import { describe, expect, it } from "vitest";
import {
  createLineBank,
  glideFrame,
  glideStep,
  wheelDeltaToPixels,
} from "./lineScroll";

const LINE = 27.2; // the reader's real line box at fontSize 17 / lineHeight 1.6

describe("wheelDeltaToPixels", () => {
  it("passes pixel deltas through", () => {
    expect(wheelDeltaToPixels(13, 0)).toBe(13);
    expect(wheelDeltaToPixels(13)).toBe(13);
  });

  it("reads line-mode deltas as lines", () => {
    // A deltaY of 3 in line mode is about a notch, not 3px. Treated as pixels
    // it is below every sane threshold and the surface barely moves.
    expect(wheelDeltaToPixels(3, 1)).toBe(120);
  });

  it("reads page-mode deltas as pages", () => {
    expect(wheelDeltaToPixels(1, 2)).toBe(400);
  });
});

describe("glideStep", () => {
  it("closes a fraction of the gap each frame", () => {
    expect(glideStep(0, 100, 0.25)).toBe(25);
    expect(glideStep(25, 100, 0.25)).toBe(43.75);
  });

  it("lands exactly rather than crawling", () => {
    // Without this an exponential glide never arrives, and the loop never
    // stands down.
    expect(glideStep(99.9, 100, 0.22, 0.5)).toBe(100);
  });

  it("works in both directions", () => {
    expect(glideStep(100, 0, 0.25)).toBe(75);
  });

  it("converges in a bounded number of frames", () => {
    let at = 0;
    let frames = 0;
    while (at !== 1000 && frames < 200) {
      at = glideStep(at, 1000);
      frames += 1;
    }
    expect(at).toBe(1000);
    // ~35 frames at 60fps is a little over half a second for a huge jump;
    // an ordinary notch settles in a handful.
    expect(frames).toBeLessThan(60);
  });
});

describe("createLineBank", () => {
  it("spends nothing until a whole line has accumulated", () => {
    // The bug this exists to prevent: a 13px notch is 0.48 of a line, and
    // quantising it on its own yields zero — for ever. Measured before the
    // fix: twelve slow notches moved the page 0px against native's 156px.
    const bank = createLineBank();
    expect(bank.spend(13, LINE)).toBe(0); // 13 banked
    expect(bank.spend(13, LINE)).toBe(0); // 26 banked, still under a line
    expect(bank.spend(13, LINE)).toBeCloseTo(LINE, 5); // 39 → one line, 11.8 kept
  });

  it("preserves the total distance the device asked for", () => {
    const bank = createLineBank();
    let moved = 0;
    for (let i = 0; i < 12; i += 1) moved += bank.spend(13, LINE);
    const asked = 12 * 13;
    // Everything except the unspent remainder, which is under one line.
    expect(moved).toBeLessThanOrEqual(asked);
    expect(asked - moved).toBeLessThan(LINE);
    expect(moved % LINE).toBeCloseTo(0, 5);
  });

  it("spends several lines at once on a burst", () => {
    const bank = createLineBank();
    expect(bank.spend(209, LINE)).toBeCloseTo(LINE * 7, 5);
  });

  it("banks in both directions", () => {
    const bank = createLineBank();
    expect(bank.spend(-13, LINE)).toBe(0);
    expect(bank.spend(-13, LINE)).toBe(0);
    expect(bank.spend(-13, LINE)).toBeCloseTo(-LINE, 5);
  });

  it("does not swallow travel when reversing", () => {
    // Scroll down half a line, then back up: the reader should end where they
    // started, not half a line adrift.
    const bank = createLineBank();
    bank.spend(13, LINE);
    expect(bank.spend(-13, LINE)).toBe(0);
    expect(bank.spend(-LINE, LINE)).toBeCloseTo(-LINE, 5);
  });

  it("passes travel straight through with no line box", () => {
    const bank = createLineBank();
    expect(bank.spend(37, 0)).toBe(37);
  });

  it("forgets banked travel on reset", () => {
    const bank = createLineBank();
    bank.spend(20, LINE);
    bank.reset();
    expect(bank.spend(13, LINE)).toBe(0);
  });
});

/** A scroller that stores whole pixels, the way a real one does.
 *
 *  The two engines this app ships on disagree about HOW: Chromium rounds
 *  (300.4 -> 300, 300.5 -> 301) while WebKit truncates (300.9 -> 300). Both
 *  are exercised below, because both stall a glide and they stall it by
 *  different distances — truncation needs a step of a whole pixel to move at
 *  all, so it stalls more than twice as far out. Measured in both engines. */
function scroller(quantise: (v: number) => number, from = 0) {
  let position = quantise(from);
  return {
    get position() {
      return position;
    },
    write(v: number) {
      position = quantise(v);
      return position;
    },
  };
}

const ENGINES: [string, (v: number) => number][] = [
  ["Chromium rounds", Math.round],
  ["WebKit truncates", Math.floor],
];

describe("glideFrame", () => {
  it.each(ENGINES)(
    "comes to rest on a line target, and says so (%s)",
    (_engine, quantise) => {
      // Every line target is fractional — each is a multiple of a 27.2px line
      // box. glideStep alone never reaches one: its step is 22% of the
      // remaining gap, which stops changing a whole-pixel scroller while the
      // gap is still 1.5-2px (Chromium) or 3.6-4.5px (WebKit). The reader then
      // rests visibly off the line it was aiming for, and because the pump's
      // idle test is `scrollTop === target`, which never becomes true, its
      // requestAnimationFrame loop also runs for ever.
      const target = LINE * 15;
      const s = scroller(quantise, 300);
      let state = { position: s.position, target };
      let frames = 0;
      while (state.position !== state.target && frames < 200) {
        state = glideFrame(state.position, state.target, (v) => s.write(v));
        frames += 1;
      }

      expect(frames).toBeLessThan(200);
      // Rests as close to the line as a whole-pixel scroller can get...
      expect(Math.abs(s.position - target)).toBeLessThan(1);
      // ...and reports that as the target, so the caller's equality test goes
      // true and its animation loop can stand down.
      expect(state.position).toBe(state.target);
    },
  );

  it("glides toward a far target rather than jumping to it", () => {
    // The landing rule must not fire while there is real distance to cover,
    // or every scroll becomes a teleport.
    const s = scroller(Math.round, 0);
    const state = glideFrame(0, 1000, (v) => s.write(v));
    expect(state.position).toBe(220); // 22% of the gap
    expect(state.target).toBe(1000); // still heading there
  });

  it("lands immediately when motion is reduced", () => {
    const s = scroller(Math.round, 0);
    const state = glideFrame(0, LINE * 15, (v) => s.write(v), true);
    expect(state.position).toBe(408);
    expect(state.position).toBe(state.target);
  });
});
