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
//
// getSource can answer null — the extension behind a saved novel can be
// uninstalled, or fail to load, at any time. That does NOT blank the page:
// everything the user saved (metadata, chapter listing, downloaded
// chapters) is on disk and renders exactly as it always does, with an
// ExtensionNotice above it and every control that would need the network
// disabled in place rather than hidden. Only a novel with no snapshot at
// all falls back to the bare "isn't installed" line, because then there
// genuinely is nothing to show.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getExtensionError,
  getExtensionStatus,
  getSource,
  getSourceMeta,
} from "../../sources/registry";
import { useLoadedExtensions } from "../../sources/useExtensions";
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
import { ExtensionNotice, type ExtensionProblem } from "./ExtensionNotice";
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
  // The registry is loaded from here, not only from the Store's mount. This
  // page is reachable from a library card without the Store ever having been
  // opened in the session (DesktopLibrary/MobileLibrary render one OR the
  // other — they are arms of the same ternary), and then every lookup below
  // answered "not installed" for an extension that is installed and working:
  // the banner said so, and per-chapter download, per-volume download,
  // Download range, Save as offline book and opening an undownloaded chapter
  // were all switched off.
  //
  // `revision` is in each dependency list below so the page re-reads the
  // registry and corrects itself when the load commits. Loading from HERE —
  // a view the user navigated to — rather than from the Library's mount or
  // app startup is the same placement argument the Store rests on; see
  // sources/useExtensions.ts.
  const revision = useLoadedExtensions();
  const source = useMemo<Source | null>(
    () => getSource(sourceId),
    [sourceId, revision],
  );
  // Display metadata comes from the registry: the contract's `Source` has no
  // `meta` — an extension does not declare its own catalogue entry, the host
  // builds one from its manifest.
  const sourceMeta = useMemo(
    () => getSourceMeta(sourceId),
    [sourceId, revision],
  );
  // Why the source is unusable, when it is. "missing" (never installed or
  // removed) reads differently from "broken" (installed, wouldn't load) and
  // "api-version" (installed, wants a newer app) — they have different
  // fixes, so the banner says different things. `null` while the source
  // works, which is also what turns every gate below off.
  const problem = useMemo<ExtensionProblem | null>(() => {
    if (source) return null;
    const status = getExtensionStatus(sourceId);
    return status === "ok" ? "missing" : status;
  }, [source, sourceId, revision]);
  const extensionError = useMemo(
    () => (problem === "broken" ? getExtensionError(sourceId) : undefined),
    [problem, sourceId, revision],
  );
  // A removed extension takes its manifest — and so its display name —
  // with it, leaving the id as the only thing left to call it.
  const sourceLabel = sourceMeta?.name ?? sourceId;
  /** Hover/focus text for every control this page had to switch off. Null
   *  when the source works, which is how each call site decides. */
  const disabledReason = problem
    ? tr("novel.offline.needsExtension", { source: sourceLabel })
    : null;
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

  // Three data sources, in order of preference:
  //   - in-library:  read source.json from disk, then refresh from
  //                  network in the background so the user sees newly
  //                  published chapters next time they reopen.
  //   - not yet:     direct source.getNovel call (existing flow).
  //   - no source:   the snapshot alone, and nothing else. Same render
  //                  path as the first case with the refresh left off —
  //                  a second one would be a second thing to keep right.
  //
  // The local-first path swaps the chapter listing in-place on refresh
  // success — chapter flags are preserved because writeSnapshotFromSourceNovel
  // merges by URL.
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, novel: null });
    setChapterFlags(new Map());

    const fetchFromSource = async (src: Source) => {
      const novel = await src.getNovel(novelUrl);
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
        // Which entry's snapshot we may render. Handed to us on the
        // library-card path; looked up only when there is no source,
        // because then the snapshot is the ONLY thing that can fill this
        // page and it would be perverse not to go and find it.
        let entryId = libraryEntryIdProp;
        if (!entryId && !source) {
          entryId = (await findSourceEntry(sourceId, novelUrl))?.id;
          if (cancelled) return;
        }
        if (entryId) {
          const { readSnapshot, snapshotToSourceNovel } = await import(
            "../../store/sourceLibrary"
          );
          const snap = await readSnapshot(entryId);
          if (snap && !cancelled) {
            setState({
              loading: false,
              error: null,
              novel: snapshotToSourceNovel(snap),
            });
            setChapterFlags(buildFlagMap(snap));
            // Refresh from network in the background; failure is
            // silent — the local copy stays visible.
            if (source) fetchFromSource(source).catch(() => {});
            return;
          }
          // No snapshot on disk yet — fall through to a normal fetch
          // and writeSnapshot.
        }
        if (!source) {
          // Nothing saved, and nothing left to fetch it with. The render
          // below turns this into the plain "isn't installed" line, which
          // is the honest answer: there is no novel here.
          if (!cancelled)
            setState({ loading: false, error: null, novel: null });
          return;
        }
        await fetchFromSource(source);
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
      // Local only — index entry + chapter listing from what's already on
      // screen. This is the whole of what the user waits for.
      const entry = await addNovelToLibrary(sourceId, novelUrl, novel);
      setLibraryEntryId(entry.id);
      onImportComplete();
      // The cover is the only part that needs the network, so it goes to
      // the queue: system notification, foreground service, cancel and
      // retry, all already built. Nothing here awaits it.
      if (novel.coverUrl) {
        const { enqueueLibraryAdd } = await import("../../store/downloadQueue");
        enqueueLibraryAdd({
          libraryEntryId: entry.id,
          novelTitle: novel.title,
          sourceId,
          novelUrl,
          coverUrl: novel.coverUrl,
        });
      }
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

  // Nothing on disk AND nothing to fetch with. Not an error pane — there is
  // no failure to report, only a novel this device has never had.
  if (!source && !state.loading && !state.novel) {
    return (
      <div style={{ padding: 40, color: theme.muted }}>
        {tr("store.notInstalled", { sourceId })}
      </div>
    );
  }

  // The first downloaded chapter, for the hero's Read action when there is
  // no source left to stream the rest with. Undefined when nothing is
  // downloaded, which is also when Read comes up disabled.
  const firstDownloadedChapterId = !problem
    ? undefined
    : state.novel?.volumes
        .flatMap((v) => v.chapters)
        .find((c) => chapterFlags.get(c.id)?.downloadedAt)?.id;

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
          {problem && (
            <ExtensionNotice
              theme={theme}
              layout={layout}
              problem={problem}
              sourceName={sourceLabel}
              error={extensionError}
            />
          )}
          <NovelHero
            localCoverUrl={localCoverUrl}
            theme={theme}
            layout={layout}
            novel={state.novel}
            sourceName={sourceLabel}
            sourceIconUrl={sourceMeta?.iconUrl}
            working={working}
            chapterCount={state.novel.volumes.reduce(
              (a, v) => a + v.chapters.length,
              0,
            )}
            inLibrary={libraryEntryId != null}
            libraryCheckDone={libraryEntryId !== undefined}
            // With no source there is nothing to stream, so Read means
            // "open the first chapter that IS on this device" — and says
            // why when there isn't one.
            onRead={() => onStreamRead(firstDownloadedChapterId)}
            readDisabledReason={
              problem && firstDownloadedChapterId === undefined
                ? tr("novel.offline.nothingDownloaded", { source: sourceLabel })
                : undefined
            }
            downloadDisabledReason={disabledReason ?? undefined}
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
          {/* Chapter search is a live query against the site. No source,
              no search — there is nothing to disable, the affordance
              simply has no offline meaning. */}
          {source && typeof source.searchChapters === "function" && (
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
            disabledReason={disabledReason}
            offlineSourceName={problem ? sourceLabel : undefined}
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
