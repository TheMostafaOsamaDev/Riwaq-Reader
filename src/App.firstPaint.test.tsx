// @vitest-environment happy-dom
//
// App must commit its first frame before ANY of its startup work settles.
//
// The scar: the Android blank launch. main.tsx withheld ReactDOM.render
// until an async filesystem call settled, and on a cold Android start that
// call could stall indefinitely — the user got the boot background and
// nothing else, no spinner and no timeout. bootGate.test.ts and
// bootMigrationDeferral.test.ts pin main.tsx's half of that contract; this
// file pins App's, which they cannot see because they stub App out.
//
// Deliberately subsystem-AGNOSTIC. The original occurrence was a filesystem
// migration, the next candidate was extension loading, and the one after
// will be something not written yet. So rather than naming a subsystem,
// every async thing App starts on mount is stubbed to a promise that NEVER
// settles — the queue restore, the book listing, the diagnostics session.
// If any of them ever moves into the render path, or gates a `return null`,
// the host below is empty and this goes red.
//
// App pulls in ~30 modules (Tauri IPC, both reader views, the whole Library
// subtree, several module-scoped stores) that have nothing to do with this
// property and would only make the test brittle and slow. Every one of them
// is stubbed out below; `Library` is replaced with a marker component, which
// is how this observes first paint without reaching into App's internals.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A promise that never settles, for every async thing App starts.
const never = () => new Promise<never>(() => {});

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
  flushSession: vi.fn(never),
  installErrorCapture: vi.fn(() => () => {}),
  startSession: vi.fn(never),
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
  loadPersistedQueue: vi.fn(never),
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
  listBooks: vi.fn(never),
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

describe("App — startup work never gates first paint", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // React's own act() check reads this global; without it every render
    // below is an act-environment warning instead of a test.
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    lastLibraryProps = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("commits the first frame with every startup promise still pending", () => {
    root = createRoot(host);
    act(() => {
      root.render(<App />);
    });

    // Nothing has settled and nothing ever will — `never` resolves no one.
    // A mount that depended on any of it would leave `host` empty here.
    expect(host.querySelector('[data-testid="library-stub"]')).not.toBeNull();
    expect(lastLibraryProps).not.toBeNull();
  });

  it("still shows the app after many turns with nothing settling", async () => {
    root = createRoot(host);
    act(() => {
      root.render(<App />);
    });

    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    // Not merely "rendered once, then blanked": a gate introduced in a later
    // effect pass would clear the host on one of these turns.
    expect(host.querySelector('[data-testid="library-stub"]')).not.toBeNull();
  });

  it("survives a startup promise that rejects, and still starts the rest", async () => {
    // The other failure shape: a startup call that fails fast rather than
    // hanging. Found by this file — the queue-restore effect awaited
    // loadPersistedQueue() bare, so a corrupt queue file both raised an
    // unhandled rejection and skipped the two calls after it, leaving the
    // session with no download tray progress and no background task.
    const { loadPersistedQueue } = await import("./store/downloadQueue");
    const { startDownloadNotifier } = await import("./store/downloadNotifier");
    const { startBackgroundTaskCoordinator } = await import(
      "./store/backgroundTasks"
    );
    vi.mocked(loadPersistedQueue).mockImplementationOnce(() =>
      Promise.reject(new Error("queue file corrupt")),
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    root = createRoot(host);
    act(() => {
      root.render(<App />);
    });
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="library-stub"]')).not.toBeNull();
    expect(startDownloadNotifier).toHaveBeenCalled();
    expect(startBackgroundTaskCoordinator).toHaveBeenCalled();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
