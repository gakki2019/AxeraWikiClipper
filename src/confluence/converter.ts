import TurndownService from "turndown";
// @ts-ignore — no bundled types for turndown-plugin-gfm
import { gfm } from "turndown-plugin-gfm";
import { logger } from "../utils/logger";

export interface ConvertOptions {
  /** Folder path (vault-relative) where attachments for this page live. */
  titleFolder: string;
  /** Base URL of the wiki, used to resolve `ri:page` links back to absolute URLs */
  baseUrl: string;
  /** Known attachment filenames (as reported by REST). Used as fallback display text. */
  attachmentFilenames: Set<string>;
  /** How to reference local attachments in the emitted Markdown. Defaults to "wikilink". */
  linkStyle?: "wikilink" | "markdown";
  /**
   * Base used for standard Markdown hrefs in `linkStyle="markdown"` mode. Must be
   * resolvable relative to the MD file being written (typically the sanitized page
   * title, because the MD file and the attachment folder share a parent).
   * Falls back to `titleFolder` if not provided.
   */
  attachmentHrefBase?: string;
}

const XML_WRAPPER_OPEN =
  '<root xmlns:ac="http://atlassian.com/content" xmlns:ri="http://atlassian.com/resource/identifier">';
const XML_WRAPPER_CLOSE = "</root>";

/**
 * Convert Confluence storage-format XHTML into Markdown.
 *
 *   1. Wrap with an XML root declaring the ac/ri namespaces and parse as XML.
 *   2. Walk the XML tree and emit a plain HTML string, rewriting Confluence
 *      custom elements to standard HTML that turndown understands.
 *   3. Run turndown (+ GFM plugin) with a custom fenced-code rule.
 *   4. Collapse excess blank lines.
 */
export function xhtmlToMarkdown(xhtml: string, opts: ConvertOptions): string {
  const html = xmlToHtml(xhtml, opts);
  logger.debug("Intermediate HTML (first 500):", html.slice(0, 500));
  const td = buildTurndown();
  const md = td.turndown(html);
  return postprocess(md);
}

// ---------------------------------------------------------------------------
// Stage 1: parse XML, emit HTML string
// ---------------------------------------------------------------------------

function xmlToHtml(xhtml: string, opts: ConvertOptions): string {
  const sanitized = replaceHtmlEntities(xhtml);
  const wrapped = XML_WRAPPER_OPEN + sanitized + XML_WRAPPER_CLOSE;
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(wrapped, "application/xml");
  const err = xmlDoc.querySelector("parsererror");
  if (err) {
    logger.warn("XML parse error in storage XHTML; output may be degraded.", err.textContent);
    return xhtml;
  }
  const root = xmlDoc.documentElement;
  let out = "";
  for (let i = 0; i < root.childNodes.length; i++) {
    out += nodeToHtml(root.childNodes[i], opts);
  }
  return out;
}

/**
 * Confluence `body.storage` contains HTML-named entities (e.g. `&ldquo;`) that
 * are NOT valid in XML. Replace them with their Unicode characters before
 * feeding the document to an XML parser. We keep the 5 XML-standard entities
 * untouched and leave `&#...;` numeric references alone (they're valid XML).
 */
function replaceHtmlEntities(s: string): string {
  return s.replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (full, name: string) => {
    if (name === "amp" || name === "lt" || name === "gt" || name === "quot" || name === "apos") {
      return full;
    }
    const ch = HTML_ENTITIES[name];
    return ch !== undefined ? ch : full;
  });
}

// Covers entities commonly appearing in Confluence output. Not exhaustive but
// safe: unknown names are left as-is (parser may still accept or choke; logger
// reports failures).
const HTML_ENTITIES: Record<string, string> = {
  nbsp: "\u00A0", copy: "\u00A9", reg: "\u00AE", trade: "\u2122",
  hellip: "\u2026", mdash: "\u2014", ndash: "\u2013",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D",
  laquo: "\u00AB", raquo: "\u00BB",
  bull: "\u2022", middot: "\u00B7",
  deg: "\u00B0", plusmn: "\u00B1", times: "\u00D7", divide: "\u00F7",
  larr: "\u2190", rarr: "\u2192", uarr: "\u2191", darr: "\u2193",
  harr: "\u2194", lArr: "\u21D0", rArr: "\u21D2", uArr: "\u21D1", dArr: "\u21D3",
  iexcl: "\u00A1", iquest: "\u00BF", sect: "\u00A7", para: "\u00B6",
  acute: "\u00B4", cedil: "\u00B8", sup1: "\u00B9", sup2: "\u00B2", sup3: "\u00B3",
  frac14: "\u00BC", frac12: "\u00BD", frac34: "\u00BE",
  Auml: "\u00C4", Ouml: "\u00D6", Uuml: "\u00DC",
  auml: "\u00E4", ouml: "\u00F6", uuml: "\u00FC", szlig: "\u00DF",
  euro: "\u20AC", pound: "\u00A3", yen: "\u00A5", cent: "\u00A2",
  check: "\u2713", cross: "\u2717",
  ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", zwnj: "\u200C", zwj: "\u200D",
};

function localName(el: Element): string {
  return (el.localName || el.tagName).toLowerCase();
}

function prefixOf(el: Element): string {
  const tag = el.tagName;
  const idx = tag.indexOf(":");
  return idx > 0 ? tag.slice(0, idx).toLowerCase() : "";
}

function getAttrNs(el: Element, attrLocalName: string, prefixName: string): string | null {
  const full = `${prefixName}:${attrLocalName}`;
  if (el.hasAttribute(full)) return el.getAttribute(full);
  if (el.hasAttribute(attrLocalName)) return el.getAttribute(attrLocalName);
  const nsMap: Record<string, string> = {
    ac: "http://atlassian.com/content",
    ri: "http://atlassian.com/resource/identifier",
  };
  const ns = nsMap[prefixName];
  if (ns) {
    const v = el.getAttributeNS(ns, attrLocalName);
    if (v !== null) return v;
  }
  return null;
}

function firstChildByPrefixLocal(el: Element, pfx: string, local: string): Element | null {
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c.nodeType !== 1) continue;
    const e = c as Element;
    if (prefixOf(e) === pfx && localName(e) === local) return e;
  }
  return null;
}

function nodeToHtml(node: Node, opts: ConvertOptions): string {
  if (node.nodeType === 3 /* text */) return escapeHtml(node.nodeValue ?? "");
  if (node.nodeType === 4 /* CDATA */) return escapeHtml((node as CharacterData).data);
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const pfx = prefixOf(el);
  const local = localName(el);

  if (pfx === "ac") return acElementToHtml(el, local, opts);
  if (pfx === "ri") return "";

  if (local === "p") {
    const cls = el.getAttribute("class") || "";
    if (cls.split(/\s+/).includes("auto-cursor-target")) return "";
    if (isEffectivelyEmptyParagraph(el)) return "";
  }
  if (local === "span") return childrenToHtml(el, opts);
  if (local === "br") return "<br>";

  const tag = local;
  const attrs = serializeAttrs(el, tag);
  if (VOID_ELEMENTS.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${childrenToHtml(el, opts)}</${tag}>`;
}

function childrenToHtml(el: Element, opts: ConvertOptions): string {
  let out = "";
  for (let i = 0; i < el.childNodes.length; i++) {
    out += nodeToHtml(el.childNodes[i], opts);
  }
  return out;
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);

const ATTR_WHITELIST: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
  code: new Set(["class"]),
  pre: new Set([]),
  th: new Set(["align", "colspan", "rowspan"]),
  td: new Set(["align", "colspan", "rowspan"]),
};

function serializeAttrs(el: Element, tag: string): string {
  const allow = ATTR_WHITELIST[tag] ?? new Set<string>();
  let out = "";
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    const n = a.name.toLowerCase();
    if (!allow.has(n)) continue;
    out += ` ${n}="${escapeAttr(a.value)}"`;
  }
  return out;
}

function isEffectivelyEmptyParagraph(el: Element): boolean {
  for (let i = 0; i < el.childNodes.length; i++) {
    const c = el.childNodes[i];
    if (c.nodeType === 3) {
      if ((c.textContent || "").trim().length > 0) return false;
    } else if (c.nodeType === 1) {
      if (localName(c as Element) !== "br") return false;
    }
  }
  return true;
}

// --- Confluence ac:* elements --------------------------------------------

function acElementToHtml(el: Element, local: string, opts: ConvertOptions): string {
  if (local === "image") return buildImageHtml(el, opts);
  if (local === "link") return buildLinkHtml(el, opts);
  if (local === "structured-macro") return buildMacroHtml(el, opts);
  if (local === "inline-comment-marker") return childrenToHtml(el, opts);
  if (local === "emoticon") {
    const name = getAttrNs(el, "name", "ac") || "";
    return escapeHtml(emoticonText(name));
  }
  return childrenToHtml(el, opts);
}

function buildImageHtml(el: Element, opts: ConvertOptions): string {
  const attach = firstChildByPrefixLocal(el, "ri", "attachment");
  if (attach) {
    const filename = getAttrNs(attach, "filename", "ri") || "";
    if (opts.linkStyle === "markdown") {
      const href = buildAttachmentHref(opts.attachmentHrefBase ?? opts.titleFolder, filename);
      return `<img src="${escapeAttr(href)}" alt="${escapeAttr(filename)}">`;
    }
    // Emit an Obsidian wikilink embed; handled by custom turndown rule below.
    const target = buildWikilinkTarget(opts.titleFolder, filename);
    return `<img data-wikilink="${escapeAttr(target)}" alt="${escapeAttr(filename)}">`;
  }
  const urlEl = firstChildByPrefixLocal(el, "ri", "url");
  if (urlEl) {
    const href = getAttrNs(urlEl, "value", "ri") || "";
    return `<img src="${escapeAttr(href)}" alt="">`;
  }
  return "";
}

function buildLinkHtml(el: Element, opts: ConvertOptions): string {
  const attach = firstChildByPrefixLocal(el, "ri", "attachment");
  const page = firstChildByPrefixLocal(el, "ri", "page");
  const urlEl = firstChildByPrefixLocal(el, "ri", "url");
  const bodyEl =
    firstChildByPrefixLocal(el, "ac", "link-body") ||
    firstChildByPrefixLocal(el, "ac", "plain-text-link-body");

  let href = "";
  let fallback = "";
  let wikilinkTarget: string | null = null;
  if (attach) {
    const filename = getAttrNs(attach, "filename", "ri") || "";
    if (opts.linkStyle === "markdown") {
      href = buildAttachmentHref(opts.attachmentHrefBase ?? opts.titleFolder, filename);
    } else {
      wikilinkTarget = buildWikilinkTarget(opts.titleFolder, filename);
    }
    fallback = stripExtension(filename);
  } else if (page) {
    const title = getAttrNs(page, "content-title", "ri") || "";
    const spaceKey = getAttrNs(page, "space-key", "ri") || "";
    const base = opts.baseUrl.replace(/\/+$/, "");
    href = spaceKey && title
      ? `${base}/display/${encodeURIComponent(spaceKey)}/${encodeURIComponent(title)}`
      : `${base}/dosearchsite.action?queryString=${encodeURIComponent(title)}`;
    fallback = title || href;
  } else if (urlEl) {
    href = getAttrNs(urlEl, "value", "ri") || "";
    fallback = href;
  } else {
    return "";
  }

  const body =
    bodyEl && bodyEl.childNodes.length > 0
      ? childrenToHtml(bodyEl, opts)
      : escapeHtml(fallback);
  if (wikilinkTarget !== null) {
    // Emit via a data attribute; converted to `[[target|body]]` by turndown rule.
    return `<a data-wikilink="${escapeAttr(wikilinkTarget)}">${body}</a>`;
  }
  return `<a href="${escapeAttr(href)}">${body}</a>`;
}

function buildMacroHtml(el: Element, opts: ConvertOptions): string {
  const name = (getAttrNs(el, "name", "ac") || "").toLowerCase();

  if (name === "toc") return "";

  if (name === "code") {
    const lang = getParam(el, "language") || "";
    const title = getParam(el, "title") || "";
    const body = getPlainTextBody(el);
    const titleHtml = title ? `<p><strong>${escapeHtml(title)}</strong></p>` : "";
    const cls = lang ? ` class="language-${escapeAttr(lang)}"` : "";
    return `${titleHtml}<pre><code${cls}>${escapeHtml(body)}</code></pre>`;
  }

  if (name === "info" || name === "note" || name === "warning" || name === "tip") {
    const rich = firstChildByPrefixLocal(el, "ac", "rich-text-body");
    const inner = rich ? childrenToHtml(rich, opts) : "";
    return `<blockquote><p>[!${name}]</p>${inner}</blockquote>`;
  }

  if (name === "noformat") {
    const body = getPlainTextBody(el);
    return `<pre><code>${escapeHtml(body)}</code></pre>`;
  }

  if (name === "status") {
    const title = getParam(el, "title") || "";
    return `<strong>${escapeHtml(title)}</strong>`;
  }

  const rich = firstChildByPrefixLocal(el, "ac", "rich-text-body");
  if (rich) return childrenToHtml(rich, opts);
  return "";
}

function getParam(macro: Element, name: string): string | null {
  for (let i = 0; i < macro.childNodes.length; i++) {
    const c = macro.childNodes[i];
    if (c.nodeType !== 1) continue;
    const e = c as Element;
    if (prefixOf(e) === "ac" && localName(e) === "parameter") {
      if (getAttrNs(e, "name", "ac") === name) return e.textContent ?? "";
    }
  }
  return null;
}

function getPlainTextBody(macro: Element): string {
  const body = firstChildByPrefixLocal(macro, "ac", "plain-text-body");
  if (!body) return "";
  return body.textContent ?? "";
}

function buildAttachmentHref(folder: string, filename: string): string {
  // Percent-encode each path segment but keep `/` literal between them, so the
  // result is a valid Markdown href whose path components Obsidian can resolve.
  const encodedFolder = folder
    .split("/")
    .filter((s) => s.length > 0)
    .map(encodeURIComponent)
    .join("/");
  const encodedName = encodeURIComponent(filename);
  return encodedFolder ? `${encodedFolder}/${encodedName}` : encodedName;
}

/**
 * Build a raw (un-encoded) vault-relative path for use inside an Obsidian
 * wikilink `[[...]]`. Wikilinks allow spaces and unicode, but `[`, `]`, `|`
 * and `#` must be stripped/replaced because they are wikilink metacharacters.
 */
function buildWikilinkTarget(titleFolder: string, filename: string): string {
  const clean = (s: string) => s.replace(/[\[\]|#]/g, "_");
  return `${clean(titleFolder)}/${clean(filename)}`;
}

function stripExtension(filename: string): string {
  const i = filename.lastIndexOf(".");
  if (i <= 0) return filename;
  return filename.slice(0, i);
}

function emoticonText(name: string): string {
  const map: Record<string, string> = {
    smile: "🙂", sad: "🙁", wink: "😉", laugh: "😄", tongue: "😛", cheeky: "😜",
    thumbs_up: "👍", thumbs_down: "👎", information: "ℹ️", tick: "✅",
    cross: "❌", warning: "⚠️",
  };
  return map[name] ?? "";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Stage 2: HTML → Markdown via turndown
// ---------------------------------------------------------------------------

function buildTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  td.use(gfm);

  td.addRule("wikilinkEmbed", {
    filter: (node): boolean =>
      node.nodeName === "IMG" &&
      (node as HTMLElement).hasAttribute("data-wikilink"),
    replacement: (_content, node): string => {
      const target = (node as HTMLElement).getAttribute("data-wikilink") || "";
      return `![[${target}]]`;
    },
  });

  td.addRule("wikilinkAnchor", {
    filter: (node): boolean =>
      node.nodeName === "A" &&
      (node as HTMLElement).hasAttribute("data-wikilink"),
    replacement: (content, node): string => {
      const target = (node as HTMLElement).getAttribute("data-wikilink") || "";
      const text = (content || "").trim();
      if (!text) return `[[${target}]]`;
      return `[[${target}|${text}]]`;
    },
  });

  td.addRule("fencedCodeLang", {
    filter: (node): boolean =>
      node.nodeName === "PRE" &&
      node.firstChild != null &&
      (node.firstChild as Element).nodeName === "CODE",
    replacement: (_content, node): string => {
      const code = (node as HTMLElement).firstChild as HTMLElement;
      const cls = code.getAttribute("class") || "";
      const m = cls.match(/language-(\S+)/);
      const lang = m ? m[1] : "";
      const text = code.textContent ?? "";
      return "\n\n```" + lang + "\n" + text.replace(/\n$/, "") + "\n```\n\n";
    },
  });

  return td;
}

// ---------------------------------------------------------------------------
// Stage 3: Post-process Markdown
// ---------------------------------------------------------------------------

function postprocess(md: string): string {
  let out = md;
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim() + "\n";
}
