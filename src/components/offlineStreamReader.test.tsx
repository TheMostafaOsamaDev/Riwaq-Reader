// @vitest-environment happy-dom
//
// The other half of "a saved novel still works with its extension gone":
// the reader has to genuinely open a downloaded chapter, not merely look
// like it would. Before this, the reader's whole load effect was gated on
// getSource() and a missing extension left it spinning on "Loading novel…"
// for ever — including for chapters already sitting on disk.
//
// DesktopReader is stubbed to print the chapter it was handed: this test is
// about what content reaches the reader, not about how the reader paints
// it. Everything that decides that — the snapshot, the per-chapter content
// read, the registry's answer — is real or explicitly mocked here.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import type { SourceSnapshot } from "../store/sourceLibrary";
import { THEMES } from "../styles/tokens";
import type { Tweaks } from "../types/reader";

const DOWNLOADED_AT = 1_700_000_000_000;
const SNAPSHOT: SourceSnapshot = {
  version: 1,
  sourceId: "seanovel",
  novelUrl: "https://seanovel.test/novel/1",
  title: "A Saved Novel",
  author: "A. Writer",
  language: "en",
  direction: "ltr",
  tags: [],
  meta: [],
  volumes: [
    {
      id: 1,
      title: "Volume One",
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

// The premise: the extension is gone.
vi.mock("../sources/registry", () => ({
  getSource: () => null,
  // The view loads the registry itself now (sources/useExtensions.ts), so
  // the mock has to answer that path too. This fixture stands for a
  // registry that has already settled: ensureExtensions is a no-op and the
  // revision never moves, which is the state the assertions below describe.
  ensureExtensions: async () => {},
  subscribeExtensions: () => () => {},
  extensionsRevision: () => 0,
}));

vi.mock("../store/library", () => ({
  findSourceEntry: async () => ({ id: "entry-1" }),
  updateSourceReadingPosition: async () => {},
}));

vi.mock("../store/sourceLibrary", async () => {
  const actual = await vi.importActual<typeof import("../store/sourceLibrary")>(
    "../store/sourceLibrary",
  );
  return {
    ...actual,
    readSnapshot: async () => SNAPSHOT,
    // Only chapter 1 is on this device — chapter 2 has to come off the
    // site, which is exactly what is no longer possible.
    readChapterContent: async (_entry: string, chapterId: number) =>
      chapterId === 1
        ? {
            version: 1 as const,
            id: 1,
            lines: [{ type: "text" as const, content: "Saved chapter body." }],
            fetchedAt: DOWNLOADED_AT,
          }
        : null,
    chapterIsDownloaded: async (_entry: string, chapterId: number) =>
      chapterId === 1,
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

// Print what the reader was actually given, so the assertions can be about
// content rather than about the reading surface's own chrome.
vi.mock("./DesktopReader", () => ({
  DesktopReader: ({
    book,
    currentChapter,
  }: {
    book: { chapters: Array<{ paragraphs: Array<{ text?: string }> }> };
    currentChapter: number;
  }) => (
    <div data-testid="reader">
      {(book.chapters[currentChapter]?.paragraphs ?? [])
        .map((p) => p.text ?? "")
        .join(" ")}
    </div>
  ),
}));
vi.mock("./MobileReader", () => ({ MobileReader: () => null }));

const { SourceStreamReader } = await import("./SourceStreamReader");

let host: HTMLDivElement;
let root: Root;

const TWEAKS = {} as Tweaks;

async function mount(startChapterId?: number) {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <I18nProvider locale="en">
        <SourceStreamReader
          theme={THEMES.light}
          themeKey="light"
          t={TWEAKS}
          setTweak={() => {}}
          layout="desktop"
          sourceId="seanovel"
          novelUrl="https://seanovel.test/novel/1"
          startChapterId={startChapterId}
          onClose={() => {}}
        />
      </I18nProvider>,
    );
  });
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("streaming reader with the source extension gone", () => {
  it("builds the book from the snapshot instead of hanging on the loader", async () => {
    await mount(1);
    expect(host.textContent ?? "").not.toContain("Loading novel…");
    expect(host.querySelector('[data-testid="reader"]')).not.toBeNull();
  });

  it("reads a downloaded chapter's saved body", async () => {
    await mount(1);
    expect(host.textContent ?? "").toContain("Saved chapter body.");
  });

  it("explains an undownloaded chapter instead of loading for ever", async () => {
    await mount(2);
    const text = host.textContent ?? "";
    expect(text).toContain("isn't saved on this device");
    expect(text).toContain("install it to read this one");
  });
});
