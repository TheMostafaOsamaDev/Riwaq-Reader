// Full-screen surface wrapper with layout-aware entry. On mobile, the panel
// slides up from the bottom (same translateY keyframe as MobileSheet). On
// desktop it cross-fades in as a centered modal with a scrim. Same phase
// machine as MobileSheet/AnimatedDialog.
//
// Used for surfaces that occupy a whole "page" rather than a card —
// SettingsSheet and DownloadQueueView are the two consumers today. The
// component each one renders is responsible only for its own internal layout
// (header + body); the scrim, centering, and animation are owned here.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MOTION, useReducedMotion } from "../styles/motion";

interface Props {
  open: boolean;
  layout: "mobile" | "desktop";
  /** Optional scrim-click handler — only meaningful on desktop, where a
   *  scrim is rendered. Mobile sheets are full-bleed, so dismissal flows
   *  through the surface's own back/close affordance. */
  onScrimClick?: () => void;
  children: ReactNode;
  zIndex?: number;
}

type Phase = "enter" | "open" | "exit";

export function AnimatedFullScreen({
  open,
  layout,
  onScrimClick,
  children,
  zIndex = 150,
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

  const animating = phase === "enter" || phase === "exit";

  if (layout === "mobile") {
    // Mobile: full-viewport panel sliding up from the bottom. No scrim —
    // the panel is opaque and covers everything beneath, so the reader's
    // existing translate keyframe is the right primitive.
    const sheetClass = reduced
      ? undefined
      : phase === "exit"
        ? "riwaq-sheet-exit"
        : phase === "enter"
          ? "riwaq-sheet-enter"
          : undefined;
    return (
      <div
        className={sheetClass}
        style={{
          position: "fixed",
          inset: 0,
          zIndex,
          // The sheet content provides its own background; the wrapper
          // stays transparent so the slide-down on exit doesn't leave a
          // stray colored rectangle.
          pointerEvents: phase === "exit" ? "none" : "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {open ? children : lastChildrenRef.current}
      </div>
    );
  }

  // Desktop: centered modal with scrim, fade + scale.
  const backdropClass = reduced
    ? undefined
    : phase === "exit"
      ? "riwaq-backdrop-exit"
      : phase === "enter"
        ? "riwaq-backdrop-enter"
        : undefined;
  const cardClass = reduced
    ? undefined
    : phase === "exit"
      ? "riwaq-fullscreen-exit"
      : phase === "enter"
        ? "riwaq-fullscreen-enter"
        : undefined;
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
          opacity: animating ? undefined : 1,
          cursor: onScrimClick ? "pointer" : undefined,
        }}
      />
      <div
        className={cardClass}
        style={{
          position: "relative",
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
