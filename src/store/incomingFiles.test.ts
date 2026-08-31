import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasIncoming,
  onIncoming,
  pushIncoming,
  takeIncoming,
} from "./incomingFiles";

describe("incomingFiles", () => {
  beforeEach(() => {
    // Drain any residue so each test starts empty — the store is
    // module-scoped and shared across tests in this file.
    takeIncoming();
  });

  it("holds paths pushed before anyone is listening", () => {
    // The whole point: a file double-clicked at cold start arrives before
    // the Library has mounted. Losing it would lose the feature.
    pushIncoming(["/a.epub"]);
    expect(hasIncoming()).toBe(true);
    expect(takeIncoming()).toEqual(["/a.epub"]);
  });

  it("drains exactly once", () => {
    pushIncoming(["/a.epub"]);
    expect(takeIncoming()).toEqual(["/a.epub"]);
    expect(takeIncoming()).toEqual([]);
    expect(hasIncoming()).toBe(false);
  });

  it("accumulates across pushes until drained", () => {
    pushIncoming(["/a.epub"]);
    pushIncoming(["/b.pdf", "/c.docx"]);
    expect(takeIncoming()).toEqual(["/a.epub", "/b.pdf", "/c.docx"]);
  });

  it("notifies subscribers on push", () => {
    const fn = vi.fn();
    const off = onIncoming(fn);
    pushIncoming(["/a.epub"]);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    pushIncoming(["/b.pdf"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ignores an empty push", () => {
    // Rust drains its queue unconditionally and can legitimately return
    // nothing; that must not wake every subscriber for no reason.
    const fn = vi.fn();
    const off = onIncoming(fn);
    pushIncoming([]);
    expect(fn).not.toHaveBeenCalled();
    expect(hasIncoming()).toBe(false);
    off();
  });

  it("keeps one subscriber's throw from starving the others", () => {
    const good = vi.fn();
    const offBad = onIncoming(() => {
      throw new Error("boom");
    });
    const offGood = onIncoming(good);
    pushIncoming(["/a.epub"]);
    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });
});
