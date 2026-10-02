// Desktop library navigation as a left sidebar (رواق rebrand).
//
// Calm and warm: phoenix + رواق wordmark, a search *button* that opens the
// full-screen search, a "Main" nav with collapsible parents — Library (tree:
// Reading/Finished/Wishlist) and Shelves (user collections; UI only for now,
// the real feature lands on its own branch) — plus Store and a Downloads row
// with a live badge + in-place progress. Settings and a primary Import
// split-button are pinned to the bottom. Mobile keeps its bottom nav.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";
import { SIDEBAR_ROW_INSET, sidebarFrame } from "./sidebarFrame";
import type { IconProps } from "./Icon";
import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  type Theme,
  type ThemeKey,
  withAlpha,
  Z,
  Z_LOCAL,
} from "../styles/tokens";
import { getState, subscribe } from "../store/downloadQueue";
import {
  getDownloadProgress,
  subscribeDownloadProgress,
} from "../store/downloadProgress";
import { useImportIndicator } from "../store/importIndicator";
import { setMinimized } from "../store/importProgress";
import type { Shelf } from "../store/shelves";
import type { LibraryTab } from "./library/tabs";
import { useI18n } from "../i18n/useI18n";
import type { Dir, MsgKey, Tr } from "../i18n";
import { dotFor, useDesktopUpdateSelect } from "../store/desktopUpdate";
import { SidebarUpdateCard } from "./update/SidebarUpdateCard";

interface Props {
  theme: Theme;
  themeKey: ThemeKey;
  tab: LibraryTab;
  setTab: (t: LibraryTab) => void;
  importing: boolean;
  onImport: () => void;
  onImportFolder: () => void;
  onOpenQueue: () => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  /** True only when the shelf itself is the active destination (not the
   *  Store, the Shelves page, or an open novel detail). Gates the Library
   *  row + its status-filter tree so a lingering filter selection doesn't
   *  stay highlighted after navigating away to a sibling destination. */
  shelfActive: boolean;
  shelves: Shelf[];
  shelvesActive: boolean;
  onOpenShelves: () => void;
  onNewShelf: () => void;
  /** Navigate to a specific shelf's detail view. */
  onOpenShelf: (id: string) => void;
  /** The shelf whose detail view is currently open, if any. Highlights the
   *  matching row in the tree below the "Shelves" parent. */
  activeShelfId?: string;
}

const TRANSITION =
  "background-color 150ms ease, color 150ms ease, opacity 150ms ease, transform 150ms ease";

/** The queue drives the row's badge/label; the percentage comes from the
 *  shared burst reading in `downloadProgress.ts`, which measures the whole
 *  burst. Averaging the running jobs' own progress here is what used to
 *  park this readout near 4% forever — with two workers there are only
 *  ever two partial jobs, and each restarts at zero as the one before it
 *  lands, so the average never reflected the queue draining. */
function useDownloadSummary() {
  const [jobs, setJobs] = useState(() => getState().jobs);
  useEffect(() => subscribe((s) => setJobs(s.jobs)), []);
  const [burst, setBurst] = useState(getDownloadProgress);
  useEffect(() => subscribeDownloadProgress(setBurst), []);
  const count = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  ).length;
  return { count, active: count > 0, pct: burst.pct };
}

const TREE_KEYS: { key: LibraryTab; k: MsgKey }[] = [
  { key: "reading", k: "sidebar.reading" },
  { key: "finished", k: "sidebar.finished" },
  { key: "wishlist", k: "sidebar.wishlist" },
];

export function LibrarySidebar({
  theme,
  themeKey,
  tab,
  setTab,
  importing,
  onImport,
  onImportFolder,
  onOpenQueue,
  onOpenSettings,
  onOpenSearch,
  shelfActive,
  shelves,
  shelvesActive,
  onOpenShelves,
  onNewShelf,
  onOpenShelf,
  activeShelfId,
}: Props) {
  const { tr, dir } = useI18n();
  const dark = themeKey === "dark" || themeKey === "oled";
  const gold = dark ? "#d4a84a" : "#c9a24a";
  const goldSoft = dark ? "rgba(212,168,74,0.22)" : "rgba(201,162,74,0.18)";
  const markSrc = dark ? "/brand/mark-cream.webp" : "/brand/mark-ink.webp";
  const dl = useDownloadSummary();
  // A waiting update the user put off with Later (the desktop store; empty
  // on Android, which never feeds it). Selected, so a download's progress
  // ticks re-render the card, not the whole sidebar.
  const updateDot = useDesktopUpdateSelect(dotFor);
  // Reads the shared import store, so a Store import shows here too and a
  // click during a run re-opens the stepper instead of the file picker.
  const ind = useImportIndicator(importing);

  const [openLib, setOpenLib] = useStoredOpen("riwaq:sidebar-open:library");
  const [openShelves, setOpenShelves] = useStoredOpen(
    "riwaq:sidebar-open:shelves",
  );

  // Index of each tree's current destination, -1 when it has none. Rows
  // before it are on the lit path from the parent. The parent stays solid
  // while its tree holds the destination (the section you're in); the child
  // is marked by its text alone, not a second solid pill — see TreeButton.
  const libActiveIdx = shelfActive
    ? TREE_KEYS.findIndex((t) => t.key === tab)
    : -1;
  const shelfActiveIdx =
    activeShelfId === undefined
      ? -1
      : shelves.findIndex((s) => s.id === activeShelfId);

  const [menuOpen, setMenuOpen] = useState(false);
  const importRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!importRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpen]);

  return (
    <aside style={{ ...sidebarFrame(theme), fontFamily: FONT_STACKS.sans }}>
      {/* Head — brand mark + wordmark. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "4px 8px 16px",
        }}
      >
        <img
          src={markSrc}
          alt=""
          width={34}
          height={34}
          style={{ width: 34, height: 34, objectFit: "contain", flexShrink: 0 }}
        />
        <span
          style={{
            fontFamily: FONT_SERIF_DISPLAY,
            fontWeight: 500,
            fontSize: 21,
            color: theme.ink,
            lineHeight: 1.1,
            letterSpacing: dir === "rtl" ? "normal" : "-0.01em",
          }}
        >
          {dir === "rtl" ? "رواق" : "Riwaq"}
        </span>
      </div>

      {/* Search — opens the full-screen search */}
      <button
        onClick={onOpenSearch}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          width: "calc(100% - 8px)",
          margin: `0 ${SIDEBAR_ROW_INSET}px 12px`,
          background: theme.bg,
          border: `1px solid ${theme.rule}`,
          borderRadius: 11,
          padding: "9px 11px",
          cursor: "pointer",
          font: "inherit",
          color: theme.muted,
          textAlign: "start",
          transition: TRANSITION,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = theme.chromeHover)
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = theme.bg)}
      >
        <Icon name="search" size={16} />
        <span style={{ flex: 1, fontSize: 13 }}>
          {tr("sidebar.searchLibrary")}
        </span>
        <span
          style={{
            fontSize: 10.5,
            color: theme.muted,
            border: `1px solid ${theme.rule}`,
            borderRadius: 5,
            padding: "2px 6px",
            fontWeight: 600,
            lineHeight: 1,
          }}
        >
          ⌘K
        </span>
      </button>

      {/* Scrollable nav. A reserved-space scrollbar's gutter sits on the
          container's inline-end edge — physically right in LTR, physically
          left in RTL — so it would land flush against the collapsible rows'
          disclosure-chevron column, and its rounded thumb end would read as
          a stray sliver right beside the row's own rounded corner (worst
          under the OLED theme). Reserving a gutter (padding/scrollbar-gutter)
          to fix that insets the nav's content, which then no longer lines up
          with the full-width Search button above and Import button below —
          so instead we hide the scrollbar chrome entirely via
          `riwaq-scroll-hidden` (wheel/trackpad scrolling still works) and
          keep the container full-width. */}
      <div
        className="riwaq-scroll-hidden"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        <SectionLabel theme={theme}>{tr("sidebar.main")}</SectionLabel>
        <nav
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 5,
            padding: `0 ${SIDEBAR_ROW_INSET}px`,
          }}
        >
          {/* Library (collapsible) — row + tree grouped so the nav gap stays uniform */}
          <div>
            <CollapsibleRow
              theme={theme}
              dark={dark}
              icon="grid"
              label={tr("sidebar.library")}
              active={shelfActive}
              open={openLib}
              onActivate={() => setTab("all")}
              setOpen={setOpenLib}
              dir={dir}
              tr={tr}
            />
            <Collapse open={openLib}>
              <Tree theme={theme}>
                {TREE_KEYS.map((t, i) => (
                  <TreeButton
                    key={t.key}
                    theme={theme}
                    label={tr(t.k)}
                    active={i === libActiveIdx}
                    onPath={i < libActiveIdx}
                    onClick={() => setTab(t.key)}
                  />
                ))}
              </Tree>
            </Collapse>
          </div>

          {/* Shelves (collapsible) — row + tree grouped so the nav gap stays uniform */}
          <div>
            <CollapsibleRow
              theme={theme}
              dark={dark}
              icon="layers"
              label={tr("sidebar.shelves")}
              active={shelvesActive || shelfActiveIdx >= 0}
              open={openShelves}
              onActivate={onOpenShelves}
              setOpen={setOpenShelves}
              dir={dir}
              tr={tr}
            />
            <Collapse open={openShelves}>
              <Tree theme={theme}>
                {shelves.map((s, i) => (
                  <TreeButton
                    key={s.id}
                    theme={theme}
                    label={s.name}
                    active={i === shelfActiveIdx}
                    onPath={i < shelfActiveIdx}
                    onClick={() => onOpenShelf(s.id)}
                  />
                ))}
                <TreeButton
                  theme={theme}
                  icon="plus"
                  label={tr("sidebar.newShelf")}
                  onClick={onNewShelf}
                />
              </Tree>
            </Collapse>
          </div>

          <NavRow
            theme={theme}
            icon="globe"
            label={tr("sidebar.store")}
            active={tab === "store"}
            onClick={() => setTab("store")}
          />

          {/* Downloads — constant height, progress fills inside */}
          <button
            onClick={onOpenQueue}
            title={tr("sidebar.downloads")}
            style={{
              position: "relative",
              overflow: "hidden",
              height: 38,
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "0 12px",
              border: 0,
              borderRadius: 10,
              background: "transparent",
              color: theme.ink,
              font: "inherit",
              fontSize: 13.5,
              fontWeight: 500,
              cursor: "pointer",
              transition: TRANSITION,
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = theme.hover)
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            <span
              style={{
                position: "absolute",
                insetInlineStart: 0,
                top: 0,
                bottom: 0,
                width: dl.active ? `${Math.max(6, dl.pct)}%` : 0,
                background: goldSoft,
                borderRadius: 10,
                transition: "width .35s ease",
                zIndex: Z_LOCAL.under,
              }}
            />
            <span
              style={{
                position: "relative",
                zIndex: Z_LOCAL.base,
                color: theme.muted,
                display: "flex",
              }}
            >
              <Icon name="download" size={18} />
            </span>
            <span style={{ position: "relative", zIndex: Z_LOCAL.base }}>
              {tr("sidebar.downloads")}
            </span>
            {dl.active ? (
              <span
                role="progressbar"
                aria-valuenow={dl.pct}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{
                  position: "relative",
                  zIndex: Z_LOCAL.base,
                  marginInlineStart: "auto",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: theme.ink,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {dl.pct}%
              </span>
            ) : dl.count > 0 ? (
              <span
                style={{
                  position: "relative",
                  zIndex: Z_LOCAL.base,
                  marginInlineStart: "auto",
                  minWidth: 20,
                  height: 20,
                  padding: "0 6px",
                  borderRadius: 10,
                  background: goldSoft,
                  color: gold,
                  fontSize: 11,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {dl.count}
              </span>
            ) : null}
          </button>

          <NavRow
            theme={theme}
            icon="settings"
            label={tr("sidebar.settings")}
            active={false}
            onClick={onOpenSettings}
            dot={updateDot}
            ariaLabel={updateDot ? tr("sidebar.settingsUpdate") : undefined}
          />
        </nav>
      </div>

      {/* Bottom: the update card (desktop), then primary Import */}
      <div style={{ padding: `10px ${SIDEBAR_ROW_INSET}px 0` }}>
        <SidebarUpdateCard theme={theme} />
        <div ref={importRef} style={{ position: "relative" }}>
          <div style={{ display: "flex" }}>
            <button
              onClick={
                ind.action === "details" ? () => setMinimized(false) : onImport
              }
              disabled={ind.action === "none"}
              aria-busy={ind.busy || undefined}
              {...(ind.action === "details"
                ? { title: tr("import.progress.openDetails") }
                : {})}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                height: 40,
                border: 0,
                borderInlineEnd: `1px solid ${dark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.18)"}`,
                borderStartStartRadius: 11,
                borderEndStartRadius: 11,
                borderStartEndRadius: 0,
                borderEndEndRadius: 0,
                background: theme.ink,
                color: theme.paper,
                font: "inherit",
                fontSize: 13.5,
                fontWeight: 600,
                // "progress", not "default": the action is under way, not unavailable.
                cursor: ind.action === "none" ? "progress" : "pointer",
                // Dimmed only while it genuinely can't be pressed — once a run
                // is reporting, a click opens the stepper.
                opacity: ind.action === "none" ? 0.6 : 1,
                transition: TRANSITION,
              }}
              onMouseEnter={(e) => {
                if (!ind.busy) e.currentTarget.style.opacity = "0.9";
              }}
              onMouseLeave={(e) => {
                if (!ind.busy) e.currentTarget.style.opacity = "1";
              }}
            >
              {ind.busy ? (
                // Swaps in for the plus rather than sitting beside it, so the
                // button's contents don't shift when a run starts. Determinate
                // as soon as the pipeline reports a ratio.
                <Spinner
                  size={16}
                  strokeWidth={2}
                  {...(ind.ratio === null ? {} : { value: ind.ratio })}
                />
              ) : (
                <Icon name="plus" size={16} />
              )}
              {ind.busy
                ? // An add's busy state is a background cover fetch, not an
                  // import — reuse the Downloads copy instead of claiming
                  // otherwise.
                  ind.reason === "add"
                  ? tr("downloads.statusFetchingCover")
                  : tr("sidebar.importing")
                : tr("sidebar.importBook")}
            </button>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={tr("sidebar.moreImport")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 38,
                height: 40,
                border: 0,
                borderStartStartRadius: 0,
                borderEndStartRadius: 0,
                borderStartEndRadius: 11,
                borderEndEndRadius: 11,
                background: theme.ink,
                color: theme.paper,
                cursor: "pointer",
                transition: TRANSITION,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <Icon
                name="chevronD"
                size={15}
                style={{
                  transform: menuOpen ? "rotate(180deg)" : "none",
                  transition: "transform .15s",
                }}
              />
            </button>
          </div>
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 6px)",
                background: theme.paper,
                border: `1px solid ${theme.rule}`,
                borderRadius: 12,
                boxShadow: "0 16px 36px rgba(0,0,0,0.18)",
                padding: 6,
                zIndex: Z.panel,
              }}
            >
              <MenuItem
                theme={theme}
                icon="folder"
                label={tr("sidebar.folderOfBooks")}
                onClick={() => {
                  setMenuOpen(false);
                  onImportFolder();
                }}
              />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

const COLLAPSE_MS = 220;

/** A tree's open/closed state, kept in localStorage. The sidebar unmounts
 *  whenever Settings or the reader is open, so component state alone
 *  reopened every collapsed tree on the way back. Blocked storage (private
 *  mode, a locked-down webview) just means the tree starts open and the
 *  choice lasts for this mount. */
export function useStoredOpen(key: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== "0";
    } catch {
      return true;
    }
  });
  const set = useCallback(
    (next: boolean) => {
      setOpen(next);
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Not persisted; the in-memory state above still applies.
      }
    },
    [key],
  );
  return [open, set];
}

/** Smoothly expand/collapse a group by animating its measured height. */
export function Collapse({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // null until measured; an open tree renders unclamped ("none") until then.
  const [h, setH] = useState<number | null>(null);
  // Measure once before first paint, then only when the content resizes (a
  // shelf added or renamed, the UI language switched). Reading scrollHeight
  // after every render forced a synchronous layout each time — and the
  // sidebar re-renders on every download-progress tick.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setH(el.scrollHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setH(el.scrollHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Animate only a toggle. Everything else that changes the height — the
  // first measurement, or shelves arriving from disk a moment after the
  // sidebar mounts — lands at once: animating those replayed the open
  // animation on every launch and every return from Settings. The flag is
  // raised in the same render as the new `open`, so the transition is in
  // place for the commit that changes max-height, and it stays up until the
  // animation has had time to finish.
  const [prevOpen, setPrevOpen] = useState(open);
  const [toggling, setToggling] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    setToggling(true);
  }
  useEffect(() => {
    if (!toggling) return;
    const t = window.setTimeout(() => setToggling(false), COLLAPSE_MS + 40);
    return () => window.clearTimeout(t);
  }, [toggling, open]);

  return (
    <div
      style={{
        flexShrink: 0,
        minHeight: 0,
        overflow: "hidden",
        maxHeight: open ? (h ?? "none") : 0,
        opacity: open ? 1 : 0,
        transition: toggling
          ? `max-height ${COLLAPSE_MS}ms ease, opacity 180ms ease`
          : "none",
      }}
    >
      {/* flow-root: without it a child's top margin (the Tree's) collapses
          out through this div, scrollHeight comes up that many px short, and
          the overflow above clips the bottom of the last row's hover fill. */}
      <div ref={ref} style={{ display: "flow-root" }}>
        {children}
      </div>
    </div>
  );
}

/** Indented TreeButtons with a curved connector per row (see
 *  `.riwaq-tree-item` in global.css): the rail runs down the inline-start
 *  side and each row bends off it with a rounded elbow; the last row's elbow
 *  ends the rail. The theme reaches that CSS as custom properties. */
function Tree({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <div
      style={
        {
          marginBlockStart: 4,
          marginInlineStart: 22,
          paddingInlineStart: 14,
          "--tree-hover-bg": theme.hover,
          "--tree-rule": theme.rule,
          // Hover path: half-strength muted, so it reads as a preview, a
          // clear step below the current path's full ink.
          "--tree-hover": withAlpha(theme.muted, 0.5),
          "--tree-active": theme.ink,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}

function TreeButton({
  theme,
  icon,
  label,
  active = false,
  onPath = false,
  onClick,
}: {
  theme: Theme;
  icon?: IconProps["name"];
  label: string;
  active?: boolean;
  /** Sits between the parent row and the active row: its stretch of rail
   *  lights up, so the line runs unbroken from parent to destination. */
  onPath?: boolean;
  onClick: () => void;
}) {
  // Selected is text only: full ink and bold against the idle rows' muted
  // 500, with the lit branch + path (global.css) leading to it. No fill —
  // the parent row already wears the solid pill while you're anywhere in
  // its section. The hover tint is CSS too (`.riwaq-tree-item`), behind
  // `(hover: hover)`, so a tap on a touch screen doesn't leave it stuck on.
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        textAlign: "start",
        border: 0,
        color: active ? theme.ink : theme.muted,
        fontWeight: active ? 600 : 500,
        fontSize: 13,
        fontFamily: "inherit",
        padding: "8px 12px",
        borderRadius: 9,
        cursor: "pointer",
        transition: TRANSITION,
      }}
      className="riwaq-tree-item"
      data-active={active || undefined}
      data-path={onPath || undefined}
      aria-current={active ? "page" : undefined}
    >
      {icon && <Icon name={icon} size={14} />}
      {label}
    </button>
  );
}

function CollapsibleRow({
  theme,
  dark,
  icon,
  label,
  active,
  open,
  onActivate,
  setOpen,
  dir,
  tr,
}: {
  theme: Theme;
  dark: boolean;
  icon: IconProps["name"];
  label: string;
  active: boolean;
  open: boolean;
  onActivate: () => void;
  setOpen: (v: boolean) => void;
  dir: Dir;
  tr: Tr;
}) {
  // Split row modelled on the bottom Import split-button: both sides share the
  // row's own colour (solid ink when active, transparent when idle), parted only
  // by a hairline — no second tint.
  //
  // UX: a single click navigates *and* reveals the tree; double-clicking the row
  // toggles the tree, so you can collapse it without aiming for the small
  // chevron. The double-click is detected by our own <400ms window (more
  // forgiving than the OS threshold) and toggles relative to the tree state
  // captured at the *start* of the gesture — so it works whether or not the row
  // is the current view, and a double-click never re-collapses a tree its own
  // first click just opened.
  const gestureOpen = useRef(open);
  const lastClickAt = useRef(0);
  const sectionBg = active ? theme.ink : "transparent";
  const divider = active
    ? dark
      ? "rgba(0,0,0,0.25)"
      : "rgba(255,255,255,0.18)"
    : theme.rule;
  const fg = active ? theme.paper : theme.ink;
  const iconColor = active ? theme.paper : theme.muted;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        borderRadius: 10,
        overflow: "hidden",
        transition: TRANSITION,
      }}
    >
      <button
        onClick={(e) => {
          const isDouble = e.timeStamp - lastClickAt.current < 400;
          lastClickAt.current = e.timeStamp;
          if (isDouble) {
            setOpen(!gestureOpen.current);
            return;
          }
          gestureOpen.current = open;
          onActivate();
          setOpen(true);
        }}
        title={tr(
          open ? "sidebar.doubleClickCollapse" : "sidebar.doubleClickExpand",
        )}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "9px 12px",
          border: 0,
          background: sectionBg,
          color: fg,
          fontWeight: active ? 600 : 500,
          fontSize: 13.5,
          fontFamily: "inherit",
          cursor: "pointer",
          textAlign: "start",
          transition: TRANSITION,
        }}
        onMouseEnter={(e) => {
          if (active) e.currentTarget.style.opacity = "0.9";
          else e.currentTarget.style.background = theme.hover;
        }}
        onMouseLeave={(e) => {
          if (active) e.currentTarget.style.opacity = "1";
          else e.currentTarget.style.background = "transparent";
        }}
      >
        <span
          style={{ color: iconColor, display: "flex", transition: TRANSITION }}
        >
          <Icon name={icon} size={18} />
        </span>
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        aria-label={tr(open ? "sidebar.collapse" : "sidebar.expand", {
          name: label,
        })}
        style={{
          width: 38,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: 0,
          borderInlineStart: `1px solid ${divider}`,
          background: sectionBg,
          color: iconColor,
          cursor: "pointer",
          transition: TRANSITION,
        }}
        onMouseEnter={(e) => {
          if (active) e.currentTarget.style.opacity = "0.9";
          else e.currentTarget.style.background = theme.hover;
        }}
        onMouseLeave={(e) => {
          if (active) e.currentTarget.style.opacity = "1";
          else e.currentTarget.style.background = "transparent";
        }}
      >
        <Icon
          name="chevronR"
          size={15}
          style={{
            // Compose the RTL mirror + open-state rotation without ever emitting
            // "scaleX(-1) none" — combining a transform function with the `none`
            // keyword is invalid CSS and gets silently rejected by the browser,
            // which would leave the chevron stuck showing its previous rotation.
            transform:
              [dir === "rtl" ? "scaleX(-1)" : "", open ? "rotate(90deg)" : ""]
                .filter(Boolean)
                .join(" ") || "none",
            transition: "transform 180ms ease",
          }}
        />
      </button>
    </div>
  );
}

function SectionLabel({
  theme,
  children,
}: {
  theme: Theme;
  children: ReactNode;
}) {
  // Tracking + uppercasing are a Latin-typography convention: extra
  // letter-spacing breaks Arabic glyph joining/ligatures, and uppercase is a
  // no-op on Arabic anyway. Skip both when the UI is Arabic.
  const { locale } = useI18n();
  const isAr = locale === "ar";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "12px 12px 7px",
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: isAr ? "normal" : "0.12em",
        textTransform: isAr ? "none" : "uppercase",
        color: theme.muted,
      }}
    >
      {children}
    </div>
  );
}

function NavRow({
  theme,
  icon,
  label,
  active,
  onClick,
  dot,
  ariaLabel,
}: {
  theme: Theme;
  icon: IconProps["name"];
  label: string;
  active: boolean;
  onClick: () => void;
  /** A small attention dot at the row's end. The words are in ariaLabel;
   *  the dot only repeats them. */
  dot?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "9px 12px",
        border: 0,
        borderRadius: 10,
        background: active ? theme.ink : "transparent",
        color: active ? theme.paper : theme.ink,
        fontWeight: active ? 600 : 500,
        fontSize: 13.5,
        fontFamily: "inherit",
        cursor: "pointer",
        textAlign: "start",
        width: "100%",
        transition: TRANSITION,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = theme.hover;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        style={{
          color: active ? theme.paper : theme.muted,
          display: "flex",
          transition: TRANSITION,
        }}
      >
        <Icon name={icon} size={18} />
      </span>
      {label}
      {dot && (
        <span
          data-update-dot
          aria-hidden="true"
          style={{
            marginInlineStart: "auto",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: theme.danger,
            flex: "none",
          }}
        />
      )}
    </button>
  );
}

function MenuItem({
  theme,
  icon,
  label,
  tag,
  onClick,
}: {
  theme: Theme;
  icon: IconProps["name"];
  label: string;
  tag?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        width: "100%",
        border: 0,
        background: "transparent",
        color: theme.ink,
        font: "inherit",
        fontWeight: 500,
        fontSize: 13,
        padding: 10,
        borderRadius: 8,
        cursor: "pointer",
        textAlign: "start",
        transition: TRANSITION,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = theme.hover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ color: theme.muted, display: "flex" }}>
        <Icon name={icon} size={17} />
      </span>
      {label}
      {tag && (
        <span
          style={{
            marginInlineStart: "auto",
            fontSize: 10.5,
            color: theme.muted,
          }}
        >
          {tag}
        </span>
      )}
    </button>
  );
}
