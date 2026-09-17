import { resolveObjectURL } from "node:buffer";
import { describe, expect, it } from "vitest";
import { loadModuleFromSource } from "./loadModule";

describe("loadModuleFromSource", () => {
  it("creates the blob with type text/javascript before handing its URL to the importer", async () => {
    let capturedType: string | undefined;
    await loadModuleFromSource("export default 1;", async (url) => {
      capturedType = resolveObjectURL(url)?.type;
      return { default: 1 };
    });
    expect(capturedType).toBe("text/javascript");
  });

  it("revokes the object URL after the importer resolves", async () => {
    let urlSeen = "";
    await loadModuleFromSource("export default 1;", async (url) => {
      urlSeen = url;
      return { default: 1 };
    });
    expect(resolveObjectURL(urlSeen)).toBeUndefined();
  });

  it("revokes the object URL even when the importer throws", async () => {
    let urlSeen = "";
    await expect(
      loadModuleFromSource("export default 1;", async (url) => {
        urlSeen = url;
        throw new Error("importer boom");
      }),
    ).rejects.toThrow("importer boom");
    expect(resolveObjectURL(urlSeen)).toBeUndefined();
  });

  it("returns exactly what the importer resolves to", async () => {
    const namespace = { default: () => "hi", extra: 42 };
    const result = await loadModuleFromSource(
      "export default 1;",
      async () => namespace,
    );
    expect(result).toBe(namespace);
  });

  // The real path — a genuine dynamic import() of a blob: URL, no injected
  // importer — cannot run under Vitest. Node's own ESM loader refuses the
  // `blob:` scheme outright ("Only URLs with a scheme in: file, data, and
  // node are supported by the default ESM loader", ERR_UNSUPPORTED_ESM_URL_
  // SCHEME on Node v22.23.2). This is independent of Vitest's configured
  // test environment: it fails identically under the default "node"
  // environment and under "happy-dom", because happy-dom only shims
  // `window`/`document` — the module loader that actually executes
  // `import()` is still Node's either way. There's no supported workaround
  // either: a custom Node loader hook (`node:module`'s `register()`) runs
  // its resolve/load callbacks on a separate thread with no visibility into
  // the main thread's blob registry, so it can't bridge this.
  //
  // Real browser engines do support it — that's the whole premise of this
  // module — so it's verified on-device instead: see task-1-report.md for
  // the macOS WKWebView and Android WebView runs.
  it.skip("gives each call backed by a real blob URL its own module instance", async () => {
    const src = `let n = 0; export default () => ++n;`;
    const a = (await loadModuleFromSource(src)) as { default: () => number };
    const b = (await loadModuleFromSource(src)) as { default: () => number };
    expect(a.default()).toBe(1);
    expect(b.default()).toBe(1); // not 2 — separate module registries
  });
});
