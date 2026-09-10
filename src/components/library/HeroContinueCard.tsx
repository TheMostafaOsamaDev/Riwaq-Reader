
import { BookCover, } from "../BookCover";
import { Button } from "../Button";
import {
  type BookIndexEntry,
} from "../../store/library";
import { paletteForId } from "../../store/palette";
import {
  titleFontFor,
  type Theme,
} from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import { relTime } from "./relTime";

export function HeroContinueCard({
  theme,
  book,
  coverSrc,
  onOpen,
  onDelete,
  onEdit,
}: {
  theme: Theme;
  book: BookIndexEntry;
  coverSrc?: string;
  onOpen: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const { tr, locale } = useI18n();
  const isAr = locale === "ar";
  const palette = paletteForId(book.id);
  // Display-time fallback for a blank `Book.title` (see common.untitled) —
  // computed once so the tooltip, font-family pick, and rendered text all
  // agree on what's actually on screen.
  const displayTitle = book.title || tr("common.untitled");
  return (
    <div
      style={{
        display: "flex",
        gap: 40,
        marginBottom: 50,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      <BookCover
        title={book.title}
        author={book.author}
        palette={palette}
        size="lg"
        src={coverSrc}
      />
      {/* minWidth: 0 so the title's nowrap+ellipsis clips at the flex
          child's assigned width instead of letting the child grow to
          accommodate the full title. */}
      <div style={{ flex: 1, paddingTop: 10, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: theme.muted,
            letterSpacing: isAr ? "normal" : "0.12em",
            textTransform: isAr ? "none" : "uppercase",
            marginBottom: 10,
          }}
        >
          {book.lastReadAt ? tr("library.continueReading") : tr("library.startReading")}
        </div>
        <h1
          title={displayTitle}
          style={{
            // Arabic / mixed titles use the Readex Pro stack so digits and
            // Latin punctuation interleaved in the title don't fall through
            // to Fraunces and stand out as a different typeface.
            fontFamily: titleFontFor(displayTitle),
            // Italic only makes sense on Fraunces — suppress it for the
            // Readex Pro path to avoid synthetic italic on Arabic.
            fontStyle: "normal",
            fontWeight: 400,
            fontSize: 44,
            // Even more vertical room than 1.3 — the previous tweak still
            // clipped the bottom dot on letters like ج at this font size.
            lineHeight: 1.45,
            paddingBottom: 8,
            margin: "0 0 4px",
            letterSpacing: "-0.02em",
            color: theme.ink,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {displayTitle}
        </h1>
        <div style={{ fontSize: 13, color: theme.muted, marginBottom: 22 }}>
          {tr("library.byAuthorChapters", {
            author: book.author || tr("common.unknownAuthor"),
            n: book.chapterCount,
          })}
        </div>
        <div
          style={{
            padding: 18,
            background: theme.chrome,
            borderRadius: 10,
            border: `0.5px solid ${theme.rule}`,
            maxWidth: 480,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
            }}
          >
            <div
              style={{
                flex: 1,
                height: 4,
                background: theme.rule,
                borderRadius: 2,
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${book.progress * 100}%`,
                  background: theme.ink,
                  borderRadius: 2,
                }}
              />
            </div>
            <div
              style={{
                fontSize: 11,
                color: theme.muted,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {Math.round(book.progress * 100)}% · {relTime(book.lastReadAt ?? book.addedAt, tr)}
            </div>
          </div>
          <div
            style={{
              marginTop: 16,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Button theme={theme} variant="primary" size="md" onClick={onOpen}>
              {book.lastReadAt ? tr("library.resumeReadingCta") : tr("library.startReadingCta")}
            </Button>
            <Button theme={theme} variant="ghost" size="md" onClick={onEdit}>
              {tr("library.editDetails")}
            </Button>
            <Button
              theme={theme}
              variant="destructiveGhost"
              size="md"
              onClick={onDelete}
            >
              {tr("library.removeFromLibrary")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
