// Handing the main thread back mid-loop.
//
// A loop whose awaits all resolve from a cache never leaves its task: a
// resolved promise is a microtask, and the browser drains every microtask
// before it paints, handles input or fires a timer. The EPUB spine loop has
// exactly that shape — `prefetchText` warms every chapter up front, so the
// `await src.readText(...)` calls that follow are free — which is why
// importing a 114-chapter book froze the app for the whole parse, progress
// ring included.

interface Scheduler {
  yield?: () => Promise<void>;
}

/** Default budget between yields. Long enough that the yields themselves
 *  cost nothing on a book of tiny chapters, short enough to stay inside one
 *  frame at 60 Hz. */
const SLICE_MS = 8;

/** Yield to the event loop. A real task boundary, not a microtask. */
export function yieldToUI(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Scheduler }).scheduler;
  // Chromium (so: Android WebView) resumes a scheduler.yield() continuation
  // ahead of freshly-queued tasks, so the parse gets the thread back as soon
  // as the browser is done with it.
  if (scheduler?.yield) return scheduler.yield();
  if (typeof MessageChannel === "function") {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Time-sliced cooperative yielding. Call the returned function every
 * iteration; it only crosses a task boundary once `sliceMs` has elapsed
 * since the last one, so a loop over thousands of cheap items doesn't pay a
 * task per item.
 */
export function createTimeSlicer(
  sliceMs: number = SLICE_MS,
): () => Promise<void> {
  let last = performance.now();
  return async () => {
    if (performance.now() - last < sliceMs) return;
    await yieldToUI();
    last = performance.now();
  };
}
