// The phone's update pill: a small floating chip above the library's bottom
// bar. What it says is pillFor(), from the store; tapping it opens the sheet
// that state belongs to. Nothing renders for a managed or manual install, or
// once the device already runs the offered version.

import { useI18n } from "../../i18n/useI18n";
import {
  flowInput,
  openSheet,
  type Sheet,
  useAndroidUpdate,
} from "../../store/androidUpdate";
import { type Pill, pillFor } from "../../store/updateFlow";
import {
  FONT_STACKS,
  type Theme,
  TOUCH_TARGET_MIN,
  Z,
} from "../../styles/tokens";
import type { UpdateInfo } from "../../store/updates";
import { Icon } from "../Icon";
import { UpdateBanner } from "../UpdateBanner";
import { PILL_BOTTOM_PX, PILL_FACE_HEIGHT, VISUALLY_HIDDEN } from "./parts";

/** Android, when install_source could not be read (the manual channel):
 *  the old behaviour, the release-page banner. Nothing while the lookup is
 *  still out, and nothing for any channel the pill or the store covers. Its
 *  own component so App does not re-render on every status poll. */
export function ManualUpdateBanner({
  info,
  theme,
  onDismiss,
}: {
  info: UpdateInfo;
  theme: Theme;
  onDismiss: () => void;
}) {
  const s = useAndroidUpdate();
  if (s.channel?.kind !== "manual") return null;
  return <UpdateBanner info={info} theme={theme} onDismiss={onDismiss} />;
}

/** The sheet each pill state opens. */
export const SHEET_FOR: Record<
  NonNullable<Pill>["kind"],
  Exclude<Sheet, "closed">
> = {
  available: "notes",
  progress: "progress",
  waiting: "progress",
  ready: "ready",
  failed: "failed",
};

/** A determinate ring drawn with a conic gradient, masked to a band so the
 *  page shows through the middle. currentColor keeps it on the pill's ink. */
function Ring({ pct, theme }: { pct: number; theme: Theme }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        width: 14,
        height: 14,
        borderRadius: "50%",
        flex: "none",
        background: `conic-gradient(currentColor ${pct}%, ${theme.rule} 0)`,
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 2.5,
          borderRadius: "50%",
          background: theme.chrome,
        }}
      />
    </span>
  );
}

export function UpdatePill({
  theme,
  layout = "mobile",
}: {
  theme: Theme;
  /** "mobile" sits above MobileBottomNav; "desktop" (a wide Android layout,
   *  no bottom bar) sits near the bottom edge. */
  layout?: "mobile" | "desktop";
}) {
  const { tr } = useI18n();
  const s = useAndroidUpdate();
  const pill = pillFor(flowInput(s));
  if (!pill) return null;
  const v = s.offer?.version ?? "";
  const failed = pill.kind === "failed";
  const label =
    pill.kind === "available"
      ? tr("update.pill.available", { v })
      : pill.kind === "progress"
        ? tr("update.pill.progress", { p: pill.pct })
        : pill.kind === "waiting"
          ? tr("update.pill.waiting", { v })
          : pill.kind === "ready"
            ? tr("update.pill.ready", { v })
            : tr("update.pill.failed");
  const quiet = pill.kind === "waiting";
  // What a screen reader hears: the state, not the percentage. The visible
  // label changes on every 500 ms poll while downloading; announcing each
  // tick would talk over the book.
  const announce = pill.kind === "progress" ? tr("update.downloading") : label;
  return (
    <button
      type="button"
      onClick={() => openSheet(SHEET_FOR[pill.kind])}
      className="riwaq-update-pill"
      data-layout={layout}
      // The button is the 44px tap area and draws nothing; the visible pill
      // is the face inside it, which also carries the focus ring
      // (global.css .riwaq-update-pill).
      style={{
        position: "fixed",
        bottom:
          layout === "mobile"
            ? `calc(${PILL_BOTTOM_PX}px + env(safe-area-inset-bottom, 0px))`
            : "calc(24px + env(safe-area-inset-bottom, 0px))",
        // Phone: centred over the bottom bar. Wide layout: the sidebar takes
        // the inline-start side, so centring on the window would sit
        // off-centre over the content; anchor to the inline-end edge.
        ...(layout === "mobile"
          ? { left: "50%", transform: "translateX(-50%)" }
          : { insetInlineEnd: 24 }),
        zIndex: Z.banner,
        minHeight: TOUCH_TARGET_MIN,
        maxWidth:
          layout === "mobile"
            ? "calc(100vw - 32px)"
            : "min(360px, calc(100vw - 48px))",
        display: "inline-flex",
        alignItems: "center",
        padding: 0,
        border: 0,
        background: "transparent",
        color: failed ? theme.danger : quiet ? theme.muted : theme.ink,
        fontFamily: FONT_STACKS.sans,
        cursor: "pointer",
        touchAction: "manipulation",
        whiteSpace: "nowrap",
      }}
    >
      <span
        data-pill-face
        className="riwaq-update-pill-face"
        style={{
          height: PILL_FACE_HEIGHT,
          maxWidth: "100%",
          boxSizing: "border-box",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "0 12px 0 10px",
          borderRadius: 18,
          border: `0.5px solid ${failed ? theme.danger : theme.ruleStrong}`,
          background: theme.chrome,
          boxShadow: "0 3px 10px rgba(0,0,0,0.12)",
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        {pill.kind === "progress" ? (
          <Ring pct={pill.pct} theme={theme} />
        ) : (
          <Icon
            name={
              pill.kind === "waiting"
                ? "wifi"
                : pill.kind === "failed"
                  ? "alert"
                  : pill.kind === "ready"
                    ? "check"
                    : "arrowUp"
            }
            size={14}
            stroke={2.2}
          />
        )}
        <span aria-live="polite" style={VISUALLY_HIDDEN}>
          {announce}
        </span>
        <span
          aria-hidden="true"
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {label}
        </span>
        <Icon
          name="chevronR"
          size={13}
          className="rtl-flip-x"
          style={{ opacity: 0.55, flex: "none" }}
        />
      </span>
    </button>
  );
}
