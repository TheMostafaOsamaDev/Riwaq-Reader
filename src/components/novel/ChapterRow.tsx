
import {
  useCallback,
  useState,
  memo,
} from "react";
import type { SourceChapter, } from "../../sources/types";
import type { DownloadJob } from "../../store/downloadQueue";
import { transition } from "../../styles/motion";

import {
  ACCENT,
  type Theme,
} from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import { Icon } from "../Icon";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useLongPress } from "../../hooks/useLongPress";

/** Resting height of a one-line chapter row. Only a seed for the windowed
 *  list's offset table — rows that wrap get measured and corrected.
 *
 *  44px, not the old 36: the row now carries a delete action beside the
 *  download one, and 36 put both under the 44px touch minimum. This
 *  feeds MeasuredVirtualList's estimatedItemHeight — leaving it stale
 *  makes the list mis-estimate its scroll extent on a 950-row volume. */
export const CHAPTER_ROW_HEIGHT = 44;

export interface ChapterRowProps {
  theme: Theme;
  chapter: SourceChapter;
  direction: "ltr" | "rtl";
  read: boolean;
  downloaded: boolean;
  libraryEntryId: string | null | undefined;
  novelTitle: string;
  queueJob: DownloadJob | undefined;
  onOpenChapter: (chapterId: number) => void;
  /** Asks the accordion to delete this row's download. A request, not a
   *  notification: the accordion owns deleteChaptersWithQueue, the flag
   *  refresh and every toast this can produce — including the error one
   *  a failed snapshot write needs, which a row has no channel for. */
  onRequestDelete: (chapterId: number) => void;
  /** True once the accordion is in selection mode (any row long-pressed
   *  or right-clicked). Swaps the row's click behaviour from "open
   *  chapter" to "toggle selection" and reveals the checkbox. */
  selecting: boolean;
  /** Whether THIS row is in the parent's selected set. A boolean, not
   *  the Set itself, so only the rows whose selectedness actually
   *  changed re-render under `memo`. */
  selected: boolean;
  onToggleSelect: (chapterId: number) => void;
  onEnterSelection: (chapterId: number) => void;
}

/**
 * One row in a volume's chapter list.
 *
 * Memoized on purpose. The parent re-renders on every download-queue event
 * (`setActiveJobs` installs a fresh Map each tick), and with a ~950-chapter
 * volume expanded that meant reconciling every mounted row several times a
 * second during a download burst. All props here are primitives or stable
 * identities, so a row only re-renders when something about *that* chapter
 * actually changed.
 */
export const ChapterRow = memo(function ChapterRow({
  theme,
  chapter,
  direction,
  read,
  downloaded,
  libraryEntryId,
  novelTitle,
  queueJob,
  onOpenChapter,
  onRequestDelete,
  selecting,
  selected,
  onToggleSelect,
  onEnterSelection,
}: ChapterRowProps) {
  const { tr } = useI18n();
  // Long-press / right-click entry point, shared by the pointer-based
  // long-press below and the onContextMenu handler.
  //
  // Only downloaded chapters are selectable — selection exists in order
  // to delete, so a row with nothing to delete in the set would need a
  // disabled state in the action bar. This guard used to live in the
  // parent's `enterSelection`, keyed off `chapterFlags`, but that gave
  // every row's `onEnterSelection` prop a new identity whenever flags
  // were rebuilt, defeating the memo for every mounted row at once.
  // `downloaded` is already a stable per-row boolean prop, so the guard
  // belongs here instead.
  //
  // While already selecting, a long-press or right-click toggles the
  // row like a tap does rather than resetting the whole selection to
  // just this one chapter — otherwise a stray long-press mid-multi-select
  // would silently collapse a large selection down to one row.
  const activateForSelection = () => {
    if (!downloaded) return;
    if (selecting) onToggleSelect(chapter.id);
    else onEnterSelection(chapter.id);
  };
  // ignoreMouse: this list's primary action is "open the chapter", and a
  // deliberate slow left-click held past 500ms was entering selection
  // mode instead. Desktop keeps the right-click entry below, which is
  // unambiguous. An intentional, approved deviation from the design
  // spec's "long-press or right-click" wording.
  const { bind, consumeLongPress } = useLongPress(activateForSelection, {
    ignoreMouse: true,
  });
  return (
    <div
      role={selecting ? undefined : "listitem"}
      style={{ display: "flex", alignItems: "stretch", direction }}
    >
      <button
        {...bind}
        onContextMenu={(e) => {
          e.preventDefault();
          activateForSelection();
        }}
        onClick={() => {
          if (consumeLongPress()) return;
          if (selecting) {
            if (downloaded) onToggleSelect(chapter.id);
            return;
          }
          onOpenChapter(chapter.id);
        }}
        role={selecting ? "option" : undefined}
        aria-selected={selecting ? selected : undefined}
        // Only downloaded rows are selectable, and onClick silently
        // ignores the rest. Without aria-disabled a screen-reader user
        // hears "option, not selected", activates it, and gets nothing
        // announced back — repeatedly, down a 950-row volume.
        aria-disabled={selecting && !downloaded}
        // The title is folded in because aria-label REPLACES the
        // element's accessible name: labelling the row "Select chapter
        // 12" alone left a screen-reader user in selection mode with no
        // chapter title at all — the one fact they need to decide what
        // to delete.
        aria-label={
          selecting
            ? tr("downloads.delete.selectChapter", {
                n: chapter.id,
                title: chapter.title,
              })
            : undefined
        }
        style={{
          flex: 1,
          textAlign: "start",
          background: selected
            ? `color-mix(in srgb, ${ACCENT} 10%, transparent)`
            : "transparent",
          border: "none",
          // Start-edge accent bar — transparent by default, theme.rule when
          // read, ACCENT on hover or when selected. A fixed 2px logical
          // border (never toggled to 0) so the colour change never shifts
          // the row's layout.
          borderInlineStart: `2px solid ${
            selected ? ACCENT : read ? theme.rule : "transparent"
          }`,
          paddingBlock: 13,
          paddingInlineStart: 26,
          paddingInlineEnd: 14,
          // Dim read chapters so the list reads "checked off" without hiding
          // anything.
          color: read ? theme.muted : theme.ink,
          opacity: read ? 0.72 : 1,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 12.5,
          lineHeight: 1.4,
          display: "flex",
          gap: 10,
          alignItems: "baseline",
          direction,
          transition: transition("border-color", "fast", "out"),
        }}
        onMouseEnter={(e) => {
          if (selected) return;
          e.currentTarget.style.background = theme.hover;
          e.currentTarget.style.borderInlineStartColor = ACCENT;
        }}
        onMouseLeave={(e) => {
          if (selected) return;
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.borderInlineStartColor = read
            ? theme.rule
            : "transparent";
        }}
      >
        {selecting && (
          <span
            aria-hidden
            style={{
              width: 17,
              height: 17,
              borderRadius: 5,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              border: `1.5px solid ${selected ? ACCENT : theme.ruleStrong}`,
              background: selected ? ACCENT : "transparent",
              color: "#fff",
              opacity: downloaded ? 1 : 0.3,
              transition: transition("background-color", "fast", "out"),
            }}
          >
            {selected && <Icon name="check" size={11} />}
          </span>
        )}
        <span
          style={{
            fontSize: 11,
            color: theme.muted,
            minWidth: 28,
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {chapter.id}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>{chapter.title}</span>
      </button>
      {libraryEntryId && !selecting && (
        <ChapterDownloadButton
          theme={theme}
          libraryEntryId={libraryEntryId}
          chapterId={chapter.id}
          downloaded={downloaded}
          novelTitle={novelTitle}
          chapterTitle={chapter.title}
          queueJob={queueJob}
          onRequestDelete={onRequestDelete}
        />
      )}
    </div>
  );
});

export interface ChapterDownloadButtonProps {
  theme: Theme;
  libraryEntryId: string;
  chapterId: number;
  /** True when the chapter has been downloaded to disk according to
   *  the parent's flag map. The button uses this for the resting state
   *  ("downloaded" check icon, armed into a delete action) and as a
   *  guard against re-enqueuing. */
  downloaded: boolean;
  /** Asks the accordion to delete this chapter's download. See
   *  ChapterRowProps.onRequestDelete for why the button doesn't run the
   *  delete itself. */
  onRequestDelete: (chapterId: number) => void;
}

export function ChapterDownloadButton({
  theme,
  libraryEntryId,
  chapterId,
  downloaded,
  novelTitle,
  chapterTitle,
  queueJob,
  onRequestDelete,
}: ChapterDownloadButtonProps & {
  novelTitle: string;
  chapterTitle: string;
  /** Live queue job for this chapter when one is queued/running.
   *  Drives the spinner/progress indicator without us needing a
   *  separate subscription per row — the parent subscribes once and
   *  fans out. */
  queueJob: import("../../store/downloadQueue").DownloadJob | undefined;
}) {
  const { tr } = useI18n();

  const onClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (downloaded) {
        // Single deletes skip the dialog: a deleted chapter is always
        // re-downloadable from the source, so the toast's action is a
        // cheaper undo than a modal. Bulk deletes still confirm.
        //
        // The delete runs in the accordion rather than here. It has to:
        // deleteChapterDownloads ends in a writeTextFile that throws on
        // a full disk — exactly the state a user deleting downloads is
        // in — and the toast that has to report that lives up there.
        onRequestDelete(chapterId);
        return;
      }
      if (queueJob) {
        const { cancel } = await import("../../store/downloadQueue");
        cancel(queueJob.id);
        return;
      }
      const { enqueue } = await import("../../store/downloadQueue");
      enqueue({ libraryEntryId, chapterId, novelTitle, chapterTitle });
    },
    [
      libraryEntryId,
      chapterId,
      downloaded,
      queueJob,
      novelTitle,
      chapterTitle,
      onRequestDelete,
    ],
  );

  // The touch-detection idiom used elsewhere in this codebase
  // (ContextMenu.tsx): `(hover: none)` alone misses Android Chrome
  // configs that report `hover: hover`, so OR with `(pointer: coarse)`
  // and fall back to navigator.maxTouchPoints.
  const mqTouch = useMediaQuery("(hover: none), (pointer: coarse)");
  const isTouch =
    mqTouch ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);

  // The downloaded row's icon is a ✓ at rest and a trash on hover or
  // keyboard focus. The button stays in the DOM and focusable at all
  // times — a hover-only control would be unreachable by keyboard —
  // and touch (no hover) shows the trash permanently.
  const [armed, setArmed] = useState(false);
  const showTrash = downloaded && (armed || isTouch);

  // Resting state precedence:
  //   downloaded (persisted)  → check icon, dim (trash armed on hover/focus/touch)
  //   queued                  → clock icon
  //   running                 → spinning download icon + progress %
  //   error (recent)          → info icon, warning color
  //   idle                    → download icon
  const status = downloaded
    ? "downloaded"
    : queueJob?.status === "queued"
      ? "queued"
      : queueJob?.status === "running"
        ? "running"
        : queueJob?.status === "error"
          ? "error"
          : "idle";

  // "downloaded" is an SD card, not a tick: a tick reads as "done", and this
  // row's point is that the content lives on THIS DEVICE — which is also why
  // the resting glyph doubles as the delete button. "idle" is the enclosed
  // download arrow, so the pair reads as one state and its opposite.
  const iconName = showTrash
    ? "trash"
    : status === "downloaded"
      ? "sdCard"
      : status === "queued"
        ? "clock"
        : status === "running"
          ? "chevronsD"
          : status === "error"
            ? "xCirc"
            : "downloadCirc";

  // The downloaded label is now the delete label — an icon-only button
  // whose aria-label still said "Downloaded" would announce the wrong
  // action to a screen reader.
  const label =
    status === "downloaded"
      ? tr("downloads.delete.chapterLabel", { n: chapterId })
      : status === "queued"
        ? tr("novel.queuedClickCancel")
        : status === "running"
          ? tr("novel.downloadingClickCancel", {
              pct: Math.round((queueJob?.progress ?? 0) * 100),
            })
          : status === "error"
            ? tr("downloads.statusFailed", {
                error: queueJob?.error ?? tr("downloads.unknownError"),
              })
            : tr("novel.downloadChapter");
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      onMouseEnter={() => setArmed(true)}
      onMouseLeave={() => setArmed(false)}
      onFocus={() => setArmed(true)}
      onBlur={() => setArmed(false)}
      style={{
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: "0 14px",
        display: "flex",
        alignItems: "center",
        gap: 4,
        color: showTrash || status === "error" ? theme.danger : theme.muted,
        opacity: downloaded && !showTrash ? 0.55 : 1,
        flexShrink: 0,
      }}
    >
      <Icon name={iconName} size={14} />
      {status === "running" && (
        <span style={{ fontSize: 10, color: theme.muted }}>
          {Math.round((queueJob?.progress ?? 0) * 100)}%
        </span>
      )}
    </button>
  );
}

// ── volumes accordion ──────────────────────────────────────────────────────
