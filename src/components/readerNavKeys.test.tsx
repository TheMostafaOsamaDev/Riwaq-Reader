// @vitest-environment happy-dom
//
// A chorded arrow is never a chapter turn. Alt+←/→ is app back/forward, and
// one press must not both leave the reader and turn a chapter; ⌘/Ctrl+←/→
// are system shortcuts.
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
  title: "Book",
  author: "Author",
  language: "en",
  chapters: [0, 1, 2].map((i) => ({
    id: `c${i}`,
    href: `c${i}.xhtml`,
    title: `Chapter ${i + 1}`,
    order: i,
    paragraphs: Array.from({ length: 10 }, (_, n) => ({
      text: `Paragraph ${n} of chapter ${i + 1}.`,
    })),
  })),
};

const STATE: BookState = {
  bookId: "b1",
  currentChapter: 1,
  paragraphIndex: 0,
  highlights: [],
};

const onChapterChange = vi.fn();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  onChapterChange.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <I18nProvider locale="en">
        <DesktopReader
          theme={THEMES.sepia}
          themeKey="sepia"
          t={{ ...DEFAULT_TWEAKS, readingMode: "scroll" }}
          setTweak={() => {}}
          book={BOOK}
          state={STATE}
          currentChapter={1}
          resumeParagraph={0}
          jumpNonce={0}
          onChapterChange={onChapterChange}
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

function press(init: KeyboardEventInit) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

describe("DesktopReader arrow keys", () => {
  it("plain arrows still change chapter (control for the case below)", () => {
    press({ key: "ArrowRight" });
    press({ key: "ArrowLeft" });
    expect(onChapterChange).toHaveBeenCalledTimes(2);
  });

  it.each(["altKey", "metaKey", "ctrlKey"] as const)(
    "%s + arrow does not change chapter",
    (mod) => {
      press({ key: "ArrowRight", [mod]: true });
      press({ key: "ArrowLeft", [mod]: true });
      expect(onChapterChange).not.toHaveBeenCalled();
    },
  );
});
