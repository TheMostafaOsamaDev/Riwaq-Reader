// Sizing a bottom sheet for the container it floats in.
//
// The rules for the box (see physics.ts for what the numbers mean): an
// expandable sheet's box is as tall as the container less the safe-area top,
// so expanding is a transform and never a relayout; a sheet that cannot
// expand is exactly as tall as its default snap; a content-sized one is as
// tall as its content, capped. Every box also reaches OVERDRAW_PX below the
// screen edge, so a rubber-band or spring overshoot past the top never lifts
// its bottom off the screen.
//
// Measured against the container (the sheet's clip window), not the window:
// a sheet raised inside a page that starts below the status bar must not
// reserve the status bar's height a second time.

import { FIT_HEIGHT_CAP, OVERDRAW_PX, type SheetGeometry } from "./physics";

/** How the sheet is sized: to its content, or to a height with or without a
 *  full snap above it. */
export type SheetSizing =
  | { fitContent: true }
  | { fitContent?: false; height: string; expandable: boolean };

const INSET_TOP_FALLBACK = 24;

/** Read `env(safe-area-inset-top)` off a probe element, so the value matches
 *  what the browser actually applies. Inserts a node: callers cache it. */
export function readSafeAreaInsetTop(): number {
  if (typeof document === "undefined") return INSET_TOP_FALLBACK;
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;top:0;left:0;visibility:hidden;height:env(safe-area-inset-top, ${INSET_TOP_FALLBACK}px)`;
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  document.body.removeChild(probe);
  return px > 0 ? px : INSET_TOP_FALLBACK;
}

/** A CSS height (`"82%"`, `"500px"`, `"min(80%, 500px)"`) in pixels of a
 *  container `containerH` tall. */
export function parseHeightPx(height: string, containerH: number): number {
  const trimmed = height.trim();
  if (trimmed.endsWith("%")) {
    const pct = Number.parseFloat(trimmed.slice(0, -1));
    if (Number.isFinite(pct)) return (pct / 100) * containerH;
  }
  if (trimmed.endsWith("px")) {
    const px = Number.parseFloat(trimmed.slice(0, -2));
    if (Number.isFinite(px)) return px;
  }
  // Anything else — `min(70%, 460px)`, `clamp(...)` — is resolved by the
  // browser off a throwaway element: a short form sheet wants "as tall as its
  // content, but never more than N% of the screen", which no single unit can
  // express. Unresolvable falls back to 82% so the sheet still works.
  return measureCssLengthPx(trimmed, containerH) ?? 0.82 * containerH;
}

function measureCssLengthPx(value: string, containerH: number): number | null {
  if (typeof document === "undefined" || !document.body) return null;
  const parent = document.createElement("div");
  parent.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;width:0;";
  parent.style.height = `${containerH}px`;
  const probe = document.createElement("div");
  probe.style.height = value;
  parent.appendChild(probe);
  document.body.appendChild(parent);
  const px = probe.getBoundingClientRect().height;
  document.body.removeChild(parent);
  return Number.isFinite(px) && px > 0 ? px : null;
}

/** Size `box` for `container` and return the sheet's geometry. Writes the
 *  box's height styles — those belong to the engine, never to React. */
export function layOutSheet(
  container: HTMLElement,
  box: HTMLElement,
  safeAreaTop: number,
  sizing: SheetSizing,
): SheetGeometry {
  const viewportH = container.clientHeight || window.innerHeight || 0;
  const containerTop = Math.max(0, container.getBoundingClientRect().top);
  const insetTop = Math.max(0, safeAreaTop - containerTop);
  const full = Math.max(0, viewportH - insetTop);
  if (sizing.fitContent) {
    box.style.height = "auto";
    box.style.maxHeight = `${Math.min(full, Math.round(viewportH * FIT_HEIGHT_CAP)) + OVERDRAW_PX}px`;
    const boxH = Math.max(0, box.offsetHeight - OVERDRAW_PX);
    return {
      viewportH,
      insetTop,
      boxH,
      defaultVisibleH: boxH,
      expandable: false,
    };
  }
  const defaultVisibleH = Math.min(
    full,
    parseHeightPx(sizing.height, viewportH),
  );
  const boxH = sizing.expandable ? full : defaultVisibleH;
  box.style.height = `${boxH + OVERDRAW_PX}px`;
  box.style.maxHeight = "";
  return {
    viewportH,
    insetTop,
    boxH,
    defaultVisibleH,
    expandable: sizing.expandable,
  };
}
