// @vitest-environment happy-dom
//
// The text colour reaches the page on both readers. Static markup is enough:
// what matters is the colour the book's text is declared in, not anything an
// effect does afterwards.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EpubBook } from "../epub/types";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import { I18nProvider } from "../i18n/I18nProvider";
import type { BookState } from "../store/library";
import { DEFAULT_TEXT_COLORS, THEMES } from "../styles/tokens";
import type { Tweaks } from "../types/reader";
import { DesktopReader } from "./DesktopReader";
import { MobileReader } from "./MobileReader";

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
    paragraphs: [{ text: `فقرة من الفصل ${i + 1}.` }],
  })),
};

const STATE: BookState = {
  bookId: "b1",
  currentChapter: 0,
  paragraphIndex: 0,
  highlights: [],
};

const common = {
  theme: THEMES.sepia,
  themeKey: "sepia" as const,
  setTweak: () => {},
  book: BOOK,
  state: STATE,
  currentChapter: 0,
  resumeParagraph: 0,
  jumpNonce: 0,
  onChapterChange: () => {},
  onParagraphChange: () => {},
  onCreateHighlight: () => {},
  onDeleteHighlight: () => {},
  onUpdateHighlightNote: () => {},
  onJumpToHighlight: () => {},
  onBack: () => {},
};

const mobileMarkup = (t: Tweaks) =>
  renderToStaticMarkup(
    <I18nProvider locale="ar">
      <MobileReader {...common} t={t} />
    </I18nProvider>,
  );

const desktopMarkup = (t: Tweaks) =>
  renderToStaticMarkup(
    <I18nProvider locale="ar">
      <DesktopReader
        {...common}
        t={{ ...t, readingMode: "scroll" }}
        activePanel={null}
        setActivePanel={() => {}}
      />
    </I18nProvider>,
  );

const olive: Tweaks = {
  ...DEFAULT_TWEAKS,
  textColor: { ...DEFAULT_TEXT_COLORS, sepia: "olive" },
};

describe("book text color", () => {
  it("the phone reader draws the book in the chosen color", () => {
    expect(mobileMarkup(olive)).toContain("color:#3d4a2a");
    expect(mobileMarkup(DEFAULT_TWEAKS)).not.toContain("#3d4a2a");
  });

  it("the desktop reader draws the book in the chosen color", () => {
    expect(desktopMarkup(olive)).toContain("color:#3d4a2a");
    expect(desktopMarkup(DEFAULT_TWEAKS)).not.toContain("#3d4a2a");
  });
});
