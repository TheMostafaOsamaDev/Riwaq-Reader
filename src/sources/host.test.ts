// source_fetch_bytes now returns tauri::ipc::Response, so the bytes arrive
// as an ArrayBuffer rather than the old Vec<u8>-as-JSON-array (number[]).
// `new Uint8Array(buf)` already produces the right bytes for either shape,
// so these assertions passed even before that Rust change — they exist to
// pin that behaviour, not to prove a fix. What they guard against is a
// future "simplification" to `Uint8Array.from(buf)`: that silently returns
// an empty array for the ArrayBuffer case, since `from` treats an
// ArrayBuffer as neither iterable nor array-like.
import { beforeEach, describe, expect, it, vi } from "vitest";

let reply: unknown = null;

/** Every invoke() the host made, in order — so the challenge-retry tests
 *  can assert about ROUTING (which Tauri command ran, and whether the
 *  session webview was reached at all) rather than only about the value
 *  that came back. A retry that never happened and a retry that happened
 *  and returned the same body are indistinguishable from the return value
 *  alone. */
const calls: { cmd: string; args: unknown }[] = [];
/** Per-command replies. A command with no handler falls through to
 *  `reply`, which is what the two fetchBytes tests below use. */
let handlers: Record<string, (args: never) => unknown> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: unknown) => {
    calls.push({ cmd, args });
    const handler = handlers[cmd];
    return handler ? handler(args as never) : reply;
  },
}));

import { createHost } from "./host";

beforeEach(() => {
  calls.length = 0;
  handlers = {};
  reply = null;
  // The retry logs a line on the challenged path; keep it out of the
  // test reporter's output.
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const ok = (text: string) => ({ status: 200, headers: {}, text });
const challenged = {
  status: 403,
  headers: { "cf-mitigated": "challenge" },
  text: "",
};
const cmds = () => calls.map((c) => c.cmd);

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

// ── the Cloudflare challenge retry ─────────────────────────────────────────
//
// This is the code that decides whether an extension's request is rerouted
// through the desktop-only session webview. Getting it wrong is expensive
// in both directions: retry too eagerly and every request on every source
// goes through a webview that does not exist on mobile; retry never and the
// sources it was written to rescue simply fail. challenge.test.ts pins the
// predicate; these pin the wiring of that predicate to the transport.

describe("fetch challenge retry", () => {
  it("returns an unchallenged response directly, without touching the session webview", async () => {
    handlers = { source_fetch: () => ok("<html>real page</html>") };

    const resp = await createHost("cenele").fetch("https://cenele.com/x");

    expect(resp.text).toBe("<html>real page</html>");
    expect(cmds()).toEqual(["source_fetch"]);
    expect(cmds()).not.toContain("source_session_fetch");
  });

  it("retries a challenged response through the session webview and returns its body", async () => {
    handlers = {
      source_fetch: () => challenged,
      source_session_fetch: () => ok("<html>cleared page</html>"),
    };

    const resp = await createHost("cenele").fetch("https://cenele.com/x");

    expect(cmds()).toEqual(["source_fetch", "source_session_fetch"]);
    expect(resp.text).toBe("<html>cleared page</html>");
    expect(resp.status).toBe(200);
  });

  it("forwards the request options to the session retry, not just the URL", async () => {
    // A challenged POST must be replayed as the same POST. Replaying it as
    // a bare GET would silently turn an admin-ajax call into a page load.
    handlers = {
      source_fetch: () => challenged,
      source_session_fetch: () => ok("done"),
    };

    await createHost("cenele").fetch("https://cenele.com/ajax", {
      method: "POST",
      body: "action=x",
      headers: { "x-requested-with": "XMLHttpRequest" },
    });

    expect(calls[1].args).toEqual({
      input: {
        url: "https://cenele.com/ajax",
        method: "POST",
        body: "action=x",
        headers: { "x-requested-with": "XMLHttpRequest" },
      },
    });
  });

  it("explains a failed session retry with the hostname and the original cause", async () => {
    // The mobile path: there is no session webview, so the retry rejects.
    // The extension's parser must not be left reporting a selector
    // regression that did not happen.
    handlers = {
      source_fetch: () => challenged,
      source_session_fetch: () => {
        throw new Error("in-app browser session isn't available on mobile yet");
      },
    };

    await expect(
      createHost("cenele").fetch("https://cenele.com/x"),
    ).rejects.toThrow(
      /cenele\.com is blocking automated access.*in-app browser session isn't available on mobile yet/s,
    );
  });

  it("falls back to the raw URL when the URL is not absolute", async () => {
    // new URL() throws on a relative path. Inside the catch that would
    // replace the plain message above with an opaque one AND discard the
    // original failure — the precise outcome that message exists to avoid.
    handlers = {
      source_fetch: () => challenged,
      source_session_fetch: () => {
        throw new Error("underlying cause");
      },
    };

    await expect(createHost("cenele").fetch("/relative/path")).rejects.toThrow(
      /\/relative\/path is blocking automated access.*underlying cause/s,
    );
  });
});
