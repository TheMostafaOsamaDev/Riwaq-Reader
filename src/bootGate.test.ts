// @vitest-environment happy-dom
//
// Regression cover for the Android blank-screen-on-launch bug.
//
// main.tsx used to withhold ReactDOM.render until migrateLegacyRoot() SETTLED:
//
//     void migrateLegacyRoot().finally(() => { createRoot(...).render(...) })
//
// Its comment argued the call "never rejects", which is true and beside the
// point — never-rejects is not always-settles. That function's first act is
// `exists()` over Tauri's IPC, and on Android that bridge can stall at cold
// start. While it stalls the user sees the boot background and nothing else:
// no spinner, no timeout, no fallback. Observed on a real device and
// reproduced on the emulator, where the app sat blank for 70s+ having made
// three IPC calls and created no app-data directory at all.
//
// The gate was also redundant. Every module that touches app data already
// awaits the same memoized promise before its first read — library.ts via
// ensureRoot(), downloadQueue.ts, sourceLibrary.ts, shelves.ts — so ordering
// is preserved without making first paint wait on the filesystem.
import { beforeEach, describe, expect, it, vi } from "vitest";

const render = vi.fn();
const createRoot = vi.fn(() => ({ render, unmount: vi.fn() }));

vi.mock("react-dom/client", () => ({
  default: { createRoot },
  createRoot,
}));
vi.mock("./App", () => ({ default: () => null }));
vi.mock("./styles/global.css", () => ({}));

/** A migration that never settles — the stall this bug is about. */
let settle: (() => void) | null = null;
const migrateLegacyRoot = vi.fn(
  () => new Promise<void>((resolve) => {
    settle = () => resolve();
  }),
);
vi.mock("./store/legacyRoot", () => ({ migrateLegacyRoot }));

describe("app boot", () => {
  beforeEach(() => {
    render.mockClear();
    createRoot.mockClear();
    migrateLegacyRoot.mockClear();
    settle = null;
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
  });

  it("mounts React even while the app-data migration is still pending", async () => {
    await import("./main");
    // Give any .then/.finally continuation a chance to run. If boot is gated
    // on the migration, nothing renders here, because it never settles.
    await Promise.resolve();
    await Promise.resolve();

    expect(migrateLegacyRoot).toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("still starts the migration, so store reads stay ordered behind it", async () => {
    await import("./main");
    await Promise.resolve();

    // The migration must be kicked off at boot, not skipped — the store
    // modules await this same memoized promise before their first read.
    expect(migrateLegacyRoot).toHaveBeenCalledTimes(1);
  });

  it("does not render a second time when the migration later settles", async () => {
    await import("./main");
    await Promise.resolve();
    settle?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(render).toHaveBeenCalledTimes(1);
  });
});
