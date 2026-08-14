// PDF-backed FixedPageSource: reads books/<id>/book.pdf off disk, opens it with
// pdf.js, and renders pages to <canvas> on demand. Page bitmaps are expensive,
// so mounted canvases are LRU-evicted to keep memory bounded on long books.

import { BaseDirectory, readFile } from "@tauri-apps/plugin-fs";
import { openPdfDocument } from "../../pdf/pdfjs";
import { bookDir, type PdfBook } from "../../store/library";
import type { FixedPageSource } from "./FixedPageSource";

const BASE = BaseDirectory.AppData;
const MAX_MOUNTED = 12; // rendered canvases kept alive at once

export async function createPdfPageSource(
  book: PdfBook,
): Promise<FixedPageSource> {
  const bytes = await readFile(`${bookDir(book.id)}/book.pdf`, { baseDir: BASE });
  const doc = await openPdfDocument(bytes);
  const sizeCache = new Map<number, { w: number; h: number }>();
  // Insertion-ordered so the first key is the oldest — cheap LRU.
  const mounted = new Map<number, HTMLCanvasElement>();

  return {
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
      let canvas = mounted.get(i);
      if (!canvas || canvas.parentElement !== host) {
        // Fresh host (or recycled by the virtualizer) — reset it.
        host.textContent = "";
        canvas = document.createElement("canvas");
        canvas.style.display = "block";
        host.appendChild(canvas);
        // Refresh LRU order.
        mounted.delete(i);
        mounted.set(i, canvas);
      }
      await doc.renderPage(i, canvas, scale);

      // Evict the oldest beyond the window (never the page just rendered).
      while (mounted.size > MAX_MOUNTED) {
        const oldest = mounted.keys().next().value as number | undefined;
        if (oldest === undefined || oldest === i) break;
        mounted.get(oldest)?.remove();
        mounted.delete(oldest);
      }
    },

    destroy() {
      for (const c of mounted.values()) c.remove();
      mounted.clear();
      doc.destroy();
    },
  };
}
