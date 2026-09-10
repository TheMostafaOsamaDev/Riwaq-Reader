import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./updateVersion";

describe("isNewerVersion", () => {
  it("sees a newer minor version", () => {
    expect(isNewerVersion("0.3.0", "0.2.0")).toBe(true);
  });

  it("sees a newer patch version", () => {
    expect(isNewerVersion("0.2.1", "0.2.0")).toBe(true);
  });

  it("does not offer an update for the same version", () => {
    expect(isNewerVersion("0.2.0", "0.2.0")).toBe(false);
  });

  it("never offers a downgrade", () => {
    // The updater only moves forward. Telling someone on a newer build that
    // an older one is "available" would loop them forever.
    expect(isNewerVersion("0.2.0", "0.3.0")).toBe(false);
  });

  it("compares numerically, not as strings", () => {
    // "10" < "9" as strings. The bug every hand-rolled semver compare has.
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.99.99")).toBe(true);
  });

  it("tolerates a leading v on either side", () => {
    // The manifest permits "v0.3.0"; getVersion() returns "0.3.0".
    expect(isNewerVersion("v0.3.0", "0.2.0")).toBe(true);
    expect(isNewerVersion("0.3.0", "v0.2.0")).toBe(true);
  });

  it("treats a prerelease as older than its release", () => {
    expect(isNewerVersion("0.3.0-beta.1", "0.3.0")).toBe(false);
    expect(isNewerVersion("0.3.0", "0.3.0-beta.1")).toBe(true);
  });

  it("refuses to offer an update on malformed input", () => {
    // A truncated download or a captive-portal HTML page must never parse as
    // a version. Failing closed means "no update", never a bogus one.
    expect(isNewerVersion("", "0.2.0")).toBe(false);
    expect(isNewerVersion("not-a-version", "0.2.0")).toBe(false);
    expect(isNewerVersion("0.3.0", "")).toBe(false);
    expect(isNewerVersion("<!DOCTYPE html>", "0.2.0")).toBe(false);
  });
});
