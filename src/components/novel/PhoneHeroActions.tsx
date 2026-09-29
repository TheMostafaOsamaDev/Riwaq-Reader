// The novel page's actions on a phone: Read across the full width, then the
// rest as a two-column grid of equal pills (`.riwaq-hero-actions` in
// global.css).
//
// A phone is too narrow for the desktop row NovelHero renders: even Read and
// "Remove from library" don't fit side by side, so every pill used to wrap
// onto its own line at its own width, a ragged stack of five.

import type { ReactNode } from "react";
import { useI18n } from "../../i18n/useI18n";
import type { Theme } from "../../styles/tokens";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { DisabledHint } from "./DisabledHint";
import type { NovelHeroProps } from "./NovelHero";

/** One pill. */
interface HeroAction {
  /** Also its `data-hero-action`. */
  key: "read" | "add" | "shelves" | "range" | "offline" | "remove";
  icon: ReactNode;
  /** What the pill says. Short: two pills share a row. */
  label: string;
  /** The full name, as the hover tooltip, where `label` shortens it. */
  fullName?: string;
  variant: "primary" | "outline" | "destructive";
  /** Running: a spinner in place of the icon. The label stays, so the pill
   *  keeps its word ("Removing…" does not fit half a row). */
  busy?: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** Why it is disabled, when the source extension is gone. Shown in place
   *  of the tooltip. */
  disabledReason?: string;
}

export type PhoneHeroActionsProps = Pick<
  NovelHeroProps,
  | "working"
  | "chapterCount"
  | "inLibrary"
  | "libraryCheckDone"
  | "downloadDisabledReason"
  | "readDisabledReason"
  | "onRead"
  | "onAddToLibrary"
  | "onRemoveFromLibrary"
  | "onOpenRangeDialog"
  | "onOpenSaveOffline"
  | "onOpenShelfList"
> & { theme: Theme };

export function PhoneHeroActions({
  theme,
  working,
  chapterCount,
  inLibrary,
  libraryCheckDone,
  downloadDisabledReason,
  readDisabledReason,
  onRead,
  onAddToLibrary,
  onRemoveFromLibrary,
  onOpenRangeDialog,
  onOpenSaveOffline,
  onOpenShelfList,
}: PhoneHeroActionsProps) {
  const { tr } = useI18n();
  // In order of importance: Read first, then what the reader does with the
  // novel, and Remove last, as far from Read as it goes.
  const downloadDisabled =
    working || chapterCount === 0 || !!downloadDisabledReason;
  const actions: HeroAction[] = [
    {
      key: "read",
      icon: <Icon name="play" size={13} fill="currentColor" stroke={0} />,
      label: tr("novel.read"),
      variant: "primary",
      onClick: onRead,
      disabled: !!readDisabledReason,
      disabledReason: readDisabledReason,
    },
  ];
  if (!inLibrary) {
    actions.push({
      key: "add",
      icon: <Icon name="bookmark" size={14} />,
      label: tr("novel.addToLibrary"),
      variant: "outline",
      busy: working,
      onClick: onAddToLibrary,
      disabled: working || !libraryCheckDone,
    });
  }
  if (onOpenShelfList) {
    actions.push({
      key: "shelves",
      icon: <Icon name="layers" size={14} />,
      label: tr("novel.shelves"),
      variant: "outline",
      onClick: onOpenShelfList,
    });
  }
  actions.push({
    key: "range",
    icon: <Icon name="slider" size={14} />,
    label: tr("novel.action.download"),
    fullName: tr("novel.downloadRange"),
    variant: "outline",
    onClick: onOpenRangeDialog,
    disabled: downloadDisabled,
    disabledReason: downloadDisabledReason,
  });
  if (onOpenSaveOffline) {
    // Conversion re-fetches anything that isn't on disk and resolves the
    // source's images, so it needs the extension even when every chapter
    // happens to be downloaded.
    actions.push({
      key: "offline",
      icon: <Icon name="download" size={14} />,
      label: tr("novel.action.saveOffline"),
      fullName: tr("downloads.saveOffline.title"),
      variant: "outline",
      onClick: onOpenSaveOffline,
      disabled: downloadDisabled,
      disabledReason: downloadDisabledReason,
    });
  }
  if (inLibrary) {
    actions.push({
      key: "remove",
      icon: <Icon name="trash" size={14} />,
      label: tr("novel.action.remove"),
      fullName: tr("library.removeFromLibrary"),
      variant: "destructive",
      busy: working,
      onClick: onRemoveFromLibrary,
      disabled: working || !libraryCheckDone,
    });
  }

  // Read has a row to itself and the rest pair up, so an even total leaves
  // the last pill alone: it takes the whole row rather than half of one.
  const lone =
    actions.length % 2 === 0 ? actions[actions.length - 1] : undefined;

  return (
    <div className="riwaq-hero-actions">
      {actions.map((a) => (
        <div
          key={a.key}
          data-hero-action={a.key}
          data-hero-span={a === lone ? "" : undefined}
        >
          <DisabledHint
            reason={a.disabledReason}
            style={{ flex: 1, minWidth: 0 }}
          >
            <Button
              theme={theme}
              surface="onImage"
              variant={a.variant}
              shape="pill"
              size="lg"
              fullWidth
              // 18px sides rather than lg's 24: half of a 360px phone's row is
              // ~145px, and "Save offline" needs all but a few of them.
              style={{ paddingInline: 18 }}
              loading={a.busy}
              onClick={a.onClick}
              disabled={a.disabled}
              title={a.disabledReason ?? a.fullName}
              leadingIcon={a.icon}
            >
              {/* Cut rather than overflow: a translation or a very narrow screen
              that doesn't fit half a row pushed the icon out of the pill. */}
              <span
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {a.label}
              </span>
            </Button>
          </DisabledHint>
        </div>
      ))}
    </div>
  );
}
