// Carrying a reading position across a DOCX mode switch. Pure: the state
// shape in, the state patch out, so the round trip is testable without a
// reader, a file system or a browser.
import { describe, expect, it } from "vitest";
import { blockIdFor, blockIndexOf, positionForMode } from "./modeSwitch";

// chapter 0: blocks 0,1,1,2   chapter 1: blocks 4,6
const MAP = [
  [0, 1, 1, 2],
  [4, 6],
];

describe("blockIndexOf / blockIdFor", () => {
  it("round-trips a block id", () => {
    expect(blockIndexOf(blockIdFor(12))).toBe(12);
    expect(blockIdFor(0)).toBe("b0");
  });

  it("reads 0 from a malformed id rather than NaN", () => {
    // A NaN here would poison every downstream clamp and land the reader
    // nowhere; state on disk can predate any id format we use today.
    expect(blockIndexOf("")).toBe(0);
    expect(blockIndexOf("nonsense")).toBe(0);
  });
});

describe("positionForMode: pages -> flow", () => {
  it("translates the fixed anchor into a chapter and paragraph", () => {
    const got = positionForMode("flow", MAP, {
      fixedAnchor: { blockId: "b4", frac: 0.25 },
    });
    expect(got).toEqual({
      currentChapter: 1,
      paragraphIndex: 0,
      paragraphOffset: 0.25,
    });
  });

  it("keeps the intra-block fraction as the paragraph offset", () => {
    const got = positionForMode("flow", MAP, {
      fixedAnchor: { blockId: "b2", frac: 0.8 },
    });
    expect(got.paragraphOffset).toBe(0.8);
  });

  it("starts at the beginning when there is no anchor yet", () => {
    const got = positionForMode("flow", MAP, {});
    expect(got).toEqual({
      currentChapter: 0,
      paragraphIndex: 0,
      paragraphOffset: 0,
    });
  });
});

describe("positionForMode: flow -> pages", () => {
  it("translates the chapter and paragraph into a fixed anchor", () => {
    const got = positionForMode("pages", MAP, {
      currentChapter: 1,
      paragraphIndex: 1,
      paragraphOffset: 0.5,
    });
    expect(got).toEqual({ fixedAnchor: { blockId: "b6", frac: 0.5 } });
  });

  it("defaults a missing offset to the top of the block", () => {
    const got = positionForMode("pages", MAP, {
      currentChapter: 0,
      paragraphIndex: 0,
    });
    expect(got).toEqual({ fixedAnchor: { blockId: "b0", frac: 0 } });
  });
});

describe("positionForMode: round trip", () => {
  // The user-facing requirement: switch away and back, land where you were.
  it("returns a position to itself through both conversions", () => {
    const start = {
      currentChapter: 1,
      paragraphIndex: 1,
      paragraphOffset: 0.4,
    };
    const toPages = positionForMode("pages", MAP, start);
    const backToFlow = positionForMode("flow", MAP, toPages);
    expect(backToFlow).toEqual(start);
  });

  it("returns a fixed anchor to itself through both conversions", () => {
    const start = { fixedAnchor: { blockId: "b4", frac: 0.75 } };
    const toFlow = positionForMode("flow", MAP, start);
    const backToPages = positionForMode("pages", MAP, toFlow);
    expect(backToPages).toEqual(start);
  });
});
