// App-wide overlay-scrollbar behaviour: the thumb paints only while a
// container is actually scrolling, then fades out.
//
// One delegated listener covers every scroll area in the app — no per-
// component wiring, and a new scrollable surface gets the behaviour for free.
// The paint itself is CSS (`[data-scrolling]::-webkit-scrollbar-thumb` in
// global.css); this module only stamps and clears the attribute.

/** Idle window before the thumb fades. Matches the fixed-page viewer's
 *  floating bar so the app has a single scrollbar rhythm. */
const IDLE_MS = 800;
const ATTR = "data-scrolling";

/** Start tracking scroll activity. Returns a cleanup that removes the
 *  listener and clears any attribute still on the DOM. */
export function installScrollbarAutoHide(): () => void {
  if (typeof document === "undefined") return () => {};

  const timers = new Map<Element, number>();

  const clear = (el: Element) => {
    const t = timers.get(el);
    if (t !== undefined) window.clearTimeout(t);
    timers.delete(el);
    el.removeAttribute(ATTR);
  };

  const onScroll = (e: Event) => {
    // The document scroller reports `document` as the target, but the bar is
    // painted by the root element — retarget so the attribute lands somewhere
    // the pseudo-element rule can match.
    const t = e.target;
    const el = t instanceof Element ? t : document.documentElement;

    const existing = timers.get(el);
    if (existing !== undefined) window.clearTimeout(existing);
    // Only touch the DOM on the first event of a gesture. Re-setting the
    // attribute on every frame of a scroll would invalidate style needlessly.
    else el.setAttribute(ATTR, "");

    timers.set(
      el,
      window.setTimeout(() => clear(el), IDLE_MS),
    );
  };

  // Capture phase is required: `scroll` does not bubble, so a document-level
  // listener would never see a nested scroller during the bubble phase.
  document.addEventListener("scroll", onScroll, {
    capture: true,
    passive: true,
  });

  return () => {
    document.removeEventListener("scroll", onScroll, { capture: true });
    // Snapshot the keys — `clear` mutates the map as it goes.
    for (const el of [...timers.keys()]) clear(el);
  };
}
