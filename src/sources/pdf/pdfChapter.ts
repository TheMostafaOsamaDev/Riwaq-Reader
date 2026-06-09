// PDF chapter parser. Turns a downloaded chapter PDF into SourceLine[]:
// NFKC-normalized text paragraphs + extracted illustration bytes (handed back
// via mintImageRef so the caller stores them and embeds the returned ref in
// the image line). pdf.js is heavy and only needed for PDF sources, so it is
// dynamically imported on first use and its worker is bundled locally.

import type { SourceLine } from "../types";

export interface ExtractedImage {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
}

export interface ExtractPdfOptions {
  /** Chapter page URL — used to strip the page-1 boilerplate header line. */
  chapterUrl: string;
  /** Novel title, if known — lets us strip the page-1 title line so it isn't
   *  duplicated with the EPUB chapter <h1>. */
  novelTitle?: string;
  /** Persist an extracted image and return a stable ref to embed in the line. */
  mintImageRef: (img: ExtractedImage) => string;
  /** Optional debug logger. */
  log?: (msg: string) => void;
}

// Images smaller than this on either side are spacers/icons, not illustrations.
const MIN_IMAGE_DIM = 100;

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      // Vite returns the bundled worker URL via the ?url suffix (offline-safe).
      const workerUrl = (
        await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
      ).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

interface TextItemLike {
  str: string;
  transform: number[]; // [a,b,c,d,e,f]; e = x, f = y (PDF user space)
  hasEOL?: boolean;
  height?: number;
}

// These chapter PDFs are produced by mPDF with the "XB Riyaz" Arabic font.
// mPDF's Arabic shaper emits some glyphs (a few base letters and most of the
// diacritic marks) at Private-Use-Area codepoints with no ToUnicode mapping to
// real Unicode, so they extract as PUA and render as □. The codepoints are
// intrinsic to the font, so the same value maps to the same glyph across every
// chapter on the site (verified over hundreds of pages from many novels).
//
//   • Base letters → the real letter (these MUST be mapped — dropping them
//     would corrupt words, e.g. "لله" → "له").
//   • Diacritic/mark forms → dropped. These chapters are machine-translated and
//     read as unvocalized Arabic; dropping the marks gives clean text and
//     avoids combining-mark misplacement artifacts (mPDF emits some marks
//     before their base letter).
//   • Any *unseen* PUA is left as-is and logged — it might be an unmapped
//     letter, so we surface it rather than silently dropping it.
const PUA_LETTER: Record<number, string> = {
  0xe915: "ي", 0xe940: "ك", 0xe913: "ى", 0xe916: "ئ",
  0xe806: "ل", 0xe807: "ل", 0xe830: "ل", 0xe8d4: "ل",
  0xe80a: "ا", 0xe80e: "ا",
};
const PUA_DROP = new Set<number>([
  0xe823, 0xe86b, 0xe835, 0xe847, 0xe7e0, 0xe864, 0xe8e6, // tanwin
  0xe826, 0xe824, 0xe7e3, // damma
  0xe827, 0xe8ea, 0xe7e4, 0xe8f4, // shadda
  0xe825, 0xe8e8, 0xe863, 0xe7ee, 0xe815, // fatha / other marks
  0xe828, // kasra
  0xe8df, // sukun
  0xe8de, // kasratan
  0xe816, 0xe813, // hamza decoration over an alef that is its own char
  0xe888, // stray standalone mark
]);

/** Map the font's PUA glyph forms back to real Arabic (base letters) or drop
 *  them (diacritic marks); leave unrecognized PUA in place and report it via
 *  `onUnknown` so the table can be extended. No-op when the string has no PUA. */
function foldArabicPua(s: string, onUnknown?: (cp: number) => void): string {
  let hasPua = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xe000 && c <= 0xf8ff) { hasPua = true; break; }
  }
  if (!hasPua) return s;
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0xe000 && cp <= 0xf8ff) {
      const letter = PUA_LETTER[cp];
      if (letter !== undefined) out += letter;
      else if (PUA_DROP.has(cp)) continue;
      else { out += ch; onUnknown?.(cp); }
    } else {
      out += ch;
    }
  }
  return out;
}

/** Fold the font's PUA glyph forms (see foldArabicPua) and Arabic presentation
 *  forms (ﻟﺤﻴﺎة, via NFKC) back to base letters and collapse whitespace. Empty
 *  string when nothing remains. */
function normalizeArabic(s: string, onUnknownPua?: (cp: number) => void): string {
  return foldArabicPua(s, onUnknownPua).normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** True for the page-1 header lines we don't want in the body: the printed
 *  chapter URL, and the title line (which the EPUB re-renders as <h1>). */
function isBoilerplate(text: string, chapterUrl: string, novelTitle?: string): boolean {
  if (text.includes("kolnovel.com/")) return true; // the printed URL line
  const bare = chapterUrl.replace(/^https?:\/\//, "");
  if (bare && text.includes(bare)) return true;
  if (novelTitle) {
    const t = normalizeArabic(novelTitle);
    // The header title line is "<novel title> <chapter number>"; strip a line
    // that is the title plus only trailing digits/dots/whitespace.
    if (t && text.startsWith(t) && /^[\s\d.\-:]*$/.test(text.slice(t.length))) {
      return true;
    }
  }
  return false;
}

/** Best-effort paragraph reconstruction from a single page's text items.
 *  PDFs have no paragraph markers, so we segment on vertical gaps: items on
 *  the same line share ~y; consecutive lines are joined; a gap larger than
 *  ~1.6 line-heights starts a new paragraph. Tune the multiplier in the
 *  verify step against real chapters if paragraphs merge or fragment. */
function reconstructParagraphs(items: TextItemLike[]): string[] {
  const paras: string[] = [];
  let cur = "";
  let prevY: number | null = null;
  let lineHeight = 0;
  const flush = () => {
    if (cur.trim()) paras.push(cur.trim());
    cur = "";
  };
  for (const it of items) {
    const y = it.transform?.[5] ?? 0;
    const h = it.height || 0;
    if (h) lineHeight = lineHeight ? lineHeight * 0.7 + h * 0.3 : h;
    if (prevY !== null) {
      const dy = prevY - y; // PDF y decreases going down the page
      if (dy > Math.max(lineHeight * 1.6, 1)) flush();
    }
    if (it.str) {
      if (cur && !cur.endsWith(" ") && !it.str.startsWith(" ")) cur += " ";
      cur += it.str;
    }
    if (it.hasEOL && cur && !cur.endsWith(" ")) cur += " ";
    if (it.str && it.str.trim()) prevY = y; // marked-content items have no str
  }
  flush();
  return paras;
}

/** Render a page offscreen so pdf.js resolves its image XObjects into
 *  page.objs (image bytes aren't available until the page is processed). */
async function renderPageToResolveObjs(page: any): Promise<void> {
  const viewport = page.getViewport({ scale: 1.0 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas context");
  await page.render({ canvasContext: ctx, viewport }).promise;
}

/** Promisified objs.get — resolves null on miss/timeout instead of hanging.
 *  Images referenced on >= 2 pages are globally cached and arrive via
 *  page.commonObjs with a "g_"-prefixed id; per-page images via page.objs. */
function getImageObj(page: any, name: string): Promise<any | null> {
  const pool = name.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) { done = true; resolve(null); }
    }, 5000);
    try {
      pool.get(name, (obj: any) => {
        if (!done) { done = true; clearTimeout(t); resolve(obj); }
      });
    } catch {
      if (!done) { done = true; clearTimeout(t); resolve(null); }
    }
  });
}

/** Draw a resolved pdf.js image object to a canvas and export JPEG bytes. */
async function imageObjToBytes(img: any): Promise<ExtractedImage | null> {
  const w = img?.width | 0;
  const h = img?.height | 0;
  if (!w || !h) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (img.bitmap) {
    ctx.drawImage(img.bitmap, 0, 0);
  } else if (img.data) {
    // kind: 2 = RGB_24BPP, 3 = RGBA_32BPP, 1 = GRAYSCALE_1BPP (bit-packed,
    // 8 pixels per byte). In a browser with OffscreenCanvas, pdf.js returns an
    // ImageBitmap for 1bpp images (handled by the img.bitmap path above), so
    // the bit-unpack fallback below is defensive (and ignores row padding).
    const rgba = new Uint8ClampedArray(w * h * 4);
    const d: Uint8ClampedArray | Uint8Array = img.data;
    if (img.kind === 3) {
      rgba.set(d.subarray(0, rgba.length));
    } else if (img.kind === 2) {
      for (let i = 0, k = 0; i < d.length; i += 3, k += 4) {
        rgba[k] = d[i]; rgba[k + 1] = d[i + 1]; rgba[k + 2] = d[i + 2]; rgba[k + 3] = 255;
      }
    } else {
      // GRAYSCALE_1BPP: each byte holds 8 pixels, MSB first.
      for (let i = 0, k = 0; i < d.length && k < rgba.length; i++) {
        for (let b = 7; b >= 0 && k < rgba.length; b--, k += 4) {
          const v = ((d[i] >> b) & 1) ? 255 : 0;
          rgba[k] = rgba[k + 1] = rgba[k + 2] = v;
          rgba[k + 3] = 255;
        }
      }
    }
    ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  } else {
    return null;
  }

  const blob = await new Promise<Blob | null>((res) =>
    canvas.toBlob((b) => res(b), "image/jpeg", 0.85),
  );
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, mimeType: "image/jpeg", extension: "jpg" };
}

export async function extractPdfLines(
  bytes: Uint8Array,
  opts: ExtractPdfOptions,
): Promise<SourceLine[]> {
  const pdfjs = await loadPdfjs();
  const OPS = pdfjs.OPS;
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const lines: SourceLine[] = [];
  // PUA codepoints we couldn't fold (see foldArabicPua) — reported once below.
  const unknownPua = new Set<number>();

  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);

      // Find image-draw ops first so we only pay for an offscreen render on
      // pages that actually contain illustrations.
      const opList = await page.getOperatorList();
      const imageNames: string[] = [];
      const seenNames = new Set<string>();
      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
          // paintInlineImageXObject carries imgData (not a name string) in
          // args[0]; the typeof guard filters those out — inline images are
          // not extracted (rare in these chapter PDFs).
          const name = opList.argsArray[i]?.[0];
          if (typeof name === "string" && !seenNames.has(name)) {
            seenNames.add(name);
            imageNames.push(name);
          }
        }
      }

      // Text.
      const tc = await page.getTextContent();
      for (const para of reconstructParagraphs(tc.items as unknown as TextItemLike[])) {
        const norm = normalizeArabic(para, (cp) => unknownPua.add(cp));
        if (!norm) continue;
        if (isBoilerplate(norm, opts.chapterUrl, opts.novelTitle)) continue;
        lines.push({ type: "text", content: norm });
      }

      // Images (interleave after the page's text; LN illustrations are
      // full-page plates, so per-page ordering is sufficient).
      if (imageNames.length > 0) {
        await renderPageToResolveObjs(page);
        for (const name of imageNames) {
          try {
            const img = await getImageObj(page, name);
            if (!img || (img.width | 0) < MIN_IMAGE_DIM || (img.height | 0) < MIN_IMAGE_DIM) {
              continue;
            }
            const extracted = await imageObjToBytes(img);
            if (!extracted) continue;
            lines.push({ type: "image", content: opts.mintImageRef(extracted) });
          } catch (e) {
            opts.log?.(`image ${name} (page ${p}) failed: ${String(e)}`);
          }
        }
      }

      page.cleanup();
    }
  } finally {
    await doc.cleanup();
    await doc.destroy();
  }

  if (unknownPua.size > 0) {
    opts.log?.(
      `unmapped PUA glyphs left as-is (extend PUA tables in pdfChapter.ts): ${[
        ...unknownPua,
      ]
        .map((c) => "U+" + c.toString(16).toUpperCase())
        .join(" ")}`,
    );
  }

  return lines;
}
