import { describe, expect, it } from "vitest";
import { androidChannel } from "./updateFlow";

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
