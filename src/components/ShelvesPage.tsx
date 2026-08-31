// The "Shelves" content page — opened from the sidebar's Shelves item.
// Each custom shelf renders as its own horizontal row of book covers,
// ending in a dashed "add a book" tile. An empty shelf shows *only* that
// add tile — no separate "no books yet" placeholder — so there's always a
// one-click way to start filling it.

import { useEffect, useRef, useState, memo} from "react";
import { FONT_SERIF_DISPLAY, FONT_STACKS, titleFontFor, type Theme } from "../styles/tokens";
import { Icon, type IconProps } from "./Icon";
import { BookCover, BOOK_COVER_DIMS } from "./BookCover";
import { SectionCarousel } from "./SectionCarousel";
import { useI18n } from "../i18n/useI18n";
import type { Shelf } from "../store/shelves";
import type { BookIndexEntry } from "../store/library";
import { booksOnShelf } from "../store/shelfLogic";
import { paletteForId } from "../store/palette";

interface Props {
  theme: Theme;
  shelves: Shelf[];
  books: BookIndexEntry[];
  covers: Record<string, string>;
  onOpenBook: (id: string) => void;
  onOpenShelf: (id: string) => void;
  onAddToShelf: (shelfId: string) => void;
  onRequestRenameShelf: (shelf: Shelf) => void;
  onRequestDeleteShelf: (shelf: Shelf) => void;
  onNewShelf: () => void;
  /** Optional parity with the single-shelf detail page's context-menu
   *  "Remove from shelf" row (Task 14): when provided, each cover shows a
   *  small hover "×" that calls it directly. Omitting it (e.g. on a
   *  touch-only build) just skips the affordance — touch users still reach
   *  the same action from the book's own context menu. */
  onRemoveFromShelf?: (bookId: string, shelfId: string) => void;
}

export function ShelvesPage({
  theme,
  shelves,
  books,
  covers,
  onOpenBook,
  onOpenShelf,
  onAddToShelf,
  onRequestRenameShelf,
  onRequestDeleteShelf,
  onNewShelf,
  onRemoveFromShelf,
}: Props) {
  const { tr, dir } = useI18n();
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px 48px", fontFamily: FONT_STACKS.sans }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: FONT_SERIF_DISPLAY, fontWeight: 400, fontSize: 30, margin: 0, letterSpacing: "-0.01em", color: theme.ink }}>
            {tr("shelves.title")}
          </h1>
          <div style={{ fontSize: 13, color: theme.muted, marginTop: 4 }}>
            {tr(shelves.length === 1 ? "shelves.countOne" : "shelves.countOther", { n: shelves.length })}
          </div>
        </div>
        <button
          onClick={onNewShelf}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, border: 0, background: theme.ink, color: theme.paper, borderRadius: 10, padding: "10px 16px", font: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
        >
          <Icon name="plus" size={15} /> {tr("shelves.newShelf")}
        </button>
      </div>

      {shelves.length === 0 ? (
        <div style={{ maxWidth: 440, margin: "56px auto", padding: 32, borderRadius: 14, background: theme.chrome, border: `0.5px solid ${theme.rule}`, textAlign: "center" }}>
          <div style={{ fontFamily: FONT_SERIF_DISPLAY, fontSize: 24, color: theme.ink, marginBottom: 8 }}>{tr("shelves.empty")}</div>
          <div style={{ fontSize: 13, color: theme.muted, lineHeight: 1.55 }}>{tr("shelves.emptyHint")}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 34 }}>
          {shelves.map((s) => (
            <ShelfSection
              key={s.id}
              theme={theme}
              shelf={s}
              books={booksOnShelf(books, s.id)}
              covers={covers}
              rtl={dir === "rtl"}
              onOpenBook={onOpenBook}
              onOpenShelf={onOpenShelf}
              onAddToShelf={onAddToShelf}
              onRequestRenameShelf={onRequestRenameShelf}
              onRequestDeleteShelf={onRequestDeleteShelf}
              onRemoveFromShelf={onRemoveFromShelf}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Dashed "add a book" tile. Doubles as the affordance at the end of every
// shelf row AND as the sole content of an empty shelf's row — exported so
// other add-to-shelf entry points (the single-shelf detail view) can reuse
// the exact same visual.
export function AddTile({
  theme,
  label,
  onClick,
}: {
  theme: Theme;
  label?: string;
  onClick: () => void;
}) {
  const { tr } = useI18n();
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      aria-label={label ?? tr("shelves.addBook")}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        minWidth: 116,
        height: 172,
        border: `1px dashed ${theme.rule}`,
        borderRadius: 12,
        background: hover ? theme.hover : "transparent",
        color: theme.muted,
        cursor: "pointer",
        font: "inherit",
        transition: "background 120ms ease",
      }}
    >
      <Icon name="plus" size={20} />
      <span style={{ fontSize: 12.5 }}>{label ?? tr("shelves.addBook")}</span>
    </button>
  );
}

interface ShelfSectionProps {
  theme: Theme;
  shelf: Shelf;
  books: BookIndexEntry[];
  covers: Record<string, string>;
  rtl: boolean;
  onOpenBook: (id: string) => void;
  onOpenShelf: (id: string) => void;
  onAddToShelf: (shelfId: string) => void;
  onRequestRenameShelf: (shelf: Shelf) => void;
  onRequestDeleteShelf: (shelf: Shelf) => void;
  onRemoveFromShelf?: (bookId: string, shelfId: string) => void;
}

function ShelfSection({
  theme,
  shelf,
  books,
  covers,
  rtl,
  onOpenBook,
  onOpenShelf,
  onAddToShelf,
  onRequestRenameShelf,
  onRequestDeleteShelf,
  onRemoveFromShelf,
}: ShelfSectionProps) {
  const { tr } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuHover, setMenuHover] = useState(false);

  return (
    <section
      style={{
        // A library with many shelves stacks many of these rows, each holding
        // a full carousel of covers. Off-screen rows skip layout and paint;
        // the intrinsic size keeps their slot reserved so the page doesn't
        // reflow as you scroll past.
        contentVisibility: "auto",
        containIntrinsicSize: `auto ${SHELF_ROW_INTRINSIC_H}px`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ color: theme.muted, display: "flex", flexShrink: 0 }}>
          <Icon name="layers" size={16} />
        </span>
        <button
          onClick={() => onOpenShelf(shelf.id)}
          style={{
            display: "flex",
            alignItems: "baseline",
            border: 0,
            background: "transparent",
            padding: 0,
            margin: 0,
            font: "inherit",
            cursor: "pointer",
            color: theme.ink,
            minWidth: 0,
          }}
        >
          <h2
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontWeight: 400,
              fontSize: 20,
              margin: 0,
              color: "inherit",
            }}
          >
            {shelf.name}
          </h2>
        </button>
        <span style={{ fontSize: 12, color: theme.muted, flexShrink: 0 }}>
          {tr(
            books.length === 1 ? "shelves.bookCountOne" : "shelves.bookCountOther",
            { n: books.length },
          )}
        </span>
        <div style={{ marginInlineStart: "auto", position: "relative", flexShrink: 0 }}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={tr("shelves.shelfOptions", { shelf: shelf.name })}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onMouseEnter={() => setMenuHover(true)}
            onMouseLeave={() => setMenuHover(false)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 30,
              height: 30,
              borderRadius: 8,
              border: 0,
              background: menuOpen || menuHover ? theme.hover : "transparent",
              color: theme.muted,
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              font: "inherit",
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <ShelfOverflowMenu
              theme={theme}
              onRename={() => {
                setMenuOpen(false);
                onRequestRenameShelf(shelf);
              }}
              onDelete={() => {
                setMenuOpen(false);
                onRequestDeleteShelf(shelf);
              }}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>

      {books.length === 0 ? (
        // Empty shelf: the row holds only the add tile — no "no books yet"
        // placeholder box. This is the affordance fix requested for empty
        // shelves (previously a dead-end dashed box with no action).
        <div style={{ display: "flex" }}>
          <AddTile onClick={() => onAddToShelf(shelf.id)} theme={theme} />
        </div>
      ) : (
        <SectionCarousel theme={theme} rtl={rtl} cardWidth={BOOK_COVER_DIMS.sm.w} gap={14}>
          {books.map((b) => (
            <div key={b.id} style={{ scrollSnapAlign: "start", flexShrink: 0 }}>
              <ShelfBookTile
                theme={theme}
                book={b}
                coverSrc={covers[b.id]}
                shelfId={shelf.id}
                onOpen={onOpenBook}
                onRemove={onRemoveFromShelf}
              />
            </div>
          ))}
          <div style={{ scrollSnapAlign: "start", flexShrink: 0 }}>
            <AddTile onClick={() => onAddToShelf(shelf.id)} theme={theme} />
          </div>
        </SectionCarousel>
      )}
    </section>
  );
}

// Compact per-book tile for a shelf row: a small cover + a clamped title,
// matching the same cover-then-title stacking the mobile shelf grid uses
// (MobileShelfCard in Library.tsx) but at the carousel's fixed card width
// instead of a fluid grid cell.
/** Heading + carousel of one shelf row: the title line, the covers, and the
 *  trailing add tile. Used as the `contain-intrinsic-size` placeholder for
 *  rows that are scrolled out of view. */
const SHELF_ROW_INTRINSIC_H = BOOK_COVER_DIMS.sm.h + 92;

/** Memoized: the shelves page renders every book of every shelf, so a state
 *  change anywhere (a rename dialog, a refresh) used to reconcile all of
 *  them. Callbacks take the book id so they can stay stable. */
const ShelfBookTile = memo(function ShelfBookTile({
  theme,
  book,
  coverSrc,
  shelfId,
  onOpen,
  onRemove,
}: {
  theme: Theme;
  book: BookIndexEntry;
  coverSrc?: string;
  shelfId: string;
  onOpen: (id: string) => void;
  /** Optional parity affordance (Task 14) — shows a small hover "×" over
   *  the cover that removes the book from just this shelf. Undefined when
   *  the caller didn't wire it up; the row then only offers the click-through
   *  to the book itself (touch users still reach "Remove from shelf" via the
   *  book's own context menu on the single-shelf detail page). */
  onRemove?: (bookId: string, shelfId: string) => void;
}) {
  const { tr } = useI18n();
  const [hover, setHover] = useState(false);
  const displayTitle = book.title || tr("common.untitled");
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        width: BOOK_COVER_DIMS.sm.w,
      }}
    >
      <div style={{ position: "relative" }}>
        <button
          onClick={() => onOpen(book.id)}
          style={{
            display: "block",
            border: 0,
            background: "transparent",
            padding: 0,
            font: "inherit",
            cursor: "pointer",
            textAlign: "start",
          }}
        >
          <BookCover
            title={book.title}
            author={book.author}
            palette={paletteForId(book.id)}
            size="sm"
            src={coverSrc}
            badge={book.kind === "pdf" ? "PDF" : book.kind === "docx" ? "DOCX" : null}
          />
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(book.id, shelfId);
            }}
            aria-label={tr("shelves.removeFromShelf")}
            title={tr("shelves.removeFromShelf")}
            style={{
              position: "absolute",
              top: 4,
              insetInlineEnd: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              borderRadius: "50%",
              border: 0,
              background: "rgba(0,0,0,0.55)",
              color: "#fff",
              cursor: "pointer",
              padding: 0,
              opacity: hover ? 1 : 0,
              transition: "opacity 120ms ease",
              pointerEvents: hover ? "auto" : "none",
            }}
          >
            <Icon name="close" size={13} stroke={2} />
          </button>
        )}
      </div>
      <button
        onClick={() => onOpen(book.id)}
        style={{
          display: "block",
          width: "100%",
          border: 0,
          background: "transparent",
          padding: 0,
          font: "inherit",
          cursor: "pointer",
          textAlign: "start",
        }}
      >
      <span
        style={{
          marginTop: 8,
          width: "100%",
          fontFamily: titleFontFor(displayTitle),
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.3,
          color: theme.ink,
          letterSpacing: "-0.005em",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          wordBreak: "break-word",
        }}
      >
        {displayTitle}
      </span>
      </button>
    </div>
  );
});

// Small anchored popover for the section header's "⋯" button — Rename /
// Delete. Deliberately lighter-weight than AddToShelfMenu (no fixed-overlay
// scrim): it's a two-row menu anchored to its trigger, dismissed on outside
// click or Escape, same as a native dropdown.
function ShelfOverflowMenu({
  theme,
  onRename,
  onDelete,
  onClose,
}: {
  theme: Theme;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { tr } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "absolute",
        insetInlineEnd: 0,
        top: "calc(100% + 6px)",
        minWidth: 168,
        background: theme.bg,
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
        borderRadius: 10,
        boxShadow: "0 12px 32px rgba(0,0,0,0.22)",
        padding: 4,
        zIndex: 20,
      }}
    >
      <ShelfMenuItem theme={theme} icon="pencil" label={tr("shelves.rename")} onClick={onRename} />
      <div style={{ height: 0.5, background: theme.rule, margin: "4px 6px" }} />
      <ShelfMenuItem theme={theme} icon="trash" label={tr("shelves.delete")} onClick={onDelete} destructive />
    </div>
  );
}

function ShelfMenuItem({
  theme,
  icon,
  label,
  onClick,
  destructive,
}: {
  theme: Theme;
  icon: IconProps["name"];
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        border: 0,
        background: hover ? theme.hover : "transparent",
        color: destructive ? "#c04a3a" : theme.ink,
        borderRadius: 7,
        padding: "8px 10px",
        font: "inherit",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        textAlign: "start",
      }}
    >
      <Icon name={icon} size={15} stroke={1.7} />
      <span>{label}</span>
    </button>
  );
}
