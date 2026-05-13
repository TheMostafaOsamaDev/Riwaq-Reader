// Per-chapter download queue for source-backed library entries.
//
// Two public surfaces:
//
//   downloadChapter(entryId, chapterId)
//       Fetch one chapter's content + inline images, write to disk,
//       and mark it downloaded in source.json. Throws on error; the
//       caller is responsible for surfacing it. Used directly by
//       "Download chapter" buttons; used internally by the queue
//       worker for batched downloads.
//
//   enqueue / cancel / subscribe / getState
//       Module-scoped queue with workers. Jobs progress through
//       "queued → running → done | error | cancelled". UIs subscribe
//       for state updates and pump the queue indirectly by enqueuing.
//
// Workers run with bounded concurrency. Cancellation is cooperative:
// a job already started keeps going until its current fetch resolves
// (we can't yank a Tauri command mid-flight), but its result is
// discarded if the user cancelled before completion. Queued-but-not-
// started jobs are removed immediately.
//
// The state list is intentionally bounded — finished jobs evict from
// the tail once we cross a high-water mark so the queue page doesn't
// grow forever. The bookkeeping isn't a long-term audit log; it's an
// in-session view.

import {
  markChapterDownloaded,
  readSnapshot,
  writeChapterContent,
  type SourceSnapshot,
} from "./sourceLibrary";
import { createHost } from "../sources/host";
import { getSource } from "../sources/registry";
import type { SourceChapter, SourceLine } from "../sources/types";

// ── public job shape ───────────────────────────────────────────────────────

export type DownloadJobStatus =
  | "queued"
  | "running"
  | "done"
  | "error"
  | "cancelled";

/** Fields every queue entry carries regardless of what kind of work
 *  it represents. Kept on a base interface so the discriminated union
 *  below stays tidy. */
interface JobBase {
  /** Synthetic job id; only meaningful inside the queue. */
  id: string;
  libraryEntryId: string;
  novelTitle: string;
  status: DownloadJobStatus;
  /** 0..1. For chapter downloads, this is fraction-of-one-chapter
   *  done; for conversions it's fraction-of-novel-converted. */
  progress: number;
  error?: string;
  enqueuedAt: number;
  updatedAt: number;
}

/** A single-chapter download: fetch content + inline images, persist
 *  to `chapters/<id>/`, flip `downloadedAt`. The original queue shape. */
export interface ChapterDownloadJob extends JobBase {
  kind: "chapter";
  chapterId: number;
  chapterTitle: string;
}

/** A "convert to offline book" job: pulls every chapter (downloaded or
 *  not), bakes one or more EPUBs, lands them in the library as regular
 *  entries. One job per user-initiated conversion regardless of how
 *  many EPUBs it produces. */
export interface ConversionJob extends JobBase {
  kind: "conversion";
  /** Whether to assemble one EPUB containing every volume as a
   *  section, or one EPUB per volume (each with chapters flat). */
  mode: "single" | "per-volume";
  /** Free-form label updated by the worker as it advances through
   *  fetch → build → save phases. Surfaced in the queue UI body so
   *  the user sees what's happening beyond a percentage. */
  phase: string;
  /** Library entry ids of the EPUBs produced so far. Single-mode
   *  lands one; per-volume lands many. */
  producedEntryIds: string[];
}

export type DownloadJob = ChapterDownloadJob | ConversionJob;

interface QueueState {
  jobs: DownloadJob[];
}

type Listener = (state: QueueState) => void;

// ── module-scoped state ────────────────────────────────────────────────────

/** Number of chapter downloads that may run concurrently. Two strikes
 *  a balance: faster than serial, and on the typical "scrape a hundred
 *  chapters" path the bottleneck is each chapter's per-page fetch +
 *  image download, not the local I/O. */
const CONCURRENCY = 2;

/** Cap on how many "terminal" (done / error / cancelled) jobs we keep
 *  around for the queue UI. New terminals push older terminals off. */
const TERMINAL_LIMIT = 50;

const state: QueueState = { jobs: [] };
const listeners = new Set<Listener>();
const cancelled = new Set<string>();
let runningCount = 0;
let nextId = 1;

function emit() {
  for (const l of listeners) l(state);
}

function genId(): string {
  // Cheap monotonic ids — the queue lifetime is one session, no
  // collision risk worth carrying a crypto.randomUUID call for.
  return `dl-${nextId++}-${Date.now().toString(36)}`;
}

function findJob(id: string): DownloadJob | undefined {
  return state.jobs.find((j) => j.id === id);
}

function evictTerminals() {
  // Keep all non-terminal jobs + the most recent TERMINAL_LIMIT
  // terminals.
  const live: DownloadJob[] = [];
  const terms: DownloadJob[] = [];
  for (const j of state.jobs) {
    if (j.status === "queued" || j.status === "running") live.push(j);
    else terms.push(j);
  }
  terms.sort((a, b) => b.updatedAt - a.updatedAt);
  state.jobs = [...live, ...terms.slice(0, TERMINAL_LIMIT)];
}

function setStatus(
  job: DownloadJob,
  status: DownloadJobStatus,
  patch?: Partial<DownloadJob>,
) {
  job.status = status;
  job.updatedAt = Date.now();
  if (patch) Object.assign(job, patch);
  if (status === "done" || status === "error" || status === "cancelled") {
    evictTerminals();
  }
  emit();
}

// ── enqueue / cancel / subscribe ───────────────────────────────────────────

export interface EnqueueDescriptor {
  libraryEntryId: string;
  chapterId: number;
  novelTitle: string;
  chapterTitle: string;
}

/** Add one chapter to the queue. Returns the job id (useful for
 *  targeted cancel). If the same (entryId, chapterId) is already
 *  queued or running, returns the existing job id without creating
 *  a duplicate. Already-completed jobs DO get a fresh entry — the
 *  caller might want to re-download. */
export function enqueue(desc: EnqueueDescriptor): string {
  const dup = state.jobs.find(
    (j) =>
      j.kind === "chapter" &&
      j.libraryEntryId === desc.libraryEntryId &&
      j.chapterId === desc.chapterId &&
      (j.status === "queued" || j.status === "running"),
  );
  if (dup) return dup.id;
  const job: ChapterDownloadJob = {
    id: genId(),
    kind: "chapter",
    libraryEntryId: desc.libraryEntryId,
    chapterId: desc.chapterId,
    novelTitle: desc.novelTitle,
    chapterTitle: desc.chapterTitle,
    status: "queued",
    progress: 0,
    enqueuedAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.jobs.push(job);
  emit();
  pump();
  return job.id;
}

export interface EnqueueConversionDescriptor {
  libraryEntryId: string;
  novelTitle: string;
  mode: "single" | "per-volume";
}

/** Enqueue a "save as offline book" conversion. One job is emitted
 *  regardless of how many EPUBs it ends up producing (per-volume mode
 *  may land many library entries from a single job). Duplicate of
 *  same (entryId, mode) is rejected while another is running so the
 *  user can't accidentally fire two conversions at once. */
export function enqueueConversion(
  desc: EnqueueConversionDescriptor,
): string {
  const dup = state.jobs.find(
    (j) =>
      j.kind === "conversion" &&
      j.libraryEntryId === desc.libraryEntryId &&
      j.mode === desc.mode &&
      (j.status === "queued" || j.status === "running"),
  );
  if (dup) return dup.id;
  const job: ConversionJob = {
    id: genId(),
    kind: "conversion",
    libraryEntryId: desc.libraryEntryId,
    novelTitle: desc.novelTitle,
    mode: desc.mode,
    phase: "Queued",
    producedEntryIds: [],
    status: "queued",
    progress: 0,
    enqueuedAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.jobs.push(job);
  emit();
  pump();
  return job.id;
}

/** Cancel a job. If queued, removes it; if running, marks it
 *  cancelled and the worker drops the result once the in-flight
 *  fetch resolves. Idempotent. */
export function cancel(jobId: string) {
  const job = findJob(jobId);
  if (!job) return;
  if (job.status === "queued") {
    setStatus(job, "cancelled");
    return;
  }
  if (job.status === "running") {
    cancelled.add(jobId);
    // Don't flip the status yet — the worker will when its fetch
    // resolves. Surfacing "cancelling…" until then would be honest
    // but requires another transient state; for now leave it
    // "running" and let the user see the spinner stop.
  }
}

export function clearTerminals() {
  state.jobs = state.jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  );
  emit();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getState(): QueueState {
  return state;
}

/** Snapshot of (entryId, chapterId) pairs whose job is currently
 *  active (queued or running). Used by the chapter-row icon to
 *  render a "queued"/"downloading" indicator alongside the
 *  persisted downloadedAt flag. Conversion jobs are excluded — they
 *  aren't per-chapter even though they read every chapter. */
export function activeChapterSet(
  libraryEntryId: string,
): Map<number, ChapterDownloadJob> {
  const out = new Map<number, ChapterDownloadJob>();
  for (const j of state.jobs) {
    if (j.kind !== "chapter") continue;
    if (j.libraryEntryId !== libraryEntryId) continue;
    if (j.status === "queued" || j.status === "running") {
      out.set(j.chapterId, j);
    }
  }
  return out;
}

// ── worker pump ────────────────────────────────────────────────────────────

function pump() {
  while (runningCount < CONCURRENCY) {
    const job = state.jobs.find((j) => j.status === "queued");
    if (!job) return;
    runningCount++;
    setStatus(job, "running", { progress: 0.02 });
    runJob(job)
      .catch(() => {
        // runJob already mapped its error to job.status. Swallow.
      })
      .finally(() => {
        runningCount--;
        pump();
      });
  }
}

async function runJob(job: DownloadJob): Promise<void> {
  try {
    if (cancelled.has(job.id)) {
      cancelled.delete(job.id);
      setStatus(job, "cancelled");
      return;
    }
    if (job.kind === "chapter") {
      await runChapterJob(job);
    } else {
      await runConversionJob(job);
    }
    if (cancelled.has(job.id)) {
      cancelled.delete(job.id);
      setStatus(job, "cancelled");
      return;
    }
    setStatus(job, "done", { progress: 1 });
  } catch (e) {
    if (e instanceof CancelledError) {
      cancelled.delete(job.id);
      setStatus(job, "cancelled");
      return;
    }
    setStatus(job, "error", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function runChapterJob(job: ChapterDownloadJob): Promise<void> {
  await downloadChapter(
    job.libraryEntryId,
    job.chapterId,
    (p) => {
      // Cooperatively poll for cancellation between phases. If the
      // user cancelled, abandon — the persisted side effects
      // already-written stay on disk (writes are mid-step), but
      // the snapshot's downloadedAt only flips after success, so
      // a cancelled chapter is consistently "not downloaded".
      if (cancelled.has(job.id)) {
        throw new CancelledError();
      }
      if (typeof p === "number") {
        job.progress = p;
        job.updatedAt = Date.now();
        emit();
      }
    },
  );
}

async function runConversionJob(job: ConversionJob): Promise<void> {
  // Dynamic import keeps the conversion module (which pulls in the
  // EPUB builder + a fair chunk of importer code) off the main
  // bundle's hot path. Queue users that only download chapters never
  // load it.
  const { runConversion } = await import("./storeConversion");
  await runConversion(
    job,
    () => cancelled.has(job.id),
    (p, phase) => {
      if (cancelled.has(job.id)) {
        throw new CancelledError();
      }
      if (typeof p === "number") {
        job.progress = p;
      }
      if (typeof phase === "string") {
        job.phase = phase;
      }
      job.updatedAt = Date.now();
      emit();
    },
  );
}

class CancelledError extends Error {
  constructor() {
    super("download cancelled");
    this.name = "CancelledError";
  }
}

// ── one-shot download (public) ─────────────────────────────────────────────

/**
 * Fetch one chapter's content + inline images, persist to disk, and
 * mark it downloaded in source.json. Throws on error.
 *
 * Image rewrite. Source extensions emit chapter lines as
 * `{type: "image", content: <ABSOLUTE_URL>}`. We download every
 * unique image URL, save it as `img-NNN.<ext>` inside the chapter's
 * directory, then rewrite the line's `content` to the bare basename.
 * The reader resolves basenames to asset:// URLs at render time via
 * `chapterImageSrc`. This keeps the persisted shape device-independent
 * (no absolute paths burned into JSON) and survives Tauri's per-OS
 * AppData differences.
 */
export async function downloadChapter(
  libraryEntryId: string,
  chapterId: number,
  onProgress?: (p: number) => void,
): Promise<void> {
  const snap = await readSnapshot(libraryEntryId);
  if (!snap) {
    throw new Error(
      "Library entry isn't a source-backed novel (no source.json on disk).",
    );
  }
  const chapter = findChapterInSnapshot(snap, chapterId);
  if (!chapter) {
    throw new Error(`Chapter ${chapterId} isn't in this novel's listing.`);
  }
  const source = getSource(snap.sourceId);
  if (!source) {
    throw new Error(
      `Source "${snap.sourceId}" isn't installed — can't download this chapter.`,
    );
  }
  onProgress?.(0.05);

  // Fetch the chapter body. Pass a SourceChapter shape; the host is
  // only consulted for the URL, but the type annotation needs the
  // empty lines + id.
  const stub: SourceChapter = {
    id: chapterId,
    title: chapter.title,
    url: chapter.url,
    lines: [],
  };
  const lines = await source.getChapterContent(stub);
  onProgress?.(0.35);

  // Collect unique image URLs in document order — we want stable
  // basenames so re-downloading doesn't shuffle indexes.
  const imageUrls: string[] = [];
  const seen = new Set<string>();
  for (const ln of lines) {
    if (ln.type !== "image") continue;
    if (seen.has(ln.content)) continue;
    seen.add(ln.content);
    imageUrls.push(ln.content);
  }

  const host = createHost(snap.sourceId);
  const imageFiles: Array<{ basename: string; bytes: Uint8Array }> = [];
  const urlToBasename = new Map<string, string>();
  for (let i = 0; i < imageUrls.length; i++) {
    const url = imageUrls[i];
    const idx = String(i + 1).padStart(3, "0");
    try {
      const bytes = await host.fetchBytes(url);
      const basename = `img-${idx}.${extensionFromImageUrl(url)}`;
      urlToBasename.set(url, basename);
      imageFiles.push({ basename, bytes });
    } catch (e) {
      host.log(
        "warn",
        `chapter ${chapterId}: image fetch failed (${url}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      // Skip this image — the line keeps its original URL so the
      // reader can still try to fetch it on display.
    }
    onProgress?.(0.35 + 0.55 * ((i + 1) / Math.max(1, imageUrls.length)));
  }

  // Rewrite image lines to local basenames where we have one.
  const rewritten: SourceLine[] = lines.map((ln) => {
    if (ln.type !== "image") return ln;
    const local = urlToBasename.get(ln.content);
    return local ? { type: "image", content: local } : ln;
  });

  await writeChapterContent(libraryEntryId, chapterId, rewritten, imageFiles);
  onProgress?.(0.95);
  await markChapterDownloaded(libraryEntryId, chapterId);
  onProgress?.(1);
}

function findChapterInSnapshot(snapshot: SourceSnapshot, chapterId: number) {
  for (const v of snapshot.volumes) {
    for (const c of v.chapters) {
      if (c.id === chapterId) return c;
    }
  }
  return null;
}

/** Best-effort extension picker — mirrors the importer's logic. */
function extensionFromImageUrl(url: string): string {
  const lower = url.toLowerCase().split("?")[0].split("#")[0];
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".gif")) return "gif";
  if (lower.endsWith(".webp")) return "webp";
  if (lower.endsWith(".svg")) return "svg";
  if (lower.endsWith(".jpeg")) return "jpg";
  if (lower.endsWith(".jpg")) return "jpg";
  // Defaulting to .jpg is OK — the reader resolves images by manifest
  // path, not content sniffing, so the actual MIME of the bytes
  // doesn't have to match the extension for the picture to render.
  return "jpg";
}

// ── batch enqueue helpers ──────────────────────────────────────────────────

/**
 * Enqueue every chapter in (inclusive) [start, end] from the novel
 * the snapshot describes. Used by "Download range" — replaces the
 * legacy build-a-separate-EPUB flow with the new queue-driven
 * approach. Returns the list of job ids that were created (existing
 * queued/running jobs for the same chapter are reused; their ids are
 * still included).
 */
export function enqueueRange(
  snapshot: SourceSnapshot,
  start: number,
  end: number,
  libraryEntryId: string,
): string[] {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  const ids: string[] = [];
  for (const v of snapshot.volumes) {
    for (const c of v.chapters) {
      if (c.id < lo || c.id > hi) continue;
      if (c.downloadedAt) continue; // already on disk
      ids.push(
        enqueue({
          libraryEntryId,
          chapterId: c.id,
          novelTitle: snapshot.title,
          chapterTitle: c.title,
        }),
      );
    }
  }
  return ids;
}
