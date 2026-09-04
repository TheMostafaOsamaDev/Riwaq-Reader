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
import { listSources } from "../sources/registry";
import { SourceIcon } from "./SourceIcon";
import { useI18n } from "../i18n/useI18n";
import type { MsgKey } from "../i18n";

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
  /** Open a source's page in the Store (from the Websites results). */
  onOpenStoreSource: (sourceId: string) => void;
  onClose: () => void;
}

const JUMPS: { key: MsgKey; icon: IconProps["name"]; go: "all" | "reading" | "finished" | "wishlist" | "store" | "downloads" | "settings" }[] = [
  { key: "sidebar.library", icon: "grid", go: "all" },
  { key: "sidebar.reading", icon: "book", go: "reading" },
  { key: "sidebar.finished", icon: "check", go: "finished" },
  { key: "sidebar.wishlist", icon: "bookmark", go: "wishlist" },
  { key: "sidebar.store", icon: "globe", go: "store" },
  { key: "sidebar.downloads", icon: "download", go: "downloads" },
  { key: "sidebar.settings", icon: "settings", go: "settings" },
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
  onOpenStoreSource,
  onClose,
}: Props) {
  const { tr } = useI18n();
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

  // Source websites matching the term — selecting one jumps into the Store
  // at that site. Registry lookup is synchronous, so no loading state.
  const sourceResults = useMemo(
    () =>
      q
        ? listSources()
            .filter(
              (s) =>
                s.name.toLowerCase().includes(q) ||
                s.baseUrl.toLowerCase().includes(q),
            )
            .slice(0, 5)
        : [],
    [q],
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
          // The whole palette — input AND body — is one opaque `paper` card.
          // The body used to be transparent, which painted `ink`/`muted` text
          // straight onto the blurred library behind the scrim; contrast then
          // depended on whichever cover happened to sit under the text
          // (measured 1.0:1–10.3:1). On `paper` every token is back on the
          // surface it was toned against, in all four themes.
          background: theme.paper,
          border: `1px solid ${theme.rule}`,
          borderRadius: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          // Long result lists used to run off the bottom of the screen with no
          // way to reach them; the card is now bounded and the body scrolls.
          maxHeight: "76vh",
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 18px",
            borderBottom: `1px solid ${theme.rule}`,
            flexShrink: 0,
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
            placeholder={tr("search.placeholder")}
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
        <div style={{ padding: "16px 18px 18px", overflowY: "auto", flex: 1, minHeight: 0 }}>
          {q ? (
            results.length || sourceResults.length ? (
              <>
                {results.length > 0 && (
                  <>
                    <OverlayLabel theme={theme} icon="search">{tr("search.results")}</OverlayLabel>
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
                        textAlign: "start",
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
                        <span style={{ display: "block", fontSize: 14, color: theme.ink, fontWeight: 500 }}>{b.title || tr("common.untitled")}</span>
                        <span style={{ display: "block", fontSize: 12, color: theme.muted, marginTop: 2 }}>{b.author || tr("common.unknownAuthor")}</span>
                      </span>
                    </button>
                  ))}
                    </div>
                  </>
                )}
                {sourceResults.length > 0 && (
                  <div style={{ marginTop: results.length ? 22 : 0 }}>
                    <OverlayLabel theme={theme} icon="globe">{tr("search.websites")}</OverlayLabel>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {sourceResults.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => { remember(term); onOpenStoreSource(s.id); onClose(); }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 13,
                            padding: "8px 10px",
                            border: 0,
                            borderRadius: 10,
                            background: "transparent",
                            cursor: "pointer",
                            textAlign: "start",
                            font: "inherit",
                            transition: "background-color 120ms ease",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = theme.hover)}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <SourceIcon theme={theme} iconUrl={s.iconUrl} size={30} radius={7} glyphSize={16} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 14, color: theme.ink, fontWeight: 500 }}>{s.name}</span>
                            <span style={{ display: "block", fontSize: 12, color: theme.muted, marginTop: 2 }}>{s.baseUrl.replace(/^https?:\/\//, "")}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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
                <Icon name="search" size={16} /> {tr("search.noMatches", { term: term.trim() })}
              </button>
            )
          ) : (
            <>
              {recent.length > 0 && (
                <>
                  <OverlayLabel theme={theme} icon="clock" action={{ label: tr("search.clearHistory"), onClick: () => { setRecent([]); saveRecent([]); } }}>
                    {tr("search.recentSearches")}
                  </OverlayLabel>
                  {/* Chips are bordered like the Jump-to pills: `chrome` alone
                      is only a few shades off `paper` (sepia especially), so
                      each chip needs the hairline to read as a control. */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                    {recent.map((r) => (
                      <span key={r} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: theme.chrome, border: `1px solid ${theme.rule}`, borderRadius: 20, padding: "6px 7px 6px 12px", fontSize: 13, color: theme.ink }}>
                        <button onClick={() => { setTerm(r); inputRef.current?.focus(); }} style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", font: "inherit", padding: 0 }}>{r}</button>
                        <button aria-label={tr("search.removeRecent", { term: r })} onClick={() => { const n = recent.filter((x) => x !== r); setRecent(n); saveRecent(n); }} style={{ display: "flex", border: 0, background: "transparent", color: theme.muted, cursor: "pointer", padding: 0 }}>
                          <Icon name="close" size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                </>
              )}
              <OverlayLabel theme={theme} icon="globe">{tr("search.jumpTo")}</OverlayLabel>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {JUMPS.map((j) => (
                  <button
                    key={j.key}
                    onClick={() => jump(j.go)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 9,
                      background: theme.chrome, border: `1px solid ${theme.rule}`, borderRadius: 22,
                      padding: "9px 15px 9px 13px", cursor: "pointer", font: "inherit", fontSize: 13.5, fontWeight: 500, color: theme.ink,
                      transition: "background-color 120ms ease, transform 120ms ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = theme.chromeHover; e.currentTarget.style.transform = "translateY(-1px)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = theme.chrome; e.currentTarget.style.transform = "none"; }}
                  >
                    <span style={{ color: theme.muted, display: "flex" }}><Icon name={j.icon} size={16} /></span>
                    {tr(j.key)}
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
        <button onClick={action.onClick} style={{ marginInlineStart: "auto", border: 0, background: "transparent", color: theme.muted, cursor: "pointer", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase" }}>
          {action.label}
        </button>
      )}
    </div>
  );
}
