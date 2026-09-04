// A small circular progress indicator, in `currentColor` so it takes on
// whatever surface it's dropped into (a filled primary button, the mobile
// FAB, a toolbar).
//
// Two modes:
//   indeterminate (no `value`) — a rotating arc, for work whose length we
//     can't predict yet.
//   determinate (`value` 0..1) — a filled ring, for work Rust reports real
//     progress on. Preferred whenever we have a ratio: a 200 MB import takes
//     long enough that a spinner with no end in sight reads as a hang.
//
// Reduced motion is honoured: the rotation stops, and the arc parks at a
// fixed angle. The determinate ring still updates, because that's
// information rather than decoration.

import { useEffect } from "react";
import { useReducedMotion } from "../styles/motion";

interface Props {
  /** Diameter in px. Stroke scales with it. */
  size?: number;
  /** 0..1 for a determinate ring; omit for the indeterminate arc. */
  value?: number;
  /** Ring thickness. Defaults to a size-proportional value. */
  strokeWidth?: number;
  /** Opacity of the unfilled track. 0 hides it. */
  trackOpacity?: number;
}

export function Spinner({
  size = 14,
  value,
  strokeWidth,
  trackOpacity = 0.25,
}: Props) {
  const reduced = useReducedMotion();
  useSpinKeyframes();

  const sw = strokeWidth ?? Math.max(1.5, size / 8);
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const determinate = typeof value === "number";
  const clamped = determinate ? Math.min(1, Math.max(0, value)) : 0;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      // -90deg so a determinate ring fills from 12 o'clock.
      style={{
        transform: "rotate(-90deg)",
        flexShrink: 0,
        ...(determinate || reduced
          ? {}
          : { animation: "riwaq-spin 1000ms linear infinite" }),
      }}
      aria-hidden
      focusable="false"
    >
      {trackOpacity > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={sw}
          opacity={trackOpacity}
        />
      )}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={determinate ? c : `${c * 0.28} ${c}`}
        strokeDashoffset={determinate ? c * (1 - clamped) : 0}
        style={
          determinate
            ? {
                transition: reduced
                  ? "none"
                  : "stroke-dashoffset 300ms cubic-bezier(0.22, 1, 0.36, 1)",
              }
            : undefined
        }
      />
    </svg>
  );
}

// Injected once, the same way ImportProgress handles its own keyframes —
// a component effect rather than a module-level side effect so hot reload
// doesn't stack duplicate <style> tags.
let injected = false;

function useSpinKeyframes() {
  useEffect(() => {
    if (injected) return;
    injected = true;
    const style = document.createElement("style");
    style.dataset.riwaqSpinner = "true";
    style.textContent =
      "@keyframes riwaq-spin { from { transform: rotate(-90deg); } to { transform: rotate(270deg); } }";
    document.head.appendChild(style);
  }, []);
}
