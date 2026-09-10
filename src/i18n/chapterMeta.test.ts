import { describe, expect, it } from "vitest";
import { formatNum, makeTr } from ".";
import { ar } from "./ar";
import { en } from "./en";

// The chapter opener's meta line — the "Chapter 3 of 24" above a chapter's
// display title. It was a hardcoded English template literal in BookBody, so
// it read "CHAPTER 1 OF 3" over an Arabic title in an Arabic-first app. These
// pin the plumbing it now goes through: the key exists in both catalogues, the
// placeholders are the ones the caller passes, and Arabic gets Arabic-Indic
// digits.

const KEY = "reader.chapterOfTotal";
/** The chapter OPENER's line, which carries the number and not the total. */
const OPENER_KEY = "reader.chapterNumber";

/** The chrome's form — the reader's top-bar subtitle. */
const metaLine = (locale: "ar" | "en", n: number, total: number) =>
  makeTr(locale)(KEY, {
    n: formatNum(n, locale),
    total: formatNum(total, locale),
  });

/** What ChapterOpener builds. */
const openerLine = (locale: "ar" | "en", n: number) =>
  makeTr(locale)(OPENER_KEY, { n: formatNum(n, locale) });

describe("chapter meta line", () => {
  it("is translated, not the English string in both locales", () => {
    expect(metaLine("ar", 3, 24)).toBe("الفصل ٣ من ٢٤");
    expect(metaLine("en", 3, 24)).toBe("Chapter 3 of 24");
  });

  it("renders Arabic-Indic digits under ar and Latin under en", () => {
    // The bug this half guards: `tr` alone would have produced the Arabic
    // sentence with Latin "3" and "24" sitting inside it.
    expect(metaLine("ar", 12, 100)).toBe("الفصل ١٢ من ١٠٠");
    expect(metaLine("ar", 12, 100)).not.toMatch(/[0-9]/);
    expect(metaLine("en", 12, 100)).toMatch(/12.*100/);
  });

  it("has the key in both catalogues, so neither falls back", () => {
    // `makeTr` falls back locale → en → the raw key. A missing Arabic entry
    // would therefore show English rather than fail, which is exactly the
    // failure that went unnoticed here for as long as it did.
    expect(ar[KEY]).toBeDefined();
    expect(en[KEY]).toBeDefined();
    expect(metaLine("ar", 1, 2)).not.toBe(KEY);
  });

  it("uses the placeholders the caller actually passes", () => {
    // A renamed placeholder leaves the literal "{n}" on the page rather than
    // throwing, so assert none survives interpolation.
    for (const locale of ["ar", "en"] as const) {
      expect(metaLine(locale, 5, 9)).not.toMatch(/[{}]/);
    }
    for (const catalogue of [ar, en]) {
      expect(catalogue[KEY]).toContain("{n}");
      expect(catalogue[KEY]).toContain("{total}");
    }
  });

  it("handles a single-chapter book without reading oddly", () => {
    expect(metaLine("ar", 1, 1)).toBe("الفصل ١ من ١");
    expect(metaLine("en", 1, 1)).toBe("Chapter 1 of 1");
  });
});

describe("chapter opener line", () => {
  // The opener drops the total on purpose: over a chapter's own display title
  // "of 24" is noise, and both the scrubber and focus mode's running head
  // still carry it. Separate key rather than a variant of `chapterOfTotal`,
  // so neither can be changed on the other's behalf.
  it("carries the number and nothing else", () => {
    expect(openerLine("ar", 3)).toBe("الفصل ٣");
    expect(openerLine("en", 3)).toBe("Chapter 3");
  });

  it("says nothing about the total", () => {
    for (const locale of ["ar", "en"] as const) {
      const line = openerLine(locale, 3);
      expect(line).not.toContain("24");
      expect(line).not.toContain("٢٤");
      expect(line).not.toMatch(/of|من/);
    }
  });

  it("uses Arabic-Indic digits under ar", () => {
    expect(openerLine("ar", 12)).toBe("الفصل ١٢");
    expect(openerLine("ar", 12)).not.toMatch(/[0-9]/);
  });

  it("has the key in both catalogues with the one placeholder", () => {
    for (const catalogue of [ar, en]) {
      expect(catalogue[OPENER_KEY]).toBeDefined();
      expect(catalogue[OPENER_KEY]).toContain("{n}");
      expect(catalogue[OPENER_KEY]).not.toContain("{total}");
    }
    expect(openerLine("ar", 1)).not.toBe(OPENER_KEY);
    expect(openerLine("ar", 1)).not.toMatch(/[{}]/);
  });

  it("stays distinct from the chrome's own line", () => {
    // Both exist and both are used; a refactor that collapsed them would
    // silently put "of 24" back over every chapter title.
    expect(openerLine("en", 3)).not.toBe(metaLine("en", 3, 24));
  });
});
