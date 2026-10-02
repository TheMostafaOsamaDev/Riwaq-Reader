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
import { Icon } from "../Icon";

const SHEET_FOR: Record<NonNullable<Pill>["kind"], Exclude<Sheet, "closed">> = {
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
        width: 16,
        height: 16,
        borderRadius: "50%",
        flex: "none",
        background: `conic-gradient(currentColor ${pct}%, ${theme.rule} 0)`,
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 3,
          borderRadius: "50%",
          background: theme.chrome,
        }}
      />
    </span>
  );
}

export function UpdatePill({ theme }: { theme: Theme }) {
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
  return (
    <button
      type="button"
      onClick={() => openSheet(SHEET_FOR[pill.kind])}
      className="riwaq-update-pill"
      style={{
        position: "fixed",
        bottom: "calc(76px + env(safe-area-inset-bottom, 0px))",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: Z.banner,
        minHeight: TOUCH_TARGET_MIN,
        maxWidth: "calc(100vw - 32px)",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "0 14px 0 12px",
        borderRadius: 22,
        border: `0.5px solid ${failed ? theme.danger : theme.ruleStrong}`,
        background: theme.chrome,
        color: failed ? theme.danger : quiet ? theme.muted : theme.ink,
        boxShadow: "0 6px 20px rgba(0,0,0,0.16)",
        fontFamily: FONT_STACKS.sans,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        touchAction: "manipulation",
        whiteSpace: "nowrap",
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
          size={15}
          stroke={2.2}
        />
      )}
      <span
        aria-live="polite"
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
        size={14}
        className="rtl-flip-x"
        style={{ opacity: 0.55, flex: "none" }}
      />
    </button>
  );
}
