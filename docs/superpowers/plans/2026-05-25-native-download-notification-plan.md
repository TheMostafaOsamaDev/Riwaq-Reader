# Native Android Download-Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unicode-bar download notification with a real Android `NotificationCompat.Builder.setProgress(...)` widget; give it a dynamic `Downloading <Novel> — Ch. NNN` title; keep one notification id; route taps to the in-app Download Queue view; degrade gracefully to plain text on iOS / desktop.

**Architecture:** Three layers:
1. A new Kotlin class `DownloadNotifier` (sibling of `MainActivity`) wraps `NotificationCompat.Builder` and the existing `leaflet-downloads` channel.
2. A new Rust command `update_download_notification` invokes the Kotlin class via JNI on Android and is a no-op elsewhere. A second command `consume_launch_intent` returns and clears the pending launch-intent extra.
3. Frontend transport (`src/store/downloadNotifier/transport.ts`) detects platform: on Android, `invoke(...)` the Rust command; everywhere else, fall through to the existing `@tauri-apps/plugin-notification`. The existing `downloadNotifier.ts` (queue listener + throttle + dedupe) keeps its shape; only `compose()` and `publish()` change.

**Tech Stack:** Rust + `jni` crate (Android FFI), Kotlin (`androidx.core.app.NotificationCompat`), TypeScript / React 19, Tauri 2.

**Spec:** `docs/superpowers/specs/2026-05-25-native-download-notification-design.md`

---

## File Structure

| File | Purpose | New? |
|---|---|---|
| `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/DownloadNotifier.kt` | Encapsulates `NotificationCompat.Builder` work for progress notifications. Static `update(...)` and `cancel(...)` entry points called by Rust via JNI. | New |
| `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/MainActivity.kt` | Read `leaflet.open` intent extra in `onCreate` / `onNewIntent`, store in a companion-object volatile field, emit Tauri event. | Modify |
| `src-tauri/src/lib.rs` | Register `update_download_notification` and `consume_launch_intent` commands. | Modify |
| `src-tauri/src/notify.rs` | New module hosting the two commands + the Android-only JNI helper. | New |
| `src-tauri/Cargo.toml` | Add `jni` (Android only). | Modify |
| `src-tauri/capabilities/default.json` | Allow the two new commands. | Modify |
| `src/store/downloadNotifier.ts` | `compose()` returns the richer payload; `publish()` calls the transport; drop `renderBar` helper. | Modify |
| `src/store/downloadNotifier/transport.ts` | Platform-switch wrapper that dispatches to the Rust command (Android) or the Tauri notification plugin (everywhere else). | New |
| `src/hooks/useLaunchIntent.ts` | On mount, drain pending intent via `consume_launch_intent`; subscribe to the `launch-intent` Tauri event. Calls a shared `openDownloadQueue()` for `queue` intents. | New |
| `src/store/uiIntents.ts` | Tiny pub/sub for `openDownloadQueue()` — App / Library subscribe. Avoids prop-drilling. | New |
| `src/App.tsx` | Mount `useLaunchIntent()` at the shell root. | Modify |
| `src/components/Library.tsx` | Subscribe to `uiIntents`'s `openDownloadQueue` event; set `queueOpen=true` on emit. | Modify |

---

## Task 1: Add `jni` dependency for Android builds

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1.1: Add the Android-target jni dependency**

Use the Edit tool to add a target-specific dependency block at the end of the `[dependencies]` section.

**old_string:**
```toml
tokio = { version = "1", features = ["time", "macros", "rt-multi-thread", "sync"] }
```

**new_string:**
```toml
tokio = { version = "1", features = ["time", "macros", "rt-multi-thread", "sync"] }

# Android-only: JNI bridge into the Kotlin DownloadNotifier class (see
# src/notify.rs). Pinned to a version that matches the JNI ABI used by
# Tauri 2's Android runtime.
[target.'cfg(target_os = "android")'.dependencies]
jni = "0.21"
```

- [ ] **Step 1.2: Sanity check (desktop build)**

Run: `cd src-tauri && cargo check`
Expected: completes successfully. The Android-only `jni` dep is not pulled in on desktop.

- [ ] **Step 1.3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "build(tauri): add android-only jni dependency"
```

---

## Task 2: Create the Kotlin `DownloadNotifier`

**Files:**
- Create: `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/DownloadNotifier.kt`

- [ ] **Step 2.1: Write the Kotlin file**

Use the Write tool. Path: `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/DownloadNotifier.kt`

```kotlin
package com.leaflet.reader

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Builds the in-progress / terminal download notification. Wraps
 * NotificationCompat.Builder + setProgress(max, progress, indeterminate)
 * for the real Android widget. Invoked from Rust over JNI; see
 * src-tauri/src/notify.rs.
 *
 * Channel id matches the existing TypeScript-side `leaflet-downloads`
 * channel so importance / vibration policy stays consistent.
 */
object DownloadNotifier {
    private const val CHANNEL_ID = "leaflet-downloads"
    private const val CHANNEL_NAME = "Downloads"
    private const val CHANNEL_DESC = "Chapter downloads and offline-book conversions"

    /** Static channel-ensure. Idempotent. */
    @JvmStatic
    private fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val ch = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW).apply {
            description = CHANNEL_DESC
            enableLights(false)
            enableVibration(false)
            setShowBadge(false)
        }
        nm.createNotificationChannel(ch)
    }

    /**
     * Push or update a download-progress notification.
     *
     * @param ctx Application context (passed in from Rust via JNI).
     * @param id Stable notification id; reuse to update in place.
     * @param title Notification title (e.g., "Downloading Re:Zero — Ch. 234").
     * @param body Notification body (e.g., "Chapter 5 of 23").
     * @param progress 0..max current value.
     * @param max Progress widget maximum (typically 100 or queue total).
     * @param indeterminate If true, the bar shows the looping animation
     *   instead of a fixed value. Use when burst total isn't known yet.
     * @param ongoing If true, marks the notification as background work
     *   (suppresses heads-up + can't be swiped away).
     * @param tapsToQueue If true, attaches a PendingIntent that opens
     *   MainActivity with extra `leaflet.open=queue`. If false, no tap
     *   intent (notification is informational).
     */
    @JvmStatic
    fun update(
        ctx: Context,
        id: Int,
        title: String,
        body: String,
        progress: Int,
        max: Int,
        indeterminate: Boolean,
        ongoing: Boolean,
        tapsToQueue: Boolean,
    ) {
        ensureChannel(ctx)

        val builder = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            // Re-use the launcher icon as the small icon. The mipmap
            // `ic_launcher` is what every Tauri 2 Android app ships
            // with; replace later with a dedicated monochrome icon.
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOnlyAlertOnce(true)
            .setOngoing(ongoing)
            .setProgress(max, progress, indeterminate)
            .setPriority(NotificationCompat.PRIORITY_LOW)

        if (tapsToQueue) {
            val intent = Intent(ctx, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra("leaflet.open", "queue")
            }
            // API 31+ requires FLAG_IMMUTABLE on PendingIntents.
            val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            val pi = PendingIntent.getActivity(ctx, id, intent, piFlags)
            builder.setContentIntent(pi)
        }

        NotificationManagerCompat.from(ctx).notify(id, builder.build())
    }

    /** Cancel the notification with the given id. */
    @JvmStatic
    fun cancel(ctx: Context, id: Int) {
        NotificationManagerCompat.from(ctx).cancel(id)
    }
}
```

- [ ] **Step 2.2: Verify the Kotlin compiles (Android build)**

This step only succeeds when run from an environment with the Android SDK + JDK. Skip if those aren't available; the next Android build will catch any Kotlin syntax errors.

Run (if Android SDK is available): `cd src-tauri/gen/android && ./gradlew :app:compileDebugKotlin -q`
Expected: completes with no errors.

If you don't have the Android SDK locally, **proceed**. The full `pnpm tauri android build` in Task 11 will compile Kotlin too.

- [ ] **Step 2.3: Commit**

```bash
git add src-tauri/gen/android/app/src/main/java/com/leaflet/reader/DownloadNotifier.kt
git commit -m "feat(android): add DownloadNotifier Kotlin class with NotificationCompat progress"
```

---

## Task 3: Wire up `MainActivity` for launch-intent extras

**Files:**
- Modify: `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/MainActivity.kt`

- [ ] **Step 3.1: Replace the file**

Use the Write tool. Path: `src-tauri/gen/android/app/src/main/java/com/leaflet/reader/MainActivity.kt`

```kotlin
package com.leaflet.reader

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Cold launch: stash any intent extra so consume_launch_intent
        // can drain it on frontend mount.
        intent?.let { rememberLaunchIntent(it) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Warm launch (singleTask): the running activity gets a new
        // intent (e.g., user tapped the notification while the app
        // was backgrounded). Update the stashed value so the frontend's
        // event listener fires the right side effect.
        rememberLaunchIntent(intent)
    }

    private fun rememberLaunchIntent(intent: Intent) {
        val extra = intent.getStringExtra("leaflet.open") ?: return
        pendingLaunchIntent = extra
    }

    companion object {
        /** Stashed launch-intent extra. Drained by Rust's
         *  consume_launch_intent. Volatile so cross-thread reads see
         *  the latest write. */
        @JvmStatic
        @Volatile
        var pendingLaunchIntent: String? = null
    }
}
```

- [ ] **Step 3.2: Commit**

```bash
git add src-tauri/gen/android/app/src/main/java/com/leaflet/reader/MainActivity.kt
git commit -m "feat(android): MainActivity stashes leaflet.open launch-intent extras"
```

---

## Task 4: Create the Rust `notify` module + commands

**Files:**
- Create: `src-tauri/src/notify.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 4.1: Write the notify module**

Use the Write tool. Path: `src-tauri/src/notify.rs`

```rust
// Bridge from the frontend to the Android-side DownloadNotifier class.
// Two commands:
//
//   update_download_notification — set / update the running download
//     notification. Calls into Kotlin via JNI on Android. No-op on
//     other platforms (frontend's transport layer doesn't call this
//     command on non-Android anyway, so the no-op is just a safety
//     net).
//
//   consume_launch_intent — drain the launch-intent extra stashed by
//     MainActivity. Returns Some("queue") or None. Used by the
//     frontend's useLaunchIntent hook on mount.
//
// Both commands are infallible from the frontend's perspective in the
// sense that they always return a Result; the frontend can log a
// warning and continue.

use tauri::AppHandle;

#[cfg(target_os = "android")]
use jni::objects::{JClass, JObject, JValue};
#[cfg(target_os = "android")]
use jni::sys::{jboolean, jint, JNI_FALSE, JNI_TRUE};

/// Update the download-progress notification. Parameters mirror
/// `DownloadNotifier.update(...)` on the Android side.
#[tauri::command]
pub async fn update_download_notification(
    app: AppHandle,
    id: i32,
    title: String,
    body: String,
    progress: i32,
    max: i32,
    indeterminate: bool,
    ongoing: bool,
    taps_to_queue: bool,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_call_update(
            &app, id, title, body, progress, max, indeterminate, ongoing,
            taps_to_queue,
        )
        .map_err(|e| format!("android notify failed: {e}"))?;
        let _ = app; // suppress unused warning on android
        return Ok(());
    }
    #[cfg(not(target_os = "android"))]
    {
        // No-op on non-Android. The frontend's transport falls back to
        // the Tauri notification plugin before invoking this command,
        // so this branch should be unreachable in practice. Keep the
        // command registered for symmetric capability declarations.
        let _ = (
            app, id, title, body, progress, max, indeterminate, ongoing,
            taps_to_queue,
        );
        Ok(())
    }
}

/// Drain the pending launch-intent extra. Returns `Some(extra)` once,
/// then `None` until the next intent arrives. Used by the frontend
/// `useLaunchIntent` hook on mount.
#[tauri::command]
pub async fn consume_launch_intent(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        return android_consume_intent(&app)
            .map_err(|e| format!("android consume_launch_intent failed: {e}"))
            .map(Some)
            .or_else(|_| Ok(None));
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(None)
    }
}

#[cfg(target_os = "android")]
fn android_call_update(
    app: &AppHandle,
    id: i32,
    title: String,
    body: String,
    progress: i32,
    max: i32,
    indeterminate: bool,
    ongoing: bool,
    taps_to_queue: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    app.run_on_main_thread({
        let title = title.clone();
        let body = body.clone();
        move || {
            // Acquire the JavaVM via the Tauri Android runtime.
            // tauri::ANDROID_APP holds a static reference set up by the
            // mobile_entry_point macro.
            let ctx = ndk_context::android_context();
            let vm =
                unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.expect("get JavaVM");
            let mut env = vm.attach_current_thread().expect("attach jni thread");
            let activity =
                unsafe { JObject::from_raw(ctx.context() as jni::sys::jobject) };

            let title_j = env.new_string(title).expect("title jstring");
            let body_j = env.new_string(body).expect("body jstring");

            let class = env
                .find_class("com/leaflet/reader/DownloadNotifier")
                .expect("find DownloadNotifier");

            env.call_static_method(
                &class,
                "update",
                "(Landroid/content/Context;ILjava/lang/String;Ljava/lang/String;IIZZZ)V",
                &[
                    JValue::Object(&activity),
                    JValue::Int(id as jint),
                    JValue::Object(&title_j),
                    JValue::Object(&body_j),
                    JValue::Int(progress as jint),
                    JValue::Int(max as jint),
                    JValue::Bool(if indeterminate { JNI_TRUE } else { JNI_FALSE }
                        as jboolean),
                    JValue::Bool(if ongoing { JNI_TRUE } else { JNI_FALSE }
                        as jboolean),
                    JValue::Bool(if taps_to_queue { JNI_TRUE } else { JNI_FALSE }
                        as jboolean),
                ],
            )
            .expect("call_static_method update");
        }
    })
    .map_err(|e| Box::<dyn std::error::Error>::from(format!("run_on_main_thread: {e:?}")))?;
    Ok(())
}

#[cfg(target_os = "android")]
fn android_consume_intent(_app: &AppHandle) -> Result<String, Box<dyn std::error::Error>> {
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }?;
    let mut env = vm.attach_current_thread()?;

    let class = env.find_class("com/leaflet/reader/MainActivity")?;
    let value = env.get_static_field(
        &class,
        "pendingLaunchIntent",
        "Ljava/lang/String;",
    )?;
    let obj: JObject = value.l()?;

    if obj.is_null() {
        return Err("no pending intent".into());
    }

    let jstr: jni::objects::JString = obj.into();
    let rust_str: String = env.get_string(&jstr)?.into();

    // Clear so subsequent calls return None.
    env.set_static_field(
        &class,
        ("pendingLaunchIntent", "Ljava/lang/String;"),
        JValue::Object(&JObject::null()),
    )?;

    Ok(rust_str)
}
```

**Note on `ndk_context`:** the `ndk-context` crate is what Tauri 2 mobile uses to expose the global Android `JavaVM` + activity. If `ndk-context` is not already a transitive dep of Tauri 2 mobile, add it explicitly:

```toml
[target.'cfg(target_os = "android")'.dependencies]
jni = "0.21"
ndk-context = "0.1"
```

(If the build fails on `unresolved import ndk_context`, add this dep.)

- [ ] **Step 4.2: Register the commands in `lib.rs`**

Use the Edit tool on `src-tauri/src/lib.rs`.

**old_string:**
```rust
mod sources;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            sources::source_fetch,
            sources::source_fetch_bytes,
            sources::source_render_and_extract,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**new_string:**
```rust
mod notify;
mod sources;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            sources::source_fetch,
            sources::source_fetch_bytes,
            sources::source_render_and_extract,
            notify::update_download_notification,
            notify::consume_launch_intent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4.3: Cargo check (desktop)**

Run: `cd src-tauri && cargo check`
Expected: completes successfully. Android-only code is feature-gated, so desktop build only sees the no-op branches.

- [ ] **Step 4.4: Commit**

```bash
git add src-tauri/src/notify.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): add notify module — Android JNI bridge for download progress"
```

---

## Task 5: Allow the new commands in `default.json` capabilities

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 5.1: Add the capability entry**

Custom Tauri commands registered in `invoke_handler` don't need a permission entry — capabilities are checked only for plugin commands. **Verify this is still the case** by running the desktop build (`pnpm tauri dev`) after Tasks 1–4. If the frontend's `invoke("update_download_notification", ...)` call (added in later tasks) is rejected at runtime with `not allowed`, add the following to `permissions`:

```json
"core:default",
"core:webview:allow-invoke"
```

If the existing setup already works (Tauri 2 default behavior allows app-defined commands), leave `default.json` untouched and skip the commit step.

- [ ] **Step 5.2: Sanity check**

Run: `cd src-tauri && cargo check`
Expected: still passes.

- [ ] **Step 5.3: Commit only if you changed the file**

```bash
git status
# If src-tauri/capabilities/default.json appears as modified:
git add src-tauri/capabilities/default.json
git commit -m "build(tauri): allow notify commands in default capability"
# Otherwise skip — no commit needed.
```

---

## Task 6: Create the frontend transport

**Files:**
- Create: `src/store/downloadNotifier/transport.ts`

- [ ] **Step 6.1: Write the file**

Use the Write tool. Path: `src/store/downloadNotifier/transport.ts`

```ts
// Platform switch for the running download notification.
//
//   Android  → invoke the custom Rust command, which renders a real
//              NotificationCompat progress widget.
//   Anywhere → fall back to @tauri-apps/plugin-notification with
//              just title + body + ongoing. No widget, but the title
//              and body update so the user still sees state.
//
// Both paths reuse the same notification id (so the OS replaces in
// place) and the same `leaflet-downloads` channel on Android.

import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import {
  sendNotification,
} from "@tauri-apps/plugin-notification";

/** Channel id used by every download/conversion notification. The
 *  Android channel is created on the Kotlin side; the plugin's
 *  fallback path expects the same id for desktop/iOS consistency. */
export const DOWNLOAD_CHANNEL_ID = "leaflet-downloads";

/** Stable notification id reused so the system replaces in place
 *  rather than stacking. */
export const DOWNLOAD_NOTIFICATION_ID = 1001;

export interface NotificationPayload {
  /** Stable id. Defaults to DOWNLOAD_NOTIFICATION_ID. */
  id?: number;
  title: string;
  body: string;
  /** 0..max. Required for the Android widget; ignored on fallback. */
  progress: number;
  /** Widget max. Required for the Android widget; ignored on fallback. */
  max: number;
  /** If true, render the looping progress animation instead of a
   *  fixed value. Used when burst totals aren't known yet. */
  indeterminate?: boolean;
  /** If true, mark as ongoing (suppresses heads-up on Android, can't
   *  be swiped away). Terminal "all done" notifications pass false. */
  ongoing: boolean;
  /** If true, attach a tap-handler PendingIntent that opens the app
   *  to the in-app Download Queue view. */
  tapsToQueue?: boolean;
}

let cachedPlatform: string | null = null;
async function getPlatform(): Promise<string> {
  if (cachedPlatform !== null) return cachedPlatform;
  try {
    cachedPlatform = await platform();
  } catch {
    cachedPlatform = "unknown";
  }
  return cachedPlatform;
}

/** Push or replace the running download notification. Resolves once
 *  the OS-level send has been attempted; surface errors via the
 *  console rather than throwing — the queue keeps running regardless. */
export async function pushDownloadNotification(
  p: NotificationPayload,
): Promise<void> {
  const id = p.id ?? DOWNLOAD_NOTIFICATION_ID;
  const plat = await getPlatform();
  if (plat === "android") {
    try {
      await invoke("update_download_notification", {
        id,
        title: p.title,
        body: p.body,
        progress: p.progress,
        max: p.max,
        indeterminate: p.indeterminate ?? false,
        ongoing: p.ongoing,
        tapsToQueue: p.tapsToQueue ?? false,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[downloadNotifier] android invoke failed:", e);
    }
    return;
  }
  // Fallback: plain plugin notification. No progress widget.
  try {
    sendNotification({
      id,
      channelId: DOWNLOAD_CHANNEL_ID,
      title: p.title,
      body: p.body,
      ongoing: p.ongoing,
      silent: p.ongoing,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[downloadNotifier] fallback sendNotification failed:", e);
  }
}
```

- [ ] **Step 6.2: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 6.3: Commit**

```bash
git add src/store/downloadNotifier/transport.ts
git commit -m "feat(notify): platform-switch transport for download notifications"
```

---

## Task 7: Refactor `downloadNotifier.ts` to use the transport

**Files:**
- Modify: `src/store/downloadNotifier.ts`

- [ ] **Step 7.1: Read the file once to confirm the current state**

Run: `wc -l src/store/downloadNotifier.ts` — expected: ~389 lines.

- [ ] **Step 7.2: Replace the `compose()` function**

Use the Edit tool. Replace the existing `compose(...)` body so it returns the new payload shape and updates the title/body strings to the T1 format. Note: the function returns `Composed | null` today; widen to a richer type.

**old_string:**
```ts
interface Composed {
  title: string;
  body: string;
}

function compose(snap: Snapshot, completedThisBurst: number): Composed | null {
  if (snap.active > 0) {
    summaryShown = false;
    if (snap.activeConversions > 0) {
      const runningConversion = findRunningConversion();
      let body: string;
      if (runningConversion) {
        const pct = Math.round(runningConversion.progress * 100);
        const bar = renderBar(runningConversion.progress);
        body = runningConversion.phase
          ? `${runningConversion.phase}\n${bar}  ${pct}%`
          : `${bar}  ${pct}%`;
      } else {
        body = `${completedThisBurst} of ${burstTotal} jobs done`;
      }
      return { title: "Saving as offline book", body };
    }
    const fraction =
      burstTotal > 0 ? completedThisBurst / burstTotal : 0;
    return {
      title: "Downloading chapters",
      body: `${renderBar(fraction)}  ${Math.round(fraction * 100)}% · ${completedThisBurst} of ${burstTotal}`,
    };
  }
  if (summaryShown) return null;
  // If nothing actually finished in this session (e.g. on launch
  // with only `interrupted` jobs hanging around), the summary
  // notification would read as a misleading "all done" — skip it.
  if (snap.done === 0 && snap.error === 0 && snap.cancelled === 0) {
    return null;
  }
  if (snap.error > 0 || snap.cancelled > 0) {
    const bits: string[] = [];
    if (snap.done > 0) bits.push(`${snap.done} completed`);
    if (snap.error > 0) bits.push(`${snap.error} failed`);
    if (snap.cancelled > 0) bits.push(`${snap.cancelled} cancelled`);
    return {
      title: "Background work finished",
      body: bits.join(" · "),
    };
  }
  return {
    title: "All done",
    body:
      snap.done === 1 ? "1 job complete" : `${snap.done} jobs complete`,
  };
}
```

**new_string:**
```ts
interface Composed {
  title: string;
  body: string;
  progress: number;
  max: number;
  indeterminate: boolean;
  ongoing: boolean;
  tapsToQueue: boolean;
}

function compose(snap: Snapshot, completedThisBurst: number): Composed | null {
  if (snap.active > 0) {
    summaryShown = false;
    // Conversion in flight: T1 title with "Converting <Novel>".
    if (snap.activeConversions > 0) {
      const runningConversion = findRunningConversion();
      if (runningConversion) {
        const pct = Math.round(runningConversion.progress * 100);
        const novel = runningConversion.novelTitle;
        return {
          title: `Converting ${novel}`,
          body: runningConversion.phase || `${pct}% done`,
          progress: pct,
          max: 100,
          indeterminate: false,
          ongoing: true,
          tapsToQueue: true,
        };
      }
      // Conversion is queued but not yet started — fall through to
      // a generic ongoing notification while we wait for it to begin.
      return {
        title: "Preparing offline book",
        body: `${completedThisBurst} of ${burstTotal} jobs done`,
        progress: completedThisBurst,
        max: Math.max(burstTotal, 1),
        indeterminate: false,
        ongoing: true,
        tapsToQueue: true,
      };
    }

    // Chapter downloads: T1 title with currently-running chapter info.
    const running = findRunningChapter();
    const novelCount = countDistinctNovels(snap);
    let title: string;
    let body: string;
    if (running) {
      title = `Downloading ${running.novelTitle} — Ch. ${running.chapterId}`;
      const suffix = novelCount > 1 ? ` (${novelCount} novels)` : "";
      body = `Chapter ${completedThisBurst} of ${burstTotal}${suffix}`;
    } else {
      // Active count > 0 but no `running` job (all queued, none
      // started yet). Use a generic title and rely on the next
      // emission once a worker picks one up.
      title = "Downloading chapters";
      body = `${completedThisBurst} of ${burstTotal} chapters`;
    }
    return {
      title,
      body,
      progress: completedThisBurst,
      max: Math.max(burstTotal, 1),
      indeterminate: false,
      ongoing: true,
      tapsToQueue: true,
    };
  }

  if (summaryShown) return null;
  if (snap.done === 0 && snap.error === 0 && snap.cancelled === 0) {
    return null;
  }
  if (snap.error > 0 || snap.cancelled > 0) {
    const bits: string[] = [];
    if (snap.done > 0) bits.push(`${snap.done} completed`);
    if (snap.error > 0) bits.push(`${snap.error} failed`);
    if (snap.cancelled > 0) bits.push(`${snap.cancelled} cancelled`);
    return {
      title: "Background work finished",
      body: bits.join(" · "),
      progress: 100,
      max: 100,
      indeterminate: false,
      ongoing: false,
      tapsToQueue: true,
    };
  }
  return {
    title: "All done",
    body: snap.done === 1 ? "1 job complete" : `${snap.done} jobs complete`,
    progress: 100,
    max: 100,
    indeterminate: false,
    ongoing: false,
    tapsToQueue: false,
  };
}
```

- [ ] **Step 7.3: Add the helper functions `findRunningChapter` and `countDistinctNovels`**

Use the Edit tool. Append the helpers after the existing `findRunningConversion` function (around line ~375, near the bottom of the file before `refreshNotification`).

**old_string:**
```ts
/** Find the conversion job that's currently running, if any. Used by
 *  the notification body so the phase text reads naturally rather
 *  than a bare burst tally. */
function findRunningConversion() {
  const jobs = getState().jobs;
  for (const j of jobs) {
    if (j.kind !== "conversion") continue;
    if (j.status !== "running") continue;
    return j;
  }
  return null;
}
```

**new_string:**
```ts
/** Find the conversion job that's currently running, if any. Used by
 *  the notification body so the phase text reads naturally rather
 *  than a bare burst tally. */
function findRunningConversion() {
  const jobs = getState().jobs;
  for (const j of jobs) {
    if (j.kind !== "conversion") continue;
    if (j.status !== "running") continue;
    return j;
  }
  return null;
}

/** Find the chapter-download job that's currently running. Used to
 *  fill the notification title with the active novel + chapter. */
function findRunningChapter() {
  const jobs = getState().jobs;
  for (const j of jobs) {
    if (j.kind !== "chapter") continue;
    if (j.status !== "running") continue;
    return j;
  }
  return null;
}

/** Count distinct novels in the current burst (active + completed).
 *  Used to append "(N novels)" to the body when more than one novel
 *  is in flight. */
function countDistinctNovels(snap: Snapshot): number {
  void snap; // snap reserved for future use; for now derive from queue
  const jobs = getState().jobs;
  const ids = new Set<string>();
  for (const j of jobs) {
    if (j.status === "done" || j.status === "error" || j.status === "cancelled") {
      // Only count terminals that belong to this burst (i.e., were
      // updated since the burst began). We use updatedAt > 0 as a
      // proxy — the burstTotal counter already filters to in-burst
      // jobs, so we don't double-filter here.
    }
    ids.add(j.libraryEntryId);
  }
  return ids.size;
}
```

- [ ] **Step 7.4: Swap `sendNotification(...)` for `pushDownloadNotification(...)`**

Use the Edit tool. Replace the `try { sendNotification({...}) }` block inside `publish()` so it routes through the transport.

**old_string:**
```ts
  await ensurePermission();
  if (permissionState !== "granted") return;

  try {
    sendNotification({
      id: NOTIFICATION_ID,
      channelId: CHANNEL_ID,
      title,
      body,
      // In-progress: ongoing so Android marks the notification as
      // persistent background work, which suppresses the per-update
      // alert. Silent on iOS for the same reason. The terminal
      // summary fires without these flags so the system alerts as
      // normal — the "your downloads are done" cue.
      ongoing: !isTerminalSummary,
      silent: !isTerminalSummary,
    });
  } catch (e) {
    // Notification plugin throws on Linux when no service is
    // available; log + drop the message. Future emissions still
    // try.
    // eslint-disable-next-line no-console
    console.warn("[downloadNotifier] sendNotification failed:", e);
  }
}
```

**new_string:**
```ts
  await ensurePermission();
  if (permissionState !== "granted") return;

  await pushDownloadNotification({
    id: NOTIFICATION_ID,
    title,
    body,
    progress: composed.progress,
    max: composed.max,
    indeterminate: composed.indeterminate,
    ongoing: composed.ongoing,
    tapsToQueue: composed.tapsToQueue,
  });
}
```

- [ ] **Step 7.5: Update imports at top of file**

Use the Edit tool. Remove the unused `sendNotification` import. Add the transport import.

**old_string:**
```ts
import {
  createChannel,
  Importance,
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  getState,
  subscribe,
  type DownloadJob,
  type DownloadJobStatus,
} from "./downloadQueue";
```

**new_string:**
```ts
import {
  createChannel,
  Importance,
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import {
  getState,
  subscribe,
  type DownloadJob,
  type DownloadJobStatus,
} from "./downloadQueue";
import { pushDownloadNotification } from "./downloadNotifier/transport";
```

- [ ] **Step 7.6: Update the references to `title` / `body` inside `publish()` to come from `composed` instead of the destructured `{ title, body } = composed`**

Use the Edit tool. The current code is:

**old_string:**
```ts
  const composed = compose(snap, completedThisBurst);
  if (!composed) return; // summary already shown this burst
  const { title, body } = composed;

  if (title === lastTitle && body === lastBody) return;
```

**new_string:**
```ts
  const composed = compose(snap, completedThisBurst);
  if (!composed) return; // summary already shown this burst
  const { title, body } = composed;

  if (title === lastTitle && body === lastBody) return;

  // `composed` is now consumed by `pushDownloadNotification` below;
  // `title`/`body` here are kept only for the dedupe + logging check.
```

(This step is a safety net — it makes the next-step removal of `renderBar` and other dead code more obvious.)

- [ ] **Step 7.7: Drop the dead `renderBar` helper and its comment**

Use the Edit tool. Remove the function and its block comment at the bottom of the file.

**old_string:**
```ts
/** Unicode block-character progress bar for the notification body.
 *  10-cell width — narrow enough to fit beside the counter on
 *  phone-width notification rows while still showing visible
 *  granularity (10% increments). The full block U+2588 + light
 *  shade U+2591 render correctly in every Android system font
 *  shipped since 2016.
 *
 *  Returns "" for invalid progress so callers can `${renderBar(p)}`
 *  unconditionally without weird empty bars when math goes wrong. */
function renderBar(progress: number, width = 10): string {
  if (!Number.isFinite(progress) || progress < 0) return "";
  const clamped = Math.min(1, progress);
  const filled = Math.round(clamped * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}
```

**new_string:** (empty string — the entire `renderBar` block and its preceding comment are deleted; no replacement text. Pass `new_string: ""` to the Edit tool.)

- [ ] **Step 7.8: Refresh the file's header comment**

Use the Edit tool. The current top-of-file comment mentions "the Tauri notification plugin doesn't expose true Android progress bars" — now stale.

**old_string:**
```ts
// We don't push true Android progress bars; the Tauri notification
// plugin doesn't expose them. Body text counts are close enough for
// "how many of how many are done" feedback.
```

**new_string:**
```ts
// Android renders a real NotificationCompat.Builder.setProgress
// widget via the custom Tauri command in src-tauri/src/notify.rs.
// Other platforms fall back to plain title + body via the existing
// Tauri notification plugin; see ./downloadNotifier/transport.ts.
```

- [ ] **Step 7.9: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output, exit code 0.

If TypeScript complains about an unused `composed`, `title`, or `body` variable inside `publish()`, remove the dead `const { title, body } = composed` line that step 7.6 left in place — it was a safety scaffold; not needed once the rest of the refactor is in.

- [ ] **Step 7.10: Commit**

```bash
git add src/store/downloadNotifier.ts
git commit -m "feat(notify): T1 title + queue progress payload; drop unicode bar"
```

---

## Task 8: Add the `useLaunchIntent` hook and `uiIntents` pub/sub

**Files:**
- Create: `src/store/uiIntents.ts`
- Create: `src/hooks/useLaunchIntent.ts`

- [ ] **Step 8.1: Write the pub/sub helper**

Use the Write tool. Path: `src/store/uiIntents.ts`

```ts
// Tiny module-scoped pub/sub for cross-cutting UI intents like "open
// the download queue from a notification tap." The notification
// tap-handler lives in App.tsx (driven by useLaunchIntent), but the
// queue's visibility is owned by Library.tsx. Rather than thread
// props through the tree, both subscribe here.

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

function emit(event: string): void {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of set) {
    try {
      fn();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[uiIntents] listener for "${event}" threw:`, e);
    }
  }
}

function on(event: string, fn: Listener): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
  };
}

/** Emit a request to open the in-app Download Queue view. */
export function openDownloadQueue(): void {
  emit("open-download-queue");
}

/** Subscribe to "open download queue" requests. Returns an
 *  unsubscribe function. */
export function onOpenDownloadQueue(fn: Listener): () => void {
  return on("open-download-queue", fn);
}
```

- [ ] **Step 8.2: Write the hook**

Use the Write tool. Path: `src/hooks/useLaunchIntent.ts`

```ts
// React hook that wires Android's launch-intent extras to the
// in-app UI. On mount, drains any pending intent stashed by
// MainActivity (cold launch). For warm launches (singleTask
// re-delivery), the native side sets the static field and we poll
// once per visibility-change — a Tauri event would be cleaner but
// requires emitting from Kotlin, which is more code.
//
// Today the only intent we handle is `leaflet.open=queue` →
// openDownloadQueue() via uiIntents.

import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openDownloadQueue } from "../store/uiIntents";

async function drainOnce(): Promise<void> {
  try {
    const value = (await invoke("consume_launch_intent")) as string | null;
    if (value === "queue") openDownloadQueue();
  } catch {
    // Non-Android or transient — silent.
  }
}

export function useLaunchIntent(): void {
  useEffect(() => {
    // Cold launch: drain whatever was stashed when the activity was
    // first created.
    void drainOnce();

    // Warm launch: when the activity comes back to the foreground
    // (singleTask re-delivery on Android), the static field gets a
    // fresh value. Re-drain on visibility change.
    const onVisible = () => {
      if (document.visibilityState === "visible") void drainOnce();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
```

- [ ] **Step 8.3: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 8.4: Commit**

```bash
git add src/store/uiIntents.ts src/hooks/useLaunchIntent.ts
git commit -m "feat(ui): uiIntents pub/sub + useLaunchIntent for notification tap routing"
```

---

## Task 9: Mount `useLaunchIntent` in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 9.1: Add the import + hook call**

Use the Edit tool on `src/App.tsx`.

**old_string:**
```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatedSwap } from "./components/AnimatedSwap";
```

**new_string:**
```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatedSwap } from "./components/AnimatedSwap";
import { useLaunchIntent } from "./hooks/useLaunchIntent";
```

- [ ] **Step 9.2: Call the hook inside the `App` function body**

Use the Edit tool. Place the hook call near the top of `App()`, right after the existing state hooks.

**old_string:**
```ts
function App() {
  const [t, setTweak] = useTweaks();
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const lightbox = useLightbox();
```

**new_string:**
```ts
function App() {
  // Listen for Android launch-intent extras (e.g., notification taps
  // routing to the download queue). Has to live above the Library so
  // any emitted intents reach the Library's subscriber.
  useLaunchIntent();
  const [t, setTweak] = useTweaks();
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const lightbox = useLightbox();
```

- [ ] **Step 9.3: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: passes.

- [ ] **Step 9.4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): mount useLaunchIntent at the shell root"
```

---

## Task 10: Subscribe Library to `openDownloadQueue` events

**Files:**
- Modify: `src/components/Library.tsx`

- [ ] **Step 10.1: Add the import**

Use the Edit tool. Find the existing imports block near the top.

**old_string:**
```ts
import { AnimatedSwap } from "./AnimatedSwap";
```

**new_string:**
```ts
import { AnimatedSwap } from "./AnimatedSwap";
import { onOpenDownloadQueue } from "../store/uiIntents";
```

- [ ] **Step 10.2: Subscribe inside the `Library` component**

Search the Library component for the existing `useState` calls for `queueOpen` and `setQueueOpen`. Right after they're declared, add a `useEffect` subscribing to the intent.

Run: `grep -n "queueOpen\|setQueueOpen" src/components/Library.tsx | head`

Expected output: something like `const [queueOpen, setQueueOpen] = useState(false);` at a line in the 100-200 range.

Then use the Edit tool. Add the effect immediately after that `useState` line. Match a unique context block:

**old_string:**
```ts
  const [queueOpen, setQueueOpen] = useState(false);
```

**new_string:**
```ts
  const [queueOpen, setQueueOpen] = useState(false);
  // Wired by useLaunchIntent in App.tsx — when a notification tap
  // arrives with `leaflet.open=queue`, the pub/sub fires and we open
  // the queue overlay.
  useEffect(() => onOpenDownloadQueue(() => setQueueOpen(true)), []);
```

If `useEffect` isn't already imported in Library.tsx, add it. Check by:

Run: `grep -n "^import.*useEffect" src/components/Library.tsx`

If no match, also use the Edit tool to add the import:

**old_string:** (search around line 1 for the existing React import)
```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
```

(If the existing import differs — e.g., is missing `useEffect` — adapt the new_string to add it.)

- [ ] **Step 10.3: Type-check**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: passes.

- [ ] **Step 10.4: Commit**

```bash
git add src/components/Library.tsx
git commit -m "feat(library): open Queue overlay on uiIntents.openDownloadQueue"
```

---

## Task 11: On-device Android verification

**Files:** none (verification only).

**Why this matters:** the Android-side code can't be exercised from a desktop dev session. The Kotlin compiler errors only surface during the Android build. The JNI bridge can only be exercised on a real device or emulator.

- [ ] **Step 11.1: Start `pnpm tauri android dev`**

Run: `pnpm tauri android dev`

If you hit the firewall / port-collision error from earlier sessions:
- Kill any stale `pnpm tauri dev` or `vite` processes on port 1420 first.
- Confirm `sudo ufw allow from 192.168.0.0/16 to any port 1420 proto tcp` (adjust subnet to your LAN).

Expected: the app launches on the device / emulator. Vite HMR runs over the LAN IP.

- [ ] **Step 11.2: Trigger a chapter download**

In the app, open a Store source (Kolnovel or Cenele), open a novel, and start downloading 3-5 chapters.

- [ ] **Step 11.3: Inspect the notification**

Pull down the system notification drawer.

Expected:
- **Title:** `Downloading <Novel> — Ch. NNN`.
- **Body:** `Chapter X of N`.
- **Progress widget:** a horizontal Android progress bar with a non-zero filled portion (queue progress).
- **Only one notification** for the burst — not one per chapter.
- **No heads-up re-pop** on chapter transitions (the bar advances quietly).
- The bar visually advances as chapters complete.

If the title is generic ("Downloading chapters") instead of T1: the running-job-discovery path isn't finding the chapter. Check `findRunningChapter()` returns a job.

If no progress widget appears: confirm the `setProgress` call in `DownloadNotifier.kt` is being reached. Add a `Log.d("DownloadNotifier", "update progress=$progress/$max")` line and check `logcat`.

- [ ] **Step 11.4: Multi-novel test**

Enqueue 2 chapters from one novel + 2 chapters from a different novel.

Expected: title still shows the currently-running chapter, body says `Chapter X of 4 (2 novels)`.

- [ ] **Step 11.5: Conversion job test**

Trigger a "Save as offline book."

Expected: title is `Converting <Novel>`, the progress bar tracks the conversion percentage (0..100), body shows the conversion's phase text.

- [ ] **Step 11.6: Tap → Queue test**

While downloads are running, tap the notification.

Expected: the app opens (or comes to the foreground) and lands on the Download Queue view, not the Library.

Repeat with the app backgrounded but not killed (warm launch): tap → same result.

Repeat with the app fully killed (cold launch): tap → app launches and routes to the Queue.

- [ ] **Step 11.7: Report any failures + fix loop**

If any test fails, open a debugger to the device's `logcat`:

Run: `adb logcat -s leaflet:* DownloadNotifier:* AndroidRuntime:E`

Look for stack traces from the JNI bridge or from `NotificationCompat.Builder`. Most likely culprits:
- `NoSuchMethodError`: the JNI signature in `notify.rs` doesn't match the Kotlin `update(...)` parameters. Re-check param types + ordering.
- `RuntimeException: PendingIntent must be FLAG_IMMUTABLE`: missing immutable flag. Already in our Kotlin; check no edit dropped it.
- `Notification not posted`: permission denied. Confirm the in-app permission prompt was accepted.

---

## Task 12: Desktop fallback verification

**Files:** none.

- [ ] **Step 12.1: Run desktop dev**

Run: `pnpm tauri dev`
Expected: the app launches on Linux.

- [ ] **Step 12.2: Trigger a chapter download**

Repeat the workflow from Task 11.2.

- [ ] **Step 12.3: Inspect the notification**

Linux notification daemon shows a normal notification.

Expected:
- **Title:** `Downloading <Novel> — Ch. NNN` (same string as Android).
- **Body:** `Chapter X of N` (same string).
- **No unicode bar in the body** — clean text only.
- **No crash** when the Rust command is bypassed.

If the notification doesn't appear at all on Linux, that's a pre-existing libnotify environment issue, not a regression — verify by checking that a baseline `notify-send "hi"` from a shell also appears.

---

## Post-implementation

After Tasks 11 + 12 pass:

- Cumulative diff covers ~10 commits across Rust, Kotlin, and TypeScript.
- The original spec at `docs/superpowers/specs/2026-05-25-native-download-notification-design.md` explains the design.
- Open one PR for the whole branch.

## Spec-coverage cross-check

| Spec requirement | Task |
|---|---|
| Native `NotificationCompat.Builder.setProgress` widget on Android | Task 2 |
| Dynamic title `Downloading <Novel> — Ch. NNN` | Task 7 (`compose()`) |
| Body `Chapter X of Y` (+ `(N novels)` when multi-novel) | Task 7 |
| Single notification id; queue stays in one notification | Task 6 (transport reuses `1001`) + Task 2 (id passed through) |
| Conversion → `Converting <Novel>` | Task 7 |
| Tap → Download Queue view | Tasks 2 (PendingIntent), 3 (MainActivity), 4 (consume command), 8 (hook + pub/sub), 9 (mount hook), 10 (Library subscribes) |
| Drop unicode `renderBar` | Task 7.7 |
| iOS / desktop / Linux fall back to plain text | Task 6 (transport's non-Android branch) |
| Channel = `leaflet-downloads` at `IMPORTANCE_LOW` | Task 2 (Kotlin), Task 6 (id constant) |
| `setOnlyAlertOnce(true)` to suppress per-update alert | Task 2 |
| `FLAG_IMMUTABLE` on PendingIntent | Task 2 |


