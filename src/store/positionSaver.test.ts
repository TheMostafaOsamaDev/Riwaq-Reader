import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPositionSaver } from "./positionSaver";

type Write = [
  bookId: string,
  paragraph: number,
  offset: number,
  progress?: number,
];

function saver() {
  const writes: Write[] = [];
  const s = createPositionSaver(async (w) => {
    writes.push(
      w.progress === undefined
        ? [w.bookId, w.paragraph, w.offset]
        : [w.bookId, w.paragraph, w.offset, w.progress],
    );
  }, 600);
  return { s, writes };
}

/** schedule() in the tests' shorthand. */
const at = (
  bookId: string,
  paragraph: number,
  offset: number,
  progress?: number,
) => ({
  bookId,
  paragraph,
  offset,
  progress,
});

describe("createPositionSaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes the latest position once scrolling has been quiet for the delay", () => {
    const { s, writes } = saver();
    s.schedule(at("b", 10, 0.1));
    s.schedule(at("b", 11, 0.2));
    s.schedule(at("b", 12, 0.3));
    vi.advanceTimersByTime(599);
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(writes).toEqual([["b", 12, 0.3]]);
  });

  it("flush writes a pending position immediately, and only once", () => {
    // Backing out of the book, or Android backgrounding the app, inside the
    // debounce used to drop the position: the reader was gone by the time
    // the timer fired. Measured: leaving 150, 400 and 700ms after a scroll
    // all came back at the old position.
    const { s, writes } = saver();
    s.schedule(at("b", 41, 0.5));
    s.flush();
    expect(writes).toEqual([["b", 41, 0.5]]);
    vi.advanceTimersByTime(5000);
    expect(writes).toHaveLength(1);
  });

  it("flush with nothing pending writes nothing", () => {
    const { s, writes } = saver();
    s.flush();
    expect(writes).toEqual([]);
  });

  it("cancel drops a pending position", () => {
    // A chapter change: the pending position belongs to the chapter being
    // left, and the chapter change itself resets the saved paragraph.
    const { s, writes } = saver();
    s.schedule(at("b", 80, 0.9));
    s.cancel();
    vi.advanceTimersByTime(5000);
    s.flush();
    expect(writes).toEqual([]);
  });

  it("writes the previous book's position before taking another book's", () => {
    const { s, writes } = saver();
    s.schedule(at("a", 5, 0.5));
    s.schedule(at("b", 7, 0.25));
    expect(writes).toEqual([["a", 5, 0.5]]);
    vi.advanceTimersByTime(600);
    expect(writes).toEqual([
      ["a", 5, 0.5],
      ["b", 7, 0.25],
    ]);
  });

  it("writes a position again after cancel, because something else rewrote it", () => {
    // cancel() is called by a chapter change and a highlight jump, both of
    // which write paragraph 0 themselves. Jump to the same highlight twice and
    // the reader reports the same spot twice, and the second one has to land.
    const { s, writes } = saver();
    s.schedule(at("b", 9, 0));
    s.flush();
    s.cancel();
    s.schedule(at("b", 9, 0));
    s.flush();
    expect(writes).toEqual([
      ["b", 9, 0],
      ["b", 9, 0],
    ]);
  });

  it("writes the book's progress along with the position", () => {
    // The library card shows this number; it has to be the one the reader's
    // own bar showed when the reader left.
    const { s, writes } = saver();
    s.schedule(at("b", 12, 0.5, 0.453));
    s.flush();
    expect(writes).toEqual([["b", 12, 0.5, 0.453]]);
  });

  it("does not rewrite a position that is already on disk", () => {
    const { s, writes } = saver();
    s.schedule(at("b", 3, 0.5));
    s.flush();
    s.schedule(at("b", 3, 0.5));
    s.flush();
    expect(writes).toHaveLength(1);
  });
});
