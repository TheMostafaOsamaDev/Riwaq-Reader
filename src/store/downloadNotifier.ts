// System notification bridge for the download queue.
//
// Subscribes to the module-scoped queue state and surfaces a single
// running notification ("Downloading 3 of 10 chapters…") plus a final
// summary on completion. One notification id is reused so Android
// replaces in place rather than stacking.
//
// Permission: requested lazily on the first active job. Denial is
// quiet — the queue still works, the user just doesn't see system
// notifications. We re-ask only after a session restart.
//
// We don't push true Android progress bars; the Tauri notification
// plugin doesn't expose them. Body text counts are close enough for
// "how many of how many are done" feedback.

import {
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

/** Stable id so subsequent sends replace the previous notification on
 *  Android instead of stacking. (iOS reuses by id too.) */
const NOTIFICATION_ID = 1001;

interface Snapshot {
  active: number;
  done: number;
  error: number;
  cancelled: number;
  total: number;
  /** Job most-recently in a terminal state — used as the body for the
   *  "summary" notification when no active jobs remain. */
  lastTerminal: DownloadJob | null;
}

let permissionState: "granted" | "denied" | "unknown" = "unknown";
let permissionInflight: Promise<void> | null = null;
let lastBody = ""; // dedupe: don't re-fire identical notifications
let lastTitle = "";
/** Set to true once we've fired the "done" notification for the
 *  current burst. Reset when a new active job appears so the next
 *  burst can fire its own completion. */
let summaryShown = false;
/** Total job count we use as the "out of N" denominator. Resets when
 *  the queue is fully idle to avoid showing inflated totals after a
 *  clearTerminals(). */
let burstTotal = 0;
let started = false;

/** Wire the notifier to the queue. Idempotent — calling more than
 *  once is a no-op. Returns an unsubscribe handle for tests; the app
 *  doesn't need to call it. */
export function startDownloadNotifier(): () => void {
  if (started) return () => {};
  started = true;
  // Fire on every queue emission. The state object is mutated in
  // place but the listener fires after each transition, so summarize
  // fresh each time.
  return subscribe((state) => {
    void publish(summarize(state.jobs));
  });
}

function summarize(jobs: DownloadJob[]): Snapshot {
  let active = 0;
  let done = 0;
  let error = 0;
  let cancelled = 0;
  let lastTerminal: DownloadJob | null = null;
  let lastTerminalTs = 0;
  for (const j of jobs) {
    if (j.status === "queued" || j.status === "running") active++;
    else if (j.status === "done") done++;
    else if (j.status === "error") error++;
    else if (j.status === "cancelled") cancelled++;
    if (
      j.status === "done" ||
      j.status === "error" ||
      j.status === "cancelled"
    ) {
      if (j.updatedAt > lastTerminalTs) {
        lastTerminal = j;
        lastTerminalTs = j.updatedAt;
      }
    }
  }
  return {
    active,
    done,
    error,
    cancelled,
    total: jobs.length,
    lastTerminal,
  };
}

async function publish(snap: Snapshot) {
  // Reset burst counters when the queue is fully idle.
  if (snap.active === 0 && snap.total === 0) {
    burstTotal = 0;
    summaryShown = false;
    lastBody = "";
    lastTitle = "";
    return;
  }

  // Bump the denominator when new jobs arrive (queue grew).
  const completedThisBurst = snap.done + snap.error + snap.cancelled;
  const liveTotal = snap.active + completedThisBurst;
  if (liveTotal > burstTotal) burstTotal = liveTotal;

  // Compose what to display.
  let title: string;
  let body: string;
  if (snap.active > 0) {
    summaryShown = false;
    title = "Downloading chapters";
    body = `${completedThisBurst} of ${burstTotal} done`;
  } else {
    if (summaryShown) return;
    summaryShown = true;
    if (snap.error > 0 || snap.cancelled > 0) {
      title = "Chapter downloads finished";
      const bits: string[] = [];
      if (snap.done > 0) bits.push(`${snap.done} downloaded`);
      if (snap.error > 0) bits.push(`${snap.error} failed`);
      if (snap.cancelled > 0) bits.push(`${snap.cancelled} cancelled`);
      body = bits.join(" · ");
    } else {
      title = "Downloads complete";
      body = snap.done === 1
        ? `1 chapter downloaded`
        : `${snap.done} chapters downloaded`;
    }
  }

  if (title === lastTitle && body === lastBody) return;
  lastTitle = title;
  lastBody = body;

  await ensurePermission();
  if (permissionState !== "granted") return;

  try {
    sendNotification({ id: NOTIFICATION_ID, title, body });
  } catch (e) {
    // Notification plugin throws on Linux when no service is
    // available; log + drop the message. Future emissions still
    // try.
    // eslint-disable-next-line no-console
    console.warn("[downloadNotifier] sendNotification failed:", e);
  }
}

async function ensurePermission(): Promise<void> {
  if (permissionState === "granted" || permissionState === "denied") return;
  if (permissionInflight) {
    await permissionInflight;
    return;
  }
  permissionInflight = (async () => {
    try {
      if (await isPermissionGranted()) {
        permissionState = "granted";
        return;
      }
      const next = await requestPermission();
      permissionState = next === "granted" ? "granted" : "denied";
    } catch (e) {
      // Plugin or capability missing → don't keep retrying.
      // eslint-disable-next-line no-console
      console.warn("[downloadNotifier] permission check failed:", e);
      permissionState = "denied";
    } finally {
      permissionInflight = null;
    }
  })();
  await permissionInflight;
}

/** Test helper: snapshot the current queue state into a notification.
 *  Useful for kicking the notifier from a manual trigger if the
 *  initial subscribe missed a state change. */
export async function refreshNotification(): Promise<void> {
  await publish(summarize(getState().jobs));
}

/** Pure helper exposed for unit tests; callers should prefer
 *  subscribe-driven updates. */
export type { DownloadJobStatus };
