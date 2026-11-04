// @vitest-environment happy-dom
//
// A reopened book has to stay where it reopened while the page settles.
//
// The resume jump lands in a layout effect, before the reading font has
// finished loading. When it arrives the text is re-measured and grows —
// measured on a Galaxy A73: the jump landed on paragraph 5 at 17px, and 60ms
// later Markazi Text loaded, useFontScale set 22.46px, and the same scrollTop
// showed paragraph 4. The landing's own report then saved paragraph 4, so
// every cold start walked the reader back. Chromium's scroll anchoring did
// not hold it, and WebKitGTK has none at all.
//
// The readers now hold the resumed position across book-body resizes until
// the reader first touches the page.

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { desktopReader, makeBook } from "./desktopReaderTestHarness";
import {
  installLayoutFake,
  mobileReader,
  readingSurface,
} from "./mobileReaderTestHarness";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

const BOOK = makeBook("en", 1, 40);

let host: HTMLDivElement;
let root: Root;
let geometry: { paraH: number };

/** ResizeObservers watching the book body, so a test can announce that it
 *  changed size the way a browser would. */
const bodyWatchers: Array<() => void> = [];
class FakeResizeObserver {
  private targets: Element[] = [];
  constructor(private cb: ResizeObserverCallback) {}
  observe(target: Element) {
    this.targets.push(target);
    if ((target as HTMLElement).dataset?.bookBody !== undefined)
      bodyWatchers.push(() => this.cb([], this as unknown as ResizeObserver));
  }
  unobserve() {}
  disconnect() {
    this.targets = [];
  }
}

/** The web font arrives: every paragraph grows by `scale`. */
function reflow(scale: number) {
  geometry.paraH = 100 * scale;
  act(() => {
    for (const notify of [...bodyWatchers]) notify();
    vi.advanceTimersByTime(50);
  });
}

/** The paragraph at the top of the page and how far into it — the readers'
 *  own measuring rule. */
function topOfPage() {
  const sc = readingSurface(host);
  const top = sc.getBoundingClientRect().top;
  let at = 0;
  let el: HTMLElement | null = null;
  for (const p of sc.querySelectorAll<HTMLElement>("[data-p-index]")) {
    if (p.getBoundingClientRect().top - top > 8) break;
    at = Number(p.dataset.pIndex);
    el = p;
  }
  const off = el ? (sc.scrollTop - el.offsetTop) / el.offsetHeight : 0;
  return { at, off: Math.round(off * 1000) / 1000 };
}

function open(reader: ReactElement) {
  act(() => root.render(reader));
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

const phone = () =>
  mobileReader({
    book: BOOK,
    locale: "en",
    resumeParagraph: 20,
    resumeOffset: 0.3,
  });
const desktop = () =>
  desktopReader({
    book: BOOK,
    locale: "en",
    resumeParagraph: 20,
    resumeOffset: 0.3,
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) =>
    setTimeout(() => fn(performance.now()), 0),
  );
  bodyWatchers.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  geometry = installLayoutFake(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each([
  ["phone", phone],
  ["desktop", desktop],
])("%s reader, reopened", (_name, reader) => {
  it("lands on the saved place", () => {
    open(reader());
    expect(topOfPage()).toEqual({ at: 20, off: 0.3 });
  });

  it("stays there when the reading font arrives and the text grows", () => {
    open(reader());
    reflow(1.32);
    expect(topOfPage()).toEqual({ at: 20, off: 0.3 });
  });

  it("lets go once the reader touches the page", () => {
    open(reader());
    act(() => {
      readingSurface(host).dispatchEvent(
        new Event("pointerdown", { bubbles: true }),
      );
    });
    const before = readingSurface(host).scrollTop;
    reflow(1.32);
    expect(readingSurface(host).scrollTop).toBe(before);
  });

  it("lets go once the reader touches anywhere, not only the page", () => {
    // A swipe that starts on the floating bars never touches the scroller:
    // the reader's touch fallback scrolls it from outside.
    open(reader());
    act(() => {
      document.body.dispatchEvent(new Event("touchstart", { bubbles: true }));
      readingSurface(host).scrollTop += 600;
      readingSurface(host).dispatchEvent(new Event("scroll"));
    });
    const before = readingSurface(host).scrollTop;
    reflow(1.32);
    expect(readingSurface(host).scrollTop).toBe(before);
  });

  it("keeps holding through a scroll nobody asked for", () => {
    // Chromium's scroll anchoring nudges scrollTop as the text grows — on the
    // A73 by 18px of the hundreds needed. Taking that for the reader
    // scrolling let go of the hold just before the real correction.
    open(reader());
    act(() => {
      readingSurface(host).scrollTop += 18;
      readingSurface(host).dispatchEvent(new Event("scroll"));
    });
    reflow(1.32);
    expect(topOfPage()).toEqual({ at: 20, off: 0.3 });
  });
});
