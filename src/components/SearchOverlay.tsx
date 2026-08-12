// Full-screen "command palette" search, opened from the sidebar search
// button or ⌘K / Ctrl-K. Type to filter the library live (title / author);
// click a result to open it, or press Enter to apply the term as a shelf
// filter. With no term, shows recent searches + quick "Jump to" shortcuts.

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import type { IconProps } from "./Icon";
import { FONT_STACKS, type Theme, type ThemeKey } from "../styles/tokens";
import type { BookIndexEntry } from "../store/library";
import type { LibraryTab } from "./Library";

const RECENT_KEY = "riwaq:recent-searches:v1";

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]).slice(0, 6) : [];
  } catch {
    return [];
  }
}
function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {
    /* ignore */
  }
}

interface Props {
  theme: Theme;
  themeKey: ThemeKey;
  books: BookIndexEntry[];
  covers: Record<string, string>;
  onOpen: (id: string) => void;
  setTab: (t: LibraryTab) => void;
  setQuery: (q: string) => void;
  onOpenSettings: () => void;
  onOpenQueue: () => void;
  onClose: () => void;
}

const JUMPS: { label: string; icon: IconProps["name"]; go: "all" | "reading" | "finished" | "wishlist" | "store" | "downloads" | "settings" }[] = [
  { label: "Library", icon: "grid", go: "all" },
  { label: "Reading", icon: "book", go: "reading" },
  { label: "Finished", icon: "check", go: "finished" },
  { label: "Wishlist", icon: "bookmark", go: "wishlist" },
  { label: "Store", icon: "globe", go: "store" },
  { label: "Downloads", icon: "download", go: "downloads" },
  { label: "Settings", icon: "settings", go: "settings" },
];

export function SearchOverlay({
  theme,
  themeKey,
  books,
  covers,
  onOpen,
  setTab,
  setQuery,
  onOpenSettings,
  onOpenQueue,
  onClose,
}: Props) {
  const dark = themeKey === "dark" || themeKey === "oled";
  const [term, setTerm] = useState("");
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = term.trim().toLowerCase();
  const results = useMemo(
    () =>
      q
        ? books
            .filter(
              (b) =>
                b.title.toLowerCase().includes(q) ||
                (b.author ?? "").toLowerCase().includes(q),
            )
            .slice(0, 8)
        : [],
    [q, books],
  );

  const remember = (t: string) => {
    const v = t.trim();
    if (!v) return;
    const next = [v, ...recent.filter((r) => r !== v)].slice(0, 6);
    setRecent(next);
    saveRecent(next);
  };

  const applyFilter = (t: string) => {
    remember(t);
    setTab("all");
    setQuery(t);
    onClose();
  };

  const jump = (go: (typeof JUMPS)[number]["go"]) => {
    if (go === "downloads") onOpenQueue();
    else if (go === "settings") onOpenSettings();
    else setTab(go);
    onClose();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: dark ? "rgba(0,0,0,0.55)" : "rgba(20,15,8,0.4)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "12vh 20px 20px",
        animation: "riwaqFadeIn 140ms ease",
      }}
    >
      <style>{`@keyframes riwaqFadeIn{from{opacity:0}to{opacity:1}}@keyframes riwaqRise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 720,
          fontFamily: FONT_STACKS.sans,
          animation: "riwaqRise 160ms ease",
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            background: theme.paper,
            border: `1px solid ${theme.rule}`,
            borderRadius: 16,
            padding: "16px 18px",
            boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          }}
        >
          <span style={{ color: theme.muted, display: "flex" }}>
            <Icon name="search" size={22} />
          </span>
          <input
            ref={inputRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (results[0]) { remember(term); onOpen(results[0].id); onClose(); }
                else if (q) applyFilter(term);
              }
            }}
            placeholder="Search books, authors…"
            style={{
              flex: 1,
              minWidth: 0,
              border: 0,
              outline: "none",
              background: "transparent",
              font: "inherit",
              fontSize: 19,
              color: theme.ink,
            }}
          />
          <button
            onClick={onClose}
            style={{
              fontSize: 11,
              letterSpacing: "0.1em",
              color: theme.muted,
              border: `1px solid ${theme.rule}`,
              borderRadius: 6,
              padding: "4px 8px",
              background: "transparent",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            ESC
          </button>
        </div>

        {/* Body */}
        <div style={{ marginTop: 18, padding: "0 4px" }}>
          {q ? (
            results.length ? (
              <>
                <OverlayLabel theme={theme} icon="search">Results</OverlayLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {results.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => { remember(term); onOpen(b.id); onClose(); }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 13,
                        padding: "8px 10px",
                        border: 0,
                        borderRadius: 10,
                        background: "transparent",
                        cursor: "pointer",
                        textAlign: "left",
                        font: "inherit",
                        transition: "background-color 120ms ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = theme.hover)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <span
                        style={{
                          width: 30,
                          height: 42,
                          borderRadius: 4,
                          flexShrink: 0,
                          background: covers[b.id]
                            ? `center/cover no-repeat url(${JSON.stringify(covers[b.id])})`
                            : `linear-gradient(150deg, ${theme.chromeInk}, ${theme.ink})`,
                          boxShadow: "0 2px 6px rgba(0,0,0,.2)",
                        }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 14, color: theme.ink, fontWeight: 500 }}>{b.title}</span>
                        <span style={{ display: "block", fontSize: 12, color: theme.muted, marginTop: 2 }}>{b.author || "Unknown"}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <button
                onClick={() => applyFilter(term)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  padding: "14px 12px", border: `1px dashed ${theme.rule}`, borderRadius: 12,
                  background: "transparent", color: theme.muted, cursor: "pointer", font: "inherit", fontSize: 14,
                }}
              >
                <Icon name="search" size={16} /> No matches — filter the shelf for “{term.trim()}”
              </button>
            )
          ) : (
            <>
              {recent.length > 0 && (
                <>
                  <OverlayLabel theme={theme} icon="clock" action={{ label: "Clear history", onClick: () => { setRecent([]); saveRecent([]); } }}>
                    Recent searches
                  </OverlayLabel>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                    {recent.map((r) => (
                      <span key={r} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: theme.chrome, borderRadius: 20, padding: "7px 8px 7px 13px", fontSize: 13, color: theme.ink }}>
                        <button onClick={() => { setTerm(r); inputRef.current?.focus(); }} style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", font: "inherit", padding: 0 }}>{r}</button>
                        <button aria-label={`Remove ${r}`} onClick={() => { const n = recent.filter((x) => x !== r); setRecent(n); saveRecent(n); }} style={{ display: "flex", border: 0, background: "transparent", color: theme.muted, cursor: "pointer", padding: 0 }}>
                          <Icon name="close" size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                </>
              )}
              <OverlayLabel theme={theme} icon="globe">Jump to</OverlayLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {JUMPS.map((j) => (
                  <button
                    key={j.label}
                    onClick={() => jump(j.go)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 9,
                      background: theme.chrome, border: `1px solid ${theme.rule}`, borderRadius: 22,
                      padding: "9px 15px 9px 13px", cursor: "pointer", font: "inherit", fontSize: 13.5, fontWeight: 500, color: theme.ink,
                      transition: "background-color 120ms ease, transform 120ms ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = theme.hover; e.currentTarget.style.transform = "translateY(-1px)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = theme.chrome; e.currentTarget.style.transform = "none"; }}
                  >
                    <span style={{ color: theme.muted, display: "flex" }}><Icon name={j.icon} size={16} /></span>
                    {j.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function OverlayLabel({
  theme,
  icon,
  action,
  children,
}: {
  theme: Theme;
  icon: IconProps["name"];
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11, color: theme.muted }}>
      <Icon name={icon} size={13} />
      <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase" }}>{children}</span>
      {action && (
        <button onClick={action.onClick} style={{ marginLeft: "auto", border: 0, background: "transparent", color: theme.muted, cursor: "pointer", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase" }}>
          {action.label}
        </button>
      )}
    </div>
  );
}
