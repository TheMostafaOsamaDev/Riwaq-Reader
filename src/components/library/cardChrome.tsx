import { useEffect } from "react";
import { BOOK_COVER_DIMS } from "../BookCover";
import type { BookIndexEntry } from "../../store/library";
import { SourceBadge } from "../SourceBadge";
import { getSourceMeta } from "../../sources/registry";
import {
  loadExtensionsOnFirstGesture,
  useExtensionsRevision,
} from "../../sources/useExtensions";
import type { Theme } from "../../styles/tokens";

/** Top-end corner marker flagging a source-backed library card with the
 *  source's favicon (globe fallback). Returns undefined for local books
 *  (epub/pdf/docx) so their covers render no marker. */
export function sourceCornerMarker(theme: Theme, book: BookIndexEntry) {
  if (book.kind !== "source" || !book.sourceId) return undefined;
  return <SourceCornerMarker theme={theme} sourceId={book.sourceId} />;
}

/** A component rather than the plain `getSourceMeta` call this used to be,
 *  because the registry is not populated when the library first paints and
 *  a value read during that render never corrects itself. Without this the
 *  icon and the source's name were missing from every source-backed card
 *  for the whole of a cold launch.
 *
 *  It subscribes (so the badge fills in the moment any load commits) and it
 *  arms the first-gesture load (so something actually loads — the grid is
 *  on screen before any navigation has happened, and must not start the
 *  load from its own mount). Both are explained in sources/useExtensions.ts;
 *  the placement rule is not stylistic. */
function SourceCornerMarker({
  theme,
  sourceId,
}: {
  theme: Theme;
  sourceId: string;
}) {
  useExtensionsRevision();
  useEffect(loadExtensionsOnFirstGesture, []);
  const meta = getSourceMeta(sourceId);
  return (
    <SourceBadge
      theme={theme}
      variant="corner"
      iconUrl={meta?.iconUrl}
      label={meta?.name}
    />
  );
}

/**
 * Desktop library grid card.
 *
 * Memoized, and its callbacks take the book id rather than being pre-bound at
 * the call site. With a few hundred books, an inline `() => onOpen(b.id)` per
 * cell meant every card re-rendered on any Library state change (tab switch,
 * context menu open, a refresh); now a card only re-renders when its own
 * book or cover changes.
 */
/** Approximate rendered height of a grid card: cover + title + meta row.
 *  Only used as the `contain-intrinsic-size` placeholder for off-screen
 *  cards, so being a few px out costs nothing once a card scrolls in. */
export const CARD_INTRINSIC_H = BOOK_COVER_DIMS.md.h + 52;

/** The mobile grid card's text block, as a fixed three-row stack: two lines
 *  of title, one line of author, one progress rail.
 *
 *  Every row reserves its height whatever the book is called, because the eye
 *  reads a grid across the row, not down the column. Left to size themselves
 *  the rows drifted three different ways: the title clamped at two lines but
 *  occupied one when it could, the author had no clamp and wrapped, and the
 *  rail was only rendered once a book had been opened — so no two cards in a
 *  row ended at the same place.
 *
 *  Shared with the card so the intrinsic-size estimate below cannot drift
 *  from what is actually rendered. */
export const MOBILE_CARD_TEXT = {
  titleSize: 12,
  titleLeading: 1.3,
  titleLines: 2,
  authorSize: 9.5,
  authorLeading: 1.35,
  /** Space above the title, the author, and the rail. */
  titleGap: 8,
  authorGap: 2,
  railGap: 6,
  railH: 2,
} as const;

export const MOBILE_TITLE_H =
  MOBILE_CARD_TEXT.titleSize *
  MOBILE_CARD_TEXT.titleLeading *
  MOBILE_CARD_TEXT.titleLines;
export const MOBILE_AUTHOR_H =
  MOBILE_CARD_TEXT.authorSize * MOBILE_CARD_TEXT.authorLeading;

export const MOBILE_CARD_INTRINSIC_H =
  BOOK_COVER_DIMS.sm.h +
  Math.round(
    MOBILE_CARD_TEXT.titleGap +
      MOBILE_TITLE_H +
      MOBILE_CARD_TEXT.authorGap +
      MOBILE_AUTHOR_H +
      MOBILE_CARD_TEXT.railGap +
      MOBILE_CARD_TEXT.railH,
  );
