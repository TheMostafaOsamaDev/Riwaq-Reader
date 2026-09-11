// The import path writes the cover, then used to read the very same file
// back to derive its thumbnail — a full image out over IPC and straight
// back in. writeCoverThumbFromBytes takes the bytes the caller already
// holds, so nothing touches the filesystem on the read side.
//
// happy-dom has no createImageBitmap/OffscreenCanvas, so encodeThumb
// returns null here and no thumbnail is written. That is fine: what this
// test pins is that the READ never happens, which is true either way.
import { describe, expect, it, vi } from "vitest";

let readFileCalls = 0;

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async () => true,
  readFile: async () => {
    readFileCalls++;
    return new Uint8Array([1, 2, 3]);
  },
  writeFile: async () => {},
}));

import { writeCoverThumbFromBytes } from "./coverThumb";

describe("writeCoverThumbFromBytes", () => {
  it("never reads the cover back off disk", async () => {
    readFileCalls = 0;
    await writeCoverThumbFromBytes("book-1", new Uint8Array([1, 2, 3]));
    expect(readFileCalls).toBe(0);
  });

  it("returns null rather than throwing when the environment can't encode", async () => {
    // A missing thumbnail is a slow cover, not a failed import — callers
    // fall back to the original and must never see an exception.
    await expect(
      writeCoverThumbFromBytes("book-1", new Uint8Array([1, 2, 3])),
    ).resolves.toBeNull();
  });
});
