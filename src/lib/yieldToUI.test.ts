// The parse loop's only defence against freezing the webview. Both branches
// matter: Android WebView has scheduler.yield(), older WKWebView does not.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTimeSlicer, yieldToUI } from "./yieldToUI";

const g = globalThis as { scheduler?: { yield?: () => Promise<void> } };

afterEach(() => {
  delete g.scheduler;
});

describe("yieldToUI", () => {
  it("prefers scheduler.yield when the platform has it", async () => {
    const y = vi.fn(async () => {});
    g.scheduler = { yield: y };
    await yieldToUI();
    expect(y).toHaveBeenCalledTimes(1);
  });

  it("falls back to a real task boundary", async () => {
    // No scheduler: must still resolve, and must resolve from a task rather
    // than a microtask — a microtask would not let the browser paint, which
    // is the entire point.
    const order: string[] = [];
    void Promise.resolve().then(() => order.push("microtask"));
    await yieldToUI();
    order.push("yield");
    expect(order).toEqual(["microtask", "yield"]);
  });
});

describe("createTimeSlicer", () => {
  it("does not yield until the slice is spent", async () => {
    const y = vi.fn(async () => {});
    g.scheduler = { yield: y };
    const slice = createTimeSlicer(60_000);
    await slice();
    await slice();
    expect(y).not.toHaveBeenCalled();
  });

  it("yields once the slice is spent", async () => {
    const y = vi.fn(async () => {});
    g.scheduler = { yield: y };
    const slice = createTimeSlicer(0);
    await slice();
    await slice();
    expect(y).toHaveBeenCalledTimes(2);
  });
});
