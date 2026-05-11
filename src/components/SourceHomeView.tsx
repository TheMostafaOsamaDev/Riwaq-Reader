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

export function SourceHomeView({
  theme,
  layout,
  sourceId,
  onBack,
  onOpenNovel,
}: Props) {
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

  if (!source) {
    return (
      <div
        style={{
          padding: 40,
          color: theme.muted,
          fontFamily: FONT_STACKS.sans,
        }}
      >
        Source “{sourceId}” isn't installed.
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
        onSubmitSearch={() => void runSearch(searchInput)}
        canSearch={typeof source.search === "function"}
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
}: HomeHeaderProps) {
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
          aria-label="Back to sources"
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
      {canSearch && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: theme.chrome,
            border: `0.5px solid ${theme.rule}`,
            borderRadius: 9,
            padding: "6px 10px",
            // Mobile: full-width below the title row. Desktop:
            // sized to fit comfortably to the right of the title.
            width: isMobile ? "100%" : 320,
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
              }
            }}
            placeholder="Search…"
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
        Couldn't load this source — {state.error}
      </div>
    );
  }
  if (state.sections.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: theme.muted }}>
        No sections found.
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
            {section.cards.length} items
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
          {state.loading ? "Searching…" : `Results for “${state.query}”`}
        </h3>
        <Button theme={theme} variant="ghost" size="sm" onClick={onClear}>
          Clear
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
          Search failed — {state.error}
        </div>
      ) : state.result && state.result.cards.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: theme.muted }}>
          No matches.
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
