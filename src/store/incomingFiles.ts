// Paths waiting to be imported, from wherever they came: an "Open with"
// launch, an Android share, or a drag-and-drop.
//
// This is a BUFFER, not just a pub-sub, and that is the whole point. The
// importer lives in Library.tsx, which unmounts behind the reader and
// hasn't mounted at all during a cold launch — exactly the two moments a
// file is most likely to arrive. Paths pushed with nobody listening are
// held here until someone drains them. Mirrors the `pendingStoreSource`
// idiom in uiIntents.ts.

type Listener = () => void;

let pending: string[] = [];
const listeners = new Set<Listener>();

/** Queue paths and wake any subscriber. An empty push is a no-op: Rust
 *  drains its queue unconditionally and can legitimately return nothing. */
export function pushIncoming(paths: string[]): void {
  if (paths.length === 0) return;
  pending = pending.concat(paths);
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      // One bad subscriber must not starve the rest, and must not leave
      // the paths stuck in the queue.
      // eslint-disable-next-line no-console
      console.warn("[incomingFiles] listener threw:", e);
    }
  }
}

/** Take everything queued, leaving the queue empty. Safe to call when
 *  empty — returns []. */
export function takeIncoming(): string[] {
  const out = pending;
  pending = [];
  return out;
}

/** True when a drain would return something. Lets a subscriber skip
 *  spinning up an import run for nothing. */
export function hasIncoming(): boolean {
  return pending.length > 0;
}

/** Subscribe to arrivals. Returns an unsubscribe function. */
export function onIncoming(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
