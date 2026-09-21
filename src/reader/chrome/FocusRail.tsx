// The phone's focus-mode progress rail.
//
// Tapping the page takes the chrome away, and with it the header that carries
// the chapter rail — so focus mode had no progress indicator at all. This puts
// the same rail at the very top of the screen instead. The system bars are
// hidden in that mode too, so nothing sits above it.
//
// It owns the placement (and the z-rung) rather than ChapterProgressBar taking
// a flag for it: the rail itself is a shared presentational component whose
// contract is "fill the bottom edge of whatever positions me", and a focus-mode
// special case inside it would straddle both stacking bands.

import type { RefObject } from "react";
import { ChapterProgressBar } from "../../components/ChapterProgressBar";
import { Z, type Theme } from "../../styles/tokens";

export function FocusRail({
  fillRef,
  theme,
  rtl,
  initialFraction,
}: {
  fillRef: RefObject<HTMLDivElement | null>;
  theme: Theme;
  rtl: boolean;
  /** Where the reader already is, so the rail arrives at the right width
   *  instead of flashing empty for a frame on the way in. */
  initialFraction: number;
}) {
  return (
    <div
      className="riwaq-focus-rail"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        pointerEvents: "none",
        zIndex: Z.focusRail,
      }}
    >
      <ChapterProgressBar
        fillRef={fillRef}
        theme={theme}
        rtl={rtl}
        initialFraction={initialFraction}
      />
    </div>
  );
}
