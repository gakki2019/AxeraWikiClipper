/**
 * Parse a user-provided wiki URL.
 *
 * Accepted URL shapes (full URL only — bare numeric pageId is NOT supported as
 * of v0.2.0):
 *   - `https://<host>/pages/viewpage.action?pageId=242053973[&...]`
 *   - `https://<host>/spaces/<space>/pages/242053973/<slug>`
 *   - `https://<host>/display/<spaceKey>/<Title>`   (spaces encoded as `+` or `%20`)
 *   - `https://<host>/display/~<user>/<Title>`      (personal space)
 *
 * The first two resolve to a pageId directly. `/display/` URLs only carry
 * spaceKey + display title; callers resolve them into a pageId via a REST
 * query (`GET /rest/api/content?spaceKey=X&title=Y`).
 *
 * tinyui short URLs (`/x/...`) remain unsupported; use `isTinyUiLink` to
 * produce a specific error message.
 *
 * Returns `null` when the input is not a recognized wiki URL.
 */
export type ParsedWikiUrl =
  | { kind: "id"; pageId: string }
  | { kind: "display"; spaceKey: string; title: string };

export function parseWikiUrl(input: string): ParsedWikiUrl | null {
  if (!input) return null;
  const raw = input.trim();
  if (raw.length === 0) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const pageIdParam = url.searchParams.get("pageId");
  if (pageIdParam && /^\d{3,}$/.test(pageIdParam)) {
    return { kind: "id", pageId: pageIdParam };
  }

  const m = url.pathname.match(/\/pages\/(\d{3,})(?:\/|$)/);
  if (m) return { kind: "id", pageId: m[1] };

  const disp = url.pathname.match(/^\/display\/([^/]+)\/(.+)$/);
  if (disp) {
    const spaceKey = decodeDisplaySegment(disp[1]);
    let rawTitle = disp[2];
    if (rawTitle.endsWith("/")) rawTitle = rawTitle.slice(0, -1);
    const title = decodeDisplaySegment(rawTitle);
    if (spaceKey && title) {
      return { kind: "display", spaceKey, title };
    }
  }

  return null;
}

/** Is the given input a tinyui short link (`/x/...`)? */
export function isTinyUiLink(input: string): boolean {
  try {
    const u = new URL(input.trim());
    return /\/x\/[A-Za-z0-9_-]+/.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Decode a `/display/` URL path segment. Confluence historically encodes
 * spaces as `+`, so convert `+` → space before `decodeURIComponent` (which
 * handles `%20` and friends).
 */
function decodeDisplaySegment(seg: string): string {
  const withSpaces = seg.replace(/\+/g, " ");
  try {
    return decodeURIComponent(withSpaces);
  } catch {
    return withSpaces;
  }
}
