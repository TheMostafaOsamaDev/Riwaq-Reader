// @vitest-environment happy-dom
//
// The mechanism behind main.tsx's migrateLegacyRoot deferral — see the big
// comment there for the full deadlock this dodges. That is its only call
// site today; this file pins the timing contract so a second one inherits it
// as a fact rather than imitating it by eye.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferPastPageLoad } from "./deferPastPageLoad";

/** happy-dom reports "complete" by default; a real cold launch does not. */
function setReadyState(value: DocumentReadyState): void {
  Object.defineProperty(document, "readyState", {
    value,
    configurable: true,
  });
}

describe("deferPastPageLoad", () => {
  // Track every `load` listener this test attached, so a leftover one from
  // an earlier test can't fire on a later test's dispatch.
  let bound: EventListenerOrEventListenerObject[] = [];
  const realAdd = window.addEventListener.bind(window);

  beforeEach(() => {
    vi.useFakeTimers();
    bound = [];
    vi.spyOn(window, "addEventListener").mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === "load" && listener) bound.push(listener);
      realAdd(type as keyof WindowEventMap, listener, options);
    }) as typeof window.addEventListener);
  });

  afterEach(() => {
    for (const l of bound) window.removeEventListener("load", l);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not run synchronously even when the document is already complete", () => {
    setReadyState("complete");
    const fn = vi.fn();
    deferPastPageLoad(fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it("runs after a macrotask when the document is already complete", () => {
    setReadyState("complete");
    const fn = vi.fn();
    deferPastPageLoad(fn);
    vi.runAllTimers();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not run while the document is still loading", () => {
    setReadyState("loading");
    const fn = vi.fn();
    deferPastPageLoad(fn);
    vi.runAllTimers();
    expect(fn).not.toHaveBeenCalled();
  });

  it("runs once `load` fires, after a further macrotask — not on the load dispatch itself", () => {
    setReadyState("loading");
    const fn = vi.fn();
    deferPastPageLoad(fn);

    window.dispatchEvent(new Event("load"));
    // The deadlock window this exists to dodge overlaps `load` itself on
    // some launches — the whole point is one more macrotask past it.
    expect(fn).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs exactly once even if `load` fires twice", () => {
    setReadyState("loading");
    const fn = vi.fn();
    deferPastPageLoad(fn);

    window.dispatchEvent(new Event("load"));
    window.dispatchEvent(new Event("load"));
    vi.runAllTimers();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps two independent registrations from interfering with each other", () => {
    setReadyState("loading");
    const a = vi.fn();
    const b = vi.fn();
    deferPastPageLoad(a);
    deferPastPageLoad(b);

    window.dispatchEvent(new Event("load"));
    vi.runAllTimers();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});
