import { App, normalizePath, Notice, TFile, TFolder, Vault } from "obsidian";
import {
  ConfluenceClient,
  AuthError,
  NotFoundError,
  HttpError,
  PageInfo,
  Attachment,
} from "./client";
import { xhtmlToMarkdown } from "./converter";
import type { AxWikiClipperSettings } from "../settings";
import { HARDCODED } from "../settings";
import { parseWikiUrl, isTinyUiLink } from "../utils/url";
import { sanitizeFilename, joinVaultPath } from "../utils/filename";
import { logger } from "../utils/logger";

export interface DownloadResult {
  markdownPath: string;
  attachmentCount: number;
  failedAttachments: string[];
}

export class Pipeline {
  private client: ConfluenceClient;

  constructor(private app: App, private settings: AxWikiClipperSettings) {
    this.client = new ConfluenceClient(settings);
  }

  async downloadByInput(input: string): Promise<DownloadResult> {
    const parsed = parseWikiUrl(input);
    if (!parsed) {
      if (isTinyUiLink(input)) {
        throw new Error("Short links (/x/...) are not supported. Please paste the full page URL.");
      }
      throw new Error(
        "Invalid input: paste a full wiki page URL (e.g. /display/<Space>/<Title> or ?pageId=...)."
      );
    }
    if (parsed.kind === "id") {
      return this.downloadByPageId(parsed.pageId);
    }
    new Notice(`Resolving "${parsed.title}" in space ${parsed.spaceKey}…`);
    const pageId = await this.client.resolvePageIdByTitle(parsed.spaceKey, parsed.title);
    return this.downloadByPageId(pageId);
  }

  async downloadByPageId(pageId: string): Promise<DownloadResult> {
    logger.info("Fetching page", pageId);
    new Notice(`Fetching page ${pageId}…`);
    const page = await this.client.getPage(pageId);
    logger.info("Page", page.id, page.title, `v${page.version}`);

    const attachments = await this.client.listAttachments(pageId);
    logger.info("Attachments listed:", attachments.length);

    const inbox = (this.settings.inboxPath || "inbox").replace(/^\/+|\/+$/g, "");
    await this.ensureFolder(inbox);

    // Dedup by pageId: find any existing .md in inbox whose frontmatter
    // carries this pageId. If found and its path differs from the new desired
    // path, we will best-effort delete the stale md + attachment folder after
    // the new files are in place.
    const existingByPageId = await findExistingByPageId(this.app.vault, inbox, pageId);
    const titleBase = sanitizeFilename(page.title);
    let mdBase = titleBase;
    let folderBase = titleBase;
    const desiredMdPath = normalizePath(joinVaultPath(inbox, `${titleBase}.md`));
    if (!existingByPageId) {
      // No previous version of this page. If desired filename is already taken
      // by an UNRELATED page, disambiguate with the pageId suffix.
      const clash = this.app.vault.getAbstractFileByPath(desiredMdPath);
      if (clash) {
        mdBase = `${titleBase} (${pageId})`;
        folderBase = `${titleBase} (${pageId})`;
      }
    }
    const folderPath = normalizePath(joinVaultPath(inbox, folderBase));
    const mdPath = normalizePath(joinVaultPath(inbox, `${mdBase}.md`));
    const titleFolder = folderBase;

    // Determine which attachments to download.
    const referenced = extractReferencedFilenames(page.storageXhtml);
    const toDownload = this.settings.downloadAllAttachments
      ? attachments
      : attachments.filter((a) => {
          const urlName = filenameFromDownloadPath(a.downloadPath);
          return (
            (urlName && referenced.has(urlName)) || referenced.has(a.title)
          );
        });

    let downloaded = 0;
    const failed: string[] = [];

    if (toDownload.length > 0) {
      await this.ensureFolder(folderPath);
      new Notice(`Downloading ${toDownload.length} attachments…`);
      const results = await runWithConcurrency(toDownload, HARDCODED.concurrency, async (a) => {
        try {
          await this.downloadOne(a, folderPath);
          return { ok: true as const, name: a.title };
        } catch (e) {
          logger.warn("Attachment failed", a.title, (e as Error).message);
          return { ok: false as const, name: a.title };
        }
      });
      for (const r of results) (r.ok ? downloaded++ : failed.push(r.name));
    }

    // Convert + write markdown
    const attachmentFilenames = new Set(attachments.map((a) => a.title));
    const markdownBody = xhtmlToMarkdown(page.storageXhtml, {
      titleFolder: folderPath,
      baseUrl: this.settings.baseUrl,
      attachmentFilenames,
      linkStyle: this.settings.linkStyle,
      // Standard-markdown hrefs must be relative to the MD file, which sits in
      // the same parent as the attachment folder, so just the title is enough.
      attachmentHrefBase: titleFolder,
    });

    const frontmatter = buildFrontmatter(page);
    const fullMd = frontmatter + markdownBody;

    await this.writeMarkdown(mdPath, fullMd);

    // Rename cleanup: if we previously saved this pageId at a different path,
    // best-effort delete the stale .md and its attachment folder. Failures are
    // logged but never block.
    if (existingByPageId && existingByPageId !== mdPath) {
      await this.tryCleanupStale(existingByPageId, inbox);
    }

    const msg = failed.length
      ? `Done with ${failed.length} attachment failures. See console for details.`
      : `Done. Downloaded ${downloaded} attachments.`;
    new Notice(msg);
    logger.info("Result", { mdPath, downloaded, failed });

    return { markdownPath: mdPath, attachmentCount: downloaded, failedAttachments: failed };
  }

  /**
   * Best-effort removal of a previous .md for the same pageId and its sibling
   * attachment folder (named after the md's basename). Any failure is logged
   * and swallowed so that the new file write is never blocked.
   */
  private async tryCleanupStale(stalePath: string, inbox: string): Promise<void> {
    const v = this.app.vault;
    const staleFile = v.getAbstractFileByPath(stalePath);
    if (staleFile) {
      try {
        await v.delete(staleFile);
        logger.info("Deleted stale md", stalePath);
      } catch (e) {
        logger.warn("Could not delete stale md (kept as orphan):", stalePath, (e as Error).message);
        new Notice(`Kept old note as orphan: ${stalePath}`);
      }
    }
    const base = stalePath.replace(/\.md$/i, "");
    const folder = v.getAbstractFileByPath(base);
    if (folder) {
      try {
        await v.delete(folder, true);
        logger.info("Deleted stale attachments folder", base);
      } catch (e) {
        logger.warn(
          "Could not delete stale attachments folder (kept as orphan):",
          base,
          (e as Error).message
        );
      }
    }
  }

  private async downloadOne(a: Attachment, folderPath: string): Promise<void> {
    if (!a.downloadPath) throw new Error(`No download URL for ${a.title}`);
    const buf = await this.client.downloadAttachment(a.downloadPath);
    // Prefer the filename from the download URL: the Confluence REST API
    // sometimes returns a renamed `title` while the page body still references
    // the original name via `ri:filename="..."`. The download URL always
    // contains the canonical name that matches the body references.
    const nameFromUrl = filenameFromDownloadPath(a.downloadPath);
    const safeName = sanitizeFilename(nameFromUrl || a.title);
    const filePath = normalizePath(joinVaultPath(folderPath, safeName));
    await this.writeBinary(filePath, buf);
    logger.debug("Saved", filePath, `${buf.byteLength} bytes`);
  }

  private async ensureFolder(path: string): Promise<void> {
    const v = this.app.vault;
    if (!path) return;
    const exists = v.getAbstractFileByPath(path);
    if (exists) return;
    try {
      await v.createFolder(path);
    } catch (e) {
      // Race: folder may have been created concurrently. Ignore if it now exists.
      if (!v.getAbstractFileByPath(path)) throw e;
    }
  }

  private async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const v: Vault = this.app.vault;
    const existing = v.getAbstractFileByPath(path);
    if (existing && "stat" in existing) {
      // @ts-expect-error modifyBinary exists on TFile
      await v.modifyBinary(existing, data);
      return;
    }
    await v.createBinary(path, data);
  }

  private async writeMarkdown(path: string, content: string): Promise<void> {
    const v: Vault = this.app.vault;
    const existing = v.getAbstractFileByPath(path);
    if (existing) {
      // @ts-expect-error modify exists on TFile
      await v.modify(existing, content);
      return;
    }
    await v.create(path, content);
  }
}

/**
 * Scan `<inbox>/*.md` for a note whose YAML frontmatter declares the given
 * pageId. Used for dedup after a page has been renamed on the wiki side.
 * Returns the vault-relative path or null. Errors are swallowed: dedup is a
 * best-effort optimization and must not block a new download.
 */
async function findExistingByPageId(
  vault: Vault,
  inbox: string,
  pageId: string
): Promise<string | null> {
  const folder = vault.getAbstractFileByPath(inbox);
  if (!folder || !(folder instanceof TFolder)) return null;
  const needle = new RegExp(`^pageId:\\s*"?${pageId}"?\\s*$`, "m");
  for (const child of folder.children) {
    if (!(child instanceof TFile)) continue;
    if (child.extension.toLowerCase() !== "md") continue;
    try {
      const text = await vault.read(child);
      // Only inspect the leading frontmatter block.
      const head = text.startsWith("---") ? text.slice(0, 2000) : text.slice(0, 1024);
      if (needle.test(head)) return child.path;
    } catch (e) {
      logger.debug("Skip md during dedup scan:", child.path, (e as Error).message);
    }
  }
  return null;
}

function buildFrontmatter(page: PageInfo): string {
  const now = new Date();
  const esc = (s: string): string => s.replace(/"/g, '\\"');
  const lines = [
    "---",
    `source: "${esc(page.webUrl)}"`,
    `pageId: "${page.id}"`,
    `spaceKey: "${esc(page.spaceKey)}"`,
    `version: ${page.version}`,
    `originalTitle: "${esc(page.title)}"`,
  ];
  if (page.createdBy) lines.push(`createdBy: "${esc(page.createdBy)}"`);
  if (page.createdAt) lines.push(`createdAt: "${esc(page.createdAt)}"`);
  if (page.lastModifiedBy) lines.push(`lastModifiedBy: "${esc(page.lastModifiedBy)}"`);
  if (page.lastModifiedAt) lines.push(`lastModifiedAt: "${esc(page.lastModifiedAt)}"`);
  lines.push(`fetchedAt: "${now.toISOString()}"`, "---", "");
  return lines.join("\n");
}

function extractReferencedFilenames(xhtml: string): Set<string> {
  const out = new Set<string>();
  const re = /ri:filename="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xhtml))) out.add(m[1]);
  return out;
}

/**
 * Extract the basename (file name) from a Confluence attachment download URL
 * such as `/download/attachments/242053973/image.png?version=1&...`.
 * Returns "" if nothing sensible can be extracted.
 */
function filenameFromDownloadPath(p: string): string {
  if (!p) return "";
  // Strip query string and fragment.
  const noQuery = p.split(/[?#]/, 1)[0];
  // Take the last path segment.
  const seg = noQuery.split("/").pop() || "";
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * Run an async mapper over `items` with at most `concurrency` workers in flight.
 * Preserves original order in the result array.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export { AuthError, NotFoundError, HttpError };
