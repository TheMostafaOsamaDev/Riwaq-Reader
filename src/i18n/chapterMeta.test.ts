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

/** What BookBody now builds. */
const metaLine = (locale: "ar" | "en", n: number, total: number) =>
  makeTr(locale)(KEY, {
    n: formatNum(n, locale),
    total: formatNum(total, locale),
  });

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
