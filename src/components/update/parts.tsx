// Small pieces both update UIs draw, the phone's (UpdatePill, UpdateSheet,
// SettingsUpdateCard) and the desktop's (SidebarUpdateCard,
// DesktopUpdateLayer, DesktopSettingsUpdateCard). Kept here so neither
// platform's components import the other's.

import { type CSSProperties, type RefObject, useEffect, useMemo } from "react";
import type { Tr } from "../../i18n";
import { useI18n } from "../../i18n/useI18n";
import type { UpdateToast as ToastKind } from "../../store/updateStore";
import type { Theme } from "../../styles/tokens";
import { Icon, type IconProps } from "../Icon";
import { Spinner } from "../Spinner";
import { Toast, type ToastMessage } from "../Toast";

/** Read by screen readers, never drawn. */
export const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

/** Bytes as MB with one decimal: 19230841 → "18.3". */
export function mb(bytes: number): string {
  return (bytes / 1_048_576).toFixed(1);
}

/** "5.1 of 12.0 MB", or just "Downloading…" before the size is known. */
export function progressText(tr: Tr, bytes: number, total: number): string {
  return total
    ? tr("update.dl.of", { a: mb(bytes), b: mb(total) })
    : tr("update.downloading");
}

/** A determinate bar, scaled rather than resized so a progress tick never
 *  relayouts what is around it. */
export function ProgressBar({
  theme,
  bytes,
  total,
  label,
  dir,
  height = 4,
  track = theme.rule,
}: {
  theme: Theme;
  bytes: number;
  total: number;
  label: string;
  dir: "ltr" | "rtl";
  height?: number;
  track?: string;
}) {
  const pct = total ? Math.min(100, (bytes / total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(pct)}
      style={{
        height,
        borderRadius: height / 2,
        background: track,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "100%",
          borderRadius: height / 2,
          background: theme.ink,
          transform: `scaleX(${pct / 100})`,
          transformOrigin: dir === "rtl" ? "right" : "left",
          transition: "transform 300ms ease-out",
        }}
      />
    </div>
  );
}

/** The rounded square an update card or dialog leads with. `ring` draws it
 *  as an outline in that colour (the failed state) instead of a tint. */
export function IconBadge({
  theme,
  icon,
  size,
  radius,
  iconSize,
  stroke = 2.2,
  color = theme.ink,
  ring,
}: {
  theme: Theme;
  icon: IconProps["name"];
  size: number;
  radius: number;
  iconSize: number;
  stroke?: number;
  color?: string;
  ring?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: ring ? "transparent" : theme.hover,
        border: ring ? `1px solid ${ring}` : "none",
        color,
      }}
    >
      <Icon name={icon} size={iconSize} stroke={stroke} />
    </span>
  );
}

/** The release notes are on their way. */
export function NotesLoading({ theme }: { theme: Theme }) {
  return (
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
  );
}

/** While `open`: focus `focusRef` (a button, or the first button inside
 *  it) and close on Escape. */
export function useDialogKeys(
  open: boolean,
  onClose: () => void,
  focusRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const el = focusRef.current;
    (el instanceof HTMLButtonElement
      ? el
      : el?.querySelector<HTMLButtonElement>("button")
    )?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, focusRef]);
}

/** The "Later" and "Skip" confirmations, the same on both platforms; only
 *  where "Show" leads differs. Pass module-level (stable) callbacks. */
export function UpdateToast({
  theme,
  kind,
  seq,
  version,
  onShow,
  onUndo,
  onDismiss,
  bottom,
}: {
  theme: Theme;
  kind: ToastKind;
  /** The store's toastSeq: a new value is a new toast, even of the same
   *  kind, and restarts its timer. */
  seq: number;
  version: string;
  onShow: () => void;
  onUndo: () => void;
  onDismiss: () => void;
  bottom?: string;
}) {
  const { tr } = useI18n();
  // One object per toast shown: Toast restarts its timer on a new identity.
  // seq is read only to key the memo.
  const toast = useMemo<ToastMessage | null>(() => {
    if (kind === "later") {
      return {
        id: seq,
        kind: "info",
        text: tr("update.toast.later"),
        action: {
          label: tr("update.toast.show"),
          onClick: () => {
            onDismiss();
            onShow();
          },
        },
      };
    }
    if (kind === "skipped") {
      return {
        id: seq,
        kind: "info",
        text: tr("update.toast.skipped", { v: version }),
        action: { label: tr("update.toast.undo"), onClick: onUndo },
      };
    }
    return null;
  }, [kind, seq, version, tr, onShow, onUndo, onDismiss]);
  return (
    <Toast
      theme={theme}
      toast={toast}
      onDismiss={onDismiss}
      ttl={6000}
      bottom={bottom}
    />
  );
}
