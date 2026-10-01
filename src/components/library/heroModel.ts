// What the "continue reading" card shows, worked out from a library entry.
// No JSX, so the arithmetic is testable without rendering anything.

import type { BookIndexEntry } from "../../store/library";
import type { HeroStyle } from "../../types/reader";

/** Picker order in Settings. The first entry is NOT the default — that is
 *  DEFAULT_TWEAKS.heroStyle. */
export const HERO_STYLES: readonly HeroStyle[] = [
  "ambient",
  "refined",
  "bookmark",
  "stack",
];

export function isHeroStyle(v: unknown): v is HeroStyle {
  return typeof v === "string" && (HERO_STYLES as string[]).includes(v);
}

export interface ReadingPosition {
  unit: "chapter" | "page";
  /** 1-based. */
  n: number;
  total: number;
}

/** The chapter (or page, for PDF/DOCX) the reader is on.
 *
 *  The index stores only `progress`, written as (current + 1) / total by
 *  every reader, so multiplying back recovers the 1-based position exactly.
 *  Rounding absorbs the float error; the clamp covers a progress of 0 (a
 *  book opened but never moved) and a total that shrank after a re-import. */
export function readingPosition(book: BookIndexEntry): ReadingPosition | null {
  const fixed = book.kind === "pdf" || book.kind === "docx";
  const total = fixed ? (book.pageCount ?? 0) : book.chapterCount;
  if (!total || total < 1) return null;
  const n = Math.min(total, Math.max(1, Math.round(book.progress * total)));
  return { unit: fixed ? "page" : "chapter", n, total };
}

/** Whole percent, never 0 once a book has been opened — "0%" next to
 *  "Continue reading" reads as a bug. */
export function percentRead(progress: number): number {
  const p = Math.round(progress * 100);
  return progress > 0 ? Math.max(1, Math.min(100, p)) : 0;
}

/** Other books the reader has open: read at least once, not finished,
 *  most recent first. `books` arrives sorted by recency from listBooks, but
 *  this does not rely on it. */
export function alsoReading(
  books: readonly BookIndexEntry[],
  heroId: string,
  limit: number,
): BookIndexEntry[] {
  return books
    .filter(
      (b) =>
        b.id !== heroId &&
        b.lastReadAt !== undefined &&
        b.status !== "finished" &&
        b.progress < 1,
    )
    .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))
    .slice(0, limit);
}

export interface Tick {
  state: "read" | "current" | "unread";
}

/** The bookmark style's ruler: one tick per chapter, or per run of chapters
 *  once there are more than `max` — a 1,200-chapter web novel still gets a
 *  ruler, just a coarser one. The tick holding the current position is
 *  "current"; everything before it is "read". */
export function chapterTicks(pos: ReadingPosition, max: number): Tick[] {
  const count = Math.max(1, Math.min(pos.total, max));
  // Index of the tick that contains chapter `n` (1-based) when `total`
  // chapters are spread over `count` ticks.
  const current = Math.min(
    count - 1,
    Math.floor(((pos.n - 1) * count) / pos.total),
  );
  return Array.from({ length: count }, (_, i) => ({
    state: i < current ? "read" : i === current ? "current" : "unread",
  }));
}
