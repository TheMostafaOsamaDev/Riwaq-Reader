// Desktop library navigation as a left sidebar (رواق rebrand).
//
// Calm and warm: phoenix + رواق wordmark, a search *button* that opens the
// full-screen search, a "Main" nav with collapsible parents — Library (tree:
// Reading/Finished/Wishlist) and Shelves (user collections; UI only for now,
// the real feature lands on its own branch) — plus Store and a Downloads row
// with a live badge + in-place progress. Settings and a primary Import
// split-button are pinned to the bottom. Mobile keeps its bottom nav.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { Spinner } from "./Spinner";
import type { IconProps } from "./Icon";
import { FONT_SERIF_DISPLAY, FONT_STACKS, type Theme, type ThemeKey } from "../styles/tokens";
import { getState, subscribe } from "../store/downloadQueue";
import {
  getDownloadProgress,
  subscribeDownloadProgress,
} from "../store/downloadProgress";
import { useNav, back, forward } from "../store/navigation";
import { useImportIndicator } from "../store/importIndicator";
import { setMinimized } from "../store/importProgress";
import type { Shelf } from "../store/shelves";
import type { LibraryTab } from "./Library";
import { useI18n } from "../i18n/useI18n";
import type { Dir, MsgKey, Tr } from "../i18n";

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

const TRANSITION = "background-color 150ms ease, color 150ms ease, opacity 150ms ease, transform 150ms ease";

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
  const markSrc = dark ? "/brand/mark-cream.png" : "/brand/mark-ink.png";
  const dl = useDownloadSummary();
  // Reads the shared import store, so a Store import shows here too and a
  // click during a run re-opens the stepper instead of the file picker.
  const ind = useImportIndicator(importing);

  const [openLib, setOpenLib] = useState(true);
  const [openShelves, setOpenShelves] = useState(true);

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
    <aside
      style={{
        width: 252,
        flexShrink: 0,
        background: theme.chrome,
        border: `1.5px solid ${theme.rule}`,
        borderRadius: 16,
        margin: 12,
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT_STACKS.sans,
        padding: "16px 12px 14px",
        boxSizing: "border-box",
      }}
    >
      {/* Head — brand mark + wordmark, with the history back/forward pair
          pinned to the inline-end (the desktop equivalent of the Android
          hardware back). */}
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "4px 8px 16px" }}>
        <img src={markSrc} alt="" width={34} height={34} draggable={false} style={{ width: 34, height: 34, objectFit: "contain", flexShrink: 0 }} />
        <span style={{ fontFamily: FONT_SERIF_DISPLAY, fontWeight: 500, fontSize: 21, color: theme.ink, lineHeight: 1.1, letterSpacing: dir === "rtl" ? "normal" : "-0.01em" }}>{dir === "rtl" ? "رواق" : "Riwaq"}</span>
        <NavArrows theme={theme} />
      </div>

      {/* Search — opens the full-screen search */}
      <button
        onClick={onOpenSearch}
        style={{
          display: "flex", alignItems: "center", gap: 9, width: "calc(100% - 8px)", margin: "0 4px 12px",
          background: theme.bg, border: `1px solid ${theme.rule}`, borderRadius: 11, padding: "9px 11px",
          cursor: "pointer", font: "inherit", color: theme.muted, textAlign: "start", transition: TRANSITION,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = theme.chromeHover)}
        onMouseLeave={(e) => (e.currentTarget.style.background = theme.bg)}
      >
        <Icon name="search" size={16} />
        <span style={{ flex: 1, fontSize: 13 }}>{tr("sidebar.searchLibrary")}</span>
        <span style={{ fontSize: 10.5, color: theme.muted, border: `1px solid ${theme.rule}`, borderRadius: 5, padding: "2px 6px", fontWeight: 600, lineHeight: 1 }}>⌘K</span>
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
          `leaflet-scroll-hidden` (wheel/trackpad scrolling still works) and
          keep the container full-width. */}
      <div className="leaflet-scroll-hidden" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        <SectionLabel theme={theme}>{tr("sidebar.main")}</SectionLabel>
        <nav style={{ display: "flex", flexDirection: "column", gap: 5, padding: "0 4px" }}>
          {/* Library (collapsible) — row + tree grouped so the nav gap stays uniform */}
          <div>
            <CollapsibleRow theme={theme} dark={dark} icon="grid" label={tr("sidebar.library")} active={shelfActive && tab === "all"} open={openLib} onActivate={() => setTab("all")} setOpen={setOpenLib} dir={dir} tr={tr} />
            <Collapse open={openLib}>
              <Tree theme={theme}>
                {TREE_KEYS.map((t) => (
                  <TreeButton key={t.key} theme={theme} label={tr(t.k)} active={shelfActive && tab === t.key} onClick={() => setTab(t.key)} />
                ))}
              </Tree>
            </Collapse>
          </div>

          {/* Shelves (collapsible) — row + tree grouped so the nav gap stays uniform */}
          <div>
            <CollapsibleRow theme={theme} dark={dark} icon="layers" label={tr("sidebar.shelves")} active={shelvesActive || activeShelfId !== undefined} open={openShelves} onActivate={onOpenShelves} setOpen={setOpenShelves} dir={dir} tr={tr} />
            <Collapse open={openShelves}>
              <Tree theme={theme}>
                {shelves.map((s) => (
                  <TreeButton key={s.id} theme={theme} label={s.name} active={activeShelfId === s.id} onClick={() => onOpenShelf(s.id)} />
                ))}
                <button
                  onClick={onNewShelf}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "start", border: 0, background: "transparent", color: theme.muted, font: "inherit", fontSize: 13, fontWeight: 500, padding: "8px 12px", borderRadius: 9, cursor: "pointer", transition: TRANSITION }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = theme.hover)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Icon name="plus" size={14} /> {tr("sidebar.newShelf")}
                </button>
              </Tree>
            </Collapse>
          </div>

          <NavRow theme={theme} icon="globe" label={tr("sidebar.store")} active={tab === "store"} onClick={() => setTab("store")} />

          {/* Downloads — constant height, progress fills inside */}
          <button
            onClick={onOpenQueue}
            title={tr("sidebar.downloads")}
            style={{
              position: "relative", overflow: "hidden", height: 38, display: "flex", alignItems: "center", gap: 11,
              padding: "0 12px", border: 0, borderRadius: 10, background: "transparent", color: theme.ink, font: "inherit",
              fontSize: 13.5, fontWeight: 500, cursor: "pointer", transition: TRANSITION,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = theme.hover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <span style={{ position: "absolute", insetInlineStart: 0, top: 0, bottom: 0, width: dl.active ? `${Math.max(6, dl.pct)}%` : 0, background: goldSoft, borderRadius: 10, transition: "width .35s ease", zIndex: 0 }} />
            <span style={{ position: "relative", zIndex: 1, color: theme.muted, display: "flex" }}><Icon name="download" size={18} /></span>
            <span style={{ position: "relative", zIndex: 1 }}>{tr("sidebar.downloads")}</span>
            {dl.active ? (
              <span
                role="progressbar"
                aria-valuenow={dl.pct}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{ position: "relative", zIndex: 1, marginInlineStart: "auto", fontSize: 11.5, fontWeight: 600, color: theme.ink, fontVariantNumeric: "tabular-nums" }}
              >{dl.pct}%</span>
            ) : dl.count > 0 ? (
              <span style={{ position: "relative", zIndex: 1, marginInlineStart: "auto", minWidth: 20, height: 20, padding: "0 6px", borderRadius: 10, background: goldSoft, color: gold, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{dl.count}</span>
            ) : null}
          </button>

          <NavRow theme={theme} icon="settings" label={tr("sidebar.settings")} active={false} onClick={onOpenSettings} />
        </nav>
      </div>

      {/* Bottom: primary Import */}
      <div style={{ padding: "10px 4px 0" }}>
        <div ref={importRef} style={{ position: "relative" }}>
          <div style={{ display: "flex" }}>
            <button
              onClick={ind.action === "details" ? () => setMinimized(false) : onImport}
              disabled={ind.action === "none"}
              aria-busy={ind.busy || undefined}
              {...(ind.action === "details"
                ? { title: tr("import.progress.openDetails") }
                : {})}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: 40, border: 0,
                borderInlineEnd: `1px solid ${dark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.18)"}`,
                borderStartStartRadius: 11, borderEndStartRadius: 11, borderStartEndRadius: 0, borderEndEndRadius: 0,
                background: theme.ink, color: theme.paper, font: "inherit", fontSize: 13.5, fontWeight: 600,
                // "progress", not "default": the action is under way, not unavailable.
                cursor: ind.action === "none" ? "progress" : "pointer",
                // Dimmed only while it genuinely can't be pressed — once a run
                // is reporting, a click opens the stepper.
                opacity: ind.action === "none" ? 0.6 : 1, transition: TRANSITION,
              }}
              onMouseEnter={(e) => { if (!ind.busy) e.currentTarget.style.opacity = "0.9"; }}
              onMouseLeave={(e) => { if (!ind.busy) e.currentTarget.style.opacity = "1"; }}
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
              {ind.busy ? tr("sidebar.importing") : tr("sidebar.importBook")}
            </button>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={tr("sidebar.moreImport")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", width: 38, height: 40, border: 0,
                borderStartStartRadius: 0, borderEndStartRadius: 0, borderStartEndRadius: 11, borderEndEndRadius: 11,
                background: theme.ink, color: theme.paper, cursor: "pointer", transition: TRANSITION,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <Icon name="chevronD" size={15} style={{ transform: menuOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
            </button>
          </div>
          {menuOpen && (
            <div style={{ position: "absolute", left: 0, right: 0, bottom: "calc(100% + 6px)", background: theme.paper, border: `1px solid ${theme.rule}`, borderRadius: 12, boxShadow: "0 16px 36px rgba(0,0,0,0.18)", padding: 6, zIndex: 20 }}>
              <MenuItem theme={theme} icon="folder" label={tr("sidebar.folderOfBooks")} onClick={() => { setMenuOpen(false); onImportFolder(); }} />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

/** Smoothly expand/collapse a group by animating its measured height. */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    if (ref.current) setH(ref.current.scrollHeight);
  });
  return (
    <div style={{ flexShrink: 0, minHeight: 0, overflow: "hidden", maxHeight: open ? h : 0, opacity: open ? 1 : 0, transition: "max-height 220ms ease, opacity 180ms ease" }}>
      <div ref={ref}>{children}</div>
    </div>
  );
}

function Tree({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <div style={{ position: "relative", marginBlockStart: 4, marginInlineStart: 22, paddingInlineStart: 14 }}>
      <span style={{ position: "absolute", insetInlineStart: 0, top: 2, bottom: 14, width: 1, background: theme.rule }} />
      {children}
    </div>
  );
}

function TreeButton({ theme, label, active, onClick }: { theme: Theme; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative", display: "block", width: "100%", textAlign: "start", border: 0,
        background: active ? theme.ink : "transparent", color: active ? theme.paper : theme.muted, fontWeight: active ? 600 : 500,
        fontSize: 13, fontFamily: "inherit", padding: "8px 12px", borderRadius: 9, cursor: "pointer", transition: TRANSITION,
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = theme.hover; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ position: "absolute", insetInlineStart: -14, top: "50%", width: 10, height: 1, background: theme.rule }} />
      {label}
    </button>
  );
}

function CollapsibleRow({
  theme, dark, icon, label, active, open, onActivate, setOpen, dir, tr,
}: {
  theme: Theme; dark: boolean; icon: IconProps["name"]; label: string; active: boolean; open: boolean;
  onActivate: () => void; setOpen: (v: boolean) => void; dir: Dir; tr: Tr;
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
  const divider = active ? (dark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.18)") : theme.rule;
  const fg = active ? theme.paper : theme.ink;
  const iconColor = active ? theme.paper : theme.muted;
  return (
    <div style={{ display: "flex", alignItems: "stretch", borderRadius: 10, overflow: "hidden", transition: TRANSITION }}>
      <button
        onClick={(e) => {
          const isDouble = e.timeStamp - lastClickAt.current < 400;
          lastClickAt.current = e.timeStamp;
          if (isDouble) { setOpen(!gestureOpen.current); return; }
          gestureOpen.current = open;
          onActivate();
          setOpen(true);
        }}
        title={tr(open ? "sidebar.doubleClickCollapse" : "sidebar.doubleClickExpand")}
        style={{
          flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", border: 0,
          background: sectionBg, color: fg, fontWeight: active ? 600 : 500, fontSize: 13.5, fontFamily: "inherit",
          cursor: "pointer", textAlign: "start", userSelect: "none", WebkitUserSelect: "none", transition: TRANSITION,
        }}
        onMouseEnter={(e) => { if (active) e.currentTarget.style.opacity = "0.9"; else e.currentTarget.style.background = theme.hover; }}
        onMouseLeave={(e) => { if (active) e.currentTarget.style.opacity = "1"; else e.currentTarget.style.background = "transparent"; }}
      >
        <span style={{ color: iconColor, display: "flex", transition: TRANSITION }}><Icon name={icon} size={18} /></span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        aria-label={tr(open ? "sidebar.collapse" : "sidebar.expand", { name: label })}
        style={{
          width: 38, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: 0,
          borderInlineStart: `1px solid ${divider}`, background: sectionBg, color: iconColor, cursor: "pointer", transition: TRANSITION,
        }}
        onMouseEnter={(e) => { if (active) e.currentTarget.style.opacity = "0.9"; else e.currentTarget.style.background = theme.hover; }}
        onMouseLeave={(e) => { if (active) e.currentTarget.style.opacity = "1"; else e.currentTarget.style.background = "transparent"; }}
      >
        <Icon
          name="chevronR"
          size={15}
          style={{
            // Compose the RTL mirror + open-state rotation without ever emitting
            // "scaleX(-1) none" — combining a transform function with the `none`
            // keyword is invalid CSS and gets silently rejected by the browser,
            // which would leave the chevron stuck showing its previous rotation.
            transform: [dir === "rtl" ? "scaleX(-1)" : "", open ? "rotate(90deg)" : ""].filter(Boolean).join(" ") || "none",
            transition: "transform 180ms ease",
          }}
        />
      </button>
    </div>
  );
}

function SectionLabel({ theme, children }: { theme: Theme; children: ReactNode }) {
  // Tracking + uppercasing are a Latin-typography convention: extra
  // letter-spacing breaks Arabic glyph joining/ligatures, and uppercase is a
  // no-op on Arabic anyway. Skip both when the UI is Arabic.
  const { locale } = useI18n();
  const isAr = locale === "ar";
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "12px 12px 7px", fontSize: 10.5, fontWeight: 600, letterSpacing: isAr ? "normal" : "0.12em", textTransform: isAr ? "none" : "uppercase", color: theme.muted }}>
      {children}
    </div>
  );
}

function NavRow({ theme, icon, label, active, onClick }: { theme: Theme; icon: IconProps["name"]; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative", display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", border: 0, borderRadius: 10,
        background: active ? theme.ink : "transparent", color: active ? theme.paper : theme.ink, fontWeight: active ? 600 : 500, fontSize: 13.5,
        fontFamily: "inherit", cursor: "pointer", textAlign: "start", width: "100%", transition: TRANSITION,
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = theme.hover; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ color: active ? theme.paper : theme.muted, display: "flex", transition: TRANSITION }}><Icon name={icon} size={18} /></span>
      {label}
    </button>
  );
}

/** History back/forward pair for the desktop chrome. Buttons disable when
 *  there's nowhere to go in that direction; the arrows mirror in RTL so
 *  "back" always points toward the reading-start edge. Keyboard (Alt+←/→)
 *  and mouse side-buttons drive the same nav store from anywhere. */
function NavArrows({ theme }: { theme: Theme }) {
  const { tr } = useI18n();
  const { canBack, canForward } = useNav();
  const arrow = (
    kind: "back" | "forward",
    enabled: boolean,
    onClick: () => void,
  ) => (
    <button
      onClick={enabled ? onClick : undefined}
      disabled={!enabled}
      aria-label={tr(kind === "back" ? "nav.back" : "nav.forward")}
      title={tr(kind === "back" ? "nav.back" : "nav.forward")}
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        flexShrink: 0,
        border: `1px solid ${theme.rule}`,
        background: "transparent",
        color: theme.ink,
        cursor: enabled ? "pointer" : "default",
        opacity: enabled ? 1 : 0.38,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: TRANSITION,
      }}
      onMouseEnter={(e) => {
        if (enabled) e.currentTarget.style.background = theme.hover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon
        name={kind === "back" ? "arrowL" : "arrowR"}
        size={15}
        className="rtl-flip-x"
      />
    </button>
  );
  return (
    <div style={{ display: "flex", gap: 5, marginInlineStart: "auto" }}>
      {arrow("back", canBack, back)}
      {arrow("forward", canForward, forward)}
    </div>
  );
}

function MenuItem({ theme, icon, label, tag, onClick }: { theme: Theme; icon: IconProps["name"]; label: string; tag?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", border: 0, background: "transparent", color: theme.ink, font: "inherit", fontWeight: 500, fontSize: 13, padding: 10, borderRadius: 8, cursor: "pointer", textAlign: "start", transition: TRANSITION }}
      onMouseEnter={(e) => (e.currentTarget.style.background = theme.hover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span style={{ color: theme.muted, display: "flex" }}><Icon name={icon} size={17} /></span>
      {label}
      {tag && <span style={{ marginInlineStart: "auto", fontSize: 10.5, color: theme.muted }}>{tag}</span>}
    </button>
  );
}
