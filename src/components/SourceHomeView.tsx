// One source's landing — search input + a column of horizontal-scroll
// novel-card rows (the sections the source surfaces from its homepage).
//
// Two display modes share this view:
//   - sections mode (default): renders the SourceSection[] the source
//     returned from getHomeSections(). Each section is a header + a
//     horizontally-scrollable row of NovelCards.
//   - search mode: kicked off when the user submits the search input.
//     Renders a single grid of result cards. Hitting Esc / clearing the
//     query returns to sections mode without re-fetching them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { getSource } from "../sources/registry";
import type {
  NovelCard as NovelCardData,
  Source,
  SourceSearchResult,
  SourceSection,
} from "../sources/types";
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { NovelCard } from "./NovelCard";
import { SectionCarousel } from "./SectionCarousel";
import { NovelCardSkeleton, SectionsListSkeleton } from "./Skeleton";

interface Props {
  theme: Theme;
  layout: "desktop" | "mobile";
  sourceId: string;
  onBack: () => void;
  onOpenNovel: (novelUrl: string) => void;
}

interface SectionsState {
  loading: boolean;
  error: string | null;
  sections: SourceSection[];
}

interface SearchState {
  loading: boolean;
  error: string | null;
  result: SourceSearchResult | null;
  query: string;
}

interface SuggestState {
  loading: boolean;
  error: string | null;
  /** null while no query is in flight; empty array means "searched, zero
   *  matches" (so the dropdown can render an empty-state row). */
  items: NovelCardData[] | null;
  query: string;
}

/** Debounce window for live-suggestion calls. 220ms ≈ Cenele's own
 *  in-page debounce (180-250ms) and below the typical inter-keystroke
 *  interval for ordinary typing, so we don't fire a request per
 *  keystroke but still feel instant. */
const SUGGEST_DEBOUNCE_MS = 220;
const SUGGEST_MIN_CHARS = 2;

export function SourceHomeView({
  theme,
  layout,
  sourceId,
  onBack,
  onOpenNovel,
}: Props) {
  const { tr } = useI18n();
  const source = useMemo<Source | null>(() => getSource(sourceId), [sourceId]);

  const [sectionsState, setSectionsState] = useState<SectionsState>({
    loading: true,
    error: null,
    sections: [],
  });
  const [searchState, setSearchState] = useState<SearchState>({
    loading: false,
    error: null,
    result: null,
    query: "",
  });
  const [searchInput, setSearchInput] = useState("");
  const [suggestState, setSuggestState] = useState<SuggestState>({
    loading: false,
    error: null,
    items: null,
    query: "",
  });
  const [suggestOpen, setSuggestOpen] = useState(false);
  const canSuggest = typeof source?.searchSuggest === "function";
  const canSearch = typeof source?.search === "function";

  // Load sections on mount (and whenever the source changes — though in
  // practice sourceId is stable until the user backs out and picks a
  // different source).
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setSectionsState({ loading: true, error: null, sections: [] });
    (async () => {
      try {
        const sections = await source.getHomeSections();
        if (cancelled) return;
        setSectionsState({ loading: false, error: null, sections });
      } catch (e) {
        if (cancelled) return;
        setSectionsState({
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          sections: [],
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  const runSearch = useCallback(
    async (query: string) => {
      if (!source || !source.search) return;
      const trimmed = query.trim();
      if (trimmed.length === 0) {
        // Clearing the input returns the user to sections mode without
        // re-fetching; the previous result stays cached in state so the
        // next non-empty query feels instant if it matches.
        setSearchState((s) => ({ ...s, result: null, query: "" }));
        return;
      }
      setSearchState({
        loading: true,
        error: null,
        result: null,
        query: trimmed,
      });
      try {
        const result = await source.search(trimmed, 1);
        setSearchState({ loading: false, error: null, result, query: trimmed });
      } catch (e) {
        setSearchState({
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          result: null,
          query: trimmed,
        });
      }
    },
    [source],
  );

  // Debounced live suggestion fetch. Fires `SUGGEST_DEBOUNCE_MS` after the
  // user stops typing, and only when the source advertises `searchSuggest`.
  // We track the inflight query against the current input so a stale
  // response from an older keystroke can't overwrite a fresh one.
  useEffect(() => {
    if (!source || !canSuggest) return;
    const trimmed = searchInput.trim();
    if (trimmed.length < SUGGEST_MIN_CHARS) {
      // Below the minimum: clear any previous result + close dropdown,
      // but don't call the source (the typical site behavior).
      setSuggestState({ loading: false, error: null, items: null, query: "" });
      setSuggestOpen(false);
      return;
    }
    setSuggestOpen(true);
    setSuggestState((s) => ({ ...s, loading: true, error: null, query: trimmed }));
    const handle = setTimeout(async () => {
      try {
        const items = await source.searchSuggest!(trimmed);
        // Drop the response if the user typed something else while we
        // were waiting — the latest keystroke wins.
        setSuggestState((s) =>
          s.query === trimmed
            ? { loading: false, error: null, items, query: trimmed }
            : s,
        );
      } catch (e) {
        setSuggestState((s) =>
          s.query === trimmed
            ? {
                loading: false,
                error: e instanceof Error ? e.message : String(e),
                items: null,
                query: trimmed,
              }
            : s,
        );
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [source, canSuggest, searchInput]);

  // Enter on the search input. Behavior depends on which capabilities
  // the source declares:
  //   - has search() → submit to the full-results grid (existing flow).
  //   - has only searchSuggest → there's no results page; open the first
  //     suggestion as if the user had clicked it (per the design choice
  //     for cenele).
  //   - has neither → noop (the input is hidden in this case so we
  //     shouldn't see this path).
  const onSubmitSearch = useCallback(() => {
    if (canSearch) {
      void runSearch(searchInput);
      setSuggestOpen(false);
      return;
    }
    if (canSuggest) {
      const items = suggestState.items;
      if (items && items.length > 0) {
        setSuggestOpen(false);
        onOpenNovel(items[0].url);
      }
    }
  }, [canSearch, canSuggest, runSearch, searchInput, suggestState.items, onOpenNovel]);

  if (!source) {
    return (
      <div
        style={{
          padding: 40,
          color: theme.muted,
          fontFamily: FONT_STACKS.sans,
        }}
      >
        {tr("store.notInstalled", { sourceId })}
      </div>
    );
  }

  const inSearchMode = searchState.query.length > 0;

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        fontFamily: FONT_STACKS.sans,
        color: theme.ink,
      }}
    >
      <HomeHeader
        theme={theme}
        layout={layout}
        source={source}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        onBack={onBack}
        onSubmitSearch={onSubmitSearch}
        canSearch={canSearch}
        canSuggest={canSuggest}
        suggestOpen={suggestOpen && canSuggest && searchInput.trim().length >= SUGGEST_MIN_CHARS}
        onCloseSuggest={() => setSuggestOpen(false)}
        suggestState={suggestState}
        onOpenSuggestion={(url) => {
          setSuggestOpen(false);
          onOpenNovel(url);
        }}
      />

      <div style={{ padding: layout === "mobile" ? "8px 18px 40px" : "8px 40px 40px" }}>
        {inSearchMode ? (
          <SearchResults
            theme={theme}
            state={searchState}
            onClear={() => {
              setSearchInput("");
              setSearchState({
                loading: false,
                error: null,
                result: null,
                query: "",
              });
            }}
            onOpenNovel={onOpenNovel}
          />
        ) : (
          <SectionsList
            theme={theme}
            state={sectionsState}
            onOpenNovel={onOpenNovel}
          />
        )}
      </div>
    </div>
  );
}

// ── header ─────────────────────────────────────────────────────────────────

interface HomeHeaderProps {
  theme: Theme;
  layout: "desktop" | "mobile";
  source: Source;
  searchInput: string;
  setSearchInput: (v: string) => void;
  onBack: () => void;
  onSubmitSearch: () => void;
  canSearch: boolean;
  canSuggest: boolean;
  suggestOpen: boolean;
  onCloseSuggest: () => void;
  suggestState: SuggestState;
  onOpenSuggestion: (url: string) => void;
}

function HomeHeader({
  theme,
  layout,
  source,
  searchInput,
  setSearchInput,
  onBack,
  onSubmitSearch,
  canSearch,
  canSuggest,
  suggestOpen,
  onCloseSuggest,
  suggestState,
  onOpenSuggestion,
}: HomeHeaderProps) {
  const { tr } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const isMobile = layout === "mobile";

  // Mobile lays out as two rows (title row + search row below) so the
  // source name has the full width it needs to display without
  // truncating to "KolNo…" the way a single-row layout did. Desktop
  // keeps the existing single-row layout — there's room for both.
  return (
    <div
      style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "stretch" : "center",
        gap: isMobile ? 10 : 14,
        padding: isMobile ? "16px 18px 12px" : "24px 40px 14px",
        borderBottom: `0.5px solid ${theme.rule}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          minWidth: 0,
          flex: isMobile ? "0 0 auto" : "0 1 auto",
        }}
      >
        <button
          onClick={onBack}
          aria-label={tr("store.backToSources")}
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
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontStyle: "italic",
              fontSize: isMobile ? 20 : 22,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {source.meta.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: theme.muted,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              fontWeight: 500,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {source.meta.baseUrl.replace(/^https?:\/\//, "")}
          </div>
        </div>
      </div>
      {!isMobile && <div style={{ flex: 1 }} />}
      {(canSearch || canSuggest) && (
        <SearchInputWithSuggest
          theme={theme}
          isMobile={isMobile}
          inputRef={inputRef}
          searchInput={searchInput}
          setSearchInput={setSearchInput}
          onSubmitSearch={onSubmitSearch}
          canSuggest={canSuggest}
          suggestOpen={suggestOpen}
          onCloseSuggest={onCloseSuggest}
          suggestState={suggestState}
          onOpenSuggestion={onOpenSuggestion}
        />
      )}
    </div>
  );
}

// ── search input + live-suggest dropdown ───────────────────────────────────

interface SearchInputWithSuggestProps {
  theme: Theme;
  isMobile: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  searchInput: string;
  setSearchInput: (v: string) => void;
  onSubmitSearch: () => void;
  canSuggest: boolean;
  suggestOpen: boolean;
  onCloseSuggest: () => void;
  suggestState: SuggestState;
  onOpenSuggestion: (url: string) => void;
}

function SearchInputWithSuggest({
  theme,
  isMobile,
  inputRef,
  searchInput,
  setSearchInput,
  onSubmitSearch,
  canSuggest,
  suggestOpen,
  onCloseSuggest,
  suggestState,
  onOpenSuggestion,
}: SearchInputWithSuggestProps) {
  const { tr } = useI18n();
  // Click-outside dismissal. Walk composedPath instead of contains() so
  // dropdown clicks on portals or shadow-DOM children would still count
  // as inside (we don't use any here yet but it future-proofs cheaply).
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!suggestOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const root = containerRef.current;
      if (!root) return;
      const path = (e.composedPath?.() ?? []) as Node[];
      if (path.includes(root) || root.contains(e.target as Node)) return;
      onCloseSuggest();
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [suggestOpen, onCloseSuggest]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: isMobile ? "100%" : 320,
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
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <Icon name="search" size={14} style={{ color: theme.muted }} />
        <input
          ref={inputRef}
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmitSearch();
            } else if (e.key === "Escape") {
              onCloseSuggest();
            }
          }}
          placeholder={tr("store.searchPlaceholder")}
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
          }}
        />
      </div>
      {canSuggest && suggestOpen && (
        <SuggestDropdown
          theme={theme}
          state={suggestState}
          onPick={onOpenSuggestion}
        />
      )}
    </div>
  );
}

interface SuggestDropdownProps {
  theme: Theme;
  state: SuggestState;
  onPick: (url: string) => void;
}

function SuggestDropdown({ theme, state, onPick }: SuggestDropdownProps) {
  const { tr } = useI18n();
  return (
    <div
      // Float over the page content; absolute is enough because the
      // parent positioned itself relatively.
      className="leaflet-scroll-hidden"
      style={{
        position: "absolute",
        top: "calc(100% + 4px)",
        insetInlineStart: 0,
        insetInlineEnd: 0,
        zIndex: 50,
        background: theme.bg,
        border: `0.5px solid ${theme.rule}`,
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        overflow: "hidden",
        maxHeight: 360,
        overflowY: "auto",
      }}
    >
      {state.loading && state.items === null ? (
        <div
          style={{ padding: "12px 14px", color: theme.muted, fontSize: 12.5 }}
        >
          {tr("store.searching")}
        </div>
      ) : state.error ? (
        <div
          style={{ padding: "12px 14px", color: theme.muted, fontSize: 12.5 }}
        >
          {tr("store.suggestError", { error: state.error })}
        </div>
      ) : state.items && state.items.length === 0 ? (
        <div
          style={{ padding: "12px 14px", color: theme.muted, fontSize: 12.5 }}
        >
          {tr("store.noSuggestMatches", { query: state.query })}
        </div>
      ) : (
        (state.items ?? []).map((card, i) => (
          <button
            key={card.url}
            onMouseDown={(e) => {
              // mousedown (not click) so we fire before the input's
              // blur dismisses us via the click-outside listener.
              e.preventDefault();
              onPick(card.url);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              padding: "8px 12px",
              border: "none",
              background: i === 0 ? theme.hover : "transparent",
              color: theme.ink,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13,
              textAlign: "start",
              borderBottom: `0.5px solid ${theme.rule}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = theme.hover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = i === 0 ? theme.hover : "transparent";
            }}
          >
            {card.coverUrl && (
              <img
                src={card.coverUrl}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                style={{
                  width: 34,
                  height: 48,
                  objectFit: "cover",
                  borderRadius: 4,
                  flexShrink: 0,
                  background: theme.chrome,
                }}
              />
            )}
            <span
              style={{
                flex: 1,
                minWidth: 0,
                lineHeight: 1.35,
                display: "-webkit-box",
                WebkitBoxOrient: "vertical" as const,
                WebkitLineClamp: 2 as const,
                overflow: "hidden",
              }}
            >
              {card.title}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

// ── sections list ──────────────────────────────────────────────────────────

interface SectionsListProps {
  theme: Theme;
  state: SectionsState;
  onOpenNovel: (url: string) => void;
}

function SectionsList({ theme, state, onOpenNovel }: SectionsListProps) {
  const { tr } = useI18n();
  if (state.loading) {
    return <SectionsListSkeleton theme={theme} />;
  }
  if (state.error) {
    return (
      <div
        style={{
          padding: 24,
          color: theme.ink,
          background: "rgba(180,60,60,0.10)",
          border: "0.5px solid rgba(180,60,60,0.4)",
          borderRadius: 10,
          fontSize: 13,
          lineHeight: 1.5,
          marginTop: 24,
        }}
      >
        {tr("store.loadSourceError", { error: state.error })}
      </div>
    );
  }
  if (state.sections.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: theme.muted }}>
        {tr("store.noSections")}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, marginTop: 18 }}>
      {state.sections.map((section) => (
        <SectionRow
          key={section.id}
          theme={theme}
          section={section}
          onOpenNovel={onOpenNovel}
        />
      ))}
    </div>
  );
}

interface SectionRowProps {
  theme: Theme;
  section: SourceSection;
  onOpenNovel: (url: string) => void;
}

function SectionRow({ theme, section, onOpenNovel }: SectionRowProps) {
  const { tr } = useI18n();
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: "-0.005em",
            color: theme.ink,
          }}
        >
          {section.title}
        </h3>
        {section.viewMoreUrl && (
          <span style={{ fontSize: 11, color: theme.muted }}>
            {tr(
              section.cards.length === 1
                ? "store.itemsCountOne"
                : "store.itemsCountOther",
              { n: section.cards.length },
            )}
          </span>
        )}
      </div>
      <SectionCarousel theme={theme}>
        {section.cards.map((c) => (
          <div
            key={c.url}
            style={{ scrollSnapAlign: "start", flexShrink: 0, width: 140 }}
          >
            <NovelCard theme={theme} card={c} onClick={() => onOpenNovel(c.url)} />
          </div>
        ))}
      </SectionCarousel>
    </div>
  );
}

// ── search results ─────────────────────────────────────────────────────────

interface SearchResultsProps {
  theme: Theme;
  state: SearchState;
  onClear: () => void;
  onOpenNovel: (url: string) => void;
}

function SearchResults({
  theme,
  state,
  onClear,
  onOpenNovel,
}: SearchResultsProps) {
  const { tr } = useI18n();
  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: theme.ink,
          }}
        >
          {state.loading
            ? tr("store.searching")
            : tr("store.resultsFor", { query: state.query })}
        </h3>
        <Button theme={theme} variant="ghost" size="sm" onClick={onClear}>
          {tr("store.clear")}
        </Button>
      </div>
      {state.loading ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 18,
          }}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <NovelCardSkeleton key={i} theme={theme} />
          ))}
        </div>
      ) : state.error ? (
        <div
          style={{
            padding: 24,
            color: theme.ink,
            background: "rgba(180,60,60,0.10)",
            border: "0.5px solid rgba(180,60,60,0.4)",
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          {tr("store.searchFailed", { error: state.error })}
        </div>
      ) : state.result && state.result.cards.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: theme.muted }}>
          {tr("store.noResults")}
        </div>
      ) : (
        <ResultsGrid
          theme={theme}
          cards={state.result?.cards ?? []}
          onOpenNovel={onOpenNovel}
        />
      )}
    </div>
  );
}

function ResultsGrid({
  theme,
  cards,
  onOpenNovel,
}: {
  theme: Theme;
  cards: NovelCardData[];
  onOpenNovel: (url: string) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: 18,
      }}
    >
      {cards.map((c) => (
        <NovelCard
          key={c.url}
          theme={theme}
          card={c}
          onClick={() => onOpenNovel(c.url)}
        />
      ))}
    </div>
  );
}
