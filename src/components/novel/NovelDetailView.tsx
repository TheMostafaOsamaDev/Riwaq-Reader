// One novel's detail page inside the Store.
//
// The page's own state lives here; each band of it renders from a file beside
// this one — NovelHero, NovelAbout, ChapterSearch, VolumesAccordion (with
// ChapterRow and VolumePlaceholders under it).
//
// Layout from top to bottom:
//   - Header: cover + title + original title + status badge + meta (author,
//     translator, year, type, …) + genre chips
//   - Description (collapsed to ~5 lines; "more" expands)
//   - Action row: Read · Add to library · Download range
//   - Volumes accordion — each volume is collapsible; expanded reveals
//     the chapter list. Clicking a chapter opens the streaming reader at
//     that chapter.
//
// All scrape calls go through getSource(sourceId). Errors land in the
// inline error pane; nothing here owns long-running tasks (the importer
// reports through the global progress modal).

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSource, getSourceMeta } from "../../sources/registry";
import {
  addNovelToLibrary,
  coverSrcFor,
  deleteBook,
  findSourceEntry,
  getEntry,
} from "../../store/library";
import type { Source, SourceNovel } from "../../sources/types";

import { FONT_STACKS, type Theme } from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import { Icon } from "../Icon";
import { NovelHeaderSkeleton, VolumesSkeleton } from "../Skeleton";
import { SaveAsOfflineBookDialog } from "../SaveAsOfflineBookDialog";
import { ShelfChecklist } from "../ShelfChecklist";
import type { Shelf } from "../../store/shelves";
import { ChapterSearch } from "./ChapterSearch";
import { NovelAbout } from "./NovelAbout";
import { NovelHero } from "./NovelHero";
import { VolumesAccordion } from "./VolumesAccordion";
import { buildFlagMap } from "./flagMap";

interface Props {
  theme: Theme;
  layout: "desktop" | "mobile";
  sourceId: string;
  novelUrl: string;
  /** Library entry id when this view is opened from a shelf card. The
   *  view then loads its metadata + chapter listing from the persisted
   *  source.json (offline-first), and surfaces per-chapter download
   *  icons + read-state dimming wired to the same entry. Undefined
   *  when opened from the Store before the novel is in the library —
   *  the view falls back to a live `source.getNovel` fetch and hides
   *  the offline-only affordances. */
  libraryEntryId?: string;
  onBack: () => void;
  /** Open the streaming reader at this chapter (or the first chapter when
   *  undefined — used by the top-level "Read" action). */
  onStreamRead: (chapterId?: number) => void;
  /** Notifies the parent Library to refresh its shelf after an import
   *  finishes. */
  onImportComplete: () => void;
  onOpenRangeDialog: () => void;
  /** Shelves membership plumbing for the hero "Shelves" action — all
   *  optional so call sites that don't (yet) support shelves, like the
   *  Store's browsing detail view for a novel not in the library, keep
   *  compiling and simply don't render the button. Only rendered together
   *  when the book is in the library AND these are provided. */
  shelves?: Shelf[];
  /** This book's current shelf ids (its `shelfIds`). */
  bookShelfIds?: string[];
  onToggleShelf?: (shelfId: string) => void;
  /** Opens the "new shelf" dialog (rendered by the parent Library). */
  onNewShelfFromDetail?: () => void;
}

interface State {
  loading: boolean;
  error: string | null;
  novel: SourceNovel | null;
}

export function NovelDetailView({
  theme,
  layout,
  sourceId,
  novelUrl,
  libraryEntryId: libraryEntryIdProp,
  onBack,
  onStreamRead,
  onImportComplete,
  onOpenRangeDialog,
  shelves,
  bookShelfIds,
  onToggleShelf,
  onNewShelfFromDetail,
}: Props) {
  const { tr } = useI18n();
  const source = useMemo<Source | null>(() => getSource(sourceId), [sourceId]);
  const [state, setState] = useState<State>({
    loading: true,
    error: null,
    novel: null,
  });
  // Tracks whether this novel is in the library and, if so, the entry's
  // id (so Remove can target it). Null = not in library, undefined =
  // not yet checked (initial mount, before findSourceEntry resolves).
  // When the parent already knows the entry id (Library card open path),
  // we skip the lookup entirely.
  const [libraryEntryId, setLibraryEntryId] = useState<
    string | null | undefined
  >(libraryEntryIdProp ?? undefined);
  // The on-disk cover `addNovelToLibrary` saved, once we know this novel is in
  // the library. Null until resolved (or when it has none), which is why the
  // remote URL stays in the candidate list behind it.
  const [localCoverUrl, setLocalCoverUrl] = useState<string | null>(null);
  // Persisted chapter flags (downloadedAt, readAt) keyed by chapter id.
  // Refreshed on snapshot load and after a download mutation. Always an
  // empty map when there's no library entry (the Store-side detail
  // view stays free of offline-only affordances).
  const [chapterFlags, setChapterFlags] = useState<
    Map<number, { downloadedAt?: number; readAt?: number }>
  >(new Map());
  const [working, setWorking] = useState(false);
  // "Save as offline book" dialog is only relevant for in-library
  // source-backed entries (it walks the persisted snapshot). Mounted
  // here so its data load can coexist with NovelDetailView's
  // background snapshot refresh without prop drilling.
  const [saveOfflineOpen, setSaveOfflineOpen] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  // "Shelves" checklist popover — only ever opened when the hero button
  // that triggers it is rendered, which itself requires `libraryEntryId`,
  // `shelves`, and `onToggleShelf` (see the `onOpenShelfList` guard below).
  const [shelfListOpen, setShelfListOpen] = useState(false);

  // Two data sources, selected by `libraryEntryIdProp`:
  //   - in-library:  read source.json from disk, then refresh from
  //                  network in the background so the user sees newly
  //                  published chapters next time they reopen.
  //   - not yet:     direct source.getNovel call (existing flow).
  //
  // The local-first path swaps the chapter listing in-place on refresh
  // success — chapter flags are preserved because writeSnapshotFromSourceNovel
  // merges by URL.
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setState({ loading: true, error: null, novel: null });
    setChapterFlags(new Map());

    const fetchFromSource = async () => {
      const novel = await source.getNovel(novelUrl);
      if (cancelled) return;
      if (libraryEntryIdProp) {
        // Library-backed: write the snapshot first so the merge
        // carries forward any chapters loaded by `loadVolume` after
        // the initial snapshot read, THEN render from the merged
        // snapshot. The naive `setState({novel})` would replace the
        // in-memory state with the bare getNovel result (empty
        // volumes for lazy sources), wiping the chapters the user
        // just lazy-loaded — that's the "stuck skeleton" bug.
        const { writeSnapshotFromSourceNovel, snapshotToSourceNovel } =
          await import("../../store/sourceLibrary");
        const snap = await writeSnapshotFromSourceNovel(
          libraryEntryIdProp,
          sourceId,
          novelUrl,
          novel,
        );
        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          novel: snapshotToSourceNovel(snap),
        });
        setChapterFlags(buildFlagMap(snap));
      } else {
        setState({ loading: false, error: null, novel });
      }
    };

    (async () => {
      try {
        if (libraryEntryIdProp) {
          const { readSnapshot, snapshotToSourceNovel } = await import(
            "../../store/sourceLibrary"
          );
          const snap = await readSnapshot(libraryEntryIdProp);
          if (snap && !cancelled) {
            setState({
              loading: false,
              error: null,
              novel: snapshotToSourceNovel(snap),
            });
            setChapterFlags(buildFlagMap(snap));
            // Refresh from network in the background; failure is
            // silent — the local copy stays visible.
            fetchFromSource().catch(() => {});
            return;
          }
          // No snapshot on disk yet — fall through to a normal fetch
          // and writeSnapshot.
        }
        await fetchFromSource();
      } catch (e) {
        if (cancelled) return;
        setState({
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          novel: null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, novelUrl, sourceId, libraryEntryIdProp]);

  // Look up whether this novel is already in the library. Skipped when
  // the parent passed `libraryEntryIdProp` (Library card open path);
  // the lookup is only for the Store-side detail view where we
  // didn't navigate from a shelf card.
  useEffect(() => {
    // The id is known synchronously on the Library-card path, so set it
    // without waiting — only the cover lookup needs to be async.
    if (libraryEntryIdProp !== undefined) setLibraryEntryId(libraryEntryIdProp);
    let cancelled = false;
    (async () => {
      const entry =
        libraryEntryIdProp !== undefined
          ? libraryEntryIdProp
            ? await getEntry(libraryEntryIdProp)
            : null
          : await findSourceEntry(sourceId, novelUrl);
      if (cancelled) return;
      if (libraryEntryIdProp === undefined)
        setLibraryEntryId(entry?.id ?? null);
      // This is what keeps opening a saved novel off the network: the cover
      // was fetched once at save time and has been on disk ever since.
      const local = entry ? await coverSrcFor(entry) : null;
      if (!cancelled) setLocalCoverUrl(local);
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceId, novelUrl, libraryEntryIdProp]);

  // Stable identity: it's threaded down to every memoized ChapterRow, and an
  // inline arrow here would defeat the memo on each parent re-render.
  const openChapter = useCallback(
    (chapterId: number) => onStreamRead(chapterId),
    [onStreamRead],
  );

  const onAddToLibrary = useCallback(async () => {
    if (working) return;
    const novel = state.novel;
    // The button is only rendered once the novel has loaded, so this is a
    // guard for the type, not a case that happens.
    if (!novel) return;
    setWorking(true);
    try {
      const entry = await addNovelToLibrary(sourceId, novelUrl, novel);
      setLibraryEntryId(entry.id);
      onImportComplete();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("addNovelToLibrary failed:", e);
    } finally {
      setWorking(false);
    }
  }, [working, sourceId, novelUrl, state.novel, onImportComplete]);

  const onRemoveFromLibrary = useCallback(async () => {
    if (working || !libraryEntryId) return;
    if (!confirm(tr("novel.removeConfirm"))) {
      return;
    }
    setWorking(true);
    try {
      await deleteBook(libraryEntryId);
      setLibraryEntryId(null);
      onImportComplete();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("deleteBook failed:", e);
    } finally {
      setWorking(false);
    }
  }, [working, libraryEntryId, onImportComplete, tr]);

  if (!source) {
    return (
      <div style={{ padding: 40, color: theme.muted }}>
        {tr("store.notInstalled", { sourceId })}
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        fontFamily: FONT_STACKS.sans,
        color: theme.ink,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: layout === "mobile" ? "14px 18px 8px" : "18px 40px 8px",
        }}
      >
        <button
          onClick={onBack}
          aria-label={tr("common.back")}
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            border: `0.5px solid ${theme.rule}`,
            background: theme.bg,
            color: theme.ink,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon name="arrowL" size={16} className="rtl-flip-x" />
        </button>
      </div>

      {state.loading ? (
        <>
          <NovelHeaderSkeleton theme={theme} layout={layout} />
          <VolumesSkeleton theme={theme} layout={layout} />
        </>
      ) : state.error || !state.novel ? (
        <div
          style={{
            margin: 32,
            padding: 24,
            background: "rgba(180,60,60,0.10)",
            border: "0.5px solid rgba(180,60,60,0.4)",
            borderRadius: 10,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {tr("novel.loadError", {
            error: state.error ?? tr("novel.noDataReturned"),
          })}
        </div>
      ) : (
        <>
          <NovelHero
            localCoverUrl={localCoverUrl}
            theme={theme}
            layout={layout}
            novel={state.novel}
            sourceName={source.meta.name}
            sourceIconUrl={getSourceMeta(source.meta.id)?.iconUrl}
            working={working}
            chapterCount={state.novel.volumes.reduce(
              (a, v) => a + v.chapters.length,
              0,
            )}
            inLibrary={libraryEntryId != null}
            libraryCheckDone={libraryEntryId !== undefined}
            onRead={() => onStreamRead(undefined)}
            onAddToLibrary={onAddToLibrary}
            onRemoveFromLibrary={onRemoveFromLibrary}
            onOpenRangeDialog={onOpenRangeDialog}
            onOpenSaveOffline={
              libraryEntryId ? () => setSaveOfflineOpen(true) : undefined
            }
            onOpenShelfList={
              libraryEntryId != null && shelves && onToggleShelf
                ? () => setShelfListOpen(true)
                : undefined
            }
          />
          {shelfListOpen && shelves && onToggleShelf && (
            <ShelfChecklist
              theme={theme}
              shelves={shelves}
              memberIds={bookShelfIds ?? []}
              onToggle={onToggleShelf}
              onNewShelf={() => {
                setShelfListOpen(false);
                onNewShelfFromDetail?.();
              }}
              onClose={() => setShelfListOpen(false)}
            />
          )}
          <NovelAbout
            theme={theme}
            layout={layout}
            novel={state.novel}
            showFullDesc={showFullDesc}
            setShowFullDesc={setShowFullDesc}
          />
          {saveOfflineOpen && libraryEntryId && state.novel && (
            <SaveAsOfflineBookDialog
              theme={theme}
              layout={layout}
              libraryEntryId={libraryEntryId}
              novelTitle={state.novel.title}
              onCancel={() => setSaveOfflineOpen(false)}
              onEnqueued={() => setSaveOfflineOpen(false)}
            />
          )}
          {typeof source.searchChapters === "function" && (
            <ChapterSearch
              theme={theme}
              layout={layout}
              source={source}
              novel={state.novel}
              novelUrl={novelUrl}
              onOpenChapter={openChapter}
            />
          )}
          <VolumesAccordion
            theme={theme}
            layout={layout}
            source={source}
            novel={state.novel}
            novelUrl={novelUrl}
            libraryEntryId={libraryEntryId ?? undefined}
            chapterFlags={chapterFlags}
            onOpenChapter={openChapter}
            onChapterFlagsChange={setChapterFlags}
            onNovelPatch={(updater) =>
              setState((s) => ({
                ...s,
                novel:
                  typeof updater === "function" ? updater(s.novel) : updater,
              }))
            }
          />
        </>
      )}
    </div>
  );
}

// ── hero (cinematic header) ──────────────────────────────────────────────────
