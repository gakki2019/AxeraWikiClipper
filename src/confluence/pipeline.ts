import { App, normalizePath, Notice, Vault } from "obsidian";
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
import { parsePageId, isTinyUiLink } from "../utils/url";
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
    const pageId = parsePageId(input);
    if (!pageId) {
      if (isTinyUiLink(input)) {
        throw new Error("Short links (/x/...) are not supported. Please paste the full page URL.");
      }
      throw new Error("Invalid input: expect a wiki URL or numeric pageId.");
    }
    return this.downloadByPageId(pageId);
  }

  async downloadByPageId(pageId: string): Promise<DownloadResult> {
    logger.info("Fetching page", pageId);
    new Notice(`Fetching page ${pageId}…`);
    const page = await this.client.getPage(pageId);
    logger.info("Page", page.id, page.title, `v${page.version}`);

    const attachments = await this.client.listAttachments(pageId);
    logger.info("Attachments listed:", attachments.length);

    const titleFolder = sanitizeFilename(page.title);
    const inbox = (this.settings.inboxPath || "inbox").replace(/^\/+|\/+$/g, "");
    const folderPath = normalizePath(joinVaultPath(inbox, titleFolder));
    const mdBase =
      this.settings.filenameSource === "pageId"
        ? pageId
        : titleFolder;
    const mdPath = normalizePath(joinVaultPath(inbox, `${mdBase}.md`));

    await this.ensureFolder(inbox);

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

    const frontmatter = this.settings.writeFrontmatter ? buildFrontmatter(page) : "";
    const fullMd = frontmatter + markdownBody;

    await this.writeMarkdown(mdPath, fullMd);

    const msg = failed.length
      ? `Done with ${failed.length} attachment failures. See console for details.`
      : `Done. Downloaded ${downloaded} attachments.`;
    new Notice(msg);
    logger.info("Result", { mdPath, downloaded, failed });

    return { markdownPath: mdPath, attachmentCount: downloaded, failedAttachments: failed };
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
      if (!this.settings.overwriteExisting) {
        throw new Error(
          `File exists: ${path}. Enable "Overwrite existing files" in settings to replace it.`
        );
      }
      // @ts-expect-error modify exists on TFile
      await v.modify(existing, content);
      return;
    }
    await v.create(path, content);
  }
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
