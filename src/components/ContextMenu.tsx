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
  /** Anchor coordinates from the original pointer event. Used as the top-left
      on hover-capable pointers; the touch path opens as a bottom action sheet
      and ignores these. */
  x: number;
  y: number;
  /** Book title shown in the action-sheet header on touch. Desktop ignores. */
  title?: string;
  /** Book author shown as a subtitle in the action-sheet header on touch. */
  author?: string;
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
const ENTER_MS = 220;
const EXIT_MS = 180;
// iOS-ish spring out for entry, faster ease-in for exit.
const ENTER_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const EXIT_EASE = "cubic-bezier(0.4, 0, 1, 1)";
const SLIDE_MS = 240;
const SLIDE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

const KEYFRAMES = `
@keyframes leaflet-ctxmenu-pop-in {
  from { opacity: 0; transform: scale(0.94); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes leaflet-ctxmenu-pop-out {
  from { opacity: 1; transform: scale(1); }
  to   { opacity: 0; transform: scale(0.96); }
}
`;

// Light haptic on tap — Android only, no-op on iOS / desktop.
function tapHaptic() {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(8);
  }
}

export function ContextMenu({
  theme,
  x,
  y,
  title,
  author,
  status,
  onPickStatus,
  onEdit,
  onDelete,
  onClose,
}: ContextMenuProps) {
  // `(hover: none)` alone misses Android Chrome configs that report
  // `hover: hover`, so OR with `(pointer: coarse)` (the rest of the app's
  // mobile signal) and fall back to navigator.maxTouchPoints.
  const mqTouch = useMediaQuery("(hover: none), (pointer: coarse)");
  const isTouch =
    mqTouch ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);

  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const mainPanelRef = useRef<HTMLDivElement>(null);
  const statusPanelRef = useRef<HTMLDivElement>(null);

  const [pos, setPos] = useState({ x, y });
  const [statusOpen, setStatusOpen] = useState(false);
  const [submenuSide, setSubmenuSide] = useState<"right" | "left">("right");
  // Desktop flyout submenu lifecycle flags. Touch never mounts the flyout.
  const [submenuMounted, setSubmenuMounted] = useState(false);
  const [submenuLeaving, setSubmenuLeaving] = useState(false);
  const [submenuMeasured, setSubmenuMeasured] = useState(false);
  // Sheet stays mounted while leaving so the slide-out plays before onClose().
  const [leaving, setLeaving] = useState(false);
  // Drives the enter animation. Starts false so the first frame paints the
  // sheet off-screen (translateY 100%), then we flip to true on the next
  // animation frame so the browser interpolates to translateY 0.
  const [entered, setEntered] = useState(false);
  const closingRef = useRef(false);

  // Touch slider: height container is sized to the active panel.
  const [panelHeight, setPanelHeight] = useState<number | undefined>(undefined);
  const [heightTransitionOn, setHeightTransitionOn] = useState(false);

  // Anchor positioning — desktop only. Touch centers via the wrapper flex.
  useEffect(() => {
    if (isTouch) return;
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
  }, [x, y, isTouch]);

  // Desktop flyout submenu choreography.
  useEffect(() => {
    if (isTouch) return;
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
  }, [statusOpen, submenuMounted, isTouch]);

  useLayoutEffect(() => {
    if (isTouch) return;
    if (!submenuMounted || submenuLeaving) return;
    const parent = menuRef.current;
    const submenu = submenuRef.current;
    if (!parent || !submenu) return;
    const parentRect = parent.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();
    const vw = window.innerWidth;
    const overflowsRight = parentRect.right + submenuRect.width + 2 > vw - 8;
    setSubmenuSide(overflowsRight ? "left" : "right");
    setSubmenuMeasured(true);
  }, [submenuMounted, submenuLeaving, isTouch]);

  // Touch slider: measure the active panel for the height transition.
  useLayoutEffect(() => {
    if (!isTouch) return;
    const target = statusOpen ? statusPanelRef.current : mainPanelRef.current;
    if (target) setPanelHeight(target.offsetHeight);
  }, [statusOpen, isTouch]);

  // Enable height transition only after the first measurement so the menu
  // doesn't animate up from 0 alongside the entrance slide.
  useEffect(() => {
    if (!isTouch || panelHeight === undefined || heightTransitionOn) return;
    const raf = requestAnimationFrame(() => setHeightTransitionOn(true));
    return () => cancelAnimationFrame(raf);
  }, [isTouch, panelHeight, heightTransitionOn]);

  // Trigger the entrance slide one frame after mount. The first paint shows
  // the sheet at translateY(100%) (off-screen below); then `entered` flips to
  // true and the transition slides it up to translateY(0).
  useEffect(() => {
    if (!isTouch) {
      setEntered(true);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [isTouch]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setLeaving(true);
    window.setTimeout(() => onClose(), EXIT_MS);
  }, [onClose]);

  const runWithExit = useCallback(
    (action: () => void) => {
      if (closingRef.current) return;
      closingRef.current = true;
      tapHaptic();
      setLeaving(true);
      window.setTimeout(() => {
        action();
        onClose();
      }, EXIT_MS);
    },
    [onClose],
  );

  const handleEdit = useCallback(
    () => runWithExit(onEdit),
    [runWithExit, onEdit],
  );
  const handleDelete = useCallback(
    () => runWithExit(onDelete),
    [runWithExit, onDelete],
  );
  const handlePickStatus = useCallback(
    (s: BookStatus) => runWithExit(() => onPickStatus(s)),
    [runWithExit, onPickStatus],
  );

  // Outside-click / Esc dismiss.
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

  // Desktop animations.
  const mainAnim = leaving
    ? `leaflet-ctxmenu-pop-out ${EXIT_MS}ms ${EXIT_EASE} forwards`
    : `leaflet-ctxmenu-pop-in ${ENTER_MS}ms ${ENTER_EASE}`;
  const submenuAnim = submenuLeaving
    ? `leaflet-ctxmenu-pop-out ${EXIT_MS}ms ${EXIT_EASE} forwards`
    : `leaflet-ctxmenu-pop-in ${ENTER_MS}ms ${ENTER_EASE}`;

  // Items inside the main panel.
  const mainItems = (
    <>
      <SheetRow
        theme={theme}
        suppressHover={isTouch}
        onMouseEnter={isTouch ? undefined : () => setStatusOpen(true)}
        onMouseLeave={isTouch ? undefined : () => setStatusOpen(false)}
        onClick={
          isTouch
            ? () => {
                tapHaptic();
                setStatusOpen(true);
              }
            : undefined
        }
        icon={isTouch ? "bookmark" : undefined}
        trailing={
          isTouch ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: theme.muted,
                fontSize: 13,
              }}
            >
              {status ? labelFor(status) : "None"}
              <Icon name="chevronR" size={15} />
            </span>
          ) : (
            <Icon name="chevronR" size={14} />
          )
        }
        compact={!isTouch}
      >
        {isTouch ? "Status" : `Status${status ? ` · ${labelFor(status)}` : ""}`}
        {!isTouch && submenuMounted && (
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
              boxShadow:
                submenuSide === "right"
                  ? "6px 10px 24px rgba(0,0,0,0.18)"
                  : "-6px 10px 24px rgba(0,0,0,0.18)",
              padding: 4,
              minWidth: 140,
              visibility: submenuMeasured ? "visible" : "hidden",
              transformOrigin:
                submenuSide === "right" ? "top left" : "top right",
              animation: submenuAnim,
              pointerEvents: submenuLeaving ? "none" : "auto",
            }}
          >
            {STATUS_OPTIONS.map((o) => (
              <SheetRow
                key={o.value}
                theme={theme}
                onClick={() => handlePickStatus(o.value)}
                trailing={
                  status === o.value ? <Icon name="check" size={13} /> : null
                }
                compact
              >
                {o.label}
              </SheetRow>
            ))}
          </div>
        )}
      </SheetRow>
      <SheetDivider theme={theme} inset={isTouch ? 56 : 0} />
      <SheetRow
        theme={theme}
        onClick={handleEdit}
        suppressHover={isTouch}
        icon={isTouch ? "pencil" : undefined}
        compact={!isTouch}
      >
        Edit book info
      </SheetRow>
      <SheetDivider theme={theme} inset={isTouch ? 56 : 0} />
      <SheetRow
        theme={theme}
        onClick={handleDelete}
        suppressHover={isTouch}
        destructive
        icon={isTouch ? "trash" : undefined}
        compact={!isTouch}
      >
        Remove book
      </SheetRow>
    </>
  );

  // Touch-only panel that replaces mainItems when statusOpen flips on.
  const statusItems = (
    <>
      <SheetRow
        theme={theme}
        suppressHover
        onClick={() => {
          tapHaptic();
          setStatusOpen(false);
        }}
        icon="arrowL"
        muted
      >
        Back
      </SheetRow>
      <SheetDivider theme={theme} inset={56} />
      {STATUS_OPTIONS.map((o, i) => (
        <div key={o.value}>
          {i > 0 && <SheetDivider theme={theme} inset={56} />}
          <SheetRow
            theme={theme}
            suppressHover
            onClick={() => handlePickStatus(o.value)}
            trailing={
              status === o.value ? (
                <Icon name="check" size={17} style={{ color: theme.ink }} />
              ) : null
            }
            icon="bookmark"
            iconMuted={status !== o.value}
          >
            {o.label}
          </SheetRow>
        </div>
      ))}
    </>
  );

  if (isTouch) {
    const slideTransform = entered && !leaving ? "translateY(0)" : "translateY(100%)";
    const slideTransition = `transform ${leaving ? EXIT_MS : ENTER_MS}ms ${
      leaving ? EXIT_EASE : ENTER_EASE
    }`;
    const backdropOpacity = entered && !leaving ? 1 : 0;
    const backdropTransition = `opacity ${
      leaving ? EXIT_MS : ENTER_MS
    }ms ease, backdrop-filter ${leaving ? EXIT_MS : ENTER_MS}ms ease`;
    return (
      <>
        <style>{KEYFRAMES}</style>
        {/* Blur backdrop. backdrop-filter is widely supported on modern
            mobile browsers; the rgba dim is the fallback if it isn't. */}
        <div
          onClick={requestClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.32)",
            backdropFilter: entered && !leaving ? "blur(6px)" : "blur(0px)",
            WebkitBackdropFilter:
              entered && !leaving ? "blur(6px)" : "blur(0px)",
            zIndex: 9499,
            opacity: backdropOpacity,
            transition: backdropTransition,
          }}
        />
        {/* Bottom-anchored container holding the two cards. */}
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9500,
            padding: 10,
            paddingBottom: `max(10px, env(safe-area-inset-bottom, 10px))`,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            transform: slideTransform,
            transition: slideTransition,
            pointerEvents: leaving ? "none" : "auto",
          }}
          ref={menuRef}
          role="menu"
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Actions card. */}
          <SheetCard theme={theme}>
            {/* Header — book title + author. Only shows if title was passed. */}
            {(title || author) && (
              <>
                <div
                  style={{
                    padding: "14px 16px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  {title && (
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: theme.ink,
                        lineHeight: 1.3,
                        // Two-line clamp keeps the header compact for long titles.
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {title}
                    </div>
                  )}
                  {author && (
                    <div
                      style={{
                        fontSize: 11.5,
                        color: theme.muted,
                        lineHeight: 1.3,
                      }}
                    >
                      {author}
                    </div>
                  )}
                </div>
                <SheetDivider theme={theme} />
              </>
            )}
            {/* Height-animated slider — main panel ↔ status panel. */}
            <div
              style={{
                overflow: "hidden",
                height: panelHeight,
                transition: heightTransitionOn
                  ? `height ${SLIDE_MS}ms ${SLIDE_EASE}`
                  : undefined,
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: "200%",
                  // flex-start so panels keep their natural heights instead of
                  // stretching to the tallest sibling — the height container
                  // then animates between those distinct heights.
                  alignItems: "flex-start",
                  transform: statusOpen ? "translateX(-50%)" : "translateX(0)",
                  transition: `transform ${SLIDE_MS}ms ${SLIDE_EASE}`,
                }}
              >
                <div
                  ref={mainPanelRef}
                  style={{ width: "50%", flexShrink: 0 }}
                  aria-hidden={statusOpen}
                  inert={statusOpen || undefined}
                >
                  {mainItems}
                </div>
                <div
                  ref={statusPanelRef}
                  style={{ width: "50%", flexShrink: 0 }}
                  aria-hidden={!statusOpen}
                  inert={!statusOpen || undefined}
                >
                  {statusItems}
                </div>
              </div>
            </div>
          </SheetCard>
          {/* Cancel card — separate group, classic iOS pattern. */}
          <SheetCard theme={theme}>
            <SheetRow
              theme={theme}
              suppressHover
              onClick={() => {
                tapHaptic();
                requestClose();
              }}
              centered
              bold
            >
              Cancel
            </SheetRow>
          </SheetCard>
        </div>
      </>
    );
  }

  // Desktop / hover-capable: anchored popover with the original side flyout.
  return (
    <div
      ref={menuRef}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        background: theme.bg,
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
        borderRadius: 8,
        boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
        fontFamily: FONT_STACKS.sans,
        fontSize: 13,
        animation: mainAnim,
        pointerEvents: leaving ? "none" : "auto",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 9500,
        minWidth: 200,
        padding: 4,
        transformOrigin: "top left",
      }}
    >
      <style>{KEYFRAMES}</style>
      {mainItems}
    </div>
  );
}

function labelFor(s: BookStatus): string {
  return s === "reading" ? "Reading" : s === "finished" ? "Finished" : "Wishlist";
}

function SheetCard({
  theme,
  children,
}: {
  theme: Theme;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        background: theme.bg,
        color: theme.ink,
        borderRadius: 14,
        border: `0.5px solid ${theme.rule}`,
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        fontFamily: FONT_STACKS.sans,
        overflow: "hidden",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      {children}
    </div>
  );
}

function SheetDivider({ theme, inset = 0 }: { theme: Theme; inset?: number }) {
  return (
    <div
      style={{
        height: 0.5,
        background: theme.rule,
        marginLeft: inset,
      }}
    />
  );
}

interface SheetRowProps {
  theme: Theme;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  icon?: Parameters<typeof Icon>[0]["name"];
  iconMuted?: boolean;
  trailing?: ReactNode;
  destructive?: boolean;
  centered?: boolean;
  bold?: boolean;
  muted?: boolean;
  /** Skip the hover-state background swap. Set on coarse-pointer devices so a
      synthetic mouseenter from the touch that opened the menu can't auto-
      highlight a row. */
  suppressHover?: boolean;
  /** Tighter desktop-style padding instead of the touch-sized row. */
  compact?: boolean;
  children: ReactNode;
}

function SheetRow({
  theme,
  onClick,
  onMouseEnter,
  onMouseLeave,
  icon,
  iconMuted,
  trailing,
  destructive,
  centered,
  bold,
  muted,
  suppressHover,
  compact,
  children,
}: SheetRowProps) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);

  // Pressed wins over hover so the brief flash on tap is visible regardless
  // of which background paint is otherwise active.
  const bg = pressed
    ? theme.hover
    : hover && !suppressHover
      ? theme.hover
      : "transparent";

  const padding = compact ? "8px 12px" : "14px 16px";
  const fontSize = compact ? 13 : 15.5;

  const labelColor = destructive
    ? "#c04a3a"
    : muted
      ? theme.muted
      : theme.ink;

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
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        position: "relative",
        padding,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: centered ? "center" : "space-between",
        gap: 12,
        color: labelColor,
        background: bg,
        fontSize,
        fontWeight: bold ? 600 : 400,
        // Pressed transitions instantly in, eases out — feels responsive on
        // tap, gentle on release.
        transition: pressed
          ? "background 0ms"
          : "background 160ms ease",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          minWidth: 0,
          flex: centered ? "none" : "1 1 auto",
          justifyContent: centered ? "center" : "flex-start",
        }}
      >
        {icon && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              color: iconMuted ? theme.muted : labelColor,
              flexShrink: 0,
            }}
          >
            <Icon name={icon} size={18} stroke={1.7} />
          </span>
        )}
        <span style={{ minWidth: 0 }}>{children}</span>
      </span>
      {trailing && <span style={{ flexShrink: 0 }}>{trailing}</span>}
    </div>
  );
}
