// Carrying a reading position across a DOCX reading-mode switch.
//
// The two modes save position differently — fixed pages as a block anchor
// (`fixedAnchor`), reflow as a chapter plus a paragraph index — so switching
// has to rewrite one into the other. Both sides go through the blockMap that
// flowDoc recorded, which is what makes the switch land on the same
// paragraph rather than merely the same chapter.
//
// Pure on purpose: state in, state patch out. The reader, the file system
// and the DOM stay out of it, so the round trip is testable directly.

import { blockForFlowPosition, flowPositionForBlock } from "./flowPosition";

export type ReadingMode = "pages" | "flow";

/** The parts of a book's saved state a mode switch reads and rewrites. */
export interface ModePosition {
  currentChapter?: number;
  paragraphIndex?: number;
  paragraphOffset?: number;
  fixedAnchor?: { blockId: string; frac: number };
}

/** `data-block-id` form used by DocxPageSource and stored in `fixedAnchor`. */
export function blockIdFor(index: number): string {
  return `b${index}`;
}

/** The index inside a `data-block-id`. Zero for anything unparseable: state
 *  on disk can outlive the format that wrote it, and a NaN here would poison
 *  every downstream clamp and land the reader nowhere at all. */
export function blockIndexOf(blockId: string): number {
  const n = Number.parseInt(blockId.replace(/^b/, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The position fields to persist when switching a DOCX to `to`.
 *
 * Returns only the fields that mode reads, so the other mode's saved
 * position is left untouched on disk — switch away and back without reading
 * anything in between and you return to exactly where you were.
 */
export function positionForMode(
  to: ReadingMode,
  blockMap: number[][],
  pos: ModePosition,
): ModePosition {
  if (to === "flow") {
    const blockIndex = pos.fixedAnchor
      ? blockIndexOf(pos.fixedAnchor.blockId)
      : 0;
    const { chapter, paragraphIndex } = flowPositionForBlock(
      blockMap,
      blockIndex,
    );
    return {
      currentChapter: chapter,
      paragraphIndex,
      paragraphOffset: pos.fixedAnchor?.frac ?? 0,
    };
  }

  const blockIndex = blockForFlowPosition(blockMap, {
    chapter: pos.currentChapter ?? 0,
    paragraphIndex: pos.paragraphIndex ?? 0,
  });
  return {
    fixedAnchor: {
      blockId: blockIdFor(blockIndex),
      frac: pos.paragraphOffset ?? 0,
    },
  };
}
