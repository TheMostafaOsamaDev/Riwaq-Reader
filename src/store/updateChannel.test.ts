import { describe, expect, it } from "vitest";
import { resolveChannel } from "./updateChannel";

// tauri-plugin-updater supports Windows, macOS and Linux-as-AppImage. It does
// not support Android at all — the plugin excludes that target — and on Linux
// it replaces the running executable in place, which for a .deb/.rpm install
// is a root-owned path under /usr/bin. Those installs need a download link,
// not a button that fails every time.
describe("resolveChannel", () => {
  it("self-updates on Windows", () => {
    expect(
      resolveChannel({ os: "windows", isAppImage: false, isFlatpak: false }),
    ).toBe("auto");
  });

  it("self-updates on macOS", () => {
    expect(
      resolveChannel({ os: "macos", isAppImage: false, isFlatpak: false }),
    ).toBe("auto");
  });

  it("self-updates on Linux when running as an AppImage", () => {
    expect(
      resolveChannel({ os: "linux", isAppImage: true, isFlatpak: false }),
    ).toBe("auto");
  });

  it("falls back to manual for a Linux package install", () => {
    expect(
      resolveChannel({ os: "linux", isAppImage: false, isFlatpak: false }),
    ).toBe("manual");
  });

  it("falls back to manual on Android", () => {
    expect(
      resolveChannel({ os: "android", isAppImage: false, isFlatpak: false }),
    ).toBe("manual");
  });

  it("falls back to manual on an unrecognised platform", () => {
    // Offering an install we cannot perform is worse than offering a link.
    expect(
      resolveChannel({ os: "ios", isAppImage: false, isFlatpak: false }),
    ).toBe("manual");
    expect(
      resolveChannel({ os: "", isAppImage: false, isFlatpak: false }),
    ).toBe("manual");
  });

  // Flathub updates a Flatpak install; the in-app updater has nothing to add,
  // and a Download link would send the user to a .deb or .rpm for an app the
  // store has already brought up to date.
  it("offers nothing in a Flatpak", () => {
    expect(
      resolveChannel({ os: "linux", isAppImage: false, isFlatpak: true }),
    ).toBe("none");
  });

  it("lets the Flatpak signal outrank every other signal", () => {
    // The sandbox decides who updates the app, whatever else the environment
    // claims: it must win over the AppImage self-update and the manual
    // fallback alike.
    expect(
      resolveChannel({ os: "linux", isAppImage: true, isFlatpak: true }),
    ).toBe("none");
    expect(resolveChannel({ os: "", isAppImage: false, isFlatpak: true })).toBe(
      "none",
    );
  });
});
