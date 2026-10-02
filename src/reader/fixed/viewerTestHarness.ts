// Shared fixtures for FixedPageViewer tests in happy-dom.
//
// The viewer lays its page column out in JS from page sizes, so a DOM with no
// layout engine is enough, given two things: a source that reports sizes and
// stamps each rendered page, and a viewport that reports a size.

import { act } from "react";
import type { FixedPageSource } from "./FixedPageSource";

export const PAGE = { w: 612, h: 792 };

/** A source with no pixels: the viewer only ever asks it for page sizes and
 *  for something to put in the host, and the geometry under test is derived
 *  from the sizes alone. Each rendered page carries `data-page-index`. */
export function fakeSource(pageCount = 60): FixedPageSource {
  return {
    kind: "pdf",
    pageCount,
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

const sizeProps = ["clientWidth", "clientHeight"] as const;

/** happy-dom lays nothing out, so the viewer would measure a 0x0 container
 *  and reserve no height at all. Every element reporting the viewport's size
 *  is enough: the only ones the viewer measures are its own scroll layer.
 *  Also marks the environment for act(). Returns the restore function. */
export function fakeViewport(size: number): () => void {
  const saved = sizeProps.map(
    (p) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, p)!,
  );
  for (const p of sizeProps) {
    Object.defineProperty(HTMLElement.prototype, p, {
      configurable: true,
      get: () => size,
    });
  }
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  return () => {
    sizeProps.forEach((p, i) => {
      Object.defineProperty(HTMLElement.prototype, p, saved[i]);
    });
  };
}

/** Let effects, the page-size promises and the rAF-throttled scroll handler
 *  all run. */
export async function settle() {
  for (let n = 0; n < 6; n++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}
