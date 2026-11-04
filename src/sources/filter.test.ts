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
    description: { en: "English web novels", ar: "روايات ويب إنجليزية" },
    language: "en",
  };
  const match = (
    item: Parameters<typeof matchesFilter>[0],
    query: string,
    language: string | null = null,
    locale: "en" | "ar" = "en",
  ) => matchesFilter(item, query, language, locale);

  it("matches everything when there is no query and no language", () => {
    expect(match(novelbuddy, "")).toBe(true);
  });

  it("matches the query against name, URL and description, ignoring case", () => {
    expect(match(novelbuddy, "BUDDY")).toBe(true);
    expect(match(novelbuddy, "novelbuddy.me")).toBe(true);
    expect(match(novelbuddy, "web novels")).toBe(true);
    expect(match(novelbuddy, "kolnovel")).toBe(false);
  });

  it("searches the description in the interface's own language", () => {
    expect(match(novelbuddy, "روايات", null, "ar")).toBe(true);
    expect(match(novelbuddy, "روايات", null, "en")).toBe(false);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(match(novelbuddy, "  buddy  ")).toBe(true);
  });

  it("keeps only the chosen language", () => {
    expect(match(novelbuddy, "", "en")).toBe(true);
    expect(match(novelbuddy, "", "ar")).toBe(false);
  });

  it("compares languages by primary subtag", () => {
    expect(match({ ...novelbuddy, language: "en-US" }, "", "en")).toBe(true);
  });

  it("needs both the query and the language to match", () => {
    expect(match(novelbuddy, "buddy", "ar")).toBe(false);
    expect(match(novelbuddy, "buddy", "en")).toBe(true);
  });

  it("drops an item with no language once a language is chosen", () => {
    expect(match({ name: "Mystery" }, "", "en")).toBe(false);
  });
});
