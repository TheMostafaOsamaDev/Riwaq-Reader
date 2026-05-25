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
