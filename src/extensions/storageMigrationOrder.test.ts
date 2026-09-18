// Task 10 fix round 3 — the ACTUAL fix.
//
// Fix round 2 (deferPastPageLoad, kept) deferred initExtensions() past page
// load, same as store/library.ts's migrateLegacyRoot(). That was necessary
// but not sufficient: two INDEPENDENTLY deferred fs-touching call sites are
// two independent rolls against the same native race (the first fs call in
// the process resolves Tauri's plugin scope via a JNI round trip on
// Android, while wry's onPageLoaded dispatch wants the same lock — see
// main.tsx's migrateLegacyRoot comment). Measured on-device: 5/10 stalls,
// worse than the single-call 6/20 baseline — matching 1-(1-0.3)^2.
//
// The fix is SERIALIZING, not deferring twice: every fs-touching export in
// storage.ts now awaits the SAME memoized migrateLegacyRoot() promise
// before its own first fs call (mirroring store/library.ts's ensureRoot()).
// That collapses two independent "first fs call" candidates back into one —
// whichever of migrateLegacyRoot()'s callers reaches it first actually does
// the risky resolve; every other caller (including every storage.ts export)
// just awaits the same already-in-flight-or-settled promise, which is safe
// regardless of timing.
//
// This file proves ORDER, not just "was called at some point" — a wrong
// implementation that called migrateLegacyRoot() from storage.ts but AFTER
// its own exists()/readTextFile() call would satisfy "was called" while
// leaving the hazard completely open, since the risky call would still be
// storage.ts's own fs op, not migrateLegacyRoot()'s.
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
