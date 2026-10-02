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
import { summaryOf } from "../../store/releaseNotes";
import type { Theme } from "../../styles/tokens";
import { SettingsCard } from "./parts";
import { RestartNowButton } from "./SidebarUpdateCard";

export function DesktopSettingsUpdateCard({ theme }: { theme: Theme }) {
  const { tr, locale } = useI18n();
  const s = useDesktopUpdate();
  if (!settingsCardFor(s) || !s.offer) return null;
  const v = s.offer.version;
  const notes = s.notes?.notes ?? null;
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
  const settled = card?.kind === "ready" || card?.kind === "installed";
  const title = settled
    ? tr("update.card.ready", { v })
    : card?.kind === "failed"
      ? tr("update.card.failed")
      : tr("update.card.available", { v });

  return (
    <SettingsCard
      theme={theme}
      label={title}
      title={title}
      icon={card?.kind === "failed" ? "alert" : settled ? "check" : "arrowUp"}
      danger={card?.kind === "failed"}
      meta={notes?.date}
      note={
        card?.kind === "ready"
          ? tr("update.restartBody")
          : card?.kind === "installed"
            ? tr("update.restartManually")
            : undefined
      }
      summary={summaryOf(notes, locale)}
      onSeeNew={() => openDialog("notes")}
      primary={
        primary
          ? {
              label: primary,
              onClick: onPrimary,
              busy: s.phase === "installing",
            }
          : null
      }
    >
      {card?.kind === "ready" && (
        <div key="restart" style={{ marginTop: 8 }}>
          <RestartNowButton theme={theme} fullWidth />
        </div>
      )}
    </SettingsCard>
  );
}
