import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { BookStatus } from "../store/library";
import { FONT_STACKS, type Theme } from "../styles/tokens";

export interface ContextMenuProps {
  theme: Theme;
  /** Click coordinates (clientX/clientY). The menu pins its top-left here,
      then nudges up/left if it would otherwise overflow the viewport. */
  x: number;
  y: number;
  status: BookStatus | undefined;
  onPickStatus: (s: BookStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const STATUS_OPTIONS: { value: BookStatus; label: string }[] = [
  { value: "reading", label: "Reading" },
  { value: "finished", label: "Finished" },
  { value: "wishlist", label: "Wishlist" },
];

// Enter and exit run at different durations on purpose: a snappy enter feels
// responsive, a slightly shorter exit gets out of the user's way faster.
const ENTER_MS = 140;
const EXIT_MS = 110;
// Snappy ease-out for entry — fast at the start, gentle at the end so the
// menu "lands" rather than "snapping".
const ENTER_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";
const EXIT_EASE = "cubic-bezier(0.4, 0, 1, 1)";

const KEYFRAMES = `
@keyframes leaflet-ctxmenu-in {
  from { opacity: 0; transform: scale(0.94); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes leaflet-ctxmenu-out {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.96); }
}
`;

export function ContextMenu({
  theme,
  x,
  y,
  status,
  onPickStatus,
  onEdit,
  onDelete,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [statusOpen, setStatusOpen] = useState(false);
  const [submenuSide, setSubmenuSide] = useState<"right" | "left">("right");
  // Three flags drive the submenu lifecycle independently of `statusOpen` so
  // the exit animation has time to play before unmounting:
  //   • mounted    — is the submenu in the DOM right now?
  //   • leaving    — is the exit animation in flight?
  //   • measured   — has the layout-effect placed it? (controls the
  //                  initial visibility-hidden flash prevention)
  const [submenuMounted, setSubmenuMounted] = useState(false);
  const [submenuLeaving, setSubmenuLeaving] = useState(false);
  const [submenuMeasured, setSubmenuMeasured] = useState(false);
  // Main-menu exit flag. The component stays mounted while leaving so the
  // closing animation plays, then onClose() fires after EXIT_MS to let the
  // parent actually unmount us.
  const [leaving, setLeaving] = useState(false);
  // Guards against double-firing requestClose (e.g. outside-tap + Esc).
  const closingRef = useRef(false);
  // On touch devices the OS synthesizes a mouseenter on the element under the
  // touch point when the menu mounts under the user's finger. That used to
  // highlight Status and pop open its submenu before the user actually meant
  // to interact with anything. Swap the hover-driven open for a tap-driven
  // one on coarse pointers, and suppress the synthetic hover styling in Item.
  const isTouch = useMediaQuery("(hover: none)");

  // Keep the menu inside the viewport — measure after mount and shift
  // left/up if the requested coords would push it off-screen.
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (nx + rect.width > vw - 8) nx = Math.max(8, vw - rect.width - 8);
    if (ny + rect.height > vh - 8) ny = Math.max(8, vh - rect.height - 8);
    setPos({ x: nx, y: ny });
  }, [x, y]);

  // Drive the submenu's mount/unmount + leaving flag from statusOpen.
  // statusOpen=true → mount and clear `leaving`.
  // statusOpen=false → start the exit animation, unmount after EXIT_MS.
  useEffect(() => {
    if (statusOpen) {
      setSubmenuMounted(true);
      setSubmenuLeaving(false);
      return;
    }
    if (!submenuMounted) return;
    setSubmenuLeaving(true);
    const t = window.setTimeout(() => {
      setSubmenuMounted(false);
      setSubmenuLeaving(false);
      setSubmenuMeasured(false);
    }, EXIT_MS);
    return () => window.clearTimeout(t);
  }, [statusOpen, submenuMounted]);

  // Flip the submenu to the left side when opening to the right would overflow
  // the viewport (e.g. when the parent menu is pinned near the right edge on a
  // narrow screen). Runs only on mount-entry so a mid-exit measurement can't
  // jitter the position.
  useLayoutEffect(() => {
    if (!submenuMounted || submenuLeaving) return;
    const parent = menuRef.current;
    const submenu = submenuRef.current;
    if (!parent || !submenu) return;
    const parentRect = parent.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();
    const vw = window.innerWidth;
    const overflowsRight =
      parentRect.right + submenuRect.width + 2 > vw - 8;
    setSubmenuSide(overflowsRight ? "left" : "right");
    setSubmenuMeasured(true);
  }, [submenuMounted, submenuLeaving]);

  // Start the exit animation on outside tap, Esc, or an item that closes
  // the whole menu. Idempotent — repeated calls during the animation are
  // no-ops so the close-timer doesn't get rescheduled.
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setLeaving(true);
    window.setTimeout(() => onClose(), EXIT_MS);
  }, [onClose]);

  // Wrap parent actions so the menu's exit animation plays first, then the
  // action fires (which usually mounts the next surface — modal, confirm
  // dialog, status change). Calling onClose at the end is belt-and-braces
  // in case the parent's handler doesn't itself unmount us on error.
  const runWithExit = useCallback(
    (action: () => void) => {
      if (closingRef.current) return;
      closingRef.current = true;
      setLeaving(true);
      window.setTimeout(() => {
        action();
        onClose();
      }, EXIT_MS);
    },
    [onClose],
  );

  const handleEdit = useCallback(() => runWithExit(onEdit), [runWithExit, onEdit]);
  const handleDelete = useCallback(
    () => runWithExit(onDelete),
    [runWithExit, onDelete],
  );
  const handlePickStatus = useCallback(
    (s: BookStatus) => runWithExit(() => onPickStatus(s)),
    [runWithExit, onPickStatus],
  );

  // Click-outside / Esc to dismiss. pointerdown covers both touch and mouse
  // and fires immediately on touchstart — on touch devices the synthetic
  // mousedown is delayed until after touchend, so listening for pointerdown
  // dismisses the menu the moment the user taps outside.
  useEffect(() => {
    const onDocPointer = (e: PointerEvent) => {
      const el = menuRef.current;
      if (el && !el.contains(e.target as Node)) requestClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [requestClose]);

  const mainAnim = leaving
    ? `leaflet-ctxmenu-out ${EXIT_MS}ms ${EXIT_EASE} forwards`
    : `leaflet-ctxmenu-in ${ENTER_MS}ms ${ENTER_EASE}`;
  const submenuAnim = submenuLeaving
    ? `leaflet-ctxmenu-out ${EXIT_MS}ms ${EXIT_EASE} forwards`
    : `leaflet-ctxmenu-in ${ENTER_MS}ms ${ENTER_EASE}`;

  return (
    <div
      ref={menuRef}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 9500,
        minWidth: 200,
        background: theme.bg,
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
        borderRadius: 8,
        boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
        padding: 4,
        fontFamily: FONT_STACKS.sans,
        fontSize: 13,
        // Origin at top-left so the menu "grows out of" the click point
        // rather than puffing up symmetrically from its centre.
        transformOrigin: "top left",
        animation: mainAnim,
        // Pointer events get cut during the exit animation so a late tap
        // can't trigger another action on a menu that's about to disappear.
        pointerEvents: leaving ? "none" : "auto",
      }}
    >
      <style>{KEYFRAMES}</style>
      <Item
        theme={theme}
        suppressHover={isTouch}
        onMouseEnter={isTouch ? undefined : () => setStatusOpen(true)}
        onMouseLeave={isTouch ? undefined : () => setStatusOpen(false)}
        onClick={isTouch ? () => setStatusOpen((v) => !v) : undefined}
        right={<Icon name="chevronR" size={14} />}
      >
        Status{status ? ` · ${labelFor(status)}` : ""}
        {submenuMounted && (
          <div
            ref={submenuRef}
            style={{
              position: "absolute",
              top: -4,
              ...(submenuSide === "right"
                ? { left: "100%", marginLeft: 2 }
                : { right: "100%", marginRight: 2 }),
              background: theme.bg,
              border: `0.5px solid ${theme.rule}`,
              borderRadius: 8,
              // Project the shadow outward (away from the parent menu) instead
              // of using a symmetric blur — a centred shadow bleeds across
              // the 2px gap and darkens the parent menu's edge, which reads
              // as a dirty seam between the two panels.
              boxShadow:
                submenuSide === "right"
                  ? "6px 10px 24px rgba(0,0,0,0.18)"
                  : "-6px 10px 24px rgba(0,0,0,0.18)",
              padding: 4,
              minWidth: 140,
              visibility: submenuMeasured ? "visible" : "hidden",
              // Anchor the scale to the edge attached to the parent so the
              // submenu appears to "spring out of" the Status row.
              transformOrigin:
                submenuSide === "right" ? "top left" : "top right",
              animation: submenuAnim,
              pointerEvents: submenuLeaving ? "none" : "auto",
            }}
          >
            {STATUS_OPTIONS.map((o) => (
              <Item
                key={o.value}
                theme={theme}
                suppressHover={isTouch}
                onClick={() => handlePickStatus(o.value)}
                right={
                  status === o.value ? (
                    <Icon name="check" size={13} />
                  ) : null
                }
              >
                {o.label}
              </Item>
            ))}
          </div>
        )}
      </Item>
      <Item theme={theme} onClick={handleEdit} suppressHover={isTouch}>
        Edit book info
      </Item>
      <div
        style={{
          height: 1,
          background: theme.rule,
          margin: "4px 6px",
        }}
      />
      <Item
        theme={theme}
        onClick={handleDelete}
        suppressHover={isTouch}
        destructive
      >
        Remove book
      </Item>
    </div>
  );
}

function labelFor(s: BookStatus): string {
  return s === "reading" ? "Reading" : s === "finished" ? "Finished" : "Wishlist";
}

function Item({
  theme,
  onClick,
  onMouseEnter,
  onMouseLeave,
  right,
  destructive,
  suppressHover,
  children,
}: {
  theme: Theme;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  right?: ReactNode;
  destructive?: boolean;
  /** Skip the hover-state background swap. Set on coarse-pointer devices
      where the synthetic mouseenter from a touch shouldn't auto-highlight
      the item just because the menu opened under the user's finger. */
  suppressHover?: boolean;
  children: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="menuitem"
      onClick={onClick}
      onMouseEnter={() => {
        if (!suppressHover) setHover(true);
        onMouseEnter?.();
      }}
      onMouseLeave={() => {
        if (!suppressHover) setHover(false);
        onMouseLeave?.();
      }}
      style={{
        position: "relative",
        padding: "8px 12px",
        borderRadius: 6,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        color: destructive ? "#c04a3a" : theme.ink,
        background: hover && !suppressHover ? theme.hover : "transparent",
        // Smooth the hover swap so the row doesn't snap on/off — keeps the
        // menu feeling "soft" alongside the scale-in animation.
        transition: "background 110ms ease",
      }}
    >
      <span>{children}</span>
      {right && <span style={{ color: theme.muted }}>{right}</span>}
    </div>
  );
}
