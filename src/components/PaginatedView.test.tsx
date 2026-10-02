// @vitest-environment happy-dom
//
// A window resize must leave the reader where they were. happy-dom has no
// multicol layout, so the paragraphs' column positions come from a small text
// model that reflows with the wrapper's width the way the browser would:
// narrower pages hold fewer characters, so every paragraph starts on a later
// page. What is under test is PaginatedView's own bookkeeping on top of that
// — which page it lands on, which paragraph it believes the reader is on, and
// whether it animates getting there.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PaginatedAPI, PaginatedView } from "./PaginatedView";

const GAP = 56;
const LINE_H = 30;
const CHAR_W = 9;
const PARAS = 160;
const paraChars = (i: number) => 180 + (i % 3) * 140;

let width = 1280;
let height = 820;
/** Glyph width — a web font swapping in reflows the text at the same size. */
let charW = CHAR_W;

/** Where paragraph `i` starts, in the multicol box's offsetLeft terms (LTR). */
function offsetLeftOf(i: number): number {
  const charsPerLine = Math.max(1, Math.floor(width / charW));
  const linesPerPage = Math.max(1, Math.floor(height / LINE_H));
  let line = 0;
  for (let p = 0; p < i; p++) line += Math.ceil(paraChars(p) / charsPerLine);
  return Math.floor(line / linesPerPage) * (width + GAP);
}

const observers = new Set<() => void>();
class FakeResizeObserver {
  private cb: () => void;
  constructor(cb: () => void) {
    this.cb = () => cb();
  }
  observe() {
    observers.add(this.cb);
  }
  unobserve() {}
  disconnect() {
    observers.delete(this.cb);
  }
}

function resize(w: number, h: number) {
  width = w;
  height = h;
  act(() => {
    for (const cb of observers) cb();
  });
}

let host: HTMLDivElement;
let root: Root;
let api: PaginatedAPI | null;
let reported: number[];
const restore: Array<() => void> = [];

function patch<T extends object>(
  obj: T,
  key: PropertyKey,
  desc: PropertyDescriptor,
) {
  const prev = Object.getOwnPropertyDescriptor(obj, key);
  Object.defineProperty(obj, key, { configurable: true, ...desc });
  restore.push(() => {
    if (prev) Object.defineProperty(obj, key, prev);
    else delete (obj as Record<PropertyKey, unknown>)[key];
  });
}

function render(initialParagraph: number) {
  act(() =>
    root.render(
      <PaginatedView
        columnsPerPage={1}
        columnGap={GAP}
        initialParagraph={initialParagraph}
        onParagraphChange={(i) => reported.push(i)}
        onApi={(a) => {
          api = a;
        }}
      >
        {Array.from({ length: PARAS }, (_, i) => (
          <p key={i} data-p-index={i}>
            {i}
          </p>
        ))}
      </PaginatedView>,
    ),
  );
}

const inner = () => host.querySelector<HTMLElement>("[dir]") as HTMLElement;
/** The page the view is showing, read back off its transform. */
const shownPage = () => {
  const m = /translateX\((-?[\d.]+)px\)/.exec(inner().style.transform);
  return Math.round(Math.abs(Number(m?.[1] ?? 0)) / (width + GAP));
};
const pageOf = (i: number) => Math.floor(offsetLeftOf(i) / (width + GAP));

beforeEach(() => {
  width = 1280;
  height = 820;
  charW = CHAR_W;
  api = null;
  reported = [];
  observers.clear();
  patch(globalThis, "ResizeObserver", {
    value: FakeResizeObserver,
    writable: true,
  });
  patch(document, "fonts", { value: new EventTarget() });
  patch(HTMLElement.prototype, "getBoundingClientRect", {
    value: () => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
    }),
  });
  patch(HTMLElement.prototype, "offsetLeft", {
    get(this: HTMLElement) {
      const idx = this.dataset.pIndex;
      return idx === undefined ? 0 : offsetLeftOf(Number(idx));
    },
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  while (restore.length) restore.pop()?.();
});

describe("PaginatedView across window resizes", () => {
  it("keeps the reader on the same paragraph through repeated resizes", () => {
    render(60);
    expect(shownPage()).toBe(pageOf(60));

    // Maximize, restore, tile to half, restore — the round trip that used to
    // walk the reader backwards a few paragraphs every time.
    for (const [w, h] of [
      [1920, 1080],
      [1280, 820],
      [900, 820],
      [960, 1000],
      [1280, 820],
      [1920, 1080],
      [1280, 820],
    ]) {
      resize(w, h);
      expect(shownPage()).toBe(pageOf(60));
    }
    expect(reported.filter((i) => i !== 60)).toEqual([]);
  });

  it("jumps to the re-anchored page instead of sliding to it", () => {
    render(60);
    resize(1920, 1080);
    expect(inner().style.transition).not.toContain("transform");
  });

  it("still slides on a page turn the reader asked for", () => {
    render(60);
    resize(1920, 1080);
    act(() => {
      api?.nextPage();
    });
    expect(inner().style.transition).toContain("transform");
  });

  it("moves the anchor when the reader turns the page", () => {
    render(0);
    act(() => {
      api?.nextPage();
    });
    const onPage1 = reported[reported.length - 1];
    expect(pageOf(onPage1)).toBe(1);
    resize(900, 820);
    expect(shownPage()).toBe(pageOf(onPage1));
  });

  it("re-anchors when a web font finishes loading and reflows the text", () => {
    // Measured against the fallback face, which is narrower: paragraph 60
    // sits a page earlier than it will once the real face is in.
    charW = 8;
    render(60);
    charW = CHAR_W;
    expect(shownPage()).not.toBe(pageOf(60));
    act(() => {
      document.fonts.dispatchEvent(new Event("loadingdone"));
    });
    expect(shownPage()).toBe(pageOf(60));
    expect(inner().style.transition).not.toContain("transform");
  });

  it("re-anchors when an image in the chapter finishes loading", () => {
    charW = 8;
    render(60);
    charW = CHAR_W;
    act(() => {
      // load does not bubble; the view has to listen in the capture phase.
      inner().querySelector("p")?.dispatchEvent(new Event("load"));
    });
    expect(shownPage()).toBe(pageOf(60));
  });
});
