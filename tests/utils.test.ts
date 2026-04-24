import { describe, expect, it } from "vitest";
import { sanitizeFilename, joinVaultPath } from "../src/utils/filename";
import { parseWikiUrl, isTinyUiLink } from "../src/utils/url";

describe("sanitizeFilename", () => {
  it("keeps CJK and spaces", () => {
    expect(sanitizeFilename("AX8860 AXCL runtime 支持pytorch VMM")).toBe(
      "AX8860 AXCL runtime 支持pytorch VMM"
    );
  });
  it("replaces illegal chars", () => {
    expect(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j')).toBe("a_b_c_d_e_f_g_h_i_j");
  });
  it("strips trailing dots/spaces", () => {
    expect(sanitizeFilename("hello...   ")).toBe("hello");
  });
  it("falls back to untitled", () => {
    expect(sanitizeFilename("")).toBe("untitled");
    expect(sanitizeFilename("   ")).toBe("untitled");
  });
});

describe("joinVaultPath", () => {
  it("joins segments with forward slashes", () => {
    expect(joinVaultPath("inbox", "Foo", "bar.md")).toBe("inbox/Foo/bar.md");
  });
  it("tolerates leading/trailing slashes", () => {
    expect(joinVaultPath("/inbox/", "/Foo/", "/bar.md")).toBe("inbox/Foo/bar.md");
  });
});

describe("parseWikiUrl", () => {
  it("extracts id from viewpage.action", () => {
    expect(
      parseWikiUrl("https://wiki.aixin-chip.com/pages/viewpage.action?pageId=242053973")
    ).toEqual({ kind: "id", pageId: "242053973" });
  });
  it("extracts id from /pages/<id>/ path", () => {
    expect(
      parseWikiUrl("https://wiki.aixin-chip.com/spaces/~foo/pages/242053973/Some+Title")
    ).toEqual({ kind: "id", pageId: "242053973" });
  });
  it("parses /display/<space>/<title> with '+' as space", () => {
    expect(parseWikiUrl("https://wiki.aixin-chip.com/display/SW/07.+FAQ")).toEqual({
      kind: "display",
      spaceKey: "SW",
      title: "07. FAQ",
    });
  });
  it("parses /display/<space>/<title> with percent-encoded space", () => {
    expect(parseWikiUrl("https://wiki.aixin-chip.com/display/SW/07.%20FAQ")).toEqual({
      kind: "display",
      spaceKey: "SW",
      title: "07. FAQ",
    });
  });
  it("parses personal-space /display/~user/<title>", () => {
    expect(
      parseWikiUrl("https://wiki.aixin-chip.com/display/~jingxiaoping/My+Page")
    ).toEqual({ kind: "display", spaceKey: "~jingxiaoping", title: "My Page" });
  });
  it("rejects bare numeric id (v0.2.0: full URL required)", () => {
    expect(parseWikiUrl("242053973")).toBeNull();
    expect(parseWikiUrl("  242053973  ")).toBeNull();
  });
  it("rejects junk and unrelated URLs", () => {
    expect(parseWikiUrl("")).toBeNull();
    expect(parseWikiUrl("abc")).toBeNull();
    expect(parseWikiUrl("https://example.com/foo")).toBeNull();
  });
  it("detects tinyui links", () => {
    expect(isTinyUiLink("https://wiki.aixin-chip.com/x/VXNtDg")).toBe(true);
    expect(
      isTinyUiLink("https://wiki.aixin-chip.com/pages/viewpage.action?pageId=1")
    ).toBe(false);
  });
});

