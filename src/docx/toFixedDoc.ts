// DOCX → a self-contained "fixed document": sanitized HTML + extracted images
// (final `images/img-NNN.ext` hrefs) + reading direction + a heading outline.
// This replaces the old DOCX→EPUB conversion: DOCX is now read as fixed pages
// (paginated at read time by DocxPageSource), not reflowed as an EPUB.
//
// The unzip + mammoth half runs in a worker (see rawHtml.ts / convertInWorker.ts);
// what is left here is the DOM pass, which needs DOMParser and so cannot leave
// the main thread.

import { docxToRawHtmlInWorker } from "./convertInWorker";
import type { Dir } from "./detectDirection";

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

export async function docxToFixedDoc(
  fileBytes: Uint8Array,
  fallbackTitle: string,
): Promise<FixedDoc> {
  const { html: rawHtml, images, dir } = await docxToRawHtmlInWorker(fileBytes);

  // Sanitize + inject heading anchors + build the outline. DOMParser is
  // available in the webview (this runs at import time inside the app) but
  // not in a worker, which is why only this half stayed here. It measured at
  // 3 ms against a real 8.9 MB document, versus 135 ms for the half above.
  const parsed = new DOMParser().parseFromString(rawHtml, "text/html");
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
