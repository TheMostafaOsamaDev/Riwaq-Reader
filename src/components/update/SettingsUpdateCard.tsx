// Settings → About on Android: the waiting update (where "Later" sends it),
// or, for a store-managed install, who updates it. Reads the update store;
// renders nothing when neither applies.

import { useI18n } from "../../i18n/useI18n";
import {
  flowInput,
  openSheet,
  openStoreApp,
  type Sheet,
  startDownload,
  useAndroidUpdate,
} from "../../store/androidUpdate";
import { pick } from "../../store/releaseNotes";
import { attentionDot, type Pill, pillFor } from "../../store/updateFlow";
import { RELEASES_PAGE_URL } from "../../store/updates";
import { type Theme, TOUCH_TARGET_MIN } from "../../styles/tokens";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { mb } from "./UpdateSheet";

const SHEET_FOR: Partial<
  Record<NonNullable<Pill>["kind"], Exclude<Sheet, "closed">>
> = {
  progress: "progress",
  waiting: "progress",
  ready: "ready",
  failed: "failed",
};

export function SettingsUpdateCard({
  theme,
  onOpenUrl,
}: {
  theme: Theme;
  onOpenUrl: (url: string) => void;
}) {
  const { tr, locale } = useI18n();
  const s = useAndroidUpdate();
  const input = flowInput(s);
  const c = s.channel;

  if (c.kind === "managed") {
    const store = c.label || tr("settings.updates.yourStore");
    return (
      <div style={{ marginTop: 10 }}>
        <p
          style={{
            margin: "0 2px 8px",
            fontSize: 12.5,
            lineHeight: 1.5,
            color: theme.ink,
          }}
        >
          {tr("settings.updates.managedBy", { store })}
        </p>
        {c.storeInstalled ? (
          <Button
            theme={theme}
            variant="outline"
            size="sm"
            fullWidth
            style={{ minHeight: TOUCH_TARGET_MIN }}
            onClick={() => void openStoreApp()}
          >
            {tr("settings.updates.openStore", { store })}
          </Button>
        ) : (
          <Button
            theme={theme}
            variant="outline"
            size="sm"
            fullWidth
            style={{ minHeight: TOUCH_TARGET_MIN }}
            trailingIcon={<Icon name="externalLink" size={13} />}
            onClick={() => onOpenUrl(RELEASES_PAGE_URL)}
          >
            {tr("settings.updates.github")}
          </Button>
        )}
      </div>
    );
  }

  // The same rule as the Settings dot: a pending offer, not skipped, on a
  // channel this app can act on.
  if (!attentionDot(input) || !s.offer) return null;
  const v = s.offer.version;
  const notes = s.notes?.notes ?? null;
  const summary = notes
    ? notes.highlight
      ? pick(notes.highlight.title, locale)
      : notes.items[0]
        ? pick(notes.items[0], locale)
        : ""
    : "";
  const size = s.apk ? mb(s.apk.size) : null;
  const meta = [notes?.date, size && tr("update.sheet.size", { mb: size })]
    .filter(Boolean)
    .join(" · ");

  // Something already under way: the primary button reads like the pill and
  // opens that state's sheet instead of starting again.
  const pill = pillFor(input);
  const inFlight = pill ? SHEET_FOR[pill.kind] : undefined;
  const assisted = c.kind === "store-assisted" ? c : null;
  const primary = inFlight
    ? pill?.kind === "progress"
      ? tr("update.pill.progress", { p: pill.pct })
      : pill?.kind === "waiting"
        ? tr("update.pill.waiting", { v })
        : pill?.kind === "ready"
          ? tr("update.pill.ready", { v })
          : tr("update.pill.failed")
    : assisted
      ? tr("update.sheet.inStore", { store: assisted.label })
      : size
        ? tr("update.sheet.update", { mb: size })
        : tr("update.action.install");

  return (
    <section
      aria-label={tr("update.available", { v })}
      style={{
        marginTop: 10,
        padding: 14,
        borderRadius: 12,
        background: theme.chrome,
        border: `0.5px solid ${theme.rule}`,
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
            color: theme.ink,
          }}
        >
          <Icon name="arrowUp" size={16} stroke={2.2} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.ink }}>
            {tr("update.available", { v })}
          </div>
          {meta && (
            <div
              style={{
                fontSize: 11.5,
                color: theme.muted,
                marginTop: 2,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {meta}
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
          onClick={() => openSheet("notes")}
        >
          {tr("settings.updates.seeNew")}
        </Button>
        <Button
          theme={theme}
          variant="primary"
          size="sm"
          fullWidth
          style={{ minHeight: TOUCH_TARGET_MIN }}
          onClick={() =>
            inFlight ? openSheet(inFlight) : void startDownload()
          }
        >
          {primary}
        </Button>
      </div>
    </section>
  );
}
