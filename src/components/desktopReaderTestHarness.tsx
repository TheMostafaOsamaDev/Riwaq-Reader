// Shared fixtures for DesktopReader tests in happy-dom: an in-memory book
// and the reader rendered with no-op callbacks, so a test passes only the
// props it is about. Each test file still mocks `@tauri-apps/api/core` itself
// (vi.mock is hoisted per file).

import type { ComponentProps } from "react";
import type { EpubBook } from "../epub/types";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import { I18nProvider } from "../i18n/I18nProvider";
import { THEMES } from "../styles/tokens";
import { DesktopReader } from "./DesktopReader";

/** A text-only book: `chapters` chapters of `paragraphs` paragraphs each. */
export function makeBook(
  language: "ar" | "en",
  chapters: number,
  paragraphs: number,
): EpubBook {
  const ar = language === "ar";
  return {
    id: "b1",
    title: ar ? "كتاب" : "Book",
    author: ar ? "مؤلف" : "Author",
    language,
    chapters: Array.from({ length: chapters }, (_, i) => ({
      id: `c${i}`,
      href: `c${i}.xhtml`,
      title: ar ? `الفصل ${i + 1}` : `Chapter ${i + 1}`,
      order: i,
      paragraphs: Array.from({ length: paragraphs }, (_, n) => ({
        text: ar
          ? `فقرة رقم ${n} من الفصل ${i + 1}.`
          : `Paragraph ${n} of chapter ${i + 1}.`,
      })),
    })),
  };
}

type ReaderProps = ComponentProps<typeof DesktopReader>;

/** DesktopReader in scroll mode on `book`, opened at `currentChapter`, with
 *  every callback a no-op unless overridden. */
export function desktopReader({
  book,
  locale,
  currentChapter = 0,
  ...overrides
}: { book: EpubBook; locale: "ar" | "en"; currentChapter?: number } & Partial<
  Omit<ReaderProps, "book" | "currentChapter">
>) {
  return (
    <I18nProvider locale={locale}>
      <DesktopReader
        theme={THEMES.sepia}
        themeKey="sepia"
        t={{ ...DEFAULT_TWEAKS, readingMode: "scroll" }}
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
        {...overrides}
      />
    </I18nProvider>
  );
}
