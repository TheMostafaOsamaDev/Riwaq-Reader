// Slide-in/out wrapper for the desktop reader's side panels (TOC,
// Highlights, Settings, Progress). When `open` flips true the panel
// mounts and runs the slide-in keyframe; when it flips false the
// panel stays mounted long enough to slide back out, then unmounts.
//
// `side` mirrors PanelShell's existing prop: "left" panels live on
// the left of the reader column and slide from the left edge.
// "right" panels mirror that on the other side.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MOTION, useReducedMotion } from "../styles/motion";

interface Props {
  open: boolean;
  side: "left" | "right";
  children: ReactNode;
}

type Phase = "enter" | "open" | "exit";

export function AnimatedPanel({ open, side, children }: Props) {
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

  const enterClass =
    side === "left" ? "leaflet-panel-enter-left" : "leaflet-panel-enter-right";
  const exitClass =
    side === "left" ? "leaflet-panel-exit-left" : "leaflet-panel-exit-right";
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
