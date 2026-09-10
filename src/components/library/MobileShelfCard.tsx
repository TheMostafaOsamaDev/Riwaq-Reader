import { memo, useCallback, } from "react";
import { useLongPress } from "../../hooks/useLongPress";
import { BookCover, } from "../BookCover";
import {
  type BookIndexEntry,
} from "../../store/library";
import { paletteForId } from "../../store/palette";
import {
  titleFontFor,
  type Theme,
} from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import { MOBILE_CARD_INTRINSIC_H, sourceCornerMarker } from "./cardChrome";

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
        badge={book.kind === "pdf" ? "PDF" : book.kind === "docx" ? "DOCX" : null}
        cornerMarker={sourceCornerMarker(theme, book)}
        // Stretch the cover to the (constrained) cell width — the fixed
        // 110px `sm` size would overflow a 3-column grid on narrow phones.
        fluid
      />
      <div
        style={{
          fontFamily: titleFontFor(displayTitle),
          fontSize: 12,
          fontWeight: 500,
          marginTop: 8,
          lineHeight: 1.3,
          color: theme.ink,
          letterSpacing: "-0.005em",
          // Clamp the title to 2 lines so cards keep a consistent height
          // instead of jumping to 3+ lines on long titles, and let unbreakable
          // tokens wrap so they don't blow out the cell.
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          wordBreak: "break-word",
        }}
      >
        {displayTitle}
      </div>
      <div style={{ fontSize: 9.5, color: theme.muted, marginTop: 2 }}>
        {book.author || tr("common.unknownAuthor")}
      </div>
      {book.progress > 0 && book.progress < 1 && (
        <div
          style={{
            height: 2,
            background: theme.rule,
            borderRadius: 1,
            marginTop: 6,
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
  );
});
