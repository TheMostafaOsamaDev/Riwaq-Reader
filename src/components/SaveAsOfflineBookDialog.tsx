// "Save as offline book" choice dialog — appears from the source-
// backed NovelDetailView's action row. Lets the user pick between
// one merged EPUB or one EPUB per volume, then enqueues the
// conversion into the unified download queue.
//
// All chapters are always included (the legacy Download Range dialog
// still covers "I only want chapters X to Y" via the per-chapter
// download flow). The dialog is intentionally narrow on choice so
// the user reaches "Save" in one tap.

import { useEffect, useMemo, useState } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  type Theme,
} from "../styles/tokens";
import { enqueueConversion } from "../store/downloadQueue";
import {
  readSnapshot,
  type SourceSnapshot,
} from "../store/sourceLibrary";
import { useI18n } from "../i18n/useI18n";

type ConvertMode = "single" | "per-volume";

interface Props {
  theme: Theme;
  layout: "desktop" | "mobile";
  libraryEntryId: string;
  novelTitle: string;
  onCancel: () => void;
  /** Conversion has been enqueued — the parent should close us. The
   *  queue page (download icon in the library header) shows progress
   *  from here. */
  onEnqueued: () => void;
}

export function SaveAsOfflineBookDialog({
  theme,
  layout,
  libraryEntryId,
  novelTitle,
  onCancel,
  onEnqueued,
}: Props) {
  const { tr } = useI18n();
  const isMobile = layout === "mobile";
  const [snapshot, setSnapshot] = useState<SourceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ConvertMode>("single");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap = await readSnapshot(libraryEntryId);
      if (cancelled) return;
      setSnapshot(snap);
      setLoading(false);
      // Default per-volume when the novel has many volumes — one
      // huge merged book is awkward on Kindle/Apple Books, while N
      // smaller EPUBs read more naturally. Threshold of 3+ matches
      // typical web-novel / light-novel conventions.
      if (snap && snap.volumes.length >= 3) {
        setMode("per-volume");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryEntryId]);

  const stats = useMemo(() => {
    if (!snapshot) return { volumes: 0, chapters: 0, downloaded: 0, unloaded: 0 };
    let chapters = 0;
    let downloaded = 0;
    let unloaded = 0;
    for (const v of snapshot.volumes) {
      if (v.chaptersLoaded === false && v.chapters.length === 0) {
        unloaded++;
      }
      for (const c of v.chapters) {
        chapters++;
        if (c.downloadedAt) downloaded++;
      }
    }
    return { volumes: snapshot.volumes.length, chapters, downloaded, unloaded };
  }, [snapshot]);

  const onSave = () => {
    enqueueConversion({
      libraryEntryId,
      novelTitle,
      mode,
    });
    onEnqueued();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-offline-heading"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9700,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isMobile ? 0 : 24,
        fontFamily: FONT_STACKS.sans,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: isMobile ? "100%" : "min(540px, 100%)",
          maxHeight: isMobile ? "100%" : "90vh",
          height: isMobile ? "100%" : "auto",
          background: theme.bg,
          color: theme.ink,
          borderRadius: isMobile ? 0 : 14,
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
          border: `0.5px solid ${theme.rule}`,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 18px 14px",
            borderBottom: `0.5px solid ${theme.rule}`,
          }}
        >
          <button
            onClick={onCancel}
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
              id="save-offline-heading"
              style={{
                fontFamily: FONT_SERIF_DISPLAY,
                fontWeight: 400,
                fontSize: 22,
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              {tr("downloads.saveOffline.title")}
            </h2>
            <div
              style={{
                marginTop: 2,
                fontSize: 11,
                color: theme.muted,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {novelTitle}
            </div>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "16px 18px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {loading ? (
            <div
              style={{
                padding: "30px 0",
                textAlign: "center",
                color: theme.muted,
                fontSize: 13,
              }}
            >
              {tr("downloads.saveOffline.loading")}
            </div>
          ) : !snapshot ? (
            <div
              style={{
                padding: 16,
                background: "rgba(180,60,60,0.10)",
                border: "0.5px solid rgba(180,60,60,0.4)",
                borderRadius: 10,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {tr("downloads.saveOffline.readError")}
            </div>
          ) : (
            <>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: theme.muted,
                }}
              >
                {tr("downloads.saveOffline.description")}
              </p>

              <ModeOption
                theme={theme}
                title={tr("downloads.saveOffline.singleTitle")}
                detail={tr("downloads.saveOffline.singleDetail")}
                selected={mode === "single"}
                onSelect={() => setMode("single")}
                disabled={snapshot.volumes.length === 0}
              />
              <ModeOption
                theme={theme}
                title={tr("downloads.saveOffline.perVolumeTitle")}
                detail={tr(
                  stats.volumes === 1
                    ? "downloads.saveOffline.perVolumeDetailOne"
                    : "downloads.saveOffline.perVolumeDetailOther",
                  { n: stats.volumes },
                )}
                selected={mode === "per-volume"}
                onSelect={() => setMode("per-volume")}
                disabled={snapshot.volumes.length <= 1}
                disabledReason={
                  snapshot.volumes.length <= 1
                    ? tr("downloads.saveOffline.onlyOneVolume")
                    : undefined
                }
              />

              <StatsRow theme={theme} stats={stats} />
            </>
          )}
        </div>

        <div
          style={{
            padding: "14px 18px 18px",
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
            disabled={loading || !snapshot}
            onClick={onSave}
          >
            {tr("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface ModeOptionProps {
  theme: Theme;
  title: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

function ModeOption({
  theme,
  title,
  detail,
  selected,
  onSelect,
  disabled,
  disabledReason,
}: ModeOptionProps) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onSelect}
      aria-pressed={selected}
      disabled={disabled}
      style={{
        textAlign: "start",
        display: "flex",
        gap: 12,
        padding: "14px 16px",
        // Selected uses the opaque `chromeHover` (a hair darker/lighter than
        // the unselected `chrome`) plus the strong ink border, so the active
        // choice reads as MORE prominent. Previously it used the faint
        // translucent `hover`, which made the selected option look fainter
        // than the unselected ones.
        background: selected ? theme.chromeHover : theme.chrome,
        border: selected
          ? `2px solid ${theme.ink}`
          : `0.5px solid ${theme.rule}`,
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        color: theme.ink,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          border: `1.5px solid ${selected ? theme.ink : theme.rule}`,
          background: selected ? theme.ink : "transparent",
          flexShrink: 0,
          marginTop: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected && (
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: theme.bg,
            }}
          />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "-0.005em",
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12.5,
            color: theme.muted,
            lineHeight: 1.5,
          }}
        >
          {disabledReason ?? detail}
        </div>
      </div>
    </button>
  );
}

interface StatsRowProps {
  theme: Theme;
  stats: { volumes: number; chapters: number; downloaded: number; unloaded: number };
}

function StatsRow({ theme, stats }: StatsRowProps) {
  const { tr } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 4,
      }}
    >
      <Stat
        theme={theme}
        label={tr(
          stats.volumes === 1
            ? "downloads.saveOffline.volumesCountOne"
            : "downloads.saveOffline.volumesCountOther",
          { n: stats.volumes },
        )}
      />
      <Stat
        theme={theme}
        label={tr(
          stats.chapters === 1
            ? "downloads.saveOffline.chaptersCountOne"
            : "downloads.saveOffline.chaptersCountOther",
          { n: stats.chapters },
        )}
      />
      <Stat
        theme={theme}
        label={tr("downloads.saveOffline.alreadyDownloaded", {
          n: stats.downloaded,
        })}
      />
      {stats.unloaded > 0 && (
        <Stat
          theme={theme}
          tone="warn"
          label={tr(
            stats.unloaded === 1
              ? "downloads.saveOffline.volumesNotLoadedOne"
              : "downloads.saveOffline.volumesNotLoadedOther",
            { n: stats.unloaded },
          )}
        />
      )}
    </div>
  );
}

function Stat({
  theme,
  label,
  tone,
}: {
  theme: Theme;
  label: string;
  tone?: "warn";
}) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: "4px 9px",
        borderRadius: 999,
        border:
          tone === "warn"
            ? "0.5px solid rgba(180,60,60,0.5)"
            : `0.5px solid ${theme.rule}`,
        color: tone === "warn" ? "#b75050" : theme.muted,
        background: tone === "warn" ? "rgba(180,60,60,0.10)" : theme.bg,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
