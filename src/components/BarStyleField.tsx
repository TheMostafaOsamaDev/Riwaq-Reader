// Settings ▸ Appearance ▸ "Reader bar" and "Home bar": pick Tweaks.readerBar
// and Tweaks.homeBar. Same shape as HeroStyleField — a grid of small
// previews, one tap to switch — so the three look-and-feel choices in
// Appearance read as one family.
//
// The previews are drawings, not the real bars scaled down: the real ones
// subscribe to the download queue, the update flow and the reader's own
// state, none of which belongs on a settings page.

import type { CSSProperties, ReactNode } from "react";
import { Field } from "./SettingsSection";
import { HOME_BAR_STYLES, READER_BAR_STYLES } from "../reader/chrome/barStyles";
import { ACCENT, type Theme } from "../styles/tokens";
import type { HomeBarStyle, ReaderBarStyle } from "../types/reader";
import type { MsgKey } from "../i18n";
import { useI18n } from "../i18n/useI18n";

export function ReaderBarField({
  theme,
  value,
  onChange,
}: {
  theme: Theme;
  value: ReaderBarStyle;
  onChange: (v: ReaderBarStyle) => void;
}) {
  return (
    <StylePicker
      theme={theme}
      field="settings.readerBar"
      styles={READER_BAR_STYLES}
      value={value}
      onChange={onChange}
      preview={(s) => <ReaderPreview style={s} theme={theme} />}
    />
  );
}

export function HomeBarField({
  theme,
  value,
  onChange,
}: {
  theme: Theme;
  value: HomeBarStyle;
  onChange: (v: HomeBarStyle) => void;
}) {
  return (
    <StylePicker
      theme={theme}
      field="settings.homeBar"
      styles={HOME_BAR_STYLES}
      value={value}
      onChange={onChange}
      preview={(s) => <HomePreview style={s} theme={theme} />}
    />
  );
}

function StylePicker<S extends string>({
  theme,
  field,
  styles,
  value,
  onChange,
  preview,
}: {
  theme: Theme;
  field: "settings.readerBar" | "settings.homeBar";
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

// ── Drawing kit ─────────────────────────────────────────────────────────────

const abs = (s: CSSProperties): CSSProperties => ({
  position: "absolute",
  ...s,
});

/** A phone screen's lower half: a few lines of page, then whatever bar. */
function Screen({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <div
      aria-hidden
      style={{
        position: "relative",
        height: 72,
        borderRadius: 6,
        background: theme.bg,
        border: `0.5px solid ${theme.rule}`,
        overflow: "hidden",
      }}
    >
      {[10, 20, 30].map((top, i) => (
        <div
          key={top}
          style={abs({
            top,
            insetInlineStart: 10,
            insetInlineEnd: i === 2 ? 34 : 10,
            height: 3,
            borderRadius: 2,
            background: theme.rule,
          })}
        />
      ))}
      {children}
    </div>
  );
}

/** A full-width band along the bottom, like the solid bars. */
function Band({
  theme,
  h,
  children,
}: {
  theme: Theme;
  h: number;
  children: ReactNode;
}) {
  return (
    <div
      style={abs({
        insetInline: 0,
        bottom: 0,
        height: h,
        background: theme.chrome,
        borderTop: `0.5px solid ${theme.ruleStrong}`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 4,
        padding: "0 8px",
        boxSizing: "border-box",
      })}
    >
      {children}
    </div>
  );
}

const Row = ({
  children,
  justify = "space-around",
  gap = 0,
}: {
  children: ReactNode;
  justify?: CSSProperties["justifyContent"];
  gap?: number;
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: justify,
      gap,
    }}
  >
    {children}
  </div>
);

const Dot = ({ c, d = 5 }: { c: string; d?: number }) => (
  <span
    style={{
      width: d,
      height: d,
      borderRadius: "50%",
      background: c,
      flexShrink: 0,
    }}
  />
);

const Bar = ({
  w,
  h = 2,
  c,
}: {
  w: number | string;
  h?: number;
  c: string;
}) => (
  <span
    style={{
      width: w,
      height: h,
      borderRadius: h,
      background: c,
      flexShrink: 0,
      display: "block",
    }}
  />
);

/** A track with a fill, for a slider. */
function Track({ theme, thick = false }: { theme: Theme; thick?: boolean }) {
  const h = thick ? 3 : 2;
  return (
    <span
      style={{
        position: "relative",
        flex: 1,
        height: h,
        borderRadius: h,
        background: theme.rule,
        display: "block",
      }}
    >
      <span
        style={abs({
          insetBlock: 0,
          insetInlineStart: 0,
          width: "34%",
          borderRadius: h,
          background: theme.chromeInk,
        })}
      />
      {thick && (
        <span
          style={abs({
            top: -3,
            insetInlineStart: "34%",
            width: 9,
            height: 9,
            marginInlineStart: -4.5,
            borderRadius: "50%",
            background: theme.chromeInk,
          })}
        />
      )}
    </span>
  );
}

function ReaderPreview({
  style,
  theme,
}: {
  style: ReaderBarStyle;
  theme: Theme;
}) {
  const ink = theme.chromeInk;
  const soft = theme.muted;
  switch (style) {
    case "classic":
      return (
        <Screen theme={theme}>
          <Band theme={theme} h={28}>
            <Row justify="center" gap={5}>
              <Dot c={soft} d={3} />
              <Track theme={theme} />
              <Dot c={soft} d={3} />
            </Row>
            <Row>
              {[0, 1, 2, 3, 4].map((i) => (
                <Dot key={i} c={ink} />
              ))}
            </Row>
          </Band>
        </Screen>
      );
    case "labelled":
      return (
        <Screen theme={theme}>
          <Band theme={theme} h={32}>
            <Row justify="center">
              <Track theme={theme} />
            </Row>
            <Row>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  style={{ display: "grid", justifyItems: "center", gap: 2 }}
                >
                  <Dot c={ink} />
                  <Bar w={12} c={soft} />
                </span>
              ))}
            </Row>
          </Band>
        </Screen>
      );
    case "capsule":
      return (
        <Screen theme={theme}>
          <div
            style={abs({
              insetInline: 10,
              bottom: 7,
              height: 16,
              borderRadius: 8,
              background: theme.chrome,
              border: `0.5px solid ${theme.ruleStrong}`,
              boxShadow: "0 2px 6px rgba(0,0,0,0.16)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 5px",
            })}
          >
            <Dot c={ink} />
            <span style={{ flex: 1, display: "grid", gap: 2 }}>
              <Bar w="70%" c={soft} />
              <Track theme={theme} />
            </span>
            <Dot c={ink} />
          </div>
        </Screen>
      );
    case "status":
      return (
        <Screen theme={theme}>
          <Band theme={theme} h={28}>
            <span
              style={abs({
                top: -1,
                insetInline: 0,
                height: 2,
                background: theme.rule,
              })}
            >
              <span
                style={abs({
                  insetBlock: 0,
                  insetInlineStart: 0,
                  width: "34%",
                  background: ink,
                })}
              />
            </span>
            <Row justify="space-between">
              <Bar w={40} c={theme.ink} />
              <Bar w={18} c={soft} />
            </Row>
            <Row justify="flex-start" gap={6}>
              <Dot c={ink} />
              <Dot c={ink} />
              <Dot c={ink} />
              <span style={{ flex: 1 }} />
              <span
                style={{
                  width: 16,
                  height: 7,
                  borderRadius: 4,
                  border: `0.5px solid ${theme.ruleStrong}`,
                }}
              />
            </Row>
          </Band>
        </Screen>
      );
    case "slider":
      return (
        <Screen theme={theme}>
          <Band theme={theme} h={34}>
            <Row justify="center">
              <Bar w={34} h={4} c={theme.hover} />
            </Row>
            <Row justify="center" gap={5}>
              <Dot c={soft} d={6} />
              <Track theme={theme} thick />
              <Dot c={soft} d={6} />
            </Row>
            <Row justify="space-between">
              <Bar w={22} h={6} c={theme.rule} />
              <Bar w={22} h={6} c={theme.rule} />
            </Row>
          </Band>
        </Screen>
      );
    case "corners":
      return (
        <Screen theme={theme}>
          <div
            style={abs({
              insetInline: 8,
              bottom: 7,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            })}
          >
            <Float theme={theme} d={14} />
            <span
              style={{
                width: 24,
                height: 10,
                borderRadius: 5,
                background: theme.chrome,
                border: `0.5px solid ${theme.ruleStrong}`,
              }}
            />
            <Float theme={theme} d={14} />
          </div>
          <span
            style={abs({
              insetInline: 0,
              bottom: 0,
              height: 2,
              background: theme.rule,
            })}
          >
            <span
              style={abs({
                insetBlock: 0,
                insetInlineStart: 0,
                width: "34%",
                background: ink,
              })}
            />
          </span>
        </Screen>
      );
  }
}

/** A floating round button. */
function Float({ theme, d }: { theme: Theme; d: number }) {
  return (
    <span
      style={{
        width: d,
        height: d,
        borderRadius: "50%",
        background: theme.chrome,
        border: `0.5px solid ${theme.ruleStrong}`,
        boxShadow: "0 2px 5px rgba(0,0,0,0.16)",
        flexShrink: 0,
      }}
    />
  );
}

function HomePreview({ style, theme }: { style: HomeBarStyle; theme: Theme }) {
  const ink = theme.chromeInk;
  const soft = theme.muted;
  switch (style) {
    case "classic":
      return (
        <Screen theme={theme}>
          <Band theme={theme} h={20}>
            <Row>
              <Ring theme={theme} />
              <Ring theme={theme} />
              <Dot c={theme.ink} d={11} />
              <Ring theme={theme} />
              <Ring theme={theme} />
            </Row>
          </Band>
        </Screen>
      );
    case "labelled":
      return (
        <Screen theme={theme}>
          <Band theme={theme} h={24}>
            <Row>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  style={{ display: "grid", justifyItems: "center", gap: 2 }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 7,
                      borderRadius: 4,
                      background: i === 0 ? theme.hover : "transparent",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <Dot c={i === 0 ? theme.ink : ink} d={4} />
                  </span>
                  <Bar w={12} c={i === 0 ? theme.ink : soft} />
                </span>
              ))}
            </Row>
          </Band>
        </Screen>
      );
    case "dock":
      return (
        <Screen theme={theme}>
          <div
            style={abs({
              insetInline: 8,
              bottom: 6,
              display: "flex",
              alignItems: "center",
              gap: 5,
            })}
          >
            <span
              style={{
                flex: 1,
                height: 15,
                borderRadius: 8,
                background: theme.chrome,
                border: `0.5px solid ${theme.ruleStrong}`,
                boxShadow: "0 2px 5px rgba(0,0,0,0.14)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-around",
              }}
            >
              <Dot c={theme.ink} d={8} />
              <Dot c={ink} d={4} />
              <Dot c={ink} d={4} />
              <Dot c={ink} d={4} />
            </span>
            <Dot c={ACCENT} d={15} />
          </div>
        </Screen>
      );
    case "raised":
      return (
        <Screen theme={theme}>
          <Band theme={theme} h={20}>
            <Row>
              <Dot c={theme.ink} d={5} />
              <Dot c={ink} d={5} />
              <span style={{ width: 14 }} />
              <Dot c={ink} d={5} />
              <Dot c={ink} d={5} />
            </Row>
          </Band>
          <span
            style={abs({
              bottom: 11,
              left: "50%",
              marginLeft: -7,
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: theme.ink,
              border: `2px solid ${theme.bg}`,
            })}
          />
        </Screen>
      );
    case "switch":
      return (
        <Screen theme={theme}>
          <Band theme={theme} h={20}>
            <Row justify="space-between" gap={5}>
              <Ring theme={theme} />
              <span
                style={{
                  flex: 1,
                  height: 11,
                  borderRadius: 6,
                  background: theme.hover,
                  border: `0.5px solid ${theme.rule}`,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  padding: 1.5,
                  boxSizing: "border-box",
                }}
              >
                <span style={{ borderRadius: 5, background: theme.bg }} />
              </span>
              <Ring theme={theme} />
            </Row>
          </Band>
        </Screen>
      );
    case "expanding":
      return (
        <Screen theme={theme}>
          <Band theme={theme} h={20}>
            <Row justify="space-between">
              <span
                style={{
                  width: 30,
                  height: 10,
                  borderRadius: 5,
                  background: theme.ink,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  padding: "0 4px",
                  boxSizing: "border-box",
                }}
              >
                <Dot c={theme.bg} d={4} />
                <Bar w={12} c={theme.bg} />
              </span>
              <Dot c={ink} d={5} />
              <Dot c={ink} d={5} />
              <Dot c={ink} d={5} />
            </Row>
          </Band>
        </Screen>
      );
  }
}

/** An outlined round button. */
function Ring({ theme }: { theme: Theme }) {
  return (
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: "50%",
        border: `0.5px solid ${theme.ruleStrong}`,
        flexShrink: 0,
      }}
    />
  );
}
