// source_fetch_bytes used to return Vec<u8>, which Tauri serializes as a
// JSON array — one element per byte, so a 300 KB cover arrived as a
// 300,000-element array to parse. It now returns tauri::ipc::Response and
// the bytes come back as an ArrayBuffer. fetchBytes accepts both, matching
// how @tauri-apps/plugin-fs's own readFile hedges, so a stale command
// binding during development doesn't hand callers a broken Uint8Array.
import { describe, expect, it, vi } from "vitest";

let reply: unknown = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => reply,
}));

import { createHost } from "./host";

describe("fetchBytes", () => {
  it("unwraps an ArrayBuffer reply without copying it through an array", async () => {
    const src = new Uint8Array([137, 80, 78, 71]);
    reply = src.buffer;
    const out = await createHost("kolnovel").fetchBytes("https://x/cover.png");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([137, 80, 78, 71]);
  });

  it("still accepts a number[] reply", async () => {
    reply = [137, 80, 78, 71];
    const out = await createHost("kolnovel").fetchBytes("https://x/cover.png");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([137, 80, 78, 71]);
  });
});
