import { describe, it, expect } from "vitest";
import { appendPage } from "./searchPaging";
import type { SourceSearchResult } from "../sources/types";

const result = (
  urls: string[], hasMore: boolean, page: number,
): SourceSearchResult => ({
  cards: urls.map((u) => ({ url: u, title: u })),
  hasMore, query: "q", page,
});

describe("appendPage", () => {
  it("seeds from nothing", () => {
    const out = appendPage(null, result(["a", "b"], true, 1));
    expect(out).toEqual({
      cards: [{ url: "a", title: "a" }, { url: "b", title: "b" }],
      hasMore: true, page: 1,
    });
  });

  it("appends the next page and advances the cursor", () => {
    const first = appendPage(null, result(["a"], true, 1));
    const out = appendPage(first, result(["b"], false, 2));
    expect(out.cards.map((c) => c.url)).toEqual(["a", "b"]);
    expect(out.page).toBe(2);
    expect(out.hasMore).toBe(false);
  });

  it("drops duplicates so a repeated row can't produce two React keys", () => {
    const first = appendPage(null, result(["a", "b"], true, 1));
    const out = appendPage(first, result(["b", "c"], true, 2));
    expect(out.cards.map((c) => c.url)).toEqual(["a", "b", "c"]);
  });

  it("stops when a page comes back empty even if hasMore was true", () => {
    const first = appendPage(null, result(["a"], true, 1));
    expect(appendPage(first, result([], true, 2)).hasMore).toBe(false);
  });
});
