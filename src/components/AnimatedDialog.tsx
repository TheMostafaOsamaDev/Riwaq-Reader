// Modal dialog wrapper. Scrim fades + card scale-pops on enter; reverses on
// exit. The card content stays mounted long enough to play the exit before it
// unmounts. Same phase machine as MobileSheet/AnimatedPanel so behavior is
// uniform across the app's animated surfaces.
//
// Each consumer dialog (ConfirmDialog, ImportChoiceModal, DownloadRangeDialog)
// renders only the *card* — this wrapper owns the scrim, centering, and
// animation.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MOTION, useReducedMotion } from "../styles/motion";

interface Props {
  open: boolean;
  /** Optional scrim-click handler — call sites typically wire this to the same
   *  onCancel/onClose the dialog uses. */
  onScrimClick?: () => void;
  children: ReactNode;
  zIndex?: number;
}

type Phase = "enter" | "open" | "exit";

export function AnimatedDialog({
  open,
  onScrimClick,
  children,
  zIndex = 200,
}: Props) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase | null>(open ? "enter" : null);
  const lastChildrenRef = useRef<ReactNode>(children);
  if (open) lastChildrenRef.current = children;

  useEffect(() => {
    if (open) {
      setPhase("enter");
      const t = setTimeout(
        () => setPhase("open"),
        reduced ? 0 : MOTION.med,
      );
      return () => clearTimeout(t);
    }
    if (phase !== null) {
      setPhase("exit");
      const t = setTimeout(
        () => setPhase(null),
        reduced ? 0 : MOTION.fast,
      );
      return () => clearTimeout(t);
    }
  }, [open, reduced]);

  if (phase === null) return null;

  const backdropClass = reduced
    ? undefined
    : phase === "exit"
      ? "leaflet-backdrop-exit"
      : phase === "enter"
        ? "leaflet-backdrop-enter"
        : undefined;
  const cardClass = reduced
    ? undefined
    : phase === "exit"
      ? "leaflet-dialog-exit"
      : phase === "enter"
        ? "leaflet-dialog-enter"
        : undefined;
  const animating = phase === "enter" || phase === "exit";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: phase === "exit" ? "none" : "auto",
      }}
    >
      <div
        onClick={onScrimClick}
        className={backdropClass}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.42)",
          // While the keyframe is running, `both` fill-mode owns the
          // opacity. While settled, pin to fully visible so the scrim
          // doesn't blink.
          opacity: animating ? undefined : 1,
          cursor: onScrimClick ? "pointer" : undefined,
        }}
      />
      <div
        className={cardClass}
        style={{
          position: "relative",
          // Cap width so the card doesn't stretch to viewport at large sizes.
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100vh - 32px)",
          display: "flex",
        }}
      >
        {open ? children : lastChildrenRef.current}
      </div>
    </div>
  );
}
