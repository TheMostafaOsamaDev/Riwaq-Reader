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

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { getSource } from "../sources/registry";
import { importFromSourceUrl } from "../store/library";
import {
  looksLikeMissingPlaceholder,
  optimizedCoverUrl,
} from "../sources/images";
import type { Source, SourceNovel } from "../sources/types";
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { NovelHeaderSkeleton, VolumesSkeleton } from "./Skeleton";

interface Props {
  theme: Theme;
  layout: "desktop" | "mobile";
  sourceId: string;
  novelUrl: string;
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
  const [importing, setImporting] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setState({ loading: true, error: null, novel: null });
    (async () => {
      try {
        const novel = await source.getNovel(novelUrl);
        if (cancelled) return;
        setState({ loading: false, error: null, novel });
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
  }, [source, novelUrl]);

  const onImportAll = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    try {
      await importFromSourceUrl(sourceId, novelUrl);
      onImportComplete();
    } catch (e) {
      // The import-progress modal also surfaces the error; we don't
      // need to render a second copy inline.
      // eslint-disable-next-line no-console
      console.error("import failed:", e);
    } finally {
      setImporting(false);
    }
  }, [importing, sourceId, novelUrl, onImportComplete]);

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
            importing={importing}
            chapterCount={state.novel.volumes.reduce(
              (a, v) => a + v.chapters.length,
              0,
            )}
            onRead={() => onStreamRead(undefined)}
            onImportAll={onImportAll}
            onOpenRangeDialog={onOpenRangeDialog}
          />
          <VolumesAccordion
            theme={theme}
            layout={layout}
            novel={state.novel}
            onOpenChapter={(chapterId) => onStreamRead(chapterId)}
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
  importing: boolean;
  chapterCount: number;
  onRead: () => void;
  onImportAll: () => void;
  onOpenRangeDialog: () => void;
}

function ActionRow({
  theme,
  layout,
  importing,
  chapterCount,
  onRead,
  onImportAll,
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
      <Button
        theme={theme}
        variant="outline"
        size="md"
        onClick={onImportAll}
        disabled={importing || chapterCount === 0}
        leadingIcon={<Icon name="download" size={14} />}
      >
        {importing
          ? "Importing…"
          : `Add to library (${chapterCount} ch.)`}
      </Button>
      <Button
        theme={theme}
        variant="outline"
        size="md"
        onClick={onOpenRangeDialog}
        disabled={importing || chapterCount === 0}
        leadingIcon={<Icon name="slider" size={14} />}
      >
        Download range
      </Button>
    </div>
  );
}

// ── volumes accordion ──────────────────────────────────────────────────────

interface VolumesAccordionProps {
  theme: Theme;
  layout: "desktop" | "mobile";
  novel: SourceNovel;
  onOpenChapter: (chapterId: number) => void;
}

function VolumesAccordion({
  theme,
  layout,
  novel,
  onOpenChapter,
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
                {v.chapters.length} ch.
              </span>
            </button>
            {isOpen && (
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
                {v.chapters.map((c) => (
                  <li key={c.id}>
                    <button
                      onClick={() => onOpenChapter(c.id)}
                      style={{
                        width: "100%",
                        textAlign: "start",
                        background: "transparent",
                        border: "none",
                        padding: "8px 14px 8px 32px",
                        color: theme.ink,
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
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
