// @vitest-environment happy-dom
//
// A layout flip (fold/unfold, split-screen, a desktop window dragged under
// 720px) mounts MobileReader while the DesktopReader it replaces is still in
// the DOM — AnimatedSwap crossfades the two, and the outgoing one comes first
// in document order. MobileReader wired its long-press selection to the first
// `[data-book-body]` in the DOCUMENT, which was the outgoing reader's, removed
// 240ms later. Its own text has native selection off, so after the flip
// nothing could be highlighted until the book was reopened.
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
      paragraphs: [{ text: "فقرة أولى." }, { text: "فقرة ثانية." }],
    },
  ],
};
const STATE: BookState = {
  bookId: "b1",
  currentChapter: 0,
  paragraphIndex: 0,
  highlights: [],
};

let outgoing: HTMLDivElement;
let host: HTMLDivElement;
let root: Root;
let pointerdownTargets: EventTarget[];

beforeEach(() => {
  pointerdownTargets = [];
  // On HTMLElement, not the global EventTarget: under happy-dom that one is
  // Node's, and a spy on it sees nothing. The spy shadows the inherited method.
  const proto = window.HTMLElement.prototype;
  const realAdd = proto.addEventListener;
  vi.spyOn(proto, "addEventListener").mockImplementation(function (
    this: HTMLElement,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (type === "pointerdown") pointerdownTargets.push(this);
    return realAdd.call(this, type, listener, options);
  });
  // The reader being swapped out, still on screen during the crossfade.
  outgoing = document.createElement("div");
  outgoing.setAttribute("data-book-body", "");
  document.body.appendChild(outgoing);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
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
          resumeParagraph={0}
          jumpNonce={0}
          onChapterChange={() => {}}
          onParagraphChange={() => {}}
          onCreateHighlight={() => {}}
          onDeleteHighlight={() => {}}
          onUpdateHighlightNote={() => {}}
          onJumpToHighlight={() => {}}
          onBack={() => {}}
        />
      </I18nProvider>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  outgoing.remove();
  vi.restoreAllMocks();
});

describe("MobileReader mounted beside the reader it replaces", () => {
  it("wires long-press selection to its own text, not the outgoing reader's", () => {
    const own = host.querySelector("[data-book-body]");
    expect(own).not.toBeNull();
    // The spy itself works: React's root listener is on the container.
    expect(pointerdownTargets).toContain(host);
    expect(pointerdownTargets).toContain(own);
    expect(pointerdownTargets).not.toContain(outgoing);
  });
});
