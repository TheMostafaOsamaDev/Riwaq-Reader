// @vitest-environment happy-dom
//
// The sidebar's trees must not grow open every time the sidebar mounts.
//
// `Collapse` animates `max-height` between 0 and its content's measured
// height. It used to start from a measured height of 0, so the first render
// of an OPEN tree wrote `max-height: 0`; the layout effect's scrollHeight read
// then forced that style through, and the real height arriving a moment later
// was a change from 0 — which the transition animated. The sidebar remounts on
// every return from Settings (it lives inside the App's view swap), so Library
// and Shelves slid open each time and pushed Store, Downloads and Settings
// ~120px down the panel under the pointer.
//
// Measured in WebKit before the fix, Settings → Back: the Store row moved
// 254 → 375px over 200ms.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Collapse, useStoredOpen } from "./LibrarySidebar";

const CONTENT_HEIGHT = 120;
let contentHeight = CONTENT_HEIGHT;
let heightReads = 0;

/** Stand-in ResizeObserver (happy-dom has none that fires): `resizeAll()`
 *  plays the browser telling every observer its element changed size. */
const observers = new Set<() => void>();
class FakeResizeObserver {
  private cb: () => void;
  constructor(cb: () => void) {
    this.cb = cb;
  }
  observe() {
    observers.add(this.cb);
  }
  disconnect() {
    observers.delete(this.cb);
  }
  unobserve() {}
}
function resizeAll() {
  for (const cb of observers) cb();
}

let host: HTMLDivElement;
let root: Root;
let restore: () => void;

beforeEach(() => {
  // happy-dom has no layout; give the measured child a real height.
  const desc = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => {
      heightReads++;
      return contentHeight;
    },
  });
  restore = () => {
    if (desc)
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", desc);
  };
  heightReads = 0;
  contentHeight = CONTENT_HEIGHT;
  observers.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  restore();
  vi.unstubAllGlobals();
});

/** Every max-height React writes, in order, from the first commit on. React
 *  assigns `style.maxHeight` directly, and both renders commit inside one
 *  act(), so the final style alone cannot show the frame in between — spy on
 *  the setter itself. */
function recordMaxHeights(): string[] {
  const seen: string[] = [];
  const proto = Object.getPrototypeOf(document.createElement("div").style);
  const desc = Object.getOwnPropertyDescriptor(proto, "maxHeight");
  if (!desc?.set) throw new Error("no maxHeight setter to observe");
  const set = desc.set;
  Object.defineProperty(proto, "maxHeight", {
    ...desc,
    set(v: string) {
      seen.push(String(v));
      set.call(this, v);
    },
  });
  const prev = restore;
  restore = () => {
    Object.defineProperty(proto, "maxHeight", desc);
    prev();
  };
  return seen;
}

describe("Collapse", () => {
  it("mounts an open tree at its full height, never from 0", async () => {
    const seen = recordMaxHeights();
    await act(async () => {
      root.render(
        <Collapse open>
          <div>rows</div>
        </Collapse>,
      );
    });
    expect(seen.length).toBeGreaterThan(0);
    // React writes a numeric 0 as "0", not "0px" — compare numerically.
    expect(seen.filter((v) => Number.parseFloat(v) === 0)).toEqual([]);
    expect((host.firstElementChild as HTMLElement).style.maxHeight).toBe(
      `${CONTENT_HEIGHT}px`,
    );
  });

  it("still animates a later toggle between 0 and the measured height", async () => {
    await act(async () => {
      root.render(
        <Collapse open>
          <div>rows</div>
        </Collapse>,
      );
    });
    await act(async () => {
      root.render(
        <Collapse open={false}>
          <div>rows</div>
        </Collapse>,
      );
    });
    const el = host.firstElementChild as HTMLElement;
    expect(Number.parseFloat(el.style.maxHeight)).toBe(0);
    expect(el.style.transition).toContain("max-height");
  });

  // Each scrollHeight read forces a synchronous layout, and the sidebar
  // re-renders on every download-progress tick. Measuring belongs to mount
  // and to real content resizes, not to every render.
  it("does not re-measure when its parent re-renders", async () => {
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        root.render(
          <Collapse open>
            <div>rows</div>
          </Collapse>,
        );
      });
    }
    expect(heightReads).toBe(1);
  });

  // The Library page reloads shelves from disk each time it mounts, so the
  // Shelves tree first renders with none and grows when they arrive. When
  // that growth animated, every return from Settings (and every launch)
  // replayed the open animation. Only a click should animate.
  it("resizes without animating when its content changes on its own", async () => {
    await act(async () => {
      root.render(
        <Collapse open>
          <div>rows</div>
        </Collapse>,
      );
    });
    contentHeight = 200;
    await act(async () => resizeAll());
    const el = host.firstElementChild as HTMLElement;
    expect(el.style.maxHeight).toBe("200px");
    expect(el.style.transition).not.toContain("max-height");
  });
});

describe("useStoredOpen", () => {
  function Probe({
    onState,
  }: {
    onState: (s: ReturnType<typeof useStoredOpen>) => void;
  }) {
    onState(useStoredOpen("riwaq:test-tree"));
    return null;
  }

  it("keeps a tree's open state across remounts", async () => {
    let state: ReturnType<typeof useStoredOpen> = [true, () => {}];
    await act(async () => root.render(<Probe onState={(s) => (state = s)} />));
    expect(state[0]).toBe(true);
    await act(async () => state[1](false));
    expect(state[0]).toBe(false);
    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<Probe onState={(s) => (state = s)} />));
    expect(state[0]).toBe(false);
  });

  it("falls back to open when storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    let state: ReturnType<typeof useStoredOpen> = [false, () => {}];
    await act(async () => root.render(<Probe onState={(s) => (state = s)} />));
    expect(state[0]).toBe(true);
    await act(async () => state[1](false));
    expect(state[0]).toBe(false);
    vi.restoreAllMocks();
  });
});
