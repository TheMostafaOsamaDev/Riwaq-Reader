// Line-aware scrolling for the reading surface.
//
// The reader used to do nothing at all to wheel input — no smoothing, and no
// `scroll-behavior` on the reading surface — so whatever the webview did
// natively was what the reader got. Measured against the real line box
// (27.2px at fontSize 17 / lineHeight 1.6), the device in use produced:
//
//   12-13px per event scrolling slowly       = 0.44-0.48 of a line
//   104-209px per event in a momentum burst, 17ms apart = 3.8-7.7 lines
//
// So slow scrolling left the text grid permanently misaligned, with the top and
// bottom lines half-cut and the eye's anchor drifting by fractions of a line,
// while a flick moved 230-460 lines a second — a blur rather than a scroll.
//
// Two independent fixes, measured separately against the real line box:
//
//   easing    glides to the target instead of applying each delta whole.
//             Worst single-frame movement 209px -> 55px.
//   banking   spends only whole lines, so the glide's target is always on one
//             and the page arrives aligned rather than being tugged into
//             place after the reader has already stopped.
//
// Quantising ALONE is worse than doing nothing for the blur (77px mean per
// frame against native's 52), which is worth knowing because "just snap to
// lines" is the obvious naive fix. Both together is what reads well.
//
// What is deliberately NOT here any more is a settle: a move that begins after
// the reader has stopped scrolling. Mobile used to glide onto the nearest line
// once a fling ended, and it was removed because a move nobody asked for is
// the one move everybody notices.
//
// Worth knowing before adding any line-alignment back, because it is the
// obvious thing to reach for and it does not work: rounding a position to a
// multiple of the line box measured from scrollTop 0 aligns to a grid the text
// is not on. BookBody gives each paragraph a 1.1em margin against a 1.6em line
// box — 18.7px against 27.2px, not a multiple — so the REAL lines walk off
// that grid from the second paragraph on. Measured drift across the first four
// paragraphs: 3, 11.6, 7.1, 1.5px, against a half line of 13.6. Align to
// measured line tops (Range.getClientRects) or not at all.
//
// Everything here is pure — glideFrame touches the scroller only through a
// writer its caller passes in. The DOM wiring lives in useLineScroll.

/** How much of the remaining gap a glide closes each frame. */
export const GLIDE_FACTOR = 0.22;
/** Below this the glide lands exactly, rather than crawling toward the target. */
export const GLIDE_SETTLE_PX = 0.5;

/**
 * Wheel deltas do not arrive in one unit. `deltaMode` says which: 0 pixels,
 * 1 lines, 2 pages. A line-mode device reports a deltaY of about 1-3 where a
 * pixel-mode one reports 100+, so treating the raw number as pixels makes a
 * device's scrolling either inert or unusably fast. Chromium reports pixels,
 * which is exactly why this is easy to get wrong and never notice in a
 * browser.
 */
export function wheelDeltaToPixels(deltaY: number, deltaMode = 0): number {
  if (deltaMode === 1) return deltaY * 40; // Chromium's own lines→px factor
  if (deltaMode === 2) return deltaY * 400; // a page, roughly a viewport
  return deltaY;
}

/** One frame of exponential glide toward `target`. */
export function glideStep(
  current: number,
  target: number,
  factor = GLIDE_FACTOR,
  settlePx = GLIDE_SETTLE_PX,
): number {
  const gap = target - current;
  if (Math.abs(gap) <= settlePx) return target;
  return current + gap * factor;
}

export interface GlideFrameState {
  /** Where the scroller is now. */
  position: number;
  /** Where it is still heading — equal to `position` once it has landed. */
  target: number;
}

/**
 * One frame of glide against a real scroller, which stores whole pixels.
 *
 * `glideStep` alone cannot land on a line. Every line target is a multiple of
 * the line box (27.2px at the default settings) and so fractional, while a
 * scroller only holds whole pixels — and the two engines this app ships on
 * disagree about how: Chromium ROUNDS (300.4 -> 300, 300.5 -> 301), WebKit
 * TRUNCATES (300.9 -> 300). Either way a step of 22% of the remaining gap
 * eventually becomes too small to change the stored value, and the glide stops
 * advancing while still short of the line it was aiming for: measured 1.5-2px
 * short in Chromium, 3.6-4.5px in WebKit, which needs a whole pixel of step to
 * move at all.
 *
 * That has two costs. The reader rests visibly off the line, so the feature
 * does not do the one thing it exists to do. And the pump's idle test is
 * `scrollTop === target`, which a target the scroller cannot store never
 * satisfies, so `idle` never counts up and the requestAnimationFrame loop runs
 * for ever after the reader has visibly stopped.
 *
 * Rather than model either engine's rounding — which would be wrong on one of
 * them — this WATCHES. `write` assigns a position and returns what the
 * scroller reads back; if that did not move, the step was below the grain, so
 * we land on the target and adopt whatever the scroller stored. The adopted
 * value is as close to the line as that engine can get, and reporting it as
 * the target is what lets the caller's equality test go true and its loop
 * stand down.
 */
export function glideFrame(
  current: number,
  target: number,
  write: (value: number) => number,
  reduced = false,
): GlideFrameState {
  const next = reduced ? target : glideStep(current, target);
  const moved = write(next);
  if (moved !== current) return { position: moved, target };
  const landed = write(target);
  return { position: landed, target: landed };
}

export interface LineBank {
  /**
   * Add raw travel, and get back the whole-line distance that can be spent
   * now. The remainder is kept for next time.
   */
  spend(px: number, lineBox: number): number;
  reset(): void;
}

/**
 * Banks sub-line travel so quantised scrolling still moves the exact distance
 * the device asked for.
 *
 * Quantising each event on its own does not work, and fails in the worst
 * possible way: this machine's slow scroll is 13px, which rounds to zero whole
 * lines, and since the glide keeps the frame loop alive the next event rounds
 * from the same unmoved target and also gives zero — for ever. Measured before
 * the fix: twelve slow notches moved the page 0px where native moved 156px. Banking the remainder means the reader's total travel is
 * preserved to the pixel while only the resting position is on a line.
 */
export function createLineBank(): LineBank {
  let banked = 0;
  return {
    spend(px, lineBox) {
      if (!(lineBox > 0)) return px;
      banked += px;
      const lines = Math.trunc(banked / lineBox);
      banked -= lines * lineBox;
      return lines === 0 ? 0 : lines * lineBox;
    },
    reset() {
      banked = 0;
    },
  };
}

/**
 * The line box of the text inside a scroller, read from what is actually
 * rendered rather than recomputed from fontSize × lineHeight — the two do not
 * always agree once a font's own metrics are involved.
 *
 * Returns 0 when there is nothing to measure, which callers treat as "do not
 * quantise" rather than guessing a value.
 */
export function measureLineBox(scroller: Element | null): number {
  const p = scroller?.querySelector("p");
  if (!p) return 0;
  const lh = parseFloat(getComputedStyle(p).lineHeight);
  return Number.isFinite(lh) && lh > 0 ? lh : 0;
}
