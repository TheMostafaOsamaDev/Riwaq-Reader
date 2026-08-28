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
import { sendNotification } from "@tauri-apps/plugin-notification";
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";

/** Channel id used by every download/conversion notification. The
 *  Android channel is created on the Kotlin side; the plugin's
 *  fallback path expects the same id for desktop/iOS consistency. */
export const DOWNLOAD_CHANNEL_ID = "leaflet-downloads";

/** Stable notification id reused so the system replaces in place
 *  rather than stacking. */
export const DOWNLOAD_NOTIFICATION_ID = 1001;

/** Separate id for the terminal "all done / failed" summary so it can
 *  co-exist with (and outlive) the foreground-service progress
 *  notification (id 1001), which the service removes on stop. */
export const DOWNLOAD_SUMMARY_ID = 1002;

/** Separate id again for the "verify your browser again" prompt. It must
 *  outlive the progress notification and must not replace the terminal
 *  summary, since both can be on screen at once when a batch stalls. */
export const DOWNLOAD_REAUTH_ID = 1003;

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
}

/** Reflect aggregate progress on the desktop taskbar/dock icon.
 *  fraction: 0..1 while working; null clears the indicator. Self-guards
 *  on mobile (Android/iOS have no taskbar/dock; Android already shows
 *  progress via its own notification widget) — no-op there. Best-effort
 *  — never throws. */
export async function setDockProgress(fraction: number | null): Promise<void> {
  try {
    const plat = await getPlatform();
    if (plat === "android" || plat === "ios") return;
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
