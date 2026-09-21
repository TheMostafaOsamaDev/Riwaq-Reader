// @vitest-environment happy-dom
//
// Evicting a page has to give the memory back.
//
// `evict` used to detach the page wrap and drop the map entry, which is
// enough for the source's own byte counter to read as "inside budget" while
// the process keeps every bitmap. A detached canvas is only collected if
// nothing else points at it, and something does: pdf.js keeps every page it
// has handed out, a page keeps its render task, and the task keeps the canvas
// context. So the orphans piled up — a desktop webview measured 1.3GB across
// 82 of them against a 96MB budget, with the text layers still attached (12k
// spans, one inline style each).
//
// Zeroing the dimensions frees the backing store whoever holds the element,
// so that is what these pin. `renderPage` in the fake sizes the canvas the
// way pdf.js does, which is the only part of a real render that matters.

import { describe, expect, it } from "vitest";
import type { PdfDoc } from "../../pdf/pdfjs";
import { createPdfPageSourceFrom } from "./PdfPageSource";

const PAGE_W = 1200;
const PAGE_H = 1600;
/** Spans per page, standing in for pdf.js's text layer. */
const SPANS = 50;

/** Pages the source has asked the document to let go of. */
const released: number[] = [];

function fakeDoc(pageCount = 40): PdfDoc {
  released.length = 0;
  return {
    pageCount,
    meta: {},
    outline: [],
    hasTextLayer: true,
    async pageViewport(_i, scale) {
      return { width: PAGE_W * scale, height: PAGE_H * scale };
    },
    async renderPage(_i, canvas, scale) {
      // Sizing the backing store is what allocates it, and it is what
      // `canvasBytes` measures.
      canvas.width = Math.floor(PAGE_W * scale);
      canvas.height = Math.floor(PAGE_H * scale);
    },
    async renderTextLayer(_i, container, _scale) {
      container.textContent = "";
      for (let n = 0; n < SPANS; n++) {
        const span = document.createElement("span");
        span.style.cssText = "left:0px; top:0px; font-size:10px;";
        span.textContent = "كلمة";
        container.appendChild(span);
      }
    },
    releasePage(i) {
      released.push(i);
    },
    destroy() {},
  };
}

function newHost(): HTMLDivElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

interface Page {
  host: HTMLDivElement;
  canvas: HTMLCanvasElement;
  text: HTMLElement;
}

/** Render `count` pages, each into its own host, and keep hold of the layers
 *  so they can still be inspected after the source has let go of them. */
async function renderPages(
  src: Awaited<ReturnType<typeof createPdfPageSourceFrom>>,
  count: number,
): Promise<Page[]> {
  const pages: Page[] = [];
  for (let i = 0; i < count; i++) {
    const host = newHost();
    await src.renderPage(i, host, 1);
    const canvas = host.querySelector("canvas");
    const text = host.querySelector<HTMLElement>(".textLayer");
    if (!canvas || !text) throw new Error(`page ${i} did not mount`);
    pages.push({ host, canvas, text });
  }
  return pages;
}

describe("a page the source has evicted", () => {
  it("was really drawn before any of this is worth asserting", async () => {
    const src = await createPdfPageSourceFrom(fakeDoc());
    const [first] = await renderPages(src, 1);
    // Guards every other case here against passing vacuously on a canvas
    // that was never sized in the first place.
    expect(first.canvas.width).toBe(PAGE_W);
    expect(first.canvas.height).toBe(PAGE_H);
    expect(first.text.childElementCount).toBe(SPANS);
  });

  it("is detached from its host", async () => {
    const src = await createPdfPageSourceFrom(fakeDoc());
    const pages = await renderPages(src, 30);
    // The precondition for everything below: page 0 is far enough back in the
    // LRU that both the byte budget and the count ceiling have passed over it.
    expect(pages[0].host.querySelector("canvas")).toBeNull();
  });

  it("gives its backing store back", async () => {
    const src = await createPdfPageSourceFrom(fakeDoc());
    const pages = await renderPages(src, 30);
    expect(pages[0].canvas.width).toBe(0);
    expect(pages[0].canvas.height).toBe(0);
  });

  it("gives its text layer back", async () => {
    const src = await createPdfPageSourceFrom(fakeDoc());
    const pages = await renderPages(src, 30);
    expect(pages[0].text.childElementCount).toBe(0);
  });

  it("holds no more pixels than the pages it still has mounted", async () => {
    const src = await createPdfPageSourceFrom(fakeDoc());
    const pages = await renderPages(src, 30);
    const live = pages.filter((p) => p.canvas.width > 0);
    // What the leak actually looked like: the source believed it was inside
    // budget while 20-odd orphans stayed fully sized.
    expect(live.length).toBeLessThanOrEqual(14);
    const bytes = pages.reduce(
      (n, p) => n + p.canvas.width * p.canvas.height * 4,
      0,
    );
    expect(bytes).toBeLessThanOrEqual(96 * 1024 * 1024);
  });
});

describe("destroying the source", () => {
  it("gives every mounted page back", async () => {
    const src = await createPdfPageSourceFrom(fakeDoc());
    const pages = await renderPages(src, 5);
    src.destroy();
    for (const p of pages) {
      expect(p.canvas.width).toBe(0);
      expect(p.canvas.height).toBe(0);
      expect(p.text.childElementCount).toBe(0);
    }
  });
});

describe("a page that is still retained", () => {
  it("keeps its pixels when the reader is looking at it", async () => {
    const src = await createPdfPageSourceFrom(fakeDoc());
    const host0 = newHost();
    await src.renderPage(0, host0, 1);
    const canvas0 = host0.querySelector("canvas");
    if (!canvas0) throw new Error("page 0 did not mount");
    // Optional on the interface, but a PDF source without it cannot protect
    // its working set at all — that is the bug this guards, so fail loudly
    // rather than skip.
    if (!src.retain) throw new Error("the pdf source cannot retain pages");
    src.retain([0]);
    // Enough traffic to evict page 0 several times over, were it allowed.
    for (let i = 1; i < 30; i++) await src.renderPage(i, newHost(), 1);
    expect(canvas0.width).toBe(PAGE_W);
    expect(host0.querySelector("canvas")).toBe(canvas0);
  });
});

// The bitmap is the big half of the leak, but not all of it. pdf.js keeps its
// own cache: every `getPage` result is held for the life of the document,
// along with that page's operator list, decoded images and fonts. Nothing
// ever dropped one, so a long session accumulated them behind the canvases —
// the measured webview held 155 live image-decode sessions. `cleanup()` is
// the documented way to give a page back, and it declines politely while a
// render is pending, so eviction is the right moment to call it.
describe("the document behind the pages", () => {
  it("is told to let go of a page the source evicted", async () => {
    const src = await createPdfPageSourceFrom(fakeDoc());
    await renderPages(src, 30);
    expect(released).toContain(0);
  });

  it("is not told to let go of a page that is still mounted", async () => {
    const src = await createPdfPageSourceFrom(fakeDoc());
    await renderPages(src, 30);
    // Whatever survived eviction is still on screen; releasing it would blank
    // a page the reader is looking at on its next redraw.
    expect(released).not.toContain(29);
  });

  it("is told to let go of every page when the source is destroyed", async () => {
    const src = await createPdfPageSourceFrom(fakeDoc());
    await renderPages(src, 5);
    released.length = 0;
    src.destroy();
    expect([...released].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
});
