// @vitest-environment happy-dom
//
// The desktop reading surface leaves wheel scrolling to the browser.
//
// It used to take it over: a non-passive `wheel` listener called
// `preventDefault` and then re-animated `scrollTop` itself, 22% of the
// remaining gap per frame plus twelve idle frames. Measured in WebKit against
// the browser's own scrolling, that cost double the input latency and about
// twenty-one extra frames of drift after the wheel had stopped — and it
// travelled the same distance.
//
// It was doing that to come to rest on a whole line, and it did not even
// manage that. Resting position measured 11.6px from the nearest real line
// against 4.1px for doing nothing, because the target grid is computed from
// `scrollTop 0` while paragraph margins (1.1em) are not a multiple of the line
// box (1.6em), so real lines walk off the grid from the second paragraph on.
//
// Cancelling the browser's scroll is the thing to guard against here: that is
// what moves scrolling off the compositor and onto the main thread, and it is
// invisible in a screenshot.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpubBook } from "../epub/types";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import { I18nProvider } from "../i18n/I18nProvider";
import type { BookState } from "../store/library";
import { THEMES } from "../styles/tokens";
import { DesktopReader } from "./DesktopReader";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

const BOOK: EpubBook = {
  id: "b1",
  title: "كتاب",
  author: "مؤلف",
  language: "ar",
  chapters: [0, 1].map((i) => ({
    id: `c${i}`,
    href: `c${i}.xhtml`,
    title: `الفصل ${i + 1}`,
    order: i,
    paragraphs: Array.from({ length: 30 }, (_, n) => ({
      text: `فقرة رقم ${n} من الفصل ${i + 1}.`,
    })),
  })),
};

const STATE: BookState = {
  bookId: "b1",
  currentChapter: 0,
  paragraphIndex: 0,
  highlights: [],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <I18nProvider locale="ar">
        <DesktopReader
          theme={THEMES.sepia}
          themeKey="sepia"
          t={{ ...DEFAULT_TWEAKS, readingMode: "scroll" }}
          setTweak={() => {}}
          book={BOOK}
          state={STATE}
          currentChapter={0}
          resumeParagraph={0}
          jumpNonce={0}
          onChapterChange={() => {}}
          onParagraphChange={() => {}}
          onCreateHighlight={() => {}}
          onDeleteHighlight={() => {}}
          onUpdateHighlightNote={() => {}}
          onJumpToHighlight={() => {}}
          activePanel={null}
          setActivePanel={() => {}}
          onBack={() => {}}
        />
      </I18nProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Every scrollable surface the reader mounts. */
function scrollers(): HTMLElement[] {
  return (Array.from(host.querySelectorAll("*")) as HTMLElement[]).filter(
    (el) => {
      const o = el.style.overflowY || el.style.overflow;
      return o === "auto" || o === "scroll";
    },
  );
}

describe("the desktop reading surface in scroll mode", () => {
  it("mounts something scrollable to aim at", () => {
    // Guards the case below from passing because nothing was found.
    expect(scrollers().length).toBeGreaterThan(0);
  });

  it("lets the browser handle the wheel instead of cancelling it", () => {
    for (const el of scrollers()) {
      const e = new WheelEvent("wheel", {
        deltaY: 120,
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(e);
      expect(
        e.defaultPrevented,
        "a cancelled wheel event moves scrolling onto the main thread",
      ).toBe(false);
    }
  });
});
