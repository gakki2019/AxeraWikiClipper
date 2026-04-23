import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";
import { logger } from "../utils/logger";
import type { AxWikiClipperSettings } from "../settings";
import { HARDCODED } from "../settings";

export interface PageInfo {
  id: string;
  title: string;
  spaceKey: string;
  version: number;
  storageXhtml: string;
  webUrl: string;
  createdBy: string;
  createdAt: string;
  lastModifiedBy: string;
  lastModifiedAt: string;
}

export interface Attachment {
  id: string;
  title: string;
  mediaType: string;
  fileSize: number;
  downloadPath: string; // site-relative, starts with "/"
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export class ConfluenceClient {
  constructor(private settings: AxWikiClipperSettings) {}

  private get baseUrl(): string {
    return this.settings.baseUrl.replace(/\/+$/, "");
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/json, */*",
      "X-Atlassian-Token": "no-check",
      ...(extra ?? {}),
    };
    if (this.settings.authMode === "basic") {
      const u = this.settings.username;
      const p = this.settings.password;
      if (u && p) {
        // btoa is available in Obsidian (Chromium) and also polyfilled by jsdom
        h["Authorization"] = "Basic " + btoa(`${u}:${p}`);
      }
    } else if (this.settings.authMode === "cookie") {
      if (this.settings.cookie) h["Cookie"] = this.settings.cookie;
    }
    return h;
  }

  private async request(params: RequestUrlParam): Promise<RequestUrlResponse> {
    logger.debug("HTTP", params.method ?? "GET", params.url);
    let res: RequestUrlResponse;
    try {
      res = await requestUrl({ throw: false, ...params });
    } catch (e) {
      throw new HttpError(0, `Network error: ${(e as Error).message}`);
    }
    logger.debug("HTTP", res.status, params.url);
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(
        `Authentication failed (HTTP ${res.status}). Check your ${
          this.settings.authMode === "basic" ? "username/password" : "cookie"
        } in settings.`
      );
    }
    if (res.status === 404) {
      throw new NotFoundError(`Not found (HTTP 404): ${params.url}`);
    }
    if (res.status >= 400) {
      throw new HttpError(res.status, `HTTP ${res.status}: ${params.url}`);
    }
    return res;
  }

  async getPage(pageId: string): Promise<PageInfo> {
    const url = `${this.baseUrl}/rest/api/content/${encodeURIComponent(
      pageId
    )}?expand=body.storage,title,version,space,history,history.lastUpdated`;
    const res = await this.request({ url, method: "GET", headers: this.buildHeaders() });
    const json = res.json as {
      id: string;
      title: string;
      space?: { key?: string };
      version?: { number?: number; by?: { displayName?: string; username?: string }; when?: string };
      body?: { storage?: { value?: string } };
      history?: {
        createdDate?: string;
        createdBy?: { displayName?: string; username?: string };
        lastUpdated?: { when?: string; by?: { displayName?: string; username?: string } };
      };
      _links?: { webui?: string; base?: string };
    };
    const storage = json.body?.storage?.value ?? "";
    const webRel = json._links?.webui ?? `/pages/viewpage.action?pageId=${pageId}`;
    const createdBy =
      json.history?.createdBy?.displayName ?? json.history?.createdBy?.username ?? "";
    const createdAt = json.history?.createdDate ?? "";
    const lastUpdated = json.history?.lastUpdated;
    const lastModifiedBy =
      lastUpdated?.by?.displayName ??
      lastUpdated?.by?.username ??
      json.version?.by?.displayName ??
      json.version?.by?.username ??
      "";
    const lastModifiedAt = lastUpdated?.when ?? json.version?.when ?? "";
    return {
      id: json.id,
      title: json.title,
      spaceKey: json.space?.key ?? "",
      version: json.version?.number ?? 0,
      storageXhtml: storage,
      webUrl: `${this.baseUrl}${webRel}`,
      createdBy,
      createdAt,
      lastModifiedBy,
      lastModifiedAt,
    };
  }

  async listAttachments(pageId: string): Promise<Attachment[]> {
    const out: Attachment[] = [];
    let next: string | null = `${this.baseUrl}/rest/api/content/${encodeURIComponent(
      pageId
    )}/child/attachment?limit=${HARDCODED.attachmentPageSize}`;
    let guard = 0;
    while (next && guard < 50) {
      guard++;
      const res: RequestUrlResponse = await this.request({ url: next, method: "GET", headers: this.buildHeaders() });
      const json = res.json as {
        results: Array<{
          id: string;
          title: string;
          extensions?: { mediaType?: string; fileSize?: number };
          _links?: { download?: string };
        }>;
        _links?: { next?: string; base?: string };
      };
      for (const r of json.results ?? []) {
        out.push({
          id: r.id,
          title: r.title,
          mediaType: r.extensions?.mediaType ?? "",
          fileSize: r.extensions?.fileSize ?? 0,
          downloadPath: r._links?.download ?? "",
        });
      }
      const rel = json._links?.next;
      next = rel ? `${this.baseUrl}${rel}` : null;
    }
    return out;
  }

  async downloadAttachment(siteRelativePath: string): Promise<ArrayBuffer> {
    const buildUrl = (p: string): string =>
      p.startsWith("http")
        ? p
        : `${this.baseUrl}${p.startsWith("/") ? "" : "/"}${p}`;

    const primary = buildUrl(siteRelativePath);
    // Fallback URL: strip query string. Some Confluence Server deployments
    // enter a redirect loop when `api=v2` (a Cloud-only parameter) is present
    // on `/download/attachments/...` URLs.
    const pathOnly = siteRelativePath.split(/[?#]/, 1)[0];
    const fallback = buildUrl(pathOnly);

    try {
      const res = await this.request({
        url: primary,
        method: "GET",
        headers: this.buildHeaders(),
      });
      return res.arrayBuffer;
    } catch (e) {
      const msg = (e as Error).message || "";
      const isRedirectLoop =
        msg.includes("ERR_TOO_MANY_REDIRECTS") || msg.includes("redirect");
      if (!isRedirectLoop || fallback === primary) throw e;
      logger.warn(
        "Attachment download hit redirect loop; retrying without query string:",
        fallback
      );
      const res = await this.request({
        url: fallback,
        method: "GET",
        headers: this.buildHeaders(),
      });
      return res.arrayBuffer;
    }
  }
}
