// @vitest-environment happy-dom
//
// What the readers say about progress, read off the rendered bars.
//
// The footer used `chapter / (count - 1)`: chapter 1 read 0% and the last
// chapter read 100% the moment it opened, while the library card said
// `(chapter + 1) / count`. And the header rail measured the whole scroller,
// end card and padding included, so a chapter's last line on screen did not
// read as the end of it. Both now come from reader/bookProgress.ts.
//
// The layout fake (mobileReaderTestHarness): a 40-paragraph chapter's last
// line is on screen from scrollTop 3400.

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

const BOOK = makeBook("en", 10, 40);

let host: HTMLDivElement;
let root: Root;

/** The header's chapter rail: a 2px track whose child is the fill. */
function headerFill(): string {
  for (const el of host.querySelectorAll<HTMLElement>("div[aria-hidden]")) {
    if (
      el.style.height === "2px" &&
      el.firstElementChild instanceof HTMLElement
    )
      return el.firstElementChild.style.width;
  }
  throw new Error("no header rail");
}

function show(reader: ReactElement) {
  act(() => root.render(reader));
}

const phone = (chapter: number) =>
  mobileReader({ book: BOOK, locale: "en", currentChapter: chapter });
const desktop = (chapter: number) =>
  desktopReader({ book: BOOK, locale: "en", currentChapter: chapter });

function scrollTo(top: number) {
  act(() => {
    readingSurface(host).scrollTop = top;
    readingSurface(host).dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(300);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) =>
    setTimeout(() => fn(performance.now()), 0),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  installLayoutFake(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("phone reader progress", () => {
  it("reads 0% at the start of the first chapter", () => {
    show(phone(0));
    expect(host.textContent).toContain("0%");
    expect(host.textContent).not.toContain("10%");
  });

  it("does not read 100% the moment the last chapter opens", () => {
    show(phone(9));
    expect(host.textContent).toContain("90%");
    expect(host.textContent).not.toContain("100%");
  });

  it("counts how far into the chapter the reader is", () => {
    show(phone(4));
    scrollTo(1700); // half of the 3400px it takes to bring the last line in
    expect(host.textContent).toContain("45%");
  });

  it("reads 100% once the last chapter's last line is on screen", () => {
    show(phone(9));
    scrollTo(3400);
    expect(host.textContent).toContain("100%");
  });

  it("fills the header rail when the last line arrives, not after the end card", () => {
    show(phone(3));
    scrollTo(3400);
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(headerFill()).toBe("100%");
  });
});

describe("desktop reader progress", () => {
  it("does not read 100% the moment the last chapter opens", () => {
    show(desktop(9));
    expect(host.textContent).toContain("90%");
    expect(host.textContent).not.toContain("100%");
  });

  it("counts how far into the chapter the reader is", () => {
    show(desktop(4));
    scrollTo(1700);
    expect(host.textContent).toContain("45%");
  });
});
