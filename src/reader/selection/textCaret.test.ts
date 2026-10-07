import { describe, expect, it } from "vitest";
import {
  type Box,
  caretOnLine,
  paragraphAt,
  pointInside,
  snapOffset,
  wordAround,
} from "./textCaret";

/** A list of boxes as paragraphAt asks for them: a count and a getter. */
const lazy = (boxes: Box[]) => [boxes.length, (i: number) => boxes[i]] as const;

// Three paragraphs as the phone lays them out: 27px lines, 19px of margin
// between paragraphs (BookBody's 1.1em at 17px).
const box = (top: number, bottom: number) => ({
  top,
  bottom,
  left: 20,
  right: 380,
});
const PARAS = [box(100, 181), box(200, 254), box(273, 381)];

describe("paragraphAt", () => {
  it("is the paragraph a point is inside", () => {
    expect(paragraphAt(...lazy(PARAS), 150)).toBe(0);
    expect(paragraphAt(...lazy(PARAS), 200)).toBe(1);
    expect(paragraphAt(...lazy(PARAS), 300)).toBe(2);
  });

  // The bug: a finger just past a paragraph's last line resolved to the
  // NEXT paragraph's first word. Within the first half of the gap it belongs
  // to the paragraph it just left.
  it("keeps a point in the upper half of a gap with the paragraph above", () => {
    expect(paragraphAt(...lazy(PARAS), 182)).toBe(0);
    expect(paragraphAt(...lazy(PARAS), 190)).toBe(0);
  });

  it("hands the lower half of a gap to the paragraph below", () => {
    expect(paragraphAt(...lazy(PARAS), 192)).toBe(1);
    expect(paragraphAt(...lazy(PARAS), 199)).toBe(1);
  });

  it("clamps above the first and below the last", () => {
    expect(paragraphAt(...lazy(PARAS), -500)).toBe(0);
    expect(paragraphAt(...lazy(PARAS), 5000)).toBe(2);
  });

  it("has nothing to say about no paragraphs", () => {
    expect(paragraphAt(...lazy([]), 10)).toBe(-1);
  });

  it("agrees with a linear scan across a long chapter", () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      box(i * 100, i * 100 + 80),
    );
    const linear = (y: number) => {
      let best = 0;
      let bestD = Number.POSITIVE_INFINITY;
      many.forEach((b, i) => {
        const d = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    };
    for (let y = -50; y < 30_100; y += 7) {
      expect(paragraphAt(...lazy(many), y)).toBe(linear(y));
    }
  });
});

describe("pointInside", () => {
  it("moves a point outside the box onto its edge, one pixel in", () => {
    expect(pointInside(box(100, 181), 500, 300)).toEqual({ x: 379, y: 180 });
    expect(pointInside(box(100, 181), -5, 50)).toEqual({ x: 21, y: 101 });
  });

  it("leaves a point already inside alone", () => {
    expect(pointInside(box(100, 181), 200, 150)).toEqual({ x: 200, y: 150 });
  });
});

describe("word snapping", () => {
  const text = "إلامَ تحدقين؟ انطلقي واقتليهم!";

  it("finds the word around an offset, diacritics included", () => {
    expect(text.slice(...wordAround(text, 2))).toBe("إلامَ");
    expect(text.slice(...wordAround(text, 8))).toBe("تحدقين");
  });

  it("snaps the end edge out to the end of the word it lands in", () => {
    const mid = text.indexOf("انطلقي") + 2;
    expect(text.slice(0, snapOffset(text, mid, "end"))).toBe(
      "إلامَ تحدقين؟ انطلقي",
    );
  });

  it("snaps the start edge back to the start of its word", () => {
    const mid = text.indexOf("واقتليهم") + 3;
    expect(text.slice(snapOffset(text, mid, "start"))).toBe("واقتليهم!");
  });

  it("leaves an offset on a boundary where it is", () => {
    const afterQ = text.indexOf("؟") + 1;
    expect(snapOffset(text, afterQ, "end")).toBe(afterQ);
    expect(snapOffset(text, 0, "start")).toBe(0);
    expect(snapOffset(text, text.length, "end")).toBe(text.length);
  });
});

describe("caretOnLine", () => {
  const line = { top: 200, bottom: 232, left: 40, right: 380 };

  it("trusts a caret that is on the line", () => {
    const caret = { x: 120, top: 200, height: 32 };
    expect(caretOnLine(caret, line, "end", "rtl")).toBe(caret);
  });

  // The reported bug: at a soft wrap the end caret reports the NEXT line, a
  // line below the selection, which is where the toolbar opens.
  it("puts an end caret that wrapped to the next line back on this line's end", () => {
    const wrapped = { x: 380, top: 236, height: 32 };
    expect(caretOnLine(wrapped, line, "end", "rtl")).toEqual({
      x: 40,
      top: 200,
      height: 32,
    });
    expect(caretOnLine(wrapped, line, "end", "ltr")).toEqual({
      x: 380,
      top: 200,
      height: 32,
    });
  });

  it("puts a start caret left on the previous line at this line's start", () => {
    const early = { x: 40, top: 164, height: 32 };
    expect(caretOnLine(early, line, "start", "rtl").x).toBe(380);
    expect(caretOnLine(early, line, "start", "ltr").x).toBe(40);
  });

  it("falls back to the line when there is no caret at all", () => {
    const none = { x: 0, top: Number.NaN, height: 0 };
    expect(caretOnLine(none, line, "end", "rtl")).toEqual({
      x: 40,
      top: 200,
      height: 32,
    });
  });
});
