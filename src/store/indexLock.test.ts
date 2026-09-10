import { describe, expect, it } from "vitest";
import { withIndexLock } from "./indexLock";

/** Yield to the microtask/macrotask queue, so an "await" inside a mutation is
 *  a real suspension point the way `readTextFile`/`writeTextFile` are. */
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A stand-in for library.json plus the two halves of every index mutation in
 *  the store: read the whole file, mutate the array, write the whole file
 *  back. The suspension between them is what makes the write lossy. */
function fakeIndex() {
  let file: string[] = [];
  return {
    get books() {
      return file;
    },
    append: (name: string) => async () => {
      const books = [...file];
      await tick();
      books.push(name);
      await tick();
      file = books;
    },
  };
}

describe("withIndexLock", () => {
  it("keeps concurrent mutations from dropping each other's write", async () => {
    // The bug: `listBooks` fires an un-awaited cover backfill that reads,
    // mutates and writes the index while an import's own append is midway
    // through the same three steps. Whichever writes second wins, and the
    // other entry — a book the user just imported — is gone from the index
    // with its files orphaned on disk.
    const idx = fakeIndex();

    await Promise.all([
      withIndexLock(idx.append("imported")),
      withIndexLock(idx.append("backfilled")),
    ]);

    expect(idx.books).toEqual(["imported", "backfilled"]);
  });

  it("runs mutations in the order they were requested", async () => {
    const idx = fakeIndex();

    await Promise.all([
      withIndexLock(idx.append("first")),
      withIndexLock(idx.append("second")),
      withIndexLock(idx.append("third")),
    ]);

    expect(idx.books).toEqual(["first", "second", "third"]);
  });

  it("lets a failed mutation through without wedging the queue", async () => {
    // rescanCover swallows its own errors, but deleteBook and setCoverFromFile
    // don't. One rejection must not strand every later mutation forever.
    const idx = fakeIndex();

    const boom = withIndexLock(async () => {
      throw new Error("index write failed");
    });

    await expect(boom).rejects.toThrow("index write failed");
    await withIndexLock(idx.append("after"));

    expect(idx.books).toEqual(["after"]);
  });

  it("returns the mutation's own value to its caller", async () => {
    // appendIndexEntry returns the entry it wrote; wrapping must not swallow it.
    await expect(withIndexLock(async () => "entry")).resolves.toBe("entry");
  });
});
