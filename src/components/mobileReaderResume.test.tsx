// @vitest-environment happy-dom
//
// Reopening a book on the phone must land exactly where it was left — and,
// since landing there is itself a scroll the reader saves, landing must save
// back the same place. If the two disagree by any amount the error compounds:
// every reopen moves by it again and saves the result.
//
// That is how it broke. The resume subtracted the top bar's height (+8px) from
// the saved scrollTop, a leftover from before the scroller's own top padding
// cleared the bar. The save never added it back, so each reopen landed ~a bar
// higher than the last — "it shifts a little, and more every time".
//
// happy-dom does no layout, so the paragraphs are given one: each is 100px
// tall, stacked under a 200px lead, and the top bar is 90px. Rects follow the
// scroller's scrollTop the way a browser's would.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpubBook } from "../epub/types";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import { I18nProvider } from "../i18n/I18nProvider";
import type { BookState } from "../store/library";
import { THEMES } from "../styles/tokens";
import { MobileReader } from "./MobileReader";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

const LEAD = 200;
const PARA_H = 100;
const BAR_H = 90;

const BOOK: EpubBook = {
  id: "b1",
  title: "كتاب",
  author: "مؤلف",
  language: "ar",
  chapters: [
    {
      id: "c0",
      href: "c0.xhtml",
      title: "الفصل",
      order: 0,
      paragraphs: Array.from({ length: 40 }, (_, i) => ({
        text: `فقرة ${i + 1}.`,
      })),
    },
  ],
};
const STATE: BookState = {
  bookId: "b1",
  currentChapter: 0,
  paragraphIndex: 0,
  highlights: [],
};

let host: HTMLDivElement;
let root: Root;

function scroller(): HTMLElement {
  const el = host.querySelector<HTMLElement>("[data-pan-scroller]");
  if (!el) throw new Error("no scroller");
  return el;
}

function paraTop(el: HTMLElement): number | null {
  const idx = el.dataset.pIndex;
  return idx === undefined ? null : LEAD + Number(idx) * PARA_H;
}

beforeEach(() => {
  vi.useFakeTimers();
  const proto = window.HTMLElement.prototype;
  vi.spyOn(proto, "offsetTop", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return paraTop(this) ?? 0;
  });
  vi.spyOn(proto, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.dataset.pIndex !== undefined) return PARA_H;
    // Anything else with height that the reader asks about is the top bar.
    return BAR_H;
  });
  vi.spyOn(proto, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = paraTop(this);
    const scrolled = host.querySelector<HTMLElement>("[data-pan-scroller]");
    const y = top === null ? 0 : top - (scrolled?.scrollTop ?? 0);
    return new DOMRect(0, y, 400, top === null ? 800 : PARA_H);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Open the book at a saved place; return the scrollTop it landed on and the
 *  place it saved back once the landing's scroll had been read. */
function open(paragraph: number, offset: number) {
  const saves: [number, number | undefined][] = [];
  act(() => {
    root.render(
      <I18nProvider locale="ar">
        <MobileReader
          theme={THEMES.sepia}
          themeKey="sepia"
          t={DEFAULT_TWEAKS}
          setTweak={() => {}}
          book={BOOK}
          state={STATE}
          currentChapter={0}
          resumeParagraph={paragraph}
          resumeOffset={offset}
          jumpNonce={0}
          onChapterChange={() => {}}
          onParagraphChange={(i, o) => saves.push([i, o])}
          onCreateHighlight={() => {}}
          onDeleteHighlight={() => {}}
          onUpdateHighlightNote={() => {}}
          onJumpToHighlight={() => {}}
          onBack={() => {}}
        />
      </I18nProvider>,
    );
  });
  act(() => {
    vi.advanceTimersByTime(100);
  });
  const landed = scroller().scrollTop;
  act(() => {
    scroller().dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(300);
  });
  return { landed, saved: saves[saves.length - 1] };
}

describe("resuming the phone reader", () => {
  it("lands on the saved paragraph and offset, bars up", () => {
    const { landed } = open(12, 0.3);
    expect(landed).toBe(LEAD + 12 * PARA_H + 0.3 * PARA_H);
  });

  it("saves back exactly the place it resumed at", () => {
    const { saved } = open(12, 0.3);
    expect(saved?.[0]).toBe(12);
    expect(saved?.[1]).toBeCloseTo(0.3, 6);
  });

  it("does not drift over repeated reopens", () => {
    let place: [number, number] = [12, 0.3];
    for (let i = 0; i < 5; i++) {
      act(() => root.unmount());
      root = createRoot(host);
      const { saved } = open(place[0], place[1]);
      place = [saved?.[0] ?? -1, saved?.[1] ?? -1];
    }
    expect(place[0]).toBe(12);
    expect(place[1]).toBeCloseTo(0.3, 6);
  });
});
