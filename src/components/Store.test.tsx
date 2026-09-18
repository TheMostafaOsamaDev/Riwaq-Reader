// @vitest-environment happy-dom
//
// Task 10 — the Store's own loading gate around extension init.
//
// initExtensions() is kicked off from App.tsx after mount and is never
// awaited before first paint (see App.firstPaint.test.tsx). The Store is
// the ONLY place that watches the resulting `extensionsReady` flag: while
// it's false there is nothing in the registry to show yet, so rendering
// SourcesListView would either show a stale empty registry or (once
// listSources() genuinely reads live data) an incorrect "no sources"
// empty state. A Skeleton placeholder takes its place instead.
//
// No animation on the swap: this codebase has a documented history of
// mount animations that give content an invisible first frame some
// webviews never reveal (see the WebKit mount-animation note), so this
// test also pins that the swap is a plain conditional with no opacity
// transition riding along.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { THEMES } from "../styles/tokens";

vi.mock("./SourcesListView", () => ({
  SourcesListView: () => <div data-testid="sources-list-view" />,
}));
vi.mock("./SourceHomeView", () => ({ SourceHomeView: () => null }));
vi.mock("./novel/NovelDetailView", () => ({ NovelDetailView: () => null }));
vi.mock("./DownloadRangeDialog", () => ({ DownloadRangeDialog: () => null }));

const { Store } = await import("./Store");

describe("Store — extensions-loading gate", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.restoreAllMocks();
  });

  function mount(extensionsReady: boolean) {
    root = createRoot(host);
    act(() => {
      root.render(
        <I18nProvider locale="en">
          <Store
            theme={THEMES.light}
            layout="desktop"
            extensionsReady={extensionsReady}
            onStreamRead={() => {}}
            onImportComplete={() => {}}
          />
        </I18nProvider>,
      );
    });
  }

  it("does not render SourcesListView while extensions are still loading", () => {
    mount(false);
    expect(host.querySelector('[data-testid="sources-list-view"]')).toBeNull();
  });

  it("shows a skeleton placeholder while extensions are still loading", () => {
    mount(false);
    expect(host.querySelector(".riwaq-skeleton")).not.toBeNull();
  });

  it("renders SourcesListView once extensions are ready", () => {
    mount(true);
    expect(
      host.querySelector('[data-testid="sources-list-view"]'),
    ).not.toBeNull();
  });

  it("does not render the loading skeleton once extensions are ready", () => {
    mount(true);
    expect(host.querySelector(".riwaq-skeleton")).toBeNull();
  });

  it("gives the skeleton no opacity/animation transition on the swap", () => {
    // Regression guard for the WebKit mount-animation trap: an entering
    // opacity keyframe that some webviews never fire leaves the content
    // permanently invisible. The loading placeholder must be a plain,
    // already-visible element — not something waiting on a mount animation.
    mount(false);
    const el = host.querySelector(".riwaq-skeleton") as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el?.style.opacity).toBe("");
    expect(el?.style.transition).toBe("");
    expect(el?.style.animationName ?? "").not.toMatch(/enter|fade/i);
  });
});
