import type { RefObject } from "react";
import type { Theme } from "../styles/tokens";
import { fractionToWidth } from "./readerProgress";

interface Props {
  /** The reader writes the fill width imperatively through this ref (e.g. on
   *  every scroll frame) so scrolling never triggers a React re-render. */
  fillRef: RefObject<HTMLDivElement | null>;
  theme: Theme;
  /** Fill grows from the reading-start edge: right in RTL, left in LTR. */
  rtl: boolean;
  /** Width to paint before the reader's first imperative update. 0..1. */
  initialFraction?: number;
}

/** A 2px within-chapter progress indicator, pinned to the bottom edge of the
 *  reader's top header. Indicative only (not draggable) — the footer scrubber
 *  already handles book-level seeking. Absolutely positioned, so its parent
 *  (the header container) must be position:relative or position:absolute. */
export function ChapterProgressBar({
  fillRef,
  theme,
  rtl,
  initialFraction = 0,
}: Props) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 2,
        background: theme.rule,
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      <div
        ref={fillRef}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          ...(rtl ? { right: 0 } : { left: 0 }),
          width: fractionToWidth(initialFraction),
          background: theme.ink,
        }}
      />
    </div>
  );
}
