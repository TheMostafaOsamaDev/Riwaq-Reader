// The reader's progress bar — one implementation for all three formats.
//
//   [prev] · percent · ─────●───── · where-you-are · [next]
//
// EPUB, PDF and DOCX differ in exactly two props: what the label says (a
// chapter name vs a page counter) and where the landmarks fall (chapter starts
// vs the file's outline). Everything else — the track, the handle, the
// gestures, the RTL mirroring, the touch targets — is shared, so the three
// readers cannot drift apart again.
//
// Position is a 0..1 `fraction` in reading order: 0 is the start of the book in
// both LTR and RTL.

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ACCENT, type Theme } from "../../styles/tokens";
import { ReaderIconButton } from "./ReaderIconButton";

/** Centre an element on a logical position.
 *
 *  `insetInlineStart: 42%` resolves to `right: 42%` under RTL, which anchors the
 *  element's RIGHT edge on the point — so the physical `translateX(-50%)` that
 *  centres it in LTR drags it a further half-width the wrong way and lands it a
 *  full width past the mark. On a 13px handle against a 3px line that reads as
 *  the handle having come loose from the end of the fill. */
function centreOn(rtl: boolean): string {
  return `translate(${rtl ? "50%" : "-50%"}, -50%)`;
}

/** Past this many landmarks the track stops drawing them.
 *
 *  A phone's track is ~184px. A web-serial with 2372 chapters asked for 2370
 *  dots on it — they pile up two to a pixel into a smear that says nothing, and
 *  cost 2370 absolutely-positioned nodes rebuilt on every frame of a drag. At
 *  the cap the dots are still ~8px apart and readable as structure. */
export const MAX_TICKS = 24;

function clamp01(n: number): number {
  return Number.isNaN(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n;
}

/** The scrub handle: an outlined ring at rest, a solid accent dot while held.
 *
 *  The ring is what keeps it a distinct control. The obvious alternative —
 *  `box-shadow: 0 0 0 3px <chrome>` — punches a hole in the track either side of
 *  the handle, and on a 3px hairline that hole is as thick as the line, so the
 *  bar reads as broken with a dimmed halo round the dot. A border closes the
 *  shape instead of cutting the line.
 *
 *  Grabbing it floods the ring with the app's accent. Contact is the one moment
 *  the handle needs to announce itself, and colour says it without moving
 *  anything — the handle stays exactly where the finger put it. */
function Knob({
  theme,
  pct,
  dragging,
  rtl,
  reduced,
}: {
  theme: Theme;
  pct: number;
  dragging: boolean;
  rtl: boolean;
  reduced: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        insetInlineStart: `${pct}%`,
        top: "50%",
        transform: `${centreOn(rtl)} scale(${dragging ? 1.3 : 1})`,
        width: 13,
        height: 13,
        boxSizing: "border-box",
        borderRadius: 999,
        background: dragging ? ACCENT : theme.chrome,
        border: `2px solid ${dragging ? ACCENT : theme.ink}`,
        boxShadow: "0 1px 4px rgba(0, 0, 0, 0.32)",
        transition: reduced
          ? "none"
          : "transform 140ms cubic-bezier(0.2, 0, 0, 1), background-color 160ms ease-out, border-color 160ms ease-out",
        zIndex: 2,
      }}
    />
  );
}

/** Chapter / outline landmarks. Dots that sit ON the line rather than strokes
 *  cutting through it — same reasoning as the handle's missing ring. */
function Ticks({ theme, ticks, rtl }: { theme: Theme; ticks: number[]; rtl: boolean }) {
  if (ticks.length > MAX_TICKS) return null;
  return (
    <>
      {ticks.map((at, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            insetInlineStart: `${clamp01(at) * 100}%`,
            top: "50%",
            transform: centreOn(rtl),
            width: 2,
            height: 2,
            borderRadius: 999,
            background: theme.muted,
            opacity: 0.65,
          }}
        />
      ))}
    </>
  );
}

/** The chip that names the position being dragged to, anchored on the handle. */
function ScrubChip({
  theme,
  pct,
  rtl,
  children,
}: {
  theme: Theme;
  pct: number;
  rtl: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        // Anchor on the handle, then shift the chip back by the fraction of its
        // own width that matches how far along we are, so it never overflows
        // the track at either extreme.
        insetInlineStart: `${pct}%`,
        bottom: "calc(100% + 12px)",
        transform: `translateX(${(rtl ? 1 : -1) * pct}%)`,
        background: theme.chrome,
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
        borderRadius: 9,
        padding: "7px 11px",
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: "nowrap",
        maxWidth: 260,
        overflow: "hidden",
        textOverflow: "ellipsis",
        pointerEvents: "none",
        boxShadow: "0 6px 18px rgba(0, 0, 0, 0.22)",
        zIndex: 3,
      }}
    >
      {children}
    </div>
  );
}

export interface ReaderProgressBarProps {
  theme: Theme;
  /** Chrome direction — drives the fill/handle mirroring and the drag axis. */
  rtl: boolean;
  /** Committed position, 0..1 in reading order. */
  fraction: number;
  /** Percent text for a position. Takes a fraction so it can describe the
   *  position being previewed mid-drag, and so digit localisation stays with
   *  the caller. */
  formatPct: (fraction: number) => string;
  /** Where-you-are text for a position: "Chapter 5 · The Long Night" for EPUB,
   *  "Page 125 of 298" for the fixed-page formats. */
  formatLabel: (fraction: number) => string;
  /** Landmarks at these 0..1 positions — chapter starts, or outline entries.
   *  More than MAX_TICKS of them and the track draws none: see the note there. */
  ticks?: number[];
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  /** Called continuously while dragging. Omit it when moving is expensive (a
   *  chapter load, say): the handle then previews under the finger and only
   *  `onSeek` fires, on release. */
  onScrub?: (fraction: number) => void;
  /** Called on release, and on a tap anywhere on the track. */
  onSeek: (fraction: number) => void;
  ariaLabel: string;
  valueMin?: number;
  valueMax?: number;
  valueNow?: number;
  valueText?: string;
  /** Bar padding. Defaults to the phone's inset, which clears Android's
   *  gesture pill; desktop callers pass their own. */
  padding?: CSSProperties["padding"];
  reducedMotion?: boolean;
  /** Width reserved for the trailing label; 0 drops it.
   *
   *  A phone has no room for it. Measured on device, the label's 104px left the
   *  track 86px of a 384px screen — a quarter of the width to seek 298 pages
   *  with. Both readers already name the position in the top bar (the page
   *  counter, or "chapter n of total"), and the chip names the target while
   *  you drag, so on narrow chrome the label is the part to give up. */
  labelWidth?: number;
}

export function ReaderProgressBar({
  theme,
  rtl,
  fraction,
  formatPct,
  formatLabel,
  ticks = [],
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  onScrub,
  onSeek,
  ariaLabel,
  valueMin,
  valueMax,
  valueNow,
  valueText,
  padding = "6px 14px calc(env(safe-area-inset-bottom, 0px) + 4px)",
  reducedMotion = false,
  labelWidth = 104,
}: ReaderProgressBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  // Where the finger is, while the parent's `fraction` may still be behind —
  // callers without `onScrub` deliberately don't move until release.
  const [preview, setPreview] = useState<number | null>(null);

  const ratioFrom = useCallback(
    (clientX: number): number | null => {
      const el = trackRef.current;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return null;
      const raw = (clientX - r.left) / r.width;
      return clamp01(rtl ? 1 - raw : raw); // 0 = start of the book either way
    },
    [rtl],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    active.current = true;
    const f = ratioFrom(e.clientX);
    if (f === null) return;
    setPreview(f);
    onScrub?.(f);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!active.current) return;
    const f = ratioFrom(e.clientX);
    if (f === null) return;
    setPreview(f);
    onScrub?.(f);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!active.current) return;
    active.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setPreview((f) => {
      if (f !== null) onSeek(f);
      return null;
    });
  };

  const dragging = preview !== null;
  const shown = preview ?? clamp01(fraction);
  const pct = clamp01(shown) * 100;

  return (
    <div
      style={{
        padding,
        display: "flex",
        alignItems: "center",
        gap: 6,
        color: theme.chromeInk,
        fontSize: 11.5,
        flexShrink: 0,
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <ReaderIconButton
        theme={theme}
        icon="arrowL"
        label={prevLabel}
        onClick={onPrev}
        disabled={prevDisabled}
        size={44}
        iconSize={17}
        flip
      />
      {/* Fixed basis, not minWidth. Anything sharing this row with the `flex: 1`
          track has to reserve its space up front: these labels change as you
          scrub ("42%" → "100%", "Chapter 5 · The Long Night" → "Chapter 11 ·
          Afterword"), and an intrinsic width hands that change straight to the
          track, which then grows and shrinks under the finger holding it. The
          track's length must be a property of the row, never of its neighbours. */}
      <span
        style={{
          flex: "0 0 42px",
          textAlign: "center",
          color: theme.muted,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatPct(shown)}
      </span>
      <div
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={valueMin}
        aria-valuemax={valueMax}
        aria-valuenow={valueNow}
        aria-valuetext={valueText}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          flex: 1,
          minWidth: 0,
          // The visible line is 3px; this grows the target to 44 without
          // moving anything, so the row's height is the button's height.
          height: 44,
          display: "flex",
          alignItems: "center",
          cursor: "pointer",
          touchAction: "none",
        }}
      >
        <div ref={trackRef} style={{ position: "relative", width: "100%", height: 3 }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: theme.rule,
              borderRadius: 999,
            }}
          />
          <div
            style={{
              position: "absolute",
              insetBlock: 0,
              insetInlineStart: 0,
              width: `${pct}%`,
              background: theme.ink,
              borderRadius: 999,
            }}
          />
          <Ticks theme={theme} ticks={ticks} rtl={rtl} />
          <Knob
            theme={theme}
            pct={pct}
            dragging={dragging}
            rtl={rtl}
            reduced={reducedMotion}
          />
          {dragging && (
            <ScrubChip theme={theme} pct={pct} rtl={rtl}>
              {formatLabel(shown)}
            </ScrubChip>
          )}
        </div>
      </div>
      {labelWidth > 0 && (
        <span
          style={{
            flex: `0 0 ${labelWidth}px`,
            color: theme.muted,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {formatLabel(shown)}
        </span>
      )}
      <ReaderIconButton
        theme={theme}
        icon="arrowR"
        label={nextLabel}
        onClick={onNext}
        disabled={nextDisabled}
        size={44}
        iconSize={17}
        flip
      />
    </div>
  );
}
