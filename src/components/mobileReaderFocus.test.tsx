// @vitest-environment happy-dom
//
// What the phone reader shows once its chrome is tapped away.
//
// Hiding the chrome takes the header with it, and the header is where the
// chapter rail lives — so focus mode had no progress indicator of any kind.
// It also inherited the app-wide overlay scrollbar, which drew a thumb down
// the right edge of the page while scrolling: a second, redundant progress
// indicator, and furniture in a mode whose whole point is removing it.
//
// So: the reading surface opts out of the overlay scrollbar, and a rail is
// pinned to the top of the viewport whenever the chrome is away, tracking the
// same chapter fraction the header rail does.
//
// happy-dom has no layout engine, so these assert the declared geometry and
// the structure rather than measured pixels. Real measured alignment is
// checked in a WKWebView.

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
  chapters: [0, 1, 2].map((i) => ({
    id: `c${i}`,
    href: `c${i}.xhtml`,
    title: `الفصل ${i + 1}`,
    order: i,
    paragraphs: Array.from({ length: 12 }, (_, n) => ({
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

/** Mount a fresh reader into `host`. Called per test, and again by the case
 *  that needs the hint's flag to survive a remount. */
function mount() {
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
}

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  mount();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** The reading surface — the element a tap toggles the chrome on. */
function surface(): HTMLElement {
  const el = host.querySelector<HTMLElement>(".no-scrollbar");
  if (!el) throw new Error("reading surface not found");
  return el;
}

/** Tap the page, which is how this reader enters and leaves focus mode. */
function tapPage() {
  act(() => {
    surface().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** The rail pinned to the viewport top — present only in focus mode. */
function focusRail(): HTMLElement | null {
  return host.querySelector<HTMLElement>(".riwaq-focus-rail");
}

function hint(): HTMLElement | null {
  return host.querySelector<HTMLElement>(".riwaq-focus-hint");
}

describe("the phone reading surface", () => {
  it("opts out of the app's overlay scrollbar", () => {
    // `no-scrollbar` only suppresses the NATIVE bar; the app draws its own
    // floating thumb over every scroller that has not opted out.
    expect(surface().hasAttribute("data-no-overlay-scrollbar")).toBe(true);
  });
});

describe("focus mode", () => {
  it("shows no top rail while the chrome is up", () => {
    // The header carries the rail in that state; a second one would be a
    // duplicate sitting directly above it.
    expect(focusRail()).toBeNull();
  });

  it("pins a rail to the top of the viewport once the chrome is away", () => {
    tapPage();
    const rail = focusRail();
    expect(rail).not.toBeNull();
    expect(rail?.style.position).toBe("fixed");
    expect(rail?.style.top).toBe("0px");
  });

  it("takes the rail away again when the chrome comes back", () => {
    tapPage();
    expect(focusRail()).not.toBeNull();
    tapPage();
    expect(focusRail()).toBeNull();
  });

  it("arrives carrying a width rather than filling in on the next scroll", () => {
    tapPage();
    // Entering focus mode is a tap, not a scroll, so nothing repaints the
    // rail afterwards — it has to mount at the fraction already reached.
    const fill = focusRail()?.firstElementChild?.firstElementChild as
      | HTMLElement
      | undefined;
    expect(fill).toBeTruthy();
    expect(fill?.style.width).not.toBe("");
  });
});

describe("the first trip into focus mode", () => {
  it("explains how to get back out", () => {
    tapPage();
    expect(hint()).not.toBeNull();
  });

  it("takes the explanation away with the chrome's return", () => {
    tapPage();
    tapPage();
    expect(hint()).toBeNull();
  });

  it("does not explain it a second time", () => {
    tapPage();
    tapPage();
    tapPage();
    expect(hint()).toBeNull();
  });

  it("stays quiet on a later install-lifetime visit", () => {
    // The flag outlives the component, so a reader who has seen it once never
    // sees it again — not on the next book, not after a relaunch.
    tapPage();
    expect(hint()).not.toBeNull();
    act(() => root.unmount());
    mount();
    tapPage();
    expect(hint()).toBeNull();
  });
});
