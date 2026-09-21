// @vitest-environment happy-dom
//
// Every card in the mobile shelf grid must be the same height, with its
// title, author and progress rail on the same lines as its neighbours'.
//
// They were not. The title clamped to two lines but only *occupied* as many
// as it needed, so a one-line title pulled the author up under it; the author
// had no clamp at all, so a long one wrapped and pushed the rail down again;
// and the rail was only rendered for a book in progress, so an unread or a
// finished book had no fourth row at all. Three sources of drift in a grid
// where the eye reads across the row.
//
// happy-dom has no layout engine, so these assert the declared geometry
// rather than measured pixels: the rows a card renders, and the heights it
// reserves for them, must not depend on the book. Real measured alignment is
// checked separately in a WKWebView.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { BookIndexEntry } from "../../store/library";
import { THEMES } from "../../styles/tokens";
import { LibraryCard } from "./LibraryCard";
import { MobileShelfCard } from "./MobileShelfCard";

function book(over: Partial<BookIndexEntry>): BookIndexEntry {
  return {
    id: "b",
    title: "كتاب",
    author: "مؤلف",
    language: "ar",
    chapterCount: 10,
    addedAt: 0,
    progress: 0,
    ...over,
  };
}

/** The spread a real shelf shows: a short title next to one that wraps, an
 *  author that fits next to one that cannot, and every progress state. */
const BOOKS: BookIndexEntry[] = [
  book({
    id: "short",
    title: "عبد الظل",
    author: "Guiltythree",
    progress: 0.4,
  }),
  book({
    id: "wraps",
    title: "لعبة العروش الطبعة المصورة",
    author: "George R. R. Martin",
    progress: 0.02,
  }),
  book({
    id: "long-author",
    title: "دليل الموظف",
    author: "أحمد متولي عبد المعطي الشرقاوي المصري",
    progress: 0.5,
  }),
  book({ id: "unread", title: "لورد الغوامض", author: "الحبار", progress: 0 }),
  book({ id: "done", title: "تناسخ العاطل", author: "Apple", progress: 1 }),
  book({ id: "blank", title: "", author: "", progress: 0.9 }),
];

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

function renderGrid(): HTMLElement[] {
  act(() => {
    root.render(
      <I18nProvider locale="ar">
        {BOOKS.map((b) => (
          <MobileShelfCard
            key={b.id}
            theme={THEMES.sepia}
            book={b}
            onOpen={() => {}}
            onContextMenu={() => {}}
          />
        ))}
      </I18nProvider>,
    );
  });
  const cards = Array.from(host.children) as HTMLElement[];
  if (cards.length !== BOOKS.length) {
    throw new Error(`expected ${BOOKS.length} cards, got ${cards.length}`);
  }
  return cards;
}

/** The text rows under the cover, in order: title, author, progress. */
function rows(card: HTMLElement): HTMLElement[] {
  return (Array.from(card.children) as HTMLElement[]).slice(1);
}

describe("the mobile shelf card", () => {
  it("renders the same rows for every book", () => {
    const shapes = renderGrid().map((c) => rows(c).length);
    // An unread book and a finished one were each missing the rail.
    expect(shapes).toEqual(shapes.map(() => shapes[0]));
    expect(shapes[0]).toBe(3);
  });

  it("reserves the same height for the title however long it is", () => {
    const heights = renderGrid().map((c) => rows(c)[0].style.minHeight);
    expect(heights.every((h) => h !== "")).toBe(true);
    expect(new Set(heights).size).toBe(1);
  });

  it("keeps the author on one line", () => {
    for (const card of renderGrid()) {
      const author = rows(card)[1];
      expect(author.style.whiteSpace).toBe("nowrap");
      expect(author.style.textOverflow).toBe("ellipsis");
      expect(author.style.overflow).toBe("hidden");
    }
  });

  it("reserves the same height for the author row", () => {
    const heights = renderGrid().map((c) => rows(c)[1].style.minHeight);
    expect(heights.every((h) => h !== "")).toBe(true);
    expect(new Set(heights).size).toBe(1);
  });

  it("reserves the progress rail even when there is no progress", () => {
    const heights = renderGrid().map((c) => rows(c)[2].style.height);
    expect(heights.every((h) => h !== "")).toBe(true);
    expect(new Set(heights).size).toBe(1);
  });

  it("still paints the rail only for a book that has been started", () => {
    const cards = renderGrid();
    const painted = cards.map((c) => rows(c)[2].childElementCount > 0);
    // index 3 is the unread book — reserved, but nothing drawn in it.
    expect(painted[3]).toBe(false);
    expect(painted[0]).toBe(true);
  });
});

// The desktop card already pins its title to one line and reserves a fixed
// row for the meter, but its author was free to wrap — and on a fixed-width
// card a name like the one below does exactly that, pushing the meter a line
// lower than on the card beside it.
describe("the desktop library card", () => {
  function renderDesktop(): HTMLElement[] {
    act(() => {
      root.render(
        <I18nProvider locale="ar">
          {BOOKS.map((b) => (
            <LibraryCard
              key={b.id}
              theme={THEMES.sepia}
              book={b}
              onOpen={() => {}}
              onContextMenu={() => {}}
            />
          ))}
        </I18nProvider>,
      );
    });
    return Array.from(host.children) as HTMLElement[];
  }

  /** title, author, meter — inside the card's clickable wrapper, after the
   *  cover. */
  function deskRows(card: HTMLElement): HTMLElement[] {
    const inner = card.firstElementChild as HTMLElement;
    return (Array.from(inner.children) as HTMLElement[]).slice(1);
  }

  it("keeps the author on one line", () => {
    for (const card of renderDesktop()) {
      const author = deskRows(card)[1];
      expect(author.style.whiteSpace).toBe("nowrap");
      expect(author.style.textOverflow).toBe("ellipsis");
      expect(author.style.overflow).toBe("hidden");
    }
  });

  it("keeps the title on one line", () => {
    for (const card of renderDesktop()) {
      expect(deskRows(card)[0].style.textOverflow).toBe("ellipsis");
    }
  });

  it("reserves the meter row for every book", () => {
    const heights = renderDesktop().map((c) => deskRows(c)[2].style.height);
    expect(heights.every((h) => h !== "")).toBe(true);
    expect(new Set(heights).size).toBe(1);
  });
});
