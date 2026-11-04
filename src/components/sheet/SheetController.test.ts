// @vitest-environment happy-dom
//
// The sheet engine, driven through its input methods with hand-picked
// coordinates. Reduced motion is forced on so every settle applies at once:
// these cases pin WHERE the sheet goes and who moves, not how it animates.
//
// Geometry G (as in physics.test.ts): 800px viewport, full-height box of
// 760px, default snap showing 600px → resting y: full 0, default 160,
// dismissed 760.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { setReduceMotionOverride } from "../../styles/motion";
import type { SheetGeometry } from "./physics";
import { SheetController, type TouchPoint } from "./SheetController";

const G: SheetGeometry = {
  viewportH: 800,
  insetTop: 40,
  boxH: 760,
  defaultVisibleH: 600,
  expandable: true,
};

let box: HTMLDivElement;
let scrim: HTMLDivElement;
let content: HTMLDivElement;
let footer: HTMLDivElement;
let grabber: HTMLDivElement;
let body: HTMLDivElement;
let bodyRow: HTMLButtonElement;
let cb: {
  onDismiss: Mock<() => void>;
  onExitFinished: Mock<() => void>;
};
let c: SheetController;

function pt(x: number, y: number, t: number, target?: Element): TouchPoint {
  return { id: 1, x, y, t, target: target ?? bodyRow };
}
const mv = (x: number, y: number, t: number) => ({
  id: 1,
  x,
  y,
  t,
  cancelable: true,
});

beforeEach(() => {
  setReduceMotionOverride("on");
  box = document.createElement("div");
  scrim = document.createElement("div");
  content = document.createElement("div");
  footer = document.createElement("div");
  grabber = document.createElement("div");
  body = document.createElement("div");
  bodyRow = document.createElement("button");
  body.setAttribute("data-sheet-scrollable", "true");
  body.style.overflowY = "auto";
  Object.defineProperty(body, "scrollHeight", {
    configurable: true,
    value: 1760,
  });
  Object.defineProperty(body, "clientHeight", {
    configurable: true,
    value: 760,
  });
  body.append(bodyRow);
  content.append(body);
  box.append(grabber, content, footer);
  document.body.append(scrim, box);
  cb = { onDismiss: vi.fn<() => void>(), onExitFinished: vi.fn<() => void>() };
  c = new SheetController({ box, scrim, content, footer }, cb);
  c.setGeometry(G);
});

afterEach(() => {
  c.destroy();
  box.remove();
  scrim.remove();
  setReduceMotionOverride("auto");
  vi.restoreAllMocks();
});

describe("snaps", () => {
  it("starts dismissed and opens to default", () => {
    expect(c.snap).toBe("dismissed");
    expect(box.style.transform).toBe("translateY(760px)");
    c.open();
    expect(c.snap).toBe("default");
    expect(c.y).toBe(160);
    expect(box.style.transform).toBe("translateY(160px)");
    expect(scrim.style.opacity).toBe("1");
  });

  it("setGeometry keeps the current snap when the viewport shrinks", () => {
    c.open();
    c.setGeometry({ ...G, viewportH: 500, boxH: 460, defaultVisibleH: 375 });
    expect(c.snap).toBe("default");
    expect(c.y).toBe(85);
  });

  it("close goes to dismissed and reports the exit", () => {
    c.open();
    c.close();
    expect(c.snap).toBe("dismissed");
    expect(c.y).toBe(760);
    expect(cb.onExitFinished).toHaveBeenCalledOnce();
    expect(cb.onDismiss).not.toHaveBeenCalled();
  });
});

describe("dragging", () => {
  it("a chrome drag follows the finger and settles to the nearest snap", () => {
    c.open();
    c.touchStart(pt(0, 400, 0, grabber));
    expect(c.touchMove(mv(0, 300, 50))).toBe(true);
    expect(box.style.transform).toBe("translateY(60px)");
    // Lifted 350ms after the finger stopped: no velocity, nearest snap wins.
    c.touchEnd({ id: 1, t: 400 });
    expect(c.snap).toBe("full");
    expect(c.y).toBe(0);
  });

  it("movement inside the slop is not claimed yet", () => {
    c.open();
    c.touchStart(pt(0, 400, 0, grabber));
    expect(c.touchMove(mv(0, 397, 10))).toBe(false);
    expect(c.y).toBe(160);
  });

  it("swipe up on the list at default expands, then scrolls the list in the same gesture", () => {
    c.open();
    c.touchStart(pt(0, 500, 0));
    expect(c.touchMove(mv(0, 300, 40))).toBe(true);
    expect(c.y).toBe(0);
    expect(body.scrollTop).toBe(40);
  });

  it("at full, swipe up on the list is left to the browser", () => {
    c.open();
    c.settleTo("full", 0);
    c.touchStart(pt(0, 500, 0));
    expect(c.touchMove(mv(0, 480, 20))).toBe(false);
  });

  it("at default, pull down on a scrolled list is left to the browser", () => {
    c.open();
    body.scrollTop = 300;
    c.touchStart(pt(0, 300, 0));
    expect(c.touchMove(mv(0, 340, 20))).toBe(false);
    expect(c.y).toBe(160);
  });

  it("at full, pull down on a list at its top drags the sheet", () => {
    c.open();
    c.settleTo("full", 0);
    c.touchStart(pt(0, 300, 0));
    expect(c.touchMove(mv(0, 400, 20))).toBe(true);
    expect(c.y).toBe(100);
  });

  it("reversing a pull from full lifts the sheet back, then scrolls the list", () => {
    c.open();
    c.settleTo("full", 0);
    c.touchStart(pt(0, 300, 0));
    c.touchMove(mv(0, 400, 20));
    c.touchMove(mv(0, 250, 40));
    expect(c.y).toBe(0);
    expect(body.scrollTop).toBe(50);
  });

  it("a fast flick down from default dismisses", () => {
    c.open();
    c.touchStart(pt(0, 300, 0, grabber));
    c.touchMove(mv(0, 330, 16));
    c.touchMove(mv(0, 360, 32));
    c.touchEnd({ id: 1, t: 40 });
    expect(cb.onDismiss).toHaveBeenCalledOnce();
    expect(cb.onExitFinished).toHaveBeenCalledOnce();
    expect(c.snap).toBe("dismissed");
  });

  it("pulling up at full rubber-bands and springs back", () => {
    c.open();
    c.settleTo("full", 0);
    c.touchStart(pt(0, 300, 0, grabber));
    c.touchMove(mv(0, 200, 30));
    expect(c.y).toBeLessThan(0);
    expect(c.y).toBeGreaterThan(-100);
    c.touchEnd({ id: 1, t: 600 });
    expect(c.y).toBe(0);
  });

  it("a horizontal start is never claimed for the rest of the touch", () => {
    c.open();
    c.touchStart(pt(100, 300, 0, grabber));
    expect(c.touchMove(mv(120, 302, 16))).toBe(false);
    expect(c.touchMove(mv(120, 360, 32))).toBe(false);
    expect(c.y).toBe(160);
  });

  it("a second finger is ignored while the first drags", () => {
    c.open();
    c.touchStart(pt(0, 400, 0, grabber));
    c.touchMove(mv(0, 380, 16));
    c.touchStart({ ...pt(0, 100, 20, grabber), id: 2 });
    expect(c.touchMove({ ...mv(0, 50, 30), id: 2 })).toBe(false);
    expect(c.y).toBe(140);
  });

  // Spike 1, measured on the A73: touchmoves keep arriving (uncancelable) at
  // the input rate after a native scroll reaches the list's top, so the sheet
  // can follow the rest of the pull, as native sheets do.
  describe("a native scroll that reaches the top", () => {
    /** Full sheet, list scrolled 100px, finger pulling down: the list
     *  scrolls back natively (simulated by setting scrollTop) until it hits
     *  its top at y 400. */
    function pullListToTop() {
      c.open();
      c.settleTo("full", 0);
      body.style.overflowY = "auto";
      body.scrollTop = 100;
      c.touchStart(pt(0, 300, 0));
      expect(c.touchMove(mv(0, 320, 16))).toBe(false);
      body.scrollTop = 80;
      body.scrollTop = 0;
      expect(c.touchMove({ ...mv(0, 400, 32), cancelable: false })).toBe(false);
      expect(c.y).toBe(0);
    }

    it("hands the rest of the pull to the sheet", () => {
      pullListToTop();
      c.touchMove({ ...mv(0, 450, 48), cancelable: false });
      expect(c.y).toBe(50);
      // Frozen while the sheet is displaced, so a reversal can't scroll the
      // list underneath it.
      expect(body.style.overflowY).toBe("hidden");
    });

    it("settles like a drag and unfreezes the list on release", () => {
      pullListToTop();
      c.touchMove({ ...mv(0, 600, 48), cancelable: false });
      expect(c.y).toBe(200);
      c.touchEnd({ id: 1, t: 600 });
      expect(c.snap).toBe("default");
      expect(c.y).toBe(160);
      expect(body.style.overflowY).toBe("auto");
    });

    it("a reversal lifts the sheet back to full and stops there", () => {
      pullListToTop();
      c.touchMove({ ...mv(0, 450, 48), cancelable: false });
      c.touchMove({ ...mv(0, 380, 64), cancelable: false });
      expect(c.y).toBe(0);
      expect(body.scrollTop).toBe(0);
    });

    it("an upward native scroll is never handed over", () => {
      c.open();
      c.settleTo("full", 0);
      body.scrollTop = 100;
      c.touchStart(pt(0, 400, 0));
      c.touchMove(mv(0, 380, 16));
      body.scrollTop = 120;
      c.touchMove({ ...mv(0, 300, 32), cancelable: false });
      expect(c.y).toBe(0);
      expect(body.style.overflowY).toBe("auto");
    });
  });

  it("after expanding, the list keeps coasting when the finger lifts mid-fling", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((f) => {
      frames.push(f);
      return frames.length;
    });
    const t0 = performance.now();
    c.open();
    c.touchStart(pt(0, 500, t0));
    c.touchMove(mv(0, 300, t0 + 40));
    c.touchMove(mv(0, 250, t0 + 56));
    c.touchEnd({ id: 1, t: t0 + 60 });
    expect(c.snap).toBe("full");
    expect(body.scrollTop).toBe(90);
    frames.shift()?.(t0 + 76);
    expect(body.scrollTop).toBeGreaterThan(90);
  });
});

describe("clicks", () => {
  it("a click right after a drag is swallowed once", () => {
    c.attach();
    c.open();
    const t = performance.now();
    c.touchStart(pt(0, 300, t, grabber));
    c.touchMove(mv(0, 340, t + 16));
    c.touchEnd({ id: 1, t: t + 300 });
    const onClick = vi.fn();
    bodyRow.addEventListener("click", onClick);
    bodyRow.click();
    expect(onClick).not.toHaveBeenCalled();
    bodyRow.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  // Found on the phone: touching Contents while it slid open stopped it, and
  // lifting the finger then opened the chapter under it and closed the sheet.
  // A touch that stops something moving is consumed, as it is natively.
  it("a tap that catches the sheet mid-animation is not a click on what is under it", () => {
    setReduceMotionOverride("auto");
    const never = { finished: new Promise(() => {}), cancel: vi.fn() };
    HTMLElement.prototype.animate = vi.fn(
      () => never,
    ) as unknown as typeof HTMLElement.prototype.animate;
    try {
      c.attach();
      c.open();
      const t = performance.now();
      c.touchStart(pt(0, 700, t));
      c.touchEnd({ id: 1, t: t + 80 });
      const onClick = vi.fn();
      bodyRow.addEventListener("click", onClick);
      bodyRow.click();
      expect(onClick).not.toHaveBeenCalled();
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
    }
  });

  it("a tap that stops a coasting list is not a click either", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((f) => {
      frames.push(f);
      return frames.length;
    });
    c.attach();
    const t0 = performance.now();
    c.open();
    c.touchStart(pt(0, 500, t0));
    c.touchMove(mv(0, 300, t0 + 40));
    c.touchMove(mv(0, 250, t0 + 56));
    c.touchEnd({ id: 1, t: t0 + 60 });
    // Spend the drag's own one-shot click window first.
    bodyRow.click();
    c.touchStart(pt(0, 400, t0 + 100));
    c.touchEnd({ id: 1, t: t0 + 160 });
    const onClick = vi.fn();
    bodyRow.addEventListener("click", onClick);
    bodyRow.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("a tap is not swallowed", () => {
    c.attach();
    c.open();
    const t = performance.now();
    c.touchStart(pt(0, 300, t));
    c.touchEnd({ id: 1, t: t + 80 });
    const onClick = vi.fn();
    bodyRow.addEventListener("click", onClick);
    bodyRow.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("wheel", () => {
  it("wheel down at default expands first, then scrolls natively", () => {
    c.open();
    expect(c.wheel(40, bodyRow)).toBe(true);
    expect(c.snap).toBe("full");
    expect(c.wheel(40, bodyRow)).toBe(false);
  });

  it("wheel up at default is left alone", () => {
    c.open();
    expect(c.wheel(-40, bodyRow)).toBe(false);
    expect(c.snap).toBe("default");
  });
});

describe("reveal", () => {
  function target(bottom: number): HTMLElement {
    const el = document.createElement("div");
    body.append(el);
    el.getBoundingClientRect = () =>
      ({
        top: bottom - 50,
        bottom,
        left: 0,
        right: 0,
        width: 0,
        height: 50,
      }) as DOMRect;
    return el;
  }

  it("expands, then scrolls the list just enough", () => {
    c.open();
    const scrollTo = vi.fn();
    body.scrollTo = scrollTo as typeof body.scrollTo;
    // Bottom at 1000 now; 840 once expanded (the sheet rises 160px); the
    // visible line is 800 − 0 (footer) − 12 = 788, so 52px more to scroll.
    c.reveal(target(1000));
    expect(c.snap).toBe("full");
    expect(scrollTo).toHaveBeenCalledWith({ top: 52, behavior: "instant" });
  });

  it("leaves an element that is already in view alone", () => {
    c.open();
    const scrollTo = vi.fn();
    body.scrollTo = scrollTo as typeof body.scrollTo;
    c.reveal(target(700));
    expect(c.snap).toBe("default");
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("measures from where the sheet is going, not where it is mid-animation", () => {
    setReduceMotionOverride("auto");
    const never = { finished: new Promise(() => {}), cancel: vi.fn() };
    HTMLElement.prototype.animate = vi.fn(
      () => never,
    ) as unknown as typeof HTMLElement.prototype.animate;
    try {
      c.open();
      c.expand();
      // Halfway up: drawn 80px below full, where it will rest.
      box.style.transform = "translateY(80px)";
      const scrollTo = vi.fn();
      body.scrollTo = scrollTo as typeof body.scrollTo;
      // Bottom 900 now, so 820 once at full; the line is 788: 32px to go.
      c.reveal(target(900));
      expect(scrollTo).toHaveBeenCalledWith({ top: 32, behavior: "smooth" });
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
    }
  });

  // Review M3: keyboard focus can land on a control in the part of the list
  // below the screen at the default snap, which the browser's own focus
  // scrolling cannot bring into view (it cannot move the sheet).
  it("focus moving into the hidden part of the list brings it into view", () => {
    c.attach();
    c.open();
    const scrollTo = vi.fn();
    body.scrollTo = scrollTo as typeof body.scrollTo;
    const el = target(1000);
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(c.snap).toBe("full");
    expect(scrollTo).toHaveBeenCalledWith({ top: 52, behavior: "instant" });
  });

  it("focus on the sheet's chrome or on visible content moves nothing", () => {
    c.attach();
    c.open();
    const scrollTo = vi.fn();
    body.scrollTo = scrollTo as typeof body.scrollTo;
    grabber.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    target(700).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(c.snap).toBe("default");
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("listeners", () => {
  it("a synthetic touch event with no touch lists is ignored, not thrown on", () => {
    c.attach();
    c.open();
    for (const type of ["touchstart", "touchmove", "touchend"]) {
      expect(() =>
        box.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })),
      ).not.toThrow();
    }
    expect(c.y).toBe(160);
  });

  it("attach registers one blocking touchmove, on the box only", () => {
    const docAdd = vi.spyOn(document, "addEventListener");
    const winAdd = vi.spyOn(window, "addEventListener");
    const boxAdd = vi.spyOn(box, "addEventListener");
    c.attach();
    expect(docAdd).not.toHaveBeenCalled();
    expect(winAdd).not.toHaveBeenCalled();
    const blocking = boxAdd.mock.calls.filter(
      ([type, , opts]) =>
        type === "touchmove" &&
        (opts as AddEventListenerOptions | undefined)?.passive === false,
    );
    expect(blocking).toHaveLength(1);
  });

  it("destroy detaches: later touches do nothing", () => {
    c.attach();
    c.open();
    c.destroy();
    const fire = (type: string, y: number) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      const t = { identifier: 1, clientX: 0, clientY: y, target: grabber };
      Object.defineProperty(ev, "changedTouches", { value: [t] });
      Object.defineProperty(ev, "touches", { value: [t] });
      grabber.dispatchEvent(ev);
      return ev;
    };
    fire("touchstart", 400);
    expect(fire("touchmove", 340).defaultPrevented).toBe(false);
    expect(c.y).toBe(160);
  });
});

// Findings of the whole-branch review, each pinned before its fix.
describe("review findings", () => {
  /** A focused text field, a range input, or a nested scroller in the list. */
  function control(kind: "range" | "text"): HTMLInputElement {
    const el = document.createElement("input");
    el.type = kind;
    body.append(el);
    return el;
  }

  // C1: only a native vertical scroll of the list may be handed to the sheet.
  it("a slider drag drifting down never moves the sheet", () => {
    c.open();
    const slider = control("range");
    c.touchStart(pt(0, 300, 0, slider));
    expect(c.touchMove(mv(30, 304, 16))).toBe(false);
    c.touchMove({ ...mv(40, 340, 32), cancelable: false });
    c.touchMove({ ...mv(50, 380, 48), cancelable: false });
    expect(c.y).toBe(160);
    expect(body.style.overflowY).toBe("auto");
  });

  it("a sideways swipe on the list never moves the sheet", () => {
    c.open();
    c.touchStart(pt(0, 300, 0));
    expect(c.touchMove(mv(20, 304, 16))).toBe(false);
    c.touchMove({ ...mv(40, 340, 32), cancelable: false });
    c.touchMove({ ...mv(60, 380, 48), cancelable: false });
    expect(c.y).toBe(160);
  });

  it("a drag in a focused text field never moves the sheet", () => {
    c.open();
    const field = control("text");
    field.focus();
    c.touchStart(pt(0, 300, 0, field));
    expect(c.touchMove(mv(0, 320, 16))).toBe(false);
    c.touchMove({ ...mv(0, 350, 32), cancelable: false });
    c.touchMove({ ...mv(0, 390, 48), cancelable: false });
    expect(c.y).toBe(160);
  });

  // I2: the spec's "a fast flick through the list never closes the sheet"
  // holds even when the list reaches its top mid-flick.
  function flickThroughNearlyTopList(endY: number, endT: number) {
    c.open();
    body.scrollTop = 60;
    c.touchStart(pt(0, 300, 0));
    c.touchMove(mv(0, 320, 8));
    body.scrollTop = 0;
    c.touchMove({ ...mv(0, 380, 16), cancelable: false });
    c.touchMove({ ...mv(0, endY, 24), cancelable: false });
    c.touchEnd({ id: 1, t: endT });
  }

  it("a fast flick that reaches the list's top does not close the sheet", () => {
    flickThroughNearlyTopList(530, 26);
    expect(cb.onDismiss).not.toHaveBeenCalled();
    expect(c.snap).toBe("default");
  });

  it("a long deliberate pull through the list's top can still close it", () => {
    flickThroughNearlyTopList(720, 600);
    expect(cb.onDismiss).toHaveBeenCalledOnce();
  });

  // I3: a mouse press that is not on the sheet's chrome is not a gesture,
  // and must not stop the sheet halfway either.
  it("a mouse press on the list mid-animation does not strand the sheet", () => {
    setReduceMotionOverride("auto");
    const never = { finished: new Promise(() => {}), cancel: vi.fn() };
    HTMLElement.prototype.animate = vi.fn(
      () => never,
    ) as unknown as typeof HTMLElement.prototype.animate;
    try {
      c.open();
      c.touchStart({ ...pt(0, 700, 0), mouse: true });
      expect(c.y).toBe(160);
      expect(never.cancel).not.toHaveBeenCalled();
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
    }
  });

  // M1: a touch whose end never reached the sheet (its row was recycled by a
  // virtual list mid-touch) must not lock out every later touch.
  it("a lost touchend does not lock out the next touch", () => {
    c.attach();
    c.open();
    const fire = (type: string, id: number, y: number, touches: number) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      const t = { identifier: id, clientX: 0, clientY: y, target: grabber };
      Object.defineProperty(ev, "changedTouches", { value: [t] });
      Object.defineProperty(ev, "touches", {
        value: Array.from({ length: touches }, () => t),
      });
      grabber.dispatchEvent(ev);
      return ev;
    };
    fire("touchstart", 1, 400, 1);
    // …its touchend went to a node that has since left the document.
    fire("touchstart", 2, 400, 1);
    const move = fire("touchmove", 2, 360, 1);
    expect(move.defaultPrevented).toBe(true);
    expect(c.y).toBe(120);
  });

  // M2: the wheel over the open font list scrolls the font list.
  it("wheel over a nested list is left to that list", () => {
    c.open();
    const inner = document.createElement("div");
    inner.style.overflowY = "auto";
    Object.defineProperty(inner, "scrollHeight", { value: 900 });
    Object.defineProperty(inner, "clientHeight", { value: 300 });
    const leaf = document.createElement("span");
    inner.append(leaf);
    body.append(inner);
    expect(c.wheel(40, leaf)).toBe(false);
    expect(c.snap).toBe("default");
  });

  // I1: a geometry change (the update sheet going 52% → 86%) keeps the
  // sheet's top edge where it is and animates from there.
  it("a new layout animates from where the sheet is drawn, not from a stale offset", () => {
    setReduceMotionOverride("auto");
    const never = { finished: new Promise(() => {}), cancel: vi.fn() };
    const animate = vi.fn(() => never);
    HTMLElement.prototype.animate =
      animate as unknown as typeof HTMLElement.prototype.animate;
    try {
      const small: SheetGeometry = {
        viewportH: 800,
        insetTop: 40,
        boxH: 300,
        defaultVisibleH: 300,
        expandable: false,
      };
      c.setGeometry(small);
      c.open();
      // Settled at default: y 0, top edge at 800 − 300 = 500.
      animate.mockClear();
      box.style.transform = "translateY(0px)";
      c.setGeometry(G, true);
      const frames = (
        animate.mock.calls.find(
          (_c, i) => animate.mock.contexts[i] === box,
        ) as unknown as [Array<{ transform: string }>]
      )[0];
      // In the 760px box the same top edge (500) is y 500 − (800 − 760).
      expect(frames[0].transform).toBe("translateY(460px)");
      expect(frames[frames.length - 1].transform).toBe("translateY(160px)");
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
    }
  });
});
