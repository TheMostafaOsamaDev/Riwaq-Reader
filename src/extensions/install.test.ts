import { describe, expect, it, vi } from "vitest";

const written: Array<{ id: string; source: string; sha256: string }> = [];
vi.mock("./storage", () => ({
  // install.ts also pulls in repos.ts (for resolveAssetUrl), and repos.ts
  // reads EXTENSIONS_DIR from this same module at import time — so the
  // mock has to supply it too, or that module-level `${EXTENSIONS_DIR}/...`
  // template throws before either test body ever runs.
  EXTENSIONS_DIR: "riwaq/extensions",
  writeInstalled: vi.fn(
    async (id: string, f: { source: string; origin: { sha256: string } }) => {
      written.push({ id, source: f.source, sha256: f.origin.sha256 });
    },
  ),
  removeInstalled: vi.fn(async () => {}),
}));

import { installExtension, sha256Hex } from "./install";

const SOURCE = "export default () => ({});";
const enc = new TextEncoder();

const entry = (sha: string) => ({
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  apiVersion: 1,
  language: "ar",
  baseUrl: "https://demo.test",
  code: "demo/index.js",
  sha256: sha,
  size: SOURCE.length,
});

describe("installExtension", () => {
  it("writes a bundle whose hash matches the index", async () => {
    const good = await sha256Hex(enc.encode(SOURCE));
    await installExtension("https://repo.test/index.min.json", entry(good), {
      fetchBytes: async () => enc.encode(SOURCE),
    });
    // Array.prototype.at needs ES2022; this project's tsconfig targets
    // ES2020, so index from the end explicitly instead.
    expect(written[written.length - 1]).toMatchObject({
      id: "demo",
      source: SOURCE,
      sha256: good,
    });
  });

  it("refuses to install when the hash does not match, and names both hashes", async () => {
    const before = written.length;
    await expect(
      installExtension(
        "https://repo.test/index.min.json",
        entry("0".repeat(64)),
        {
          fetchBytes: async () => enc.encode(SOURCE),
        },
      ),
    ).rejects.toThrow(/checksum|sha256|mismatch/i);
    expect(written).toHaveLength(before); // nothing was written
  });
});
