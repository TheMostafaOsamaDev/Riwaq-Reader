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
import type { ReactElement } from "react";
import { goLibrary, type StorePage, useNav } from "../store/navigation";

let resolveInit: (() => void) | null = null;
const initExtensions = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      resolveInit = resolve;
    }),
);
// Whether a previous visit already loaded the registry (registry.isInitialized).
let alreadyInitialized = false;
vi.mock("../sources/registry", () => ({
  initExtensions,
  isInitialized: () => alreadyInitialized,
}));

// The Store's sub-views are faked. They are siblings of the thing under test
// here, their module graphs reach the registry mock above (which deliberately
// exports only initExtensions), and each fake exposes just the callbacks the
// Store wires into it.
vi.mock("./ExtensionsView", () => ({
  ExtensionsView: () => <div data-testid="extensions-view" />,
}));
vi.mock("./SourcesListView", () => ({
  SourcesListView: ({
    onOpenSource,
  }: {
    onOpenSource: (id: string) => void;
  }) => (
    <button
      type="button"
      data-testid="sources-list-view"
      onClick={() => onOpenSource("s1")}
    />
  ),
}));
// Records which source the instance was MOUNTED for: SourceHomeView keeps
// per-source state (search query, loaded result pages, an in-flight search
// generation), so an instance re-used for another source would show the
// first source's results under the second's id.
vi.mock("./SourceHomeView", async () => {
  const { useState } = await import("react");
  return {
    SourceHomeView: ({
      sourceId,
      onOpenNovel,
      onBack,
    }: {
      sourceId: string;
      onOpenNovel: (url: string) => void;
      onBack: () => void;
    }) => {
      const [mountedFor] = useState(sourceId);
      return (
        <div
          data-testid="source-home"
          data-source={sourceId}
          data-mounted-for={mountedFor}
        >
          <button
            type="button"
            data-testid="open-novel"
            onClick={() => onOpenNovel("/n1")}
          />
          <button type="button" data-testid="source-back" onClick={onBack} />
        </div>
      );
    },
  };
});
vi.mock("./novel/NovelDetailView", () => ({
  NovelDetailView: ({
    novelUrl,
    onBack,
    onOpenRangeDialog,
  }: {
    novelUrl: string;
    onBack: () => void;
    onOpenRangeDialog: () => void;
  }) => (
    <div data-testid="novel-detail" data-novel={novelUrl}>
      <button type="button" data-testid="novel-back" onClick={onBack} />
      <button
        type="button"
        data-testid="open-range"
        onClick={onOpenRangeDialog}
      />
    </div>
  ),
}));
vi.mock("./DownloadRangeDialog", () => ({
  DownloadRangeDialog: ({ open }: { open: boolean }) => (
    <div data-testid="range-dialog" data-open={String(open)} />
  ),
}));

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

  function render(el: ReactElement) {
    root = createRoot(host);
    act(() => {
      root.render(<I18nProvider locale="en">{el}</I18nProvider>);
    });
  }

  /** The Store at a fixed page (none = the sources list). */
  function mount(page?: StorePage) {
    render(
      <Store
        theme={THEMES.light}
        layout="desktop"
        page={page}
        onStreamRead={() => {}}
        onImportComplete={() => {}}
      />,
    );
  }

  /** The Store as the Library renders it: its page comes from history. */
  function HistoryStore() {
    const { snapshot } = useNav();
    const v = snapshot.base.screen === "library" ? snapshot.base.view : null;
    return (
      <Store
        theme={THEMES.light}
        layout="desktop"
        page={v?.kind === "store" ? v.page : undefined}
        onStreamRead={() => {}}
        onImportComplete={() => {}}
      />
    );
  }

  const mountHistory = () => render(<HistoryStore />);

  /** Let initExtensions() resolve. */
  async function ready() {
    await act(async () => {
      resolveInit?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  const q = (id: string) =>
    host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = (id: string) =>
    act(() => {
      q(id)?.click();
    });

  it("calls initExtensions() on mount", () => {
    mount();
    expect(initExtensions).toHaveBeenCalledTimes(1);
  });

  it("does not render SourcesListView while extensions are still loading", () => {
    mount();
    expect(q("sources-list-view")).toBeNull();
  });

  it("shows a skeleton placeholder while extensions are still loading", () => {
    mount();
    expect(host.querySelector(".riwaq-skeleton")).not.toBeNull();
  });

  // A return visit: the registry is already loaded, so the sources draw at
  // once instead of a skeleton — and the re-list still runs behind them.
  it("skips the skeleton when an earlier visit already loaded extensions", () => {
    alreadyInitialized = true;
    try {
      mount();
      expect(host.querySelector(".riwaq-skeleton")).toBeNull();
      expect(q("sources-list-view")).not.toBeNull();
      expect(initExtensions).toHaveBeenCalled();
    } finally {
      alreadyInitialized = false;
    }
  });

  it("renders SourcesListView once extensions resolve", async () => {
    mount();
    await ready();
    expect(q("sources-list-view")).not.toBeNull();
  });

  it("does not render the loading skeleton once extensions resolve", async () => {
    mount();
    await ready();
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

  // The page comes from nav history, so a Store mounted fresh — back from
  // the reader, or sent to the extensions manager from a saved novel's
  // notice — lands on that page, not on the sources list.
  it("renders the page it is given on a fresh mount", async () => {
    mount({ kind: "source", sourceId: "s9" });
    await ready();
    expect(q("source-home")?.dataset.source).toBe("s9");
    expect(q("sources-list-view")).toBeNull();
  });

  it("renders the extensions manager without waiting for extensions", () => {
    mount({ kind: "extensions" });
    expect(q("extensions-view")).not.toBeNull();
  });

  it("walks its pages through history: sources → source → novel and back", async () => {
    act(() => goLibrary({ kind: "store" }));
    mountHistory();
    await ready();
    click("sources-list-view");
    expect(q("source-home")?.dataset.source).toBe("s1");
    click("open-novel");
    expect(q("novel-detail")?.dataset.novel).toBe("/n1");
    click("novel-back");
    expect(q("source-home")?.dataset.source).toBe("s1");
    // The platform Back (Android hardware, mouse button) walks the same way.
    act(() => window.history.back());
    expect(q("sources-list-view")).not.toBeNull();
    act(() => window.history.forward());
    click("source-back");
    expect(q("sources-list-view")).not.toBeNull();
  });

  // Back/Forward between two sources' pages (⌘K → Websites opens one source
  // while another is showing) must not hand the first source's search state
  // to the second.
  it("remounts the source page when history moves to another source", async () => {
    act(() =>
      goLibrary({ kind: "store", page: { kind: "source", sourceId: "a" } }),
    );
    act(() =>
      goLibrary({ kind: "store", page: { kind: "source", sourceId: "b" } }),
    );
    mountHistory();
    await ready();
    expect(q("source-home")?.dataset.mountedFor).toBe("b");
    act(() => window.history.back());
    expect(q("source-home")?.dataset.source).toBe("a");
    expect(q("source-home")?.dataset.mountedFor).toBe("a");
  });

  // A page restored from history (back from the reader, a reload) can be a
  // source's page; resolving that source before the registry has loaded
  // would leave it on "not installed" for good.
  it("holds a restored source page until extensions have loaded", async () => {
    mount({ kind: "source", sourceId: "s1" });
    expect(q("source-home")).toBeNull();
    expect(host.querySelector(".riwaq-skeleton")).not.toBeNull();
    await ready();
    expect(q("source-home")?.dataset.source).toBe("s1");
  });

  it("closes the download-range dialog when Back leaves its novel", async () => {
    act(() =>
      goLibrary({ kind: "store", page: { kind: "source", sourceId: "s1" } }),
    );
    act(() =>
      goLibrary({
        kind: "store",
        page: { kind: "novel", sourceId: "s1", novelUrl: "/n1" },
      }),
    );
    mountHistory();
    await ready();
    click("open-range");
    expect(q("range-dialog")?.dataset.open).toBe("true");
    act(() => window.history.back());
    expect(q("source-home")).not.toBeNull();
    expect(q("range-dialog")?.dataset.open).toBe("false");
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
