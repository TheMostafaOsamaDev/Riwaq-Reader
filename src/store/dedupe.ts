// Recognising a book the library already holds.
//
// "Open with" makes re-opening the same file the normal case — someone
// double-clicks the same PDF in Finder every day. Without this, each open
// would add another library entry with its own reading position and its
// own highlights, and the user would slowly lose track of which copy they
// were actually reading.
//
// Split out from library.ts so the decision is testable without a
// filesystem.

import { bookDir } from "./paths";
// Type-only, so this stays a leaf at runtime: it keeps the set of kinds
// single-sourced instead of re-typing a union that must not drift.
import type { BookIndexEntry } from "./library";

/** The only part of a library entry this decision needs. */
export interface HashableEntry {
  id: string;
  /** Absent on books imported before hashing existed. */
  sourceHash?: string;
}

/**
 * Id of the book already holding `hash`, or null.
 *
 * An absent or empty hash never matches. That matters twice: books that
 * predate this feature carry no hash and must keep importing normally, and
 * a staging failure that yielded "" must not collide with all of them at
 * once.
 */
export function findByHash(
  entries: HashableEntry[],
  hash: string,
): string | null {
  if (!hash) return null;
  const hit = entries.find((e) => e.sourceHash === hash);
  return hit ? hit.id : null;
}

/** The part of a library entry that decides which files it needs on disk. */
export interface StoredEntry {
  id: string;
  /** Absent on EPUBs and on entries that predate the field. */
  kind?: BookIndexEntry["kind"];
}

/**
 * App-data-relative files that must ALL exist for `entry` to open.
 *
 * A hash match is only worth honouring while the book behind it is still
 * readable, and what that takes depends on the kind: an EPUB reads its
 * chapters from the parsed `book.json` (the original zip is kept only for
 * re-scanning covers and in-flow images, so losing it costs nothing at read
 * time), a PDF renders pages straight out of the original, a DOCX out of its
 * converted HTML, and a source bookmark has no book on disk at all — just
 * the chapter snapshot.
 */
export function requiredFilesFor(entry: StoredEntry): string[] {
  const dir = bookDir(entry.id);
  // Entries that predate the field are EPUBs.
  const kind = entry.kind ?? "epub";
  switch (kind) {
    case "epub":
      return [`${dir}/book.json`];
    case "pdf":
      return [`${dir}/book.json`, `${dir}/book.pdf`];
    case "docx":
      return [`${dir}/book.json`, `${dir}/content.html`];
    case "source":
      return [`${dir}/source.json`];
    default:
      return unhandledKind(kind);
  }
}

/** Exhaustiveness guard. Adding a kind without saying what it needs on disk
 *  is a type error here, because the caller acts on a "missing" answer by
 *  deleting the book — the EPUB answer must never be a silent fallback.
 *
 *  Reachable at runtime only from an index written by a newer build, where
 *  requiring nothing is the safe reply: a kind this one doesn't understand
 *  gets reused as-is rather than deleted. */
function unhandledKind(_kind: never): string[] {
  return [];
}
