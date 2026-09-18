import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledRecord } from "../extensions/storage";

// Only one primitive is substituted: Node's ESM loader refuses the `blob:`
// URLs loadModuleFromSource mints (see loadModule.test.ts), so bundles are
// evaluated from an equivalent `data:` URL instead. Everything between the
// registry and that call — loader.ts's apiVersion gate, its failure
// capture, the factory invocation — runs for real.
vi.mock("../extensions/loadModule", async () => {
  const actual = await vi.importActual<
    typeof import("../extensions/loadModule")
  >("../extensions/loadModule");
  return {
    ...actual,
    loadModuleFromSource: (src: string) =>
      import(
        /* @vite-ignore */ `data:text/javascript,${encodeURIComponent(src)}`
      ),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: async () => {
    throw new Error("no tauri in tests");
  },
}));

let installed: InstalledRecord[] = [];
let bundles: Record<string, string> = {};
/** When set, readBundleSource blocks on this until it is released —
 *  letting a test observe the registry WHILE initExtensions() is running
 *  rather than only after it settles. `entered` fires once the loop has
 *  actually reached the first bundle read. */
let bundleGate: { blocked: Promise<void>; entered: () => void } | null = null;
/** When set, listInstalled rejects with it — the one failure arm that sits
 *  outside initExtensions()' per-extension try/catch. */
let listInstalledThrows: Error | null = null;

vi.mock("../extensions/storage", () => ({
  listInstalled: async () => {
    if (listInstalledThrows) throw listInstalledThrows;
    return installed;
  },
  readBundleSource: async (id: string) => {
    if (bundleGate) {
      bundleGate.entered();
      await bundleGate.blocked;
    }
    const src = bundles[id];
    if (src === undefined) throw new Error(`ENOENT: ${id}/index.js`);
    return src;
  },
  iconPath: (id: string) => `riwaq/extensions/installed/${id}/icon.png`,
}));

let repoList: {
  url: string;
  name: string;
  addedAt: string;
  lastFetchedAt?: string;
}[] = [];
let fetchResults: Record<
  string,
  | {
      index: { name: string; apiVersion: number; extensions: [] };
      cached: boolean;
      fetchedAt: string;
    }
  | Error
> = {};
const saved: (typeof repoList)[] = [];
/** When set, saveRepos rejects with it — the bookkeeping write that sits on
 *  loadCatalog's happy path. */
let saveReposThrows: Error | null = null;

vi.mock("../extensions/repos", () => ({
  listRepos: async () => repoList,
  saveRepos: async (r: typeof repoList) => {
    if (saveReposThrows) throw saveReposThrows;
    saved.push(structuredClone(r));
  },
  fetchRepoIndex: async (url: string) => {
    const r = fetchResults[url];
    if (r instanceof Error) throw r;
    if (!r) throw new Error(`no stub for ${url}`);
    return r;
  },
}));

import {
  findSourceForUrl,
  getExtensionError,
  getExtensionStatus,
  getSource,
  getSourceMeta,
  initExtensions,
  isInitialized,
  listSources,
  loadCatalog,
  resolveSourceId,
} from "./registry";

const record = (
  id: string,
  over: Partial<InstalledRecord["manifest"]> = {},
  repoUrl = "https://repo.test/index.min.json",
): InstalledRecord => ({
  manifest: {
    id,
    name: id.toUpperCase(),
    version: "1.0.0",
    apiVersion: 1,
    language: "ar",
    baseUrl: `https://${id}.test`,
    ...over,
  },
  origin: {
    repoUrl,
    sha256: "a".repeat(64),
    installedAt: "2026-01-01T00:00:00Z",
  },
});

/** A bundle whose source only handles its own baseUrl. */
const bundleFor = (id: string) =>
  `export default (host) => ({ canHandle: (u) => u.startsWith("https://${id}.test") });`;

beforeEach(() => {
  installed = [];
  bundles = {};
  repoList = [];
  fetchResults = {};
  saved.length = 0;
  saveReposThrows = null;
  bundleGate = null;
  listInstalledThrows = null;
});

describe("resolveSourceId", () => {
  it("maps the retired kolnovel-pro id onto kolnovel", () => {
    // Library books persist sourceId. kolnovel-pro was merged into kolnovel
    // upstream, so existing books must keep resolving with no data rewrite.
    expect(resolveSourceId("kolnovel-pro")).toBe("kolnovel");
  });

  it("passes through an unknown id unchanged", () => {
    expect(resolveSourceId("cenele")).toBe("cenele");
  });
});

describe("initExtensions", () => {
  it("constructs every installed extension and exposes it", async () => {
    installed = [record("alpha"), record("beta")];
    bundles = { alpha: bundleFor("alpha"), beta: bundleFor("beta") };

    await initExtensions();

    expect(isInitialized()).toBe(true);
    expect(listSources().map((m) => m.id)).toEqual(["alpha", "beta"]);
    expect(getExtensionStatus("alpha")).toBe("ok");
    expect(getSource("alpha")?.canHandle("https://alpha.test/x")).toBe(true);
  });

  it("builds metadata from the manifest, including the icon and origin repo", async () => {
    installed = [
      record(
        "alpha",
        { icon: "icon.png", description: { en: "hi" } },
        "https://r1.test/i.json",
      ),
    ];
    bundles = { alpha: bundleFor("alpha") };

    await initExtensions();

    expect(getSourceMeta("alpha")).toMatchObject({
      id: "alpha",
      name: "ALPHA",
      baseUrl: "https://alpha.test",
      language: "ar",
      version: "1.0.0",
      description: { en: "hi" },
      iconUrl: "asset://localhost/riwaq/extensions/installed/alpha/icon.png",
      installedFrom: "https://r1.test/i.json",
    });
  });

  it("leaves iconUrl undefined when the manifest declares no icon", async () => {
    // A convertFileSrc() of a path that was never written resolves to a URL
    // that 404s, which the UI would render as a broken image rather than
    // falling back to its generated avatar.
    installed = [record("alpha")];
    bundles = { alpha: bundleFor("alpha") };
    await initExtensions();
    expect(getSourceMeta("alpha")?.iconUrl).toBeUndefined();
  });

  it("keeps every other extension working when one bundle throws", async () => {
    installed = [record("alpha"), record("broken"), record("beta")];
    bundles = {
      alpha: bundleFor("alpha"),
      broken: `throw new Error("kaboom");`,
      beta: bundleFor("beta"),
    };

    await initExtensions();

    expect(getExtensionStatus("broken")).toBe("broken");
    expect(getExtensionError("broken")).toMatch(/kaboom/);
    expect(getSource("broken")).toBeNull();
    // The two healthy ones are untouched.
    expect(listSources().map((m) => m.id)).toEqual(["alpha", "beta"]);
    expect(getSource("beta")?.canHandle("https://beta.test/x")).toBe(true);
  });

  it("keeps every other extension working when one bundle cannot be read", async () => {
    // readBundleSource throws OUTSIDE loadExtension, so this is the arm the
    // registry's own try/catch has to cover.
    installed = [record("alpha"), record("gone")];
    bundles = { alpha: bundleFor("alpha") };

    await initExtensions();

    expect(getExtensionStatus("gone")).toBe("broken");
    expect(getExtensionError("gone")).toMatch(/ENOENT/);
    expect(listSources().map((m) => m.id)).toEqual(["alpha"]);
  });

  it("reports an apiVersion mismatch distinctly from a broken bundle", async () => {
    // The Store offers "update Riwaq" for one and "reinstall" for the
    // other, so collapsing them into "broken" misdirects the user.
    installed = [record("future", { apiVersion: 2 })];
    bundles = { future: bundleFor("future") };

    await initExtensions();

    expect(getExtensionStatus("future")).toBe("api-version");
    expect(listSources()).toEqual([]);
  });

  it("reports an id that was never installed as missing", async () => {
    await initExtensions();
    expect(getExtensionStatus("nope")).toBe("missing");
    expect(getSource("nope")).toBeNull();
    expect(getSourceMeta("nope")).toBeNull();
  });

  it("keeps serving the PREVIOUS set while a refresh is still in flight", async () => {
    // The one test that observes the registry mid-refresh. Every other
    // test here awaits initExtensions() to completion, and at completion a
    // build-locally-then-swap and a clear()-then-fill-in-place are
    // indistinguishable — which is exactly why this property needs its own
    // test rather than being inferred from the others.
    //
    // A clear() up front empties the registry for as long as the bundles
    // take to evaluate. Every synchronous accessor answers "nothing
    // installed" during that window, so a Store refresh after an install
    // flashes an empty list.
    installed = [record("alpha"), record("beta")];
    bundles = {
      alpha: bundleFor("alpha"),
      beta: bundleFor("beta"),
      gamma: bundleFor("gamma"),
    };
    await initExtensions();
    expect(listSources().map((m) => m.id)).toEqual(["alpha", "beta"]);

    // Hold the next run open inside its per-extension loop.
    let release!: () => void;
    let entered!: () => void;
    const reached = new Promise<void>((r) => {
      entered = r;
    });
    bundleGate = {
      blocked: new Promise<void>((r) => {
        release = r;
      }),
      entered,
    };

    installed = [record("gamma")];
    const inFlight = initExtensions();
    await reached; // past listInstalled(), inside the loop, not yet finished

    expect(listSources().map((m) => m.id)).toEqual(["alpha", "beta"]);
    expect(getSource("alpha")).not.toBeNull();
    expect(isInitialized()).toBe(true);

    release();
    await inFlight;

    expect(listSources().map((m) => m.id)).toEqual(["gamma"]);
    expect(getSource("alpha")).toBeNull();
  });

  it("does not reject when the extensions directory cannot be read", async () => {
    // initExtensions() is documented as safe to call WITHOUT awaiting, so
    // a rejection would be an unhandled one. listInstalled() sits outside
    // the per-extension try, so it is the arm that can produce it.
    installed = [record("alpha")];
    bundles = { alpha: bundleFor("alpha") };
    await initExtensions();

    listInstalledThrows = new Error("EACCES: permission denied");
    await expect(initExtensions()).resolves.toBeUndefined();

    // …and a transient FS failure must not blank a working registry.
    expect(listSources().map((m) => m.id)).toEqual(["alpha"]);
  });

  it("does not leave a removed extension behind on a re-init", async () => {
    installed = [record("alpha"), record("beta")];
    bundles = { alpha: bundleFor("alpha"), beta: bundleFor("beta") };
    await initExtensions();
    expect(listSources()).toHaveLength(2);

    installed = [record("alpha")];
    await initExtensions();

    expect(listSources().map((m) => m.id)).toEqual(["alpha"]);
    expect(getExtensionStatus("beta")).toBe("missing");
  });
});

describe("findSourceForUrl", () => {
  it("returns the source that claims the URL", async () => {
    installed = [record("alpha"), record("beta")];
    bundles = { alpha: bundleFor("alpha"), beta: bundleFor("beta") };
    await initExtensions();

    expect(findSourceForUrl("https://beta.test/novel/1")).toBe(
      getSource("beta"),
    );
    expect(findSourceForUrl("https://nobody.test/x")).toBeNull();
  });

  it("skips a broken extension instead of throwing on its null source", async () => {
    installed = [record("broken"), record("beta")];
    bundles = {
      broken: `throw new Error("kaboom");`,
      beta: bundleFor("beta"),
    };
    await initExtensions();

    expect(findSourceForUrl("https://beta.test/x")).toBe(getSource("beta"));
  });
});

describe("id aliases", () => {
  it("resolves a library book's retired sourceId through every accessor", async () => {
    installed = [record("kolnovel")];
    bundles = { kolnovel: bundleFor("kolnovel") };
    await initExtensions();

    expect(getSource("kolnovel-pro")).toBe(getSource("kolnovel"));
    expect(getSourceMeta("kolnovel-pro")?.id).toBe("kolnovel");
    expect(getExtensionStatus("kolnovel-pro")).toBe("ok");
  });

  it("does not let the alias table shadow a genuinely installed extension", async () => {
    // A literally-installed id always wins over the alias. Otherwise a repo
    // shipping an extension really named "kolnovel-pro" would be LISTED
    // under that id — listSources reports each entry's own meta.id — while
    // getSource handed back kolnovel's instance instead. The alias is only
    // ever a fallback for orphaned library rows.
    installed = [record("kolnovel"), record("kolnovel-pro")];
    bundles = {
      kolnovel: bundleFor("kolnovel"),
      "kolnovel-pro": bundleFor("kolnovel-pro"),
    };
    await initExtensions();

    expect(getSourceMeta("kolnovel-pro")?.id).toBe("kolnovel-pro");
    expect(getSource("kolnovel-pro")).not.toBe(getSource("kolnovel"));
    expect(
      getSource("kolnovel-pro")?.canHandle("https://kolnovel-pro.test/x"),
    ).toBe(true);
    expect(
      listSources()
        .map((m) => m.id)
        .sort(),
    ).toEqual(["kolnovel", "kolnovel-pro"]);
  });

  it("does not strand a listed extension whose aliased target is absent", async () => {
    // The failure the unconditional alias produced: kolnovel not installed,
    // so "kolnovel-pro" resolved to a missing entry and its own card —
    // status "ok", listed — could not be opened at all.
    installed = [record("kolnovel-pro")];
    bundles = { "kolnovel-pro": bundleFor("kolnovel-pro") };
    await initExtensions();

    expect(getExtensionStatus("kolnovel-pro")).toBe("ok");
    expect(getSourceMeta("kolnovel-pro")).not.toBeNull();
    expect(getSource("kolnovel-pro")).not.toBeNull();
  });
});

describe("loadCatalog", () => {
  const url = "https://repo.test/index.min.json";

  it("stamps lastFetchedAt on a repo it reached", async () => {
    repoList = [{ url, name: "R", addedAt: "2026-01-01T00:00:00Z" }];
    fetchResults[url] = {
      index: { name: "R", apiVersion: 1, extensions: [] },
      cached: false,
      fetchedAt: "2026-09-18T10:00:00Z",
    };

    await loadCatalog();

    expect(saved).toHaveLength(1);
    expect(saved[0][0].lastFetchedAt).toBe("2026-09-18T10:00:00Z");
  });

  it("does not stamp lastFetchedAt when the repo was served from cache", async () => {
    // `cached: true` means the network failed and the last good index was
    // replayed. Stamping then would claim a fetch that never happened and
    // make a permanently unreachable repo look freshly checked.
    repoList = [{ url, name: "R", addedAt: "2026-01-01T00:00:00Z" }];
    fetchResults[url] = {
      index: { name: "R", apiVersion: 1, extensions: [] },
      cached: true,
      fetchedAt: "2026-01-02T00:00:00Z",
    };

    await loadCatalog();

    expect(saved).toEqual([]);
  });

  it("does not write repos.json at all when nothing changed", async () => {
    repoList = [
      {
        url,
        name: "R",
        addedAt: "2026-01-01T00:00:00Z",
        lastFetchedAt: "2026-09-18T10:00:00Z",
      },
    ];
    fetchResults[url] = {
      index: { name: "R", apiVersion: 1, extensions: [] },
      cached: false,
      fetchedAt: "2026-09-18T10:00:00Z",
    };

    await loadCatalog();

    expect(saved).toEqual([]);
  });

  it("still returns the catalog when the lastFetchedAt write fails", async () => {
    // The timestamp is bookkeeping. A disk-write failure must not blank the
    // Extensions manager when every repo actually fetched fine.
    repoList = [{ url, name: "R", addedAt: "2026-01-01T00:00:00Z" }];
    fetchResults[url] = {
      index: { name: "R", apiVersion: 1, extensions: [] },
      cached: false,
      fetchedAt: "2026-09-18T10:00:00Z",
    };
    saveReposThrows = new Error("ENOSPC: no space left on device");

    const out = await loadCatalog();

    expect(out.contents[0].error).toBeUndefined();
    expect(out.catalog).toEqual([]);
    expect(out.repos[0].lastFetchedAt).toBe("2026-09-18T10:00:00Z");
  });

  it("surfaces a repo that could not be reached without failing the whole catalog", async () => {
    const dead = "https://dead.test/i.json";
    repoList = [
      { url, name: "R", addedAt: "2026-01-01T00:00:00Z" },
      { url: dead, name: "D", addedAt: "2026-01-01T00:00:00Z" },
    ];
    fetchResults[url] = {
      index: { name: "R", apiVersion: 1, extensions: [] },
      cached: false,
      fetchedAt: "2026-09-18T10:00:00Z",
    };
    fetchResults[dead] = new Error("offline");

    const out = await loadCatalog();

    expect(out.contents.find((c) => c.repoUrl === dead)?.error).toBe("offline");
    expect(out.contents.find((c) => c.repoUrl === url)?.error).toBeUndefined();
    // The reachable repo is still stamped.
    expect(saved[0][0].lastFetchedAt).toBe("2026-09-18T10:00:00Z");
    expect(saved[0][1].lastFetchedAt).toBeUndefined();
  });
});
