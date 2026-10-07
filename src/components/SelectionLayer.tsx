// The phone reader's own text selection: a tint over each selected line and
// a handle at each end. Rendered INSIDE the reading scroller, absolutely, in
// its content coordinates — so it scrolls with the text on the compositor,
// frame for frame, with no JavaScript on scroll (see
// reader/selection/selectionGeometry.ts for why it used to trail the text).
//
// Being inside the scroller also puts it in the right place in the stack: it
// is part of the page, so the reader's glass bars and the selection toolbar
// are above it, and a handle can never be drawn over the toolbar again.

import type { PointerEvent as ReactPointerEvent } from "react";
import type { Caret } from "../reader/selection/textCaret";
import type { SelectionGeometry } from "../reader/selection/selectionGeometry";

const TINT = "rgba(120, 180, 220, 0.32)";
const HANDLE_COLOR = "rgba(110, 200, 220, 0.95)";
const BAR_WIDTH = 2;
/** The visible dot. */
export const HANDLE_DOT = 16;
/** The touch target around it. 44px is the platform minimum; the dot itself
 *  is far too small to find with a thumb. */
const HANDLE_HIT = 44;

/** How far the selection toolbar keeps from the selected lines so that it
 *  never sits on a handle's dot, which hangs a dot's height past the line. */
export const HANDLE_CLEARANCE = HANDLE_DOT + 12;

interface Props {
  geometry: SelectionGeometry;
  /** An edge is being dragged. The grips then stop taking hit tests: the
   *  drag asks the browser which character is under the caret, and a 44px
   *  grip sitting on that spot answered "no text here" — which sent the
   *  edge to the start of the paragraph the moment a handle was touched. */
  dragging: boolean;
  onHandleDown: (
    which: "start" | "end",
    e: ReactPointerEvent<HTMLDivElement>,
  ) => void;
}

export function SelectionLayer({ geometry, dragging, onHandleDown }: Props) {
  return (
    <div
      aria-hidden
      data-selection-layer
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        // Taps go through the tint to the text (and to the page, whose tap
        // dismisses the selection). Only the handles take input.
        pointerEvents: "none",
      }}
    >
      {geometry.lines.map((r, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
            background: TINT,
            borderRadius: 2,
          }}
        />
      ))}
      <Handle
        caret={geometry.start}
        which="start"
        live={!dragging}
        onPointerDown={(e) => onHandleDown("start", e)}
      />
      <Handle
        caret={geometry.end}
        which="end"
        live={!dragging}
        onPointerDown={(e) => onHandleDown("end", e)}
      />
    </div>
  );
}

/** A bar on the caret with a dot above it (start) or below it (end). The dot
 *  is the grip — off the line, so the thumb holding it does not cover the
 *  text being selected. */
function Handle({
  caret,
  which,
  live,
  onPointerDown,
}: {
  caret: Caret;
  which: "start" | "end";
  live: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const height = caret.height || 18;
  const dotTop = which === "start" ? -HANDLE_DOT : height;
  return (
    <div
      data-selection-handle={which}
      style={{
        position: "absolute",
        left: caret.x - BAR_WIDTH / 2,
        top: caret.top,
        width: BAR_WIDTH,
        height,
        background: HANDLE_COLOR,
      }}
    >
      <div
        onPointerDown={onPointerDown}
        // Not a page tap: the reader's tap-to-toggle-chrome and its
        // dismiss-on-outside-tap both ignore it (see PAGE_CONTROL), and the
        // pan fallback leaves its drags alone (data-pan-none).
        role="button"
        tabIndex={-1}
        data-pan-none
        style={{
          position: "absolute",
          left: BAR_WIDTH / 2 - HANDLE_HIT / 2,
          top: dotTop + HANDLE_DOT / 2 - HANDLE_HIT / 2,
          width: HANDLE_HIT,
          height: HANDLE_HIT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: live ? "auto" : "none",
          // The browser must not take a handle drag for a scroll.
          touchAction: "none",
          cursor: "grab",
        }}
      >
        <div
          style={{
            width: HANDLE_DOT,
            height: HANDLE_DOT,
            borderRadius: HANDLE_DOT / 2,
            background: HANDLE_COLOR,
            boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
          }}
        />
      </div>
    </div>
  );
}
