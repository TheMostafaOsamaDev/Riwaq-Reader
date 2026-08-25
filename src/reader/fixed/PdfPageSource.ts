// PDF-backed FixedPageSource: reads books/<id>/book.pdf off disk, opens it with
// pdf.js, and renders pages to <canvas> on demand. Page bitmaps are expensive,
// so mounted canvases are LRU-evicted to keep memory bounded on long books.

import { BaseDirectory, readFile } from "@tauri-apps/plugin-fs";
import { openPdfDocument } from "../../pdf/pdfjs";
import { bookDir, type PdfBook } from "../../store/library";
import type { FixedPageSource } from "./FixedPageSource";

const BASE = BaseDirectory.AppData;
const MAX_MOUNTED = 8; // rendered canvases kept alive at once (bounds memory)

/** A page we have already rasterized, plus the scale its pixels were drawn at.
 *  Keeping the scale lets `renderPage` re-mount a canvas somewhere else without
 *  redrawing it — see the note there. */
interface Mounted {
  canvas: HTMLCanvasElement;
  scale: number;
}

/** Scale comparisons go through the same rounding the viewer uses, so a float
 *  that differs in the 4th decimal doesn't force a pointless re-render. */
function quantize(scale: number): number {
  return Math.round(scale * 1000) / 1000;
}

export async function createPdfPageSource(
  book: PdfBook,
): Promise<FixedPageSource> {
  const bytes = await readFile(`${bookDir(book.id)}/book.pdf`, { baseDir: BASE });
  return createPdfPageSourceFromBytes(bytes);
}

/** Build a page source directly from PDF bytes — used by the dev harness and by
 *  createPdfPageSource after it reads the file off disk. */
export async function createPdfPageSourceFromBytes(
  bytes: Uint8Array,
): Promise<FixedPageSource> {
  const doc = await openPdfDocument(bytes);
  const sizeCache = new Map<number, { w: number; h: number }>();
  // Insertion-ordered so the first key is the oldest — cheap LRU.
  const mounted = new Map<number, Mounted>();

  /** Drop the least-recently-used canvases past the window, never `keep`. */
  function evict(keep: number) {
    while (mounted.size > MAX_MOUNTED) {
      const oldest = mounted.keys().next().value as number | undefined;
      if (oldest === undefined || oldest === keep) break;
      mounted.get(oldest)?.canvas.remove();
      mounted.delete(oldest);
    }
  }

  return {
    kind: "pdf",
    pageCount: doc.pageCount,
    outline: doc.outline,
    hasTextLayer: doc.hasTextLayer,

    async pageSize(i) {
      const cached = sizeCache.get(i);
      if (cached) return cached;
      const vp = await doc.pageViewport(i, 1);
      const size = { w: vp.width, h: vp.height };
      sizeCache.set(i, size);
      return size;
    },

    async renderPage(i, host, scale) {
      const want = quantize(scale);
      const entry = mounted.get(i);
      if (entry) {
        // MOVE the existing canvas rather than building a new one. A page turn
        // hands the same page from the overlay host to the base host, and a
        // fresh canvas there meant rasterizing the page a second time — the
        // single most expensive thing a turn did, and it landed mid-animation.
        // Re-parenting keeps the pixels, so the second mount is free.
        if (entry.canvas.parentElement !== host) {
          host.textContent = "";
          host.appendChild(entry.canvas);
        }
        // Refresh LRU order.
        mounted.delete(i);
        mounted.set(i, entry);
        // Same scale → the bitmap is still correct, nothing to redraw.
        if (entry.scale === want) return;
        entry.scale = want;
        await doc.renderPage(i, entry.canvas, scale);
        evict(i);
        return;
      }

      // Fresh host (or recycled by the virtualizer) — reset it.
      host.textContent = "";
      const canvas = document.createElement("canvas");
      canvas.style.display = "block";
      host.appendChild(canvas);
      const created: Mounted = { canvas, scale: want };
      mounted.set(i, created);
      await doc.renderPage(i, canvas, scale);
      evict(i);
    },

    destroy() {
      for (const m of mounted.values()) m.canvas.remove();
      mounted.clear();
      doc.destroy();
    },
  };
}
