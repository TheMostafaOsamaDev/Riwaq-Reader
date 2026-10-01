// @vitest-environment happy-dom
//
// The desktop reader's position indicators, matched to the phone's.
//
// The reading surface drew the app's floating scrollbar thumb down the page
// edge — a second position indicator beside the header's progress bar — and
// focus mode, which lifts the header away, then had no indicator but that
// thumb. Now the surface opts out of the thumb, and focus mode puts the
// phone's 2px rail at the top of the window, fed by the same progress the
// header's bar is.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpubBook } from "../epub/types";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import { I18nProvider } from "../i18n/I18nProvider";
import type { BookState } from "../store/library";
import { THEMES } from "../styles/tokens";
import type { Tweaks } from "../types/reader";
import { DesktopReader } from "./DesktopReader";

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
    paragraphs: Array.from({ length: 30 }, (_, n) => ({
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

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(t: Partial<Tweaks>) {
  act(() => {
    root.render(
      <I18nProvider locale="ar">
        <DesktopReader
          theme={THEMES.sepia}
          themeKey="sepia"
          t={{ ...DEFAULT_TWEAKS, readingMode: "scroll", ...t }}
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
          activePanel={null}
          setActivePanel={() => {}}
          onBack={() => {}}
        />
      </I18nProvider>,
    );
  });
}

const rail = () => host.querySelector<HTMLElement>(".riwaq-focus-rail");

/** The reading surface: the one element that scrolls the chapter. */
function surface(): HTMLElement {
  const el = (Array.from(host.querySelectorAll("*")) as HTMLElement[]).find(
    (e) => e.style.overflow === "auto" && e.querySelector("p"),
  );
  if (!el) throw new Error("no reading surface");
  return el;
}

/** happy-dom has no layout: give the surface a chapter-sized geometry. */
function setGeometry(el: HTMLElement, scrollHeight: number, client: number) {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { value: client });
}

describe("desktop reader position indicators", () => {
  it("opts the reading surface out of the floating scrollbar", () => {
    mount({});
    expect(surface().hasAttribute("data-no-overlay-scrollbar")).toBe(true);
  });

  it("puts the rail up in focus mode only", () => {
    mount({ focusMode: false });
    expect(rail()).toBeNull();
    mount({ focusMode: true });
    expect(rail()).not.toBeNull();
  });

  it("pins the rail to the top edge of the window", () => {
    mount({ focusMode: true });
    const r = rail()!;
    expect(r.style.position).toBe("fixed");
    expect(r.style.top).toBe("0px");
  });

  it("fills the rail with the chapter's scroll progress", async () => {
    mount({ focusMode: true });
    const el = surface();
    setGeometry(el, 2000, 500);
    el.scrollTop = 750; // halfway through the scrollable 1500px
    await act(async () => {
      el.dispatchEvent(new Event("scroll"));
      await new Promise((r) => setTimeout(r, 50));
    });
    const fills = [
      ...host.querySelectorAll<HTMLElement>(".riwaq-focus-rail div div"),
    ];
    expect(fills).toHaveLength(1);
    expect(fills[0].style.width).toBe("50%");
  });
});
