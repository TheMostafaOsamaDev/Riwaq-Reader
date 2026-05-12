# Importer pipeline

`src/sources/importer.ts` turns a source + URL into an EPUB the
library can ingest. Called from two places:

- **Add to library** in `NovelDetailView` → imports every chapter
  the source returns.
- **Download range** in `DownloadRangeDialog` → imports a contiguous
  `chapterIdRange` slice. The resulting library title is suffixed
  with `(Ch. X–Y)` so the shelf shows it's a partial.

## Steps

```
startImport([fetch-index, cover, chapters, images, epub, save])
  │
  ▼
1. getNovel(url)                ──→ index page → title + chapter stubs
2. download cover (best-effort) ──→ Uint8Array
3. fan-out getChapterContent    ──→ 4 workers, populate chapter.lines
4. download inline image URLs   ──→ all unique image URLs, in order
5. buildEpub(meta, chapters, cover, images)
6. importEpubBytes() — DI'd in by store/library.ts (breaks the cycle)
finishImport(entry.id)
```

Step 3's chapter fan-out is a static worker pool, not `Promise.all` —
one slow chapter shouldn't block the batch. Concurrency defaults to 4
(matches the original NovelScraper). Each worker pulls the next index,
fetches, writes back into the array.

A chapter that throws gets a stub `[Failed to load this chapter: <e>]`
text line, so the import doesn't fail wholesale for one bad page.

## Progress reporting

The progress UI is a singleton in `src/store/importProgress.ts`. The
importer is fire-and-forget against it — `beginStep("chapters")`,
`setStepLabel("chapters", "Fetching chapter 47 / 213")`,
`completeStep("chapters")`. Failures call `failStep(currentStepId, msg)`
before re-throwing, so the modal surfaces the error even if the caller
swallows the exception.

A second import while one is in flight gets refused at the top of
`importFromSource` — the progress store is module-scoped, and stomping
on it would break the live UI.
