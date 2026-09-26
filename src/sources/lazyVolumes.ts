// Completing a lazy-volume source's chapter listing.
//
// A source that declares `hasLazyVolumes` (cenele) returns every volume from
// getNovel with an empty `chapters[]` and, where it knows it, a
// `chapterCount`; the listing itself arrives one volume at a time through
// getVolumeChapters. The volumes accordion wants exactly that. The streaming
// reader does not: it numbers the whole novel as one flat spine, so its saved
// position, its Contents panel and its "next chapter" at a volume boundary are
// all wrong unless every volume is present — and with none present it has no
// book at all.
//
// Cost, measured against cenele on 2026-09-26: one volume's listing is one
// request per 50 chapters, made in sequence inside the extension. A 14-volume,
// 3,198-chapter novel took 63s volume-by-volume and 10s with every volume in
// flight at once, so volumes go in parallel, capped to stay a polite client.

import type { Source, SourceChapter, SourceNovel, SourceVolume } from "./types";

export interface LoadMissingVolumesOptions {
  /** Most getVolumeChapters calls in flight at once. */
  concurrency?: number;
  /** The source ran getNovel for this novel in this session, so its
   *  per-novel state is built and every volume can start at once. Leave it
   *  unset when the volumes came from somewhere else (a saved snapshot). */
  warm?: boolean;
  /** Checked before each volume starts; a cancelled load starts nothing
   *  further and resolves with whatever it has. */
  isCancelled?: () => boolean;
  /** `done` of `total` missing volumes loaded. Called once with 0 up front. */
  onProgress?: (done: number, total: number) => void;
  /** One volume's listing, as soon as it lands — for persisting it. Not
   *  awaited: a save never holds up the next fetch. */
  onVolume?: (volumeId: number, chapters: SourceChapter[]) => void;
}

/** A volume whose listing hasn't been fetched. `chapterCount: 0` is the
 *  source saying the volume really is empty, so it isn't asked again. */
function isMissing(v: SourceVolume): boolean {
  return v.chapters.length === 0 && v.chapterCount !== 0;
}

/** `novel` with every missing volume's chapters filled in through
 *  getVolumeChapters, volumes kept in their original order. Returns `novel`
 *  itself when the source isn't lazy or nothing is missing. Rejects with the
 *  first volume error: a novel with a volume silently absent would shift
 *  every later chapter's position. */
export async function loadMissingVolumes(
  source: Source,
  novelUrl: string,
  novel: SourceNovel,
  opts: LoadMissingVolumesOptions = {},
): Promise<SourceNovel> {
  const getVolumeChapters = source.getVolumeChapters?.bind(source);
  if (!source.hasLazyVolumes || !getVolumeChapters) return novel;
  const missing = novel.volumes.flatMap((v, i) => (isMissing(v) ? [i] : []));
  if (missing.length === 0) return novel;

  const { concurrency = 4, warm = false, isCancelled = () => false } = opts;
  const volumes = novel.volumes.slice();
  let done = 0;
  opts.onProgress?.(0, missing.length);

  const loadOne = async (i: number) => {
    const chapters = await getVolumeChapters(novelUrl, volumes[i]);
    volumes[i] = { ...volumes[i], chapters };
    opts.onVolume?.(volumes[i].id, chapters);
    done += 1;
    opts.onProgress?.(done, missing.length);
  };

  // A cold source goes one volume first. Cenele reached through a snapshot,
  // with no getNovel this session, rebuilds its per-novel state (novel page +
  // volume meta) on its first call, and parallel first calls would each
  // rebuild it.
  let next = 0;
  if (!warm && !isCancelled()) await loadOne(missing[next++]);

  const worker = async () => {
    while (next < missing.length && !isCancelled()) {
      try {
        await loadOne(missing[next++]);
      } catch (e) {
        next = missing.length; // the other workers start nothing further
        throw e;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, missing.length - next) },
      worker,
    ),
  );

  return { ...novel, volumes };
}
