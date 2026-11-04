// @vitest-environment happy-dom
//
// Where a web novel's reader is, as the streaming reader keeps it.
//
// - The position has to survive leaving. The streaming reader keeps it in
//   React state and writes it to localStorage from an effect, but the
//   reader's last report arrives as it unmounts — the same commit that
//   unmounts this component — and a setState there is dropped. A final report
//   is written straight through.
// - A chapter is marked read once the reader says its last line is on
//   screen. It used to wait for the reported paragraph to reach the last one,
//   but the reader reports the paragraph at the TOP of the screen, and the
//   last one never gets there: scrolled to the very bottom it reported 166 of
//   169, so a chapter finished by scrolling was never marked.
// - The library card's progress is the reader's own number
//   (reader/bookProgress.ts), written as the reader leaves.
import { act, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import type { SourceSnapshot } from "../store/sourceLibrary";
import { THEMES } from "../styles/tokens";
import type { OnParagraphChange, Tweaks } from "../types/reader";

const mocks = vi.hoisted(() => ({
  markChapterRead: vi.fn(async () => {}),
  updateBookProgress: vi.fn(async () => {}),
}));

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
  updateBookProgress: mocks.updateBookProgress,
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
            lines: Array.from({ length: 6 }, (_, i) => ({
              type: "text" as const,
              content: `Line ${i + 1}.`,
            })),
            fetchedAt: DOWNLOADED_AT,
          }
        : null,
    chapterIsDownloaded: async (_entry: string, chapterId: number) =>
      chapterId === 1,
    chapterImageSrc: async () => "",
    markChapterRead: mocks.markChapterRead,
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

// The readers, reduced to what matters here: a handle the test reports
// through, and one last final report from a layout cleanup — exactly when
// the real one sends it (usePositionReporter). Through a ref, because the
// host's callback changes identity as the novel loads.
const readers: Record<string, OnParagraphChange | null> = {};
function stubReader(name: "desktop" | "mobile", lastWords: number) {
  return function StubReader({
    onParagraphChange,
  }: {
    onParagraphChange: OnParagraphChange;
  }) {
    readers[name] = onParagraphChange;
    const latest = useRef(onParagraphChange);
    latest.current = onParagraphChange;
    useLayoutEffect(
      () => () => latest.current(lastWords, 0.4, { final: true }),
      [],
    );
    return <div data-testid={`reader-${name}`} />;
  };
}
vi.mock("./DesktopReader", () => ({
  DesktopReader: stubReader("desktop", 12),
}));
vi.mock("./MobileReader", () => ({ MobileReader: stubReader("mobile", 30) }));

const { SourceStreamReader } = await import("./SourceStreamReader");

const KEY = "riwaq:stream-state:seanovel:https://seanovel.test/novel/1";
let host: HTMLDivElement;
let root: Root;

function view(layout: "desktop" | "mobile") {
  return (
    <I18nProvider locale="en">
      <SourceStreamReader
        theme={THEMES.light}
        themeKey="light"
        t={{} as Tweaks}
        setTweak={() => {}}
        layout={layout}
        sourceId="seanovel"
        novelUrl="https://seanovel.test/novel/1"
        startChapterId={1}
        onClose={() => {}}
      />
    </I18nProvider>
  );
}

async function mount(layout: "desktop" | "mobile" = "desktop") {
  await act(async () => {
    root.render(view(layout));
  });
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const saved = () => JSON.parse(localStorage.getItem(KEY) ?? "{}");

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  localStorage.clear();
  root = createRoot(host);
  mocks.markChapterRead.mockClear();
  mocks.updateBookProgress.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("streaming reader position", () => {
  it("saves the reader's final report as it closes", async () => {
    await mount();
    act(() => root.unmount());
    root = createRoot(host); // for afterEach

    expect(saved().paragraphIndex).toBe(12);
    expect(saved().paragraphOffset).toBe(0.4);
  });

  it("ignores the outgoing reader's last report on a layout flip", async () => {
    // The desktop reader's text has reflowed to the phone's width by the
    // time it unmounts, so the paragraph it measures (12 here) is wrong.
    await mount("desktop");
    act(() => readers.desktop?.(5, 0.1));
    await act(async () => {
      root.render(view("mobile"));
    });

    expect(saved().paragraphIndex).not.toBe(12);
  });

  it("marks a chapter read once its last line is on screen", async () => {
    await mount();
    // The top of the screen is still on paragraph 3 of 6 — the last line has
    // come into view below it.
    act(() => readers.desktop?.(3, 0.2, { chapterFraction: 1 }));
    expect(mocks.markChapterRead).toHaveBeenCalledWith("entry-1", 1);
  });

  it("does not mark a chapter read on the way through it", async () => {
    await mount();
    act(() => readers.desktop?.(3, 0.2, { chapterFraction: 0.6 }));
    expect(mocks.markChapterRead).not.toHaveBeenCalled();
  });

  it("writes the library card's progress as the reader leaves", async () => {
    await mount();
    act(() =>
      readers.desktop?.(3, 0.2, {
        final: true,
        chapterFraction: 0.5,
        bookFraction: 0.25,
      }),
    );
    expect(mocks.updateBookProgress).toHaveBeenCalledWith("entry-1", 0.25);
  });
});
