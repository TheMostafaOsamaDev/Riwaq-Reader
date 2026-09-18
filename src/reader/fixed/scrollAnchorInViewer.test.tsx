// @vitest-environment happy-dom
//
// The wiring: rescaling the page column must not move the reader. `scrollTop`
// is an absolute offset into a column whose height is a multiple of the scale,
// so leaving it alone across a change of zoom — or of fit, which rescales the
// same way — lands the reader several pages from where they were.
//
// The column is laid out in JS: every page's `top` and height is a number the
// viewer computes rather than something the browser measures, so a DOM with no
// layout engine is enough to catch this. The arithmetic itself is covered in
// scrollAnchor.test.ts; what is proved here is that the viewer calls it, at
// the right moment, against the new column.
//
// The third input that rescales the column, the container's own size, is NOT
// covered here: it reaches the viewer through a ResizeObserver, and happy-dom
// never fires one. That case is verified in a real browser instead.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FixedPageViewer } from "./FixedPageViewer";
import type { FixedPageSource } from "./FixedPageSource";
import type { FixedFit } from "../../types/reader";
import { THEMES } from "../../styles/tokens";

const VIEWPORT = 900;
const PAGE_COUNT = 60;
const PAGE = { w: 612, h: 792 };

interface Scale {
  zoom?: number;
  fit?: FixedFit;
}

/** A source with no pixels: the viewer only ever asks it for page sizes and
 *  for something to put in the host, and the geometry under test is derived
 *  from the sizes alone. */
function fakeSource(): FixedPageSource {
  return {
    kind: "pdf",
    pageCount: PAGE_COUNT,
    outline: [],
    hasTextLayer: false,
    async pageSize() {
      return PAGE;
    },
    async renderPage(i, host) {
      const el = document.createElement("div");
      el.setAttribute("data-page-index", String(i));
      host.replaceChildren(el);
    },
    destroy() {},
  };
}

function viewer({ zoom = 1, fit = "width" }: Scale) {
  return (
    <FixedPageViewer
      source={source}
      flow="scroll"
      fit={fit}
      zoom={zoom}
      tint="none"
      dir="ltr"
      turnAxis="y"
      theme={THEMES.light}
      themeKey="light"
      highlights={[]}
      onSelect={() => {}}
      onHighlightClick={() => {}}
    />
  );
}

let source: FixedPageSource;
let host: HTMLDivElement;
let root: Root;
const sizeProps = ["clientWidth", "clientHeight"] as const;
let saved: PropertyDescriptor[] = [];

beforeEach(() => {
  // happy-dom lays nothing out, so the viewer would measure a 0x0 container
  // and reserve no height at all. Every element reporting the viewport's size
  // is enough: the only ones the viewer measures are its own scroll layer.
  saved = sizeProps.map(
    (p) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, p)!,
  );
  for (const p of sizeProps) {
    Object.defineProperty(HTMLElement.prototype, p, {
      configurable: true,
      get: () => VIEWPORT,
    });
  }
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  source = fakeSource();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  sizeProps.forEach((p, i) => {
    Object.defineProperty(HTMLElement.prototype, p, saved[i]);
  });
});

/** Let effects, the page-size promises and the rAF-throttled scroll handler
 *  all run. */
async function settle() {
  for (let n = 0; n < 6; n++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

function scroller(): HTMLElement {
  const el = host.querySelector<HTMLElement>(".no-scrollbar");
  if (!el) throw new Error("no scroll layer");
  return el;
}

/** Where the top of the viewport sits, read back out of what the viewer
 *  actually rendered: each mounted page host carries its own `top` and
 *  `height` inline, and the source stamps the page index inside it.
 *
 *  Deliberately re-derived from the DOM rather than by calling `anchorAt` —
 *  computing the expectation with the code under test proves nothing. */
function placeOnScreen(): { page: number; offset: number } {
  const sc = scroller();
  const rows = [...sc.querySelectorAll<HTMLElement>("[data-page-index]")]
    .map((child) => {
      const box = child.parentElement;
      if (!box) throw new Error("page host missing");
      return {
        page: Number(child.dataset.pageIndex),
        top: Number.parseFloat(box.style.top),
        height: Number.parseFloat(box.style.height),
      };
    })
    .sort((a, b) => a.top - b.top);
  const at = rows.find((r) => r.top + r.height > sc.scrollTop);
  if (!at) {
    throw new Error(
      `nothing mounted at scrollTop ${sc.scrollTop}; have ${rows
        .map((r) => r.page)
        .join(",")}`,
    );
  }
  return { page: at.page, offset: (sc.scrollTop - at.top) / at.height };
}

/** Open the book at `from`, scroll deep into it, change the scale to `to`,
 *  and report where the reader ended up against where they started. */
async function rescale(from: Scale, to: Scale, scrollY: number) {
  await act(async () => {
    root.render(viewer(from));
  });
  await settle();

  const sc = scroller();
  sc.scrollTop = scrollY;
  sc.dispatchEvent(new Event("scroll"));
  await settle();

  const before = placeOnScreen();
  await act(async () => {
    root.render(viewer(to));
  });
  await settle();
  return { before, after: placeOnScreen() };
}

describe("FixedPageViewer — a change of scale holds the reader's place", () => {
  it.each([
    ["zoom in", { zoom: 1 }, { zoom: 1.25 }, 20000],
    ["zoom out", { zoom: 1.5 }, { zoom: 0.75 }, 30000],
    // Same column, same root cause: "fit page" scales every page to the
    // viewport height instead of its width, so the whole column changes
    // height under a reader who only asked to see the page differently.
    [
      "fit width to page",
      { fit: "width" as const },
      { fit: "page" as const },
      20000,
    ],
  ])("stays on the same page: %s", async (_label, from, to, scrollY) => {
    const { before, after } = await rescale(from, to, scrollY);
    // Deep enough in that a jump would show — near the top every wrong
    // answer is also page 0 or 1, so a shallow case can pass while broken.
    expect(before.page).toBeGreaterThan(10);
    expect(after.page).toBe(before.page);
    expect(after.offset).toBeCloseTo(before.offset, 1);
  });
});
