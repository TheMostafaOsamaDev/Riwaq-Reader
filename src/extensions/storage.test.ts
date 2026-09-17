import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string | Uint8Array>();
const dirs = new Set<string>();

function requireBaseDir(opts?: { baseDir?: unknown }): void {
  if (!opts || opts.baseDir === undefined) {
    throw new Error("missing baseDir");
  }
}

function requireRenameBaseDirs(opts?: {
  oldPathBaseDir?: unknown;
  newPathBaseDir?: unknown;
}): void {
  if (
    !opts ||
    opts.oldPathBaseDir === undefined ||
    opts.newPathBaseDir === undefined
  ) {
    throw new Error("missing baseDir");
  }
}

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: vi.fn(async (p: string, opts?: { baseDir?: unknown }) => {
    requireBaseDir(opts);
    return files.has(p) || dirs.has(p);
  }),
  mkdir: vi.fn(async (p: string, opts?: { baseDir?: unknown }) => {
    requireBaseDir(opts);
    // Mirrors real recursive mkdir / create_dir_all: every ancestor becomes
    // its own directory entry, not just the leaf path.
    const parts = p.split("/");
    for (let i = 1; i <= parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }),
  readDir: vi.fn(async (p: string, opts?: { baseDir?: unknown }) => {
    requireBaseDir(opts);
    return [...dirs]
      .filter(
        (d) => d.startsWith(`${p}/`) && !d.slice(p.length + 1).includes("/"),
      )
      .map((d) => ({ name: d.slice(p.length + 1), isDirectory: true }));
  }),
  readTextFile: vi.fn(async (p: string, opts?: { baseDir?: unknown }) => {
    requireBaseDir(opts);
    if (!files.has(p)) throw new Error(`ENOENT ${p}`);
    return files.get(p) as string;
  }),
  writeTextFile: vi.fn(
    async (p: string, c: string, opts?: { baseDir?: unknown }) => {
      requireBaseDir(opts);
      files.set(p, c);
    },
  ),
  writeFile: vi.fn(
    async (p: string, c: Uint8Array, opts?: { baseDir?: unknown }) => {
      requireBaseDir(opts);
      files.set(p, c);
    },
  ),
  remove: vi.fn(async (p: string, opts?: { baseDir?: unknown }) => {
    requireBaseDir(opts);
    files.delete(p);
    dirs.delete(p);
    for (const k of [...files.keys()])
      if (k.startsWith(`${p}/`)) files.delete(k);
    for (const d of [...dirs]) if (d.startsWith(`${p}/`)) dirs.delete(d);
  }),
  rename: vi.fn(
    async (
      a: string,
      b: string,
      opts?: { oldPathBaseDir?: unknown; newPathBaseDir?: unknown },
    ) => {
      requireRenameBaseDirs(opts);
      for (const k of [...files.keys()]) {
        if (k === a || k.startsWith(`${a}/`)) {
          files.set(k.replace(a, b), files.get(k)!);
          files.delete(k);
        }
      }
      dirs.delete(a);
      dirs.add(b);
    },
  ),
}));

import { rename } from "@tauri-apps/plugin-fs";
import {
  listInstalled,
  readBundleSource,
  removeInstalled,
  writeInstalled,
} from "./storage";

const manifest = {
  id: "demo",
  name: "Demo",
  version: "1.2.0",
  apiVersion: 1,
  language: "ar",
  baseUrl: "https://demo.test",
};
const goodManifest = { ...manifest, id: "good", name: "Good" };
const origin = {
  repoUrl: "https://repo.test/index.min.json",
  sha256: "abc",
  installedAt: "2026-09-17T00:00:00Z",
};

beforeEach(() => {
  files.clear();
  dirs.clear();
  vi.mocked(rename).mockClear();
});

describe("storage", () => {
  it("round-trips an installed extension", async () => {
    await writeInstalled("demo", {
      source: "export default () => 1;",
      manifest,
      origin,
    });

    const installed = await listInstalled();
    expect(installed).toHaveLength(1);
    expect(installed[0].manifest.version).toBe("1.2.0");
    expect(installed[0].origin.repoUrl).toBe(
      "https://repo.test/index.min.json",
    );
    expect(await readBundleSource("demo")).toBe("export default () => 1;");
  });

  it("removes an extension completely", async () => {
    await writeInstalled("demo", { source: "x", manifest, origin });
    await removeInstalled("demo");
    expect(await listInstalled()).toEqual([]);
  });

  it("skips a directory whose manifest is unreadable rather than failing the whole listing", async () => {
    await writeInstalled("good", {
      source: "x",
      manifest: goodManifest,
      origin,
    });
    dirs.add("riwaq/extensions/installed/broken");
    const installed = await listInstalled();
    expect(installed.map((r) => r.manifest.id)).toEqual(["good"]);
  });

  it("throws when the manifest id does not match the install id", async () => {
    await expect(
      writeInstalled("mismatch", { source: "x", manifest, origin }),
    ).rejects.toThrow(/id mismatch/i);
    // Nothing was written on the failed attempt.
    expect(await listInstalled()).toEqual([]);
  });

  it("recovers a stale .old-<id> left by an interrupted upgrade", async () => {
    await writeInstalled("demo", { source: "v1", manifest, origin });

    // Simulate a crash between "move old aside" and "delete old": target is
    // gone, `.old-<id>` holds the pre-upgrade bundle.
    const target = "riwaq/extensions/installed/demo";
    const aside = "riwaq/extensions/installed/.old-demo";
    for (const [k, v] of [...files.entries()]) {
      if (k === target || k.startsWith(`${target}/`)) {
        files.set(k.replace(target, aside), v);
        files.delete(k);
      }
    }
    dirs.delete(target);
    dirs.add(aside);

    // While in that state, the interrupted extension is invisible rather
    // than reported broken — `.old-` is skipped exactly like `.tmp-`.
    expect(await listInstalled()).toEqual([]);

    vi.mocked(rename).mockClear();
    await writeInstalled("demo", { source: "v2", manifest, origin });

    // The recovery rename (old aside back to target) actually ran, before
    // the new bundle's own swap — not just a fresh write landing there by
    // coincidence.
    expect(vi.mocked(rename).mock.calls[0]).toEqual([
      aside,
      target,
      { oldPathBaseDir: 1, newPathBaseDir: 1 },
    ]);
    expect(await readBundleSource("demo")).toBe("v2");
    expect(dirs.has(aside)).toBe(false);
  });

  it("clears a stale .tmp-<id> staging directory before reuse", async () => {
    // Simulate a crash mid-install that left an icon behind in staging.
    const staging = "riwaq/extensions/installed/.tmp-demo";
    dirs.add(staging);
    files.set(`${staging}/icon.png`, new Uint8Array([1, 2, 3]));

    await writeInstalled("demo", { source: "v1", manifest, origin });

    expect(files.has("riwaq/extensions/installed/demo/icon.png")).toBe(false);
  });
});
