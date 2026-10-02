import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/useI18n";
import { fetchNotes } from "../../store/fetchNotes";
import type { ReleaseNotes } from "../../store/releaseNotes";
import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  type Theme,
  TOUCH_TARGET_MIN,
} from "../../styles/tokens";
import { AnimatedDialog } from "../AnimatedDialog";
import { Button } from "../Button";
import { Spinner } from "../Spinner";
import { NotesView } from "./NotesView";

type Invoke = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

async function tauriInvoke(cmd: string, args: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args);
}

type Notes = { notes: ReleaseNotes | null; highlightImage?: string };

/** The next version's notes, opened from the update banner or the desktop
 *  sidebar card. The primary button is the caller's own action, passed in,
 *  so install/download logic lives in exactly one place.
 *
 *  With `onLater` the footer is the desktop flow's: Skip this version,
 *  Later, and the action. Without it, Close and the action, as before. */
export function DesktopNotesDialog({
  open,
  version,
  theme,
  actionLabel,
  actionBusy,
  actionDisabled = false,
  onAction,
  onClose,
  onLater,
  onSkip,
  body,
  preloaded,
  invokeImpl = tauriInvoke,
}: {
  open: boolean;
  version: string;
  theme: Theme;
  actionLabel: string;
  actionBusy: boolean;
  /** Shown but not pressable (with no spinner): the state it names is
   *  under way somewhere else, e.g. "Downloading…". */
  actionDisabled?: boolean;
  onAction: () => void;
  onClose: () => void;
  onLater?: () => void;
  onSkip?: () => void;
  /** A sentence above the notes (the manual channel's "can't update
   *  itself"). */
  body?: string;
  /** Notes someone already fetched: undefined fetches them here, null is
   *  still loading. */
  preloaded?: Notes | null;
  invokeImpl?: Invoke;
}) {
  const { tr } = useI18n();
  const [state, setState] = useState<{
    notes: ReleaseNotes | null;
    image?: string;
  } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || preloaded !== undefined) return;
    let live = true;
    setState(null);
    void fetchNotes(invokeImpl, version).then((r) => {
      if (live) setState({ notes: r.notes, image: r.highlightImage });
    });
    return () => {
      live = false;
    };
  }, [open, version, invokeImpl, preloaded]);
  const shown =
    preloaded === undefined
      ? state
      : preloaded && {
          notes: preloaded.notes,
          image: preloaded.highlightImage,
        };

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatedDialog open={open} onScrimClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-notes-title"
        style={{
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 32px)",
          display: "flex",
          flexDirection: "column",
          background: theme.bg,
          color: theme.ink,
          borderRadius: 14,
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
          border: `0.5px solid ${theme.rule}`,
          overflow: "hidden",
          fontFamily: FONT_STACKS.sans,
        }}
      >
        <div style={{ padding: "20px 22px 12px", flex: "none" }}>
          <div
            id="desktop-notes-title"
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontSize: 20,
              color: theme.ink,
            }}
          >
            {tr("whatsNew.title", { v: version })}
          </div>
        </div>
        <div
          style={{
            padding: "0 22px 8px",
            overflowY: "auto",
            minHeight: 80,
            flex: "1 1 auto",
          }}
        >
          {body && (
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 13,
                lineHeight: 1.5,
                color: theme.ink,
              }}
            >
              {body}
            </p>
          )}
          {shown === null ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: "28px 0",
                color: theme.muted,
              }}
            >
              <Spinner size={22} />
            </div>
          ) : (
            <NotesView
              notes={shown.notes}
              theme={theme}
              fallbackVersion={version}
              imageUrl={(n) =>
                n === shown.notes?.highlight?.image ? shown.image : undefined
              }
            />
          )}
        </div>
        <div
          style={{
            padding: "12px 22px 16px",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            flex: "none",
          }}
        >
          {onSkip && (
            <Button
              theme={theme}
              variant="ghost"
              size="sm"
              style={{ minHeight: TOUCH_TARGET_MIN, marginInlineEnd: "auto" }}
              onClick={onSkip}
            >
              {tr("update.sheet.skip")}
            </Button>
          )}
          <Button
            ref={closeRef}
            theme={theme}
            variant="outline"
            size="sm"
            style={onLater ? { minHeight: TOUCH_TARGET_MIN } : undefined}
            onClick={onLater ?? onClose}
          >
            {onLater ? tr("update.action.later") : tr("common.close")}
          </Button>
          <Button
            theme={theme}
            variant="primary"
            size="sm"
            style={onLater ? { minHeight: TOUCH_TARGET_MIN } : undefined}
            loading={actionBusy}
            disabled={actionBusy || actionDisabled}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        </div>
      </div>
    </AnimatedDialog>
  );
}
