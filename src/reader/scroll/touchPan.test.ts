import { describe, expect, it } from "vitest";
import { TOUCH_SLOP } from "../gestureAxis";
import {
  MAX_FLING_VELOCITY,
  MIN_FLING_VELOCITY,
  TAKE_DISTANCE,
  createPanGesture,
  flingOffset,
  planFling,
  releaseVelocity,
} from "./touchPan";

describe("planFling", () => {
  it("does not fling a release slower than the platform's minimum", () => {
    expect(planFling(MIN_FLING_VELOCITY - 1)).toBeNull();
    expect(planFling(-(MIN_FLING_VELOCITY - 1))).toBeNull();
    expect(planFling(0)).toBeNull();
  });

  it("travels in the direction of the release", () => {
    expect(planFling(2000)?.distance).toBeGreaterThan(0);
    expect(planFling(-2000)?.distance).toBeLessThan(0);
  });

  it("caps the launch at the platform's maximum", () => {
    expect(planFling(MAX_FLING_VELOCITY * 3)).toEqual(
      planFling(MAX_FLING_VELOCITY),
    );
  });

  it("goes further, for longer, the harder the release", () => {
    const soft = planFling(800);
    const hard = planFling(4000);
    expect(soft && hard).toBeTruthy();
    if (!soft || !hard) return;
    expect(Math.abs(hard.distance)).toBeGreaterThan(Math.abs(soft.distance));
    expect(hard.durationMs).toBeGreaterThan(soft.durationMs);
  });

  // The property that makes a fling feel attached to the finger: the page
  // leaves the glass at the speed the finger did. A curve that launched
  // slower would visibly brake at the moment of release; faster, and the page
  // would lurch away from under the thumb.
  it("launches at the speed of the release", () => {
    for (const v of [300, 1200, 3000, 6000]) {
      const plan = planFling(v);
      expect(plan).not.toBeNull();
      if (!plan) return;
      const dt = 2; // ms
      const launch = (flingOffset(plan, dt) / dt) * 1000;
      expect(Math.abs(launch - v) / v).toBeLessThan(0.05);
    }
  });

  // The launch property above holds for ANY friction coefficient, so it cannot
  // catch a curve that brakes too hard or coasts too far — mixing up dp and
  // device pixels, say, which would make every fling 2.6x longer on a phone.
  // Worked by hand from SplineOverScroller's formula at density 1:
  //   l = ln(0.35 * 1000 / (0.015 * 9.80665 * 39.37 * 160 * 0.84)) = -0.7992
  //   duration = 1000 * e^(l / 1.3585) = 555ms
  //   distance = 778.35 * e^(2.3585 / 1.3585 * l) = 194.3px
  it("matches Android's own fling for a 1000 dp/s release", () => {
    const plan = planFling(1000);
    expect(plan?.durationMs).toBeCloseTo(555, 0);
    expect(plan?.distance).toBeCloseTo(194.3, 0);
  });

  it("starts at 0, ends exactly on its distance, and never runs backwards", () => {
    const plan = planFling(2500);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(flingOffset(plan, 0)).toBe(0);
    expect(flingOffset(plan, plan.durationMs)).toBeCloseTo(plan.distance, 6);
    expect(flingOffset(plan, plan.durationMs * 5)).toBeCloseTo(
      plan.distance,
      6,
    );
    let last = 0;
    for (let t = 0; t <= plan.durationMs; t += 4) {
      const now = flingOffset(plan, t);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });
});

describe("releaseVelocity", () => {
  const steady = (vPxPerMs: number, until: number, every = 8) => {
    const out: { t: number; y: number }[] = [];
    for (let t = 0; t <= until; t += every)
      out.push({ t, y: 500 + vPxPerMs * t });
    return out;
  };

  it("reads a steady finger's speed in px/s", () => {
    expect(releaseVelocity(steady(-2, 200), 200)).toBeCloseTo(-2000, 0);
    expect(releaseVelocity(steady(1.5, 200), 200)).toBeCloseTo(1500, 0);
  });

  it("is zero when the finger stopped before it lifted", () => {
    // Moving until 200ms, then resting for 80ms before release: a reader who
    // stops to read and then lifts must not get a fling.
    expect(releaseVelocity(steady(-2, 200), 280)).toBe(0);
  });

  it("only weighs the last stretch of the gesture", () => {
    // Slow for most of the drag, then fast at the end: the release is fast.
    const samples = steady(-0.2, 400);
    const lastY = samples[samples.length - 1].y;
    for (let t = 408; t <= 480; t += 8) {
      samples.push({ t, y: lastY - 3 * (t - 400) });
    }
    expect(releaseVelocity(samples, 480)).toBeLessThan(-2500);
  });

  it("is zero with fewer than two samples", () => {
    expect(releaseVelocity([], 10)).toBe(0);
    expect(releaseVelocity([{ t: 0, y: 1 }], 0)).toBe(0);
  });
});

describe("createPanGesture", () => {
  it("stays out of a gesture the browser takes", () => {
    const g = createPanGesture();
    g.down(200, 500, 0);
    expect(g.move(200, 490, 8)).toBe(0);
    g.cancel(); // pointercancel: the browser started its own scroll
    expect(g.move(200, 470, 16)).toBe(0);
    expect(g.move(200, 450, 24)).toBe(0);
    expect(g.up(32)).toBe(0);
    expect(g.state).toBe("idle");
  });

  it("waits one event past the take distance before taking over", () => {
    // The browser decides at ITS touch slop and cancels the pointer before the
    // next pointermove, so a move that arrives after one already this far out
    // proves the browser declined.
    const g = createPanGesture();
    g.down(200, 500, 0);
    expect(g.move(200, 500 - (TAKE_DISTANCE + 2), 8)).toBe(0);
    expect(g.state).toBe("pending");
    expect(g.move(200, 500 - (TAKE_DISTANCE + 12), 16)).not.toBe(0);
    expect(g.state).toBe("panning");
  });

  it("then follows the finger 1:1, less the slop, so nothing jumps", () => {
    const g = createPanGesture();
    g.down(200, 500, 0);
    g.move(200, 480, 8);
    // Taken here: the finger is 30px up; the page moves 30 - slop.
    expect(g.move(200, 470, 16)).toBe(30 - TOUCH_SLOP);
    // From now on every px of finger is a px of page.
    expect(g.move(200, 460, 24)).toBe(10);
    expect(g.move(200, 465, 32)).toBe(-5);
  });

  it("scrolls a swipe that started sideways by its vertical travel", () => {
    // The gesture the browser drops: first movement leans past 45 degrees.
    const g = createPanGesture();
    g.down(200, 500, 0);
    expect(g.move(217, 496, 8)).toBe(0); // past the take distance: armed
    expect(g.move(230, 492, 16)).toBe(0); // taken, but vertical travel = slop
    expect(g.state).toBe("panning");
    expect(g.move(232, 472, 24)).toBe(28 - TOUCH_SLOP);
    expect(g.move(233, 452, 32)).toBe(20);
  });

  it("hands the release velocity to the page as scroll velocity", () => {
    const g = createPanGesture();
    g.down(200, 800, 0);
    let y = 800;
    for (let t = 8; t <= 160; t += 8) {
      y -= 16; // finger up at 2px/ms
      g.move(200, y, t);
    }
    // Finger moving up = content moving towards the end = scrollTop rising.
    expect(g.up(160)).toBeCloseTo(2000, -1);
  });

  it("gives no velocity for a gesture it never took", () => {
    const g = createPanGesture();
    g.down(200, 500, 0);
    g.move(203, 498, 8);
    expect(g.up(16)).toBe(0);
  });

  it("leaves a sideways drag alone when told the control owns that axis", () => {
    // Started on the chapter slider: sideways is a scrub, not a scroll, and
    // the page must not ride the finger's vertical wobble while it scrubs.
    const g = createPanGesture();
    g.down(200, 850, 0, { verticalOnly: true });
    g.move(210, 848, 8);
    expect(g.state).toBe("idle");
    expect(g.move(240, 830, 16)).toBe(0);
    expect(g.move(260, 800, 24)).toBe(0);
    expect(g.up(32)).toBe(0);
  });

  it("still takes a vertical drag from a control that owns the other axis", () => {
    const g = createPanGesture();
    g.down(200, 850, 0, { verticalOnly: true });
    g.move(202, 840, 8);
    g.move(203, 825, 16);
    expect(g.move(204, 810, 24)).toBe(40 - TOUCH_SLOP);
    expect(g.state).toBe("panning");
  });

  it("forgets everything on the next down", () => {
    const g = createPanGesture();
    g.down(200, 500, 0);
    g.move(200, 470, 8);
    g.move(200, 440, 16);
    expect(g.state).toBe("panning");
    g.down(100, 300, 400);
    expect(g.state).toBe("pending");
    expect(g.move(100, 295, 408)).toBe(0);
  });
});
