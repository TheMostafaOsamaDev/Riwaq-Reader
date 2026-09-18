// Every fs-touching export in storage.ts awaits the same memoized
// migrateLegacyRoot() promise before its own first fs call. This file proves
// that ORDER, not merely that the call happened at some point.
//
// Why the order matters: storage.ts writes under `riwaq/extensions`, and
// creating that path CREATES the `riwaq/` root. migrateLegacyRoot() moves a
// pre-rename `leaflet/` root across to `riwaq/` only while `riwaq/` does not
// exist yet — so an extensions write that lands first makes the migration
// decline to move, stranding an upgrading user's entire library under
// `leaflet/`. legacyRoot.ts's header states that rule and that consequence;
// store/library.ts's ensureRoot() is the same guard for every store/*
// module. src/extensions/ was the only fs-touching module not following it.
//
// This serialisation is NOT a fix for the Android launch deadlock. It was
// introduced as one, in this task's third fix round; on-device measurement
// then put that mechanism no better than the baseline, and a later round
// established that extensions loading was never the cause at all. The
// deadlock is addressed structurally instead, by initialising extensions
// from the Store's own mount — long after page load — see the header of
// components/Store.tsx. Keep the serialisation for the data-safety reason
// above; do not re-derive a causal claim about launches from it.
//
// An implementation that called migrateLegacyRoot() from storage.ts but
// AFTER its own exists()/mkdir() call would satisfy "was called" while
// leaving the stranding wide open, which is why every test below asserts
// position 0 rather than membership.
import { beforeEach, describe, expect, it, vi } from "vitest";

const order: string[] = [];

vi.mock("../store/legacyRoot", () => ({
  migrateLegacyRoot: vi.fn(async () => {
    order.push("migrateLegacyRoot");
  }),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: vi.fn(async () => {
    order.push("fs:exists");
    return false;
  }),
  mkdir: vi.fn(async () => {
    order.push("fs:mkdir");
  }),
  readDir: vi.fn(async () => {
    order.push("fs:readDir");
    return [];
  }),
  readTextFile: vi.fn(async () => {
    order.push("fs:readTextFile");
    return "{}";
  }),
  writeTextFile: vi.fn(async () => {
    order.push("fs:writeTextFile");
  }),
  writeFile: vi.fn(async () => {
    order.push("fs:writeFile");
  }),
  remove: vi.fn(async () => {
    order.push("fs:remove");
  }),
  rename: vi.fn(async () => {
    order.push("fs:rename");
  }),
}));

import { migrateLegacyRoot } from "../store/legacyRoot";
import {
  listInstalled,
  readBundleSource,
  removeInstalled,
  writeInstalled,
} from "./storage";

const manifest = {
  id: "demo",
  name: "Demo",
  version: "1.0.0",
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
  order.length = 0;
  vi.mocked(migrateLegacyRoot).mockClear();
});

describe("storage.ts — every fs entry point serialises behind migrateLegacyRoot", () => {
  it("listInstalled awaits it before its own first fs call", async () => {
    await listInstalled();
    expect(order[0]).toBe("migrateLegacyRoot");
    expect(order.slice(1)).toContain("fs:exists");
  });

  it("readBundleSource awaits it before its own first fs call", async () => {
    await readBundleSource("demo");
    expect(order[0]).toBe("migrateLegacyRoot");
    expect(order.slice(1)).toContain("fs:readTextFile");
  });

  it("writeInstalled awaits it before its own first fs call", async () => {
    await writeInstalled("demo", { source: "x", manifest, origin });
    expect(order[0]).toBe("migrateLegacyRoot");
    expect(order.slice(1)).toContain("fs:exists");
  });

  it("removeInstalled awaits it before its own first fs call", async () => {
    await removeInstalled("demo");
    expect(order[0]).toBe("migrateLegacyRoot");
    expect(order.slice(1)).toContain("fs:exists");
  });

  it("does not skip the await when the manifest id check fails first", async () => {
    // writeInstalled's id-mismatch guard throws before any fs call — confirm
    // migrateLegacyRoot still ran (it's unconditional, not gated on reaching
    // the fs work), so a later successful call on the same id isn't the one
    // that ends up racing as the "first" fs call instead.
    await expect(
      writeInstalled("demo", {
        source: "x",
        manifest: { ...manifest, id: "other" },
        origin,
      }),
    ).rejects.toThrow(/id mismatch/i);
    expect(order).toEqual(["migrateLegacyRoot"]);
  });
});
