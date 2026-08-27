// Accumulator for paginated source search. Kept out of SourceHomeView so
// the merge rules (dedupe, end-of-results) are unit-testable without a
// React renderer.

import type { NovelCard, SourceSearchResult } from "../sources/types";

export interface SearchPage {
  cards: NovelCard[];
  hasMore: boolean;
  /** Highest page number merged so far; the next fetch asks for page+1. */
  page: number;
}

/** Merge one search response onto the accumulated results.
 *
 *  Dedupes by `url` — sources paginate over live data, so a novel that
 *  moves between pages while the user is reading would otherwise appear
 *  twice and collide on its React key.
 *
 *  An empty page ends pagination regardless of the source's `hasMore`:
 *  a source that always reports true would otherwise loop forever. */
export function appendPage(
  prev: SearchPage | null,
  next: SourceSearchResult,
): SearchPage {
  const cards = prev ? [...prev.cards] : [];
  const seen = new Set(cards.map((c) => c.url));
  for (const card of next.cards) {
    if (seen.has(card.url)) continue;
    seen.add(card.url);
    cards.push(card);
  }
  return {
    cards,
    hasMore: next.hasMore && next.cards.length > 0,
    page: next.page,
  };
}

export type SearchView = "skeletons" | "error" | "empty" | "grid";

/** Which body the search area shows. Extracted so the precedence rules are
 *  testable without rendering: a load-more failure must NOT displace results
 *  that are already on screen — only a first-page failure does. */
export function searchView(state: {
  loading: boolean;
  error: string | null;
  result: { cards: unknown[] } | null;
}): SearchView {
  if (state.loading) return "skeletons";
  if (state.error && !state.result) return "error";
  if (state.result && state.result.cards.length === 0) return "empty";
  return "grid";
}
