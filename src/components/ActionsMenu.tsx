// A list of actions that doesn't fit where it was triggered from: a bottom
// sheet on a phone, an anchored popover on desktop.
//
// Extracted from VolumeActionsMenu when the novel page's hero grew a ⋮ of
// its own. Everything shaped around a volume — its title, its three fixed
// action ids, its sheet height — stayed behind in that wrapper; what lives
// here is the shell, the rows, and the desktop popover's placement and
// dismissal, which is the part worth having exactly once.
//
// Not ContextMenu: that one is shaped around a library book (cover, author,
// reading status, edit/delete) and none of it applies to either caller.

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MobileSheet } from "./MobileSheet";
import { Icon, type IconProps } from "./Icon";
import { useI18n } from "../i18n/useI18n";
import { FONT_STACKS, type Theme, Z } from "../styles/tokens";

/** Rendered box width of the desktop popover: minWidth 250 + 5px padding
 *  and a 0.5px border on each side. Used both to mirror the menu under RTL
 *  and to keep it inside the viewport. */
const MENU_BOX_WIDTH = 262;
const VIEWPORT_MARGIN = 8;

export interface MenuAction<Id extends string = string> {
  id: Id;
  label: string;
  icon: IconProps["name"];
  destructive?: boolean;
  disabled?: boolean;
}

export interface ActionsMenuProps<Id extends string> {
  theme: Theme;
  layout: "desktop" | "mobile";
  open: boolean;
  /** Viewport coords of the trigger. Desktop only; ignored on mobile.
   *  Both horizontal edges, because which one the menu hangs from
   *  depends on the UI direction — see DesktopPopover. */
  anchor: { left: number; right: number; y: number } | null;
  /** The button that opened this menu. The outside-press listener skips
   *  presses landing inside it so the trigger's own click can toggle
   *  the menu shut instead of closing and immediately reopening it. */
  triggerRef?: RefObject<HTMLElement | null>;
  /** Mobile sheet header. Omit for a sheet with no header; the desktop
   *  popover never has one. */
  title?: string;
  /** Second line under `title`. Rendered only when non-empty. */
  subtitle?: string;
  /** The sheet's accessible name. A CONSTANT, never derived from the data
   *  the menu was opened for: MobileSheet passes aria-label through live
   *  while freezing its children for the exit animation, so a name read
   *  off a cleared selection leaves role="dialog" nameless for the length
   *  of the exit. */
  label: string;
  /** CSS height for the sheet's default snap, sized to the row count. */
  sheetHeight?: string;
  actions: MenuAction<Id>[];
  /** Why some rows are unavailable, when they are. Rendered with the rows
   *  so BOTH layouts get it; silently greyed rows with no reason is the
   *  state this exists to prevent. */
  note?: string;
  onPick: (id: Id) => void;
  onClose: () => void;
}

export function ActionsMenu<Id extends string>({
  theme,
  layout,
  open,
  anchor,
  triggerRef,
  title,
  subtitle,
  label,
  sheetHeight = "min(46%, 320px)",
  actions,
  note,
  onPick,
  onClose,
}: ActionsMenuProps<Id>) {
  const rows = (
    <div style={{ fontFamily: FONT_STACKS.sans }}>
      {actions.map((a) => (
        <button
          key={a.id}
          data-menu-action={a.id}
          disabled={a.disabled}
          onClick={() => {
            if (a.disabled) return;
            onPick(a.id);
            onClose();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            // 44px minimum touch target, and comfortable with a mouse.
            // minHeight, not padding alone: 12px blocks around a 15px
            // line box measured 39px, so the comment was describing an
            // intention the row didn't meet — on a destructive action
            // that is a mobile mis-tap away from a bulk delete.
            minHeight: 44,
            paddingBlock: 12,
            paddingInline: 12,
            border: "none",
            background: "transparent",
            borderRadius: 8,
            font: "inherit",
            fontSize: 13,
            textAlign: "start",
            cursor: a.disabled ? "default" : "pointer",
            opacity: a.disabled ? 0.42 : 1,
            color: a.destructive ? theme.danger : theme.ink,
          }}
          onMouseEnter={(e) => {
            if (!a.disabled) e.currentTarget.style.background = theme.hover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <Icon name={a.icon} size={15} />
          <span>{a.label}</span>
        </button>
      ))}
      {note && (
        <div
          style={{
            display: "flex",
            gap: 8,
            paddingBlock: "6px 8px",
            paddingInline: 12,
            fontSize: 11.5,
            lineHeight: 1.4,
            color: theme.muted,
          }}
        >
          <Icon
            name="info"
            size={13}
            style={{ flexShrink: 0, marginBlockStart: 1 }}
          />
          <span>{note}</span>
        </div>
      )}
    </div>
  );

  if (layout === "mobile") {
    return (
      <MobileSheet
        theme={theme}
        open={open}
        onClose={onClose}
        label={label}
        // Sized to its content: a header plus its rows. The percentage
        // still bounds it on short phones.
        height={sheetHeight}
      >
        <div style={{ paddingBlock: "4px 16px", paddingInline: 8 }}>
          {title && (
            <div style={{ paddingBlock: "0 12px", paddingInline: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
              {subtitle && (
                <div style={{ fontSize: 12, color: theme.muted }}>
                  {subtitle}
                </div>
              )}
            </div>
          )}
          {rows}
        </div>
      </MobileSheet>
    );
  }

  return (
    <DesktopPopover {...{ theme, open, anchor, triggerRef, onClose }}>
      {rows}
    </DesktopPopover>
  );
}

function DesktopPopover({
  theme,
  open,
  anchor,
  triggerRef,
  onClose,
  children,
}: {
  theme: Theme;
  open: boolean;
  anchor: { left: number; right: number; y: number } | null;
  triggerRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const { dir } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current && ref.current.contains(target)) return;
      // The trigger opens on click but this listener fires on
      // mousedown, so without this the sequence on the open menu's own
      // ⋯ was close-then-reopen and it never toggled shut. Skipping the
      // trigger lets its click handler own the toggle — and a press on
      // a DIFFERENT trigger still falls through and closes, so that one
      // switches in a single click.
      if (triggerRef?.current && triggerRef.current.contains(target)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose, triggerRef]);

  if (!open || !anchor) return null;
  // Into the body, not where it was triggered. The novel page's ⋮ sits
  // inside Hero, which is `overflow: hidden` with `isolation: isolate` —
  // the first clips the popover at the hero's rounded edge, and the second
  // confines its z-index to the hero's own stacking context, so everything
  // after the hero in the document paints over it. The menu came out as a
  // sliver. Nothing here reads its position from the DOM (the anchor is
  // viewport coordinates and the box is `position: fixed`), so leaving the
  // subtree costs nothing and is what every caller wants.
  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        // Clamp so a trigger near the viewport edge doesn't push the menu
        // off-screen. The floor matters in a resized dev-server browser
        // window (below the packaged app's 720x540 minimum, this is
        // otherwise unreachable).
        top: Math.max(8, Math.min(anchor.y + 6, window.innerHeight - 190)),
        // Physical `left`, deliberately: `anchor` holds physical
        // viewport coordinates and this element is position: fixed, so
        // insetInlineStart would resolve against the direction and land
        // the menu on the wrong side. What IS direction-aware is which
        // trigger edge the menu hangs from — the ⋯ sits at the inline
        // end, so under RTL that is the trigger's right edge with the
        // menu extending leftward. Anchoring off `left` in both
        // directions opened the menu away from its own trigger.
        left: Math.max(
          VIEWPORT_MARGIN,
          Math.min(
            dir === "rtl" ? anchor.right - MENU_BOX_WIDTH : anchor.left,
            window.innerWidth - MENU_BOX_WIDTH - VIEWPORT_MARGIN,
          ),
        ),
        zIndex: Z.menuMenu,
        // Pinned, not minWidth: the note line's copy can be wider than
        // 250 and a box that outgrows MENU_BOX_WIDTH invalidates both
        // the RTL mirror and the viewport clamp above — measured at 304
        // wide in Arabic, hanging 42px past where the clamp thought the
        // right edge was.
        boxSizing: "border-box",
        width: MENU_BOX_WIDTH,
        padding: 5,
        background: theme.bg,
        border: `0.5px solid ${theme.rule}`,
        borderRadius: 12,
        boxShadow: "0 24px 64px rgba(0,0,0,0.35)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
