// source_fetch_bytes now returns tauri::ipc::Response, so the bytes arrive
// as an ArrayBuffer rather than the old Vec<u8>-as-JSON-array (number[]).
// `new Uint8Array(buf)` already produces the right bytes for either shape,
// so these assertions passed even before that Rust change — they exist to
// pin that behaviour, not to prove a fix. What they guard against is a
// future "simplification" to `Uint8Array.from(buf)`: that silently returns
// an empty array for the ArrayBuffer case, since `from` treats an
// ArrayBuffer as neither iterable nor array-like.
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
