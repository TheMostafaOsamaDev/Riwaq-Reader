# Open-with file associations + desktop drag-and-drop

**Date:** 2026-08-31
**Branch:** feat/open-with-and-drag-drop

## Problem

Riwaq can only take a book in one way: the user opens the app, taps Import,
and drives a file picker. Two consequences:

1. **The OS doesn't know Riwaq reads books.** Double-clicking an `.epub` in
   Finder, tapping a downloaded `.pdf` in an Android file manager, or hitting
   Share on a `.docx` in Chrome never offers Riwaq — it isn't in the
   "Open with" chooser or the Android share sheet at all. `tauri.conf.json`
   declares no `bundle.fileAssociations`, and `AndroidManifest.xml` carries
   only the LAUNCHER filter.
2. **Dragging a book onto the desktop window does nothing.** The window
   silently swallows the drop.

Both are the same missing capability: the import pipeline has exactly one
entry point (a picker the user must find), when it should have several.

## Decisions

From the brainstorming session:

- **Desktop platforms:** macOS, Windows and Linux all get registration.
  macOS and Android are verifiable on this machine; Windows and Linux are
  implemented to spec and shipped **unverified** — called out in the PR body.
- **What happens on open:** import, then land in the reader. The user's
  intent was "read this file", not "file this away". EPUB imports silently
  and opens. PDF/DOCX still show the existing title/cover import dialog
  (it needs their input), then open the reader on confirm.
- **Repeat opens reuse the existing book.** Opening the same file twice must
  not produce two library entries with two separate reading positions.
  Matched on a content hash computed during staging.
- **Drop overlay always appears** for any file drag, in one of two states:
  accepting (≥1 supported file) or refusing (none supported). A mixed drop
  imports what it can and reports what it skipped. Silence would read as a
  broken app.
- **Android gets both** `ACTION_VIEW` (open-with) and `ACTION_SEND`
  (share-to). Share-to is the more common path on Android — it is how a book
  leaves Chrome, Downloads, Telegram or WhatsApp. `ACTION_SEND_MULTIPLE` is
  out of scope.

### Edge cases, resolved

- **"Open the reader" applies to a single book only.** One book in, one
  reader. Two or more — a multi-file drop — imports them all and stays in
  the library, because there is no defensible way to pick which of five
  books the user meant. The library's existing import summary reports the
  batch.
- **Drops are accepted anywhere in the window**, including mid-chapter in
  the reader. The reader is not interrupted and does not navigate away — an
  interruption there would cost the user their place, which is worse than a
  delay in seeing the new book.

  `Library` unmounts behind the reader (`App.tsx` swaps the two through
  `AnimatedSwap`), and it owns the import machinery — the progress reporter
  and the PDF/DOCX dialog. So a drop arriving while the reader or settings
  is on screen is **queued in the store and imported the moment the library
  mounts**, not imported in place. The overlay acknowledges the drop
  immediately with a short confirmation state so the queueing is visible
  rather than silent; the library's existing import summary confirms
  completion later.
- **A drop or open arriving while an import is already running queues
  silently — it is not refused.** `onImport` already guards on
  `importing || importQueue.length > 0`; the drain effect honours the same
  guard by leaving the paths in the incoming-files store instead of taking
  them, and it resubscribes whenever `importing`/`importQueue.length`
  change, so the deferred run starts on its own the moment the current one
  finishes. (Corrected post-launch: this originally toasted a refusal, but
  the code toasted AND imported anyway once free — the toast was a lie —
  and the stated reason for refusing, two progress reporters fighting over
  one Android notification, doesn't apply, since the deferred run only
  starts after the first ends. The overlay's own "received" acknowledgment
  already covers telling the user something happened.)

### Transport: why a buffered queue

Four independent sources produce the same value — a list of paths. Three
candidate transports:

- **Events only** (`app.emit("opened", paths)`) — races cold start. A
  double-clicked file launches the app, and Rust emits before the webview
  has a listener. The first open, which is the whole feature, is lost.
- **Poll only**, as `useLaunchIntent` does today — works for launch, but
  drag-drop needs realtime delivery, so we would end up maintaining two
  mechanisms.
- **Buffered queue + payload-less wake-up event** — chosen. Rust owns a
  `Mutex<Vec<String>>`. Pushing to it also emits `app://opened` with no
  payload. The frontend drains the queue on mount *and* on every event, so
  cold launch, warm launch and drop all take one identical code path and
  nothing can slip between "emitted" and "listening".

## Architecture

### Data flow

```
macOS RunEvent::Opened ─────────┐
Win/Linux argv + single-instance ┤
Android VIEW/SEND intent ────────┼──► Rust PENDING ──► take_pending_opens()
                                 │                            │
desktop drag-drop ───────────────┼────────────────────────────┤
                                 │                            ▼
                                            src/store/incomingFiles.ts
                                                              │
                                            library.ts  importPaths(paths, report)
                                                              │
                            EPUB → auto-import        PDF/DOCX → existing import dialog
                                                              │
                                                        open the reader
```

### Rust: `src-tauri/src/opened.rs` (new)

```rust
static PENDING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Push paths and wake the frontend. The event carries no payload — the
/// frontend always drains the queue, so a listener that attaches late
/// still sees everything that arrived before it.
pub fn push<R: Runtime>(app: &AppHandle<R>, paths: Vec<String>) { … }

#[tauri::command]
pub fn take_pending_opens() -> Vec<String>;   // drains

/// Stat each dropped path so the frontend can render accept/refuse and
/// route folders to the existing folder-import path. A dropped directory
/// is indistinguishable from an extension-less file without this.
#[tauri::command]
pub fn classify_drop(paths: Vec<String>) -> DropClassification;
// { books: Vec<String>, folders: Vec<String>, unsupported: Vec<String> }
```

Both are registered in `invoke_handler`, which is what authorizes them in
Tauri 2 — no `capabilities/default.json` entry needed, matching the
`source_fetch` / `archive::*` precedent already documented there.

### Rust: `src-tauri/src/lib.rs`

- `tauri_plugin_single_instance::init(…)` registered **first** (the plugin
  requires it) under `#[cfg(desktop)]`; its callback pushes `argv[1..]`.
- In `setup()`, under `#[cfg(desktop)]`, scan `std::env::args_os().skip(1)`
  for existing files and push them — the cold-start path on Windows/Linux.
- `.run(tauri::generate_context!())` becomes `.build(…)?` followed by
  `.run(|app, event| …)` so `RunEvent::Opened { urls }` can be handled —
  the macOS cold *and* warm path. `file://` URLs convert via
  `Url::to_file_path`.

### Rust: `src-tauri/src/archive.rs`

`stage_import_file` already streams every byte of the picked file, so
hashing is nearly free — feed each buffer to a SHA-256 hasher alongside the
write. `StagedFile` gains `hash: String`. This adds `sha2 = "0.10"` to
Cargo.toml; it is pure Rust and a few KB, which matters only against the
Android `.so` size budget the file already tracks.

### Android

**`AndroidManifest.xml`** — new filters on the existing `MainActivity`
(already `launchMode="singleTask"`, so warm opens reach `onNewIntent`):

- `ACTION_VIEW`, `DEFAULT` + `BROWSABLE`, schemes `content` and `file`,
  with `mimeType` for `application/epub+zip`, `application/pdf`, and
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- A second `ACTION_VIEW` block matching `mimeType="*/*"` with
  `pathPattern` on `.*\\.epub` / `.*\\.pdf` / `.*\\.docx`. Many file
  managers hand `.epub` over as `application/octet-stream`, so the
  MIME-typed block alone misses the common case. `pathPattern` requires a
  `host` wildcard to match at all.
- `ACTION_SEND`, `DEFAULT`, same three MIME types.

**`MainActivity.kt`** — a **second** static field beside the existing one:

```kotlin
@JvmField @Volatile
var pendingOpenUri: String? = null
```

Deliberately not overloaded onto `pendingLaunchIntent`, whose contract is
the `"queue"` sentinel. `rememberLaunchIntent(intent)` gains a branch: for
`ACTION_VIEW` read `intent.data`, for `ACTION_SEND` read
`intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)`, and stash
`uri.toString()`.

**`notify.rs`** — `consume_open_uri`, a copy of the existing
`consume_launch_intent` JNI reader pointed at the new field, going through
`find_app_class` for the same classloader reason.

**`proguard-rules.pro`** — add the keep rule for `pendingOpenUri` in the
same commit as the field. A missing rule compiles and runs in debug and
dies only in release, which is the exact failure mode the file's existing
comments warn about.

No new I/O path is needed: `stage_import_file` already resolves
`content://` URIs through `FsExt::open`, because that is what the SAF
picker returns today. The intent's read grant lasts for the life of the
activity, and staging copies immediately.

### Frontend

**`src/store/incomingFiles.ts`** (new) — module-scoped pub-sub mirroring
`uiIntents.ts`, including its `pendingStoreSource` idiom: paths that arrive
with no subscriber mounted are held and drained on the next mount. That is
what lets a drop survive the reader, and what makes a cold-launch open
survive the gap before `Library` first renders.

**`src/hooks/useIncomingFiles.ts`** (new) — mounted in `App.tsx` beside
`useLaunchIntent`:

- drains `take_pending_opens` on mount (cold launch)
- listens for `app://opened` and drains again (warm launch, drop)
- re-drains on `visibilitychange`, matching the existing hook's belt-and-
  braces approach for Android warm delivery

**`src/hooks/useFileDrop.ts`** (new) — desktop only, gated on
`platform() !== "android"`. Subscribes to
`getCurrentWebview().onDragDropEvent()`:

- `enter` → one `classify_drop` call, set overlay state. Tauri's `over`
  event carries no paths, so this is one IPC per drag, not per mousemove.
- `drop` → clear overlay, hand `books` to the incoming-files store, hand
  `folders` to the existing folder-import path, toast what was skipped
- `leave` → clear overlay

`app.windows[].dragDropEnabled` must stay at its default `true`.

**`src/store/library.ts`** — `pickBooksForImport` splits. The `open()`
dialog call stays; its body becomes an exported
`importPaths(paths, report)`. `stagePaths` is untouched, so external paths
inherit the existing staging, progress reporting and Android IPC-ceiling
avoidance for free.

**`src/components/Library.tsx`** — `beginImport` gains an
"open the reader when done" flag, set for externally-originated imports and
unset for picker-originated ones. It is honoured only when the run produced
exactly one book (see Edge cases); a batch falls back to the existing
import summary.

### Dedup

`BookIndexEntry` gains optional `sourceHash?: string`. After staging,
`importPaths` looks the hash up in the index. On a hit it deletes the
staged copy and opens the existing book, preserving its reading position
and highlights.

**No migration and no backfill.** Books already in the library have no
hash and will not match until they are re-imported. A rescan pass is not
in scope.

### Drop overlay UI

Built from the existing tokens in `src/styles/tokens.ts` and
`src/styles/motion.ts` — no new palette, and specifically not a blue dashed
border box.

- Full-window fixed layer, `pointer-events: none` (Tauri owns the drag; the
  overlay is purely visual). Backdrop is `theme.bg` at ~88% with an 8px
  blur — the app already uses blur to mean "the background is dismissed".
- Centered card on `theme.paper` with a `theme.rule` border at the dialog
  radius. Three states:
  - **Accepting:** `download` icon, "أفلت الكتب هنا" / "Drop to add", a
    count line, and a warm amber accent (`#d4a84a`, already in
    `HIGHLIGHT_COLORS.yellow.dot`).
  - **Refusing:** same card, muted ink, `info` icon, and "EPUB · PDF · DOCX"
    as the recovery hint — an error must say how to fix itself, not only
    that something is wrong.
  - **Received:** `check` icon, held 1400ms after a drop, then fades. This
    is the only feedback a drop gets while the reader is on screen, since
    the library's toast is unreachable from there. Shown unconditionally so
    the drop's own outcome and the import's outcome each get their own
    acknowledgement.
- Motion: fade + `scale(0.98 → 1)` at `MOTION.med` / `EASE.enter`, exit at
  `MOTION.fast` / `EASE.exit`, collapsing to instant under
  `useReducedMotion()`.
- Strings land in `i18n/en.ts` (source of truth) and `i18n/ar.ts`, flat
  dot-namespaced under `drop.*`. The layout is centered and icon-over-text,
  so RTL needs no directional flip.
- Contrast: card ink is `theme.ink` on `theme.paper` and the hint line is
  `theme.muted`, both of which the token file already holds at ≥4.5:1 in
  all four themes.

### File-association declarations

`tauri.conf.json` gains `bundle.fileAssociations` with one entry each for
`epub`, `pdf` and `docx`, carrying `name`, `description`, `role: "Viewer"`
and `mimeType`. One declaration feeds all three desktop platforms:
`CFBundleDocumentTypes` on macOS, extension keys in the NSIS/WiX installer
on Windows, and `MimeType=` in the `.desktop` file on Linux.

## Risks

- **`role: "Viewer"` may not be enough on macOS.** Tauri's
  `fileAssociations` sets `CFBundleTypeRole` but does not expose
  `LSHandlerRank`, so Riwaq could compete with Preview for the PDF default
  rather than sitting politely in the "Open With" list. If that happens,
  pin `LSHandlerRank: Alternate` through a merged custom `Info.plist`. This
  is a verification step, not an assumption.
- **macOS associations only register for an installed app.** Dev builds do
  not appear in "Open With"; each test round needs `pnpm mac:install`.
- **Windows and Linux ship unverified** from this machine.

## Testing

Unit tests in Vitest, colocated as the repo does elsewhere:

- `classify_drop`'s frontend counterpart: extension classification and the
  accept/refuse/mixed decision.
- The dedup decision function: hash hit → reuse, hash miss → import, absent
  hash on an old entry → import.
- The incoming-files store: queue drain semantics, and that draining twice
  does not double-import.

The native paths are not unit-testable, so verification is a manual matrix:

| Case | How |
|---|---|
| macOS cold open | `pnpm mac:install`, quit Riwaq, `open -a Riwaq book.epub` |
| macOS warm open | Riwaq running, Finder → Open With → Riwaq |
| macOS all three types | one `.epub`, one `.pdf`, one `.docx` |
| Android cold VIEW | `adb shell am start -a android.intent.action.VIEW -d file:///… -t application/epub+zip` |
| Android warm VIEW | same, with the app already foregrounded |
| Android share-to | Share from Chrome Downloads into Riwaq |
| Android octet-stream | a file manager that reports `application/octet-stream` |
| Drop: accepting | drag 3 EPUBs onto the window |
| Drop: refusing | drag a `.txt` |
| Drop: mixed | 2 EPUBs + 1 `.txt`; check the skipped-files toast |
| Drop: folder | a directory of books |
| Drop while reading | drop a book mid-chapter; reader keeps its place |
| Multi-book open | drop 3 books; stays in library, no reader |
| Drop during an import | second drop queues silently, imports once the first finishes |
| Overlay in all 4 themes | light, sepia, dark, oled |
| Reduced motion | overlay appears instantly, no scale animation |
| Dedup | open the same file twice; one library entry, position preserved |

## Out of scope

- `ACTION_SEND_MULTIPLE` on Android.
- Backfilling `sourceHash` onto books already in the library.
- iOS (no `gen/apple` project exists).
- Registering Riwaq as the *default* handler for any type. It appears as an
  option; the user chooses.
