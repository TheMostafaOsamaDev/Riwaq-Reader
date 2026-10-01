import { describe, expect, it } from "vitest";
import {
  androidChannel,
  cleanupDecision,
  parseNativeStatus,
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
