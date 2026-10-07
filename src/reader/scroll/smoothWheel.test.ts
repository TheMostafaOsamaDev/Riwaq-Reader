// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachSmoothWheel, glideStep } from "./smoothWheel";

describe("glideStep", () => {
  it("moves a third of a notch in the first 16ms frame and most of it within ~95ms", () => {
    const first = glideStep(0, 120, 16);
    expect(first).toBeGreaterThan(35);
    expect(first).toBeLessThan(45);
    let pos = 0;
    for (let t = 0; t < 96; t += 16) pos = glideStep(pos, 120, 16);
    expect(pos).toBeGreaterThan(108);
  });

  it("lands exactly on the target instead of creeping at it forever", () => {
    let pos = 0;
    let frames = 0;
    while (pos !== 120 && frames < 100) {
      pos = glideStep(pos, 120, 16);
      frames++;
    }
    expect(pos).toBe(120);
    // ~250ms at 60Hz — not the ~350ms drift the removed glide had.
    expect(frames).toBeLessThanOrEqual(16);
  });
});

describe("attachSmoothWheel", () => {
  let el: HTMLDivElement;
  let frames: FrameRequestCallback[];
  let now = 1000;

  beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
    Object.defineProperty(el, "scrollHeight", { value: 5000 });
    Object.defineProperty(el, "clientHeight", { value: 800 });
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    el.remove();
    vi.restoreAllMocks();
  });

  const runFrames = (n: number) => {
    for (let i = 0; i < n && frames.length > 0; i++) {
      now += 16;
      const cb = frames.shift();
      cb?.(now);
    }
  };
  const wheel = (deltaY: number) => {
    const e = new WheelEvent("wheel", { deltaY, cancelable: true });
    el.dispatchEvent(e);
    return e;
  };

  it("never touches a trackpad's events", () => {
    attachSmoothWheel(el, { isMouse: () => false });
    expect(wheel(120).defaultPrevented).toBe(false);
    expect(frames).toHaveLength(0);
  });

  it("does nothing until the native side has said it is a mouse", () => {
    // No `isMouse` injected: reads window.__riwaqWheel, which is unset.
    attachSmoothWheel(el);
    expect(wheel(120).defaultPrevented).toBe(false);
  });

  it("takes a mouse notch and glides it out to the full distance", () => {
    attachSmoothWheel(el, { isMouse: () => true });
    expect(wheel(120).defaultPrevented).toBe(true);
    runFrames(1);
    expect(el.scrollTop).toBeGreaterThan(30);
    expect(el.scrollTop).toBeLessThan(120);
    runFrames(40);
    expect(el.scrollTop).toBe(120);
    expect(frames).toHaveLength(0); // parked, not spinning
  });

  it("adds notches that arrive mid-glide to the same target", () => {
    attachSmoothWheel(el, { isMouse: () => true });
    wheel(120);
    runFrames(2);
    wheel(120);
    runFrames(40);
    expect(el.scrollTop).toBe(240);
  });

  it("stops at the end of the page", () => {
    attachSmoothWheel(el, { isMouse: () => true });
    el.scrollTop = 4150;
    wheel(400);
    runFrames(40);
    expect(el.scrollTop).toBe(4200);
  });

  it("gives way when something else moves the page mid-glide", () => {
    attachSmoothWheel(el, { isMouse: () => true });
    wheel(400);
    runFrames(2);
    el.scrollTop = 2000; // the scrollbar, the keyboard, a chapter jump
    runFrames(40);
    expect(el.scrollTop).toBe(2000);
  });

  it("leaves pinch-zoom and reduced motion to the browser", () => {
    attachSmoothWheel(el, { isMouse: () => true, reducedMotion: () => true });
    expect(wheel(120).defaultPrevented).toBe(false);
    const e = new WheelEvent("wheel", {
      deltaY: 10,
      ctrlKey: true,
      cancelable: true,
    });
    el.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
