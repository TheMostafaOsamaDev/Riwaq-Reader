// Popover opened from the book-detail page's "Shelves" action: lets the
// reader toggle this single book's shelf membership without leaving the
// page. Self-contained overlay (owns its own scrim + centering + a light
// fade/pop animation) — same shape as AddToShelfMenu, so it's rendered
// directly by NovelDetailView rather than wrapped in AnimatedDialog.
//
// Pure membership editing: toggling a row here only adds/removes this
// book's id from a shelf's member list. It never touches the book itself —
// unchecking every shelf leaves the book in the library untouched (no
// orphan/keep-in-library prompt, unlike the shelf-page "remove" flow).

import { forwardRef, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import type { Shelf } from "../store/shelves";
import { FONT_STACKS, type Theme } from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";

interface Props {
  theme: Theme;
  shelves: Shelf[];
  /** This book's current shelf ids. */
  memberIds: string[];
  /** Toggles membership immediately — there's no separate "save" step. */
  onToggle: (shelfId: string) => void;
  onNewShelf: () => void;
  onClose: () => void;
}

export function ShelfChecklist({
  theme,
  shelves,
  memberIds,
  onToggle,
  onNewShelf,
  onClose,
}: Props) {
  const { tr } = useI18n();
  const firstRowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRowRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9500,
        background: "rgba(0,0,0,0.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: FONT_STACKS.sans,
        animation: "leafletShelfChecklistFade 130ms ease",
      }}
    >
      <style>{`
        @keyframes leafletShelfChecklistFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes leafletShelfChecklistPop {
          from { opacity: 0; transform: translateY(6px) scale(0.98); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        role="menu"
        aria-label={tr("novel.shelves")}
        style={{
          width: "min(300px, calc(100vw - 32px))",
          maxHeight: "min(420px, calc(100vh - 32px))",
          display: "flex",
          flexDirection: "column",
          background: theme.bg,
          color: theme.ink,
          border: `0.5px solid ${theme.rule}`,
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          overflow: "hidden",
          animation: "leafletShelfChecklistPop 150ms ease",
        }}
      >
        <div
          style={{
            padding: "14px 16px 10px",
            fontSize: 12.5,
            fontWeight: 600,
            color: theme.muted,
            borderBottom: `0.5px solid ${theme.rule}`,
            flexShrink: 0,
          }}
        >
          {tr("novel.shelves")}
        </div>
        <div
          style={{
            padding: 6,
            overflowY: "auto",
            flex: 1,
            minHeight: 0,
          }}
        >
          {shelves.length === 0 ? (
            <div
              style={{
                padding: "16px 12px",
                fontSize: 12.5,
                color: theme.muted,
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              {tr("shelves.empty")}
            </div>
          ) : (
            shelves.map((s, i) => (
              <ShelfRow
                key={s.id}
                ref={i === 0 ? firstRowRef : undefined}
                theme={theme}
                label={s.name}
                checked={memberIds.includes(s.id)}
                onClick={() => onToggle(s.id)}
              />
            ))
          )}
        </div>
        <div
          style={{
            borderTop: `0.5px solid ${theme.rule}`,
            padding: 6,
            flexShrink: 0,
          }}
        >
          <NewShelfRow
            ref={shelves.length === 0 ? firstRowRef : undefined}
            theme={theme}
            label={tr("sidebar.newShelf")}
            onClick={() => {
              onNewShelf();
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}

const ShelfRow = forwardRef<HTMLButtonElement, {
  theme: Theme;
  label: string;
  checked: boolean;
  onClick: () => void;
}>(function ShelfRow({ theme, label, checked, onClick }, ref) {
  const [hover, setHover] = useState(false);
  return (
    <button
      ref={ref}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="menuitemcheckbox"
      aria-checked={checked}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        border: "none",
        background: hover ? theme.hover : "transparent",
        color: theme.ink,
        borderRadius: 8,
        padding: "10px 12px",
        font: "inherit",
        fontSize: 13.5,
        fontWeight: 500,
        cursor: "pointer",
        transition: "background 120ms ease",
        textAlign: "start",
      }}
    >
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          flexShrink: 0,
          border: `1.5px solid ${checked ? theme.ink : theme.rule}`,
          background: checked ? theme.ink : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: theme.bg,
          transition: "background 120ms ease, border-color 120ms ease",
        }}
      >
        {checked && <Icon name="check" size={12} stroke={2.6} />}
      </span>
    </button>
  );
});

const NewShelfRow = forwardRef<HTMLButtonElement, {
  theme: Theme;
  label: string;
  onClick: () => void;
}>(function NewShelfRow({ theme, label, onClick }, ref) {
  const [hover, setHover] = useState(false);
  return (
    <button
      ref={ref}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        border: "none",
        background: hover ? theme.hover : "transparent",
        color: theme.muted,
        borderRadius: 8,
        padding: "10px 12px",
        font: "inherit",
        fontSize: 13.5,
        fontWeight: 500,
        cursor: "pointer",
        transition: "background 120ms ease",
        textAlign: "start",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          flexShrink: 0,
          color: theme.ink,
        }}
      >
        <Icon name="plus" size={14} />
      </span>
      <span>{label}</span>
    </button>
  );
});
