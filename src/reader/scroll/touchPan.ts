/**
 * A pan the browser declined, and the fling that follows it.
 *
 * The phone reader scrolls natively: the compositor moves the page and flings
 * it, which is the smoothest thing a WebView can do. But Chromium only takes
 * a touch gesture it believes is a vertical scroll, and it decides once, at
 * the touch slop, from the direction of that first few pixels:
 *
 *   - `touch-action: pan-y` (the page) drops any gesture whose first movement
 *     leans more than 45 degrees sideways. A thumb arcs, so a flick that is
 *     unmistakably "scroll down" often starts that way. Measured on the
 *     emulator: 44 degrees moved the page 264px, 46 degrees moved it 0 — for
 *     the WHOLE swipe, although the next 260px of travel were straight up.
 *   - Relaxing touch-action does not rescue it. Past ~50 degrees Chromium
 *     rails the gesture to the horizontal axis, finds nothing that scrolls
 *     sideways, and the swipe goes nowhere with the pointer already cancelled.
 *   - A swipe that starts on the reader's floating bars is not inside the
 *     scroller at all, so there is nothing for the browser to scroll.
 *
 * A native Android ScrollView has none of these holes: it starts dragging as
 * soon as the finger has moved a slop's worth vertically, whatever it did
 * sideways. This module gives the reader the same rule for exactly the
 * gestures the browser turns down, and leaves every other one native.
 *
 * How it knows the browser declined: when Chromium takes a gesture it cancels
 * the pointer (`pointercancel`) at its own slop, before the next pointermove.
 * So a pointermove that arrives after one already TAKE_DISTANCE out, with no
 * cancel in between, proves nobody else is moving the page. That costs one
 * touch sample of latency, and the page then catches up with the finger in
 * one step less the slop, exactly as a native drag does.
 *
 * The fling is Android's own curve (SplineOverScroller), so a page flung this
 * way decelerates the way a natively flung one does, and leaves the finger at
 * the finger's speed. Pure — the DOM wiring is touchPanFallback.ts.
 */

import { TOUCH_SLOP, gestureAxis } from "../gestureAxis";

/** How far out a pointermove must follow before this takes the gesture. Twice
 *  the slop, so that whatever the platform's exact slop, the browser has
 *  already had its chance to claim the gesture. */
export const TAKE_DISTANCE = 16;

/** ViewConfiguration's minimum and maximum fling velocities, in dp/s. */
export const MIN_FLING_VELOCITY = 50;
export const MAX_FLING_VELOCITY = 8000;

/** Android's VelocityTracker ignores samples older than this... */
const VELOCITY_HORIZON_MS = 100;
/** ...and treats a finger that has not moved for this long as stopped. */
const ASSUME_STOPPED_MS = 40;

// ── The fling curve ─────────────────────────────────────────────────────────
//
// A port of android.widget.OverScroller.SplineOverScroller. The numbers are
// Android's, not tuning: they are what make this indistinguishable from the
// native fling beside it.

const DECELERATION_RATE = Math.log(0.78) / Math.log(0.9);
const INFLEXION = 0.35;
const START_TENSION = 0.5;
const END_TENSION = 1.0;
const P1 = START_TENSION * INFLEXION;
const P2 = 1.0 - END_TENSION * (1.0 - INFLEXION);
/** ViewConfiguration.getScrollFriction(). */
const FLING_FRICTION = 0.015;
/** g × inches per metre × ppi × Android's "look and feel" factor, with the
 *  ppi of a 1-density screen, because velocities here are CSS px (= dp). */
const PHYSICAL_COEFF = 9.80665 * 39.37 * 160 * 0.84;

const NB_SAMPLES = 100;
const SPLINE_POSITION: number[] = (() => {
  const out = new Array<number>(NB_SAMPLES + 1);
  let xMin = 0;
  for (let i = 0; i < NB_SAMPLES; i++) {
    const alpha = i / NB_SAMPLES;
    let xMax = 1;
    let x = 0;
    let coef = 0;
    for (;;) {
      x = xMin + (xMax - xMin) / 2;
      coef = 3 * x * (1 - x);
      const tx = coef * ((1 - x) * P1 + x * P2) + x * x * x;
      if (Math.abs(tx - alpha) < 1e-5) break;
      if (tx > alpha) xMax = x;
      else xMin = x;
    }
    out[i] = coef * ((1 - x) * START_TENSION + x) + x * x * x;
  }
  out[NB_SAMPLES] = 1;
  return out;
})();

export interface FlingPlan {
  /** Total travel, px. Positive = scrollTop rising. */
  distance: number;
  durationMs: number;
}

/** The fling a release at `velocity` (px/s) would make, or null when the
 *  release is too slow to fling at all. */
export function planFling(velocity: number): FlingPlan | null {
  const speed = Math.min(Math.abs(velocity), MAX_FLING_VELOCITY);
  if (speed < MIN_FLING_VELOCITY) return null;
  const sign = Math.sign(velocity);
  const l = Math.log((INFLEXION * speed) / (FLING_FRICTION * PHYSICAL_COEFF));
  const decelMinusOne = DECELERATION_RATE - 1;
  return {
    distance:
      sign *
      FLING_FRICTION *
      PHYSICAL_COEFF *
      Math.exp((DECELERATION_RATE / decelMinusOne) * l),
    durationMs: 1000 * Math.exp(l / decelMinusOne),
  };
}

/** How far (signed px) the fling has carried the page `elapsedMs` in. */
export function flingOffset(plan: FlingPlan, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= plan.durationMs) return plan.distance;
  const t = elapsedMs / plan.durationMs;
  const index = Math.floor(NB_SAMPLES * t);
  const tInf = index / NB_SAMPLES;
  const dInf = SPLINE_POSITION[index];
  const dSup = SPLINE_POSITION[index + 1];
  const coef = dInf + (t - tInf) * NB_SAMPLES * (dSup - dInf);
  return coef * plan.distance;
}

// ── Release velocity ────────────────────────────────────────────────────────

export interface PanSample {
  t: number;
  y: number;
}

/** The finger's vertical velocity at release, px/s (negative = moving up):
 *  a least-squares line through the last VELOCITY_HORIZON_MS of samples, or 0
 *  when the finger had stopped before it lifted.
 *
 *  Not sheetSnap's `velocityFromSamples`, which takes the window's two ends:
 *  that is enough to pick a snap point, but a fling launches at exactly this
 *  number, so one jittery end sample would throw the page, and a finger that
 *  paused before lifting must not throw it at all. */
export function releaseVelocity(samples: PanSample[], upT: number): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  if (upT - last.t > ASSUME_STOPPED_MS) return 0;
  const recent = samples.filter((s) => s.t >= last.t - VELOCITY_HORIZON_MS);
  if (recent.length < 2) return 0;
  let st = 0;
  let sy = 0;
  for (const s of recent) {
    st += s.t;
    sy += s.y;
  }
  const mt = st / recent.length;
  const my = sy / recent.length;
  let num = 0;
  let den = 0;
  for (const s of recent) {
    num += (s.t - mt) * (s.y - my);
    den += (s.t - mt) * (s.t - mt);
  }
  if (den === 0) return 0;
  return (num / den) * 1000;
}

// ── The gesture ─────────────────────────────────────────────────────────────

export type PanState = "idle" | "pending" | "panning";

export interface PanDownOptions {
  /** The gesture started on a control that owns sideways drags (the chapter
   *  slider): take it only if it turns out vertical. */
  verticalOnly?: boolean;
}

export interface PanGesture {
  readonly state: PanState;
  down(x: number, y: number, t: number, options?: PanDownOptions): void;
  /** Returns how far to scroll NOW (px, positive = scrollTop rising); 0 while
   *  undecided, or when the gesture belongs to the browser. */
  move(x: number, y: number, t: number): number;
  /** The browser (or the system) took the pointer. */
  cancel(): void;
  /** Returns the page's scroll velocity at release (px/s), 0 for none. */
  up(t: number): number;
}

export function createPanGesture(): PanGesture {
  let state: PanState = "idle";
  let x0 = 0;
  let y0 = 0;
  /** A previous move was already TAKE_DISTANCE out. */
  let armed = false;
  let verticalOnly = false;
  /** Once scrolling, the finger y the last delta was measured to. */
  let lastY: number | null = null;
  let samples: PanSample[] = [];

  return {
    get state() {
      return state;
    },
    down(x, y, t, options) {
      state = "pending";
      x0 = x;
      y0 = y;
      armed = false;
      verticalOnly = options?.verticalOnly ?? false;
      lastY = null;
      samples = [{ t, y }];
    },
    move(x, y, t) {
      if (state === "idle") return 0;
      samples.push({ t, y });
      if (samples.length > 32) samples.shift();
      if (state === "pending") {
        if (verticalOnly) {
          const axis = gestureAxis(x - x0, y - y0);
          if (axis === "x") {
            state = "idle";
            return 0;
          }
          // Decided vertical: from here it is an ordinary drag.
          if (axis === "y") verticalOnly = false;
        }
        if (!armed) {
          if (Math.hypot(x - x0, y - y0) >= TAKE_DISTANCE) armed = true;
          return 0;
        }
        state = "panning";
      }
      if (lastY === null) {
        const dy = y - y0;
        // A native vertical drag starts once the finger has moved a slop's
        // worth vertically, whatever it did sideways — and starts from the
        // slop's edge, so the page does not jump by the slop.
        if (Math.abs(dy) <= TOUCH_SLOP) return 0;
        lastY = y0 + Math.sign(dy) * TOUCH_SLOP;
      }
      const delta = lastY - y;
      lastY = y;
      return delta;
    },
    cancel() {
      state = "idle";
    },
    up(t) {
      const scrolled = state === "panning" && lastY !== null;
      state = "idle";
      if (!scrolled) return 0;
      // The finger moving up (negative y velocity) carries the page towards
      // its end, which is scrollTop rising.
      return -releaseVelocity(samples, t);
    },
  };
}
