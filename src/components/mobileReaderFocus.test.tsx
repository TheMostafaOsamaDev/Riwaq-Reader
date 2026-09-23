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

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpubBook } from "../epub/types";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import { ar } from "../i18n/ar";
import { I18nProvider } from "../i18n/I18nProvider";
import type { BookState } from "../store/library";
import { GLASS_CLASS } from "../reader/chrome/glass";
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
/** Chapters the reader asked to move to, oldest first. */
let moves: number[] = [];

/** A LIVE reader: `onChapterChange` really moves it, so a tap on an in-page
 *  control re-renders the page the way the app does rather than leaving it
 *  frozen on chapter 0. The chapter-turn cases depend on that — a turn that
 *  never happens cannot show what the turn does to the chrome. */
function Harness({ start }: { start: number }) {
  const [chapter, setChapter] = useState(start);
  return (
    <I18nProvider locale="ar">
      <MobileReader
        theme={THEMES.sepia}
        themeKey="sepia"
        t={DEFAULT_TWEAKS}
        setTweak={() => {}}
        book={BOOK}
        state={{ ...STATE, currentChapter: chapter }}
        currentChapter={chapter}
        resumeParagraph={0}
        jumpNonce={0}
        onChapterChange={(next) => {
          moves.push(next);
          setChapter(next);
        }}
        onParagraphChange={() => {}}
        onCreateHighlight={() => {}}
        onDeleteHighlight={() => {}}
        onUpdateHighlightNote={() => {}}
        onJumpToHighlight={() => {}}
        onBack={() => {}}
      />
    </I18nProvider>
  );
}

/** Mount a fresh reader into `host`, opened on chapter `start`. Called per
 *  test, and again by the cases that need a different chapter or need the
 *  hint's flag to survive a remount. */
function mount(start = 0) {
  root = createRoot(host);
  act(() => {
    root.render(<Harness start={start} />);
  });
}

beforeEach(() => {
  localStorage.clear();
  moves = [];
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

/** True while the header and the bottom bar are both gone — i.e. focus mode.
 *  Read off the bars rather than off the rail: the rail is a consequence of
 *  the same flag, but the bars are the thing the reader watches leave.
 *
 *  The count is asserted because `every` on an empty list is `true` — a
 *  selector that stopped matching would otherwise report permanent focus
 *  mode and every case below would pass on nothing. */
function chromeIsAway(): boolean {
  const bars = [
    ...host.querySelectorAll<HTMLElement>(`.${GLASS_CLASS}[aria-hidden]`),
  ];
  if (bars.length !== 2)
    throw new Error(`expected 2 chrome bars, saw ${bars.length}`);
  return bars.every((bar) => bar.getAttribute("aria-hidden") === "true");
}

/** Re-open the reader in the MIDDLE of the book — the only place where both
 *  the way back and the way forward are on the page at once. */
function openMidBook() {
  act(() => root.unmount());
  mount(1);
}

/** Tap an in-page control the way a thumb does: on the label inside it, not
 *  on the button box. A tap that landed on the button itself would miss the
 *  bug entirely — what bubbles to the page is the same either way, but only
 *  the inner node proves the fix looks past the node actually hit. */
function tapControl(label: string) {
  const el = [...host.querySelectorAll<HTMLElement>("button")].find((b) =>
    (b.getAttribute("aria-label") ?? b.textContent ?? "").startsWith(label),
  );
  if (!el) throw new Error(`no control named ${label}`);
  const inner = el.querySelector("span") ?? el;
  act(() => {
    inner.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
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

// A tap on the page toggles the chrome, and the two chapter controls live ON
// the page — so their tap bubbled to the same handler and turned the chrome
// back on. Reported from a phone: enter focus mode, tap through to the next
// chapter, and the header and bottom bar are back. The one control meant to
// keep you reading was the one that threw you out of the reading mode.
describe("the in-page chapter controls, in focus mode", () => {
  beforeEach(openMidBook);

  it("turns forward without bringing the chrome back", () => {
    tapPage();
    expect(chromeIsAway()).toBe(true);
    tapControl(ar["reader.nextChapter"]);
    expect(moves).toEqual([2]);
    expect(chromeIsAway()).toBe(true);
    expect(focusRail()).not.toBeNull();
  });

  it("turns back without bringing the chrome back", () => {
    tapPage();
    tapControl(ar["reader.prevChapter"]);
    expect(moves).toEqual([0]);
    expect(chromeIsAway()).toBe(true);
  });

  it("keeps the chrome away for the foot's marginal links too", () => {
    // Same block, same bubble. Opening the contents or going back to the top
    // of the chapter are moves made INSIDE focus mode; neither is a request
    // to leave it.
    tapPage();
    tapControl(ar["reader.topOfChapter"]);
    expect(chromeIsAway()).toBe(true);
    tapControl(ar["reader.toc"]);
    expect(chromeIsAway()).toBe(true);
  });

  it("still lets a tap on the page itself work the chrome", () => {
    // The guard has to be narrow: the paper around the controls is still the
    // toggle, and so is the text.
    tapPage();
    expect(chromeIsAway()).toBe(true);
    tapPage();
    expect(chromeIsAway()).toBe(false);
  });
});
