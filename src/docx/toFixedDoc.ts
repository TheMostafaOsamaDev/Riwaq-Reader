// DOCX → a self-contained "fixed document": sanitized HTML + extracted images
// (final `images/img-NNN.ext` hrefs) + reading direction + a heading outline.
// This replaces the old DOCX→EPUB conversion: DOCX is now read as fixed pages
// (paginated at read time by DocxPageSource), not reflowed as an EPUB.
//
// mammoth (docx → HTML) and detectDirection are reused; buildEpub/splitChapters/
// stage are NOT — this module is independent of the removed EPUB-conversion path.

import JSZip from "jszip";
import { detectDocDirection, type Dir } from "./detectDirection";

// Mammoth's browser bundle is ~700KB — lazy-load it so it doesn't ship on app
// start (Vite code-splits at the dynamic import; first .docx import pays the
// one-time webview-cached cost).
async function loadMammoth() {
  const m = await import("mammoth/mammoth.browser");
  return m.default;
}

/** One heading in the document, with an injected anchor id the page source maps
 *  to a page number after pagination (pages don't exist until read time). */
export interface DocxOutlineEntry {
  title: string;
  /** 0-based nesting depth (h1 → 0). */
  level: number;
  anchorId: string;
}

export interface FixedDoc {
  /** Sanitized body HTML; `<img>` src values are `images/img-NNN.ext`, and
   *  headings carry `id="docx-h-N"` anchors matching `outline`. */
  html: string;
  images: { href: string; bytes: Uint8Array }[];
  title: string;
  author: string;
  dir: Dir;
  outline: DocxOutlineEntry[];
}

function extensionFromMime(mime: string): string {
  switch (mime.toLowerCase()) {
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
    case "image/bmp":
      return "bmp";
    case "image/tiff":
      return "tiff";
    default:
      return "bin";
  }
}

export async function docxToFixedDoc(
  fileBytes: Uint8Array,
  fallbackTitle: string,
): Promise<FixedDoc> {
  // JSZip wants the underlying buffer; Tauri's readFile may hand back a view
  // over a larger buffer, so slice cleanly when it isn't exact.
  const arrayBuffer =
    fileBytes.byteOffset === 0 &&
    fileBytes.byteLength === fileBytes.buffer.byteLength
      ? (fileBytes.buffer as ArrayBuffer)
      : (fileBytes.slice().buffer as ArrayBuffer);

  const zip = await JSZip.loadAsync(arrayBuffer);
  const { dir } = await detectDocDirection(zip);

  const mammoth = await loadMammoth();
  const images: { href: string; bytes: Uint8Array }[] = [];
  let imgN = 0;
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const buffer = await image.readAsArrayBuffer();
        const bytes = new Uint8Array(buffer);
        imgN += 1;
        const href = `images/img-${String(imgN).padStart(3, "0")}.${extensionFromMime(image.contentType)}`;
        images.push({ href, bytes });
        return { src: href };
      }),
    },
  );

  // Sanitize + inject heading anchors + build the outline. DOMParser is
  // available in the webview (this runs at import time inside the app).
  const parsed = new DOMParser().parseFromString(result.value, "text/html");
  parsed
    .querySelectorAll("script, style, link, meta, iframe, object, embed")
    .forEach((n) => n.remove());
  parsed.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    }
  });

  const outline: DocxOutlineEntry[] = [];
  parsed.querySelectorAll("h1, h2, h3").forEach((h, i) => {
    const anchorId = `docx-h-${i}`;
    h.id = anchorId;
    outline.push({
      title: (h.textContent || "").trim(),
      level: Math.max(0, Number(h.tagName[1]) - 1),
      anchorId,
    });
  });

  const firstHeading = parsed.querySelector("h1, h2, h3");
  const title = (firstHeading?.textContent || "").trim() || fallbackTitle;

  return {
    html: parsed.body.innerHTML,
    images,
    title,
    // Empty (not "Unknown author") — the display-time fallback localizes a
    // blank author; baking an English literal would freeze it in every locale.
    author: "",
    dir,
    outline,
  };
}
