// The desktop reader's bottom bar, in whichever style the reader picked in
// Settings ▸ Appearance (Tweaks.readerBar) — the same choice that arranges the
// phone's bar (ReaderBottomBar), translated for a window. Shared by the EPUB
// reader and the fixed-page (PDF/DOCX) reader.
//
// On desktop the panel buttons live in the top bar, so a style here only
// decides how you see and move your place in the book:
//
//   classic   the full-width scrubber the desktop has always had
//   labelled  "Previous chapter" / "Next chapter" in words, with where you
//             are spelled out above a seek line
//   slider    one large slider across the window, the chapter riding its
//             handle
//   capsule   a small frosted pill floating at the bottom centre
//   status    no bar: a seekable hairline and one line of text
//   corners   two round buttons in the corners and almost nothing else
//
// The first three are one glass surface along the bottom edge, as before.
// The floating three are click-through apart from their controls, so the
// text near the bottom of the window stays selectable around them.
//
// The reader owns focus mode's show/hide (`outer`, `inner`); this file owns
// only the arrangement.

import type { CSSProperties, ReactNode } from "react";
import { Icon } from "../../components/Icon";
import type { Theme } from "../../styles/tokens";
import type { ReaderBarStyle } from "../../types/reader";
import { glassBar, glassPill } from "./glass";
import { ReaderIconButton } from "./ReaderIconButton";
import {
  type BarPlace,
  type BarSeek,
  SeekLine,
  ThinTrack,
} from "./ReaderBottomBar";

/** A previous/next step: a chapter, or a page. */
export interface BarStep {
  label: string;
  onClick: () => void;
  disabled: boolean;
}

export interface DesktopReaderBarProps {
  theme: Theme;
  style: ReaderBarStyle;
  /** The window at the bottom edge (focus.pin / focus.clip). */
  outer: CSSProperties;
  /** What slides inside it in focus mode (focus.slide), or null. */
  inner: CSSProperties | null;
  /** The reader's ReaderProgressBar, as the classic bar has always shown it. */
  slider: ReactNode;
  /** The same, `size="large"`, for the slider-first bar. */
  bigSlider: ReactNode;
  place: BarPlace;
  seek: BarSeek;
  prev: BarStep;
  next: BarStep;
}

const FLOATING: ReadonlySet<ReaderBarStyle> = new Set([
  "capsule",
  "status",
  "corners",
]);

export function DesktopReaderBar(props: DesktopReaderBarProps) {
  const { theme, style, outer, inner } = props;
  const floating = FLOATING.has(style);
  const glass = glassBar(theme, "bottom");
  return (
    <div
      data-desktop-reader-bar={style}
      // A floating style's window spans the whole edge but shows only a few
      // controls; the rest of it must not swallow clicks meant for the text.
      style={floating ? { ...outer, pointerEvents: "none" } : outer}
    >
      <div
        className={floating ? undefined : glass.className}
        style={{
          ...(floating ? null : glass.style),
          ...inner,
          color: theme.chromeInk,
        }}
      >
        {style === "classic" && props.slider}
        {style === "slider" && props.bigSlider}
        {style === "labelled" && <Labelled {...props} />}
        {style === "capsule" && <Capsule {...props} />}
        {style === "status" && <Status {...props} />}
        {style === "corners" && <Corners {...props} />}
      </div>
    </div>
  );
}

// ── Full-width ──────────────────────────────────────────────────────────────

function Labelled({ theme, place, seek, prev, next }: DesktopReaderBarProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 20,
        padding: "12px 28px 14px",
      }}
    >
      <StepButton theme={theme} step={prev} dir="prev" />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            fontSize: 12.5,
            marginBottom: 4,
          }}
        >
          <span
            dir="auto"
            style={{
              color: theme.ink,
              fontWeight: 500,
              minWidth: 0,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {place.title}
          </span>
          <span
            style={{
              color: theme.muted,
              flexShrink: 0,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {place.position} · {place.percent}
          </span>
        </div>
        <div style={{ paddingTop: 15 }}>
          <SeekLine theme={theme} fraction={place.fraction} seek={seek} />
        </div>
      </div>
      <StepButton theme={theme} step={next} dir="next" />
    </div>
  );
}

/** "Previous chapter" with its arrow, as a pill. */
function StepButton({
  theme,
  step,
  dir,
}: {
  theme: Theme;
  step: BarStep;
  dir: "prev" | "next";
}) {
  const arrow = (
    <Icon
      name={dir === "prev" ? "arrowL" : "arrowR"}
      size={14}
      className="rtl-flip-x"
    />
  );
  return (
    <button
      type="button"
      onClick={step.onClick}
      disabled={step.disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        height: 36,
        padding: "0 16px",
        borderRadius: 999,
        border: `0.5px solid ${theme.ruleStrong}`,
        background: "transparent",
        color: theme.chromeInk,
        font: "inherit",
        fontSize: 12.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
        cursor: step.disabled ? "default" : "pointer",
        opacity: step.disabled ? 0.4 : 1,
      }}
    >
      {dir === "prev" && arrow}
      {step.label}
      {dir === "next" && arrow}
    </button>
  );
}

// ── Floating ────────────────────────────────────────────────────────────────

/** Room above a floating control for the seek line's chip while dragging:
 *  the focus-mode window clips at its own top edge. */
const CHIP_ROOM = 40;

function Capsule({ theme, place, seek, prev, next }: DesktopReaderBarProps) {
  const pill = glassPill(theme);
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        padding: `${CHIP_ROOM}px 0 16px`,
      }}
    >
      <div
        className={pill.className}
        style={{
          ...pill.style,
          pointerEvents: "auto",
          width: "min(480px, 56%)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 6px",
          borderRadius: 999,
        }}
      >
        <StepIcon theme={theme} step={prev} dir="prev" />
        <div style={{ flex: 1, minWidth: 0, paddingTop: 15 }}>
          <SeekLine theme={theme} fraction={place.fraction} seek={seek} />
        </div>
        <span
          style={{
            flex: "0 0 40px",
            textAlign: "center",
            fontSize: 11.5,
            color: theme.muted,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {place.percent}
        </span>
        <StepIcon theme={theme} step={next} dir="next" />
      </div>
    </div>
  );
}

function Status({ theme, place, seek }: DesktopReaderBarProps) {
  return (
    <div
      style={{
        paddingTop: CHIP_ROOM,
        // No surface, so the line of text gets a fade of the page colour to
        // sit on instead of the paragraph running through it.
        background: `linear-gradient(to top, ${theme.bg} 55%, transparent)`,
      }}
    >
      <div style={{ pointerEvents: "auto", paddingTop: 15 }}>
        <SeekLine theme={theme} fraction={place.fraction} seek={seek} />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          padding: "2px 24px 10px",
          fontSize: 11.5,
          color: theme.muted,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span
          dir="auto"
          style={{
            color: theme.ink,
            fontWeight: 500,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {place.title}
        </span>
        <span style={{ flexShrink: 0 }}>
          {place.detail ? `${place.detail} · ` : ""}
          {place.percent}
        </span>
      </div>
    </div>
  );
}

function Corners({ theme, place, prev, next }: DesktopReaderBarProps) {
  return (
    <div style={{ position: "relative", height: CHIP_ROOM + 64 }}>
      <div
        style={{
          position: "absolute",
          insetInline: 20,
          bottom: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <CornerStep theme={theme} step={prev} dir="prev" />
        <span
          style={{
            fontSize: 11.5,
            color: theme.muted,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {place.percent}
        </span>
        <CornerStep theme={theme} step={next} dir="next" />
      </div>
      <ThinTrack
        theme={theme}
        fraction={place.fraction}
        height={2}
        style={{
          position: "absolute",
          insetInline: 0,
          bottom: 0,
          opacity: 0.7,
        }}
      />
    </div>
  );
}

function StepIcon({
  theme,
  step,
  dir,
}: {
  theme: Theme;
  step: BarStep;
  dir: "prev" | "next";
}) {
  return (
    <ReaderIconButton
      theme={theme}
      icon={dir === "prev" ? "arrowL" : "arrowR"}
      label={step.label}
      onClick={step.onClick}
      disabled={step.disabled}
      size={32}
      iconSize={15}
      flip
    />
  );
}

function CornerStep({
  theme,
  step,
  dir,
}: {
  theme: Theme;
  step: BarStep;
  dir: "prev" | "next";
}) {
  const pill = glassPill(theme);
  return (
    <button
      type="button"
      onClick={step.onClick}
      disabled={step.disabled}
      aria-label={step.label}
      title={step.label}
      className={pill.className}
      style={{
        ...pill.style,
        pointerEvents: "auto",
        width: 40,
        height: 40,
        borderRadius: 20,
        display: "grid",
        placeItems: "center",
        color: theme.chromeInk,
        cursor: step.disabled ? "default" : "pointer",
        opacity: step.disabled ? 0.4 : 1,
      }}
    >
      <Icon
        name={dir === "prev" ? "arrowL" : "arrowR"}
        size={16}
        className="rtl-flip-x"
      />
    </button>
  );
}
