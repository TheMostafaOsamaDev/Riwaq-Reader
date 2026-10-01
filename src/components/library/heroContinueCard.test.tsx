// @vitest-environment happy-dom
//
// The continue-reading card in each of its four styles, on both layouts:
// what it shows, which style it falls back to, and that its two buttons do
// what they say. Layout itself is checked by eye in a browser; happy-dom has
// no layout engine.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { BookIndexEntry } from "../../store/library";
import { THEMES } from "../../styles/tokens";
import type { HeroStyle } from "../../types/reader";
import { HeroContinueCard } from "./HeroContinueCard";
import { HERO_STYLES } from "./heroModel";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function book(over: Partial<BookIndexEntry>): BookIndexEntry {
  return {
    id: "hero",
    title: "لعبة العروش",
    author: "George R. R. Martin",
    language: "ar",
    chapterCount: 114,
    addedAt: 0,
    lastReadAt: Date.now() - 19 * 60_000,
    progress: 5 / 114,
    ...over,
  };
}

const HERO = book({});
const OTHER = book({
  id: "other",
  title: "القس المجنون",
  lastReadAt: Date.now() - 3_600_000,
  progress: 0.1,
});

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

function render(
  variant: HeroStyle,
  layout: "desktop" | "mobile",
  opts: { books?: BookIndexEntry[]; hero?: BookIndexEntry } = {},
) {
  const onOpen = vi.fn();
  const onMenu = vi.fn();
  const hero = opts.hero ?? HERO;
  act(() => {
    root.render(
      <I18nProvider locale="en">
        <HeroContinueCard
          theme={THEMES.sepia}
          layout={layout}
          variant={variant}
          book={hero}
          books={opts.books ?? [hero, OTHER]}
          covers={{}}
          onOpen={onOpen}
          onMenu={onMenu}
        />
      </I18nProvider>,
    );
  });
  return { onOpen, onMenu, text: host.textContent ?? "" };
}

function button(label: string): HTMLButtonElement {
  const b = [...host.querySelectorAll("button")].find(
    (el) =>
      el.getAttribute("aria-label") === label ||
      el.textContent?.trim() === label,
  );
  if (!b) throw new Error(`no button "${label}" in: ${host.innerHTML}`);
  return b;
}

describe.each(["desktop", "mobile"] as const)("%s", (layout) => {
  it.each(HERO_STYLES)("%s shows where you are and resumes", (variant) => {
    const { onOpen, onMenu, text } = render(variant, layout);
    expect(text).toContain("لعبة العروش");
    expect(text).toMatch(/Chapter 5/);
    // Removing the book is behind the menu, never a button on the card.
    expect(text).not.toContain("Remove from library");

    const resume = [...host.querySelectorAll("button")].find((b) =>
      /^Resume/.test(b.textContent?.trim() ?? ""),
    );
    expect(resume).toBeDefined();
    act(() => resume?.click());
    // Once, even on the phone where the whole card is also a tap target.
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("hero");

    act(() => button("More actions").click());
    expect(onMenu).toHaveBeenCalledWith(
      "hero",
      expect.any(Number),
      expect.any(Number),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("stack lists the other open book and opens it", () => {
    const { onOpen, text } = render("stack", layout);
    expect(text).toContain("Also reading");
    act(() =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("القس المجنون"))
        ?.click(),
    );
    expect(onOpen).toHaveBeenCalledWith("other");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("stack with nothing else open falls back to refined", () => {
    const { text } = render("stack", layout, { books: [HERO] });
    expect(text).not.toContain("Also reading");
    expect(text).toMatch(/Chapter 5 of 114/);
  });

  it("bookmark without a chapter count falls back to refined", () => {
    const hero = book({ chapterCount: 0 });
    const { text } = render("bookmark", layout, { hero });
    expect(text).not.toContain("Pick up where you left off");
    expect(text).toContain("Resume reading");
  });

  it("bookmark counts pages for a PDF", () => {
    const hero = book({ kind: "pdf", pageCount: 300, progress: 0.5 });
    const { text } = render("bookmark", layout, { hero });
    expect(text).toContain("Page 150");
    expect(text).toContain("Resume page 150");
  });
});
