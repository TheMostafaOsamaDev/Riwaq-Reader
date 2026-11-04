import { describe, expect, it } from "vitest";
import {
  bookProgress,
  chapterAtBookFraction,
  chapterStartTicks,
  textReadFraction,
} from "./bookProgress";

describe("bookProgress", () => {
  it("counts the chapters behind the reader plus how far into this one", () => {
    expect(bookProgress(4, 0.5, 10)).toBeCloseTo(0.45, 9);
  });

  it("is 0 at the start of the first chapter, not a chapter's worth", () => {
    // The library card used (chapter + 1) / count: opening chapter 1 of 3
    // read 33% there while the reader's own bar read 0%.
    expect(bookProgress(0, 0, 3)).toBe(0);
  });

  it("only reaches 100% at the end of the last chapter, not on opening it", () => {
    // Every formula had the last chapter at 100% the moment it opened.
    expect(bookProgress(9, 0, 10)).toBeCloseTo(0.9, 9);
    expect(bookProgress(9, 1, 10)).toBe(1);
  });

  it("clamps what it is handed", () => {
    expect(bookProgress(2, 7, 4)).toBeCloseTo(0.75, 9);
    expect(bookProgress(0, -1, 4)).toBe(0);
    expect(bookProgress(0, 0, 0)).toBe(0);
  });
});

describe("chapterAtBookFraction", () => {
  it("names the chapter whose span holds the position", () => {
    expect(chapterAtBookFraction(0.45, 10)).toBe(4);
    expect(chapterAtBookFraction(0, 10)).toBe(0);
    expect(chapterAtBookFraction(1, 10)).toBe(9);
  });

  it("round-trips a chapter start through the bar", () => {
    // Seeking to a chapter lands at its start, and the bar must then name
    // that same chapter — not its neighbour.
    for (const count of [1, 3, 10, 1437]) {
      for (let ch = 0; ch < count; ch += Math.max(1, Math.floor(count / 7))) {
        expect(chapterAtBookFraction(bookProgress(ch, 0, count), count)).toBe(
          ch,
        );
        expect(
          chapterAtBookFraction(bookProgress(ch, 0.99, count), count),
        ).toBe(ch);
      }
    }
  });
});

describe("chapterStartTicks", () => {
  it("marks where each chapter after the first begins", () => {
    expect(chapterStartTicks(4, 24)).toEqual([0.25, 0.5, 0.75]);
  });

  it("draws nothing past the cap, or for a single chapter", () => {
    expect(chapterStartTicks(26, 24)).toEqual([]);
    expect(chapterStartTicks(1, 24)).toEqual([]);
  });
});

describe("textReadFraction", () => {
  it("is 0 at the top and 1 once the last line is on screen", () => {
    // 4200px of content whose text ends at 4000, in an 800px viewport: the
    // last line arrives at scrollTop 3200, before the end card below it.
    expect(textReadFraction(0, 800, 4000)).toBe(0);
    expect(textReadFraction(1600, 800, 4000)).toBeCloseTo(0.5, 9);
    expect(textReadFraction(3200, 800, 4000)).toBe(1);
    expect(textReadFraction(3400, 800, 4000)).toBe(1);
  });

  it("is 1 for a chapter whose text fits on one screen", () => {
    expect(textReadFraction(0, 800, 600)).toBe(1);
  });

  it("is 0 while the chapter has no text yet", () => {
    // A streamed chapter mounts empty; flashing 100% there was a bug once.
    expect(textReadFraction(0, 800, null)).toBe(0);
  });
});
