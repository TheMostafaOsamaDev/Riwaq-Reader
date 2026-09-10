import { useCallback, useEffect, useRef, useState } from "react";
import type { Source, SourceNovel } from "../../sources/types";
import { MeasuredVirtualList } from "../VirtualList";
import { transition } from "../../styles/motion";

import { type Theme, Z } from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import { Icon } from "../Icon";
import { AnimatedDialog } from "../AnimatedDialog";
import { ConfirmDialog } from "../ConfirmDialog";
import { Toast, type ToastMessage } from "../Toast";
import { VolumeActionsMenu } from "../VolumeActionsMenu";
import {
  deleteChaptersWithQueue,
  downloadedChapterIds,
  readDownloadedChapterIds,
  type ChapterFlags,
} from "../../store/chapterDeletion";
import { CHAPTER_ROW_HEIGHT, ChapterRow } from "./ChapterRow";
import { buildFlagMap } from "./flagMap";
import { VolumeChaptersSkeleton, VolumeErrorPanel } from "./VolumePlaceholders";
export interface VolumesAccordionProps {
  theme: Theme;
  layout: "desktop" | "mobile";
  source: Source;
  novel: SourceNovel;
  novelUrl: string;
  /** Library entry id when this view is bound to a shelf entry. Drives
   *  the per-chapter download icon's visibility — the Store-side detail
   *  view (no library entry yet) hides downloads entirely. */
  libraryEntryId?: string;
  /** Per-chapter flag lookup. Read chapters dim. Downloaded chapters
   *  show the "downloaded" indicator on their row. */
  chapterFlags: Map<number, ChapterFlags>;
  onOpenChapter: (chapterId: number) => void;
  /** Bumped by the download / queue subsystem when a chapter's flags
   *  change so the accordion re-renders. The setter accepts a new map
   *  built from the latest source.json snapshot. */
  onChapterFlagsChange: (next: Map<number, ChapterFlags>) => void;
  /** Replace the novel object the parent holds — used by the lazy
   *  volume path: after a fresh `getVolumeChapters` lands, the
   *  accordion calls this with the same novel but the target volume's
   *  chapters[] populated. Accepts either a value or a functional
   *  updater (the latter lets the accordion patch atop whatever the
   *  parent's latest state is, avoiding stale-closure overwrites when
   *  multiple effects race). */
  onNovelPatch: (
    updater:
      | SourceNovel
      | ((current: SourceNovel | null) => SourceNovel | null),
  ) => void;
}

export function VolumesAccordion({
  theme,
  layout,
  source,
  novel,
  novelUrl,
  libraryEntryId,
  chapterFlags,
  onOpenChapter,
  onChapterFlagsChange,
  onNovelPatch,
}: VolumesAccordionProps) {
  const { tr } = useI18n();
  // Open the first volume by default; subsequent volumes start collapsed
  // to keep the page short on a 100+ chapter novel.
  const [open, setOpen] = useState<Set<number>>(
    () => new Set(novel.volumes.length > 0 ? [novel.volumes[0].id] : []),
  );
  const toggle = (id: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ── lazy volume loading ──────────────────────────────────────────────
  // For sources that declare `hasLazyVolumes`, getNovel returns volumes
  // with empty chapters[] arrays. We fetch them on first expand of each
  // volume, persist into source.json, and stuff the result into the
  // parent's novel state.
  //
  // loadingVolumes  per-volume in-flight flag (drives the skeleton)
  // errorByVolume   surface error message when a load fails
  const [loadingVolumes, setLoadingVolumes] = useState<Set<number>>(
    () => new Set(),
  );
  const [errorByVolume, setErrorByVolume] = useState<Map<number, string>>(
    () => new Map(),
  );
  const expandedRef = useRef<Set<number>>(new Set());
  const isLazy = source.hasLazyVolumes === true;

  // Cancel-on-unmount guards. Tracks every in-flight fetch by volume
  // id so an unmount mid-load doesn't leak setState calls into a
  // dead component.
  //
  // The body resets the ref to `true` on every mount because
  // `useRef`'s value persists across React StrictMode's simulated
  // unmount→remount cycle. Without the explicit reset, the cleanup
  // from the first invocation would leave the ref `false` going into
  // the second mount, and every in-flight loadVolume would bail in
  // its `if (!aliveRef.current) return;` guards — leaving the
  // skeleton stuck forever.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const loadVolume = useCallback(
    async (volumeId: number) => {
      if (!isLazy) return;
      if (loadingVolumes.has(volumeId)) return;
      // Did we already load it once this mount? Avoid hammering on
      // every collapse/expand toggle.
      if (expandedRef.current.has(volumeId)) return;
      const vol = novel.volumes.find((v) => v.id === volumeId);
      if (!vol) return;
      if (vol.chapters.length > 0) {
        // Already loaded (e.g. snapshot had carried-forward chapters).
        expandedRef.current.add(volumeId);
        return;
      }
      if (!source.getVolumeChapters) return;

      setLoadingVolumes((s) => {
        const next = new Set(s);
        next.add(volumeId);
        return next;
      });
      setErrorByVolume((m) => {
        if (!m.has(volumeId)) return m;
        const next = new Map(m);
        next.delete(volumeId);
        return next;
      });
      try {
        const chapters = await source.getVolumeChapters(novelUrl, vol);
        if (!aliveRef.current) return;
        // Persist + mirror into the parent's novel state. Use a
        // functional updater so we patch atop the parent's CURRENT
        // novel — if a concurrent fetchFromSource has updated
        // state.novel since our await, we'd overwrite it with the
        // stale closure copy otherwise.
        if (libraryEntryId) {
          const { setVolumeChapters } = await import(
            "../../store/sourceLibrary"
          );
          await setVolumeChapters(libraryEntryId, volumeId, chapters);
        }
        onNovelPatch((current) => {
          if (!current) {
            // Should be unreachable — accordion only renders when
            // novel is non-null — but the functional updater's typed
            // input includes null, so guard.
            return current;
          }
          const patched = current.volumes.map((v) =>
            v.id === volumeId ? { ...v, chapters } : v,
          );
          return { ...current, volumes: patched };
        });
        expandedRef.current.add(volumeId);
      } catch (e) {
        if (!aliveRef.current) return;
        setErrorByVolume((m) => {
          const next = new Map(m);
          next.set(volumeId, e instanceof Error ? e.message : String(e));
          return next;
        });
      } finally {
        // Guarded rather than an early `return`: a return inside `finally`
        // discards anything still propagating out of the try/catch, which
        // here would mean losing a throw from the catch block itself.
        if (aliveRef.current) {
          setLoadingVolumes((s) => {
            const next = new Set(s);
            next.delete(volumeId);
            return next;
          });
        }
      }
    },
    [
      isLazy,
      loadingVolumes,
      novel,
      novelUrl,
      source,
      libraryEntryId,
      onNovelPatch,
    ],
  );

  // Fire the load when a lazy volume becomes open (initial mount's
  // auto-opened first volume + any subsequent user-driven expand).
  useEffect(() => {
    if (!isLazy) return;
    for (const id of open) {
      const vol = novel.volumes.find((v) => v.id === id);
      if (!vol) continue;
      if (vol.chapters.length === 0 && !loadingVolumes.has(id)) {
        void loadVolume(id);
      }
    }
  }, [isLazy, open, novel.volumes, loadingVolumes, loadVolume]);

  // Refresh chapter flags on demand — used by the per-chapter download
  // button once a download completes. Reads source.json and rebuilds
  // the flag map.
  //
  // Generation-guarded, because these overlap and don't resolve in
  // order. Cancelling a QUEUED job inside cancelJobsForChapters calls
  // setStatus(…, "cancelled") synchronously, which emits, which makes
  // the queue subscription below see a new terminal job and fire its
  // own refreshFlags — so a read of the PRE-delete snapshot is already
  // in flight before the sweep starts, and runBulkDelete fires another
  // one when it finishes. If the first read lands last (a multi-MB
  // source.json on Android competing with 200 in-flight remove()
  // calls) the deleted chapters flip back to "downloaded" until the
  // next queue tick or navigation, and the delete looks like it
  // failed. Only the newest read may write.
  const flagsGenRef = useRef(0);
  const refreshFlags = useCallback(async () => {
    if (!libraryEntryId) return;
    const gen = ++flagsGenRef.current;
    const { readSnapshot } = await import("../../store/sourceLibrary");
    const snap = await readSnapshot(libraryEntryId);
    if (!snap) return;
    if (gen !== flagsGenRef.current) return;
    onChapterFlagsChange(buildFlagMap(snap));
  }, [libraryEntryId, onChapterFlagsChange]);

  // Toast + per-row delete plumbing. Reused by the bulk delete affordances
  // (volume / read-downloads) landing in later tasks.
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastIdRef = useRef(0);
  const showToast = useCallback(
    (
      kind: ToastMessage["kind"],
      text: string,
      action?: ToastMessage["action"],
    ) => {
      toastIdRef.current += 1;
      setToast({ id: toastIdRef.current, kind, text, action });
    },
    [],
  );
  // Stable, like closeVolumeMenu above and for the same reason. Toast's
  // auto-dismiss effect lists onDismiss in its deps, so an inline arrow
  // restarted the 3.5s timer on every parent re-render — and this
  // component re-renders on every queue emission, roughly 25 per
  // chapter (one per image). Deleting chapter 5 while chapter 7
  // downloaded pinned the toast, and its stale "Re-download chapter 5"
  // button, for the whole remaining download.
  const dismissToast = useCallback(() => setToast(null), []);

  /** One row's delete, end to end: run it, refresh the flags, report
   *  what actually happened.
   *
   *  Every exit reports something. deleteChapterDownloads ends in a
   *  writeTextFile, which throws when the disk is full — the state a
   *  user deleting downloads is most likely to be in. Left uncaught
   *  that was an unhandled rejection with no toast, no error, and a row
   *  still showing a ✓ over content that is already gone. */
  const deleteOneChapter = useCallback(
    (chapterId: number) => {
      if (!libraryEntryId) return;
      const chapter = novel.volumes
        .flatMap((v) => v.chapters)
        .find((c) => c.id === chapterId);
      const title = chapter?.title ?? String(chapterId);
      void (async () => {
        try {
          const res = await deleteChaptersWithQueue(libraryEntryId, [
            chapterId,
          ]);
          // res.removed is what the snapshot actually cleared. Saying
          // "Deleted X" regardless of it means a chapter the snapshot
          // never listed reads as freed disk that was never freed.
          if (res.removed.length === 0) {
            showToast("warn", tr("downloads.delete.nothingRemoved", { title }));
            return;
          }
          showToast(
            "info",
            tr(
              res.cancelledRunning.length > 0
                ? "downloads.delete.deletedAndCancelled"
                : "downloads.delete.deleted",
              { title },
            ),
            {
              label: tr("downloads.delete.redownload"),
              onClick: () => {
                void (async () => {
                  const { enqueue } = await import("../../store/downloadQueue");
                  if (!chapter) return;
                  enqueue({
                    libraryEntryId,
                    chapterId,
                    novelTitle: novel.title,
                    chapterTitle: chapter.title,
                  });
                })();
              },
            },
          );
        } catch (e) {
          showToast(
            "error",
            tr("downloads.delete.failed", {
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        } finally {
          // Either way: a throw can land after some directories were
          // already swept, so the rows have to be rebuilt from disk
          // rather than left on the pre-delete map.
          void refreshFlags();
        }
      })();
    },
    [refreshFlags, showToast, tr, novel, libraryEntryId],
  );

  // Volume-header overflow menu ("⋯"): delete read downloads / delete all
  // downloads in the volume. `volumeMenu` anchors the popover/sheet at the
  // trigger button's rect; `deleteConfirm` stages the chosen chapter ids
  // for the ConfirmDialog.
  const [volumeMenu, setVolumeMenu] = useState<{
    id: number;
    left: number;
    right: number;
    y: number;
  } | null>(null);
  /** The ⋯ button that opened the menu. Handed to VolumeActionsMenu so
   *  its outside-press listener can skip the trigger, letting the
   *  trigger's own click toggle the menu shut. */
  const volumeMenuTriggerRef = useRef<HTMLElement | null>(null);
  // Stable identity so VolumeActionsMenu's DesktopPopover effect (which
  // depends on onClose) doesn't tear down and re-add its window
  // listeners on every parent re-render (the download-queue subscription
  // above re-renders this component frequently while the popover is open).
  const closeVolumeMenu = useCallback(() => setVolumeMenu(null), []);
  /** Chapters staged for a bulk delete, awaiting the user's confirm.
   *  `conversionActive` is sampled once at stage time — see stageDelete. */
  const [deleteConfirm, setDeleteConfirm] = useState<{
    ids: number[];
    conversionActive: boolean;
  } | null>(null);
  /** Stage a bulk delete for confirmation, sampling the queue for a
   *  live conversion of this same entry on the way.
   *
   *  The design spec's hazard 5: storeConversion's enrichChapter reads
   *  a chapter from disk when downloadedAt is set and refetches it from
   *  the source otherwise. Deleting under a running "Save as offline
   *  book" therefore doesn't fail — it silently turns a fast local job
   *  into hundreds of live scrapes, which is minutes-to-hours of
   *  degradation plus real rate-limit exposure. So it warns, and does
   *  NOT block: the user may well mean it.
   *
   *  Sampled here rather than read during render because the queue
   *  module is loaded lazily throughout this file, and the confirm's
   *  body has to be a plain synchronous render. A conversion starting
   *  in the second between staging and confirming goes unwarned; that
   *  is the honest cost of not making the dialog async. */
  const stageDelete = useCallback(
    (ids: number[]) => {
      if (ids.length === 0) return;
      void (async () => {
        let conversionActive = false;
        if (libraryEntryId) {
          try {
            const { getState } = await import("../../store/downloadQueue");
            conversionActive = getState().jobs.some(
              (j) =>
                j.kind === "conversion" &&
                j.libraryEntryId === libraryEntryId &&
                (j.status === "queued" || j.status === "running"),
            );
          } catch {
            // Queue module unavailable — stage without the warning
            // rather than blocking a delete the user asked for.
          }
        }
        setDeleteConfirm({ ids, conversionActive });
      })();
    },
    [libraryEntryId],
  );
  /** Live counter for a bulk delete, driven by deleteChapterDownloads'
   *  every-25-chapters onProgress. Non-null exactly while a sweep runs,
   *  so it doubles as the "show the progress line" flag.
   *
   *  A 950-chapter volume is 950 sequential remove() IPC round-trips
   *  with the entry lock held — minutes on Android. Without this the
   *  only feedback was a toast at the very end. */
  const [deleteProgress, setDeleteProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  /** Disables the bulk-delete affordances while a sweep is in flight.
   *  The ref is the actual guard — two synchronous confirms would both
   *  read a not-yet-committed `false` out of the state variable. The
   *  state exists only so the buttons re-render disabled.
   *
   *  Without it: confirm "delete all in volume", reopen the ⋯ menu
   *  (still computing `downloaded` from the pre-delete chapterFlags),
   *  confirm the same 950 ids again. The second call serializes behind
   *  the entry lock, finds every flag already clear, and reports
   *  "Deleted 0 downloads" after 950 more remove() calls. */
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);

  // Selection state is declared here, ahead of runBulkDelete: runBulkDelete
  // calls exitSelection at the end, and a `const` arrow declared below it
  // would be a used-before-declaration error. Library.tsx hoists showToast
  // for the same reason.
  //
  // Selection lives in the parent, not in the rows: `ChapterRow` is
  // memoized because the parent re-renders on every download-queue tick,
  // and a 950-row volume can't afford to reconcile all of them. Rows
  // receive a boolean, so only the two rows whose selectedness actually
  // changed re-render.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  // Escape leaves selection mode. The ✕ in the action bar was the only
  // way out, and on Android the hardware back button routes into the
  // webview's history — intercepting it would mean leaving the novel
  // entirely, so a key is the honest fix here.
  //
  // Stands down while the confirm dialog or the volume menu is open:
  // both bind Escape themselves, and cancelling a confirm should not
  // also throw away the selection the user is about to retry with.
  useEffect(() => {
    if (!selecting) return;
    if (deleteConfirm !== null || volumeMenu !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, deleteConfirm, volumeMenu, exitSelection]);

  const toggleSelected = useCallback((chapterId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  }, []);

  // The "only downloaded chapters are selectable" guard used to live
  // here and depend on `chapterFlags`, which made this callback (and
  // therefore every mounted ChapterRow's `onEnterSelection` prop) get a
  // new identity on every flag rebuild — defeating the row memo for all
  // of them, not just the row whose flags actually changed. ChapterRow
  // already receives `downloaded` as a boolean prop, so the guard now
  // lives there instead, letting this stay a stable, dependency-free
  // callback.
  const enterSelection = useCallback((chapterId: number) => {
    setSelecting(true);
    setSelected(new Set([chapterId]));
  }, []);

  const runBulkDelete = useCallback(
    async (ids: number[]) => {
      if (!libraryEntryId || ids.length === 0) return;
      if (deletingRef.current) return;
      deletingRef.current = true;
      setDeleting(true);
      // Seed at 0/total so the line appears the moment the sweep starts.
      // onProgress only fires every 25 chapters, so a small batch would
      // otherwise show nothing at all until it finished.
      setDeleteProgress({ done: 0, total: ids.length });
      try {
        const res = await deleteChaptersWithQueue(
          libraryEntryId,
          ids,
          (done, total) => setDeleteProgress({ done, total }),
        );
        showToast(
          "info",
          tr(
            res.removed.length === 1
              ? "downloads.delete.deletedCountOne"
              : "downloads.delete.deletedCountOther",
            { n: res.removed.length },
          ),
        );
        exitSelection();
      } catch (e) {
        // The selection deliberately survives a failure: it is the
        // user's only record of what they were trying to delete, and
        // rebuilding it by hand over a 950-row volume is worse than
        // leaving the mode open behind an error toast.
        showToast(
          "error",
          tr("downloads.delete.failed", {
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      } finally {
        deletingRef.current = false;
        setDeleting(false);
        setDeleteProgress(null);
        void refreshFlags();
      }
    },
    [libraryEntryId, refreshFlags, showToast, tr, exitSelection],
  );

  // Per-volume "download all" — enqueues every not-yet-downloaded chapter in
  // one volume. Lazy volumes are fetched first so their chapter list exists
  // before we enqueue. `downloadingVol` guards the brief enqueue window so a
  // double-tap can't fire it twice.
  const [downloadingVol, setDownloadingVol] = useState<Set<number>>(
    () => new Set(),
  );
  /** Volume awaiting the user's go-ahead. One tap on the volume's download
   *  icon used to queue every chapter in it immediately — dozens of network
   *  fetches from a 42px target sitting right next to the expand/collapse
   *  row, with no way to take it back. The icon now only stages the intent;
   *  `downloadVolume` runs on confirm. `pending`/`skipped` are captured at
   *  tap time so the dialog can state exactly what it is about to queue. */
  const [volumeConfirm, setVolumeConfirm] = useState<{
    id: number;
    title: string;
    pending: number;
    skipped: number;
  } | null>(null);
  const downloadVolume = useCallback(
    async (volumeId: number) => {
      if (!libraryEntryId) return;
      if (downloadingVol.has(volumeId)) return;
      const vol = novel.volumes.find((v) => v.id === volumeId);
      if (!vol) return;
      setDownloadingVol((s) => new Set(s).add(volumeId));
      try {
        // Ensure the chapter list exists (lazy volumes arrive empty).
        let chapters = vol.chapters;
        if (chapters.length === 0 && source.getVolumeChapters) {
          const fetched = await source.getVolumeChapters(novelUrl, vol);
          if (!aliveRef.current) return;
          chapters = fetched;
          const { setVolumeChapters } = await import(
            "../../store/sourceLibrary"
          );
          await setVolumeChapters(libraryEntryId, volumeId, fetched);
          onNovelPatch((current) =>
            current
              ? {
                  ...current,
                  volumes: current.volumes.map((v) =>
                    v.id === volumeId ? { ...v, chapters: fetched } : v,
                  ),
                }
              : current,
          );
          expandedRef.current.add(volumeId);
        }
        const { enqueue } = await import("../../store/downloadQueue");
        for (const c of chapters) {
          if (chapterFlags.get(c.id)?.downloadedAt) continue;
          enqueue({
            libraryEntryId,
            chapterId: c.id,
            novelTitle: novel.title,
            chapterTitle: c.title,
          });
        }
      } catch {
        // The per-chapter rows surface queue/error state; a failed lazy
        // fetch leaves the volume untouched for a retry.
      } finally {
        if (aliveRef.current) {
          setDownloadingVol((s) => {
            const next = new Set(s);
            next.delete(volumeId);
            return next;
          });
        }
      }
    },
    [
      libraryEntryId,
      downloadingVol,
      novel,
      novelUrl,
      source,
      chapterFlags,
      onNovelPatch,
    ],
  );

  // Live queue state for this entry — drives the per-row download
  // icon's queued/running/error rendering. We subscribe to the
  // module-scoped queue once for the accordion (not once per row) and
  // re-read activeChapterSet on every emission. When a job transitions
  // from running → done we trigger a flag refresh so the persisted
  // downloadedAt picks up.
  const [activeJobs, setActiveJobs] = useState<
    Map<number, import("../../store/downloadQueue").DownloadJob>
  >(new Map());
  useEffect(() => {
    if (!libraryEntryId) return;
    let lastTerminalUpdate = 0;
    let cancelled = false;
    (async () => {
      const { subscribe, activeChapterSet, getState } = await import(
        "../../store/downloadQueue"
      );
      const apply = () => {
        if (cancelled) return;
        setActiveJobs(activeChapterSet(libraryEntryId));
        // Heuristic: any terminal job belonging to this entry that
        // showed up after our last refresh is a good moment to
        // re-read source.json so freshly-downloaded chapters flip
        // their persisted flag in the UI.
        const st = getState();
        let newest = lastTerminalUpdate;
        let dirty = false;
        for (const j of st.jobs) {
          if (j.libraryEntryId !== libraryEntryId) continue;
          if (
            j.status === "done" ||
            j.status === "error" ||
            j.status === "cancelled"
          ) {
            if (j.updatedAt > lastTerminalUpdate) dirty = true;
            if (j.updatedAt > newest) newest = j.updatedAt;
          }
        }
        if (dirty) {
          lastTerminalUpdate = newest;
          void refreshFlags();
        }
      };
      apply();
      const off = subscribe(apply);
      // Capture the unsubscribe for cleanup. Wrap so cleanup runs
      // even before the dynamic import resolved (cancelled-flag
      // gate above).
      return off;
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryEntryId, refreshFlags]);

  return (
    <div
      style={{
        padding: layout === "mobile" ? "0 18px 40px" : "0 40px 40px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <h2
        style={{
          fontSize: 14,
          fontWeight: 600,
          margin: "8px 0",
          color: theme.ink,
          letterSpacing: "-0.005em",
        }}
      >
        {tr("novel.chaptersHeading")}
      </h2>
      {selecting && (
        <div
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            paddingBlock: 10,
            paddingInline: 14,
            background: theme.chrome,
            borderBottom: `0.5px solid ${theme.rule}`,
            position: "sticky",
            top: 0,
            zIndex: Z.panel,
          }}
        >
          <button
            onClick={exitSelection}
            aria-label={tr("downloads.delete.exitSelection")}
            style={{
              width: 32,
              height: 32,
              display: "grid",
              placeItems: "center",
              border: "none",
              background: "transparent",
              color: theme.muted,
              cursor: "pointer",
              borderRadius: 8,
            }}
          >
            <Icon name="close" size={15} />
          </button>
          <span style={{ fontWeight: 600, fontSize: 12.5 }}>
            {tr("downloads.delete.selectionCount", { n: selected.size })}
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => {
              // Candidate ids come from chapterFlags (rebuilt from the
              // full disk snapshot by refreshFlags), not novel.volumes.
              // For a lazy-volume source, a volume's chapters[] stays []
              // until the user expands it in THIS session — but
              // DownloadRangeDialog can populate chapterFlags for a
              // volume via setVolumeChapters without ever patching
              // novel.volumes (it doesn't call onNovelPatch). Building
              // "all" from novel.volumes would silently drop those
              // already-downloaded chapters from the selection. The
              // predicate itself still lives in chapterDeletion.ts, not
              // an inline filter — it's already unit-tested there.
              setSelected(
                new Set(
                  downloadedChapterIds(
                    Array.from(chapterFlags.keys()),
                    chapterFlags,
                  ),
                ),
              );
            }}
            style={{
              font: "inherit",
              fontSize: 11.5,
              paddingBlock: 6,
              paddingInline: 12,
              borderRadius: 999,
              border: `0.5px solid ${theme.rule}`,
              background: "transparent",
              color: theme.ink,
              cursor: "pointer",
            }}
          >
            {tr("downloads.delete.selectAllDownloaded")}
          </button>
          <button
            disabled={selected.size === 0 || deleting}
            onClick={() => stageDelete([...selected])}
            style={{
              font: "inherit",
              fontSize: 11.5,
              paddingBlock: 6,
              paddingInline: 12,
              borderRadius: 999,
              border: `0.5px solid ${theme.danger}`,
              background: theme.danger,
              // theme.bg, not #fff: theme.danger is a LIGHT red on the
              // dark themes (it has to clear AA against a near-black
              // background), and white on it measures under 3:1. Taking
              // the background as the label colour makes this ratio
              // identical to danger-vs-bg, which the token guarantees.
              color: theme.bg,
              cursor: selected.size === 0 || deleting ? "default" : "pointer",
              opacity: selected.size === 0 || deleting ? 0.45 : 1,
            }}
          >
            {tr(
              selected.size === 1
                ? "downloads.delete.confirmButtonOne"
                : "downloads.delete.confirmButtonOther",
              { n: selected.size },
            )}
          </button>
        </div>
      )}
      {deleteProgress && (
        // Sits outside the selection bar on purpose: the ⋯ menu's
        // "delete read"/"delete all" presets never enter selection
        // mode, so a counter living in that bar would be invisible for
        // exactly the biggest sweeps.
        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingBlock: 8,
            paddingInline: 14,
            borderRadius: 10,
            background: theme.chrome,
            border: `0.5px solid ${theme.rule}`,
            color: theme.muted,
            fontSize: 11.5,
          }}
        >
          <Icon name="trash" size={13} />
          <span>
            {tr("downloads.delete.deleting", {
              done: deleteProgress.done,
              total: deleteProgress.total,
            })}
          </span>
        </div>
      )}
      {novel.volumes.map((v) => {
        const isOpen = open.has(v.id);
        const count =
          v.chapters.length > 0 ? v.chapters.length : (v.chapterCount ?? 0);
        const volLoaded = v.chapters.length > 0;
        const volPending = volLoaded
          ? v.chapters.filter((c) => !chapterFlags.get(c.id)?.downloadedAt)
              .length
          : count;
        const volAllDownloaded = volLoaded && volPending === 0;
        const volDownloading = downloadingVol.has(v.id);
        return (
          <div
            key={v.id}
            style={{
              border: `0.5px solid ${isOpen ? theme.ruleStrong : theme.rule}`,
              borderRadius: 12,
              overflow: "hidden",
              background: isOpen ? theme.chrome : theme.bg,
              transition: transition("background", "fast", "out"),
            }}
          >
            <div style={{ display: "flex", alignItems: "stretch" }}>
              <button
                onClick={() => toggle(v.id)}
                aria-expanded={isOpen}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "13px 14px",
                  border: "none",
                  background: "transparent",
                  color: theme.ink,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textAlign: "start",
                }}
                onMouseEnter={(e) => {
                  if (!isOpen) e.currentTarget.style.background = theme.hover;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    minWidth: 0,
                  }}
                >
                  {/* Outer span mirrors the chevron in RTL; the inner span
                      rotates it between closed (points toward content) and open
                      (points down). Two layers so the rotate transform doesn't
                      clobber the rtl-flip. Reduced motion neutralizes the
                      rotation via the global transition-duration override. */}
                  <span
                    className="rtl-flip-x"
                    style={{
                      display: "inline-flex",
                      flexShrink: 0,
                      color: theme.muted,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        transition: transition("transform", "fast", "out"),
                        transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                      }}
                    >
                      <Icon name="chevronR" size={14} />
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {v.title}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: theme.muted,
                    flexShrink: 0,
                    padding: "3px 9px",
                    borderRadius: 999,
                    background: theme.bg,
                    border: `0.5px solid ${theme.rule}`,
                  }}
                >
                  {count > 0
                    ? tr("novel.chapterCountShort", { n: count })
                    : "—"}
                </span>
              </button>
              {libraryEntryId && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (volAllDownloaded || volDownloading) return;
                    // A lazy volume has no chapter list yet, so volPending is
                    // the source's reported count and nothing is known to be
                    // on disk — the fetch happens after the user confirms.
                    setVolumeConfirm({
                      id: v.id,
                      title: v.title,
                      pending: volPending,
                      skipped: volLoaded ? count - volPending : 0,
                    });
                  }}
                  disabled={volAllDownloaded || volDownloading}
                  title={
                    volAllDownloaded
                      ? tr("novel.volumeAllDownloaded")
                      : volDownloading
                        ? tr("novel.downloadingVolume")
                        : tr("novel.downloadVolume")
                  }
                  aria-label={
                    volAllDownloaded
                      ? tr("novel.volumeAllDownloaded")
                      : tr("novel.downloadVolume")
                  }
                  style={{
                    flexShrink: 0,
                    width: 42,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "none",
                    background: "transparent",
                    color: volAllDownloaded ? theme.muted : theme.ink,
                    cursor:
                      volAllDownloaded || volDownloading
                        ? "default"
                        : "pointer",
                    opacity: volDownloading ? 0.5 : volAllDownloaded ? 0.55 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!volAllDownloaded && !volDownloading) {
                      e.currentTarget.style.background = theme.hover;
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <Icon
                    name={volAllDownloaded ? "check" : "download"}
                    size={15}
                  />
                </button>
              )}
              {libraryEntryId && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    volumeMenuTriggerRef.current = e.currentTarget;
                    // Toggle, not open. DesktopPopover's outside-press
                    // listener skips this button, so a second click
                    // reaches here with the menu still open and closes
                    // it; a click on another volume's ⋯ arrives after
                    // that listener already closed the old one, so
                    // `prev` is null and the new volume opens.
                    setVolumeMenu((prev) =>
                      prev?.id === v.id
                        ? null
                        : {
                            id: v.id,
                            left: r.left,
                            right: r.right,
                            y: r.bottom,
                          },
                    );
                  }}
                  title={tr("downloads.delete.volumeActions")}
                  aria-label={tr("downloads.delete.volumeActions")}
                  style={{
                    flexShrink: 0,
                    width: 42,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "none",
                    background: "transparent",
                    color: theme.muted,
                    cursor: "pointer",
                  }}
                >
                  <Icon name="more" size={15} />
                </button>
              )}
            </div>
            {isOpen &&
              (() => {
                const isLoading = loadingVolumes.has(v.id);
                const err = errorByVolume.get(v.id);
                const empty = v.chapters.length === 0;
                if (err && empty) {
                  return (
                    <VolumeErrorPanel
                      theme={theme}
                      message={err}
                      onRetry={() => {
                        // Allow re-attempt: clear the "already
                        // expanded" memoization so loadVolume runs
                        // again on the next mount cycle.
                        expandedRef.current.delete(v.id);
                        void loadVolume(v.id);
                      }}
                    />
                  );
                }
                if (isLoading && empty) {
                  return (
                    <VolumeChaptersSkeleton
                      theme={theme}
                      rows={Math.min(v.chapterCount ?? 8, 12)}
                    />
                  );
                }
                return null;
              })()}
            {isOpen && v.chapters.length > 0 && (
              // Windowed: a big volume runs to ~950 chapters, and mounting
              // every row cost ~200ms and ~6.6k DOM nodes — after which every
              // download-queue tick re-reconciled all of them. Measured (not
              // fixed-height) because ~6% of chapter titles wrap to a second
              // line and clipping them would hide content.
              <MeasuredVirtualList
                items={v.chapters}
                estimatedItemHeight={CHAPTER_ROW_HEIGHT}
                itemKey={(c) => c.id}
                // Rows carry role="option"/aria-selected while selecting
                // (NovelDetailView's ChapterRow), so the container has to
                // switch from list/listitem to listbox/option in step —
                // `option` outside a `listbox` is not a valid ARIA
                // pairing and leaves selection-mode screen-reader
                // behaviour undefined.
                role={selecting ? "listbox" : "list"}
                ariaMultiselectable={selecting ? true : undefined}
                className="riwaq-scroll-hidden riwaq-collapse-enter"
                ariaLabel={v.title}
                style={{
                  margin: 0,
                  padding: "4px 0 8px",
                  borderTop: `0.5px solid ${theme.rule}`,
                  maxHeight: 360,
                  background: theme.bg,
                }}
                renderItem={(c) => (
                  <ChapterRow
                    theme={theme}
                    chapter={c}
                    direction={novel.direction}
                    read={!!chapterFlags.get(c.id)?.readAt}
                    downloaded={!!chapterFlags.get(c.id)?.downloadedAt}
                    libraryEntryId={libraryEntryId}
                    novelTitle={novel.title}
                    queueJob={activeJobs.get(c.id)}
                    onOpenChapter={onOpenChapter}
                    onRequestDelete={deleteOneChapter}
                    selecting={selecting}
                    selected={selected.has(c.id)}
                    onToggleSelect={toggleSelected}
                    onEnterSelection={enterSelection}
                  />
                )}
              />
            )}
          </div>
        );
      })}
      {(() => {
        // VolumeActionsMenu stays mounted regardless of `volumeMenu` —
        // only `open` toggles. On mobile this is load-bearing: its
        // MobileSheet plays a slide-down exit whose setTimeout unmount
        // never gets to run if the whole tree is torn down synchronously
        // in the same render that nulls `volumeMenu` (see AnimatedDialog's
        // and DownloadRangeDialog's identical always-mounted convention).
        // The derived values below tolerate `volumeMenu === null` — once
        // closed, MobileSheet freezes its last (non-empty) children for
        // the exit animation, so these empty fallbacks are never actually
        // painted; they just keep this block safe to evaluate every render.
        const vol = volumeMenu
          ? novel.volumes.find((v) => v.id === volumeMenu.id)
          : undefined;
        const all = (vol?.chapters ?? []).map((c) => c.id);
        // Predicates live in chapterDeletion.ts, not inline here —
        // "both downloaded AND read" is the kind of condition that
        // quietly drifts, and it needs a test.
        const downloaded = downloadedChapterIds(all, chapterFlags);
        const read = readDownloadedChapterIds(all, chapterFlags);
        return (
          <VolumeActionsMenu
            theme={theme}
            layout={layout}
            open={volumeMenu !== null}
            anchor={
              volumeMenu
                ? {
                    left: volumeMenu.left,
                    right: volumeMenu.right,
                    y: volumeMenu.y,
                  }
                : null
            }
            triggerRef={volumeMenuTriggerRef}
            title={vol?.title ?? ""}
            // Not novel.chapterCountShort ("{n} ch."): a 200-chapter
            // volume with 12 downloads rendered "12 ch." under its own
            // title, which reads as the volume's size rather than its
            // download count. Wrong in both languages.
            subtitle={
              all.length > 0
                ? tr("downloads.delete.downloadedCount", {
                    n: downloaded.length,
                  })
                : ""
            }
            // Say why, when both rows come up disabled. A lazy-volume
            // source hands us chapters: [] until the volume is expanded
            // in this session, so "nothing downloaded" and "we haven't
            // looked yet" are different states and only one of them is
            // the user's problem to fix. Loading the volume from here
            // is deliberately deferred.
            note={
              all.length === 0
                ? tr("downloads.delete.volumeNotLoaded")
                : downloaded.length === 0
                  ? tr("downloads.delete.nothingToDelete")
                  : undefined
            }
            actions={[
              {
                id: "delete-read",
                label: tr("downloads.delete.deleteRead"),
                icon: "trash",
                destructive: true,
                disabled: read.length === 0 || deleting,
              },
              {
                id: "delete-all",
                label: tr("downloads.delete.deleteAllInVolume"),
                icon: "trash",
                destructive: true,
                disabled: downloaded.length === 0 || deleting,
              },
            ]}
            onPick={(id) => {
              stageDelete(id === "delete-read" ? read : downloaded);
            }}
            onClose={closeVolumeMenu}
          />
        );
      })()}

      <AnimatedDialog
        open={deleteConfirm !== null}
        onScrimClick={() => setDeleteConfirm(null)}
        zIndex={Z.menuDialog}
      >
        {deleteConfirm && (
          <ConfirmDialog
            theme={theme}
            title={tr(
              deleteConfirm.ids.length === 1
                ? "downloads.delete.confirmTitleOne"
                : "downloads.delete.confirmTitleOther",
              { n: deleteConfirm.ids.length },
            )}
            confirmVariant="destructive"
            confirmLabel={tr(
              deleteConfirm.ids.length === 1
                ? "downloads.delete.confirmButtonOne"
                : "downloads.delete.confirmButtonOther",
              { n: deleteConfirm.ids.length },
            )}
            cancelLabel={tr("common.cancel")}
            message={
              <>
                {tr("downloads.delete.confirmBody")}
                {deleteConfirm.conversionActive && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginBlockStart: 10,
                      // theme.ink against the dialog body's theme.muted,
                      // plus the icon: the warning must not rest on
                      // colour alone.
                      color: theme.ink,
                    }}
                  >
                    <Icon
                      name="info"
                      size={14}
                      style={{ flexShrink: 0, marginBlockStart: 2 }}
                    />
                    <span>{tr("downloads.delete.conversionRunning")}</span>
                  </div>
                )}
              </>
            }
            onConfirm={() => {
              const ids = deleteConfirm.ids;
              setDeleteConfirm(null);
              void runBulkDelete(ids);
            }}
            onCancel={() => setDeleteConfirm(null)}
          />
        )}
      </AnimatedDialog>

      {/* AnimatedDialog stays mounted and takes `open` as a prop — it keeps the
          last children around to play the exit animation. Unmounting the whole
          thing on cancel would snap it off-screen instead. */}
      <AnimatedDialog
        open={volumeConfirm !== null}
        onScrimClick={() => setVolumeConfirm(null)}
        zIndex={Z.menuDialog}
      >
        {volumeConfirm && (
          <ConfirmDialog
            theme={theme}
            title={tr("novel.downloadVolumeConfirmTitle")}
            // Queuing downloads is additive and cancellable from the queue
            // page, so this is a primary action, not a destructive one.
            confirmVariant="primary"
            confirmLabel={tr("downloads.range.queueButton", {
              n: volumeConfirm.pending,
            })}
            cancelLabel={tr("common.cancel")}
            message={
              <>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>
                  {volumeConfirm.title}
                </div>
                {tr(
                  volumeConfirm.pending === 1
                    ? "downloads.range.queueCountOne"
                    : "downloads.range.queueCountOther",
                  {
                    n: volumeConfirm.pending,
                    extra:
                      volumeConfirm.skipped > 0
                        ? tr("downloads.range.alreadyOnDisk", {
                            n: volumeConfirm.skipped,
                          })
                        : "",
                  },
                )}
              </>
            }
            onConfirm={() => {
              const id = volumeConfirm.id;
              setVolumeConfirm(null);
              void downloadVolume(id);
            }}
            onCancel={() => setVolumeConfirm(null)}
          />
        )}
      </AnimatedDialog>
      <Toast theme={theme} toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
