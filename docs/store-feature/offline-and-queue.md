# Offline novels + download queue

How a source-backed library entry stores its data on disk, what's
available offline, and how chapter downloads are queued and tracked.

## Storage layout

For each source-backed library entry (`kind: "source"`):

```
$APPDATA/leaflet/books/<entry-id>/
├── source.json                  novel metadata + volume index + per-
│                                chapter flags (downloadedAt, readAt)
├── cover.<ext>                  downloaded cover (asset:// URL via
│                                coverSrcFor / convertFileSrc)
├── state.json                   reading position + highlights (shared
│                                with EPUB entries)
└── chapters/                    one folder per downloaded chapter;
    └── 00001/                   absent folder = not yet downloaded
        ├── content.json         { id, lines, fetchedAt }
        ├── img-001.<ext>        inline images, referenced from
        ├── img-002.<ext>        content.json by basename
        └── …
```

`source.json` is the canonical chapter LISTING; `chapters/<id>/content.json`
holds the body of one chapter. The listing is small (a few KB even
for novels with thousands of chapters) and is always available
offline once `Add to library` lands. Chapter bodies are downloaded
on demand.

Chapter content's image lines store **basenames** (e.g.
`"img-001.webp"`), not absolute paths. The reader resolves them to
`asset://` URLs at render time via
`chapterImageSrc(entryId, chapterId, basename)`. That keeps the
persisted shape device-independent and survives Tauri's per-OS
AppData differences.

## What's offline-available

|  | Without downloading any chapter | After downloading chapters |
|---|---|---|
| Library card (cover, title, author) | ✓ | ✓ |
| Novel detail page (synopsis, meta, volumes accordion, chapter titles) | ✓ | ✓ |
| Chapter content (text) | — (streams from source if online) | ✓ |
| Inline images in chapters | — | ✓ |
| Read-state dimming | ✓ (flag travels in source.json) | ✓ |
| Chapter search (when source supports it) | only when online | only when online |

The reader (`SourceStreamReader`) is **local-first**: if a chapter
has been downloaded, it reads from `chapters/<id>/content.json`.
Otherwise it falls back to `source.getChapterContent(url)` — the
chapter is still readable as long as the user is online.

## Per-chapter download flow

```
NovelDetailView's volumes accordion
  └─ ChapterDownloadButton (icon at end of each chapter row)
        click → downloadQueue.enqueue({ entryId, chapterId, … })
        click on a queued job → downloadQueue.cancel(jobId)

downloadQueue (module-scoped, 2 workers)
  └─ worker picks the next queued job
        ├─ downloadChapter(entryId, chapterId)
        │     ├─ readSnapshot(entryId)             # find the URL
        │     ├─ source.getChapterContent(stub)    # fetch lines
        │     ├─ host.fetchBytes(imgUrl) × N       # download images
        │     ├─ rewrite image lines → basenames
        │     ├─ writeChapterContent(entryId, id, lines, imgFiles)
        │     └─ markChapterDownloaded(entryId, id)
        └─ job.status = "done"

DownloadQueueView (library header → download icon)
  └─ subscribes to the queue; shows active + recent jobs with
     progress bars and cancel buttons.
```

The queue keeps **only one** in-flight or queued entry per
(entryId, chapterId) — clicking the download icon twice doesn't
enqueue twice. Re-downloads (e.g., a completed job that the user
wants to refresh) get a new job; the old terminal entry stays in
the "Recent" section until it ages out (50-job cap).

## Read-state dimming

A chapter is marked **read** when one of these happens in the
reader for a library-backed novel:

- The user navigates **away from** the chapter (next or previous).
- The user's scroll position lands on the **last paragraph**.

Both call `markChapterRead(entryId, chapterId)`, which patches
`source.json` (idempotent — a second mark is a no-op). The volumes
accordion in `NovelDetailView` lowers opacity + greys the row when
`readAt` is set.

Pure streaming sessions (Store-side detail view, no library entry)
don't persist this — once the user adds the novel to their library,
new reads start dimming. Older reads (before the entry existed)
aren't backfilled.

## "Download range" repurposed

`DownloadRangeDialog` no longer builds a separate EPUB library entry
from a chapter range. Instead it **enqueues** every chapter in the
range into the existing source-backed entry's download queue.
Already-downloaded chapters in the range are skipped automatically.

The dialog reads the chapter listing from `source.json` first
(offline), falling back to a `source.getNovel` fetch if the entry
predates the snapshot-on-import path.

## Migration

Source-backed entries imported **before** this change have no
`source.json` on disk — only the `BookIndexEntry` in `library.json`.
When the user re-opens the detail view, `NovelDetailView` does a
fresh `source.getNovel` and writes the snapshot. Subsequent opens
are offline. The user doesn't see anything different beyond a brief
fetch on the first reopen.

`addNovelToLibrary` itself is now also "idempotent + refresh": if
the entry already exists, the function refreshes its snapshot from
the source (picking up newly published chapters) and reuses the
existing id, cover, and per-chapter flags. The snapshot writer
preserves `downloadedAt` / `readAt` by URL-matching against the
prior snapshot, so a re-fetch doesn't wipe download or read state.
