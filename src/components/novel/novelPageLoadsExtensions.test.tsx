// @vitest-environment happy-dom
//
// The novel page must load the source registry itself.
//
// DesktopLibrary and MobileLibrary render the novel page and the Store as
// two arms of ONE ternary, so a library-backed novel page is on screen only
// when the Store has never mounted — and initExtensions() used to be called
// from nowhere but the Store's mount. The registry was therefore empty for
// the whole of any session that went library card → novel page, and the
// page told the user a correctly installed extension "isn't installed"
// while disabling every download on it.
//
// So this test mounts the page with NOTHING else mounted, and with the real
// sources/registry behind it — only the disk (extensions/storage) and the
// bundle evaluation (extensions/loader) are substituted. A mocked registry
// would assume away the exact thing under test.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceSnapshot } from "../../store/sourceLibrary";

// ── what the disk holds ─────────────────────────────────────────────────
/** Swapped per test: one installed extension, or none at all. */
let installedIds: string[] = ["seanovel"];

vi.mock("../../extensions/storage", () => ({
  listInstalled: async () =>
    installedIds.map((id) => ({
      manifest: {
        id,
        name: "SeaNovel",
        version: "1.0.0",
        apiVersion: 1,
        language: "en",
        baseUrl: "https://seanovel.test",
      },
      origin: {
        repoUrl: "https://repo.test/index.min.json",
        sha256: "a".repeat(64),
        installedAt: "2026-01-01T00:00:00.000Z",
      },
    })),
  readBundleSource: async () => "export default () => ({});",
  iconPath: (id: string) => `riwaq/extensions/installed/${id}/icon.png`,
}));

// The bundle's own evaluation is loadModule.test.ts's and loader.test.ts's
// subject, not this file's: here it only has to succeed.
vi.mock("../../extensions/loader", () => ({
  loadExtension: async () => ({
    ok: true,
    source: {
      id: "seanovel",
      canHandle: () => true,
      // The page refreshes from the source in the background once it has
      // rendered the snapshot. It has to succeed, or the refresh failure
      // would be what this file was measuring.
      getNovel: async () => ({
        title: "A Saved Novel",
        author: "A. Writer",
        language: "en",
        direction: "ltr" as const,
        tags: [],
        meta: [],
        volumes: [],
      }),
    },
  }),
}));

vi.mock("../../sources/host", () => ({ createHost: () => ({}) }));
vi.mock("../../extensions/repos", () => ({
  listRepos: async () => [],
  saveRepos: async () => {},
  fetchRepoIndex: async () => {
    throw new Error("no repo in this test");
  },
}));

// ── the snapshot the page renders from ──────────────────────────────────
const DOWNLOADED_AT = 1_700_000_000_000;
const storedSnapshot: SourceSnapshot = {
  version: 1,
  sourceId: "seanovel",
  novelUrl: "https://seanovel.test/novel/1",
  title: "A Saved Novel",
  author: "A. Writer",
  language: "en",
  direction: "ltr",
  description: "Saved while the extension was installed.",
  tags: [],
  status: "Ongoing",
  meta: [],
  volumes: [
    {
      id: 1,
      title: "Volume One",
      chapterCount: 2,
      chaptersLoaded: true,
      chapters: [
        {
          id: 1,
          title: "Chapter One",
          url: "https://seanovel.test/c/1",
          downloadedAt: DOWNLOADED_AT,
        },
        { id: 2, title: "Chapter Two", url: "https://seanovel.test/c/2" },
      ],
    },
  ],
  fetchedAt: DOWNLOADED_AT,
};

vi.mock("../../store/library", () => ({
  addNovelToLibrary: vi.fn(),
  coverSrcFor: async () => null,
  deleteBook: vi.fn(),
  findSourceEntry: async () => null,
  getEntry: async () => ({ id: "entry-1" }),
}));

vi.mock("../../store/sourceLibrary", async () => {
  const actual = await vi.importActual<
    typeof import("../../store/sourceLibrary")
  >("../../store/sourceLibrary");
  return {
    ...actual,
    readSnapshot: async () => storedSnapshot,
    setVolumeChapters: async () => null,
    writeSnapshotFromSourceNovel: async () => storedSnapshot,
  };
});

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 13 },
  exists: async () => false,
  mkdir: async () => {},
  readTextFile: async () => "",
  writeTextFile: async () => {},
  writeFile: async () => {},
  remove: async () => {},
  readDir: async () => [],
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/appdata",
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
  invoke: async () => {
    throw new Error("no tauri in tests");
  },
}));

vi.mock("../../store/downloadQueue", () => ({
  enqueue: vi.fn(),
  enqueueLibraryAdd: vi.fn(),
  cancel: vi.fn(),
  cancelJobsForChapters: async () => [],
  activeChapterSet: () => new Map(),
  getState: () => ({ jobs: [] }),
  subscribe: () => () => {},
}));

// ── harness ─────────────────────────────────────────────────────────────
// The registry is module-level state that is populated ONCE, which is the
// whole point of it — so every case here takes a fresh module graph rather
// than inheriting the previous case's loaded registry. That is also what
// makes the negative control below mean anything: without the reset it
// would be asserting against the extension the previous test installed, and
// would pass or fail on file order.
//
// The i18n provider is re-imported alongside the view for the same reason:
// after vi.resetModules() a statically-imported provider would be a
// different module instance from the one the view reads its context from.
let NovelDetailView: any;
let I18nProvider: any;
let THEMES: any;

let host: HTMLDivElement;
let root: Root;

async function mount() {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <NovelDetailView
          theme={THEMES.light}
          layout="desktop"
          sourceId="seanovel"
          novelUrl="https://seanovel.test/novel/1"
          libraryEntryId="entry-1"
          onBack={() => {}}
          onStreamRead={() => {}}
          onImportComplete={() => {}}
          onOpenRangeDialog={() => {}}
        />
      </I18nProvider>,
    );
  });
  // Long enough for the registry load (listInstalled → evaluate → commit)
  // AND the page's own snapshot read to settle and re-render. A macrotask
  // between passes because the registry commit lands in a listener, whose
  // re-render then restarts the page's snapshot effect.
  for (let pass = 0; pass < 4; pass++) {
    await act(async () => {
      for (let i = 0; i < 16; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** The undownloaded chapter's trailing download button. */
function downloadButton(): HTMLButtonElement {
  const rows = [...host.querySelectorAll('[role="listitem"]')];
  const buttons = [...rows[1].querySelectorAll("button")];
  const button = (buttons as HTMLButtonElement[]).find((b) =>
    (b.getAttribute("aria-label") ?? "").startsWith("Download chapter"),
  );
  if (!button) throw new Error("row has no download button");
  return button;
}

beforeEach(async () => {
  vi.resetModules();
  ({ NovelDetailView } = await import("./NovelDetailView"));
  ({ I18nProvider } = await import("../../i18n/I18nProvider"));
  ({ THEMES } = await import("../../styles/tokens"));
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  installedIds = ["seanovel"];
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a novel page mounted without the Store ever mounting", () => {
  it("does not claim an installed extension isn't installed", async () => {
    await mount();
    // Asserted against the literal English sentence rather than tr(), so a
    // key that agrees with itself cannot pass this.
    expect(host.textContent ?? "").not.toContain(
      "The “SeaNovel” extension isn't installed",
    );
    expect(host.textContent ?? "").not.toContain("extension isn't installed");
  });

  it("offers the download the empty registry used to refuse", async () => {
    await mount();
    expect(downloadButton().disabled).toBe(false);
  });

  it("still says so when the extension really is not installed", async () => {
    // The negative control. Without it the two cases above pass for a page
    // that never shows the banner and never disables anything.
    installedIds = [];
    await mount();
    expect(host.textContent ?? "").toContain(
      "The “seanovel” extension isn't installed",
    );
    expect(downloadButton().disabled).toBe(true);
  });
});
