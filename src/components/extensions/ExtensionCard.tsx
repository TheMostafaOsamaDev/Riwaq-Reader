// One extension in the manager: identity on the leading side, actions on
// the trailing side, and — whenever it is not simply working — a message
// underneath that names both the cause and the button that fixes it.
//
// Five states, distinguished by which actions the card offers:
//
//   not installed        Install
//   not installed, and
//     built for another
//     contract major     Install refused, "needs a newer Riwaq" inline
//   ok, no update        Remove
//   ok, update available Update + Remove
//   broken               Retry + Remove, load error inline
//   api-version          Remove, "needs a newer Riwaq" inline
//
// At most one filled button per card, and Remove is always last in the
// cluster and always `destructiveGhost`, so the destructive action is
// visually subordinate and spatially separated from the one the user
// probably wants. The cluster is pushed to the inline end with
// `marginInlineStart: auto` and never hand-flipped: the app runs
// `dir="rtl"` in Arabic and flexbox mirrors on its own, which keeps Remove
// last in reading order in both directions.

import type { CatalogEntry } from "../../extensions/catalog";
import { useI18n } from "../../i18n/useI18n";
import { API_VERSION } from "../../sources/types";
import type { Theme } from "../../styles/tokens";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { SourceIcon } from "../SourceIcon";

/** Mirrors registry.getExtensionStatus's return type. Declared here rather
 *  than imported so this component depends on the shape, not on the
 *  registry module — which is what lets the view inject a fake. */
export type ExtensionStatus = "ok" | "broken" | "api-version" | "missing";

/** Which action is currently running for this card. `update` covers Retry
 *  too: both re-download the bundle, so they share a spinner. */
export type CardAction = "install" | "update" | "remove";

interface Props {
  theme: Theme;
  entry: CatalogEntry;
  status: ExtensionStatus;
  /** The load error the registry captured, for `broken`. */
  loadError?: string;
  iconUrl?: string;
  busy: CardAction | null;
  /** Failure of the last action the user took here — shown in place of the
   *  load notice, because it is the newer news. */
  actionError?: string;
  onInstall: () => void;
  onUpdate: () => void;
  onRetry: () => void;
  onRemove: () => void;
}

// Every action is at least 44 CSS px tall: this ships on Android, where a
// 28px control is a miss as often as a hit.
const ACTION_STYLE = { minHeight: 44, minWidth: 44, paddingInline: 14 };

export function ExtensionCard({
  theme,
  entry,
  status,
  loadError,
  iconUrl,
  busy,
  actionError,
  onInstall,
  onUpdate,
  onRetry,
  onRemove,
}: Props) {
  const { tr } = useI18n();
  const installed = entry.installed;
  // "missing" means the registry has not listed this id yet — the moment
  // right after an install, before initExtensions() has re-run. Reading it
  // as broken would flash a red error on a card that is fine.
  const broken = installed && status === "broken";
  const apiMismatch = installed && status === "api-version";
  // The same gate loader.ts applies, one step earlier. An Available card
  // whose index entry declares another contract major will install
  // perfectly and then refuse to load — so it offered a plain Install that
  // could only end in a broken card. The index says so up front; say it up
  // front.
  const entryApiMismatch =
    !installed &&
    entry.entry !== undefined &&
    entry.entry.apiVersion !== API_VERSION;

  const notice =
    actionError ??
    (apiMismatch
      ? tr("extensions.apiVersionNotice")
      : entryApiMismatch
        ? tr("extensions.apiVersionAvailableNotice")
        : broken
          ? tr("extensions.brokenNotice", {
              error: loadError ?? tr("extensions.unknownError"),
            })
          : undefined);

  // Version numbers render raw and LTR — a semver is the same string in
  // every language, and pinning the direction stops bidi reordering from
  // putting the arrow between the wrong pair of numbers under RTL. Same
  // convention as the `v{version}` line on a source card.
  const installedVersion = entry.installedVersion ?? entry.version;
  const versionText =
    installed && entry.updateAvailable
      ? `v${installedVersion} → v${entry.version}`
      : `v${installed ? installedVersion : entry.version}`;

  return (
    <div
      role="listitem"
      data-testid={`extension-card-${entry.id}`}
      style={{
        background: theme.chrome,
        border: `0.5px solid ${theme.rule}`,
        borderRadius: 12,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          minHeight: 56,
        }}
      >
        <SourceIcon
          theme={theme}
          iconUrl={iconUrl}
          size={36}
          radius={9}
          glyphSize={18}
        />
        <div style={{ minWidth: 140, flex: 1 }}>
          <div
            title={entry.name}
            style={{
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {entry.name}
          </div>
          <div style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>
            {/* Only the version string is pinned LTR. Pinning the whole
                line would drag it to the left edge under RTL, away from
                the name it belongs to. */}
            <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
              {versionText}
            </span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginInlineStart: "auto",
            flexShrink: 0,
          }}
        >
          {!installed && (
            <Button
              theme={theme}
              variant="primary"
              size="sm"
              style={ACTION_STYLE}
              loading={busy === "install"}
              disabled={busy !== null || entryApiMismatch}
              title={
                entryApiMismatch
                  ? tr("extensions.apiVersionAvailableNotice")
                  : undefined
              }
              onClick={onInstall}
            >
              {tr("extensions.install")}
            </Button>
          )}
          {broken && (
            <Button
              theme={theme}
              variant="secondary"
              size="sm"
              style={ACTION_STYLE}
              loading={busy === "update"}
              disabled={busy !== null}
              onClick={onRetry}
            >
              {tr("extensions.retry")}
            </Button>
          )}
          {installed && !broken && entry.updateAvailable && (
            <Button
              theme={theme}
              variant="primary"
              size="sm"
              style={ACTION_STYLE}
              loading={busy === "update"}
              disabled={busy !== null}
              onClick={onUpdate}
            >
              {tr("extensions.update")}
            </Button>
          )}
          {installed && (
            <Button
              theme={theme}
              variant="destructiveGhost"
              size="sm"
              style={ACTION_STYLE}
              loading={busy === "remove"}
              disabled={busy !== null}
              onClick={onRemove}
            >
              {tr("extensions.remove")}
            </Button>
          )}
        </div>
      </div>
      {notice && (
        // Never colour alone: the tint carries an icon and a sentence, so
        // the state survives a colour-blind reader and a greyscale screen.
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginTop: 10,
            fontSize: 12,
            lineHeight: 1.5,
            color: theme.danger,
          }}
        >
          <Icon name="info" size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{notice}</span>
        </div>
      )}
    </div>
  );
}
