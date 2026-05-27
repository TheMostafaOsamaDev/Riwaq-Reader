// One end of a custom text-selection range. Renders a small vertical
// bar at the caret position with a dot above (for start) or below
// (for end). The dot is the touch target — large enough to grab
// reliably without an in-page click region that fights body taps.

import type { PointerEvent as ReactPointerEvent } from "react";

interface Props {
  /** Viewport-coordinate rect of the collapsed caret position. */
  rect: DOMRect;
  /** "start" → dot above the line; "end" → dot below. */
  position: "start" | "end";
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

const BAR_WIDTH = 2;
const BAR_COLOR = "rgba(110, 200, 220, 0.95)";
const DOT_SIZE = 16;
const DOT_HIT = 32; // larger touch target around the visible dot

export function SelectionHandle({ rect, position, onPointerDown }: Props) {
  const lineHeight = rect.height || 18;
  const dotTop =
    position === "start"
      ? rect.top - DOT_SIZE
      : rect.top + lineHeight;
  return (
    <div
      style={{
        position: "fixed",
        left: rect.left - BAR_WIDTH / 2,
        top: rect.top,
        width: BAR_WIDTH,
        height: lineHeight,
        background: BAR_COLOR,
        zIndex: 9500,
        pointerEvents: "none",
      }}
    >
      {/* Larger touch area centered around the visible dot. */}
      <div
        onPointerDown={onPointerDown}
        style={{
          position: "absolute",
          left: BAR_WIDTH / 2 - DOT_HIT / 2,
          top: dotTop - rect.top - (DOT_HIT - DOT_SIZE) / 2,
          width: DOT_HIT,
          height: DOT_HIT,
          borderRadius: DOT_HIT / 2,
          pointerEvents: "auto",
          touchAction: "none",
          cursor: "grab",
          // Centered visible dot inside the larger hit area.
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: DOT_SIZE,
            height: DOT_SIZE,
            borderRadius: DOT_SIZE / 2,
            background: BAR_COLOR,
            boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
          }}
        />
      </div>
    </div>
  );
}
