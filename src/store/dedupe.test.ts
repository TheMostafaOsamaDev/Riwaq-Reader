import { describe, expect, it } from "vitest";
import { findByHash, requiredFilesFor } from "./dedupe";

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

describe("requiredFilesFor", () => {
  it("names the parsed book for an EPUB", () => {
    // The chapters live in book.json. book.epub is kept only for re-scanning
    // covers and in-flow images, so a book missing it still opens.
    expect(requiredFilesFor({ id: "e1" })).toEqual([
      "riwaq/books/e1/book.json",
    ]);
  });

  it("gives an explicit epub kind the same answer as an absent one", () => {
    // Older entries don't carry the field at all; both mean the same book.
    expect(requiredFilesFor({ id: "e2", kind: "epub" })).toEqual([
      "riwaq/books/e2/book.json",
    ]);
  });

  it("names the original PDF as well as the descriptor", () => {
    // PdfPageSource renders every page straight out of book.pdf at read time.
    expect(requiredFilesFor({ id: "p1", kind: "pdf" })).toEqual([
      "riwaq/books/p1/book.json",
      "riwaq/books/p1/book.pdf",
    ]);
  });

  it("names the converted HTML for a DOCX", () => {
    // A DOCX is paginated from content.html; the .docx itself is not kept.
    expect(requiredFilesFor({ id: "d1", kind: "docx" })).toEqual([
      "riwaq/books/d1/book.json",
      "riwaq/books/d1/content.html",
    ]);
  });

  it("names the snapshot for a source bookmark", () => {
    // Source entries have no book.json at all — the chapter list lives in
    // source.json and the text stays on the site.
    expect(requiredFilesFor({ id: "s1", kind: "source" })).toEqual([
      "riwaq/books/s1/source.json",
    ]);
  });
});
