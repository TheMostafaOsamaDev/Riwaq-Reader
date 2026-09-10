/** Serializes read-modify-write sequences against `library.json`.
 *
 *  Every index mutation in the store has the same three-step shape:
 *  `readIndex()` → mutate the array → `writeIndex()`, with real suspension
 *  points between the steps because both halves touch the filesystem. Two of
 *  those overlapping means both read the SAME array and the second write
 *  clobbers the first — dropping, for example, a book the user just imported
 *  while a background cover backfill happened to be running.
 *
 *  Mutations queue on one promise chain, so each runs to completion before
 *  the next reads. A rejection is contained: the caller still sees it, the
 *  queue does not, so one failed mutation can't strand every later one.
 *
 *  This guards a single process against itself. Two OS processes writing the
 *  same library would still race — `tauri-plugin-single-instance` is what
 *  keeps that from happening on desktop. */
let tail: Promise<unknown> = Promise.resolve();

export function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn);
  // Swallow only on the QUEUE's copy so the next mutation still runs; `run`
  // itself keeps the rejection for whoever called us.
  tail = run.catch(() => undefined);
  return run;
}
