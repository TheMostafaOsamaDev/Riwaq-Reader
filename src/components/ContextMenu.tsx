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
import { EASE, MOTION } from "../styles/motion";
import { FONT_STACKS, type Theme } from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";
import type { Tr } from "../i18n";

export interface ContextMenuProps {
  theme: Theme;
  /** Anchor coordinates from the original pointer event. Used as the top-left
      on hover-capable pointers; the touch path opens as a bottom action sheet
      and ignores these. */
  x: number;
  y: number;
  /** Book title shown in the header on both touch and desktop. */
  title?: string;
  /** Book author shown as a subtitle below the title. */
  author?: string;
  /** Optional cover URL rendered as a tiny thumbnail in the desktop header
      so the user can identify which book the menu belongs to after clicking
      through several cards. */
  coverSrc?: string;
  status: BookStatus | undefined;
  onPickStatus: (s: BookStatus) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  /** When both this and `onRemoveFromShelf` are set, the menu renders an
   *  extra "Remove from shelf" row above Delete — only meaningful when the
   *  menu was opened from a shelf-scoped grid (the single-shelf detail
   *  page), not the main library grid. `shelfContextId` itself is unused
   *  beyond gating the row; the actual shelf id lives in the caller's
   *  closure over `onRemoveFromShelf`. */
  shelfContextId?: string;
  onRemoveFromShelf?: () => void;
}

/** Status submenu entries. Labels reuse the sidebar's already-translated
 *  Reading/Finished/Wishlist strings rather than a separate copy. Computed
 *  from `tr` on every render (a 3-item array) instead of module-level so
 *  the labels track the active UI locale. */
function getStatusOptions(tr: Tr): { value: BookStatus; label: string }[] {
  return [
    { value: "reading", label: tr("sidebar.reading") },
    { value: "finished", label: tr("sidebar.finished") },
    { value: "wishlist", label: tr("sidebar.wishlist") },
  ];
}

// Motion timings pulled from the app-wide motion tokens so every
// menu/sheet/panel shares the same enter/exit feel.
const ENTER_MS = MOTION.med;
const EXIT_MS = MOTION.fast;
const ENTER_EASE = EASE.enter;
const EXIT_EASE = EASE.exit;
const SLIDE_MS = MOTION.med;
const SLIDE_EASE = EASE.enter;

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
  coverSrc,
  status,
  onPickStatus,
  onEdit,
  onDelete,
  onClose,
  shelfContextId,
  onRemoveFromShelf,
}: ContextMenuProps) {
  const { tr, dir } = useI18n();
  const STATUS_OPTIONS = getStatusOptions(tr);
  // Only meaningful when the menu was opened from a shelf-scoped grid —
  // the main library grid never passes these two together.
  const hasShelfRow = Boolean(shelfContextId && onRemoveFromShelf);
  // Main-panel row indices: Status(0), Edit(1), [Remove from shelf](2),
  // Delete(last). Kept as constants rather than hardcoded 2/3 so the
  // keyboard-nav math below stays in sync with whichever row set is
  // actually rendered.
  const REMOVE_SHELF_INDEX = 2;
  const DELETE_INDEX = hasShelfRow ? 3 : 2;
  const MAIN_COUNT = hasShelfRow ? 4 : 3;
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

  // Desktop-only: which row is currently highlighted. Both mouse hover and
  // keyboard arrows feed `mainFocus` / `subFocus`, so we never end up with
  // two rows lit at once. -1 means "nothing highlighted yet" (initial state
  // before the user has interacted).
  const [mainFocus, setMainFocus] = useState(-1);
  const [subFocus, setSubFocus] = useState(-1);

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
  const handleRemoveFromShelf = useCallback(() => {
    if (onRemoveFromShelf) runWithExit(onRemoveFromShelf);
  }, [runWithExit, onRemoveFromShelf]);
  const handlePickStatus = useCallback(
    (s: BookStatus) => runWithExit(() => onPickStatus(s)),
    [runWithExit, onPickStatus],
  );

  // Outside-click dismiss. pointerdown fires on both touchstart and mousedown
  // so the menu closes the moment a finger or cursor lands outside it.
  useEffect(() => {
    const onDocPointer = (e: PointerEvent) => {
      const el = menuRef.current;
      if (el && !el.contains(e.target as Node)) requestClose();
    };
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, [requestClose]);

  // Keyboard handler — touch gets a minimal Esc-closes; desktop gets full
  // arrow navigation, Enter to activate, letter shortcuts, and right/left
  // for submenu traversal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (leaving) return;
      if (isTouch) {
        if (e.key === "Escape") {
          e.preventDefault();
          requestClose();
        }
        return;
      }
      const inSubmenu = subFocus >= 0;
      const n = STATUS_OPTIONS.length;
      // Under RTL the submenu flyout opens toward the inline-start (visually
      // left), so the enter/exit arrows swap: ArrowLeft opens, ArrowRight
      // closes. Mirrors the reader's forward/back arrow swap (DesktopReader).
      const enterSubmenuKey = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
      const exitSubmenuKey = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (inSubmenu) {
            setSubFocus((p) => (p + 1) % n);
          } else {
            setMainFocus((p) => (p < 0 ? 0 : (p + 1) % MAIN_COUNT));
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (inSubmenu) {
            setSubFocus((p) => (p - 1 + n) % n);
          } else {
            setMainFocus((p) =>
              p < 0 ? MAIN_COUNT - 1 : (p - 1 + MAIN_COUNT) % MAIN_COUNT,
            );
          }
          break;
        case enterSubmenuKey:
          // From the Status row, enter the submenu and focus the first
          // option (or the current status, if one is already set).
          e.preventDefault();
          if (!inSubmenu && mainFocus === 0) {
            const initial = status
              ? STATUS_OPTIONS.findIndex((o) => o.value === status)
              : 0;
            setStatusOpen(true);
            setSubFocus(initial >= 0 ? initial : 0);
          }
          break;
        case exitSubmenuKey:
          // Exits the submenu back to the Status row.
          e.preventDefault();
          if (inSubmenu) {
            setStatusOpen(false);
            setSubFocus(-1);
          }
          break;
        case "Enter":
          e.preventDefault();
          if (inSubmenu) {
            handlePickStatus(STATUS_OPTIONS[subFocus].value);
          } else if (mainFocus === 0) {
            // Enter on Status toggles the submenu so a returning user
            // doesn't have to remember which arrow opens it.
            if (statusOpen) {
              setStatusOpen(false);
              setSubFocus(-1);
            } else {
              const initial = status
                ? STATUS_OPTIONS.findIndex((o) => o.value === status)
                : 0;
              setStatusOpen(true);
              setSubFocus(initial >= 0 ? initial : 0);
            }
          } else if (mainFocus === 1) {
            handleEdit();
          } else if (hasShelfRow && mainFocus === REMOVE_SHELF_INDEX) {
            handleRemoveFromShelf();
          } else if (mainFocus === DELETE_INDEX) {
            handleDelete();
          }
          break;
        case "Escape":
          e.preventDefault();
          // Esc inside the submenu only closes the submenu; a second Esc
          // closes the whole menu. Standard menu pattern.
          if (inSubmenu || statusOpen) {
            setStatusOpen(false);
            setSubFocus(-1);
          } else {
            requestClose();
          }
          break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    isTouch,
    leaving,
    mainFocus,
    subFocus,
    statusOpen,
    status,
    handleEdit,
    handleDelete,
    handleRemoveFromShelf,
    handlePickStatus,
    requestClose,
    hasShelfRow,
    MAIN_COUNT,
    REMOVE_SHELF_INDEX,
    DELETE_INDEX,
  ]);

  // Desktop: collapse the submenu the moment the highlight moves off the
  // Status row (hover onto Edit, ArrowDown past it, etc.) so the flyout
  // doesn't linger contradicting the new highlight.
  useEffect(() => {
    if (isTouch) return;
    if (mainFocus > 0 && statusOpen) {
      setStatusOpen(false);
      setSubFocus(-1);
    }
  }, [mainFocus, statusOpen, isTouch]);

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
              {status ? labelFor(status, tr) : tr("contextMenu.statusNone")}
              <Icon name="chevronR" size={15} className="rtl-flip-x" />
            </span>
          ) : (
            <Icon name="chevronR" size={14} className="rtl-flip-x" />
          )
        }
        compact={!isTouch}
      >
        {isTouch
          ? tr("contextMenu.status")
          : `${tr("contextMenu.status")}${status ? ` · ${labelFor(status, tr)}` : ""}`}
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
        {tr("contextMenu.editBookInfo")}
      </SheetRow>
      {hasShelfRow && (
        <>
          <SheetDivider theme={theme} inset={isTouch ? 56 : 0} />
          <SheetRow
            theme={theme}
            onClick={handleRemoveFromShelf}
            suppressHover={isTouch}
            icon={isTouch ? "layers" : undefined}
            compact={!isTouch}
          >
            {tr("shelves.removeFromShelf")}
          </SheetRow>
        </>
      )}
      <SheetDivider theme={theme} inset={isTouch ? 56 : 0} />
      <SheetRow
        theme={theme}
        onClick={handleDelete}
        suppressHover={isTouch}
        destructive
        icon={isTouch ? "trash" : undefined}
        compact={!isTouch}
      >
        {tr("contextMenu.removeBook")}
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
        iconClassName="rtl-flip-x"
        muted
      >
        {tr("common.back")}
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

  // Desktop-only book header — keeps the user oriented after right-clicking
  // through several cards. Shows nothing if neither title nor author was
  // passed in (back-compat with older call sites).
  const desktopHeader =
    title || author ? (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          // Sit within the menu's 4px inner padding — keeps the divider
          // clear of the rounded corners and avoids overlap with the
          // side-flyout submenu (which positions absolute past the right
          // edge and would otherwise be clipped if we used overflow:hidden
          // to contain a margin-escaped divider).
          padding: "8px 8px 10px",
          marginBottom: 4,
          borderBottom: `0.5px solid ${theme.rule}`,
        }}
      >
        {coverSrc && (
          <img
            src={coverSrc}
            alt=""
            style={{
              width: 28,
              height: 42,
              objectFit: "cover",
              borderRadius: 3,
              flexShrink: 0,
              boxShadow:
                "0 1px 2px rgba(0,0,0,0.18), inset 1px 0 0 rgba(255,255,255,0.08), inset -1px 0 0 rgba(0,0,0,0.18)",
            }}
          />
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            gap: 2,
            flex: 1,
          }}
        >
          {/* Always shown (once the header itself renders — gated above by
              `title || author`): a blank `title` now falls back to a
              localized "Untitled" rather than hiding the row entirely,
              same as BookCover / the Library shelf cards. */}
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: theme.ink,
              lineHeight: 1.25,
              // Two-line clamp so long titles don't push the menu absurdly
              // tall — the rest stays visible in the Edit modal anyway.
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {title || tr("common.untitled")}
          </div>
          {/* Always shown (once the header itself renders — gated above by
              `title || author`): a blank `author` now falls back to a
              localized "Unknown author" rather than hiding the row, same
              as BookCover / the Library shelf cards. */}
          <div
            style={{
              fontSize: 11,
              color: theme.muted,
              lineHeight: 1.3,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {author || tr("common.unknownAuthor")}
          </div>
        </div>
      </div>
    ) : null;

  // Desktop main items — separate from `mainItems` (touch) because the
  // desktop layout adds icons, shortcut hints, and parent-driven focus
  // state. The submenu flyout still lives inside the Status row so its
  // position stays anchored to that row.
  const desktopMainItems = (
    <>
      <SheetRow
        theme={theme}
        compact
        icon="bookmark"
        forceHighlight={mainFocus === 0}
        onMouseEnter={() => {
          setMainFocus(0);
          if (!statusOpen) setStatusOpen(true);
        }}
        onClick={() => {
          // Click on Status (rare — hover already opens it) toggles the
          // submenu so trackpad users who tap can dismiss it without
          // leaving the row.
          if (statusOpen) {
            setStatusOpen(false);
            setSubFocus(-1);
          } else {
            const initial = status
              ? STATUS_OPTIONS.findIndex((o) => o.value === status)
              : 0;
            setStatusOpen(true);
            setSubFocus(initial >= 0 ? initial : 0);
          }
        }}
        trailing={
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              color: theme.muted,
              fontSize: 12,
            }}
          >
            {status ? labelFor(status, tr) : null}
            <Icon name="chevronR" size={13} className="rtl-flip-x" />
          </span>
        }
      >
        {tr("contextMenu.status")}
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
              boxShadow:
                submenuSide === "right"
                  ? "6px 10px 24px rgba(0,0,0,0.18)"
                  : "-6px 10px 24px rgba(0,0,0,0.18)",
              padding: 4,
              minWidth: 160,
              visibility: submenuMeasured ? "visible" : "hidden",
              transformOrigin:
                submenuSide === "right" ? "top left" : "top right",
              animation: submenuAnim,
              pointerEvents: submenuLeaving ? "none" : "auto",
            }}
          >
            {STATUS_OPTIONS.map((o, i) => (
              <SheetRow
                key={o.value}
                theme={theme}
                compact
                forceHighlight={subFocus === i}
                onMouseEnter={() => setSubFocus(i)}
                onClick={() => handlePickStatus(o.value)}
                trailing={
                  status === o.value ? (
                    <Icon name="check" size={13} />
                  ) : null
                }
              >
                {o.label}
              </SheetRow>
            ))}
          </div>
        )}
      </SheetRow>
      <SheetDivider theme={theme} />
      <SheetRow
        theme={theme}
        compact
        icon="pencil"
        forceHighlight={mainFocus === 1}
        onMouseEnter={() => setMainFocus(1)}
        onClick={handleEdit}
      >
        {tr("contextMenu.editBookInfo")}
      </SheetRow>
      {hasShelfRow && (
        <>
          <SheetDivider theme={theme} />
          <SheetRow
            theme={theme}
            compact
            icon="layers"
            forceHighlight={mainFocus === REMOVE_SHELF_INDEX}
            onMouseEnter={() => setMainFocus(REMOVE_SHELF_INDEX)}
            onClick={handleRemoveFromShelf}
          >
            {tr("shelves.removeFromShelf")}
          </SheetRow>
        </>
      )}
      <SheetDivider theme={theme} />
      <SheetRow
        theme={theme}
        compact
        icon="trash"
        destructive
        forceHighlight={mainFocus === DELETE_INDEX}
        onMouseEnter={() => setMainFocus(DELETE_INDEX)}
        onClick={handleDelete}
      >
        {tr("contextMenu.removeBook")}
      </SheetRow>
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
            insetInlineStart: 0,
            insetInlineEnd: 0,
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
                  {/* Blank `title` falls back to a localized "Untitled"
                      rather than hiding the row — same rationale as the
                      desktop header above. */}
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
                    {title || tr("common.untitled")}
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: theme.muted,
                      lineHeight: 1.3,
                    }}
                  >
                    {author || tr("common.unknownAuthor")}
                  </div>
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
              {tr("common.cancel")}
            </SheetRow>
          </SheetCard>
        </div>
      </>
    );
  }

  // Desktop / hover-capable: anchored popover with a book-context header,
  // icon + shortcut-hint rows, and the original side flyout submenu.
  return (
    <div
      ref={menuRef}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        background: theme.bg,
        color: theme.ink,
        border: `0.5px solid ${theme.rule}`,
        borderRadius: 10,
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
        // Wider than the original 200px so the book header and status
        // label sit comfortably without crowding the rows.
        minWidth: 240,
        padding: 4,
        // overflow stays visible so the side flyout submenu can extend
        // past the menu's right edge.
        transformOrigin: "top left",
      }}
    >
      <style>{KEYFRAMES}</style>
      {desktopHeader}
      {desktopMainItems}
    </div>
  );
}

function labelFor(s: BookStatus, tr: Tr): string {
  return s === "reading"
    ? tr("sidebar.reading")
    : s === "finished"
      ? tr("sidebar.finished")
      : tr("sidebar.wishlist");
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
        // Logical (not `marginLeft`): the inset aligns the divider under the
        // row's text, which sits at the reading-direction START past the
        // icon column — that's the right edge in RTL, not always the left.
        marginInlineStart: inset,
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
  /** Extra className passed to the icon — used for `rtl-flip-x` on
   *  directional glyphs (e.g. the "Back" row's arrowL). */
  iconClassName?: string;
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
  /** When defined, parent fully controls the highlight (overrides internal
      hover state). True paints theme.hover; false paints transparent. Used by
      the desktop menu to keep keyboard focus and mouse hover in a single
      source of truth so two rows can't light up at once. */
  forceHighlight?: boolean;
  children: ReactNode;
}

function SheetRow({
  theme,
  onClick,
  onMouseEnter,
  onMouseLeave,
  icon,
  iconMuted,
  iconClassName,
  trailing,
  destructive,
  centered,
  bold,
  muted,
  suppressHover,
  compact,
  forceHighlight,
  children,
}: SheetRowProps) {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);

  // Pressed wins over hover/forceHighlight so the brief flash on tap is
  // visible regardless of which background paint is otherwise active. When
  // forceHighlight is set (desktop, parent-driven), it overrides the local
  // hover entirely so kb focus and mouse hover share one source of truth.
  const highlighted =
    pressed ||
    (forceHighlight !== undefined
      ? forceHighlight
      : hover && !suppressHover);
  const bg = highlighted ? theme.hover : "transparent";

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
            <Icon name={icon} size={18} stroke={1.7} className={iconClassName} />
          </span>
        )}
        <span style={{ minWidth: 0 }}>{children}</span>
      </span>
      {trailing && <span style={{ flexShrink: 0 }}>{trailing}</span>}
    </div>
  );
}
