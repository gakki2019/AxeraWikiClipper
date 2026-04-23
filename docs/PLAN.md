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
1. User runs command → modal prompts URL or pageId.
2. Parse pageId (support `viewpage.action?pageId=`, `/spaces/.../pages/<id>/...`, bare id).
3. `GET /rest/api/content/{id}?expand=body.storage,title,version,space`.
4. `GET /rest/api/content/{id}/child/attachment?limit=200` (handle pagination).
5. Create `<inbox>/<sanitizedTitle>/`.
6. Parallel-download (concurrency 8) every attachment.
7. Convert body.storage via turndown + GFM + Confluence macro rules; rewrite `ri:attachment` refs.
8. Prepend YAML frontmatter (if enabled).
9. Overwrite `<inbox>/<sanitizedTitle>.md`.

## Converter rules
See `/memories/repo/plan.md` § Converter rules.

## Settings (11 items, final)
Connection: baseUrl, authMode, username, password, cookie
Storage: inboxPath, filenameSource, overwriteExisting, downloadAllAttachments (**default: off**)
Markdown: writeFrontmatter, linkStyle (**default: `wikilink`**; alternative `markdown`)
Hardcoded: concurrency=8, timeout=30s, frontmatter field set.

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
The Download modal uses a stacked layout: "URL or page ID" label + single-line description (`white-space: nowrap`) on top, then a full-width `<input>`. Title reads `Download Axera wiki page`. Enter submits; Esc closes.

### Enriched frontmatter
`?expand=history,history.lastUpdated` yields page history; frontmatter now includes `createdBy`, `createdAt`, `lastModifiedBy`, `lastModifiedAt` in addition to the original set. `fetchedAt` uses `Date.toISOString()` (trailing `Z` = UTC).

## Scope
- IN: single-URL download, attachments (referenced by default, all opt-in), Markdown conversion, overwrite, 2-mode auth, settings UI.
- OUT: child-page recursion, incremental sync, comments, version history, SSO/OAuth.
