// @vitest-environment happy-dom
//
// Leaving the reader must not lose where it was.
//
// A scroll reached disk through two timers: the reader's 250ms throttle, then
// App's 600ms debounce. Back out of the book, or have Android background the
// app, inside that window and the position never arrived — measured in the
// scroll lab: leaving 150, 400 and 700ms after a scroll all reopened at the
// old place. The reader now reports once more on the way out, marked final,
// and the throttle can no longer fire after the reader is gone (it used to
// measure the detached tree, where the LAST paragraph wins).

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeBook } from "./desktopReaderTestHarness";
import {
  installLayoutFake,
  LEAD,
  mobileReader,
  PARA_H,
  readingSurface,
} from "./mobileReaderTestHarness";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

type Report = {
  idx: number;
  off: number | undefined;
  final: boolean;
  chapterFraction?: number;
};

let host: HTMLDivElement;
let root: Root;
let reports: Report[];

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  reports = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  installLayoutFake(host);
  root = createRoot(host);
  act(() => {
    root.render(
      mobileReader({
        book: makeBook("ar", 1, 40),
        locale: "ar",
        resumeParagraph: 5,
        onParagraphChange: (idx, off, report) =>
          reports.push({
            idx,
            off,
            final: report?.final === true,
            chapterFraction: report?.chapterFraction,
          }),
      }),
    );
  });
  // Let the landing's own report go by, so each test starts from quiet.
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  reports = [];
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setVisibility("visible");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Scroll to paragraph 20, 30% of the way in, the way a finger would. */
function scrollToTwenty() {
  act(() => {
    readingSurface(host).scrollTop = LEAD + 20 * PARA_H + 30;
    readingSurface(host).dispatchEvent(new Event("scroll"));
  });
}

describe("MobileReader on the way out", () => {
  it("reports where the reader was when the book closes inside the throttle", () => {
    scrollToTwenty();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => root.unmount());
    root = createRoot(host); // for afterEach

    expect(reports).toContainEqual(
      expect.objectContaining({ idx: 20, off: 0.3, final: true }),
    );
  });

  it("reports at once, final, when the app is backgrounded", () => {
    scrollToTwenty();
    act(() => setVisibility("hidden"));

    expect(reports).toEqual([
      expect.objectContaining({ idx: 20, off: 0.3, final: true }),
    ]);
  });

  it("never reports from the throttle after the reader has gone", () => {
    scrollToTwenty();
    act(() => root.unmount());
    root = createRoot(host);
    const atUnmount = reports.length;
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(reports).toHaveLength(atUnmount);
    expect(reports.every((r) => r.final)).toBe(true);
  });

  it("reports how much of the chapter's text has been read", () => {
    // The text ends at 4200px; in the 800px viewport its last line is on
    // screen from scrollTop 3400. The end card below the text does not count.
    scrollToTwenty();
    act(() => setVisibility("hidden"));
    expect(reports[0].chapterFraction).toBeCloseTo(2230 / 3400, 6);

    act(() => {
      readingSurface(host).scrollTop = 3400;
      readingSurface(host).dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(300);
    });
    expect(reports[reports.length - 1].chapterFraction).toBe(1);
  });
});
