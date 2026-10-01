// The novel page's action cluster, for both layouts.
//
//   [ ▶ Read ]  [⤓]  [▤]  [⋮]
//
// Read is the one labelled primary; Download range and Shelves are icons;
// the ⋮ holds what is left. It replaces five labelled pills that needed a
// two-column grid to fit a phone at all (and still read as five competing
// calls to action), and the desktop row that wrapped the same five.
//
// Icons cost discoverability — there is no hover tooltip on Android, so a
// glyph is all a phone user gets until they tap it. That is bearable for
// these two because both are conventional and neither is destructive, and
// it is paid for by a cluster whose primary action is unmissable. What is
// NOT bearable is an unnamed control, so every icon button here carries an
// aria-label; `Button`'s `iconOnly` makes the compiler insist on it.

import { useCallback, useRef, useState } from "react";
import { useI18n } from "../../i18n/useI18n";
import type { Theme } from "../../styles/tokens";
import { ActionsMenu, type MenuAction, type MenuAnchor } from "../ActionsMenu";
import { Button } from "../Button";
import { Icon, type IconProps } from "../Icon";
import { DisabledHint } from "./DisabledHint";
import type { NovelHeroProps } from "./NovelHero";

/** What the ⋮ can hold. Both are conditional, and when neither applies —
 *  a novel being browsed in the Store — the ⋮ itself does not render. */
type MenuId = "offline" | "remove";

/** Desktop floor for the Read pill: wide enough that the primary action
 *  dominates the three 44px circles beside it rather than matching them. */
const READ_MIN_WIDTH = 210;

/** One icon-only button in the row. The ⋮ is not one of these — it owns a
 *  ref and opens the menu, so it is written out after the map rather than
 *  carrying a "which one am I" check into the loop. */
interface IconAction {
  /** Also its `data-hero-action`. */
  key: "range" | "shelves" | "add";
  icon: IconProps["name"];
  /** Its accessible name, and its desktop tooltip. There is no label. */
  name: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  /** Why it is disabled, when the source extension is gone. Takes the
   *  tooltip's place, and reaches the pointer through DisabledHint. */
  disabledReason?: string;
}

export type HeroActionsProps = Pick<
  NovelHeroProps,
  | "layout"
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

export function HeroActions({
  theme,
  layout,
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
}: HeroActionsProps) {
  const { tr } = useI18n();
  const isMobile = layout === "mobile";
  const moreRef = useRef<HTMLButtonElement>(null);
  // One piece of state, not an `open` flag beside an anchor: they are set
  // and cleared together, and holding them apart allows an open-but-
  // unanchored menu that renders nothing. VolumesAccordion's copy of this
  // menu does the same.
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  // Stable identity: DesktopPopover lists onClose in the deps of the effect
  // that mounts its window listeners, and this component re-renders
  // whenever the page's chapter flags change underneath it.
  const closeMenu = useCallback(() => setAnchor(null), []);

  const downloadDisabled =
    working || chapterCount === 0 || !!downloadDisabledReason;
  const libraryBusy = working || !libraryCheckDone;

  const menuActions: MenuAction<MenuId>[] = [];
  if (onOpenSaveOffline) {
    // Conversion re-fetches anything that isn't on disk and resolves the
    // source's images, so it needs the extension even when every chapter
    // happens to be downloaded.
    menuActions.push({
      id: "offline",
      label: tr("downloads.saveOffline.title"),
      icon: "book",
      disabled: downloadDisabled,
    });
  }
  if (inLibrary) {
    menuActions.push({
      id: "remove",
      label: tr("library.removeFromLibrary"),
      icon: "trash",
      destructive: true,
      disabled: libraryBusy,
    });
  }

  const icons: IconAction[] = [
    {
      key: "range",
      // `download`, not the `slider` this action used to carry beside a
      // "Download" label: on its own at 16px that glyph reads as a minus
      // sign. The menu row below can afford the less obvious icon because
      // it has words next to it; this button has nothing else.
      icon: "download",
      name: tr("novel.downloadRange"),
      onClick: onOpenRangeDialog,
      disabled: downloadDisabled,
      disabledReason: downloadDisabledReason,
    },
  ];
  if (onOpenShelfList) {
    icons.push({
      key: "shelves",
      icon: "layers",
      name: tr("novel.shelves"),
      onClick: onOpenShelfList,
    });
  } else if (!inLibrary) {
    // Shelves only exist for a saved book, which leaves this slot free for
    // the thing you actually do with one you have just found. Remove is the
    // opposite — destructive, and rare — so it lives in the ⋮ instead.
    icons.push({
      key: "add",
      icon: "bookmark",
      name: tr("novel.addToLibrary"),
      onClick: onAddToLibrary,
      busy: working,
      disabled: libraryBusy,
    });
  }
  const toggleMenu = () => {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const r = moreRef.current?.getBoundingClientRect();
    if (r) setAnchor({ left: r.left, right: r.right, y: r.bottom });
  };

  return (
    <>
      <div
        style={{
          marginTop: 20,
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        {/* The cell owns Read's width in both layouts — the whole leftover
            row on a phone, a floor wide enough to dominate the icons on
            desktop — and the button simply fills it. It also keeps a stable
            flex item under DisabledHint, which collapses to a fragment when
            there is no reason to give. */}
        <div
          style={{
            display: "flex",
            minWidth: 0,
            ...(isMobile ? { flex: 1 } : { minWidth: READ_MIN_WIDTH }),
          }}
        >
          <DisabledHint
            reason={readDisabledReason}
            style={{ flex: 1, minWidth: 0 }}
          >
            <Button
              data-hero-action="read"
              theme={theme}
              surface="onImage"
              variant="primary"
              shape="pill"
              size="lg"
              fullWidth
              onClick={onRead}
              disabled={!!readDisabledReason}
              title={readDisabledReason}
              leadingIcon={
                <Icon name="play" size={13} fill="currentColor" stroke={0} />
              }
            >
              {tr("novel.read")}
            </Button>
          </DisabledHint>
        </div>

        {icons.map((a) => (
          <DisabledHint key={a.key} reason={a.disabledReason}>
            <Button
              data-hero-action={a.key}
              theme={theme}
              surface="onImage"
              variant="outline"
              shape="pill"
              size="lg"
              iconOnly
              aria-label={a.name}
              title={a.disabledReason ?? a.name}
              loading={a.busy}
              onClick={a.onClick}
              disabled={a.disabled}
              leadingIcon={<Icon name={a.icon} size={16} />}
            />
          </DisabledHint>
        ))}

        {menuActions.length > 0 && (
          <Button
            data-hero-action="more"
            ref={moreRef}
            theme={theme}
            surface="onImage"
            variant="outline"
            shape="pill"
            size="lg"
            iconOnly
            aria-label={tr("novel.moreActions")}
            title={tr("novel.moreActions")}
            // The ⋮ holds Remove, so while an add or remove is running it
            // both reports that and stays shut.
            loading={working}
            disabled={working}
            onClick={toggleMenu}
            leadingIcon={<Icon name="more" size={16} />}
          />
        )}
      </div>

      {menuActions.length > 0 && (
        <ActionsMenu<MenuId>
          theme={theme}
          layout={layout}
          open={anchor !== null}
          anchor={anchor}
          triggerRef={moreRef}
          label={tr("novel.moreActions")}
          // Anchored to the ⋮ on a phone as well as on desktop. Two rows
          // hanging off a button in the middle of the page do not warrant
          // a sheet rising from the bottom of the screen.
          presentation="popover"
          actions={menuActions}
          // On Android a disabled row has no tooltip to explain itself, so
          // the reason is stated in the menu rather than only on hover.
          note={downloadDisabledReason}
          onPick={(id) => {
            if (id === "offline") onOpenSaveOffline?.();
            else onRemoveFromLibrary();
          }}
          onClose={closeMenu}
        />
      )}
    </>
  );
}
