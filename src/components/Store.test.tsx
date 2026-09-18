// @vitest-environment happy-dom
//
// Task 10 (fix round 4) — the Store now initialises extensions itself, on
// its own mount, rather than App.tsx threading an `extensionsReady` prop
// down from a startup effect. See the comment at the top of Store.tsx for
// why: three separate attempts at starting this during app startup each
// independently reproduced a real native deadlock on live-device testing.
//
// This file covers the React-level contract only — that a mount calls
// initExtensions(), that the Skeleton gates the sources list until it
// resolves, and that a fresh mount re-initialises (since AnimatedSwap
// genuinely unmounts the Store when the user leaves the tab, confirmed by a
// throwaway spike test before this design was built on top of it). The
// on-device claim (this closes the deadlock because the Store is reached
// long after page load) is NOT testable here — no simulated DOM reaches
// native code — and is verified separately via repeated cold starts on a
// bundled APK.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { THEMES } from "../styles/tokens";

let resolveInit: (() => void) | null = null;
const initExtensions = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      resolveInit = resolve;
    }),
);
vi.mock("../sources/registry", () => ({ initExtensions }));

vi.mock("./SourcesListView", () => ({
  SourcesListView: () => <div data-testid="sources-list-view" />,
}));
vi.mock("./SourceHomeView", () => ({ SourceHomeView: () => null }));
vi.mock("./novel/NovelDetailView", () => ({ NovelDetailView: () => null }));
vi.mock("./DownloadRangeDialog", () => ({ DownloadRangeDialog: () => null }));

const { Store } = await import("./Store");

describe("Store — initialises its own extensions on mount", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    resolveInit = null;
    initExtensions.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.restoreAllMocks();
  });

  function mount() {
    root = createRoot(host);
    act(() => {
      root.render(
        <I18nProvider locale="en">
          <Store
            theme={THEMES.light}
            layout="desktop"
            onStreamRead={() => {}}
            onImportComplete={() => {}}
          />
        </I18nProvider>,
      );
    });
  }

  it("calls initExtensions() on mount", () => {
    mount();
    expect(initExtensions).toHaveBeenCalledTimes(1);
  });

  it("does not render SourcesListView while extensions are still loading", () => {
    mount();
    expect(host.querySelector('[data-testid="sources-list-view"]')).toBeNull();
  });

  it("shows a skeleton placeholder while extensions are still loading", () => {
    mount();
    expect(host.querySelector(".riwaq-skeleton")).not.toBeNull();
  });

  it("renders SourcesListView once extensions resolve", async () => {
    mount();
    await act(async () => {
      resolveInit?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      host.querySelector('[data-testid="sources-list-view"]'),
    ).not.toBeNull();
  });

  it("does not render the loading skeleton once extensions resolve", async () => {
    mount();
    await act(async () => {
      resolveInit?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.querySelector(".riwaq-skeleton")).toBeNull();
  });

  it("still shows the app if initExtensions never settles at all", async () => {
    mount();
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(host.querySelector(".riwaq-skeleton")).not.toBeNull();
  });

  it("re-initialises on a fresh mount rather than reusing stale state", () => {
    // Mirrors what AnimatedSwap actually does when the user leaves and
    // re-opens the Store tab: unmount, then a genuinely new instance.
    mount();
    expect(initExtensions).toHaveBeenCalledTimes(1);
    act(() => {
      root.unmount();
    });
    mount();
    expect(initExtensions).toHaveBeenCalledTimes(2);
  });

  it("gives the skeleton no opacity/animation transition on the swap", () => {
    // Regression guard for the WebKit mount-animation trap: an entering
    // opacity keyframe that some webviews never fire leaves the content
    // permanently invisible. The loading placeholder must be a plain,
    // already-visible element — not something waiting on a mount animation.
    mount();
    const el = host.querySelector(".riwaq-skeleton") as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el?.style.opacity).toBe("");
    expect(el?.style.transition).toBe("");
    expect(el?.style.animationName ?? "").not.toMatch(/enter|fade/i);
  });
});
