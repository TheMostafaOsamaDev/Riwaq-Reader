// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { loadLibrarySnapshot, saveLibrarySnapshot } from "./libraryCache";
import type { BookIndexEntry } from "./library";

const KEY = "riwaq:library-cache:v1";
const book = (id: string): BookIndexEntry =>
  ({
    id,
    title: `Book ${id}`,
    author: "A",
    language: "ar",
    chapterCount: 3,
    addedAt: 1,
    progress: 0,
  }) as BookIndexEntry;

afterEach(() => localStorage.removeItem(KEY));

describe("library snapshot", () => {
  it("is nothing on a first launch", () => {
    expect(loadLibrarySnapshot()).toBeNull();
  });

  it("gives back the library it was handed", () => {
    saveLibrarySnapshot({ books: [book("a"), book("b")], covers: { a: "x" } });
    const s = loadLibrarySnapshot();
    expect(s?.books.map((b) => b.id)).toEqual(["a", "b"]);
    expect(s?.covers).toEqual({ a: "x" });
  });

  it("ignores a corrupt or foreign entry rather than drawing garbage", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadLibrarySnapshot()).toBeNull();
    localStorage.setItem(
      KEY,
      JSON.stringify({ books: [{ nope: 1 }], covers: {} }),
    );
    expect(loadLibrarySnapshot()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ books: "x", covers: {} }));
    expect(loadLibrarySnapshot()).toBeNull();
  });

  it("drops itself instead of filling storage with a huge library", () => {
    saveLibrarySnapshot({ books: [book("a")], covers: {} });
    const huge = Array.from({ length: 4000 }, (_, i) => ({
      ...book(String(i)),
      description: "x".repeat(500),
    }));
    saveLibrarySnapshot({ books: huge, covers: {} });
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
