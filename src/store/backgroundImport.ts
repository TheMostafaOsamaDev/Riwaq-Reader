// Imports for books handed to Riwaq from outside: "Open with" from a file
// manager, the Android share sheet, a drag-and-drop.
//
// Why this lives here and not in the Library. The Library unmounts whenever
// the reader or Settings is on screen, which is exactly when a book tends to
// arrive (the app comes to the front mid-chapter). The import used to run
// inside it, so a file opened while reading waited, unimported, until the
// user happened to go back to the library — and an import the user walked
// away from mid-run lost its title/cover dialog, leaked its staged copy, and
// could still yank them into the reader minutes later from a component that
// was no longer on screen. A module outlives every screen, so the run here
// finishes no matter where the user goes.
//
// What a background import does differently from the import button:
//
//   * No dialog. A PDF/DOCX commits with the title and cover the dialog would
//     have prefilled; the result toast offers "Edit details" for changing
//     them afterwards. Asking first would block the very screen the user was
//     on, for a question with a good default answer.
//   * It opens the book only if the user has not moved since the file
//     arrived. A file opened from outside means "read this", but a user who
//     has since opened something else, or gone to Settings, has told us what
//     they want to look at now. They get a toast with "Open" instead.
//   * One batch at a time, in arrival order, and never alongside any other
//     import run: they all drive the one shared progress store (the FAB ring,
//     the Android notification), so they take turns through its lock (see
//     acquireImportLock in ./importProgress).
//
// The incoming-files buffer (./incomingFiles) stays the hand-off point. This
// module drains it; the producers (useIncomingFiles, useFileDrop) did not
// change.

import { useSyncExternalStore } from "react";
import {
  acquireImportLock,
  isImportBusy,
  subscribe as subscribeProgress,
} from "./importProgress";
import type { BookIndexEntry, ImportReporter, StagedPick } from "./library";
import { draftDefaultCover } from "./draftDefaults";

// ── public state ──────────────────────────────────────────────────────────

export interface BackgroundImportResult {
  /** Books this run created, in arrival order. */
  added: { id: string; title: string }[];
  /** Books the library already held; nothing was imported for these. */
  reused: { id: string; title: string }[];
  /** Files that did not make it in. `retryable` is false when trying again
   *  cannot help — the file is not a book at all. */
  failed: { name: string; message: string; path: string; retryable: boolean }[];
  /** The book the run opened in the reader, if it opened one. */
  opened: string | null;
}

export type BackgroundImportView =
  | { kind: "idle" }
  /** Files are waiting for another import run to finish first. */
  | { kind: "queued"; files: number }
  | {
      kind: "working";
      /** The file being read, once the pipeline has resolved its name. */
      name: string;
      /** 0-based position within this run, and the run's size. */
      index: number;
      total: number;
      /** Files queued behind this run. */
      waiting: number;
      /** The user hid the toast. The run carries on; its result shows. */
      hidden: boolean;
    }
  | {
      kind: "result";
      /** Bumps per result, so the toast restarts its timer on a new one. */
      seq: number;
      result: BackgroundImportResult;
      waiting: number;
    };

// ── dependencies (real ones by default; tests swap them) ──────────────────

export interface BackgroundImportDeps {
  importPaths(paths: string[], report: ImportReporter): Promise<StagedPick>;
  /** Start the shared progress run (FAB ring, notification). */
  startRun(): {
    reporter: ImportReporter;
    finish(): void;
    fail(message: string): void;
  };
  /** Open a book in the reader. */
  open(bookId: string): void | Promise<void>;
  /** Anything that changes identity when the user navigates. */
  navToken(): unknown;
}

let deps: BackgroundImportDeps | null = null;

/** Wire the real dependencies (App does this on mount) or test doubles. A
 *  batch that arrives before this waits in the queue. */
export function configureBackgroundImport(next: BackgroundImportDeps): void {
  deps = next;
  void kick();
}

// ── store plumbing ────────────────────────────────────────────────────────

let view: BackgroundImportView = { kind: "idle" };
const listeners = new Set<() => void>();
const libraryListeners = new Set<() => void>();
let resultSeq = 0;

function setView(next: BackgroundImportView): void {
  view = next;
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getView(): BackgroundImportView {
  return view;
}

export function useBackgroundImport(): BackgroundImportView {
  return useSyncExternalStore(subscribe, getView, getView);
}

/** Called after a run changes the library index. The Library re-reads on
 *  this; when it isn't mounted it reads the fresh index on mount anyway. */
export function onLibraryChanged(fn: () => void): () => void {
  libraryListeners.add(fn);
  return () => {
    libraryListeners.delete(fn);
  };
}

function notifyLibraryChanged(): void {
  for (const fn of libraryListeners) {
    try {
      fn();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[backgroundImport] library listener threw:", e);
    }
  }
}

// ── the queue ─────────────────────────────────────────────────────────────

interface Batch {
  paths: string[];
  /** Where the user was when these arrived — see the module comment. */
  nav: unknown;
}

const queue: Batch[] = [];
/** Every path queued or in the running batch. A file manager, the OS and
 *  our three drain triggers can all deliver one open more than once; the
 *  second copy is dropped here rather than imported twice. */
const pending = new Set<string>();
let running = false;
/** Set while waiting for another run to give the import lock back. */
let stopWaiting: (() => void) | null = null;

function queuedFiles(): number {
  return queue.reduce((n, b) => n + b.paths.length, 0);
}

/** Queue files for import. Duplicates of anything already queued or running
 *  are dropped; an all-duplicate call is a no-op. */
export function enqueueImport(paths: string[]): void {
  const fresh: string[] = [];
  for (const p of paths) {
    if (!p || pending.has(p)) continue;
    pending.add(p);
    fresh.push(p);
  }
  if (fresh.length === 0) return;
  queue.push({ paths: fresh, nav: deps?.navToken() });
  if (view.kind === "working") setView({ ...view, waiting: queuedFiles() });
  else if (!running) setView({ kind: "queued", files: queuedFiles() });
  void kick();
}

/** True while a background run is going or waiting. */
export function isBackgroundImportBusy(): boolean {
  return running || queue.length > 0;
}

/** Hide the in-progress toast. The import carries on. */
export function hideBackgroundImport(): void {
  if (view.kind === "working") setView({ ...view, hidden: true });
}

/** Dismiss a result. A no-op for anything else, so a toast timer firing
 *  just after a new run started can't clear that run's status. */
export function dismissBackgroundImport(seq: number): void {
  if (view.kind === "result" && view.seq === seq) setView({ kind: "idle" });
}

/** Retry when the import lock comes free. Progress-store emits are the
 *  signal: a release emits, and so does any run finishing or failing. */
function waitForLock(): void {
  if (stopWaiting) return;
  stopWaiting = subscribeProgress(() => {
    if (isImportBusy()) return;
    stopWaiting?.();
    stopWaiting = null;
    void kick();
  });
}

async function kick(): Promise<void> {
  if (running || !deps || queue.length === 0) return;
  const release = acquireImportLock();
  if (!release) {
    waitForLock();
    return;
  }
  const batch = queue.shift() as Batch;
  running = true;
  try {
    // runBatch reports per-file failures itself; landing in this catch means
    // the pipeline as a whole fell over. Still say so, and still let the
    // next batch run — a stuck `running` would swallow every later arrival.
    const result = await runBatch(deps, batch).catch((e) =>
      allFailed(batch.paths, message(e)),
    );
    resultSeq += 1;
    setView({
      kind: "result",
      seq: resultSeq,
      result,
      waiting: queuedFiles(),
    });
  } finally {
    for (const p of batch.paths) pending.delete(p);
    running = false;
    release();
    void kick();
  }
}

// ── one run ───────────────────────────────────────────────────────────────

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function lastSegment(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function brief(entry: BookIndexEntry): { id: string; title: string } {
  return { id: entry.id, title: entry.title };
}

function allFailed(paths: string[], msg: string): BackgroundImportResult {
  return {
    added: [],
    reused: [],
    failed: paths.map((path) => ({
      name: lastSegment(path),
      message: msg,
      path,
      retryable: true,
    })),
    opened: null,
  };
}

async function runBatch(
  d: BackgroundImportDeps,
  batch: Batch,
): Promise<BackgroundImportResult> {
  setView({
    kind: "working",
    name: "",
    index: 0,
    total: batch.paths.length,
    waiting: queuedFiles(),
    hidden: false,
  });
  const run = d.startRun();
  const reporter: ImportReporter = {
    ...run.reporter,
    file(index, total, name) {
      run.reporter.file(index, total, name);
      if (view.kind === "working") {
        setView({ ...view, name, index, total, waiting: queuedFiles() });
      }
    },
  };

  let pick: StagedPick;
  try {
    pick = await d.importPaths(batch.paths, reporter);
  } catch (e) {
    run.fail(message(e));
    throw e;
  }

  const added = pick.autoImported.map(brief);
  const reused = (pick.reused ?? []).map(brief);
  const failed: BackgroundImportResult["failed"] = pick.errors.map((e) => ({
    name: e.name,
    message: e.message,
    path: e.path,
    retryable: e.retryable,
  }));

  // PDF/DOCX: commit what the dialog would have prefilled. Sequential, like
  // the dialog queue, so two big PDFs don't fight over the bridge.
  for (const draft of pick.drafts) {
    try {
      const entry = await draft.commit({
        title: draft.title,
        cover: draftDefaultCover(draft),
      });
      added.push(brief(entry));
    } catch (e) {
      failed.push({
        name: draft.title || lastSegment(draft.filename),
        message: message(e),
        // `filename` is the path the draft was staged from.
        path: draft.filename,
        retryable: true,
      });
    } finally {
      draft.dispose();
    }
  }
  for (const f of failed) {
    // eslint-disable-next-line no-console
    console.warn("[backgroundImport] import failed:", f.name, f.message);
  }

  // Exactly one book, nothing went wrong, and the user has not moved since
  // it arrived: open it. A failure keeps the reader closed so the toast
  // reporting it is not buried under a book.
  const books = [...added, ...reused];
  const opened =
    books.length === 1 && failed.length === 0 && d.navToken() === batch.nav
      ? books[0].id
      : null;
  if (opened) {
    // The reader reports its own load failures; nothing to add here.
    void Promise.resolve()
      .then(() => d.open(opened))
      .catch(() => {});
  } else if (added.length + reused.length + (pick.pruned?.length ?? 0) > 0) {
    // Only when staying put: opening unmounts the Library, which re-reads
    // on its next mount, so a refresh now would be thrown away — and would
    // compete with loading the book.
    notifyLibraryChanged();
  }

  if (books.length === 0 && failed.length > 0) run.fail(failed[0].message);
  else run.finish();

  return { added, reused, failed, opened };
}

/** Test-only: forget everything between cases. */
export function __resetBackgroundImportForTests(): void {
  deps = null;
  queue.length = 0;
  pending.clear();
  running = false;
  stopWaiting?.();
  stopWaiting = null;
  resultSeq = 0;
  listeners.clear();
  libraryListeners.clear();
  view = { kind: "idle" };
}
