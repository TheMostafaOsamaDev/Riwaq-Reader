# Instant Add to Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Add to library" land instantly by doing only local work on the tap, and move the cover fetch into the existing download queue so it gets the system notification, foreground service, persistence and retry that are already built.

**Architecture:** Split the add at the local/network boundary. `addNovelToLibrary` takes the `SourceNovel` the detail view already parsed, writes the index entry and `source.json`, and returns — no network, and the index lock held only for the read-modify-write. The cover becomes a third `DownloadJob` kind (`library-add`) whose worker fetches, writes, thumbnails and patches the entry. Two independent IPC fixes ride along: `source_fetch_bytes` returns raw bytes instead of a JSON number array, and the thumbnail is derived from bytes in hand instead of re-read from disk.

**Tech Stack:** React 19 + Vite + Tauri v2 (desktop + Android), TypeScript, Vitest + happy-dom, Biome, Rust (`reqwest`, `tauri::ipc::Response`).

**Spec:** `docs/superpowers/specs/2026-09-11-fast-background-add-to-library-design.md`

## Global Constraints

- Branch is `perf/instant-add-to-library`, already created off `main`. Do not work on `main`.
- **Never `git add -A` in this repo.** Untracked `CLAUDE.md`, `docs/design/`, `scripts/mac-install.sh` and `pnpm-workspace.yaml` must stay untracked. Stage explicit paths only.
- **Commit style:** the repo writes multi-line commit bodies explaining *why*.
  Match it. Commit messages are the user's own voice: no AI attribution, no
  `Co-Authored-By` trailers.
- Every user-visible string gets a key in **both** `src/i18n/en.ts` and `src/i18n/ar.ts`. A key present in one and missing from the other is a build failure — `ar.ts` is typed against `en.ts`.
- `pnpm check` = `format:check && lint && build && test`. It must pass before the final commit of each task.
- Test runner is Vitest with `happy-dom`. `createImageBitmap` and `OffscreenCanvas` do **not** exist there, so `encodeThumb` returns `null` in tests. Never write a test that depends on a real thumbnail encode.
- Tauri command names are snake_case on the Rust side and invoked by that exact string from JS.
- The repo uses Biome, not ESLint or Prettier. Run `pnpm format` before committing if formatting fails.
- Follow the house comment style: explain *why* a thing is the way it is, not what the line does.

---

### Task 1: Cover bytes stop crossing IPC as a JSON number array

`source_fetch_bytes` returns `Result<Vec<u8>, String>`, which Tauri serializes as a JSON array with one element per byte. `archive.rs` already solved this for `zip_read_bytes` and `read_file_range` with `tauri::ipc::Response`; this command was left behind. Fixing it speeds up every cover **and** every inline chapter image the download queue fetches.

**Files:**
- Modify: `src-tauri/src/sources.rs:113-139`
- Modify: `src/sources/host.ts:46-52`
- Create: `src/sources/host.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `host.fetchBytes(url, options?) => Promise<Uint8Array>` — same signature as today, now tolerant of both an `ArrayBuffer` and a `number[]` reply.

- [ ] **Step 1: Write the failing test**

Create `src/sources/host.test.ts`:

```ts
// source_fetch_bytes used to return Vec<u8>, which Tauri serializes as a
// JSON array — one element per byte, so a 300 KB cover arrived as a
// 300,000-element array to parse. It now returns tauri::ipc::Response and
// the bytes come back as an ArrayBuffer. fetchBytes accepts both, matching
// how @tauri-apps/plugin-fs's own readFile hedges, so a stale command
// binding during development doesn't hand callers a broken Uint8Array.
import { describe, expect, it, vi } from "vitest";

let reply: unknown = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => reply,
}));

import { createHost } from "./host";

describe("fetchBytes", () => {
  it("unwraps an ArrayBuffer reply without copying it through an array", async () => {
    const src = new Uint8Array([137, 80, 78, 71]);
    reply = src.buffer;
    const out = await createHost("kolnovel").fetchBytes("https://x/cover.png");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([137, 80, 78, 71]);
  });

  it("still accepts a number[] reply", async () => {
    reply = [137, 80, 78, 71];
    const out = await createHost("kolnovel").fetchBytes("https://x/cover.png");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([137, 80, 78, 71]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run src/sources/host.test.ts`
Expected: the ArrayBuffer case FAILS — `Uint8Array.from(ArrayBuffer)` yields an empty array, so `Array.from(out)` is `[]`.

- [ ] **Step 3: Change the Rust command to return raw bytes**

In `src-tauri/src/sources.rs`, add `Response` to the `tauri` imports at the top of the file (check whether a `use tauri::...` line already exists and extend it rather than adding a second):

```rust
use tauri::ipc::Response;
```

Then change the signature and the final expression of `source_fetch_bytes`:

```rust
/// Fetch a URL as raw bytes. Returned through `tauri::ipc::Response` so it
/// travels as an octet-stream rather than a JSON number array — the same
/// reason `zip_read_bytes` in archive.rs does. Covers and inline chapter
/// images are the callers, and a 300 KB cover as JSON is 300,000 elements
/// for the webview to parse.
#[tauri::command]
pub async fn source_fetch_bytes(
    url: String,
    options: Option<FetchOptions>,
) -> Result<Response, String> {
```

and the last line of the body:

```rust
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    Ok(Response::new(bytes.to_vec()))
}
```

Leave everything between the signature and that line untouched.

- [ ] **Step 4: Update the JS side**

In `src/sources/host.ts`, replace the `fetchBytes` method:

```ts
    async fetchBytes(url, options) {
      // The command returns `tauri::ipc::Response`, so the bytes arrive as
      // an ArrayBuffer over the raw channel. The `number[]` branch is the
      // same hedge @tauri-apps/plugin-fs keeps in readFile — it costs one
      // instanceof and means a stale command binding degrades to slow
      // rather than to a silently empty buffer.
      const buf = await invoke<ArrayBuffer | number[]>("source_fetch_bytes", {
        url,
        options: normalizeFetchOptions(options),
      });
      return buf instanceof ArrayBuffer ? new Uint8Array(buf) : Uint8Array.from(buf);
    },
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm vitest run src/sources/host.test.ts`
Expected: PASS, both cases.

- [ ] **Step 6: Confirm the Rust compiles**

Run: `cd src-tauri && cargo check && cd ..`
Expected: finishes with no errors. Warnings about unrelated dead code on non-desktop targets are pre-existing and fine.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/sources.rs src/sources/host.ts src/sources/host.test.ts
git commit -m "$(cat <<'EOF'
perf(sources): return fetched bytes as an octet-stream, not a JSON array

source_fetch_bytes returned Vec<u8>, which Tauri serializes with one JSON
number per byte — a 300 KB cover arrived as a 300,000-element array for
the webview to parse. archive.rs already uses tauri::ipc::Response for
exactly this; this command was the one byte-returning holdout.

Every cover and every inline chapter image the download queue fetches
goes through here.
EOF
)"
```

---

### Task 2: Derive the thumbnail from bytes already in hand

`writeCoverThumb(bookId, coverFile)` takes a filename and opens it. Its only callers write that file moments earlier and still hold the bytes, so the cover makes a pointless round trip out to disk and back. `encodeThumb(bytes)` is already exported and already takes bytes.

**Files:**
- Modify: `src/store/coverThumb.ts:113-130`
- Create: `src/store/coverThumbBytes.test.ts`

**Interfaces:**
- Consumes: `encodeThumb(bytes: Uint8Array) => Promise<{bytes: Uint8Array, ext: string} | null>`, `THUMB_STEM`, `bookDir(id)` — all already exist.
- Produces: `writeCoverThumbFromBytes(bookId: string, bytes: Uint8Array) => Promise<string | null>` — returns the written filename (e.g. `"cover-thumb.webp"`) or `null` when the environment can't encode. `writeCoverThumb(bookId, coverFile)` keeps its existing signature and behaviour.

- [ ] **Step 1: Write the failing test**

Create `src/store/coverThumbBytes.test.ts`:

```ts
// The import path writes the cover, then used to read the very same file
// back to derive its thumbnail — a full image out over IPC and straight
// back in. writeCoverThumbFromBytes takes the bytes the caller already
// holds, so nothing touches the filesystem on the read side.
//
// happy-dom has no createImageBitmap/OffscreenCanvas, so encodeThumb
// returns null here and no thumbnail is written. That is fine: what this
// test pins is that the READ never happens, which is true either way.
import { describe, expect, it, vi } from "vitest";

let readFileCalls = 0;

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async () => true,
  readFile: async () => {
    readFileCalls++;
    return new Uint8Array([1, 2, 3]);
  },
  writeFile: async () => {},
}));

import { writeCoverThumbFromBytes } from "./coverThumb";

describe("writeCoverThumbFromBytes", () => {
  it("never reads the cover back off disk", async () => {
    readFileCalls = 0;
    await writeCoverThumbFromBytes("book-1", new Uint8Array([1, 2, 3]));
    expect(readFileCalls).toBe(0);
  });

  it("returns null rather than throwing when the environment can't encode", async () => {
    // A missing thumbnail is a slow cover, not a failed import — callers
    // fall back to the original and must never see an exception.
    await expect(
      writeCoverThumbFromBytes("book-1", new Uint8Array([1, 2, 3])),
    ).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run src/store/coverThumbBytes.test.ts`
Expected: FAIL — `writeCoverThumbFromBytes` is not exported from `./coverThumb`.

- [ ] **Step 3: Add the bytes-first helper and make the file-based one delegate**

In `src/store/coverThumb.ts`, replace the whole `writeCoverThumb` function (currently the last function in the file) with these two:

```ts
/** Write `cover-thumb.<ext>` for a book from cover bytes the caller already
 *  holds. Returns the thumbnail's filename, or null if the environment can't
 *  encode or the image won't decode — in which case the UI falls back to the
 *  original. Never throws: a missing thumbnail is a slow cover, not a failed
 *  import. */
export async function writeCoverThumbFromBytes(
  bookId: string,
  bytes: Uint8Array,
): Promise<string | null> {
  try {
    const thumb = await encodeThumb(bytes);
    if (!thumb) return null;
    const name = `${THUMB_STEM}.${thumb.ext}`;
    await writeFile(`${bookDir(bookId)}/${name}`, thumb.bytes, { baseDir: BASE });
    return name;
  } catch {
    return null;
  }
}

/** Derive `cover-thumb.<ext>` for a book from its stored cover file. For
 *  callers that still hold the bytes, `writeCoverThumbFromBytes` skips the
 *  read. */
export async function writeCoverThumb(
  bookId: string,
  coverFile: string,
): Promise<string | null> {
  try {
    const src = `${bookDir(bookId)}/${coverFile}`;
    if (!(await exists(src, { baseDir: BASE }))) return null;
    return await writeCoverThumbFromBytes(
      bookId,
      await readFile(src, { baseDir: BASE }),
    );
  } catch {
    return null;
  }
}
```

The existing imports at the top of the file (`exists`, `readFile`, `writeFile`, `bookDir`, `BASE`) already cover this — do not add any.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run src/store/coverThumbBytes.test.ts`
Expected: PASS, both cases.

- [ ] **Step 5: Confirm the existing thumbnail tests still pass**

Run: `pnpm vitest run src/store/coverThumb.test.ts src/store/coverLifecycle.test.ts`
Expected: PASS. `writeCoverThumb`'s contract is unchanged, so nothing here should move.

- [ ] **Step 6: Commit**

```bash
git add src/store/coverThumb.ts src/store/coverThumbBytes.test.ts
git commit -m "$(cat <<'EOF'
perf(covers): derive the thumbnail from bytes, not from a re-read

writeCoverThumb took a filename, so every caller wrote the cover and then
immediately read the same image back to downscale it. encodeThumb already
took bytes; only the wrapper insisted on the round trip.

writeCoverThumb keeps its signature for callers that genuinely only have a
filename, and now delegates.
EOF
)"
```

---

### Task 3: `addNovelToLibrary` takes the novel and stops holding the lock across the network

This is the main speed win. The detail view already holds the parsed `SourceNovel`; today `addNovelToLibrary` refetches and reparses it, inside the index lock. After this task the tap does one index read, one index write, and one `source.json` write — no network at all.

The cover moves out to a separate exported function that Task 4's worker calls.

**Files:**
- Modify: `src/store/library.ts:773-861` (the whole `addNovelToLibrary` body)
- Modify: `src/components/novel/NovelDetailView.tsx:256-268` (call site, so the build stays green — the enqueue lands in Task 7)
- Create: `src/store/addNovelToLibrary.test.ts`

**Interfaces:**
- Consumes: `writeCoverThumbFromBytes` from Task 2; `withIndexLock`, `readIndex`, `writeIndex`, `bookDir`, `ensureRoot`, `extensionFromCoverUrl` (all already in scope in `library.ts`).
- Produces:
  - `addNovelToLibrary(sourceId: string, novelUrl: string, novel: SourceNovel) => Promise<BookIndexEntry>` — third parameter is **required**.
  - `saveNovelCover(entryId: string, sourceId: string, coverUrl: string) => Promise<void>` — fetches, writes `cover.<ext>`, writes the thumbnail from the same bytes, patches `coverFile`/`thumbFile` onto the index entry. Throws on fetch failure so the queue can mark the job errored.

- [ ] **Step 1: Write the failing test**

Create `src/store/addNovelToLibrary.test.ts`:

```ts
// Adding a novel used to refetch and reparse the whole novel page that the
// detail view had already parsed to render itself — for a 2372-chapter
// novel, the single most expensive thing the tap did. It now takes the
// SourceNovel it is given.
//
// The second half covers the race that opened up when the existing-entry
// lookup ran before the lock instead of inside it: two taps landing
// together both read "not in library" and both insert.
import { beforeEach, describe, expect, it, vi } from "vitest";

let files: Record<string, string> = {};
const dirs = new Set<string>();
let snapshotWrites = 0;
let getSourceCalls = 0;

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (p: string) => p in files || dirs.has(p),
  mkdir: async (p: string) => {
    dirs.add(p);
  },
  readTextFile: async (p: string) => {
    const v = files[p];
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  },
  writeTextFile: async (p: string, data: string) => {
    files[p] = data;
  },
  readFile: async () => new Uint8Array(),
  writeFile: async () => {},
  remove: async () => {},
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
  invoke: async () => {
    throw new Error("addNovelToLibrary must not touch IPC");
  },
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("./legacyRoot", () => ({ migrateLegacyRoot: async () => {} }));
vi.mock("./sourceLibrary", () => ({
  writeSnapshotFromSourceNovel: async () => {
    snapshotWrites++;
    return {};
  },
}));
// If addNovelToLibrary still reaches for the registry, it is still
// refetching — which is exactly what this change removes.
vi.mock("../sources/registry", () => ({
  getSource: () => {
    getSourceCalls++;
    return null;
  },
}));

import { addNovelToLibrary } from "./library";
import { INDEX } from "./paths";

function novelFixture(chapters: number) {
  return {
    title: "القس المجنون",
    author: "Gu Zhen Ren",
    language: "ar",
    direction: "rtl" as const,
    description: "قصة الشرير فانغ يوان",
    tags: [],
    meta: [],
    volumes: [
      {
        id: 1,
        title: "V1",
        chapters: Array.from({ length: chapters }, (_, i) => ({
          id: i + 1,
          title: `Ch ${i + 1}`,
          url: `https://kolnovel.test/ch/${i + 1}`,
          lines: [],
        })),
      },
    ],
  };
}

function indexBooks(): { id: string; title: string; chapterCount: number }[] {
  const raw = files[INDEX];
  return raw ? JSON.parse(raw).books : [];
}

beforeEach(() => {
  files = {};
  dirs.clear();
  snapshotWrites = 0;
  getSourceCalls = 0;
});

describe("addNovelToLibrary", () => {
  it("uses the novel it is handed instead of refetching it", async () => {
    const entry = await addNovelToLibrary(
      "kolnovel",
      "https://kolnovel.test/novel/1",
      novelFixture(2372) as never,
    );

    expect(getSourceCalls).toBe(0);
    expect(entry.title).toBe("القس المجنون");
    expect(entry.chapterCount).toBe(2372);
    expect(entry.kind).toBe("source");
    expect(snapshotWrites).toBe(1);
  });

  it("writes exactly one entry when two taps land together", async () => {
    await Promise.all([
      addNovelToLibrary("kolnovel", "https://kolnovel.test/novel/1", novelFixture(3) as never),
      addNovelToLibrary("kolnovel", "https://kolnovel.test/novel/1", novelFixture(3) as never),
    ]);
    expect(indexBooks()).toHaveLength(1);
  });

  it("re-adding an existing novel keeps its id and addedAt", async () => {
    const first = await addNovelToLibrary(
      "kolnovel",
      "https://kolnovel.test/novel/1",
      novelFixture(3) as never,
    );
    const second = await addNovelToLibrary(
      "kolnovel",
      "https://kolnovel.test/novel/1",
      novelFixture(9) as never,
    );
    expect(second.id).toBe(first.id);
    expect(second.addedAt).toBe(first.addedAt);
    // The refreshed listing is what the user asked for.
    expect(second.chapterCount).toBe(9);
    expect(indexBooks()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run src/store/addNovelToLibrary.test.ts`
Expected: FAIL — the current implementation calls `getSource` (so `getSourceCalls` is 1) and then throws on the null source.

- [ ] **Step 3: Rewrite `addNovelToLibrary` and add `saveNovelCover`**

In `src/store/library.ts`, replace the entire `addNovelToLibrary` function (lines 773-861) with:

```ts
/** Mint a fresh book id. `crypto.randomUUID` is present in both webviews we
 *  ship; the fallback is for the test environment and any host that hides it
 *  outside a secure context. */
function newBookId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Put a source-backed novel in the library.
 *
 * `novel` is passed in rather than fetched: the caller is the novel detail
 * view, which cannot render the Add button at all until `source.getNovel`
 * has resolved. Refetching it here meant paying for a full page fetch and a
 * DOM parse of every chapter anchor twice — on a 2372-chapter novel that was
 * the whole of the wait.
 *
 * Nothing here touches the network, so the index lock covers only the
 * read-modify-write it exists for. The cover is a separate, queued job
 * (`saveNovelCover`) — see store/downloadQueue.ts.
 */
export async function addNovelToLibrary(
  sourceId: string,
  novelUrl: string,
  novel: SourceNovel,
): Promise<BookIndexEntry> {
  const { writeSnapshotFromSourceNovel } = await import("./sourceLibrary");

  const chapterCount = novel.volumes.reduce((a, v) => a + v.chapters.length, 0);

  // The existing-entry lookup lives INSIDE the lock. Outside it, two taps
  // landing together both read "not in library" and both insert.
  const entry = await withIndexLock(async () => {
    const idx = await readIndex();
    const existing =
      idx.books.find(
        (b) =>
          b.kind === "source" &&
          b.sourceId === sourceId &&
          b.novelUrl === novelUrl,
      ) ?? null;
    const id = existing?.id ?? newBookId();
    // Spreading `existing` first carries forward everything the entry has
    // accumulated that this call knows nothing about — shelfIds, progress,
    // coverFile, coverBust — and then the fresh listing overrides what the
    // source is authoritative for.
    const next: BookIndexEntry = {
      ...(existing ?? {}),
      id,
      title: novel.title,
      author: novel.author,
      language: novel.language,
      chapterCount,
      addedAt: existing?.addedAt ?? Date.now(),
      progress: existing?.progress ?? 0,
      kind: "source",
      sourceId,
      novelUrl,
      ...(novel.description ? { description: novel.description } : {}),
    };
    const at = idx.books.findIndex((b) => b.id === id);
    if (at === -1) idx.books.push(next);
    else idx.books[at] = next;
    await writeIndex(idx);
    return next;
  });

  // Outside the lock: neither of these reads or writes library.json, and
  // writeSnapshotFromSourceNovel takes its own per-entry lock.
  const dir = bookDir(entry.id);
  if (!(await exists(dir, { baseDir: BASE }))) {
    await mkdir(dir, { baseDir: BASE, recursive: true });
  }
  await writeSnapshotFromSourceNovel(entry.id, sourceId, novelUrl, novel);

  return entry;
}

/**
 * Fetch a novel's cover, store it, derive its thumbnail, and point the index
 * entry at both. Run from the download queue's `library-add` job, not from
 * the tap — it is the only part of adding a novel that needs the network.
 *
 * Throws on a failed fetch so the queue can mark the job errored and offer
 * Retry. The library entry is already usable without it.
 */
export async function saveNovelCover(
  entryId: string,
  sourceId: string,
  coverUrl: string,
): Promise<void> {
  const { createHost } = await import("../sources/host");
  const bytes = await createHost(sourceId).fetchBytes(coverUrl);

  const dir = bookDir(entryId);
  if (!(await exists(dir, { baseDir: BASE }))) {
    await mkdir(dir, { baseDir: BASE, recursive: true });
  }
  const coverFile = `cover.${extensionFromCoverUrl(coverUrl)}`;
  await writeFile(`${dir}/${coverFile}`, bytes, { baseDir: BASE });
  // Same bytes, no read-back.
  const thumbFile = await writeCoverThumbFromBytes(entryId, bytes);

  await withIndexLock(async () => {
    const idx = await readIndex();
    const entry = idx.books.find((b) => b.id === entryId);
    // The user may have removed the book while the cover was in flight.
    if (!entry) return;
    entry.coverFile = coverFile;
    if (thumbFile) entry.thumbFile = thumbFile;
    await writeIndex(idx);
  });
}
```

- [ ] **Step 4: Fix the imports**

At the top of `src/store/library.ts`, find the import of `writeCoverThumb` from `./coverThumb` and extend it to bring in the new helper:

```ts
import { writeCoverThumb, writeCoverThumbFromBytes } from "./coverThumb";
```

Confirm `SourceNovel` is imported from `../sources/types`. If it is not, add it to the existing type import from that module.

- [ ] **Step 5: Update the one call site so the build stays green**

In `src/components/novel/NovelDetailView.tsx`, replace the `onAddToLibrary` callback (lines 256-268) with:

```ts
  const onAddToLibrary = useCallback(async () => {
    if (working) return;
    const novel = state.novel;
    // The button is only rendered once the novel has loaded, so this is a
    // guard for the type, not a case that happens.
    if (!novel) return;
    setWorking(true);
    try {
      const entry = await addNovelToLibrary(sourceId, novelUrl, novel);
      setLibraryEntryId(entry.id);
      onImportComplete();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("addNovelToLibrary failed:", e);
    } finally {
      setWorking(false);
    }
  }, [working, sourceId, novelUrl, state.novel, onImportComplete]);
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `pnpm vitest run src/store/addNovelToLibrary.test.ts`
Expected: PASS, all three cases.

- [ ] **Step 7: Run the full check**

Run: `pnpm check`
Expected: PASS. If TypeScript complains that `addNovelToLibrary` is called with two arguments somewhere, that call site was missed — there should be exactly one.

- [ ] **Step 8: Commit**

```bash
git add src/store/library.ts src/store/addNovelToLibrary.test.ts src/components/novel/NovelDetailView.tsx
git commit -m "$(cat <<'EOF'
perf(library): add a novel from the listing already in memory

addNovelToLibrary refetched and reparsed the novel page that the detail
view had just parsed to render itself, and did it inside the index lock —
so every other library mutation queued behind a network round trip, and a
2372-chapter novel paid for its chapter listing twice.

The novel is now a required argument. The lock covers only the
read-modify-write, and the existing-entry lookup moves inside it, which
also closes a double-insert on a fast double-tap.

The cover splits out into saveNovelCover for the queue to run.
EOF
)"
```

---

### Task 4: `library-add` becomes a third download-queue job kind

`DownloadJob` has been a two-member union since it was written, and several places encode that as "chapter, else conversion". Each needs a real third branch — the notifier's is the dangerous one because it derives its count by subtraction and so goes wrong silently.

**Files:**
- Modify: `src/store/downloadQueue.ts` — job union (~line 122), `resolvedCounters` (~line 143), `getResolvedCounters` (~line 156), `bumpResolved` (~line 176), `enqueueLibraryAdd` (new, after `enqueueConversion` ~line 240), `runJob` (~line 619), `runLibraryAddJob` (new, after `runConversionJob` ~line 668)
- Create: `src/store/libraryAddJob.test.ts`

**Interfaces:**
- Consumes: `saveNovelCover(entryId, sourceId, coverUrl)` from Task 3.
- Produces:
  - `LibraryAddJob` — exported interface, `kind: "library-add"`, extra fields `sourceId`, `novelUrl`, `coverUrl`.
  - `EnqueueLibraryAddDescriptor` — exported interface: `{ libraryEntryId, novelTitle, sourceId, novelUrl, coverUrl }`, all `string`.
  - `enqueueLibraryAdd(desc: EnqueueLibraryAddDescriptor) => string` — returns the job id; returns an existing job's id instead of duplicating when one for the same `libraryEntryId` is queued or running.
  - `activeLibraryAddCount(jobs: DownloadJob[]) => number` — queued-or-running `library-add` jobs only. Task 5's FAB ring reads it.
  - `getResolvedCounters()` gains `addDone: number` and `addFailed: number`.

- [ ] **Step 1: Write the failing test**

Create `src/store/libraryAddJob.test.ts`:

```ts
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
  saveNovelCover: async (entryId: string, sourceId: string, coverUrl: string) => {
    coverCalls.push({ entryId, sourceId, coverUrl });
    if (coverShouldFail) throw new Error("HTTP 403 for cover");
  },
}));

import {
  activeLibraryAddCount,
  clearTerminals,
  enqueue,
  enqueueLibraryAdd,
  getResolvedCounters,
  getState,
  retry,
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
    enqueueLibraryAdd(descriptor());
    enqueueLibraryAdd(descriptor({ libraryEntryId: "entry-2" }));
    await settle();
    expect(coverCalls.map((c) => c.entryId).sort()).toEqual(["entry-1", "entry-2"]);
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
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run src/store/libraryAddJob.test.ts`
Expected: FAIL — `enqueueLibraryAdd` is not exported from `./downloadQueue`.

- [ ] **Step 3: Add the job kind to the union**

In `src/store/downloadQueue.ts`, immediately after the `ConversionJob` interface and before `export type DownloadJob`, add:

```ts
/** Fetching and storing a novel's cover after `addNovelToLibrary` has
 *  already written the entry and its chapter listing. The entry is usable
 *  the moment the tap returns; this is the part that needs the network.
 *
 *  The payload is deliberately three strings and an id — no parsed novel,
 *  no in-memory handle — so a job reloaded as "interrupted" after an app
 *  kill can resume without refetching anything. */
export interface LibraryAddJob extends JobBase {
  kind: "library-add";
  sourceId: string;
  novelUrl: string;
  coverUrl: string;
}
```

and widen the union:

```ts
export type DownloadJob = ChapterDownloadJob | ConversionJob | LibraryAddJob;
```

- [ ] **Step 4: Give the new kind its own lifetime counters**

Add the two fields to `resolvedCounters`:

```ts
const resolvedCounters = {
  chDone: 0,
  chFailed: 0,
  chCancelled: 0,
  cvDone: 0,
  cvFailed: 0,
  addDone: 0,
  addFailed: 0,
};
```

Widen `getResolvedCounters`'s return type to include `addDone: number;` and `addFailed: number;` (the body already spreads the whole object, so only the annotation changes).

Then replace `bumpResolved`'s body with an exhaustive switch, so a fourth kind is a type error rather than a silently wrong tally:

```ts
/** Adjust the lifetime counters for one job's terminal outcome by `delta`
 *  (+1 on entering a terminal state, -1 on leaving it). Conversions and
 *  library-adds lump error/cancelled together; only chapters distinguish
 *  them, because only chapters get bulk-cancelled. */
function bumpResolved(
  job: DownloadJob,
  status: DownloadJobStatus,
  delta: number,
) {
  switch (job.kind) {
    case "chapter":
      if (status === "done") resolvedCounters.chDone += delta;
      else if (status === "error") resolvedCounters.chFailed += delta;
      else if (status === "cancelled") resolvedCounters.chCancelled += delta;
      return;
    case "conversion":
      if (status === "done") resolvedCounters.cvDone += delta;
      else resolvedCounters.cvFailed += delta; // error or cancelled
      return;
    case "library-add":
      if (status === "done") resolvedCounters.addDone += delta;
      else resolvedCounters.addFailed += delta; // error or cancelled
      return;
  }
}
```

- [ ] **Step 5: Add the enqueue entry point**

Directly after `enqueueConversion`, add:

```ts
export interface EnqueueLibraryAddDescriptor {
  libraryEntryId: string;
  novelTitle: string;
  sourceId: string;
  novelUrl: string;
  coverUrl: string;
}

/** Queue the cover fetch for a novel that is already in the library.
 *  Deduped per entry: re-tapping Add while one is in flight returns the
 *  running job rather than fetching the same cover twice. */
export function enqueueLibraryAdd(desc: EnqueueLibraryAddDescriptor): string {
  const dup = state.jobs.find(
    (j) =>
      j.kind === "library-add" &&
      j.libraryEntryId === desc.libraryEntryId &&
      (j.status === "queued" || j.status === "running"),
  );
  if (dup) return dup.id;
  const job: LibraryAddJob = {
    id: genId(),
    kind: "library-add",
    libraryEntryId: desc.libraryEntryId,
    novelTitle: desc.novelTitle,
    sourceId: desc.sourceId,
    novelUrl: desc.novelUrl,
    coverUrl: desc.coverUrl,
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

/** Queued-or-running library adds. Mirrors `activeQueueCount` in
 *  backgroundTasks.ts: one rule, exported, so the FAB ring and any future
 *  consumer can't drift apart on what "an add is happening" means. */
export function activeLibraryAddCount(jobs: DownloadJob[]): number {
  let n = 0;
  for (const j of jobs) {
    if (j.kind !== "library-add") continue;
    if (j.status === "queued" || j.status === "running") n++;
  }
  return n;
}
```

- [ ] **Step 6: Add the worker and dispatch to it**

Directly after `runConversionJob`, add:

```ts
async function runLibraryAddJob(job: LibraryAddJob): Promise<void> {
  // Dynamic import for the same reason runConversionJob uses one: library.ts
  // pulls in the EPUB pipeline, and the queue module is loaded at boot.
  const { saveNovelCover } = await import("./library");
  if (cancelled.has(job.id)) throw new CancelledError();
  // One network fetch with no sub-steps to report, so the bar just shows
  // motion rather than a fake breakdown.
  job.progress = 0.15;
  job.updatedAt = Date.now();
  emit();
  await saveNovelCover(job.libraryEntryId, job.sourceId, job.coverUrl);
}
```

Then replace the dispatch inside `runJob` — the `if (job.kind === "chapter") { … } else { … }` pair — with:

```ts
    switch (job.kind) {
      case "chapter":
        await runChapterJob(job);
        break;
      case "conversion":
        await runConversionJob(job);
        break;
      case "library-add":
        await runLibraryAddJob(job);
        break;
    }
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `pnpm vitest run src/store/libraryAddJob.test.ts src/store/downloadQueue.test.ts`
Expected: PASS. The existing queue tests must be untouched by this — if one moved, the dispatch switch is wrong.

- [ ] **Step 8: Commit**

```bash
git add src/store/downloadQueue.ts src/store/libraryAddJob.test.ts
git commit -m "$(cat <<'EOF'
feat(downloads): add a library-add job kind for the cover fetch

Adding a novel is now two halves: the tap writes the entry and the chapter
listing from memory, and the cover — the only part that needs the network —
becomes a queue job. That buys the existing notification, foreground
service, persistence, cancel and retry with no new machinery.

The job carries three strings and an entry id, so one reloaded as
interrupted after an app kill resumes without refetching anything.

bumpResolved and runJob become exhaustive switches on job.kind; both used
to treat "not chapter" as "conversion".
EOF
)"
```

---

### Task 5: The notification and the FAB ring learn about adds

Two consumers still assume two job kinds. `downloadNotifier.ts:430` computes the chapter-download count as `active − conversions − imports`, so an add job would be announced as "Downloading 1". And `importIndicator.ts` reads only `importProgress`, so the FAB ring stays dark for a queued add.

**Files:**
- Modify: `src/store/downloadNotifier.ts` — `Snapshot` (~line 120), `burstBase` (~line 157 and its reset ~line 269), `summarize` (~line 208), `resolvedTally` (~line 388), `compose` (~line 428 and the completion summary ~line 531)
- Modify: `src/store/importIndicator.ts`
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts`
- Create: `src/store/libraryAddIndicator.test.ts`

**Interfaces:**
- Consumes: `getResolvedCounters().addDone/.addFailed` and `activeLibraryAddCount(jobs)` from Task 4.
- Produces:
  - `importIndicator(progress, localImporting, addsActive: number)` — third parameter is the count of queued-or-running `library-add` jobs. `useImportIndicator(localImporting)` keeps its one-argument signature and reads the count from the queue itself, so none of its three call sites (`LibrarySidebar.tsx:116`, `MobileBottomNav.tsx:188`, `EmptyState.tsx:18`) change.
  - `chapterDownloadCount(snap)` — exported from `downloadNotifier.ts` for testing only.

- [ ] **Step 1: Write the failing test**

Create `src/store/libraryAddIndicator.test.ts`:

```ts
// The FAB ring is the app's one "background work is happening" light. It
// used to read the import store only, so a queued cover fetch left it dark.
//
// It deliberately does NOT light up for chapter downloads: those already
// have the Downloads page, and spinning the ring for each of a 200-chapter
// burst would be a behaviour change nobody asked for.
import { describe, expect, it, vi } from "vitest";
import { importIndicator } from "./importIndicator";

const idle = {
  active: false,
  minimized: false,
  steps: [],
  overall: 0,
  error: null,
  resultBookId: null,
  finishedAt: null,
};

describe("importIndicator", () => {
  it("is idle with no import and no adds", () => {
    expect(importIndicator(idle, false, 0)).toEqual({
      busy: false,
      ratio: null,
      action: "pick",
    });
  });

  it("spins for an in-flight library add", () => {
    const ind = importIndicator(idle, false, 1);
    expect(ind.busy).toBe(true);
    expect(ind.action).toBe("details");
  });

  it("reports an add as indeterminate — one cover has no meaningful ratio", () => {
    expect(importIndicator(idle, false, 2).ratio).toBeNull();
  });

  it("lets a real import's determinate ratio win over an add", () => {
    const importing = { ...idle, active: true, overall: 0.4 };
    expect(importIndicator(importing, false, 1).ratio).toBe(0.4);
  });
});

describe("chapterDownloadCount", () => {
  it("excludes library adds from the chapter-download count", () => {
    // The bug this replaces: one cover fetch, nothing else, announced as
    // "Downloading 1" because adds weren't subtracted.
    expect(
      chapterDownloadCount({
        active: 1,
        activeConversions: 0,
        activeAdds: 1,
        importActive: false,
      }),
    ).toBe(0);
  });

  it("still counts real chapter downloads alongside an add", () => {
    expect(
      chapterDownloadCount({
        active: 4,
        activeConversions: 0,
        activeAdds: 1,
        importActive: false,
      }),
    ).toBe(3);
  });

  it("subtracts every separately-counted kind at once", () => {
    expect(
      chapterDownloadCount({
        active: 5,
        activeConversions: 1,
        activeAdds: 2,
        importActive: true,
      }),
    ).toBe(1);
  });
});
```

The import line at the top of that test file becomes:

```ts
import { importIndicator } from "./importIndicator";
import { chapterDownloadCount } from "./downloadNotifier";
```

**Mocks this file needs, and why exactly these three.** Both imports reach
`./downloadQueue`, which statically imports `../sources/registry` — three
extension modules and two PNG assets. Cut the graph at that one edge rather
than mocking six things behind it. The real `activeLibraryAddCount` is
covered against the real queue in Task 4's test, so mocking it here loses no
coverage. Put these above the imports:

```ts
vi.mock("./downloadQueue", () => ({
  subscribe: () => () => {},
  getState: () => ({ jobs: [] }),
  activeLibraryAddCount: () => 0,
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  createChannel: async () => {},
  Importance: { Low: 2 },
  isPermissionGranted: async () => false,
  requestPermission: async () => "denied",
}));
vi.mock("./downloadNotifier/transport", () => ({
  DOWNLOAD_NOTIFICATION_ID: 1,
  DOWNLOAD_SUMMARY_ID: 2,
  pushDownloadNotification: async () => {},
  setDockProgress: async () => {},
}));
```

Both functions under test are pure, so the mocked queue is never consulted by
either assertion.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run src/store/libraryAddIndicator.test.ts`
Expected: FAIL — `importIndicator` takes two arguments; the add cases return `busy: false`.

- [ ] **Step 3: Widen the indicator**

Replace the two functions at the bottom of `src/store/importIndicator.ts`:

```ts
export function importIndicator(
  progress: ProgressState,
  localImporting: boolean,
  addsActive: number,
): ImportIndicator {
  // A real import knows its ratio, so it wins the ring even when an add is
  // also in flight.
  if (isImportActive(progress)) {
    return { busy: true, ratio: progress.overall, action: "details" };
  }
  // One cover fetch has no meaningful fraction, so the ring is
  // indeterminate rather than pretending to a percentage.
  if (addsActive > 0) return { busy: true, ratio: null, action: "details" };
  // Local-only: the picker is open, or a commit is still finishing after the
  // reporter already settled.
  if (localImporting) return { busy: true, ratio: null, action: "none" };
  return IDLE;
}

/** Hook form. Subscribes to both the import store and the download queue via
 *  useSyncExternalStore. Chapter downloads are deliberately excluded — the
 *  Downloads page is their indicator; the ring would otherwise flicker
 *  through every chapter of a long burst. */
export function useImportIndicator(localImporting: boolean): ImportIndicator {
  const progress = useImportProgress();
  const queue = useSyncExternalStore(subscribeQueue, getQueueState, getQueueState);
  return importIndicator(
    progress,
    localImporting,
    activeLibraryAddCount(queue.jobs),
  );
}
```

and add the imports it needs at the top of that file:

```ts
import { useSyncExternalStore } from "react";
import {
  activeLibraryAddCount,
  subscribe as subscribeQueue,
  getState as getQueueState,
} from "./downloadQueue";
```

- [ ] **Step 4: Run the indicator test and confirm it passes**

Run: `pnpm vitest run src/store/libraryAddIndicator.test.ts`
Expected: PASS, all four cases.

- [ ] **Step 5: Add the i18n strings**

In `src/i18n/en.ts`, beside the other `status.notif.part*` keys (~line 726):

```ts
  "status.notif.partAdding": "Adding",
  "status.notif.addingTitle": "Adding {novel}",
  "status.notif.addingBody": "Fetching cover",
  "status.notif.novelAdded": "Added to library",
  "status.notif.addFailed": "Cover couldn't be fetched",
```

In `src/i18n/ar.ts`, at the matching position:

```ts
  "status.notif.partAdding": "إضافة",
  "status.notif.addingTitle": "إضافة {novel}",
  "status.notif.addingBody": "جارٍ جلب الغلاف",
  "status.notif.novelAdded": "أُضيف إلى المكتبة",
  "status.notif.addFailed": "تعذّر جلب الغلاف",
```

- [ ] **Step 6: Stop the notifier counting adds as chapter downloads**

In `src/store/downloadNotifier.ts`:

**(a)** Add to the `Snapshot` interface, beside `activeConversions`:

```ts
  /** Queued or running `library-add` jobs. Counted separately so the
   *  chapter-download count — which is derived by subtraction — doesn't
   *  silently absorb them and announce "Downloading 1". */
  activeAdds: number;
  /** The running add's novel title, for the lone-add notification. */
  runningAddTitle: string | null;
```

**(b)** Replace the repeated `burstBase` object literals (its declaration and the reset inside `publish`) with one factory so a third copy can't go stale:

```ts
function emptyBurstBase() {
  return {
    resolved: 0,
    chDone: 0,
    chFailed: 0,
    chCancelled: 0,
    cvDone: 0,
    cvFailed: 0,
    addDone: 0,
    addFailed: 0,
  };
}
let burstBase = emptyBurstBase();
```

and in `publish`, the reset becomes `burstBase = emptyBurstBase();`.

**(c)** In `summarize`, add a counter beside `activeConversions`:

```ts
  let activeAdds = 0;
  let runningAddTitle: string | null = null;
```

inside the `queued | running` branch, beside the conversion line:

```ts
      if (j.kind === "library-add") {
        activeAdds++;
        if (j.status === "running") runningAddTitle = j.novelTitle;
      }
```

and add `activeAdds,` and `runningAddTitle,` to the returned object.

**(d)** In `resolvedTally`, add `addDone: number;` and `addFailed: number;` to the return type and include them in the sum:

```ts
    resolved:
      c.chDone + c.chFailed + c.chCancelled + c.cvDone + c.cvFailed + c.addDone + c.addFailed,
```

**(e)** Fix the subtraction. It is the one piece of arithmetic here that fails *silently* rather than at compile time, so pull it out as an exported pure function above `compose` and give it a test:

```ts
/** Chapter downloads in flight, derived by subtracting the kinds that are
 *  counted separately from the active total.
 *
 *  Exported only so it can be tested. This is subtraction, so a new job
 *  kind that isn't subtracted here does not fail to compile — it quietly
 *  inflates the chapter count and announces a cover fetch as
 *  "Downloading 1". That is exactly what happened when library-add was
 *  added, and the reason this is not inline any more. */
export function chapterDownloadCount(snap: {
  active: number;
  activeConversions: number;
  activeAdds: number;
  importActive: boolean;
}): number {
  return (
    snap.active -
    snap.activeConversions -
    snap.activeAdds -
    (snap.importActive ? 1 : 0)
  );
}
```

Then in `compose`, replace the `dl` line and add the new part:

```ts
    const dl = chapterDownloadCount(snap);
    if (dl > 0) kinds.push(tr("status.notif.partDownloads", { n: dl }));
    if (snap.activeConversions > 0)
      kinds.push(tr("status.notif.partConverting"));
    if (snap.activeAdds > 0) kinds.push(tr("status.notif.partAdding"));
    if (snap.importActive) kinds.push(tr("status.notif.partImporting"));
```

Then, immediately **after** the lone-import block and **before** the conversion block, add the lone-add composition:

```ts
    // Lone add: a cover fetch with nothing else overlapping.
    if (
      snap.activeAdds > 0 &&
      dl === 0 &&
      snap.activeConversions === 0 &&
      !snap.importActive
    ) {
      return {
        title: snap.runningAddTitle
          ? tr("status.notif.addingTitle", { novel: snap.runningAddTitle })
          : tr("status.notif.partAdding"),
        body: tr("status.notif.addingBody"),
        progress: Math.round(snap.activePartial * 100),
        max: 100,
        indeterminate: false,
        ongoing: true,
        tapsToQueue: true,
      };
    }
```

**(f)** In the completion summary, rebase and report the new counters. After the `cvFailed` line:

```ts
  const addDone = Math.max(0, t.addDone - burstBase.addDone);
  const addFailed = Math.max(0, t.addFailed - burstBase.addFailed);
```

add `addDone === 0 && addFailed === 0 &&` to the "nothing actually finished" guard, then in the body parts:

```ts
  if (addDone > 0) bodyParts.push(tr("status.notif.novelAdded"));
```
placed after the `cvDone` line, and:
```ts
  if (addFailed > 0) bodyParts.push(tr("status.notif.addFailed"));
```
placed after the `cvFailed` line.

Finally include it in the title selection:

```ts
  const successKinds =
    (chDone > 0 ? 1 : 0) + (cvDone > 0 ? 1 : 0) + (addDone ? 1 : 0) + (impDone ? 1 : 0);
```
and add `else if (addDone > 0) title = tr("status.notif.novelAdded");` after the `cvDone` branch.

- [ ] **Step 7: Run the full check**

Run: `pnpm check`
Expected: PASS. A missing `ar.ts` key shows up here as a TypeScript error, not at runtime.

- [ ] **Step 8: Commit**

```bash
git add src/store/downloadNotifier.ts src/store/importIndicator.ts src/i18n/en.ts src/i18n/ar.ts src/store/libraryAddIndicator.test.ts
git commit -m "$(cat <<'EOF'
feat(notifications): report library adds, and stop miscounting them

The notifier derived its chapter-download count by subtracting
conversions and imports from the active total, so a library-add job was
silently announced as "Downloading 1". It now counts adds explicitly and
gets its own notification line and completion summary.

The FAB ring reads the queue as well as the import store, so a queued
cover fetch lights it. Chapter downloads stay excluded — the Downloads
page is their indicator, and the ring would flicker through every chapter
of a long burst.
EOF
)"
```

---

### Task 6: The Downloads page renders the new kind

`describe()` and `subtitleFor()` in `DownloadQueueView.tsx` branch on one kind and treat the other as the fallback, so an add job currently renders as "Downloaded" with a subtitle that reads a `mode` field it does not have.

**This task touches UI.** Per `CLAUDE.md`, invoke the `ui-ux-pro-max` skill before writing the JSX and follow its guidance (stack: React 19 + Vite + Tauri; prefer its `react` stack data). The change is wording and status semantics inside an existing row component — no new layout — so expect the skill to confirm the existing row treatment rather than propose a redesign.

**Files:**
- Modify: `src/components/DownloadQueueView.tsx:540-601`
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts`

**Interfaces:**
- Consumes: `LibraryAddJob` from Task 4; `job.novelTitle` from `JobBase` already drives the row title, so only the second line and the status line need work.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Invoke the UI skill**

Run the `ui-ux-pro-max` skill for: "status and subtitle copy for a new row kind in an existing download-queue list, React 19 + Tauri, RTL-capable (Arabic UI)". Apply whatever it says about copy hierarchy and status semantics to the strings below before committing them.

- [ ] **Step 2: Add the strings**

In `src/i18n/en.ts`, beside the other `downloads.status*` keys (~line 506):

```ts
  "downloads.statusFetchingCover": "Fetching cover…",
  "downloads.statusCoverSaved": "Cover saved",
  "downloads.subtitleLibraryAdd": "Cover art",
```

In `src/i18n/ar.ts`, at the matching position:

```ts
  "downloads.statusFetchingCover": "جارٍ جلب الغلاف…",
  "downloads.statusCoverSaved": "تم حفظ الغلاف",
  "downloads.subtitleLibraryAdd": "صورة الغلاف",
```

- [ ] **Step 3: Make `describe` and `subtitleFor` exhaustive**

In `src/components/DownloadQueueView.tsx`, in `describe`, change the `running` case to handle all three kinds:

```ts
    case "running":
      // Conversion jobs carry a free-form `phase` label that's more
      // useful than a bare percentage ("Building EPUB" / "Saving to
      // library" / "Fetching chapter 47 / 213"). That label is produced
      // deep in the conversion pipeline (store/storeConversion.ts) as a
      // stable English string with no `tr` access there — `phaseLabel`
      // maps it to a localized string here, at the point it's rendered.
      if (job.kind === "conversion") {
        return tr("status.phaseWithPercent", {
          phase: phaseLabel(job.phase, tr),
          pct: Math.round(job.progress * 100),
        });
      }
      // One cover fetch has no sub-steps worth a percentage.
      if (job.kind === "library-add") return tr("downloads.statusFetchingCover");
      return tr("status.percentOnly", { pct: Math.round(job.progress * 100) });
```

the `done` case:

```ts
    case "done":
      if (job.kind === "conversion") {
        const n = job.producedEntryIds.length;
        return tr(
          n === 1 ? "downloads.statusSavedOne" : "downloads.statusSavedOther",
          { n },
        );
      }
      if (job.kind === "library-add") return tr("downloads.statusCoverSaved");
      return tr("downloads.statusDownloaded");
```

and replace `subtitleFor` entirely:

```ts
/** Second line of each row: chapter title for chapter jobs, mode
 *  description for conversion jobs, and a plain label for the cover fetch
 *  that follows adding a novel — its novel title is already the row title. */
function subtitleFor(job: DownloadJob, tr: Tr): string {
  switch (job.kind) {
    case "chapter":
      return job.chapterTitle;
    case "library-add":
      return tr("downloads.subtitleLibraryAdd");
    case "conversion":
      return tr(
        job.mode === "single"
          ? "downloads.saveOffline.singleTitle"
          : "downloads.saveOffline.perVolumeTitle",
      );
  }
}
```

The `interrupted` case needs no change: its conversion-specific branch is already guarded on `job.kind === "conversion"`, so an add falls through to `downloads.statusInterruptedResume`, which is correct.

- [ ] **Step 4: Run the full check**

Run: `pnpm check`
Expected: PASS. If TypeScript reports that `subtitleFor` can return `undefined`, a case is missing from the switch.

- [ ] **Step 5: Commit**

```bash
git add src/components/DownloadQueueView.tsx src/i18n/en.ts src/i18n/ar.ts
git commit -m "$(cat <<'EOF'
feat(downloads): render library-add rows in the queue page

describe() and subtitleFor() branched on one kind and treated the other as
the fallback, so a cover fetch showed as "Downloaded" and read a mode
field it does not have. subtitleFor is now an exhaustive switch.
EOF
)"
```

---

### Task 7: The tap enqueues the cover and returns

The detail view still awaits the whole add. After this task the tap writes the entry, flips the button, and hands the cover to the queue.

**This task touches UI** (the button's working state). Invoke `ui-ux-pro-max` per `CLAUDE.md` before changing what the button renders.

**Files:**
- Modify: `src/components/novel/NovelDetailView.tsx:256-268`

**Interfaces:**
- Consumes: `addNovelToLibrary(sourceId, novelUrl, novel)` from Task 3; `enqueueLibraryAdd(desc)` from Task 4.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Invoke the UI skill**

Run the `ui-ux-pro-max` skill for: "primary action button that completes optimistically while background work continues — React 19, existing pill Button with a loading state, RTL-capable".

Step 2 is the default implementation: it keeps `setWorking(true)` around the local write, so the button shows `novel.adding` for the fraction of a second that takes. The open question for the skill is only whether a sub-second loading state is worth showing at all or reads as a flicker. If the skill says drop it, delete the `setWorking`/`finally` pair from Step 2's code and remove the now-unused `working` guard from the dependency array — everything else in Step 2 stands either way.

- [ ] **Step 2: Rewrite the handler**

In `src/components/novel/NovelDetailView.tsx`, replace `onAddToLibrary` with:

```ts
  const onAddToLibrary = useCallback(async () => {
    if (working) return;
    const novel = state.novel;
    // The button isn't rendered until the novel has loaded, so this guards
    // the type rather than a case that happens.
    if (!novel) return;
    setWorking(true);
    try {
      // Local only — index entry + chapter listing from what's already on
      // screen. This is the whole of what the user waits for.
      const entry = await addNovelToLibrary(sourceId, novelUrl, novel);
      setLibraryEntryId(entry.id);
      onImportComplete();
      // The cover is the only part that needs the network, so it goes to
      // the queue: system notification, foreground service, cancel and
      // retry, all already built. Nothing here awaits it.
      if (novel.coverUrl) {
        const { enqueueLibraryAdd } = await import("../../store/downloadQueue");
        enqueueLibraryAdd({
          libraryEntryId: entry.id,
          novelTitle: novel.title,
          sourceId,
          novelUrl,
          coverUrl: novel.coverUrl,
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("addNovelToLibrary failed:", e);
    } finally {
      setWorking(false);
    }
  }, [working, sourceId, novelUrl, state.novel, onImportComplete]);
```

- [ ] **Step 3: Run the full check**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/novel/NovelDetailView.tsx
git commit -m "$(cat <<'EOF'
feat(novel): add to library returns as soon as the entry is written

The tap now does local work only — index entry and chapter listing from
the novel already on screen — and hands the cover fetch to the download
queue. The button flips, the shelf refreshes, and the user can leave the
page while the cover lands.
EOF
)"
```

---

### Task 8: Measure it, and confirm it on a real device

No performance claim ships that did not come off a measurement. This task produces the number and verifies the flow end to end on Android, where the IPC costs actually bite.

**Files:**
- Modify: `docs/superpowers/specs/2026-09-11-fast-background-add-to-library-design.md` (append the measured result)

**Interfaces:**
- Consumes: everything above.
- Produces: a measured before/after figure for the commit message and the spec.

- [ ] **Step 1: Build and run on the emulator**

Run: `pnpm android:dev`
Note from prior work in this repo: if Gradle picks the wrong JDK, the override is the documented one in `docs/ANDROID.md`; a blank launch is usually the AVD rather than the change — count Tauri IPC lines in logcat to tell the difference.

- [ ] **Step 2: Measure the tap**

Attach to the Android WebView over the Chrome DevTools Protocol (`chrome://inspect`, or the CDP endpoint on `localabstract:webview_devtools_remote_<pid>`). In the console, time the add on a large novel:

```js
performance.mark('add-start');
// tap Add in the UI, then:
performance.mark('add-end');
performance.measure('add', 'add-start', 'add-end');
performance.getEntriesByName('add').at(-1).duration;
```

Take the same measurement on `main` (`git stash` the branch or check out `main` into a second worktree) for the before figure. Use the same novel both times — القس المجنون on KolNovel, 2372 chapters, is the case that prompted this.

- [ ] **Step 3: Verify the behaviour by hand on the device**

Confirm each of these, and write down any that fail:

- Tapping Add flips the button and the novel appears on the shelf without a perceptible wait.
- A system notification appears with the novel's title while the cover fetches, and does not blink or re-alert.
- Backgrounding the app mid-fetch does not kill it; the notification keeps updating.
- The cover appears on the shelf card within a few seconds, replacing the placeholder.
- The Downloads page shows the add row with a sane title, subtitle and status.
- Turning on airplane mode before tapping Add: the entry still lands and is readable, the job goes to `error`, and Retry works once the network is back.
- Force-killing the app mid-fetch: the job reloads as `interrupted` and Retry completes it.
- Switching the UI language to Arabic shows the new strings translated and correctly laid out RTL.

- [ ] **Step 3b: Additional checks, added by the final whole-branch review**

These come from reading the finished diff and are the places it predicts an
on-device surprise. Each names why it is worth a look.

- **Cross-compile for Android explicitly.** `source_fetch_bytes` is the one
  command whose target was never built. Its `use tauri::ipc::Response;` is
  deliberately ungated while the `use tauri::{…}` line below it is
  `#[cfg(desktop)]`-gated; the reasoning was verified by inspection against
  `archive.rs`, but not by a compiler. Run
  `cargo check --target aarch64-linux-android`, or a full
  `pnpm android:build`, before merge.
- **Confirm the raw reply shape actually arrives on Android.** `fetchBytes`
  accepts both an `ArrayBuffer` and a `number[]`, so a regression to the slow
  JSON arm would be silent — and the whole point of that change would be lost.
  One `console.log(buf.constructor.name)` over CDP settles it.
- **Foreground-service flap.** `activeQueueCount` is kind-agnostic and
  `syncService` has no debounce, so every add now starts and stops the Android
  foreground service inside about a second. Check whether Android's
  minimum-visibility rule pins that notification for ~5s, and whether a
  heads-up plus vibration fires for what the user experiences as an instant
  tap.
- **Two notifications per tap.** The lone-add "Adding {novel}" (throttled at
  600ms) is followed by the completion "Added to library" (which bypasses the
  throttle). Confirm a sub-second cover fetch does not read as a blink.
- **Wifi-only + cellular.** `meteredHold()` is kind-agnostic, so with
  wifi-only on and a metered link the cover job sits queued indefinitely — the
  ring spins and the notification stays up. Confirm the Downloads page now
  explains why (it should, since adds render there as of the final fix wave).
- **Tap Add on wifi and confirm the in-flight job appears on the Downloads
  page.** The airplane-mode check alone does NOT cover this: an errored job
  lands in `recent` and renders either way, so it would have passed even while
  in-flight adds were invisible.
- **Add, then immediately Remove.** Confirm `books/<id>/` does not reappear on
  disk holding an orphan cover.
- **Force-kill between the index write and the snapshot write** (not only
  mid-cover). The entry self-heals when opened because `NovelDetailView` falls
  through to a live fetch on a missing snapshot — but that needs a network.
  Check the offline case shows a sane error rather than a broken card.
- **RTL:** the Arabic notification title interpolates a possibly-Latin novel
  title into an RTL string. Same shape as the existing `convertingTitle`, but
  worth one screenshot with a Latin-titled novel.

- [ ] **Step 4: Record the result**

Append a short "Measured" section to the spec with the before/after numbers, the device, and the novel used. State what was measured (tap to entry-in-`library.json`), not a vaguer claim.

- [ ] **Step 5: Final full check and commit**

```bash
pnpm check
git add docs/superpowers/specs/2026-09-11-fast-background-add-to-library-design.md
git commit -m "$(cat <<'EOF'
docs(spec): record the measured add-to-library timings
EOF
)"
```

---

## Notes for the reviewer

Two things in this plan are judgment calls rather than mechanics, and are the right places to push back:

1. **The shelf card shows a placeholder cover for a second or two.** A source-backed `BookIndexEntry` does not persist the remote `coverUrl`, so the grid has no remote fallback while the job runs. Storing `coverUrl` on the entry would remove the gap and is a small change — it was deliberately left out of scope. The novel-detail page is unaffected; `novelCoverCandidates` already falls back to the network.

2. **The FAB ring lights for adds but not for chapter downloads.** That asymmetry is intentional (the Downloads page is the chapter indicator, and the ring would flicker through a 200-chapter burst) but it is a defensible thing to disagree with.
