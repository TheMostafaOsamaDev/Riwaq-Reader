// Contents panel. Renders the book's chapters either as one flat list (local
// EPUBs, whose spine carries no grouping metadata) or as collapsible volumes
// when the caller can supply them — source novels, where the volume ranges
// survive from the source's own chapter index. Collapsed volumes render no
// chapter rows at all, which is what keeps a 2000-chapter novel's Contents
// list light: the DOM holds a few dozen volume headers instead of thousands
// of buttons.

import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { Icon, type IconProps } from "../components/Icon";
import type { EpubChapter } from "../epub/types";
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { transition } from "../styles/motion";
import { useI18n } from "../i18n/useI18n";
import type { TocVolume } from "../types/reader";
import { PanelShell } from "./PanelShell";
import {
  centerScrollTop,
  contentOffsetTop,
  nearestScrollableAncestor,
} from "./tocReveal";

interface Props {
  theme: Theme;
  onClose?: () => void;
  bookTitle: string;
  chapters: EpubChapter[];
  currentChapter: number;
  onJump?: (order: number) => void;
  width?: number | string;
  side?: "left" | "right";
  /** Collapsible volume ranges over `chapters`. Omit for an ungrouped list. */
  volumes?: TocVolume[];
}

export function TOCPanel({
  theme,
  onClose,
  bookTitle,
  chapters,
  currentChapter,
  onJump,
  width,
  side = "left",
  volumes,
}: Props) {
  const { tr, locale } = useI18n();
  const isAr = locale === "ar";
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  const filtered = useMemo(() => {
    if (!trimmed) return chapters;
    const needle = trimmed.toLowerCase();
    return chapters.filter((c) => c.title.toLowerCase().includes(needle));
  }, [chapters, trimmed]);

  // chapter `order` → volume id. Volumes cover contiguous runs, so filling
  // this costs one pass over the spine and turns every later lookup into a
  // map hit rather than a scan over the volume list.
  const volumeOf = useMemo(() => {
    if (!volumes || volumes.length === 0) return null;
    const map = new Map<number, string>();
    for (const v of volumes) {
      for (let order = v.start; order <= v.end; order++) map.set(order, v.id);
    }
    return map;
  }, [volumes]);

  const currentVolumeId = volumeOf?.get(currentChapter) ?? null;

  // Only the volume being read starts expanded. Opening every volume on a
  // long novel buries the current chapter in a scroll bar that means nothing.
  const [openVolumes, setOpenVolumes] = useState<Set<string>>(
    () => new Set(currentVolumeId ? [currentVolumeId] : []),
  );

  // Reading on into the next volume expands it, so the current chapter is
  // never hidden inside a collapsed group while the panel is docked open.
  // Volumes the reader collapsed by hand stay collapsed.
  useEffect(() => {
    if (!currentVolumeId) return;
    setOpenVolumes((prev) =>
      prev.has(currentVolumeId)
        ? prev
        : new Set(prev).add(currentVolumeId),
    );
  }, [currentVolumeId]);

  // Bucket the (possibly search-filtered) chapters by volume. `loose` catches
  // chapters no volume claims — defensive, but it means a partial or stale
  // volume list can never make a chapter unreachable from the Contents list.
  const grouped = useMemo(() => {
    if (!volumes || volumes.length === 0 || !volumeOf) return null;
    const buckets = new Map<string, EpubChapter[]>();
    const loose: EpubChapter[] = [];
    for (const c of filtered) {
      const id = volumeOf.get(c.order);
      if (id === undefined) {
        loose.push(c);
        continue;
      }
      const bucket = buckets.get(id);
      if (bucket) bucket.push(c);
      else buckets.set(id, [c]);
    }
    return {
      // A volume with no surviving chapters is dropped rather than shown
      // empty — while searching, that leaves only the volumes that matched.
      rows: volumes
        .map((v) => ({ volume: v, chapters: buckets.get(v.id) ?? [] }))
        .filter((row) => row.chapters.length > 0),
      loose,
    };
  }, [volumes, volumeOf, filtered]);

  // While searching, every matching volume is expanded regardless of the
  // manual open/closed state — a hit the user can't see is a dead end. The
  // manual state is left untouched so clearing the query restores it.
  const isOpen = (id: string) => searching || openVolumes.has(id);
  const allExpanded =
    grouped !== null &&
    grouped.rows.length > 0 &&
    grouped.rows.every((row) => openVolumes.has(row.volume.id));

  // Scroll the current chapter's row to the middle of the list: once when the
  // panel mounts, and again whenever the reader presses "go to current
  // chapter". Deliberately NOT keyed on `currentChapter` — a docked panel
  // that re-scrolls itself every chapter turn fights the reader's own
  // browsing, which is exactly what the button is for.
  //
  // The scroll is applied to THIS list's scroll container only. `scrollIntoView`
  // would instead walk up every scrollable ancestor (see ./tocReveal), and
  // inside the mobile bottom sheet that dragged the sheet itself up mid-enter —
  // the row starts off-screen below, so the browser found the range it needed
  // in the sheet's clip wrapper.
  const activeRowRef = useRef<HTMLButtonElement>(null);
  const [revealNonce, setRevealNonce] = useState(0);
  useEffect(() => {
    const row = activeRowRef.current;
    if (!row) return;
    const scroller = nearestScrollableAncestor(row);
    if (!scroller) return;
    const top = centerScrollTop({
      scrollTop: scroller.scrollTop,
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
      rowOffsetTop: contentOffsetTop(
        row.getBoundingClientRect().top,
        scroller.getBoundingClientRect().top,
        scroller.scrollTop,
      ),
      rowHeight: row.getBoundingClientRect().height,
    });
    scroller.scrollTo({
      top,
      behavior: revealNonce === 0 ? "auto" : "smooth",
    });
  }, [revealNonce]);

  const goToCurrent = () => {
    if (currentVolumeId) {
      setOpenVolumes((prev) =>
        prev.has(currentVolumeId) ? prev : new Set(prev).add(currentVolumeId),
      );
    }
    setQuery("");
    // Bump after the expand so the effect below runs on a laid-out row.
    setRevealNonce((n) => n + 1);
  };

  return (
    <PanelShell
      theme={theme}
      title={tr("reader.toc")}
      // Display-time fallback for a blank `Book.title` (see common.untitled).
      subtitle={bookTitle || tr("common.untitled")}
      onClose={onClose}
      icon={<Icon name="list" size={15} />}
      width={width}
      side={side}
      actions={
        <>
          {grouped !== null && (
            <HeaderAction
              theme={theme}
              icon={allExpanded ? "chevronsU" : "chevronsD"}
              label={tr(allExpanded ? "toc.collapseAll" : "toc.expandAll")}
              onClick={() =>
                setOpenVolumes(
                  allExpanded
                    ? new Set()
                    : new Set(grouped.rows.map((row) => row.volume.id)),
                )
              }
            />
          )}
          <HeaderAction
            theme={theme}
            icon="locate"
            label={tr("toc.goToCurrent")}
            onClick={goToCurrent}
          />
        </>
      }
    >
      <SearchBar
        theme={theme}
        query={query}
        onChange={setQuery}
        onSubmit={() => {
          // Enter on a query that narrows to a single chapter jumps to
          // it — handy on mobile where Return doubles as the keyboard's
          // "go" key. Multi-match queries fall through (cursor stays).
          if (filtered.length === 1 && onJump) onJump(filtered[0].order);
        }}
      />
      <div style={{ padding: grouped ? "8px 10px 20px" : "8px 6px" }}>
        {filtered.length === 0 && (
          <div
            style={{
              padding: "32px 18px",
              textAlign: "center",
              color: theme.muted,
              fontSize: 12.5,
              fontFamily: FONT_STACKS.sans,
              lineHeight: 1.5,
            }}
          >
            {tr("toc.noMatches", { term: trimmed })}
          </div>
        )}

        {grouped === null
          ? filtered.map((c) => (
              <ChapterRow
                key={c.id}
                rowRef={c.order === currentChapter ? activeRowRef : undefined}
                theme={theme}
                chapter={c}
                active={c.order === currentChapter}
                read={c.order < currentChapter}
                isAr={isAr}
                onJump={onJump}
              />
            ))
          : grouped.rows.map((row) => {
              const open = isOpen(row.volume.id);
              const holdsCurrent =
                currentChapter >= row.volume.start &&
                currentChapter <= row.volume.end;
              return (
                <div
                  key={row.volume.id}
                  style={{
                    // Border and tint only while open, so a collapsed list of
                    // 40 volumes stays a quiet list of rows instead of 40
                    // competing cards.
                    border: `0.5px solid ${open ? theme.rule : "transparent"}`,
                    borderRadius: 10,
                    background: open ? theme.chrome : "transparent",
                    overflow: "hidden",
                    marginBottom: 4,
                    transition: transition("background", "fast", "out"),
                  }}
                >
                  <VolumeHeader
                    theme={theme}
                    title={row.volume.title}
                    count={
                      searching
                        ? row.chapters.length
                        : row.volume.end - row.volume.start + 1
                    }
                    open={open}
                    // The marker moves to the chapter row itself once the
                    // volume is open, so it never reads twice.
                    showNow={holdsCurrent && !open}
                    nowLabel={tr("toc.now")}
                    isAr={isAr}
                    onToggle={() => {
                      const id = row.volume.id;
                      if (searching) {
                        // Every match is force-expanded, so a header click
                        // here can't mean "collapse" — `isOpen` would just
                        // re-open it. Read it as "take me to this volume in
                        // the full list" instead, and leave it open there.
                        setQuery("");
                        setOpenVolumes((prev) => new Set(prev).add(id));
                        return;
                      }
                      setOpenVolumes((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      });
                    }}
                  />
                  {open && (
                    <div
                      className="leaflet-collapse-enter"
                      style={{
                        padding: "3px 4px 6px",
                        borderTop: `0.5px solid ${theme.rule}`,
                      }}
                    >
                      {row.chapters.map((c) => (
                        <ChapterRow
                          key={c.id}
                          rowRef={
                            c.order === currentChapter
                              ? activeRowRef
                              : undefined
                          }
                          theme={theme}
                          chapter={c}
                          active={c.order === currentChapter}
                          read={c.order < currentChapter}
                          isAr={isAr}
                          onJump={onJump}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

        {grouped !== null && grouped.loose.length > 0 && (
          <div style={{ paddingTop: 4 }}>
            {grouped.loose.map((c) => (
              <ChapterRow
                key={c.id}
                rowRef={c.order === currentChapter ? activeRowRef : undefined}
                theme={theme}
                chapter={c}
                active={c.order === currentChapter}
                read={c.order < currentChapter}
                isAr={isAr}
                onJump={onJump}
              />
            ))}
          </div>
        )}
      </div>
    </PanelShell>
  );
}

/** Panel-header icon button. Sized to match PanelShell's own close button so
 *  the action cluster reads as one row of controls. */
function HeaderAction({
  theme,
  icon,
  label,
  onClick,
}: {
  theme: Theme;
  icon: IconProps["name"];
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: 26,
        height: 26,
        borderRadius: 6,
        border: "none",
        background: "transparent",
        color: theme.chromeInk,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = theme.hover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon name={icon} size={14} />
    </button>
  );
}

function VolumeHeader({
  theme,
  title,
  count,
  open,
  showNow,
  nowLabel,
  isAr,
  onToggle,
}: {
  theme: Theme;
  title: string;
  count: number;
  open: boolean;
  showNow: boolean;
  nowLabel: string;
  isAr: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "11px 12px",
        border: "none",
        background: "transparent",
        color: theme.ink,
        cursor: "pointer",
        fontFamily: FONT_STACKS.sans,
        textAlign: "start",
        borderRadius: 10,
      }}
      onMouseEnter={(e) => {
        if (!open) e.currentTarget.style.background = theme.hover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        {/* Outer span mirrors the chevron in RTL; the inner span rotates it
            between closed (points toward the content) and open (points down).
            Two layers so the rotate transform doesn't clobber the rtl-flip. */}
        <span
          className="rtl-flip-x"
          style={{ display: "inline-flex", flexShrink: 0, color: theme.muted }}
        >
          <span
            style={{
              display: "inline-flex",
              transition: transition("transform", "fast", "out"),
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
            }}
          >
            <Icon name="chevronR" size={13} />
          </span>
        </span>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            letterSpacing: "-0.005em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {showNow && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: theme.muted,
              letterSpacing: isAr ? "normal" : "0.06em",
              textTransform: isAr ? "none" : "uppercase",
            }}
          >
            {nowLabel}
          </span>
        )}
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: theme.muted,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      </span>
    </button>
  );
}

function ChapterRow({
  theme,
  chapter,
  active,
  read,
  isAr,
  onJump,
  rowRef,
}: {
  theme: Theme;
  chapter: EpubChapter;
  active: boolean;
  read: boolean;
  isAr: boolean;
  onJump?: (order: number) => void;
  rowRef?: Ref<HTMLButtonElement>;
}) {
  const { tr } = useI18n();
  return (
    <button
      ref={rowRef}
      onClick={() => onJump?.(chapter.order)}
      aria-current={active ? "true" : undefined}
      style={{
        width: "100%",
        textAlign: "start",
        border: "none",
        background: active ? theme.hover : "transparent",
        padding: "11px 14px",
        borderRadius: 8,
        cursor: "pointer",
        display: "flex",
        alignItems: "baseline",
        gap: 12,
        color: theme.ink,
        marginBottom: 1,
      }}
    >
      <span
        style={{
          fontFamily: FONT_STACKS.sans,
          fontSize: 10.5,
          fontWeight: 600,
          color: active ? theme.ink : theme.muted,
          minWidth: 36,
          letterSpacing: "0.04em",
          fontVariantNumeric: "tabular-nums",
          opacity: read ? 0.55 : 1,
        }}
      >
        {String(chapter.order + 1).padStart(2, "0")}
      </span>
      <span
        style={{
          fontFamily: FONT_SERIF_DISPLAY,
          fontSize: 14.5,
          fontWeight: active ? 500 : 400,
          fontStyle: "normal",
          color: read ? theme.muted : theme.ink,
          flex: 1,
          lineHeight: 1.3,
        }}
      >
        {chapter.title}
      </span>
      {active && (
        <span
          style={{
            fontFamily: FONT_STACKS.sans,
            fontSize: 9,
            color: theme.muted,
            fontWeight: 600,
            letterSpacing: isAr ? "normal" : "0.06em",
            textTransform: isAr ? "none" : "uppercase",
          }}
        >
          {tr("toc.now")}
        </span>
      )}
    </button>
  );
}

function SearchBar({
  theme,
  query,
  onChange,
  onSubmit,
}: {
  theme: Theme;
  query: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) {
  const { tr, dir } = useI18n();
  return (
    // Sticks to the top of the scroll container so the search field
    // stays reachable while scanning a long table of contents. zIndex 1
    // keeps it above the buttons that scroll under it.
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1,
        padding: "10px 12px",
        background: theme.bg,
        borderBottom: `0.5px solid ${theme.rule}`,
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          background: theme.hover,
          border: `0.5px solid ${theme.rule}`,
          borderRadius: 8,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            color: theme.muted,
            flexShrink: 0,
          }}
        >
          <Icon name="search" size={14} />
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onChange("");
            } else if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={tr("toc.searchChapters")}
          // Follow the UI locale, NOT dir="auto". `auto` derives direction
          // from the value's first strong character, and a search field is
          // empty most of the time — so it fell back to LTR and put the
          // caret and the (translated, Arabic) placeholder on the wrong side
          // of an Arabic UI, then flipped mid-typing. Bidi still lays out a
          // Latin query correctly inside an RTL field.
          dir={dir}
          aria-label={tr("toc.searchChapters")}
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            color: theme.ink,
            fontFamily: FONT_STACKS.sans,
            fontSize: 13,
            paddingBlock: 8,
            paddingInlineStart: 0,
            paddingInlineEnd: 8,
            WebkitAppearance: "none",
          }}
        />
        {query.length > 0 && (
          <button
            onClick={() => onChange("")}
            aria-label={tr("toc.clearSearch")}
            title={tr("toc.clearSearch")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              border: "none",
              background: "transparent",
              color: theme.muted,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
