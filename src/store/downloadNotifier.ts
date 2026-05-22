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
//
// Anti-blink contract. The queue can emit dozens of state changes per
// second while a chapter downloads (image fetch ticks, snapshot
// writes, etc.). Re-firing a fresh notification each time would make
// Android pop the heads-up + vibrate on every tick, which is what the
// user reported as "blinking". Two mitigations are in play:
//
//   1. `ongoing: true` on in-progress notifications. Android treats
//      ongoing notifications as background-work indicators that
//      shouldn't re-alert on update — the body text changes silently.
//   2. Throttle the publish loop. While in the "running" state we
//      coalesce updates to at most one every UPDATE_THROTTLE_MS, with
//      a leading-edge emit so the FIRST tick of a burst lands
//      immediately and the LAST progress before completion always
//      gets through.
//
// The final summary fires without `ongoing` so the system does its
// normal alert — this is the user-visible "your work is done" cue.

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

/** Stable id so subsequent sends replace the previous notification on
 *  Android instead of stacking. (iOS reuses by id too.) */
const NOTIFICATION_ID = 1001;

/** Channel id used by every download/conversion notification. We
 *  register the channel with Importance.LOW on first use so updates
 *  never show heads-up — Android otherwise re-renders the heads-up
 *  overlay on every body change, which reads as a blink at chapter
 *  boundaries. The channel only exists on Android; the createChannel
 *  call is a no-op everywhere else. */
const CHANNEL_ID = "leaflet-downloads";
let channelRegistered = false;

async function ensureChannel(): Promise<void> {
  if (channelRegistered) return;
  try {
    await createChannel({
      id: CHANNEL_ID,
      name: "Downloads",
      description: "Chapter downloads and offline-book conversions",
      importance: Importance.Low,
      lights: false,
      vibration: false,
    });
    channelRegistered = true;
  } catch (e) {
    // Plugin throws on non-Android platforms (channels are
    // Android-only) — that's fine, sendNotification still works
    // without a channel. Mark registered so we don't keep
    // retrying.
    channelRegistered = true;
    // eslint-disable-next-line no-console
    console.warn("[downloadNotifier] createChannel skipped:", e);
  }
}

interface Snapshot {
  active: number;
  /** Subset of `active` whose kind is "conversion". Drives the
   *  notification title — a conversion is a bigger deal than a
   *  chapter download (whole-novel scope, lands new library entries)
   *  so the user gets a clearer label when one is in flight. */
  activeConversions: number;
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

/** Smallest interval between consecutive in-progress notification
 *  sends. Anything faster on Android (re)triggers the heads-up +
 *  vibration and reads as "blinking". 600ms is a comfortable cap —
 *  the user can still see progress moving but the system doesn't
 *  alert per tick. The completion send bypasses this throttle. */
const UPDATE_THROTTLE_MS = 600;
/** Timestamp of the last in-progress send, used to throttle. */
let lastSentAt = 0;
/** Pending throttled timer so a fast-moving burst still gets a final
 *  in-progress send before its summary lands. */
let pendingFlush: ReturnType<typeof setTimeout> | null = null;
let pendingSnap: Snapshot | null = null;

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
  let activeConversions = 0;
  let lastTerminal: DownloadJob | null = null;
  let lastTerminalTs = 0;
  for (const j of jobs) {
    if (j.status === "queued" || j.status === "running") {
      active++;
      if (j.kind === "conversion") activeConversions++;
    } else if (j.status === "done") done++;
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
    activeConversions,
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
    lastSentAt = 0;
    if (pendingFlush) {
      clearTimeout(pendingFlush);
      pendingFlush = null;
    }
    pendingSnap = null;
    return;
  }

  // Bump the denominator when new jobs arrive (queue grew).
  const completedThisBurst = snap.done + snap.error + snap.cancelled;
  const liveTotal = snap.active + completedThisBurst;
  if (liveTotal > burstTotal) burstTotal = liveTotal;

  const isTerminalSummary = snap.active === 0;
  // Compose what to display. A conversion in flight gets first
  // billing — it's whole-novel work that produces a library entry,
  // versus chapter downloads which are per-row.
  const composed = compose(snap, completedThisBurst);
  if (!composed) return; // summary already shown this burst
  const { title, body } = composed;

  if (title === lastTitle && body === lastBody) return;

  // Throttle in-progress updates so Android doesn't pop the
  // heads-up + vibrate on every tick. The terminal summary
  // bypasses the throttle and fires immediately + non-ongoing so
  // the user hears the "done" alert.
  if (!isTerminalSummary) {
    const now = Date.now();
    const elapsed = now - lastSentAt;
    if (lastSentAt !== 0 && elapsed < UPDATE_THROTTLE_MS) {
      // Schedule a trailing flush so the last progress before
      // completion still lands. We overwrite the previous pending
      // snap — only the most recent state matters.
      pendingSnap = snap;
      if (!pendingFlush) {
        pendingFlush = setTimeout(() => {
          pendingFlush = null;
          const ps = pendingSnap;
          pendingSnap = null;
          if (ps) void publish(ps);
        }, UPDATE_THROTTLE_MS - elapsed);
      }
      return;
    }
  } else if (pendingFlush) {
    // Terminal summary outranks any pending flush.
    clearTimeout(pendingFlush);
    pendingFlush = null;
    pendingSnap = null;
  }

  lastTitle = title;
  lastBody = body;
  lastSentAt = Date.now();
  if (isTerminalSummary) summaryShown = true;

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
        await ensureChannel();
        return;
      }
      const next = await requestPermission();
      permissionState = next === "granted" ? "granted" : "denied";
      if (permissionState === "granted") await ensureChannel();
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

/** Test helper: snapshot the current queue state into a notification.
 *  Useful for kicking the notifier from a manual trigger if the
 *  initial subscribe missed a state change. */
export async function refreshNotification(): Promise<void> {
  await publish(summarize(getState().jobs));
}

/** Pure helper exposed for unit tests; callers should prefer
 *  subscribe-driven updates. */
export type { DownloadJobStatus };
