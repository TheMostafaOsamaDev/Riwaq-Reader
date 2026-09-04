// What the one remaining import indicator (the bottom-bar FAB) shows, and
// what tapping it does. Pure so it can be tested without a renderer — the
// component is a thin wrapper over this.
import { describe, expect, it } from "vitest";
import { importIndicator } from "./importIndicator";
import type { ProgressState } from "./importProgress";

function state(patch: Partial<ProgressState> = {}): ProgressState {
  return {
    active: false,
    minimized: false,
    steps: [],
    overall: 0,
    error: null,
    resultBookId: null,
    finishedAt: null,
    ...patch,
  };
}

describe("importIndicator", () => {
  it("is idle and opens the picker when nothing is running", () => {
    expect(importIndicator(state(), false)).toEqual({
      busy: false,
      ratio: null,
      action: "pick",
    });
  });

  it("spins indeterminately while the file dialog is open", () => {
    // The picker is up: the library knows it's importing, but no reporter
    // exists yet, so there is nothing to be determinate about and nothing
    // to open.
    expect(importIndicator(state(), true)).toEqual({
      busy: true,
      ratio: null,
      action: "none",
    });
  });

  it("tracks a reporting device import and offers the details modal", () => {
    expect(
      importIndicator(state({ active: true, minimized: true, overall: 0.4 }), true),
    ).toEqual({ busy: true, ratio: 0.4, action: "details" });
  });

  it("lights up for a source import the library knows nothing about", () => {
    // Store/Sources imports never touch Library's local state — this is the
    // case the deleted dock used to be the only indicator for.
    expect(importIndicator(state({ active: true, overall: 0.7 }), false)).toEqual({
      busy: true,
      ratio: 0.7,
      action: "details",
    });
  });

  it("goes quiet once the run finishes", () => {
    expect(
      importIndicator(state({ active: true, overall: 1, finishedAt: 123 }), false),
    ).toEqual({ busy: false, ratio: null, action: "pick" });
  });

  it("goes quiet on failure — the modal owns the error", () => {
    expect(
      importIndicator(state({ active: true, error: "boom", finishedAt: 123 }), false),
    ).toEqual({ busy: false, ratio: null, action: "pick" });
  });
});
