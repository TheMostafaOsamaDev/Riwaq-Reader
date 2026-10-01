// Making a DOCX highlight visible in both reading modes.
//
// The two modes anchor a highlight differently: pages mode stores a block id
// plus a character range inside that block, flowing text stores a chapter, a
// paragraph index and a range inside that paragraph. Each reader renders —
// and jumps — only from its own anchor, so a highlight made in one mode was
// invisible in the other, and tapping it in the panel did nothing at all
// because the jump read a field the other mode never wrote.
//
// Both anchors describe the same place, and blockMap already knows how to
// translate between them, so a highlight can simply carry both. Filling the
// missing side is idempotent: a highlight that already has both is returned
// untouched, and one with neither is left alone rather than invented.
//
// Character offsets are carried across as-is. Within a block that produced a
// single paragraph they agree; where one block produced several paragraphs
// (a list) the highlight lands on that block's first paragraph, which is the
// documented limit of a block-level coordinate — the highlight stays visible
// and on the right passage rather than disappearing.

import type { Highlight } from "../store/library";
import { blockForFlowPosition, flowPositionForBlock } from "./flowPosition";
import { blockIdFor, blockIndexOf } from "./modeSwitch";

/**
 * Return `highlights` with both anchors populated wherever one can be derived
 * from the other. PDF anchors are passed through untouched — a page plus
 * rectangles means nothing in this coordinate system.
 */
export function bridgeDocxHighlights(
  highlights: Highlight[],
  blockMap: number[][],
): Highlight[] {
  if (blockMap.length === 0) return highlights;
  return highlights.map((h) => {
    if (h.fixed?.fmt === "pdf") return h;

    // Made in pages mode: derive the chapter/paragraph the flow reader needs.
    if (h.fixed?.fmt === "docx") {
      const hasFlow = h.charEnd > h.charStart;
      if (hasFlow) return h;
      const { chapter, paragraphIndex } = flowPositionForBlock(
        blockMap,
        blockIndexOf(h.fixed.blockId),
      );
      return {
        ...h,
        chapter,
        paragraphIndex,
        charStart: h.fixed.charStart,
        charEnd: h.fixed.charEnd,
      };
    }

    // Made in flowing text: derive the block anchor the fixed reader needs.
    if (h.charEnd > h.charStart) {
      const blockIndex = blockForFlowPosition(blockMap, {
        chapter: h.chapter,
        paragraphIndex: h.paragraphIndex,
      });
      return {
        ...h,
        fixed: {
          fmt: "docx",
          blockId: blockIdFor(blockIndex),
          charStart: h.charStart,
          charEnd: h.charEnd,
        },
      };
    }

    return h;
  });
}
