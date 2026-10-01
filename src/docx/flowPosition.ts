// Converting a reading position between the two DOCX reading modes.
//
// Fixed pages anchor to a top-level block index (`data-block-id="b{N}"`,
// see reader/fixed/DocxPageSource.ts); reflow anchors to a chapter plus an
// item index. Both count block-level content in document order, but not
// one-for-one, so every conversion here is a lookup in the blockMap that
// flowDoc recorded — never arithmetic over indices.
//
// Nothing throws and nothing resets to the start: a position that cannot be
// matched exactly resolves to the nearest preceding one, because landing a
// few lines early is a rounding error and landing at chapter 0 is losing
// someone's place in a book.

export interface FlowPosition {
  chapter: number;
  paragraphIndex: number;
}

const ORIGIN: FlowPosition = { chapter: 0, paragraphIndex: 0 };

/** Fixed-page anchor -> flow position.
 *
 *  When one block produced several items (a list), this returns the FIRST —
 *  the top of the thing the reader was looking at. When a block produced no
 *  item at all (an empty spacer paragraph), it returns the nearest preceding
 *  item rather than nothing. */
export function flowPositionForBlock(
  blockMap: number[][],
  blockIndex: number,
): FlowPosition {
  let best: FlowPosition | null = null;

  for (let chapter = 0; chapter < blockMap.length; chapter++) {
    const blocks = blockMap[chapter];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      // First item of this block wins; later ones are the same block.
      if (b === blockIndex) return { chapter, paragraphIndex: i };
      // Document order is monotonic, so anything at or before the target is
      // a candidate and the last such candidate is the nearest preceding.
      if (b < blockIndex) best = { chapter, paragraphIndex: i };
      // Past the target: monotonic order means nothing better follows.
      else if (b > blockIndex) return best ?? ORIGIN;
    }
  }

  return best ?? ORIGIN;
}

/** Flow position -> fixed-page anchor. Out-of-range input clamps into the
 *  document rather than throwing: state on disk can outlive the content it
 *  described (a re-import, a repaired book). */
export function blockForFlowPosition(
  blockMap: number[][],
  pos: FlowPosition,
): number {
  if (blockMap.length === 0) return 0;
  const chapter = clamp(pos.chapter, 0, blockMap.length - 1);
  const blocks = blockMap[chapter];
  if (blocks.length === 0) return 0;
  return blocks[clamp(pos.paragraphIndex, 0, blocks.length - 1)];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
