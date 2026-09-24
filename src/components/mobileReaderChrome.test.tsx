// @vitest-environment happy-dom
//
// The phone reader's top bar overlays the scroller instead of displacing it,
// so the scroller's top inset is the only thing holding the first line out
// from under the glass. Grow the bar without growing the inset and the
// previous-chapter link goes back under it — which is how it was lost once
// already, measured at a 98px bar over a capsule spanning 44–85px.
//
// These lock the two together by asserting the DECLARED geometry and the
// arithmetic between the two declarations — which is where the drift happens.
//
// Read out of React's own server-rendered markup rather than off a mounted
// node: happy-dom's CSS parser rejects `env()` outright and drops the whole
// `padding` declaration, so `el.style.padding` comes back EMPTY for both bars.
// A test reading that would pass against any value at all, including none.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EpubBook } from "../epub/types";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import { I18nProvider } from "../i18n/I18nProvider";
import type { BookState } from "../store/library";
import { THEMES } from "../styles/tokens";
import {
  CHROME_AIR_TOP,
  CHROME_CLEARANCE,
  CHROME_CONTENT_H,
  MobileReader,
  READING_INSET_TOP,
} from "./MobileReader";

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

/** The reader's markup, rendered once. Static rendering runs no effects and
 *  needs no DOM — all this case cares about is what React declares. */
const MARKUP = renderToStaticMarkup(
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

/** Every `style="…"` in the markup that declares a padding. */
function styles(): string[] {
  return [...MARKUP.matchAll(/style="([^"]*)"/g)].map((m) =>
    m[1].replace(/&quot;/g, '"').replace(/&#x27;/g, "'"),
  );
}

/** The px a declaration adds on top of `env(safe-area-inset-top, 12px)`. */
function airOverSafeArea(decl: string): number | null {
  const m = decl.match(
    /padding:\s*calc\(env\(safe-area-inset-top,\s*12px\)\s*\+\s*(\d+(?:\.\d+)?)px\)/,
  );
  return m ? Number(m[1]) : null;
}

/** Everything in the tree whose padding is measured off the safe-area inset.
 *  The phone reader has exactly two: the top bar and the page under it. */
function safeAreaPaddings(): number[] {
  return styles()
    .map(airOverSafeArea)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
}

describe("the phone reader's top bar and the page under it", () => {
  it("measures both the bar and the page off the safe-area inset", () => {
    // A bar that carried env() and a page that did not would agree on the
    // emulator, where env() resolves to 0, and be a whole bar out on a phone
    // with a status bar. There are exactly two such boxes, and this is also
    // the guard that the regexes above still match anything at all — without
    // it, every number below would be read from an empty list.
    expect(safeAreaPaddings()).toHaveLength(2);
  });

  it("pads the bar over the status bar, not merely to it", () => {
    // env() alone leaves the title sitting directly on the status bar; the
    // air is what separates the two.
    const [bar] = safeAreaPaddings();
    expect(bar).toBe(CHROME_AIR_TOP);
    expect(bar).toBeGreaterThan(0);
  });

  it("reserves the bar's whole height, plus clearance, on the page", () => {
    const [, page] = safeAreaPaddings();
    expect(page).toBe(READING_INSET_TOP);
  });

  it("keeps the page's inset derived from the bar rather than guessed", () => {
    // THE invariant, and the reason the constants exist. Both numbers come
    // back out of the markup, so a literal written into either declaration
    // fails here even while the constants still agree with each other.
    const [bar, page] = safeAreaPaddings();
    expect(page - bar).toBe(CHROME_CONTENT_H + CHROME_CLEARANCE);
  });

  it("leaves a real gap between the glass and the first line", () => {
    // Not merely "clears it" — a line tucked against the bar reads as a
    // rendering fault rather than as a margin.
    expect(CHROME_CLEARANCE).toBeGreaterThan(0);
  });
});
