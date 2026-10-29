import { describe, expect, it } from "vitest";
import { languageName, listLanguages, matchesFilter } from "./filter";

describe("languageName", () => {
  it("names a language in the UI's own language", () => {
    expect(languageName("en", "en")).toBe("English");
    expect(languageName("ar", "en")).toBe("Arabic");
    expect(languageName("en", "ar")).toBe("الإنجليزية");
  });

  it("names a regional tag by its primary language", () => {
    expect(languageName("en-US", "en")).toBe("English");
  });

  it("falls back to the code itself for a tag Intl cannot name", () => {
    expect(languageName("not a tag", "en")).toBe("NOT A TAG");
  });
});

describe("listLanguages", () => {
  it("lists each language once, sorted by its display name", () => {
    expect(listLanguages(["en", "ar", "EN", "en-GB"], "en")).toEqual([
      { code: "ar", name: "Arabic" },
      { code: "en", name: "English" },
    ]);
  });

  it("skips entries that declare no language", () => {
    expect(listLanguages([undefined, "", "ar"], "en")).toEqual([
      { code: "ar", name: "Arabic" },
    ]);
  });
});

describe("matchesFilter", () => {
  const novelbuddy = {
    name: "NovelBuddy",
    baseUrl: "https://novelbuddy.me",
    description: "English web novels",
    language: "en",
  };

  it("matches everything when there is no query and no language", () => {
    expect(matchesFilter(novelbuddy, "", null)).toBe(true);
  });

  it("matches the query against name, URL and description, ignoring case", () => {
    expect(matchesFilter(novelbuddy, "BUDDY", null)).toBe(true);
    expect(matchesFilter(novelbuddy, "novelbuddy.me", null)).toBe(true);
    expect(matchesFilter(novelbuddy, "web novels", null)).toBe(true);
    expect(matchesFilter(novelbuddy, "kolnovel", null)).toBe(false);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(matchesFilter(novelbuddy, "  buddy  ", null)).toBe(true);
  });

  it("keeps only the chosen language", () => {
    expect(matchesFilter(novelbuddy, "", "en")).toBe(true);
    expect(matchesFilter(novelbuddy, "", "ar")).toBe(false);
  });

  it("compares languages by primary subtag", () => {
    expect(matchesFilter({ ...novelbuddy, language: "en-US" }, "", "en")).toBe(
      true,
    );
  });

  it("needs both the query and the language to match", () => {
    expect(matchesFilter(novelbuddy, "buddy", "ar")).toBe(false);
    expect(matchesFilter(novelbuddy, "buddy", "en")).toBe(true);
  });

  it("drops an item with no language once a language is chosen", () => {
    expect(matchesFilter({ name: "Mystery" }, "", "en")).toBe(false);
  });
});
