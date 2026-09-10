import type { Theme } from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";

export interface VolumeChaptersSkeletonProps {
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
export function VolumeChaptersSkeleton({
  theme,
  rows,
}: VolumeChaptersSkeletonProps) {
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

export interface VolumeErrorPanelProps {
  theme: Theme;
  message: string;
  onRetry: () => void;
}

export function VolumeErrorPanel({
  theme,
  message,
  onRetry,
}: VolumeErrorPanelProps) {
  const { tr } = useI18n();
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
      <span style={{ flex: 1 }}>
        {tr("novel.chaptersLoadError", { error: message })}
      </span>
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
        {tr("common.retry")}
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
