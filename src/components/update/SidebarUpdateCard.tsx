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
import { Icon } from "../Icon";
import { Spinner } from "../Spinner";
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

/** Height budget: every card stays within ~64 px, so the sidebar's
 *  scrolling nav keeps Settings fully in view at an 800 px (and 720 px)
 *  window. The ready card used to be ~130 px (a two-line note over a
 *  full-width 44 px button) and cut Settings off, found in the final Mac
 *  verification. Actions are compact (32 px faces, 44 px hit areas, the
 *  same trick as the phone pill), and notes are one line with the full
 *  text in `title` (it is in full on the Settings card and in the dialog). */
function CardBody({ theme, card }: { theme: Theme; card: NonNullable<Card> }) {
  const { tr, dir } = useI18n();
  const s = useDesktopUpdate();
  const v = s.offer?.version ?? "";
  const failed = card.kind === "failed";

  const frame = {
    margin: "0 0 8px",
    borderRadius: 12,
    background: theme.bg,
    border: `1px solid ${failed ? theme.danger : theme.rule}`,
    fontFamily: FONT_STACKS.sans,
    transition: TRANSITION,
  };
  const titleStyle = {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.25,
    color: failed ? theme.danger : theme.ink,
  };
  const sub = {
    display: "block",
    marginTop: 1,
    fontSize: 12,
    lineHeight: 1.3,
  };

  // available / downloading: the whole card is one button that opens its
  // dialog; there is no action on the card itself.
  if (card.kind === "available" || card.kind === "downloading") {
    const title =
      card.kind === "available"
        ? tr("update.card.available", { v })
        : tr("update.dl.title", { v });
    return (
      <div data-update-card={card.kind} style={frame}>
        <button
          type="button"
          onClick={() =>
            openDialog(card.kind === "available" ? "notes" : "progress")
          }
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            width: "100%",
            minHeight: TOUCH_TARGET_MIN,
            padding: "6px 10px",
            border: 0,
            borderRadius: 11,
            background: "transparent",
            font: "inherit",
            color: "inherit",
            textAlign: "start",
            cursor: "pointer",
            transition: TRANSITION,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.hover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <IconBadge
            theme={theme}
            icon={card.kind === "available" ? "arrowUp" : "download"}
            size={24}
            radius={7}
            iconSize={14}
          />
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={titleStyle}>{title}</span>
            {card.kind === "available" ? (
              <span
                style={{
                  ...sub,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 2,
                  color: theme.muted,
                }}
              >
                {tr("update.action.whatsNew")}
                <Icon name="chevronR" size={12} className="rtl-flip-x" />
              </span>
            ) : (
              <>
                <span
                  style={{
                    ...sub,
                    color: theme.muted,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {progressText(tr, card.bytes, card.total)}
                </span>
                <span style={{ display: "block", marginTop: 5 }}>
                  <ProgressBar
                    theme={theme}
                    bytes={card.bytes}
                    total={card.total}
                    label={title}
                    dir={dir}
                  />
                </span>
              </>
            )}
          </span>
        </button>
      </div>
    );
  }

  // ready / installed / failed: one row, the title at inline-start and the
  // action (if any) at inline-end, then at most one line of note.
  const title =
    card.kind === "failed"
      ? tr("update.card.failed")
      : tr("update.card.ready", { v });
  const note =
    card.kind === "ready"
      ? tr("update.restartBody")
      : card.kind === "installed"
        ? tr("update.restartManually")
        : null;
  return (
    <div data-update-card={card.kind} style={{ ...frame, padding: "6px 10px" }}>
      <div
        data-update-row
        style={{ display: "flex", alignItems: "center", gap: 8 }}
      >
        {failed ? (
          // Opens the failed dialog (Download from GitHub lives there). Its
          // hit area grows past its text without taking layout space.
          <button
            type="button"
            data-update-head
            onClick={() => openDialog("failed")}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "6px 6px",
              margin: "-6px -6px",
              border: 0,
              borderRadius: 8,
              background: "transparent",
              font: "inherit",
              textAlign: "start",
              cursor: "pointer",
            }}
          >
            <span style={titleStyle}>{title}</span>
          </button>
        ) : (
          <span style={{ ...titleStyle, flex: 1, minWidth: 0 }}>{title}</span>
        )}
        {card.kind === "failed" && (
          <CompactAction
            key="retry"
            theme={theme}
            label={tr("update.fail.again")}
            onClick={() => void update()}
          />
        )}
        {/* Its own element, never Try again re-labelled. */}
        {card.kind === "ready" && (
          <RestartNowButton key="restart" theme={theme} compact />
        )}
      </div>
      {note && (
        <span
          data-update-note
          title={note}
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            marginTop: 2,
            fontSize: 12,
            lineHeight: 1.3,
            color: theme.muted,
          }}
        >
          {note}
        </span>
      )}
    </div>
  );
}

/** A small primary action for the sidebar card: a 32 px face inside a
 *  44 px hit area (the extra 6 px above and below takes no layout space),
 *  like the phone pill; the focus ring goes on the face (global.css). */
function CompactAction({
  theme,
  label,
  onClick,
  armed = true,
  busy = false,
}: {
  theme: Theme;
  label: string;
  onClick: () => void;
  armed?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      data-compact
      className="riwaq-compact-action"
      disabled={busy}
      aria-disabled={!armed || undefined}
      aria-busy={busy || undefined}
      onClick={onClick}
      style={{
        flex: "none",
        padding: "6px 0",
        margin: "-6px 0",
        border: 0,
        background: "transparent",
        font: "inherit",
        cursor: busy ? "progress" : "pointer",
      }}
    >
      <span
        className="riwaq-compact-action-face"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 32,
          padding: "0 12px",
          borderRadius: 8,
          background: theme.ink,
          color: theme.bg,
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: "nowrap",
          opacity: armed && !busy ? 1 : 0.6,
          transition: "opacity 200ms ease",
        }}
      >
        {busy && <Spinner size={12} />}
        {label}
      </span>
    </button>
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
  compact,
}: {
  theme: Theme;
  fullWidth?: boolean;
  /** The sidebar card's 32 px face (44 px hit area). */
  compact?: boolean;
}) {
  const { tr } = useI18n();
  const s = useDesktopUpdate();
  const armed = useArmed("restart");
  const installing = s.phase === "installing";
  if (compact) {
    return (
      <CompactAction
        theme={theme}
        label={tr("update.restart")}
        armed={armed}
        busy={installing}
        onClick={() => {
          if (armed) void restart();
        }}
      />
    );
  }
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
