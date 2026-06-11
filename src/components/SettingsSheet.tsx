// Quick-access settings sheet for the mobile bottom nav.
//
// Today: the theme picker only. The reader already has a richer
// SettingsPanel (font, line height, content width, etc.) — pulling
// those into the library shell adds value but also a UI sprawl. We
// start with the most common change-while-browsing pain point
// (switching themes without having to open a book first).
//
// Layout is a centered modal on desktop; full-screen sheet with
// safe-area padding on mobile, mirroring DownloadQueueView's shape so
// the two side pages feel consistent.

import { Icon } from "./Icon";
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme, type ThemeKey } from "../styles/tokens";
import type { Tweaks } from "../types/reader";

interface Props {
  theme: Theme;
  themeKey: ThemeKey;
  setTweak: <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void;
  layout: "desktop" | "mobile";
  onClose: () => void;
}

const THEME_SWATCHES: ReadonlyArray<{
  key: ThemeKey;
  label: string;
  bg: string;
  ink: string;
}> = [
  { key: "light", label: "Light", bg: "#ffffff", ink: "#1f1a14" },
  { key: "sepia", label: "Sepia", bg: "#f4ecd8", ink: "#3a2f1f" },
  { key: "dark", label: "Dark", bg: "#1a1614", ink: "#d8cbb0" },
  { key: "oled", label: "OLED", bg: "#000000", ink: "#b8ad94" },
];

export function SettingsSheet({
  theme,
  themeKey,
  setTweak,
  layout,
  onClose,
}: Props) {
  const isMobile = layout === "mobile";

  return (
    // The scrim, centering, and enter/exit animation live in
    // AnimatedFullScreen at the call site. On mobile it slides up
    // full-bleed; on desktop it fade-pops a centered card.
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-sheet-heading"
      style={{
        width: isMobile ? "100%" : 480,
        maxHeight: isMobile ? "100%" : "84vh",
        height: isMobile ? "100%" : "auto",
        background: theme.bg,
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
        borderRadius: isMobile ? 0 : 14,
        boxShadow: "0 16px 40px rgba(0,0,0,0.32)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: FONT_STACKS.sans,
        ...(isMobile
          ? {
              paddingTop: "env(safe-area-inset-top, 0px)",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
              paddingLeft: "env(safe-area-inset-left, 0px)",
              paddingRight: "env(safe-area-inset-right, 0px)",
              boxSizing: "border-box",
            }
          : null),
      }}
    >
        <Header theme={theme} onClose={onClose} />
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "16px 18px 24px",
          }}
        >
          <SectionLabel theme={theme} label="Theme" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 10,
              marginTop: 8,
            }}
          >
            {THEME_SWATCHES.map((s) => {
              const selected = themeKey === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setTweak("theme", s.key)}
                  aria-pressed={selected}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    padding: "20px 12px 14px",
                    borderRadius: 12,
                    background: s.bg,
                    color: s.ink,
                    border: selected
                      ? `2px solid ${theme.ink}`
                      : `1px solid ${theme.rule}`,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "transform 80ms ease",
                  }}
                >
                  <span
                    style={{
                      fontFamily: FONT_SERIF_DISPLAY,
                      fontSize: 28,
                      fontStyle: "italic",
                      lineHeight: 1,
                    }}
                  >
                    Aa
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      letterSpacing: "0.04em",
                      opacity: 0.85,
                    }}
                  >
                    {s.label}
                  </span>
                </button>
              );
            })}
          </div>
          <p
            style={{
              marginTop: 18,
              fontSize: 11.5,
              color: theme.muted,
              lineHeight: 1.55,
            }}
          >
            More reading options (font, size, line height) live inside
            the reader's Settings panel.
          </p>
        </div>
    </div>
  );
}

function Header({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "16px 18px 14px",
        borderBottom: `0.5px solid ${theme.rule}`,
      }}
    >
      <button
        onClick={onClose}
        aria-label="Back"
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          border: `0.5px solid ${theme.rule}`,
          background: theme.bg,
          color: theme.ink,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name="arrowL" size={16} />
      </button>
      <h2
        id="settings-sheet-heading"
        style={{
          fontFamily: FONT_SERIF_DISPLAY,
          fontStyle: "italic",
          fontWeight: 400,
          fontSize: 22,
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        Settings
      </h2>
    </div>
  );
}

function SectionLabel({ theme, label }: { theme: Theme; label: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: theme.muted,
      }}
    >
      {label}
    </div>
  );
}
