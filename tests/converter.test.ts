import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { xhtmlToMarkdown } from "../src/confluence/converter";

const FIXTURE_JSON = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/242053973.json"), "utf8")
) as { title: string; body: { storage: { value: string } } };

const ATTACHMENTS_JSON = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/attachment.json"), "utf8")
) as { results: Array<{ title: string }> };

const TITLE = FIXTURE_JSON.title;
const XHTML = FIXTURE_JSON.body.storage.value;
const ATTACH_NAMES = new Set(ATTACHMENTS_JSON.results.map((r) => r.title));

function convert(): string {
  return xhtmlToMarkdown(XHTML, {
    titleFolder: TITLE,
    baseUrl: "https://wiki.aixin-chip.com",
    attachmentFilenames: ATTACH_NAMES,
  });
}

describe("xhtmlToMarkdown on real fixture", () => {
  it("renders h1 headings", () => {
    const md = convert();
    expect(md).toMatch(/^# 背景/m);
    expect(md).toMatch(/^# 竞品/m);
  });

  it("rewrites ac:image to an Obsidian wikilink embed pointing at the local folder", () => {
    const md = convert();
    expect(md).toContain(`![[${TITLE}/image2026-4-22_20-21-0.png]]`);
  });

  it("rewrites ac:link→ri:attachment to a wikilink with basename alias", () => {
    const md = convert();
    expect(md).toContain(
      `[[${TITLE}/虚拟内存到物理内存映射.pdf|虚拟内存到物理内存映射]]`
    );
  });

  it("emits a fenced code block with cpp language", () => {
    const md = convert();
    expect(md).toMatch(/```cpp\nvoid SampleTest\(\)/);
    // Code ends with `}` followed by the closing fence.
    expect(md).toMatch(/aclrtFreePhysical\(handle\);[\s\S]*?\n\}\n```/);
  });

  it("preserves code-macro title as bold paragraph above the fence", () => {
    const md = convert();
    expect(md).toMatch(/\*\*sample\*\*\s*\n+```cpp/);
  });

  it("drops empty paragraphs and auto-cursor-target", () => {
    const md = convert();
    // No excessive blank runs
    expect(md).not.toMatch(/\n{3,}/);
  });

  it("preserves external anchor URLs", () => {
    const md = convert();
    expect(md).toContain("https://www.hiascend.com/document/detail/zh/canncommercial/850/API/appdevgapi/aclcppdevg_03_0114.html");
    expect(md).toContain(
      "https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/virtual-memory-management.html#reserve-and-map"
    );
  });

  it("strips color span wrappers but keeps text", () => {
    const md = convert();
    expect(md).toContain("Runtime提供了一套虚拟内存管理的API接口");
    expect(md).not.toContain("rgb(0,0,0)");
  });
});

describe("xhtmlToMarkdown with linkStyle=markdown", () => {
  function convertMd(titleFolder: string, attachmentHrefBase?: string): string {
    return xhtmlToMarkdown(XHTML, {
      titleFolder,
      baseUrl: "https://wiki.aixin-chip.com",
      attachmentFilenames: ATTACH_NAMES,
      linkStyle: "markdown",
      attachmentHrefBase,
    });
  }

  it("emits ![](path) for ac:image with folder relative to the MD file", () => {
    // The MD file sits in `inbox/` and the attachments in `inbox/<title>/`, so
    // `attachmentHrefBase` must be just the title — without the inbox prefix.
    const md = convertMd(`inbox/${TITLE}`, TITLE);
    // Percent-encoded segments, but `/` stays literal between folder and filename.
    expect(md).toContain(`](${encodeURIComponent(TITLE)}/image2026-4-22_20-21-0.png)`);
    // Must NOT contain a percent-encoded slash, nor the inbox prefix.
    expect(md).not.toContain("inbox%2F");
    expect(md).not.toContain("%2F");
  });

  it("emits [text](path) for ac:link→ri:attachment with alias", () => {
    const md = convertMd(`inbox/${TITLE}`, TITLE);
    const folder = encodeURIComponent(TITLE);
    const file = encodeURIComponent("虚拟内存到物理内存映射.pdf");
    expect(md).toContain(`[虚拟内存到物理内存映射](${folder}/${file})`);
  });

  it("falls back to titleFolder when attachmentHrefBase is omitted", () => {
    const md = convertMd(TITLE);
    expect(md).toContain(`](${encodeURIComponent(TITLE)}/image2026-4-22_20-21-0.png)`);
  });
});
