import { memo, useCallback } from "react";
import { useLongPress } from "../../hooks/useLongPress";
import { BookCover } from "../BookCover";
import type { BookIndexEntry } from "../../store/library";
import { paletteForId } from "../../store/palette";
import { titleFontFor, type Theme } from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import {
  MOBILE_AUTHOR_H,
  MOBILE_CARD_INTRINSIC_H,
  MOBILE_CARD_TEXT as M,
  MOBILE_TITLE_H,
  sourceCornerMarker,
} from "./cardChrome";

/** Mobile shelf-grid card. Memoized for the same reason as `LibraryCard`. */
export const MobileShelfCard = memo(function MobileShelfCard({
  theme,
  book,
  coverSrc,
  shelfId,
  onOpen,
  onContextMenu,
}: {
  theme: Theme;
  book: BookIndexEntry;
  coverSrc?: string;
  shelfId?: string;
  onOpen: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number, shelfId?: string) => void;
}) {
  const { tr } = useI18n();
  const longPress = useLongPress(
    useCallback(
      (x: number, y: number) => onContextMenu(book.id, x, y, shelfId),
      [onContextMenu, book.id, shelfId],
    ),
  );
  // Display-time fallback for a blank `Book.title` (see common.untitled) —
  // computed once so the font-family/line-height pick and the rendered
  // text agree on what's actually on screen.
  const displayTitle = book.title || tr("common.untitled");
  const displayAuthor = book.author || tr("common.unknownAuthor");
  return (
    <div
      onClick={() => {
        if (longPress.consumeLongPress()) return;
        onOpen(book.id);
      }}
      {...longPress.bind}
      style={{
        // `minWidth: 0` so a wide unbreakable string inside this grid item
        // doesn't push the cell past its `minmax(0, 1fr)` track.
        minWidth: 0,
        // See LibraryCard — off-screen cells skip layout/paint but keep their
        // reserved height so the grid doesn't reflow while scrolling.
        contentVisibility: "auto",
        containIntrinsicSize: `auto ${MOBILE_CARD_INTRINSIC_H}px`,
        // Suppress the platform long-press text-selection / callout so the
        // menu opens cleanly without a stray selection box flickering in.
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <BookCover
        title={book.title}
        author={book.author}
        palette={paletteForId(book.id)}
        size="sm"
        src={coverSrc}
        badge={
          book.kind === "pdf" ? "PDF" : book.kind === "docx" ? "DOCX" : null
        }
        cornerMarker={sourceCornerMarker(theme, book)}
        // Stretch the cover to the (constrained) cell width — the fixed
        // 110px `sm` size would overflow a 3-column grid on narrow phones.
        fluid
      />
      <div
        title={displayTitle}
        style={{
          fontFamily: titleFontFor(displayTitle),
          fontSize: M.titleSize,
          fontWeight: 500,
          marginTop: M.titleGap,
          lineHeight: M.titleLeading,
          color: theme.ink,
          letterSpacing: "-0.005em",
          // Two lines, always. Clamped so a long title cannot grow the card,
          // and reserved so a short one cannot shrink it — either way the
          // author below starts at the same offset in every card of the row.
          // `wordBreak` lets an unbreakable token wrap rather than blow out
          // the cell.
          display: "-webkit-box",
          WebkitLineClamp: M.titleLines,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          minHeight: MOBILE_TITLE_H,
          wordBreak: "break-word",
        }}
      >
        {displayTitle}
      </div>
      <div
        title={displayAuthor}
        style={{
          fontSize: M.authorSize,
          lineHeight: M.authorLeading,
          color: theme.muted,
          marginTop: M.authorGap,
          minHeight: MOBILE_AUTHOR_H,
          // One line, cropped at the cell edge. An author long enough to wrap
          // used to push the rail down and leave the card taller than the one
          // beside it.
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {displayAuthor}
      </div>
      {/* The rail's row is always present, so a card's height never depends
          on whether the book has been opened. Only what is drawn inside it
          does. */}
      <div style={{ height: M.railH, marginTop: M.railGap }}>
        {book.progress > 0 && book.progress < 1 && (
          <div
            style={{
              height: "100%",
              background: theme.rule,
              borderRadius: 1,
            }}
          >
            <div
              style={{
                width: `${book.progress * 100}%`,
                height: "100%",
                background: theme.muted,
                borderRadius: 1,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
});
