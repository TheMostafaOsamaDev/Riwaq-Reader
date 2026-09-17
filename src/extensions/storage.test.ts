import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string | Uint8Array>();
const dirs = new Set<string>();

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: vi.fn(async (p: string) => files.has(p) || dirs.has(p)),
  mkdir: vi.fn(async (p: string) => {
    dirs.add(p);
  }),
  readDir: vi.fn(async (p: string) =>
    [...dirs]
      .filter(
        (d) => d.startsWith(`${p}/`) && !d.slice(p.length + 1).includes("/"),
      )
      .map((d) => ({ name: d.slice(p.length + 1), isDirectory: true })),
  ),
  readTextFile: vi.fn(async (p: string) => {
    if (!files.has(p)) throw new Error(`ENOENT ${p}`);
    return files.get(p) as string;
  }),
  writeTextFile: vi.fn(async (p: string, c: string) => {
    files.set(p, c);
  }),
  writeFile: vi.fn(async (p: string, c: Uint8Array) => {
    files.set(p, c);
  }),
  remove: vi.fn(async (p: string) => {
    files.delete(p);
    dirs.delete(p);
    for (const k of [...files.keys()])
      if (k.startsWith(`${p}/`)) files.delete(k);
    for (const d of [...dirs]) if (d.startsWith(`${p}/`)) dirs.delete(d);
  }),
  rename: vi.fn(async (a: string, b: string) => {
    for (const k of [...files.keys()]) {
      if (k === a || k.startsWith(`${a}/`)) {
        files.set(k.replace(a, b), files.get(k)!);
        files.delete(k);
      }
    }
    dirs.delete(a);
    dirs.add(b);
  }),
}));

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
const origin = {
  repoUrl: "https://repo.test/index.min.json",
  sha256: "abc",
  installedAt: "2026-09-17T00:00:00Z",
};

beforeEach(() => {
  files.clear();
  dirs.clear();
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
    await writeInstalled("good", { source: "x", manifest, origin });
    dirs.add("riwaq/extensions/installed/broken");
    const installed = await listInstalled();
    expect(installed.map((r) => r.manifest.id)).toEqual(["good"]);
  });
});
