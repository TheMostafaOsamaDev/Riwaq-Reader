// Slide-in/out wrapper for the desktop reader's side panels (TOC,
// Highlights, Settings, Progress). When `open` flips true the panel
// mounts and runs the slide-in keyframe; when it flips false the
// panel stays mounted long enough to slide back out, then unmounts.
//
// `side` mirrors PanelShell's existing prop and is a LOGICAL position:
// "left" panels live on the reader column's leading edge in LTR — but
// under RTL the chrome's flex row mirrors (Task 6), so a "left" panel
// physically renders on the right, and the slide-in keyframe is chosen
// to match wherever it actually lands (see `physicalSide` below), not
// the static prop.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/useI18n";
import { MOTION, useReducedMotion } from "../styles/motion";

interface Props {
  open: boolean;
  side: "left" | "right";
  children: ReactNode;
}

type Phase = "enter" | "open" | "exit";

export function AnimatedPanel({ open, side, children }: Props) {
  const { dir } = useI18n();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase | null>(open ? "enter" : null);
  // Remember the last children seen while open so the user sees the
  // panel they were interacting with slide off-screen, not a freshly
  // emptied frame.
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

  // The chrome root's flex row mirrors under RTL (Task 6), so a panel
  // declared side="left" can end up resting on the physical right edge
  // (and vice versa). The slide keyframes in global.css are physical —
  // translateX(±100%) — so pick the keyframe by where the panel actually
  // lands on screen, not by the static `side` prop, or it would sweep in
  // from the wrong edge, across the reading column.
  const physicalSide =
    dir === "rtl" ? (side === "left" ? "right" : "left") : side;
  const enterClass = `riwaq-panel-enter-${physicalSide}`;
  const exitClass = `riwaq-panel-exit-${physicalSide}`;
  const cls = reduced
    ? undefined
    : phase === "enter"
      ? enterClass
      : phase === "exit"
        ? exitClass
        : undefined;

  return (
    <div className={cls} style={{ display: "flex", flexShrink: 0 }}>
      {open ? children : lastChildrenRef.current}
    </div>
  );
}
