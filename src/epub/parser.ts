import type { ZipSource } from "./zipSource";
import type {
  ChapterItem,
  EpubBook,
  EpubChapter,
  EpubCoverRef,
  EpubImageRef,
  ImageItem,
  ParsedEpub,
} from "./types";

// EPUB 3 / EPUB 2 parser.
//
// Steps:
//   1. META-INF/container.xml  →  path to the OPF package document
//   2. OPF                     →  metadata + manifest (id→href) + spine (order)
//   3. nav.xhtml or NCX        →  human-readable chapter titles (optional)
//   4. Each spine item         →  fetch XHTML, pull paragraph-level text
//                                  + collect <img> references, reading bytes
//                                  out of the zip and renaming hrefs onto a
//                                  stable `images/img-NNN.ext` scheme.
//
// Block-level items become `ChapterItem`s — text or image. Images are
// returned in `ParsedEpub.images` as *references* (zip entry + target
// filename), never as bytes: the importer hands them to
// `ZipSource.extract`, which copies archive → disk natively. On Android a
// byte array crossing the JS IPC is expanded to one JSON array element per
// byte, so keeping image bytes out of the webview is the difference between
// an import that works and one that dies with `RangeError: Invalid array
// length`.
//
// The zip itself is behind `ZipSource`, so the same parser serves an
// archive on disk (Rust reads it) and one that only exists as a buffer.

const DC_NS = "http://purl.org/dc/elements/1.1/";
const OPF_NS = "http://www.idpf.org/2007/opf";
const NCX_NS = "http://www.daisy.org/z3986/2005/ncx/";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

export class EpubParseError extends Error {
  constructor(msg: string) {
    super(`EPUB parse failed: ${msg}`);
    this.name = "EpubParseError";
  }
}

/**
 * Parse an EPUB out of `src`.
 *
 * `id` is supplied by the caller rather than generated here because the
 * importer has to know the book's storage directory *before* parsing — the
 * archive is staged to `books/<id>/book.epub` first, and the parser reads it
 * from there.
 */
export async function parseEpubFromSource(
  src: ZipSource,
  id: string,
): Promise<ParsedEpub> {
  const opfPath = await readOpfPath(src);
  const opfText = await readZipText(src, opfPath);

  const opf = new DOMParser().parseFromString(opfText, "application/xml");
  throwIfParserError(opf, "OPF");

  const basePath = dirname(opfPath);

  // Empty (not "Untitled"/"Unknown author") — a blank title/author persists
  // as "" so the display-time fallback (`common.untitled`/
  // `common.unknownAuthor`) localizes it wherever the book is rendered,
  // instead of freezing an English (or, worse, whatever-locale-was-active)
  // literal into the book's stored data.
  const title = firstText(opf, DC_NS, "title") ?? "";
  const author = firstText(opf, DC_NS, "creator") ?? "";
  const language = firstText(opf, DC_NS, "language") ?? "en";

  const manifest = buildManifest(opf);
  const spineIds = readSpine(opf);
  const navTitles = await readNavTitles(src, basePath, opf, manifest);
  const cover = await readCover(src, basePath, opf, manifest);

  // Pull every spine document in one round trip. Read individually, a
  // 114-chapter book costs 114 IPC round trips, and on Android each of
  // those is a postMessage plus a `webview.eval` of the response.
  await src.prefetchText(
    spineIds
      .map((idref) => manifest.get(idref))
      .filter((item): item is ManifestItem => !!item)
      .map((item) => joinPath(basePath, item.href)),
  );

  const imageCollector = new ImageCollector();
  const chapters: EpubChapter[] = [];
  let order = 0;
  for (const idref of spineIds) {
    const manifestItem = manifest.get(idref);
    if (!manifestItem) continue;
    const fullPath = joinPath(basePath, manifestItem.href);
    const xhtml = await src.readText(fullPath);
    if (!xhtml) continue;

    const doc = new DOMParser().parseFromString(xhtml, "application/xhtml+xml");
    // XHTML parse can fail on malformed EPUBs; fall back to HTML parsing.
    const root =
      doc.getElementsByTagName("parsererror").length > 0
        ? new DOMParser().parseFromString(xhtml, "text/html")
        : doc;

    const title =
      navTitles.get(manifestItem.href) ??
      navTitles.get(fullPath) ??
      firstHeadingText(root) ??
      `Chapter ${order + 1}`;

    const instructions = collectChapterInstructions(root);
    const items = resolveChapterItems(
      instructions,
      src,
      dirname(fullPath),
      imageCollector,
    );
    // Skip spine items that produced nothing — usually covers, title pages
    // whose image we already counted, or nav docs that snuck into the spine.
    if (items.length === 0) continue;

    chapters.push({
      id: idref,
      href: manifestItem.href,
      title,
      paragraphs: items,
      order: order++,
    });
  }

  if (chapters.length === 0)
    throw new EpubParseError("no readable chapters found in spine");

  const book: EpubBook = {
    id,
    title,
    author,
    language,
    chapters,
  };
  return {
    book,
    images: imageCollector.collected(),
    ...(cover ? { cover } : {}),
  };
}

// ── internals ──────────────────────────────────────────────────────────────

interface ManifestItem {
  href: string;
  mediaType: string;
  properties: string;
}

async function readOpfPath(src: ZipSource): Promise<string> {
  const container = await readZipText(src, "META-INF/container.xml");
  const doc = new DOMParser().parseFromString(container, "application/xml");
  throwIfParserError(doc, "container.xml");
  const rootfile = doc.getElementsByTagName("rootfile")[0];
  const full = rootfile?.getAttribute("full-path");
  if (!full) throw new EpubParseError("no rootfile in container.xml");
  return full;
}

function buildManifest(opf: Document): Map<string, ManifestItem> {
  const out = new Map<string, ManifestItem>();
  const items = opf.getElementsByTagNameNS(OPF_NS, "item");
  for (let i = 0; i < items.length; i++) {
    const el = items[i];
    const id = el.getAttribute("id");
    const href = el.getAttribute("href");
    if (!id || !href) continue;
    out.set(id, {
      href: decodeURI(href),
      mediaType: el.getAttribute("media-type") ?? "",
      properties: el.getAttribute("properties") ?? "",
    });
  }
  return out;
}

// Accept bytes as an image if the OPF says so, *or* if the filename's
// extension is a well-known raster/vector format. Calibre-produced EPUBs
// sometimes stamp the cover as `application/octet-stream`.
const IMAGE_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "avif",
]);

function looksLikeImage(item: ManifestItem): boolean {
  if (item.mediaType.startsWith("image/")) return true;
  const ext = item.href.match(/\.([A-Za-z0-9]+)(?:$|[?#])/)?.[1]?.toLowerCase();
  return !!ext && IMAGE_EXTS.has(ext);
}

// If the "cover" manifest item is an XHTML wrapper (common in EPUB 2 and
// in books converted by Sigil/Calibre), pull out the first <img src> or
// <svg><image xlink:href> inside it, then resolve that back to a manifest
// image item.
async function resolveXhtmlCover(
  src: ZipSource,
  basePath: string,
  wrapper: ManifestItem,
  manifest: Map<string, ManifestItem>,
): Promise<ManifestItem | undefined> {
  const wrapperPath = joinPath(basePath, wrapper.href);
  const xhtml = await src.readText(wrapperPath);
  if (!xhtml) return undefined;

  const doc = new DOMParser().parseFromString(xhtml, "application/xhtml+xml");
  const root =
    doc.getElementsByTagName("parsererror").length > 0
      ? new DOMParser().parseFromString(xhtml, "text/html")
      : doc;

  // <img src> first, <svg><image xlink:href> second — both show up in real
  // EPUBs.
  const img = root.querySelector("img[src]");
  const svgImg = root.querySelector("image");
  const rawHref =
    img?.getAttribute("src") ||
    svgImg?.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
    svgImg?.getAttribute("href") ||
    null;
  if (!rawHref) return undefined;

  const wrapperDir = dirname(wrapperPath);
  const resolved = joinPath(wrapperDir, decodeURI(rawHref.split("#")[0]));

  // Look up that resolved path in the manifest so we keep the declared mime.
  for (const item of manifest.values()) {
    if (joinPath(basePath, item.href) === resolved) return item;
  }
  // Not in the manifest — fabricate an item pointing at the file directly.
  return {
    href: resolved.startsWith(basePath)
      ? resolved.slice(basePath.length)
      : resolved,
    mediaType: "",
    properties: "",
  };
}

async function readCover(
  src: ZipSource,
  basePath: string,
  opf: Document,
  manifest: Map<string, ManifestItem>,
): Promise<EpubCoverRef | undefined> {
  // EPUB 3: manifest item with properties="cover-image".
  let cover: ManifestItem | undefined;
  for (const item of manifest.values()) {
    if (item.properties.split(/\s+/).includes("cover-image")) {
      cover = item;
      break;
    }
  }

  // EPUB 2: <meta name="cover" content="<idref>"/> points at a manifest id.
  // The target is usually an image, but in older/Calibre EPUBs it sometimes
  // points at an XHTML wrapper — handled a few lines down.
  if (!cover) {
    const metas = opf.getElementsByTagNameNS(OPF_NS, "meta");
    for (let i = 0; i < metas.length; i++) {
      if (metas[i].getAttribute("name") === "cover") {
        const idref = metas[i].getAttribute("content");
        if (idref && manifest.has(idref)) {
          cover = manifest.get(idref);
          break;
        }
      }
    }
  }

  // If we landed on an XHTML file (a cover page), pull the image it wraps.
  if (
    cover &&
    (cover.mediaType.includes("xhtml") || cover.href.match(/\.x?html?$/i))
  ) {
    const inner = await resolveXhtmlCover(src, basePath, cover, manifest);
    if (inner) cover = inner;
  }

  // Still nothing? Scan the spine's first few items for an XHTML whose id or
  // href looks like a cover page, and unwrap *that*. Lots of fan-translated
  // EPUBs put the cover as `cover.xhtml` at spine[0] without any cover-image
  // property set.
  if (!cover || !looksLikeImage(cover)) {
    const spine = readSpine(opf).slice(0, 4);
    for (const idref of spine) {
      const item = manifest.get(idref);
      if (!item) continue;
      const hintId = /(^|[\/_-])cover([\/_-]|\.|$)/i.test(idref);
      const hintHref = /(^|[\/_-])cover([\/_-]|\.|$)/i.test(item.href);
      const isXhtml =
        item.mediaType.includes("xhtml") || /\.x?html?$/i.test(item.href);
      if (!isXhtml || (!hintId && !hintHref)) continue;
      const inner = await resolveXhtmlCover(src, basePath, item, manifest);
      if (inner) {
        cover = inner;
        break;
      }
    }
  }

  // Heuristic fallback — any manifest item whose id or href contains `cover`
  // and looks like an image (by mime OR extension).
  if (!cover || !looksLikeImage(cover)) {
    const candidates = Array.from(manifest.entries()).filter(([, v]) =>
      looksLikeImage(v),
    );
    const hit = candidates.find(
      ([id, v]) =>
        /(^|[\/_-])cover([\/_-]|\.|$)/i.test(id) ||
        /(^|[\/_-])cover([\/_-]|\.|$)/i.test(v.href),
    );
    if (hit) cover = hit[1];
  }

  // Last-chance fallback — the FIRST image in the manifest. For EPUBs with
  // zero cover metadata, this is almost always the cover itself because
  // toolchains list manifest items in spine order and the cover page is
  // typically spine[0].
  if (!cover || !looksLikeImage(cover)) {
    for (const item of manifest.values()) {
      if (looksLikeImage(item)) {
        cover = item;
        break;
      }
    }
  }

  if (!cover || !looksLikeImage(cover)) return undefined;

  const fullPath = joinPath(basePath, cover.href);
  if (!src.has(fullPath)) return undefined;

  const extension = extensionFor(cover.mediaType, cover.href);
  const mime = cover.mediaType.startsWith("image/")
    ? cover.mediaType
    : mimeForExtension(extension);
  return { entry: fullPath, mimeType: mime, extension };
}

function mimeForExtension(ext: string): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

function extensionFor(mimeType: string, href: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
  }
  const m = href.match(/\.([A-Za-z0-9]{1,5})(?:$|[?#])/);
  return (m?.[1] ?? "bin").toLowerCase();
}

function readSpine(opf: Document): string[] {
  const refs = opf.getElementsByTagNameNS(OPF_NS, "itemref");
  const out: string[] = [];
  for (let i = 0; i < refs.length; i++) {
    const idref = refs[i].getAttribute("idref");
    if (idref) out.push(idref);
  }
  return out;
}

async function readNavTitles(
  src: ZipSource,
  basePath: string,
  opf: Document,
  manifest: Map<string, ManifestItem>,
): Promise<Map<string, string>> {
  // EPUB 3: look for item with properties="nav"
  for (const item of manifest.values()) {
    if (item.properties.split(/\s+/).includes("nav")) {
      const path = joinPath(basePath, item.href);
      const xhtml = await src.readText(path);
      if (!xhtml) continue;
      return parseNavXhtml(xhtml, basePath, item.href);
    }
  }
  // EPUB 2: spine[@toc] → manifest item (NCX)
  const spine = opf.getElementsByTagNameNS(OPF_NS, "spine")[0];
  const tocId = spine?.getAttribute("toc");
  if (tocId) {
    const item = manifest.get(tocId);
    if (item) {
      const path = joinPath(basePath, item.href);
      const ncx = await src.readText(path);
      if (ncx) return parseNcx(ncx, basePath, item.href);
    }
  }
  return new Map();
}

function parseNavXhtml(
  xhtml: string,
  basePath: string,
  navHref: string,
): Map<string, string> {
  const out = new Map<string, string>();
  const doc = new DOMParser().parseFromString(xhtml, "application/xhtml+xml");
  const root =
    doc.getElementsByTagName("parsererror").length > 0
      ? new DOMParser().parseFromString(xhtml, "text/html")
      : doc;
  const navs = root.getElementsByTagName("nav");
  const navDir = dirname(joinPath(basePath, navHref));
  for (let n = 0; n < navs.length; n++) {
    const nav = navs[n];
    if ((nav.getAttribute("epub:type") ?? nav.getAttribute("type")) === "toc" ||
        nav.getAttributeNS("http://www.idpf.org/2007/ops", "type") === "toc") {
      collectNavLinks(nav, navDir, basePath, out);
      break;
    }
  }
  // If no explicit toc-nav, fall back to the first nav.
  if (out.size === 0 && navs.length > 0) {
    collectNavLinks(navs[0], navDir, basePath, out);
  }
  return out;
}

function collectNavLinks(
  nav: Element,
  navDir: string,
  basePath: string,
  out: Map<string, string>,
) {
  const links = nav.getElementsByTagName("a");
  for (let i = 0; i < links.length; i++) {
    const a = links[i];
    const href = a.getAttribute("href");
    const text = (a.textContent ?? "").trim();
    if (!href || !text) continue;
    const [path] = href.split("#");
    const decoded = decodeURI(path);
    const resolvedFromNav = joinPath(navDir, decoded);
    const resolvedFromBase = joinPath(basePath, decoded);
    out.set(decoded, text);
    out.set(resolvedFromNav, text);
    out.set(resolvedFromBase, text);
  }
}

function parseNcx(
  ncx: string,
  basePath: string,
  ncxHref: string,
): Map<string, string> {
  const out = new Map<string, string>();
  const doc = new DOMParser().parseFromString(ncx, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return out;
  const points = doc.getElementsByTagNameNS(NCX_NS, "navPoint");
  const ncxDir = dirname(joinPath(basePath, ncxHref));
  for (let i = 0; i < points.length; i++) {
    const label =
      points[i].getElementsByTagNameNS(NCX_NS, "text")[0]?.textContent?.trim();
    const content = points[i].getElementsByTagNameNS(NCX_NS, "content")[0];
    const src = content?.getAttribute("src");
    if (!label || !src) continue;
    const [path] = src.split("#");
    const decoded = decodeURI(path);
    out.set(decoded, label);
    out.set(joinPath(ncxDir, decoded), label);
    out.set(joinPath(basePath, decoded), label);
  }
  return out;
}

const BLOCK_SELECTOR =
  "p, blockquote, h1, h2, h3, h4, h5, h6, li, figcaption, div.para";
const ITEM_SELECTOR = `${BLOCK_SELECTOR}, img`;

/** What `collectChapterInstructions` emits — a flat document-order list of
 *  text spans + image references. The image step is deferred so the
 *  zip-read can run async without scattering awaits inside the DOM walk. */
type ChapterInstruction =
  | { kind: "text"; text: string }
  | { kind: "image"; src: string; alt?: string };

function collectChapterInstructions(doc: Document): ChapterInstruction[] {
  const body = doc.body ?? doc.documentElement;
  if (!body) return [];
  const nodes = body.querySelectorAll(ITEM_SELECTOR);
  const seen = new Set<Element>();
  const out: ChapterInstruction[] = [];

  nodes.forEach((node) => {
    const isImg = node.tagName.toLowerCase() === "img";

    // Skip elements nested inside another matching block. Exception: a bare
    // `<p><img/></p>` wrapper passes the img through, since EPUB content
    // routinely wraps images in single-purpose paragraphs.
    let anc = node.parentElement;
    while (anc && anc !== body) {
      if (anc.matches(BLOCK_SELECTOR)) {
        const ancText = (anc.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!isImg || ancText.length > 0) return;
      }
      anc = anc.parentElement;
    }
    if (seen.has(node)) return;
    seen.add(node);

    if (isImg) {
      const src = node.getAttribute("src");
      if (!src) return;
      const alt = node.getAttribute("alt") || undefined;
      out.push({ kind: "image", src, alt });
      return;
    }

    // Block element. If its only meaningful content is an inner <img> with
    // no surrounding text, emit that image directly so we don't drop it on
    // the (text.length > 0) check below.
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length === 0) {
      const innerImg = node.querySelector("img");
      if (innerImg) {
        const src = innerImg.getAttribute("src");
        if (src) {
          seen.add(innerImg);
          out.push({
            kind: "image",
            src,
            alt: innerImg.getAttribute("alt") || undefined,
          });
        }
      }
      return;
    }
    out.push({ kind: "text", text });
  });

  return out;
}

/** Take the document-order instructions and turn them into ChapterItems,
 *  routing image references through the shared collector so the same source
 *  path used by multiple chapters only gets stored once. No bytes are read
 *  here — the collector records where each image lives and the importer
 *  extracts them all in one native pass afterwards. */
function resolveChapterItems(
  instructions: ChapterInstruction[],
  src: ZipSource,
  chapterDir: string,
  collector: ImageCollector,
): ChapterItem[] {
  const out: ChapterItem[] = [];
  for (const inst of instructions) {
    if (inst.kind === "text") {
      out.push({ text: inst.text });
      continue;
    }
    const zipPath = joinPath(chapterDir, decodeURI(inst.src.split("#")[0]));
    const href = collector.reference(src, zipPath);
    if (!href) continue; // referenced image missing from zip — drop silently
    const item: ImageItem = { src: href };
    if (inst.alt) item.alt = inst.alt;
    out.push(item);
  }
  return out;
}

/** Notes each referenced image on first encounter, dedupes by source path,
 *  and assigns a stable `images/img-NNN.ext` href. The href shape doubles as
 *  the on-disk path under `books/<id>/`, so the reader can resolve it via
 *  Tauri's asset:// protocol later.
 *
 *  Nothing is decompressed here. The collector only produces a work list;
 *  `ZipSource.extract` turns it into files. That's what keeps a 200 MB
 *  picture book from having its entire image set resident in the webview
 *  at once. */
class ImageCollector {
  private byPath = new Map<string, string>();
  private images: EpubImageRef[] = [];

  reference(src: ZipSource, zipPath: string): string | null {
    const cached = this.byPath.get(zipPath);
    if (cached) return cached;
    if (!src.has(zipPath)) return null;

    const ext = imageExtensionForPath(zipPath);
    const idx = this.images.length + 1;
    const href = `images/img-${String(idx).padStart(3, "0")}.${ext}`;

    this.byPath.set(zipPath, href);
    this.images.push({ href, entry: zipPath, mimeType: mimeForExtension(ext) });
    return href;
  }

  collected(): EpubImageRef[] {
    return this.images;
  }
}

function imageExtensionForPath(zipPath: string): string {
  const m = zipPath.match(/\.([A-Za-z0-9]{2,5})(?:$|[?#])/);
  const raw = m?.[1]?.toLowerCase();
  if (!raw) return "bin";
  // Normalize a couple of common aliases so the on-disk filename is tidy.
  if (raw === "jpeg") return "jpg";
  return raw;
}

function firstHeadingText(doc: Document): string | null {
  const h = doc.querySelector("h1, h2, h3, h4, h5, h6, title");
  return h?.textContent?.trim() || null;
}

function firstText(
  opf: Document,
  ns: string,
  local: string,
): string | null {
  const el = opf.getElementsByTagNameNS(ns, local)[0];
  return el?.textContent?.trim() || null;
}

function throwIfParserError(doc: Document, label: string) {
  if (doc.getElementsByTagName("parsererror").length > 0)
    throw new EpubParseError(`could not parse ${label} as XML`);
  void XHTML_NS;
}

async function readZipText(src: ZipSource, path: string): Promise<string> {
  const text = await src.readText(path);
  if (text === null) throw new EpubParseError(`missing ${path} in EPUB`);
  return text;
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i + 1);
}

function joinPath(base: string, rel: string): string {
  if (rel.startsWith("/")) return rel.slice(1);
  if (!base) return rel;
  // Normalize ../ segments — OPFs often reference siblings via `../text/x.xhtml`.
  const parts = (base + rel).split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}
