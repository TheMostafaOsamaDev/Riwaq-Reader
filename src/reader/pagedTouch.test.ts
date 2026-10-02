// The EPUB reader's 1-page and 2-page modes turned pages only by wheel and
// arrow keys. That is the reader an Android tablet gets in landscape (it is
// wider than the 720px phone breakpoint), so there, nothing could reach the
// rest of a chapter: tapping and swiping did nothing, and the bar's arrows
// jump whole chapters. These pin how a touch gesture becomes a page turn —
// the same rules the PDF reader's paged mode already uses.
import { describe, expect, it } from "vitest";
import { pagedTouchTurn } from "./pagedTouch";

const W = 1000;
const tap = (x: number, t = 120) => ({
  down: { x, y: 400, t: 0 },
  up: { x, y: 400, t },
});
const swipe = (x0: number, x1: number, dy = 0) => ({
  down: { x: x0, y: 400, t: 0 },
  up: { x: x1, y: 400 + dy, t: 220 },
});

describe("pagedTouchTurn — taps", () => {
  it("turns forward from the trailing edge of an LTR book", () => {
    const { down, up } = tap(950);
    expect(pagedTouchTurn(down, up, 0, W, false)).toBe(1);
  });

  it("turns back from the leading edge of an LTR book", () => {
    const { down, up } = tap(40);
    expect(pagedTouchTurn(down, up, 0, W, false)).toBe(-1);
  });

  it("mirrors in RTL: the LEFT edge is next, like the left arrow key", () => {
    expect(pagedTouchTurn(tap(40).down, tap(40).up, 0, W, true)).toBe(1);
    expect(pagedTouchTurn(tap(950).down, tap(950).up, 0, W, true)).toBe(-1);
  });

  it("leaves the middle of the page alone", () => {
    const { down, up } = tap(500);
    expect(pagedTouchTurn(down, up, 0, W, false)).toBe(0);
  });

  it("measures the edge against the reader's box, not the window", () => {
    // A reader that starts 300px in (a docked contents panel): x=330 is its
    // leading edge, though it is a third of the way across the screen.
    const { down, up } = tap(330);
    expect(pagedTouchTurn(down, up, 300, 700, false)).toBe(-1);
  });

  it("does not turn on a hold — that is a text selection", () => {
    const { down, up } = tap(950, 700);
    expect(pagedTouchTurn(down, up, 0, W, false)).toBe(0);
  });
});

describe("pagedTouchTurn — swipes", () => {
  it("swiping left advances an LTR book", () => {
    const { down, up } = swipe(700, 400);
    expect(pagedTouchTurn(down, up, 0, W, false)).toBe(1);
  });

  it("swiping right advances an RTL book", () => {
    const { down, up } = swipe(400, 700);
    expect(pagedTouchTurn(down, up, 0, W, true)).toBe(1);
    expect(pagedTouchTurn(up, down, 0, W, true)).toBe(-1);
  });

  it("ignores a mostly vertical drag", () => {
    const { down, up } = swipe(500, 560, 200);
    expect(pagedTouchTurn(down, up, 0, W, false)).toBe(0);
  });

  it("ignores a short wobble that is neither a tap nor a swipe", () => {
    const { down, up } = swipe(500, 520);
    expect(pagedTouchTurn(down, up, 0, W, false)).toBe(0);
  });

  it("a swipe that starts at an edge is still read as a swipe", () => {
    // Started on the leading edge, dragged left: forward, not the edge's back.
    const { down, up } = swipe(120, 20);
    expect(pagedTouchTurn(down, up, 0, W, false)).toBe(1);
  });
});
