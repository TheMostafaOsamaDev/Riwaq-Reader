import type { ReactNode } from "react";
import { Icon } from "../components/Icon";
import { SystemThemeGlyph } from "../components/SystemThemeGlyph";
import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  type FontFamilyKey,
  type Theme,
  type ThemeKey,
} from "../styles/tokens";
import type { Tweaks } from "../types/reader";
import { PanelShell } from "./PanelShell";
import { useI18n } from "../i18n/useI18n";
import type { MsgKey, UiLangPref } from "../i18n";

interface Props {
  theme: Theme;
  themeKey: ThemeKey;
  t: Tweaks;
  setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
  onClose?: () => void;
  width?: number | string;
  side?: "left" | "right";
  /** Surface mobile-only fields (e.g. tap-to-turn-pages). The desktop
      reader doesn't show these because they have no effect there. */
  mobile?: boolean;
}

const THEME_SWATCHES: ReadonlyArray<[ThemeKey, string, string]> = [
  ["light", "#ffffff", "#1f1a14"],
  ["sepia", "#f4ecd8", "#3a2f1f"],
  ["dark", "#1a1614", "#d8cbb0"],
  ["oled", "#000000", "#b8ad94"],
];

interface FontOpt {
  value: FontFamilyKey;
  label: string;
  name: string;
  font: string;
}

const FONT_ROW_LATIN: ReadonlyArray<FontOpt> = [
  { value: "serif", label: "Aa", name: "Serif", font: FONT_STACKS.serif },
  { value: "sans", label: "Aa", name: "Sans", font: FONT_STACKS.sans },
  {
    value: "dyslexic",
    label: "Aa",
    name: "Dyslexic",
    font: FONT_STACKS.dyslexic,
  },
];

const FONT_ROW_ARABIC: ReadonlyArray<FontOpt> = [
  { value: "cairo", label: "أب", name: "Cairo", font: FONT_STACKS.cairo },
  { value: "lateef", label: "أب", name: "Lateef", font: FONT_STACKS.lateef },
  { value: "tajawal", label: "أب", name: "Tajawal", font: FONT_STACKS.tajawal },
];

function Field({
  label,
  theme,
  children,
}: {
  label: string;
  theme: Theme;
  children: ReactNode;
}) {
  // Tracking + uppercasing are a Latin-typography convention: extra
  // letter-spacing breaks Arabic glyph joining/ligatures, and uppercase is a
  // no-op on Arabic anyway. Skip both when the UI is Arabic.
  const { locale } = useI18n();
  const isAr = locale === "ar";
  return (
    <div
      style={{
        padding: "12px 18px",
        borderBottom: `0.5px solid ${theme.rule}`,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          color: theme.muted,
          letterSpacing: isAr ? "normal" : "0.08em",
          textTransform: isAr ? "none" : "uppercase",
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

interface SegRowProps<T extends string> {
  theme: Theme;
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: ReactNode }[];
}

function SegRow<T extends string>({
  theme,
  value,
  onChange,
  options,
}: SegRowProps<T>) {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        background: theme.hover,
        borderRadius: 8,
        padding: 3,
      }}
    >
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              flex: 1,
              border: "none",
              background: selected ? theme.paper : "transparent",
              color: theme.ink,
              padding: "8px 4px",
              borderRadius: 6,
              cursor: "pointer",
              fontFamily: FONT_STACKS.sans,
              fontSize: 12,
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

export function SettingsPanel({
  theme,
  t,
  setTweak,
  onClose,
  width,
  side = "right",
  mobile,
}: Props) {
  const { tr, locale } = useI18n();
  // "Aa" reads fine in Latin UIs, but is meaningless (and Fraunces has no
  // Arabic glyphs to fall back on) when the UI is Arabic — swap to an
  // Arabic-capable font + glyph pair so the preview never shows tofu.
  const previewGlyph = locale === "ar" ? "أب" : "Aa";
  const previewFontFamily = locale === "ar" ? FONT_STACKS.sans : FONT_SERIF_DISPLAY;
  return (
    <PanelShell
      theme={theme}
      title={tr("settings.title")}
      subtitle={tr("settings.subtitle")}
      onClose={onClose}
      icon={<Icon name="type" size={14} />}
      width={width}
      side={side}
    >
      <Field label={tr("settings.language")} theme={theme}>
        <SegRow<UiLangPref>
          theme={theme}
          value={t.uiLang}
          onChange={(v) => setTweak("uiLang", v)}
          options={[
            { value: "system", label: tr("settings.language.auto") },
            { value: "en", label: "English" },
            { value: "ar", label: "العربية" },
          ]}
        />
      </Field>

      <Field label={tr("settings.theme")} theme={theme}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 6,
          }}
        >
          {THEME_SWATCHES.map(([k, bg, ink]) => (
            <button
              key={k}
              onClick={() => setTweak("theme", k)}
              style={{
                border:
                  t.theme === k
                    ? `1.5px solid ${theme.ink}`
                    : `1px solid ${theme.rule}`,
                background: bg,
                color: ink,
                borderRadius: 8,
                padding: "14px 0 8px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontFamily: previewFontFamily,
                  fontSize: 18,
                  fontStyle: locale === "ar" ? "normal" : "italic",
                }}
              >
                {previewGlyph}
              </span>
              <span
                style={{
                  fontFamily: FONT_STACKS.sans,
                  fontSize: 9.5,
                  color: ink,
                  opacity: 0.7,
                }}
              >
                {tr(`settings.theme.${k}` as MsgKey)}
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setTweak("theme", "system")}
          aria-pressed={t.theme === "system"}
          style={{
            marginTop: 6,
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 8,
            background: theme.hover,
            color: theme.ink,
            border:
              t.theme === "system"
                ? `1.5px solid ${theme.ink}`
                : `1px solid ${theme.rule}`,
            cursor: "pointer",
            fontFamily: FONT_STACKS.sans,
            textAlign: "start",
          }}
        >
          <SystemThemeGlyph size={22} />
          <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              {tr("settings.theme.system")}
            </span>
            <span style={{ fontSize: 10, color: theme.muted }}>
              {tr("settings.theme.systemHint")}
            </span>
          </span>
        </button>
      </Field>

      <Field label={tr("settings.font")} theme={theme}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[FONT_ROW_LATIN, FONT_ROW_ARABIC].map((row, i) => (
            <SegRow<FontFamilyKey>
              key={i}
              theme={theme}
              value={t.fontFamily}
              onChange={(v) => setTweak("fontFamily", v)}
              options={row.map((o) => ({
                value: o.value,
                label: (
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <span style={{ fontFamily: o.font, fontSize: 16 }}>
                      {o.label}
                    </span>
                    <span
                      style={{
                        fontSize: 9.5,
                        color: theme.muted,
                        fontWeight: 500,
                      }}
                    >
                      {o.name}
                    </span>
                  </span>
                ),
              }))}
            />
          ))}
        </div>
      </Field>

      <Field
        label={tr("settings.fontSize", { n: t.fontSize })}
        theme={theme}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: theme.ink }}>
          <span
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontSize: 12,
              color: theme.muted,
            }}
          >
            A
          </span>
          <input
            type="range"
            min={14}
            max={42}
            value={t.fontSize}
            onChange={(e) => setTweak("fontSize", +e.target.value)}
            style={{ flex: 1, color: theme.ink }}
          />
          <span
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontSize: 22,
              color: theme.ink,
            }}
          >
            A
          </span>
        </div>
      </Field>

      <Field
        label={tr("settings.lineHeight", { n: t.lineHeight.toFixed(2) })}
        theme={theme}
      >
        <input
          type="range"
          min={1.3}
          max={2.0}
          step={0.05}
          value={t.lineHeight}
          onChange={(e) => setTweak("lineHeight", +e.target.value)}
          style={{ width: "100%", color: theme.ink }}
        />
      </Field>

      <Field
        label={tr("settings.letterSpacing", {
          n: t.letterSpacing.toFixed(2),
        })}
        theme={theme}
      >
        <input
          type="range"
          min={-0.02}
          max={0.08}
          step={0.005}
          value={t.letterSpacing}
          onChange={(e) => setTweak("letterSpacing", +e.target.value)}
          style={{ width: "100%", color: theme.ink }}
        />
      </Field>

      <Field
        label={tr("settings.contentWidth", { n: t.contentWidth })}
        theme={theme}
      >
        <input
          type="range"
          min={50}
          max={100}
          step={1}
          value={t.contentWidth}
          onChange={(e) => setTweak("contentWidth", +e.target.value)}
          style={{ width: "100%", color: theme.ink }}
        />
      </Field>

      <Field label={tr("settings.alignment")} theme={theme}>
        <SegRow<Tweaks["textAlign"]>
          theme={theme}
          value={t.textAlign}
          onChange={(v) => setTweak("textAlign", v)}
          options={[
            {
              value: "auto",
              label: <span style={{ fontSize: 11 }}>{tr("settings.align.auto")}</span>,
            },
            { value: "left", label: <span style={{ fontSize: 14 }}>⯇</span> },
            {
              value: "justify",
              label: <span style={{ fontSize: 14 }}>☰</span>,
            },
            {
              value: "right",
              label: <span style={{ fontSize: 14 }}>⯈</span>,
            },
          ]}
        />
      </Field>

      <Field label={tr("settings.readingMode")} theme={theme}>
        <SegRow<Tweaks["readingMode"]>
          theme={theme}
          value={t.readingMode}
          onChange={(v) => setTweak("readingMode", v)}
          options={[
            { value: "paginated-2", label: tr("settings.mode.paginated2") },
            { value: "paginated-1", label: tr("settings.mode.paginated1") },
            { value: "scroll", label: tr("settings.mode.scroll") },
          ]}
        />
      </Field>

      {mobile && (
        <Field label={tr("settings.tapToTurn")} theme={theme}>
          <SegRow<"on" | "off">
            theme={theme}
            value={t.mobileTapNav ? "on" : "off"}
            onChange={(v) => setTweak("mobileTapNav", v === "on")}
            options={[
              { value: "on", label: <span style={{ fontSize: 11 }}>{tr("settings.on")}</span> },
              { value: "off", label: <span style={{ fontSize: 11 }}>{tr("settings.off")}</span> },
            ]}
          />
        </Field>
      )}

      {mobile && t.mobileTapNav && (
        <Field
          label={tr("settings.tapZoneWidth", { n: t.mobileTapZoneWidth })}
          theme={theme}
        >
          <input
            type="range"
            min={10}
            max={45}
            step={1}
            value={t.mobileTapZoneWidth}
            onChange={(e) => setTweak("mobileTapZoneWidth", +e.target.value)}
            style={{ width: "100%", color: theme.ink }}
          />
        </Field>
      )}

      {mobile && t.mobileTapNav && (
        <Field
          label={tr("settings.tapStride", { n: t.mobileTapStride })}
          theme={theme}
        >
          <input
            type="range"
            min={30}
            max={100}
            step={5}
            value={t.mobileTapStride}
            onChange={(e) => setTweak("mobileTapStride", +e.target.value)}
            style={{ width: "100%", color: theme.ink }}
          />
        </Field>
      )}

    </PanelShell>
  );
}
