// Multi-select picker for adding existing library books to a shelf. Rendered
// as the *card* only — the scrim, centering, and enter/exit animation live in
// the caller's <AnimatedDialog> (same convention as ConfirmDialog).

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Button } from "./Button";
import { BookCover } from "./BookCover";
import { VirtualList } from "./VirtualList";
import { paletteForId } from "../store/palette";
import { isOnShelf } from "../store/shelfLogic";
import type { BookIndexEntry } from "../store/library";
import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  titleFontFor,
  type Theme,
} from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";

interface Props {
  theme: Theme;
  shelfName: string;
  shelfId: string;
  books: BookIndexEntry[];
  covers: Record<string, string>;
  onConfirm: (bookIds: string[]) => void;
  onClose: () => void;
}

const ROW_HEIGHT = 60;

export function AddToShelfDialog({
  theme,
  shelfName,
  shelfId,
  books,
  covers,
  onConfirm,
  onClose,
}: Props) {
  const { tr } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      books.filter(
        (b) =>
          !q ||
          b.title.toLowerCase().includes(q) ||
          (b.author ?? "").toLowerCase().includes(q),
      ),
    [books, q],
  );

  const toggle = (book: BookIndexEntry) => {
    if (isOnShelf(book.shelfIds, shelfId)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(book.id)) next.delete(book.id);
      else next.add(book.id);
      return next;
    });
  };

  const confirm = () => {
    if (selected.size === 0) return;
    onConfirm([...selected]);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-to-shelf-title"
      style={{
        width: "min(440px, calc(100vw - 32px))",
        maxHeight: "min(620px, calc(100vh - 32px))",
        background: theme.bg,
        color: theme.ink,
        borderRadius: 14,
        border: `0.5px solid ${theme.rule}`,
        boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
        fontFamily: FONT_STACKS.sans,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "18px 20px 14px",
          borderBottom: `0.5px solid ${theme.rule}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div
            id="add-to-shelf-title"
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontSize: 19,
              fontWeight: 400,
              color: theme.ink,
              lineHeight: 1.3,
              letterSpacing: "-0.01em",
            }}
          >
            {tr("shelves.pickerTitle", { shelf: shelfName })}
          </div>
          <button
            onClick={onClose}
            aria-label={tr("common.cancel")}
            style={{
              flexShrink: 0,
              width: 28,
              height: 28,
              borderRadius: 14,
              border: `0.5px solid ${theme.rule}`,
              background: "transparent",
              color: theme.muted,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        <div style={{ position: "relative", marginTop: 12 }}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              insetInlineStart: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: theme.muted,
              display: "flex",
              pointerEvents: "none",
            }}
          >
            <Icon name="search" size={15} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("shelves.pickerSearch")}
            style={{
              width: "100%",
              boxSizing: "border-box",
              paddingInlineStart: 34,
              paddingInlineEnd: 12,
              paddingBlock: 9,
              border: `1px solid ${theme.rule}`,
              background: theme.chrome,
              color: theme.ink,
              borderRadius: 9,
              font: "inherit",
              fontSize: 13.5,
              outline: "none",
            }}
          />
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, minHeight: 0, padding: "4px 10px" }}>
        {books.length === 0 ? (
          <EmptyRow theme={theme} text={tr("shelves.pickerEmpty")} />
        ) : filtered.length === 0 ? (
          <EmptyRow theme={theme} text={tr("library.emptyGeneric")} />
        ) : (
          <VirtualList
            items={filtered}
            itemHeight={ROW_HEIGHT}
            itemKey={(b) => b.id}
            style={{ height: "100%" }}
            ariaLabel={tr("shelves.pickerSearch")}
            renderItem={(b) => (
              <BookRow
                theme={theme}
                book={b}
                coverSrc={covers[b.id]}
                onShelf={isOnShelf(b.shelfIds, shelfId)}
                selected={selected.has(b.id)}
                onToggle={() => toggle(b)}
              />
            )}
          />
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "14px 20px",
          borderTop: `0.5px solid ${theme.rule}`,
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <Button theme={theme} variant="outline" size="sm" onClick={onClose}>
          {tr("common.cancel")}
        </Button>
        <Button
          theme={theme}
          variant="primary"
          size="sm"
          onClick={confirm}
          disabled={selected.size === 0}
        >
          {tr("shelves.pickerAdd", { n: selected.size })}
        </Button>
      </div>
    </div>
  );
}

function EmptyRow({ theme, text }: { theme: Theme; text: string }) {
  return (
    <div
      style={{
        padding: "40px 16px",
        textAlign: "center",
        color: theme.muted,
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  );
}

function BookRow({
  theme,
  book,
  coverSrc,
  onShelf,
  selected,
  onToggle,
}: {
  theme: Theme;
  book: BookIndexEntry;
  coverSrc?: string;
  onShelf: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const { tr } = useI18n();
  const [hover, setHover] = useState(false);
  const displayTitle = book.title || tr("common.untitled");
  const checked = onShelf || selected;

  return (
    <div
      onClick={onShelf ? undefined : onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="checkbox"
      aria-checked={checked}
      aria-disabled={onShelf}
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 8px",
        borderRadius: 10,
        cursor: onShelf ? "default" : "pointer",
        opacity: onShelf ? 0.55 : 1,
        background: hover && !onShelf ? theme.hover : "transparent",
        transition: "background 120ms ease",
      }}
    >
      <div style={{ width: 32, flexShrink: 0 }}>
        <BookCover
          title={book.title}
          author={book.author}
          palette={paletteForId(book.id)}
          size="sm"
          src={coverSrc}
          fluid
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: titleFontFor(displayTitle),
            fontSize: 13.5,
            fontWeight: 500,
            color: theme.ink,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {displayTitle}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: theme.muted,
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {book.author || tr("common.unknownAuthor")}
        </div>
      </div>
      {onShelf ? (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            color: theme.muted,
            fontSize: 11,
            fontWeight: 500,
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
        >
          <Icon name="check" size={13} />
          {tr("shelves.onShelf")}
        </span>
      ) : (
        <span
          aria-hidden
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            flexShrink: 0,
            border: `1.5px solid ${selected ? theme.ink : theme.rule}`,
            background: selected ? theme.ink : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: theme.bg,
            transition: "background 120ms ease, border-color 120ms ease",
          }}
        >
          {selected && <Icon name="check" size={12} stroke={2.6} />}
        </span>
      )}
    </div>
  );
}
