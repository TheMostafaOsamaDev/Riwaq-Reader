// @vitest-environment happy-dom
//
// The regression guard for the whole diagnostics design.
//
// The blank-launch bug is a stall on the Tauri IPC bridge. lib/devLog.ts
// writes through that same bridge, which is why it has never been able to
// describe the failure. These tests pin the property that makes breadcrumbs
// different: with every filesystem call hung forever, the marks are STILL
// written and STILL readable on the next launch.
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every IPC call hangs forever — the exact failure being diagnosed. */
const neverSettles = () => new Promise(() => {});
vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  mkdir: neverSettles,
  writeTextFile: neverSettles,
  readTextFile: neverSettles,
  readDir: neverSettles,
  remove: neverSettles,
  exists: neverSettles,
}));

const render = vi.fn();
vi.mock("react-dom/client", () => ({
  default: { createRoot: () => ({ render, unmount: vi.fn() }) },
  createRoot: () => ({ render, unmount: vi.fn() }),
}));
vi.mock("../../App", () => ({ default: () => null }));
vi.mock("../../styles/global.css", () => ({}));
vi.mock("../../store/legacyRoot", () => ({
  migrateLegacyRoot: neverSettles,
}));

describe("boot breadcrumbs under a dead IPC bridge", () => {
  beforeEach(() => {
    localStorage.clear();
    render.mockClear();
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
  });

  it("records the module mark even though every fs call hangs", async () => {
    const { BOOT_KEY } = await import("./breadcrumbs");
    await import("../../main");
    await Promise.resolve();

    const raw = localStorage.getItem(BOOT_KEY);
    expect(raw).toBeTruthy();
    const marks = JSON.parse(raw as string).marks;
    expect(marks.module).toBeDefined();
  });

  it("records the render mark, so a stall after render is distinguishable", async () => {
    const { BOOT_KEY } = await import("./breadcrumbs");
    await import("../../main");
    await Promise.resolve();

    const marks = JSON.parse(localStorage.getItem(BOOT_KEY) as string).marks;
    expect(marks.render).toBeDefined();
    // `mounted` comes from App's effect, which is mocked out here — so this
    // run looks exactly like a blank launch, which is the point.
    expect(marks.mounted).toBeUndefined();
  });

  it("still mounts React — the diagnostic must not gate first paint", async () => {
    await import("../../main");
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);
  });
});
