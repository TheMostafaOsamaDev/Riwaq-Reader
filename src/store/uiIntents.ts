// Tiny module-scoped pub/sub for cross-cutting UI intents like "open
// the download queue from a notification tap." The notification
// tap-handler lives in App.tsx (driven by useLaunchIntent), but the
// queue's visibility is owned by Library.tsx. Rather than thread
// props through the tree, both subscribe here.

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

function emit(event: string): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of set) {
    try {
      fn();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[uiIntents] listener for "${event}" threw:`, e);
    }
  }
}

function on(event: string, fn: Listener): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
  };
}

/** Emit a request to open the in-app Download Queue view. */
export function openDownloadQueue(): void {
  emit("open-download-queue");
}

/** Subscribe to "open download queue" requests. Returns an
 *  unsubscribe function. */
export function onOpenDownloadQueue(fn: Listener): () => void {
  return on("open-download-queue", fn);
}

// One-shot "open a specific source in the Store" intent. Carries the source
// id via a module var, and remembers the LAST request as `pendingStoreSource`
// so a request emitted BEFORE the Store mounts (e.g. the main search jumping
// in from the shelf) isn't lost — the Store consumes it on mount.
let pendingStoreSource: string | null = null;

/** Request that the Store open a given source's home page. */
export function openStoreSource(sourceId: string): void {
  pendingStoreSource = sourceId;
  emit("open-store-source");
}

/** Subscribe to "open store source" requests fired while already mounted. The
 *  handler receives the requested source id; the pending value is cleared as
 *  it's delivered. Returns an unsubscribe function. */
export function onOpenStoreSource(fn: (sourceId: string) => void): () => void {
  return on("open-store-source", () => {
    const id = pendingStoreSource;
    pendingStoreSource = null;
    if (id) fn(id);
  });
}

/** Consume a request that arrived before any subscriber existed — call once
 *  when the Store mounts. Returns the pending source id, or null. */
export function takePendingStoreSource(): string | null {
  const id = pendingStoreSource;
  pendingStoreSource = null;
  return id;
}
