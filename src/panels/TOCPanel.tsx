import { useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import type { EpubChapter } from "../epub/types";
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { PanelShell } from "./PanelShell";

interface Props {
  theme: Theme;
  onClose?: () => void;
  bookTitle: string;
  chapters: EpubChapter[];
  currentChapter: number;
  onJump?: (order: number) => void;
  width?: number | string;
  side?: "left" | "right";
}

export function TOCPanel({
  theme,
  onClose,
  bookTitle,
  chapters,
  currentChapter,
  onJump,
  width,
  side = "left",
}: Props) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const filtered = useMemo(() => {
    if (!trimmed) return chapters;
    const needle = trimmed.toLowerCase();
    return chapters.filter((c) => c.title.toLowerCase().includes(needle));
  }, [chapters, trimmed]);

  return (
    <PanelShell
      theme={theme}
      title="Contents"
      subtitle={bookTitle}
      onClose={onClose}
      icon={<Icon name="list" size={15} />}
      width={width}
      side={side}
    >
      <SearchBar
        theme={theme}
        query={query}
        onChange={setQuery}
        onSubmit={() => {
          // Enter on a query that narrows to a single chapter jumps to
          // it — handy on mobile where Return doubles as the keyboard's
          // "go" key. Multi-match queries fall through (cursor stays).
          if (filtered.length === 1 && onJump) onJump(filtered[0].order);
        }}
      />
      <div style={{ padding: "8px 6px" }}>
        {filtered.length === 0 && (
          <div
            style={{
              padding: "32px 18px",
              textAlign: "center",
              color: theme.muted,
              fontSize: 12.5,
              fontFamily: FONT_STACKS.sans,
              lineHeight: 1.5,
            }}
          >
            No chapters match
            <span style={{ color: theme.ink, fontWeight: 500 }}>
              {" "}
              "{trimmed}"
            </span>
            .
          </div>
        )}
        {filtered.map((c) => {
          const active = c.order === currentChapter;
          const read = c.order < currentChapter;
          return (
            <button
              key={c.id}
              onClick={() => onJump?.(c.order)}
              style={{
                width: "100%",
                textAlign: "left",
                border: "none",
                background: active ? theme.hover : "transparent",
                padding: "11px 14px",
                borderRadius: 8,
                cursor: "pointer",
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                color: theme.ink,
                marginBottom: 1,
              }}
            >
              <span
                style={{
                  fontFamily: FONT_STACKS.sans,
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: active ? theme.ink : theme.muted,
                  minWidth: 36,
                  letterSpacing: "0.04em",
                  opacity: read ? 0.55 : 1,
                }}
              >
                {String(c.order + 1).padStart(2, "0")}
              </span>
              <span
                style={{
                  fontFamily: FONT_SERIF_DISPLAY,
                  fontSize: 14.5,
                  fontWeight: active ? 500 : 400,
                  fontStyle: active ? "italic" : "normal",
                  color: read ? theme.muted : theme.ink,
                  flex: 1,
                  lineHeight: 1.3,
                }}
              >
                {c.title}
              </span>
              {active && (
                <span
                  style={{
                    fontFamily: FONT_STACKS.sans,
                    fontSize: 9,
                    color: theme.muted,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                  }}
                >
                  Now
                </span>
              )}
            </button>
          );
        })}
      </div>
    </PanelShell>
  );
}

function SearchBar({
  theme,
  query,
  onChange,
  onSubmit,
}: {
  theme: Theme;
  query: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  return (
    // Sticks to the top of the scroll container so the search field
    // stays reachable while scanning a long table of contents. zIndex 1
    // keeps it above the buttons that scroll under it.
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1,
        padding: "10px 12px",
        background: theme.bg,
        borderBottom: `0.5px solid ${theme.rule}`,
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          background: theme.hover,
          border: `0.5px solid ${theme.rule}`,
          borderRadius: 8,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            color: theme.muted,
            flexShrink: 0,
          }}
        >
          <Icon name="search" size={14} />
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onChange("");
            } else if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Search chapters"
          // dir=auto so Arabic / RTL queries lay out from the inline
          // start — the placeholder stays LTR because it's pure English.
          dir="auto"
          aria-label="Search chapters"
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            color: theme.ink,
            fontFamily: FONT_STACKS.sans,
            fontSize: 13,
            padding: "8px 8px 8px 0",
            WebkitAppearance: "none",
          }}
        />
        {query.length > 0 && (
          <button
            onClick={() => onChange("")}
            aria-label="Clear search"
            title="Clear search"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              border: "none",
              background: "transparent",
              color: theme.muted,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
