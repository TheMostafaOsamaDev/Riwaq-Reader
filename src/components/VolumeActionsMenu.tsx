// Overflow menu for a volume header: download the whole volume, or delete
// its downloads.
//
// The responsive shell — bottom sheet on mobile, anchored popover on
// desktop — is ActionsMenu, shared with the novel page's hero ⋮. What is
// here is what is specific to a volume: its three action ids, the header
// naming which volume the menu belongs to, and the sheet's accessible name.

import type { RefObject } from "react";
import { ActionsMenu } from "./ActionsMenu";
import { useI18n } from "../i18n/useI18n";
import type { Theme } from "../styles/tokens";

export interface VolumeAction {
  id: "download-all" | "delete-read" | "delete-all";
  label: string;
  icon: "download" | "trash";
  destructive?: boolean;
  disabled?: boolean;
}

interface Props {
  theme: Theme;
  layout: "desktop" | "mobile";
  open: boolean;
  anchor: { left: number; right: number; y: number } | null;
  triggerRef?: RefObject<HTMLElement | null>;
  title: string;
  /** Mobile sheet header only — the desktop popover has no header. */
  subtitle: string;
  actions: VolumeAction[];
  note?: string;
  onPick: (id: VolumeAction["id"]) => void;
  onClose: () => void;
}

export function VolumeActionsMenu({
  theme,
  layout,
  open,
  anchor,
  title,
  subtitle,
  actions,
  note,
  triggerRef,
  onPick,
  onClose,
}: Props) {
  const { tr } = useI18n();
  return (
    <ActionsMenu<VolumeAction["id"]>
      theme={theme}
      layout={layout}
      open={open}
      anchor={anchor}
      triggerRef={triggerRef}
      title={title}
      subtitle={subtitle}
      label={tr("downloads.delete.volumeActions")}
      actions={actions}
      note={note}
      onPick={onPick}
      onClose={onClose}
    />
  );
}
