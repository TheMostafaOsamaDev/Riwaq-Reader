import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/useI18n";
import { fetchNotes } from "../../store/fetchNotes";
import type { ReleaseNotes } from "../../store/releaseNotes";
import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  type Theme,
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

/** The next version's notes, opened from the update banner. The primary
 *  button is the banner's own action, passed in, so install/download logic
 *  lives in exactly one place. */
export function DesktopNotesDialog({
  open,
  version,
  theme,
  actionLabel,
  actionBusy,
  onAction,
  onClose,
  invokeImpl = tauriInvoke,
}: {
  open: boolean;
  version: string;
  theme: Theme;
  actionLabel: string;
  actionBusy: boolean;
  onAction: () => void;
  onClose: () => void;
  invokeImpl?: Invoke;
}) {
  const { tr } = useI18n();
  const [state, setState] = useState<{
    notes: ReleaseNotes | null;
    image?: string;
  } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setState(null);
    void fetchNotes(invokeImpl, version).then((r) => {
      if (live) setState({ notes: r.notes, image: r.highlightImage });
    });
    return () => {
      live = false;
    };
  }, [open, version, invokeImpl]);

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
          {state === null ? (
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
              notes={state.notes}
              theme={theme}
              fallbackVersion={version}
              imageUrl={(n) =>
                n === state.notes?.highlight?.image ? state.image : undefined
              }
            />
          )}
        </div>
        <div
          style={{
            padding: "12px 22px 16px",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            flex: "none",
          }}
        >
          <Button
            ref={closeRef}
            theme={theme}
            variant="outline"
            size="sm"
            onClick={onClose}
          >
            {tr("common.close")}
          </Button>
          <Button
            theme={theme}
            variant="primary"
            size="sm"
            loading={actionBusy}
            disabled={actionBusy}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        </div>
      </div>
    </AnimatedDialog>
  );
}
