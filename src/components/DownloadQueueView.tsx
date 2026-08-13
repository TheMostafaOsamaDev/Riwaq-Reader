// Download queue page — a sheet listing active and recently-completed
// chapter downloads. Subscribes to the module-scoped queue so jobs
// update in real time.
//
// Behavior contract:
//   - Active section: queued + running, in enqueue order
//   - Recent section: done / error / cancelled, newest first
//   - Each row: novel title, chapter title, status, progress bar
//     (running), cancel button (active rows only), clear button
//     (recent rows individually OR via a "Clear completed" toolbar
//     action)
//
// Lives in a portal so callers can mount it from anywhere (library
// header, future Store header, etc.) without worrying about parent
// stacking-context bugs.

import { useEffect, useState } from "react";
import {
  cancel as cancelJob,
  clearTerminals,
  getState as getQueueState,
  retry as retryJob,
  retryAll,
  subscribe as subscribeToQueue,
  type DownloadJob,
} from "../store/downloadQueue";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme } from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";
import type { Tr } from "../i18n";

interface Props {
  theme: Theme;
  layout: "desktop" | "mobile";
  onClose: () => void;
}

export function DownloadQueueView({ theme, layout, onClose }: Props) {
  const { tr } = useI18n();
  // Snapshot the queue once on mount and re-snapshot on every
  // emission. Job objects are mutated in place by the queue, but
  // setState with a fresh array forces React to re-render.
  const [jobs, setJobs] = useState<DownloadJob[]>(() => [
    ...getQueueState().jobs,
  ]);
  useEffect(() => {
    const off = subscribeToQueue((s) => setJobs([...s.jobs]));
    return off;
  }, []);

  // Split active jobs by kind so conversions get their own section —
  // they're slower (whole-novel scope) and produce a more dramatic
  // outcome (one or more new library entries), so calling them out
  // separately matches what the user expects when starting one.
  const activeConversions = jobs.filter(
    (j) =>
      j.kind === "conversion" &&
      (j.status === "queued" || j.status === "running"),
  );
  const activeDownloads = jobs.filter(
    (j) =>
      j.kind === "chapter" &&
      (j.status === "queued" || j.status === "running"),
  );
  const interrupted = jobs
    .filter((j) => j.status === "interrupted")
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const activeCount = activeConversions.length + activeDownloads.length;
  const recent = jobs
    .filter(
      (j) =>
        j.status === "done" || j.status === "error" || j.status === "cancelled",
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const isMobile = layout === "mobile";

  return (
    // The scrim, centering, and enter/exit animation live in
    // AnimatedFullScreen at the call site. On mobile it slides up
    // full-bleed; on desktop it fade-pops a centered card.
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-queue-heading"
      style={{
        width: isMobile ? "100%" : 560,
        maxHeight: isMobile ? "100%" : "84vh",
        height: isMobile ? "100%" : "auto",
        background: theme.bg,
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
        borderRadius: isMobile ? 0 : 14,
        boxShadow: "0 16px 40px rgba(0,0,0,0.32)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: FONT_STACKS.sans,
        // Sheet sits at the top of the viewport on mobile (height 100%) —
        // without explicit safe-area padding the header collides with
        // the status bar on devices with a notch.
        ...(isMobile
          ? {
              paddingTop: "env(safe-area-inset-top, 0px)",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
              paddingLeft: "env(safe-area-inset-left, 0px)",
              paddingRight: "env(safe-area-inset-right, 0px)",
              boxSizing: "border-box",
            }
          : null),
      }}
    >
        <Header
          theme={theme}
          activeCount={activeCount}
          interruptedCount={interrupted.length}
          onClose={onClose}
          onClearCompleted={recent.length > 0 ? clearTerminals : undefined}
        />
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "8px 0 16px",
          }}
        >
          {activeCount === 0 &&
            interrupted.length === 0 &&
            recent.length === 0 && (
              <div
                style={{
                  padding: "40px 24px",
                  textAlign: "center",
                  color: theme.muted,
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {tr("downloads.emptyState")}
              </div>
            )}
          {interrupted.length > 0 && (
            <Section
              title={tr("downloads.sectionInterrupted")}
              tone="warn"
              theme={theme}
              action={
                interrupted.length > 1 ? (
                  <Button
                    theme={theme}
                    variant="ghost"
                    size="sm"
                    onClick={retryAll}
                  >
                    {tr("downloads.retryAll")}
                  </Button>
                ) : null
              }
            >
              {interrupted.map((j) => (
                <JobRow key={j.id} theme={theme} job={j} tr={tr} />
              ))}
            </Section>
          )}
          {activeConversions.length > 0 && (
            <Section
              title={tr("downloads.sectionSavingOffline")}
              tone="accent"
              theme={theme}
            >
              {activeConversions.map((j) => (
                <JobRow key={j.id} theme={theme} job={j} tr={tr} />
              ))}
            </Section>
          )}
          {activeDownloads.length > 0 && (
            <Section title={tr("downloads.sectionDownloading")} theme={theme}>
              {activeDownloads.map((j) => (
                <JobRow key={j.id} theme={theme} job={j} tr={tr} />
              ))}
            </Section>
          )}
          {recent.length > 0 && (
            <Section title={tr("downloads.sectionRecent")} theme={theme}>
              {recent.map((j) => (
                <JobRow key={j.id} theme={theme} job={j} tr={tr} />
              ))}
            </Section>
          )}
        </div>
    </div>
  );
}

// ── header ────────────────────────────────────────────────────────────────

interface HeaderProps {
  theme: Theme;
  activeCount: number;
  interruptedCount: number;
  onClose: () => void;
  /** Present when there's something to clear. Undefined hides the
   *  button rather than rendering a disabled one. */
  onClearCompleted?: () => void;
}

function Header({
  theme,
  activeCount,
  interruptedCount,
  onClose,
  onClearCompleted,
}: HeaderProps) {
  const { tr } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "16px 18px 14px",
        borderBottom: `0.5px solid ${theme.rule}`,
      }}
    >
      {/* Side-page convention: the leftmost control is a back arrow.
          Tapping it closes the sheet (returns the user to whatever
          was underneath). Matches NovelDetailView's header. */}
      <button
        onClick={onClose}
        aria-label={tr("common.back")}
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2
          id="download-queue-heading"
          style={{
            fontFamily: FONT_SERIF_DISPLAY,
            fontStyle: "italic",
            fontWeight: 400,
            fontSize: 22,
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          {tr("sidebar.downloads")}
        </h2>
        <div
          style={{
            marginTop: 2,
            fontSize: 11,
            color: theme.muted,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          {(() => {
            const interruptedText = tr(
              interruptedCount === 1
                ? "downloads.interruptedOne"
                : "downloads.interruptedOther",
              { n: interruptedCount },
            );
            const activeText = tr(
              activeCount === 1
                ? "downloads.activeCountOne"
                : "downloads.activeCountOther",
              { n: activeCount },
            );
            if (interruptedCount > 0) {
              return activeCount > 0
                ? `${interruptedText} · ${activeText}`
                : interruptedText;
            }
            return activeCount === 0 ? tr("downloads.allCaughtUp") : activeText;
          })()}
        </div>
      </div>
      {onClearCompleted && (
        <Button theme={theme} variant="ghost" size="sm" onClick={onClearCompleted}>
          {tr("downloads.clearCompleted")}
        </Button>
      )}
    </div>
  );
}

// ── section ───────────────────────────────────────────────────────────────

function Section({
  title,
  children,
  tone,
  theme,
  action,
}: {
  title: string;
  children: React.ReactNode;
  /** "accent" — tinted band for the Conversions group. "warn" —
   *  red-tinted band for the Interrupted group (jobs the user
   *  needs to act on). Default — neutral, used for Active downloads
   *  + Recent. */
  tone?: "accent" | "warn";
  theme: Theme;
  /** Optional right-aligned action button in the section header
   *  (e.g. "Retry all" for the Interrupted section). */
  action?: React.ReactNode;
}) {
  const accent = tone === "accent";
  const warn = tone === "warn";
  return (
    <div
      style={{
        marginTop: 8,
        ...(accent
          ? {
              background: theme.chrome,
              borderTop: `0.5px solid ${theme.rule}`,
              borderBottom: `0.5px solid ${theme.rule}`,
            }
          : null),
        ...(warn
          ? {
              background: "rgba(180,90,50,0.08)",
              borderTop: "0.5px solid rgba(180,90,50,0.35)",
              borderBottom: "0.5px solid rgba(180,90,50,0.35)",
            }
          : null),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: "10px 18px 6px",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: warn ? "#b75050" : accent ? theme.ink : theme.muted,
            opacity: accent || warn ? 0.9 : 0.6,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
          }}
        >
          {accent && (
            <Icon
              name="bookmark"
              size={12}
              style={{ color: theme.ink, opacity: 0.85 }}
            />
          )}
          {warn && (
            <Icon
              name="info"
              size={12}
              style={{ color: "#b75050" }}
            />
          )}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── row ───────────────────────────────────────────────────────────────────

function JobRow({
  theme,
  job,
  tr,
}: {
  theme: Theme;
  job: DownloadJob;
  tr: Tr;
}) {
  const isActive = job.status === "queued" || job.status === "running";
  const statusLine = describe(job, tr);
  const subtitle = subtitleFor(job, tr);
  return (
    <div
      style={{
        padding: "10px 18px",
        borderTop: `0.5px solid ${theme.rule}`,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: theme.ink,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={job.novelTitle}
        >
          {job.novelTitle}
        </div>
        <div
          style={{
            fontSize: 12,
            color: theme.muted,
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={subtitle}
        >
          {subtitle}
        </div>
        <div style={{ marginTop: 6 }}>
          <ProgressBar theme={theme} job={job} />
        </div>
        <div
          style={{
            fontSize: 11,
            color:
              job.status === "error"
                ? "#b75050"
                : job.status === "done"
                  ? theme.muted
                  : theme.muted,
            marginTop: 4,
          }}
        >
          {statusLine}
        </div>
      </div>
      {isActive && (
        <button
          onClick={() => cancelJob(job.id)}
          title={tr("common.cancel")}
          aria-label={tr("downloads.cancelDownload")}
          style={{
            background: "transparent",
            border: `0.5px solid ${theme.rule}`,
            borderRadius: 18,
            width: 34,
            height: 34,
            color: theme.muted,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon name="close" size={14} />
        </button>
      )}
      {job.status === "interrupted" && (
        <button
          onClick={() => retryJob(job.id)}
          title={tr("common.retry")}
          aria-label={tr("common.retry")}
          style={{
            background: theme.ink,
            border: "none",
            borderRadius: 18,
            height: 34,
            padding: "0 14px",
            color: theme.bg,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            flexShrink: 0,
            fontFamily: "inherit",
            fontSize: 12.5,
            fontWeight: 500,
          }}
        >
          <Icon name="download" size={12} />
          {tr("common.retry")}
        </button>
      )}
    </div>
  );
}

function ProgressBar({ theme, job }: { theme: Theme; job: DownloadJob }) {
  // Show a bar only for running jobs; queued + terminal use the
  // status line to convey state.
  if (job.status !== "running") return null;
  const pct = Math.max(0, Math.min(1, job.progress));
  return (
    <div
      style={{
        height: 4,
        borderRadius: 2,
        background: theme.chrome,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${Math.round(pct * 100)}%`,
          height: "100%",
          background: theme.ink,
          transition: "width 180ms ease",
        }}
      />
    </div>
  );
}

function describe(job: DownloadJob, tr: Tr): string {
  switch (job.status) {
    case "queued":
      return tr("downloads.statusWaiting");
    case "running":
      // Conversion jobs carry a free-form `phase` label that's more
      // useful than a bare percentage ("Building EPUB" / "Saving to
      // library" / "Fetching chapter 47 / 213"). That label is produced
      // deep in the conversion pipeline (store/storeConversion.ts) and
      // isn't yet localized — tracked separately from this surface's
      // own strings. For chapter jobs we just show the percent.
      if (job.kind === "conversion") {
        return `${job.phase} · ${Math.round(job.progress * 100)}%`;
      }
      return `${Math.round(job.progress * 100)}%`;
    case "done":
      if (job.kind === "conversion") {
        const n = job.producedEntryIds.length;
        return tr(
          n === 1 ? "downloads.statusSavedOne" : "downloads.statusSavedOther",
          { n },
        );
      }
      return tr("downloads.statusDownloaded");
    case "error":
      return tr("downloads.statusFailed", {
        error: job.error ?? tr("downloads.unknownError"),
      });
    case "cancelled":
      return tr("downloads.statusCancelled");
    case "interrupted":
      // Distinguish conversion mid-flight (some volumes already
      // produced) from a freshly-interrupted chapter download.
      if (job.kind === "conversion" && job.producedEntryIds.length > 0) {
        const n = job.producedEntryIds.length;
        return tr(
          n === 1
            ? "downloads.statusInterruptedPartialOne"
            : "downloads.statusInterruptedPartialOther",
          { n },
        );
      }
      return tr("downloads.statusInterruptedResume");
  }
}

/** Second line of each row: chapter title for chapter jobs, mode
 *  description for conversion jobs. */
function subtitleFor(job: DownloadJob, tr: Tr): string {
  if (job.kind === "chapter") return job.chapterTitle;
  return tr(
    job.mode === "single"
      ? "downloads.saveOffline.singleTitle"
      : "downloads.saveOffline.perVolumeTitle",
  );
}
