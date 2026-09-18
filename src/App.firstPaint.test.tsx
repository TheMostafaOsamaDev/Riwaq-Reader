// @vitest-environment happy-dom
//
// Task 10 — proves initExtensions() cannot gate App's first paint.
//
// App.tsx kicks off initExtensions() (src/sources/registry.ts) from a
// useEffect: `void initExtensions().finally(() => setExtensionsReady(true))`.
// Nothing awaits it, and `extensionsReady` gates nothing outside the Store
// (see Store.test.tsx for that half). The scar this guards against is the
// Android blank launch documented in main.tsx / bootMigrationDeferral.test.ts
// — gating the mount on an async filesystem call left the screen blank for
// as long as the call took, sometimes forever.
//
// App.tsx pulls in ~30 modules (Tauri IPC, both full reader views, the whole
// Library subtree, several module-scoped stores) that have nothing to do
// with this property and would only make the test brittle and slow. Every
// one of them is stubbed out below. `Library` in particular is replaced with
// a component that does nothing but record the props it was handed — which
// is also how this test observes `extensionsReady` without reaching into
// App's internals.
//
// What this pins: initExtensions() is left permanently UNRESOLVED for the
// whole first test. If App's mount depended on it in any way — an `await`
// slipped into the render path, or a `return null` gated on
// `extensionsReady` — the host would still be empty after `act()` returns.
// It isn't.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── the one dependency this test actually cares about ──────────────────────
let resolveInit: (() => void) | null = null;
const initExtensions = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      resolveInit = resolve;
    }),
);
vi.mock("./sources/registry", () => ({ initExtensions }));

// ── Library stub: records what it was handed, renders a marker ────────────
let lastLibraryProps: Record<string, unknown> | null = null;
vi.mock("./components/library/Library", () => ({
  Library: (props: Record<string, unknown>) => {
    lastLibraryProps = props;
    return <div data-testid="library-stub" />;
  },
}));

// ── everything else App.tsx imports: irrelevant to this property ──────────
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
  convertFileSrc: vi.fn((p: string) => p),
}));
vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => {
    throw new Error("no tauri in tests");
  }),
}));
vi.mock("./components/AnimatedSwap", () => ({
  AnimatedSwap: (props: { children?: unknown }) => props.children,
}));
vi.mock("./lib/diagnostics/breadcrumbs", () => ({
  markBoot: vi.fn(),
  readPreviousLaunch: vi.fn(() => null),
}));
vi.mock("./lib/diagnostics/recorder", () => ({
  record: vi.fn(),
  setVerbose: vi.fn(),
}));
vi.mock("./lib/diagnostics/store", () => ({
  flushSession: vi.fn(() => Promise.resolve()),
  installErrorCapture: vi.fn(() => () => {}),
  startSession: vi.fn(() => Promise.resolve()),
}));
vi.mock("./hooks/useLaunchIntent", () => ({ useLaunchIntent: vi.fn() }));
vi.mock("./hooks/useIncomingFiles", () => ({ useIncomingFiles: vi.fn() }));
vi.mock("./hooks/useFileDrop", () => ({ useFileDrop: vi.fn() }));
vi.mock("./store/dropOverlay", () => ({
  useDropOverlayState: vi.fn(() => ({ kind: "idle" })),
}));
vi.mock("./components/DesktopReader", () => ({ DesktopReader: () => null }));
vi.mock("./components/DropOverlay", () => ({ DropOverlay: () => null }));
vi.mock("./components/ImportProgress", () => ({
  ImportProgress: () => null,
}));
vi.mock("./components/Lightbox", () => ({ Lightbox: () => null }));
vi.mock("./components/MobileReader", () => ({ MobileReader: () => null }));
vi.mock("./components/LazyViewFallback", () => ({
  LazyViewFallback: () => null,
}));
vi.mock("./components/ReaderErrorBoundary", () => ({
  ReaderErrorBoundary: (props: { children?: unknown }) => props.children,
}));
vi.mock("./components/ReaderFallback", () => ({
  ReaderFallback: () => null,
}));
vi.mock("./components/SettingsPage", () => ({ SettingsPage: () => null }));
vi.mock("./reader/fixed/PdfPageSource", () => ({
  createPdfPageSource: vi.fn(),
}));
vi.mock("./reader/fixed/DocxPageSource", () => ({
  createDocxPageSource: vi.fn(),
}));
vi.mock("./store/backgroundTasks", () => ({
  startBackgroundTaskCoordinator: vi.fn(),
}));
vi.mock("./store/downloadNotifier", () => ({
  startDownloadNotifier: vi.fn(),
}));
vi.mock("./store/downloadQueue", () => ({
  loadPersistedQueue: vi.fn(() => Promise.resolve()),
  setDownloadConcurrency: vi.fn(),
  setWifiOnlyDownloads: vi.fn(),
}));
vi.mock("./hooks/useMediaQuery", () => ({
  useMediaQuery: vi.fn(() => false),
}));
vi.mock("./hooks/useTweaks", () => ({
  useTweaks: vi.fn(() => [
    {
      uiLang: "system",
      theme: "sepia",
      startupView: "library",
      verboseDiagnostics: false,
      reduceMotion: "auto",
      maxConcurrentDownloads: 2,
      wifiOnlyDownloads: false,
      uiFont: "readex",
      keepScreenAwake: false,
      confirmDelete: true,
    },
    vi.fn(),
    vi.fn(),
  ]),
}));
vi.mock("./hooks/useWakeLock", () => ({ useWakeLock: vi.fn() }));
vi.mock("./store/lightbox", () => ({
  close: vi.fn(),
  useLightbox: vi.fn(() => ({ src: null })),
}));
vi.mock("./styles/overlayScrollbar", () => ({
  installOverlayScrollbar: vi.fn(() => () => {}),
}));
vi.mock("./hooks/useUpdateCheck", () => ({
  useUpdateCheck: vi.fn(() => ({
    info: null,
    dismiss: vi.fn(),
    check: vi.fn(),
    checking: false,
  })),
}));
vi.mock("./components/UpdateBanner", () => ({ UpdateBanner: () => null }));
vi.mock("./store/library", () => ({
  deleteHighlights: vi.fn(),
  getEntry: vi.fn(),
  listBooks: vi.fn(() => Promise.resolve([])),
  loadBook: vi.fn(),
  loadFixedBook: vi.fn(),
  markBookOpened: vi.fn(),
  saveHighlight: vi.fn(),
  updateHighlightNote: vi.fn(),
  updatePagePosition: vi.fn(),
  updatePageProgress: vi.fn(),
  updateParagraphPosition: vi.fn(),
  updateReadingPosition: vi.fn(),
}));

const { default: App } = await import("./App");

describe("App — extension loading never gates first paint", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // React's own act() check reads this global; without it every render
    // below is an act-environment warning instead of a test.
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    lastLibraryProps = null;
    resolveInit = null;
    initExtensions.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("commits the first frame while initExtensions is still unresolved", () => {
    root = createRoot(host);
    act(() => {
      root.render(<App />);
    });

    // initExtensions() was called (the effect ran) but deliberately never
    // resolved in this test — resolveInit was captured, not invoked. A mount
    // that depended on it would leave `host` empty right here.
    expect(initExtensions).toHaveBeenCalledTimes(1);
    expect(resolveInit).not.toBeNull();
    expect(host.querySelector('[data-testid="library-stub"]')).not.toBeNull();
  });

  it("hands the library extensionsReady=false before init resolves, then true after", async () => {
    root = createRoot(host);
    act(() => {
      root.render(<App />);
    });
    expect(lastLibraryProps?.extensionsReady).toBe(false);

    await act(async () => {
      resolveInit?.();
      // Let the .finally() microtask (and the resulting re-render) flush.
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lastLibraryProps?.extensionsReady).toBe(true);
  });

  it("still shows the app if initExtensions never settles at all", async () => {
    root = createRoot(host);
    act(() => {
      root.render(<App />);
    });

    // Several turns of the microtask queue, never calling resolveInit.
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="library-stub"]')).not.toBeNull();
    expect(lastLibraryProps?.extensionsReady).toBe(false);
  });
});
