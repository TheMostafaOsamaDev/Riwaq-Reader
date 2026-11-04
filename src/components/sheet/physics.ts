// Pure motion maths for the bottom sheet (MobileSheet). No React, no DOM:
// everything that can be decided from numbers alone lives here so it can be
// tested in isolation, and so the engine that drives the DOM
// (SheetController) is left with wiring, not arithmetic.
//
// Coordinates. `y` is the sheet box's translateY. 0 means the box sits at its
// layout position. An expandable sheet's box is laid out full-height (top
// edge on the safe-area inset) and pushed down to reach its default snap, so
// expanding is a transform, never a relayout. A sheet that cannot expand is
// laid out exactly as tall as its default snap, so its default y is 0.

import { cubicBezier } from "../../styles/motion";

export type Snap = "full" | "default" | "dismissed";

export interface SheetGeometry {
  /** Layout viewport height (window.innerHeight). */
  viewportH: number;
  /** Space kept clear above the sheet at full: the safe-area top inset. */
  insetTop: number;
  /** Height of the sheet box, not counting the overdraw below the screen.
   *  Expandable: viewportH − insetTop. Otherwise: defaultVisibleH. */
  boxH: number;
  /** How much of the sheet shows at the default snap. */
  defaultVisibleH: number;
  /** Whether the sheet has a full snap above its default. */
  expandable: boolean;
}

export interface MoveSample {
  y: number;
  /** performance.now() in ms. */
  t: number;
}

/** Movement under this many px is still a tap, not a drag. */
export const SLOP_PX = 6;
/** A release at least this fast always moves on to the next snap. */
export const FLICK_PX_PER_S = 700;
/** How far ahead a release is projected to pick its snap: y + v × this. */
export const PROJECTION_S = 0.15;
/** iOS's rubber-band constant. */
export const RUBBER_COEFF = 0.55;
/** Sheet-coloured box below the screen edge, so overshoot past the top never
 *  lifts the sheet's bottom off the screen. */
export const OVERDRAW_PX = 120;
/** A `height="auto"` sheet is capped at this fraction of the viewport. */
export const AUTO_HEIGHT_CAP = 0.9;
/** Release velocity is measured over the last this-many ms of the drag. */
export const VELOCITY_WINDOW_MS = 120;
/** Per-millisecond decay of a list still coasting after a sheet gesture
 *  (iOS "normal" deceleration). */
export const MOMENTUM_DECAY_PER_MS = 0.998;
/** Near-critically damped (ζ ≈ 1, mass 1): settles in ~0.4s from rest with
 *  no overshoot, and carries a release velocity without bouncing. */
export const SHEET_SPRING = { stiffness: 380, damping: 39 } as const;

const FRAME_MS = 1000 / 60;
const MAX_SPRING_FRAMES = 120;

export function snapY(snap: Snap, g: SheetGeometry): number {
  const def = Math.max(0, g.boxH - g.defaultVisibleH);
  switch (snap) {
    case "full":
      return g.expandable ? 0 : def;
    case "default":
      return def;
    case "dismissed":
      return g.boxH;
  }
}

/** The highest snap the sheet can rest at. */
export function topSnap(g: SheetGeometry): "full" | "default" {
  return g.expandable ? "full" : "default";
}

/** Scrim opacity at a position: fully dimmed from the default snap upward,
 *  fading out in lockstep with the sheet as it leaves the screen. */
export function scrimOpacity(y: number, g: SheetGeometry): number {
  if (g.defaultVisibleH <= 0) return 0;
  const visible = g.boxH - y;
  return Math.min(1, Math.max(0, visible / g.defaultVisibleH));
}

/** translateY for the pinned footer. Between full and default it cancels the
 *  sheet's own offset, so the footer stays on the screen bottom; below default
 *  it stops cancelling, and leaves with the sheet. */
export function footerOffset(y: number, g: SheetGeometry): number {
  const lift = Math.min(Math.max(y, 0), snapY("default", g));
  // Never -0: callers compare and serialise this.
  return lift === 0 ? 0 : -lift;
}

/** iOS-style resistance: the further past the limit, the less each pixel of
 *  finger movement moves the sheet. Signed; approaches ±dimension. */
export function rubberBand(overshoot: number, dimension: number): number {
  if (overshoot === 0 || dimension <= 0) return 0;
  const x = Math.abs(overshoot);
  const banded = dimension * (1 - 1 / ((x * RUBBER_COEFF) / dimension + 1));
  return Math.sign(overshoot) * banded;
}

/** Where a raw drag position is drawn: rubber-banded above the top snap,
 *  clamped at the dismissed snap. */
export function displayY(rawY: number, g: SheetGeometry): number {
  const top = snapY(topSnap(g), g);
  const bottom = snapY("dismissed", g);
  if (rawY < top) return top + rubberBand(rawY - top, g.viewportH);
  return Math.min(rawY, bottom);
}

/** Finger velocity (px/s, positive downward) over the last
 *  VELOCITY_WINDOW_MS of samples. 0 when there is not enough data. */
export function velocityFromSamples(samples: MoveSample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let oldest = samples[samples.length - 2];
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i].t <= VELOCITY_WINDOW_MS) oldest = samples[i];
    else break;
  }
  const dt = (last.t - oldest.t) / 1000;
  if (dt <= 0) return 0;
  return (last.y - oldest.y) / dt;
}

/** Which snap a release at `y` with `velocity` settles to. The release is
 *  projected forward and the nearest snap wins; a flick also always reaches
 *  at least the next snap in its direction, however short the drag. */
export function pickSnap(y: number, velocity: number, g: SheetGeometry): Snap {
  const snaps: Snap[] = g.expandable
    ? ["full", "default", "dismissed"]
    : ["default", "dismissed"];
  const projected = y + velocity * PROJECTION_S;
  let best = snaps[0];
  for (const s of snaps) {
    if (
      Math.abs(snapY(s, g) - projected) < Math.abs(snapY(best, g) - projected)
    ) {
      best = s;
    }
  }
  if (Math.abs(velocity) >= FLICK_PX_PER_S) {
    const dir = Math.sign(velocity);
    const ahead = snaps
      .filter((s) => (dir > 0 ? snapY(s, g) > y + 0.5 : snapY(s, g) < y - 0.5))
      .sort((a, b) => dir * (snapY(a, g) - snapY(b, g)));
    const next = ahead[0];
    if (next && dir * (snapY(best, g) - snapY(next, g)) < 0) best = next;
  }
  return best;
}

/** One value per frame of a damped spring from `from` to `to`, starting at
 *  velocity `v0` (px/s). The first value is `from` and the last is exactly
 *  `to`. */
export function springSamples(
  from: number,
  to: number,
  v0: number,
  frameMs = FRAME_MS,
): number[] {
  const { stiffness: k, damping: c } = SHEET_SPRING;
  const SUBSTEPS = 4;
  const h = frameMs / 1000 / SUBSTEPS;
  const values = [from];
  let x = from;
  let v = v0;
  for (let f = 1; f < MAX_SPRING_FRAMES; f++) {
    for (let i = 0; i < SUBSTEPS; i++) {
      // Semi-implicit Euler: update velocity first, then position with it.
      v += (-k * (x - to) - c * v) * h;
      x += v * h;
    }
    if (Math.abs(x - to) < 0.5 && Math.abs(v) < 10) break;
    values.push(x);
  }
  values.push(to);
  return values;
}

/** Values of a cubic-bezier ease from `from` to `to`, sampled at even
 *  progress steps one frame apart. Played over `durationMs`; the first value
 *  is `from` and the last is exactly `to`. */
export function easeSamples(
  from: number,
  to: number,
  durationMs: number,
  points: readonly [number, number, number, number],
  frameMs = FRAME_MS,
): number[] {
  const ease = cubicBezier(...points);
  const steps = Math.max(1, Math.ceil(durationMs / frameMs));
  const values: number[] = [];
  for (let i = 0; i <= steps; i++) {
    values.push(i === steps ? to : from + (to - from) * ease(i / steps));
  }
  return values;
}

export interface DistributeInput {
  /** Finger movement since the last move, px, positive downward. */
  delta: number;
  /** Raw (not rubber-banded) sheet position. */
  sheetY: number;
  /** The top snap's y: the sheet does not rise above this before the body
   *  takes the motion. */
  minY: number;
  scrollTop: number;
  maxScroll: number;
  /** Whether the body scrolls as part of this gesture. */
  bodyLinked: boolean;
}

/** Share one finger movement between the sheet and its list, the way native
 *  nested scrolling does. Up: the sheet rises to its top snap first, then the
 *  list scrolls, then the sheet overshoots. Down: an overshoot is taken back
 *  first, then the list scrolls to its top, then the sheet moves down.
 *  `mover` is whichever took the last part of the motion. */
export function distribute(i: DistributeInput): {
  sheetY: number;
  scrollTop: number;
  mover: "sheet" | "body" | null;
} {
  let { sheetY, scrollTop } = i;
  let rem = i.delta;
  let mover: "sheet" | "body" | null = null;
  if (rem < 0) {
    const take = Math.max(rem, Math.min(0, i.minY - sheetY));
    if (take < 0) {
      sheetY += take;
      rem -= take;
      mover = "sheet";
    }
    if (rem < 0 && i.bodyLinked) {
      const s = Math.max(0, Math.min(-rem, i.maxScroll - scrollTop));
      if (s > 0) {
        scrollTop += s;
        rem += s;
        mover = "body";
      }
    }
    if (rem < 0) {
      sheetY += rem;
      mover = "sheet";
    }
  } else if (rem > 0) {
    const back = Math.min(rem, Math.max(0, i.minY - sheetY));
    if (back > 0) {
      sheetY += back;
      rem -= back;
      mover = "sheet";
    }
    if (rem > 0 && i.bodyLinked) {
      const s = Math.max(0, Math.min(rem, scrollTop));
      if (s > 0) {
        scrollTop -= s;
        rem -= s;
        mover = "body";
      }
    }
    if (rem > 0) {
      sheetY += rem;
      mover = "sheet";
    }
  }
  return { sheetY, scrollTop, mover };
}
