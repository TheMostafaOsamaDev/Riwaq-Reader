import { memo, } from "react";
import { Icon } from "../Icon";
import { BookCover, BOOK_COVER_DIMS } from "../BookCover";
import {
  type BookIndexEntry,
} from "../../store/library";
import { paletteForId } from "../../store/palette";
import {
  FONT_STACKS,
  isArabicTitle,
  titleFontFor,
  type Theme,
} from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import { CARD_INTRINSIC_H, sourceCornerMarker } from "./cardChrome";

export const LibraryCard = memo(function LibraryCard({
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
  /** Set when the card is rendered inside a shelf, so the context menu can
   *  offer "remove from this shelf". */
  shelfId?: string;
  onOpen: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number, shelfId?: string) => void;
}) {
  const { tr, locale } = useI18n();
  const isAr = locale === "ar";
  // Display-time fallback for a blank `Book.title` (see common.untitled) —
  // computed once so the tooltip, font-family pick, and rendered text all
  // agree on what's actually on screen.
  const displayTitle = book.title || tr("common.untitled");
  return (
    <div
      // Pin the whole card to the cover width so the title row's
      // ellipsis truncates at the cover edge and the progress meter
      // never extends past it. The grid track is `minmax(140, 1fr)` so
      // cells stretch on wide viewports — without this, everything
      // below the cover stretched with the cell.
      style={{
        position: "relative",
        width: BOOK_COVER_DIMS.md.w,
        // Skip layout + paint for cards scrolled out of view. The grid keeps
        // every card in the DOM (so Cmd+F, focus order and the scrollbar all
        // behave), but the renderer only does real work for what's near the
        // viewport. `contain-intrinsic-size` supplies the placeholder box so
        // skipped cards still reserve their space — no scrollbar jitter.
        contentVisibility: "auto",
        containIntrinsicSize: `${BOOK_COVER_DIMS.md.w}px ${CARD_INTRINSIC_H}px`,
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(book.id, e.clientX, e.clientY, shelfId);
      }}
    >
      <div style={{ cursor: "pointer" }} onClick={() => onOpen(book.id)}>
        <div style={{ position: "relative" }}>
          <BookCover
            title={book.title}
            author={book.author}
            palette={paletteForId(book.id)}
            size="md"
            src={coverSrc}
            badge={book.kind === "pdf" ? "PDF" : book.kind === "docx" ? "DOCX" : null}
            cornerMarker={sourceCornerMarker(theme, book)}
          />
          {book.progress === 0 && (
            <span
              aria-label={tr("library.newBadgeAriaLabel")}
              style={{
                position: "absolute",
                top: 8,
                insetInlineStart: 8,
                padding: "3px 7px",
                borderRadius: 4,
                // Dark blurred pill reads on any cover art without
                // dominating it. Same idiom we use elsewhere for cover-
                // surface overlays.
                background: "rgba(0,0,0,0.55)",
                color: "#fff",
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: isAr ? "normal" : "0.1em",
                textTransform: isAr ? "none" : "uppercase",
                fontFamily: FONT_STACKS.sans,
                backdropFilter: "blur(6px)",
                pointerEvents: "none",
              }}
            >
              {tr("library.newBadge")}
            </span>
          )}
        </div>
        <div
          title={displayTitle}
          style={{
            marginTop: 12,
            fontFamily: titleFontFor(displayTitle),
            fontSize: 14,
            lineHeight: isArabicTitle(displayTitle) ? 1.4 : 1.25,
            color: theme.ink,
            letterSpacing: "-0.005em",
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {displayTitle}
        </div>
        <div style={{ fontSize: 11, color: theme.muted, marginTop: 2 }}>
          {book.author || tr("common.unknownAuthor")}
        </div>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
            height: 14,
          }}
        >
          {book.progress >= 1 ? (
            <span
              style={{
                fontSize: 10,
                color: theme.muted,
                fontWeight: 600,
                letterSpacing: isAr ? "normal" : "0.06em",
                textTransform: isAr ? "none" : "uppercase",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Icon name="check" size={11} /> {tr("sidebar.finished")}
            </span>
          ) : book.progress > 0 ? (
            <>
              <div
                style={{
                  flex: 1,
                  height: 2,
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
              <span
                style={{
                  fontSize: 10,
                  color: theme.muted,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Math.round(book.progress * 100)}%
              </span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
});
