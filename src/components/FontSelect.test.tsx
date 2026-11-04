// @vitest-environment happy-dom
//
// The reader's font picker inside the phone's settings sheet. Two complaints
// shaped these cases: reaching the end of the font list carried on and
// scrolled the settings panel behind it, and a list opened near the bottom
// of the sheet ran off the screen.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { THEMES } from "../styles/tokens";
import { FontSelect } from "./FontSelect";
import { type SheetApi, SheetContext } from "./sheet/SheetContext";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

function render(sheet: SheetApi | null = null) {
  act(() => {
    root.render(
      <I18nProvider locale="en">
        <SheetContext.Provider value={sheet}>
          <FontSelect theme={THEMES.sepia} value="serif" onChange={() => {}} />
        </SheetContext.Provider>
      </I18nProvider>,
    );
  });
}

const trigger = () =>
  host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
const listbox = () => host.querySelector('[role="listbox"]');

describe("FontSelect", () => {
  it("its list stops at its ends instead of scrolling what's behind it", () => {
    render();
    act(() => trigger()?.click());
    const scroller = host.querySelector<HTMLElement>(
      "[data-no-overlay-scrollbar]",
    );
    expect(scroller?.style.overscrollBehaviorY).toBe("contain");
  });

  it("asks the enclosing sheet to reveal it when it opens", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((f) => {
      f(0);
      return 1;
    });
    const reveal = vi.fn();
    render({ reveal, footerSlot: null });
    act(() => trigger()?.click());
    expect(reveal).toHaveBeenCalledOnce();
    const el = reveal.mock.calls[0][0] as HTMLElement;
    expect(el.contains(listbox())).toBe(true);
  });

  it("Esc closes the list and claims the key, so the sheet stays open", () => {
    render();
    act(() => trigger()?.click());
    expect(listbox()).not.toBeNull();
    const ev = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      document.dispatchEvent(ev);
    });
    expect(listbox()).toBeNull();
    expect(ev.defaultPrevented).toBe(true);
  });
});
