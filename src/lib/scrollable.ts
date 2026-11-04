// "Can the user scroll this box vertically right now?" — one answer for every
// caller: the overlay scrollbar, the Contents reveal, and the bottom sheet's
// gesture rules. Three slightly different copies of this check is how a
// scrollbar ends up painted on a box the sheet thinks it may drag through.

/** Rounding slack: a box a pixel taller than its viewport does not scroll. */
const DEFAULT_SLACK_PX = 1;

/** True when `el` has vertical range to scroll and its overflow lets the
 *  user scroll it. Range is checked first: it is cheap, and rules out most
 *  nodes before `getComputedStyle`. */
export function canScrollY(el: Element, slack = DEFAULT_SLACK_PX): boolean {
  if (el.scrollHeight - el.clientHeight <= slack) return false;
  const overflowY = getComputedStyle(el).overflowY;
  return (
    overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay"
  );
}
