// The Appearance look-and-feel pickers — "Continue reading card", "Reader
// bar", "Home bar" — share this shape: a hint, then a grid of small previews
// with a name and a line each, one tap to switch.

import type { ReactNode } from "react";
import { Field } from "./SettingsSection";
import type { Theme } from "../styles/tokens";
import type { MsgKey } from "../i18n";
import { useI18n } from "../i18n/useI18n";

export function StylePicker<S extends string>({
  theme,
  field,
  styles,
  value,
  onChange,
  preview,
}: {
  theme: Theme;
  /** The setting's message key; `.hint`, `.<style>` and `.<style>.hint`
   *  hang off it. */
  field: "settings.heroStyle" | "settings.readerBar" | "settings.homeBar";
  styles: readonly S[];
  value: S;
  onChange: (v: S) => void;
  preview: (s: S) => ReactNode;
}) {
  const { tr } = useI18n();
  return (
    <Field label={tr(field)} theme={theme}>
      <p
        style={{
          margin: "-4px 0 10px",
          fontSize: 11.5,
          lineHeight: 1.5,
          color: theme.muted,
        }}
      >
        {tr(`${field}.hint` as MsgKey)}
      </p>
      <div
        style={{
          display: "grid",
          // Two across on a phone, four across on a wide pane.
          gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
          gap: 8,
        }}
      >
        {styles.map((s) => {
          const selected = value === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={selected}
              data-bar-style={s}
              onClick={() => onChange(s)}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 8,
                borderRadius: 10,
                cursor: "pointer",
                textAlign: "start",
                fontFamily: "inherit",
                color: theme.ink,
                background: selected ? theme.hover : "transparent",
                // Width stays fixed across states (1.5 vs 1 + 0.5 padding)
                // so picking a card does not nudge its neighbours.
                border: selected
                  ? `1.5px solid ${theme.ink}`
                  : `1px solid ${theme.rule}`,
                margin: selected ? 0 : 0.5,
                transition: "background 120ms ease, border-color 120ms ease",
              }}
            >
              {preview(s)}
              <span
                style={{ display: "flex", flexDirection: "column", gap: 2 }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {tr(`${field}.${s}` as MsgKey)}
                </span>
                <span
                  style={{ fontSize: 11, lineHeight: 1.4, color: theme.muted }}
                >
                  {tr(`${field}.${s}.hint` as MsgKey)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Field>
  );
}
