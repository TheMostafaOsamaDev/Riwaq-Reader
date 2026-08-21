import { describe, it, expect } from "vitest";
import {
  buildDefaultShelves,
  isDuplicateName,
  appendShelf,
  renameInList,
  removeFromList,
  normalizeShelfIds,
  isOnShelf,
  toggleMembership,
  removeMembership,
  wouldOrphan,
  booksOnShelf,
  type Shelf,
} from "./shelfLogic";

const shelf = (id: string, name: string, order = 0): Shelf => ({
  id,
  name,
  createdAt: 0,
  order,
});

describe("buildDefaultShelves", () => {
  it("assigns injected ids, shared timestamp, and incremental order", () => {
    let n = 0;
    const out = buildDefaultShelves(["Favorites", "To read"], () => `id${n++}`, 5);
    expect(out).toEqual([
      { id: "id0", name: "Favorites", createdAt: 5, order: 0 },
      { id: "id1", name: "To read", createdAt: 5, order: 1 },
    ]);
  });
});

describe("isDuplicateName", () => {
  const list = [shelf("a", "Favorites"), shelf("b", "Summer")];
  it("is case-insensitive and trims", () => {
    expect(isDuplicateName(list, "  favorites ")).toBe(true);
  });
  it("ignores the shelf being renamed", () => {
    expect(isDuplicateName(list, "Favorites", "a")).toBe(false);
  });
  it("returns false for a new unique name", () => {
    expect(isDuplicateName(list, "Winter")).toBe(false);
  });
});

describe("list mutations", () => {
  const list = [shelf("a", "A"), shelf("b", "B")];
  it("appends", () => {
    expect(appendShelf(list, shelf("c", "C")).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
  it("renames (trimmed) without touching others", () => {
    expect(renameInList(list, "a", "  New ")).toEqual([shelf("a", "New"), shelf("b", "B")]);
  });
  it("removes", () => {
    expect(removeFromList(list, "a").map((s) => s.id)).toEqual(["b"]);
  });
});

describe("membership", () => {
  it("normalizeShelfIds dedupes and handles undefined", () => {
    expect(normalizeShelfIds(undefined)).toEqual([]);
    expect(normalizeShelfIds(["x", "x", "y"])).toEqual(["x", "y"]);
  });
  it("isOnShelf", () => {
    expect(isOnShelf(["x", "y"], "y")).toBe(true);
    expect(isOnShelf(undefined, "y")).toBe(false);
  });
  it("toggleMembership adds then removes", () => {
    expect(toggleMembership(["x"], "y")).toEqual(["x", "y"]);
    expect(toggleMembership(["x", "y"], "y")).toEqual(["x"]);
  });
  it("removeMembership", () => {
    expect(removeMembership(["x", "y"], "y")).toEqual(["x"]);
  });
  it("wouldOrphan is true only when removing the last shelf", () => {
    expect(wouldOrphan(["x"], "x")).toBe(true);
    expect(wouldOrphan(["x", "y"], "x")).toBe(false);
    expect(wouldOrphan(undefined, "x")).toBe(true);
  });
});

describe("booksOnShelf", () => {
  it("filters by membership", () => {
    const books = [
      { id: "1", shelfIds: ["a"] },
      { id: "2", shelfIds: ["b"] },
      { id: "3" },
    ];
    expect(booksOnShelf(books, "a").map((b) => b.id)).toEqual(["1"]);
  });
});
