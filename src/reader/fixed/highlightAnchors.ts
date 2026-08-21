// Pure helpers behind fixed-layout (PDF/DOCX) highlighting. Kept framework-free
// and DOM-free so they're unit-testable. (DOM-coupled helpers — DOCX selection
// resolution and mark injection — live in docxHighlight.ts.)

import type { NormRect } from "../../store/library";

/** A rectangle in page pixels at some scale. */
export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Page-px rect → 0..1 fractions of the page box. */
export function normalizeRect(r: PxRect, pageW: number, pageH: number): NormRect {
  return { x: r.x / pageW, y: r.y / pageH, w: r.w / pageW, h: r.h / pageH };
}

/** 0..1 fractions → page-px rect at the given display size. */
export function denormalizeRect(n: NormRect, pageW: number, pageH: number): PxRect {
  return { x: n.x * pageW, y: n.y * pageH, w: n.w * pageW, h: n.h * pageH };
}
