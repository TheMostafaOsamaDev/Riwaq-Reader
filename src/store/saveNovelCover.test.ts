// saveNovelCover: fetch a source novel's cover, store it, derive its
// thumbnail, and point the index entry at both.
//
// This used to have no real coverage at all. libraryAddJob.test.ts mocks
// `./library` wholesale, so its `saveNovelCover` assertions only prove the
// queue calls a function with the right arguments — the function it calls
// is a stub that records them and returns. None of the actual filesystem
// writes, extension derivation, or index patching in the real
// implementation ever ran under test. This file exercises the real thing,
// mocking only the Tauri plugins underneath it (same approach as
// coverLifecycle.test.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

let files: Record<string, Uint8Array | string> = {};
const dirs = new Set<string>();

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (p: string) => p in files || dirs.has(p),
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
  remove: async (p: string) => {
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

// `saveNovelCover` reaches the network through `createHost(sourceId)
// .fetchBytes(url)`, loaded via a dynamic import so the queue doesn't pay
// for the sources registry on every startup. `fetchBytesMock` is
// reconfigured per test (resolve with bytes, or reject) the same way
// libraryAddJob.test.ts's `coverShouldFail` flag drives its stub.
let fetchBytesMock: (url: string) => Promise<Uint8Array>;
vi.mock("../sources/host", () => ({
  createHost: (_sourceId: string) => ({
    fetchBytes: (url: string) => fetchBytesMock(url),
  }),
}));

import { saveNovelCover, type BookIndexEntry } from "./library";
import { bookDir, INDEX } from "./paths";

const ID = "novel-1";
const SOURCE_ID = "kolnovel";

/** Seed the index with one source-backed entry for ID, as it looks right
 *  after `addNovelToLibrary` and before its cover job has run. */
function seed(overrides: Partial<BookIndexEntry> = {}) {
  const books: BookIndexEntry[] = [
    {
      id: ID,
      title: "A novel",
      author: "",
      language: "ar",
      chapterCount: 10,
      addedAt: 1,
      progress: 0,
      kind: "source",
      sourceId: SOURCE_ID,
      novelUrl: "https://kolnovel.test/novel/1",
      ...overrides,
    } as BookIndexEntry,
  ];
  files = { [INDEX]: JSON.stringify({ version: 1, books }) };
  dirs.clear();
}

/** The book has already been removed (or was never added) by the time the
 *  queued job gets to run — the preflight bail's exact scenario. */
function seedEmpty() {
  files = { [INDEX]: JSON.stringify({ version: 1, books: [] }) };
  dirs.clear();
}

function readIndexBooks(): BookIndexEntry[] {
  return JSON.parse(String(files[INDEX])).books;
}

beforeEach(() => {
  fetchBytesMock = async () => new Uint8Array([1, 2, 3]);
});

describe("saveNovelCover", () => {
  it("writes the fetched bytes to cover.<ext>, derived from the URL", async () => {
    seed();
    const bytes = new Uint8Array([9, 8, 7, 6]);
    fetchBytesMock = async () => bytes;

    await saveNovelCover(
      ID,
      SOURCE_ID,
      "https://kolnovel.test/covers/art.png?w=200",
    );

    expect(files[`${bookDir(ID)}/cover.png`]).toEqual(bytes);
  });

  it("patches coverFile and bumps coverBust on the index entry", async () => {
    seed();
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    try {
      await saveNovelCover(ID, SOURCE_ID, "https://kolnovel.test/cover.jpg");
    } finally {
      vi.useRealTimers();
    }

    const [book] = readIndexBooks();
    expect(book.coverFile).toBe("cover.jpg");
    // coverBust exists specifically so a cover re-fetched to the same
    // filename (e.g. Retry after a failed attempt) isn't served stale from
    // the webview's asset cache — coverSrcFor keys the <img> src off it.
    // Asserting the exact stamp (not just "is defined") is what would
    // actually fail if that line were ever dropped from the implementation.
    expect(book.coverBust).toBe(1_700_000_000_000);
  });

  it("does not write a thumbFile when the environment can't encode one", async () => {
    // happy-dom has neither createImageBitmap nor OffscreenCanvas, so
    // encodeThumb() legitimately returns null here. Asserting thumbFile is
    // absent (rather than skipping the question) documents that this test
    // environment cannot exercise the thumbnail path — it is not a claim
    // that thumbnailing is broken.
    seed();
    await saveNovelCover(ID, SOURCE_ID, "https://kolnovel.test/cover.jpg");
    const [book] = readIndexBooks();
    expect(book.thumbFile).toBeUndefined();
  });

  it("bails before fetching when the entry is no longer in the index", async () => {
    seedEmpty();
    let called = false;
    fetchBytesMock = async () => {
      called = true;
      return new Uint8Array([1]);
    };

    await saveNovelCover(ID, SOURCE_ID, "https://kolnovel.test/cover.jpg");

    expect(called).toBe(false);
    expect(files[`${bookDir(ID)}/cover.jpg`]).toBeUndefined();
  });

  it("propagates a failed fetch so the queue can mark the job errored", async () => {
    seed();
    fetchBytesMock = async () => {
      throw new Error("HTTP 403 for cover");
    };

    await expect(
      saveNovelCover(ID, SOURCE_ID, "https://kolnovel.test/cover.jpg"),
    ).rejects.toThrow("HTTP 403 for cover");

    // Nothing should have been written on a failed fetch.
    expect(files[`${bookDir(ID)}/cover.jpg`]).toBeUndefined();
  });
});
