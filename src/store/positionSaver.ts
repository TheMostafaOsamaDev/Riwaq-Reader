/** Debounced persistence of the reflow reader's position, with a flush.
 *
 *  Scrolling reports a position several times a second; writing each one to
 *  `state.json` would hammer the disk, so writes wait until the reader has
 *  been still for `delayMs`. The debounce alone loses the last position
 *  whenever the reader goes away inside that window — back to the library,
 *  or Android freezing a backgrounded app — so the reader asks for a flush at
 *  those moments and the pending position is written at once. See
 *  reader/scroll/usePositionReporter.ts. */

/** One saved reading position, and the book progress it stands for when
 *  known (reader/bookProgress.ts). */
export interface SavedPosition {
  bookId: string;
  paragraph: number;
  offset: number;
  progress?: number;
}

export interface PositionSaver {
  /** Queue a position; it is written once nothing newer arrives for the delay. */
  schedule(position: SavedPosition): void;
  /** Write the queued position now. */
  flush(): void;
  /** Drop the queued position unwritten. For when something else is about to
   *  rewrite the saved paragraph (a chapter change, a highlight jump), so the
   *  record of what's on disk is dropped too. */
  cancel(): void;
}

export function createPositionSaver(
  write: (position: SavedPosition) => Promise<void>,
  delayMs: number,
): PositionSaver {
  let pending: SavedPosition | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // What is already on disk, so an unchanged position isn't rewritten every
  // time the reader stops on it.
  let written: string | null = null;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    clear();
    const p = pending;
    pending = null;
    if (!p) return;
    const key = `${p.bookId}:${p.paragraph}:${p.offset}`;
    if (written === key) return;
    written = key;
    void write(p);
  };

  return {
    schedule(position) {
      // Another book's position must not be lost to this one replacing it.
      if (pending && pending.bookId !== position.bookId) flush();
      pending = position;
      clear();
      timer = setTimeout(flush, delayMs);
    },
    flush,
    cancel() {
      clear();
      pending = null;
      written = null;
    },
  };
}
