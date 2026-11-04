// @vitest-environment happy-dom
//
// The library's long-press book menu on a touch screen: the shared bottom
// sheet (MobileSheet), so it drags, springs and closes on Back like every
// other sheet in the app, instead of the old pair of floating cards that did
// none of that. An action runs once the sheet has slid away, as before.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { setReduceMotionOverride } from "../styles/motion";
import { THEMES } from "../styles/tokens";
import { ContextMenu } from "./ContextMenu";

let host: HTMLDivElement;
let root: Root;
let calls: string[];
const handlers = () => ({
  onPickStatus: vi.fn(() => calls.push("status")),
  onEdit: vi.fn(() => calls.push("edit")),
  onDelete: vi.fn(() => calls.push("delete")),
  onClose: vi.fn(() => calls.push("close")),
});

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  // The touch path: ContextMenu falls back to maxTouchPoints when the media
  // query reports a hover-capable pointer.
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 5,
  });
  setReduceMotionOverride("on");
  calls = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setReduceMotionOverride("auto");
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 0,
  });
});

function render(h: ReturnType<typeof handlers>) {
  act(() => {
    root.render(
      <I18nProvider locale="en">
        <ContextMenu
          theme={THEMES.sepia}
          x={10}
          y={10}
          title="A Book"
          author="An Author"
          status="reading"
          {...h}
        />
      </I18nProvider>,
    );
  });
}

const buttonWith = (label: string) =>
  [...document.querySelectorAll<HTMLElement>("button, [role=menuitem]")].find(
    (b) => b.textContent?.includes(label),
  );

describe("ContextMenu on touch", () => {
  it("opens as the shared bottom sheet", () => {
    render(handlers());
    expect(document.querySelector("[data-sheet-box]")).not.toBeNull();
    expect(buttonWith("Cancel")).toBeUndefined();
    expect(document.body.textContent).toContain("A Book");
    expect(buttonWith("Edit book info")).toBeDefined();
  });

  it("Edit runs after the sheet has closed", () => {
    const h = handlers();
    render(h);
    act(() => buttonWith("Edit book info")?.click());
    expect(calls).toEqual(["edit", "close"]);
    expect(h.onEdit).toHaveBeenCalledOnce();
    expect(h.onClose).toHaveBeenCalledOnce();
  });

  it("Back closes it without running an action", () => {
    const h = handlers();
    render(h);
    act(() => window.history.back());
    expect(h.onClose).toHaveBeenCalledOnce();
    expect(h.onEdit).not.toHaveBeenCalled();
    expect(h.onDelete).not.toHaveBeenCalled();
  });

  it("tapping the dimmed library closes it", () => {
    const h = handlers();
    render(h);
    act(() =>
      document.querySelector<HTMLElement>("[data-sheet-scrim]")?.click(),
    );
    expect(h.onClose).toHaveBeenCalledOnce();
    expect(h.onDelete).not.toHaveBeenCalled();
  });
});
