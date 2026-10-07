// The phone reader's bottom bar, in whichever style the reader picked in
// Settings ▸ Appearance (Tweaks.readerBar). Shared by the EPUB reader and the
// fixed-page (PDF/DOCX) reader, so the two formats always look alike.
//
// The reader owns everything that differs by format and passes it in: the
// slider (chapters or pages), the words that say where you are, and how the
// bar is positioned and hidden. This file owns only the arrangement.
//
// Two families:
//   - Full-width glass bars (classic, labelled, status, slider): the bar is
//     one surface along the bottom edge, as before.
//   - Floating (capsule, corners): the bar is transparent and the controls
//     float on their own glass, so the page shows around them. Every glass
//     surface is a pan zone — a swipe that starts on one scrolls the page,
//     exactly as on the full-width bar (see reader/scroll/touchPan.ts).

import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
  useState,
} from "react";
import { Icon } from "../../components/Icon";
import { useI18n } from "../../i18n/useI18n";
import type { Theme } from "../../styles/tokens";
import type { ReaderBarStyle } from "../../types/reader";
import { glassBar, glassPill } from "./glass";
import { PANEL_ARIA, PANEL_ICON, PANEL_LABEL, panelsOnBar } from "./barStyles";
import { useScrubGesture } from "./useScrubGesture";
import { clamp01 } from "../../components/readerProgress";
import { type ReaderPanel, ReaderTabBar, readerTabStyle } from "./ReaderTabBar";

/** Where the reader is, in words the bar can show. */
export interface BarPlace {
  /** 0..1 through the book (chapters or pages), the slider's own value. */
  fraction: number;
  /** The chapter title, or the book's for a fixed-page document. */
  title: string;
  /** "Chapter 12 of 48", or "Page 4 of 120". */
  position: string;
  /** "34%". */
  percent: string;
  /** A short extra, such as "8 min left". The status style shows it. */
  detail?: string;
}

/** Drag-to-seek for the status style's thin line. */
export interface BarSeek {
  rtl: boolean;
  /** What a position would be, shown while dragging. */
  formatLabel: (fraction: number) => string;
  onSeek: (fraction: number) => void;
  ariaLabel: string;
}

interface Props {
  theme: Theme;
  style: ReaderBarStyle;
  /** The reader's ReaderProgressBar. */
  slider: ReactNode;
  place: BarPlace;
  seek: BarSeek;
  active: ReaderPanel | null;
  onOpen: (panel: ReaderPanel) => void;
  /** Classic only: its slider can be shown and hidden from the tab row. */
  showProgress: boolean;
  onToggleProgress: () => void;
  /** Position, show/hide transform and pointer events, from the reader. */
  frame: CSSProperties;
  /** The bar is away. Closes the capsule's slider so it does not reappear
   *  open the next time the bar comes up. */
  hidden: boolean;
  /** The bar's outer element, for a reader that has to keep its page clear
   *  of it (the fixed-page reader fits whole pages between the bars). The
   *  floating styles' slider card is NOT part of that box: it opens over the
   *  page instead of pushing it, so a fitted page never re-fits under it. */
  rootRef?: Ref<HTMLDivElement>;
}

/** Space under the controls for Android's gesture pill. */
const SAFE_BOTTOM = "var(--safe-bottom)";

export function ReaderBottomBar(props: Props) {
  const { style } = props;
  if (style === "capsule" || style === "corners")
    return <FloatingBar {...props} />;
  return <SolidBar {...props} />;
}

// ── Full-width bars ─────────────────────────────────────────────────────────

function SolidBar({
  theme,
  style,
  slider,
  place,
  seek,
  active,
  onOpen,
  showProgress,
  onToggleProgress,
  frame,
  hidden,
  rootRef,
}: Props) {
  const glass = glassBar(theme, "bottom");
  const padding =
    style === "status"
      ? `0 0 calc(${SAFE_BOTTOM} + 10px)`
      : style === "slider"
        ? `10px 16px calc(${SAFE_BOTTOM} + 14px)`
        : style === "labelled"
          ? `10px 12px calc(${SAFE_BOTTOM} + 12px)`
          : `14px 20px calc(${SAFE_BOTTOM} + 16px)`;
  return (
    <div
      ref={rootRef}
      className={glass.className}
      aria-hidden={hidden}
      data-reader-bar={style}
      // Right where a thumb starts an upward flick — see the top bar.
      data-pan-zone
      style={{
        ...frame,
        ...glass.style,
        padding,
        color: theme.chromeInk,
      }}
    >
      {style === "classic" && (
        <>
          {showProgress && slider}
          <ReaderTabBar
            theme={theme}
            active={active}
            onOpen={onOpen}
            showProgress={showProgress}
            onToggleProgress={onToggleProgress}
          />
        </>
      )}
      {style === "labelled" && (
        <>
          <PlaceLine theme={theme} place={place} />
          {slider}
          <LabelledTabs theme={theme} active={active} onOpen={onOpen} />
        </>
      )}
      {style === "status" && (
        <>
          <SeekLine theme={theme} fraction={place.fraction} seek={seek} />
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              padding: "6px 20px 2px",
              fontSize: 12,
              color: theme.muted,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 0,
                color: theme.ink,
                fontSize: 13,
                fontWeight: 500,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {place.title || place.position}
            </span>
            <span style={{ flexShrink: 0 }}>
              {place.detail ?? place.position}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              padding: "2px 10px 0",
            }}
          >
            {panelsOnBar("status")
              .filter((p) => p !== "settings")
              .map((p) => (
                <PanelIconButton
                  key={p}
                  theme={theme}
                  panel={p}
                  active={active === p}
                  onOpen={onOpen}
                />
              ))}
            <span style={{ flex: 1 }} />
            <TextSettingsPill
              theme={theme}
              active={active === "settings"}
              onOpen={onOpen}
            />
          </div>
        </>
      )}
      {style === "slider" && (
        <>
          <div
            style={{
              width: "max-content",
              maxWidth: "100%",
              margin: "0 auto 4px",
              padding: "4px 12px",
              borderRadius: 999,
              background: theme.hover,
              color: theme.ink,
              fontSize: 12,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {place.position} · {place.percent}
          </div>
          {slider}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 6,
            }}
          >
            <LabelledButton
              theme={theme}
              panel="toc"
              active={active === "toc"}
              onOpen={onOpen}
            />
            <LabelledButton
              theme={theme}
              panel="settings"
              active={active === "settings"}
              onOpen={onOpen}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── Floating bars ───────────────────────────────────────────────────────────

function FloatingBar({
  theme,
  style,
  slider,
  place,
  active,
  onOpen,
  frame,
  hidden,
  rootRef,
}: Props) {
  const { tr } = useI18n();
  // Both floating styles keep the slider folded away; tapping where you are
  // brings it up above the controls.
  const [sliderOpen, setSliderOpen] = useState(false);
  useEffect(() => {
    if (hidden) setSliderOpen(false);
  }, [hidden]);

  const surface = glassPill(theme);
  /** The bar is up and its controls take taps; the strip itself never does. */
  const live = frame.pointerEvents !== "none";
  const placeLabel = tr("reader.bar.showSlider");

  return (
    <div
      ref={rootRef}
      aria-hidden={hidden}
      data-reader-bar={style}
      style={{
        ...frame,
        // The strip itself is see-through and lets taps reach the page; only
        // the controls on it are solid.
        background: "transparent",
        padding: `0 16px calc(${SAFE_BOTTOM} + ${style === "corners" ? 18 : 22}px)`,
        color: theme.chromeInk,
        pointerEvents: "none",
      }}
    >
      {style === "corners" && (
        // How far through the book, as a hairline along the very bottom
        // edge — the one piece of progress this style keeps on screen.
        <ThinTrack
          theme={theme}
          fraction={place.fraction}
          height={2}
          style={{ position: "absolute", insetInline: 0, bottom: 0 }}
        />
      )}
      <div style={{ position: "relative" }}>
        {sliderOpen && (
          <div
            data-pan-zone
            className={surface.className}
            style={{
              ...surface.style,
              position: "absolute",
              left: 0,
              right: 0,
              bottom: "calc(100% + 10px)",
              borderRadius: 20,
              padding: "10px 6px 4px",
              pointerEvents: live ? "auto" : "none",
            }}
          >
            {slider}
          </div>
        )}
        {style === "capsule" ? (
          <div
            data-pan-zone
            className={surface.className}
            style={{
              ...surface.style,
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: 5,
              borderRadius: 28,
              pointerEvents: live ? "auto" : "none",
            }}
          >
            <PanelIconButton
              theme={theme}
              panel="toc"
              active={active === "toc"}
              onOpen={onOpen}
              round
            />
            <button
              type="button"
              onClick={() => setSliderOpen((o) => !o)}
              aria-expanded={sliderOpen}
              aria-label={`${placeLabel}: ${place.position}, ${place.percent}`}
              style={{
                flex: 1,
                minWidth: 0,
                height: 44,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                display: "grid",
                alignContent: "center",
                gap: 6,
                padding: "0 6px",
                fontFamily: "inherit",
                color: theme.ink,
              }}
            >
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {place.title
                  ? `${place.position} · ${place.title}`
                  : place.position}
              </span>
              <ThinTrack theme={theme} fraction={place.fraction} />
            </button>
            <PanelIconButton
              theme={theme}
              panel="settings"
              active={active === "settings"}
              onOpen={onOpen}
              round
            />
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <CornerButton
              theme={theme}
              panel="toc"
              active={active === "toc"}
              onOpen={onOpen}
              hidden={!live}
            />
            <button
              type="button"
              data-pan-zone
              className={surface.className}
              onClick={() => setSliderOpen((o) => !o)}
              aria-expanded={sliderOpen}
              aria-label={`${placeLabel}: ${place.position}, ${place.percent}`}
              style={{
                ...surface.style,
                minWidth: 0,
                padding: "6px 16px",
                borderRadius: 20,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "center",
                lineHeight: 1.35,
                fontVariantNumeric: "tabular-nums",
                pointerEvents: live ? "auto" : "none",
              }}
            >
              <span
                style={{
                  display: "block",
                  fontSize: 15,
                  fontWeight: 500,
                  color: theme.ink,
                }}
              >
                {place.percent}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 11.5,
                  color: theme.muted,
                  whiteSpace: "nowrap",
                }}
              >
                {place.position}
              </span>
            </button>
            <CornerButton
              theme={theme}
              panel="settings"
              active={active === "settings"}
              onOpen={onOpen}
              hidden={!live}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function PanelIconButton({
  theme,
  panel,
  active,
  onOpen,
  round = false,
}: {
  theme: Theme;
  panel: ReaderPanel;
  active: boolean;
  onOpen: (p: ReaderPanel) => void;
  round?: boolean;
}) {
  const { tr } = useI18n();
  return (
    <button
      type="button"
      onClick={() => onOpen(panel)}
      aria-label={tr(PANEL_ARIA[panel])}
      aria-pressed={active}
      style={{
        ...readerTabStyle(theme, active),
        flexShrink: 0,
        borderRadius: round ? 22 : 10,
      }}
    >
      <Icon name={PANEL_ICON[panel]} size={18} />
    </button>
  );
}

/** "Chapter 12 of 48 · 34%" above the labelled bar's slider. */
function PlaceLine({ theme, place }: { theme: Theme; place: BarPlace }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "0 10px 2px",
        fontSize: 11.5,
        color: theme.muted,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span
        style={{
          minWidth: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {place.position}
      </span>
      <span style={{ flexShrink: 0 }}>{place.percent}</span>
    </div>
  );
}

function LabelledTabs({
  theme,
  active,
  onOpen,
}: {
  theme: Theme;
  active: ReaderPanel | null;
  onOpen: (p: ReaderPanel) => void;
}) {
  const { tr } = useI18n();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 4,
      }}
    >
      {panelsOnBar("labelled").map((p) => {
        const on = active === p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onOpen(p)}
            aria-pressed={on}
            style={{
              minHeight: 48,
              border: "none",
              borderRadius: 12,
              background: on ? theme.hover : "transparent",
              color: on ? theme.ink : theme.chromeInk,
              cursor: "pointer",
              display: "grid",
              justifyItems: "center",
              alignContent: "center",
              gap: 3,
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: on ? 500 : 400,
              padding: "4px 2px",
            }}
          >
            <Icon name={PANEL_ICON[p]} size={18} />
            <span
              style={{
                maxWidth: "100%",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {tr(PANEL_LABEL[p])}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A pill with an icon and a word — the slider style's two actions. */
function LabelledButton({
  theme,
  panel,
  active,
  onOpen,
}: {
  theme: Theme;
  panel: ReaderPanel;
  active: boolean;
  onOpen: (p: ReaderPanel) => void;
}) {
  const { tr } = useI18n();
  return (
    <button
      type="button"
      onClick={() => onOpen(panel)}
      aria-pressed={active}
      style={{
        height: 44,
        padding: "0 18px",
        borderRadius: 22,
        border: active ? `1px solid ${theme.ruleStrong}` : "none",
        background: theme.hover,
        color: theme.ink,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "inherit",
        fontSize: 13,
      }}
    >
      <Icon name={PANEL_ICON[panel]} size={17} />
      {tr(PANEL_LABEL[panel])}
    </button>
  );
}

/** The status style's "Aa": text settings, set apart as the one control
 *  readers reach for most. */
function TextSettingsPill({
  theme,
  active,
  onOpen,
}: {
  theme: Theme;
  active: boolean;
  onOpen: (p: ReaderPanel) => void;
}) {
  const { tr } = useI18n();
  return (
    <button
      type="button"
      onClick={() => onOpen("settings")}
      aria-label={tr("reader.settings")}
      aria-pressed={active}
      style={{
        height: 40,
        padding: "0 16px",
        borderRadius: 20,
        border: `0.5px solid ${theme.ruleStrong}`,
        background: active ? theme.hover : "transparent",
        color: theme.ink,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "inherit",
        fontSize: 13,
      }}
    >
      <Icon name="type" size={16} />
      Aa
    </button>
  );
}

function CornerButton({
  theme,
  panel,
  active,
  onOpen,
  hidden,
}: {
  theme: Theme;
  panel: ReaderPanel;
  active: boolean;
  onOpen: (p: ReaderPanel) => void;
  hidden: boolean;
}) {
  const { tr } = useI18n();
  const surface = glassPill(theme);
  return (
    <button
      type="button"
      data-pan-zone
      className={surface.className}
      onClick={() => onOpen(panel)}
      aria-label={tr(PANEL_ARIA[panel])}
      aria-pressed={active}
      style={{
        ...surface.style,
        width: 52,
        height: 52,
        borderRadius: 26,
        flexShrink: 0,
        color: active ? theme.ink : theme.chromeInk,
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        pointerEvents: hidden ? "none" : "auto",
      }}
    >
      <Icon name={PANEL_ICON[panel]} size={19} />
    </button>
  );
}

/** A 3px track with a fill — where you are, read-only. */
export function ThinTrack({
  theme,
  fraction,
  height = 3,
  style,
}: {
  theme: Theme;
  fraction: number;
  height?: number;
  /** Placement, for a track pinned somewhere (the corners' edge line). */
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: "block",
        position: "relative",
        height,
        borderRadius: 2,
        background: theme.rule,
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          insetBlock: 0,
          insetInlineStart: 0,
          width: `${clamp01(fraction) * 100}%`,
          borderRadius: 2,
          background: theme.chromeInk,
        }}
      />
    </span>
  );
}

/**
 * The status style's progress line: 3px to look at, a full 32px tall to
 * grab. Drag it to preview a position (named in a chip above the finger),
 * release to go there. Like the full slider, a touch that turns vertical
 * before it moves sideways is a page scroll, not a seek — the line sits
 * where a thumb starts an upward flick.
 */
export function SeekLine({
  theme,
  fraction,
  seek,
}: {
  theme: Theme;
  fraction: number;
  seek: BarSeek;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The progress slider's own drag (shared hook). A cancelled pointer drops
  // the preview here: the line is a quick seek, not a careful scrub.
  const { preview, handlers } = useScrubGesture({
    trackRef: ref,
    rtl: seek.rtl,
    onSeek: seek.onSeek,
    commitOnCancel: false,
  });

  const shown = preview ?? clamp01(fraction);
  return (
    <div
      ref={ref}
      role="slider"
      data-pan-axis="x"
      tabIndex={0}
      aria-label={seek.ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamp01(fraction) * 100)}
      {...handlers}
      onKeyDown={(e) => {
        const step =
          e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const dir = seek.rtl ? -step : step;
        seek.onSeek(clamp01(clamp01(fraction) + dir * 0.01));
      }}
      style={{
        position: "relative",
        height: 32,
        marginTop: -15,
        cursor: "pointer",
        touchAction: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          insetInline: 0,
          top: 14,
          height: 3,
          background: theme.rule,
        }}
      />
      <span
        style={{
          position: "absolute",
          insetInlineStart: 0,
          top: 14,
          height: 3,
          width: `${shown * 100}%`,
          background: theme.chromeInk,
        }}
      />
      <span
        style={{
          position: "absolute",
          top: 9,
          insetInlineStart: `${shown * 100}%`,
          width: 13,
          height: 13,
          marginInlineStart: -6.5,
          borderRadius: "50%",
          background: theme.chromeInk,
          transform: preview === null ? "none" : "scale(1.25)",
          transition: "transform 120ms ease-out",
        }}
      />
      {preview !== null && (
        <span
          style={{
            position: "absolute",
            bottom: 30,
            insetInlineStart: `clamp(8px, calc(${shown * 100}% - 90px), calc(100% - 188px))`,
            width: 180,
            textAlign: "center",
            padding: "5px 10px",
            borderRadius: 10,
            background: theme.chrome,
            border: `0.5px solid ${theme.ruleStrong}`,
            color: theme.ink,
            fontSize: 12,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          {seek.formatLabel(preview)}
        </span>
      )}
    </div>
  );
}
