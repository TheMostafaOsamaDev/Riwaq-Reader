# Native Android download-notification progress bar

**Date:** 2026-05-25
**Branch:** feat/native-download-notification

## Problem

Today the download notifier in `src/store/downloadNotifier.ts` renders a
unicode block-character progress bar (`██████░░░░  60% · 6 of 10`) inside the
notification body text, and sets a generic title (`"Downloading chapters"` or
`"Saving as offline book"`). It uses a single notification id so Android
replaces in place, with a throttle to avoid heads-up re-popping.

Three problems:

1. **Unicode bar is not a real widget.** On Android the user wants the native
   progress-bar widget that `NotificationCompat.Builder.setProgress(...)`
   produces — a real animated horizontal bar, not text.
2. **Title is generic.** It never names the novel or chapter being fetched.
3. **In-app perception of "separate notifications per chapter"** — really an
   artifact of the body text changing per chapter. With a real widget the
   chapter boundary still happens, but the visual continuity is much stronger
   (the bar advances smoothly, the title is the only thing that updates).

## Decisions

From the brainstorming session:

- **Title format ([T1] from the mockups):** `Downloading <novelTitle> — Ch.
  <chapterNumber>`. Title flips to whichever chapter is currently running.
  Chapter number only (no chapter title text — chapter titles on Cenele /
  Kolnovel can be long enough to push the novel name off-screen).
- **Body:** `Chapter X of Y` queue counter. When multiple novels are queued,
  append `(N novels)`: `Chapter 5 of 47 (3 novels)`.
- **Progress widget value:** queue progress (`completedThisBurst /
  burstTotal`). Bar steps forward at chapter boundaries; no per-chapter
  sub-progress.
- **Tap action:** opens the app to the in-app Download Queue view
  (`DownloadQueueView`).
- **Platform reality:**
  - **Android:** native `NotificationCompat.Builder.setProgress` widget.
  - **iOS / macOS / Linux / Windows:** fall back to the existing Tauri
    notification plugin with the new title + body. No unicode bar, no
    progress widget. Clean text.
- **Conversion jobs** (existing "Saving as offline book"): same T1 pattern
  with verb swap → `Converting <novelTitle>`. Progress widget value =
  the conversion's own `progress` field (0..1 → percent).
- **Notification id:** keep reusing `1001` so Android replaces in place.
- **Channel:** keep the existing `leaflet-downloads` channel at
  `Importance.LOW`.

## Architecture

### Frontend

**`src/store/downloadNotifier.ts`** — existing file. Refactor so:

- `compose()` returns a richer object:
  ```ts
  interface NotificationPayload {
    title: string;
    body: string;
    // 0..max. Omitted when the system can't show a widget.
    progress?: number;
    max?: number;
    // For conversion phase changes where total isn't a clean count.
    indeterminate?: boolean;
    ongoing: boolean;
    // Extra used by the tap-handler. "queue" routes to DownloadQueueView.
    tapsTo: "queue" | null;
  }
  ```
- `publish()` calls a new transport `pushDownloadNotification(payload)`
  instead of `sendNotification(...)` directly.
- Existing throttle + dedupe + burst-counter logic stays unchanged. The
  unicode `renderBar` helper is **removed**.

**New `src/store/downloadNotifier/transport.ts`** — platform switch:

- Detects platform via `@tauri-apps/api/core` `platform()` or similar.
- **Android:** `invoke("update_download_notification", payload)` — calls the
  new Rust command.
- **Everything else:** calls the existing `@tauri-apps/plugin-notification`
  `sendNotification` with `{ id, channelId, title, body, ongoing, silent }`.
  Progress / max are dropped (no widget); the title + body still update.

### Backend

**New Tauri command in `src-tauri/src/lib.rs`:**

```rust
#[tauri::command]
async fn update_download_notification(
    app: tauri::AppHandle,
    id: i32,
    title: String,
    body: String,
    progress: Option<i32>,
    max: Option<i32>,
    indeterminate: bool,
    ongoing: bool,
    taps_to: Option<String>,  // "queue" | None
) -> Result<(), String>
```

- On **Android** (`#[cfg(target_os = "android")]`): delegates to the Android
  side (Kotlin) via Tauri's mobile plugin / JNI pattern. The Kotlin code uses
  `NotificationCompat.Builder` with `setProgress(max, progress, indeterminate)`,
  `setOnlyAlertOnce(true)`, `setOngoing(ongoing)`, `setChannelId("leaflet-downloads")`,
  `setSmallIcon(R.drawable.ic_stat_leaflet)`, and (when `taps_to == Some("queue")`)
  a `setContentIntent(PendingIntent...)` that opens `MainActivity` with an
  extra `leaflet.open=queue`.
- On **other platforms**: command is a no-op. The frontend's transport falls
  back to `sendNotification` before reaching the command, so the no-op only
  triggers if something misroutes.

**New Kotlin file** `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/DownloadNotifier.kt`
(exact package matches the existing app identifier `com.leaflet.reader`).
Encapsulates the `NotificationCompat` builder + channel-ensure call mirroring
the existing JS-side `ensureChannel()`. Single entry-point `update(...)`
matching the Rust command signature.

### Tap → Queue routing

- The PendingIntent is built with an intent extra `leaflet.open=queue`.
- `MainActivity.onCreate` / `onNewIntent` reads the extra and stores it on a
  static field plus emits a Tauri event `launch-intent` so the frontend
  reacts whether it's a cold launch (intent is consumed on mount) or a warm
  launch (the running app receives the event).
- Frontend handler (a small `useLaunchIntent` hook in
  `src/hooks/useLaunchIntent.ts`) does both: on mount, calls
  `invoke("consume_launch_intent")` to drain any pending value; subscribes
  to the `launch-intent` event for live arrivals. When the intent is
  `queue`, it calls a shared `openDownloadQueue()` function that
  `App.tsx` / `Library.tsx` use to bring the Queue view up.

## Files touched

| File | Change |
|---|---|
| `src-tauri/src/lib.rs` | Register new `update_download_notification` + `consume_launch_intent` commands |
| `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/DownloadNotifier.kt` | **New file.** NotificationCompat work, intent extras |
| `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/MainActivity.kt` | Read `leaflet.open` extra in `onCreate` / `onNewIntent`; store for `consume_launch_intent` |
| `src-tauri/Cargo.toml` | Confirm `jni` or whatever JNI bridge already used; add deps if needed |
| `src/store/downloadNotifier.ts` | `compose()` returns richer payload; `publish()` calls transport; drop `renderBar` |
| `src/store/downloadNotifier/transport.ts` | **New file.** Platform switch |
| `src/hooks/useLaunchIntent.ts` | **New file.** Mount-time consume + event subscribe; calls `openDownloadQueue()` on `queue` intents |
| `src/App.tsx` | Invoke `useLaunchIntent` at app shell; expose `openDownloadQueue()` |
| `src/components/Library.tsx` | Accept the `openDownloadQueue` hook or read from a small module-scoped store; sets `queueOpen=true` on demand |

## Non-goals

- **iOS Live Activities** — separate Swift project, would let iOS show a real
  progress UI. Defer.
- **Linux notification daemon `int:value` hints** — daemon-dependent, not
  universally supported. Defer.
- **Windows Toast `<progress>` element** — would require bypassing the Tauri
  plugin entirely on Windows. Defer.
- **Per-chapter sub-progress** — chosen against during brainstorm. Queue
  progress only.
- **Notification action buttons** (Pause / Cancel) — separate spec.
- **Custom small icon** — assume the existing app icon is fine; don't
  introduce a new vector drawable in this scope.

## Test plan

1. **Single novel, multi-chapter burst (Android phone).** Enqueue 5 chapters
   of one novel. Confirm:
   - Title shows `Downloading <Novel> — Ch. NNN` and flips per chapter.
   - Body shows `Chapter X of 5`.
   - Native progress bar advances 0% → 100% across the burst (not jumping
     back to 0% on chapter boundary).
   - One notification only — never see two stacked.
   - No heads-up re-pop on chapter transitions (silence is preserved).
2. **Multiple novels (Android phone).** Enqueue 4 chapters across 3 distinct
   novels. Confirm body says `(3 novels)` and title shows the currently-
   running chapter.
3. **Conversion job (Android phone).** Trigger "save as offline book."
   Confirm title is `Converting <Novel>` and the bar tracks the conversion's
   `progress` field smoothly.
4. **Tap → Queue (Android phone).** While downloads are running, tap the
   notification. Confirm the app opens directly to the Download Queue view.
   Repeat with the app already running in the background (should also route
   to the queue, not just bring the app forward).
5. **Permission denied.** Deny notification permission. Confirm the queue
   keeps working; no errors logged besides the existing warn.
6. **iOS / desktop fallback.** Run on Linux desktop. Confirm a normal text
   notification appears with the new title + body, no unicode bar, no crash
   on the missing progress widget.
7. **Reduce-motion.** Native progress bars are still acceptable under
   reduce-motion (system handles their animation policy).

## Order of work

(Detailed steps in the implementation plan; this is the high-level sequence.)

1. **Add the Kotlin notifier + Rust command.** Backend-first so frontend has
   something to call. Test that `invoke("update_download_notification", ...)`
   from the DevTools console produces a real Android notification with a
   widget bar.
2. **Add the transport file + platform switch.** Swap one `publish()` call
   site over to use it. Confirm Android still shows the new widget, and
   non-Android still falls through to the plugin.
3. **Refactor `compose()` to return the richer payload.** Drop `renderBar`.
   Update title/body strings to match the T1 format.
4. **Add launch-intent plumbing for tap → Queue.** New Rust command +
   `MainActivity` extras + frontend hook + Library wiring.
5. **On-device verification on Android.** Walk through the test plan.
6. **Drop dead code:** the old unicode bar helper, stale comments referencing
   "the Tauri notification plugin doesn't expose progress."

## Risks / open questions

- **Tauri 2 mobile plugin idiom vs ad-hoc Kotlin file.** A proper Tauri 2
  mobile plugin (under `src-tauri/tauri-plugin-<name>/`) is the idiomatic
  choice for future-proofing. An ad-hoc Kotlin file is faster to ship but
  diverges from the plugin pattern. The implementation plan should pick one
  early — preference: ad-hoc for now (single app, no reuse), revisit if we
  ever extract.
- **`PendingIntent` flags across Android versions.** API 31+ requires
  `FLAG_IMMUTABLE` on PendingIntent. The plan must include this; otherwise
  modern Android refuses to build the intent.
- **`onlyAlertOnce` for the terminal "all done" alert.** Today the terminal
  send drops `ongoing` + `silent` so it alerts. With `onlyAlertOnce`, we'd
  need to either issue a different id for the terminal notification or
  override `onlyAlertOnce` on the terminal send. Plan should call this out.
