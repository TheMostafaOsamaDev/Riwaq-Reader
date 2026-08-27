// The reader's font picker: an anchored dropdown over the whole reading
// library. Replaces the six-chip grid, which stopped scaling once the library
// grew past a handful of faces.
//
// One selector drives BOTH scripts, so each row previews Arabic and Latin
// together — a family carrying only one script falls back to Readex Pro for
// the other, and the row shows that rather than hiding it.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ACCENT,
  FONT_GROUP_ORDER,
  FONT_FAMILY_LABELS,
  FONT_STACKS,
  READING_FONTS,
  type FontFamilyKey,
  type FontGroup,
  type Theme,
} from "../styles/tokens";
import { useFontScale } from "../hooks/useFontScale";
import { ScrollArea } from "./ScrollArea";
import { useI18n } from "../i18n/useI18n";
import type { MsgKey } from "../i18n";

const GROUP_KEY: Record<FontGroup, MsgKey> = {
  naskh: "settings.fontGroup.naskh",
  modern: "settings.fontGroup.modern",
  kufi: "settings.fontGroup.kufi",
  display: "settings.fontGroup.display",
};

const SAMPLE_AR = "أبجد هوز";
const SAMPLE_EN = "Handgloves";

/** A family name set in its own face.
 *
 *  Two corrections are load-bearing here. Families differ enormously in
 *  intrinsic size at the same `font-size` — Mirza and Markazi render far
 *  smaller than Tajawal — so the name is scaled by the measured ratio that
 *  BookBody uses for body text. And a unitless line-height pins the line box,
 *  which otherwise grows with each family's own ascent/descent and drops the
 *  name at a different height in every row. Without both, a list of names is
 *  visibly ragged. */
function FaceLabel({
  text,
  stack,
  size,
  weight,
  color,
  dir,
}: {
  text: string;
  stack: string;
  size: number;
  weight: number;
  color?: string;
  dir?: "rtl" | "ltr";
}) {
  const scale = useFontScale(stack, dir === "rtl" ? "arabic" : "latin");
  // Line box is fixed in PX off the nominal size, never the scaled one. A
  // unitless line-height would multiply the per-family scaled font-size and
  // hand every row a different height — which is exactly the raggedness the
  // scaling is meant to remove. Flex-centring then parks each face on a
  // common optical centre despite differing ascent/descent.
  const box = Math.round(size * 1.6);
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        height: box,
        lineHeight: `${box}px`,
        overflow: "hidden",
      }}
    >
      <span
        dir={dir}
        style={{
          fontFamily: stack,
          fontSize: Math.round(size * scale * 100) / 100,
          fontWeight: weight,
          lineHeight: `${box}px`,
          fontSizeAdjust: "none",
          color,
          display: "block",
          minWidth: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {text}
      </span>
    </span>
  );
}

function Chevron({ open, color }: { open: boolean; color: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "0 0 auto", transform: open ? "rotate(180deg)" : "none", transition: "transform 180ms ease" }}
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Check({ color }: { color: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "0 0 auto" }}
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Option({
  theme,
  fontKey,
  selected,
  onPick,
}: {
  theme: Theme;
  fontKey: FontFamilyKey;
  selected: boolean;
  onPick: () => void;
}) {
  const stack = FONT_STACKS[fontKey];
  return (
    <button
      className="riwaq-opt"
      role="option"
      aria-selected={selected}
      onClick={onPick}
      style={{
        width: "100%",
        minHeight: 52,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 12px",
        border: "none",
        borderInlineStart: `3px solid ${selected ? ACCENT : "transparent"}`,
        // Deliberately unset when not selected: an inline background outranks
        // any stylesheet rule, so "transparent" here would beat the :hover
        // rule in global.css and the hover tint would never show.
        background: selected ? `${ACCENT}12` : undefined,
        color: theme.ink,
        cursor: "pointer",
        textAlign: "start",
        ["--opt-hover" as string]: theme.hover,
      }}
    >
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: selected ? 700 : 500,
            lineHeight: 1.25,
            color: selected ? theme.ink : theme.muted,
          }}
        >
          {FONT_FAMILY_LABELS[fontKey]}
        </span>
        <FaceLabel text={`${SAMPLE_AR} · ${SAMPLE_EN}`} stack={stack} size={15} weight={400} dir="rtl" />
      </span>
      {selected && <Check color={ACCENT} />}
    </button>
  );
}

export function FontSelect({
  theme,
  value,
  onChange,
}: {
  theme: Theme;
  value: FontFamilyKey;
  onChange: (next: FontFamilyKey) => void;
}) {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, close]);

  const groups = FONT_GROUP_ORDER.map(
    (g) => [g, READING_FONTS.filter((f) => f.group === g)] as const,
  ).filter(([, items]) => items.length > 0);

  const triggerStyle: CSSProperties = {
    width: "100%",
    minHeight: 52,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "7px 12px",
    borderRadius: 10,
    border: `1.5px solid ${open ? ACCENT : theme.rule}`,
    background: open ? `${ACCENT}0d` : theme.chrome,
    color: theme.ink,
    cursor: "pointer",
    textAlign: "start",
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={tr("settings.font")}
        style={triggerStyle}
      >
        {/* No label inside the control — the enclosing Field renders it above,
            the same way every other row in the panel is labelled. */}
        <span style={{ minWidth: 0, flex: 1 }}>
          <FaceLabel text={FONT_FAMILY_LABELS[value]} stack={FONT_STACKS[value]} size={14} weight={600} />
        </span>
        <Chevron open={open} color={theme.muted} />
      </button>

      {open && (
        <ScrollArea
          alwaysVisible
          color={theme.muted}
          style={{
            position: "absolute",
            insetInline: 0,
            top: "calc(100% + 6px)",
            maxHeight: 300,
            zIndex: 40,
            // `chrome`, not `paper`: on the dark themes paper IS bg (#1a1614,
            // and #000 on OLED), so a paper popover over the sheet had no
            // separation at all. chrome sits a step lighter there and a step
            // darker on the light themes — either way it reads as its own
            // surface.
            background: theme.chrome,
            border: `1px solid ${theme.rule}`,
            borderRadius: 12,
            // A shadow has to be black-based. theme.ruleStrong is ink-tinted,
            // which on the dark themes is a PALE colour — it rendered as a
            // light halo around the popover rather than a shadow. Matches the
            // depth used by ContextMenu, the closest analogue in the app.
            boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
            overflow: "hidden",
          }}
          scrollStyle={{ maxHeight: 300, height: "auto", paddingBlock: 6 }}
        >
          <div role="listbox" aria-label={tr("settings.font")}>
            {groups.map(([g, items]) => (
              <div key={g}>
                <div
                  style={{
                    padding: "9px 12px 3px",
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: theme.muted,
                  }}
                >
                  {tr(GROUP_KEY[g])}
                </div>
                {items.map((f) => (
                  <Option
                    key={f.key}
                    theme={theme}
                    fontKey={f.key}
                    selected={f.key === value}
                    onPick={() => {
                      onChange(f.key);
                      close();
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
