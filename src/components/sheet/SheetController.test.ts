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
    expect(c.wheel(40)).toBe(true);
    expect(c.snap).toBe("full");
    expect(c.wheel(40)).toBe(false);
  });

  it("wheel up at default is left alone", () => {
    c.open();
    expect(c.wheel(-40)).toBe(false);
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

  it("attach registers nothing on document or window, and destroy removes all it added", () => {
    const docAdd = vi.spyOn(document, "addEventListener");
    const winAdd = vi.spyOn(window, "addEventListener");
    const boxAdd = vi.spyOn(box, "addEventListener");
    const boxRemove = vi.spyOn(box, "removeEventListener");
    c.attach();
    expect(docAdd).not.toHaveBeenCalled();
    expect(winAdd).not.toHaveBeenCalled();
    const blocking = boxAdd.mock.calls.filter(
      ([type, , opts]) =>
        type === "touchmove" &&
        (opts as AddEventListenerOptions | undefined)?.passive === false,
    );
    expect(blocking).toHaveLength(1);
    c.destroy();
    expect(boxRemove.mock.calls.map(([type]) => type).sort()).toEqual(
      boxAdd.mock.calls.map(([type]) => type).sort(),
    );
  });
});
