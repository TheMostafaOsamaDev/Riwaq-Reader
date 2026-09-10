// What fills a view's box while its lazy chunk is still evaluating.
//
// Deliberately just an opaque surface — no spinner, no skeleton, no animation.
// Three reasons, in order of how much they matter:
//
//   1. It must paint on its FIRST frame. Views mount inside AnimatedSwap, whose
//      slot runs `.riwaq-view-enter` (opacity 0 → 1, `both` fill). If the slot's
//      content suspends, that keyframe runs on an empty div — and WKWebView can
//      hold such a keyframe's first frame indefinitely, so the opacity: 0 would
//      stick and the view would never appear. An opaque surface means the fade
//      animates something real, exactly as it does with an eager view.
//
//   2. A spinner here would be a flash of noise. Loading indicators earn their
//      place past ~300 ms; these chunks measured 2-20 ms to compile and execute
//      (2026-09-11, Chromium and WebKit). Anything that animates would appear
//      and vanish inside a couple of frames, which reads as a glitch.
//
//   3. It reserves the box, so nothing shifts when the real view swaps in.
//
// It carries no text and announces nothing: at this duration a live-region
// "loading" would be noise for a screen reader too. If a chunk ever does load
// slowly (cold disk, first launch after an update), the user sees a calm
// theme-coloured surface for a beat rather than a stutter of chrome.

interface Props {
  /** Painted as the surface colour, so the fallback is opaque from frame one. */
  background: string;
}

export function LazyViewFallback({ background }: Props) {
  return (
    <div
      aria-hidden
      style={{
        flex: 1,
        minHeight: 0,
        alignSelf: "stretch",
        background,
      }}
    />
  );
}
