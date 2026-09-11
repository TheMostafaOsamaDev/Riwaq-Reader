// @vitest-environment happy-dom
//
// The FAB ring is the app's one "background work is happening" light. It
// used to read the import store only, so a queued cover fetch left it dark.
//
// It deliberately does NOT light up for chapter downloads: those already
// have the Downloads page, and spinning the ring for each of a 200-chapter
// burst would be a behaviour change nobody asked for.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stateful, unlike a fixed `{ jobs: [] }`/`() => 0` stub: the reactivity
// test below needs to change the job list after the hook has already
// mounted and observe whether that reaches a re-render. And it has to
// mirror the real downloadQueue.ts's identity contract exactly — a single
// object whose `.jobs` property is overwritten in place, never a fresh
// `{ jobs }` wrapper handed back from `getState()` — otherwise the mock
// can't reproduce (or would over-eagerly "catch") the actual bug, which is
// specifically about `getState()` returning the SAME reference forever.
interface FakeJob {
  kind: string;
  status: "queued" | "running" | "done";
}
const queueState: { jobs: FakeJob[] } = { jobs: [] };
const queueListeners = new Set<() => void>();

vi.mock("./downloadQueue", () => ({
  subscribe: (fn: () => void) => {
    queueListeners.add(fn);
    return () => queueListeners.delete(fn);
  },
  getState: () => queueState,
  activeLibraryAddCount: (jobs: FakeJob[]) =>
    jobs.filter(
      (j) =>
        j.kind === "library-add" &&
        (j.status === "queued" || j.status === "running"),
    ).length,
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  createChannel: async () => {},
  Importance: { Low: 2 },
  isPermissionGranted: async () => false,
  requestPermission: async () => "denied",
}));
vi.mock("./downloadNotifier/transport", () => ({
  DOWNLOAD_NOTIFICATION_ID: 1,
  DOWNLOAD_SUMMARY_ID: 2,
  pushDownloadNotification: async () => {},
  setDockProgress: async () => {},
}));

import { importIndicator, useImportIndicator } from "./importIndicator";
import type { ImportIndicator } from "./importIndicator";
import { chapterDownloadCount } from "./downloadNotifier";

const idle = {
  active: false,
  minimized: false,
  steps: [],
  overall: 0,
  error: null,
  resultBookId: null,
  finishedAt: null,
};

describe("importIndicator", () => {
  it("is idle with no import and no adds", () => {
    expect(importIndicator(idle, false, 0)).toEqual({
      busy: false,
      ratio: null,
      action: "pick",
    });
  });

  it("spins for an in-flight library add", () => {
    const ind = importIndicator(idle, false, 1);
    expect(ind.busy).toBe(true);
    expect(ind.action).toBe("details");
  });

  it("reports an add as indeterminate — one cover has no meaningful ratio", () => {
    expect(importIndicator(idle, false, 2).ratio).toBeNull();
  });

  it("lets a real import's determinate ratio win over an add", () => {
    const importing = { ...idle, active: true, overall: 0.4 };
    expect(importIndicator(importing, false, 1).ratio).toBe(0.4);
  });
});

describe("chapterDownloadCount", () => {
  it("excludes library adds from the chapter-download count", () => {
    // The bug this replaces: one cover fetch, nothing else, announced as
    // "Downloading 1" because adds weren't subtracted.
    expect(
      chapterDownloadCount({
        active: 1,
        activeConversions: 0,
        activeAdds: 1,
        importActive: false,
      }),
    ).toBe(0);
  });

  it("still counts real chapter downloads alongside an add", () => {
    expect(
      chapterDownloadCount({
        active: 4,
        activeConversions: 0,
        activeAdds: 1,
        importActive: false,
      }),
    ).toBe(3);
  });

  it("subtracts every separately-counted kind at once", () => {
    expect(
      chapterDownloadCount({
        active: 5,
        activeConversions: 1,
        activeAdds: 2,
        importActive: true,
      }),
    ).toBe(1);
  });
});

// The pure `importIndicator` cases above pass a hand-picked `addsActive`
// count directly — they cannot see whether `useImportIndicator` ever
// actually gets that count from a live queue. This is a real, previously
// broken path: `useSyncExternalStore`'s getSnapshot returned the queue's
// state OBJECT, which downloadQueue.ts mutates in place and never
// reassigns, so Object.is(prev, next) was always true and React never
// re-rendered on a new add — the ring stayed dark. Rendering the hook for
// real and pushing a queue change through the mocked `subscribe` listener
// is the only way to catch that class of bug; asserting on `importIndicator`
// directly cannot, no matter how many cases are added.
describe("useImportIndicator", () => {
  afterEach(() => {
    queueState.jobs = [];
    queueListeners.clear();
  });

  function mount(): { latest: () => ImportIndicator; root: Root } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let latest!: ImportIndicator;
    act(() => {
      root.render(
        createElement(() => {
          latest = useImportIndicator(false);
          return null;
        }),
      );
    });
    return { latest: () => latest, root };
  }

  it("re-renders when a library-add job appears on the queue", () => {
    const { latest, root } = mount();
    expect(latest().busy).toBe(false);

    // A property write, exactly like the real queue's `state.jobs = ...` —
    // `queueState` itself keeps its identity.
    queueState.jobs = [{ kind: "library-add", status: "running" }];
    act(() => {
      for (const l of queueListeners) l();
    });

    expect(latest().busy).toBe(true);
    expect(latest().action).toBe("details");
    root.unmount();
  });

  it("re-renders back to idle once the add resolves", () => {
    queueState.jobs = [{ kind: "library-add", status: "running" }];
    const { latest, root } = mount();
    expect(latest().busy).toBe(true);

    queueState.jobs = [{ kind: "library-add", status: "done" }];
    act(() => {
      for (const l of queueListeners) l();
    });

    expect(latest().busy).toBe(false);
    root.unmount();
  });
});
