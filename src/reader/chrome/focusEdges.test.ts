import { describe, expect, it } from "vitest";
import { CHROME_EDGE_PX, chromeEdges } from "./focusEdges";

// An 800px-tall reader.
const H = 800;

describe("chromeEdges", () => {
  it("summons the top bar near the top of the reading surface", () => {
    expect(chromeEdges(10, H, false)).toEqual({ top: true, bottom: false });
  });

  it("summons the bottom bar near the bottom of the reading surface", () => {
    expect(chromeEdges(H - 10, H, false)).toEqual({ top: false, bottom: true });
  });

  it("summons nothing from the middle of the page", () => {
    expect(chromeEdges(400, H, false)).toEqual({ top: false, bottom: false });
  });

  it("summons nothing from the top of a docked panel", () => {
    // The bug: a docked Contents panel puts its own header — close button and
    // search field — inside the top band. Reaching for that ✕ slid the reader's
    // top bar out over it, so the control moved out from under the pointer.
    expect(chromeEdges(10, H, true)).toEqual({ top: false, bottom: false });
  });

  it("summons nothing from the bottom of a docked panel either", () => {
    // Same reasoning at the other edge: the scrubber would slide up over the
    // last rows of the chapter list.
    expect(chromeEdges(H - 10, H, true)).toEqual({ top: false, bottom: false });
  });

  it("treats the edge distance as inclusive", () => {
    expect(chromeEdges(CHROME_EDGE_PX, H, false).top).toBe(true);
    expect(chromeEdges(CHROME_EDGE_PX + 1, H, false).top).toBe(false);
  });

  it("still reads the reading surface while a panel is docked elsewhere", () => {
    // `overDockedPanel` is about where the POINTER is, not whether a panel
    // happens to be open — the reading column keeps its own reveal.
    expect(chromeEdges(10, H, false)).toEqual({ top: true, bottom: false });
  });
});
