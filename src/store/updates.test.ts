import { describe, expect, it } from "vitest";
import { evaluateUpdate, fetchManifestVersion, resolveCheck } from "./updates";

const answers = (body: unknown) => async (command: string) => {
  // The command name is part of the contract with src-tauri/src/updates.rs.
  expect(command).toBe("check_update_manifest");
  return body;
};

describe("fetchManifestVersion", () => {
  it("reads the version and notes the Rust side returns", async () => {
    const r = await fetchManifestVersion(
      answers({ version: "0.3.0", notes: "Faster covers" }),
    );
    expect(r).toEqual({ version: "0.3.0", notes: "Faster covers" });
  });

  it("returns null when the command rejects", async () => {
    // Offline is the NORMAL case for an offline-first reader, and so is a
    // captive portal's HTML — Rust rejects both. Neither may throw here.
    const boom = async () => {
      throw "manifest is not JSON";
    };
    expect(await fetchManifestVersion(boom)).toBeNull();
  });

  it("returns null for a malformed answer", async () => {
    expect(await fetchManifestVersion(answers(null))).toBeNull();
    expect(await fetchManifestVersion(answers({ version: "" }))).toBeNull();
    expect(await fetchManifestVersion(answers({ version: 3 }))).toBeNull();
  });
});

const mac = { os: "macos", isAppImage: false, isFlatpak: false };

describe("resolveCheck", () => {
  it("keeps a failed check apart from an up-to-date one", () => {
    // The bug this exists for: both used to collapse to "no banner".
    expect(resolveCheck({ latest: null, current: "0.5.0", env: mac })).toEqual({
      kind: "failed",
    });
    expect(
      resolveCheck({
        latest: { version: "0.5.0" },
        current: "0.5.0",
        env: mac,
      }),
    ).toEqual({ kind: "upToDate", current: "0.5.0" });
  });

  it("offers the update when one exists", () => {
    expect(
      resolveCheck({
        latest: { version: "0.6.0" },
        current: "0.5.0",
        env: mac,
      }),
    ).toEqual({
      kind: "update",
      info: { version: "0.6.0", notes: undefined, channel: "auto" },
    });
  });

  it("calls an unknown running version a failure, not up to date", () => {
    expect(
      resolveCheck({ latest: { version: "0.5.0" }, current: "", env: mac }),
    ).toEqual({ kind: "failed" });
  });

  it("reports a Flatpak as managed whether or not it is behind", () => {
    const env = { os: "linux", isAppImage: false, isFlatpak: true };
    for (const version of ["0.6.0", "0.5.0"]) {
      expect(
        resolveCheck({ latest: { version }, current: "0.5.0", env }),
      ).toEqual({ kind: "managed" });
    }
  });
});

describe("evaluateUpdate", () => {
  it("offers an update on the auto channel", () => {
    expect(
      evaluateUpdate({
        latest: { version: "0.3.0", notes: "n" },
        current: "0.2.0",
        env: { os: "macos", isAppImage: false, isFlatpak: false },
      }),
    ).toEqual({ version: "0.3.0", notes: "n", channel: "auto" });
  });

  it("offers an update on the manual channel for Android", () => {
    expect(
      evaluateUpdate({
        latest: { version: "0.3.0" },
        current: "0.2.0",
        env: { os: "android", isAppImage: false, isFlatpak: false },
      }),
    ).toEqual({ version: "0.3.0", notes: undefined, channel: "manual" });
  });

  it("offers nothing when already current", () => {
    expect(
      evaluateUpdate({
        latest: { version: "0.2.0" },
        current: "0.2.0",
        env: { os: "windows", isAppImage: false, isFlatpak: false },
      }),
    ).toBeNull();
  });

  it("offers nothing when the fetch failed", () => {
    expect(
      evaluateUpdate({
        latest: null,
        current: "0.2.0",
        env: { os: "windows", isAppImage: false, isFlatpak: false },
      }),
    ).toBeNull();
  });

  it("offers nothing when the running version is unknown", () => {
    // getVersion() can fail; an empty current must not read as "older than
    // everything" and offer an update on every launch.
    expect(
      evaluateUpdate({
        latest: { version: "0.3.0" },
        current: "",
        env: { os: "windows", isAppImage: false, isFlatpak: false },
      }),
    ).toBeNull();
  });

  it("offers nothing in a Flatpak even when a newer version exists", () => {
    // Flathub ships the update on its own schedule. A banner here would point
    // at a .deb/.rpm download for an install that package cannot replace, and
    // nothing else would notice if it came back: the banner just appears.
    const latest = { version: "0.3.0", notes: "n" };
    const linux = { os: "linux", isAppImage: false };
    // The control: the same install outside a Flatpak is offered the update,
    // so the null below is down to the flag and not to the inputs.
    expect(
      evaluateUpdate({
        latest,
        current: "0.2.0",
        env: { ...linux, isFlatpak: false },
      }),
    ).toEqual({ version: "0.3.0", notes: "n", channel: "manual" });
    expect(
      evaluateUpdate({
        latest,
        current: "0.2.0",
        env: { ...linux, isFlatpak: true },
      }),
    ).toBeNull();
  });
});
