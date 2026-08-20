// Dialog opened from the novel detail page to bulk-download a chapter
// slice. The selected range is enqueued into the download queue —
// per-chapter content + images land under the existing library entry's
// `chapters/<id>/` directory, and the queue page (download icon in the
// library header) is where the user watches progress + cancels.
//
// This used to build a separate EPUB entry per range (legacy
// "Download range" behavior). That import path is gone: one source-
// backed entry now owns its chapters, and the queue is the single
// place to manage downloads.

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";

interface Props {
  theme: Theme;
  sourceId: string;
  novelUrl: string;
  /** Library entry id for the novel being downloaded. The dialog
   *  enqueues into this entry's chapter folder, so it MUST be
   *  source-backed (the dialog's parent only opens it for kind:
   *  "source" entries). Undefined indicates an invalid open path —
   *  the dialog surfaces an error instead of running. */
  libraryEntryId?: string;
  onCancel: () => void;
  /** Dialog has enqueued the range — caller should unmount the
   *  dialog. The queue worker takes over from here. */
  onStarted: () => void;
  /** No longer fires per-completion (downloads are async via the
   *  queue) — kept for API compatibility. Called once at enqueue
   *  time so the caller can refresh the shelf if it wants. */
  onCompleted: () => void;
}

interface ChapterChoice {
  id: number;
  label: string;
}

export function DownloadRangeDialog({
  theme,
  sourceId,
  novelUrl,
  libraryEntryId,
  onCancel,
  onStarted,
  onCompleted,
}: Props) {
  const { tr } = useI18n();
  const source = useMemo(() => getSource(sourceId), [sourceId]);
  // Two data sources to populate the dropdowns:
  //   - the persisted snapshot (offline, the typical path now that
  //     the dialog only opens for source-backed library entries)
  //   - source.getNovel as a fallback when no snapshot is on disk
  //     (legacy entries created before the snapshot-on-import path
  //     landed; the dialog still works for them)
  const [snapshot, setSnapshot] = useState<SourceSnapshot | null>(null);
  const [novel, setNovel] = useState<SourceNovel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startId, setStartId] = useState<number | null>(null);
  const [endId, setEndId] = useState<number | null>(null);
  // Lazy-volume pre-load progress. When a Cenele-style source returns
  // empty per-volume chapters from getNovel, we lazy-load each missing
  // volume so the range dropdowns see every chapter — otherwise the
  // user can only pick from whichever volumes they've already
  // expanded.
  const [preloadTotal, setPreloadTotal] = useState(0);
  const [preloadDone, setPreloadDone] = useState(0);
  const [preloading, setPreloading] = useState(false);

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
        // is identical in shape (id, title, url) so the dropdowns
        // and submit code work without further branching.
        if (libraryEntryId) {
          let snap = await readSnapshot(libraryEntryId);
          if (snap && !cancelled) {
            setSnapshot(snap);
            setLoading(false);

            // Lazy-volume sources stash empty `chapters[]` arrays
            // in source.json until each volume gets expanded. The
            // range dialog needs the FULL listing or the user
            // can't pick endpoints past the first volume — so
            // top-up by fetching every missing volume here. The
            // results are persisted via setVolumeChapters, so the
            // accordion in the detail view sees them next time.
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
                    // Per-volume error doesn't fail the whole
                    // dialog — surface so the user knows the range
                    // is partial, but keep going with what we have.
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

            // Pick the default range AFTER the preload so endId
            // lands inside the now-loaded volumes rather than
            // wherever the snapshot happened to truncate.
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

  // Map both data sources to the same ChapterChoice[] shape so the
  // rest of the dialog doesn't need to branch.
  const choices = useMemo<ChapterChoice[]>(() => {
    const flat = snapshot
      ? snapshot.volumes.flatMap((v) =>
          v.chapters.map((c) => ({
            id: c.id,
            title: c.title,
            downloaded: !!c.downloadedAt,
          })),
        )
      : novel
        ? flatChapters(novel).map((c) => ({
            id: c.id,
            title: c.title,
            downloaded: false,
          }))
        : [];
    return flat.map((c) => ({
      id: c.id,
      label: `${c.id}. ${truncate(c.title, 60)}${c.downloaded ? " ✓" : ""}`,
    }));
  }, [snapshot, novel]);

  // How many chapters in the range still need downloading. We skip
  // already-downloaded ones (enqueue() does this too, but surfacing
  // the count up-front sets the user's expectations).
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
    // No snapshot yet → assume everything in range is pending.
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

  return (
    // The scrim, centering, and enter/exit animation live in AnimatedDialog
    // at the call site. This component just renders the card.
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
            padding: "8px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            overflowY: "auto",
          }}
        >
          {loading ? (
            <div
              style={{
                padding: "30px 0",
                textAlign: "center",
                color: theme.muted,
              }}
            >
              {tr("downloads.range.loading")}
            </div>
          ) : (
            <>
              {preloading && (
                <PreloadProgress
                  theme={theme}
                  done={preloadDone}
                  total={preloadTotal}
                />
              )}
              {error && (
                <div
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
              <RangePicker
                theme={theme}
                label={tr("downloads.range.from")}
                choices={choices}
                value={startId}
                onChange={setStartId}
                disabled={preloading}
              />
              <RangePicker
                theme={theme}
                label={tr("downloads.range.to")}
                choices={choices}
                value={endId}
                onChange={setEndId}
                disabled={preloading}
              />
              <div
                style={{
                  fontSize: 12,
                  color: theme.muted,
                  paddingTop: 4,
                }}
              >
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
          )}
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
            disabled={
              loading ||
              preloading ||
              startId === null ||
              endId === null ||
              pendingInRange === 0
            }
            onClick={submit}
          >
            {preloading
              ? tr("downloads.range.loadingVolumes")
              : pendingInRange === 0
                ? tr("downloads.range.nothingToDownload")
                : tr("downloads.range.queueButton", { n: pendingInRange })}
          </Button>
        </div>
    </div>
  );
}

interface PreloadProgressProps {
  theme: Theme;
  done: number;
  total: number;
}

/** Inline progress bar shown while DownloadRangeDialog pre-loads
 *  per-volume chapter listings from a lazy source. The bar fills
 *  proportional to (done / total) and the text counts up as each
 *  volume's AJAX call lands. */
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

interface RangePickerProps {
  theme: Theme;
  label: string;
  choices: ChapterChoice[];
  value: number | null;
  onChange: (id: number) => void;
  disabled?: boolean;
}

function RangePicker({
  theme,
  label,
  choices,
  value,
  onChange,
  disabled,
}: RangePickerProps) {
  // Tracking + uppercasing are a Latin-typography convention: extra
  // letter-spacing breaks Arabic glyph joining/ligatures, and uppercase is a
  // no-op on Arabic anyway. Skip both when the UI is Arabic.
  const { locale } = useI18n();
  const isAr = locale === "ar";
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
      <select
        value={value ?? ""}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        disabled={disabled}
        style={{
          padding: "8px 10px",
          fontSize: 13,
          fontFamily: "inherit",
          color: theme.ink,
          background: theme.chrome,
          border: `0.5px solid ${theme.rule}`,
          borderRadius: 8,
          outline: "none",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
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

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trim() + "…" : s;
}
