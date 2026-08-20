// Reusable overlay side sheet: a dimmed scrim + an edge-anchored panel that
// slides in *over* the reader content instead of pushing it aside. Shared by
// the reflowable DesktopReader and the FixedPageReader so both readers get
// identical open/close motion, scrim dismissal, Esc-to-close and RTL-correct
// slide direction.
//
// It deliberately reuses the app's existing motion vocabulary — the
// `leaflet-backdrop-*` fade (as in AnimatedDialog) and the
// `leaflet-panel-enter/exit-<side>` slide (as in AnimatedPanel) — driven by the
// same 3-phase enter/open/exit machine, so no new keyframes are introduced and
// the sheet feels like the rest of the app.
//
// `side` is LOGICAL: "left" = the reader's leading edge, "right" = trailing.
// The panel is anchored with logical inset properties so it rests on the
// correct edge under RTL automatically; the *physical* slide keyframe is picked
// to match wherever it actually lands (see `physicalSide`), mirroring
// AnimatedPanel — otherwise it would sweep in from the wrong edge under RTL.
//
// The sheet fills its positioning parent (`position: absolute; inset: 0`), so
// mount it inside the reader's *content* region (below the chrome) — that keeps
// the chrome bar and its toggle buttons above the scrim and fully clickable.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/useI18n";
import { MOTION, useReducedMotion } from "../styles/motion";

interface Props {
  open: boolean;
  /** Fired by scrim click and by Escape. */
  onClose: () => void;
  /** Logical edge the panel rests on: "left" = leading, "right" = trailing. */
  side: "left" | "right";
  children: ReactNode;
  /** Optional fixed width. When omitted the panel is sized by its content
   *  (e.g. PanelShell's own 340px), which is what both readers rely on. */
  width?: number | string;
  /** Dim the reader behind the panel. Default true. */
  dim?: boolean;
  /** Accessible name for the dialog surface. */
  label?: string;
  /** Base stacking level; the panel sits one above the scrim. Default 40. */
  zIndex?: number;
}

type Phase = "enter" | "open" | "exit";

export function SideSheet({
  open,
  onClose,
  side,
  children,
  width,
  dim = true,
  label,
  zIndex = 40,
}: Props) {
  const { dir } = useI18n();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase | null>(open ? "enter" : null);

  // Freeze the children + side seen while open so the exit animation plays the
  // panel the user was actually using, sliding off its own edge — even though
  // the parent has already cleared its active-panel state to null.
  const lastChildrenRef = useRef<ReactNode>(children);
  const lastSideRef = useRef(side);
  if (open) {
    lastChildrenRef.current = children;
    lastSideRef.current = side;
  }

  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Keep the latest onClose without retriggering the focus/keydown effect on
  // every render (parents pass a fresh arrow each time).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Drive the enter → open → exit → unmount phase machine.
  useEffect(() => {
    if (open) {
      setPhase("enter");
      const t = setTimeout(() => setPhase("open"), reduced ? 0 : MOTION.med);
      return () => clearTimeout(t);
    }
    if (phase !== null) {
      setPhase("exit");
      const t = setTimeout(() => setPhase(null), reduced ? 0 : MOTION.fast);
      return () => clearTimeout(t);
    }
    // phase intentionally omitted: this effect reacts to `open`, and the
    // exit branch reads the current phase at cleanup-time only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reduced]);

  // While open: Esc closes, focus moves into the panel, and focus is restored
  // to the trigger on close. Lightweight — not a full focus trap (no Radix).
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  if (phase === null) return null;

  const activeSide = open ? side : lastSideRef.current;
  // The panel is anchored on the logical edge via inset properties (which flip
  // under RTL on their own); the slide keyframes are physical (translateX
  // ±100%), so choose the keyframe by where the panel physically lands.
  const physicalSide =
    dir === "rtl" ? (activeSide === "left" ? "right" : "left") : activeSide;
  const anchor =
    activeSide === "left"
      ? { insetInlineStart: 0, insetInlineEnd: "auto" as const }
      : { insetInlineEnd: 0, insetInlineStart: "auto" as const };

  const backdropClass = reduced
    ? undefined
    : phase === "exit"
      ? "leaflet-backdrop-exit"
      : phase === "enter"
        ? "leaflet-backdrop-enter"
        : undefined;
  const panelClass = reduced
    ? undefined
    : phase === "enter"
      ? `leaflet-panel-enter-${physicalSide}`
      : phase === "exit"
        ? `leaflet-panel-exit-${physicalSide}`
        : undefined;
  const animating = phase === "enter" || phase === "exit";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex,
        // Don't swallow clicks meant for the reader while sliding out.
        pointerEvents: phase === "exit" ? "none" : "auto",
      }}
    >
      {dim && (
        <div
          onClick={onClose}
          className={backdropClass}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.42)",
            // While the keyframe runs, `both` fill-mode owns the opacity; once
            // settled, pin to fully visible so the scrim doesn't blink.
            opacity: animating ? undefined : 1,
            cursor: "pointer",
          }}
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={panelClass}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          ...anchor,
          ...(width != null ? { width } : null),
          maxWidth: "100%",
          display: "flex",
          outline: "none",
          zIndex: 1,
        }}
      >
        {open ? children : lastChildrenRef.current}
      </div>
    </div>
  );
}
