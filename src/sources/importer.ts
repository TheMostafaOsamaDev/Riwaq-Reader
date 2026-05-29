// Importer pipeline — drives a Source through a full scrape and turns its
// output into an EPUB the library can ingest.
//
// Sequence:
//   1. Source.getNovel(url) — index page → title, author, volumes, chapter stubs.
//   2. Download cover image (if the source identified one).
//   3. Source.getChapterContent(chapter) — body lines per chapter.
//      Runs at modest concurrency to amortize the per-page browser cost
//      without spawning so many hidden webviews that the desktop chokes.
//   4. Download all image-URL lines so they ride along inside the EPUB
//      (deferring image loading to runtime is fragile when the source's
//      images expire or get rate-limited; bake them in).
//   5. Assemble EPUB via buildEpub(), then hand off to importEpubBytes()
//      so the result is a regular library entry.
//
// Progress reporting reuses the existing importProgress store. The chapter
// fan-out step's label is live-updated ("Fetching chapter 47 of 213") so
// the user can see motion during the long phase without us inflating the
// step count.

import { buildEpub } from "../docx/buildEpub";
import type {
  EpubBuildImage,
  EpubCoverInput,
  EpubMeta,
} from "../docx/buildEpub";
import type { DocChapter } from "../docx/splitChapters";
import {
  beginStep,
  completeStep,
  failStep,
  finishImport,
  setStepLabel,
  startImport,
  getState as getImportProgressState,
} from "../store/importProgress";
import { createHost } from "./host";
import type {
  Source,
  SourceChapter,
  SourceHost,
  SourceLine,
  SourceNovel,
} from "./types";

/** Maximum chapter scrapes in flight at once. The headless webview path is
 *  the bottleneck — each scrape opens a hidden window. Four matches the
 *  C# original's `MaxDegreeOfParallelism = 4`. */
const DEFAULT_CHAPTER_CONCURRENCY = 4;

export interface ImportFromSourceResult {
  epubBytes: Uint8Array;
  novel: SourceNovel;
  chapterCount: number;
}

export interface ImportFromSourceOptions {
  /** Override chapter-fetch concurrency. Set to 1 for ordered + minimal
   *  resource use; larger values are faster but each new in-flight scrape
   *  spawns another hidden webview window. */
  chapterConcurrency?: number;
  /** When set, only chapters whose `id` falls within [start, end]
   *  (inclusive) are fetched. Used by the "Download range" UI to grab a
   *  slice of a long novel without downloading every chapter. The title
   *  of the resulting EPUB is augmented with the range so the library
   *  shows what was imported. */
  chapterIdRange?: { start: number; end: number };
}

/**
 * Run a source against a URL and return EPUB bytes — ready to be fed to
 * `importEpubBytes`. Reports progress through the import-progress store.
 *
 * The store API is fire-and-forget; failures here throw, but the
 * progress UI also surfaces the failure via `failStep` before the throw
 * so the user sees it in the modal even if the caller swallows the
 * exception.
 */
export async function importFromSource(
  source: Source,
  url: string,
  options: ImportFromSourceOptions = {},
): Promise<ImportFromSourceResult> {
  const concurrency = Math.max(
    1,
    options.chapterConcurrency ?? DEFAULT_CHAPTER_CONCURRENCY,
  );

  // Refuse to start a second import while one is already running — the
  // progress store is module-scoped (singleton), and stomping on it would
  // break the in-flight UI. Matches the guard pickAndImportDocx already
  // uses.
  const current = getImportProgressState();
  if (current.active && current.finishedAt === null) {
    throw new Error("Another import is already running");
  }

  startImport([
    { id: "fetch-index", label: `Loading ${source.meta.name} page` },
    { id: "cover", label: "Fetching cover" },
    { id: "chapters", label: "Fetching chapters" },
    { id: "images", label: "Downloading inline images" },
    { id: "epub", label: "Building EPUB" },
    { id: "save", label: "Adding to library" },
  ]);

  let currentStepId = "fetch-index";
  try {
    // ── 1. index page ────────────────────────────────────────────────────
    beginStep("fetch-index");
    const novel = await source.getNovel(url);
    completeStep("fetch-index");

    let chapters = flattenChapters(novel);
    if (options.chapterIdRange) {
      const { start, end } = options.chapterIdRange;
      chapters = chapters.filter(
        (c) => c.sourceChapter.id >= start && c.sourceChapter.id <= end,
      );
      if (chapters.length === 0) {
        throw new Error(
          `No chapters in range ${start}–${end} for this novel.`,
        );
      }
    }
    if (chapters.length === 0) {
      throw new Error(
        `${source.meta.name} returned no chapters for ${url}. The site layout may have changed.`,
      );
    }

    // ── 2. cover ─────────────────────────────────────────────────────────
    currentStepId = "cover";
    beginStep("cover");
    let cover: EpubCoverInput | null = null;
    if (novel.coverUrl) {
      try {
        cover = await downloadImage(novel.coverUrl, createHost(source.meta.id));
      } catch (e) {
        // A missing cover shouldn't fail the whole import — most libraries
        // can re-derive one from inline content. Note in the log and move on.
        // eslint-disable-next-line no-console
        console.warn("[importer] cover download failed:", e);
      }
    }
    completeStep("cover");

    // ── 3. chapter content fan-out ───────────────────────────────────────
    currentStepId = "chapters";
    beginStep("chapters");
    await fetchAllChapters(source, chapters, concurrency);
    completeStep("chapters");

    // ── 4. inline images ─────────────────────────────────────────────────
    currentStepId = "images";
    beginStep("images");
    const host = createHost(source.meta.id);
    const { imageMap, images: epubImages } = await downloadInlineImages(
      source,
      chapters,
      host,
      (done, total) => {
        setStepLabel("images", `Downloading inline images (${done}/${total})`);
      },
    );
    completeStep("images");

    // ── 5. assemble EPUB ─────────────────────────────────────────────────
    currentStepId = "epub";
    beginStep("epub");
    // Tag the title with the requested range so the library shelf shows
    // the user this is a partial slice of the novel, not the whole thing.
    const titleSuffix = options.chapterIdRange
      ? ` (Ch. ${options.chapterIdRange.start}–${options.chapterIdRange.end})`
      : "";
    const meta: EpubMeta = {
      title: novel.title + titleSuffix,
      author: novel.author,
      language: novel.language,
      dir: novel.direction,
    };
    const docChapters = chapters.map((ch) =>
      buildChapterHtml(ch, novel, imageMap),
    );
    const epubBytes = await buildEpub(meta, docChapters, cover, epubImages);
    completeStep("epub");

    return {
      epubBytes,
      novel,
      chapterCount: chapters.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failStep(currentStepId, message);
    throw err;
  }
}

/**
 * Convenience wrapper: run the importer, then save to the library. The
 * `save` step + finishImport() call live here so the importer can be
 * unit-tested without touching disk, but callers that just want the
 * "click → book in library" experience can use this entry point.
 *
 * `importEpubBytes` is dependency-injected to break the circular import
 * with store/library.ts (which will export `importFromSourceUrl` that
 * calls this with its own importEpubBytes).
 */
export async function runFullSourceImport(
  source: Source,
  url: string,
  importEpubBytes: (bytes: Uint8Array) => Promise<{ id: string }>,
  options?: ImportFromSourceOptions,
): Promise<{ id: string }> {
  const result = await importFromSource(source, url, options);
  try {
    beginStep("save");
    const entry = await importEpubBytes(result.epubBytes);
    completeStep("save");
    finishImport(entry.id);
    return entry;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failStep("save", message);
    throw err;
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

interface FlatChapter {
  sourceChapter: SourceChapter;
  /** 1-based — useful for the user-facing title. */
  volumeId: number;
  volumeTitle: string;
  /** True when the novel has more than one volume — drives whether the
   *  rendered chapter title includes a volume prefix. */
  multiVolume: boolean;
}

function flattenChapters(novel: SourceNovel): FlatChapter[] {
  const multiVolume = novel.volumes.length > 1;
  const flat: FlatChapter[] = [];
  for (const v of novel.volumes) {
    for (const ch of v.chapters) {
      flat.push({
        sourceChapter: ch,
        volumeId: v.id,
        volumeTitle: v.title,
        multiVolume,
      });
    }
  }
  return flat;
}

async function fetchAllChapters(
  source: Source,
  chapters: FlatChapter[],
  concurrency: number,
): Promise<void> {
  const total = chapters.length;
  let done = 0;
  setStepLabel("chapters", `Fetching chapter 0 / ${total}`);

  // Static cursor-style worker pool — pull the next chapter index, fetch
  // it, repeat. Keeps `concurrency` workers busy without depending on
  // batched Promise.all where one slow chapter blocks the whole batch.
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = next++;
          if (i >= chapters.length) return;
          const fc = chapters[i];
          try {
            const lines = await source.getChapterContent(fc.sourceChapter);
            fc.sourceChapter.lines = lines;
          } catch (e) {
            // Surface the error in the chapter as a stub line; don't fail
            // the whole import for one bad chapter. The user can re-import
            // or scrape just the failed chapter later.
            fc.sourceChapter.lines = [
              {
                type: "text",
                content: `[Failed to load this chapter: ${
                  e instanceof Error ? e.message : String(e)
                }]`,
              },
            ];
          } finally {
            done++;
            setStepLabel(
              "chapters",
              `Fetching chapter ${done} / ${total}`,
            );
          }
        }
      })(),
    );
  }
  await Promise.all(workers);
}

interface InlineImageResult {
  imageMap: Map<string, string>; // sourceUrl → relative href
  images: EpubBuildImage[];
}

async function downloadInlineImages(
  source: Source,
  chapters: FlatChapter[],
  host: SourceHost,
  onProgress: (done: number, total: number) => void,
): Promise<InlineImageResult> {
  // Collect all unique image URLs across every chapter's lines.
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const fc of chapters) {
    for (const ln of fc.sourceChapter.lines) {
      if (ln.type !== "image") continue;
      if (seen.has(ln.content)) continue;
      seen.add(ln.content);
      urls.push(ln.content);
    }
  }

  const imageMap = new Map<string, string>();
  const images: EpubBuildImage[] = [];
  let done = 0;
  onProgress(done, urls.length);
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      // PDF-style sources hold extracted image bytes in-memory and expose
      // them via resolveImage; only fall back to a network fetch when the
      // source can't resolve the ref itself.
      const dl =
        (await source.resolveImage?.(url)) ?? (await downloadImage(url, host));
      const idStr = String(i + 1).padStart(3, "0");
      const href = `images/img-${idStr}.${dl.extension}`;
      imageMap.set(url, href);
      images.push({ href, bytes: dl.bytes, mimeType: dl.mimeType });
    } catch (e) {
      host.log("warn", `failed to download image ${url}: ${String(e)}`);
    } finally {
      done++;
      onProgress(done, urls.length);
    }
  }
  return { imageMap, images };
}

interface DownloadedImage {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
}

async function downloadImage(
  url: string,
  host: SourceHost,
): Promise<DownloadedImage> {
  const bytes = await host.fetchBytes(url);
  // Best-effort MIME detection from the URL extension. We don't sniff the
  // bytes because the EPUB just needs a coherent (mimeType, extension)
  // pair — the reader resolves the image via the manifest, not content
  // type detection.
  const lower = url.toLowerCase();
  let extension = "jpg";
  let mimeType = "image/jpeg";
  if (lower.endsWith(".png")) {
    extension = "png";
    mimeType = "image/png";
  } else if (lower.endsWith(".gif")) {
    extension = "gif";
    mimeType = "image/gif";
  } else if (lower.endsWith(".webp")) {
    extension = "webp";
    mimeType = "image/webp";
  } else if (lower.endsWith(".svg")) {
    extension = "svg";
    mimeType = "image/svg+xml";
  } else if (lower.endsWith(".jpeg") || lower.endsWith(".jpg")) {
    extension = "jpg";
    mimeType = "image/jpeg";
  }
  return { bytes, mimeType, extension };
}

function buildChapterHtml(
  fc: FlatChapter,
  novel: SourceNovel,
  imageMap: Map<string, string>,
): DocChapter {
  const ch = fc.sourceChapter;
  const isFirstOfVolume = ch === firstChapterOfVolume(novel, fc.volumeId);
  const dirAttr = novel.direction === "rtl" ? ' dir="rtl"' : "";

  const lineHtml = ch.lines
    .map((ln) => renderLine(ln, imageMap, dirAttr))
    .join("\n  ");

  // Volume separator: when a novel has multiple volumes, prepend a small
  // volume heading on the first chapter of each volume so the reader
  // shows "Volume 2" as a context marker before the chapter title. The
  // TOC still has one entry per chapter; the volume label is in-body only.
  const volumeHeader =
    fc.multiVolume && isFirstOfVolume
      ? `<h2 class="volume-heading"${dirAttr}>${escapeHtml(
          fc.volumeTitle,
        )}</h2>\n  `
      : "";

  const title = fc.multiVolume
    ? `V${fc.volumeId} · ${ch.title}`
    : ch.title;

  const html = `${volumeHeader}<h1${dirAttr}>${escapeHtml(title)}</h1>\n  ${lineHtml}`;

  return { title, html };
}

function firstChapterOfVolume(
  novel: SourceNovel,
  volumeId: number,
): SourceChapter | null {
  const v = novel.volumes.find((x) => x.id === volumeId);
  return v?.chapters[0] ?? null;
}

function renderLine(
  line: SourceLine,
  imageMap: Map<string, string>,
  dirAttr: string,
): string {
  if (line.type === "image") {
    const localHref = imageMap.get(line.content);
    if (!localHref) {
      // Image we couldn't download — leave a hint in the body so the user
      // notices rather than silently dropping it.
      return `<p${dirAttr}><em>[Missing image: ${escapeHtml(
        line.content,
      )}]</em></p>`;
    }
    return `<p${dirAttr}><img src="${escapeAttr(localHref)}" alt=""/></p>`;
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
