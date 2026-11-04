// Plays pre-sampled values on several elements in lockstep through the Web
// Animations API.
//
// Why WAAPI and not a requestAnimationFrame loop: transform and opacity
// animations handed to the browser run on the compositor, so a busy main
// thread (a long Contents list re-rendering, a PDF page decoding) cannot
// stutter a sheet that is settling. The values are sampled in JS (a spring
// with the finger's release velocity has no CSS easing) and played with
// linear easing between samples; every track gets the same sample count and
// duration, so the sheet, its scrim and its footer stay locked together.

import { isReducedMotion } from "../../styles/motion";

export interface Track {
  el: HTMLElement;
  prop: "transform" | "opacity";
  /** One CSS value per sample, evenly spaced over the duration. */
  values: string[];
}

export interface Playback {
  cancel(): void;
  /** true when the animation ran to its end, false when it was cancelled. */
  finished: Promise<boolean>;
}

export function playTracks(tracks: Track[], durationMs: number): Playback {
  const finalize = () => {
    for (const t of tracks) t.el.style[t.prop] = t.values[t.values.length - 1];
  };
  const canAnimate =
    durationMs > 0 &&
    !isReducedMotion() &&
    tracks.every(
      (t) => t.values.length > 1 && typeof t.el.animate === "function",
    );
  if (!canAnimate) {
    finalize();
    return { cancel() {}, finished: Promise.resolve(true) };
  }
  let cancelled = false;
  const animations = tracks.map((t) =>
    t.el.animate(
      t.values.map((v) => ({ [t.prop]: v })),
      { duration: durationMs, easing: "linear", fill: "forwards" },
    ),
  );
  const finished = Promise.all(animations.map((a) => a.finished)).then(
    () => {
      if (cancelled) return false;
      // Commit the end state inline, then drop the animations: a filled
      // animation would otherwise keep overriding every later inline write.
      finalize();
      for (const a of animations) a.cancel();
      return true;
    },
    () => false,
  );
  return {
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const a of animations) a.cancel();
    },
    finished,
  };
}
