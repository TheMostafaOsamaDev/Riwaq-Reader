// The library as it was at the end of the last session, kept in
// localStorage so the home screen can draw it the instant the app starts.
//
// The real index lives on disk (library.json) and reading it is not slow,
// but the screen used to wait for it AND for every cover's file path — one
// IPC round trip per book — before showing a single card, so each launch
// opened on "Loading…". Now the last known list paints at once and the disk
// read refreshes it a moment later; when nothing changed, nothing moves.
//
// Strictly a cache: the disk is the truth. A missing, corrupt, oversized or
// foreign-version entry is ignored and the screen falls back to the old
// path. Nothing here ever writes to the library itself.

import type { BookIndexEntry } from "./library";

const KEY = "riwaq:library-cache:v1";
/** Above this the cache is not worth its localStorage share (5 MB total). */
const MAX_CHARS = 1_500_000;

export interface LibrarySnapshot {
  books: BookIndexEntry[];
  covers: Record<string, string>;
}

export function loadLibrarySnapshot(): LibrarySnapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LibrarySnapshot>;
    if (!Array.isArray(v.books) || typeof v.covers !== "object" || !v.covers) {
      return null;
    }
    // Every entry must at least look like a book, or the shelf would render
    // garbage until the refresh lands.
    if (!v.books.every((b) => b && typeof b.id === "string")) return null;
    return { books: v.books, covers: v.covers as Record<string, string> };
  } catch {
    return null;
  }
}

export function saveLibrarySnapshot(snapshot: LibrarySnapshot): void {
  try {
    const raw = JSON.stringify(snapshot);
    if (raw.length > MAX_CHARS) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(KEY, raw);
  } catch {
    // Storage full or unavailable: the next launch just reads the disk.
  }
}
