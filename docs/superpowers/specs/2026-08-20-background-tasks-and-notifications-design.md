# Background tasks + unified progress notifications — design

**Date:** 2026-08-20
**Status:** Approved direction; spec under review
**Platforms in scope:** Android (primary). Desktop (secondary — notification quality only).

## 1. Problem & goals

Today, all long-running work (chapter downloads, book imports, and "save as
offline book" conversions) runs as JavaScript inside the app's webview. On
**Android the webview is suspended when the user leaves the app**, so this work
stops. On desktop it keeps running while minimized, but the OS notifications are
plain and tend to stack.

Goals:

1. **Background execution on Android** — downloads, imports, and conversions
   keep running when the user switches to another app or turns off the screen,
   as long as the app is still in recents (i.e. not swiped away).
2. **One unified progress notification** per device — a single, grouped,
   accurate notification that covers all in-flight background work (downloads +
   imports + conversions), instead of multiple stacked notifications or no
   notification at all for import/convert.
3. **Better desktop notifications** — stop per-item stacking; add a
   taskbar/dock progress indicator.

### Non-goals

- Surviving the app being **swiped away / force-closed** (would need a fully
  native background worker). Explicitly out of scope.
- Cloud sync / backup / network upload (the app is deliberately local-only).
- Rewriting the download/conversion engine in Rust/Kotlin.
- iOS.

## 2. Current architecture (as-is)

- **Download/conversion engine:** `src/store/downloadQueue.ts` — a module-scoped
  singleton queue with bounded concurrency, cooperative cancel, wifi-only gate,
  and crash recovery (persisted to `$APPDATA/leaflet/downloadQueue.json`). Two
  job kinds: `ChapterDownloadJob` and `ConversionJob` (`runConversionJob` calls
  into `src/store/storeConversion.ts`). Runs entirely in the webview JS loop.
- **Import engine:** `src/store/importProgress.ts` (+ `fixedImport.ts`,
  `fixedImportStage.ts`) — a **separate** progress store (via
  `useSyncExternalStore`) not connected to the queue or the notifier.
- **Notifier:** `src/store/downloadNotifier.ts` subscribes to the queue,
  summarizes jobs (`summarize`/`compose`), and pushes one reused notification.
  `src/store/downloadNotifier/transport.ts` switches platform: Android →
  `invoke("update_download_notification", …)` (real progress bar); desktop →
  `sendNotification(…)` from `@tauri-apps/plugin-notification`.
  Notification id `1001`, channel `leaflet-downloads` (Importance.Low).
- **Rust bridge:** `src-tauri/src/notify.rs` — `update_download_notification`
  calls Kotlin `DownloadNotifier.update(...)` over JNI; also
  `consume_launch_intent`, `set_status_bar_style`. Registered in
  `src-tauri/src/lib.rs` `invoke_handler`.
- **Kotlin renderer:** `.../com/leaflet/reader/DownloadNotifier.kt` — builds a
  `NotificationCompat` progress notification (`setProgress`, `setOngoing`,
  `setOnlyAlertOnce`), tap opens `MainActivity` with `leaflet.open=queue`.
- **Manifest:** `.../AndroidManifest.xml` declares only `MainActivity` +
  `FileProvider`; **no `<service>`**, only `INTERNET` permission. No
  `FOREGROUND_SERVICE` / `WAKE_LOCK`.
- **Boot wiring:** `src/App.tsx` calls `loadPersistedQueue()` then
  `startDownloadNotifier()` (order matters).

## 3. Design

Chosen approach: **foreground-service keep-alive that reuses the existing JS
engine.** Alternatives (Rust port; WorkManager) were rejected as overkill for
the "survive switched-away" requirement and because the hidden-webview scrapers
and EPUB conversion are JS-only.

### Part 0 — Spike: WebView JS liveness under a foreground service (do first)

The approach rests on one assumption: **the Android WebView keeps executing JS
while the Activity is stopped, provided the process stays alive.** Verify before
building the rest.

- **Probe:** temporarily add a foreground service (or even just a wake lock +
  test notification) and a JS timer that increments a counter and updates the
  notification every second. Background the app (home button, screen off) and
  confirm the counter keeps advancing and a real download completes while
  backgrounded.
- **If JS pauses:** the fix is to prevent wry/tao from pausing the webview on
  `onStop` — call `webView.resumeTimers()` (and avoid `pauseTimers()`) from the
  generated Kotlin activity/service lifecycle. Document the exact hook used.
- **Exit criterion:** a multi-chapter download started in-app runs to completion
  with the screen off and the app backgrounded. This gates the rest of Part A.

### Part A — Android foreground service

- **New Kotlin service** `TaskService` (foreground service type `dataSync`) in
  `.../com/leaflet/reader/`. On start it acquires a **partial `WAKE_LOCK`** and
  calls `startForeground(1001, notification)` using the *same* notification id
  and channel the `DownloadNotifier` already uses — so the service and the
  progress notification are one object (no duplicate notifications). On stop it
  releases the wake lock and calls `stopForeground(STOP_FOREGROUND_REMOVE)`.
- **Lifecycle control from JS:** the queue/notifier is the source of truth for
  "is any background-eligible task active?". Add:
  - Rust commands `start_task_service` / `stop_task_service` in
    `src-tauri/src/notify.rs` (Android-only; no-op elsewhere), registered in
    `lib.rs`, bridged to Kotlin over JNI (mirror the existing
    `android_call_update` pattern).
  - A thin TS helper (e.g. in `transport.ts` or a new
    `downloadNotifier/service.ts`) that starts the service when active-task
    count goes 0→>0 and stops it when it returns to 0. Driven by the same
    subscription the notifier already has.
- **Notification ownership:** while the service runs, it owns notification 1001;
  `DownloadNotifier.update(...)` continues to update the *same* id, so progress
  updates flow through unchanged. When the service stops, the terminal
  (completed/failed) summary notification is posted normally.
- **Manifest additions:** `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_DATA_SYNC`, `POST_NOTIFICATIONS`, `WAKE_LOCK`, and the
  `<service android:name=".TaskService" android:foregroundServiceType="dataSync"
  android:exported="false"/>` declaration.
- **Permissions:** `POST_NOTIFICATIONS` runtime request (Android 13+) already
  handled via the notification plugin's `requestPermission`; confirm it's
  requested before the first background task, else the foreground notification is
  silent-but-present (service still runs).

### Part B — Unify the three task types into one notification

- **Bring imports into the unified model.** Two options; pick during
  implementation based on code fit:
  - (Preferred) Have `downloadNotifier.ts` additionally subscribe to
    `importProgress.ts` and fold import progress into the same
    `summarize`/`compose` aggregate.
  - (Alternative) Represent imports as a job kind in `downloadQueue.ts`. Heavier;
    only if the notifier-observes-both path proves awkward.
- **Single source of "active work"** feeds both the notification content and the
  Android service start/stop decision, so they can never disagree.
- **Root-cause the "multiple notifications" report** and fix:
  - Desktop `sendNotification` likely stacks because the OS notification plugin
    doesn't reliably replace by id on desktop — see Part C.
  - Confirm conversions + downloads don't each spawn their own notification.

### Part C — Progress content + desktop

- **Content (`compose`)**: one notification, accurate aggregate. Examples:
  - Downloads only: `"Downloading 3 of 12 · 25%"`.
  - Mixed: a title + short lines distinguishing downloads vs. convert vs. import
    (e.g. `"Background tasks · 40%"` with a body listing each active kind).
  - Terminal: `"Downloaded 12 chapters"` / `"3 downloads failed — tap to retry"`.
  - Keep `setOnlyAlertOnce` + throttle to avoid blink/heads-up spam.
- **Desktop**:
  - Stop per-item spam: send a notification on **start** and on **completion**
    (and on failure), not on every progress tick; rely on the in-app queue view
    for live detail.
  - Add a **taskbar/dock progress bar** via Tauri v2 `Window.setProgressBar`
    (`@tauri-apps/api/window`), reflecting aggregate progress; clear it on drain.
    This is the desktop equivalent of the Android progress widget.
- **In-app queue view** (`DownloadQueueView.tsx`) stays the detailed source of
  truth; extend it to show imports if that's cheap, otherwise leave as-is.

## 4. Data flow

```
JS queue + import store  ──(active count, aggregate progress)──▶  notifier
        │                                                            │
        │ start/stop when active count crosses 0                     │ update content
        ▼                                                            ▼
  invoke start/stop_task_service (Android)              transport: Android → invoke update_download_notification
        │                                                            │ desktop → sendNotification (start/end only)
        ▼                                                            │           + Window.setProgressBar
  Rust notify.rs ──JNI──▶ Kotlin TaskService                        ▼
        │                    startForeground(1001, notif) + wake lock
        ▼
  DownloadNotifier.update(...) keeps updating notification 1001
```

## 5. Error handling & edge cases

- **Service fails to start / permission denied:** downloads still run in-app;
  log and degrade gracefully (no crash). If `POST_NOTIFICATIONS` denied, service
  runs without an alerting notification.
- **App swiped away (out of scope but must not corrupt):** process dies; existing
  crash recovery reclassifies `queued`/`running` jobs as `interrupted` on next
  launch. Keep that behavior; do not auto-hammer the network.
- **Wake lock leak:** release in all stop paths (drain, cancel-all, error,
  service destroy). Guard with a single owner (the active-count transition).
- **Concurrency with cancel/retry:** service stops only when active count truly
  reaches 0 including retryable/interrupted handling; ensure cancel-all stops it.
- **Desktop progress bar** cleared on drain, error, and app focus regain.

## 6. Testing / verification

- **Spike (Part 0):** manual on-device — screen-off multi-chapter download
  completes. This is the go/no-go.
- **Android manual matrix:** switch away mid-download; screen off; start an
  import + a download together (one notification, correct aggregate); cancel-all
  (service stops, notification clears, wake lock released); permission-denied
  path.
- **Desktop manual:** minimized multi-chapter download → single start + single
  completion notification, dock/taskbar progress advances and clears.
- **Regression:** existing queue behaviors (persistence, wifi-only, retry,
  tap-to-open-queue) still work.
- Verify via `pnpm android:dev` on the `leaflet` AVD (see project memory).

## 7. Risks & open questions

- **Primary risk:** WebView JS may not run while the Activity is stopped even
  with a foreground service (Part 0 spike resolves this; fallback is
  `resumeTimers()` in Kotlin lifecycle).
- Android 14+ `dataSync` foreground services have a ~6h/day budget — acceptable
  for this workload; note it.
- Desktop OS-notification replacement behavior varies by platform; the
  start/end-only strategy + taskbar progress sidesteps it.

## 8. Files touched (anticipated)

- `src/store/downloadNotifier.ts`, `src/store/downloadNotifier/transport.ts`
  (+ possibly new `downloadNotifier/service.ts`)
- `src/store/importProgress.ts` (subscription surface) and/or
  `src/store/downloadQueue.ts`
- `src/App.tsx` (boot wiring for service lifecycle)
- `src-tauri/src/notify.rs`, `src-tauri/src/lib.rs`
- `.../com/leaflet/reader/TaskService.kt` (new),
  `DownloadNotifier.kt`, `MainActivity.kt`
- `.../AndroidManifest.xml`
- Possibly `DownloadQueueView.tsx` (show imports), and a desktop
  `setProgressBar` helper.
