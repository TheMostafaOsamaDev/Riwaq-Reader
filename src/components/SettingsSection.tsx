// Shared settings primitives + composite controls.
//
// Extracted so the reader's quick-panel (panels/SettingsPanel.tsx) and the
// full Settings page (components/SettingsPage.tsx) render the SAME controls
// from one source — they can't drift, and both edit the same `Tweaks` state.
//
// Arabic-typography guards (no uppercase / no letter-tracking on `ar`, and the
// tofu-free preview glyph + font swap) live here once instead of in three
// copies.

import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconProps } from "./Icon";
import { SystemThemeGlyph } from "./SystemThemeGlyph";
import {
  ACCENT,
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  type Theme,
  type ThemeKey,
  type ThemePref,
} from "../styles/tokens";
import type { Tweaks } from "../types/reader";
import { useI18n } from "../i18n/useI18n";
import { formatNum } from "../i18n";
import type { Locale, MsgKey, Tr, UiLangPref } from "../i18n";
import {
  isColorSet,
  isLowContrast,
  resolveReadingColors,
} from "../reader/readingColors";

type SetTweak = <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;

/** Fixed-layout viewer zoom bounds, shared by the panel stepper and any
 *  caller that clamps zoom itself. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.5;
export const ZOOM_STEP = 0.1;

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

// ── reading color controls (Text color / Page color) ───────────────────────

/** Curated ink presets — near-black, grey, sepia-brown, warm off-white (for
 *  dark pages). "Auto" (theme) + a freeform picker flank them in the row. */
const INK_PRESETS = ["#1b1b1b", "#5b5b5b", "#3a2f1f", "#d8cbb0"] as const;
/** Curated paper presets — white, sepia, soft sage-grey, near-black. */
const PAPER_PRESETS = ["#ffffff", "#f4ecd8", "#eae7dd", "#1a1614"] as const;

const SWATCH = 30;

/** Pick a legible glyph/icon color for a filled swatch: dark on light fills,
 *  light on dark. `isLowContrast(fill, white)` is true when the fill is light. */
function onColorFor(fill: string): string {
  return isLowContrast(fill, "#ffffff") ? "#111111" : "#ffffff";
}

function swatchBase(theme: Theme, selected: boolean): CSSProperties {
  return {
    width: SWATCH,
    height: SWATCH,
    flex: "0 0 auto",
    padding: 0,
    borderRadius: 999,
    border: `1px solid ${theme.rule}`,
    cursor: "pointer",
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    // Selected halo: a paper-colored gap ring, then an ink-colored ring.
    boxShadow: selected ? `0 0 0 2px ${theme.paper}, 0 0 0 3.5px ${theme.ink}` : "none",
  };
}

/** One "Text" or "Page" color row: an Auto chip, preset swatches, and a
 *  freeform picker. `value` is "auto" or a hex; `autoResolved` is the theme
 *  color Auto falls back to (shown as the Auto chip's fill). */
function ColorSwatchRow({
  theme,
  caption,
  value,
  presets,
  autoResolved,
  onChange,
}: {
  theme: Theme;
  caption: string;
  value: string;
  presets: readonly string[];
  autoResolved: string;
  onChange: (v: string) => void;
}) {
  const { tr } = useI18n();
  const norm = value.trim().toLowerCase();
  const isAuto = !isColorSet(value);
  const isPreset = presets.some((p) => p.toLowerCase() === norm);
  const isCustom = !isAuto && !isPreset;
  const customSeed = isColorSet(value) ? value : autoResolved;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          width: 42,
          flex: "0 0 auto",
          fontSize: 11,
          fontWeight: 500,
          color: theme.muted,
        }}
      >
        {caption}
      </span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: 1 }}>
        {/* Auto — reverts to the theme color */}
        <button
          type="button"
          onClick={() => onChange("auto")}
          aria-pressed={isAuto}
          aria-label={`${caption} — ${tr("settings.colors.auto")}`}
          title={tr("settings.colors.auto")}
          style={{ ...swatchBase(theme, isAuto), background: autoResolved }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: onColorFor(autoResolved) }}>
            A
          </span>
        </button>

        {/* Presets */}
        {presets.map((p) => {
          const selected = p.toLowerCase() === norm;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              aria-pressed={selected}
              aria-label={`${caption}: ${p}`}
              title={p}
              style={{ ...swatchBase(theme, selected), background: p }}
            >
              {selected && <Icon name="check" size={14} style={{ color: onColorFor(p) }} />}
            </button>
          );
        })}

        {/* Freeform picker */}
        <label
          aria-label={`${caption} — ${tr("settings.colors.custom")}`}
          title={tr("settings.colors.custom")}
          style={{
            ...swatchBase(theme, isCustom),
            background: isCustom
              ? value
              : "conic-gradient(from 90deg, #ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ef4444)",
          }}
        >
          <Icon
            name="pencil"
            size={12}
            style={{ color: isCustom ? onColorFor(value) : "#ffffff", pointerEvents: "none" }}
          />
          <input
            type="color"
            value={customSeed}
            onChange={(e) => onChange(e.target.value)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              opacity: 0,
              cursor: "pointer",
              border: "none",
              padding: 0,
            }}
          />
        </label>
      </div>
    </div>
  );
}

/** The Text-color + Page-color control. Shared by the reflow reader's reading
 *  settings and the fixed (PDF/DOCX) reader panel. Warns (icon + text, not
 *  color alone) when the effective ink/paper pair drops below WCAG AA. */
export function ColorField({
  theme,
  inkColor,
  paperColor,
  onChangeInk,
  onChangePaper,
}: {
  theme: Theme;
  inkColor: string;
  paperColor: string;
  onChangeInk: (v: string) => void;
  onChangePaper: (v: string) => void;
}) {
  const { tr } = useI18n();
  const resolved = resolveReadingColors(theme, inkColor, paperColor);
  const anyOverride = isColorSet(inkColor) || isColorSet(paperColor);
  const lowContrast = anyOverride && isLowContrast(resolved.ink, resolved.paper);

  return (
    <Field label={tr("settings.colors")} theme={theme}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <ColorSwatchRow
          theme={theme}
          caption={tr("settings.colors.text")}
          value={inkColor}
          presets={INK_PRESETS}
          autoResolved={theme.ink}
          onChange={onChangeInk}
        />
        <ColorSwatchRow
          theme={theme}
          caption={tr("settings.colors.page")}
          value={paperColor}
          presets={PAPER_PRESETS}
          autoResolved={theme.bg}
          onChange={onChangePaper}
        />
      </div>
      {lowContrast && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 12,
            color: ACCENT,
          }}
        >
          <Icon name="info" size={14} style={{ flex: "0 0 auto" }} />
          <span style={{ fontSize: 10.5, lineHeight: 1.4 }}>
            {tr("settings.colors.lowContrast")}
          </span>
        </div>
      )}
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
      id: "readingColors",
      label: tr("settings.colors"),
      node: (
        <ColorField
          theme={theme}
          inkColor={t.inkColor}
          paperColor={t.paperColor}
          onChangeInk={(v) => setTweak("inkColor", v)}
          onChangePaper={(v) => setTweak("paperColor", v)}
        />
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

/** Zoom stepper button. Sized to the platform's touch minimum on mobile
 *  (44pt, Apple HIG) and to the panel's denser desktop rhythm otherwise. */
function zoomStepStyle(theme: Theme, mobile: boolean): CSSProperties {
  const size = mobile ? 44 : 34;
  return {
    width: size,
    height: size,
    borderRadius: 8,
    border: `1px solid ${theme.rule}`,
    background: theme.hover,
    color: theme.ink,
    cursor: "pointer",
    fontSize: 18,
    lineHeight: 1,
    display: "grid",
    placeItems: "center",
    touchAction: "manipulation",
    flexShrink: 0,
  };
}

/** Fixed-layout (PDF / DOCX) page controls, as searchable entries.
 *
 *  The reflow counterpart is `readingItems()` above. A fixed-layout page is a
 *  rendered image — font size, line height and alignment are baked in — so
 *  this list swaps typography for the knobs that DO apply: how pages advance,
 *  how they're scaled, and how they're tinted.
 *
 *  `zoom` is deliberately NOT a `Tweaks` field: it's per-session viewer state
 *  owned by FixedPageReader, so it arrives as an explicit value + setter. */
export function fixedItems(ctx: {
  theme: Theme;
  t: Tweaks;
  setTweak: SetTweak;
  tr: Tr;
  locale: Locale;
  zoom: number;
  onZoomChange: (next: number) => void;
  mobile: boolean;
}): SettingEntry[] {
  const { theme, t, setTweak, tr, locale, zoom, onZoomChange, mobile } = ctx;
  const step = (delta: number) =>
    onZoomChange(
      Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(zoom + delta).toFixed(2))),
    );
  return [
    {
      id: "readingColors",
      label: tr("settings.colors"),
      node: (
        <ColorField
          theme={theme}
          inkColor={t.inkColor}
          paperColor={t.paperColor}
          onChangeInk={(v) => setTweak("inkColor", v)}
          onChangePaper={(v) => setTweak("paperColor", v)}
        />
      ),
    },
    {
      id: "fixedFlow",
      label: tr("settings.flow"),
      node: (
        <Field label={tr("settings.flow")} theme={theme}>
          <SegRow<Tweaks["fixedFlow"]>
            theme={theme}
            value={t.fixedFlow}
            onChange={(v) => setTweak("fixedFlow", v)}
            options={[
              { value: "scroll", label: tr("settings.flow.scroll") },
              { value: "paged", label: tr("settings.flow.paged") },
            ]}
          />
        </Field>
      ),
    },
    {
      id: "fixedFit",
      label: tr("settings.fit"),
      node: (
        <Field label={tr("settings.fit")} theme={theme}>
          <SegRow<Tweaks["fixedFit"]>
            theme={theme}
            value={t.fixedFit}
            onChange={(v) => setTweak("fixedFit", v)}
            options={[
              { value: "width", label: tr("settings.fit.width") },
              { value: "page", label: tr("settings.fit.page") },
            ]}
          />
        </Field>
      ),
    },
    {
      id: "fixedPageTint",
      label: tr("settings.pageTint"),
      node: (
        <Field label={tr("settings.pageTint")} theme={theme}>
          <SegRow<Tweaks["fixedPageTint"]>
            theme={theme}
            value={t.fixedPageTint}
            onChange={(v) => setTweak("fixedPageTint", v)}
            options={[
              { value: "none", label: tr("settings.pageTint.none") },
              { value: "dim", label: tr("settings.pageTint.dim") },
              { value: "invert", label: tr("settings.pageTint.invert") },
            ]}
          />
        </Field>
      ),
    },
    {
      id: "fixedZoom",
      label: tr("settings.zoom"),
      node: (
        <Field label={tr("settings.zoom")} theme={theme}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => step(-ZOOM_STEP)}
              disabled={zoom <= ZOOM_MIN}
              aria-label={tr("settings.zoom.out")}
              style={{
                ...zoomStepStyle(theme, mobile),
                opacity: zoom <= ZOOM_MIN ? 0.4 : 1,
                cursor: zoom <= ZOOM_MIN ? "default" : "pointer",
              }}
            >
              −
            </button>
            <span
              style={{
                flex: 1,
                textAlign: "center",
                fontVariantNumeric: "tabular-nums",
                color: theme.ink,
                fontSize: 13,
              }}
            >
              {formatNum(Math.round(zoom * 100), locale)}%
            </span>
            <button
              onClick={() => step(ZOOM_STEP)}
              disabled={zoom >= ZOOM_MAX}
              aria-label={tr("settings.zoom.in")}
              style={{
                ...zoomStepStyle(theme, mobile),
                opacity: zoom >= ZOOM_MAX ? 0.4 : 1,
                cursor: zoom >= ZOOM_MAX ? "default" : "pointer",
              }}
            >
              +
            </button>
          </div>
        </Field>
      ),
    },
  ];
}

/** Reader quick-panel controls for fixed-layout books — the `fixedItems`
 *  counterpart to `ReadingControls`. */
export function FixedPageControls(props: {
  theme: Theme;
  t: Tweaks;
  setTweak: SetTweak;
  zoom: number;
  onZoomChange: (next: number) => void;
  mobile?: boolean;
}) {
  const { tr, locale } = useI18n();
  return <>{renderEntries(fixedItems({ ...props, tr, locale, mobile: props.mobile ?? false }))}</>;
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
