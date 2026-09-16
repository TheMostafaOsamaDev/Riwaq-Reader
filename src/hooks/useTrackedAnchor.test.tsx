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

/** Swapped mid-test to mimic a drag growing the selection. */
let currentAnchor: AnchorBox = RTL_PARAGRAPH;

function Harness({ onPlace }: { onPlace: (s: React.CSSProperties) => void }) {
  const track = useTrackedAnchor({
    getAnchor: () => currentAnchor,
    placement: "auto",
    insets: { top: 66, bottom: 60 },
  });
  onPlace(track.style);
  return <div ref={track.ref} data-testid="toolbar" />;
}

describe("useTrackedAnchor: first paint", () => {
  beforeEach(() => {
    measured = false;
    currentAnchor = RTL_PARAGRAPH;
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

/**
 * The reported bug, from a measured trace.
 *
 * The toolbar mounts while the drag is still running, when the selection
 * is the one word the drag began on. On a real chapter that anchor was
 * 61px wide at 954..1015 and the toolbar placed itself at 747. The drag
 * then grew the selection to the full column, 44..1256, where the
 * toolbar belongs at 988 — and nothing re-measured, because a selection
 * growing is neither a scroll nor a resize. It stayed wrong until the
 * reader scrolled 900ms later.
 */
describe("useTrackedAnchor: the selection growing under a drag", () => {
  /** The word the drag started on. */
  const ONE_WORD: AnchorBox = {
    top: 300,
    bottom: 336,
    firstLine: { left: 954, right: 1015 },
    lastLine: { left: 954, right: 1015 },
    dir: "rtl",
  };
  /** What it became by the time the drag ended. */
  const FULL_COLUMN: AnchorBox = {
    top: 300,
    bottom: 408,
    firstLine: { left: 44, right: 1256 },
    lastLine: { left: 487, right: 1256 },
    dir: "rtl",
  };

  const flush = async () => {
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
  };

  it("follows the selection as it grows, without waiting for a scroll", async () => {
    measured = true;
    currentAnchor = ONE_WORD;
    const seen: React.CSSProperties[] = [];
    const host = document.createElement("div");
    document.body.appendChild(host);

    await act(async () => {
      createRoot(host).render(<Harness onPlace={(s) => seen.push(s)} />);
    });
    // Placed against the single word: 1015 - 268.
    expect(seen[seen.length - 1]?.left).toBe(747);

    // The drag continues and the selection becomes the whole paragraph.
    currentAnchor = FULL_COLUMN;
    document.dispatchEvent(new Event("selectionchange"));
    await flush();

    // 1256 - 268. Previously this only happened on the next scroll.
    expect(seen[seen.length - 1]?.left).toBe(988);
  });
});
