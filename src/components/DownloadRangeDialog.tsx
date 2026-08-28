// Bulk "download a range of chapters" flow, opened from the novel detail
// page. The selected [from, to] slice is enqueued into the download queue —
// per-chapter content + images land under the library entry's
// `chapters/<id>/` directory, and the queue page is where the user watches
// progress + cancels.
//
// Presentation is responsive: a centered popup (AnimatedDialog) on desktop,
// a slide-up bottom sheet (MobileSheet — the same primitive behind the
// reader's highlights panel) on mobile. Both wrap the one DownloadRangeContent.
//
// The From/To pickers are searchable, volume-grouped chapter lists (not native
// <select>s) so the user gets search, per-volume context, and a downloaded ✓
// on chapters already on disk.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { getSource } from "../sources/registry";
import {
  readSnapshot,
  setVolumeChapters,
  snapshotToSourceNovel,
  type SourceSnapshot,
} from "../store/sourceLibrary";
import { enqueueRange } from "../store/downloadQueue";
import type { SourceNovel } from "../sources/types";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { AnimatedDialog } from "./AnimatedDialog";
import { MobileSheet } from "./MobileSheet";
import {
  ACCENT,
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  type Theme,
} from "../styles/tokens";
import { transition } from "../styles/motion";
import { useI18n } from "../i18n/useI18n";

interface Props {
  theme: Theme;
  layout: "desktop" | "mobile";
  /** Drives the container's open/close (+ enter/exit animation). */
  open: boolean;
  sourceId?: string;
  novelUrl?: string;
  /** Library entry id for the novel being downloaded. The dialog enqueues
   *  into this entry's chapter folder, so it MUST be source-backed. */
  libraryEntryId?: string;
  onCancel: () => void;
  /** Dialog has enqueued the range — caller should close it. */
  onStarted: () => void;
  /** Called once at enqueue time so the caller can refresh the shelf. */
  onCompleted: () => void;
}

/** Responsive shell: bottom sheet on mobile, centered popup on desktop.
 *  Kept always-mounted (open toggles) so the container animates in/out. */
export function DownloadRangeDialog({
  theme,
  layout,
  open,
  sourceId,
  novelUrl,
  libraryEntryId,
  onCancel,
  onStarted,
  onCompleted,
}: Props) {
  const { tr } = useI18n();
  const content =
    open && sourceId && novelUrl ? (
      <DownloadRangeContent
        theme={theme}
        layout={layout}
        sourceId={sourceId}
        novelUrl={novelUrl}
        libraryEntryId={libraryEntryId}
        onCancel={onCancel}
        onStarted={onStarted}
        onCompleted={onCompleted}
      />
    ) : null;

  if (layout === "mobile") {
    return (
      <MobileSheet
        theme={theme}
        open={open}
        onClose={onCancel}
        label={tr("downloads.range.title")}
        // This form is two pickers and a count line. At the 82% default the
        // sheet opened with a screen of empty space between the fields and the
        // button; the cap keeps it near its content on tall phones while the
        // percentage still bounds it on short ones. The px figure is sized for
        // the tallest normal case — the count line wrapping to two lines once
        // the "(N already on disk)" suffix appears. Longer content scrolls in
        // the body, and dragging up to full still works.
        height="min(80%, 500px)"
      >
        {content}
      </MobileSheet>
    );
  }
  return (
    <AnimatedDialog open={open} onScrimClick={onCancel} zIndex={9700}>
      {content}
    </AnimatedDialog>
  );
}

interface ContentProps {
  theme: Theme;
  layout: "desktop" | "mobile";
  sourceId: string;
  novelUrl: string;
  libraryEntryId?: string;
  onCancel: () => void;
  onStarted: () => void;
  onCompleted: () => void;
}

interface ChapterOption {
  id: number;
  title: string;
  volumeTitle: string;
  downloaded: boolean;
}

function DownloadRangeContent({
  theme,
  layout,
  sourceId,
  novelUrl,
  libraryEntryId,
  onCancel,
  onStarted,
  onCompleted,
}: ContentProps) {
  const { tr } = useI18n();
  const source = useMemo(() => getSource(sourceId), [sourceId]);
  const isMobile = layout === "mobile";
  // Two data sources to populate the pickers:
  //   - the persisted snapshot (offline, the typical path)
  //   - source.getNovel as a fallback when no snapshot is on disk
  const [snapshot, setSnapshot] = useState<SourceSnapshot | null>(null);
  const [novel, setNovel] = useState<SourceNovel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startId, setStartId] = useState<number | null>(null);
  const [endId, setEndId] = useState<number | null>(null);
  // Which picker's list is expanded ("from" | "to" | null) — only one at a
  // time so the sheet/popup doesn't grow two long lists at once.
  const [openField, setOpenField] = useState<"from" | "to" | null>(null);
  // Lazy-volume pre-load progress (see the effect below).
  const [preloadTotal, setPreloadTotal] = useState(0);
  const [preloadDone, setPreloadDone] = useState(0);
  const [preloading, setPreloading] = useState(false);
  const direction = (snapshot?.direction ?? novel?.direction ?? "ltr") as
    | "rtl"
    | "ltr";

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setLoading(true);
    setPreloadTotal(0);
    setPreloadDone(0);
    setPreloading(false);
    (async () => {
      try {
        // Snapshot path: read source.json. The book's chapters list
        // is identical in shape (id, title, url) so the pickers and
        // submit code work without further branching.
        if (libraryEntryId) {
          let snap = await readSnapshot(libraryEntryId);
          if (snap && !cancelled) {
            setSnapshot(snap);
            setLoading(false);

            // Lazy-volume sources stash empty `chapters[]` arrays
            // in source.json until each volume gets expanded. The
            // range dialog needs the FULL listing or the user
            // can't pick endpoints past the first volume — so
            // top-up by fetching every missing volume here.
            if (source.hasLazyVolumes && source.getVolumeChapters) {
              const missing = snap.volumes.filter(
                (v) => !v.chaptersLoaded && v.chapters.length === 0,
              );
              if (missing.length > 0) {
                setPreloading(true);
                setPreloadTotal(missing.length);
                setPreloadDone(0);
                const novelForFetch = snapshotToSourceNovel(snap);
                for (const persisted of missing) {
                  if (cancelled) return;
                  const sourceVol = novelForFetch.volumes.find(
                    (vv) => vv.id === persisted.id,
                  );
                  if (!sourceVol) continue;
                  try {
                    const chapters = await source.getVolumeChapters(
                      novelUrl,
                      sourceVol,
                    );
                    if (cancelled) return;
                    snap = await setVolumeChapters(
                      libraryEntryId,
                      persisted.id,
                      chapters,
                    );
                    if (cancelled) return;
                    if (snap) setSnapshot(snap);
                  } catch (e) {
                    if (cancelled) return;
                    setError(
                      tr("downloads.range.volumeLoadError", {
                        title: persisted.title,
                        error: e instanceof Error ? e.message : String(e),
                      }),
                    );
                  } finally {
                    if (!cancelled) setPreloadDone((n) => n + 1);
                  }
                }
                if (cancelled) return;
                setPreloading(false);
              }
            }

            // Pick the default range AFTER the preload so endId lands
            // inside the now-loaded volumes.
            const final = await readSnapshot(libraryEntryId);
            if (final && !cancelled) {
              setSnapshot(final);
              const flat = final.volumes.flatMap((v) => v.chapters);
              if (flat.length > 0 && startId === null && endId === null) {
                setStartId(flat[0].id);
                setEndId(flat[Math.min(flat.length - 1, 19)].id);
              }
            }
            return;
          }
        }
        // Fallback: network fetch.
        const n = await source.getNovel(novelUrl);
        if (cancelled) return;
        setNovel(n);
        const flat = flatChapters(n);
        if (flat.length > 0) {
          setStartId(flat[0].id);
          setEndId(flat[Math.min(flat.length - 1, 19)].id);
        }
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
        setPreloading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, novelUrl, libraryEntryId]);

  // Volume-grouped chapter options for the pickers. Both data sources map
  // to the same shape so the rest of the component doesn't branch.
  const options = useMemo<ChapterOption[]>(() => {
    if (snapshot) {
      return snapshot.volumes.flatMap((v) =>
        v.chapters.map((c) => ({
          id: c.id,
          title: c.title,
          volumeTitle: v.title,
          downloaded: !!c.downloadedAt,
        })),
      );
    }
    if (novel) {
      return novel.volumes.flatMap((v) =>
        v.chapters.map((c) => ({
          id: c.id,
          title: c.title,
          volumeTitle: v.title,
          downloaded: false,
        })),
      );
    }
    return [];
  }, [snapshot, novel]);

  // How many chapters in the range still need downloading (skip already-
  // downloaded ones — enqueue does this too, but surfacing it sets
  // expectations).
  const pendingInRange = useMemo(() => {
    if (startId === null || endId === null) return 0;
    const lo = Math.min(startId, endId);
    const hi = Math.max(startId, endId);
    if (snapshot) {
      let n = 0;
      for (const v of snapshot.volumes) {
        for (const c of v.chapters) {
          if (c.id >= lo && c.id <= hi && !c.downloadedAt) n++;
        }
      }
      return n;
    }
    return Math.abs(endId - startId) + 1;
  }, [snapshot, startId, endId]);

  const submit = useCallback(() => {
    if (startId === null || endId === null) return;
    if (!libraryEntryId || !snapshot) {
      setError(tr("downloads.range.needsLibrary"));
      return;
    }
    enqueueRange(
      snapshot,
      Math.min(startId, endId),
      Math.max(startId, endId),
      libraryEntryId,
    );
    onStarted();
    onCompleted();
  }, [startId, endId, snapshot, libraryEntryId, onStarted, onCompleted, tr]);

  const submitDisabled =
    loading ||
    preloading ||
    startId === null ||
    endId === null ||
    pendingInRange === 0;

  const submitLabel = preloading
    ? tr("downloads.range.loadingVolumes")
    : pendingInRange === 0
      ? tr("downloads.range.nothingToDownload")
      : tr("downloads.range.queueButton", { n: pendingInRange });

  // Shared inner body (preload / error / pickers / count) used by both
  // the mobile-sheet and desktop-popup layouts.
  const body = loading ? (
    <div style={{ padding: "30px 0", textAlign: "center", color: theme.muted }}>
      {tr("downloads.range.loading")}
    </div>
  ) : (
    <>
      {preloading && (
        <PreloadProgress theme={theme} done={preloadDone} total={preloadTotal} />
      )}
      {error && (
        <div
          role="alert"
          style={{
            padding: 12,
            background: "rgba(180,60,60,0.10)",
            border: "0.5px solid rgba(180,60,60,0.4)",
            borderRadius: 10,
            fontSize: 12.5,
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      )}
      <ChapterRangeField
        theme={theme}
        label={tr("downloads.range.from")}
        options={options}
        value={startId}
        onChange={setStartId}
        open={openField === "from"}
        onToggle={() =>
          setOpenField((f) => (f === "from" ? null : "from"))
        }
        onClose={() => setOpenField(null)}
        disabled={preloading}
        direction={direction}
      />
      <ChapterRangeField
        theme={theme}
        label={tr("downloads.range.to")}
        options={options}
        value={endId}
        onChange={setEndId}
        open={openField === "to"}
        onToggle={() => setOpenField((f) => (f === "to" ? null : "to"))}
        onClose={() => setOpenField(null)}
        disabled={preloading}
        direction={direction}
      />
      <div style={{ fontSize: 12, color: theme.muted, paddingTop: 2 }}>
        {tr(
          pendingInRange === 1
            ? "downloads.range.queueCountOne"
            : "downloads.range.queueCountOther",
          {
            n: pendingInRange,
            extra:
              countSelected(startId, endId) !== pendingInRange
                ? tr("downloads.range.alreadyOnDisk", {
                    n: countSelected(startId, endId) - pendingInRange,
                  })
                : "",
          },
        )}
      </div>
    </>
  );

  if (isMobile) {
    // Header / scrolling body / pinned footer.
    //
    // The action button used to be the last inline child of one big scroll
    // column. MobileSheet renders the sheet at FULL height and translates it
    // down to reach a partial snap, so that column's tail — the button —
    // physically sat below the screen: the user had to drag the sheet to full
    // before they could queue anything. Reserving `--sheet-overhang` (the
    // published distance the sheet hangs off-screen at the current snap) on
    // this container puts the footer exactly on the visible bottom edge at
    // every snap, so the primary action is always in reach.
    return (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          paddingBottom: "var(--sheet-overhang, 0px)",
          fontFamily: FONT_STACKS.sans,
          color: theme.ink,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "4px 18px 4px",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: FONT_SERIF_DISPLAY,
                fontSize: 21,
                letterSpacing: "-0.01em",
                marginBottom: 4,
              }}
            >
              {tr("downloads.range.title")}
            </div>
            <div style={{ fontSize: 12.5, color: theme.muted, lineHeight: 1.5 }}>
              {tr("downloads.range.body")}
            </div>
          </div>
          <button
            onClick={onCancel}
            aria-label={tr("common.close")}
            style={{
              flexShrink: 0,
              width: 32,
              height: 32,
              borderRadius: 16,
              border: `0.5px solid ${theme.rule}`,
              background: theme.bg,
              color: theme.ink,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
        <div
          data-sheet-scrollable
          className="leaflet-scroll-hidden"
          style={{
            padding: "14px 18px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            // flex + minHeight:0 is what keeps this the ONLY scrolling region:
            // it absorbs the leftover height and scrolls internally instead of
            // pushing the footer past the sheet's visible edge. MobileSheet's
            // drag handoff reads scrollTop off [data-sheet-scrollable], so the
            // attribute has to travel with the overflow.
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overscrollBehaviorY: "contain",
          }}
        >
          {body}
        </div>
        <div
          style={{
            // The env() floor is deliberate: this WebView reports
            // safe-area-inset-bottom as 0 on Android even with a gesture bar
            // present, so max() supplies the clearance env() won't.
            padding: "10px 18px max(20px, env(safe-area-inset-bottom, 0px))",
            flexShrink: 0,
          }}
        >
          <Button
            theme={theme}
            variant="primary"
            size="lg"
            fullWidth
            disabled={submitDisabled}
            onClick={submit}
          >
            {submitLabel}
          </Button>
        </div>
      </div>
    );
  }

  // Desktop: centered card with a sticky footer.
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        width: "min(520px, calc(100vw - 32px))",
        maxHeight: "90vh",
        background: theme.bg,
        color: theme.ink,
        borderRadius: 14,
        boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
        border: `0.5px solid ${theme.rule}`,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT_STACKS.sans,
      }}
    >
      <div style={{ padding: "22px 22px 8px" }}>
        <div
          style={{
            fontFamily: FONT_SERIF_DISPLAY,
            fontSize: 22,
            marginBottom: 6,
            letterSpacing: "-0.01em",
          }}
        >
          {tr("downloads.range.title")}
        </div>
        <div style={{ fontSize: 13, color: theme.muted, lineHeight: 1.5 }}>
          {tr("downloads.range.body")}
        </div>
      </div>
      <div
        style={{
          padding: "8px 22px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          overflowY: "auto",
        }}
      >
        {body}
      </div>
      <div
        style={{
          padding: "14px 22px 18px",
          borderTop: `0.5px solid ${theme.rule}`,
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <Button theme={theme} variant="ghost" size="sm" onClick={onCancel}>
          {tr("common.cancel")}
        </Button>
        <Button
          theme={theme}
          variant="primary"
          size="sm"
          disabled={submitDisabled}
          onClick={submit}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

// ── searchable, volume-grouped chapter picker ──────────────────────────────

interface ChapterRangeFieldProps {
  theme: Theme;
  label: string;
  options: ChapterOption[];
  value: number | null;
  onChange: (id: number) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  disabled?: boolean;
  direction: "rtl" | "ltr";
}

function ChapterRangeField({
  theme,
  label,
  options,
  value,
  onChange,
  open,
  onToggle,
  onClose,
  disabled,
  direction,
}: ChapterRangeFieldProps) {
  const { tr, locale } = useI18n();
  const isAr = locale === "ar";
  const [query, setQuery] = useState("");
  const selected = options.find((o) => o.id === value) ?? null;

  // Reset the search whenever the list collapses so reopening starts clean.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(
        (o) => String(o.id).includes(q) || o.title.toLowerCase().includes(q),
      )
    : options;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: isAr ? "normal" : "0.04em",
          textTransform: isAr ? "none" : "uppercase",
          color: theme.muted,
        }}
      >
        {label}
      </span>
      <button
        type="button"
        onClick={disabled ? undefined : onToggle}
        disabled={disabled}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          width: "100%",
          padding: "11px 14px",
          fontSize: 13.5,
          fontFamily: "inherit",
          color: theme.ink,
          background: theme.chrome,
          border: `0.5px solid ${open ? theme.ruleStrong : theme.rule}`,
          borderRadius: 10,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          textAlign: "start",
          direction,
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {selected ? (
            <>
              <span style={{ color: theme.muted }}>{selected.id}.</span>{" "}
              {selected.title}
              {selected.downloaded ? "  ✓" : ""}
            </>
          ) : (
            <span style={{ color: theme.muted }}>
              {tr("downloads.range.selectChapter")}
            </span>
          )}
        </span>
        <span
          className="rtl-flip-x"
          style={{
            display: "inline-flex",
            color: theme.muted,
            flexShrink: 0,
            transition: transition("transform", "fast", "out"),
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          <Icon name="chevronR" size={14} />
        </span>
      </button>
      {open && (
        <div
          style={{
            border: `0.5px solid ${theme.rule}`,
            borderRadius: 10,
            overflow: "hidden",
            background: theme.bg,
          }}
        >
          <div style={{ padding: 8, borderBottom: `0.5px solid ${theme.rule}` }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: theme.chrome,
                border: `0.5px solid ${theme.rule}`,
                borderRadius: 8,
                padding: "6px 10px",
              }}
            >
              <Icon name="search" size={14} style={{ color: theme.muted }} />
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tr("downloads.range.searchPlaceholder")}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "transparent",
                  color: theme.ink,
                  border: "none",
                  outline: "none",
                  fontSize: 13,
                  fontFamily: "inherit",
                  direction,
                }}
              />
            </div>
          </div>
          <div
            data-sheet-scrollable
            className="leaflet-scroll-hidden"
            style={{ maxHeight: 260, overflowY: "auto" }}
          >
            {filtered.length === 0 ? (
              <div
                style={{
                  padding: 14,
                  color: theme.muted,
                  fontSize: 12.5,
                  textAlign: "center",
                }}
              >
                {tr("downloads.range.noMatches")}
              </div>
            ) : (
              filtered.map((o, i) => {
                const showHeader =
                  i === 0 || filtered[i - 1].volumeTitle !== o.volumeTitle;
                const isSel = o.id === value;
                return (
                  <Fragment key={o.id}>
                    {showHeader && (
                      <div
                        style={{
                          padding: "7px 14px 5px",
                          fontSize: 10.5,
                          fontWeight: 600,
                          letterSpacing: isAr ? "normal" : "0.04em",
                          textTransform: isAr ? "none" : "uppercase",
                          color: theme.muted,
                          background: theme.chrome,
                          position: "sticky",
                          top: 0,
                          zIndex: 1,
                          direction,
                        }}
                      >
                        {o.volumeTitle}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onChange(o.id);
                        onClose();
                      }}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 14px",
                        border: "none",
                        borderInlineStart: `2px solid ${
                          isSel ? ACCENT : "transparent"
                        }`,
                        background: isSel ? theme.hover : "transparent",
                        color: theme.ink,
                        cursor: "pointer",
                        fontFamily: "inherit",
                        fontSize: 12.5,
                        textAlign: "start",
                        direction,
                      }}
                      onMouseEnter={(e) => {
                        if (!isSel) e.currentTarget.style.background = theme.hover;
                      }}
                      onMouseLeave={(e) => {
                        if (!isSel)
                          e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          color: theme.muted,
                          minWidth: 28,
                          flexShrink: 0,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {o.id}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {o.title}
                      </span>
                      {o.downloaded && (
                        <Icon
                          name="check"
                          size={13}
                          style={{ color: ACCENT, flexShrink: 0 }}
                        />
                      )}
                    </button>
                  </Fragment>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface PreloadProgressProps {
  theme: Theme;
  done: number;
  total: number;
}

/** Inline progress bar shown while the dialog pre-loads per-volume chapter
 *  listings from a lazy source. */
function PreloadProgress({ theme, done, total }: PreloadProgressProps) {
  const { tr } = useI18n();
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div
      style={{
        padding: "12px 14px",
        background: theme.chrome,
        border: `0.5px solid ${theme.rule}`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 12.5,
          color: theme.ink,
        }}
      >
        <span>{tr("downloads.range.preloadLabel")}</span>
        <span style={{ color: theme.muted, fontVariantNumeric: "tabular-nums" }}>
          {done} / {total}
        </span>
      </div>
      <div
        style={{
          height: 4,
          background: theme.bg,
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.round(pct * 100)}%`,
            height: "100%",
            background: theme.ink,
            transition: "width 220ms ease",
          }}
        />
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function flatChapters(novel: SourceNovel) {
  return novel.volumes.flatMap((v) => v.chapters);
}

function countSelected(start: number | null, end: number | null): number {
  if (start === null || end === null) return 0;
  return Math.abs(end - start) + 1;
}
