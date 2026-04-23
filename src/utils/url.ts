/**
 * Parse a user-provided input (URL or bare numeric pageId) into a Confluence pageId.
 *
 * Accepted:
 *   - `https://<host>/pages/viewpage.action?pageId=242053973[&...]`
 *   - `https://<host>/spaces/<space>/pages/242053973/<slug>`
 *   - bare numeric id: `"242053973"` (6–12 digits, trimmed)
 *
 * Returns `null` when the input cannot be parsed (caller should show an error).
 * tinyui short URLs (`/x/...`) are not supported in this release.
 */
export function parsePageId(input: string): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (raw.length === 0) return null;

  // Bare numeric id
  if (/^\d{6,12}$/.test(raw)) return raw;

  // Try URL parsing
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  // viewpage.action?pageId=
  const pageIdParam = url.searchParams.get("pageId");
  if (pageIdParam && /^\d{3,}$/.test(pageIdParam)) {
    return pageIdParam;
  }

  // /pages/<digits>/...  or  /spaces/.../pages/<digits>/...
  const m = url.pathname.match(/\/pages\/(\d{3,})(?:\/|$)/);
  if (m) return m[1];

  return null;
}

/**
 * Is the given input a tinyui short link (`/x/...`)? Used to produce a more
 * specific error message when parsing fails.
 */
export function isTinyUiLink(input: string): boolean {
  try {
    const u = new URL(input.trim());
    return /\/x\/[A-Za-z0-9_-]+/.test(u.pathname);
  } catch {
    return false;
  }
}
