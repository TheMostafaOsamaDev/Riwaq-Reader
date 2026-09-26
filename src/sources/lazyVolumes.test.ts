import { describe, expect, it, vi } from "vitest";
import { loadMissingVolumes } from "./lazyVolumes";
import type { Source, SourceChapter, SourceNovel, SourceVolume } from "./types";

function chapter(id: number): SourceChapter {
  return {
    id,
    title: `Chapter ${id}`,
    url: `https://x.test/c${id}`,
    lines: [],
  };
}

function novel(volumes: SourceVolume[]): SourceNovel {
  return {
    title: "N",
    author: "A",
    language: "ar",
    direction: "rtl",
    tags: [],
    meta: [],
    volumes,
  };
}

function emptyVolume(id: number, chapterCount?: number): SourceVolume {
  return { id, title: `V${id}`, chapters: [], chapterCount, key: String(id) };
}

const emptyVolumes = (n: number) =>
  Array.from({ length: n }, (_, i) => emptyVolume(i + 1, 1));

/** A lazy source whose getVolumeChapters is `impl` (by default, one chapter
 *  per volume, numbered after it). `started()` lists the volume ids it was
 *  asked for, in call order. */
function lazySource(
  impl: (v: SourceVolume) => Promise<SourceChapter[]> = async (v) => [
    chapter(v.id),
  ],
) {
  const getVolumeChapters = vi.fn((_url: string, v: SourceVolume) => impl(v));
  const source = {
    hasLazyVolumes: true,
    getVolumeChapters,
  } as unknown as Source;
  const started = () => getVolumeChapters.mock.calls.map((c) => c[1].id);
  return { source, getVolumeChapters, started };
}

/** A lazy source whose calls resolve only when the test releases them, so
 *  the number in flight at any moment is observable. */
function gatedSource() {
  const pending: Array<{
    id: number;
    resolve: () => void;
    reject: (e: Error) => void;
  }> = [];
  const s = lazySource(
    (v) =>
      new Promise((resolve, reject) => {
        pending.push({
          id: v.id,
          resolve: () => resolve([chapter(v.id)]),
          reject,
        });
      }),
  );
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const take = (id: number) =>
    pending.splice(
      pending.findIndex((p) => p.id === id),
      1,
    )[0];
  const release = async (id: number) => {
    take(id).resolve();
    await settle();
  };
  const fail = async (id: number, message: string) => {
    take(id).reject(new Error(message));
    await settle();
  };
  return { ...s, pending, release, fail, settle };
}

describe("loadMissingVolumes", () => {
  it("fills only the empty volumes, in their original order", async () => {
    const s = lazySource(async (v) => [chapter(v.id * 10)]);
    const loaded: SourceVolume = {
      id: 1,
      title: "V1",
      chapters: [chapter(1)],
    };
    const out = await loadMissingVolumes(
      s.source,
      "u",
      novel([loaded, emptyVolume(2, 1), emptyVolume(3, 1)]),
    );
    expect(s.started()).toEqual([2, 3]);
    expect(out.volumes.map((v) => v.chapters.map((c) => c.id))).toEqual([
      [1],
      [20],
      [30],
    ]);
  });

  it("skips a volume the source already counted as empty", async () => {
    const s = lazySource();
    await loadMissingVolumes(s.source, "u", novel([emptyVolume(1, 0)]));
    expect(s.getVolumeChapters).not.toHaveBeenCalled();
  });

  it("returns the novel untouched for a source that isn't lazy", async () => {
    const getVolumeChapters = vi.fn(async () => [chapter(9)]);
    const source = { getVolumeChapters } as unknown as Source;
    const input = novel([emptyVolume(1, 3)]);
    expect(await loadMissingVolumes(source, "u", input)).toBe(input);
    expect(getVolumeChapters).not.toHaveBeenCalled();
  });

  it("loads the first volume alone, then the rest with at most `concurrency` in flight", async () => {
    const g = gatedSource();
    const done = loadMissingVolumes(g.source, "u", novel(emptyVolumes(6)), {
      concurrency: 2,
    });
    await g.settle();
    expect(g.started()).toEqual([1]);
    await g.release(1);
    expect(g.started()).toEqual([1, 2, 3]);
    expect(g.pending).toHaveLength(2);
    await g.release(3);
    expect(g.started()).toEqual([1, 2, 3, 4]);
    expect(g.pending).toHaveLength(2);
    for (const id of [2, 4, 5, 6]) await g.release(id);
    const out = await done;
    expect(out.volumes.map((v) => v.chapters[0].id)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it("starts `concurrency` volumes at once when the source is warm", async () => {
    const g = gatedSource();
    const done = loadMissingVolumes(g.source, "u", novel(emptyVolumes(3)), {
      concurrency: 2,
      warm: true,
    });
    await g.settle();
    expect(g.started()).toEqual([1, 2]);
    for (const id of [1, 2, 3]) await g.release(id);
    await done;
    expect(g.started()).toEqual([1, 2, 3]);
  });

  it("reports progress and hands each volume over as it lands", async () => {
    const s = lazySource();
    const progress: Array<[number, number]> = [];
    const landed: number[] = [];
    await loadMissingVolumes(s.source, "u", novel(emptyVolumes(2)), {
      onProgress: (done, total) => progress.push([done, total]),
      onVolume: (id) => {
        landed.push(id);
      },
    });
    expect(progress).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    expect(landed.sort()).toEqual([1, 2]);
  });

  it("rejects with the volume's own error and starts nothing further", async () => {
    const s = lazySource(async (v) => {
      if (v.id === 2) throw new Error("volume 2 broke");
      return [chapter(v.id)];
    });
    await expect(
      loadMissingVolumes(s.source, "u", novel(emptyVolumes(4)), {
        concurrency: 1,
      }),
    ).rejects.toThrow("volume 2 broke");
    expect(s.started()).toEqual([1, 2]);
  });

  it("stops the other workers once one volume fails", async () => {
    const g = gatedSource();
    const done = loadMissingVolumes(g.source, "u", novel(emptyVolumes(4)), {
      concurrency: 2,
      warm: true,
    });
    const settled = done.catch((e: Error) => e.message);
    await g.settle();
    await g.fail(2, "volume 2 broke");
    await g.release(1);
    expect(await settled).toBe("volume 2 broke");
    expect(g.started()).toEqual([1, 2]);
  });

  it("stops starting volumes once cancelled", async () => {
    const g = gatedSource();
    let cancelled = false;
    const done = loadMissingVolumes(g.source, "u", novel(emptyVolumes(3)), {
      concurrency: 1,
      isCancelled: () => cancelled,
    });
    await g.settle();
    cancelled = true;
    await g.release(1);
    await done;
    expect(g.started()).toEqual([1]);
  });
});
