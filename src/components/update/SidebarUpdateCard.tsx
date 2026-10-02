// The desktop update card, at the bottom of the library sidebar above
// Import (placement A, chosen 2026-10-02). What it says is cardFor(), from
// the desktop store; the dialogs it opens live in DesktopUpdateLayer, which
// App mounts once so Settings can open them too.

import { useI18n } from "../../i18n/useI18n";
import {
  type Card,
  cardFor,
  openDialog,
  restart,
  update,
  useDesktopUpdate,
} from "../../store/desktopUpdate";
import { FONT_STACKS, type Theme, TOUCH_TARGET_MIN } from "../../styles/tokens";
import { Button } from "../Button";
import { Icon, type IconProps } from "../Icon";
import { VISUALLY_HIDDEN } from "./UpdatePill";
import { mb } from "./UpdateSheet";

const TRANSITION = "background-color 150ms ease, border-color 150ms ease";

/** A determinate bar, scaled rather than resized so a progress tick never
 *  relayouts the sidebar. */
export function ProgressBar({
  theme,
  bytes,
  total,
  label,
  dir,
}: {
  theme: Theme;
  bytes: number;
  total: number;
  label: string;
  dir: "ltr" | "rtl";
}) {
  const pct = total ? Math.min(100, (bytes / total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(pct)}
      style={{
        height: 4,
        borderRadius: 2,
        background: theme.rule,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "100%",
          borderRadius: 2,
          background: theme.ink,
          transform: `scaleX(${pct / 100})`,
          transformOrigin: dir === "rtl" ? "right" : "left",
          transition: "transform 300ms ease-out",
        }}
      />
    </div>
  );
}

/** "5.1 of 12.0 MB", or just "Downloading…" before the size is known. */
export function progressText(
  tr: ReturnType<typeof useI18n>["tr"],
  bytes: number,
  total: number,
): string {
  return total
    ? tr("update.dl.of", { a: mb(bytes), b: mb(total) })
    : tr("update.downloading");
}

/** What a screen reader hears when the card changes: the state, never the
 *  byte count (that would talk over the book on every tick). */
function announcement(
  card: Card,
  v: string,
  tr: ReturnType<typeof useI18n>["tr"],
): string {
  if (!card) return "";
  switch (card.kind) {
    case "available":
      return tr("update.card.available", { v });
    case "downloading":
      return tr("update.downloading");
    case "ready":
      return tr("update.card.ready", { v });
    case "installed":
      return tr("update.restartManually");
    case "failed":
      return tr("update.card.failed");
  }
}

export function SidebarUpdateCard({ theme }: { theme: Theme }) {
  const { tr } = useI18n();
  const s = useDesktopUpdate();
  const card = cardFor(s);
  const v = s.offer?.version ?? "";

  // One live region, always mounted at the same place (first child of the
  // same fragment, with or without a card), so it exists before its text
  // changes and is never remounted when the card appears.
  return (
    <>
      <span data-update-live aria-live="polite" style={VISUALLY_HIDDEN}>
        {announcement(card, v, tr)}
      </span>
      {card && <CardBody theme={theme} card={card} />}
    </>
  );
}

function CardBody({ theme, card }: { theme: Theme; card: NonNullable<Card> }) {
  const { tr, dir } = useI18n();
  const s = useDesktopUpdate();
  const v = s.offer?.version ?? "";

  const failed = card.kind === "failed";
  const icon: IconProps["name"] =
    card.kind === "available"
      ? "arrowUp"
      : card.kind === "downloading"
        ? "download"
        : card.kind === "ready" || card.kind === "installed"
          ? "check"
          : "alert";
  const title =
    card.kind === "available"
      ? tr("update.card.available", { v })
      : card.kind === "downloading"
        ? tr("update.dl.title", { v })
        : card.kind === "ready" || card.kind === "installed"
          ? tr("update.card.ready", { v })
          : tr("update.card.failed");
  // Under the title: reassurance before a restart, or what to do when the
  // app could not restart itself.
  const note =
    card.kind === "ready"
      ? tr("update.restartBody")
      : card.kind === "installed"
        ? tr("update.restartManually")
        : null;

  const head = (
    <>
      <span
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: failed ? "transparent" : theme.hover,
          border: failed ? `1px solid ${theme.danger}` : "none",
          color: failed ? theme.danger : theme.ink,
        }}
      >
        <Icon name={icon} size={15} stroke={2.2} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.35,
            color: failed ? theme.danger : theme.ink,
          }}
        >
          {title}
        </span>
        {card.kind === "available" && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              marginTop: 2,
              fontSize: 12,
              color: theme.muted,
            }}
          >
            {tr("update.action.whatsNew")}
            <Icon name="chevronR" size={12} className="rtl-flip-x" />
          </span>
        )}
        {card.kind === "downloading" && (
          <span
            style={{
              display: "block",
              marginTop: 2,
              fontSize: 12,
              color: theme.muted,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {progressText(tr, card.bytes, card.total)}
          </span>
        )}
        {note && (
          <span
            style={{
              display: "block",
              marginTop: 3,
              fontSize: 12,
              lineHeight: 1.45,
              color: theme.muted,
            }}
          >
            {note}
          </span>
        )}
      </span>
    </>
  );

  const headStyle = {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
    minHeight: TOUCH_TARGET_MIN,
    padding: 10,
    border: 0,
    borderRadius: 11,
    background: "transparent",
    font: "inherit",
    color: "inherit",
    textAlign: "start" as const,
  };

  // Ready has nothing to open: its one action is on the card.
  const opens =
    card.kind === "available"
      ? "notes"
      : card.kind === "downloading"
        ? "progress"
        : card.kind === "failed"
          ? "failed"
          : null;

  return (
    <div
      data-update-card={card.kind}
      style={{
        margin: "0 0 10px",
        borderRadius: 12,
        background: theme.bg,
        border: `1px solid ${failed ? theme.danger : theme.rule}`,
        fontFamily: FONT_STACKS.sans,
        transition: TRANSITION,
      }}
    >
      {opens ? (
        <button
          type="button"
          onClick={() => openDialog(opens)}
          style={{ ...headStyle, cursor: "pointer", transition: TRANSITION }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.hover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {head}
        </button>
      ) : (
        <div style={headStyle}>{head}</div>
      )}
      {card.kind === "downloading" && (
        <div style={{ padding: "0 10px 10px" }}>
          <ProgressBar
            theme={theme}
            bytes={card.bytes}
            total={card.total}
            label={title}
            dir={dir}
          />
        </div>
      )}
      {(card.kind === "ready" || card.kind === "failed") && (
        <div style={{ padding: "0 10px 10px" }}>
          <Button
            theme={theme}
            variant="primary"
            size="sm"
            fullWidth
            loading={s.phase === "installing"}
            disabled={s.phase === "installing"}
            style={{ minHeight: TOUCH_TARGET_MIN }}
            onClick={() => void (card.kind === "ready" ? restart() : update())}
          >
            {card.kind === "ready"
              ? tr("update.restart")
              : tr("update.fail.again")}
          </Button>
        </div>
      )}
    </div>
  );
}
