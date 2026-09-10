
import { BOOK_COVER_DIMS } from "../BookCover";
import type {
  BookIndexEntry,
} from "../../store/library";
import { SourceBadge } from "../SourceBadge";
import { getSourceMeta } from "../../sources/registry";
import type {
  Theme,
} from "../../styles/tokens";

/** Top-end corner marker flagging a source-backed library card with the
 *  source's favicon (globe fallback). Returns undefined for local books
 *  (epub/pdf/docx) so their covers render no marker. */
export function sourceCornerMarker(theme: Theme, book: BookIndexEntry) {
  if (book.kind !== "source" || !book.sourceId) return undefined;
  const meta = getSourceMeta(book.sourceId);
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
export const MOBILE_CARD_INTRINSIC_H = BOOK_COVER_DIMS.sm.h + 46;
