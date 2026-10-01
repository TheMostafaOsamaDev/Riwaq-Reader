// Settings ▸ Appearance ▸ "Continue reading card": picks Tweaks.heroStyle.
//
// Each option carries a thumbnail drawn from plain boxes in the live theme,
// not a screenshot — it follows the theme the user is in and costs nothing to
// ship. The thumbnails are sketches of the layout, not the real card; their
// only job is to tell the four apart at a glance.

import type { CSSProperties, ReactNode } from "react";
import { Field } from "./SettingsSection";
import { HERO_STYLES } from "./library/heroModel";
import { ACCENT, type Theme } from "../styles/tokens";
import type { HeroStyle } from "../types/reader";
import type { MsgKey } from "../i18n";
import { useI18n } from "../i18n/useI18n";

export function HeroStyleField({
  theme,
  value,
  onChange,
}: {
  theme: Theme;
  value: HeroStyle;
  onChange: (v: HeroStyle) => void;
}) {
  const { tr } = useI18n();
  return (
    <Field label={tr("settings.heroStyle")} theme={theme}>
      <p
        style={{
          margin: "-4px 0 10px",
          fontSize: 11.5,
          lineHeight: 1.5,
          color: theme.muted,
        }}
      >
        {tr("settings.heroStyle.hint")}
      </p>
      <div
        style={{
          display: "grid",
          // Two across on a phone, four across on a wide pane.
          gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
          gap: 8,
        }}
      >
        {HERO_STYLES.map((s) => {
          const selected = value === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={selected}
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
              <Preview style={s} theme={theme} />
              <span
                style={{ display: "flex", flexDirection: "column", gap: 2 }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {tr(`settings.heroStyle.${s}` as MsgKey)}
                </span>
                <span
                  style={{ fontSize: 11, lineHeight: 1.4, color: theme.muted }}
                >
                  {tr(`settings.heroStyle.${s}.hint` as MsgKey)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Field>
  );
}

// ── thumbnails ──────────────────────────────────────────────────────────────

const box = (s: CSSProperties): CSSProperties => ({ flexShrink: 0, ...s });

function Line({ w, h = 3, c }: { w: string | number; h?: number; c: string }) {
  return (
    <div style={box({ width: w, height: h, borderRadius: h, background: c })} />
  );
}

/** A book cover: a warm block with a darker spine edge. */
function MiniCover({ w, h }: { w: number; h: number }) {
  return (
    <div
      style={box({
        width: w,
        height: h,
        borderRadius: 2,
        background:
          "linear-gradient(155deg, #7a3b2a 0%, #7a3b2a 55%, #c08a5a 100%)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
      })}
    />
  );
}

function Frame({
  theme,
  children,
  bg,
}: {
  theme: Theme;
  children: ReactNode;
  bg?: string;
}) {
  return (
    <div
      aria-hidden
      style={{
        height: 72,
        borderRadius: 6,
        padding: 8,
        boxSizing: "border-box",
        background: bg ?? theme.bg,
        border: `0.5px solid ${theme.rule}`,
        display: "flex",
        gap: 8,
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function Preview({ style, theme }: { style: HeroStyle; theme: Theme }) {
  const ink = theme.ink;
  const muted = theme.muted;
  const track = theme.rule;
  const col = (gap: number, children: ReactNode) => (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap,
      }}
    >
      {children}
    </div>
  );

  switch (style) {
    case "ambient":
      return (
        <Frame
          theme={theme}
          bg="radial-gradient(120% 140% at 20% 30%, #9a5a3a 0%, transparent 60%), linear-gradient(135deg, #3a2418 0%, #171210 100%)"
        >
          <MiniCover w={30} h={44} />
          {col(
            5,
            <>
              <Line w="80%" h={5} c="#ffffff" />
              <Line w="50%" c="rgba(255,255,255,0.7)" />
              <Line w="90%" h={2} c="rgba(255,255,255,0.3)" />
              <div
                style={box({
                  width: 28,
                  height: 9,
                  borderRadius: 9,
                  background: "#ffffff",
                })}
              />
            </>,
          )}
        </Frame>
      );
    case "refined":
      return (
        <Frame theme={theme}>
          <MiniCover w={30} h={44} />
          {col(
            5,
            <>
              <Line w="80%" h={5} c={ink} />
              <Line w="50%" c={muted} />
              <div
                style={box({
                  width: "90%",
                  height: 2,
                  borderRadius: 2,
                  background: track,
                  display: "flex",
                })}
              >
                <div
                  style={{ width: "30%", background: ink, borderRadius: 2 }}
                />
              </div>
              <div
                style={box({
                  width: 28,
                  height: 9,
                  borderRadius: 2,
                  background: ink,
                })}
              />
            </>,
          )}
        </Frame>
      );
    case "bookmark":
      return (
        <Frame theme={theme}>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <div
              style={{
                position: "absolute",
                insetInlineStart: 20,
                top: 36,
                width: 5,
                height: 14,
                background: ACCENT,
                clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 75%, 0 100%)",
              }}
            />
            <div style={{ position: "relative" }}>
              <MiniCover w={30} h={44} />
            </div>
          </div>
          {col(
            5,
            <>
              <Line w="55%" h={8} c={ink} />
              <Line w="70%" c={muted} />
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 1.5,
                  height: 10,
                }}
              >
                {Array.from({ length: 16 }, (_, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      height: i === 5 ? 10 : 6,
                      background:
                        i < 5 ? ink : i === 5 ? ACCENT : theme.ruleStrong,
                    }}
                  />
                ))}
              </div>
            </>,
          )}
        </Frame>
      );
    case "stack":
      return (
        <Frame theme={theme}>
          <div
            style={{
              flex: 1.5,
              minWidth: 0,
              height: "100%",
              borderRadius: 4,
              background: theme.chrome,
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: 5,
              boxSizing: "border-box",
            }}
          >
            <MiniCover w={20} h={30} />
            {col(
              4,
              <>
                <Line w="85%" h={4} c={ink} />
                <Line w="60%" c={muted} />
                <div
                  style={box({
                    width: 18,
                    height: 7,
                    borderRadius: 2,
                    background: ink,
                  })}
                />
              </>,
            )}
          </div>
          {col(
            6,
            [0, 1, 2].map((i) => (
              <div
                key={i}
                style={{ display: "flex", gap: 4, alignItems: "center" }}
              >
                <MiniCover w={8} h={12} />
                <Line w="70%" h={2} c={muted} />
              </div>
            )),
          )}
        </Frame>
      );
  }
}
