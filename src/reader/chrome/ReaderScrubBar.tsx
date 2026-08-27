// Shared reader bottom scrubber: prev · % · draggable track (fill + knob +
// optional ticks) · title · next. Position is expressed as a 0..1 `fraction`;
// dragging/clicking the track emits a 0..1 value through `onSeek`, so the reflow
// reader can map it to a chapter and the fixed-page reader to a page with one
// implementation.
//
// RTL-correct: fill and knob use logical positioning (grow from the reading-
// start edge), and the drag ratio is inverted under RTL so the start of the
// book is the reading-start edge in both directions.

import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Theme } from "../../styles/tokens";
import { ReaderIconButton } from "./ReaderIconButton";

interface Props {
  theme: Theme;
  /** Whether the reader chrome is RTL (drives fill/knob + drag-ratio inversion). */
  rtl: boolean;
  /** Current position, 0..1. */
  fraction: number;
  /** Percent label (already rounded/localized-digit if needed by caller). */
  pctLabel: string;
  /** Trailing title text (chapter title or book title). */
  label: string;
  /** Optional tick marks at these 0..1 positions (e.g. chapter boundaries). */
  ticks?: number[];
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  /** Emitted (0..1) on track press + drag. */
  onSeek: (fraction: number) => void;
  ariaLabel: string;
  valueMin?: number;
  valueMax?: number;
  valueNow?: number;
  valueText?: string;
  /** Bar padding — defaults to the reflow reader's generous footer inset. */
  padding?: CSSProperties["padding"];
}

export function ReaderScrubBar({
  theme,
  rtl,
  fraction,
  pctLabel,
  label,
  ticks = [],
  prevLabel,
  nextLabel,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  onSeek,
  ariaLabel,
  valueMin,
  valueMax,
  valueNow,
  valueText,
  // Bottom inset keeps the scrubber clear of Android's gesture pill; 0 on desktop.
  padding = "14px 80px calc(22px + env(safe-area-inset-bottom, 0px))",
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const ratioFromClientX = (clientX: number): number | null => {
    const el = trackRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return null;
    const raw = (clientX - rect.left) / rect.width;
    const r = rtl ? 1 - raw : raw; // 0 = reading start in both directions
    return Math.min(1, Math.max(0, r));
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    const r = ratioFromClientX(e.clientX);
    if (r !== null) onSeek(r);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const r = ratioFromClientX(e.clientX);
    if (r !== null) onSeek(r);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const posPct = `${Math.min(100, Math.max(0, fraction * 100))}%`;

  return (
    <div
      style={{
        padding,
        display: "flex",
        alignItems: "center",
        gap: 16,
        color: theme.muted,
        fontSize: 11,
        flexShrink: 0,
      }}
    >
      <ReaderIconButton
        theme={theme}
        icon="arrowL"
        label={prevLabel}
        onClick={onPrev}
        disabled={prevDisabled}
        size={28}
        iconSize={14}
        flip
      />
      <span style={{ fontVariantNumeric: "tabular-nums", minWidth: 32 }}>
        {pctLabel}
      </span>
      <div
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={valueMin}
        aria-valuemax={valueMax}
        aria-valuenow={valueNow}
        aria-valuetext={valueText}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          flex: 1,
          height: 22,
          display: "flex",
          alignItems: "center",
          cursor: dragging ? "grabbing" : "pointer",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <div ref={trackRef} style={{ position: "relative", width: "100%", height: 3 }}>
          <div
            style={{ position: "absolute", inset: 0, background: theme.rule, borderRadius: 1.5 }}
          />
          <div
            style={{
              position: "absolute",
              insetBlock: 0,
              insetInlineStart: 0,
              width: posPct,
              background: theme.ink,
              borderRadius: 1.5,
            }}
          />
          {ticks.map((p, i) => (
            <span
              key={i}
              style={{
                position: "absolute",
                insetInlineStart: `${p * 100}%`,
                top: -2,
                width: 1,
                height: 7,
                background: theme.muted,
                opacity: 0.5,
              }}
            />
          ))}
          <div
            style={{
              position: "absolute",
              insetInlineStart: posPct,
              top: "50%",
              transform: `translate(-50%, -50%) scale(${dragging ? 1.25 : 1})`,
              width: 12,
              height: 12,
              borderRadius: 6,
              background: theme.ink,
              boxShadow: `0 0 0 3px ${theme.bg}`,
              transition: "transform 120ms ease",
            }}
          />
        </div>
      </div>
      <span
        style={{
          fontVariantNumeric: "tabular-nums",
          maxWidth: 200,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <ReaderIconButton
        theme={theme}
        icon="arrowR"
        label={nextLabel}
        onClick={onNext}
        disabled={nextDisabled}
        size={28}
        iconSize={14}
        flip
      />
    </div>
  );
}
