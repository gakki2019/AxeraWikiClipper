# AxeraWikiClipper — Task List

Mirror of `/memories/repo/tasks.md`. See there for the authoritative, live version.

## Phase 1 — Scaffolding
- [x] T1.1 Initialize project layout in `d:/work`
- [x] T1.2 Declare deps: turndown, turndown-plugin-gfm, vitest, jsdom, @types/turndown
- [x] T1.3 Configure tsconfig, esbuild.config.mjs, manifest.json
- [x] T1.4 Add .gitignore, docs/PLAN.md, docs/TASKS.md
- [x] T1.5 Add vitest config + copy fixtures under tests/fixtures/

## Phase 2 — Core modules
- [x] T2.1 src/utils/filename.ts
- [x] T2.2 src/utils/url.ts
- [x] T2.3 src/utils/logger.ts
- [x] T2.4 src/settings.ts
- [x] T2.5 src/confluence/client.ts
- [x] T2.6 src/confluence/converter.ts
- [x] T2.7 src/confluence/pipeline.ts

## Phase 3 — UI & wiring
- [x] T3.1 src/ui/UrlModal.ts
- [x] T3.2 main.ts (plugin class, command, ribbon, settings tab)

## Phase 4 — Tests
- [x] T4.1 tests/utils.test.ts
- [x] T4.2 tests/converter.test.ts (fixture-driven)
- [x] T4.3 tests/client.test.ts (mocked requestUrl; verifies redirect-loop fallback)
- [x] T4.4 tests/pipeline.test.ts (mocked vault + client; end-to-end on real fixture)

## Phase 5 — Manual verification
- [x] T5.1 `npm run build` and copy dist to a test vault
- [x] T5.2 Configure auth
- [x] T5.3 Run on pageId=242053973; verify inbox tree
- [x] T5.4 Verify Obsidian preview rendering
- [ ] T5.5 Edge cases (long titles / duplicate attachments / non-ascii paths)

## Phase 6 — Polish
- [x] T6.1 README
- [ ] T6.2 Release zip

## Fixes applied after initial ship
- [x] F1 Obsidian wikilinks for local attachments (instead of encoded MD paths)
- [x] F2 Wikilinks use full vault-relative path `inbox/<title>/<file>` so Obsidian resolves from vault root
- [x] F3 Attachment filenames taken from download URL (matches `ri:filename` in body) rather than REST `title` field which can diverge across versions
- [x] F4 Attachment `<a>` wikilinks always emit `|alias` with basename (no extension)
- [x] F5 Image `<img>` wikilinks have no alias (Obsidian embed syntax)
- [x] F6 Download falls back to query-string-free URL on `ERR_TOO_MANY_REDIRECTS` (observed on `/download/attachments/.../foo.png?version=1&modificationDate=...&api=v2`)
- [x] F7 Frontmatter enriched: `createdBy`, `createdAt`, `lastModifiedBy`, `lastModifiedAt` pulled from `?expand=history,history.lastUpdated`
- [x] F8 Default `downloadAllAttachments` changed to `false` — API returns historic attachments from previous page versions (e.g. stale `image2026-4-22_15-56-55.png`) that are not referenced by the current body; downloading them by default confuses users. Off-by-default downloads only what the body references.
- [x] F9 "Enable debug logs" button given CTA (blue) styling — previous default grey button looked disabled.
- [x] F10 Rebrand: manifest.name → `AxeraWikiClipper`, author → `yayajxp`, description → `Clipper Axera wiki page to vault.`; logger prefix → `[AxeraWikiClipper]`; Notice / ribbon tooltip / command prefix all updated. Plugin id / folder kept as `ax-wiki-clipper` to preserve existing `data.json`.
- [x] F11 "Enable debug logs" changed from one-shot button to **toggle**. `logger` gained `disableDebug()` and `isDebugEnabled()`.
- [x] F12 Modal rework: title `Download Axera wiki page`; stacked layout (label + single-line nowrap description above a full-width URL input); Enter submits.
- [x] F13 Custom ribbon icon from `docs/wiki.svg` (Axera logo, two curves). Registered via `addIcon("axera-wiki", svg)`; paths use `fill="currentColor"`; 190×190 viewBox rescaled (`scale 0.0526,-0.0526`) into the 100×100 viewBox Obsidian provides. Removed the hardcoded `color:#0052cc` override in `styles.css` so the icon follows theme + hover/active/disabled states.
- [x] F14 New setting `linkStyle` (`wikilink` | `markdown`, default `wikilink`). Converter branches to emit either `![[path]]` / `[[path|alias]]` or standard `![](url-encoded)` / `[alias](url-encoded)`.
- [x] F15 v0.2.0 — Settings simplified. Removed `filenameSource`, `overwriteExisting`, `writeFrontmatter`. Filenames always use sanitized title; files are always overwritten; frontmatter is always written. Data migration: Obsidian's `loadData` merges with `DEFAULT_SETTINGS`, and old keys left in `data.json` are simply ignored by the new code — no user action required.
- [x] F16 v0.2.0 — URL parser rewritten. `parsePageId` replaced by `parseWikiUrl` returning `{kind:"id"|"display"}`. Accepts `/display/<Space>/<Title>` (including personal spaces `~user`) with `+` or `%20` as space. Rejects bare numeric ids. `ConfluenceClient.resolvePageIdByTitle(spaceKey, title)` resolves display URLs via `GET /rest/api/content?spaceKey=X&title=Y&limit=1`.
- [x] F17 v0.2.0 — pageId dedup + rename handling. Before writing, scan `<inbox>/*.md` for frontmatter `pageId: "<id>"`; on a hit at a different path, best-effort delete old `.md` + old attachment folder after the new file is in place (delete failures are swallowed; orphan allowed). Collision with an UNRELATED pageId disambiguates via ` (<pageId>)` suffix.
- [x] F18 v0.2.0 shipped. Version bumped in `manifest.json` + `package.json`; 37 tests pass (added `parseWikiUrl`, `resolvePageIdByTitle`, `/display/` end-to-end, dedup rename, delete-failure-orphan, collision-suffix cases).

## Deferred / Out of scope
Child-page recursion, incremental sync, SSO, encrypted creds, two-way sync.
