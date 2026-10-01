import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetBackgroundImportForTests,
  configureBackgroundImport,
  dismissBackgroundImport,
  enqueueImport,
  getView,
  isBackgroundImportBusy,
  onLibraryChanged,
  type BackgroundImportDeps,
  type BackgroundImportResult,
} from "./backgroundImport";
import {
  __resetImportLockForTests,
  acquireImportLock,
  dismiss as resetProgress,
  isImportBusy,
} from "./importProgress";
import type { BookIndexEntry, ImportReporter, StagedPick } from "./library";
import type { FixedImportDraft } from "./fixedImportStage";

const book = (id: string, title = id) =>
  ({ id, title }) as unknown as BookIndexEntry;

const pick = (p: Partial<StagedPick> = {}): StagedPick => ({
  autoImported: [],
  drafts: [],
  errors: [],
  reused: [],
  pruned: [],
  ...p,
});

function draft(
  path: string,
  title: string,
  opts: { cover?: string | null; fail?: boolean } = {},
) {
  const d = {
    filename: path,
    title,
    defaultCoverId: opts.cover === undefined ? "c1" : opts.cover,
    commit: vi.fn(async () => {
      if (opts.fail) throw new Error("disk full");
      return book(`id-${title}`, title);
    }),
    dispose: vi.fn(),
  };
  return d as unknown as FixedImportDraft & typeof d;
}

/** Resolve every promise the queue has chained so far. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** importPaths that resolves only when the test says so. */
function gated() {
  const calls: { paths: string[]; resolve: (p: StagedPick) => void }[] = [];
  const importPaths = vi.fn(
    (paths: string[], _r: ImportReporter) =>
      new Promise<StagedPick>((resolve) => calls.push({ paths, resolve })),
  );
  return { calls, importPaths };
}

let nav: object;
let run: {
  finish: ReturnType<typeof vi.fn<() => void>>;
  fail: ReturnType<typeof vi.fn<(message: string) => void>>;
};

function setup(over: Partial<BackgroundImportDeps> = {}) {
  run = { finish: vi.fn<() => void>(), fail: vi.fn<(m: string) => void>() };
  const deps: BackgroundImportDeps = {
    importPaths: vi.fn(async () => pick()),
    startRun: () => ({
      reporter: {
        file: vi.fn(),
        phase: vi.fn(),
        progress: vi.fn(),
        parseProgress: vi.fn(),
      },
      ...run,
    }),
    open: vi.fn(),
    navToken: () => nav,
    ...over,
  };
  configureBackgroundImport(deps);
  return deps;
}

function lastResult(): BackgroundImportResult {
  const v = getView();
  if (v.kind !== "result") throw new Error(`expected a result, got ${v.kind}`);
  return v.result;
}

let libraryChanged: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  __resetBackgroundImportForTests();
  resetProgress();
  __resetImportLockForTests();
  nav = {};
  libraryChanged = vi.fn<() => void>();
  onLibraryChanged(libraryChanged);
});
afterEach(() => __resetBackgroundImportForTests());

describe("background import", () => {
  it("opens a single book when the user has not moved since it arrived", async () => {
    const deps = setup({
      importPaths: vi.fn(async () => pick({ autoImported: [book("b1")] })),
    });
    enqueueImport(["/a.epub"]);
    await flush();
    expect(deps.open).toHaveBeenCalledWith("b1");
    expect(lastResult()).toMatchObject({ opened: "b1", failed: [] });
    // Opening unmounts the Library; a refresh now would be thrown away.
    expect(libraryChanged).not.toHaveBeenCalled();
    expect(run.finish).toHaveBeenCalled();
  });

  it("does not hijack the user who navigated while it imported", async () => {
    const { calls, importPaths } = gated();
    const deps = setup({ importPaths });
    enqueueImport(["/a.epub"]);
    await flush();
    nav = {}; // the user opened something else meanwhile
    calls[0].resolve(pick({ autoImported: [book("b1")] }));
    await flush();
    expect(deps.open).not.toHaveBeenCalled();
    expect(lastResult()).toMatchObject({ opened: null, added: [{ id: "b1" }] });
    // Staying put, so a mounted Library must re-read.
    expect(libraryChanged).toHaveBeenCalledTimes(1);
  });

  it("commits a PDF/DOCX with the dialog's defaults, then opens it", async () => {
    const d = draft("content://x/report.pdf", "Report");
    const deps = setup({
      importPaths: vi.fn(async () => pick({ drafts: [d] })),
    });
    enqueueImport(["content://x/report.pdf"]);
    await flush();
    expect(d.commit).toHaveBeenCalledWith({
      title: "Report",
      cover: { kind: "candidate", id: "c1" },
    });
    expect(d.dispose).toHaveBeenCalled();
    expect(deps.open).toHaveBeenCalledWith("id-Report");
  });

  it("commits a draft with no usable cover as cover-less", async () => {
    const d = draft("/n.docx", "Notes", { cover: null });
    setup({ importPaths: vi.fn(async () => pick({ drafts: [d] })) });
    enqueueImport(["/n.docx"]);
    await flush();
    expect(d.commit).toHaveBeenCalledWith({
      title: "Notes",
      cover: { kind: "none" },
    });
  });

  it("reports a failed commit with its path, and still disposes it", async () => {
    const d = draft("/bad.pdf", "Bad", { fail: true });
    const deps = setup({
      importPaths: vi.fn(async () => pick({ drafts: [d] })),
    });
    enqueueImport(["/bad.pdf"]);
    await flush();
    expect(d.dispose).toHaveBeenCalled();
    expect(lastResult().failed).toEqual([
      { name: "Bad", message: "disk full", path: "/bad.pdf", retryable: true },
    ]);
    expect(deps.open).not.toHaveBeenCalled();
    expect(run.fail).toHaveBeenCalledWith("disk full");
  });

  it("keeps the reader closed when anything failed, even with one success", async () => {
    const deps = setup({
      importPaths: vi.fn(async () =>
        pick({
          autoImported: [book("good")],
          errors: [
            {
              message: "nope",
              path: "/broken.epub",
              name: "Broken",
              retryable: false,
            },
          ],
        }),
      ),
    });
    enqueueImport(["/good.epub", "/broken.epub"]);
    await flush();
    expect(deps.open).not.toHaveBeenCalled();
    expect(lastResult().failed).toEqual([
      {
        name: "Broken",
        message: "nope",
        path: "/broken.epub",
        retryable: false,
      },
    ]);
    // Something did land, so the run itself is not a failure.
    expect(run.finish).toHaveBeenCalled();
    expect(run.fail).not.toHaveBeenCalled();
  });

  it("opens the existing copy of a book the library already has", async () => {
    const deps = setup({
      importPaths: vi.fn(async () => pick({ reused: [book("old")] })),
    });
    enqueueImport(["/again.epub"]);
    await flush();
    expect(deps.open).toHaveBeenCalledWith("old");
    expect(lastResult()).toMatchObject({ added: [], reused: [{ id: "old" }] });
  });

  it("never opens one of several books", async () => {
    const deps = setup({
      importPaths: vi.fn(async () =>
        pick({ autoImported: [book("a"), book("b")] }),
      ),
    });
    enqueueImport(["/a.epub", "/b.epub"]);
    await flush();
    expect(deps.open).not.toHaveBeenCalled();
  });

  it("drops a second delivery of a file that is already importing", async () => {
    const { calls, importPaths } = gated();
    setup({ importPaths });
    enqueueImport(["/a.epub"]);
    await flush();
    enqueueImport(["/a.epub"]); // same open, delivered again
    calls[0].resolve(pick({ autoImported: [book("a")] }));
    await flush();
    expect(importPaths).toHaveBeenCalledTimes(1);
  });

  it("imports the same file again once the first run is over", async () => {
    const importPaths = vi.fn(async () => pick({ reused: [book("a")] }));
    setup({ importPaths });
    enqueueImport(["/a.epub"]);
    await flush();
    enqueueImport(["/a.epub"]); // a deliberate second "Open with"
    await flush();
    expect(importPaths).toHaveBeenCalledTimes(2);
  });

  it("runs batches one at a time, in arrival order", async () => {
    const { calls, importPaths } = gated();
    setup({ importPaths });
    enqueueImport(["/1.epub"]);
    await flush();
    enqueueImport(["/2.epub"]);
    await flush();
    expect(calls.map((c) => c.paths)).toEqual([["/1.epub"]]);
    expect(getView()).toMatchObject({ kind: "working", waiting: 1 });

    calls[0].resolve(pick({ autoImported: [book("1")] }));
    await flush();
    expect(calls.map((c) => c.paths)).toEqual([["/1.epub"], ["/2.epub"]]);
  });

  it("waits for another run's import lock, then runs", async () => {
    const importPaths = vi.fn(async () => pick({ autoImported: [book("a")] }));
    setup({ importPaths });
    const release = acquireImportLock(); // the Library's picker is open
    enqueueImport(["/a.epub"]);
    await flush();
    expect(importPaths).not.toHaveBeenCalled();
    expect(getView()).toEqual({ kind: "queued", files: 1 });
    expect(isBackgroundImportBusy()).toBe(true);

    release?.();
    await flush();
    expect(importPaths).toHaveBeenCalledTimes(1);
    expect(isBackgroundImportBusy()).toBe(false);
  });

  it("holds the lock for its run, and gives it back after", async () => {
    const { calls, importPaths } = gated();
    setup({ importPaths });
    enqueueImport(["/a.epub"]);
    await flush();
    // Running: nobody else may start (the Library's guard, the Sources
    // importer's guard).
    expect(isImportBusy()).toBe(true);
    expect(acquireImportLock()).toBeNull();
    calls[0].resolve(pick({ autoImported: [book("a")] }));
    await flush();
    // The fake run never touches the progress store, so the lock was all
    // that held it.
    expect(isImportBusy()).toBe(false);
  });

  it("holds files that arrive before the app wires it up", async () => {
    enqueueImport(["/early.epub"]);
    await flush();
    const deps = setup({
      importPaths: vi.fn(async () => pick({ autoImported: [book("e")] })),
    });
    await flush();
    expect(deps.importPaths).toHaveBeenCalledWith(
      ["/early.epub"],
      expect.anything(),
    );
  });

  it("survives the pipeline throwing, and keeps the queue moving", async () => {
    let n = 0;
    const importPaths = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("bridge died");
      return pick({ autoImported: [book("next")] });
    });
    const deps = setup({ importPaths });
    enqueueImport(["/1.epub"]);
    enqueueImport(["/2.epub"]);
    await flush();
    expect(importPaths).toHaveBeenCalledTimes(2);
    expect(run.fail).toHaveBeenCalledWith("bridge died");
    // The second batch still ran, and its book opened.
    expect(deps.open).toHaveBeenCalledWith("next");
  });

  it("makes every file of a crashed run retryable", async () => {
    setup({
      importPaths: vi.fn(async () => {
        throw new Error("bridge died");
      }),
    });
    enqueueImport(["/dir/one.epub"]);
    await flush();
    expect(lastResult().failed).toEqual([
      {
        name: "one.epub",
        message: "bridge died",
        path: "/dir/one.epub",
        retryable: true,
      },
    ]);
  });

  it("tells a mounted Library nothing when nothing changed", async () => {
    setup({
      importPaths: vi.fn(async () =>
        pick({
          errors: [{ path: "/x", name: "x", message: "no", retryable: true }],
        }),
      ),
    });
    enqueueImport(["/x.epub"]);
    await flush();
    expect(libraryChanged).not.toHaveBeenCalled();
  });

  it("ignores a dismiss aimed at an older result", async () => {
    setup({
      importPaths: vi.fn(async () => pick({ autoImported: [book("a")] })),
    });
    enqueueImport(["/a.epub"]);
    await flush();
    const first = getView();
    if (first.kind !== "result") throw new Error("no result");
    enqueueImport(["/b.epub"]);
    await flush();
    dismissBackgroundImport(first.seq); // stale timer from the first toast
    expect(getView().kind).toBe("result");
    const second = getView();
    if (second.kind !== "result") throw new Error("no result");
    dismissBackgroundImport(second.seq);
    expect(getView().kind).toBe("idle");
  });
});
