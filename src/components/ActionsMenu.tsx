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

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { MobileSheet } from "./MobileSheet";
import { Icon, type IconProps } from "./Icon";
import { useI18n } from "../i18n/useI18n";
import { FONT_STACKS, type Theme, TOUCH_TARGET_MIN, Z } from "../styles/tokens";

/** How close to the viewport edge the popover may sit. */
const VIEWPORT_MARGIN = 8;
/** Gap between the popover and the trigger it hangs from. */
const ANCHOR_GAP = 6;

/** Viewport coordinates of the control a popover hangs from. Both
 *  horizontal edges, because which one it hangs from depends on the UI
 *  direction — see DesktopPopover. `y` is the trigger's bottom. */
export interface MenuAnchor {
  left: number;
  right: number;
  y: number;
}

export interface MenuAction<Id extends string> {
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
  /** Where to hang the popover. Ignored by the sheet presentation. */
  anchor: MenuAnchor | null;
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
  /** How the menu is presented. "auto" (the default) follows `layout`: a
   *  bottom sheet on a phone, an anchored popover on desktop. "popover"
   *  anchors it on both — for a short menu hanging off a button in the
   *  middle of the page, where a sheet rising from the bottom of the
   *  screen is a bigger gesture than the action deserves. */
  presentation?: "auto" | "popover";
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
  presentation = "auto",
  actions,
  note,
  onPick,
  onClose,
}: ActionsMenuProps<Id>) {
  const rows = (
    <Rows
      theme={theme}
      actions={actions}
      note={note}
      onPick={onPick}
      onClose={onClose}
    />
  );

  if (presentation === "auto" && layout === "mobile") {
    return (
      <MobileSheet
        theme={theme}
        open={open}
        onClose={onClose}
        label={label}
        // Sized to its content: a header plus three rows. The percentage
        // still bounds it on short phones.
        height="min(46%, 320px)"
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

function Rows<Id extends string>({
  theme,
  actions,
  note,
  onPick,
  onClose,
}: Pick<
  ActionsMenuProps<Id>,
  "theme" | "actions" | "note" | "onPick" | "onClose"
>) {
  return (
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
            // minHeight, not padding alone: 12px blocks around a 15px
            // line box measured 39px, so the comment was describing an
            // intention the row didn't meet — on a destructive action
            // that is a mobile mis-tap away from a bulk delete.
            minHeight: TOUCH_TARGET_MIN,
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
  anchor: MenuAnchor | null;
  triggerRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const { dir } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  // The popover's own rendered size, measured rather than assumed. This
  // used to be two constants describing the volume menu — a pinned 262px
  // box and a 190px height allowance — which a second caller with a
  // different number of rows made wrong in both directions: a 2-row menu
  // was shoved 72px up off its trigger to leave room it never needed, and
  // a menu wider than 262 (Arabic copy measured 304) hung off the edge the
  // clamp thought it was respecting. ContextMenu already measures; so does
  // this now. Null until the first layout pass.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor) {
      setSize(null);
      return;
    }
    const r = ref.current?.getBoundingClientRect();
    if (r) setSize({ w: r.width, h: r.height });
  }, [open, anchor]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
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
    // `pointerdown`, not `mousedown`: this popover is now shown on phones
    // too, where a tap only reaches `mousedown` as a synthesised event
    // after the touch sequence ends — and not at all if the page treats
    // the touch as a gesture. `pointerdown` covers mouse and finger alike.
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open, onClose, triggerRef]);

  if (!open || !anchor) return null;
  // Into the body, not where it was triggered. The novel page's ⋮ sits
  // inside Hero, which sets `isolation: isolate` — a new stacking context,
  // so Z.menuMenu stops meaning "above the page" and means only "above the
  // hero's own children". Everything after the hero in document order then
  // paints over the menu, and it came out as a sliver under the button.
  // (Not clipping, despite the `overflow: hidden` next to it: a
  // position-fixed box is only clipped by an ancestor that establishes a
  // containing block, which the hero frame does not — its blur filter is
  // on the backdrop img.) Nothing here reads its position from the DOM —
  // the anchor is viewport coordinates and the box is `position: fixed` —
  // so leaving the subtree costs nothing and is what every caller wants.
  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        // Hang under the trigger, and if that would run past the bottom,
        // sit as low as the menu's own height allows. Measured, so a short
        // menu stays on its trigger; the first pass before `size` lands is
        // never painted, because the measurement is a layout effect.
        top: Math.max(
          VIEWPORT_MARGIN,
          size
            ? Math.min(
                anchor.y + ANCHOR_GAP,
                window.innerHeight - size.h - VIEWPORT_MARGIN,
              )
            : anchor.y + ANCHOR_GAP,
        ),
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
          size
            ? Math.min(
                dir === "rtl" ? anchor.right - size.w : anchor.left,
                window.innerWidth - size.w - VIEWPORT_MARGIN,
              )
            : dir === "rtl"
              ? anchor.right
              : anchor.left,
        ),
        zIndex: Z.menuMenu,
        // Free to be as wide as its longest row needs, bounded only by the
        // viewport: the clamps above read the result instead of assuming
        // it, so a long Arabic label widens the box rather than hanging it
        // off the screen.
        boxSizing: "border-box",
        minWidth: 250,
        maxWidth: Math.max(250, window.innerWidth - VIEWPORT_MARGIN * 2),
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
