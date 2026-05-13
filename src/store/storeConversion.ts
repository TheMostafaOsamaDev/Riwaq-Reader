// "Save as offline book" conversion — bakes a source-backed library
// entry's snapshot + downloaded chapter content (with on-the-fly
// fetching of any chapters still missing) into one or more standalone
// EPUB library entries.
//
// Inputs:
//   - source.json snapshot for the entry
//   - per-chapter content from `chapters/<padded-id>/content.json`
//     when downloaded, otherwise a fresh `source.getChapterContent`
//     call
//   - cover from `books/<entryId>/cover.<ext>`
//
// Output:
//   - "single" mode → one EPUB containing every volume as a section
//   - "per-volume" mode → one EPUB per volume, each with chapters flat
//   - All outputs land as new library entries via importEpubBytes.
//     The original source-backed entry stays untouched.
//
// Implementation notes:
//   - Chapter ordering is the snapshot's natural source order
//     (volume sort + chapter id within volume).
//   - Image hrefs are normalized to `images/img-NNN.<ext>` inside each
//     EPUB, deduplicated by source-key (URL or local basename) so a
//     repeated image lands once. Downloaded-image bytes come from
//     disk; remote URLs are fetched once at assemble time.
//   - Per-volume mode keeps each EPUB independent — its image set
//     starts fresh — so opening volume 5 doesn't depend on volume 1.

import { buildEpub } from "../docx/buildEpub";
import type {
  EpubBuildImage,
  EpubCoverInput,
  EpubMeta,
} from "../docx/buildEpub";
import type { DocChapter } from "../docx/splitChapters";
import {
  BaseDirectory,
  exists,
  readFile,
} from "@tauri-apps/plugin-fs";
import { createHost } from "../sources/host";
import { getSource } from "../sources/registry";
import type { SourceChapter, SourceLine } from "../sources/types";
import {
  readChapterContent,
  readSnapshot,
  type PersistedSourceChapter,
  type PersistedSourceVolume,
  type SourceSnapshot,
} from "./sourceLibrary";
import { importEpubBytes } from "./library";
import type { ConversionJob } from "./downloadQueue";

const BASE = BaseDirectory.AppData;
const ROOT = "leaflet";
const BOOKS = `${ROOT}/books`;

interface EnrichedChapter {
  volumeId: number;
  volumeTitle: string;
  chapter: PersistedSourceChapter;
  lines: SourceLine[];
  /** Local image basename → bytes for downloaded chapters. Absent
   *  when the chapter wasn't on disk and we fetched it (the line's
   *  image content is a remote URL in that case). */
  imagesByBasename: Map<string, Uint8Array>;
}

interface ProgressFn {
  (progress: number, phase?: string): void;
}

interface CancelledFn {
  (): boolean;
}

/**
 * Drive a conversion job to completion. Mutates the supplied job in
 * place by appending freshly-created library entry ids to
 * `producedEntryIds`. Throws if the source can't be resolved, or a
 * chapter fetch fails irrecoverably.
 *
 * Cancellation is cooperative: the caller's `isCancelled` is polled
 * between every chapter fetch and between every EPUB build. A
 * cancelled job leaves any already-produced EPUB entries on disk
 * (importEpubBytes is atomic per book) so the user keeps whatever
 * the worker managed to land before they hit cancel.
 */
export async function runConversion(
  job: ConversionJob,
  isCancelled: CancelledFn,
  onProgress: ProgressFn,
): Promise<void> {
  onProgress(0.01, "Loading snapshot");
  const snap = await readSnapshot(job.libraryEntryId);
  if (!snap) {
    throw new Error(
      "Couldn't read the novel's snapshot — try reopening it from the library first.",
    );
  }
  const source = getSource(snap.sourceId);
  if (!source) {
    throw new Error(
      `Source "${snap.sourceId}" isn't installed in this build.`,
    );
  }

  // Build a flat ordered chapter list. Skip any volumes whose
  // listing isn't loaded yet — the user is expected to either let
  // the dialog pre-load them or open the volumes manually. Skipping
  // is safer than fetching here because lazy-volume fetches can
  // multiply network load unpredictably mid-conversion.
  const orderedVolumes = snap.volumes.filter(
    (v) => v.chaptersLoaded !== false || v.chapters.length > 0,
  );
  if (orderedVolumes.length === 0) {
    throw new Error(
      "No chapter listings are loaded for this novel. Open the volumes in the detail view (or use Download Range) before converting.",
    );
  }
  const flat = orderedVolumes.flatMap((v) =>
    v.chapters.map((c) => ({ volumeId: v.id, volumeTitle: v.title, chapter: c })),
  );
  if (flat.length === 0) {
    throw new Error("This novel has no chapters to convert.");
  }

  // ── enrichment pass: read content from disk or fetch from source ──────
  const enriched: EnrichedChapter[] = [];
  const host = createHost(snap.sourceId);
  for (let i = 0; i < flat.length; i++) {
    if (isCancelled()) return;
    const fc = flat[i];
    const phase = `Reading chapter ${i + 1} / ${flat.length}`;
    // Cap content-load progress at 0.7 of the bar so we leave room
    // for image fetch + EPUB build.
    onProgress(0.05 + (0.65 * i) / flat.length, phase);
    enriched.push(await enrichChapter(job.libraryEntryId, source, fc, host));
  }
  if (isCancelled()) return;

  // ── cover ─────────────────────────────────────────────────────────────
  const cover = await readCoverForEntry(job.libraryEntryId);

  // ── assemble ──────────────────────────────────────────────────────────
  if (job.mode === "single") {
    onProgress(0.78, "Building EPUB");
    const bytes = await assembleSingleEpub(
      snap,
      enriched,
      cover,
      host,
      isCancelled,
      (p, phase) => onProgress(0.78 + 0.18 * p, phase),
    );
    if (isCancelled()) return;
    onProgress(0.96, "Saving to library");
    const entry = await importEpubBytes(bytes);
    job.producedEntryIds.push(entry.id);
    onProgress(1, `Saved "${entry.title ?? snap.title}"`);
    return;
  }

  // ── per-volume ────────────────────────────────────────────────────────
  // Group by volumeId in the order the snapshot serves them.
  const groups: Array<{ volumeTitle: string; items: EnrichedChapter[] }> = [];
  for (const v of orderedVolumes) {
    const items = enriched.filter((e) => e.volumeId === v.id);
    if (items.length > 0) groups.push({ volumeTitle: v.title, items });
  }
  const nVolumes = groups.length;
  // Resume support: a retried job may already have produced some
  // library entries before being interrupted. Skip those positions
  // and pick up at the next volume. The producedEntryIds list is
  // ordered by emission, so its length is the highest already-saved
  // volume index.
  const alreadyProduced = job.producedEntryIds.length;
  if (alreadyProduced > 0) {
    onProgress(
      0.78 + 0.18 * (alreadyProduced / nVolumes),
      `Resuming at volume ${alreadyProduced + 1} / ${nVolumes}`,
    );
  }
  for (let i = alreadyProduced; i < nVolumes; i++) {
    if (isCancelled()) return;
    const g = groups[i];
    const fraction = i / nVolumes;
    const span = 1 / nVolumes;
    onProgress(
      0.78 + 0.18 * fraction,
      `Building volume ${i + 1} / ${nVolumes}`,
    );
    const bytes = await assembleVolumeEpub(
      snap,
      g.items,
      g.volumeTitle,
      cover,
      host,
      isCancelled,
      (p, phase) =>
        onProgress(0.78 + 0.18 * (fraction + p * span), phase),
    );
    if (isCancelled()) return;
    onProgress(0.78 + 0.18 * (fraction + 0.9 * span), `Saving volume ${i + 1}`);
    const entry = await importEpubBytes(bytes);
    job.producedEntryIds.push(entry.id);
  }
  onProgress(1, `Saved ${nVolumes} books`);
}

// ── per-chapter enrichment ─────────────────────────────────────────────

async function enrichChapter(
  entryId: string,
  source: NonNullable<ReturnType<typeof getSource>>,
  fc: { volumeId: number; volumeTitle: string; chapter: PersistedSourceChapter },
  host: ReturnType<typeof createHost>,
): Promise<EnrichedChapter> {
  const imagesByBasename = new Map<string, Uint8Array>();

  // Preferred path: read the downloaded content + images from disk.
  const stored = fc.chapter.downloadedAt
    ? await readChapterContent(entryId, fc.chapter.id)
    : null;
  if (stored) {
    for (const ln of stored.lines) {
      if (ln.type !== "image") continue;
      // Downloaded image lines reference a local basename. Read
      // each one from `chapters/<padded>/<basename>`. A chapter
      // whose download partially failed may have a line that
      // points at the remote URL — we leave those as-is and the
      // assembler refetches them.
      if (/^https?:\/\//i.test(ln.content)) continue;
      if (imagesByBasename.has(ln.content)) continue;
      try {
        const bytes = await readImageFile(entryId, fc.chapter.id, ln.content);
        if (bytes) imagesByBasename.set(ln.content, bytes);
      } catch {
        // Skip — the assembler will surface a "missing image" line.
      }
    }
    return {
      volumeId: fc.volumeId,
      volumeTitle: fc.volumeTitle,
      chapter: fc.chapter,
      lines: stored.lines,
      imagesByBasename,
    };
  }

  // Fallback: fetch live. We don't persist this — the user asked to
  // convert without first downloading, and writing scattered chapter
  // content for an in-flight conversion would clutter the snapshot.
  const stub: SourceChapter = {
    id: fc.chapter.id,
    title: fc.chapter.title,
    url: fc.chapter.url,
    lines: [],
  };
  void host; // hosts are constructed inside getChapterContent calls already
  const lines = await source.getChapterContent(stub);
  return {
    volumeId: fc.volumeId,
    volumeTitle: fc.volumeTitle,
    chapter: fc.chapter,
    lines,
    imagesByBasename,
  };
}

async function readImageFile(
  entryId: string,
  chapterId: number,
  basename: string,
): Promise<Uint8Array | null> {
  const path = `${BOOKS}/${entryId}/chapters/${paddedChapterId(chapterId)}/${basename}`;
  if (!(await exists(path, { baseDir: BASE }))) return null;
  return readFile(path, { baseDir: BASE });
}

function paddedChapterId(chapterId: number): string {
  return String(chapterId).padStart(5, "0");
}

// ── cover loading ──────────────────────────────────────────────────────

async function readCoverForEntry(entryId: string): Promise<EpubCoverInput | null> {
  // The cover filename lives in library.json. The simplest read is
  // to look at the index entry; we duck-type by listing common
  // extensions instead of pulling library.ts's listBooks (which
  // would re-fetch every book just for this).
  for (const ext of ["jpg", "jpeg", "png", "webp", "gif"]) {
    const path = `${BOOKS}/${entryId}/cover.${ext}`;
    if (!(await exists(path, { baseDir: BASE }))) continue;
    const bytes = await readFile(path, { baseDir: BASE });
    return {
      bytes,
      mimeType: mimeForExt(ext),
      extension: ext === "jpeg" ? "jpg" : ext,
    };
  }
  return null;
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

// ── EPUB assembly ──────────────────────────────────────────────────────

async function assembleSingleEpub(
  snap: SourceSnapshot,
  items: EnrichedChapter[],
  cover: EpubCoverInput | null,
  host: ReturnType<typeof createHost>,
  isCancelled: CancelledFn,
  onProgress: ProgressFn,
): Promise<Uint8Array> {
  const multiVolume = new Set(items.map((it) => it.volumeId)).size > 1;
  const { imageMap, imageFiles } = await collectImages(items, host, isCancelled, onProgress);
  if (isCancelled()) return new Uint8Array();

  const docChapters: DocChapter[] = items.map((it, i) => {
    const prev = items[i - 1];
    const isFirstOfVolume =
      multiVolume && (!prev || prev.volumeId !== it.volumeId);
    return buildChapterDoc(it, snap, multiVolume, isFirstOfVolume, imageMap);
  });

  const meta: EpubMeta = {
    title: snap.title,
    author: snap.author,
    language: snap.language,
    dir: snap.direction,
  };
  return buildEpub(meta, docChapters, cover, imageFiles);
}

async function assembleVolumeEpub(
  snap: SourceSnapshot,
  items: EnrichedChapter[],
  volumeTitle: string,
  cover: EpubCoverInput | null,
  host: ReturnType<typeof createHost>,
  isCancelled: CancelledFn,
  onProgress: ProgressFn,
): Promise<Uint8Array> {
  const { imageMap, imageFiles } = await collectImages(items, host, isCancelled, onProgress);
  if (isCancelled()) return new Uint8Array();

  // Per-volume mode never emits volume headings (each EPUB IS the
  // volume — adding "Volume 3" inside Volume 3's book is redundant).
  const docChapters: DocChapter[] = items.map((it) =>
    buildChapterDoc(it, snap, false, false, imageMap),
  );

  const meta: EpubMeta = {
    title: `${snap.title} — ${volumeTitle}`,
    author: snap.author,
    language: snap.language,
    dir: snap.direction,
  };
  return buildEpub(meta, docChapters, cover, imageFiles);
}

interface CollectedImages {
  /** Maps a source key (basename or URL) → href used in the EPUB. */
  imageMap: Map<string, string>;
  imageFiles: EpubBuildImage[];
}

async function collectImages(
  items: EnrichedChapter[],
  host: ReturnType<typeof createHost>,
  isCancelled: CancelledFn,
  onProgress: ProgressFn,
): Promise<CollectedImages> {
  const imageMap = new Map<string, string>();
  const imageFiles: EpubBuildImage[] = [];

  // First pass: collect everything we have on disk (no network).
  for (const it of items) {
    for (const ln of it.lines) {
      if (ln.type !== "image") continue;
      if (imageMap.has(ln.content)) continue;
      if (/^https?:\/\//i.test(ln.content)) continue;
      const bytes = it.imagesByBasename.get(ln.content);
      if (!bytes) continue;
      const ext = extensionForImage(ln.content);
      const href = `images/img-${String(imageFiles.length + 1).padStart(3, "0")}.${ext}`;
      imageMap.set(ln.content, href);
      imageFiles.push({ href, bytes, mimeType: mimeForExt(ext) });
    }
  }

  // Second pass: fetch remote images. Sequential to keep server load
  // predictable + so progress is monotonic. Errors per-image don't
  // fail the whole conversion — the line just falls back to a
  // "missing image" placeholder.
  const remoteKeys: string[] = [];
  for (const it of items) {
    for (const ln of it.lines) {
      if (ln.type !== "image") continue;
      if (imageMap.has(ln.content)) continue;
      if (!/^https?:\/\//i.test(ln.content)) continue;
      remoteKeys.push(ln.content);
    }
  }
  // De-dup while preserving order.
  const seen = new Set<string>();
  const unique = remoteKeys.filter((k) => (seen.has(k) ? false : (seen.add(k), true)));
  for (let i = 0; i < unique.length; i++) {
    if (isCancelled()) break;
    const url = unique[i];
    onProgress(
      i / Math.max(1, unique.length),
      `Fetching image ${i + 1} / ${unique.length}`,
    );
    try {
      const bytes = await host.fetchBytes(url);
      const ext = extensionForImage(url);
      const href = `images/img-${String(imageFiles.length + 1).padStart(3, "0")}.${ext}`;
      imageMap.set(url, href);
      imageFiles.push({ href, bytes, mimeType: mimeForExt(ext) });
    } catch {
      // Drop the image — line will render as a "missing image"
      // placeholder via the renderer's fallback.
    }
  }

  return { imageMap, imageFiles };
}

function extensionForImage(ref: string): string {
  const lower = ref.toLowerCase().split("?")[0].split("#")[0];
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".gif")) return "gif";
  if (lower.endsWith(".webp")) return "webp";
  if (lower.endsWith(".svg")) return "svg";
  if (lower.endsWith(".jpeg") || lower.endsWith(".jpg")) return "jpg";
  return "jpg";
}

function buildChapterDoc(
  it: EnrichedChapter,
  snap: SourceSnapshot,
  multiVolume: boolean,
  isFirstOfVolume: boolean,
  imageMap: Map<string, string>,
): DocChapter {
  const dirAttr = snap.direction === "rtl" ? ' dir="rtl"' : "";
  const lineHtml = it.lines
    .map((ln) => renderLine(ln, imageMap, dirAttr))
    .join("\n  ");
  const volumeHeader =
    multiVolume && isFirstOfVolume
      ? `<h2 class="volume-heading"${dirAttr}>${escapeHtml(it.volumeTitle)}</h2>\n  `
      : "";
  const title = multiVolume
    ? `V${it.volumeId} · ${it.chapter.title}`
    : it.chapter.title;
  const html = `${volumeHeader}<h1${dirAttr}>${escapeHtml(title)}</h1>\n  ${lineHtml}`;
  return { title, html };
}

function renderLine(
  line: SourceLine,
  imageMap: Map<string, string>,
  dirAttr: string,
): string {
  if (line.type === "image") {
    const href = imageMap.get(line.content);
    if (!href) {
      return `<p${dirAttr}><em>[Missing image: ${escapeHtml(line.content)}]</em></p>`;
    }
    return `<p${dirAttr}><img src="${escapeAttr(href)}" alt=""/></p>`;
  }
  return `<p${dirAttr}>${escapeHtml(line.content)}</p>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

// re-export only the helper types so call sites don't have to crawl
// sourceLibrary.ts when integrating.
export type { PersistedSourceVolume };
