// Dialog opened from the novel detail page to scrape a chapter slice.
//
// Fetches the novel's full chapter list once (to populate the dropdowns
// with real chapter ids + titles) then hands off to `importFromSourceUrl`
// with a chapterIdRange. The import-progress modal at the app root takes
// over from that point, so this dialog closes immediately on submit.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSource } from "../sources/registry";
import { importFromSourceUrl } from "../store/library";
import type { SourceNovel } from "../sources/types";
import { Button } from "./Button";
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";

interface Props {
  theme: Theme;
  sourceId: string;
  novelUrl: string;
  onCancel: () => void;
  /** Dialog has handed off to the import-progress modal — caller should
   *  unmount this dialog now. */
  onStarted: () => void;
  /** Full import finished (after onStarted) — the parent refreshes the
   *  shelf so the new EPUB shows up. */
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
  onCancel,
  onStarted,
  onCompleted,
}: Props) {
  const source = useMemo(() => getSource(sourceId), [sourceId]);
  const [novel, setNovel] = useState<SourceNovel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startId, setStartId] = useState<number | null>(null);
  const [endId, setEndId] = useState<number | null>(null);

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const n = await source.getNovel(novelUrl);
        if (cancelled) return;
        setNovel(n);
        const flat = flatChapters(n);
        if (flat.length > 0) {
          setStartId(flat[0].id);
          setEndId(flat[Math.min(flat.length - 1, 19)].id); // default to first 20
        }
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, novelUrl]);

  const choices = useMemo<ChapterChoice[]>(() => {
    if (!novel) return [];
    return flatChapters(novel).map((c) => ({
      id: c.id,
      label: `${c.id}. ${truncate(c.title, 60)}`,
    }));
  }, [novel]);

  const submit = useCallback(async () => {
    if (startId === null || endId === null) return;
    const range = {
      start: Math.min(startId, endId),
      end: Math.max(startId, endId),
    };
    // Hand off to the import-progress UI immediately; the actual scrape
    // runs in the background. We catch errors here only because the
    // progress modal can be dismissed before the scrape resolves —
    // surfacing the error in the console is the fallback path.
    onStarted();
    try {
      await importFromSourceUrl(sourceId, novelUrl, { chapterIdRange: range });
      onCompleted();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("ranged import failed:", e);
    }
  }, [startId, endId, sourceId, novelUrl, onStarted, onCompleted]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9700,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: FONT_STACKS.sans,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 100%)",
          maxHeight: "90vh",
          background: theme.bg,
          color: theme.ink,
          borderRadius: 14,
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
          border: `0.5px solid ${theme.rule}`,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "22px 22px 8px" }}>
          <div
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontStyle: "italic",
              fontSize: 22,
              marginBottom: 6,
              letterSpacing: "-0.01em",
            }}
          >
            Download a chapter range
          </div>
          <div style={{ fontSize: 13, color: theme.muted, lineHeight: 1.5 }}>
            Pick the first and last chapter to include. The downloaded EPUB
            will be tagged with the range.
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
              Loading chapter list…
            </div>
          ) : error ? (
            <div
              style={{
                padding: 18,
                background: "rgba(180,60,60,0.10)",
                border: "0.5px solid rgba(180,60,60,0.4)",
                borderRadius: 10,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              Couldn't load chapters — {error}
            </div>
          ) : (
            <>
              <RangePicker
                theme={theme}
                label="From"
                choices={choices}
                value={startId}
                onChange={setStartId}
              />
              <RangePicker
                theme={theme}
                label="To"
                choices={choices}
                value={endId}
                onChange={setEndId}
              />
              <div
                style={{
                  fontSize: 12,
                  color: theme.muted,
                  paddingTop: 4,
                }}
              >
                {countSelected(startId, endId)} chapter
                {countSelected(startId, endId) === 1 ? "" : "s"} will be
                downloaded.
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
            Cancel
          </Button>
          <Button
            theme={theme}
            variant="primary"
            size="sm"
            disabled={
              loading || error !== null || startId === null || endId === null
            }
            onClick={submit}
          >
            Download
          </Button>
        </div>
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
}

function RangePicker({
  theme,
  label,
  choices,
  value,
  onChange,
}: RangePickerProps) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: theme.muted,
        }}
      >
        {label}
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        style={{
          padding: "8px 10px",
          fontSize: 13,
          fontFamily: "inherit",
          color: theme.ink,
          background: theme.chrome,
          border: `0.5px solid ${theme.rule}`,
          borderRadius: 8,
          outline: "none",
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
