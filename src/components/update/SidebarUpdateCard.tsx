// The desktop update card, at the bottom of the library sidebar above
// Import (placement A, chosen 2026-10-02). What it says is cardFor(), from
// the desktop store; the dialogs it opens live in DesktopUpdateLayer, which
// App mounts once so Settings can open them too.

import { useArmed } from "../../hooks/useArmed";
import type { Tr } from "../../i18n";
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
import { IconBadge, ProgressBar, progressText, VISUALLY_HIDDEN } from "./parts";

const TRANSITION = "background-color 150ms ease, border-color 150ms ease";

/** What a screen reader hears when the card changes: the state, never the
 *  byte count (that would talk over the book on every tick). */
function announcement(card: Card, v: string, tr: Tr): string {
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
      <IconBadge
        theme={theme}
        icon={icon}
        size={28}
        radius={8}
        iconSize={15}
        color={failed ? theme.danger : undefined}
        ring={failed ? theme.danger : undefined}
      />
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
          // Two lines at most: unclamped, it pushed the sidebar's Settings
          // row half out of view at an 800 px window. The full text is in
          // the title here, and in full on the Settings card and the dialog.
          <span
            data-update-note
            title={note}
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
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
      {card.kind === "failed" && (
        <div key="retry" style={{ padding: "0 10px 10px" }}>
          <Button
            theme={theme}
            variant="primary"
            size="sm"
            fullWidth
            style={{ minHeight: TOUCH_TARGET_MIN }}
            onClick={() => void update()}
          >
            {tr("update.fail.again")}
          </Button>
        </div>
      )}
      {/* Its own element, below the note, never Try again re-labelled. */}
      {card.kind === "ready" && (
        <div key="restart" style={{ padding: "0 10px 10px" }}>
          <RestartNowButton theme={theme} fullWidth />
        </div>
      )}
    </div>
  );
}

/** "Restart now", the one action that ends the session. It is its own
 *  element, placed apart from Update / Try again, and it ignores clicks for
 *  ARM_MS after it appears (useArmed explains the unexplained restart this
 *  guards against; the store's restart() guards too). It stays visible and
 *  focusable meanwhile (aria-disabled, dimmed), and brightens once live. */
export function RestartNowButton({
  theme,
  fullWidth,
}: {
  theme: Theme;
  fullWidth?: boolean;
}) {
  const { tr } = useI18n();
  const s = useDesktopUpdate();
  const armed = useArmed("restart");
  const installing = s.phase === "installing";
  return (
    <Button
      theme={theme}
      variant="primary"
      size="sm"
      fullWidth={fullWidth}
      loading={installing}
      disabled={installing}
      aria-disabled={!armed || undefined}
      style={{
        minHeight: TOUCH_TARGET_MIN,
        opacity: armed ? 1 : 0.6,
        transition: "opacity 200ms ease",
      }}
      onClick={() => {
        if (armed) void restart();
      }}
    >
      {tr("update.restart")}
    </Button>
  );
}
