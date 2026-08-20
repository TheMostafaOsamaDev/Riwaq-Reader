# Background tasks + unified progress notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep chapter downloads, book imports, and offline-book conversions running on Android when the app is switched away / screen off, and surface all in-flight work as one accurate, grouped progress notification (with a proper desktop experience too).

**Architecture:** Reuse the existing JavaScript task engines (`downloadQueue.ts`, `storeConversion.ts`, import flow). Add an Android **foreground service** (`TaskService`) + partial wake lock that keeps the app process — and therefore the WebView JS loop — alive while any background-eligible task runs. A small JS coordinator starts/stops the service as the aggregate active-task count crosses zero. The existing notifier is extended to fold in imports and to render a smooth aggregate; desktop gains start/end-only notifications plus a taskbar/dock progress bar.

**Tech Stack:** Tauri v2, React 19 + Vite (TypeScript), Rust (`src-tauri`, JNI bridge), Kotlin (Android `gen/android`), `@tauri-apps/plugin-notification`, `@tauri-apps/plugin-os`, `@tauri-apps/api/window`.

**Spec:** `docs/superpowers/specs/2026-08-20-background-tasks-and-notifications-design.md` (read it alongside this plan).

## Global Constraints

- **Tauri v2** APIs only. App-defined commands (via `generate_handler!`) are permitted by default and need **no** capability entry (same as the existing `update_download_notification`). Core/plugin commands **do** need capability entries.
- **No unit-test framework exists** in this repo (no vitest/jest). Verification = `pnpm exec tsc --noEmit` (typecheck), `cargo check` (host, for non-Android Rust signatures), the Android build/run (`pnpm android:dev` — full native validation), and **explicit manual on-device checks** with stated expected observations. Do not invent a test harness.
- **Android emulator/device:** run via `pnpm android:dev` on the `leaflet` AVD. Mind the Gradle JDK-override gotcha noted in project memory.
- **Notification identity is fixed:** channel id `"leaflet-downloads"`, ongoing progress notification id `1001`. This plan adds a terminal-summary id `1002`. Keep these exact.
- **i18n:** every user-visible string must be added to BOTH `src/i18n/en.ts` and `src/i18n/ar.ts` (Arabic is a first-class UI language; window title is Arabic).
- **Commits:** author as the user; never mention Claude/AI in commit messages (project memory).
- **Non-goals (do not build):** surviving app swipe-away/force-close, cloud sync/upload, any Rust/Kotlin re-port of the download engine, iOS.

---

## File Structure

- **Create** `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/TaskService.kt` — foreground service + wake lock + start/stop helpers.
- **Create** `src/store/backgroundTasks.ts` — coordinator: aggregates active-task count across the download queue and the import store, and drives the Android service start/stop. Single source of truth for "is background work happening".
- **Modify** `src-tauri/gen/android/app/src/main/AndroidManifest.xml` — permissions + `<service>` declaration.
- **Modify** `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/DownloadNotifier.kt` — expose channel-ensure for the service.
- **Modify** `src-tauri/src/notify.rs` — `start_task_service` / `stop_task_service` commands + JNI helpers.
- **Modify** `src-tauri/src/lib.rs` — register the two new commands.
- **Modify** `src/store/downloadNotifier.ts` — fold imports into the summary; smooth aggregate; route terminal summary to id `1002`.
- **Modify** `src/store/downloadNotifier/transport.ts` — add `DOWNLOAD_SUMMARY_ID`; desktop start/end-only + `setProgressBar`.
- **Modify** `src/store/importProgress.ts` — export a tiny `isImportActive` helper (pure).
- **Modify** `src/App.tsx` — start the coordinator at boot.
- **Modify** `src/i18n/en.ts`, `src/i18n/ar.ts` — new notification strings.
- **Modify** `src-tauri/capabilities/default.json` — add `core:window:allow-set-progress-bar` (Task 6).

---

## Task 1: Android foreground service skeleton + verify background JS liveness

This is the **de-risking task**. Everything downstream assumes the WebView keeps executing JS while the Activity is stopped, provided the process stays alive under a foreground service + wake lock. Prove it here.

**Files:**
- Create: `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/TaskService.kt`
- Modify: `src-tauri/gen/android/app/src/main/AndroidManifest.xml`
- Modify: `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/DownloadNotifier.kt`

**Interfaces:**
- Produces: `TaskService.start(ctx: Context)`, `TaskService.stop(ctx: Context)` (JvmStatic), constants `TaskService.NOTIF_ID = 1001`, `TaskService.CHANNEL_ID = "leaflet-downloads"`, `TaskService.ACTION_STOP`. `DownloadNotifier.ensureChannelPublic(ctx: Context)`.

- [ ] **Step 1: Add permissions + service declaration to the manifest**

In `AndroidManifest.xml`, add after the existing `INTERNET` permission (line 3):

```xml
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
```

Inside `<application>` (after the `<provider>` block, before `</application>`):

```xml
        <service
            android:name=".TaskService"
            android:foregroundServiceType="dataSync"
            android:exported="false" />
```

- [ ] **Step 2: Expose the channel-ensure on `DownloadNotifier`**

In `DownloadNotifier.kt`, add a public wrapper (the service needs the channel to exist before its first `startForeground`). Add inside the `object DownloadNotifier` companion body, next to `ensureChannel`:

```kotlin
    /** Public channel-ensure for TaskService's placeholder foreground
     *  notification. Idempotent; delegates to the private ensureChannel. */
    @JvmStatic
    fun ensureChannelPublic(ctx: Context) = ensureChannel(ctx)
```

- [ ] **Step 3: Create `TaskService.kt`**

```kotlin
package com.leaflet.reader

import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * Foreground service that keeps the app process — and therefore the
 * WebView JS loop that runs downloads/imports/conversions — alive while
 * background-eligible work is in flight. It owns notification id
 * [NOTIF_ID], the same id DownloadNotifier.update() writes to, so
 * progress flows through unchanged and no duplicate notification appears.
 *
 * Lifecycle is driven from JS via Rust (notify.rs). We intentionally do
 * NOT survive swipe-away (START_NOT_STICKY, no swipe-away handling).
 */
class TaskService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            releaseWakeLock()
            // REMOVE, not DETACH: the terminal "all done" summary is a
            // separate notification id (1002), so removing 1001 here just
            // clears the stale progress bar.
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        DownloadNotifier.ensureChannelPublic(this)
        startInForeground(NOTIF_ID, buildPlaceholderNotification())
        acquireWakeLock()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    private fun startInForeground(id: Int, notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(id, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(id, notification)
        }
    }

    private fun buildPlaceholderNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("…")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "leaflet:tasks").apply {
            setReferenceCounted(false)
            acquire(30 * 60 * 1000L) // 30-min safety cap
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    companion object {
        const val CHANNEL_ID = "leaflet-downloads"
        const val NOTIF_ID = 1001
        const val ACTION_STOP = "com.leaflet.reader.action.STOP_TASKS"

        @JvmStatic
        fun start(ctx: Context) {
            val intent = Intent(ctx, TaskService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        }

        @JvmStatic
        fun stop(ctx: Context) {
            val intent = Intent(ctx, TaskService::class.java).apply { action = ACTION_STOP }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        }
    }
}
```

- [ ] **Step 4: Build and confirm it compiles**

Run: `pnpm android:dev` (let it install on the `leaflet` AVD; mind the Gradle JDK gotcha in memory).
Expected: app builds and launches with no manifest/Kotlin errors.

- [ ] **Step 5: SPIKE — verify JS runs in the background under the service**

This step needs the service running *while a download is in flight*, decoupled from the not-yet-built JS wiring. Start it manually via adb.

1. In the running app, start a **multi-chapter download** (e.g. `Download range` of ~15 chapters) so the queue has sustained work.
2. Immediately start the service from a shell:
   `adb shell am start-foreground-service -n com.leaflet.reader/.TaskService`
   Expected: a low-priority "…" notification appears.
3. Press Home, then turn the screen off. Wait ~60s.
4. Turn the screen on, reopen the app, open the Download Queue view.
   **Exit criterion (GO):** downloads made progress / completed while backgrounded (more chapters show `done` than when you left). Also confirm via `adb logcat | grep -i leaflet` that fetches happened during the dark window.
5. Stop the service: `adb shell am stopservice -n com.leaflet.reader/.TaskService` (or it stays until Task 2 wires stop).

- [ ] **Step 6: If JS PAUSED in the background (NO-GO), add the resumeTimers fix**

If step 5 shows no progress while backgrounded, wry/tao is pausing the WebView on `onStop`. Fix in `MainActivity.kt`: override `onStop`/`onPause` to keep JS timers running while a task is active. Determine the exact webview handle during the spike; the documented pattern is to call `android.webkit.WebView`'s `resumeTimers()` (global) after `super`, e.g. add to `MainActivity`:

```kotlin
    override fun onStop() {
        super.onStop()
        // Keep WebView JS timers running so background downloads (kept
        // alive by TaskService) don't freeze when the Activity stops.
        // resumeTimers() is a global WebView call; safe to invoke here.
        try {
            android.webkit.WebView(this).resumeTimers()
        } catch (_: Throwable) { }
    }
```

Re-run step 5 until the GO criterion holds. Document in the commit body which path was taken.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/gen/android/app/src/main/AndroidManifest.xml \
        src-tauri/gen/android/app/src/main/java/com/leaflet/reader/TaskService.kt \
        src-tauri/gen/android/app/src/main/java/com/leaflet/reader/DownloadNotifier.kt
# include MainActivity.kt too if Step 6 was needed
git commit -m "feat(android): foreground service + wake lock for background tasks"
```

---

## Task 2: Rust/JNI bridge to start & stop the service

**Files:**
- Modify: `src-tauri/src/notify.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `TaskService.start(ctx)` / `TaskService.stop(ctx)` (Task 1).
- Produces: Tauri commands `start_task_service()` and `stop_task_service()` (both `Result<(), String>`), invokable from JS as `invoke("start_task_service")` / `invoke("stop_task_service")`. No-ops on non-Android.

- [ ] **Step 1: Add the two commands + JNI helpers in `notify.rs`**

After `set_status_bar_style` (around line 79), add:

```rust
/// Start the Android foreground TaskService (keeps the process/webview
/// alive while background work runs). No-op on non-Android.
#[tauri::command]
pub async fn start_task_service(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_task_service("start").map_err(|e| format!("start service failed: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

/// Stop the Android foreground TaskService. No-op on non-Android.
#[tauri::command]
pub async fn stop_task_service(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_task_service("stop").map_err(|e| format!("stop service failed: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}
```

Then add the JNI helper (Android-only) near `android_call_update`, reusing the same `ndk_context` + `find_app_class` pattern:

```rust
#[cfg(target_os = "android")]
fn android_task_service(op: &str) -> Result<(), Box<dyn std::error::Error>> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }?;
    let mut env = vm.attach_current_thread()?;
    let activity = unsafe { JObject::from_raw(ctx.context() as jni::sys::jobject) };

    let class = find_app_class(&mut env, &activity, "com.leaflet.reader.TaskService")?;
    let method = if op == "stop" { "stop" } else { "start" };
    env.call_static_method(
        &class,
        method,
        "(Landroid/content/Context;)V",
        &[JValue::Object(&activity)],
    )?;
    Ok(())
}
```

- [ ] **Step 2: Register both commands in `lib.rs`**

In the `generate_handler!` list (lines 12-19), add after `notify::consume_launch_intent,`:

```rust
            notify::start_task_service,
            notify::stop_task_service,
```

- [ ] **Step 3: Host typecheck of the non-Android branches**

Run: `cd src-tauri && cargo check`
Expected: compiles (host build exercises the `#[cfg(not(target_os = "android"))]` no-op branches and command registration).

- [ ] **Step 4: Verify on device via devtools**

Run: `pnpm android:dev`. In the webview devtools console:
`await window.__TAURI__.core.invoke("start_task_service")` → the "…" foreground notification appears.
`await window.__TAURI__.core.invoke("stop_task_service")` → it disappears.
(If `window.__TAURI__` isn't exposed, add a temporary `import { invoke } from "@tauri-apps/api/core"` call behind a dev button; remove before commit.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/notify.rs src-tauri/src/lib.rs
git commit -m "feat(android): tauri commands to start/stop the task service"
```

---

## Task 3: JS coordinator — drive the service from the queue's active count

**Files:**
- Create: `src/store/backgroundTasks.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `subscribe`, `getState`, `type DownloadJob` from `./downloadQueue`; `invoke` from `@tauri-apps/api/core`; `platform` from `@tauri-apps/plugin-os`.
- Produces: `startBackgroundTaskCoordinator(): () => void` (idempotent, returns unsubscribe). `activeBackgroundCount(): number` (pure, exported for later tasks/tests).

- [ ] **Step 1: Create `src/store/backgroundTasks.ts`**

```typescript
// Coordinator that keeps the Android foreground TaskService running
// exactly while background-eligible work is in flight. Single source of
// truth for "is background work happening" — the notifier reuses the
// same active-count logic. On non-Android platforms the service calls
// are no-ops (the webview keeps running when minimized anyway).

import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import {
  subscribe as subscribeQueue,
  getState as getQueueState,
  type DownloadJob,
} from "./downloadQueue";

/** Count queue jobs that represent live work (queued or running).
 *  Terminal + interrupted jobs are not "active". */
export function activeQueueCount(jobs: DownloadJob[]): number {
  let n = 0;
  for (const j of jobs) {
    if (j.status === "queued" || j.status === "running") n++;
  }
  return n;
}

/** Total active background work across every source. Task 4 adds
 *  imports here. Exported so the notifier and tests share one rule. */
export function activeBackgroundCount(): number {
  return activeQueueCount(getQueueState().jobs);
}

let cachedIsAndroid: boolean | null = null;
async function isAndroid(): Promise<boolean> {
  if (cachedIsAndroid !== null) return cachedIsAndroid;
  try {
    cachedIsAndroid = (await platform()) === "android";
  } catch {
    cachedIsAndroid = false;
  }
  return cachedIsAndroid;
}

let serviceRunning = false;
let started = false;

async function syncService(): Promise<void> {
  if (!(await isAndroid())) return;
  const shouldRun = activeBackgroundCount() > 0;
  if (shouldRun === serviceRunning) return;
  serviceRunning = shouldRun;
  try {
    await invoke(shouldRun ? "start_task_service" : "stop_task_service");
  } catch (e) {
    // Degrade gracefully: downloads still run in-app; we just lose the
    // keep-alive. Reset so the next transition retries.
    serviceRunning = !shouldRun;
    // eslint-disable-next-line no-console
    console.warn("[backgroundTasks] service sync failed:", e);
  }
}

/** Wire the coordinator to every active-work source. Idempotent.
 *  Returns an unsubscribe handle (the app doesn't need to call it). */
export function startBackgroundTaskCoordinator(): () => void {
  if (started) return () => {};
  started = true;
  const unsubQueue = subscribeQueue(() => {
    void syncService();
  });
  return () => {
    unsubQueue();
  };
}
```

- [ ] **Step 2: Wire it into boot in `App.tsx`**

In the existing boot effect (lines 253-263), start the coordinator after the notifier. Update the async block:

```typescript
    (async () => {
      await loadPersistedQueue();
      startDownloadNotifier();
      startBackgroundTaskCoordinator();
    })();
```

Add the import alongside the existing store imports at the top of `App.tsx`:

```typescript
import { startBackgroundTaskCoordinator } from "./store/backgroundTasks";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify end-to-end (the payoff)**

Run: `pnpm android:dev`.
1. Start a multi-chapter download → the foreground notification appears **on its own** (no adb needed now).
2. Home + screen off ~60s → reopen → downloads progressed/completed while dark.
3. Let the queue drain → the foreground service notification is removed automatically.

- [ ] **Step 5: Commit**

```bash
git add src/store/backgroundTasks.ts src/App.tsx
git commit -m "feat: coordinate android task service with the download queue"
```

---

## Task 4: Fold imports into the unified active-count and the notification

Imports (esp. Sources-based imports that fetch many chapters) must also keep the service alive and appear in the single notification.

**Files:**
- Modify: `src/store/importProgress.ts`
- Modify: `src/store/backgroundTasks.ts`
- Modify: `src/store/downloadNotifier.ts`
- Modify: `src/store/downloadNotifier/transport.ts`

**Interfaces:**
- Consumes: import store `subscribe`, `getState`, `ProgressState`.
- Produces: `isImportActive(s: ProgressState): boolean` (pure) from `importProgress.ts`; `DOWNLOAD_SUMMARY_ID` from `transport.ts`.

- [ ] **Step 1: Add a pure `isImportActive` to `importProgress.ts`**

An import counts as live work while it's running and hasn't finished or errored:

```typescript
/** True while an import is actively in progress (started, not yet
 *  finished or errored). Used by the background-task coordinator and
 *  the notifier so imports keep the service alive and show progress. */
export function isImportActive(s: ProgressState): boolean {
  return s.active && s.finishedAt === null && s.error === null;
}
```

- [ ] **Step 2: Have the coordinator watch imports too**

In `backgroundTasks.ts`, import the store and fold it into `activeBackgroundCount`, and subscribe to it:

```typescript
import {
  subscribe as subscribeImport,
  getState as getImportState,
  isImportActive,
} from "./importProgress";
```

Update `activeBackgroundCount`:

```typescript
export function activeBackgroundCount(): number {
  const queue = activeQueueCount(getQueueState().jobs);
  const imports = isImportActive(getImportState()) ? 1 : 0;
  return queue + imports;
}
```

In `startBackgroundTaskCoordinator`, also subscribe to the import store:

```typescript
  const unsubImport = subscribeImport(() => {
    void syncService();
  });
  return () => {
    unsubQueue();
    unsubImport();
  };
```

- [ ] **Step 3: Add the separate terminal-summary id in `transport.ts`**

After `DOWNLOAD_NOTIFICATION_ID` (line 23):

```typescript
/** Separate id for the terminal "all done / failed" summary so it can
 *  co-exist with (and outlive) the foreground-service progress
 *  notification (id 1001), which the service removes on stop. */
export const DOWNLOAD_SUMMARY_ID = 1002;
```

- [ ] **Step 4: Route the terminal summary to id 1002 in `downloadNotifier.ts`**

Import the new id (extend the existing import from `./downloadNotifier/transport`):

```typescript
import {
  DOWNLOAD_NOTIFICATION_ID,
  DOWNLOAD_SUMMARY_ID,
  pushDownloadNotification,
} from "./downloadNotifier/transport";
```

In `publish()`, where it calls `pushDownloadNotification({ id: NOTIFICATION_ID, ... })` (lines 266-275), choose the id by whether this is the terminal summary:

```typescript
  await pushDownloadNotification({
    id: isTerminalSummary ? DOWNLOAD_SUMMARY_ID : NOTIFICATION_ID,
    title: composed.title,
    body: composed.body,
    progress: composed.progress,
    max: composed.max,
    indeterminate: composed.indeterminate,
    ongoing: composed.ongoing,
    tapsToQueue: composed.tapsToQueue,
  });
```

- [ ] **Step 5: Make the notifier subscribe to imports and include them**

The notifier currently only subscribes to the queue. Give it import awareness so a lone import (no queue jobs) still shows one notification. In `startDownloadNotifier()`, add an import subscription that re-publishes:

```typescript
import {
  subscribe as subscribeImport,
  getState as getImportState,
  isImportActive,
} from "./importProgress";
```

```typescript
export function startDownloadNotifier(): () => void {
  if (started) return () => {};
  started = true;
  const unsubQueue = subscribe((state) => {
    void publish(summarize(state.jobs));
  });
  const unsubImport = subscribeImport(() => {
    void publish(summarize(getState().jobs));
  });
  return () => {
    unsubQueue();
    unsubImport();
  };
}
```

Extend `Snapshot` with import fields and populate them in `summarize` by reading the import store (the import store is a singleton, safe to read here):

```typescript
interface Snapshot {
  active: number;
  activeConversions: number;
  importActive: boolean;   // an import is in flight
  importPct: number;       // 0..100 for the active import
  done: number;
  error: number;
  cancelled: number;
  total: number;
  lastTerminal: DownloadJob | null;
}
```

In `summarize`, after the loop, read the import state and set `importActive`/`importPct`, and add the import to `active`:

```typescript
  const imp = getImportState();
  const importActive = isImportActive(imp);
  const importPct = Math.round(imp.overall * 100);
  return {
    active: active + (importActive ? 1 : 0),
    activeConversions,
    importActive,
    importPct,
    done, error, cancelled,
    total: jobs.length + (importActive ? 1 : 0),
    lastTerminal,
  };
```

(Content wording for the import case is finalized in Task 5; for now `compose` can fall through to the generic ongoing branch — verify it shows *a* notification for a lone import.)

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors (fix any `Snapshot` field references that now need the new fields).

- [ ] **Step 7: Verify on device**

Run: `pnpm android:dev`.
1. Start a **Sources-based import** of a multi-chapter book. → foreground service starts (keep-alive), and a single progress notification shows.
2. Home + screen off during the import → reopen → import advanced while dark.
3. Start an import **and** a download together → still **one** notification; service stays up until both finish.

- [ ] **Step 8: Commit**

```bash
git add src/store/importProgress.ts src/store/backgroundTasks.ts \
        src/store/downloadNotifier.ts src/store/downloadNotifier/transport.ts
git commit -m "feat: include imports in background keep-alive and the unified notification"
```

---

## Task 5: Smooth aggregate progress + mixed-work content + i18n

Make the single notification read accurately: a smooth percentage, a clear line when download + convert + import overlap, and correct terminal summaries.

**Files:**
- Modify: `src/store/downloadNotifier.ts`
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts`

**Interfaces:**
- Consumes: `Snapshot` (extended in Task 4), `getState().jobs`.
- Produces: (internal) a smooth `overallFraction`.

- [ ] **Step 1: Add new i18n keys (en + ar)**

In both `src/i18n/en.ts` and `src/i18n/ar.ts`, add under the existing `status.notif.*` group. English values:

```typescript
"status.notif.downloadingProgress": "Downloading {done} of {total} · {pct}%",
"status.notif.importingTitle": "Importing book",
"status.notif.importingBody": "{pct}% done",
"status.notif.backgroundTasksTitle": "Background tasks · {pct}%",
"status.notif.mixedBody": "{parts}",           // e.g. "Downloading 3 of 12 · Converting · Importing"
"status.notif.partDownloads": "Downloading {n}",
"status.notif.partConverting": "Converting",
"status.notif.partImporting": "Importing",
```

Arabic values (mirror keys; translate — e.g.):

```typescript
"status.notif.downloadingProgress": "جارٍ التنزيل {done} من {total} · {pct}٪",
"status.notif.importingTitle": "جارٍ استيراد الكتاب",
"status.notif.importingBody": "اكتمل {pct}٪",
"status.notif.backgroundTasksTitle": "مهام في الخلفية · {pct}٪",
"status.notif.mixedBody": "{parts}",
"status.notif.partDownloads": "تنزيل {n}",
"status.notif.partConverting": "تحويل",
"status.notif.partImporting": "استيراد",
```

- [ ] **Step 2: Compute a smooth overall fraction in `downloadNotifier.ts`**

Add a helper that sums per-job fractional progress across the burst so the bar moves continuously (not just at chapter boundaries), including the active import:

```typescript
/** Smooth 0..1 progress across all live work in the current burst.
 *  Each queue job contributes its own `progress`; completed jobs count
 *  as 1; the active import contributes its `overall`. Denominator is
 *  the burst total so the bar fills as work finishes. */
function overallFraction(snap: Snapshot): number {
  const jobs = getState().jobs;
  let sum = 0;
  for (const j of jobs) {
    if (j.status === "done") sum += 1;
    else if (j.status === "running" || j.status === "queued") sum += j.progress;
  }
  if (snap.importActive) sum += snap.importPct / 100;
  const denom = Math.max(burstTotal, 1);
  return Math.min(1, sum / denom);
}
```

- [ ] **Step 3: Use the smooth fraction + new copy in `compose()`**

In the `snap.active > 0` chapter-download branch (lines 330-367), replace the fixed `progress: completedThisBurst, max: burstTotal` with a percentage and use the new `downloadingProgress` string. Compute once at the top of the active branch:

```typescript
    const pctOverall = Math.round(overallFraction(snap) * 100);
```

For the pure chapter-download case, set body/progress:

```typescript
      body = tr("status.notif.downloadingProgress", {
        done: completedThisBurst,
        total: burstTotal,
        pct: pctOverall,
      });
```
```typescript
    return {
      title,
      body,
      progress: pctOverall,
      max: 100,
      indeterminate: false,
      ongoing: true,
      tapsToQueue: true,
    };
```

Add a **mixed-work** branch at the very top of the `snap.active > 0` block: when more than one *kind* is active (downloads + conversions + import), show one aggregate line instead of privileging one:

```typescript
    const kinds: string[] = [];
    const dl = snap.active - snap.activeConversions - (snap.importActive ? 1 : 0);
    if (dl > 0) kinds.push(tr("status.notif.partDownloads", { n: dl }));
    if (snap.activeConversions > 0) kinds.push(tr("status.notif.partConverting"));
    if (snap.importActive) kinds.push(tr("status.notif.partImporting"));
    if (kinds.length > 1) {
      const pct = Math.round(overallFraction(snap) * 100);
      return {
        title: tr("status.notif.backgroundTasksTitle", { pct }),
        body: tr("status.notif.mixedBody", { parts: kinds.join(" · ") }),
        progress: pct,
        max: 100,
        indeterminate: false,
        ongoing: true,
        tapsToQueue: true,
      };
    }
```

Add a **lone-import** branch (import active, no queue work): after the mixed branch, before the conversion branch:

```typescript
    if (snap.importActive && dl === 0 && snap.activeConversions === 0) {
      return {
        title: tr("status.notif.importingTitle"),
        body: tr("status.notif.importingBody", { pct: snap.importPct }),
        progress: snap.importPct,
        max: 100,
        indeterminate: false,
        ongoing: true,
        tapsToQueue: false,
      };
    }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify on device (Android)**

Run: `pnpm android:dev`.
- Download ~12 chapters: notification reads `Downloading N of 12 · P%`, and the bar/percent advance smoothly (not just at chapter boundaries).
- Import alone: reads `Importing book · P%`.
- Import + download together: **one** notification titled `Background tasks · P%`, body lists both kinds.
- Let a batch finish with one failure: terminal summary (id 1002) shows the completed/failed counts and **alerts** (sound), while the progress notification (1001) is gone. Confirm you never see two live notifications at once.

- [ ] **Step 6: Commit**

```bash
git add src/store/downloadNotifier.ts src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(notifications): smooth aggregate progress and mixed-task summary"
```

---

## Task 6: Desktop — start/end-only notifications + taskbar/dock progress bar

On desktop the OS-notification plugin tends to stack per send and has no progress widget. Fix by (a) only notifying on start and completion, and (b) reflecting live progress on the taskbar/dock icon via Tauri's `setProgressBar`.

**Files:**
- Modify: `src/store/downloadNotifier/transport.ts`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: `getCurrentWindow` from `@tauri-apps/api/window`; `NotificationPayload` (existing).
- Produces: `setDockProgress(fraction: number | null): Promise<void>` (fraction 0..1, or `null` to clear) in `transport.ts`.

- [ ] **Step 1: Allow `setProgressBar` in capabilities**

In `src-tauri/capabilities/default.json`, add to the `permissions` array:

```json
    "core:window:allow-set-progress-bar",
```

- [ ] **Step 2: Add `setDockProgress` and desktop start/end-only logic in `transport.ts`**

```typescript
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
```

```typescript
/** Reflect aggregate progress on the desktop taskbar/dock icon.
 *  fraction: 0..1 while working; null clears the indicator. No-op on
 *  mobile (guarded by the caller). Best-effort — never throws. */
export async function setDockProgress(fraction: number | null): Promise<void> {
  try {
    const w = getCurrentWindow();
    if (fraction === null) {
      await w.setProgressBar({ status: ProgressBarStatus.None });
    } else {
      await w.setProgressBar({
        status: ProgressBarStatus.Normal,
        progress: Math.max(0, Math.min(100, Math.round(fraction * 100))),
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[downloadNotifier] setProgressBar failed:", e);
  }
}
```

In `pushDownloadNotification`, change the desktop fallback so ongoing (in-progress) sends do NOT fire a new OS notification each tick — only the non-ongoing terminal summary does. Live progress goes to the dock instead:

```typescript
  // Desktop / iOS fallback: no progress widget in OS notifications and
  // per-tick sends stack, so only notify on the terminal (non-ongoing)
  // summary. Live progress is shown on the taskbar/dock instead.
  if (p.ongoing) {
    return; // in-progress tick — dock progress is driven separately
  }
  try {
    sendNotification({
      id,
      channelId: DOWNLOAD_CHANNEL_ID,
      title: p.title,
      body: p.body,
      ongoing: false,
      silent: false,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[downloadNotifier] fallback sendNotification failed:", e);
  }
```

- [ ] **Step 3: Drive the dock progress from the notifier**

In `downloadNotifier.ts`, import `setDockProgress` and call it from `publish()`. On non-terminal publishes set the fraction; on idle-reset / terminal, clear it. Add near the top of `publish` (after the idle-reset block that returns early — before that early return, clear the dock):

In the idle-reset branch (lines 200-212), before `return;`:

```typescript
    void setDockProgress(null);
```

Where the in-progress notification is pushed (after computing `composed`), also update the dock:

```typescript
  if (!isTerminalSummary) {
    void setDockProgress(overallFraction(snap));
  } else {
    void setDockProgress(null);
  }
```

Extend the transport import:

```typescript
import {
  DOWNLOAD_NOTIFICATION_ID,
  DOWNLOAD_SUMMARY_ID,
  pushDownloadNotification,
  setDockProgress,
} from "./downloadNotifier/transport";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify on desktop**

Run: `pnpm tauri dev` (desktop).
- Start a multi-chapter download, minimize the window.
- Expected: **no** per-chapter notification spam; the dock/taskbar icon shows a progress bar that advances.
- On completion: exactly **one** "all done" (or "N failed") notification fires with sound; the dock progress clears.

- [ ] **Step 6: Commit**

```bash
git add src/store/downloadNotifier/transport.ts src/store/downloadNotifier.ts \
        src-tauri/capabilities/default.json
git commit -m "feat(desktop): taskbar progress and start/end-only notifications"
```

---

## Self-Review

**Spec coverage:**
- Background execution on Android (switched-away/screen-off) → Tasks 1–4 (service + coordinator + import inclusion). ✅
- Spike/liveness de-risk → Task 1 steps 5–6. ✅
- One unified notification across downloads + imports + conversions → Tasks 4–5. ✅
- "Multiple notifications" fix → separate summary id (Task 4) + desktop start/end-only (Task 6). ✅
- No import/convert notification → import folded in (Task 4); conversion already covered, re-verified (Task 5). ✅
- Poor progress info → smooth aggregate + mixed-work copy (Task 5). ✅
- Desktop plain/ungrouped → dock progress + start/end-only (Task 6). ✅
- Non-goals (swipe-away, cloud, Rust re-port) → explicitly excluded; `START_NOT_STICKY` + existing crash-recovery honor "don't corrupt on swipe-away". ✅
- Error handling: service-sync failure degrades gracefully (Task 3 `syncService` catch); permission denial already handled by the notifier; wake-lock release on every stop path (Task 1). ✅

**Placeholder scan:** No TBD/TODO; every code step has concrete content. The one genuinely open item — the exact webview hook if JS pauses — is intentionally a spike outcome (Task 1 step 6 gives the documented fix to apply).

**Type consistency:** `activeBackgroundCount()` / `activeQueueCount()` names consistent across Tasks 3–4. `Snapshot` gains `importActive`/`importPct` in Task 4 and is consumed by `overallFraction`/`compose` in Task 5. `DOWNLOAD_SUMMARY_ID` defined in Task 4, imported in Tasks 4 & 6. `setDockProgress` defined in Task 6 step 2, consumed in step 3. `TaskService.start/stop` (Task 1) consumed by `android_task_service` (Task 2). `isImportActive` defined in Task 4 step 1, consumed in Tasks 3-modified and 4. Consistent.

**Verification realism:** No fake unit tests. Steps use `tsc --noEmit`, `cargo check`, `pnpm android:dev` / `tauri dev`, and concrete manual observations. ✅
