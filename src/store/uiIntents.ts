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

// "Edit this book's details" — the background-import toast's action for a
// book that was imported with default title and cover (see
// store/backgroundImport.ts). The edit dialog belongs to the Library, which
// is unmounted behind the reader, so the request is remembered as a one-shot
// pending id and the Library consumes it on mount.
let pendingEditBook: string | null = null;

/** Request the edit dialog for a book. Safe from anywhere in the app. */
export function requestEditBook(bookId: string): void {
  pendingEditBook = bookId;
  emit("edit-book");
}

/** Subscribe to edit requests fired while already mounted. The pending id is
 *  cleared as it is delivered. Returns an unsubscribe function. */
export function onEditBook(fn: (bookId: string) => void): () => void {
  return on("edit-book", () => {
    const id = pendingEditBook;
    pendingEditBook = null;
    if (id) fn(id);
  });
}

/** Consume an edit request that arrived before the Library mounted. */
export function takePendingEditBook(): string | null {
  const id = pendingEditBook;
  pendingEditBook = null;
  return id;
}
