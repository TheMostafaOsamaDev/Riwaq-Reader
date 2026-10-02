import rawNotes, { appVersion, images } from "virtual:whats-new";
import { type ReactNode, useEffect, useRef } from "react";
import { useI18n } from "../../i18n/useI18n";
import { parseReleaseNotes } from "../../store/releaseNotes";
import { FONT_STACKS, type Theme, TOUCH_TARGET_MIN } from "../../styles/tokens";
import { AnimatedDialog } from "../AnimatedDialog";
import { Button } from "../Button";
import { MobileSheet } from "../MobileSheet";
import { NotesView } from "./NotesView";
import { StoryPages } from "./StoryPages";

// The bundled value is raw JSON: validate it once, and only trust it when it
// describes the version actually running.
const parsed = parseReleaseNotes(rawNotes);
export const bundledNotes =
  parsed && parsed.version === appVersion ? parsed : null;

const imageUrl = (n: string) => images[n];

/** Big release (stories) → full-screen pages; otherwise → a short sheet on
 *  a phone, a centred dialog at desktop width. */
export function WhatsNewAfterUpdate({
  theme,
  open,
  onClose,
  layout = "mobile",
}: {
  theme: Theme;
  open: boolean;
  onClose: () => void;
  layout?: "mobile" | "desktop";
}) {
  const { tr } = useI18n();
  const notes = bundledNotes;
  if (!notes) return null;
  if (notes.stories?.length) {
    return open ? (
      <StoryPages
        notes={notes}
        theme={theme}
        imageUrl={imageUrl}
        onDone={onClose}
      />
    ) : null;
  }
  if (layout === "desktop") {
    return (
      <WhatsNewDialog
        theme={theme}
        open={open}
        onClose={onClose}
        version={notes.version}
      >
        <NotesView notes={notes} theme={theme} imageUrl={imageUrl} />
      </WhatsNewDialog>
    );
  }
  return (
    <MobileSheet
      theme={theme}
      open={open}
      onClose={onClose}
      height="70%"
      label={tr("whatsNew.title", { v: notes.version })}
    >
      <div style={{ padding: "4px 20px 20px" }}>
        <h2 style={{ margin: "0 0 2px", fontSize: 19, fontWeight: 600 }}>
          {tr("whatsNew.title", { v: notes.version })}
        </h2>
        <p style={{ margin: "0 0 14px", fontSize: 12, color: theme.muted }}>
          {tr("whatsNew.now", { v: notes.version })}
        </p>
        <NotesView notes={notes} theme={theme} imageUrl={imageUrl} />
        <div style={{ marginTop: 16 }}>
          <Button theme={theme} variant="primary" fullWidth onClick={onClose}>
            {tr("whatsNew.gotIt")}
          </Button>
        </div>
      </div>
    </MobileSheet>
  );
}

/** The desktop frame: built like DesktopNotesDialog, with Got it to close. */
export function WhatsNewDialog({
  theme,
  open,
  onClose,
  version,
  children,
}: {
  theme: Theme;
  open: boolean;
  onClose: () => void;
  version: string;
  children: ReactNode;
}) {
  const { tr } = useI18n();
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    doneRef.current?.focus();
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
        aria-labelledby="whats-new-title"
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
          <h2
            id="whats-new-title"
            style={{ margin: "0 0 2px", fontSize: 19, fontWeight: 600 }}
          >
            {tr("whatsNew.title", { v: version })}
          </h2>
          <p style={{ margin: 0, fontSize: 12, color: theme.muted }}>
            {tr("whatsNew.now", { v: version })}
          </p>
        </div>
        <div
          style={{ padding: "0 22px 8px", overflowY: "auto", flex: "1 1 auto" }}
        >
          {children}
        </div>
        <div
          style={{
            padding: "12px 22px 16px",
            display: "flex",
            justifyContent: "flex-end",
            flex: "none",
          }}
        >
          <Button
            ref={doneRef}
            theme={theme}
            variant="primary"
            size="sm"
            style={{ minHeight: TOUCH_TARGET_MIN }}
            onClick={onClose}
          >
            {tr("whatsNew.gotIt")}
          </Button>
        </div>
      </div>
    </AnimatedDialog>
  );
}
