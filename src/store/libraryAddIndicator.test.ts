// The FAB ring is the app's one "background work is happening" light. It
// used to read the import store only, so a queued cover fetch left it dark.
//
// It deliberately does NOT light up for chapter downloads: those already
// have the Downloads page, and spinning the ring for each of a 200-chapter
// burst would be a behaviour change nobody asked for.
import { describe, expect, it, vi } from "vitest";

vi.mock("./downloadQueue", () => ({
  subscribe: () => () => {},
  getState: () => ({ jobs: [] }),
  activeLibraryAddCount: () => 0,
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

import { importIndicator } from "./importIndicator";
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
