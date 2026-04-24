# AxeraWikiClipper — Plan

See source in `/memories/repo/plan.md`; this doc mirrors the final agreed plan.

## Identity
- Plugin id: `ax-wiki-clipper` (folder + manifest.id; unchanged so existing installs keep their `data.json`)
- Display name: `AxeraWikiClipper` (manifest.name; also the Ctrl+P command prefix)
- Author: `yayajxp`
- Description: `Clipper Axera wiki page to vault.`
- Command: `Download wiki page by URL` (id: `download-wiki`)
- Ribbon icon: custom SVG `axera-wiki` (from `docs/wiki.svg`, registered via `addIcon`). `fill="currentColor"` so it follows theme/hover/disabled colors automatically. No CSS color override.
- Triggers: ribbon icon + command palette + user-assignable hotkey

## Goal
Single-command Obsidian plugin that downloads a Confluence page + all attachments into `inbox/<title>.md` and `inbox/<title>/` under the active vault. Single URL only, overwrite on conflict.

## Target environment
- Wiki: https://wiki.aixin-chip.com (Atlassian Confluence, REST API available).
- Build: TypeScript + esbuild.
- Runtime HTTP: Obsidian `requestUrl` only.

## Authentication
- PAT endpoint returns 404 → not available.
- Basic Auth (default) + Cookie fallback.
- Always send `X-Atlassian-Token: no-check`.

## Data flow
1. User runs command → modal prompts a full wiki page URL.
2. Parse URL via `parseWikiUrl` (supports `viewpage.action?pageId=`, `/spaces/.../pages/<id>/...`, `/display/<space>/<title>`; bare numeric pageId is NOT accepted as of v0.2.0).
3. For `/display/` URLs, resolve to pageId via `GET /rest/api/content?spaceKey=X&title=Y&limit=1`.
4. `GET /rest/api/content/{id}?expand=body.storage,title,version,space,history,history.lastUpdated`.
5. `GET /rest/api/content/{id}/child/attachment?limit=200` (handle pagination).
6. Dedup by pageId: scan `<inbox>/*.md` frontmatter. On hit at different path, best-effort delete old `.md` + old attachments folder after new write (failures are logged, never block).
7. If target filename is already taken by an unrelated pageId, disambiguate with ` (<pageId>)` suffix.
8. Create `<inbox>/<sanitizedTitle>/`.
9. Parallel-download (concurrency 8) every attachment.
10. Convert body.storage via turndown + GFM + Confluence macro rules; rewrite `ri:attachment` refs.
11. Prepend YAML frontmatter (always).
12. Write `<inbox>/<sanitizedTitle>.md` (overwrite on existing).

## Converter rules
See `/memories/repo/plan.md` § Converter rules.

## Settings (8 items, final)
Connection: baseUrl, authMode, username, password, cookie
Storage: inboxPath, downloadAllAttachments (**default: off**)
Markdown: linkStyle (**default: `wikilink`**; alternative `markdown`)
Hardcoded: concurrency=8, timeout=30s, frontmatter is always written (always-on), overwrite is always-on.

> Removed in v0.2.0: `filenameSource` (we always use sanitized title; collisions are disambiguated by pageId suffix), `overwriteExisting` (always overwrite; dedup by pageId handles renames), `writeFrontmatter` (always written; frontmatter `pageId` is required for dedup to work).

## Logging
- `[AxeraWikiClipper]` prefix, console-only, 4 levels.
- dev build → DEBUG; prod build → INFO.
- Runtime override: `window.AxWikiClipperDebug = true`.
- Settings page has a **toggle** (not a one-shot button) that flips the override; `logger` exposes `enableDebug()`, `disableDebug()`, `isDebugEnabled()`.

## Post-ship design refinements

### Attachment reference style is user-selectable
New setting `linkStyle` (`wikilink` | `markdown`, default `wikilink`). Passed through `Pipeline` to `xhtmlToMarkdown` via `ConvertOptions.linkStyle`. `buildImageHtml` and `buildLinkHtml` in the converter branch on it:
- `wikilink` (default): emits `<img data-wikilink=...>` / `<a data-wikilink=...>`, turndown rules render `![[path]]` / `[[path|alias]]`.
- `markdown`: emits plain `<img src="url-encoded-path">` / `<a href="url-encoded-path">`, turndown renders `![](path)` / `[alias](path)`.
The on-disk attachment layout and filenames are identical in both modes; only the reference syntax differs.

### Attachment references: Obsidian wikilinks (default)
Local attachments are emitted as Obsidian wikilinks, not standard markdown links:
- Images:   `![[inbox/<title>/<filename>]]` (no alias)
- Files:    `[[inbox/<title>/<filename>|<filename-without-ext>]]`

Reasons: standard markdown `![](url-encoded/path)` is unreliable for non-ASCII vault paths; wikilinks with slashes resolve from vault root, so we must include the full `inbox/<title>/` prefix.

### Attachment filename source
Confluence REST `title` of an attachment can diverge from the `ri:filename` referenced in the body (e.g. after rename, or when historical versions are present). The canonical name lives in the attachment's download URL path. We always save each attachment using the basename taken from its download URL and match body references against that name.

### downloadAllAttachments default = off
The attachment list REST endpoint returns historic attachments even when the current body no longer references them. Example: `image2026-4-22_15-56-55.png` was uploaded in an earlier page version, replaced by `image2026-4-22_20-21-0.png` in the current body. Downloading by default everything the API returns is noisy, so the default is to download only what the body references. Toggle on when you want a full archive.

### Download redirect-loop fallback
Some Confluence Server deployments return `HTTP 3xx → ERR_TOO_MANY_REDIRECTS` for `/download/attachments/<id>/<file>?version=1&modificationDate=...&api=v2`. On that specific error, the client retries once with the query string stripped (plain path). This behavior is unit-tested in `tests/client.test.ts`.

### Modal layout
The Download modal uses a stacked layout: "Wiki page URL" label + single-line description (`white-space: nowrap`) on top, then a full-width `<input>`. Title reads `Download Axera wiki page`. Enter submits; Esc closes.

### Enriched frontmatter
`?expand=history,history.lastUpdated` yields page history; frontmatter now includes `createdBy`, `createdAt`, `lastModifiedBy`, `lastModifiedAt` in addition to the original set. `fetchedAt` uses `Date.toISOString()` (trailing `Z` = UTC).

### v0.2.0 — URL coverage + pageId dedup
- `parseWikiUrl` replaces `parsePageId`. Returns either `{kind:"id", pageId}` or `{kind:"display", spaceKey, title}`. Bare numeric pageId is rejected (a full URL is required).
- `/display/<Space>/<Title>` URLs are resolved to a pageId via `GET /rest/api/content?spaceKey=X&title=Y&limit=1`. Spaces in the title path may be encoded as `+` or `%20`; both are normalized. Personal-space URLs `/display/~user/...` are supported.
- pageId is the dedup key. Before writing a new note, we scan `<inbox>/*.md` for frontmatter `pageId: "..."` matching the page being downloaded. On a hit at a different path (e.g. the page was renamed on the wiki side), the new file is written at the new location and the old `.md` + its attachment folder are deleted best-effort. Delete failures (permissions, open file, etc.) are logged and swallowed — the new write always succeeds; the stale file is left as an orphan.
- Collision on target filename by an UNRELATED pageId produces a ` (<pageId>)` suffix (e.g. `07. FAQ (242053973).md` + `07. FAQ (242053973)/`).
- Frontmatter is always written; `pageId` field is mandatory for dedup scanning.

## Scope
- IN: single-URL download, attachments (referenced by default, all opt-in), Markdown conversion, overwrite, 2-mode auth, settings UI.
- OUT: child-page recursion, incremental sync, comments, version history, SSO/OAuth.
