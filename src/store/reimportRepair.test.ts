// Re-importing a book whose files are gone.
//
// Import dedup matches on the content hash in the library index and then
// trusts it: the staged copy is deleted and the app is pointed at the
// existing entry. If that entry's files are no longer on disk — an
// interrupted delete, a half-finished legacy-root migration, an OS clearing
// app storage — the entry can never be repaired. Re-importing the very same
// file discards the only good copy of it and hands back the broken book
// again, forever, with no user-visible way out.
//
// Re-importing is the natural repair gesture, so it has to work: a match
// whose files are missing is treated as no match, and the dead entry is
// dropped from the index so it stops shadowing every later import of the
// same file.
import { describe, expect, it, vi } from "vitest";

let files: Record<string, Uint8Array | string> = {};
const dirs = new Set<string>();
/** Path whose exists() should throw, standing in for a transient fs fault. */
let failExistsFor: string | null = null;

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (p: string) => {
    if (failExistsFor === p) throw new Error(`EIO ${p}`);
    return p in files || dirs.has(p);
  },
  mkdir: async (p: string) => {
    dirs.add(p);
  },
  readTextFile: async (p: string) => {
    const v = files[p];
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return String(v);
  },
  writeTextFile: async (p: string, data: string) => {
    files[p] = data;
  },
  readFile: async (p: string) => {
    const v = files[p];
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v instanceof Uint8Array ? v : new TextEncoder().encode(String(v));
  },
  writeFile: async (p: string, data: Uint8Array) => {
    files[p] = data;
  },
  remove: async (p: string, opts?: { recursive?: boolean }) => {
    if (opts?.recursive) {
      for (const k of Object.keys(files)) {
        if (k === p || k.startsWith(`${p}/`)) delete files[k];
      }
      for (const d of [...dirs]) {
        if (d === p || d.startsWith(`${p}/`)) dirs.delete(d);
      }
      return;
    }
    if (!(p in files)) throw new Error(`ENOENT ${p}`);
    delete files[p];
  },
  rename: async () => {},
  readDir: async () => [],
  copyFile: async () => {},
  stat: async () => ({ size: 0 }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/app",
  join: async (...p: string[]) => p.join("/"),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
  invoke: async () => null,
}));
vi.mock("./legacyRoot", () => ({ migrateLegacyRoot: async () => {} }));
vi.mock("./coverThumb", () => ({ writeCoverThumb: async () => null }));

/** What the native staging pass reports for the next picked file. */
let staged: { size: number; format: string; hash: string };
let tokens = 0;
/** Set by the one test that needs the repair import itself to fail. */
let parseFails = false;

vi.mock("./nativeStaging", () => ({
  newStagingToken: () => `token-${++tokens}`,
  onStageProgress: async () => () => {},
  stageImportFile: async (_from: string, to: string) => {
    files[to] = "staged bytes";
    return staged;
  },
  renameStaged: async (from: string, to: string) => {
    files[to] = files[from];
    delete files[from];
  },
  deleteStaged: async (p: string) => {
    for (const k of Object.keys(files)) {
      if (k === p || k.startsWith(`${p}/`)) delete files[k];
    }
  },
  writeBytesChunked: async (p: string, bytes: Uint8Array) => {
    files[p] = bytes;
  },
}));

// The EPUB parse: enough of a book for commitEpubAt to write an index entry.
vi.mock("../epub/zipSource", () => ({
  openNativeZip: async () => ({
    extract: async () => [],
    dispose: () => {},
  }),
}));
vi.mock("../epub/parser", () => ({
  parseEpubFromSource: async (_src: unknown, id: string) => {
    if (parseFails) throw new Error("corrupt zip");
    return {
      book: {
        id,
        title: "A book",
        author: "An author",
        language: "en",
        chapters: [{ id: "c1", title: "One", paragraphs: [] }],
      },
      cover: undefined,
      images: [],
    };
  },
}));

// PDF/DOCX come back as drafts for the import dialog rather than importing
// straight away, so the staging half is all this needs.
vi.mock("./fixedImportStage", () => ({
  stageFixedImport: async (
    _source: unknown,
    path: string,
    kind: "pdf" | "docx",
  ) => ({ kind, title: path, author: "", covers: [] }),
}));

import { importPaths, type BookIndexEntry } from "./library";
import { commitDocxBook, commitPdfBook } from "./fixedImport";
import { bookDir, INDEX, STAGING } from "./paths";

const HASH = "a".repeat(64);

function indexEntries(): BookIndexEntry[] {
  return JSON.parse(String(files[INDEX])).books;
}

/** A library entry carrying HASH. Cover fields are set so `listBooks`'
 *  background backfill has nothing to chase. */
function entry(over: Partial<BookIndexEntry> = {}): BookIndexEntry {
  return {
    id: "existing",
    title: "A book",
    author: "An author",
    language: "en",
    chapterCount: 1,
    addedAt: 1,
    progress: 0,
    coverFile: "cover.jpg",
    thumbFile: "thumb.webp",
    sourceHash: HASH,
    ...over,
  };
}

function seed(entries: BookIndexEntry[], onDisk: string[] = []) {
  files = { [INDEX]: JSON.stringify({ version: 1, books: entries }) };
  for (const f of onDisk) files[f] = "{}";
  dirs.clear();
  tokens = 0;
  parseFails = false;
  failExistsFor = null;
  staged = { size: 10, format: "epub", hash: HASH };
}

describe("re-importing a book the index already claims to hold", () => {
  it("reuses the existing book when its files are on disk", async () => {
    seed([entry()], [`${bookDir("existing")}/book.json`]);

    const result = await importPaths(["/picked/book.epub"]);

    expect(result.reused?.map((e) => e.id)).toEqual(["existing"]);
    expect(result.autoImported).toEqual([]);
    expect(indexEntries().map((e) => e.id)).toEqual(["existing"]);
  });

  it("imports the file again when the matched book's files are gone", async () => {
    // Nothing under books/existing/ — the entry is a ghost. Discarding the
    // staged copy here would strand the user with a book that cannot open.
    seed([entry()]);

    const result = await importPaths(["/picked/book.epub"]);

    expect(result.reused ?? []).toEqual([]);
    expect(result.autoImported).toHaveLength(1);
    const imported = result.autoImported[0];
    expect(files[`${bookDir(imported.id)}/book.json`]).toBeDefined();
  });

  it("drops the ghost entry so it can't shadow the repaired book", async () => {
    seed([entry()]);

    const result = await importPaths(["/picked/book.epub"]);

    const ids = indexEntries().map((e) => e.id);
    expect(ids).not.toContain("existing");
    expect(ids).toEqual([result.autoImported[0].id]);
    expect(result.pruned).toEqual(["existing"]);
  });

  it("reports the dropped ghost even when the repair import fails", async () => {
    // The prune is an index write, and on this path there is nothing imported
    // and nothing reused for the library view to refresh on. Unless the run
    // says what it dropped, the ghost's card stays on screen pointing at an
    // entry the index no longer has.
    seed([entry()]);
    parseFails = true;

    const result = await importPaths(["/picked/book.epub"]);

    expect(result.errors).toHaveLength(1);
    expect(result.autoImported).toEqual([]);
    expect(result.pruned).toEqual(["existing"]);
    expect(indexEntries()).toEqual([]);
  });

  it("prunes nothing when a book that reads fine is reused", async () => {
    seed([entry()], [`${bookDir("existing")}/book.json`]);

    const result = await importPaths(["/picked/book.epub"]);

    expect(result.pruned ?? []).toEqual([]);
  });

  it("keeps an entry it cannot check rather than deleting it", async () => {
    // A throwing exists() — a transient Android fs or permission fault — must
    // fail the import, not delete a book whose files may well be there.
    seed([entry()]);
    failExistsFor = `${bookDir("existing")}/book.json`;

    const result = await importPaths(["/picked/book.epub"]);

    expect(result.errors).toHaveLength(1);
    expect(indexEntries().map((e) => e.id)).toEqual(["existing"]);
  });

  it("leaves other books alone when it drops a ghost", async () => {
    seed(
      [entry({ id: "keeper", sourceHash: "b".repeat(64) }), entry()],
      [`${bookDir("keeper")}/book.json`],
    );

    const result = await importPaths(["/picked/book.epub"]);

    // The ghost goes; the unrelated book keeps its entry, hash and all.
    expect(indexEntries().map((e) => e.id)).toEqual([
      "keeper",
      result.autoImported[0].id,
    ]);
    expect(indexEntries()[0].sourceHash).toBe("b".repeat(64));
    expect(files[`${bookDir("keeper")}/book.json`]).toBeDefined();
  });

  it("dedupes the rest of the batch against the repaired book", async () => {
    // The same file twice in one drop, matching a ghost. The second copy has
    // to recognise the book just imported — not the entry that was dropped.
    seed([entry()]);

    const result = await importPaths([
      "/picked/book.epub",
      "/picked/book.epub",
    ]);

    expect(result.autoImported).toHaveLength(1);
    expect(result.reused?.map((e) => e.id)).toEqual([
      result.autoImported[0].id,
    ]);
    expect(indexEntries()).toHaveLength(1);
  });

  it("repairs a PDF whose original file is gone but whose descriptor survives", async () => {
    // Partial loss counts as broken: PdfPageSource renders pages straight
    // out of books/<id>/book.pdf, so the entry cannot open without it even
    // though book.json is still there.
    seed([entry({ id: "pdf-1", kind: "pdf", pageCount: 3 })], [
      `${bookDir("pdf-1")}/book.json`,
    ]);
    staged = { size: 10, format: "pdf", hash: HASH };

    const result = await importPaths(["/picked/book.pdf"]);

    expect(result.reused ?? []).toEqual([]);
    expect(result.drafts).toHaveLength(1);
    expect(indexEntries().map((e) => e.id)).not.toContain("pdf-1");
  });

  it("recognises a PDF written by the real importer", async () => {
    // Pins the two halves together: what commitPdfBook writes has to be what
    // requiredFilesFor asks for. If either side renames a file, this test
    // fails — rather than every re-imported PDF being judged broken and its
    // directory deleted.
    seed([]);
    files[`${STAGING}/pdf-source`] = "pdf bytes";
    const committed = await commitPdfBook({
      title: "A PDF",
      author: "",
      pageCount: 2,
      outline: [],
      sourceHash: HASH,
      stagedPath: `${STAGING}/pdf-source`,
    });
    staged = { size: 10, format: "pdf", hash: HASH };

    const result = await importPaths(["/picked/book.pdf"]);

    expect(result.reused?.map((e) => e.id)).toEqual([committed.id]);
    expect(result.pruned).toEqual([]);
    expect(result.drafts).toEqual([]);
  });

  it("recognises a DOCX written by the real importer", async () => {
    seed([]);
    const committed = await commitDocxBook({
      html: "<p>A paragraph.</p>",
      images: [],
      dir: "ltr",
      title: "A DOCX",
      author: "",
      outline: [],
      sourceHash: HASH,
    });
    staged = { size: 10, format: "docx", hash: HASH };

    const result = await importPaths(["/picked/book.docx"]);

    expect(result.reused?.map((e) => e.id)).toEqual([committed.id]);
    expect(result.pruned).toEqual([]);
    expect(result.drafts).toEqual([]);
  });

  it("reuses a DOCX whose content and descriptor are both on disk", async () => {
    seed([entry({ id: "docx-1", kind: "docx" })], [
      `${bookDir("docx-1")}/book.json`,
      `${bookDir("docx-1")}/content.html`,
    ]);
    staged = { size: 10, format: "docx", hash: HASH };

    const result = await importPaths(["/picked/book.docx"]);

    expect(result.reused?.map((e) => e.id)).toEqual(["docx-1"]);
    expect(result.drafts).toEqual([]);
  });
});
