// @vitest-environment happy-dom
//
// The update check shipped for five releases without ever working: it was a
// webview fetch() of a GitHub release asset, GitHub sends no CORS headers for
// those, and the blocked response was swallowed as "no update". The unit tests
// passed throughout because they injected a fetch that has no CORS. These run
// the real hook and pin the two things that hid the bug — where the request
// is made, and that a failure is not recorded as a successful check.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TWEAKS } from "./useTweaks";
import type { Tweaks } from "../types/reader";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-os", () => ({ type: () => "macos" }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.5.0" }));

const { useUpdateCheck } = await import("./useUpdateCheck");

type Hook = ReturnType<typeof useUpdateCheck>;
let root: Root;
let host: HTMLElement;
let hook: Hook;
let setTweak: ReturnType<typeof vi.fn>;

function Probe({ t }: { t: Tweaks }) {
  hook = useUpdateCheck(t, setTweak as never);
  return null;
}

async function mount() {
  await act(async () => {
    root.render(
      <Probe t={{ ...DEFAULT_TWEAKS, lastUpdateCheck: undefined }} />,
    );
  });
  // Let the dynamic imports and the invoke promise settle.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  invoke.mockReset();
  setTweak = vi.fn();
  host = document.createElement("div");
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("the update check must not use the webview's fetch");
    }),
  );
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("useUpdateCheck", () => {
  it("asks the Rust side, never the webview's fetch", async () => {
    invoke.mockResolvedValue({ version: "0.6.0" });
    await mount();
    expect(invoke).toHaveBeenCalledWith("check_update_manifest");
    expect(fetch).not.toHaveBeenCalled();
    expect(hook.info).toEqual({
      version: "0.6.0",
      notes: undefined,
      channel: "auto",
    });
    expect(setTweak).toHaveBeenCalledWith(
      "lastUpdateCheck",
      expect.any(Number),
    );
  });

  it("reports a failure, and does not stamp the throttle on one", async () => {
    invoke.mockRejectedValue("HTTP 503");
    await mount();
    expect(hook.result).toEqual({ kind: "failed" });
    expect(hook.info).toBeNull();
    // Stamping here would turn one offline launch into a day of silence.
    expect(setTweak).not.toHaveBeenCalledWith(
      "lastUpdateCheck",
      expect.anything(),
    );
  });

  it("says up to date only when GitHub answered", async () => {
    invoke.mockResolvedValue({ version: "0.5.0" });
    await mount();
    expect(hook.result).toEqual({ kind: "upToDate", current: "0.5.0" });
  });
});
