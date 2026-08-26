// Shared pdf.js glue for the PDF reading mode: a lazy-loaded worker plus a thin
// document facade (page count, metadata, outline, per-page size + canvas
// render). Mirrors the worker-load pattern already used by the web-novel PDF
// text extractor (src/sources/pdf/pdfChapter.ts) so the bundled offline worker
// is reused. pdf.js is heavy, so it is dynamically imported on first use.

import type { TocEntry } from "../types/reader";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

/** Lazy-load pdf.js and point it at the locally-bundled worker (offline-safe). */
export async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
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

export interface PdfMeta {
  title?: string;
  author?: string;
}

/** A thin handle over one open PDF document. Pages are 0-based here (pdf.js is
 *  1-based internally — the facade converts). */
export interface PdfDoc {
  pageCount: number;
  meta: PdfMeta;
  outline: TocEntry[];
  /** True when page 1 carries an extractable text layer (selection/search). */
  hasTextLayer: boolean;
  /** Intrinsic CSS-pixel size of page `i` at the given scale. */
  pageViewport(i: number, scale: number): Promise<{ width: number; height: number }>;
  /** Render page `i` into `canvas` at `scale` (handles devicePixelRatio). */
  renderPage(i: number, canvas: HTMLCanvasElement, scale: number): Promise<void>;
  destroy(): void;
}

export async function openPdfDocument(bytes: Uint8Array): Promise<PdfDoc> {
  const pdfjs = await loadPdfjs();
  // Hand pdf.js its own copy — it may transfer/detach the buffer.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;

  const meta = await readMeta(doc);
  const outline = await buildOutline(doc);
  const hasTextLayer = await probeTextLayer(doc);

  // pdf.js forbids concurrent render() on the same canvas — cancel a canvas's
  // in-flight render before starting a new one (e.g. on fast scroll / rescale).
  const renderTasks = new WeakMap<
    HTMLCanvasElement,
    { cancel(): void; promise: Promise<void> }
  >();

  return {
    pageCount: doc.numPages,
    meta,
    outline,
    hasTextLayer,
    async pageViewport(i, scale) {
      const page = await doc.getPage(i + 1);
      const vp = page.getViewport({ scale });
      return { width: vp.width, height: vp.height };
    },
    async renderPage(i, canvas, scale) {
      const prev = renderTasks.get(canvas);
      if (prev) {
        try {
          prev.cancel();
        } catch {
          // already settled
        }
      }
      const page = await doc.getPage(i + 1);
      const vp = page.getViewport({ scale });
      // A 2D context's `direction` defaults to `inherit`, which resolves from
      // the canvas element's computed CSS. Mounted inside the reader's
      // `dir="rtl"` shell that makes it "rtl", and every `fillText` pdf.js
      // issues is then anchored from the opposite edge — glyph runs land in the
      // wrong places, words collide, and runs pushed past the edge disappear
      // entirely. A PDF carries its own text positions and must be drawn in a
      // direction-neutral context, so pin it regardless of where the canvas
      // hangs in the DOM.
      canvas.style.direction = "ltr";
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.direction = "ltr";
      // Render at devicePixelRatio for crisp text, capped at 2× to bound memory.
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(vp.width * outputScale);
      canvas.height = Math.floor(vp.height * outputScale);
      canvas.style.width = `${Math.floor(vp.width)}px`;
      canvas.style.height = `${Math.floor(vp.height)}px`;
      const task = page.render({
        canvasContext: ctx,
        viewport: vp,
        transform:
          outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      });
      renderTasks.set(canvas, task);
      try {
        await task.promise;
      } catch {
        // cancelled / superseded by a newer render — ignore
      } finally {
        if (renderTasks.get(canvas) === task) renderTasks.delete(canvas);
      }
    },
    destroy() {
      void doc.destroy();
    },
  };
}

// ── internals (pdf.js's outline/metadata shapes are loosely typed) ──────────

async function readMeta(doc: unknown): Promise<PdfMeta> {
  try {
    const { info } = (await (doc as any).getMetadata()) as {
      info?: { Title?: string; Author?: string };
    };
    return { title: info?.Title || undefined, author: info?.Author || undefined };
  } catch {
    return {};
  }
}

async function probeTextLayer(doc: unknown): Promise<boolean> {
  try {
    const page = await (doc as any).getPage(1);
    const tc = await page.getTextContent();
    return Array.isArray(tc.items) && tc.items.length > 0;
  } catch {
    return false;
  }
}

async function buildOutline(doc: unknown): Promise<TocEntry[]> {
  let raw: any[] | null = null;
  try {
    raw = await (doc as any).getOutline();
  } catch {
    raw = null;
  }
  if (!raw || raw.length === 0) return [];
  const out: TocEntry[] = [];
  const walk = async (items: any[], level: number) => {
    for (const it of items) {
      let page = 0;
      try {
        page = await destToPageIndex(doc, it.dest);
      } catch {
        page = 0;
      }
      out.push({
        title: String(it.title ?? "").trim(),
        dest: { fmt: "page", page },
        level,
      });
      if (Array.isArray(it.items) && it.items.length > 0) {
        await walk(it.items, level + 1);
      }
    }
  };
  await walk(raw, 0);
  return out;
}

async function destToPageIndex(doc: unknown, dest: unknown): Promise<number> {
  const explicit =
    typeof dest === "string" ? await (doc as any).getDestination(dest) : dest;
  if (!Array.isArray(explicit) || explicit.length === 0) return 0;
  const idx = await (doc as any).getPageIndex(explicit[0]); // 0-based
  return typeof idx === "number" ? idx : 0;
}
