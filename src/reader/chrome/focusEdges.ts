// Which floating chrome bar, if any, the pointer is currently asking for.
//
// Split out of focusChrome so the rule is testable without a DOM, and because
// it stopped being a plain "how close to the edge is the cursor" question once
// Contents could dock.

/** How close to an edge the pointer must come to summon that bar, in px. */
export const CHROME_EDGE_PX = 72;

/**
 * @param y      Pointer offset from the top of the reader's own box.
 * @param height The reader box's height.
 * @param overDockedPanel Whether the pointer is over a docked panel rather
 *        than over the page. A docked Contents panel is a sibling of the
 *        reading column, so it sits INSIDE both edge bands — its header (close
 *        button, search field) is in the top one and the tail of its chapter
 *        list is in the bottom one. Summoning a bar from there slid the chrome
 *        out over the control the reader was reaching for, moving it out from
 *        under the pointer. The bars belong to the page, so only the page
 *        summons them.
 */
export function chromeEdges(
  y: number,
  height: number,
  overDockedPanel: boolean,
): { top: boolean; bottom: boolean } {
  if (overDockedPanel) return { top: false, bottom: false };
  return {
    top: y <= CHROME_EDGE_PX,
    bottom: y >= height - CHROME_EDGE_PX,
  };
}
