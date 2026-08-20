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
import {
  subscribe as subscribeImport,
  getState as getImportState,
  isImportActive,
} from "./importProgress";

/** Count queue jobs that represent live work (queued or running).
 *  Terminal + interrupted jobs are not "active". */
export function activeQueueCount(jobs: DownloadJob[]): number {
  let n = 0;
  for (const j of jobs) {
    if (j.status === "queued" || j.status === "running") n++;
  }
  return n;
}

/** Total active background work across every source: queue jobs plus
 *  any in-flight import. Exported so the notifier and tests share one
 *  rule. */
export function activeBackgroundCount(): number {
  const queue = activeQueueCount(getQueueState().jobs);
  const imports = isImportActive(getImportState()) ? 1 : 0;
  return queue + imports;
}

let cachedIsAndroid: boolean | null = null;
async function isAndroid(): Promise<boolean> {
  if (cachedIsAndroid !== null) return cachedIsAndroid;
  try {
    cachedIsAndroid = (await platform()) === "android";
  } catch {
    return false; // transient — don't cache; retry next call
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

// Serialize syncService() calls so a new sync always waits for the
// prior invoke to settle before evaluating shouldRun again. Without
// this, two overlapping invokes (e.g. a "stop" from a job finishing
// racing a "start" from the next job starting) can resolve out of
// order and leave the native service state diverged from what JS
// believes it set. Chaining onto the SAME handler for both branches
// means a rejected prior link doesn't break the chain, and each run
// re-reads activeBackgroundCount() fresh, so rapid flips coalesce
// into whatever the count actually is by the time this link runs.
let syncChain: Promise<void> = Promise.resolve();
function scheduleSync(): void {
  syncChain = syncChain.then(syncService, syncService);
}

/** Wire the coordinator to every active-work source. Idempotent.
 *  Returns an unsubscribe handle (the app doesn't need to call it). */
export function startBackgroundTaskCoordinator(): () => void {
  if (started) return () => {};
  started = true;
  const unsubQueue = subscribeQueue(() => {
    scheduleSync();
  });
  const unsubImport = subscribeImport(() => {
    scheduleSync();
  });
  return () => {
    unsubQueue();
    unsubImport();
  };
}
