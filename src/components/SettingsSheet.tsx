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
import { BrandMark } from "./BrandMark";
import { SystemThemeGlyph } from "./SystemThemeGlyph";
import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  type Theme,
  type ThemeKey,
  type ThemePref,
} from "../styles/tokens";
import type { Tweaks } from "../types/reader";
import { useI18n } from "../i18n/useI18n";
import type { MsgKey, UiLangPref } from "../i18n";

interface Props {
  theme: Theme;
  themeKey: ThemeKey;
  /** Raw preference (may be "system"). Falls back to themeKey if omitted. */
  themePref?: ThemePref;
  /** Raw UI-language preference (may be "system"), so the sheet can
   *  highlight "Auto" rather than the resolved concrete locale. */
  uiLang: UiLangPref;
  setTweak: <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void;
  layout: "desktop" | "mobile";
  onClose: () => void;
}

const THEME_SWATCHES: ReadonlyArray<{
  key: ThemeKey;
  bg: string;
  ink: string;
}> = [
  { key: "light", bg: "#ffffff", ink: "#1f1a14" },
  { key: "sepia", bg: "#f4ecd8", ink: "#3a2f1f" },
  { key: "dark", bg: "#1a1614", ink: "#d8cbb0" },
  { key: "oled", bg: "#000000", ink: "#b8ad94" },
];

function LangSegRow({
  theme,
  value,
  onChange,
  options,
}: {
  theme: Theme;
  value: UiLangPref;
  onChange: (next: UiLangPref) => void;
  options: { value: UiLangPref; label: string }[];
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        background: theme.chrome,
        borderRadius: 10,
        padding: 4,
      }}
    >
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={selected}
            style={{
              flex: 1,
              border: "none",
              background: selected ? theme.bg : "transparent",
              color: theme.ink,
              padding: "9px 4px",
              borderRadius: 8,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12.5,
              fontWeight: 500,
              boxShadow: selected ? `0 1px 2px ${theme.rule}` : "none",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsSheet({
  theme,
  themeKey,
  themePref,
  uiLang,
  setTweak,
  layout,
  onClose,
}: Props) {
  const { tr, locale } = useI18n();
  const isMobile = layout === "mobile";
  const pref = themePref ?? themeKey;
  // "Aa" reads fine in Latin UIs, but is meaningless (and Fraunces has no
  // Arabic glyphs to fall back on) when the UI is Arabic — swap to an
  // Arabic-capable font + glyph pair so the preview never shows tofu.
  const previewGlyph = locale === "ar" ? "أب" : "Aa";
  const previewFontFamily = locale === "ar" ? FONT_STACKS.sans : FONT_SERIF_DISPLAY;

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
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <BrandMark themeKey={themeKey} size={76} />
          </div>
          <SectionLabel theme={theme} label={tr("settings.language")} />
          <div style={{ marginTop: 8, marginBottom: 20 }}>
            <LangSegRow
              theme={theme}
              value={uiLang}
              onChange={(v) => setTweak("uiLang", v)}
              options={[
                { value: "system", label: tr("settings.language.auto") },
                { value: "en", label: "English" },
                { value: "ar", label: "العربية" },
              ]}
            />
          </div>
          <SectionLabel theme={theme} label={tr("settings.theme")} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 10,
              marginTop: 8,
            }}
          >
            {THEME_SWATCHES.map((s) => {
              const selected = pref === s.key;
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
                      fontFamily: previewFontFamily,
                      fontSize: 28,
                      fontStyle: locale === "ar" ? "normal" : "italic",
                      lineHeight: 1,
                    }}
                  >
                    {previewGlyph}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      letterSpacing: "0.04em",
                      opacity: 0.85,
                    }}
                  >
                    {tr(`settings.theme.${s.key}` as MsgKey)}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setTweak("theme", "system")}
            aria-pressed={pref === "system"}
            style={{
              marginTop: 10,
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "12px 14px",
              borderRadius: 12,
              background: theme.chrome,
              color: theme.ink,
              border:
                pref === "system"
                  ? `2px solid ${theme.ink}`
                  : `1px solid ${theme.rule}`,
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "start",
            }}
          >
            <SystemThemeGlyph size={26} />
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {tr("settings.theme.system")}
              </span>
              <span style={{ fontSize: 11, color: theme.muted }}>
                {tr("settings.theme.systemHintDevice")}
              </span>
            </span>
          </button>
          <p
            style={{
              marginTop: 18,
              fontSize: 11.5,
              color: theme.muted,
              lineHeight: 1.55,
            }}
          >
            {tr("settings.moreOptionsHint")}
          </p>
        </div>
    </div>
  );
}

function Header({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { tr, locale } = useI18n();
  // Fraunces (the display serif) has no Arabic glyphs, so an Arabic heading
  // forces the browser to synthesize a fake-oblique slant on a fallback
  // font — the same tofu-adjacent problem the preview glyph had. Match the
  // fix there: swap to the Arabic-capable sans, upright, for `ar`.
  const headingFontFamily = locale === "ar" ? FONT_STACKS.sans : FONT_SERIF_DISPLAY;
  const headingFontStyle = locale === "ar" ? "normal" : "italic";
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
        aria-label={tr("common.back")}
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
        <Icon name="arrowL" size={16} className="rtl-flip-x" />
      </button>
      <h2
        id="settings-sheet-heading"
        style={{
          fontFamily: headingFontFamily,
          fontStyle: headingFontStyle,
          fontWeight: 400,
          fontSize: 22,
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        {tr("sidebar.settings")}
      </h2>
    </div>
  );
}

function SectionLabel({ theme, label }: { theme: Theme; label: string }) {
  // Tracking + uppercasing are a Latin-typography convention: extra
  // letter-spacing breaks Arabic glyph joining/ligatures, and uppercase is a
  // no-op on Arabic anyway. Skip both when the UI is Arabic.
  const { locale } = useI18n();
  const isAr = locale === "ar";
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: isAr ? "none" : "uppercase",
        letterSpacing: isAr ? "normal" : "0.08em",
        color: theme.muted,
      }}
    >
      {label}
    </div>
  );
}
