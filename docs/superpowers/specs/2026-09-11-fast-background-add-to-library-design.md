# Add to library: instant tap, cover in the background

Date: 2026-09-11

Adding a source-backed novel to the library takes long enough that the button
sits on "Adding…" while the user waits, pinned to the detail page. On a novel
like القس المجنون — 2372 chapters — it is the slowest ordinary action in the
app.

Almost none of that time is work the app needs to do. This design removes the
redundant work, moves what remains off the tap, and routes it through the
background-task machinery Riwaq already has.

## Where the time goes

`addNovelToLibrary` (`src/store/library.ts:773`) runs this sequence, all of it
inside `withIndexLock`:

1. `findSourceEntry` — read `library.json`
2. `source.getNovel(novelUrl)` — **fetch and parse the whole novel page**
3. download the cover — `host.fetchBytes`
4. `writeFile` the cover
5. `writeCoverThumb` — **read that same file back**, decode, downscale, re-encode, write
6. `writeSnapshotFromSourceNovel` — write `source.json`
7. read `library.json`, upsert, write it back

Four of those seven steps are avoidable.

### 1. The novel is fetched twice

`NovelDetailView` calls `source.getNovel(novelUrl)` on mount to render the page
(`src/components/novel/NovelDetailView.tsx:151`). The result — title, author,
volumes, every chapter stub — sits in `state.novel`. It is the only reason the
page has anything on it.

Step 2 throws that away and fetches it again. For KolNovel that is one HTTP
request for a page carrying all 2372 chapter anchors, a `DOMParser` pass over
it, and `parseVolumes` building 2372 objects (`kolnovel-theme.ts:381`) — paid a
second time, for a result the caller already holds.

`NovelHero` is only rendered when `state.novel` is non-null, so the Add button
cannot be tapped without it. The data is always there.

### 2. The lock is held across the network

`withIndexLock` exists to serialize read-modify-write sequences against
`library.json` (`src/store/indexLock.ts`). Wrapping the scrape in it means
every other library mutation in the app queues behind a network round trip —
the lock is doing a job it was never meant to do, for ten times longer than it
needs to.

### 3. Every cover byte crosses the IPC boundary as a JSON number

```rust
pub async fn source_fetch_bytes(...) -> Result<Vec<u8>, String>
```

`src-tauri/src/sources.rs:117`. Tauri serializes a `Vec<u8>` return as a JSON
array — one array element per byte. A 300 KB cover arrives as a 300,000-element
JSON array to parse.

This codebase already knows the fix and applies it elsewhere. `zip_read_bytes`
and `read_file_range` in `src-tauri/src/archive.rs` both return
`tauri::ipc::Response`, with the reason written down at `archive.rs:385`:

> Returned through `tauri::ipc::Response` so it travels as an octet-stream over
> the channel/fetch path rather than as a JSON number array.

`source_fetch_bytes` is the one byte-returning command that was left behind.
Fixing it speeds up every cover **and** every inline chapter image the download
queue fetches — not just this flow.

### 4. The cover is written, then read back

`writeCoverThumb(bookId, coverFile)` takes a *filename* and opens it
(`src/store/coverThumb.ts:114`). Its caller wrote that file moments earlier and
still holds the bytes. The encode helper it delegates to, `encodeThumb(bytes)`,
is already exported and already takes bytes — only the wrapper insists on a
round trip through the filesystem.

## The shape

Split the add at the point where local work ends and the network begins.

```
tap Add
  │
  ├─ addNovelToLibrary(sourceId, novelUrl, novel)     ← local only, no network
  │    withIndexLock: readIndex → find existing → mint id → upsert → writeIndex
  │    writeSnapshotFromSourceNovel(...)              ← from memory
  │    → entry
  │
  ├─ button flips to "In library", shelf refreshes
  │
  └─ enqueueLibraryAdd({ entryId, sourceId, novelUrl, coverUrl })
       └─ queue worker: fetch cover → write → thumb from those bytes → patch index
```

The tap costs one index read, one index write, and one `source.json` write.
Nothing it does can block on a network.

`writeTextFile` and `writeFile` in `@tauri-apps/plugin-fs` pass their payload as
the invoke *body*, not as JSON arguments, so the ~300 KB snapshot write is not
subject to the per-byte problem in §3 and can stay on the tap.

### `addNovelToLibrary` takes the novel

```ts
export async function addNovelToLibrary(
  sourceId: string,
  novelUrl: string,
  novel: SourceNovel,
): Promise<BookIndexEntry>
```

Required, not optional. There is one call site
(`NovelDetailView.tsx:260`) and it always has the novel; an optional parameter
would preserve a slow path nothing asks for and nothing tests.

`findSourceEntry` moves **inside** the lock. Today it runs before it, so two
taps landing together can both read "not in library" and both insert. Reading
and writing the index in one critical section closes that, and costs nothing
now that the section is short.

### The queue job

Everything left after the split is the cover, so the cover is the job — a third
kind in `src/store/downloadQueue.ts`, beside `chapter` and `conversion`:

```ts
export interface LibraryAddJob extends JobBase {
  kind: "library-add";
  sourceId: string;
  novelUrl: string;
  coverUrl: string;
}
```

The worker fetches `coverUrl`, writes `cover.<ext>`, derives the thumbnail from
the bytes it already has, and patches `coverFile` / `thumbFile` onto the index
entry under the lock.

The payload is three strings. That matters for resume: a job reloaded as
`interrupted` after the app is killed has everything it needs and re-fetches
nothing. It is also why `sourceId`/`novelUrl` are carried even though the worker
does not read them today — they identify the job in the queue UI and leave the
door open for a re-scrape without a schema change.

No job is enqueued when the novel has no `coverUrl`. Jobs dedupe on
`libraryEntryId`, matching how `enqueue` and `enqueueConversion` already guard.

### The third kind is not free

`DownloadJob` has been a two-member union since it was written, and several
places encode that by testing one kind and treating the other as the `else`.
Each needs an explicit third branch:

| Site | What it does today | Risk if untouched |
|---|---|---|
| `downloadQueue.ts:176` `bumpResolved` | `if chapter … else` → conversion counters | Adds tallied as conversions |
| `downloadQueue.ts:619` `runJob` | `if chapter … else runConversionJob` | Add job dispatched to the conversion worker |
| `downloadNotifier.ts:430` | `dl = active − conversions − imports` | **Adds counted as chapter downloads** — "Downloading 1 chapter" for a cover fetch |
| `DownloadQueueView.tsx:552,560,579` `describe` | `if conversion … else` → chapter wording | Cover fetch described as "Downloaded" / a chapter |
| `DownloadQueueView.tsx:595` `subtitleFor` | `if chapter … else` → conversion modes | Reads a `mode` field the job does not have |

The notifier one is the trap: it derives the download count by *subtraction*, so
it goes wrong silently rather than failing to compile. All five become
exhaustive `switch` statements on `job.kind` so a fourth kind is a type error,
not a wrong label.

`activeQueueCount` in `backgroundTasks.ts` is already kind-agnostic — it counts
`queued | running` — so the Android foreground service keeps itself alive for
add jobs with no change.

### Notification and indicator

Both surfaces the user asked for already exist; neither needs new UI.

- **System notification.** `downloadNotifier.ts` gains an `activeAdds` counter
  in its snapshot, a `status.notif.partAdding` part for the mixed-work line, and
  a lone-add composition mirroring the existing lone-conversion one. It reuses
  the established `ongoing: true` anti-blink contract and the throttle, both
  documented at the top of that file. No transport change.
- **FAB ring.** `importIndicator.ts` reads only `importProgress` today. It
  widens to also report busy for **library-add jobs specifically** — not for
  chapter downloads, which would make the ring spin during every chapter fetch
  and change behaviour nobody asked to change.

New strings land in `src/i18n/en.ts` **and** `src/i18n/ar.ts`.

## What this trades away

For the second or two the job runs, the shelf card shows a placeholder instead
of cover art. `coverSrcFor` returns null when the entry has no `coverFile` or
`thumbFile`, and a source-backed `BookIndexEntry` does not persist the remote
`coverUrl`, so there is no remote fallback for the grid to reach for.

That is the price of the tap being instant, and it is the right side of the
trade: a book that is *there* with art arriving beats a spinner that blocks the
page. Storing `coverUrl` on the entry so the card could fall back to the network
is a separate change and is not in scope here.

The novel-detail page is unaffected — `novelCoverCandidates` already falls back
to the remote URL behind the local file
(`src/components/novelCoverCandidates.ts`).

## Failure and recovery

Cover failure is already non-fatal and stays so. The entry is real and readable
without it; today the failure is a `console.warn`
(`library.ts:813`), and afterwards it is a queue job in `error` state with the
Retry button the Downloads page already renders.

A kill mid-job reloads it as `interrupted`, the same as an interrupted chapter
download, and the same Retry resumes it.

An entry whose `source.json` write failed degrades cleanly too:
`NovelDetailView` treats a missing snapshot as a cache miss and falls through to
a live fetch (`NovelDetailView.tsx:202`).

## Verification

`pnpm check` — format, lint, build, test — plus new unit tests:

- `addNovelToLibrary` issues **zero** `getNovel` calls; the injected source's
  method is asserted un-called.
- It performs no network I/O inside `withIndexLock`.
- Two concurrent calls for the same `(sourceId, novelUrl)` produce one entry.
- `writeCoverThumbFromBytes` reads nothing from disk.
- `LibraryAddJob` lifecycle: enqueue → running → done; dedupe by entry id; retry
  after error; reload as `interrupted`.
- `importIndicator` reports busy for a library-add job and **not** for a chapter
  job.
- The notifier's `dl` count excludes add jobs.

Beyond tests, the tap is measured on the Android emulator before and after
rather than asserted from reasoning: drive the running app's WebView over the
Chrome DevTools Protocol and time the interval from the Add click to the
entry landing in `library.json`. No performance claim goes in the commit
message that did not come off that measurement.

## Files

| File | Change |
|---|---|
| `src-tauri/src/sources.rs` | `source_fetch_bytes` returns `tauri::ipc::Response` |
| `src/sources/host.ts` | `fetchBytes` consumes an `ArrayBuffer` |
| `src/store/library.ts` | `addNovelToLibrary` takes the novel; lock narrowed; lookup moved inside it |
| `src/store/coverThumb.ts` | `writeCoverThumbFromBytes` |
| `src/store/downloadQueue.ts` | `LibraryAddJob`, `enqueueLibraryAdd`, worker, exhaustive switches |
| `src/store/downloadNotifier.ts` | `activeAdds`; `dl` no longer derived by subtraction |
| `src/store/importIndicator.ts` | reflects library-add jobs |
| `src/components/DownloadQueueView.tsx` | row rendering for the new kind |
| `src/components/novel/NovelDetailView.tsx` | pass the novel; enqueue; optimistic flip |
| `src/i18n/en.ts`, `src/i18n/ar.ts` | new strings |
