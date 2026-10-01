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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Collapse } from "./LibrarySidebar";

const CONTENT_HEIGHT = 120;
let heightReads = 0;

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
      return CONTENT_HEIGHT;
    },
  });
  restore = () => {
    if (desc)
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", desc);
  };
  heightReads = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  restore();
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
});
