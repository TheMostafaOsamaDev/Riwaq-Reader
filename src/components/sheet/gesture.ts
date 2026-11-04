// Who owns a touch on a bottom sheet, and the small DOM reads that decision
// needs.
//
// A touch is decided once, on its first move past the slop, into one of:
//
//  - "sheet": the sheet owns it. It moves, and the caller preventDefaults the
//    touchmove so the browser does not also scroll.
//  - "scroll": a native vertical scroll of the sheet's list. The browser owns
//    it, but the sheet watches a downward one: if the list reaches its top
//    with the finger still pulling, the sheet takes the rest of the pull.
//  - "pass": anything else the browser handles — a sideways swipe, a slider
//    drag, a text selection, a scroll inside an inner list. Never watched.
//
// The rules are the ownership table in
// docs/superpowers/specs/2026-11-04-native-feel-sheets-design.md:
//
//  - Up below full is the sheet's: native sheets expand before their list
//    scrolls.
//  - Down is the sheet's only when the list is already at its top; a
//    scrolled list scrolls back natively, keeping native momentum, at every
//    snap (the Contents panel opens scrolled to the current chapter).
//  - Inner scroll boxes (the font picker) are never the sheet's.

import { canScrollY } from "../../lib/scrollable";
import { gestureAxis } from "../../reader/gestureAxis";

export type Region = "chrome" | "body" | "nested";
export type TargetKind = "plain" | "slider" | "editing";
export type Owner = "sheet" | "scroll" | "pass";

export interface OwnerInput {
  /** chrome = outside the list (grabber, headers, footer); body = the list;
   *  nested = inside a scroll box within the list. */
  region: Region;
  kind: TargetKind;
  /** Movement since touchstart, px. dy positive is downward. */
  dx: number;
  dy: number;
  /** Whether this touchmove can still be cancelled. Once the browser has
   *  started a native scroll it cannot. */
  cancelable: boolean;
  /** Whether the sheet rests at its highest snap. */
  atTopSnap: boolean;
  expandable: boolean;
  bodyScrollTop: number;
  bodyScrollable: boolean;
}

export function decideOwner(i: OwnerInput): Owner {
  if (!i.cancelable) return "pass";
  if (i.kind === "editing") return "pass";
  // The reader's own axis rule, so a sheet and the page under it can never
  // disagree about which way a finger is going.
  if (gestureAxis(i.dx, i.dy) !== "y") return "pass";
  // A slider takes horizontal drags; only a clearly vertical move is the
  // sheet's, so a slightly diagonal slider drag still moves the slider.
  if (i.kind === "slider" && !(Math.abs(i.dy) > 2 * Math.abs(i.dx))) {
    return "pass";
  }
  if (i.region === "nested") return "pass";
  if (i.region === "chrome") return "sheet";
  if (i.dy < 0) {
    if (i.expandable && !i.atTopSnap) return "sheet";
    if (!i.bodyScrollable) return "sheet";
    return "scroll";
  }
  return i.bodyScrollTop <= 0 ? "sheet" : "scroll";
}

/** The sheet's main list: the outermost `[data-sheet-scrollable]` inside the
 *  content (querySelector returns the first in document order, and an
 *  ancestor precedes its descendants), or the content container itself. */
export function findBody(content: HTMLElement): HTMLElement {
  return (
    content.querySelector<HTMLElement>("[data-sheet-scrollable]") ?? content
  );
}

export function classifyTarget(
  target: Element,
  body: HTMLElement,
): { region: Region; kind: TargetKind } {
  return { region: regionOf(target, body), kind: kindOf(target) };
}

function regionOf(target: Element, body: HTMLElement): Region {
  if (!body.contains(target)) return "chrome";
  for (
    let el: Element | null = target;
    el && el !== body;
    el = el.parentElement
  ) {
    if (canScrollY(el)) return "nested";
  }
  return "body";
}

function kindOf(target: Element): TargetKind {
  if (
    target.closest(
      '[data-no-drag], [contenteditable=""], [contenteditable="true"]',
    )
  ) {
    return "editing";
  }
  const field = target.closest("input, textarea");
  if (field && field === document.activeElement && !isRange(field)) {
    return "editing";
  }
  if (target.closest('input[type="range"], [role="slider"]')) return "slider";
  return "plain";
}

function isRange(el: Element): boolean {
  return el instanceof HTMLInputElement && el.type === "range";
}

/** The vertical offset an element is drawn at right now, read from its
 *  computed transform, so a sheet caught mid-animation continues from
 *  exactly where it is. Engines report a matrix; happy-dom echoes the
 *  authored function, so both forms are read. */
export function readTranslateY(el: HTMLElement): number {
  const t = getComputedStyle(el).transform || el.style.transform;
  if (!t || t === "none") return 0;
  const nums = (s: string) =>
    s
      .slice(s.indexOf("(") + 1, s.lastIndexOf(")"))
      .split(",")
      .map((p) => Number.parseFloat(p));
  if (t.startsWith("matrix3d(")) return nums(t)[13] || 0;
  if (t.startsWith("matrix(")) return nums(t)[5] || 0;
  if (t.startsWith("translateY(")) return nums(t)[0] || 0;
  if (t.startsWith("translate(") || t.startsWith("translate3d(")) {
    return nums(t)[1] || 0;
  }
  return 0;
}
