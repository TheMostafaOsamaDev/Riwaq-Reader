import { describe, expect, it } from "vitest";
import {
  androidChannel,
  attentionDot,
  cleanupDecision,
  clearSkip,
  decideStart,
  parseNativeStatus,
  pillFor,
  showsMobileDataSetting,
  staleStatusDecision,
  versionCode,
} from "./updateFlow";

const src = (installer: string, storeInstalled = true, label = "") => ({
  installer,
  label,
  storeInstalled,
});

describe("androidChannel", () => {
  it("installs in-app for sideloads, adb/Shizuku and our own earlier update", () => {
    for (const i of [
      "",
      "com.google.android.packageinstaller",
      "com.android.packageinstaller",
      "com.android.shell",
      "com.riwaq.reader",
    ]) {
      expect(androidChannel(src(i)).kind).toBe("in-app");
    }
  });
  it("hands Orion and Obtainium installs back to their store", () => {
    expect(androidChannel(src("com.orion.store"))).toMatchObject({
      kind: "store-assisted",
      store: "orion",
    });
    expect(androidChannel(src("dev.imranr.obtainium.fdroid"))).toMatchObject({
      kind: "store-assisted",
      store: "obtainium",
    });
  });
  it("falls back to in-app when that store app is gone", () => {
    expect(androidChannel(src("com.orion.store", false)).kind).toBe("in-app");
  });
  it("leaves F-Droid, Play and unknown stores alone", () => {
    for (const i of [
      "org.fdroid.fdroid",
      "com.looker.droidify",
      "com.android.vending",
      "com.example.somestore",
    ]) {
      expect(androidChannel(src(i)).kind).toBe("managed");
    }
  });
  it("does not mistake an Object.prototype key for a known store", () => {
    expect(androidChannel(src("constructor")).kind).toBe("managed");
  });
  it("uses the old link when the lookup failed", () => {
    expect(androidChannel(null).kind).toBe("manual");
  });
});

describe("cleanupDecision", () => {
  it("deletes a cached APK once the running app is at or past it — whoever updated", () => {
    // Orion/Obtainium/F-Droid/adb updated us while our APK sat in cache.
    expect(cleanupDecision("0.6.0", "0.6.0")).toBe("delete");
    expect(cleanupDecision("0.6.1", "0.6.0")).toBe("delete");
    expect(cleanupDecision("0.5.3", "0.6.0")).toBe("keep");
    expect(cleanupDecision("0.5.3", undefined)).toBe("keep");
  });
});

describe("staleStatusDecision", () => {
  const job = { working: false, parked: false, hasJob: true };
  it("re-parks a Wi-Fi wait the process lost, instead of reporting a failure", () => {
    // Swiped away while waiting: state.json still says "waiting", but the
    // network callback died with the process. Nothing failed.
    expect(staleStatusDecision({ ...job, state: "waiting" })).toBe("repark");
  });
  it("fails a lost wait only when state.json no longer holds the job", () => {
    expect(
      staleStatusDecision({ ...job, state: "waiting", hasJob: false }),
    ).toBe("fail");
  });
  it("leaves a wait that is still parked alone", () => {
    expect(
      staleStatusDecision({ ...job, state: "waiting", parked: true }),
    ).toBe("keep");
  });
  it("reports a download the process lost as interrupted", () => {
    for (const state of ["downloading", "verifying"] as const) {
      expect(staleStatusDecision({ ...job, state })).toBe("fail");
      expect(staleStatusDecision({ ...job, state, working: true })).toBe(
        "keep",
      );
    }
  });
  it("never touches any other state", () => {
    for (const state of [
      "idle",
      "ready",
      "installing",
      "failed",
      "something",
    ]) {
      expect(staleStatusDecision({ ...job, state })).toBe("keep");
    }
  });
});

describe("parseNativeStatus", () => {
  it("reads a downloading status", () => {
    expect(
      parseNativeStatus(
        '{"state":"downloading","version":"0.6.0","bytes":5,"total":10,"error":null}',
      ),
    ).toEqual({
      state: "downloading",
      version: "0.6.0",
      bytes: 5,
      total: 10,
      error: null,
    });
  });
  it("treats garbage as idle instead of throwing", () => {
    expect(parseNativeStatus("nope").state).toBe("idle");
    expect(parseNativeStatus('{"state":"exploded"}').state).toBe("idle");
  });
});

describe("versionCode", () => {
  it("matches Android's versionCode rule", () => {
    expect(versionCode("0.6.1")).toBe(6001);
    expect(versionCode("1.2.3")).toBe(1002003);
    expect(versionCode("x")).toBe(-1);
  });
});

const idle = { state: "idle", bytes: 0, total: 0, error: null } as const;
const base = {
  offered: "0.6.0",
  running: "0.5.3",
  native: idle,
  skipped: undefined,
  laterThisSession: false,
  channel: "in-app",
} as const;

describe("pillFor", () => {
  it("offers, then shows progress, then ready", () => {
    expect(pillFor(base)).toEqual({ kind: "available" });
    expect(
      pillFor({
        ...base,
        native: { ...idle, state: "downloading", bytes: 37, total: 100 },
      }),
    ).toEqual({ kind: "progress", pct: 37 });
    expect(pillFor({ ...base, native: { ...idle, state: "ready" } })).toEqual({
      kind: "ready",
    });
  });
  it("disappears once the app is already at the offered version — a store updated it", () => {
    expect(pillFor({ ...base, running: "0.6.0" })).toBeNull();
    expect(
      pillFor({
        ...base,
        running: "0.6.0",
        native: { ...idle, state: "ready" },
      }),
    ).toBeNull();
  });
  it("offers nothing it could not verify, but keeps a job already under way", () => {
    expect(pillFor({ ...base, unverified: true })).toBeNull();
    expect(
      pillFor({
        ...base,
        unverified: true,
        native: { ...idle, state: "downloading", version: "0.6.0" },
      }),
    ).toEqual({ kind: "progress", pct: 0 });
  });
  it("hides after Later or Skip, but never hides a running download", () => {
    expect(pillFor({ ...base, laterThisSession: true })).toBeNull();
    expect(pillFor({ ...base, skipped: "0.6.0" })).toBeNull();
    expect(
      pillFor({
        ...base,
        laterThisSession: true,
        native: { ...idle, state: "downloading", bytes: 1, total: 2 },
      })?.kind,
    ).toBe("progress");
  });
  it("offers the new release, not a stale ready APK of an older one", () => {
    // 0.6.0 was downloaded and left; 0.6.1 is now the offer.
    expect(
      pillFor({
        ...base,
        offered: "0.6.1",
        native: { ...idle, state: "ready", version: "0.6.0" },
      }),
    ).toEqual({ kind: "available" });
  });
  it("is never shown for a store-managed install", () => {
    expect(pillFor({ ...base, channel: "managed" })).toBeNull();
    expect(pillFor({ ...base, channel: "store-assisted" })).toEqual({
      kind: "available",
    });
  });
});

describe("attentionDot", () => {
  it("marks Settings after Later, not after Skip, not when managed", () => {
    expect(attentionDot({ ...base, laterThisSession: true })).toBe(true);
    expect(attentionDot({ ...base, skipped: "0.6.0" })).toBe(false);
    expect(attentionDot({ ...base, channel: "managed" })).toBe(false);
    expect(attentionDot({ ...base, running: "0.6.0" })).toBe(false);
  });
});

describe("decideStart", () => {
  it("asks on mobile data by default, waits or starts per the setting", () => {
    expect(decideStart({ metered: false, pref: "ask" })).toBe("start");
    expect(decideStart({ metered: true, pref: "ask" })).toBe("ask");
    expect(decideStart({ metered: true, pref: "wifi" })).toBe("wait");
    expect(decideStart({ metered: true, pref: "always" })).toBe("start");
  });
});

describe("clearSkip", () => {
  it("clears a skip once something newer is offered or running", () => {
    expect(clearSkip("0.6.0", "0.6.1", "0.5.3")).toBe(true);
    expect(clearSkip("0.6.0", "0.6.0", "0.5.3")).toBe(false);
    expect(clearSkip("0.6.0", null, "0.6.0")).toBe(true);
  });
});

describe("showsMobileDataSetting", () => {
  // Task 14: an F-Droid install still showed "Over mobile data", a setting
  // for a download it never makes.
  it("only an in-app install downloads, so only it gets the row", () => {
    expect(showsMobileDataSetting({ kind: "in-app" })).toBe(true);
    expect(
      showsMobileDataSetting({
        kind: "managed",
        pkg: "org.fdroid.fdroid",
        label: "F-Droid",
        storeInstalled: true,
      }),
    ).toBe(false);
    expect(
      showsMobileDataSetting({
        kind: "store-assisted",
        store: "orion",
        pkg: "com.orion.store",
        label: "Orion Store",
      }),
    ).toBe(false);
    expect(showsMobileDataSetting({ kind: "manual" })).toBe(false);
    // Not known yet: hidden rather than shown and then pulled away.
    expect(showsMobileDataSetting(null)).toBe(false);
  });
});
