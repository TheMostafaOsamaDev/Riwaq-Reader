import { describe, expect, it } from "vitest";
import type { BookIndexEntry } from "../../store/library";
import {
  alsoReading,
  chapterTicks,
  isHeroStyle,
  percentRead,
  readingPosition,
} from "./heroModel";

function book(over: Partial<BookIndexEntry>): BookIndexEntry {
  return {
    id: "b",
    title: "T",
    author: "A",
    language: "en",
    chapterCount: 10,
    addedAt: 0,
    progress: 0,
    ...over,
  };
}

describe("readingPosition", () => {
  it("inverts the (current + 1) / total the readers write", () => {
    // Every chapter of a 114-chapter book round-trips, which is where float
    // error in progress would show up first.
    for (let current = 0; current < 114; current++) {
      const pos = readingPosition(
        book({ chapterCount: 114, progress: (current + 1) / 114 }),
      );
      expect(pos).toEqual({ unit: "chapter", n: current + 1, total: 114 });
    }
  });

  it("counts pages for fixed-layout books, not chapters", () => {
    expect(
      readingPosition(
        book({ kind: "pdf", pageCount: 300, chapterCount: 12, progress: 0.5 }),
      ),
    ).toEqual({ unit: "page", n: 150, total: 300 });
  });

  it("clamps a never-moved book to the first chapter", () => {
    expect(readingPosition(book({ progress: 0 }))?.n).toBe(1);
  });

  it("returns null when there is nothing to count", () => {
    expect(readingPosition(book({ chapterCount: 0 }))).toBeNull();
    expect(readingPosition(book({ kind: "docx", chapterCount: 5 }))).toBeNull();
  });
});

describe("percentRead", () => {
  it("never shows 0% for a book that has been opened", () => {
    expect(percentRead(1 / 328)).toBe(1);
    expect(percentRead(0)).toBe(0);
    expect(percentRead(0.044)).toBe(4);
    expect(percentRead(1)).toBe(100);
  });
});

describe("alsoReading", () => {
  const books = [
    book({ id: "hero", lastReadAt: 50 }),
    book({ id: "old", lastReadAt: 10, progress: 0.2 }),
    book({ id: "new", lastReadAt: 40, progress: 0.1 }),
    book({ id: "never", progress: 0 }),
    book({ id: "done", lastReadAt: 45, progress: 1 }),
    book({ id: "marked", lastReadAt: 44, progress: 0.3, status: "finished" }),
  ];

  it("lists opened, unfinished books newest first, without the hero", () => {
    expect(alsoReading(books, "hero", 5).map((b) => b.id)).toEqual([
      "new",
      "old",
    ]);
  });

  it("honours the limit", () => {
    expect(alsoReading(books, "hero", 1).map((b) => b.id)).toEqual(["new"]);
  });
});

describe("chapterTicks", () => {
  const states = (ticks: { state: string }[]) =>
    ticks.map((t) => t.state[0]).join("");

  it("draws one tick per chapter when they fit", () => {
    expect(states(chapterTicks({ unit: "chapter", n: 3, total: 6 }, 100))).toBe(
      "rrcuuu",
    );
  });

  it("buckets long books instead of drawing hairlines", () => {
    const ticks = chapterTicks({ unit: "chapter", n: 1200, total: 1200 }, 60);
    expect(ticks).toHaveLength(60);
    expect(ticks[ticks.length - 1].state).toBe("current");
    expect(chapterTicks({ unit: "chapter", n: 1, total: 1200 }, 60)[0]).toEqual(
      { state: "current" },
    );
  });

  it("puts the current chapter in the bucket that contains it", () => {
    // 100 chapters over 10 ticks: chapters 41-50 are tick 4.
    const ticks = chapterTicks({ unit: "chapter", n: 45, total: 100 }, 10);
    expect(states(ticks)).toBe("rrrrcuuuuu");
  });
});

describe("isHeroStyle", () => {
  it("accepts the four styles and nothing else", () => {
    expect(isHeroStyle("ambient")).toBe(true);
    expect(isHeroStyle("stack")).toBe(true);
    expect(isHeroStyle("cinematic")).toBe(false);
    expect(isHeroStyle(3)).toBe(false);
  });
});
