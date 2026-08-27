// PDF-backed FixedPageSource: reads books/<id>/book.pdf off disk, opens it with
// pdf.js, and renders pages to <canvas> on demand. Page bitmaps are expensive,
// so mounted canvases are LRU-evicted to keep memory bounded on long books.

import { BaseDirectory, readFile } from "@tauri-apps/plugin-fs";
import { openPdfDocument } from "../../pdf/pdfjs";
import { bookDir, type PdfBook } from "../../store/library";
import type { FixedPageSource } from "./FixedPageSource";

const BASE = BaseDirectory.AppData;
// Never evict below this: the page on screen, the one sliding in, and one
// neighbour. Dropping any of those guarantees a rasterization mid-turn.
const MIN_MOUNTED = 3;
// Hard ceiling on the number of live canvases, independent of their size —
// a backstop for pages small enough that the byte budget alone wouldn't bite.
const MAX_MOUNTED = 14;

/** How many bytes of canvas we're willing to hold.
 *
 *  Counting canvases is the wrong unit: a page at 100% on a phone is ~3MB
 *  while the same page zoomed to 250% is ~20MB, so a fixed count either wastes
 *  memory at low zoom or blows past a safe footprint at high zoom. Budget the
 *  bytes instead and let the count fall out of it.
 *
 *  `deviceMemory` is coarse (rounded to a power of two, capped at 8) and absent
 *  outside Chromium, which is fine — it only has to separate a 2GB phone from
 *  an 8GB one. The clamp keeps both ends sane when it's missing or lying. */
function canvasBudgetBytes(): number {
  const gb = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  const guess = typeof gb === "number" && gb > 0 ? gb * 8 : 48; // MB
  return Math.min(96, Math.max(24, guess)) * 1024 * 1024;
}

/** A page we have already rasterized, plus the scale its pixels were drawn at.
 *  Keeping the scale lets `renderPage` re-mount a canvas somewhere else without
 *  redrawing it — see the note there. */
interface Mounted {
  canvas: HTMLCanvasElement;
  scale: number;
  /** Backing-store bytes, so eviction can budget by memory rather than count. */
  bytes: number;
}

/** RGBA backing store of a canvas, in bytes. */
function canvasBytes(c: HTMLCanvasElement): number {
  return c.width * c.height * 4;
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
  const budget = canvasBudgetBytes();

  function heldBytes(): number {
    let n = 0;
    for (const m of mounted.values()) n += m.bytes;
    return n;
  }

  /** Drop least-recently-used canvases until we're inside both the byte budget
   *  and the count ceiling, never touching `keep` and never going below
   *  MIN_MOUNTED — a turn's working set outranks the budget. */
  function evict(keep: number) {
    let bytes = heldBytes();
    while (
      mounted.size > MIN_MOUNTED &&
      (mounted.size > MAX_MOUNTED || bytes > budget)
    ) {
      // Oldest first, but step over the page we were just asked to keep
      // instead of giving up on it — otherwise one pinned entry at the head
      // stalls eviction entirely and the budget is never enforced.
      let victim: number | undefined;
      for (const key of mounted.keys()) {
        if (key !== keep) {
          victim = key;
          break;
        }
      }
      if (victim === undefined) break;
      const m = mounted.get(victim)!;
      bytes -= m.bytes;
      m.canvas.remove();
      mounted.delete(victim);
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
        entry.bytes = canvasBytes(entry.canvas); // scale changed the backing store
        evict(i);
        return;
      }

      // Fresh host (or recycled by the virtualizer) — reset it.
      host.textContent = "";
      const canvas = document.createElement("canvas");
      canvas.style.display = "block";
      host.appendChild(canvas);
      const created: Mounted = { canvas, scale: want, bytes: 0 };
      mounted.set(i, created);
      await doc.renderPage(i, canvas, scale);
      created.bytes = canvasBytes(canvas);
      evict(i);
    },

    destroy() {
      for (const m of mounted.values()) m.canvas.remove();
      mounted.clear();
      doc.destroy();
    },
  };
}
