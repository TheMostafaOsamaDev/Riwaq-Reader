// Bottom sheet for the mobile reader's menus (TOC, settings, etc.).
// Slides up from the bottom on enter and back down on exit; the
// scrim fades in lock-step. The component owns the mount/leave
// state so callers can pass `open` like a normal boolean — when
// `open` flips false the sheet plays its exit animation and only
// unmounts once that finishes. Children rendered during the exit
// phase are the LAST children seen while open, so the user sees the
// sheet they were just looking at slide off — not an empty container.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MOTION, useReducedMotion } from "../styles/motion";
import type { Theme } from "../styles/tokens";

interface Props {
  theme: Theme;
  /** Controls visibility. Flip to false to dismiss with animation. */
  open: boolean;
  /** Called when the user taps the backdrop. Parents typically flip
   *  `open` to false in response. */
  onClose: () => void;
  children: ReactNode;
  height?: string;
}

type Phase = "enter" | "open" | "exit";

export function MobileSheet({
  theme,
  open,
  onClose,
  children,
  height = "78%",
}: Props) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase | null>(open ? "enter" : null);
  const lastChildrenRef = useRef<ReactNode>(children);
  if (open) lastChildrenRef.current = children;

  useEffect(() => {
    if (open) {
      // Mount/re-mount into the enter phase. The CSS keyframe self-
      // triggers; we just need to promote to "open" so the exit class
      // isn't accidentally still applied.
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
  const backdropClass = reduced
    ? undefined
    : phase === "exit"
      ? "leaflet-backdrop-exit"
      : phase === "enter"
        ? "leaflet-backdrop-enter"
        : undefined;
  const sheetClass = reduced
    ? undefined
    : phase === "exit"
      ? "leaflet-sheet-exit"
      : phase === "enter"
        ? "leaflet-sheet-enter"
        : undefined;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 20 }}>
      <div
        onClick={onClose}
        className={backdropClass}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
          // When the keyframe is running, `both` fill-mode owns the
          // opacity. While settled, no animation is applied — pin to
          // fully visible so the scrim doesn't blink.
          opacity: animating ? undefined : 1,
        }}
      />
      <div
        className={sheetClass}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height,
          background: theme.bg,
          color: theme.ink,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -10px 40px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            paddingTop: 8,
            paddingBottom: 2,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: theme.rule,
            }}
          />
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {open ? children : lastChildrenRef.current}
        </div>
      </div>
    </div>
  );
}
