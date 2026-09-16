/**
 * Where a selection toolbar goes, given the rect of the thing it belongs
 * to. Both reader popovers (SelectionPopover, HighlightActionPopover)
 * place themselves through here.
 *
 * All coordinates are VIEWPORT coordinates, which is what
 * `getBoundingClientRect()` hands back and what `position: fixed`
 * consumes. That choice is what makes a popover follow its selection
 * when the reading column scrolls underneath it: the caller re-measures
 * the anchor and calls this again (see hooks/useTrackedAnchor).
 *
 * `bounds` is the slice of the viewport the toolbar may occupy — the
 * reading region, inset clear of the frosted chrome bars. A selection
 * that has scrolled outside it gets `visible: false` rather than a
 * clamped position, because a toolbar parked over unrelated text reads
 * as a bug (and was one).
 */

/** The line boxes placement actually needs, in viewport coordinates.
 *
 *  Not a single bounding rect. A selection spanning three lines of a
 *  justified column has a bounding rect as wide as the column, and
 *  centring a toolbar on that puts it in the dead middle of the block,
 *  touching neither end of the thing it belongs to. Measured on a real
 *  920px RTL column: union 768→1688, so "centred" lands at 1094 — the
 *  middle of the paragraph — while the selection starts at 1688.
 *
 *  So placement is told the first and last LINE instead, and which end
 *  of a line the reader's eye starts from. */
export interface AnchorBox {
  /** Top of the first line and bottom of the last: the vertical extent. */
  top: number;
  bottom: number;
  /** Topmost line box of the selection. */
  firstLine: { left: number; right: number };
  /** Bottommost line box. */
  lastLine: { left: number; right: number };
  /** Reading direction of the text being anchored to, resolved from the
   *  element itself rather than the document: a reader can hold an
   *  English quote inside an Arabic chapter. */
  dir: "rtl" | "ltr";
}

export interface PlacementInput {
  /** The selection, or an existing highlight's `<mark>`. */
  anchor: AnchorBox;
  /** Measured size of the toolbar. */
  size: { width: number; height: number };
  /** The region the toolbar must stay inside. */
  bounds: { top: number; bottom: number; left: number; right: number };
  /** "auto": above the selection if it fits, else below.
   *  "below": always below — the phone reader forces this so we never
   *  cover Android's own floating toolbar, which sits above the text. */
  placement: "auto" | "below";
  /** Gap between the toolbar and both the selection and the bounds. */
  margin: number;
  /** The side the toolbar is ALREADY on, when it is already open.
   *
   *  Placement holds that side for the toolbar's whole life instead of
   *  re-deciding every scroll frame. Re-deciding is what makes a
   *  toolbar appear to jump: scroll a selection up-page and the moment
   *  room above runs out it would leap to the other side of the text.
   *  Held, it slides to the edge of the reading region and then fades
   *  with its selection — which is a thing the reader can follow. */
  lockedSide?: Side;
}

export type Side = "above" | "below";

export interface Placement {
  top: number;
  left: number;
  /** The side actually used. Feed it back as `lockedSide` on the next
   *  call to keep the toolbar there. */
  side: Side;
  /** False when the anchor has left the reading region entirely. The
   *  caller fades the toolbar out instead of drawing it somewhere it no
   *  longer means anything. */
  visible: boolean;
}

export function placePopover({
  anchor,
  size,
  bounds,
  placement,
  margin,
  lockedSide,
}: PlacementInput): Placement {
  const above = anchor.top - size.height - margin;
  const below = anchor.bottom + margin;

  const roomAbove = above >= bounds.top;
  const roomBelow = below + size.height <= bounds.bottom;

  // Above is the default because it leaves the text you just selected
  // uncovered as you read down to it. Below is the fallback, and the
  // forced choice on the phone (Android draws its own toolbar above the
  // selection). Once open, the side is whatever it already was.
  const side: Side =
    lockedSide ??
    (placement === "below"
      ? roomBelow || !roomAbove
        ? "below"
        : "above"
      : roomAbove
        ? "above"
        : "below");

  // Clamp, never flip. Everything the toolbar does after opening is a
  // slide within the reading region.
  const wantedTop = side === "above" ? above : below;
  const top = clamp(wantedTop, bounds.top, bounds.bottom - size.height);

  // Anchored to where the selection STARTS, on the line the toolbar is
  // actually beside — the first line when it sits above, the last when
  // below. In RTL that is the line's right edge and the toolbar hangs
  // leftward from it; in LTR, mirrored.
  //
  // Start rather than centre because it is the one point that does not
  // move as the selection grows: drag two more lines and a centred
  // toolbar slides away under your hand, while this one stays put.
  const line = side === "above" ? anchor.firstLine : anchor.lastLine;
  const wanted = anchor.dir === "rtl" ? line.right - size.width : line.left;
  const left = clamp(
    wanted,
    bounds.left + margin,
    bounds.right - size.width - margin,
  );

  // Any overlap with the reading region counts as visible: half a line
  // showing is still a line the reader can see themselves highlighting,
  // and snatching the toolbar away at that point feels broken.
  const visible = anchor.bottom > bounds.top && anchor.top < bounds.bottom;

  // Whole pixels: a fixed element re-placed every scroll frame on a
  // fractional offset shimmers against the text behind it.
  return { top: Math.round(top), left: Math.round(left), side, visible };
}

/** Ordinary clamp, but tolerant of a range that has gone inverted —
 *  a viewport shorter than the toolbar itself, which happens on a phone
 *  in landscape with the keyboard up. The low bound wins there, so the
 *  toolbar stays reachable at the top rather than being pushed off. */
function clamp(value: number, low: number, high: number): number {
  if (high < low) return low;
  return Math.min(Math.max(value, low), high);
}
