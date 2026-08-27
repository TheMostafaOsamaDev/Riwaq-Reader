import { describe, it, expect } from "vitest";
import { appendPage, searchView } from "./searchPaging";
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

const page = (n: number) => ({ cards: Array.from({ length: n }, (_, i) => ({ url: `u${i}`, title: `t${i}` })) });

describe("searchView", () => {
  it("shows skeletons while the first page loads", () => {
    expect(searchView({ loading: true, error: null, result: null })).toBe("skeletons");
  });

  it("shows skeletons even when stale results are still held", () => {
    expect(searchView({ loading: true, error: "boom", result: page(3) })).toBe("skeletons");
  });

  it("shows the error box when the first page failed and nothing is loaded", () => {
    expect(searchView({ loading: false, error: "boom", result: null })).toBe("error");
  });

  it("keeps the grid when an error arrives but results are already on screen", () => {
    // Regression test: a failed Load-more must not wipe the results the user
    // is reading. Before this, the ladder routed any error to the error box.
    expect(searchView({ loading: false, error: "boom", result: page(3) })).toBe("grid");
  });

  it("shows the empty state for a successful search with no matches", () => {
    expect(searchView({ loading: false, error: null, result: page(0) })).toBe("empty");
  });

  it("shows the grid for a normal populated result", () => {
    expect(searchView({ loading: false, error: null, result: page(5) })).toBe("grid");
  });
});
