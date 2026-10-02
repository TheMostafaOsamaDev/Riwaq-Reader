// Settings → About on desktop: the waiting update, where "Later" sends it.
// The desktop twin of SettingsUpdateCard (Android): version, date, the
// release's one-line summary, What's new, and the action for the state the
// update is in. Renders nothing without a pending, unskipped offer.

import { useI18n } from "../../i18n/useI18n";
import {
  cardFor,
  openDialog,
  settingsCardFor,
  update,
  useDesktopUpdate,
} from "../../store/desktopUpdate";
import { pick } from "../../store/releaseNotes";
import { type Theme, TOUCH_TARGET_MIN } from "../../styles/tokens";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { RestartNowButton } from "./SidebarUpdateCard";

export function DesktopSettingsUpdateCard({ theme }: { theme: Theme }) {
  const { tr, locale } = useI18n();
  const s = useDesktopUpdate();
  if (!settingsCardFor(s) || !s.offer) return null;
  const v = s.offer.version;
  const notes = s.notes?.notes ?? null;
  const summary = notes
    ? notes.highlight
      ? pick(notes.highlight.title, locale)
      : notes.items[0]
        ? pick(notes.items[0], locale)
        : ""
    : "";
  const card = cardFor({ ...s, later: false });

  let primary: string | null;
  let onPrimary: () => void = () => {};
  switch (card?.kind) {
    case "downloading":
      primary = tr("update.downloading");
      onPrimary = () => openDialog("progress");
      break;
    case "ready":
      // Not in this row: Restart now gets its own armed button below, so a
      // repeated click where Update was cannot reach it.
      primary = null;
      break;
    case "installed":
      // Installed; only the user can restart now.
      primary = null;
      break;
    case "failed":
      primary = tr("update.fail.again");
      onPrimary = () => void update();
      break;
    default:
      primary =
        s.offer.channel === "manual"
          ? tr("update.action.download")
          : tr("update.action.install");
      onPrimary = () => void update();
  }
  const title =
    card?.kind === "ready" || card?.kind === "installed"
      ? tr("update.card.ready", { v })
      : card?.kind === "failed"
        ? tr("update.card.failed")
        : tr("update.card.available", { v });

  return (
    <section
      data-settings-update
      aria-label={title}
      style={{
        marginTop: 10,
        padding: 14,
        borderRadius: 12,
        background: theme.chrome,
        border: `0.5px solid ${card?.kind === "failed" ? theme.danger : theme.rule}`,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: theme.hover,
            color: card?.kind === "failed" ? theme.danger : theme.ink,
          }}
        >
          <Icon
            name={
              card?.kind === "failed"
                ? "alert"
                : card?.kind === "ready" || card?.kind === "installed"
                  ? "check"
                  : "arrowUp"
            }
            size={16}
            stroke={2.2}
          />
        </span>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: card?.kind === "failed" ? theme.danger : theme.ink,
            }}
          >
            {title}
          </div>
          {notes?.date && (
            <div
              style={{
                fontSize: 11.5,
                color: theme.muted,
                marginTop: 2,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {notes.date}
            </div>
          )}
          {(card?.kind === "ready" || card?.kind === "installed") && (
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.45,
                color: theme.muted,
                marginTop: 6,
              }}
            >
              {card.kind === "ready"
                ? tr("update.restartBody")
                : tr("update.restartManually")}
            </div>
          )}
          {summary && (
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.45,
                color: theme.ink,
                marginTop: 6,
              }}
            >
              {summary}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Button
          theme={theme}
          variant="outline"
          size="sm"
          fullWidth
          style={{ minHeight: TOUCH_TARGET_MIN }}
          onClick={() => openDialog("notes")}
        >
          {tr("settings.updates.seeNew")}
        </Button>
        {primary && (
          <Button
            theme={theme}
            variant="primary"
            size="sm"
            fullWidth
            loading={s.phase === "installing"}
            disabled={s.phase === "installing"}
            style={{ minHeight: TOUCH_TARGET_MIN }}
            onClick={onPrimary}
          >
            {primary}
          </Button>
        )}
      </div>
      {card?.kind === "ready" && (
        <div key="restart" style={{ marginTop: 8 }}>
          <RestartNowButton theme={theme} fullWidth />
        </div>
      )}
    </section>
  );
}
