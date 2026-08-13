import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import {
  FONT_STACKS,
  HIGHLIGHT_COLORS,
  type HighlightColor,
  type Theme,
} from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";
import type { MsgKey } from "../i18n";

interface Props {
  theme: Theme;
  /** Viewport-coordinate rect of the current selection; popover positions
      itself relative to this. */
  anchor: DOMRect;
  /** "auto" (default): place above if there's room, else below.
   *  "below": always below the selection — used on mobile so the
   *  popover never overlaps Android's native floating toolbar that
   *  sits above the selected text. */
  placement?: "auto" | "below";
  onPick: (color: HighlightColor) => void;
  onAddNote: (color: HighlightColor, note: string) => void;
  onDismiss: () => void;
}

const COLORS: HighlightColor[] = ["yellow", "blue", "pink", "green"];
const DEFAULT_COLOR: HighlightColor = "yellow";

/** Localized color name for the swatch aria-labels below. */
const COLOR_NAME_KEY: Record<HighlightColor, MsgKey> = {
  yellow: "color.yellow",
  blue: "color.blue",
  pink: "color.pink",
  green: "color.green",
};

export function SelectionPopover({
  theme,
  anchor,
  placement = "auto",
  onPick,
  onAddNote,
  onDismiss,
}: Props) {
  const { tr } = useI18n();
  const [noteMode, setNoteMode] = useState(false);
  const [noteColor, setNoteColor] = useState<HighlightColor>(DEFAULT_COLOR);
  const [note, setNote] = useState("");

  // Esc dismisses. Don't close on outside-click here — the parent owns
  // the selection lifecycle and dismisses us when the selection clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  // Position above the selection; flip below if there isn't room or
  // when the caller explicitly requested below (mobile path — see
  // the `placement` prop). The anchor rect is in viewport coords, so
  // `position: fixed` keeps the popover stable even if the underlying
  // scroll container moves.
  const margin = 8;
  const estimatedHeight = noteMode ? 132 : 44;
  const fitsAbove =
    placement === "auto" && anchor.top - estimatedHeight - margin > 8;
  const top = fitsAbove
    ? anchor.top - estimatedHeight - margin
    : anchor.bottom + margin;
  const center = anchor.left + anchor.width / 2;

  return (
    <div
      role="toolbar"
      aria-label={tr("selection.ariaLabel")}
      data-popover="highlight"
      onMouseDown={(e) => {
        // Keep the underlying selection alive while the user clicks our
        // controls — without this, mousedown on the popover collapses
        // the selection before we can read its anchor.
        e.preventDefault();
      }}
      style={{
        position: "fixed",
        top,
        left: center,
        transform: "translateX(-50%)",
        zIndex: 9000,
        padding: noteMode ? "10px 12px" : "6px 8px",
        background: theme.bg,
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        fontFamily: FONT_STACKS.sans,
        display: "flex",
        flexDirection: noteMode ? "column" : "row",
        alignItems: noteMode ? "stretch" : "center",
        gap: 8,
        minWidth: noteMode ? 260 : undefined,
      }}
    >
      {!noteMode ? (
        <>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onPick(c)}
              aria-label={tr("selection.colorAriaLabel", { color: tr(COLOR_NAME_KEY[c]) })}
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                border: "none",
                background: HIGHLIGHT_COLORS[c].dot,
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
          <div
            style={{
              width: 1,
              height: 18,
              background: theme.rule,
              margin: "0 2px",
            }}
          />
          <button
            onClick={() => setNoteMode(true)}
            aria-label={tr("highlights.addNote")}
            title={tr("highlights.addNote")}
            style={{
              width: 28,
              height: 28,
              border: "none",
              borderRadius: 6,
              background: "transparent",
              color: theme.ink,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="pencil" size={14} />
          </button>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNoteColor(c)}
                aria-label={tr("selection.colorPickAriaLabel", { color: tr(COLOR_NAME_KEY[c]) })}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  border:
                    c === noteColor
                      ? `2px solid ${theme.ink}`
                      : "2px solid transparent",
                  background: HIGHLIGHT_COLORS[c].dot,
                  cursor: "pointer",
                  padding: 0,
                }}
              />
            ))}
          </div>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onAddNote(noteColor, note);
              }
            }}
            placeholder={tr("highlights.whyMatterPlaceholder")}
            rows={3}
            style={{
              width: "100%",
              background: theme.chrome,
              color: theme.ink,
              border: `0.5px solid ${theme.rule}`,
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: 12,
              fontFamily: FONT_STACKS.sans,
              outline: "none",
              resize: "vertical",
              minHeight: 60,
            }}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                setNoteMode(false);
                setNote("");
              }}
              style={ghostBtn(theme)}
            >
              {tr("common.cancel")}
            </button>
            <button
              onClick={() => onAddNote(noteColor, note)}
              style={primaryBtn(theme)}
            >
              {tr("common.save")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ghostBtn(theme: Theme): React.CSSProperties {
  return {
    padding: "5px 10px",
    border: `0.5px solid ${theme.rule}`,
    borderRadius: 6,
    background: "transparent",
    color: theme.ink,
    fontSize: 11.5,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: FONT_STACKS.sans,
  };
}

function primaryBtn(theme: Theme): React.CSSProperties {
  return {
    padding: "5px 10px",
    border: "none",
    borderRadius: 6,
    background: theme.ink,
    color: theme.bg,
    fontSize: 11.5,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: FONT_STACKS.sans,
  };
}
