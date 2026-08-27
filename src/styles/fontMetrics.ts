// Runtime glyph-size measurement for the reader's font picker.
//
// The same `font-size` renders at wildly different apparent sizes across the
// reading fonts — at 100px, Lateef's Arabic ink is ~72% the height of Readex
// Pro's, Tajawal's ~77%, Cairo's ~89%. Left alone, switching font silently
// changes how big the book reads, and the size slider stops meaning anything.
//
// We measure instead of shipping a lookup table because two of the six stacks
// don't resolve to a fixed face: "Serif" and "Dyslexic" name fonts that aren't
// self-hosted, so they land on Literata/Iowan/Georgia on one OS and fall all
// the way through to Readex Pro on another. A hardcoded correction would be
// wrong on whichever platform it wasn't calibrated for; measuring the face the
// browser ACTUALLY resolved is right everywhere.
//
// The chrome solves the same problem with `font-size-adjust` (see
// UI_FONT_ADJUST), but that normalizes on x-height — a Latin metric. Arabic
// naskh faces like Lateef carry a large x-height relative to their body
// glyphs, so x-height normalization under-corrects them badly. Hence a
// per-script sample measured off the real face.

import { FONT_READING_SANS } from "./tokens";

/** Script-representative samples. Both are classic type-specimen strings that
 *  mix ascenders, descenders and body glyphs, because what a reader perceives
 *  as "how big this font is" in a paragraph is the ink extent of running text,
 *  not any single metric. A body-only sample (no ascenders/descenders) was
 *  tried first and under-corrected Tajawal badly — its body glyphs sit tall
 *  relative to the rest of the face, so it scored as needing 1.07 when running
 *  text needs ~1.27. */
const SAMPLES = {
  latin: "Handgloves",
  // The abjad letter-order mnemonic — covers alef, the descending jim/za,
  // and the flat body letters in one short string.
  arabic: "أبجد هوز حطي",
} as const;

export type MetricScript = keyof typeof SAMPLES;

/** Guard rails: a pathological or mis-measured face can't blow up the reading
 *  column. Wide enough to cover the real spread (Lateef needs ~1.39 on Arabic,
 *  ~1.55 on Latin) without letting a bad measurement through. */
export const FONT_SCALE_MIN = 0.8;
export const FONT_SCALE_MAX = 1.75;

let ctx: CanvasRenderingContext2D | null | undefined;

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    ctx = document.createElement("canvas").getContext("2d");
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Ink height of `sample` set in `stack` at 100px, or 0 when unmeasurable. */
function inkHeight(
  c: CanvasRenderingContext2D,
  stack: string,
  sample: string,
): number {
  c.font = `100px ${stack}`;
  const m = c.measureText(sample);
  const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  return Number.isFinite(h) && h > 0 ? h : 0;
}

/** The font shorthand + text to hand `document.fonts.load()` so the faces a
 *  stack needs are resolved BEFORE measuring — measure too early and the
 *  browser reports the fallback face's metrics, not the one that will paint. */
export function loadSpecFor(
  stack: string,
  script: MetricScript,
): [string, string] {
  return [`100px ${stack}`, SAMPLES[script]];
}

/** Multiplier that brings `stack` to the same apparent size as Readex Pro —
 *  the face the reader's size slider is calibrated against, so "17px" reads
 *  the same whichever font is chosen. Returns 1 when measurement isn't
 *  available (no canvas, zero-height sample), which is the pre-existing
 *  unnormalized behaviour rather than a broken layout. */
export function measureFontScale(stack: string, script: MetricScript): number {
  const c = context();
  if (!c) return 1;
  const sample = SAMPLES[script];
  const base = inkHeight(c, FONT_READING_SANS, sample);
  const own = inkHeight(c, stack, sample);
  if (base <= 0 || own <= 0) return 1;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, base / own));
}
