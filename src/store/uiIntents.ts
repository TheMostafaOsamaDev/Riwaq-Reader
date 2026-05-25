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
