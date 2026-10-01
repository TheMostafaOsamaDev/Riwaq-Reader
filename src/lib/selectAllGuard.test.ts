// @vitest-environment happy-dom
//
// happy-dom implements no select-all command, so these drive the event the
// engine fires instead. That the keyboard, the macOS menu item and a field's
// own select-all really do target the nodes assumed here was measured in a
// real WKWebView, WebKit and Chromium — see selectAllGuard.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSelectAllGuard } from "./selectAllGuard";

/** Fires selectstart at `target` and reports whether it was cancelled. */
function start(target: EventTarget): boolean {
  const e = new Event("selectstart", { bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e.defaultPrevented;
}

describe("select-all guard", () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installSelectAllGuard();
  });
  afterEach(() => {
    uninstall();
    document.body.innerHTML = "";
  });

  it("blocks a select-all of the page, which starts at the root", () => {
    expect(start(document.body)).toBe(true);
    expect(start(document.documentElement)).toBe(true);
  });

  it("leaves a drag, double-click or long-press alone", () => {
    const p = document.body.appendChild(document.createElement("p"));
    p.textContent = "a passage";
    expect(start(p)).toBe(false);
    expect(start(p.firstChild as Text)).toBe(false);
  });

  it("leaves a text field's own select-all alone", () => {
    const input = document.body.appendChild(document.createElement("input"));
    const ta = document.body.appendChild(document.createElement("textarea"));
    expect(start(input)).toBe(false);
    expect(start(ta)).toBe(false);
  });

  it("stops blocking once uninstalled", () => {
    uninstall();
    expect(start(document.body)).toBe(false);
    uninstall = installSelectAllGuard();
  });
});
