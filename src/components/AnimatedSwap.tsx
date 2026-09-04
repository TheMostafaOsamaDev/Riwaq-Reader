// Cross-fade swap for top-level view changes. Wraps the App's
// Library / Reader / Stream views and runs the
// `.riwaq-view-enter` + `.riwaq-view-exit` keyframes when `viewKey`
// changes. Both layers stay mounted simultaneously for the duration of
// the longer animation so the user sees the new view rising over the
// old one rather than a blank-frame snap.
//
// The component intentionally does NOT memoise children — when
// `viewKey` is stable but child props change (e.g., chapter advance
// inside the Reader), the active slot's content is updated in place
// so re-renders pass through normally.

import { useEffect, useState, type ReactNode } from "react";
import { MOTION, useReducedMotion } from "../styles/motion";

interface SwapSlot {
  /** Stable identifier — when this changes vs. the active slot's key,
   *  the swap animation kicks off. */
  key: string;
  /** What to render. Re-assigned in place if `key` is unchanged. */
  content: ReactNode;
  /** Drives which `.riwaq-view-*` class is on the layer. */
  phase: "enter" | "exit" | "idle";
}

interface Props {
  viewKey: string;
  children: ReactNode;
}

export function AnimatedSwap({ viewKey, children }: Props) {
  const reduced = useReducedMotion();
  const [slots, setSlots] = useState<SwapSlot[]>(() => [
    { key: viewKey, content: children, phase: "idle" },
  ]);

  // Detect viewKey transitions and content updates. We update slots
  // imperatively here rather than deriving from props so that an exit
  // animation can keep running on the previous content while the new
  // content mounts above it.
  useEffect(() => {
    setSlots((prev) => {
      const active = prev.find((s) => s.phase !== "exit");
      if (active && active.key === viewKey) {
        // Same view, just thread the latest children through so prop
        // changes propagate (e.g., chapter change inside the Reader).
        return prev.map((s) =>
          s.phase !== "exit" && s.key === viewKey
            ? { ...s, content: children }
            : s,
        );
      }
      // viewKey changed → exit the active slot, mount a new entering one.
      return [
        ...prev
          .filter((s) => s.phase !== "exit")
          .map((s) => ({ ...s, phase: "exit" as const })),
        { key: viewKey, content: children, phase: "enter" as const },
      ];
    });
  }, [viewKey, children]);

  // Once enough time has passed for both keyframes to finish, drop the
  // exiting slots and promote the entering one to idle. Use MOTION.med
  // because the view-enter keyframe in global.css runs 240ms — wait at
  // least that long before stripping the class, or the animation will
  // be cut short.
  useEffect(() => {
    const animating = slots.some((s) => s.phase !== "idle");
    if (!animating) return;
    const t = setTimeout(
      () => {
        setSlots((prev) =>
          prev
            .filter((s) => s.phase !== "exit")
            .map((s) =>
              s.phase === "enter" ? { ...s, phase: "idle" as const } : s,
            ),
        );
      },
      reduced ? 0 : MOTION.med,
    );
    return () => clearTimeout(t);
  }, [slots, reduced]);

  return (
    <>
      {slots.map((s) => (
        <div
          key={s.key}
          className={
            reduced
              ? undefined
              : s.phase === "enter"
                ? "riwaq-view-enter"
                : s.phase === "exit"
                  ? "riwaq-view-exit"
                  : undefined
          }
          // Slot is a flex column so children that use `flex: 1` to fill
          // their parent (Library shelf, NovelDetailView, Store) lay out
          // correctly inside an absolute-positioned slot.
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {s.content}
        </div>
      ))}
    </>
  );
}
