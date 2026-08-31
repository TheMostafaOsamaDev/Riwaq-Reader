// Integration cover for the number the Downloads row shows. The
// notifier owns burst accounting, so this drives it with a simulated
// queue and reads back what `downloadProgress.ts` publishes — the same
// value the sidebar renders.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: async () => true,
  requestPermission: async () => "granted",
  createChannel: async () => {},
  Importance: { Default: 3, Low: 2 },
}));
vi.mock("./downloadNotifier/transport", () => ({
  DOWNLOAD_NOTIFICATION_ID: 1001,
  DOWNLOAD_SUMMARY_ID: 1002,
  DOWNLOAD_REAUTH_ID: 1003,
  DOWNLOAD_CHANNEL_ID: "leaflet-downloads",
  pushDownloadNotification: async () => {},
  setDockProgress: async () => {},
}));

interface FakeJob {
  id: string;
  kind: "chapter";
  status: "queued" | "running" | "done";
  progress: number;
  libraryEntryId: string;
  novelTitle: string;
  chapterId: number;
  chapterTitle: string;
  enqueuedAt: number;
  updatedAt: number;
}

let jobs: FakeJob[] = [];
let counters = { chDone: 0, chFailed: 0, chCancelled: 0, cvDone: 0, cvFailed: 0 };
let listener: ((s: { jobs: FakeJob[] }) => void) | null = null;

vi.mock("./downloadQueue", () => ({
  getState: () => ({ jobs }),
  getResolvedCounters: () => ({ ...counters }),
  subscribe: (fn: (s: { jobs: FakeJob[] }) => void) => {
    listener = fn;
    return () => {
      listener = null;
    };
  },
}));
vi.mock("./importProgress", () => ({
  subscribe: () => () => {},
  getState: () => ({ overall: 0, finishedAt: null, resultBookId: null, error: null }),
  isImportActive: () => false,
}));

import { startDownloadNotifier } from "./downloadNotifier";
import { getDownloadProgress } from "./downloadProgress";

function chapter(n: number, status: FakeJob["status"], progress: number): FakeJob {
  return {
    id: `j${n}`,
    kind: "chapter",
    status,
    progress,
    libraryEntryId: "e1",
    novelTitle: "Novel",
    chapterId: n,
    chapterTitle: `Chapter ${n}`,
    enqueuedAt: 0,
    updatedAt: n,
  };
}

/** Rebuild the queue as it would look mid-burst and let the notifier see it. */
function emit(done: number, running: number[], total: number) {
  jobs = [];
  for (let i = 0; i < done; i++) jobs.push(chapter(i, "done", 1));
  running.forEach((p, i) => jobs.push(chapter(done + i, "running", p)));
  for (let i = done + running.length; i < total; i++) jobs.push(chapter(i, "queued", 0));
  counters = { ...counters, chDone: done };
  listener?.({ jobs });
}

beforeEach(() => {
  startDownloadNotifier(); // idempotent; only the first call subscribes
  // The notifier holds burst state for the process, so hand it a fully
  // idle queue to close out whatever the previous test left open.
  jobs = [];
  counters = { chDone: 0, chFailed: 0, chCancelled: 0, cvDone: 0, cvFailed: 0 };
  listener?.({ jobs });
});

describe("downloads burst progress", () => {
  it("tracks the queue draining instead of parking near 4%", () => {
    // 200 chapters, 2 workers. Every running chapter is near the start
    // of its own life the whole way through — that is exactly the shape
    // that used to hold the readout at 4%.
    const seen: number[] = [];
    for (const done of [0, 20, 50, 100, 150]) {
      emit(done, [0.05, 0.02], 200);
      seen.push(getDownloadProgress().pct);
    }
    emit(200, [], 200);
    seen.push(getDownloadProgress().pct);
    expect(seen).toEqual([0, 10, 25, 50, 75, 100]);
  });

  it("never falls back when a chapter lands and the next starts over", () => {
    const seen: number[] = [];
    for (const [done, partial] of [[3, 0.95], [4, 0.02], [4, 0.35], [5, 0.05]] as const) {
      emit(done, [partial], 10);
      seen.push(getDownloadProgress().pct);
    }
    expect(seen).toEqual([40, 40, 43, 51]);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
  });

  it("moves for a single chapter, where nothing resolves until the end", () => {
    const seen: number[] = [];
    for (const p of [0.02, 0.05, 0.35, 0.95]) {
      emit(0, [p], 1);
      seen.push(getDownloadProgress().pct);
    }
    expect(seen).toEqual([2, 5, 35, 95]);
  });

  it("clears once the queue goes idle", () => {
    emit(0, [0.5], 4);
    expect(getDownloadProgress().pct).toBeGreaterThan(0);
    jobs = [];
    counters = { chDone: 0, chFailed: 0, chCancelled: 0, cvDone: 0, cvFailed: 0 };
    listener?.({ jobs });
    expect(getDownloadProgress()).toEqual({ active: 0, resolved: 0, total: 0, pct: 0 });
  });
});
