// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { en } from "../../i18n/en";
import { THEMES } from "../../styles/tokens";
import type { HomeBarStyle } from "../../types/reader";
import {
  HOME_BAR_STYLES,
  homeBarHasImport,
} from "../../reader/chrome/barStyles";
import { HOME_BAR_HEIGHT, MobileBottomNav } from "./MobileBottomNav";
import type { LibraryTab } from "./tabs";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(style: HomeBarStyle, tab: LibraryTab = "all") {
  const fns = {
    onOpenShelves: vi.fn(),
    onSetStore: vi.fn(),
    onOpenQueue: vi.fn(),
    onImport: vi.fn(),
    onOpenSettings: vi.fn(),
    onGoLibrary: vi.fn(),
  };
  act(() =>
    root.render(
      <I18nProvider locale="en">
        <MobileBottomNav
          theme={THEMES.sepia}
          importing={false}
          tab={tab}
          shelvesActive={false}
          style={style}
          {...fns}
        />
      </I18nProvider>,
    ),
  );
  return fns;
}

const named = (name: string) =>
  [...host.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === name || b.textContent?.trim() === name,
  ) ?? null;

describe("the home bar styles", () => {
  it.each(HOME_BAR_STYLES.filter((s) => s !== "classic"))(
    "%s is the classic bar's height, so the update pill still clears it",
    (style) => {
      render(style);
      const bar = host.firstElementChild as HTMLElement;
      expect(bar.style.height).toBe(`${HOME_BAR_HEIGHT}px`);
    },
  );

  it.each(HOME_BAR_STYLES.filter((s) => s !== "classic"))(
    "%s goes to the library, the store, downloads and settings",
    (style) => {
      const fns = render(style, "store");
      act(() => named(en["sidebar.library"])?.click());
      expect(fns.onGoLibrary).toHaveBeenCalledTimes(1);
      act(() => named(en["sidebar.downloads"])?.click());
      expect(fns.onOpenQueue).toHaveBeenCalledTimes(1);
      act(() => named(en["sidebar.settings"])?.click());
      expect(fns.onOpenSettings).toHaveBeenCalledTimes(1);
      // Already on the Store: tapping it again must not toggle back out, the
      // way the classic bar's globe does.
      act(() => named(en["sidebar.store"])?.click());
      expect(fns.onSetStore).not.toHaveBeenCalled();

      const fresh = render(style, "all");
      act(() => named(en["sidebar.store"])?.click());
      expect(fresh.onSetStore).toHaveBeenCalledTimes(1);
    },
  );

  it.each(HOME_BAR_STYLES)("%s carries import only when it should", (style) => {
    const fns = render(style);
    const add = named(en["library.importEpub"]);
    expect(add !== null).toBe(homeBarHasImport(style));
    if (add) {
      act(() => add.click());
      expect(fns.onImport).toHaveBeenCalledTimes(1);
    }
  });

  it("marks the screen you are on", () => {
    render("expanding", "all");
    expect(named(en["sidebar.library"])?.getAttribute("aria-current")).toBe(
      "page",
    );
    expect(host.textContent).toContain(en["sidebar.library"]);
    expect(host.textContent).not.toContain(en["sidebar.store"]);
  });
});
