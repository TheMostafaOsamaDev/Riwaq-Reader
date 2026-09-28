// @vitest-environment happy-dom
//
// A closed sheet must not cost the page it sits on anything.
//
// The sheet claims an in-flight scroll by calling preventDefault on touchmove,
// which only works from a listener registered with `passive: false`. The
// trouble is where that listener lives: on `document`. A non-passive touchmove
// listener anywhere on the document makes the browser hold EVERY touch scroll
// until the main thread has run it — the compositor cannot start moving the
// page before it knows nobody will cancel the gesture. The phone reader keeps
// its sheet mounted (closed) for the whole reading session, so the listener
// was taxing every swipe in the book, and a swipe that landed while the main
// thread was busy did not move at all until it came free.
//
// Measured on the emulator before the fix: DOMDebugger listed this handler as
// the only non-passive touchmove listener in the reader.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileSheet } from "./MobileSheet";
import { THEMES } from "../styles/tokens";

/** Every touchmove listener on `document` that can block a scroll, i.e. one
 *  registered without `passive: true`, that has not since been removed. */
function blockingTouchMoveListeners(add: Spy, remove: Spy): number {
  const removed = new Set(
    remove.mock.calls
      .filter(([type]) => type === "touchmove")
      .map(([, fn]) => fn),
  );
  return add.mock.calls.filter(
    ([type, fn, opts]) =>
      type === "touchmove" &&
      !(opts as AddEventListenerOptions | undefined)?.passive &&
      !removed.has(fn),
  ).length;
}

/** What the counter needs of a spy on add/removeEventListener. */
type Spy = { mock: { calls: [type: unknown, fn: unknown, opts?: unknown][] } };

describe("MobileSheet's blocking touchmove listener", () => {
  let host: HTMLDivElement;
  let root: Root;
  let add: ReturnType<typeof vi.spyOn>;
  let remove: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    add = vi.spyOn(document, "addEventListener");
    remove = vi.spyOn(document, "removeEventListener");
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  const render = (open: boolean) =>
    act(() => {
      root.render(
        <MobileSheet theme={THEMES.sepia} open={open} onClose={() => {}}>
          <div>contents</div>
        </MobileSheet>,
      );
    });

  it("registers none while the sheet is closed", () => {
    render(false);
    expect(blockingTouchMoveListeners(add, remove)).toBe(0);
  });

  it("registers one while the sheet is open, so a drag can still claim a scroll", () => {
    render(true);
    expect(blockingTouchMoveListeners(add, remove)).toBe(1);
  });
});
