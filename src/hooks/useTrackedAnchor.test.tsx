// @vitest-environment happy-dom
//
// The toolbar must not appear and then move.
//
// It measures itself with a ResizeObserver, so on its very first layout
// effect it still believes it is 0x0. Placement anchors to the start of
// the selection, which in RTL means `line.right - width` — at width 0
// that is the selection's right edge, a full toolbar-width away from
// where the toolbar actually belongs. So the old order painted it hard
// against the text, then jumped it left the moment the observer fired.
//
// The reader reported exactly that: "when i first highlighted the popup
// appeared then when i started scrolling the position of the popup
// changed". This pins the half of it that is about first paint.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnchorBox } from "../lib/popoverPlacement";
import { useTrackedAnchor } from "./useTrackedAnchor";

/** A three-line RTL selection in a 920px column, from real measurements
 *  in a 1728px-wide browser: the lines fill the column and the last one
 *  is short and hugs the right, where an Arabic paragraph ends. */
const RTL_PARAGRAPH: AnchorBox = {
  top: 300,
  bottom: 408,
  firstLine: { left: 768, right: 1688 },
  lastLine: { left: 1639, right: 1688 },
  dir: "rtl",
};

const TOOLBAR = { width: 268, height: 96 };

/** Reports 0x0 until `measured` flips, mimicking the gap between mount
 *  and the first ResizeObserver callback. */
let measured = false;

function Harness({ onPlace }: { onPlace: (s: React.CSSProperties) => void }) {
  const track = useTrackedAnchor({
    getAnchor: () => RTL_PARAGRAPH,
    placement: "auto",
    insets: { top: 66, bottom: 60 },
  });
  onPlace(track.style);
  return <div ref={track.ref} data-testid="toolbar" />;
}

describe("useTrackedAnchor: first paint", () => {
  beforeEach(() => {
    measured = false;
    document.body.innerHTML = "";
    (
      globalThis as unknown as Record<string, unknown>
    ).IS_REACT_ACT_ENVIRONMENT = true;
    // happy-dom lays nothing out, so the toolbar's size comes from here.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          width: measured ? TOOLBAR.width : 0,
          height: measured ? TOOLBAR.height : 0,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    Object.defineProperty(window, "innerWidth", {
      value: 1728,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 900,
      configurable: true,
    });
  });

  it("stays hidden while it has not measured itself", () => {
    const seen: React.CSSProperties[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);

    act(() => {
      createRoot(host).render(<Harness onPlace={(s) => seen.push(s)} />);
    });

    // Unmeasured: no honest position exists yet, so it must not be shown
    // at a placeholder one.
    expect(seen[seen.length - 1]?.opacity).toBe(0);
  });

  it("never paints at the unmeasured position", () => {
    const seen: React.CSSProperties[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);

    act(() => {
      createRoot(host).render(<Harness onPlace={(s) => seen.push(s)} />);
    });

    // 1688 is `line.right - 0` — where a zero-width toolbar's start edge
    // lands. It must never have been committed as a visible position.
    const paintedWrong = seen.some((s) => s.left === 1688 && s.opacity === 1);
    expect(paintedWrong).toBe(false);
  });
});
