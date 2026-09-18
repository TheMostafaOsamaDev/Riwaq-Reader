// @vitest-environment happy-dom
//
// A saved novel whose source extension is no longer usable.
//
// Behaviour, not markup: what the page still SHOWS (every chapter, the
// saved metadata), what it still DOES (open a downloaded chapter, remove
// the book), and what it refuses with a reason attached (download a
// chapter, download a volume, download a range, open a chapter that was
// never downloaded). The banner is asserted against literal English
// sentences typed here — never against tr() — so a wrong key can't agree
// with itself.
//
// The registry is mocked because "the extension is gone" is precisely a
// registry answer; sourceLibrary keeps its REAL snapshotToSourceNovel, so
// the shape the page renders is the one the store actually produces rather
// than one this file invented.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { SourceSnapshot } from "../../store/sourceLibrary";
import { THEMES } from "../../styles/tokens";

// ── the snapshot on disk ────────────────────────────────────────────────
// Chapter 1 downloaded, chapter 2 not, chapter 3 downloaded and read.
const DOWNLOADED_AT = 1_700_000_000_000;
function snapshot(): SourceSnapshot {
  return {
    version: 1,
    sourceId: "seanovel",
    novelUrl: "https://seanovel.test/novel/1",
    title: "A Saved Novel",
    author: "A. Writer",
    language: "en",
    direction: "ltr",
    description: "Saved when the extension still worked.",
    tags: ["fantasy"],
    status: "Ongoing",
    meta: [{ label: "Type", value: "Web Novel" }],
    volumes: [
      {
        id: 1,
        title: "Volume One",
        chapterCount: 3,
        chaptersLoaded: true,
        chapters: [
          {
            id: 1,
            title: "Chapter One",
            url: "https://seanovel.test/c/1",
            downloadedAt: DOWNLOADED_AT,
          },
          { id: 2, title: "Chapter Two", url: "https://seanovel.test/c/2" },
          {
            id: 3,
            title: "Chapter Three",
            url: "https://seanovel.test/c/3",
            downloadedAt: DOWNLOADED_AT,
            readAt: DOWNLOADED_AT,
          },
        ],
      },
    ],
    fetchedAt: DOWNLOADED_AT,
  };
}

// ── mocks ───────────────────────────────────────────────────────────────
let extensionStatus: "ok" | "missing" | "broken" | "api-version" = "missing";
let extensionError: string | undefined;
let storedSnapshot: SourceSnapshot | null = null;
// Null is the premise of nearly every case here — but not of all of them:
// one test installs a working source to prove the gates are a response to
// the registry rather than something this page always does.
let installedSource: unknown = null;

vi.mock("../../sources/registry", () => ({
  getSource: () => installedSource,
  // A removed extension leaves no manifest, so no display name either.
  getSourceMeta: () => null,
  getExtensionStatus: () => extensionStatus,
  getExtensionError: () => extensionError,
}));

const deleteBook = vi.fn(async (_id: string) => {});
vi.mock("../../store/library", () => ({
  addNovelToLibrary: vi.fn(),
  coverSrcFor: async () => null,
  deleteBook: (id: string) => deleteBook(id),
  findSourceEntry: async () => null,
  getEntry: async () => ({ id: "entry-1" }),
}));

vi.mock("../../store/sourceLibrary", async () => {
  // The real converter — this test is about what the saved shape renders
  // as, and a hand-rolled stand-in would prove nothing about that.
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

// sourceLibrary's real module reaches the Tauri fs plugin at import time.
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
}));

const enqueue = vi.fn();
vi.mock("../../store/downloadQueue", () => ({
  enqueue,
  enqueueLibraryAdd: vi.fn(),
  cancel: vi.fn(),
  cancelJobsForChapters: async () => [],
  activeChapterSet: () => new Map(),
  getState: () => ({ jobs: [] }),
  subscribe: () => () => {},
}));

const { NovelDetailView } = await import("./NovelDetailView");

// ── harness ─────────────────────────────────────────────────────────────
let host: HTMLDivElement;
let root: Root;
const onStreamRead = vi.fn();

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

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
          onStreamRead={onStreamRead}
          onImportComplete={() => {}}
          onOpenRangeDialog={() => {}}
        />
      </I18nProvider>,
    );
  });
  await flush();
}

/** Every chapter row currently painted, in order. */
function rows(): HTMLElement[] {
  return [...host.querySelectorAll('[role="listitem"]')] as HTMLElement[];
}

/** A row's primary (open-the-chapter) button. */
function openButton(row: HTMLElement): HTMLButtonElement {
  const button = row.querySelector("button");
  if (!button) throw new Error("row has no button");
  return button as HTMLButtonElement;
}

/** A row's trailing download / delete button, found by its own label
 *  rather than by position. */
function rowActionButton(row: HTMLElement): HTMLButtonElement {
  const buttons = [...row.querySelectorAll("button")] as HTMLButtonElement[];
  const button = buttons.find((b) => {
    const label = b.getAttribute("aria-label") ?? "";
    return (
      label.startsWith("Download chapter") ||
      label.startsWith("Delete download")
    );
  });
  if (!button) throw new Error("row has no download/delete button");
  return button;
}

function buttonWithText(text: string): HTMLButtonElement {
  const buttons = [...host.querySelectorAll("button")] as HTMLButtonElement[];
  const button = buttons.find((b) => (b.textContent ?? "").includes(text));
  if (!button) throw new Error(`no button labelled "${text}"`);
  return button;
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  extensionStatus = "missing";
  extensionError = undefined;
  storedSnapshot = snapshot();
  installedSource = null;
  onStreamRead.mockClear();
  enqueue.mockClear();
  deleteBook.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("saved novel, source extension gone — what is still shown", () => {
  it("lists every chapter from the snapshot", async () => {
    await mount();
    const text = host.textContent ?? "";
    expect(text).toContain("Chapter One");
    expect(text).toContain("Chapter Two");
    expect(text).toContain("Chapter Three");
  });

  it("still shows the saved title, description and volume", async () => {
    await mount();
    const text = host.textContent ?? "";
    expect(text).toContain("A Saved Novel");
    expect(text).toContain("Saved when the extension still worked.");
    expect(text).toContain("Volume One");
  });

  it("does not fall back to the bare not-installed line", async () => {
    await mount();
    expect(host.textContent ?? "").not.toContain(
      "Source “seanovel” isn't installed.",
    );
  });
});

describe("saved novel, source extension gone — what still works", () => {
  it("opens a downloaded chapter at that chapter", async () => {
    await mount();
    await act(async () => {
      openButton(rows()[0]).click();
    });
    expect(onStreamRead).toHaveBeenCalledWith(1);
  });

  it("keeps the delete action on a downloaded chapter live", async () => {
    await mount();
    expect(rowActionButton(rows()[0]).disabled).toBe(false);
  });

  it("keeps Remove from library live", async () => {
    await mount();
    expect(buttonWithText("Remove from library").disabled).toBe(false);
  });

  it("points Read at the first downloaded chapter", async () => {
    await mount();
    await act(async () => {
      buttonWithText("Read").click();
    });
    expect(onStreamRead).toHaveBeenCalledWith(1);
  });

  it("disables Read when no chapter is downloaded", async () => {
    const bare = snapshot();
    for (const c of bare.volumes[0].chapters) {
      c.downloadedAt = undefined;
    }
    storedSnapshot = bare;
    await mount();
    expect(buttonWithText("Read").disabled).toBe(true);
  });
});

describe("saved novel, source extension gone — what is refused", () => {
  it("disables downloading an undownloaded chapter", async () => {
    await mount();
    expect(rowActionButton(rows()[1]).disabled).toBe(true);
  });

  it("says why that download is unavailable", async () => {
    await mount();
    expect(rowActionButton(rows()[1]).getAttribute("title")).toContain(
      "install it to download again",
    );
  });

  it("never enqueues a download from a disabled row", async () => {
    await mount();
    await act(async () => {
      rowActionButton(rows()[1]).click();
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("disables opening a chapter that was never downloaded", async () => {
    await mount();
    expect(openButton(rows()[1]).disabled).toBe(true);
  });

  it("says why that chapter can't be opened", async () => {
    await mount();
    expect(rows()[1].getAttribute("title")).toContain("Not downloaded");
  });

  it("disables the whole-volume download", async () => {
    await mount();
    const volume = [...host.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Download volume",
    ) as HTMLButtonElement | undefined;
    expect(volume?.disabled).toBe(true);
  });

  it("disables the range download in the hero", async () => {
    await mount();
    expect(buttonWithText("Download range").disabled).toBe(true);
  });

  it("disables Save as offline book", async () => {
    await mount();
    expect(buttonWithText("Save as offline book").disabled).toBe(true);
  });
});

describe("the banner", () => {
  it("names the missing extension and its fix", async () => {
    await mount();
    const text = host.textContent ?? "";
    expect(text).toContain("The “seanovel” extension isn't installed");
    expect(text).toContain("Install the extension again");
  });

  it("says something different when the extension is merely broken", async () => {
    extensionStatus = "broken";
    extensionError = "kaboom at line 3";
    await mount();
    const text = host.textContent ?? "";
    expect(text).toContain("The “seanovel” extension failed to load");
    expect(text).toContain("kaboom at line 3");
    expect(text).not.toContain("The “seanovel” extension isn't installed");
  });

  it("asks for an app update when the extension outranks this build", async () => {
    extensionStatus = "api-version";
    await mount();
    expect(host.textContent ?? "").toContain(
      "The “seanovel” extension needs a newer Riwaq",
    );
  });

  it("offers a way to the Extensions manager", async () => {
    await mount();
    expect(buttonWithText("Open Extensions")).toBeTruthy();
  });
});

describe("a volume this device never loaded", () => {
  it("says the chapters need the extension rather than showing nothing", async () => {
    const lazy = snapshot();
    lazy.volumes[0].chapters = [];
    lazy.volumes[0].chaptersLoaded = false;
    storedSnapshot = lazy;
    await mount();
    expect(host.textContent ?? "").toContain(
      "were never loaded onto this device",
    );
  });
});

// The counterweight: none of the above may be something the page simply
// always does. With the extension working, the same fixtures leave every
// control live and no banner on screen.
describe("the same page with the extension working", () => {
  beforeEach(() => {
    extensionStatus = "ok";
    installedSource = {
      canHandle: () => true,
      getNovel: async () => ({
        title: "A Saved Novel",
        author: "A. Writer",
        language: "en",
        direction: "ltr" as const,
        tags: [],
        meta: [],
        volumes: [],
      }),
      getHomeSections: async () => [],
      search: async () => ({ items: [] }),
      getChapterContent: async () => [],
    };
  });

  it("shows no banner", async () => {
    await mount();
    expect(host.textContent ?? "").not.toContain("Open Extensions");
  });

  it("leaves an undownloaded chapter's download live", async () => {
    await mount();
    expect(rowActionButton(rows()[1]).disabled).toBe(false);
  });

  it("leaves an undownloaded chapter openable", async () => {
    await mount();
    expect(openButton(rows()[1]).disabled).toBe(false);
  });

  it("leaves the range download live", async () => {
    await mount();
    expect(buttonWithText("Download range").disabled).toBe(false);
  });
});

describe("no snapshot at all", () => {
  it("keeps the plain not-installed message", async () => {
    storedSnapshot = null;
    await mount();
    expect(host.textContent ?? "").toContain(
      "Source “seanovel” isn't installed.",
    );
  });

  // Today's message and nothing else: with nothing on disk there is no
  // page to decorate, so neither the chapter list nor the banner belongs
  // here.
  it("shows no chapter list", async () => {
    storedSnapshot = null;
    await mount();
    expect(host.textContent ?? "").not.toContain("Chapter One");
  });

  it("shows no banner either", async () => {
    storedSnapshot = null;
    await mount();
    expect(host.textContent ?? "").not.toContain("Open Extensions");
  });
});
