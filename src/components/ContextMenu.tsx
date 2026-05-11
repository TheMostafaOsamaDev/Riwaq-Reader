import {
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
  const [submenuReady, setSubmenuReady] = useState(false);
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

  // Flip the Status submenu to the left side when opening to the right would
  // overflow the viewport (e.g. when the parent menu is pinned near the right
  // edge on a narrow screen).
  useLayoutEffect(() => {
    if (!statusOpen) {
      setSubmenuReady(false);
      return;
    }
    const parent = menuRef.current;
    const submenu = submenuRef.current;
    if (!parent || !submenu) return;
    const parentRect = parent.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();
    const vw = window.innerWidth;
    const overflowsRight =
      parentRect.right + submenuRect.width + 2 > vw - 8;
    setSubmenuSide(overflowsRight ? "left" : "right");
    setSubmenuReady(true);
  }, [statusOpen]);

  // Click-outside / Esc to dismiss. pointerdown covers both touch and mouse
  // and fires immediately on touchstart — on touch devices the synthetic
  // mousedown is delayed until after touchend, so listening for pointerdown
  // dismisses the menu the moment the user taps outside.
  useEffect(() => {
    const onDocPointer = (e: PointerEvent) => {
      const el = menuRef.current;
      if (el && !el.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

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
      }}
    >
      <Item
        theme={theme}
        suppressHover={isTouch}
        onMouseEnter={isTouch ? undefined : () => setStatusOpen(true)}
        onMouseLeave={isTouch ? undefined : () => setStatusOpen(false)}
        onClick={isTouch ? () => setStatusOpen((v) => !v) : undefined}
        right={<Icon name="chevronR" size={14} />}
      >
        Status{status ? ` · ${labelFor(status)}` : ""}
        {statusOpen && (
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
              visibility: submenuReady ? "visible" : "hidden",
            }}
          >
            {STATUS_OPTIONS.map((o) => (
              <Item
                key={o.value}
                theme={theme}
                suppressHover={isTouch}
                onClick={() => onPickStatus(o.value)}
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
      <Item theme={theme} onClick={onEdit} suppressHover={isTouch}>
        Edit book info
      </Item>
      <div
        style={{
          height: 1,
          background: theme.rule,
          margin: "4px 6px",
        }}
      />
      <Item theme={theme} onClick={onDelete} suppressHover={isTouch} destructive>
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
      }}
    >
      <span>{children}</span>
      {right && <span style={{ color: theme.muted }}>{right}</span>}
    </div>
  );
}
