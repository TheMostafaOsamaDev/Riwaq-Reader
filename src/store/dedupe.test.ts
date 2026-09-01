import { describe, expect, it } from "vitest";
import { findByHash } from "./dedupe";

describe("findByHash", () => {
  const HASH = "a".repeat(64);

  it("finds the book carrying the hash", () => {
    const id = findByHash(
      [{ id: "one", sourceHash: "b".repeat(64) }, { id: "two", sourceHash: HASH }],
      HASH,
    );
    expect(id).toBe("two");
  });

  it("returns null when nothing matches", () => {
    expect(findByHash([{ id: "one", sourceHash: "b".repeat(64) }], HASH))
      .toBeNull();
  });

  it("skips entries that predate hashing", () => {
    // Books imported before this feature carry no hash. They must never
    // match — including not matching each other — so an old library keeps
    // importing normally instead of silently reusing the wrong book.
    expect(findByHash([{ id: "old" }, { id: "older" }], HASH)).toBeNull();
  });

  it("never matches an empty or missing hash", () => {
    // A staging failure that produced "" must not collide with every
    // hash-less entry in the library.
    expect(findByHash([{ id: "old" }], "")).toBeNull();
    expect(findByHash([{ id: "one", sourceHash: "" }], "")).toBeNull();
  });

  it("returns the first match when a duplicate slipped in earlier", () => {
    const id = findByHash(
      [{ id: "first", sourceHash: HASH }, { id: "second", sourceHash: HASH }],
      HASH,
    );
    expect(id).toBe("first");
  });
});
