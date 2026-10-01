// The within-chapter progress, painted to both of the reader's rails.
//
// Every reader shows the same fraction in two places: the 2px bar along the
// bottom of its header, and focus mode's FocusRail at the top of the screen,
// which stands in for it while the header is away. They are separate elements
// with separate refs on purpose — the header stays mounted and merely
// translates off-screen, so moving one ref between them would leave whichever
// bar lost it frozen at its last width. One paint keeps both current; only one
// is on screen at a time, so the second write costs a single CSSOM update and
// means neither can be stale the instant it is revealed.
//
// Written imperatively (scroll frames, page turns), so progress never
// re-renders React. Shared by the phone and desktop readers, which used to
// carry a copy each.

import { useCallback, useRef } from "react";
import { fractionToWidth } from "../../components/readerProgress";

export function useProgressRails() {
  /** The header's bar fill. */
  const progressFillRef = useRef<HTMLDivElement>(null);
  /** FocusRail's fill. */
  const focusFillRef = useRef<HTMLDivElement>(null);
  /** The fraction the rails were last painted at. FocusRail mounts on a mode
   *  change, not a scroll — without this it would sit empty until the reader
   *  next moved. Pass it as the rail's `initialFraction`. */
  const lastFractionRef = useRef(0);
  /** Paint `fraction` (0..1) to both rails. Stable across renders. */
  const paintProgress = useCallback((fraction: number) => {
    lastFractionRef.current = fraction;
    const w = fractionToWidth(fraction);
    if (progressFillRef.current) progressFillRef.current.style.width = w;
    if (focusFillRef.current) focusFillRef.current.style.width = w;
  }, []);
  return { progressFillRef, focusFillRef, lastFractionRef, paintProgress };
}
