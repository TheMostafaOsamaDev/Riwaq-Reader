// @vitest-environment happy-dom
//
// A lazy-volume source (cenele) returns every volume from getNovel with an
// empty `chapters[]` and only a `chapterCount` — the listing arrives one
// volume at a time through getVolumeChapters. The streaming reader never made
// those calls, so "Start reading" on any such novel flattened zero chapters
// and reported "This novel has no chapters." unless the library snapshot
// happened to hold every volume already.
//
// DesktopReader is stubbed to print what it was handed: the chapter count and
// the current chapter's body. The source, the snapshot and the registry are
// the parts that decide that, and they are faked here to the shape cenele
// actually returns.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import type { SourceSnapshot } from "../store/sourceLibrary";
import type {
  Source,
  SourceChapter,
  SourceNovel,
  SourceVolume,
} from "../sources/types";
import { THEMES } from "../styles/tokens";
import type { Tweaks } from "../types/reader";

const NOVEL_URL = "https://cenele.test/cont/novel/";

// Two volumes, 2 + 1 chapters. Ids are pre-assigned from the counts, the way
// cenele numbers them (startId + i), so volume 2 starts at 3.
const LISTING: Record<number, SourceChapter[]> = {
  1: [
    { id: 1, title: "Chapter 1", url: `${NOVEL_URL}c1/`, lines: [] },
    { id: 2, title: "Chapter 2", url: `${NOVEL_URL}c2/`, lines: [] },
  ],
  2: [{ id: 3, title: "Chapter 3", url: `${NOVEL_URL}c3/`, lines: [] }],
};

function lazyNovel(): SourceNovel {
  return {
    title: "A Lazy Novel",
    author: "A. Writer",
    language: "ar",
    direction: "rtl",
    tags: [],
    meta: [],
    volumes: [
      { id: 1, title: "Volume 1", chapters: [], chapterCount: 2, key: "1" },
      { id: 2, title: "Volume 2", chapters: [], chapterCount: 1, key: "2" },
    ],
  };
}

const getVolumeChapters = vi.fn(
  async (_url: string, volume: SourceVolume) => LISTING[volume.id] ?? [],
);
const source: Source = {
  id: "cenele",
  name: "Cenele",
  language: "ar",
  baseUrl: "https://cenele.test",
  hasLazyVolumes: true,
  canHandle: () => true,
  getHomeSections: async () => [],
  search: async (query: string) => ({
    cards: [],
    hasMore: false,
    query,
    page: 1,
  }),
  getNovel: async () => lazyNovel(),
  getVolumeChapters,
  getChapterContent: async (chapter: SourceChapter) => [
    { type: "text", content: `Body of ${chapter.title}.` },
  ],
} as unknown as Source;

let libraryEntry: { id: string } | null = null;
let snapshot: SourceSnapshot | null = null;
const setVolumeChapters = vi.fn(
  async (_entry: string, _volumeId: number, _chapters: SourceChapter[]) =>
    snapshot,
);

vi.mock("../sources/registry", () => ({
  getSource: () => source,
  ensureExtensions: async () => {},
  subscribeExtensions: () => () => {},
  extensionsRevision: () => 0,
}));

vi.mock("../store/library", () => ({
  findSourceEntry: async () => libraryEntry,
  updateSourceReadingPosition: async () => {},
}));

vi.mock("../store/sourceLibrary", async () => {
  const actual = await vi.importActual<typeof import("../store/sourceLibrary")>(
    "../store/sourceLibrary",
  );
  return {
    ...actual,
    readSnapshot: async () => snapshot,
    setVolumeChapters: (entry: string, volumeId: number, ch: SourceChapter[]) =>
      setVolumeChapters(entry, volumeId, ch),
    readChapterContent: async () => null,
    chapterIsDownloaded: async () => false,
    chapterImageSrc: async () => "",
    markChapterRead: async () => {},
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
}));

vi.mock("./DesktopReader", () => ({
  DesktopReader: ({
    book,
    currentChapter,
  }: {
    book: {
      chapters: Array<{ title: string; paragraphs: Array<{ text?: string }> }>;
    };
    currentChapter: number;
  }) => (
    <div data-testid="reader">
      <span data-testid="count">{book.chapters.length}</span>
      <span data-testid="titles">
        {book.chapters.map((c) => c.title).join("|")}
      </span>
      <span data-testid="body">
        {(book.chapters[currentChapter]?.paragraphs ?? [])
          .map((p) => p.text ?? "")
          .join(" ")}
      </span>
    </div>
  ),
}));
vi.mock("./MobileReader", () => ({ MobileReader: () => null }));

const { SourceStreamReader } = await import("./SourceStreamReader");

let host: HTMLDivElement;
let root: Root;

async function mount(startChapterId?: number) {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <SourceStreamReader
          theme={THEMES.light}
          themeKey="light"
          t={{} as Tweaks}
          setTweak={() => {}}
          layout="desktop"
          sourceId="cenele"
          novelUrl={NOVEL_URL}
          startChapterId={startChapterId}
          onClose={() => {}}
        />
      </I18nProvider>,
    );
  });
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

const text = (id: string) =>
  host.querySelector(`[data-testid="${id}"]`)?.textContent ?? null;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  localStorage.clear();
  libraryEntry = null;
  snapshot = null;
  getVolumeChapters.mockClear();
  setVolumeChapters.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("streaming reader on a lazy-volume source", () => {
  it("loads every volume's chapters instead of reporting none", async () => {
    await mount();
    expect(host.textContent ?? "").not.toContain("This novel has no chapters");
    expect(text("count")).toBe("3");
    expect(text("titles")).toBe("Chapter 1|Chapter 2|Chapter 3");
    expect(text("body")).toBe("Body of Chapter 1.");
  });

  it("opens the requested chapter when it lives in a later volume", async () => {
    await mount(3);
    expect(text("body")).toBe("Body of Chapter 3.");
  });

  it("fetches only the volumes the snapshot is missing, and saves them", async () => {
    libraryEntry = { id: "entry-1" };
    snapshot = {
      version: 1,
      sourceId: "cenele",
      novelUrl: NOVEL_URL,
      title: "A Lazy Novel",
      author: "A. Writer",
      language: "ar",
      direction: "rtl",
      tags: [],
      meta: [],
      volumes: [
        {
          id: 1,
          title: "Volume 1",
          key: "1",
          chapterCount: 2,
          chaptersLoaded: true,
          chapters: LISTING[1].map(({ id, title, url }) => ({
            id,
            title,
            url,
          })),
        },
        { id: 2, title: "Volume 2", key: "2", chapterCount: 1, chapters: [] },
      ],
      fetchedAt: 0,
    };
    await mount();
    expect(text("count")).toBe("3");
    expect(getVolumeChapters).toHaveBeenCalledTimes(1);
    expect(getVolumeChapters.mock.calls[0][1]).toMatchObject({
      id: 2,
      key: "2",
    });
    expect(setVolumeChapters).toHaveBeenCalledWith("entry-1", 2, LISTING[2]);
  });

  it("reports a volume that fails to load rather than a book with a hole in it", async () => {
    getVolumeChapters.mockImplementationOnce(async () => {
      throw new Error("cenele: failed to fetch chapters page 1 for volume 1.");
    });
    await mount();
    expect(host.querySelector('[data-testid="reader"]')).toBeNull();
    expect(host.textContent ?? "").toContain(
      "cenele: failed to fetch chapters page 1 for volume 1.",
    );
  });
});
