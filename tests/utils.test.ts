import { describe, expect, it } from "vitest";
import { sanitizeFilename, joinVaultPath } from "../src/utils/filename";
import { parsePageId, isTinyUiLink } from "../src/utils/url";

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

describe("parsePageId", () => {
  it("extracts from viewpage.action", () => {
    expect(
      parsePageId("https://wiki.aixin-chip.com/pages/viewpage.action?pageId=242053973")
    ).toBe("242053973");
  });
  it("extracts from /pages/<id>/ path", () => {
    expect(
      parsePageId("https://wiki.aixin-chip.com/spaces/~foo/pages/242053973/Some+Title")
    ).toBe("242053973");
  });
  it("accepts bare numeric id", () => {
    expect(parsePageId("242053973")).toBe("242053973");
    expect(parsePageId("  242053973  ")).toBe("242053973");
  });
  it("rejects junk", () => {
    expect(parsePageId("")).toBeNull();
    expect(parsePageId("abc")).toBeNull();
    expect(parsePageId("https://example.com/foo")).toBeNull();
  });
  it("detects tinyui links", () => {
    expect(isTinyUiLink("https://wiki.aixin-chip.com/x/VXNtDg")).toBe(true);
    expect(isTinyUiLink("https://wiki.aixin-chip.com/pages/viewpage.action?pageId=1")).toBe(false);
  });
});
