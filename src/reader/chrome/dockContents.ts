// When Contents claims real layout beside the reading surface instead of
// floating over it.
//
// This lives in one place on purpose. Docking was implemented once before and
// then removed, because the reflowable reader docked Contents while the
// fixed-page reader overlaid it — so the same click did two different things
// depending on whether you had opened an EPUB or a PDF. Both readers now
// import this, which is what makes them agree by construction.
//
// Contents docks and the other panels never do: Contents is a place you
// navigate FROM (pick a chapter, read it, pick the next one without reopening
// anything), while settings/progress/highlights are tools you dismiss. A
// docked tool panel would hold reading width hostage for no benefit.

/** Panel identifiers the readers share. `null` = nothing open. */
export type DockablePanel = string | null;

/** Below this the window cannot seat a 340px panel and a readable column at
 *  the same time, so Contents keeps the overlay. 1024 is the standard
 *  desktop breakpoint (and the width at which a sidebar becomes the right
 *  navigation pattern), rather than a number picked per reader. */
export const DOCK_MIN_WIDTH = 1024;

/** Width of the docked strip. Also what the panel itself is sized to. */
export const DOCK_WIDTH = 340;

export const DOCK_QUERY = `(min-width: ${DOCK_MIN_WIDTH}px)`;

export function shouldDockContents(
  panel: DockablePanel,
  roomToDock: boolean,
): boolean {
  return panel === "toc" && roomToDock;
}
