// Shared settings primitives + composite controls.
//
// Extracted so the reader's quick-panel (panels/SettingsPanel.tsx) and the
// full Settings page (components/SettingsPage.tsx) render the SAME controls
// from one source — they can't drift, and both edit the same `Tweaks` state.
//
// Arabic-typography guards (no uppercase / no letter-tracking on `ar`, and the
// tofu-free preview glyph + font swap) live here once instead of in three
// copies.

import { Fragment, type ReactNode } from "react";
import { Icon, type IconProps } from "./Icon";
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
import type { MsgKey, Tr, UiLangPref } from "../i18n";

type SetTweak = <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;

// ── settings catalog model (categories + searchable entries) ─────────────────

export type CategoryKey =
  | "appearance"
  | "reading"
  | "behavior"
  | "downloads"
  | "data"
  | "about";

export const CATEGORY_ORDER: readonly CategoryKey[] = [
  "appearance",
  "reading",
  "behavior",
  "downloads",
  "data",
  "about",
];

export const CATEGORY_META: Record<
  CategoryKey,
  { icon: IconProps["name"]; labelKey: MsgKey }
> = {
  appearance: { icon: "sun", labelKey: "settings.section.appearance" },
  reading: { icon: "type", labelKey: "settings.section.reading" },
  behavior: { icon: "settings", labelKey: "settings.section.behavior" },
  downloads: { icon: "download", labelKey: "settings.section.downloads" },
  data: { icon: "doc", labelKey: "settings.section.data" },
  about: { icon: "info", labelKey: "settings.section.about" },
};

/** One searchable setting: a translated `label` (matched by the settings
 *  search + not necessarily rendered) plus the control `node`. */
export interface SettingEntry {
  id: string;
  label: string;
  node: ReactNode;
}

/** Render a list of entries (used by category pages and search results). */
export function renderEntries(entries: SettingEntry[]): ReactNode {
  return entries.map((e) => <Fragment key={e.id}>{e.node}</Fragment>);
}

// ── data tables ─────────────────────────────────────────────────────────────

export const THEME_SWATCHES: ReadonlyArray<{
  key: ThemeKey;
  bg: string;
  ink: string;
}> = [
  { key: "light", bg: "#ffffff", ink: "#1f1a14" },
  { key: "sepia", bg: "#f4ecd8", ink: "#3a2f1f" },
  { key: "dark", bg: "#1a1614", ink: "#d8cbb0" },
  { key: "oled", bg: "#000000", ink: "#b8ad94" },
];

// ── shared Arabic-aware preview tokens ──────────────────────────────────────

/** "Aa" reads fine in Latin UIs but is meaningless (and Fraunces has no Arabic
 *  glyphs to fall back on) when the UI is Arabic — swap to an Arabic-capable
 *  font + glyph pair so the theme preview never shows tofu. */
export function useThemePreviewGlyph() {
  const { locale } = useI18n();
  const isAr = locale === "ar";
  return {
    isAr,
    previewGlyph: isAr ? "أب" : "Aa",
    previewFontFamily: FONT_STACKS.sans,
    previewFontStyle: "normal" as const,
  };
}

// ── primitives ──────────────────────────────────────────────────────────────

/** One labelled control row. Tracking + uppercasing are a Latin convention:
 *  extra letter-spacing breaks Arabic glyph joining and uppercase is a no-op
 *  on Arabic — skip both when the UI is Arabic. */
export function Field({
  label,
  theme,
  children,
}: {
  label: string;
  theme: Theme;
  children: ReactNode;
}) {
  const { locale } = useI18n();
  const isAr = locale === "ar";
  return (
    <div style={{ padding: "12px 18px", borderBottom: `0.5px solid ${theme.rule}` }}>
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

/** Section heading for the full Settings page (larger than a Field label). */
export function SectionHeader({
  theme,
  label,
  icon,
}: {
  theme: Theme;
  label: string;
  icon?: ReactNode;
}) {
  const { locale } = useI18n();
  const isAr = locale === "ar";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 18px 8px",
        color: theme.muted,
      }}
    >
      {icon}
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: isAr ? "normal" : "0.09em",
          textTransform: isAr ? "none" : "uppercase",
        }}
      >
        {label}
      </span>
    </div>
  );
}

interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name — required when `label` is a glyph/icon with no text. */
  ariaLabel?: string;
}

/** Generic segmented control. */
export function SegRow<T extends string>({
  theme,
  value,
  onChange,
  options,
}: {
  theme: Theme;
  value: T;
  onChange: (next: T) => void;
  options: SegOption<T>[];
}) {
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
            aria-pressed={selected}
            aria-label={o.ariaLabel}
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

/** A full-width range slider, styled to match the reader panel. */
function Slider({
  theme,
  min,
  max,
  step,
  value,
  onChange,
  ariaLabel,
}: {
  theme: Theme;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (n: number) => void;
  ariaLabel?: string;
}) {
  return (
    <input
      type="range"
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(+e.target.value)}
      style={{ width: "100%", color: theme.ink }}
    />
  );
}

/** A labelled slider row — the Field's label doubles as the slider's
 *  accessible name (range inputs otherwise announce only their value). */
function SliderField({
  theme,
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  theme: Theme;
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <Field label={label} theme={theme}>
      <Slider
        theme={theme}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
        ariaLabel={label}
      />
    </Field>
  );
}

// ── composite controls (shared by the reader panel and the page) ────────────

export function LanguageField({
  theme,
  value,
  onChange,
}: {
  theme: Theme;
  value: UiLangPref;
  onChange: (v: UiLangPref) => void;
}) {
  const { tr } = useI18n();
  return (
    <Field label={tr("settings.language")} theme={theme}>
      <SegRow<UiLangPref>
        theme={theme}
        value={value}
        onChange={onChange}
        options={[
          { value: "system", label: tr("settings.language.auto") },
          { value: "en", label: "English" },
          { value: "ar", label: "العربية" },
        ]}
      />
    </Field>
  );
}

export function ThemeField({
  theme,
  pref,
  onChange,
  columns = 4,
}: {
  theme: Theme;
  pref: ThemePref;
  onChange: (p: ThemePref) => void;
  columns?: number;
}) {
  const { tr } = useI18n();
  const { previewGlyph, previewFontFamily, previewFontStyle } =
    useThemePreviewGlyph();
  return (
    <Field label={tr("settings.theme")} theme={theme}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: 6,
        }}
      >
        {THEME_SWATCHES.map((s) => (
          <button
            key={s.key}
            onClick={() => onChange(s.key)}
            aria-pressed={pref === s.key}
            style={{
              border:
                pref === s.key
                  ? `1.5px solid ${theme.ink}`
                  : `1px solid ${theme.rule}`,
              background: s.bg,
              color: s.ink,
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
                fontStyle: previewFontStyle,
              }}
            >
              {previewGlyph}
            </span>
            <span
              style={{
                fontFamily: FONT_STACKS.sans,
                fontSize: 9.5,
                color: s.ink,
                opacity: 0.7,
              }}
            >
              {tr(`settings.theme.${s.key}` as MsgKey)}
            </span>
          </button>
        ))}
      </div>
      <button
        onClick={() => onChange("system")}
        aria-pressed={pref === "system"}
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
            pref === "system"
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
  );
}

/** The reading typography/layout controls as individually-searchable entries,
 *  shared by the reader quick-panel and the Settings page's Reading section.
 *  `mobile` surfaces the tap-to-turn controls; `showPageTurn` surfaces the
 *  page-flip toggle (desktop paginated only — mobile is scroll-only). */
export function readingItems(ctx: {
  theme: Theme;
  t: Tweaks;
  setTweak: SetTweak;
  tr: Tr;
  mobile: boolean;
  showPageTurn: boolean;
}): SettingEntry[] {
  const { theme, t, setTweak, tr, mobile, showPageTurn } = ctx;
  const onOff = (
    id: string,
    label: string,
    value: boolean,
    onChange: (on: boolean) => void,
    hint?: string,
  ): SettingEntry => ({
    id,
    label,
    node: (
      <Field label={label} theme={theme}>
        <SegRow<"on" | "off">
          theme={theme}
          value={value ? "on" : "off"}
          onChange={(v) => onChange(v === "on")}
          options={[
            { value: "on", label: <span style={{ fontSize: 11 }}>{tr("settings.on")}</span> },
            { value: "off", label: <span style={{ fontSize: 11 }}>{tr("settings.off")}</span> },
          ]}
        />
        {hint && (
          <p style={{ margin: "8px 2px 0", fontSize: 10.5, color: theme.muted, lineHeight: 1.5 }}>
            {hint}
          </p>
        )}
      </Field>
    ),
  });

  const slider = (
    id: string,
    label: string,
    min: number,
    max: number,
    step: number | undefined,
    value: number,
    onChange: (n: number) => void,
  ): SettingEntry => ({
    id,
    label,
    node: (
      <SliderField
        theme={theme}
        label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={onChange}
      />
    ),
  });

  const items: SettingEntry[] = [
    {
      id: "fontSize",
      label: tr("settings.fontSize", { n: t.fontSize }),
      node: (
        <Field label={tr("settings.fontSize", { n: t.fontSize })} theme={theme}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: theme.ink }}>
            <span style={{ fontFamily: FONT_SERIF_DISPLAY, fontSize: 12, color: theme.muted }}>A</span>
            <Slider
              theme={theme}
              min={14}
              max={42}
              value={t.fontSize}
              onChange={(n) => setTweak("fontSize", n)}
              ariaLabel={tr("settings.fontSize", { n: t.fontSize })}
            />
            <span style={{ fontFamily: FONT_SERIF_DISPLAY, fontSize: 22, color: theme.ink }}>A</span>
          </div>
        </Field>
      ),
    },
    slider("lineHeight", tr("settings.lineHeight", { n: t.lineHeight.toFixed(2) }), 1.3, 2.0, 0.05, t.lineHeight, (n) => setTweak("lineHeight", n)),
    slider("letterSpacing", tr("settings.letterSpacing", { n: t.letterSpacing.toFixed(2) }), -0.02, 0.08, 0.005, t.letterSpacing, (n) => setTweak("letterSpacing", n)),
    slider("paragraphSpacing", tr("settings.paragraphSpacing", { n: t.paragraphSpacing.toFixed(1) }), 0.4, 2.4, 0.1, t.paragraphSpacing, (n) => setTweak("paragraphSpacing", n)),
    slider("contentWidth", tr("settings.contentWidth", { n: t.contentWidth }), 50, 100, 1, t.contentWidth, (n) => setTweak("contentWidth", n)),
    {
      id: "alignment",
      label: tr("settings.alignment"),
      node: (
        <Field label={tr("settings.alignment")} theme={theme}>
          <SegRow<Tweaks["textAlign"]>
            theme={theme}
            value={t.textAlign}
            onChange={(v) => setTweak("textAlign", v)}
            options={[
              { value: "auto", label: <span style={{ fontSize: 11 }}>{tr("settings.align.auto")}</span> },
              { value: "left", ariaLabel: tr("settings.align.left"), label: <Icon name="alignLeft" size={16} style={{ display: "block", margin: "0 auto" }} /> },
              { value: "justify", ariaLabel: tr("settings.align.justify"), label: <Icon name="alignJustify" size={16} style={{ display: "block", margin: "0 auto" }} /> },
              { value: "right", ariaLabel: tr("settings.align.right"), label: <Icon name="alignRight" size={16} style={{ display: "block", margin: "0 auto" }} /> },
            ]}
          />
        </Field>
      ),
    },
    {
      id: "readingMode",
      label: tr("settings.readingMode"),
      node: (
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
      ),
    },
    onOff("hyphenation", tr("settings.hyphenation"), t.hyphenation, (on) => setTweak("hyphenation", on)),
  ];

  if (showPageTurn) {
    items.push(onOff("pageTurnAnimation", tr("settings.pageTurnAnimation"), t.pageTurnAnimation, (on) => setTweak("pageTurnAnimation", on)));
  }
  items.push(onOff("keepScreenAwake", tr("settings.keepScreenAwake"), t.keepScreenAwake, (on) => setTweak("keepScreenAwake", on), tr("settings.keepScreenAwake.hint")));

  if (mobile) {
    items.push(onOff("tapToTurn", tr("settings.tapToTurn"), t.mobileTapNav, (on) => setTweak("mobileTapNav", on)));
    if (t.mobileTapNav) {
      items.push(slider("tapZoneWidth", tr("settings.tapZoneWidth", { n: t.mobileTapZoneWidth }), 10, 45, 1, t.mobileTapZoneWidth, (n) => setTweak("mobileTapZoneWidth", n)));
      items.push(slider("tapStride", tr("settings.tapStride", { n: t.mobileTapStride }), 30, 100, 5, t.mobileTapStride, (n) => setTweak("mobileTapStride", n)));
    }
  }
  return items;
}

/** Reader quick-panel reading controls — renders the shared `readingItems`. */
export function ReadingControls({
  theme,
  t,
  setTweak,
  mobile = false,
  showPageTurn = true,
}: {
  theme: Theme;
  t: Tweaks;
  setTweak: SetTweak;
  mobile?: boolean;
  showPageTurn?: boolean;
}) {
  const { tr } = useI18n();
  return <>{renderEntries(readingItems({ theme, t, setTweak, tr, mobile, showPageTurn }))}</>;
}

/** A tappable full-width row (used for "All settings" in the reader panel and
 *  the Data/About actions on the page). */
export function ActionRow({
  theme,
  icon,
  label,
  hint,
  onClick,
  trailing,
  danger = false,
}: {
  theme: Theme;
  icon?: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  trailing?: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 18px",
        background: "transparent",
        color: danger ? "#c04a3a" : theme.ink,
        border: "none",
        borderBottom: `0.5px solid ${theme.rule}`,
        cursor: "pointer",
        fontFamily: FONT_STACKS.sans,
        textAlign: "start",
      }}
    >
      {icon && (
        <span style={{ display: "flex", color: danger ? "#c04a3a" : theme.chromeInk }}>
          {icon}
        </span>
      )}
      <span style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: theme.muted }}>{hint}</span>}
      </span>
      {trailing}
    </button>
  );
}
