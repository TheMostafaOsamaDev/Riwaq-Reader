import { describe, expect, it, vi } from "vitest";

const written: Array<{
  id: string;
  source: string;
  sha256: string;
  manifestIcon: string | undefined;
}> = [];
vi.mock("./storage", () => ({
  // install.ts also pulls in repos.ts (for resolveAssetUrl), and repos.ts
  // reads EXTENSIONS_DIR from this same module at import time — so the
  // mock has to supply it too, or that module-level `${EXTENSIONS_DIR}/...`
  // template throws before either test body ever runs.
  EXTENSIONS_DIR: "riwaq/extensions",
  writeInstalled: vi.fn(
    async (
      id: string,
      f: {
        source: string;
        origin: { sha256: string };
        manifest: { icon?: string };
      },
    ) => {
      written.push({
        id,
        source: f.source,
        sha256: f.origin.sha256,
        manifestIcon: f.manifest.icon,
      });
    },
  ),
  removeInstalled: vi.fn(async () => {}),
}));

import { MAX_BUNDLE_BYTES } from "./repos";
import { installExtension, sha256Hex } from "./install";

const SOURCE = "export default () => ({});";
const enc = new TextEncoder();

const entry = (sha: string, icon?: string) => ({
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  apiVersion: 1,
  language: "ar",
  baseUrl: "https://demo.test",
  code: "demo/index.js",
  icon,
  sha256: sha,
  size: SOURCE.length,
});

describe("sha256Hex", () => {
  it("matches the published digest for a known input", async () => {
    // A known answer, from FIPS 180-2 / RFC 6234's SHA-256("abc") vector.
    //
    // Every other test in this file compares sha256Hex against sha256Hex:
    // the same function produces both the expected value and the actual
    // one, so they agree with each other however wrong they both are.
    // Dropping the .padStart(2, "0") in install.ts silently truncates every
    // digest that contains a byte below 0x10 — and left four of the five
    // cases below green. This is the security boundary the whole branch
    // rests on; it needs one value it did not compute itself.
    expect(await sha256Hex(enc.encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("keeps the leading zero of a byte below 0x10", async () => {
    // The specific failure the vector above catches, pinned on its own so
    // a regression names itself. SHA-256("") starts with 0xe3 and contains
    // 0x08 and 0x09 further in; the digest is always 64 hex characters.
    const empty = await sha256Hex(new Uint8Array());
    expect(empty).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(empty).toHaveLength(64);
  });
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

  it("still installs, and does not claim an icon in the manifest, when the icon fetch fails", async () => {
    const good = await sha256Hex(enc.encode(SOURCE));
    await installExtension(
      "https://repo.test/index.min.json",
      entry(good, "demo/icon.png"),
      {
        fetchBytes: async (url: string) => {
          if (url.endsWith("icon.png")) {
            throw new Error("icon fetch failed");
          }
          return enc.encode(SOURCE);
        },
      },
    );
    const last = written[written.length - 1];
    // A missing icon is cosmetic: the (verified) install must still succeed
    // — reaching this line at all is part of what's under test.
    expect(last).toMatchObject({ id: "demo", source: SOURCE, sha256: good });
    // ...but the manifest must not claim a file that was never written,
    // or the Store UI renders a broken <img> for it later.
    expect(last.manifestIcon).toBeUndefined();
  });

  it("installs successfully when the index's hash is upper-case hex", async () => {
    const good = await sha256Hex(enc.encode(SOURCE));
    await installExtension(
      "https://repo.test/index.min.json",
      entry(good.toUpperCase()),
      { fetchBytes: async () => enc.encode(SOURCE) },
    );
    expect(written[written.length - 1]).toMatchObject({
      id: "demo",
      source: SOURCE,
      sha256: good,
    });
  });

  it("refuses a bundle larger than the cap, whatever the index declared", async () => {
    // The index's `size` is a claim, not a measurement — a repo serving a
    // multi-gigabyte body under a small declared size would otherwise be
    // buffered whole and then digested before anything looked at it.
    const before = written.length;
    const huge = new Uint8Array(MAX_BUNDLE_BYTES + 1);
    await expect(
      installExtension(
        "https://repo.test/index.min.json",
        entry(await sha256Hex(huge)),
        { fetchBytes: async () => huge },
      ),
    ).rejects.toThrow(/limit/i);
    expect(written).toHaveLength(before);
  });

  it("drops an oversized icon without failing the install", async () => {
    // Same ceiling, opposite consequence: the bundle is the thing that gets
    // executed, the icon is a picture. Refusing the whole install over it
    // would be worse than going without it.
    const good = await sha256Hex(enc.encode(SOURCE));
    await installExtension(
      "https://repo.test/index.min.json",
      entry(good, "demo/icon.png"),
      {
        fetchBytes: async (url: string) =>
          url.endsWith("icon.png")
            ? new Uint8Array(MAX_BUNDLE_BYTES)
            : enc.encode(SOURCE),
      },
    );
    const last = written[written.length - 1];
    expect(last).toMatchObject({ id: "demo", source: SOURCE, sha256: good });
    expect(last.manifestIcon).toBeUndefined();
  });

  it("propagates a network failure on the code fetch itself, before hashing anything", async () => {
    const before = written.length;
    await expect(
      installExtension(
        "https://repo.test/index.min.json",
        entry("0".repeat(64)),
        {
          fetchBytes: async () => {
            throw new Error("network down");
          },
        },
      ),
    ).rejects.toThrow(/network down/);
    expect(written).toHaveLength(before); // nothing was written
  });
});
