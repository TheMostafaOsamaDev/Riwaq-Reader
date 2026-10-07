import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  useEffect,
  useState,
} from "react";
import { Icon } from "../Icon";
import {
  getState as getQueueState,
  subscribe as subscribeToQueue,
} from "../../store/downloadQueue";
import { Spinner } from "../Spinner";
import { useImportIndicator } from "../../store/importIndicator";
import { setMinimized } from "../../store/importProgress";
import type { Theme } from "../../styles/tokens";
import { useI18n } from "../../i18n/useI18n";
import { flowInput, useAndroidUpdateSelect } from "../../store/androidUpdate";
import { attentionDot } from "../../store/updateFlow";
import type { LibraryTab } from "./tabs";
import type { HomeBarStyle } from "../../types/reader";
import { useSlidingIndicator } from "../../hooks/useSlidingIndicator";
import { useReducedMotion } from "../../styles/motion";
import { ACCENT, raisedSurface, Z_LOCAL } from "../../styles/tokens";

export interface MobileBottomNavProps {
  theme: Theme;
  importing: boolean;
  tab: LibraryTab;
  shelvesActive: boolean;
  onOpenShelves: () => void;
  onSetStore: () => void;
  onOpenQueue: () => void;
  onImport: () => void;
  onOpenSettings: () => void;
  /** Which bar to draw (Settings ▸ Appearance). Classic when omitted. */
  style?: HomeBarStyle;
  /** Back to the library shelf, from the Store or Shelves. The styles that
   *  have a Library tab use it; classic toggles the Store instead. */
  onGoLibrary?: () => void;
  /** The tab on screen, when the caller knows it — the phone shell does,
   *  and Downloads and Settings are tabs there. Without it the bar works it
   *  out from `tab` and `shelvesActive`, as before. */
  current?: "library" | "store" | "downloads" | "settings";
}

/** Every style is exactly this tall. The update pill and its toasts float a
 *  fixed distance above the bar (components/update/parts.tsx), so a style
 *  that grew would put the bar under them. */
export const HOME_BAR_HEIGHT = 75;

/** The phone home screen's navigation, in the style the reader picked. */
export function MobileBottomNav(props: MobileBottomNavProps) {
  switch (props.style ?? "classic") {
    case "classic":
      return <ClassicNav {...props} />;
    case "labelled":
      return <LabelledNav {...props} />;
    case "dock":
      return <DockNav {...props} />;
    case "raised":
      return <RaisedNav {...props} />;
    case "switch":
      return <SwitchNav {...props} />;
    case "expanding":
      return <ExpandingNav {...props} />;
  }
}

function ClassicNav({
  theme,
  importing,
  tab,
  shelvesActive,
  current,
  onOpenShelves,
  onSetStore,
  onOpenQueue,
  onImport,
  onOpenSettings,
}: MobileBottomNavProps) {
  const { tr } = useI18n();
  // Read here, not passed down: the update store is app-wide, and the dot is
  // this bar's business alone.
  // Selected: the 500 ms status polls re-render the bar only if the dot
  // changes.
  const updateDot = useAndroidUpdateSelect((s) => attentionDot(flowInput(s)));
  return (
    <div
      style={{
        flexShrink: 0,
        position: "relative",
        padding: "10px 14px 14px",
        background: theme.bg,
        // Bolder top edge (theme.ruleStrong) so the bar's boundary
        // registers cleanly against the upward shadow rather than
        // bleeding into the shadow gradient.
        borderTop: `1px solid ${theme.ruleStrong}`,
        // A barely-there upward shadow: enough that the bar reads as a
        // surface over the shelf, not so much that it sits on the page like
        // a slab. It is deliberately black and faint rather than themed —
        // on light and sepia it is the only thing lifting the bar, and on
        // dark and OLED it is invisible against the background, where the
        // themed border above carries the separation on its own.
        boxShadow: "0 -1px 10px rgba(0,0,0,0.04)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        gap: 6,
      }}
    >
      <NavIconButton
        theme={theme}
        icon="layers"
        ariaLabel={tr("shelves.title")}
        active={shelvesActive && (!current || current === "library")}
        onClick={onOpenShelves}
      />
      <NavIconButton
        theme={theme}
        icon="globe"
        ariaLabel={
          tab === "store"
            ? tr("library.backToLibrary")
            : tr("library.openStore")
        }
        active={current ? current === "store" : tab === "store"}
        onClick={onSetStore}
      />
      <NavFabButton theme={theme} importing={importing} onClick={onImport} />
      <NavIconButton
        theme={theme}
        icon="download"
        ariaLabel={tr("library.openDownloads")}
        active={current === "downloads"}
        onClick={onOpenQueue}
        showQueueBadge
      />
      <NavIconButton
        theme={theme}
        icon="settings"
        ariaLabel={
          updateDot ? tr("sidebar.settingsUpdate") : tr("sidebar.settings")
        }
        active={current === "settings"}
        onClick={onOpenSettings}
        showUpdateDot={updateDot}
      />
    </div>
  );
}

export interface NavIconButtonProps {
  theme: Theme;
  icon: "globe" | "download" | "doc" | "settings" | "layers";
  ariaLabel: string;
  active?: boolean;
  disabled?: boolean;
  showQueueBadge?: boolean;
  /** A waiting update (see attentionDot). Words in the aria-label carry the
   *  meaning; the dot only repeats it. */
  showUpdateDot?: boolean;
  onClick: () => void;
}

export function NavIconButton({
  theme,
  icon,
  ariaLabel,
  active,
  disabled,
  showQueueBadge,
  showUpdateDot,
  onClick,
}: NavIconButtonProps) {
  const [activeCount, setActiveCount] = useState(() =>
    activeJobCount(getQueueState()),
  );
  useEffect(() => {
    if (!showQueueBadge) return;
    const off = subscribeToQueue((s) => setActiveCount(activeJobCount(s)));
    return off;
  }, [showQueueBadge]);
  const showBadge = !!showQueueBadge && activeCount > 0;
  const reduced = useReducedMotion();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
      // The classic style's motion: the circle that becomes selected pops.
      // The class only appears on that change, so it plays once per
      // selection; see `.riwaq-nav-pop` in global.css.
      className={active && !reduced ? "riwaq-nav-pop" : undefined}
      style={{
        position: "relative",
        width: 44,
        height: 44,
        borderRadius: 22,
        border: active ? "none" : `0.5px solid ${theme.rule}`,
        background: active ? theme.ink : "transparent",
        color: active ? theme.bg : theme.ink,
        transition: reduced
          ? "none"
          : "background 200ms ease, color 200ms ease",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Icon name={icon} size={18} />
      {showBadge && (
        <span
          style={{
            position: "absolute",
            top: -2,
            insetInlineEnd: -2,
            minWidth: 18,
            height: 18,
            padding: "0 5px",
            borderRadius: 9,
            background: theme.ink,
            color: theme.bg,
            fontSize: 10,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
            border: `2px solid ${theme.bg}`,
          }}
        >
          {activeCount > 99 ? "99+" : activeCount}
        </span>
      )}
      {showUpdateDot && (
        <span
          data-update-dot
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 1,
            insetInlineEnd: 1,
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: "#c4573a",
            // The 2px ring separates the dot from the button's own outline.
            boxShadow: `0 0 0 2px ${theme.bg}`,
          }}
        />
      )}
    </button>
  );
}

export interface NavFabButtonProps {
  theme: Theme;
  importing: boolean;
  onClick: () => void;
  /** Diameter. 50 in the classic bar; the header copy is smaller. */
  size?: number;
  /** "ink" is the classic filled button; "accent" the dock's copper one. */
  tone?: "ink" | "accent";
  /** A ring in the page colour, for a button raised out of the bar's edge. */
  ring?: boolean;
}

export function NavFabButton({
  theme,
  importing,
  onClick,
  size = 50,
  tone = "ink",
  ring = false,
}: NavFabButtonProps) {
  // The focal action — filled + slightly larger than the outlined siblings
  // (50px vs 38px) + a soft drop shadow so it reads as the primary
  // affordance. Sits flush with the bar rather than protruding above it.
  //
  // While an import runs this is the *only* progress indicator in the app,
  // so it stays tappable: a tap re-opens the stepper modal instead of the
  // file picker. `useImportIndicator` also picks up Store imports, which
  // never reach this component's `importing` prop.
  const { tr } = useI18n();
  const ind = useImportIndicator(importing);
  const details = ind.action === "details";
  const label = details
    ? tr("import.progress.openDetails")
    : ind.busy
      ? // An add's busy state is a background cover fetch, not an import —
        // reuse the Downloads copy for that instead of claiming otherwise.
        ind.reason === "add"
        ? tr("downloads.statusFetchingCover")
        : tr("sidebar.importing")
      : tr("library.importEpub");
  return (
    <button
      onClick={details ? () => setMinimized(false) : onClick}
      disabled={ind.action === "none"}
      aria-label={label}
      aria-busy={ind.busy || undefined}
      title={label}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        border: ring ? `4px solid ${theme.bg}` : "none",
        background: tone === "accent" ? ACCENT : theme.ink,
        color: tone === "accent" ? "#fff" : theme.bg,
        cursor: ind.action === "none" ? "progress" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow:
          tone === "accent"
            ? "0 8px 20px rgba(201,100,66,0.38)"
            : "0 3px 10px rgba(0,0,0,0.18)",
        // Dimmed only while it genuinely can't be pressed. A tappable
        // control at 0.6 reads as disabled.
        opacity: ind.action === "none" ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      {ind.busy ? (
        // Determinate whenever the pipeline has a real ratio — a 200 MB book
        // takes long enough that a bare spinner reads as a hang.
        <Spinner
          size={22}
          strokeWidth={2.5}
          {...(ind.ratio === null ? {} : { value: ind.ratio })}
        />
      ) : (
        <Icon name="plus" size={20} />
      )}
    </button>
  );
}

/** Badge count = work the user might want to address. That includes
 *  jobs that were interrupted by the app dying mid-flight — the
 *  Downloads page is where they Retry, so the badge should advertise
 *  it. Done / cancelled / errored without retry intent don't count. */
export function activeJobCount(s: { jobs: { status: string }[] }): number {
  let n = 0;
  for (const j of s.jobs) {
    if (
      j.status === "queued" ||
      j.status === "running" ||
      j.status === "interrupted"
    ) {
      n++;
    }
  }
  return n;
}

// ── The other styles ────────────────────────────────────────────────────────
//
// Each is HOME_BAR_HEIGHT tall, carries the same downloads count and update
// dot as the classic bar, and keeps the import button's progress state (it
// is the same NavFabButton, wherever it sits). The styles without an import
// button here put it in the header instead — see MobileLibrary.

type NavKey = "library" | "store" | "downloads" | "settings";
const NAV_ICON = {
  library: "book",
  store: "globe",
  downloads: "download",
  settings: "settings",
} as const;
const NAV_LABEL = {
  library: "sidebar.library",
  store: "sidebar.store",
  downloads: "sidebar.downloads",
  settings: "sidebar.settings",
} as const;

/** What the bar needs to know and do, the same for every style. */
function useNav(p: MobileBottomNavProps) {
  const storeActive = p.current ? p.current === "store" : p.tab === "store";
  const libraryActive = p.current
    ? p.current === "library"
    : !storeActive && !p.shelvesActive;
  const downloadsActive = p.current === "downloads";
  const settingsActive = p.current === "settings";
  const updateDot = useAndroidUpdateSelect((s) => attentionDot(flowInput(s)));
  const [queued, setQueued] = useState(() => activeJobCount(getQueueState()));
  useEffect(() => subscribeToQueue((s) => setQueued(activeJobCount(s))), []);
  const act = (k: NavKey) => {
    if (k === "library") {
      if (p.onGoLibrary) p.onGoLibrary();
      else if (storeActive) p.onSetStore();
    } else if (k === "store") {
      if (!storeActive) p.onSetStore();
    } else if (k === "downloads") p.onOpenQueue();
    else p.onOpenSettings();
  };
  const isActive = (k: NavKey) =>
    k === "library"
      ? libraryActive
      : k === "store"
        ? storeActive
        : k === "downloads"
          ? downloadsActive
          : settingsActive;
  const { tr } = useI18n();
  /** The button's accessible name; Settings says when an update waits. */
  const aria = (k: NavKey) =>
    k === "settings" && updateDot
      ? tr("sidebar.settingsUpdate")
      : tr(NAV_LABEL[k]);
  return { act, isActive, aria, updateDot, queued };
}

const barBase = (theme: Theme): CSSProperties => ({
  flexShrink: 0,
  position: "relative",
  height: HOME_BAR_HEIGHT,
  boxSizing: "border-box",
  background: theme.bg,
});

/** The downloads count, or the update dot, pinned to an icon's corner. */
function Marks({
  theme,
  k,
  queued,
  updateDot,
}: {
  theme: Theme;
  k: NavKey;
  queued: number;
  updateDot: boolean;
}) {
  if (k === "downloads" && queued > 0) {
    return (
      <span
        style={{
          position: "absolute",
          top: -7,
          insetInlineEnd: -10,
          minWidth: 17,
          height: 17,
          padding: "0 4px",
          borderRadius: 9,
          background: theme.ink,
          color: theme.bg,
          fontSize: 10,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
          border: `2px solid ${theme.bg}`,
        }}
      >
        {queued > 99 ? "99+" : queued}
      </span>
    );
  }
  if (k === "settings" && updateDot) {
    return (
      <span
        data-update-dot
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -3,
          insetInlineEnd: -3,
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: "#c4573a",
          boxShadow: `0 0 0 2px ${theme.bg}`,
        }}
      />
    );
  }
  return null;
}

/** An icon with its marks, sized for the bar. */
function NavGlyph({
  theme,
  k,
  nav,
  size = 19,
}: {
  theme: Theme;
  k: NavKey;
  nav: ReturnType<typeof useNav>;
  size?: number;
}) {
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <Icon name={NAV_ICON[k]} size={size} />
      <Marks
        theme={theme}
        k={k}
        queued={nav.queued}
        updateDot={nav.updateDot}
      />
    </span>
  );
}

/** Which item the sliding indicator sits under. */
function activeKey(nav: ReturnType<typeof useNav>): NavKey | null {
  const keys: NavKey[] = ["library", "store", "downloads", "settings"];
  return keys.find((k) => nav.isActive(k)) ?? null;
}

/** The travelling indicator: under the items, never in the way of a tap.
 *  Its colour and shape are the style's; its position is the hook's. */
function Indicator({
  slide,
  style,
}: {
  slide: ReturnType<typeof useSlidingIndicator<NavKey>>;
  style: CSSProperties;
}) {
  return (
    <div
      ref={slide.indicatorRef}
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        opacity: 0,
        pointerEvents: "none",
        zIndex: Z_LOCAL.under,
        ...style,
      }}
    />
  );
}

/** Content colour for an item, eased to match its selection arriving — the
 *  same 200ms the filter pills use. */
const inkTransition = "color 200ms ease";
/** Material's emphasized-decelerate: fast out of the gate, gentle landing. */
const EMPHASIZED = "cubic-bezier(0.05, 0.7, 0.1, 1)";

// Each style moves its selection its own way:
//   classic   — the circle pops (NavIconButton)
//   labelled  — the pill grows out of the icon's centre (Material 3)
//   dock      — the circle flows across, stretching then settling
//   raised    — the icon lifts and a dot glides under the label
//   switch    — the thumb springs across, overshooting a touch
//   expanding — the tab widens and its name unrolls

/** Four tabs with their names under the icons. The selected tab's pill grows
 *  out from the icon's centre while the old one shrinks back into its own.
 *  Import lives in the header. */
function LabelledNav(p: MobileBottomNavProps) {
  const { theme } = p;
  const nav = useNav(p);
  const reduced = useReducedMotion();
  const keys: NavKey[] = ["library", "store", "downloads", "settings"];
  return (
    <nav
      data-home-bar="labelled"
      style={{
        ...barBase(theme),
        borderTop: `1px solid ${theme.ruleStrong}`,
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        alignItems: "center",
        padding: "0 6px",
      }}
    >
      {keys.map((k) => (
        <TabWithLabel key={k} k={k} nav={nav} theme={theme}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 15,
              background: theme.hover,
              boxShadow: `inset 0 0 0 1px ${theme.rule}`,
              transform: nav.isActive(k) ? "scaleX(1)" : "scaleX(0.3)",
              opacity: nav.isActive(k) ? 1 : 0,
              transition: reduced
                ? "none"
                : `transform 300ms ${EMPHASIZED}, opacity 160ms ease`,
            }}
          />
        </TabWithLabel>
      ))}
    </nav>
  );
}

/** One line height for every tab label, so a label in a button and one in a
 *  plain column (Raised's "Add") share a baseline. */
const LABEL_LINE = "15px";

/** An icon over its name. `children` decorates the 58x30 icon slot (the
 *  labelled style's pill); `lift` raises the icon a little (raised style). */
function TabWithLabel({
  k,
  nav,
  theme,
  children,
  lift = false,
  labelRef,
}: {
  k: NavKey;
  nav: ReturnType<typeof useNav>;
  theme: Theme;
  children?: ReactNode;
  lift?: boolean;
  labelRef?: Ref<HTMLSpanElement>;
}) {
  const { tr } = useI18n();
  const reduced = useReducedMotion();
  const on = nav.isActive(k);
  return (
    <button
      type="button"
      onClick={() => nav.act(k)}
      aria-current={on ? "page" : undefined}
      aria-label={nav.aria(k)}
      style={{
        position: "relative",
        zIndex: Z_LOCAL.base,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        display: "grid",
        justifyItems: "center",
        gap: 4,
        padding: "4px 0",
        fontFamily: "inherit",
        fontSize: 11.5,
        lineHeight: LABEL_LINE,
        fontWeight: on ? 500 : 400,
        color: on ? theme.ink : theme.chromeInk,
        transition: inkTransition,
        minWidth: 0,
      }}
    >
      <span
        style={{
          position: "relative",
          width: 58,
          height: 30,
          display: "grid",
          placeItems: "center",
        }}
      >
        {children}
        <span
          style={{
            position: "relative",
            display: "inline-flex",
            transform: lift && on ? "translateY(-3px)" : "none",
            transition: reduced ? "none" : `transform 280ms ${EMPHASIZED}`,
          }}
        >
          <NavGlyph theme={theme} k={k} nav={nav} />
        </span>
      </span>
      <span
        ref={labelRef}
        style={{
          maxWidth: "100%",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {tr(NAV_LABEL[k])}
      </span>
    </button>
  );
}

/** Height of the dock pill and of the import button beside it. */
const DOCK_H = 56;
/** The dock's items, and the inset that puts them the same distance from
 *  every edge of the pill: (56 - 44) / 2 on all four sides. */
const DOCK_ITEM = 44;
const DOCK_INSET = (DOCK_H - DOCK_ITEM) / 2;

/** A pill of four icons floating over the page, with import beside it as
 *  the one coloured control on screen. The selected circle flows from item
 *  to item: it stretches out to reach the new one, then lets go of the
 *  old. */
function DockNav(p: MobileBottomNavProps) {
  const { theme } = p;
  const nav = useNav(p);
  const slide = useSlidingIndicator<NavKey>(activeKey(nav), "stretch");
  const keys: NavKey[] = ["library", "store", "downloads", "settings"];
  return (
    <nav
      data-home-bar="dock"
      style={{
        ...barBase(theme),
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 14px",
      }}
    >
      <div
        ref={slide.containerRef as Ref<HTMLDivElement>}
        style={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          height: DOCK_H,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          // space-between, not space-around: the end items sit DOCK_INSET
          // from the pill's ends, exactly as far as from its top and bottom.
          // space-around added half a gap of empty pill at each end.
          justifyContent: "space-between",
          padding: `0 ${DOCK_INSET}px`,
          borderRadius: DOCK_H / 2,
          background: theme.chrome,
          border: `0.5px solid ${theme.ruleStrong}`,
          boxShadow: "0 8px 22px rgba(0,0,0,0.12)",
        }}
      >
        <Indicator
          slide={slide}
          style={{ borderRadius: DOCK_ITEM / 2, background: theme.ink }}
        />
        {keys.map((k) => {
          const on = nav.isActive(k);
          return (
            <button
              key={k}
              ref={slide.register(k)}
              type="button"
              onClick={() => nav.act(k)}
              aria-current={on ? "page" : undefined}
              aria-label={nav.aria(k)}
              title={nav.aria(k)}
              style={{
                position: "relative",
                zIndex: Z_LOCAL.base,
                width: DOCK_ITEM,
                height: DOCK_ITEM,
                borderRadius: DOCK_ITEM / 2,
                border: "none",
                background: "transparent",
                color: on ? theme.bg : theme.chromeInk,
                transition: inkTransition,
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              <NavGlyph theme={theme} k={k} nav={nav} size={18} />
            </button>
          );
        })}
      </div>
      <NavFabButton
        theme={theme}
        importing={p.importing}
        onClick={p.onImport}
        size={DOCK_H}
        tone="accent"
      />
    </nav>
  );
}

/** The classic layout with names, and Add raised out of the middle. The
 *  selected tab's icon lifts and a small dot glides along under the labels
 *  to it. */
function RaisedNav(p: MobileBottomNavProps) {
  const { theme } = p;
  const { tr } = useI18n();
  const nav = useNav(p);
  const slide = useSlidingIndicator<NavKey>(activeKey(nav));
  const tab = (k: NavKey) => (
    <TabWithLabel k={k} nav={nav} theme={theme} lift>
      {/* The dot's anchor: a 4px box centred under the icon slot, which the
          indicator measures. */}
      <span
        ref={slide.register(k)}
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          bottom: -27,
          width: 4,
          height: 4,
          marginLeft: -2,
        }}
      />
    </TabWithLabel>
  );
  return (
    <nav
      ref={slide.containerRef}
      data-home-bar="raised"
      style={{
        ...barBase(theme),
        borderTop: `1px solid ${theme.ruleStrong}`,
        display: "grid",
        gridTemplateColumns: "1fr 1fr 72px 1fr 1fr",
        alignItems: "center",
        padding: "0 4px",
      }}
    >
      <Indicator
        slide={slide}
        style={{ borderRadius: 2, background: theme.ink }}
      />
      {tab("library")}
      {tab("store")}
      {/* Laid out exactly like TabWithLabel — 4px, a 30px slot, a 4px gap,
          the label, 4px — so "Add" shares the other labels' baseline. The
          button hangs from the slot. */}
      <span
        style={{
          position: "relative",
          zIndex: Z_LOCAL.base,
          display: "grid",
          justifyItems: "center",
          gap: 4,
          padding: "4px 0",
          fontSize: 11.5,
          lineHeight: LABEL_LINE,
          color: theme.chromeInk,
        }}
      >
        <span style={{ height: 30 }} />
        {/* Out of the bar's top edge by only 14px: the update pill floats
            centred 20px above the bar (update/parts.tsx), and a button
            raised further would run into it. The bar's top edge sits 8px
            above this column (75px bar, 59px column, centred). */}
        <span
          style={{
            position: "absolute",
            top: -14 - 8,
            left: "50%",
            transform: "translateX(-50%)",
          }}
        >
          <NavFabButton
            theme={theme}
            importing={p.importing}
            onClick={p.onImport}
            size={54}
            ring
          />
        </span>
        <span aria-hidden>{tr("library.nav.add")}</span>
      </span>
      {tab("downloads")}
      {tab("settings")}
    </nav>
  );
}

/** Your books or books to get: one big two-way switch, with Downloads and
 *  Settings either side. The thumb springs across like a physical switch.
 *  Import lives in the header. */
function SwitchNav(p: MobileBottomNavProps) {
  const { theme } = p;
  const { tr } = useI18n();
  const nav = useNav(p);
  const slide = useSlidingIndicator<NavKey>(activeKey(nav), "spring");
  const side = (k: NavKey) => (
    <button
      type="button"
      onClick={() => nav.act(k)}
      aria-label={nav.aria(k)}
      title={nav.aria(k)}
      style={{
        width: 46,
        height: 46,
        borderRadius: 23,
        flexShrink: 0,
        border: `0.5px solid ${theme.ruleStrong}`,
        background: "transparent",
        color: theme.ink,
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
      }}
    >
      <NavGlyph theme={theme} k={k} nav={nav} size={18} />
    </button>
  );
  return (
    <nav
      data-home-bar="switch"
      style={{
        ...barBase(theme),
        borderTop: `1px solid ${theme.ruleStrong}`,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 14px",
      }}
    >
      {side("downloads")}
      <div
        ref={slide.containerRef as Ref<HTMLDivElement>}
        style={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          padding: 4,
          borderRadius: 26,
          background: theme.hover,
          border: `0.5px solid ${theme.rule}`,
        }}
      >
        <Indicator
          slide={slide}
          style={{
            borderRadius: 22,
            background: raisedSurface(theme),
            boxShadow: "0 1px 4px rgba(0,0,0,0.14)",
          }}
        />
        {(["library", "store"] as const).map((k) => {
          const on = nav.isActive(k);
          return (
            <button
              key={k}
              ref={slide.register(k)}
              type="button"
              onClick={() => nav.act(k)}
              aria-current={on ? "page" : undefined}
              style={{
                position: "relative",
                zIndex: Z_LOCAL.base,
                height: 42,
                border: "none",
                borderRadius: 22,
                background: "transparent",
                color: on ? theme.ink : theme.chromeInk,
                transition: inkTransition,
                fontFamily: "inherit",
                fontSize: 13.5,
                fontWeight: on ? 500 : 400,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                minWidth: 0,
              }}
            >
              <Icon name={NAV_ICON[k]} size={17} />
              <span
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {tr(NAV_LABEL[k])}
              </span>
            </button>
          );
        })}
      </div>
      {side("settings")}
    </nav>
  );
}

/** How wide a name may unroll to in the expanding style. Generous for the
 *  longest label in either language ("Downloads", "التنزيلات"). */
const EXPAND_LABEL_MAX = 110;

/** Icons, except the screen you are on: its tab widens into a filled pill
 *  and its name unrolls beside the icon, while the tab it left narrows back
 *  to an icon. Both tabs animate at once, so the bar trades width between
 *  them. Import lives in the header. */
function ExpandingNav(p: MobileBottomNavProps) {
  const { theme } = p;
  const { tr } = useI18n();
  const nav = useNav(p);
  const reduced = useReducedMotion();
  const keys: NavKey[] = ["library", "store", "downloads", "settings"];
  const t = (props: string, ms: number) =>
    reduced
      ? "none"
      : props
          .split(",")
          .map((x) => `${x.trim()} ${ms}ms ${EMPHASIZED}`)
          .join(", ");
  return (
    <nav
      data-home-bar="expanding"
      style={{
        ...barBase(theme),
        borderTop: `1px solid ${theme.ruleStrong}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
      }}
    >
      {keys.map((k) => {
        const on = nav.isActive(k);
        return (
          <button
            key={k}
            type="button"
            onClick={() => nav.act(k)}
            aria-current={on ? "page" : undefined}
            aria-label={nav.aria(k)}
            style={{
              height: 46,
              minWidth: 46,
              padding: on ? "0 18px 0 16px" : "0 13px",
              borderRadius: 23,
              border: "none",
              background: on ? theme.ink : "transparent",
              color: on ? theme.bg : theme.chromeInk,
              transition: t("padding, background-color, color", 320),
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "inherit",
              fontSize: 13.5,
              fontWeight: 500,
            }}
          >
            <NavGlyph theme={theme} k={k} nav={nav} size={18} />
            {/* Always rendered, clipped to nothing when not selected: the name
                unrolls by widening its box, never by mounting — a mount
                animation is what a webview can skip or freeze. */}
            <span
              aria-hidden={!on}
              style={{
                display: "inline-block",
                overflow: "hidden",
                whiteSpace: "nowrap",
                maxWidth: on ? EXPAND_LABEL_MAX : 0,
                marginInlineStart: on ? 8 : 0,
                opacity: on ? 1 : 0,
                transition: t("max-width, margin, opacity", 320),
              }}
            >
              {tr(NAV_LABEL[k])}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
