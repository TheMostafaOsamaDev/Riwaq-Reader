/** Reader input that means "I have the page now". */
const TOUCHED = ["pointerdown", "touchstart", "wheel", "keydown"] as const;

/** After this long the page has settled, or the reader has; stop either way. */
const HOLD_MS = 10_000;

/**
 * Keeps a freshly resumed position on screen while the page settles.
 *
 * The resume jump lands in a layout effect, before the page is final: the
 * reading font finishes loading after it, useFontScale re-measures and the
 * text grows, and images without a reserved size arrive later still. Each
 * change slides the text under the scrollTop, and the reader's next position
 * report saves wherever it slid to. Measured on a Galaxy A73: the jump landed
 * on paragraph 5, Markazi Text arrived 60ms later and took the text from 17px
 * to 22.46px, and the page showed paragraph 4 — so every cold start walked the
 * reader back. Chromium's scroll anchoring moved the page 18px of the hundreds
 * needed; WebKitGTK has no anchoring at all.
 *
 * So `place` (which puts the resumed position back) runs again whenever the
 * book body changes size — until the reader touches, scrolls or presses a key
 * anywhere, at which point the page is theirs. Input, not scroll events, is
 * what counts: anchoring scrolls the page too, and taking that for the reader
 * let go just before the real correction. Anywhere in the window, because a
 * swipe that starts on the floating bars never touches the scroller (the touch
 * fallback scrolls it from outside). Returns the function that stops holding.
 */
export function holdPosition(
  scroller: HTMLElement,
  place: () => void,
): () => void {
  const body = scroller.querySelector("[data-book-body]");
  if (!body || typeof ResizeObserver === "undefined") return () => {};
  let held = true;
  const ro = new ResizeObserver(() => {
    if (held) place();
  });
  const stop = () => {
    if (!held) return;
    held = false;
    ro.disconnect();
    clearTimeout(timer);
    for (const type of TOUCHED) window.removeEventListener(type, stop, true);
  };
  ro.observe(body);
  for (const type of TOUCHED)
    window.addEventListener(type, stop, { capture: true, passive: true });
  const timer = setTimeout(stop, HOLD_MS);
  return stop;
}
