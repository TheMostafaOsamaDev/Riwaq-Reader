// Shared fixtures for reader position/progress tests in happy-dom: a layout
// fake (happy-dom does no layout at all) and MobileReader rendered with no-op
// callbacks, so a test passes only the props it is about. The book comes from
// desktopReaderTestHarness's makeBook. Each test file still mocks
// `@tauri-apps/api/core` itself (vi.mock is hoisted per file).

import type { ComponentProps } from "react";
import { vi } from "vitest";
import type { EpubBook } from "../epub/types";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import { I18nProvider } from "../i18n/I18nProvider";
import { THEMES } from "../styles/tokens";
import { MobileReader } from "./MobileReader";

/** The fake's geometry: paragraphs 100px tall stacked under a 200px lead, in
 *  an 800px viewport. A 40-paragraph chapter's text ends at 4200px, so its
 *  last line is on screen from scrollTop 3400. */
export const LEAD = 200;
export const PARA_H = 100;
export const VIEW_H = 800;

/** The scroller being read: the phone's is marked; the desktop's is the
 *  overflow:auto box around the book body. */
export function readingSurface(host: HTMLElement): HTMLElement {
  const marked = host.querySelector<HTMLElement>("[data-pan-scroller]");
  if (marked) return marked;
  let n = host.querySelector<HTMLElement>("[data-book-body]")?.parentElement;
  while (n && n !== host) {
    if (n.style.overflow === "auto" || n.style.overflowY === "auto") return n;
    n = n.parentElement;
  }
  throw new Error("no reading surface");
}

/** Give `host`'s reader a layout: paragraph offsets and rects that follow the
 *  scroller's scrollTop the way a browser's would. The returned geometry is
 *  read live, so a test can reflow the page (a web font arriving) by growing
 *  `paraH`. Undo with vi.restoreAllMocks(). */
export function installLayoutFake(host: HTMLElement): { paraH: number } {
  const geometry = { paraH: PARA_H };
  const paraTop = (el: HTMLElement): number | null =>
    el.dataset.pIndex === undefined
      ? null
      : LEAD + Number(el.dataset.pIndex) * geometry.paraH;
  const surface = () => {
    try {
      return readingSurface(host);
    } catch {
      return null;
    }
  };
  const proto = window.HTMLElement.prototype;
  vi.spyOn(proto, "offsetTop", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return paraTop(this) ?? 0;
  });
  vi.spyOn(proto, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.pIndex !== undefined ? geometry.paraH : 90;
  });
  vi.spyOn(proto, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this === surface() ? VIEW_H : 0;
  });
  vi.spyOn(proto, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const top = paraTop(this);
    const y = top === null ? 0 : top - (surface()?.scrollTop ?? 0);
    return new DOMRect(0, y, 400, top === null ? 800 : geometry.paraH);
  });
  return geometry;
}

type ReaderProps = ComponentProps<typeof MobileReader>;

/** MobileReader on `book`, opened at `currentChapter`, with every callback a
 *  no-op unless overridden. */
export function mobileReader({
  book,
  locale,
  currentChapter = 0,
  ...overrides
}: { book: EpubBook; locale: "ar" | "en"; currentChapter?: number } & Partial<
  Omit<ReaderProps, "book" | "currentChapter">
>) {
  return (
    <I18nProvider locale={locale}>
      <MobileReader
        theme={THEMES.sepia}
        themeKey="sepia"
        t={DEFAULT_TWEAKS}
        setTweak={() => {}}
        book={book}
        state={{
          bookId: book.id,
          currentChapter,
          paragraphIndex: 0,
          highlights: [],
        }}
        currentChapter={currentChapter}
        resumeParagraph={0}
        resumeOffset={0}
        jumpNonce={0}
        onChapterChange={() => {}}
        onParagraphChange={() => {}}
        onCreateHighlight={() => {}}
        onDeleteHighlight={() => {}}
        onUpdateHighlightNote={() => {}}
        onJumpToHighlight={() => {}}
        onBack={() => {}}
        {...overrides}
      />
    </I18nProvider>
  );
}
