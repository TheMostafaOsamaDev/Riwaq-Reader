// The desktop sidebar's frame, shared by the Library sidebar and the Settings
// rail.
//
// The App crossfades Library ↔ Settings, so for a moment both panels are on
// screen in the same spot. When each one spelled out its own frame, they
// drifted 4px apart in position and 8px in height, and the crossfade showed
// two outlines jittering against each other. Both now take the frame from
// here, so they line up exactly.

import type { CSSProperties } from "react";
import type { Theme } from "../styles/tokens";

/** Inline padding of the frame itself. */
const FRAME_PAD_INLINE = 12;

/** How far rows sit inside the frame's padding. The Library sidebar insets
 *  each block (search, nav, import) by this much, inside its own scroller,
 *  so a focus ring at a row's edge has room. A panel that lays its rows
 *  straight into the frame adds it to the padding instead, with
 *  `SIDEBAR_ROW_PAD_INLINE`. */
export const SIDEBAR_ROW_INSET = 4;

/** The frame's inline padding plus the row inset, for a panel whose rows sit
 *  directly in the frame. Rows then land where the Library sidebar's do. */
export const SIDEBAR_ROW_PAD_INLINE = FRAME_PAD_INLINE + SIDEBAR_ROW_INSET;

export function sidebarFrame(theme: Theme): CSSProperties {
  return {
    width: 252,
    flexShrink: 0,
    boxSizing: "border-box",
    margin: 12,
    padding: `16px ${FRAME_PAD_INLINE}px 14px`,
    background: theme.chrome,
    border: `1.5px solid ${theme.rule}`,
    borderRadius: 16,
    display: "flex",
    flexDirection: "column",
  };
}
