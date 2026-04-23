/**
 * Sanitize a string to be safe as a Windows/macOS/Linux file or folder name.
 *
 * - Replaces illegal chars `<>:"/\|?*` and control chars with `_`
 * - Strips trailing dots/spaces (Windows-hostile)
 * - Collapses runs of whitespace
 * - Falls back to "untitled" if the result is empty
 * - Allows unicode (CJK etc.)
 */
export function sanitizeFilename(name: string): string {
  if (!name) return "untitled";
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned : "untitled";
}

/**
 * Join two vault-relative path segments with a forward slash (Obsidian normalizes to `/`).
 * Leading/trailing slashes on segments are tolerated.
 */
export function joinVaultPath(...segments: string[]): string {
  return segments
    .map((s) => s.replace(/^\/+|\/+$/g, ""))
    .filter((s) => s.length > 0)
    .join("/");
}
