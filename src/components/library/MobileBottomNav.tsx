import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import {
  getState as getQueueState,
  subscribe as subscribeToQueue,
} from "../../store/downloadQueue";
import { Spinner } from "../Spinner";
import { useImportIndicator } from "../../store/importIndicator";
import { setMinimized } from "../../store/importProgress";
import type { Theme } from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import type { LibraryTab } from "./tabs";

export interface MobileBottomNavProps {
  theme: Theme;
  importing: boolean;
  tab: LibraryTab;
  shelvesActive: boolean;
  onOpenShelves: () => void;
  onSetStore: () => void;
  onOpenQueue: () => void;
  onImport: () => void;
  onOpenSettings: () => void;
}

export function MobileBottomNav({
  theme,
  importing,
  tab,
  shelvesActive,
  onOpenShelves,
  onSetStore,
  onOpenQueue,
  onImport,
  onOpenSettings,
}: MobileBottomNavProps) {
  const { tr } = useI18n();
  return (
    <div
      style={{
        flexShrink: 0,
        position: "relative",
        padding: "10px 14px 14px",
        background: theme.bg,
        // Bolder top edge (theme.ruleStrong) so the bar's boundary
        // registers cleanly against the upward shadow rather than
        // bleeding into the shadow gradient.
        borderTop: `1px solid ${theme.ruleStrong}`,
        // Soft upward shadow so the bar reads as a floating surface
        // hovering over the shelf, not a flush edge of the page.
        boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        gap: 6,
      }}
    >
      <NavIconButton
        theme={theme}
        icon="layers"
        ariaLabel={tr("shelves.title")}
        active={shelvesActive}
        onClick={onOpenShelves}
      />
      <NavIconButton
        theme={theme}
        icon="globe"
        ariaLabel={
          tab === "store"
            ? tr("library.backToLibrary")
            : tr("library.openStore")
        }
        active={tab === "store"}
        onClick={onSetStore}
      />
      <NavFabButton theme={theme} importing={importing} onClick={onImport} />
      <NavIconButton
        theme={theme}
        icon="download"
        ariaLabel={tr("library.openDownloads")}
        onClick={onOpenQueue}
        showQueueBadge
      />
      <NavIconButton
        theme={theme}
        icon="settings"
        ariaLabel={tr("sidebar.settings")}
        onClick={onOpenSettings}
      />
    </div>
  );
}

export interface NavIconButtonProps {
  theme: Theme;
  icon: "globe" | "download" | "doc" | "settings" | "layers";
  ariaLabel: string;
  active?: boolean;
  disabled?: boolean;
  showQueueBadge?: boolean;
  onClick: () => void;
}

export function NavIconButton({
  theme,
  icon,
  ariaLabel,
  active,
  disabled,
  showQueueBadge,
  onClick,
}: NavIconButtonProps) {
  const [activeCount, setActiveCount] = useState(() =>
    activeJobCount(getQueueState()),
  );
  useEffect(() => {
    if (!showQueueBadge) return;
    const off = subscribeToQueue((s) => setActiveCount(activeJobCount(s)));
    return off;
  }, [showQueueBadge]);
  const showBadge = !!showQueueBadge && activeCount > 0;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      style={{
        position: "relative",
        width: 44,
        height: 44,
        borderRadius: 22,
        border: active ? "none" : `0.5px solid ${theme.rule}`,
        background: active ? theme.ink : "transparent",
        color: active ? theme.bg : theme.ink,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon name={icon} size={18} />
      {showBadge && (
        <span
          style={{
            position: "absolute",
            top: -2,
            insetInlineEnd: -2,
            minWidth: 18,
            height: 18,
            padding: "0 5px",
            borderRadius: 9,
            background: theme.ink,
            color: theme.bg,
            fontSize: 10,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
            border: `2px solid ${theme.bg}`,
          }}
        >
          {activeCount > 99 ? "99+" : activeCount}
        </span>
      )}
    </button>
  );
}

export interface NavFabButtonProps {
  theme: Theme;
  importing: boolean;
  onClick: () => void;
}

export function NavFabButton({ theme, importing, onClick }: NavFabButtonProps) {
  // The focal action — filled + slightly larger than the outlined siblings
  // (50px vs 38px) + a soft drop shadow so it reads as the primary
  // affordance. Sits flush with the bar rather than protruding above it.
  //
  // While an import runs this is the *only* progress indicator in the app,
  // so it stays tappable: a tap re-opens the stepper modal instead of the
  // file picker. `useImportIndicator` also picks up Store imports, which
  // never reach this component's `importing` prop.
  const { tr } = useI18n();
  const ind = useImportIndicator(importing);
  const details = ind.action === "details";
  const label = details
    ? tr("import.progress.openDetails")
    : ind.busy
      ? tr("sidebar.importing")
      : tr("library.importEpub");
  return (
    <button
      onClick={details ? () => setMinimized(false) : onClick}
      disabled={ind.action === "none"}
      aria-label={label}
      aria-busy={ind.busy || undefined}
      title={label}
      style={{
        width: 50,
        height: 50,
        borderRadius: 25,
        border: "none",
        background: theme.ink,
        color: theme.bg,
        cursor: ind.action === "none" ? "progress" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 3px 10px rgba(0,0,0,0.18)",
        // Dimmed only while it genuinely can't be pressed. A tappable
        // control at 0.6 reads as disabled.
        opacity: ind.action === "none" ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      {ind.busy ? (
        // Determinate whenever the pipeline has a real ratio — a 200 MB book
        // takes long enough that a bare spinner reads as a hang.
        <Spinner
          size={22}
          strokeWidth={2.5}
          {...(ind.ratio === null ? {} : { value: ind.ratio })}
        />
      ) : (
        <Icon name="plus" size={20} />
      )}
    </button>
  );
}

/** Badge count = work the user might want to address. That includes
 *  jobs that were interrupted by the app dying mid-flight — the
 *  Downloads page is where they Retry, so the badge should advertise
 *  it. Done / cancelled / errored without retry intent don't count. */
export function activeJobCount(s: { jobs: { status: string }[] }): number {
  let n = 0;
  for (const j of s.jobs) {
    if (
      j.status === "queued" ||
      j.status === "running" ||
      j.status === "interrupted"
    ) {
      n++;
    }
  }
  return n;
}
