// Pure math + types for the MobileSheet drag-to-snap gesture.
// No React, no DOM — keeps the moving parts testable in isolation
// and the consumer (`MobileSheet.tsx`) easier to read.

export type Snap = "full" | "default" | "dismissed";

export interface SnapDims {
  /** Pixel offset reserved above the sheet at the full snap (safe-area / notch). */
  fullInsetTop: number;
  /** Total viewport height in px (visualViewport / window.innerHeight). */
  viewportH: number;
  /** Height of the *default* snap in px (the rendered "82%"). */
  defaultH: number;
}

/** Sample of a pointermove for velocity estimation. */
export interface MoveSample {
  y: number;
  t: number; // performance.now() in ms
}

export const TAP_THRESHOLD = 6;  // px — below this, the gesture is a tap
export const V_THRESH = 500;     // px/sec — flick threshold
export const VELOCITY_WINDOW_MS = 120;

/** translateY (px) for a given snap relative to a sheet rendered at the
 *  full snap height with `bottom: 0` anchor.
 *
 *  - "full"      → 0 (sheet top edge sits at fullInsetTop)
 *  - "default"   → viewportH - fullInsetTop - defaultH (sheet shifted down so
 *                  only defaultH is visible above the viewport bottom)
 *  - "dismissed" → viewportH - fullInsetTop (sheet entirely below the viewport)
 */
export function baselineTranslateY(snap: Snap, dims: SnapDims): number {
  switch (snap) {
    case "full":
      return 0;
    case "default":
      return Math.max(0, dims.viewportH - dims.fullInsetTop - dims.defaultH);
    case "dismissed":
      return Math.max(0, dims.viewportH - dims.fullInsetTop);
  }
}

/** Clamp a raw translateY value so the sheet cannot be dragged above the
 *  full snap or past the dismissed snap. */
export function clampTranslateY(y: number, dims: SnapDims): number {
  const min = baselineTranslateY("full", dims);
  const max = baselineTranslateY("dismissed", dims);
  return Math.min(max, Math.max(min, y));
}

/** Estimate the user's vertical drag velocity (px/sec, signed +down/-up)
 *  from a recent ring of pointermove samples. Returns 0 when there's not
 *  enough data. */
export function velocityFromSamples(samples: MoveSample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  // Walk backward to find the oldest sample inside the velocity window.
  let oldest = samples[0];
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t <= VELOCITY_WINDOW_MS) {
      oldest = samples[i];
    } else {
      break;
    }
  }
  const dt = (last.t - oldest.t) / 1000;
  if (dt <= 0) return 0;
  return (last.y - oldest.y) / dt;
}

export interface SnapInput {
  /** Where the gesture started ("dismissed" is unreachable as a start). */
  fromSnap: Exclude<Snap, "dismissed">;
  /** Signed pixel offset applied to the from-snap baseline (+down/-up). */
  offsetPx: number;
  /** Signed velocity at release (+down/-up). */
  velocityPxPerSec: number;
  dims: SnapDims;
}

/** Decide which snap the sheet should settle to when the pointer is
 *  released. The thresholds match the rules approved during brainstorming:
 *
 *  from "default":
 *    - drag up past 20 % of (full → default) gap or upward flick → "full"
 *    - drag down past 25 % of defaultH or downward flick → "dismissed"
 *    - otherwise → "default"
 *
 *  from "full":
 *    - drag down past gapFullToDefault + 25 % of defaultH or downward flick → "dismissed"
 *    - drag down past gapFullToDefault → "default"
 *    - otherwise → "full"
 */
export function decideSnap(input: SnapInput): Snap {
  const { fromSnap, offsetPx, velocityPxPerSec, dims } = input;
  const gapFullToDefault = Math.max(
    0,
    dims.viewportH - dims.fullInsetTop - dims.defaultH,
  );
  const dismissExtra = 0.25 * dims.defaultH;

  if (fromSnap === "default") {
    if (offsetPx < 0) {
      const distOk = Math.abs(offsetPx) >= 0.20 * gapFullToDefault;
      const flickOk = velocityPxPerSec <= -V_THRESH;
      if (distOk || flickOk) return "full";
      return "default";
    }
    if (offsetPx > 0) {
      const distOk = offsetPx >= 0.25 * dims.defaultH;
      const flickOk = velocityPxPerSec >= V_THRESH;
      if (distOk || flickOk) return "dismissed";
      return "default";
    }
    return "default";
  }

  // fromSnap === "full"
  if (offsetPx <= 0) return "full"; // dragging further up at full → stay
  if (
    offsetPx > gapFullToDefault + dismissExtra ||
    velocityPxPerSec >= V_THRESH
  ) {
    return "dismissed";
  }
  if (offsetPx >= gapFullToDefault) return "default";
  return "full";
}
