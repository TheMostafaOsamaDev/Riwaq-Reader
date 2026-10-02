// The desktop update dialogs and toasts, read straight from the desktop
// store. App mounts this once on desktop, so the sidebar card and the
// Settings card open the same dialogs:
//   notes    → DesktopNotesDialog: Skip this version, Later, Update/Download
//   progress → the download, with Hide only (the plugin cannot abort)
//   failed   → Try again, Download from GitHub

import { type ReactNode, useCallback, useId, useRef } from "react";
import { useI18n } from "../../i18n/useI18n";
import {
  closeDialog,
  dismissToast,
  later,
  openDialog,
  openReleasePage,
  restart,
  skip,
  undoSkip,
  update,
  useDesktopUpdate,
} from "../../store/desktopUpdate";
import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  type Theme,
  TOUCH_TARGET_MIN,
} from "../../styles/tokens";
import { AnimatedDialog } from "../AnimatedDialog";
import { Button } from "../Button";
import { Icon, type IconProps } from "../Icon";
import { DesktopNotesDialog } from "./DesktopNotesDialog";
import {
  IconBadge,
  ProgressBar,
  progressText,
  UpdateToast,
  useDialogKeys,
} from "./parts";

const BTN = { minHeight: TOUCH_TARGET_MIN };
const showNotes = () => openDialog("notes");

/** A centred card, built like DesktopNotesDialog. Escape and the scrim
 *  close it; the first button is focused when it opens. */
function Frame({
  open,
  theme,
  icon,
  danger,
  title,
  children,
  actions,
  onClose,
}: {
  open: boolean;
  theme: Theme;
  icon: IconProps["name"];
  danger?: boolean;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogKeys(open, onClose, ref);
  // One per Frame: two Frames can be mounted at once (one leaving while the
  // other opens), and a shared id would label both with one title.
  const titleId = useId();
  return (
    <AnimatedDialog open={open} onScrimClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          width: "min(440px, calc(100vw - 32px))",
          background: theme.bg,
          color: theme.ink,
          borderRadius: 14,
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
          border: `0.5px solid ${theme.rule}`,
          fontFamily: FONT_STACKS.sans,
          padding: "20px 22px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <IconBadge
            theme={theme}
            icon={icon}
            size={32}
            radius={10}
            iconSize={16}
            color={danger ? theme.danger : undefined}
            ring={danger ? theme.danger : undefined}
          />
          <div
            id={titleId}
            style={{
              fontFamily: FONT_SERIF_DISPLAY,
              fontSize: 19,
              color: theme.ink,
            }}
          >
            {title}
          </div>
        </div>
        <div style={{ marginTop: 14 }}>{children}</div>
        <div
          ref={ref}
          style={{
            display: "flex",
            justifyContent: "flex-end",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 18,
          }}
        >
          {actions}
        </div>
      </div>
    </AnimatedDialog>
  );
}

export function DesktopUpdateLayer({ theme }: { theme: Theme }) {
  const { tr, dir } = useI18n();
  const s = useDesktopUpdate();
  const v = s.offer?.version ?? "";
  const manual = s.offer?.channel === "manual";
  const onClose = useCallback(() => closeDialog(), []);

  const progressTitle = tr("update.dl.title", { v });

  // The notes dialog can be opened from Settings in any state, so its
  // primary button follows the state rather than always saying Update.
  const offerOpen = manual || s.phase === "idle" || s.phase === "failed";
  const notesAction: {
    label: string;
    disabled: boolean;
    body?: string;
    run: () => void;
  } = manual
    ? {
        label: tr("update.action.download"),
        disabled: false,
        body: tr("update.manualBody"),
        run: () => {
          closeDialog();
          void update();
        },
      }
    : s.phase === "downloading"
      ? { label: tr("update.downloading"), disabled: true, run: () => {} }
      : s.phase === "ready" || s.phase === "installing"
        ? {
            label: tr("update.restart"),
            disabled: false,
            body: tr("update.restartBody"),
            run: () => void restart(),
          }
        : s.phase === "installed"
          ? {
              label: tr("update.restart"),
              disabled: true,
              body: tr("update.restartManually"),
              run: () => {},
            }
          : s.phase === "failed"
            ? {
                label: tr("update.fail.again"),
                disabled: false,
                run: () => {
                  openDialog("progress");
                  void update();
                },
              }
            : {
                label: tr("update.action.install"),
                disabled: false,
                run: () => void update(),
              };

  return (
    <>
      {s.offer && (
        <DesktopNotesDialog
          open={s.dialog === "notes"}
          version={v}
          theme={theme}
          preloaded={s.notes}
          body={notesAction.body}
          actionLabel={notesAction.label}
          actionBusy={s.phase === "installing"}
          actionDisabled={notesAction.disabled}
          actionArmKey={
            s.phase === "ready" || s.phase === "installing"
              ? "restart"
              : undefined
          }
          onAction={notesAction.run}
          onClose={onClose}
          // Later and Skip are for an offer nobody has acted on yet.
          onLater={offerOpen ? later : undefined}
          onSkip={offerOpen ? skip : undefined}
        />
      )}
      <Frame
        open={s.dialog === "progress" && s.phase === "downloading"}
        theme={theme}
        icon="download"
        title={progressTitle}
        onClose={onClose}
        actions={
          <Button
            theme={theme}
            variant="primary"
            size="sm"
            style={BTN}
            onClick={closeDialog}
          >
            {tr("update.dl.hide")}
          </Button>
        }
      >
        <ProgressBar
          theme={theme}
          bytes={s.bytes}
          total={s.total}
          label={progressTitle}
          dir={dir}
        />
        <p
          style={{
            margin: "10px 0 0",
            fontSize: 13,
            color: theme.ink,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {progressText(tr, s.bytes, s.total)}
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: theme.muted }}>
          {tr("update.keepReading")}
        </p>
      </Frame>
      <Frame
        open={s.dialog === "failed" && s.phase === "failed"}
        theme={theme}
        icon="alert"
        danger
        title={tr("update.card.failed")}
        onClose={onClose}
        actions={
          <>
            <Button
              theme={theme}
              variant="outline"
              size="sm"
              style={BTN}
              trailingIcon={<Icon name="externalLink" size={13} />}
              onClick={() => {
                closeDialog();
                void openReleasePage();
              }}
            >
              {tr("settings.updates.github")}
            </Button>
            <Button
              theme={theme}
              variant="primary"
              size="sm"
              style={BTN}
              onClick={() => {
                openDialog("progress");
                void update();
              }}
            >
              {tr("update.fail.again")}
            </Button>
          </>
        }
      >
        <p
          style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: theme.ink }}
        >
          {tr("update.failDesktop")}
        </p>
      </Frame>
      <UpdateToast
        theme={theme}
        kind={s.toast}
        seq={s.toastSeq}
        version={v}
        onShow={showNotes}
        onUndo={undoSkip}
        onDismiss={dismissToast}
      />
    </>
  );
}
