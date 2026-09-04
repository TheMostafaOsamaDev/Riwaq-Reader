// Contents panel. Renders the book's chapters either as one flat list (local
// EPUBs, whose spine carries no grouping metadata) or as collapsible volumes
// when the caller can supply them — source novels, where the volume ranges
// survive from the source's own chapter index. Collapsed volumes render no
// chapter rows at all, which is what keeps a 2000-chapter novel's Contents
// list light: the DOM holds a few dozen volume headers instead of thousands
// of buttons.

import {
  memo,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Ref,
} from "react";
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
import { rowOffsets, windowRange } from "./virtualWindow";

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

  // Bumping this asks the list holding the current chapter to scroll it to the
  // middle: once when the panel mounts, and again whenever the reader presses
  // "go to current chapter". Deliberately NOT keyed on `currentChapter` — a
  // docked panel that re-scrolls itself every chapter turn fights the reader's
  // own browsing, which is exactly what the button is for.
  //
  // The scroll itself lives in VirtualChapterList, which owns the row
  // geometry. Every list ignores a reveal for a chapter it does not hold, so
  // on a grouped book only the open volume containing it responds.
  const [revealNonce, setRevealNonce] = useState(0);

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
          ? (
              // Ungrouped books hand the whole spine to one list, so this is
              // the path that has to survive a 2000-chapter novel. It owns its
              // own reveal (see VirtualChapterList) because the row to scroll
              // to is usually not mounted; the effect above handles the
              // grouped path, where every rendered row is a real element.
              <VirtualChapterList
                chapters={filtered}
                currentChapter={currentChapter}
                theme={theme}
                isAr={isAr}
                onJump={onJump}
                revealNonce={revealNonce}
              />
            )
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
                      {/* Windowed like the flat list. Normally only the volume
                          being read is open, so this is cheap either way — but
                          "expand all", and a search that matches across the
                          book, both open every volume at once, and that put
                          2042 rows in the DOM and 33-40ms on every chapter
                          turn while Contents was docked. Each open volume runs
                          its own window and the off-screen ones mount nothing. */}
                      <VirtualChapterList
                        chapters={row.chapters}
                        currentChapter={currentChapter}
                        theme={theme}
                        isAr={isAr}
                        onJump={onJump}
                        revealNonce={revealNonce}
                      />
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

/** Height a chapter row is assumed to have before anything has been measured:
 *  11px padding top and bottom around a 14.5px/1.3 line, plus the 1px gap.
 *  Only the seed — see `estimateOf`, which replaces it with the running mean
 *  of the rows actually seen, because titles wrap and rows are not uniform. */
const ROW_SEED = 42;

/** Rows kept mounted beyond each edge of the scrollport, so a flick reveals
 *  chapters rather than blank space while React catches up. */
const OVERSCAN = 6;

/** Attempts allowed to converge a reveal. Scrolling to a row mounts the rows
 *  around it, which measures them, which moves the row — so the target has to
 *  be recomputed until it stops moving. It settles in two or three passes;
 *  the cap only stops a pathological list from looping. */
const REVEAL_PASSES = 5;

/** The flat chapter list, windowed.
 *
 *  A scraped novel's spine runs to thousands of chapters, and a DOCKED
 *  Contents panel stays mounted the whole time you read. Rendering every row
 *  measured 103ms to open and 37-66ms per chapter turn — the turn cost being
 *  the one docking introduces, since the overlay it replaces was dismissed on
 *  jump. Memoising the rows was measured too and was not enough on its own:
 *  simply CREATING 2000 elements per render is most of the cost, so the list
 *  has to stop producing them.
 *
 *  Rows are NOT a fixed height — a long chapter title wraps — so heights are
 *  measured as rows mount and cached by chapter id, with the running mean
 *  standing in for rows not yet seen. The windowing arithmetic lives in
 *  ./virtualWindow so it can be tested against a 5000-row spine without a DOM. */
function VirtualChapterList({
  chapters,
  currentChapter,
  theme,
  isAr,
  onJump,
  revealNonce,
}: {
  chapters: EpubChapter[];
  currentChapter: number;
  theme: Theme;
  isAr: boolean;
  onJump?: (order: number) => void;
  /** Bumped by the panel to ask for the current chapter to be revealed. */
  revealNonce: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const measured = useRef(new Map<string, number>());
  const [measureTick, bumpMeasured] = useReducer((n: number) => n + 1, 0);
  const [view, setView] = useState({ scrollTop: 0, height: 0, listTop: 0 });

  // Unmeasured rows are assumed to be the mean of the rows we HAVE measured,
  // not a fixed 42. With roughly one title in seven wrapping to two lines, a
  // constant estimate drifts by thousands of pixels over a long spine, which
  // is enough to land "go to current chapter" in the wrong part of the book.
  const heights = useMemo(() => {
    const seen = measured.current;
    let total = 0;
    for (const h of seen.values()) total += h;
    const estimate = seen.size > 0 ? total / seen.size : ROW_SEED;
    return chapters.map((c) => seen.get(c.id) ?? estimate);
    // measureTick is the signal that `measured` has new entries.
  }, [chapters, measureTick]);

  const offsets = useMemo(() => rowOffsets(heights), [heights]);

  // Track the panel's scroll container. Reading scrollTop inside a rAF rather
  // than straight from the scroll event keeps this to one layout read per
  // frame however fast the wheel is spun.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scroller = nearestScrollableAncestor(host);
    if (!scroller) return;

    let queued = 0;
    const read = () => {
      queued = 0;
      const listTop = contentOffsetTop(
        host.getBoundingClientRect().top,
        scroller.getBoundingClientRect().top,
        scroller.scrollTop,
      );
      setView((prev) =>
        prev.scrollTop === scroller.scrollTop &&
        prev.height === scroller.clientHeight &&
        prev.listTop === listTop
          ? prev
          : { scrollTop: scroller.scrollTop, height: scroller.clientHeight, listTop },
      );
    };
    const onScroll = () => {
      if (queued) return;
      queued = requestAnimationFrame(read);
    };

    read();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    // The panel is resizable in practice: docking changes nothing, but the
    // window does, and on mobile the sheet is dragged between snaps.
    const ro = new ResizeObserver(read);
    ro.observe(scroller);
    return () => {
      if (queued) cancelAnimationFrame(queued);
      scroller.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [chapters]);

  const total = offsets[offsets.length - 1];
  const viewTop = view.scrollTop - view.listTop;

  // A list can sit entirely outside the scrollport — every open volume on a
  // fully-expanded novel renders one of these, and only one of them is on
  // screen. windowRange always keeps a row mounted (it has to, or an
  // unmeasured list could never grow past its first frame), so without this
  // 40 off-screen volumes would still cost 40 windows' worth of rows.
  // Guarded on a measured height so it can't fire before the first layout.
  const offscreen = view.height > 0 && (viewTop >= total || viewTop + view.height <= 0);

  const { start, end } = offscreen
    ? { start: 0, end: 0 }
    : windowRange(offsets, viewTop, view.height, OVERSCAN);

  // Record real heights for rows that just mounted. Only a change worth more
  // than half a pixel counts, so this settles after one pass rather than
  // oscillating on sub-pixel rounding.
  const onRowMeasured = (id: string, height: number) => {
    if (Math.abs((measured.current.get(id) ?? -1) - height) < 0.5) return;
    measured.current.set(id, height);
    queueMicrotask(bumpMeasured);
  };

  // ── Reveal ──────────────────────────────────────────────────────────────
  // Scroll the current chapter to the middle of the list.
  //
  // Two-stage, because in a windowed list the row being revealed is usually
  // NOT mounted, so there is no element to measure. While it is absent the
  // target comes from `offsets` — good enough to haul the scrollport into the
  // right region, which mounts the row. Once it IS mounted its own rect gives
  // the exact answer, and that is what actually centres it: the offsets ahead
  // of the window are estimates, and the rows that mount during a scroll are
  // measured *after* it, which on its own left the row ~130-340px off centre.
  //
  // Settles in two or three passes. REVEAL_PASSES only stops a pathological
  // list from looping, and `done` stops this from ever fighting the reader's
  // own scrolling afterwards.
  const revealIndex = chapters.findIndex((c) => c.order === currentChapter);
  const pending = useRef({ nonce: -1, passes: 0, last: -1, done: false });
  if (pending.current.nonce !== revealNonce) {
    pending.current = { nonce: revealNonce, passes: 0, last: -1, done: false };
  }

  useEffect(() => {
    const p = pending.current;
    if (p.done || revealIndex < 0) return;
    const host = hostRef.current;
    if (!host) return;
    const scroller = nearestScrollableAncestor(host);
    if (!scroller) return;

    const scrollerTop = scroller.getBoundingClientRect().top;
    const row = host.querySelector<HTMLElement>('[aria-current="true"]');
    const rect = row?.getBoundingClientRect();

    const geometry = rect
      ? {
          rowOffsetTop: contentOffsetTop(
            rect.top,
            scrollerTop,
            scroller.scrollTop,
          ),
          rowHeight: rect.height,
        }
      : {
          rowOffsetTop:
            contentOffsetTop(
              host.getBoundingClientRect().top,
              scrollerTop,
              scroller.scrollTop,
            ) + offsets[revealIndex],
          rowHeight: offsets[revealIndex + 1] - offsets[revealIndex],
        };

    const top = centerScrollTop({
      scrollTop: scroller.scrollTop,
      clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight,
      ...geometry,
    });

    // Centred on the row's real geometry and no longer moving — finished.
    if (rect && Math.abs(top - p.last) < 1) {
      p.done = true;
      return;
    }
    p.last = top;
    p.passes += 1;
    if (p.passes >= REVEAL_PASSES) p.done = true;
    scroller.scrollTo({ top, behavior: "auto" });
  }, [revealNonce, revealIndex, offsets]);

  return (
    <div ref={hostRef}>
      {/* Spacers stand in for the rows above and below the window, so the
          scrollbar reflects the whole book rather than just what is mounted. */}
      <div style={{ height: offsets[start] }} />
      {chapters.slice(start, end).map((c) => (
        <MeasuredChapterRow
          key={c.id}
          onMeasured={onRowMeasured}
          theme={theme}
          chapter={c}
          active={c.order === currentChapter}
          read={c.order < currentChapter}
          isAr={isAr}
          onJump={onJump}
        />
      ))}
      <div style={{ height: offsets[offsets.length - 1] - offsets[end] }} />
    </div>
  );
}

/** A chapter row that reports its laid-out height once it is on screen. */
function MeasuredChapterRow({
  onMeasured,
  chapter,
  ...rest
}: {
  onMeasured: (id: string, height: number) => void;
  theme: Theme;
  chapter: EpubChapter;
  active: boolean;
  read: boolean;
  isAr: boolean;
  onJump?: (order: number) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // marginBottom is part of the row's footprint in the offsets table, and
    // getBoundingClientRect does not include it.
    onMeasured(chapter.id, el.getBoundingClientRect().height + 1);
  });
  return <ChapterRow rowRef={ref} chapter={chapter} {...rest} />;
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

// Memoised because a DOCKED Contents panel stays mounted while you read, so
// every chapter turn re-renders the whole list. On a 2000-chapter novel that
// measured 37-66ms per turn — several dropped frames, on the one interaction
// that has to feel instant. A turn only genuinely changes two or three rows
// (the one you left, the one you arrived at), so memo takes the cost to ~0.
//
// This only holds while `onJump` and `theme` are referentially stable — see
// the useCallback around onJump in the readers that mount this panel.
const ChapterRow = memo(function ChapterRow({
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
});

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
