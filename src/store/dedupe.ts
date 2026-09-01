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
