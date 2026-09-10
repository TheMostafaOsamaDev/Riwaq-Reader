import { describe, expect, it } from "vitest";
import { resolveChannel } from "./updateChannel";

// tauri-plugin-updater supports Windows, macOS and Linux-as-AppImage. It does
// not support Android at all — the plugin excludes that target — and on Linux
// it replaces the running executable in place, which for a .deb/.rpm install
// is a root-owned path under /usr/bin. Those installs need a download link,
// not a button that fails every time.
describe("resolveChannel", () => {
  it("self-updates on Windows", () => {
    expect(resolveChannel({ os: "windows", isAppImage: false })).toBe("auto");
  });

  it("self-updates on macOS", () => {
    expect(resolveChannel({ os: "macos", isAppImage: false })).toBe("auto");
  });

  it("self-updates on Linux when running as an AppImage", () => {
    expect(resolveChannel({ os: "linux", isAppImage: true })).toBe("auto");
  });

  it("falls back to manual for a Linux package install", () => {
    expect(resolveChannel({ os: "linux", isAppImage: false })).toBe("manual");
  });

  it("falls back to manual on Android", () => {
    expect(resolveChannel({ os: "android", isAppImage: false })).toBe("manual");
  });

  it("falls back to manual on an unrecognised platform", () => {
    // Offering an install we cannot perform is worse than offering a link.
    expect(resolveChannel({ os: "ios", isAppImage: false })).toBe("manual");
    expect(resolveChannel({ os: "", isAppImage: false })).toBe("manual");
  });
});
