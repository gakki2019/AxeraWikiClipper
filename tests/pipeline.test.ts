import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------- Mock the `obsidian` module ----------
// The pipeline only uses Notice (side-effect only), normalizePath, and Vault typing.
vi.mock("obsidian", () => {
  class Notice {
    constructor(_msg: string) {}
  }
  const normalizePath = (p: string): string =>
    p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
  return {
    Notice,
    normalizePath,
    // Unused in this test; provide stubs so imports don't fail.
    requestUrl: vi.fn(),
    Plugin: class {},
    PluginSettingTab: class {},
    Setting: class {},
    Modal: class {},
  };
});

import { Pipeline } from "../src/confluence/pipeline";
import { ConfluenceClient } from "../src/confluence/client";
import type { AxWikiClipperSettings } from "../src/settings";
import { DEFAULT_SETTINGS } from "../src/settings";
import type { Attachment, PageInfo } from "../src/confluence/client";

// ---------- Load real fixtures ----------
const PAGE_FIXTURE = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/242053973.json"), "utf8")
) as { id: string; title: string; body: { storage: { value: string } } };

const ATTACH_FIXTURE = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/attachment.json"), "utf8")
) as {
  results: Array<{
    id: string;
    title: string;
    extensions?: { mediaType?: string; fileSize?: number };
    _links?: { download?: string };
  }>;
};

const PAGE_TITLE = PAGE_FIXTURE.title;

// ---------- Build in-memory fakes ----------
interface FakeFile {
  path: string;
  binary?: ArrayBuffer;
  text?: string;
}

function makeFakeVault() {
  const files = new Map<string, FakeFile>();
  const folders = new Set<string>();
  const vault = {
    getAbstractFileByPath: (p: string) =>
      files.get(p) ?? (folders.has(p) ? { path: p } : null),
    createFolder: async (p: string) => {
      folders.add(p);
    },
    create: async (p: string, content: string) => {
      files.set(p, { path: p, text: content });
    },
    createBinary: async (p: string, data: ArrayBuffer) => {
      files.set(p, { path: p, binary: data });
    },
    modify: async (f: { path: string }, content: string) => {
      files.set(f.path, { path: f.path, text: content });
    },
    modifyBinary: async (f: { path: string }, data: ArrayBuffer) => {
      files.set(f.path, { path: f.path, binary: data });
    },
  };
  return { vault, files, folders };
}

function makeFakePage(): PageInfo {
  return {
    id: PAGE_FIXTURE.id,
    title: PAGE_FIXTURE.title,
    spaceKey: "~jingxiaoping",
    version: 1,
    storageXhtml: PAGE_FIXTURE.body.storage.value,
    webUrl: `https://wiki.aixin-chip.com/pages/viewpage.action?pageId=${PAGE_FIXTURE.id}`,
    createdBy: "jingxiaoping",
    createdAt: "2026-04-22T07:56:52.000Z",
    lastModifiedBy: "jingxiaoping",
    lastModifiedAt: "2026-04-22T12:21:00.000Z",
  };
}

function makeFakeAttachments(): Attachment[] {
  return ATTACH_FIXTURE.results.map((r) => ({
    id: r.id,
    title: r.title,
    mediaType: r.extensions?.mediaType ?? "",
    fileSize: r.extensions?.fileSize ?? 0,
    downloadPath: r._links?.download ?? "",
  }));
}

// Track which download URLs the pipeline fetched.
function makeFakeClient(): { fetched: string[]; patch: () => void } {
  const fetched: string[] = [];
  const patch = () => {
    const proto = ConfluenceClient.prototype as unknown as {
      getPage: (id: string) => Promise<PageInfo>;
      listAttachments: (id: string) => Promise<Attachment[]>;
      downloadAttachment: (url: string) => Promise<ArrayBuffer>;
    };
    proto.getPage = async () => makeFakePage();
    proto.listAttachments = async () => makeFakeAttachments();
    proto.downloadAttachment = async (url: string) => {
      fetched.push(url);
      const tail = decodeURIComponent(url.split(/[?#]/, 1)[0].split("/").pop() || "");
      const buf = new TextEncoder().encode(`FAKE_CONTENT_FOR:${tail}`).buffer;
      return buf;
    };
  };
  return { fetched, patch };
}

function makeSettings(overrides: Partial<AxWikiClipperSettings> = {}): AxWikiClipperSettings {
  return {
    ...DEFAULT_SETTINGS,
    baseUrl: "https://wiki.aixin-chip.com",
    username: "x",
    password: "x",
    ...overrides,
  };
}

// ---------- Tests ----------
describe("Pipeline end-to-end (mocked vault + client)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("saves referenced image under inbox/<title>/<filename> and MD references it", async () => {
    const { vault, files, folders } = makeFakeVault();
    const { patch } = makeFakeClient();
    patch();
    const settings = makeSettings({ downloadAllAttachments: false });
    const app = { vault } as any;
    const pipeline = new Pipeline(app, settings);

    const result = await pipeline.downloadByInput(PAGE_FIXTURE.id);

    const folder = `inbox/${PAGE_TITLE}`;
    const imgPath = `${folder}/image2026-4-22_20-21-0.png`;
    const pdfPath = `${folder}/虚拟内存到物理内存映射.pdf`;
    const mdPath = `inbox/${PAGE_TITLE}.md`;

    expect(folders.has(folder)).toBe(true);
    expect(files.has(imgPath), `expected ${imgPath} to exist, got: ${[...files.keys()].join(", ")}`).toBe(true);
    expect(files.has(pdfPath)).toBe(true);
    expect(files.has(mdPath)).toBe(true);
    // Stale attachment not referenced in body must NOT be saved.
    expect(files.has(`${folder}/image2026-4-22_15-56-55.png`)).toBe(false);

    const md = files.get(mdPath)!.text!;
    expect(md).toContain(`![[${folder}/image2026-4-22_20-21-0.png]]`);
    expect(md).toContain(`[[${folder}/虚拟内存到物理内存映射.pdf|虚拟内存到物理内存映射]]`);

    expect(result.attachmentCount).toBe(2);
    expect(result.failedAttachments).toEqual([]);
  });

  it("with downloadAllAttachments=true, saves all 4 attachments by URL basename", async () => {
    const { vault, files } = makeFakeVault();
    const { patch } = makeFakeClient();
    patch();
    const settings = makeSettings({ downloadAllAttachments: true });
    const app = { vault } as any;
    const pipeline = new Pipeline(app, settings);

    await pipeline.downloadByInput(PAGE_FIXTURE.id);

    const folder = `inbox/${PAGE_TITLE}`;
    expect(files.has(`${folder}/image2026-4-22_20-21-0.png`)).toBe(true);
    expect(files.has(`${folder}/image2026-4-22_15-56-55.png`)).toBe(true);
    expect(files.has(`${folder}/虚拟内存到物理内存映射.pdf`)).toBe(true);
    expect(files.has(`${folder}/CUDA_Driver_API.pdf`)).toBe(true);

    // Md still references only the in-body image, and that file exists.
    const md = files.get(`inbox/${PAGE_TITLE}.md`)!.text!;
    expect(md).toContain(`![[${folder}/image2026-4-22_20-21-0.png]]`);
  });

  it("frontmatter includes author + modified fields", async () => {
    const { vault, files } = makeFakeVault();
    const { patch } = makeFakeClient();
    patch();
    const settings = makeSettings();
    const app = { vault } as any;
    const pipeline = new Pipeline(app, settings);
    await pipeline.downloadByInput(PAGE_FIXTURE.id);

    const md = files.get(`inbox/${PAGE_TITLE}.md`)!.text!;
    expect(md).toMatch(/^---\n/);
    expect(md).toContain(`pageId: "${PAGE_FIXTURE.id}"`);
    expect(md).toContain(`createdBy: "jingxiaoping"`);
    expect(md).toContain(`lastModifiedBy: "jingxiaoping"`);
    expect(md).toContain(`lastModifiedAt: "2026-04-22T12:21:00.000Z"`);
    expect(md).toContain(`fetchedAt: "`);
  });
});
