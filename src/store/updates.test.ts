import { describe, expect, it } from "vitest";
import { evaluateUpdate, fetchManifestVersion } from "./updates";

const ok = (body: unknown) =>
  (async () =>
    new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe("fetchManifestVersion", () => {
  it("reads the version and notes from a well-formed manifest", async () => {
    const r = await fetchManifestVersion(
      ok({ version: "0.3.0", notes: "Faster covers", platforms: {} }),
    );
    expect(r).toEqual({ version: "0.3.0", notes: "Faster covers" });
  });

  it("returns null on a non-200", async () => {
    const fail = (async () =>
      new Response("nope", { status: 404 })) as unknown as typeof fetch;
    expect(await fetchManifestVersion(fail)).toBeNull();
  });

  it("returns null when the body is not JSON", async () => {
    // A captive portal or a GitHub error page serves HTML with a 200.
    const html = (async () =>
      new Response("<!DOCTYPE html>", { status: 200 })) as unknown as typeof fetch;
    expect(await fetchManifestVersion(html)).toBeNull();
  });

  it("returns null when the manifest carries no version", async () => {
    expect(await fetchManifestVersion(ok({ platforms: {} }))).toBeNull();
  });

  it("returns null when the network throws", async () => {
    // Offline is the NORMAL case for an offline-first reader. It must never
    // surface as an error the user has to dismiss.
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchManifestVersion(boom)).toBeNull();
  });
});

describe("evaluateUpdate", () => {
  it("offers an update on the auto channel", () => {
    expect(
      evaluateUpdate({
        latest: { version: "0.3.0", notes: "n" },
        current: "0.2.0",
        env: { os: "macos", isAppImage: false },
      }),
    ).toEqual({ version: "0.3.0", notes: "n", channel: "auto" });
  });

  it("offers an update on the manual channel for Android", () => {
    expect(
      evaluateUpdate({
        latest: { version: "0.3.0" },
        current: "0.2.0",
        env: { os: "android", isAppImage: false },
      }),
    ).toEqual({ version: "0.3.0", notes: undefined, channel: "manual" });
  });

  it("offers nothing when already current", () => {
    expect(
      evaluateUpdate({
        latest: { version: "0.2.0" },
        current: "0.2.0",
        env: { os: "windows", isAppImage: false },
      }),
    ).toBeNull();
  });

  it("offers nothing when the fetch failed", () => {
    expect(
      evaluateUpdate({
        latest: null,
        current: "0.2.0",
        env: { os: "windows", isAppImage: false },
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
        env: { os: "windows", isAppImage: false },
      }),
    ).toBeNull();
  });
});
