import { resolveObjectURL } from "node:buffer";
import { describe, expect, it } from "vitest";
import type { SourceHost } from "../sources/types";
import type { ModuleImporter } from "./loadModule";
import { loadExtension } from "./loader";

// Evaluates a bundle as a real ES module through Node's own loader.
//
// loadModuleFromSource hands its importer a `blob:` URL, and Node's ESM
// loader refuses that scheme outright — see the long note on the skipped
// test in loadModule.test.ts. So these tests inject an importer that reads
// the source back OUT of the blob it was given and re-serves it as a
// `data:` URL, which Node does support.
//
// Reading it out of the blob rather than closing over the test's own string
// is what makes the seam honest: the source still has to travel
// loadExtension(source) -> loadModuleFromSource -> blob -> here, so a
// loadExtension that dropped or mangled its `source` argument fails these
// tests rather than passing them. And the module is genuinely parsed and
// evaluated: a bundle that throws really throws, a bundle with no default
// export really has none.
const evaluating: ModuleImporter = async (url) => {
  const blob = resolveObjectURL(url);
  if (!blob) throw new Error(`no blob registered for ${url}`);
  const src = await blob.text();
  return import(
    /* @vite-ignore */ `data:text/javascript,${encodeURIComponent(src)}`
  );
};

const host = { locale: "en" } as unknown as SourceHost;
const manifest = {
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  apiVersion: 1,
  language: "ar",
  baseUrl: "https://demo.test",
};

describe("loadExtension", () => {
  it("constructs a source from a well-formed bundle", async () => {
    const r = await loadExtension(
      manifest,
      `export default (host) => ({ canHandle: (u) => u.startsWith("https://demo.test") });`,
      host,
      evaluating,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source.canHandle("https://demo.test/x")).toBe(true);
      expect(r.source.canHandle("https://other.test/x")).toBe(false);
    }
  });

  it("passes the host to the factory", async () => {
    // Without this, a loader that called `mod.default()` with no argument
    // would satisfy every other test here while shipping extensions a
    // host of `undefined`.
    const r = await loadExtension(
      manifest,
      `export default (host) => ({ canHandle: () => host.locale === "en" });`,
      host,
      evaluating,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source.canHandle("https://demo.test/x")).toBe(true);
  });

  it("refuses a bundle built against a newer contract major", async () => {
    const r = await loadExtension(
      { ...manifest, apiVersion: 2 },
      `export default () => ({ canHandle: () => true });`,
      host,
      evaluating,
    );
    expect(r).toMatchObject({ ok: false, reason: "api-version" });
    if (!r.ok) expect(r.message).toMatch(/newer version of Riwaq/);
  });

  it("refuses a bundle built against an older contract major, and says so differently", async () => {
    // Both directions are refused, but the user can only act on one of
    // them — "update Riwaq" vs "update the extension". A single shared
    // message would pass a reason-only assertion while telling half of
    // the users to do the wrong thing.
    const r = await loadExtension(
      { ...manifest, apiVersion: 0 },
      `export default () => ({ canHandle: () => true });`,
      host,
      evaluating,
    );
    expect(r).toMatchObject({ ok: false, reason: "api-version" });
    if (!r.ok) expect(r.message).toMatch(/needs updating/);
  });

  it("checks apiVersion BEFORE evaluating the bundle", async () => {
    // A bundle that would throw on evaluation, behind a failing gate. If
    // the gate ran after evaluation this would come back "load-error" —
    // and, worse, a mismatched bundle's top-level code would have run.
    const r = await loadExtension(
      { ...manifest, apiVersion: 2 },
      `throw new Error("bad bundle");`,
      host,
      evaluating,
    );
    expect(r).toMatchObject({ ok: false, reason: "api-version" });
  });

  it("captures a bundle that throws at evaluation instead of propagating", async () => {
    const r = await loadExtension(
      manifest,
      `throw new Error("bad bundle");`,
      host,
      evaluating,
    );
    expect(r).toMatchObject({ ok: false, reason: "load-error" });
    if (!r.ok) expect(r.message).toMatch(/bad bundle/);
  });

  it("captures a bundle with no default export", async () => {
    const r = await loadExtension(
      manifest,
      `export const nope = 1;`,
      host,
      evaluating,
    );
    expect(r).toMatchObject({ ok: false, reason: "load-error" });
    if (!r.ok) expect(r.message).toMatch(/default-exported factory/);
  });

  it("captures a factory that returns something that is not a Source", async () => {
    const r = await loadExtension(
      manifest,
      `export default () => ({ nope: 1 });`,
      host,
      evaluating,
    );
    expect(r).toMatchObject({ ok: false, reason: "load-error" });
    if (!r.ok) expect(r.message).toMatch(/did not return a Source/);
  });

  it("captures a factory that throws when called", async () => {
    const r = await loadExtension(
      manifest,
      `export default () => { throw new Error("factory boom"); };`,
      host,
      evaluating,
    );
    expect(r).toMatchObject({ ok: false, reason: "load-error" });
    if (!r.ok) expect(r.message).toMatch(/factory boom/);
  });
});
