// Small pieces both update UIs draw, the phone's (UpdatePill, UpdateSheet,
// SettingsUpdateCard) and the desktop's (SidebarUpdateCard,
// DesktopUpdateLayer, DesktopSettingsUpdateCard). Kept here so neither
// platform's components import the other's.

import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
} from "react";
import type { Tr } from "../../i18n";
import { useI18n } from "../../i18n/useI18n";
import type { UpdateToast as ToastKind } from "../../store/updateStore";
import { type Theme, TOUCH_TARGET_MIN } from "../../styles/tokens";
import { Button } from "../Button";
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

/** Settings → About's update card, on both platforms: the icon, a title,
 *  the date (and size) line, an optional note, the release's one-line
 *  summary, then What's new beside the state's primary action. `children`
 *  goes below that row (desktop's separate Restart now). */
export function SettingsCard({
  theme,
  label,
  title,
  icon,
  danger = false,
  meta,
  note,
  summary,
  onSeeNew,
  primary,
  children,
}: {
  theme: Theme;
  label: string;
  title: string;
  icon: IconProps["name"];
  danger?: boolean;
  meta?: string;
  note?: string;
  summary?: string;
  onSeeNew: () => void;
  primary: { label: string; onClick: () => void; busy?: boolean } | null;
  children?: ReactNode;
}) {
  const { tr } = useI18n();
  const accent = danger ? theme.danger : theme.ink;
  return (
    <section
      data-settings-update
      aria-label={label}
      style={{
        marginTop: 10,
        padding: 14,
        borderRadius: 12,
        background: theme.chrome,
        border: `0.5px solid ${danger ? theme.danger : theme.rule}`,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <IconBadge
          theme={theme}
          icon={icon}
          size={32}
          radius={10}
          iconSize={16}
          color={accent}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: accent }}>
            {title}
          </div>
          {meta && (
            <div
              style={{
                fontSize: 11.5,
                color: theme.muted,
                marginTop: 2,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {meta}
            </div>
          )}
          {note && (
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.45,
                color: theme.muted,
                marginTop: 6,
              }}
            >
              {note}
            </div>
          )}
          {summary && (
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.45,
                color: theme.ink,
                marginTop: 6,
              }}
            >
              {summary}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Button
          theme={theme}
          variant="outline"
          size="sm"
          fullWidth
          style={{ minHeight: TOUCH_TARGET_MIN }}
          onClick={onSeeNew}
        >
          {tr("settings.updates.seeNew")}
        </Button>
        {primary && (
          <Button
            theme={theme}
            variant="primary"
            size="sm"
            fullWidth
            loading={primary.busy}
            disabled={primary.busy}
            style={{ minHeight: TOUCH_TARGET_MIN }}
            onClick={primary.onClick}
          >
            {primary.label}
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}
