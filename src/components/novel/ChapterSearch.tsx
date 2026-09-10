
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Source, SourceChapter, SourceNovel } from "../../sources/types";

import type {
  Theme,
} from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import { Icon } from "../Icon";

/** Debounce window for the in-novel chapter search. Same rationale as
 *  the homepage suggest debounce — fast enough to feel live, slow enough
 *  not to fire per-keystroke. */
export const CHAPTER_SEARCH_DEBOUNCE_MS = 250;
export const CHAPTER_SEARCH_MIN_CHARS = 1;

export interface ChapterSearchProps {
  theme: Theme;
  layout: "desktop" | "mobile";
  source: Source;
  novel: SourceNovel;
  novelUrl: string;
  onOpenChapter: (chapterId: number) => void;
}

export interface ChapterSearchState {
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
export function ChapterSearch({
  theme,
  layout,
  source,
  novel,
  novelUrl,
  onOpenChapter,
}: ChapterSearchProps) {
  const { tr } = useI18n();
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
          placeholder={tr("novel.searchChaptersPlaceholder")}
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
            aria-label={tr("novel.clearChapterSearch")}
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
          className="riwaq-scroll-hidden"
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
              {tr("novel.searchingChapters")}
            </div>
          ) : state.error ? (
            <div style={{ padding: 14, color: theme.muted, fontSize: 12.5 }}>
              {tr("novel.searchChaptersError", { error: state.error })}
            </div>
          ) : state.results && state.results.length === 0 ? (
            <div style={{ padding: 14, color: theme.muted, fontSize: 12.5 }}>
              {tr("novel.searchChaptersNoMatches", { query: state.query })}
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
