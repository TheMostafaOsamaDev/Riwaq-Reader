// @vitest-environment happy-dom
//
// The toolbar is built from a snapshot taken on `pointerup`, which is
// what keeps it alive after a swatch click throws the selection away.
// But a snapshot cannot see a selection still being dragged, and an
// early pointerup — the first of a double-click, or a click preceding a
// drag — captures a single word.
//
// Measured on a real chapter, through the app's own diagnostics log:
//
//   t=1     first[1099..1155]   56px, one word   -> toolbar at 887
//   t=1107  first[44..1256]     the paragraph    -> toolbar at 988
//
// That second line is the jump the reader saw. The live selection is
// what closes the gap, so these pin when it is trusted and when it is
// not.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveSelectionBox } from "./selectionAnchor";

function mount(html: string) {
  document.body.innerHTML = `<div data-book-body>${html}</div>`;
}

/** happy-dom lays nothing out, so a Range reports no client rects. Real
 *  browsers always give one box per line for a non-collapsed range; this
 *  supplies that so the test exercises the guards, not the layout. */
function withLineBoxes(rects: Partial<DOMRect>[]) {
  vi.spyOn(Range.prototype, "getClientRects").mockReturnValue({
    length: rects.length,
    item: (i: number) => rects[i] as DOMRect,
    [Symbol.iterator]: function* () {
      for (const r of rects) yield r as DOMRect;
    },
  } as unknown as DOMRectList);
}

function select(node: Node, start: number, end: number) {
  const r = document.createRange();
  r.setStart(node, start);
  r.setEnd(node, end);
  const s = window.getSelection();
  s?.removeAllRanges();
  s?.addRange(r);
}

describe("liveSelectionBox", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports nothing when there is no selection", () => {
    mount(`<p data-p-index="0">The quick brown fox</p>`);
    expect(liveSelectionBox()).toBeNull();
  });

  it("reports nothing for a collapsed selection", () => {
    mount(`<p data-p-index="0">The quick brown fox</p>`);
    const text = document.querySelector("p")?.firstChild as Node;
    select(text, 4, 4);
    expect(liveSelectionBox()).toBeNull();
  });

  it("reports a box for a live selection inside the reading column", () => {
    mount(`<p data-p-index="0">The quick brown fox</p>`);
    const text = document.querySelector("p")?.firstChild as Node;
    select(text, 4, 9);
    withLineBoxes([
      { top: 300, bottom: 336, left: 44, right: 1256, width: 1212, height: 36 },
    ]);
    const box = liveSelectionBox();
    expect(box).not.toBeNull();
    expect(box?.firstLine).toEqual({ left: 44, right: 1256 });
    expect(box?.dir).toBe("ltr");
  });

  it("ignores a selection outside the reading column", () => {
    // A selection in the sidebar, a dialog, or the settings page must
    // not drag the reader's toolbar across the screen.
    document.body.innerHTML =
      `<div data-book-body><p data-p-index="0">chapter text</p></div>` +
      `<aside><p id="outside">unrelated text</p></aside>`;
    const outside = document.getElementById("outside")?.firstChild as Node;
    select(outside, 0, 9);
    withLineBoxes([
      { top: 10, bottom: 30, left: 0, right: 200, width: 200, height: 20 },
    ]);
    // Rects exist, so only the reading-column guard can reject this.
    expect(liveSelectionBox()).toBeNull();
  });
});
