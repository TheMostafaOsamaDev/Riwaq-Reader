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
// Android renders a real NotificationCompat.Builder.setProgress
// widget via the custom Tauri command in src-tauri/src/notify.rs.
// Other platforms fall back to plain title + body via the existing
// Tauri notification plugin; see ./downloadNotifier/transport.ts.
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
} from "@tauri-apps/plugin-notification";
import {
  getState,
  getResolvedCounters,
  subscribe,
  type DownloadJob,
  type DownloadJobStatus,
} from "./downloadQueue";
import {
  DOWNLOAD_NOTIFICATION_ID,
  DOWNLOAD_SUMMARY_ID,
  pushDownloadNotification,
  setDockProgress,
} from "./downloadNotifier/transport";
import {
  subscribe as subscribeImport,
  getState as getImportState,
  isImportActive,
} from "./importProgress";
import { makeTr, type Locale } from "../i18n";
import { phaseLabel } from "../i18n/statusLabels";

/** Best-effort current UI locale. This module runs outside the component
 *  tree (a plain background subscriber to the download queue), so it reads
 *  `document.documentElement.lang` instead of `useI18n()` — App.tsx keeps
 *  that attribute in sync with the user's UI-language preference. Same
 *  pattern as `currentUiLocale()` in kolnovel-theme.ts / cenele.ts. */
function currentUiLocale(): Locale {
  if (typeof document !== "undefined" && document.documentElement.lang === "ar") {
    return "ar";
  }
  return "en";
}

/** Stable id so subsequent sends replace the previous notification on
 *  Android instead of stacking. Reuses the canonical constant from
 *  the transport so the value can't drift. */
const NOTIFICATION_ID = DOWNLOAD_NOTIFICATION_ID;

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
    const tr = makeTr(currentUiLocale());
    await createChannel({
      id: CHANNEL_ID,
      name: tr("status.notif.channelName"),
      description: tr("status.notif.channelDescription"),
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
  /** True while a doc/Sources import is in flight (see
   *  `importProgress.ts`). Folded into `active`/`total` so a lone
   *  import keeps the notification (and foreground service) alive. */
  importActive: boolean;
  /** 0..100 progress of the active import, for the widget. */
  importPct: number;
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
/** Monotonic high-water-mark of the displayed percent within a burst,
 *  so progress never ticks backward. The running chapters' partial
 *  progress resetting at chapter boundaries otherwise made the percent
 *  bounce (19% → 18% → 19%). Reset when the queue goes fully idle. */
let burstMaxPct = 0;
/** Per-kind resolved-count tally captured at the start of a burst. Queue
 *  terminals from a previous burst linger until clearTerminals(), so we
 *  subtract this baseline to keep a new burst's counts/percent its own. */
let burstBase = {
  resolved: 0,
  chDone: 0,
  chFailed: 0,
  chCancelled: 0,
  cvDone: 0,
  cvFailed: 0,
};
/** `finishedAt` of the import whose completion we've already announced,
 *  so an undismissed finished import isn't re-announced in a later burst. */
let announcedImportFinishedAt: number | null = null;
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
  const unsubQueue = subscribe((state) => {
    void publish(summarize(state.jobs));
  });
  // Imports don't live in the download queue, so give the notifier its
  // own subscription — re-summarize off the current queue state on
  // every import transition so a lone import (no queue jobs) still
  // drives a notification.
  const unsubImport = subscribeImport(() => {
    void publish(summarize(getState().jobs));
  });
  return () => {
    unsubQueue();
    unsubImport();
  };
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
  const imp = getImportState();
  const importActive = isImportActive(imp);
  const importPct = Math.round(imp.overall * 100);
  return {
    active: active + (importActive ? 1 : 0),
    activeConversions,
    importActive,
    importPct,
    done,
    error,
    cancelled,
    total: jobs.length + (importActive ? 1 : 0),
    lastTerminal,
  };
}

async function publish(snap: Snapshot) {
  // A lone import (no queue jobs) finishes by flipping inactive with an
  // empty queue, which looks "fully idle" — but we still owe a completion
  // summary. Detect that so the idle-reset below doesn't swallow it.
  const impState = getImportState();
  const importTerminalPending =
    !summaryShown &&
    impState.finishedAt !== null &&
    impState.finishedAt !== announcedImportFinishedAt &&
    (impState.resultBookId !== null || impState.error !== null);

  // Reset burst counters when the queue is fully idle and nothing is
  // waiting to be announced.
  if (snap.active === 0 && snap.total === 0 && !importTerminalPending) {
    burstTotal = 0;
    burstMaxPct = 0;
    burstBase = {
      resolved: 0,
      chDone: 0,
      chFailed: 0,
      chCancelled: 0,
      cvDone: 0,
      cvFailed: 0,
    };
    summaryShown = false;
    lastBody = "";
    lastTitle = "";
    lastSentAt = 0;
    if (pendingFlush) {
      clearTimeout(pendingFlush);
      pendingFlush = null;
    }
    pendingSnap = null;
    void setDockProgress(null);
    return;
  }

  // Per-burst accounting. Terminal jobs from a previous burst linger in
  // the queue (until clearTerminals), so on a fresh burst we rebase and
  // subtract the leftover count — otherwise this burst's "N of M" and
  // percent would inherit the previous burst's totals.
  const tally = resolvedTally();
  if (snap.active > 0 && summaryShown) {
    burstTotal = 0;
    burstMaxPct = 0;
    summaryShown = false;
    burstBase = tally;
  }
  const burstCompleted = Math.max(0, tally.resolved - burstBase.resolved);
  const liveTotal = snap.active + burstCompleted;
  if (liveTotal > burstTotal) burstTotal = liveTotal;

  const isTerminalSummary = snap.active === 0;
  // Compose what to display. A conversion in flight gets first
  // billing — it's whole-novel work that produces a library entry,
  // versus chapter downloads which are per-row.
  const composed = compose(snap, burstCompleted);
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

  // Drive the dock/taskbar indicator regardless of OS-notification
  // permission — `setProgressBar` is unrelated to that permission, and
  // `ensurePermission()` below can permanently cache "denied" for the
  // session, which must not kill the dock progress bar too.
  if (!isTerminalSummary && composed.max > 0) {
    void setDockProgress(composed.progress / composed.max);
  } else {
    void setDockProgress(null);
  }

  await ensurePermission();
  if (permissionState !== "granted") return;

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
}

/** Per-kind tally of RESOLVED jobs, read from the queue's eviction-proof
 *  lifetime counters (the jobs array caps terminals at 50, so scanning it
 *  undercounts large bursts). `resolved` is the grand total for the
 *  denominator/baseline; the per-kind fields drive the completion summary. */
function resolvedTally(): {
  resolved: number;
  chDone: number;
  chFailed: number;
  chCancelled: number;
  cvDone: number;
  cvFailed: number;
} {
  const c = getResolvedCounters();
  return {
    resolved:
      c.chDone + c.chFailed + c.chCancelled + c.cvDone + c.cvFailed,
    ...c,
  };
}

/** Monotonic display percent for the aggregate download/mixed progress.
 *  Based on the RESOLVED-job fraction (done + failed + cancelled over the
 *  burst total) so it matches the "N of M" count exactly, then clamped to
 *  a per-burst high-water-mark so it never ticks backward. Using the
 *  resolved count instead of the running chapters' live partial progress
 *  is what removes the 19% → 18% → 19% bounce. */
function clampPct(pct: number): number {
  if (pct > burstMaxPct) burstMaxPct = pct;
  return burstMaxPct;
}

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
  // This module runs outside the component tree (a plain background
  // subscriber, no React context available), so it resolves the current
  // UI locale + translator the same way kolnovel-theme.ts / cenele.ts do —
  // see `currentUiLocale()` below — rather than using `useI18n()`.
  const tr = makeTr(currentUiLocale());
  if (snap.active > 0) {
    summaryShown = false;
    const pctOverall = clampPct(
      Math.round((completedThisBurst / Math.max(burstTotal, 1)) * 100),
    );

    // Mixed work: more than one kind of task overlapping (e.g. a
    // download burst running alongside a conversion or an import).
    // Show one aggregate line instead of privileging a single kind.
    const kinds: string[] = [];
    const dl = snap.active - snap.activeConversions - (snap.importActive ? 1 : 0);
    if (dl > 0) kinds.push(tr("status.notif.partDownloads", { n: dl }));
    if (snap.activeConversions > 0) kinds.push(tr("status.notif.partConverting"));
    if (snap.importActive) kinds.push(tr("status.notif.partImporting"));
    if (kinds.length > 1) {
      return {
        title: tr("status.notif.backgroundTasksTitle", { pct: pctOverall }),
        body: tr("status.notif.mixedBody", { parts: kinds.join(" · ") }),
        progress: pctOverall,
        max: 100,
        indeterminate: false,
        ongoing: true,
        tapsToQueue: true,
      };
    }

    // Lone import: an import in flight with no queue work overlapping.
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

    // Conversion in flight: T1-style title with "Converting <Novel>".
    if (snap.activeConversions > 0) {
      const runningConversion = findRunningConversion();
      if (runningConversion) {
        const pct = Math.round(runningConversion.progress * 100);
        const novel = runningConversion.novelTitle;
        return {
          title: tr("status.notif.convertingTitle", { novel }),
          body: runningConversion.phase
            ? phaseLabel(runningConversion.phase, tr)
            : tr("status.notif.percentDone", { pct }),
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
        title: tr("status.notif.preparingOfflineBook"),
        body: tr("status.notif.jobsDoneOf", {
          done: completedThisBurst,
          total: burstTotal,
        }),
        progress: completedThisBurst,
        max: Math.max(burstTotal, 1),
        indeterminate: false,
        ongoing: true,
        tapsToQueue: true,
      };
    }

    // Chapter downloads: T1 title with the currently-running chapter.
    const running = findRunningChapter();
    let title: string;
    if (running) {
      title = tr("status.notif.downloadingChapterTitle", {
        novel: running.novelTitle,
        n: running.chapterId,
      });
    } else {
      // Active count > 0 but no `running` job (all queued, none
      // started yet). Use a generic title; the next emission once
      // a worker picks one up will fill in the novel + chapter.
      title = tr("status.notif.downloadingChaptersTitle");
    }
    const body = tr("status.notif.downloadingProgress", {
      done: completedThisBurst,
      total: burstTotal,
      pct: pctOverall,
    });
    return {
      title,
      body,
      progress: pctOverall,
      max: 100,
      indeterminate: false,
      ongoing: true,
      tapsToQueue: true,
    };
  }

  if (summaryShown) return null;

  // Describe what actually finished, BY TASK TYPE with counts — instead of
  // a generic "background work finished". Counts come from the queue's
  // eviction-proof lifetime counters (not the 50-capped jobs array) and are
  // rebased to this burst; imports are read from their own store.
  const t = resolvedTally();
  const chDone = Math.max(0, t.chDone - burstBase.chDone);
  const chFailed = Math.max(0, t.chFailed - burstBase.chFailed);
  const chCancelled = Math.max(0, t.chCancelled - burstBase.chCancelled);
  const cvDone = Math.max(0, t.cvDone - burstBase.cvDone);
  const cvFailed = Math.max(0, t.cvFailed - burstBase.cvFailed);
  const imp = getImportState();
  const impFresh =
    imp.finishedAt !== null && imp.finishedAt !== announcedImportFinishedAt;
  const impDone = impFresh && imp.error === null && imp.resultBookId !== null;
  const impFail = impFresh && imp.error !== null;

  // Nothing actually finished this session (e.g. launch with only
  // interrupted jobs) → don't show a misleading "all done".
  if (
    chDone === 0 &&
    chFailed === 0 &&
    chCancelled === 0 &&
    cvDone === 0 &&
    cvFailed === 0 &&
    !impDone &&
    !impFail
  ) {
    return null;
  }
  // Mark this import announced so an undismissed finished import isn't
  // re-announced when a later, unrelated burst completes.
  if (impDone || impFail) announcedImportFinishedAt = imp.finishedAt;

  const bodyParts: string[] = [];
  if (chDone > 0)
    bodyParts.push(tr("status.notif.chaptersDownloaded", { n: chDone }));
  if (cvDone > 0) bodyParts.push(tr("status.notif.offlineBookReady"));
  if (impDone) bodyParts.push(tr("status.notif.bookImported"));
  if (chFailed > 0)
    bodyParts.push(tr("status.notif.failedCount", { n: chFailed }));
  if (chCancelled > 0)
    bodyParts.push(tr("status.notif.cancelledCount", { n: chCancelled }));
  if (cvFailed > 0) bodyParts.push(tr("status.notif.conversionFailed"));
  if (impFail) bodyParts.push(tr("status.notif.importFailed"));

  const successKinds =
    (chDone > 0 ? 1 : 0) + (cvDone > 0 ? 1 : 0) + (impDone ? 1 : 0);
  let title: string;
  if (successKinds > 1) title = tr("status.notif.allTasksDone");
  else if (chDone > 0) title = tr("status.notif.downloadComplete");
  else if (cvDone > 0) title = tr("status.notif.offlineBookReady");
  else if (impDone) title = tr("status.notif.importComplete");
  else title = tr("status.notif.backgroundWorkFinished"); // failures only

  return {
    title,
    body: bodyParts.join(" · "),
    progress: 100,
    max: 100,
    indeterminate: false,
    ongoing: false,
    tapsToQueue: true,
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

/** Test helper: snapshot the current queue state into a notification.
 *  Useful for kicking the notifier from a manual trigger if the
 *  initial subscribe missed a state change. */
export async function refreshNotification(): Promise<void> {
  await publish(summarize(getState().jobs));
}

/** Pure helper exposed for unit tests; callers should prefer
 *  subscribe-driven updates. */
export type { DownloadJobStatus };
