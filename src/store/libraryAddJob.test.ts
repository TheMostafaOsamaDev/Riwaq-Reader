// The cover is the only part of adding a novel that needs the network, so
// it is the only part that is a queue job. Its payload is three strings,
// which is what lets a job reloaded as "interrupted" after an app kill
// resume without refetching anything.
import { beforeEach, describe, expect, it, vi } from "vitest";

let coverCalls: { entryId: string; sourceId: string; coverUrl: string }[] = [];
let coverShouldFail = false;

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 13 },
  exists: async () => false,
  mkdir: async () => {},
  readTextFile: async () => "{}",
  writeTextFile: async () => {},
}));
vi.mock("./legacyRoot", () => ({
  ROOT: "riwaq",
  LEGACY_ROOT: "leaflet",
  migrateLegacyRoot: async () => {},
}));
vi.mock("./sessionExpiry", () => ({
  isSessionExpiredError: () => false,
  notifySessionExpired: async () => {},
  resetSessionExpiredNotices: () => {},
}));
vi.mock("../sources/host", () => ({ createHost: () => ({}) }));
vi.mock("../sources/registry", () => ({ getSource: () => null }));
vi.mock("./sourceLibrary", () => ({
  readSnapshot: async () => null,
  writeChapterContent: async () => {},
  markChapterDownloaded: async () => {},
}));
vi.mock("./library", () => ({
  saveNovelCover: async (
    entryId: string,
    sourceId: string,
    coverUrl: string,
  ) => {
    coverCalls.push({ entryId, sourceId, coverUrl });
    if (coverShouldFail) throw new Error("HTTP 403 for cover");
  },
}));

import {
  activeLibraryAddCount,
  activeLibraryAddJobs,
  clearTerminals,
  enqueue,
  enqueueLibraryAdd,
  getResolvedCounters,
  getState,
  retry,
  setDownloadConcurrency,
  type EnqueueLibraryAddDescriptor,
} from "./downloadQueue";

/** The queue pumps asynchronously; let its microtasks and the dynamic
 *  import inside the worker settle. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

function descriptor(
  overrides: Partial<EnqueueLibraryAddDescriptor> = {},
): EnqueueLibraryAddDescriptor {
  return {
    libraryEntryId: "entry-1",
    novelTitle: "القس المجنون",
    sourceId: "kolnovel",
    novelUrl: "https://kolnovel.test/novel/1",
    coverUrl: "https://kolnovel.test/cover.webp",
    ...overrides,
  };
}

beforeEach(async () => {
  for (const j of getState().jobs) j.status = "cancelled";
  clearTerminals();
  coverCalls = [];
  coverShouldFail = false;
});

describe("library-add jobs", () => {
  it("runs the cover save and lands done", async () => {
    const id = enqueueLibraryAdd(descriptor());
    await settle();
    const job = getState().jobs.find((j) => j.id === id);
    expect(job?.status).toBe("done");
    expect(coverCalls).toEqual([
      {
        entryId: "entry-1",
        sourceId: "kolnovel",
        coverUrl: "https://kolnovel.test/cover.webp",
      },
    ]);
  });

  it("does not queue a second job for the same entry", async () => {
    const a = enqueueLibraryAdd(descriptor());
    const b = enqueueLibraryAdd(descriptor());
    expect(b).toBe(a);
    await settle();
    expect(coverCalls).toHaveLength(1);
  });

  it("queues separately for a different entry", async () => {
    // Force the two jobs to run one after another rather than both
    // starting in the same pump tick. Two library-add jobs racing to the
    // same still-unresolved "./library" specifier trip a real Vitest
    // limitation (vitest-dev/vitest#7040): the second concurrent dynamic
    // import of a module mocked with vi.mock can silently resolve to the
    // real, unmocked module instead of the mock. Concurrency 1 sidesteps
    // that without touching production code, and still proves both
    // entries queue and both covers get fetched.
    setDownloadConcurrency(1);
    try {
      enqueueLibraryAdd(descriptor());
      enqueueLibraryAdd(descriptor({ libraryEntryId: "entry-2" }));
      await settle();
      expect(coverCalls.map((c) => c.entryId).sort()).toEqual([
        "entry-1",
        "entry-2",
      ]);
    } finally {
      setDownloadConcurrency(2); // restore the default so sibling tests
      // in this file aren't left serialized behind this one.
    }
  });

  it("records a failure under its own counter, not the conversion one", async () => {
    const before = getResolvedCounters();
    coverShouldFail = true;
    enqueueLibraryAdd(descriptor());
    await settle();
    const after = getResolvedCounters();
    expect(after.addFailed).toBe(before.addFailed + 1);
    expect(after.cvFailed).toBe(before.cvFailed);
  });

  it("carries everything it needs to resume after a kill", async () => {
    const id = enqueueLibraryAdd(descriptor());
    const job = getState().jobs.find((j) => j.id === id);
    expect(job?.kind).toBe("library-add");
    // No parsed novel, no in-memory handle: three strings and the entry id.
    expect(job).toMatchObject({
      libraryEntryId: "entry-1",
      sourceId: "kolnovel",
      novelUrl: "https://kolnovel.test/novel/1",
      coverUrl: "https://kolnovel.test/cover.webp",
    });
    await settle();
  });

  it("retries a failed cover fetch and completes", async () => {
    coverShouldFail = true;
    const id = enqueueLibraryAdd(descriptor());
    await settle();
    expect(getState().jobs.find((j) => j.id === id)?.status).toBe("error");

    coverShouldFail = false;
    retry(id);
    await settle();
    expect(getState().jobs.find((j) => j.id === id)?.status).toBe("done");
    expect(coverCalls).toHaveLength(2);
  });

  it("retrying a failure does not leave it counted as both failed and done", async () => {
    const before = getResolvedCounters();
    coverShouldFail = true;
    const id = enqueueLibraryAdd(descriptor());
    await settle();
    coverShouldFail = false;
    retry(id);
    await settle();
    const after = getResolvedCounters();
    expect(after.addFailed).toBe(before.addFailed);
    expect(after.addDone).toBe(before.addDone + 1);
  });

  it("counts only queued-or-running adds for the FAB ring", async () => {
    expect(activeLibraryAddCount(getState().jobs)).toBe(0);
    enqueueLibraryAdd(descriptor());
    expect(activeLibraryAddCount(getState().jobs)).toBe(1);
    await settle();
    // Done is not active — the ring must go dark when the cover lands.
    expect(activeLibraryAddCount(getState().jobs)).toBe(0);
  });

  it("does not count chapter jobs as adds", () => {
    // The ring is deliberately not a chapter-download indicator.
    enqueue({
      libraryEntryId: "entry-1",
      chapterId: 7,
      novelTitle: "القس المجنون",
      chapterTitle: "Ch 7",
    });
    expect(activeLibraryAddCount(getState().jobs)).toBe(0);
  });

  it("surfaces the queued-or-running add job itself, not just its count", async () => {
    // The Downloads page's "Adding to library" section renders these rows
    // directly — before this, a library-add job appeared in no active
    // list on that page at all, so this filter existing and returning the
    // job (not just a number) is exactly what closes that gap.
    expect(activeLibraryAddJobs(getState().jobs)).toEqual([]);
    const id = enqueueLibraryAdd(descriptor());
    const active = activeLibraryAddJobs(getState().jobs);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(id);
    expect(active[0].kind).toBe("library-add");
    await settle();
    // Done falls out of the active list — it belongs in Recent instead.
    expect(activeLibraryAddJobs(getState().jobs)).toEqual([]);
  });
});
