// @vitest-environment happy-dom
//
// Focus mode on the phone, as a mode rather than a toggle.
//
// You enter it from the control in the header's trailing corner, and you leave
// it by double-tapping the page or by tapping the lock that says you are in
// it. A single tap does nothing but re-state the way out — it used to toggle
// the chrome, which meant any stray tap dropped a reader out of the mode with
// no acknowledgement at all.
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
import { GLASS_CLASS } from "../reader/chrome/glass";
import type { BookState } from "../store/library";
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
function Harness({ start }: { start: number }) {
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

/** One tap on the paper. */
function tapPage() {
  click(surface());
}
/** Two taps in the same place, back to back — the exit gesture. */
function doubleTapPage() {
  tapPage();
  tapPage();
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
    // The tap used to do this. It no longer does, because a bare screen you
    // can reach by accident is one you leave by accident too.
    tapPage();
    expect(chromeIsAway()).toBe(false);
    enterFocus();
    expect(chromeIsAway()).toBe(true);
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

  it("re-states the way out when a single tap asks", () => {
    // A tap that does nothing at all reads as a frozen app.
    enterFocus();
    tapPage();
    expect(pill()).not.toBeNull();
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
