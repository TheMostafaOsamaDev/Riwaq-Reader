// Adding a novel used to refetch and reparse the whole novel page that the
// detail view had already parsed to render itself — for a 2372-chapter
// novel, the single most expensive thing the tap did. It now takes the
// SourceNovel it is given.
//
// The second half covers the race that opened up when the existing-entry
// lookup ran before the lock instead of inside it: two taps landing
// together both read "not in library" and both insert.
import { beforeEach, describe, expect, it, vi } from "vitest";

let files: Record<string, string> = {};
const dirs = new Set<string>();
let snapshotWrites = 0;
let getSourceCalls = 0;

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (p: string) => p in files || dirs.has(p),
  mkdir: async (p: string) => {
    dirs.add(p);
  },
  readTextFile: async (p: string) => {
    const v = files[p];
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  },
  writeTextFile: async (p: string, data: string) => {
    files[p] = data;
  },
  readFile: async () => new Uint8Array(),
  writeFile: async () => {},
  remove: async () => {},
  rename: async () => {},
  readDir: async () => [],
  copyFile: async () => {},
  stat: async () => ({ size: 0 }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/app",
  join: async (...p: string[]) => p.join("/"),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async () => {
    throw new Error("addNovelToLibrary must not touch IPC");
  },
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("./legacyRoot", () => ({ migrateLegacyRoot: async () => {} }));
vi.mock("./sourceLibrary", () => ({
  writeSnapshotFromSourceNovel: async () => {
    snapshotWrites++;
    return {};
  },
}));
// If addNovelToLibrary still reaches for the registry, it is still
// refetching — which is exactly what this change removes.
vi.mock("../sources/registry", () => ({
  getSource: () => {
    getSourceCalls++;
    return null;
  },
}));

import { addNovelToLibrary } from "./library";
import { INDEX } from "./paths";

function novelFixture(chapters: number) {
  return {
    title: "القس المجنون",
    author: "Gu Zhen Ren",
    language: "ar",
    direction: "rtl" as const,
    description: "قصة الشرير فانغ يوان",
    tags: [],
    meta: [],
    volumes: [
      {
        id: 1,
        title: "V1",
        chapters: Array.from({ length: chapters }, (_, i) => ({
          id: i + 1,
          title: `Ch ${i + 1}`,
          url: `https://kolnovel.test/ch/${i + 1}`,
          lines: [],
        })),
      },
    ],
  };
}

function indexBooks(): { id: string; title: string; chapterCount: number }[] {
  const raw = files[INDEX];
  return raw ? JSON.parse(raw).books : [];
}

beforeEach(() => {
  files = {};
  dirs.clear();
  snapshotWrites = 0;
  getSourceCalls = 0;
});

describe("addNovelToLibrary", () => {
  it("uses the novel it is handed instead of refetching it", async () => {
    const entry = await addNovelToLibrary(
      "kolnovel",
      "https://kolnovel.test/novel/1",
      novelFixture(2372) as never,
    );

    expect(getSourceCalls).toBe(0);
    expect(entry.title).toBe("القس المجنون");
    expect(entry.chapterCount).toBe(2372);
    expect(entry.kind).toBe("source");
    expect(snapshotWrites).toBe(1);
  });

  it("writes exactly one entry when two taps land together", async () => {
    await Promise.all([
      addNovelToLibrary(
        "kolnovel",
        "https://kolnovel.test/novel/1",
        novelFixture(3) as never,
      ),
      addNovelToLibrary(
        "kolnovel",
        "https://kolnovel.test/novel/1",
        novelFixture(3) as never,
      ),
    ]);
    expect(indexBooks()).toHaveLength(1);
  });

  it("re-adding an existing novel keeps its id and addedAt", async () => {
    const first = await addNovelToLibrary(
      "kolnovel",
      "https://kolnovel.test/novel/1",
      novelFixture(3) as never,
    );
    const second = await addNovelToLibrary(
      "kolnovel",
      "https://kolnovel.test/novel/1",
      novelFixture(9) as never,
    );
    expect(second.id).toBe(first.id);
    expect(second.addedAt).toBe(first.addedAt);
    // The refreshed listing is what the user asked for.
    expect(second.chapterCount).toBe(9);
    expect(indexBooks()).toHaveLength(1);
  });
});
