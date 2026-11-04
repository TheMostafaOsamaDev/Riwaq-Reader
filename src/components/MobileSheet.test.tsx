// @vitest-environment happy-dom
//
// MobileSheet: lifecycle, the Back layer, Esc, the footer slot, and the two
// performance promises — a closed sheet costs the page nothing, and a drag
// never re-renders what is inside the sheet.
//
// Why the listener cases exist: the sheet claims a gesture by calling
// preventDefault on touchmove, which needs a non-passive listener. One on
// `document` makes the browser hold EVERY touch scroll on the page until the
// main thread has run it — and the phone reader keeps its sheet mounted for
// the whole session. Measured on the emulator before the first fix:
// DOMDebugger listed that handler as the only non-passive touchmove listener
// in the reader. The listener now lives on the sheet box, only while mounted.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setReduceMotionOverride } from "../styles/motion";
import { THEMES } from "../styles/tokens";
import { MobileSheet } from "./MobileSheet";
import { SheetFooter } from "./sheet/SheetContext";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  setReduceMotionOverride("on");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setReduceMotionOverride("auto");
  vi.restoreAllMocks();
});

function show(node: ReactNode) {
  act(() => root.render(node));
}

function sheet(
  props: Partial<Parameters<typeof MobileSheet>[0]> & { open: boolean },
  children: ReactNode = <div>contents</div>,
) {
  return (
    <MobileSheet theme={THEMES.sepia} onClose={() => {}} {...props}>
      {children}
    </MobileSheet>
  );
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement;

/** Dispatch a single-finger touch event the way the engine reads it. */
function touch(type: string, target: Element, x: number, y: number): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const t = { identifier: 1, clientX: x, clientY: y, target };
  Object.defineProperty(ev, "touches", {
    value: type === "touchend" ? [] : [t],
  });
  Object.defineProperty(ev, "changedTouches", { value: [t] });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

/** Give an element a vertical scroll range happy-dom can't lay out. */
function scrollRange(el: HTMLElement, range: number) {
  el.style.overflowY = "auto";
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: 300,
  });
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    value: 300 + range,
  });
}

describe("blocking touchmove listener", () => {
  function blocking(spy: ReturnType<typeof vi.spyOn>) {
    return spy.mock.calls
      .map((call: unknown[], i: number) => ({
        type: call[0],
        opts: call[2] as AddEventListenerOptions | undefined,
        self: spy.mock.contexts[i],
      }))
      .filter(
        (c: { type: unknown; opts?: AddEventListenerOptions }) =>
          c.type === "touchmove" && !c.opts?.passive,
      );
  }

  // happy-dom's nodes, document and window don't share one patchable
  // prototype method, so each is spied on directly.
  function spies() {
    return [
      vi.spyOn(HTMLElement.prototype, "addEventListener"),
      vi.spyOn(document, "addEventListener"),
      vi.spyOn(window, "addEventListener"),
    ];
  }

  it("a closed sheet renders nothing and registers none anywhere", () => {
    const all = spies();
    show(sheet({ open: false }));
    expect(q('[role="dialog"]')).toBeNull();
    for (const s of all) expect(blocking(s)).toHaveLength(0);
  });

  it("an open sheet registers its one on the sheet box, not on document", () => {
    const [el, doc, win] = spies();
    show(sheet({ open: true }));
    const found = blocking(el);
    expect(found).toHaveLength(1);
    expect(found[0].self).toBe(q("[data-sheet-box]"));
    expect(blocking(doc)).toHaveLength(0);
    expect(blocking(win)).toHaveLength(0);
  });
});

describe("dragging", () => {
  it("dragging the grabber moves the box without re-rendering the children", () => {
    let renders = 0;
    function Child() {
      renders++;
      return <div>child</div>;
    }
    show(sheet({ open: true }, <Child />));
    const box = q("[data-sheet-box]");
    const grabber = q("[data-sheet-grabber]");
    const before = renders;
    const startTransform = box.style.transform;
    touch("touchstart", grabber, 0, 400);
    touch("touchmove", grabber, 0, 380);
    touch("touchmove", grabber, 0, 360);
    touch("touchmove", grabber, 0, 340);
    expect(box.style.transform).not.toBe(startTransform);
    expect(renders).toBe(before);
  });

  it("a touch inside a nested scroller is never claimed", () => {
    show(
      sheet(
        { open: true },
        <div data-sheet-scrollable id="list">
          <div id="inner">
            <span id="leaf">font</span>
          </div>
        </div>,
      ),
    );
    scrollRange(q("#list"), 1000);
    scrollRange(q("#inner"), 400);
    const leaf = q("#leaf");
    touch("touchstart", leaf, 0, 400);
    const move = touch("touchmove", leaf, 0, 370);
    expect(move.defaultPrevented).toBe(false);
  });

  it("a swipe up on the list below full is claimed", () => {
    show(
      sheet(
        { open: true },
        <div data-sheet-scrollable id="list">
          <button type="button" id="row">
            row
          </button>
        </div>,
      ),
    );
    scrollRange(q("#list"), 1000);
    const row = q("#row");
    touch("touchstart", row, 0, 400);
    const move = touch("touchmove", row, 0, 370);
    expect(move.defaultPrevented).toBe(true);
  });

  it("fitContent sizes the box to its content and cannot expand", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(420);
    show(sheet({ open: true, fitContent: true }));
    const box = q("[data-sheet-box]");
    const grabber = q("[data-sheet-grabber]");
    expect(box.style.height).toBe("auto");
    expect(box.style.transform).toBe("translateY(0px)");
    touch("touchstart", grabber, 0, 400);
    touch("touchmove", grabber, 0, 360);
    const dragged = Number.parseFloat(
      box.style.transform.replace("translateY(", ""),
    );
    expect(dragged).toBeLessThan(0);
    expect(dragged).toBeGreaterThan(-40);
    touch("touchend", grabber, 0, 360);
    expect(box.style.transform).toBe("translateY(0px)");
  });
});

describe("closing", () => {
  it("Back closes the sheet", () => {
    const onClose = vi.fn();
    show(sheet({ open: true, onClose }));
    act(() => window.history.back());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Esc closes the sheet", () => {
    const onClose = vi.fn();
    show(sheet({ open: true, onClose }));
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Esc already handled by something inside the sheet is left alone", () => {
    const onClose = vi.fn();
    show(sheet({ open: true, onClose }));
    act(() => {
      const ev = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      ev.preventDefault();
      document.body.dispatchEvent(ev);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("tapping the scrim closes the sheet", () => {
    const onClose = vi.fn();
    show(sheet({ open: true, onClose }));
    const scrim = q("[data-sheet-scrim]");
    act(() => {
      scrim.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      scrim.click();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  // Found on the A73: a long-press opened the library's book menu, and the
  // click that followed the lift landed on the scrim now covering the book —
  // closing the menu the press had just opened. Only a press that began on
  // the scrim closes the sheet.
  it("the press that opened the sheet cannot close it through the scrim", () => {
    const onClose = vi.fn();
    show(sheet({ open: true, onClose }));
    act(() => q("[data-sheet-scrim]").click());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("with reduced motion, close unmounts and fires onExited", () => {
    const onExited = vi.fn();
    show(sheet({ open: true, onExited }));
    show(sheet({ open: false, onExited }));
    expect(q('[role="dialog"]')).toBeNull();
    expect(onExited).toHaveBeenCalledOnce();
  });

  // Review M6: during its exit the sheet is gone as far as the user is
  // concerned — a re-tap on ⋮ must reach ⋮, not the departing scrim.
  it("a closing sheet lets taps through to the page", () => {
    setReduceMotionOverride("auto");
    const anim = { finished: new Promise(() => {}), cancel: vi.fn() };
    HTMLElement.prototype.animate = vi.fn(
      () => anim,
    ) as unknown as typeof HTMLElement.prototype.animate;
    try {
      show(sheet({ open: true }));
      const root = q(".riwaq-clip-window");
      expect(root.style.pointerEvents).not.toBe("none");
      show(sheet({ open: false }));
      expect(root.style.pointerEvents).toBe("none");
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
    }
  });

  // Review M5: the update sheet flips `expandable` along with its height.
  it("changing only `expandable` re-lays the sheet out", () => {
    show(sheet({ open: true, height: "52%", expandable: false }));
    const before = q("[data-sheet-box]").style.height;
    show(sheet({ open: true, height: "52%", expandable: true }));
    expect(q("[data-sheet-box]").style.height).not.toBe(before);
  });

  it("keeps showing the last children while it exits", () => {
    setReduceMotionOverride("auto");
    const anim = {
      finished: new Promise(() => {}),
      cancel: vi.fn(),
    };
    HTMLElement.prototype.animate = vi.fn(
      () => anim,
    ) as unknown as typeof HTMLElement.prototype.animate;
    try {
      show(sheet({ open: true }, <div id="kid">first</div>));
      show(sheet({ open: false }, null));
      expect(q("#kid")?.textContent).toBe("first");
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
    }
  });

  it("reopening during exit lands at default and pushes one layer", () => {
    setReduceMotionOverride("auto");
    const anim = {
      finished: new Promise(() => {}),
      cancel: vi.fn(),
    };
    const animate = vi.fn(() => anim);
    HTMLElement.prototype.animate =
      animate as unknown as typeof HTMLElement.prototype.animate;
    try {
      const navIndex = () =>
        (window.history.state as { navIndex: number }).navIndex;
      const base = navIndex();
      show(sheet({ open: true }));
      expect(navIndex()).toBe(base + 1);
      show(sheet({ open: false }));
      expect(navIndex()).toBe(base);
      show(sheet({ open: true }));
      expect(navIndex()).toBe(base + 1);
      expect(q('[role="dialog"]')).not.toBeNull();
      const box = q("[data-sheet-box]");
      const boxCalls = animate.mock.calls.filter(
        (_c, i) => animate.mock.contexts[i] === box,
      ) as unknown as [Array<{ transform: string }>][];
      const lastFrames = boxCalls[boxCalls.length - 1][0];
      const firstFrames = boxCalls[0][0];
      // The enter animation's end is the default snap; the reopen settles
      // back to that same place.
      expect(lastFrames[lastFrames.length - 1].transform).toBe(
        firstFrames[firstFrames.length - 1].transform,
      );
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
    }
  });
});

describe("SheetFooter", () => {
  it("portals into the sheet's footer slot", () => {
    show(
      sheet(
        { open: true },
        <SheetFooter>
          <button type="button" id="q">
            Queue
          </button>
        </SheetFooter>,
      ),
    );
    expect(q("[data-sheet-footer]").contains(q("#q"))).toBe(true);
  });

  it("renders inline outside a sheet", () => {
    show(
      <SheetFooter>
        <button type="button" id="q">
          Queue
        </button>
      </SheetFooter>,
    );
    expect(host.contains(q("#q"))).toBe(true);
  });
});
