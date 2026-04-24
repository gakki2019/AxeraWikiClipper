import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------- Mock the `obsidian` module ----------
// The pipeline uses Notice (side-effect only), normalizePath, Vault typing,
// and the TFile/TFolder classes (for instanceof checks in dedup scanning).
vi.mock("obsidian", () => {
  class Notice {
    constructor(_msg: string) {}
  }
  const normalizePath = (p: string): string =>
    p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
  class TFile {
    path = "";
    name = "";
    basename = "";
    extension = "";
    parent: TFolder | null = null;
  }
  class TFolder {
    path = "";
    name = "";
    parent: TFolder | null = null;
    children: Array<TFile | TFolder> = [];
  }
  return {
    Notice,
    normalizePath,
    TFile,
    TFolder,
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
import { TFile as StubTFile, TFolder as StubTFolder } from "obsidian";

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
const PAGE_URL = `https://wiki.aixin-chip.com/pages/viewpage.action?pageId=${PAGE_FIXTURE.id}`;

// ---------- Build in-memory fakes ----------
interface FakeFile {
  path: string;
  binary?: ArrayBuffer;
  text?: string;
}

function makeFakeVault(opts: { deleteFails?: (path: string) => boolean } = {}) {
  const files = new Map<string, FakeFile>();
  const folders = new Set<string>();
  const folderChildren = new Map<string, Array<StubTFile | StubTFolder>>();

  function toTFile(path: string): StubTFile {
    const f = new StubTFile();
    f.path = path;
    const lastSlash = path.lastIndexOf("/");
    f.name = path.slice(lastSlash + 1);
    const dot = f.name.lastIndexOf(".");
    f.basename = dot >= 0 ? f.name.slice(0, dot) : f.name;
    f.extension = dot >= 0 ? f.name.slice(dot + 1) : "";
    return f;
  }
  function toTFolder(path: string): StubTFolder {
    const f = new StubTFolder();
    f.path = path;
    f.name = path.slice(path.lastIndexOf("/") + 1);
    f.children = folderChildren.get(path) ?? [];
    return f;
  }
  function parentOf(p: string): string {
    const i = p.lastIndexOf("/");
    return i >= 0 ? p.slice(0, i) : "";
  }
  function addChild(path: string, child: StubTFile | StubTFolder) {
    const parent = parentOf(path);
    if (!parent) return;
    const arr = folderChildren.get(parent) ?? [];
    if (!arr.find((c) => c.path === path)) arr.push(child);
    folderChildren.set(parent, arr);
  }
  function removeChild(path: string) {
    const parent = parentOf(path);
    const arr = folderChildren.get(parent);
    if (!arr) return;
    const i = arr.findIndex((c) => c.path === path);
    if (i >= 0) arr.splice(i, 1);
  }

  const vault = {
    getAbstractFileByPath: (p: string) => {
      if (files.has(p)) return toTFile(p);
      if (folders.has(p)) return toTFolder(p);
      return null;
    },
    createFolder: async (p: string) => {
      folders.add(p);
      const f = toTFolder(p);
      addChild(p, f);
    },
    create: async (p: string, content: string) => {
      files.set(p, { path: p, text: content });
      addChild(p, toTFile(p));
    },
    createBinary: async (p: string, data: ArrayBuffer) => {
      files.set(p, { path: p, binary: data });
      addChild(p, toTFile(p));
    },
    modify: async (f: { path: string }, content: string) => {
      files.set(f.path, { path: f.path, text: content });
    },
    modifyBinary: async (f: { path: string }, data: ArrayBuffer) => {
      files.set(f.path, { path: f.path, binary: data });
    },
    read: async (f: { path: string }) => {
      const entry = files.get(f.path);
      if (!entry || entry.text === undefined) {
        throw new Error(`not a text file: ${f.path}`);
      }
      return entry.text;
    },
    delete: async (f: { path: string }, _recursive?: boolean) => {
      if (opts.deleteFails && opts.deleteFails(f.path)) {
        throw new Error(`fake delete denied: ${f.path}`);
      }
      if (files.has(f.path)) {
        files.delete(f.path);
        removeChild(f.path);
        return;
      }
      if (folders.has(f.path)) {
        // recursively drop all files under the folder
        for (const k of [...files.keys()]) {
          if (k.startsWith(f.path + "/")) {
            files.delete(k);
            removeChild(k);
          }
        }
        folders.delete(f.path);
        removeChild(f.path);
        folderChildren.delete(f.path);
        return;
      }
      throw new Error(`not found: ${f.path}`);
    },
  };
  return { vault, files, folders };
}

function makeFakePage(overrides: Partial<PageInfo> = {}): PageInfo {
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
    ...overrides,
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
function makeFakeClient(pageOverride?: () => PageInfo): { fetched: string[]; patch: () => void } {
  const fetched: string[] = [];
  const patch = () => {
    const proto = ConfluenceClient.prototype as unknown as {
      getPage: (id: string) => Promise<PageInfo>;
      listAttachments: (id: string) => Promise<Attachment[]>;
      downloadAttachment: (url: string) => Promise<ArrayBuffer>;
      resolvePageIdByTitle: (space: string, title: string) => Promise<string>;
    };
    proto.getPage = async () => (pageOverride ? pageOverride() : makeFakePage());
    proto.listAttachments = async () => makeFakeAttachments();
    proto.downloadAttachment = async (url: string) => {
      fetched.push(url);
      const tail = decodeURIComponent(url.split(/[?#]/, 1)[0].split("/").pop() || "");
      const buf = new TextEncoder().encode(`FAKE_CONTENT_FOR:${tail}`).buffer;
      return buf;
    };
    proto.resolvePageIdByTitle = async (_space: string, _title: string) => PAGE_FIXTURE.id;
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
    const settings = makeSettings();
    const app = { vault } as any;
    const pipeline = new Pipeline(app, settings);

    const result = await pipeline.downloadByInput(PAGE_URL);

    const folder = `inbox/${PAGE_TITLE}`;
    const imgPath = `${folder}/image2026-4-22_20-21-0.png`;
    const pdfPath = `${folder}/虚拟内存到物理内存映射.pdf`;
    const mdPath = `inbox/${PAGE_TITLE}.md`;

    expect(folders.has(folder)).toBe(true);
    expect(
      files.has(imgPath),
      `expected ${imgPath} to exist, got: ${[...files.keys()].join(", ")}`
    ).toBe(true);
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

    await pipeline.downloadByInput(PAGE_URL);

    const folder = `inbox/${PAGE_TITLE}`;
    expect(files.has(`${folder}/image2026-4-22_20-21-0.png`)).toBe(true);
    expect(files.has(`${folder}/image2026-4-22_15-56-55.png`)).toBe(true);
    expect(files.has(`${folder}/虚拟内存到物理内存映射.pdf`)).toBe(true);
    expect(files.has(`${folder}/CUDA_Driver_API.pdf`)).toBe(true);

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
    await pipeline.downloadByInput(PAGE_URL);

    const md = files.get(`inbox/${PAGE_TITLE}.md`)!.text!;
    expect(md).toMatch(/^---\n/);
    expect(md).toContain(`pageId: "${PAGE_FIXTURE.id}"`);
    expect(md).toContain(`createdBy: "jingxiaoping"`);
    expect(md).toContain(`lastModifiedBy: "jingxiaoping"`);
    expect(md).toContain(`lastModifiedAt: "2026-04-22T12:21:00.000Z"`);
    expect(md).toContain(`fetchedAt: "`);
  });

  it("accepts /display/<space>/<title> URLs via resolvePageIdByTitle", async () => {
    const { vault, files } = makeFakeVault();
    const { patch } = makeFakeClient();
    patch();
    const settings = makeSettings();
    const app = { vault } as any;
    const pipeline = new Pipeline(app, settings);
    await pipeline.downloadByInput(
      "https://wiki.aixin-chip.com/display/~jingxiaoping/" +
        encodeURIComponent(PAGE_TITLE)
    );
    expect(files.has(`inbox/${PAGE_TITLE}.md`)).toBe(true);
  });

  it("renames on pageId dedup hit: writes new path and deletes old md + old folder", async () => {
    const { vault, files, folders } = makeFakeVault();
    const { patch } = makeFakeClient();
    patch();
    const settings = makeSettings();
    const app = { vault } as any;

    // Pre-populate vault with an old note for the same pageId at a different path.
    await vault.createFolder("inbox");
    await vault.create(
      "inbox/OldTitle.md",
      `---\npageId: "${PAGE_FIXTURE.id}"\n---\nold body\n`
    );
    await vault.createFolder("inbox/OldTitle");
    await vault.createBinary(
      "inbox/OldTitle/leftover.png",
      new TextEncoder().encode("stale").buffer
    );

    const pipeline = new Pipeline(app, settings);
    await pipeline.downloadByInput(PAGE_URL);

    expect(files.has(`inbox/${PAGE_TITLE}.md`)).toBe(true);
    expect(files.has("inbox/OldTitle.md")).toBe(false);
    expect(files.has("inbox/OldTitle/leftover.png")).toBe(false);
    expect(folders.has("inbox/OldTitle")).toBe(false);
  });

  it("delete-old failure does not block new write (orphan allowed)", async () => {
    const { vault, files } = makeFakeVault({
      deleteFails: (p) => p === "inbox/OldTitle.md",
    });
    const { patch } = makeFakeClient();
    patch();
    const settings = makeSettings();
    const app = { vault } as any;

    await vault.createFolder("inbox");
    await vault.create(
      "inbox/OldTitle.md",
      `---\npageId: "${PAGE_FIXTURE.id}"\n---\nold body\n`
    );

    const pipeline = new Pipeline(app, settings);
    await pipeline.downloadByInput(PAGE_URL);

    // New file written.
    expect(files.has(`inbox/${PAGE_TITLE}.md`)).toBe(true);
    // Old file retained as orphan (delete threw, swallowed).
    expect(files.has("inbox/OldTitle.md")).toBe(true);
  });

  it("different pageId occupying same filename gets (pageId) suffix", async () => {
    const { vault, files } = makeFakeVault();
    const { patch } = makeFakeClient();
    patch();
    const settings = makeSettings();
    const app = { vault } as any;

    await vault.createFolder("inbox");
    // Pre-existing file at target name with a DIFFERENT pageId.
    await vault.create(
      `inbox/${PAGE_TITLE}.md`,
      `---\npageId: "99999999"\n---\nunrelated page\n`
    );

    const pipeline = new Pipeline(app, settings);
    const result = await pipeline.downloadByInput(PAGE_URL);

    const suffixed = `inbox/${PAGE_TITLE} (${PAGE_FIXTURE.id}).md`;
    expect(result.markdownPath).toBe(suffixed);
    expect(files.has(suffixed)).toBe(true);
    // Unrelated existing file is preserved.
    const original = files.get(`inbox/${PAGE_TITLE}.md`)!.text!;
    expect(original).toContain(`pageId: "99999999"`);
  });
});

