// @vitest-environment happy-dom
//
// The phone reader's chrome: when the top and bottom bars are there, and what
// makes them leave.
//
// Two modes share one answer. OUTSIDE focus mode the bars are a toggle — one
// tap takes them away, one tap brings them back, and a scroll takes them away
// because scrolling is what a reader does when they want the page to
// themselves. INSIDE focus mode they are pinned down: one tap does nothing,
// and it takes a double-tap (or the lock) to end the mode. That difference is
// the point of the mode — a stray tap must not drop a reader out of it.
//
// What the two share is that only a real TAP counts. The same pointer stream
// also carries scrolls and the hold that starts a highlight, and the browser
// ends all three with a click, so the gesture is measured rather than assumed.
//
// happy-dom has no layout engine, so these assert declared geometry and
// structure rather than measured pixels.

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpubBook } from "../epub/types";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import { ar } from "../i18n/ar";
import { I18nProvider } from "../i18n/I18nProvider";
import { FOCUS_TOAST_MS } from "../reader/chrome/FocusSigns";
import { GLASS_CLASS } from "../reader/chrome/glass";
import { LONG_PRESS_MS } from "../reader/chrome/pageTap";
import type { BookState, Highlight } from "../store/library";
import type { Tweaks } from "../types/reader";
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

/** A LIVE reader: the tweaks are real state, so `focusMode` behaves the way it
 *  does in the app — persisted, not reset on every render — and a chapter turn
 *  really re-renders the page. */
function Harness({
  start,
  highlights = [],
}: {
  start: number;
  highlights?: Highlight[];
}) {
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);
  const [chapter, setChapter] = useState(start);
  return (
    <I18nProvider locale="ar">
      <MobileReader
        theme={THEMES.sepia}
        themeKey="sepia"
        t={tweaks}
        setTweak={(k, v) => setTweaks((prev: Tweaks) => ({ ...prev, [k]: v }))}
        book={BOOK}
        state={{ ...STATE, currentChapter: chapter, highlights }}
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

function mount(start = 0, highlights: Highlight[] = []) {
  root = createRoot(host);
  act(() => {
    root.render(<Harness start={start} highlights={highlights} />);
  });
}

beforeEach(() => {
  localStorage.clear();
  moves = [];
  now = CLOCK_START;
  host = document.createElement("div");
  document.body.appendChild(host);
  mount();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** The reading surface. */
function surface(): HTMLElement {
  const el = host.querySelector<HTMLElement>(".no-scrollbar");
  if (!el) throw new Error("reading surface not found");
  return el;
}

/** A button, by the accessible name it carries. */
function byLabel(label: string): HTMLElement {
  const el = [...host.querySelectorAll<HTMLElement>("button")].find((b) =>
    (b.getAttribute("aria-label") ?? b.textContent ?? "").startsWith(label),
  );
  if (!el) throw new Error(`no control named ${label}`);
  return el;
}

const click = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

/** A clock for event timestamps. happy-dom stamps every event 0, which would
 *  make a flick and a long hold the same gesture.
 *
 *  It starts well past zero on purpose: React substitutes `Date.now()` for a
 *  native timeStamp it finds falsy, so a gesture beginning at 0 reaches the
 *  handler as one that began hours ago. */
const CLOCK_START = 1_000;
let now = CLOCK_START;
function stamped(type: string, x: number, y: number): MouseEvent {
  const ev = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(ev, "timeStamp", { value: now });
  return ev;
}

interface Spot {
  x: number;
  y: number;
}
const MIDDLE: Spot = { x: 180, y: 400 };

/** One gesture on an element, start to finish: the press, the time the finger
 *  spent down, where it was when it lifted, and the click the browser fires
 *  afterwards whichever of the three gestures it turned out to be. */
function gesture(
  el: Element,
  {
    from = MIDDLE,
    to = from,
    heldMs = 60,
  }: Partial<{ from: Spot; to: Spot; heldMs: number }> = {},
) {
  act(() => {
    el.dispatchEvent(stamped("pointerdown", from.x, from.y));
    now += heldMs;
    el.dispatchEvent(stamped("click", to.x, to.y));
    now += 1;
  });
}

/** One tap on the paper. */
function tapPage(spot: Spot = MIDDLE) {
  gesture(surface(), { from: spot });
}
/** Two taps in the same place, back to back — the exit gesture. */
function doubleTapPage() {
  tapPage();
  tapPage();
}
/** A press held long enough to start a selection: reaching for a highlight. */
function holdPage() {
  gesture(surface(), { heldMs: LONG_PRESS_MS + 120 });
}
/** A finger that landed and travelled: a scroll, which also ends in a click. */
function dragPage() {
  gesture(surface(), { from: MIDDLE, to: { x: MIDDLE.x, y: MIDDLE.y - 140 } });
}
/** The page moving under a finger. */
function scrollPage() {
  act(() => {
    surface().dispatchEvent(new Event("touchmove", { bubbles: true }));
  });
}

function focusRail(): HTMLElement | null {
  return host.querySelector<HTMLElement>(".riwaq-focus-rail");
}
function lock(): HTMLElement | null {
  return host.querySelector<HTMLElement>(".riwaq-focus-lock");
}
function pill(): HTMLElement | null {
  return host.querySelector<HTMLElement>(".riwaq-focus-pill");
}

/** True while the header and the bottom bar are both gone. The count is
 *  asserted because `every` on an empty list is `true`, and a selector that
 *  stopped matching would otherwise report permanent focus mode. */
function chromeIsAway(): boolean {
  const bars = [
    ...host.querySelectorAll<HTMLElement>(`.${GLASS_CLASS}[aria-hidden]`),
  ];
  if (bars.length !== 2)
    throw new Error(`expected 2 chrome bars, saw ${bars.length}`);
  return bars.every((b) => b.getAttribute("aria-hidden") === "true");
}

function enterFocus() {
  click(byLabel(ar["reader.focusMode"]));
}

describe("entering focus mode", () => {
  it("starts with the chrome up and no focus furniture", () => {
    expect(chromeIsAway()).toBe(false);
    expect(focusRail()).toBeNull();
    expect(lock()).toBeNull();
  });

  it("is a control in the header, not a tap on the page", () => {
    // A tap clears the page, which is a different thing from entering the
    // mode: nothing is locked, and the next tap puts it all back. A mode you
    // could fall into by accident is one you would leave by accident too.
    tapPage();
    expect(lock()).toBeNull();
    expect(focusRail()).not.toBeNull(); // the bars are away, so the rail is up
    tapPage();
    expect(chromeIsAway()).toBe(false);

    enterFocus();
    expect(chromeIsAway()).toBe(true);
    expect(lock()).not.toBeNull();
  });

  it("announces the mode and the way out", () => {
    enterFocus();
    const p = pill();
    expect(p).not.toBeNull();
    expect(p?.textContent).toContain(ar["reader.focusMode"]);
    expect(p?.textContent).toContain(ar["reader.focusExitHint"]);
  });

  it("puts the rail and the lock on screen", () => {
    enterFocus();
    expect(focusRail()).not.toBeNull();
    expect(lock()).not.toBeNull();
  });
});

describe("leaving focus mode", () => {
  it("goes on a double-tap of the page", () => {
    enterFocus();
    doubleTapPage();
    expect(chromeIsAway()).toBe(false);
    expect(lock()).toBeNull();
  });

  it("stays on a single tap", () => {
    // The whole point: a stray tap while reading must not end the mode.
    enterFocus();
    tapPage();
    expect(chromeIsAway()).toBe(true);
  });

  it("says nothing when a single tap asks", () => {
    // The toast used to come back on every stray tap. It is an announcement
    // about ENTERING the mode, and a reader already in it who rested a thumb
    // on the page is not asking to be told anything. The lock is on screen the
    // whole time as the visible way out.
    vi.useFakeTimers();
    try {
      enterFocus();
      act(() => {
        vi.advanceTimersByTime(FOCUS_TOAST_MS + 50);
      });
      expect(pill()).toBeNull();
      tapPage();
      expect(pill()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes when the lock is tapped", () => {
    // The lock is the visible control the gesture cannot be on its own.
    enterFocus();
    const l = lock();
    expect(l).not.toBeNull();
    if (l) click(l);
    expect(chromeIsAway()).toBe(false);
  });

  it("gives the lock a name a screen reader can use", () => {
    enterFocus();
    expect(lock()?.getAttribute("aria-label")).toBe(ar["reader.exitFocusMode"]);
  });

  it("brings the bars back after a scroll inside the mode", () => {
    // Leaving has to land somewhere a reader can act from, and both modes
    // share one hidden/shown state — so a scroll taken while inside focus
    // mode, where it looks like it did nothing, must not be what the reader
    // gets handed back on the way out. Otherwise the lock, the one visible
    // way out, returns a screen as empty as the one it left.
    enterFocus();
    scrollPage();
    doubleTapPage();
    expect(chromeIsAway()).toBe(false);
  });
});

describe("the bars, outside focus mode", () => {
  it("go on a tap and come back on the next one", () => {
    tapPage();
    expect(chromeIsAway()).toBe(true);
    tapPage();
    expect(chromeIsAway()).toBe(false);
  });

  it("needs only ONE tap, unlike focus mode", () => {
    // The whole difference between the two modes. A single tap here does what
    // it takes a double-tap to do in focus mode.
    tapPage();
    expect(chromeIsAway()).toBe(true);
    expect(lock()).toBeNull();
  });

  it("go when the reader scrolls", () => {
    scrollPage();
    expect(chromeIsAway()).toBe(true);
  });

  it("stay away across a chapter turn", () => {
    act(() => root.unmount());
    mount(1);
    tapPage();
    expect(chromeIsAway()).toBe(true);
    const el = byLabel(ar["reader.nextChapter"]);
    click(el.querySelector("span") ?? el);
    expect(moves).toEqual([2]);
    expect(chromeIsAway()).toBe(true);
  });

  it("ignore a press held long enough to highlight", () => {
    // Reaching for a highlight is a press that never moves, and the browser
    // ends it with a click like any other. Treating that as a tap took the
    // chrome away every time a reader went to select something.
    holdPage();
    expect(chromeIsAway()).toBe(false);
  });

  it("ignore a press that travelled", () => {
    // That gesture was a scroll. The scroll rule above already owns it.
    dragPage();
    expect(chromeIsAway()).toBe(false);
  });
});

describe("taps that belong to something else", () => {
  const HIGHLIGHT: Highlight = {
    id: "h1",
    chapter: 0,
    paragraphIndex: 0,
    charStart: 0,
    charEnd: 5,
    text: "فقرة ",
    color: "yellow",
    ts: 0,
  };

  beforeEach(() => {
    act(() => root.unmount());
    mount(0, [HIGHLIGHT]);
  });

  function mark(): HTMLElement {
    const el = host.querySelector<HTMLElement>("[data-h-id]");
    if (!el) throw new Error("highlight not rendered");
    return el;
  }
  function popover(): HTMLElement | null {
    return host.querySelector<HTMLElement>('[data-popover="highlight"]');
  }

  it("leaves the bars alone when the tap opens a highlight", () => {
    gesture(mark());
    expect(popover()).not.toBeNull();
    expect(chromeIsAway()).toBe(false);
  });

  it("leaves the bars alone when the tap dismisses the popover", () => {
    // One tap, one job: the page underneath is not also asking to be cleared.
    gesture(mark());
    tapPage();
    expect(popover()).toBeNull();
    expect(chromeIsAway()).toBe(false);
  });
});

describe("the in-page chapter controls, in focus mode", () => {
  beforeEach(() => {
    act(() => root.unmount());
    mount(1);
  });

  /** Tap a control the way a thumb does — on the label inside it. */
  function tapControl(label: string) {
    const el = byLabel(label);
    click(el.querySelector("span") ?? el);
  }

  it("turns forward without ending the mode", () => {
    enterFocus();
    tapControl(ar["reader.nextChapter"]);
    expect(moves).toEqual([2]);
    expect(chromeIsAway()).toBe(true);
  });

  it("turns back without ending the mode", () => {
    enterFocus();
    tapControl(ar["reader.prevChapter"]);
    expect(moves).toEqual([0]);
    expect(chromeIsAway()).toBe(true);
  });

  it("survives a DOUBLE tap on a chapter control", () => {
    // Two taps on the turn are two turns, never an exit — the control is
    // exempt from the page gesture in both directions.
    enterFocus();
    tapControl(ar["reader.nextChapter"]);
    tapControl(ar["reader.nextChapter"]);
    expect(chromeIsAway()).toBe(true);
  });
});
