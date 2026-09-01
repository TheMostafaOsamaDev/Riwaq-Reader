# Open-with file associations + desktop drag-and-drop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the OS hand a book to Riwaq — via "Open with", the Android share sheet, or a drag-and-drop onto the desktop window — instead of the in-app file picker being the only way in.

**Architecture:** Four native sources (macOS `RunEvent::Opened`, Windows/Linux argv + single-instance, Android VIEW/SEND intents, desktop drop) push paths into one Rust-side buffered queue and emit a payload-less wake-up event. The frontend drains that queue on mount and on every event, so a file double-clicked at cold start cannot race the webview's listener. Drained paths go through a new `importPaths()` that reuses the existing `stagePaths` pipeline unchanged.

**Tech Stack:** Tauri 2 (Rust), React 19 + TypeScript, Vite, Vitest, Kotlin/JNI for Android, Tailwind-less inline-style theming via `src/styles/tokens.ts`.

**Spec:** `docs/superpowers/specs/2026-08-31-open-with-and-drag-drop-design.md`

## Global Constraints

- **Branch:** `feat/open-with-and-drag-drop`. Already created and checked out. The working tree has unrelated uncommitted changes from `fix/downloads-progress-percentage` — **stage files by explicit path in every commit, never `git add -A` or `git add .`**
- **Test runner:** `pnpm test` (Vitest). `vitest.config.ts` sets `environment: "node"` and `include: ["src/**/*.test.ts"]` — **`.tsx` files are not collected**. Every test in this plan is a pure-function test in a `.ts` file. Do not write React component tests; they will silently not run.
- **Package manager is pnpm.** Never `npm install`.
- **Supported formats are exactly `epub`, `pdf`, `docx`.** No other extension is ever accepted.
- **i18n:** `src/i18n/en.ts` is the source of truth. Every key added there MUST get an Arabic counterpart in `src/i18n/ar.ts` — the `Messages` type makes a missing key a compile error. Keys are flat and dot-namespaced.
- **Never persist a UI-locale string into stored data.** Titles and authors that can't be determined stay `""` and are localized at display time.
- **Colors come from `src/styles/tokens.ts`**, durations and easings from `src/styles/motion.ts`. No hard-coded hex or `220ms` strings in components. The one exception in this plan is the amber accent `#d4a84a`, which is read from `HIGHLIGHT_COLORS.yellow.dot`.
- **Reduced motion:** any animated component calls `useReducedMotion()` from `src/styles/motion.ts` and collapses to an instant toggle when it returns true.
- **Android JNI rule:** any new static Kotlin field or method reached from Rust MUST get a matching `-keepclassmembers` rule in `src-tauri/gen/android/app/proguard-rules.pro` **in the same commit**. A missing rule compiles and runs in debug and dies only in release.
- **Custom `#[tauri::command]`s need no `capabilities/default.json` entry** in Tauri 2 — being listed in `invoke_handler` is what authorizes them.
- **Commit style:** the repo writes multi-line commit bodies explaining *why*. Match it. No AI/Claude attribution or `Co-Authored-By` trailers.
- **After every Rust change run `cargo check`** from `src-tauri/`. After every TypeScript change run `pnpm build` (which runs `tsc`) or at minimum `pnpm exec tsc --noEmit`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src-tauri/src/opened.rs` | The pending-opens queue, its two commands, and drop classification. Owns nothing else. |
| `src/store/incomingFiles.ts` | Pub-sub + buffer for paths awaiting import. No I/O, no React — pure state, so it is unit-testable. |
| `src/store/incomingFiles.test.ts` | Tests for the queue's drain semantics. |
| `src/store/dedupe.ts` | The hash-match decision, isolated from the filesystem so it can be tested. |
| `src/store/dedupe.test.ts` | Tests for the above. |
| `src/hooks/useIncomingFiles.ts` | Drains the Rust queue on mount / event / visibility change. |
| `src/hooks/useFileDrop.ts` | Subscribes to Tauri's drag-drop events, drives the overlay state. |
| `src/components/DropOverlay.tsx` | The three-state visual. Presentational only — takes state, renders. |

**Modified:**

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | `sha2`, `tauri-plugin-single-instance` |
| `src-tauri/src/lib.rs` | Register the plugin + module, argv scan, `.build()`/`.run()` split |
| `src-tauri/src/archive.rs` | Hash while staging; `StagedFile.hash` |
| `src-tauri/src/notify.rs` | `consume_open_uri` JNI reader |
| `src-tauri/tauri.conf.json` | `bundle.fileAssociations` |
| `src-tauri/gen/android/app/src/main/AndroidManifest.xml` | VIEW + SEND intent filters |
| `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/MainActivity.kt` | `pendingOpenUri` + intent parsing |
| `src-tauri/gen/android/app/proguard-rules.pro` | Keep rule for the new field |
| `src/store/nativeStaging.ts` | `StagedFile.hash` on the TS side |
| `src/store/library.ts` | Split out `importPaths`; `sourceHash` on the index entry; dedupe lookup |
| `src/components/Library.tsx` | Subscribe to incoming files; open-reader-when-single |
| `src/App.tsx` | Mount `useIncomingFiles`, `useFileDrop`, render `DropOverlay` |
| `src/i18n/en.ts`, `src/i18n/ar.ts` | `drop.*` and `status.*` strings |
| `docs/setup.md` | How to test file associations per platform |

**Dependency order:** Task 1 → 2 → 3 unlock the frontend. Tasks 4–6 (desktop native), 7 (Android native) and 8–10 (UI) are independent of each other once 1–3 land.

---

## Task 1: The incoming-files queue

Start here because it is the only part testable without a running app, and everything else consumes it.

**Files:**
- Create: `src/store/incomingFiles.ts`, `src/store/incomingFiles.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pushIncoming(paths: string[]): void`
  - `takeIncoming(): string[]`
  - `onIncoming(fn: () => void): () => void`
  - `hasIncoming(): boolean`

Note on where classification lives: deciding whether a path is a book happens **in Rust** (`classify_drop`, Task 4), not here. A dropped folder is indistinguishable from an extension-less file by name alone, and expanding one needs a directory read the webview cannot do for arbitrary paths. One mechanism, not two — do not add a TypeScript extension checker.

- [ ] **Step 1: Write the failing tests**

Create `src/store/incomingFiles.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasIncoming,
  onIncoming,
  pushIncoming,
  takeIncoming,
} from "./incomingFiles";

describe("incomingFiles", () => {
  beforeEach(() => {
    // Drain any residue so each test starts empty — the store is
    // module-scoped and shared across tests in this file.
    takeIncoming();
  });

  it("holds paths pushed before anyone is listening", () => {
    // The whole point: a file double-clicked at cold start arrives before
    // the Library has mounted. Losing it would lose the feature.
    pushIncoming(["/a.epub"]);
    expect(hasIncoming()).toBe(true);
    expect(takeIncoming()).toEqual(["/a.epub"]);
  });

  it("drains exactly once", () => {
    pushIncoming(["/a.epub"]);
    expect(takeIncoming()).toEqual(["/a.epub"]);
    expect(takeIncoming()).toEqual([]);
    expect(hasIncoming()).toBe(false);
  });

  it("accumulates across pushes until drained", () => {
    pushIncoming(["/a.epub"]);
    pushIncoming(["/b.pdf", "/c.docx"]);
    expect(takeIncoming()).toEqual(["/a.epub", "/b.pdf", "/c.docx"]);
  });

  it("notifies subscribers on push", () => {
    const fn = vi.fn();
    const off = onIncoming(fn);
    pushIncoming(["/a.epub"]);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    pushIncoming(["/b.pdf"]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("ignores an empty push", () => {
    // Rust drains its queue unconditionally and can legitimately return
    // nothing; that must not wake every subscriber for no reason.
    const fn = vi.fn();
    const off = onIncoming(fn);
    pushIncoming([]);
    expect(fn).not.toHaveBeenCalled();
    expect(hasIncoming()).toBe(false);
    off();
  });

  it("keeps one subscriber's throw from starving the others", () => {
    const good = vi.fn();
    const offBad = onIncoming(() => {
      throw new Error("boom");
    });
    const offGood = onIncoming(good);
    pushIncoming(["/a.epub"]);
    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run src/store/incomingFiles.test.ts`
Expected: FAIL — `Failed to resolve import "./incomingFiles"`.

- [ ] **Step 3: Implement `incomingFiles.ts`**

Create `src/store/incomingFiles.ts`:

```ts
// Paths waiting to be imported, from wherever they came: an "Open with"
// launch, an Android share, or a drag-and-drop.
//
// This is a BUFFER, not just a pub-sub, and that is the whole point. The
// importer lives in Library.tsx, which unmounts behind the reader and
// hasn't mounted at all during a cold launch — exactly the two moments a
// file is most likely to arrive. Paths pushed with nobody listening are
// held here until someone drains them. Mirrors the `pendingStoreSource`
// idiom in uiIntents.ts.

type Listener = () => void;

let pending: string[] = [];
const listeners = new Set<Listener>();

/** Queue paths and wake any subscriber. An empty push is a no-op: Rust
 *  drains its queue unconditionally and can legitimately return nothing. */
export function pushIncoming(paths: string[]): void {
  if (paths.length === 0) return;
  pending = pending.concat(paths);
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      // One bad subscriber must not starve the rest, and must not leave
      // the paths stuck in the queue.
      // eslint-disable-next-line no-console
      console.warn("[incomingFiles] listener threw:", e);
    }
  }
}

/** Take everything queued, leaving the queue empty. Safe to call when
 *  empty — returns []. */
export function takeIncoming(): string[] {
  const out = pending;
  pending = [];
  return out;
}

/** True when a drain would return something. Lets a subscriber skip
 *  spinning up an import run for nothing. */
export function hasIncoming(): boolean {
  return pending.length > 0;
}

/** Subscribe to arrivals. Returns an unsubscribe function. */
export function onIncoming(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/store/incomingFiles.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: all green. No pre-existing test should break.

- [ ] **Step 6: Commit**

```bash
git add src/store/incomingFiles.ts src/store/incomingFiles.test.ts
git commit -m "feat(import): a queue for files handed to Riwaq from outside

A buffer rather than a plain pub-sub, because the importer lives in
Library.tsx, which unmounts behind the reader and hasn't mounted at all
during a cold launch — exactly the two moments a file is most likely to
arrive. Paths pushed with nobody listening wait here until drained."
```

---

## Task 2: Content hash while staging

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/archive.rs` (`StagedFile` at :66-72, `stage_import_file` at :193-265)
- Modify: `src/store/nativeStaging.ts` (`StagedFile` interface, `stageImportFile`)
- Create: `src/store/dedupe.ts`, `src/store/dedupe.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - Rust `StagedFile { size: u64, format: String, hash: String }` — hash is lowercase hex SHA-256.
  - TS `StagedFile { size: number; format: BookFormat; hash: string }`
  - `findByHash(entries: { id: string; sourceHash?: string }[], hash: string): string | null`

- [ ] **Step 1: Add the sha2 dependency**

In `src-tauri/Cargo.toml`, in `[dependencies]`, after the `zip` entry:

```toml
# Content hash for import dedup (see archive.rs). Pure Rust and a few KB —
# worth noting against the Android .so budget the profile below tunes for.
# The bytes are already streaming through stage_import_file, so hashing
# costs a pass over data we're touching anyway.
sha2 = "0.10"
```

Run: `cd src-tauri && cargo fetch`
Expected: resolves and updates `Cargo.lock`.

- [ ] **Step 2: Add `hash` to the Rust `StagedFile`**

In `src-tauri/src/archive.rs`, extend the struct (around line 66):

```rust
#[derive(Serialize, Clone)]
pub struct StagedFile {
    pub size: u64,
    /// "epub" | "pdf" | "docx" | "unknown" — sniffed from the bytes, because
    /// Android's SAF picker returns a `content://` URI with no extension.
    pub format: String,
    /// Lowercase hex SHA-256 of the file's bytes. Lets an import recognise a
    /// book the library already holds and reuse it — with its reading
    /// position and highlights — instead of adding a second copy. Computed
    /// during the copy, so it costs a pass over bytes already in hand.
    pub hash: String,
}
```

- [ ] **Step 3: Compute the hash in the copy loop**

In `src-tauri/src/archive.rs`, add the import at the top of the file alongside the other `use` lines:

```rust
use sha2::{Digest, Sha256};
```

Inside `stage_import_file`'s `spawn_blocking` closure, declare the hasher next to `let mut copied: u64 = 0;`:

```rust
let mut hasher = Sha256::new();
```

Feed it inside the read loop, immediately after the `writer.write_all(&buf[..n])` call:

```rust
hasher.update(&buf[..n]);
```

Then, where the closure builds its result (after `let format = sniff_format(...)`), add the field:

```rust
let format = sniff_format(&head, Some(&dest_for_worker));
Ok(StagedFile {
    size: copied,
    format,
    hash: format!("{:x}", hasher.finalize()),
})
```

Note: the existing `Ok(StagedFile { size: copied, ...` block already sets `size` and `format` — add `hash` to it rather than writing a second construction.

- [ ] **Step 4: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: no errors. A warning about an unused import means the `use sha2` line landed in the wrong module — fix before continuing.

- [ ] **Step 5: Mirror the field on the TypeScript side**

In `src/store/nativeStaging.ts`, extend the interface:

```ts
export interface StagedFile {
  size: number;
  format: BookFormat;
  /** Lowercase hex SHA-256 of the file's bytes, computed by Rust during the
   *  copy. Used to recognise a book the library already holds. */
  hash: string;
}
```

and widen the invoke's return type in `stageImportFile`:

```ts
export async function stageImportFile(
  src: string,
  dest: string,
  token: string,
): Promise<StagedFile> {
  const staged = await invoke<{ size: number; format: string; hash: string }>(
    "stage_import_file",
    { src, dest, token },
  );
  return {
    size: staged.size,
    format: staged.format as BookFormat,
    hash: staged.hash,
  };
}
```

- [ ] **Step 6: Write the failing test for the dedupe lookup**

Create `src/store/dedupe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findByHash } from "./dedupe";

describe("findByHash", () => {
  const HASH = "a".repeat(64);

  it("finds the book carrying the hash", () => {
    const id = findByHash(
      [{ id: "one", sourceHash: "b".repeat(64) }, { id: "two", sourceHash: HASH }],
      HASH,
    );
    expect(id).toBe("two");
  });

  it("returns null when nothing matches", () => {
    expect(findByHash([{ id: "one", sourceHash: "b".repeat(64) }], HASH))
      .toBeNull();
  });

  it("skips entries that predate hashing", () => {
    // Books imported before this feature carry no hash. They must never
    // match — including not matching each other — so an old library keeps
    // importing normally instead of silently reusing the wrong book.
    expect(findByHash([{ id: "old" }, { id: "older" }], HASH)).toBeNull();
  });

  it("never matches an empty or missing hash", () => {
    // A staging failure that produced "" must not collide with every
    // hash-less entry in the library.
    expect(findByHash([{ id: "old" }], "")).toBeNull();
    expect(findByHash([{ id: "one", sourceHash: "" }], "")).toBeNull();
  });

  it("returns the first match when a duplicate slipped in earlier", () => {
    const id = findByHash(
      [{ id: "first", sourceHash: HASH }, { id: "second", sourceHash: HASH }],
      HASH,
    );
    expect(id).toBe("first");
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm exec vitest run src/store/dedupe.test.ts`
Expected: FAIL — `Failed to resolve import "./dedupe"`.

- [ ] **Step 8: Implement `dedupe.ts`**

Create `src/store/dedupe.ts`:

```ts
// Recognising a book the library already holds.
//
// "Open with" makes re-opening the same file the normal case — someone
// double-clicks the same PDF in Finder every day. Without this, each open
// would add another library entry with its own reading position and its
// own highlights, and the user would slowly lose track of which copy they
// were actually reading.
//
// Split out from library.ts so the decision is testable without a
// filesystem.

/** The only part of a library entry this decision needs. */
export interface HashableEntry {
  id: string;
  /** Absent on books imported before hashing existed. */
  sourceHash?: string;
}

/**
 * Id of the book already holding `hash`, or null.
 *
 * An absent or empty hash never matches. That matters twice: books that
 * predate this feature carry no hash and must keep importing normally, and
 * a staging failure that yielded "" must not collide with all of them at
 * once.
 */
export function findByHash(
  entries: HashableEntry[],
  hash: string,
): string | null {
  if (!hash) return null;
  const hit = entries.find((e) => e.sourceHash === hash);
  return hit ? hit.id : null;
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm exec vitest run src/store/dedupe.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 10: Verify the whole suite and typecheck**

Run: `pnpm test && pnpm exec tsc --noEmit && cd src-tauri && cargo check`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/archive.rs \
        src/store/nativeStaging.ts src/store/dedupe.ts src/store/dedupe.test.ts
git commit -m "feat(import): hash staged files so a re-import reuses the book

Open-with makes re-opening the same file the normal case — someone
double-clicks the same PDF in Finder every day. Each open would otherwise
add another library entry with its own reading position and highlights.

stage_import_file already streams every byte to disk, so the SHA-256 is a
pass over data already in hand rather than a second read. An absent hash
never matches, which keeps books that predate this feature importing
normally instead of silently colliding with each other."
```

---

## Task 3: `importPaths` — a second way into the pipeline

**Files:**
- Modify: `src/store/library.ts` (`BookIndexEntry` at :68-99, `stagePaths` at :374-425, `pickBooksForImport` at :433-445)

**Interfaces:**
- Consumes: `findByHash` from Task 2; `StagedFile.hash` from Task 2.
- Produces:
  - `importPaths(paths: string[], report?: ImportReporter): Promise<StagedPick>`
  - `StagedPick` gains `reused: BookIndexEntry[]`
  - `BookIndexEntry` gains `sourceHash?: string`

- [ ] **Step 1: Add `sourceHash` to the index entry**

In `src/store/library.ts`, inside `interface BookIndexEntry` (after the `shelfIds` field):

```ts
  /** Lowercase hex SHA-256 of the file this book was imported from. Absent
   *  on books imported before dedup existed, and on books that never came
   *  from a file at all (source bookmarks). Lets a repeat "Open with" of
   *  the same file reuse this entry — reading position and highlights
   *  intact — instead of adding a second copy. Not backfilled. */
  sourceHash?: string;
```

- [ ] **Step 2: Add `reused` to `StagedPick`**

In `src/store/library.ts`, extend the interface at :323:

```ts
export interface StagedPick {
  autoImported: BookIndexEntry[];
  drafts: FixedImportDraft[];
  errors: { file: string; message: string }[];
  /** True only for folder picks that found no importable files. */
  empty?: boolean;
  /** Books already in the library that the picked files turned out to be
   *  copies of. Nothing was imported for these; the caller opens them as-is. */
  reused?: BookIndexEntry[];
}
```

- [ ] **Step 3: Short-circuit staging on a hash hit**

In `src/store/library.ts`, in `stagePaths`, add `const reused: BookIndexEntry[] = [];` beside the existing `autoImported` / `drafts` / `errors` declarations, and read the index once before the loop:

```ts
  const reused: BookIndexEntry[] = [];
  // Read once, outside the loop: a multi-file drop shouldn't re-read the
  // index per file. Entries imported during this same run are appended
  // below so a batch containing the same book twice still dedupes.
  const known: BookIndexEntry[] = await listBooks();
```

Then, inside the `try` block, immediately after the `stageImportFile` call and before `fixedKindFor`:

```ts
      const staged = await stageImportFile(path, stagedPath, token);

      // Already have this exact file? Drop the staged copy and hand back
      // the existing book, so its reading position and highlights survive.
      const existingId = findByHash(known, staged.hash);
      if (existingId) {
        await deleteStaged(stagedPath);
        const entry = known.find((e) => e.id === existingId);
        if (entry) reused.push(entry);
        continue;
      }

      const fixed = fixedKindFor(staged.format, path);
```

Add the import at the top of the file:

```ts
import { findByHash } from "./dedupe";
```

And return `reused` from `stagePaths`:

```ts
  return { autoImported, drafts, errors, reused };
```

**Note on `continue` inside `try`/`finally`:** the existing `finally { unlisten?.(); }` still runs. That is intended — the progress listener must be torn down on the dedupe path too.

- [ ] **Step 4: Record the hash on newly imported EPUBs**

Newly imported books must record their hash, or the *next* open won't dedupe. Thread it down to where the entry is built rather than writing the index a second time.

**EPUB path.** Add an optional parameter to both functions in `src/store/library.ts`:

```ts
async function importStagedEpub(
  stagedPath: string,
  token: string,
  report?: ImportReporter,
  sourceHash?: string,
): Promise<BookIndexEntry> {
```

```ts
async function commitEpubAt(
  id: string,
  token: string,
  report?: ImportReporter,
  sourceHash?: string,
): Promise<BookIndexEntry> {
```

`importStagedEpub` forwards it: `return await commitEpubAt(id, token, report, sourceHash);`. Inside `commitEpubAt`, set `sourceHash` on the entry object it hands to `appendIndexEntry` — read the function body first and add the field where the entry literal is constructed, so there is exactly one index write.

Then the call site in `stagePaths`:

```ts
      } else if (staged.format === "epub") {
        const entry = await importStagedEpub(
          stagedPath,
          token,
          report,
          staged.hash,
        );
        autoImported.push(entry);
        // A batch containing the same book twice dedupes against itself.
        known.push(entry);
      } else {
```

**PDF/DOCX path.** The entry does not exist until the user confirms the import dialog, so the hash rides on the staged-source object through the draft's `commit` closure. In `src/store/fixedImportStage.ts`, add to the `StagedSource` interface:

```ts
  /** Hash of the picked file, recorded on the committed entry so a repeat
   *  open of the same file reuses this book. */
  sourceHash?: string;
```

`stageFixedImport` already takes `staged?: StagedSource` as its fourth argument and passes it to `stagePdf` / `stageDocx`, so the call site in `stagePaths` only grows a field:

```ts
        drafts.push(
          await stageFixedImport(bytes, path, fixed, {
            stagedPath,
            sourceHash: staged.hash,
          }),
        );
```

Then in `src/store/fixedImport.ts`, `commitPdfBook` and `commitDocxBook` each accept an optional `sourceHash` in their opts and set it on the `BookIndexEntry` they pass to `appendIndexEntry`. Follow the shape those functions already use for optional fields such as `cover`.

`updateBookMeta` is deliberately **not** touched — its patch type at `src/store/library.ts:1099` covers user-editable fields (title, author, description), and a content hash is not one.

- [ ] **Step 5: Split the picker from the importer**

In `src/store/library.ts`, replace `pickBooksForImport` (:433-445) with:

```ts
/**
 * Import a list of already-chosen files. EPUBs import immediately; PDF/DOCX
 * come back as drafts for the title/cover dialog; files the library already
 * holds come back under `reused`.
 *
 * Split out from `pickBooksForImport` so files that arrive from outside the
 * app — an "Open with" launch, an Android share, a drag-and-drop — take the
 * exact same path as picked ones, including the native staging that keeps a
 * 200 MB book off the Android IPC bridge.
 */
export async function importPaths(
  paths: string[],
  report?: ImportReporter,
): Promise<StagedPick> {
  return stagePaths(paths, report);
}

/**
 * Prompt for one or more books, then import them. Null if the user
 * cancelled.
 */
export async function pickBooksForImport(
  report?: ImportReporter,
): Promise<StagedPick | null> {
  const picked = await open({
    multiple: true,
    directory: false,
    filters: [{ name: "Books", extensions: ["epub", "pdf", "docx"] }],
  });
  if (!picked) return null;
  const paths = Array.isArray(picked) ? picked : [picked];
  return importPaths(paths, report);
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean. Expect to fix fallout in `fixedImportStage.ts` / `fixedImport.ts` from Step 4.

- [ ] **Step 7: Run the suite**

Run: `pnpm test`
Expected: all existing tests still pass — `bookFormat.test.ts` and `importReporter.test.ts` in particular.

- [ ] **Step 8: Commit**

```bash
git add src/store/library.ts src/store/fixedImport.ts src/store/fixedImportStage.ts
git commit -m "feat(import): importPaths, a second way into the pipeline

The picker was the only entry point. Splitting the dialog call off from
the import body lets files arriving from outside the app — an Open with
launch, an Android share, a drag-and-drop — take the identical path,
including the native staging that keeps a 200 MB book off the Android IPC
bridge.

Staging now short-circuits on a hash the library already holds: the staged
copy is dropped and the existing book handed back, so its reading position
and highlights survive a re-open. Newly imported books record their hash so
the next open finds them."
```

---

## Task 4: The Rust pending-opens queue

**Files:**
- Create: `src-tauri/src/opened.rs`
- Modify: `src-tauri/src/lib.rs` (module list at :1-3, `invoke_handler` at :13-31)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `opened::push<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>)`
  - command `take_pending_opens() -> Vec<String>`
  - command `classify_drop(paths: Vec<String>) -> DropClassification`, where `DropClassification = { books: string[]; unsupported: string[] }` and `books` already includes files found one level inside dropped folders
  - event `app://opened`, no payload

- [ ] **Step 1: Create the module**

Create `src-tauri/src/opened.rs`:

```rust
// Files handed to Riwaq from outside: an "Open with" launch, an Android
// share, a drag-and-drop.
//
// Why a queue and not just an event. A double-clicked file LAUNCHES the
// app, so Rust learns the path long before the webview exists to hear an
// emit. An event alone would drop the very first open, which is the whole
// feature. So paths land here, and the emit is only a nudge that carries
// no payload — the frontend always drains the queue, which means a
// listener attaching late still sees everything that arrived before it.

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

/// Extensions Riwaq can read. The single source of truth for what a
/// drop will accept — the frontend never second-guesses this list.
/// Note these decide only what the OVERLAY promises; the authoritative
/// check is still the byte sniff in src/store/bookFormat.ts, and
/// stagePaths rejects a file whose bytes disagree with its name.
const SUPPORTED: [&str; 3] = ["epub", "pdf", "docx"];

static PENDING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Event name. Payload-less by design; see the module comment.
const OPENED_EVENT: &str = "app://opened";

/// Queue paths and nudge the frontend. Safe to call before the webview
/// exists — the emit simply reaches nobody, and the drain on mount picks
/// the paths up.
pub fn push<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Ok(mut q) = PENDING.lock() {
        q.extend(paths);
    }
    let _ = app.emit(OPENED_EVENT, ());
}

/// Queue paths without an AppHandle, for callers that run before one
/// exists (the argv scan in setup runs early enough that emitting is
/// pointless anyway — the frontend drains on mount).
pub fn push_silent(paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    if let Ok(mut q) = PENDING.lock() {
        q.extend(paths);
    }
}

#[tauri::command]
pub fn take_pending_opens() -> Vec<String> {
    PENDING
        .lock()
        .map(|mut q| std::mem::take(&mut *q))
        .unwrap_or_default()
}

#[derive(Serialize)]
pub struct DropClassification {
    /// Every book the drop resolved to, including files found one level
    /// inside dropped folders. This is the list the frontend imports.
    pub books: Vec<String>,
    /// Dropped paths that yielded no book — a stray .txt, an empty folder.
    /// Only used to decide whether to say anything about skipped files.
    pub unsupported: Vec<String>,
}

/// Resolve a drop into a list of importable books.
///
/// Rust rather than JS for two reasons: a dropped FOLDER is
/// indistinguishable from an extension-less file by name alone, and
/// expanding one needs a directory read the webview can't do for arbitrary
/// paths. Folders are walked ONE level — a shelf of books is the case
/// worth handling; a recursive walk of a dropped home directory is not.
///
/// Called once per drag-enter, since Tauri's `over` event carries no
/// paths, so the I/O is paid once per drag rather than per mousemove.
#[tauri::command]
pub fn classify_drop(paths: Vec<String>) -> DropClassification {
    let mut books = Vec::new();
    let mut unsupported = Vec::new();

    for p in paths {
        let path = Path::new(&p);
        if path.is_dir() {
            let found = books.len();
            if let Ok(entries) = std::fs::read_dir(path) {
                for entry in entries.flatten() {
                    let child = entry.path();
                    if child.is_file() && is_book(&child) {
                        books.push(child.to_string_lossy().into_owned());
                    }
                }
            }
            // An empty folder, or one holding nothing we can read, is a
            // refusal like any other — otherwise the overlay would accept
            // a drop that imports nothing.
            if books.len() == found {
                unsupported.push(p);
            }
            continue;
        }
        if is_book(path) {
            books.push(p);
        } else {
            unsupported.push(p);
        }
    }

    // read_dir yields in filesystem order, which is arbitrary. Sort so a
    // dropped folder imports in the order the user sees in their file
    // manager.
    books.sort();
    DropClassification { books, unsupported }
}

fn is_book(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}
```

- [ ] **Step 2: Register the module and its commands**

In `src-tauri/src/lib.rs`, add `mod opened;` to the module list at the top (keep the list alphabetical: `archive`, `notify`, `opened`, `sources`).

In the `generate_handler!` list, after `archive::delete_staged,`:

```rust
            opened::take_pending_opens,
            opened::classify_drop,
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: no errors. `push` and `push_silent` will warn as unused — that is expected until Tasks 5 and 7 wire them up. Do not silence the warning with `#[allow(dead_code)]`; it disappears on its own.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/opened.rs src-tauri/src/lib.rs
git commit -m "feat(open): buffered queue for files handed to Riwaq from outside

A double-clicked file launches the app, so Rust learns the path long
before the webview exists to hear an emit. An event alone would drop the
very first open — the whole feature. Paths land in a queue instead, and
the emit is a payload-less nudge, so a listener attaching late still sees
everything that arrived before it.

classify_drop resolves a drop in Rust because a dropped folder is
indistinguishable from an extension-less file by name, and expanding one
needs a directory read the webview can't do for arbitrary paths. One level
deep: a shelf of books is worth handling, a recursive walk of a dropped
home directory is not. It runs once per drag-enter, not per mousemove."
```

---

## Task 5: Desktop delivery — macOS Opened, argv, single instance

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs` (builder at :7-12, `setup` at :32, `.run()` at :101)

**Interfaces:**
- Consumes: `opened::push`, `opened::push_silent` from Task 4.
- Produces: nothing new to the frontend.

- [ ] **Step 1: Add the single-instance plugin**

In `src-tauri/Cargo.toml`, add a desktop-only dependency section. Place it directly above the existing `[target.'cfg(target_os = "android")'.dependencies]` block:

```toml
# Desktop-only: without this, "Open with" on an already-running Riwaq
# starts a SECOND copy of the app pointed at its own library rather than
# handing the file to the window the user is looking at. macOS routes
# opens through RunEvent::Opened instead and doesn't need it, but the
# plugin is harmless there and keeps the three platforms on one path.
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-single-instance = "2"
```

Run: `cd src-tauri && cargo fetch`

- [ ] **Step 2: Register the plugin first**

The single-instance plugin must be the **first** plugin registered or it does not work. In `src-tauri/src/lib.rs`:

```rust
pub fn run() {
    let builder = tauri::Builder::default();

    // MUST be the first plugin registered — the plugin's own requirement.
    // Fires in the ALREADY-RUNNING instance when a second launch happens,
    // which is how Windows and Linux deliver "Open with" to a live window.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(
        |app, argv, _cwd| {
            opened::push(app, book_paths_from_argv(&argv));
        },
    ));

    builder
        .plugin(tauri_plugin_opener::init())
        // …the rest unchanged
```

- [ ] **Step 3: Add the argv filter helper**

Still in `src-tauri/src/lib.rs`, above `pub fn run()`:

```rust
/// Book paths out of a command line, skipping argv[0] and anything that
/// isn't a file that exists.
///
/// Windows and Linux deliver a "Open with" cold start as plain arguments,
/// mixed in with whatever flags the launcher added. Requiring the file to
/// exist is what keeps a stray `--flag` from being queued as a book.
#[cfg(desktop)]
fn book_paths_from_argv(argv: &[String]) -> Vec<String> {
    argv.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter(|a| std::path::Path::new(a).is_file())
        .cloned()
        .collect()
}
```

- [ ] **Step 4: Scan argv at startup**

In the existing `.setup(|app| { … })` closure, before the `LEAFLET_SESSION_SELFTEST` block:

```rust
            // Cold start on Windows / Linux: the file double-clicked in the
            // file manager arrives as an argument. macOS doesn't use argv
            // for this — it sends RunEvent::Opened, handled below.
            #[cfg(desktop)]
            {
                let argv: Vec<String> = std::env::args().collect();
                opened::push_silent(book_paths_from_argv(&argv));
            }
```

- [ ] **Step 5: Split `.run()` so macOS opens can be handled**

`RunEvent::Opened` is only reachable from the two-stage build. At the bottom of `run()`, replace:

```rust
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
```

with:

```rust
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // macOS delivers "Open with" here, for BOTH cold and warm
            // launches — never as argv. The urls are file:// and have to be
            // converted back to paths before staging can open them.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &_event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                opened::push(_app, paths);
            }
        });
```

The `_app` / `_event` underscores keep non-macOS builds warning-free, since the body compiles away there.

- [ ] **Step 6: Verify it compiles for desktop**

Run: `cd src-tauri && cargo check`
Expected: no errors, and the unused-`push` warning from Task 4 is gone.

- [ ] **Step 7: Verify the Android target still compiles**

This is the step that catches a `#[cfg(desktop)]` in the wrong place — the failure mode `lib.rs` already warns about for the selftest block.

Run: `cd src-tauri && cargo check --target aarch64-linux-android`
Expected: no errors. If the target isn't installed, run `rustup target add aarch64-linux-android` first.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs
git commit -m "feat(open): desktop delivery for Open with

Three platforms, two mechanisms. macOS sends RunEvent::Opened for both
cold and warm launches and never uses argv, which needs the two-stage
build/run split to reach. Windows and Linux pass the file as an argument
— argv at startup for a cold launch, and the single-instance plugin to
forward it into the live window otherwise. Without the plugin, opening a
book while Riwaq is running starts a second copy of the app pointed at
its own library."
```

---

## Task 6: File-association declarations

**Files:**
- Modify: `src-tauri/tauri.conf.json` (`bundle` block)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by other tasks. Independent — can be done in any order after Task 5.

- [ ] **Step 1: Declare the three types**

In `src-tauri/tauri.conf.json`, inside `"bundle"`, after the `"icon"` array:

```json
    "fileAssociations": [
      {
        "ext": ["epub"],
        "name": "EPUB Book",
        "description": "EPUB e-book",
        "mimeType": "application/epub+zip",
        "role": "Viewer"
      },
      {
        "ext": ["pdf"],
        "name": "PDF Document",
        "description": "PDF document",
        "mimeType": "application/pdf",
        "role": "Viewer"
      },
      {
        "ext": ["docx"],
        "name": "Word Document",
        "description": "Word document",
        "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "role": "Viewer"
      }
    ],
```

One declaration feeds all three desktop platforms: `CFBundleDocumentTypes` on macOS, installer extension keys on Windows, and `MimeType=` in the `.desktop` file on Linux.

- [ ] **Step 2: Verify the config still parses**

Run: `pnpm exec tauri info`
Expected: prints the environment summary without a config error. A schema violation shows up here as a parse failure.

- [ ] **Step 3: Build and install on macOS**

Run: `pnpm mac:build && pnpm mac:install`
Expected: build succeeds and the app lands in `/Applications`.

**This step is required for any manual verification.** macOS only registers associations for an installed app — a `tauri dev` build never appears in "Open with".

- [ ] **Step 4: Verify registration**

Run:
```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -dump | grep -A 3 -i "riwaq" | head -40
```
Expected: the bundle appears with its declared document types.

Then right-click an `.epub` in Finder → **Open With**. Riwaq should be listed.

**If Riwaq has instead become the default handler for PDF**, that is the risk the spec flagged. Tauri does not expose `LSHandlerRank`. The fix is a custom `Info.plist` merged at bundle time setting `LSHandlerRank` to `Alternate` for each type. Add it, rebuild, re-verify, and note it in the commit body.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(open): declare epub, pdf and docx file associations

One declaration covers all three desktop platforms — CFBundleDocumentTypes
on macOS, installer extension keys on Windows, MimeType= in the .desktop
file on Linux.

role: Viewer asks to be offered rather than to take over. macOS only
registers associations for an INSTALLED app, so verifying this needs
pnpm mac:install; a dev build never appears in Open With."
```

---

## Task 7: Android — intent filters, Kotlin, JNI, ProGuard

**Files:**
- Modify: `src-tauri/gen/android/app/src/main/AndroidManifest.xml`
- Modify: `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/MainActivity.kt`
- Modify: `src-tauri/gen/android/app/proguard-rules.pro`
- Modify: `src-tauri/src/notify.rs`
- Modify: `src-tauri/src/lib.rs` (`invoke_handler`)

**Interfaces:**
- Consumes: nothing from Tasks 4–6 (it uses its own JNI path, mirroring `consume_launch_intent`).
- Produces: command `consume_open_uri() -> Result<Option<String>, String>`

- [ ] **Step 1: Add the intent filters**

In `AndroidManifest.xml`, inside the existing `<activity android:name=".MainActivity">`, after the LAUNCHER `<intent-filter>`:

```xml
            <!-- "Open with": a file manager taps a book at us. Two blocks,
                 because file managers are inconsistent about MIME types. -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:mimeType="application/epub+zip" />
                <data android:mimeType="application/pdf" />
                <data android:mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
            </intent-filter>

            <!-- The common case the block above MISSES: plenty of file
                 managers report a .epub as application/octet-stream, so the
                 MIME match never fires. Fall back to the filename. The host
                 wildcard is required — pathPattern doesn't match without
                 one. -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="content" />
                <data android:scheme="file" />
                <data android:host="*" />
                <data android:mimeType="*/*" />
                <data android:pathPattern=".*\\.epub" />
                <data android:pathPattern=".*\\.pdf" />
                <data android:pathPattern=".*\\.docx" />
            </intent-filter>

            <!-- "Share to": how a book actually leaves Chrome, Downloads,
                 Telegram or WhatsApp. -->
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="application/epub+zip" />
                <data android:mimeType="application/pdf" />
                <data android:mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
            </intent-filter>
```

- [ ] **Step 2: Stash the URI in MainActivity**

In `MainActivity.kt`, extend `rememberLaunchIntent` so it handles book intents alongside the existing notification extra:

```kotlin
    private fun rememberLaunchIntent(intent: Intent) {
        // A book handed to us by another app — "Open with" (VIEW) or the
        // share sheet (SEND). Kept in its own field rather than folded into
        // pendingLaunchIntent, whose contract is the "queue" sentinel.
        val bookUri: Uri? = when (intent.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND ->
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
            else -> null
        }
        if (bookUri != null) {
            pendingOpenUri = bookUri.toString()
            return
        }

        val extra = intent.getStringExtra("leaflet.open") ?: return
        pendingLaunchIntent = extra
    }
```

Add `import android.net.Uri` to the imports at the top of the file.

In the `companion object`, beside `pendingLaunchIntent`:

```kotlin
        /** Stashed content:// (or file://) URI of a book another app asked
         *  us to open. Drained by Rust's consume_open_uri. Same @JvmField
         *  @Volatile reasoning as pendingLaunchIntent above: JNI's
         *  GetStaticFieldID needs a true static field, and the write lands
         *  on a different thread than the read. */
        @JvmField
        @Volatile
        var pendingOpenUri: String? = null
```

`onNewIntent` already calls `rememberLaunchIntent`, so warm delivery needs no further change.

- [ ] **Step 3: Add the ProGuard keep rule in the same commit**

In `proguard-rules.pro`, extend the existing `MainActivity` block:

```proguard
-keepclassmembers class com.leaflet.reader.MainActivity {
    public static void setBarAppearance(android.app.Activity, boolean, int);
    static java.lang.String pendingLaunchIntent;
    static java.lang.String pendingOpenUri;
}
```

Adding the field without this rule compiles and runs fine in debug and dies only in release, which is the failure mode this file's existing comments already warn about.

- [ ] **Step 4: Add the JNI reader**

In `src-tauri/src/notify.rs`, add the command beside `consume_launch_intent` (:151):

```rust
/// Drain the book URI stashed by MainActivity when another app asked us to
/// open a file ("Open with" or the share sheet). Returns the `content://`
/// or `file://` URI, or None.
#[tauri::command]
pub async fn consume_open_uri(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        return Ok(android_consume_open_uri(&app).ok());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(None)
    }
}
```

Then the JNI half, beside `android_consume_intent` (:344). The existing
pair is split in two so the caller can drain a pending exception on every
exit path — keep that split, and keep going through `find_app_class`
rather than `env.find_class`, for the classloader reason documented there.

```rust
#[cfg(target_os = "android")]
fn android_consume_open_uri(
    _app: &AppHandle,
) -> Result<String, Box<dyn std::error::Error>> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }?;
    let mut env = vm.attach_current_thread()?;
    let activity =
        unsafe { JObject::from_raw(ctx.context() as jni::sys::jobject) };

    let res = read_pending_open_uri(&mut env, &activity);
    // Same rule as everywhere else in this module: a field lookup R8
    // renamed away must degrade to "no pending file", not a dead process.
    drain_pending_exception(&mut env);
    res
}

/// Field-access half of [`android_consume_open_uri`], split out so the
/// caller can drain a pending exception on every exit path.
#[cfg(target_os = "android")]
fn read_pending_open_uri<'local>(
    env: &mut jni::JNIEnv<'local>,
    activity: &JObject<'local>,
) -> Result<String, Box<dyn std::error::Error>> {
    let class = find_app_class(env, activity, "com.leaflet.reader.MainActivity")?;
    let value = env.get_static_field(&class, "pendingOpenUri", "Ljava/lang/String;")?;
    let obj: JObject = value.l()?;

    if obj.is_null() {
        return Err("no pending open uri".into());
    }

    let jstr: jni::objects::JString = obj.into();
    let rust_str: String = env.get_string(&jstr)?.into();

    // Clear so subsequent calls return None. `set_static_field` in jni
    // 0.21 expects a `JStaticFieldID`, not a (name, sig) tuple — look up
    // the field id explicitly here.
    let field_id =
        env.get_static_field_id(&class, "pendingOpenUri", "Ljava/lang/String;")?;
    env.set_static_field(&class, field_id, JValue::Object(&JObject::null()))?;

    Ok(rust_str)
}
```

Register the command in `lib.rs`'s `generate_handler!`, beside
`notify::consume_launch_intent`:

```rust
            notify::consume_open_uri,
```

- [ ] **Step 5: Verify both targets compile**

Run: `cd src-tauri && cargo check && cargo check --target aarch64-linux-android`
Expected: no errors on either.

- [ ] **Step 6: Build the debug APK**

Run: `pnpm android:build:debug`
Expected: builds clean.

- [ ] **Step 7: Verify the release build survives ProGuard**

The whole point of Step 3. Run: `pnpm android:build`
Expected: builds, and `pnpm verify:jni` (which `android:build` chains) passes.

- [ ] **Step 8: Verify the intent actually routes**

With the app installed and **not** running:

```bash
adb shell am start -a android.intent.action.VIEW \
  -d "file:///sdcard/Download/test.epub" -t application/epub+zip \
  -n com.leaflet.reader/.MainActivity
```
Expected: Riwaq launches. (It won't import yet — that lands in Task 8.) Confirm the field was set by checking logcat for no `ClassNotFoundException` or `NoSuchFieldError`.

Then repeat with the app already foregrounded to exercise `onNewIntent`.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/gen/android/app/src/main/AndroidManifest.xml \
        src-tauri/gen/android/app/src/main/java/com/leaflet/reader/MainActivity.kt \
        src-tauri/gen/android/app/proguard-rules.pro \
        src-tauri/src/notify.rs src-tauri/src/lib.rs
git commit -m "feat(open): accept books from Android Open with and the share sheet

Two VIEW filters, not one: plenty of file managers report a .epub as
application/octet-stream, so a MIME-typed filter alone misses the common
case and a pathPattern fallback has to cover it. SEND is included because
that is how a book actually leaves Chrome, Downloads or WhatsApp.

The URI gets its own static field rather than being folded into
pendingLaunchIntent, whose contract is the 'queue' sentinel — with its
ProGuard keep rule in this same commit, since a missing rule builds fine
in debug and dies only in release."
```

---

## Task 8: Drain the queue into the importer

**Files:**
- Create: `src/hooks/useIncomingFiles.ts`
- Modify: `src/App.tsx` (hook mounting at :109)
- Modify: `src/components/Library.tsx` (`beginImport` at :500, `importRunner` at :537, `onImport` at :558)
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts`

**Interfaces:**
- Consumes: `pushIncoming` / `takeIncoming` / `onIncoming` / `hasIncoming` (Task 1); `importPaths` and `StagedPick.reused` (Task 3); `take_pending_opens` and the `app://opened` event (Task 4); `consume_open_uri` (Task 7).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the hook**

Create `src/hooks/useIncomingFiles.ts`:

```ts
// Drains files handed to Riwaq from outside — an "Open with" launch, an
// Android share — into the incoming-files queue.
//
// Three triggers for one drain, because no single one covers every case:
// mount catches a cold launch (the paths were queued before any JS ran),
// the app://opened event catches a warm desktop launch, and
// visibilitychange catches Android's warm delivery, where the Kotlin side
// sets a static field rather than emitting. Draining is idempotent, so
// overlapping triggers are harmless.

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { pushIncoming } from "../store/incomingFiles";

async function drainOnce(): Promise<void> {
  try {
    const desktop = (await invoke("take_pending_opens")) as string[] | null;
    if (desktop && desktop.length > 0) pushIncoming(desktop);
  } catch {
    // Command unavailable or transient — the next trigger retries.
  }
  try {
    const uri = (await invoke("consume_open_uri")) as string | null;
    if (uri) pushIncoming([uri]);
  } catch {
    // Non-Android or transient — silent, same as useLaunchIntent.
  }
}

export function useIncomingFiles(): void {
  useEffect(() => {
    void drainOnce();

    let unlisten: (() => void) | undefined;
    void listen("app://opened", () => {
      void drainOnce();
    }).then((fn) => {
      unlisten = fn;
    });

    const onVisible = () => {
      if (document.visibilityState === "visible") void drainOnce();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      unlisten?.();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
```

- [ ] **Step 2: Mount it**

In `src/App.tsx`, beside the existing `useLaunchIntent()` call at :109:

```tsx
  useLaunchIntent();
  // Files handed to us from outside — Open with, the Android share sheet,
  // a drag-and-drop. Lives above the Library for the same reason
  // useLaunchIntent does: the Library subscribes, and it isn't always
  // mounted.
  useIncomingFiles();
```

with `import { useIncomingFiles } from "./hooks/useIncomingFiles";` alongside the existing hook import.

- [ ] **Step 3: Add the strings**

In `src/i18n/en.ts`, beside the other `status.*` keys (near `status.emptyFolderImport` at :570):

```ts
  "status.importBusy": "An import is already running — try again when it finishes.",
  "status.skippedUnsupported": "Skipped {count} file(s) Riwaq can't read.",
  "status.alreadyInLibrary": "Already in your library.",
```

In `src/i18n/ar.ts`, at the matching position:

```ts
  "status.importBusy": "هناك عملية استيراد جارية — أعد المحاولة بعد انتهائها.",
  "status.skippedUnsupported": "تم تخطي {count} ملف لا يمكن لرواق قراءته.",
  "status.alreadyInLibrary": "موجود في مكتبتك بالفعل.",
```

Check how an existing key interpolates a count (`shelves.removedToast` uses `{shelf}`) and match that mechanism exactly.

- [ ] **Step 4: Subscribe in the Library**

In `src/components/Library.tsx`, first generalise `onImport` so the import source is a parameter. Replace its body's picker call:

```tsx
  /** Run one import. `source` supplies the paths — a picker prompt, or a
   *  list that arrived from outside the app. */
  const runImport = async (
    source: (report: ImportReporter) => Promise<StagedPick | null>,
    opts?: { openWhenSingle?: boolean },
  ) => {
    if (importing || importQueue.length > 0) return;
    setImporting(true);
    setImportPct(null);
    setError(null);
    const run = importRunner();
    try {
      const res = await source(run.reporter);
      await beginImport(res, opts);
      run.finish();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      run.fail(message);
      setError(errorLabel(message, tr));
      pendingShelfImportRef.current = null;
    } finally {
      setImporting(false);
      setImportPct(null);
    }
  };

  const onImport = () => runImport((report) => pickBooksForImport(report));
```

Then add the subscription, near the existing `onOpenDownloadQueue` subscriber at :807:

```tsx
  // Files handed to us from outside (Open with, Android share, drag-drop).
  // They queue in the store because this component unmounts behind the
  // reader — draining on mount is what makes a drop mid-chapter survive.
  useEffect(() => {
    const drain = () => {
      if (!hasIncoming()) return;
      if (importing || importQueue.length > 0) {
        showToast("warn", tr("status.importBusy"));
        return;
      }
      const paths = takeIncoming();
      void runImport((report) => importPaths(paths, report), {
        openWhenSingle: true,
      });
    };
    drain();
    return onIncoming(drain);
  }, [importing, importQueue.length, showToast, tr]);
```

Three things about this effect that a reviewer will check:

- **Guard order.** `hasIncoming()` is tested *before* the busy check, so a spurious wake-up doesn't toast "import busy" at a user who dropped nothing.
- **Drain last.** The paths come out of the queue only once the run is definitely starting. A busy refusal leaves them queued for the next attempt rather than dropping them on the floor.
- **`importing` is in the deps on purpose.** The effect resubscribes whenever it flips, so the `drain` closure never captures a stale busy flag and never refuses an import that has already finished. Removing it to quiet the linter would reintroduce exactly that bug.

- [ ] **Step 5: Open the reader for a single book**

In `beginImport`, add the option and honour it only for a single result:

```tsx
  const beginImport = async (
    res: StagedPick | null,
    opts?: { openWhenSingle?: boolean },
  ) => {
```

then, after the existing `if (res.autoImported.length > 0) await refresh();`:

```tsx
    // A file opened from outside meant "read this". Land the user in the
    // reader — but only when there's exactly one book to land on. A
    // multi-file drop has no defensible choice, so it stays in the library
    // and reports through the usual import summary.
    const reused = res.reused ?? [];
    if (reused.length > 0) {
      await refresh();
      showToast("info", tr("status.alreadyInLibrary"));
    }
    const single =
      res.autoImported.length + reused.length === 1 && res.drafts.length === 0
        ? (res.autoImported[0] ?? reused[0])
        : null;
    if (opts?.openWhenSingle && single) {
      onOpen(single.id);
      return;
    }
```

`onOpen` is already a prop on this component (`onOpen: (bookId: string) => void` at :104).

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean. Add the missing imports in `Library.tsx` (`hasIncoming`, `takeIncoming`, `onIncoming`, `importPaths`) as errors point them out.

- [ ] **Step 7: Run the suite**

Run: `pnpm test`
Expected: all green.

- [ ] **Step 8: Verify on macOS end to end**

Run: `pnpm mac:build && pnpm mac:install`, quit Riwaq, then:

```bash
open -a Riwaq ~/Downloads/test.epub
```
Expected: Riwaq launches, imports the book, and lands in the reader.

Run it a second time. Expected: the same book opens, reading position intact, and **no** second library entry.

Then with Riwaq already running, use Finder → Open With → Riwaq on a `.pdf`. Expected: the import dialog appears; on confirm, the reader opens.

- [ ] **Step 9: Verify on Android**

Rebuild and install, then repeat the `adb shell am start` from Task 7 Step 8. Expected: the book imports and opens. Then share a book into Riwaq from another app.

- [ ] **Step 10: Commit**

```bash
git add src/hooks/useIncomingFiles.ts src/App.tsx src/components/Library.tsx \
        src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(open): import and read files handed to Riwaq from outside

Three triggers drive one drain, because no single one covers every case:
mount catches a cold launch, where the path was queued before any JS ran;
the app://opened event catches a warm desktop launch; visibilitychange
catches Android's warm delivery, where Kotlin sets a static field rather
than emitting. Draining is idempotent, so the overlap is harmless.

Opening a file from outside means 'read this', so a single book lands in
the reader. A multi-file drop has no defensible choice about which book
the user meant, so it stays in the library and reports through the usual
import summary."
```

---

## Task 9: Drag-and-drop plumbing

**Files:**
- Create: `src/hooks/useFileDrop.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `classify_drop` (Task 4); `pushIncoming` (Task 1).
- Produces:
  - `type DropState = { kind: "idle" } | { kind: "accept"; count: number } | { kind: "refuse" } | { kind: "received"; count: number }`
  - `useFileDrop(enabled: boolean): DropState`

Both are consumed by Task 10.

- [ ] **Step 1: Write the hook**

Create `src/hooks/useFileDrop.ts`:

```ts
// Desktop drag-and-drop. Turns Tauri's drag events into the overlay's
// state and hands accepted paths to the incoming-files queue.
//
// Resolution happens in Rust on `enter`, not in JS: a dropped FOLDER is
// indistinguishable from an extension-less file by name alone, and
// expanding one needs a directory read the webview can't do for arbitrary
// paths. Tauri's `over` event carries no paths, so this costs one IPC per
// drag rather than one per mousemove.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { pushIncoming } from "../store/incomingFiles";

export type DropState =
  | { kind: "idle" }
  | { kind: "accept"; count: number }
  | { kind: "refuse" }
  | { kind: "received"; count: number };

interface DropClassification {
  /** Books the drop resolved to, folder contents already expanded. */
  books: string[];
  /** Dropped paths that yielded nothing importable. */
  unsupported: string[];
}

const EMPTY: DropClassification = { books: [], unsupported: [] };

/** How long the post-drop confirmation stays up. Long enough to read,
 *  short enough not to sit over the reader. */
const RECEIVED_MS = 1400;

export function useFileDrop(enabled: boolean): DropState {
  const [state, setState] = useState<DropState>({ kind: "idle" });

  useEffect(() => {
    if (!enabled) return;

    let unlisten: (() => void) | undefined;
    let timer: number | undefined;
    let disposed = false;
    // The classification from `enter`, reused on `drop`. Tauri repeats the
    // paths in the drop payload, but re-resolving them there would both
    // re-read every dropped folder and race a file moved mid-drag.
    let latest: DropClassification = EMPTY;

    void getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const p = event.payload;

        if (p.type === "enter") {
          try {
            latest = await invoke<DropClassification>("classify_drop", {
              paths: p.paths,
            });
          } catch {
            // Resolution failed — refuse rather than promise an import we
            // can't describe.
            latest = EMPTY;
          }
          if (disposed) return;
          setState(
            latest.books.length > 0
              ? { kind: "accept", count: latest.books.length }
              : { kind: "refuse" },
          );
          return;
        }

        if (p.type === "leave") {
          latest = EMPTY;
          setState({ kind: "idle" });
          return;
        }

        if (p.type === "drop") {
          const books = latest.books;
          latest = EMPTY;
          if (books.length === 0) {
            setState({ kind: "idle" });
            return;
          }
          pushIncoming(books);
          // Acknowledge the drop itself. The library's import summary
          // confirms completion later — but it is unreachable while the
          // reader is on screen, which is exactly when this matters.
          setState({ kind: "received", count: books.length });
          timer = window.setTimeout(
            () => setState({ kind: "idle" }),
            RECEIVED_MS,
          );
        }
      })
      .then((fn) => {
        // Unmounted before the listener resolved — tear it down now, or it
        // outlives the component.
        if (disposed) fn();
        else unlisten = fn;
      });

    return () => {
      disposed = true;
      unlisten?.();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled]);

  return state;
}
```

- [ ] **Step 2: Mount it in App.tsx**

Add the import, then near the existing `isMobile` derivation:

```tsx
  // Drag-and-drop is desktop-only: Android has no pointer drag onto the
  // window, and Tauri emits no drag events there.
  const dropState = useFileDrop(!isMobile);
```

If `isMobile` isn't yet in scope at that point, move the call below its declaration — it is a plain hook call with no ordering constraint beyond that.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean apart from `dropState` being unused, which Task 10 resolves. If `noUnusedLocals` makes that an error, add `void dropState;` and delete it in Task 10.

- [ ] **Step 4: Verify the events actually fire**

Run: `pnpm tauri dev`, then drag a file over the window with the devtools console open. Add a temporary `console.log(p.type, p.paths)` at the top of the handler if nothing seems to happen.

Expected: `enter` then `drop` (or `leave`). If NO events arrive at all, check that `app.windows[].dragDropEnabled` has not been set to `false` in `tauri.conf.json` — it defaults to `true` and must stay there.

Remove the temporary log before committing.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useFileDrop.ts src/App.tsx
git commit -m "feat(drop): turn Tauri drag events into overlay state

Resolution runs in Rust on enter, not in JS, because a dropped folder is
indistinguishable from an extension-less file by name alone and expanding
one needs a directory read the webview can't do for arbitrary paths.
Tauri's over event carries no paths, so this is one IPC per drag rather
than one per mousemove.

The enter classification is reused on drop rather than recomputed: the
drop payload repeats the paths, but re-resolving would re-read every
dropped folder and race a file moved mid-drag."
```

---

## Task 10: The drop overlay

**Files:**
- Create: `src/components/DropOverlay.tsx`
- Modify: `src/App.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts`

**Interfaces:**
- Consumes: `DropState` from Task 9; `THEMES` / `HIGHLIGHT_COLORS` from `src/styles/tokens.ts`; `MOTION` / `EASE` / `useReducedMotion` from `src/styles/motion.ts`; `Icon` from `src/components/Icon.tsx`.
- Produces: nothing.

- [ ] **Step 1: Add the strings**

In `src/i18n/en.ts`:

```ts
  "drop.accept": "Drop to add",
  "drop.acceptCount": "{count} book(s)",
  "drop.refuse": "Riwaq can't read this",
  "drop.formats": "EPUB · PDF · DOCX",
  "drop.received": "Added to your library",
```

In `src/i18n/ar.ts`:

```ts
  "drop.accept": "أفلت الكتب هنا",
  "drop.acceptCount": "{count} كتاب",
  "drop.refuse": "لا يمكن لرواق قراءة هذا الملف",
  "drop.formats": "EPUB · PDF · DOCX",
  "drop.received": "تمت الإضافة إلى مكتبتك",
```

- [ ] **Step 2: Write the component**

Create `src/components/DropOverlay.tsx`:

```tsx
// The full-window drag-and-drop overlay.
//
// Three states, not two. Refusing has to be VISIBLE — an overlay that
// simply never appears for an unsupported file reads as a broken app —
// and it names the formats, because an error should say how to fix
// itself. "Received" exists because the library's import toast is
// unreachable while the reader is on screen, which is exactly when a drop
// most needs acknowledging.
//
// Purely presentational: it takes state and renders. The drag plumbing
// lives in hooks/useFileDrop.ts.

import type { DropState } from "../hooks/useFileDrop";
import { useT } from "../i18n";
import { EASE, MOTION, useReducedMotion } from "../styles/motion";
import { HIGHLIGHT_COLORS, type Theme } from "../styles/tokens";
import { Icon } from "./Icon";

interface Props {
  state: DropState;
  theme: Theme;
}

/** Warm amber, borrowed from the highlight palette. The point of naming it
 *  here is that it is the ONLY non-theme colour in this component — a
 *  drop target does not need to be blue. */
const ACCENT = HIGHLIGHT_COLORS.yellow.dot;

export function DropOverlay({ state, theme }: Props) {
  const tr = useT();
  const reduced = useReducedMotion();

  // Kept mounted through the exit transition would need a presence
  // wrapper; the overlay is transient enough that an instant unmount on
  // idle is honest and much simpler.
  if (state.kind === "idle") return null;

  const accepting = state.kind === "accept";
  const received = state.kind === "received";

  const icon = received ? "check" : accepting ? "download" : "info";
  const title = received
    ? tr("drop.received")
    : accepting
      ? tr("drop.accept")
      : tr("drop.refuse");
  const subtitle = accepting
    ? tr("drop.acceptCount", { count: String(state.count) })
    : received
      ? null
      : tr("drop.formats");

  return (
    <div
      // Tauri owns the drag: a pointer-catching overlay would swallow the
      // drop it exists to advertise.
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        display: "grid",
        placeItems: "center",
        // Above the reader chrome, the library, and any open dialog.
        zIndex: 9000,
        background: `${theme.bg}e0`,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        opacity: 1,
        transition: reduced
          ? "none"
          : `opacity ${MOTION.med}ms ${EASE.enter}`,
      }}
      // Announced rather than silent, for the same reason the refusing
      // state is visible at all.
      role="status"
      aria-live="polite"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          padding: "32px 40px",
          borderRadius: 16,
          background: theme.paper,
          border: `1px solid ${theme.rule}`,
          boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
          // Centred, icon over text — no directional flip needed for RTL.
          textAlign: "center",
          maxWidth: "min(90vw, 380px)",
          transform: "scale(1)",
          transition: reduced
            ? "none"
            : `transform ${MOTION.med}ms ${EASE.enter}`,
          animation: reduced
            ? undefined
            : `dropCardIn ${MOTION.med}ms ${EASE.enter}`,
        }}
      >
        <Icon
          name={icon}
          size={28}
          color={accepting || received ? ACCENT : theme.muted}
        />
        <div
          style={{
            fontSize: 17,
            fontWeight: 600,
            color: accepting || received ? theme.ink : theme.muted,
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div style={{ fontSize: 14, color: theme.muted }}>{subtitle}</div>
        ) : null}
        {accepting ? (
          <div
            style={{
              width: 48,
              height: 2,
              borderRadius: 2,
              background: ACCENT,
              marginTop: 4,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
```

Add the keyframe to `src/styles/global.css`, beside the app's existing keyframes:

```css
/* Drop overlay card entrance. A two-frame transition rather than a
   keyframe would be safer on WKWebView, but this overlay is desktop-only
   and never mounts there. */
@keyframes dropCardIn {
  from {
    opacity: 0;
    transform: scale(0.98);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
```

**Before writing this, verify three things against the codebase and adjust:**

1. `useT` — check how `src/i18n` actually exposes the translator and how `Library.tsx` calls it (`tr(...)`). Match that import and interpolation shape exactly; `{count}` must use whatever mechanism `shelves.removedToast` uses for `{shelf}`.
2. `Icon` — confirm the export shape and prop names in `src/components/Icon.tsx` (`name`, and whether size/colour are props or come from CSS).
3. `zIndex: 9000` — grep the codebase for the highest existing z-index (check `Lightbox.tsx` and the reader chrome) and go above it rather than trusting this number.

- [ ] **Step 3: Render it**

In `src/App.tsx`, render `<DropOverlay state={dropState} theme={theme} />` as the **last** child of the top-level wrapper, so it layers above the reader, the library, and any open dialog.

- [ ] **Step 4: Typecheck and build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: clean.

- [ ] **Step 5: Verify visually in all four themes**

Run: `pnpm tauri dev`. Then, for each of light / sepia / dark / oled:

1. Drag 3 EPUBs over the window without releasing → accept state, "3 books".
2. Drag a `.txt` → refuse state naming the three formats.
3. Drag 2 EPUBs + 1 `.txt` → accept state showing 2.
4. Drop the EPUBs → received state, then the library import runs.
5. Drag over and back out without dropping → overlay disappears.

Screenshot each theme's accept and refuse state.

- [ ] **Step 6: Verify reduced motion**

Enable **System Settings → Accessibility → Display → Reduce motion** on macOS (or flip the in-app override in Settings, which `setReduceMotionOverride` drives). Repeat the drag. Expected: the overlay appears and disappears instantly, with no scale animation.

- [ ] **Step 7: Verify the drop-while-reading path**

Open a book, scroll into a chapter, and drop an EPUB. Expected: the reader keeps its place and does not navigate; the overlay confirms; returning to the library shows the new book.

- [ ] **Step 8: Commit**

```bash
git add src/components/DropOverlay.tsx src/App.tsx src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(drop): the drag-and-drop overlay

Three states rather than two. Refusing has to be visible — an overlay that
simply never appears for an unsupported file reads as a broken app — and
it names the three formats, because an error should say how to fix itself.
The received state exists because the library's import toast is
unreachable while the reader is on screen, which is exactly when a drop
needs acknowledging.

Built from the existing theme and motion tokens, so it reads as a sibling
of the app's dialogs: warm paper, a hairline rule, an amber accent. No
dashed blue box."
```

---

## Task 11: Document the verification path

**Files:**
- Modify: `docs/setup.md`

- [ ] **Step 1: Add a section**

Append to `docs/setup.md`, matching the file's existing heading level and tone:

```markdown
## Testing file associations

### macOS

macOS only registers associations for an **installed** app. A `tauri dev`
build never appears in "Open With", so testing means installing first:

```bash
pnpm mac:build && pnpm mac:install
```

Confirm the registration took:

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/\
LaunchServices.framework/Support/lsregister -dump | grep -i -A 3 riwaq
```

Then the smoke test — quit Riwaq first, so this exercises the cold-launch
path (`RunEvent::Opened`, not argv; macOS never uses argv for this):

```bash
open -a Riwaq ~/Downloads/test.epub
```

Run it a second time to check dedup: the same book should open with its
reading position intact, and no second library entry should appear.

### Android

```bash
adb shell am start -a android.intent.action.VIEW \
  -d "file:///sdcard/Download/test.epub" -t application/epub+zip \
  -n com.leaflet.reader/.MainActivity
```

Run it once with the app closed (cold, `onCreate`) and once with it
foregrounded (warm, `onNewIntent`) — they are different code paths.

Two VIEW intent-filters exist, not one: many file managers report a
`.epub` as `application/octet-stream`, so the MIME-typed filter misses the
common case and a `pathPattern` filter covers it. Test with a real file
manager, not only `adb`.

**Any new static Kotlin field reached from Rust over JNI needs a matching
keep rule in `proguard-rules.pro`.** Without one the debug build works
perfectly and only the release build dies. Always confirm with
`pnpm android:build`, which chains `verify:jni`.

### Windows and Linux

**Unverified.** The association config in `tauri.conf.json` is shared
across all three desktop platforms, so registration is likely fine; the
untested part is *delivery* — argv on cold start, and
`tauri-plugin-single-instance` forwarding the path into an already-running
window. Without the plugin, opening a book while Riwaq runs starts a
second copy of the app pointed at its own library.

### Drag-and-drop

Desktop only. Dropped folders are read one level deep — a shelf of books
works, a nested tree does not. Everything the drop resolves to is imported
through the same pipeline as the picker.
```

- [ ] **Step 2: Commit**

```bash
git add docs/setup.md
git commit -m "docs(setup): how to verify file associations per platform

macOS only registers associations for an installed app, so the check that
matters is easy to skip and easy to get wrong. Records the Android adb
invocation too, and states plainly that Windows and Linux ship unverified."
```

---

## Verification matrix

Run this in full before opening the PR. Every row is a manual check; the automated suite (`pnpm test`) covers only the pure logic in Tasks 1–3.

| Case | How | Expected |
|---|---|---|
| macOS cold open | quit Riwaq, `open -a Riwaq book.epub` | imports, lands in reader |
| macOS warm open | Riwaq running, Finder → Open With | imports, lands in reader |
| macOS PDF | Open With on a `.pdf` | import dialog, then reader |
| macOS DOCX | Open With on a `.docx` | import dialog, then reader |
| macOS default not stolen | check Preview is still the PDF default | unchanged |
| Android cold VIEW | `adb shell am start -a …VIEW -d file://…` | imports, lands in reader |
| Android warm VIEW | same, app foregrounded | imports, lands in reader |
| Android share-to | Share from Chrome Downloads | imports, lands in reader |
| Android octet-stream | a file manager reporting `application/octet-stream` | Riwaq offered |
| Android release build | `pnpm android:build` | builds; `verify:jni` passes |
| Drop: accepting | drag 3 EPUBs | accept state, "3 books" |
| Drop: refusing | drag a `.txt` | refuse state, formats named |
| Drop: mixed | 2 EPUBs + 1 `.txt` | accept showing 2; 2 imported |
| Drop: folder | a directory of books | accept showing the file count; all import |
| Drop: empty folder | a directory with no books | refuse state |
| Drop while reading | drop mid-chapter | reader keeps place; book appears on return |
| Multi-book open | drop 3 books | stays in library, no reader |
| Drop during an import | drop twice quickly | second queues silently, imports once the first finishes |
| Overlay in 4 themes | light, sepia, dark, oled | legible, warm, no blue |
| Reduced motion | OS setting on | instant, no scale |
| Dedupe | open the same file twice | one entry, position kept |
| Existing library unaffected | open a pre-existing book | reads normally |
