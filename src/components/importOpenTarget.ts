// Where an import run should leave the user: in the reader, or back in the
// library with a summary. Pure and total — Library.tsx owns the navigation and
// the toasts, this owns only the decision, so the rule below is unit-testable
// without rendering the library or standing up an import.

/** The parts of a `StagedPick` (see store/library.ts) the decision reads.
 *  Structural rather than the real type: only lengths and the chosen entry
 *  matter here, which keeps this module free of the store and its Tauri deps. */
export interface OpenTargetPick<T> {
  autoImported: T[];
  drafts: unknown[];
  errors: unknown[];
  reused?: T[];
  /** Entries the run dropped because their files were gone, then re-imported.
   *  Declared so the rule can state that it deliberately ignores them: a
   *  repair is bookkeeping about what got cleaned up on the way in, not a
   *  failure, so it must not keep the reader closed. */
  pruned?: unknown[];
}

export type OpenIntent<T> =
  /** Report through `summarizeImport` and stay put. */
  | { kind: "none" }
  /** Land in the reader on this book now. */
  | { kind: "now"; target: T }
  /** One fixed-layout book: land in the reader once its title/cover dialog
   *  commits, which is the first moment a book exists to open. */
  | { kind: "afterDraft" };

/**
 * Decide where a finished pick leaves the user.
 *
 * `openWhenSingle` marks a pick that arrived from outside the app — Open with,
 * an Android share, a drag-drop. That means "read this", so a pick holding
 * exactly one book skips the library and opens it. The app's own import button
 * always passes false and always reports through the summary.
 *
 * **Exactly one book also means nothing went wrong.** A pick carrying an error
 * is never a single-book pick, however many books survived it: `errors` is
 * reported only by `summarizeImport`, and both open paths reach the reader by
 * returning early, before it. Counting only the successes let
 * `open -a Riwaq good.epub broken.epub` look single, open `good.epub`, and
 * never mention the file it could not read.
 *
 * Reporting has to win over opening here, because a toast fired on the way out
 * does not outlive the trip: the toast host lives inside the library, and
 * `onOpen` swaps the library out for the reader, unmounting it. Such a message
 * gets the book's load time on screen and not a moment more — no use for
 * something the reader is meant to actually read. Staying put is what makes the
 * failure visible at all.
 */
export function openIntentFor<T>(
  pick: OpenTargetPick<T>,
  openWhenSingle: boolean,
): OpenIntent<T> {
  if (!openWhenSingle) return { kind: "none" };
  // Something needs saying, and only the library can say it.
  if (pick.errors.length > 0) return { kind: "none" };

  const reused = pick.reused ?? [];
  // A hash-dedupe match imports nothing, so the book the user asked for can
  // arrive under either list — but never both, and never more than one here.
  if (pick.autoImported.length + reused.length === 1 && pick.drafts.length === 0) {
    const target = pick.autoImported[0] ?? reused[0];
    if (target) return { kind: "now", target };
  }
  // A PDF or DOCX on its own: real book, just not yet.
  if (
    pick.drafts.length === 1 &&
    pick.autoImported.length === 0 &&
    reused.length === 0
  ) {
    return { kind: "afterDraft" };
  }
  // Two or more books is no defensible choice of which to land on.
  return { kind: "none" };
}
