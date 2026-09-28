// @vitest-environment happy-dom
//
// The wiring of the pan fallback: which gestures it takes, what it writes to
// the scroller, and when it lets go. The gesture arithmetic and the fling
// curve are covered in touchPan.test.ts; what is proved here is that real
// pointer events drive them, against a real scroller, that the markup
// (`data-pan-zone`, `data-pan-axis`) decides what is a candidate, and that the
// fallback stays out of everything it should.
//
// happy-dom has no layout, so the scroller's extent is defined by hand, and
// animation frames are pumped by the test so a fling can be stepped through.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachTouchPanFallback } from "./touchPanFallback";

const SCROLL_HEIGHT = 5000;
const CLIENT_HEIGHT = 800;
const MAX = SCROLL_HEIGHT - CLIENT_HEIGHT;

type Point = [x: number, y: number, t: number];

let root: HTMLDivElement;
let scroller: HTMLDivElement;
let text: HTMLParagraphElement;
let bar: HTMLDivElement;
let slider: HTMLDivElement;
let elsewhere: HTMLDivElement;
let detach: () => void;
let blocked = false;
let frames: (FrameRequestCallback | null)[] = [];
const realRaf = window.requestAnimationFrame;
const realCaf = window.cancelAnimationFrame;

/** Run queued frames every `step` ms from `from` until none are left. Returns
 *  the time it stopped at; `onFrame` sees the scroller after each frame. */
function pumpUntilIdle(from: number, onFrame?: () => void, step = 8) {
  let t = from;
  for (let i = 0; i < 400 && frames.some(Boolean); i++) {
    t += step;
    const batch = frames;
    frames = [];
    for (const cb of batch) cb?.(t);
    onFrame?.();
  }
  return t;
}

function pointer(
  target: Element,
  type: string,
  [x, y, t]: Point,
  pointerType = "touch",
) {
  const e = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 3,
    pointerType,
    isPrimary: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(e, "timeStamp", { value: t });
  target.dispatchEvent(e);
}

/** down, the moves, and up `restMs` after the last move. Returns the up time. */
function swipe(
  target: Element,
  path: Point[],
  restMs: number,
  pointerType = "touch",
) {
  const [first, ...rest] = path;
  pointer(target, "pointerdown", first, pointerType);
  for (const p of rest) pointer(target, "pointermove", p, pointerType);
  const [x, y, t] = path[path.length - 1];
  pointer(target, "pointerup", [x, y, t + restMs], pointerType);
  return t + restMs;
}

/** Straight up at 2px/ms from (x, y), released in motion. */
const flick = (x = 200, y = 700): Point[] => {
  const path: Point[] = [[x, y, 0]];
  for (let t = 8; t <= 120; t += 8) path.push([x, y - 2 * t, t]);
  return path;
};

/** Straight up at a gentle pace, lifted after a rest: moves the page, no fling. */
const drag = (x = 200, y = 500): Point[] => [
  [x, y, 0],
  [x, y - 30, 8],
  [x, y - 60, 16],
  [x, y - 90, 24],
];

beforeEach(() => {
  frames = [];
  window.requestAnimationFrame = (cb) => frames.push(cb);
  window.cancelAnimationFrame = (id) => {
    frames[id - 1] = null;
  };
  blocked = false;
  root = document.createElement("div");
  scroller = document.createElement("div");
  text = document.createElement("p");
  bar = document.createElement("div");
  bar.setAttribute("data-pan-zone", "");
  slider = document.createElement("div");
  slider.setAttribute("data-pan-axis", "x");
  bar.appendChild(slider);
  elsewhere = document.createElement("div");
  scroller.appendChild(text);
  root.append(scroller, bar, elsewhere);
  document.body.appendChild(root);
  Object.defineProperty(scroller, "scrollHeight", { value: SCROLL_HEIGHT });
  Object.defineProperty(scroller, "clientHeight", { value: CLIENT_HEIGHT });
  // happy-dom stores whatever it is given; a real scroller clamps.
  let top = 0;
  Object.defineProperty(scroller, "scrollTop", {
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(MAX, v));
    },
  });
  scroller.scrollTop = 1000;
  detach = attachTouchPanFallback(root, scroller, () => blocked);
});

afterEach(() => {
  detach();
  root.remove();
  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCaf;
});

describe("attachTouchPanFallback", () => {
  it("scrolls the page for a swipe the browser declined", () => {
    // Leans sideways first — the gesture Chromium's pan-y drops — then goes up.
    swipe(
      text,
      [
        [200, 500, 0],
        [217, 496, 8],
        [230, 492, 16],
        [232, 472, 24],
        [233, 452, 32],
      ],
      100, // lifted after a rest: no fling
    );
    expect(scroller.scrollTop).toBe(1000 + 20 + 20);
    expect(frames.some(Boolean)).toBe(false);
  });

  it("never touches a gesture the browser took", () => {
    pointer(text, "pointerdown", [200, 500, 0]);
    pointer(text, "pointermove", [200, 490, 8]);
    pointer(text, "pointercancel", [200, 490, 9]);
    pointer(text, "pointermove", [200, 460, 16]);
    pointer(text, "pointermove", [200, 430, 24]);
    pointer(text, "pointerup", [200, 430, 32]);
    expect(scroller.scrollTop).toBe(1000);
    expect(frames.some(Boolean)).toBe(false);
  });

  it("scrolls the page for a swipe that starts on a zone outside it", () => {
    swipe(bar, drag(), 100);
    expect(scroller.scrollTop).toBe(1000 + 90 - 8);
  });

  it("scrolls from a sideways control only when the drag goes vertical", () => {
    swipe(
      slider,
      [
        [200, 850, 0],
        [215, 846, 8],
        [260, 830, 16],
        [300, 800, 24],
      ],
      100,
    );
    expect(scroller.scrollTop).toBe(1000); // a scrub: not ours
    swipe(slider, drag(200, 850), 100);
    expect(scroller.scrollTop).toBe(1000 + 90 - 8);
  });

  it("ignores a gesture that starts outside the scroller and every zone", () => {
    swipe(elsewhere, drag(), 100);
    expect(scroller.scrollTop).toBe(1000);
  });

  it("ignores a mouse", () => {
    swipe(text, drag(), 100, "mouse");
    expect(scroller.scrollTop).toBe(1000);
  });

  it("stands down while another gesture owns the pointer", () => {
    // A long-press selection extending under the finger.
    blocked = true;
    swipe(text, drag(), 100);
    expect(scroller.scrollTop).toBe(1000);
  });

  it("flings on a release in motion, easing to a stop", () => {
    // A bar swipe: the browser never claims those (touch-action: none).
    const upT = swipe(bar, flick(), 0);
    const released = scroller.scrollTop;
    const seen: number[] = [];
    pumpUntilIdle(upT, () => seen.push(scroller.scrollTop));
    expect(seen.length).toBeGreaterThan(20);
    expect(seen[seen.length - 1]).toBeGreaterThan(released + 300);
    // Decelerating: each frame moves no further than the one before it.
    const steps = seen.map((v, i) => v - (i ? seen[i - 1] : released));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeLessThanOrEqual(steps[i - 1] + 1e-9);
    }
  });

  it("stops a fling the moment a finger lands again", () => {
    const upT = swipe(bar, flick(), 0);
    let frame = 0;
    let caught = 0;
    pumpUntilIdle(upT, () => {
      if (++frame !== 2) return;
      caught = scroller.scrollTop;
      pointer(text, "pointerdown", [200, 400, upT + 20]);
    });
    expect(scroller.scrollTop).toBe(caught);
  });

  it("gives way when something else moves the page mid-fling", () => {
    // A chapter turn resets the scroller; the fling must not drag the new
    // chapter along with it.
    const upT = swipe(bar, flick(), 0);
    let reset = false;
    pumpUntilIdle(upT, () => {
      if (reset) return;
      reset = true;
      scroller.scrollTop = 0;
    });
    expect(scroller.scrollTop).toBe(0);
  });

  it("stops at the end of the chapter instead of pushing against it", () => {
    scroller.scrollTop = MAX - 50;
    const upT = swipe(bar, flick(), 0);
    const end = pumpUntilIdle(upT);
    expect(scroller.scrollTop).toBe(MAX);
    expect(end - upT).toBeLessThan(200); // parked, not spinning to the curve's end
  });
});
