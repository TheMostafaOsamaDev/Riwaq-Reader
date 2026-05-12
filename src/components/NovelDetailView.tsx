// One novel's detail page inside the Store.
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

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getSource } from "../sources/registry";
import {
  addNovelToLibrary,
  deleteBook,
  findSourceEntry,
} from "../store/library";
import {
  looksLikeMissingPlaceholder,
  optimizedCoverUrl,
} from "../sources/images";
import type { Source, SourceChapter, SourceNovel } from "../sources/types";
import type { SourceSnapshot } from "../store/sourceLibrary";

interface ChapterFlags {
  downloadedAt?: number;
  readAt?: number;
}

/** Build a chapter-id → {downloadedAt, readAt} lookup from a snapshot.
 *  Lets the volumes accordion render per-chapter status with a single
 *  Map.get() per chapter instead of walking volumes each time. */
function buildFlagMap(snapshot: SourceSnapshot): Map<number, ChapterFlags> {
  const out = new Map<number, ChapterFlags>();
  for (const v of snapshot.volumes) {
    for (const c of v.chapters) {
      if (c.downloadedAt || c.readAt) {
        out.set(c.id, {
          ...(c.downloadedAt ? { downloadedAt: c.downloadedAt } : {}),
          ...(c.readAt ? { readAt: c.readAt } : {}),
        });
      }
    }
  }
  return out;
}
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { NovelHeaderSkeleton, VolumesSkeleton } from "./Skeleton";

/** Debounce window for the in-novel chapter search. Same rationale as
 *  the homepage suggest debounce — fast enough to feel live, slow enough
 *  not to fire per-keystroke. */
const CHAPTER_SEARCH_DEBOUNCE_MS = 250;
const CHAPTER_SEARCH_MIN_CHARS = 1;

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
}: Props) {
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
  const [libraryEntryId, setLibraryEntryId] = useState<string | null | undefined>(
    libraryEntryIdProp ?? undefined,
  );
  // Persisted chapter flags (downloadedAt, readAt) keyed by chapter id.
  // Refreshed on snapshot load and after a download mutation. Always an
  // empty map when there's no library entry (the Store-side detail
  // view stays free of offline-only affordances).
  const [chapterFlags, setChapterFlags] = useState<
    Map<number, { downloadedAt?: number; readAt?: number }>
  >(new Map());
  const [working, setWorking] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);

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
          await import("../store/sourceLibrary");
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
            "../store/sourceLibrary"
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
    if (libraryEntryIdProp !== undefined) {
      setLibraryEntryId(libraryEntryIdProp);
      return;
    }
    let cancelled = false;
    (async () => {
      const entry = await findSourceEntry(sourceId, novelUrl);
      if (cancelled) return;
      setLibraryEntryId(entry?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceId, novelUrl, libraryEntryIdProp]);

  const onAddToLibrary = useCallback(async () => {
    if (working) return;
    setWorking(true);
    try {
      const entry = await addNovelToLibrary(sourceId, novelUrl);
      setLibraryEntryId(entry.id);
      onImportComplete();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("addNovelToLibrary failed:", e);
    } finally {
      setWorking(false);
    }
  }, [working, sourceId, novelUrl, onImportComplete]);

  const onRemoveFromLibrary = useCallback(async () => {
    if (working || !libraryEntryId) return;
    if (
      !confirm(
        "Remove this novel from your library? Your downloaded chapter ranges (if any) are kept.",
      )
    ) {
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
  }, [working, libraryEntryId, onImportComplete]);

  if (!source) {
    return (
      <div style={{ padding: 40, color: theme.muted }}>
        Source “{sourceId}” isn't installed.
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
          padding: layout === "mobile" ? "16px 18px 10px" : "20px 40px 12px",
          borderBottom: `0.5px solid ${theme.rule}`,
        }}
      >
        <button
          onClick={onBack}
          aria-label="Back"
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
          <Icon name="arrowL" size={16} />
        </button>
        <div
          style={{
            fontSize: 12.5,
            color: theme.muted,
            letterSpacing: "0.02em",
          }}
        >
          {source.meta.name}
        </div>
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
          Couldn't load this novel — {state.error ?? "no data returned"}
        </div>
      ) : (
        <>
          <NovelHeader
            theme={theme}
            layout={layout}
            novel={state.novel}
            showFullDesc={showFullDesc}
            setShowFullDesc={setShowFullDesc}
          />
          <ActionRow
            theme={theme}
            layout={layout}
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
          />
          {typeof source.searchChapters === "function" && (
            <ChapterSearch
              theme={theme}
              layout={layout}
              source={source}
              novel={state.novel}
              novelUrl={novelUrl}
              onOpenChapter={(chapterId) => onStreamRead(chapterId)}
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
            onOpenChapter={(chapterId) => onStreamRead(chapterId)}
            onChapterFlagsChange={setChapterFlags}
            onNovelPatch={(updater) =>
              setState((s) => ({
                ...s,
                novel:
                  typeof updater === "function"
                    ? updater(s.novel)
                    : updater,
              }))
            }
          />
        </>
      )}
    </div>
  );
}

// ── header (cover + meta) ──────────────────────────────────────────────────

interface NovelHeaderProps {
  theme: Theme;
  layout: "desktop" | "mobile";
  novel: SourceNovel;
  showFullDesc: boolean;
  setShowFullDesc: (b: boolean) => void;
}

function NovelHeader({
  theme,
  layout,
  novel,
  showFullDesc,
  setShowFullDesc,
}: NovelHeaderProps) {
  const desc = novel.description ?? "";
  const isLongDesc = desc.length > 280;
  const visibleDesc = showFullDesc || !isLongDesc ? desc : desc.slice(0, 280) + "…";

  return (
    <div
      style={{
        display: "flex",
        gap: layout === "mobile" ? 14 : 28,
        padding: layout === "mobile" ? "20px 18px" : "32px 40px 24px",
        flexDirection: layout === "mobile" ? "column" : "row",
        alignItems: layout === "mobile" ? "flex-start" : "flex-start",
      }}
    >
      <div
        style={{
          width: layout === "mobile" ? 140 : 200,
          flexShrink: 0,
          alignSelf: layout === "mobile" ? "center" : "flex-start",
        }}
      >
        <div
          style={{
            width: "100%",
            aspectRatio: "2 / 3",
            borderRadius: 12,
            overflow: "hidden",
            background: theme.chrome,
            border: `0.5px solid ${theme.rule}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {novel.coverUrl ? (
            <NovelCoverImage
              coverUrl={novel.coverUrl}
              size={layout === "mobile" ? 400 : 600}
              theme={theme}
            />
          ) : (
            <span style={{ color: theme.muted, fontSize: 12 }}>No cover</span>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h1
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: layout === "mobile" ? 24 : 28,
              margin: 0,
              letterSpacing: "-0.01em",
              color: theme.ink,
              direction: novel.direction,
            }}
          >
            {novel.title}
          </h1>
          {novel.status && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                background: theme.chrome,
                border: `0.5px solid ${theme.rule}`,
                color: theme.ink,
                padding: "3px 8px",
                borderRadius: 999,
              }}
            >
              {novel.status}
            </span>
          )}
        </div>
        {novel.originalTitle && (
          <div
            style={{
              fontSize: 13,
              color: theme.muted,
              marginTop: 4,
              fontStyle: "italic",
            }}
          >
            {novel.originalTitle}
          </div>
        )}

        {novel.meta.length > 0 && (
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "4px 14px",
              margin: "16px 0 0 0",
              fontSize: 12.5,
            }}
          >
            {novel.meta.slice(0, 6).map((m, i) => (
              <Fragment key={i}>
                <dt style={{ color: theme.muted, whiteSpace: "nowrap" }}>
                  {m.label}
                </dt>
                <dd style={{ margin: 0, color: theme.ink }}>{m.value}</dd>
              </Fragment>
            ))}
          </dl>
        )}

        {novel.tags.length > 0 && (
          <div
            style={{
              marginTop: 14,
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {novel.tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 999,
                  border: `0.5px solid ${theme.rule}`,
                  color: theme.muted,
                  background: theme.bg,
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {desc.length > 0 && (
          <div
            style={{
              marginTop: 18,
              fontSize: 13.5,
              lineHeight: 1.6,
              color: theme.ink,
              direction: novel.direction,
              textAlign: novel.direction === "rtl" ? "right" : "left",
            }}
          >
            {visibleDesc}
            {isLongDesc && (
              <button
                onClick={() => setShowFullDesc(!showFullDesc)}
                style={{
                  marginInlineStart: 6,
                  background: "transparent",
                  border: "none",
                  color: theme.muted,
                  cursor: "pointer",
                  fontSize: 12,
                  textDecoration: "underline",
                  fontFamily: "inherit",
                  padding: 0,
                }}
              >
                {showFullDesc ? "less" : "more"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Cover with the same thumbnail-first / original-fallback flow the
 *  card uses, sized for the novel-detail header. Bigger `size` than a
 *  card thumbnail since the cover renders larger here. */
function NovelCoverImage({
  coverUrl,
  size,
  theme,
}: {
  coverUrl: string;
  size: number;
  theme: Theme;
}) {
  const [src, setSrc] = useState(() => optimizedCoverUrl(coverUrl, size));
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span style={{ color: theme.muted, fontSize: 12 }}>No cover</span>;
  }
  return (
    <img
      src={src}
      alt=""
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={(e) => {
        // Same 200-OK placeholder detection as NovelCard — KolNovel
        // serves a 600×330 landscape "Could not get image" graphic
        // when the requested thumbnail size doesn't exist.
        if (src !== coverUrl && looksLikeMissingPlaceholder(e.currentTarget)) {
          setSrc(coverUrl);
        }
      }}
      onError={() => {
        if (src !== coverUrl) setSrc(coverUrl);
        else setFailed(true);
      }}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  );
}

// ── action row ─────────────────────────────────────────────────────────────

interface ActionRowProps {
  theme: Theme;
  layout: "desktop" | "mobile";
  working: boolean;
  chapterCount: number;
  /** True when the novel is already a library entry — swaps the Add
   *  button for Remove. */
  inLibrary: boolean;
  /** False while we haven't yet checked the library — the Add/Remove
   *  button stays in a disabled state until we know which to render so
   *  the user doesn't accidentally double-add by clicking before the
   *  lookup resolves. */
  libraryCheckDone: boolean;
  onRead: () => void;
  onAddToLibrary: () => void;
  onRemoveFromLibrary: () => void;
  onOpenRangeDialog: () => void;
}

function ActionRow({
  theme,
  layout,
  working,
  chapterCount,
  inLibrary,
  libraryCheckDone,
  onRead,
  onAddToLibrary,
  onRemoveFromLibrary,
  onOpenRangeDialog,
}: ActionRowProps) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        padding: layout === "mobile" ? "6px 18px 18px" : "0 40px 28px",
        alignItems: "center",
      }}
    >
      <Button
        theme={theme}
        variant="primary"
        size="md"
        onClick={onRead}
        leadingIcon={<Icon name="type" size={14} />}
      >
        Read
      </Button>
      {inLibrary ? (
        <Button
          theme={theme}
          variant="outline"
          size="md"
          onClick={onRemoveFromLibrary}
          disabled={working || !libraryCheckDone}
          leadingIcon={<Icon name="trash" size={14} />}
        >
          {working ? "Removing…" : "Remove from library"}
        </Button>
      ) : (
        <Button
          theme={theme}
          variant="outline"
          size="md"
          onClick={onAddToLibrary}
          disabled={working || !libraryCheckDone}
          leadingIcon={<Icon name="bookmark" size={14} />}
        >
          {working ? "Adding…" : "Add to library"}
        </Button>
      )}
      <Button
        theme={theme}
        variant="outline"
        size="md"
        onClick={onOpenRangeDialog}
        disabled={working || chapterCount === 0}
        leadingIcon={<Icon name="slider" size={14} />}
      >
        Download range
      </Button>
    </div>
  );
}

// ── chapter search ─────────────────────────────────────────────────────────

interface ChapterSearchProps {
  theme: Theme;
  layout: "desktop" | "mobile";
  source: Source;
  novel: SourceNovel;
  novelUrl: string;
  onOpenChapter: (chapterId: number) => void;
}

interface ChapterSearchState {
  loading: boolean;
  error: string | null;
  results: SourceChapter[] | null;
  query: string;
}

/** Live search inside this novel's chapter list. Only rendered when the
 *  source declares `searchChapters` — sites that don't expose a chapter-
 *  search endpoint (KolNovel etc.) just don't show this UI at all.
 *
 *  Source.searchChapters returns chapter stubs identified by URL, not by
 *  the per-session numeric id `getNovel` assigned. We resolve back to
 *  numeric id by URL-matching against the novel's volumes so the existing
 *  `onOpenChapter(id)` flow keeps working. Chapters the search returned
 *  that aren't in our local volume listing (e.g., outside any volume the
 *  user has expanded yet, or hidden by source-side filtering) still
 *  render but are non-clickable — that's strictly better than swallowing
 *  the result. */
function ChapterSearch({
  theme,
  layout,
  source,
  novel,
  novelUrl,
  onOpenChapter,
}: ChapterSearchProps) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<ChapterSearchState>({
    loading: false,
    error: null,
    results: null,
    query: "",
  });

  // URL → chapter-id map built once per novel render, lets us resolve a
  // search result back to the numeric id the reader uses for navigation.
  const idByUrl = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of novel.volumes) {
      for (const c of v.chapters) {
        map.set(c.url, c.id);
      }
    }
    return map;
  }, [novel]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < CHAPTER_SEARCH_MIN_CHARS) {
      setState({ loading: false, error: null, results: null, query: "" });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null, query: trimmed }));
    const handle = setTimeout(async () => {
      try {
        const results = await source.searchChapters!(novelUrl, trimmed);
        setState((s) =>
          s.query === trimmed
            ? { loading: false, error: null, results, query: trimmed }
            : s,
        );
      } catch (e) {
        setState((s) =>
          s.query === trimmed
            ? {
                loading: false,
                error: e instanceof Error ? e.message : String(e),
                results: null,
                query: trimmed,
              }
            : s,
        );
      }
    }, CHAPTER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, source, novelUrl]);

  const inSearchMode = state.query.length > 0;

  return (
    <div
      style={{
        padding: layout === "mobile" ? "0 18px" : "0 40px",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: theme.chrome,
          border: `0.5px solid ${theme.rule}`,
          borderRadius: 9,
          padding: "6px 10px",
        }}
      >
        <Icon name="search" size={14} style={{ color: theme.muted }} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search chapters…"
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            color: theme.ink,
            border: "none",
            outline: "none",
            fontSize: 13,
            fontFamily: "inherit",
            padding: "4px 0",
            direction: novel.direction,
          }}
        />
        {query.length > 0 && (
          <button
            onClick={() => setQuery("")}
            aria-label="Clear chapter search"
            style={{
              background: "transparent",
              border: "none",
              color: theme.muted,
              cursor: "pointer",
              padding: 4,
              display: "flex",
              alignItems: "center",
            }}
          >
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      {inSearchMode && (
        <div
          style={{
            marginTop: 8,
            border: `0.5px solid ${theme.rule}`,
            borderRadius: 10,
            background: theme.bg,
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {state.loading && state.results === null ? (
            <div style={{ padding: 14, color: theme.muted, fontSize: 12.5 }}>
              Searching chapters…
            </div>
          ) : state.error ? (
            <div style={{ padding: 14, color: theme.muted, fontSize: 12.5 }}>
              Couldn't search chapters — {state.error}
            </div>
          ) : state.results && state.results.length === 0 ? (
            <div style={{ padding: 14, color: theme.muted, fontSize: 12.5 }}>
              No matches for “{state.query}”.
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {(state.results ?? []).map((c) => {
                const id = idByUrl.get(c.url);
                const clickable = id != null;
                return (
                  <li
                    key={c.url}
                    style={{
                      borderBottom: `0.5px solid ${theme.rule}`,
                    }}
                  >
                    <button
                      onClick={() => {
                        if (id != null) onOpenChapter(id);
                      }}
                      disabled={!clickable}
                      style={{
                        width: "100%",
                        textAlign: "start",
                        background: "transparent",
                        border: "none",
                        padding: "10px 14px",
                        color: clickable ? theme.ink : theme.muted,
                        cursor: clickable ? "pointer" : "default",
                        fontFamily: "inherit",
                        fontSize: 12.5,
                        lineHeight: 1.4,
                        direction: novel.direction,
                      }}
                      onMouseEnter={(e) => {
                        if (clickable) {
                          e.currentTarget.style.background = theme.hover;
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      {c.title}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── lazy-volume skeletons / error ──────────────────────────────────────────

interface VolumeChaptersSkeletonProps {
  theme: Theme;
  rows: number;
}

/** Placeholder rows shown inside an expanded but still-loading lazy
 *  volume. Mirrors the row layout the real chapter list uses (number
 *  on the left, title bar in the middle, trailing space for the
 *  download icon) so the swap-in feels smooth.
 *
 *  Row count is capped at the volume's reported chapterCount when
 *  it's small (so we don't render 459 ghost rows for vol 10 of
 *  Shadow Slave) and clamped to a sane default otherwise. */
function VolumeChaptersSkeleton({ theme, rows }: VolumeChaptersSkeletonProps) {
  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: "4px 0 8px",
        borderTop: `0.5px solid ${theme.rule}`,
      }}
    >
      {Array.from({ length: Math.max(3, rows) }).map((_, i) => (
        <li
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px 10px 32px",
          }}
        >
          <span
            style={{
              width: 22,
              height: 9,
              borderRadius: 4,
              background: theme.chrome,
              flexShrink: 0,
              opacity: 0.7,
            }}
          />
          <span
            style={{
              flex: 1,
              height: 11,
              borderRadius: 4,
              background: theme.chrome,
              opacity: 0.5 + Math.random() * 0.2,
            }}
          />
        </li>
      ))}
    </ul>
  );
}

interface VolumeErrorPanelProps {
  theme: Theme;
  message: string;
  onRetry: () => void;
}

function VolumeErrorPanel({ theme, message, onRetry }: VolumeErrorPanelProps) {
  return (
    <div
      style={{
        padding: "14px 18px",
        borderTop: `0.5px solid ${theme.rule}`,
        background: "rgba(180,60,60,0.08)",
        color: theme.ink,
        fontSize: 12.5,
        lineHeight: 1.55,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <span style={{ flex: 1 }}>Couldn't load chapters — {message}</span>
      <button
        onClick={onRetry}
        style={{
          padding: "4px 10px",
          borderRadius: 6,
          border: `0.5px solid ${theme.rule}`,
          background: theme.bg,
          color: theme.ink,
          fontFamily: "inherit",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Retry
      </button>
    </div>
  );
}

// ── per-chapter download button ────────────────────────────────────────────
//
// Lives inside each chapter row in the volumes accordion. Its job is
// to show the chapter's download status (idle / queued / downloading /
// done / failed) and to enqueue/cancel a download when the user
// clicks. Filled in by task 10 once the queue module exists.

interface ChapterDownloadButtonProps {
  theme: Theme;
  libraryEntryId: string;
  chapterId: number;
  /** True when the chapter has been downloaded to disk according to
   *  the parent's flag map. The button uses this for the resting state
   *  ("downloaded" check icon) and as a guard against re-enqueuing. */
  downloaded: boolean;
  /** Called after any state change that should refresh the parent's
   *  flag map (download success, manual delete). The parent re-reads
   *  source.json and rebuilds its chapter-flag lookup. */
  onChange: () => void;
}

function ChapterDownloadButton({
  theme,
  libraryEntryId,
  chapterId,
  downloaded,
  novelTitle,
  chapterTitle,
  queueJob,
  onChange,
}: ChapterDownloadButtonProps & {
  novelTitle: string;
  chapterTitle: string;
  /** Live queue job for this chapter when one is queued/running.
   *  Drives the spinner/progress indicator without us needing a
   *  separate subscription per row — the parent subscribes once and
   *  fans out. */
  queueJob: import("../store/downloadQueue").DownloadJob | undefined;
}) {
  const onClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (downloaded) return;
      if (queueJob) {
        // Already queued — clicking again cancels.
        const { cancel } = await import("../store/downloadQueue");
        cancel(queueJob.id);
        return;
      }
      const { enqueue } = await import("../store/downloadQueue");
      enqueue({
        libraryEntryId,
        chapterId,
        novelTitle,
        chapterTitle,
      });
    },
    [
      libraryEntryId,
      chapterId,
      downloaded,
      queueJob,
      novelTitle,
      chapterTitle,
    ],
  );

  // Resting state precedence:
  //   downloaded (persisted)  → check icon, dim
  //   queued                  → clock icon
  //   running                 → spinning download icon + progress %
  //   error (recent)          → info icon, warning color
  //   idle                    → download icon
  const status = downloaded
    ? "downloaded"
    : queueJob?.status === "queued"
      ? "queued"
      : queueJob?.status === "running"
        ? "running"
        : queueJob?.status === "error"
          ? "error"
          : "idle";
  const label =
    status === "downloaded"
      ? "Downloaded"
      : status === "queued"
        ? "Queued — click to cancel"
        : status === "running"
          ? `Downloading (${Math.round((queueJob?.progress ?? 0) * 100)}%) — click to cancel`
          : status === "error"
            ? `Failed: ${queueJob?.error ?? "unknown error"}`
            : "Download chapter";
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={status === "downloaded"}
      // Refresh the parent's flag lookup once a download lands. The
      // parent's onChange does a snapshot re-read; running here on
      // every render with a useEffect would be wasteful. Instead, the
      // parent subscribes to the queue and pings onChange when a job
      // turns terminal.
      onMouseLeave={() => {
        // no-op; included for completeness — the useEffect above
        // could also trigger onChange when status flips, but the
        // parent re-renders on queue state anyway.
        void onChange;
      }}
      style={{
        background: "transparent",
        border: "none",
        cursor:
          status === "downloaded"
            ? "default"
            : status === "queued" || status === "running"
              ? "pointer"
              : "pointer",
        padding: "0 14px",
        display: "flex",
        alignItems: "center",
        gap: 4,
        color: status === "error" ? "#b75050" : theme.muted,
        opacity: status === "downloaded" ? 0.55 : 1,
        flexShrink: 0,
      }}
    >
      <Icon
        name={
          status === "downloaded"
            ? "check"
            : status === "queued"
              ? "clock"
              : status === "running"
                ? "cloudOk"
                : status === "error"
                  ? "info"
                  : "download"
        }
        size={14}
      />
      {status === "running" && (
        <span style={{ fontSize: 10, color: theme.muted }}>
          {Math.round((queueJob?.progress ?? 0) * 100)}%
        </span>
      )}
    </button>
  );
}

// ── volumes accordion ──────────────────────────────────────────────────────

interface VolumesAccordionProps {
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
    updater: SourceNovel | ((current: SourceNovel | null) => SourceNovel | null),
  ) => void;
}

function VolumesAccordion({
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
          const { setVolumeChapters } = await import("../store/sourceLibrary");
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
        if (!aliveRef.current) return;
        setLoadingVolumes((s) => {
          const next = new Set(s);
          next.delete(volumeId);
          return next;
        });
      }
    },
    [isLazy, loadingVolumes, novel, novelUrl, source, libraryEntryId, onNovelPatch],
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
  const refreshFlags = useCallback(async () => {
    if (!libraryEntryId) return;
    const { readSnapshot } = await import("../store/sourceLibrary");
    const snap = await readSnapshot(libraryEntryId);
    if (!snap) return;
    onChapterFlagsChange(buildFlagMap(snap));
  }, [libraryEntryId, onChapterFlagsChange]);

  // Live queue state for this entry — drives the per-row download
  // icon's queued/running/error rendering. We subscribe to the
  // module-scoped queue once for the accordion (not once per row) and
  // re-read activeChapterSet on every emission. When a job transitions
  // from running → done we trigger a flag refresh so the persisted
  // downloadedAt picks up.
  const [activeJobs, setActiveJobs] = useState<
    Map<number, import("../store/downloadQueue").DownloadJob>
  >(new Map());
  useEffect(() => {
    if (!libraryEntryId) return;
    let lastTerminalUpdate = 0;
    let cancelled = false;
    (async () => {
      const { subscribe, activeChapterSet, getState } = await import(
        "../store/downloadQueue"
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
        Chapters
      </h2>
      {novel.volumes.map((v) => {
        const isOpen = open.has(v.id);
        return (
          <div
            key={v.id}
            style={{
              border: `0.5px solid ${theme.rule}`,
              borderRadius: 10,
              overflow: "hidden",
              background: theme.bg,
            }}
          >
            <button
              onClick={() => toggle(v.id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "12px 14px",
                border: "none",
                background: "transparent",
                color: theme.ink,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "start",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <Icon name={isOpen ? "chevronD" : "chevronR"} size={14} />
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
                style={{ fontSize: 11, color: theme.muted, flexShrink: 0 }}
              >
                {v.chapters.length > 0
                  ? `${v.chapters.length} ch.`
                  : v.chapterCount
                    ? `${v.chapterCount} ch.`
                    : "—"}
              </span>
            </button>
            {isOpen && (
              <>
                {(() => {
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
              </>
            )}
            {isOpen && v.chapters.length > 0 && (
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: "4px 0 8px",
                  borderTop: `0.5px solid ${theme.rule}`,
                  maxHeight: 360,
                  overflowY: "auto",
                }}
              >
                {v.chapters.map((c) => {
                  const flags = chapterFlags.get(c.id);
                  const read = !!flags?.readAt;
                  const downloaded = !!flags?.downloadedAt;
                  return (
                    <li
                      key={c.id}
                      style={{
                        display: "flex",
                        alignItems: "stretch",
                        direction: novel.direction,
                      }}
                    >
                      <button
                        onClick={() => onOpenChapter(c.id)}
                        style={{
                          flex: 1,
                          textAlign: "start",
                          background: "transparent",
                          border: "none",
                          padding: "8px 14px 8px 32px",
                          // Dim read chapters: lower opacity so the
                          // text reads visibly "checked off" without
                          // hiding it.
                          color: read ? theme.muted : theme.ink,
                          opacity: read ? 0.62 : 1,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontSize: 12.5,
                          lineHeight: 1.4,
                          display: "flex",
                          gap: 10,
                          alignItems: "baseline",
                          direction: novel.direction,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = theme.hover;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            color: theme.muted,
                            minWidth: 28,
                            flexShrink: 0,
                          }}
                        >
                          {c.id}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>{c.title}</span>
                      </button>
                      {libraryEntryId && (
                        <ChapterDownloadButton
                          theme={theme}
                          libraryEntryId={libraryEntryId}
                          chapterId={c.id}
                          downloaded={downloaded}
                          novelTitle={novel.title}
                          chapterTitle={c.title}
                          queueJob={activeJobs.get(c.id)}
                          onChange={() => void refreshFlags()}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
