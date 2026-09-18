// The banner a saved novel shows when the extension behind it can't be used.
//
// The page underneath it is the normal novel page, rendered from the
// snapshot on disk — title, description, cover, chapter list, downloads.
// This says why the online half of it (new downloads, refreshing the
// listing, streaming an undownloaded chapter) is unavailable, and offers
// the one thing that fixes it.
//
// Deliberately NOT animated in: a webview here has twice left content
// permanently invisible behind a mount keyframe, and a notice that
// sometimes doesn't paint is worse than no notice at all.

import type { MsgKey } from "../../i18n";
import { useI18n } from "../../i18n/useI18n";
import { openExtensionsManager } from "../../store/uiIntents";
import type { Theme } from "../../styles/tokens";
import { Button } from "../Button";
import { Icon } from "../Icon";

/** The registry statuses that mean "this source cannot be used right now".
 *  Mirrors sources/registry.ts's `Status` minus "ok". */
export type ExtensionProblem = "missing" | "broken" | "api-version";

export interface ExtensionNoticeCopy {
  titleKey: MsgKey;
  bodyKey: MsgKey;
}

/** Which copy a given problem gets. A removed extension and one that is
 *  installed-but-failing are different situations with different fixes
 *  (install it again vs retry/reinstall vs update the app), so they do not
 *  share a sentence. Pure + exported so the mapping is testable without a
 *  DOM. */
export function extensionNoticeCopy(
  problem: ExtensionProblem,
): ExtensionNoticeCopy {
  switch (problem) {
    case "broken":
      return {
        titleKey: "novel.offline.brokenTitle",
        bodyKey: "novel.offline.brokenBody",
      };
    case "api-version":
      return {
        titleKey: "novel.offline.apiVersionTitle",
        bodyKey: "novel.offline.apiVersionBody",
      };
    case "missing":
      return {
        titleKey: "novel.offline.missingTitle",
        bodyKey: "novel.offline.missingBody",
      };
  }
}

export interface ExtensionNoticeProps {
  theme: Theme;
  layout: "desktop" | "mobile";
  problem: ExtensionProblem;
  /** The extension's display name when the app still knows it; its id
   *  otherwise — an uninstalled extension took its manifest with it. */
  sourceName: string;
  /** Loader message for the "broken" case. Interpolated into the body. */
  error?: string;
}

export function ExtensionNotice({
  theme,
  layout,
  problem,
  sourceName,
  error,
}: ExtensionNoticeProps) {
  const { tr } = useI18n();
  const { titleKey, bodyKey } = extensionNoticeCopy(problem);
  const isMobile = layout === "mobile";
  return (
    <div
      // "status", not "alert": this is the standing condition of the page,
      // present from its first frame, not something that just happened.
      role="status"
      style={{
        margin: isMobile ? "0 18px 4px" : "0 40px 4px",
        padding: isMobile ? "14px 16px" : "16px 18px",
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "stretch" : "center",
        gap: 14,
        background: theme.chrome,
        border: `0.5px solid ${theme.ruleStrong}`,
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", gap: 12, flex: 1, minWidth: 0 }}>
        {/* The icon is the non-colour half of the signal — the banner must
            not rest on its tint alone. */}
        <Icon
          name="info"
          size={16}
          style={{ flexShrink: 0, marginBlockStart: 2, color: theme.ink }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: theme.ink }}>
            {tr(titleKey, { source: sourceName })}
          </div>
          <div
            style={{
              fontSize: 12.5,
              lineHeight: 1.55,
              color: theme.muted,
              marginBlockStart: 4,
            }}
          >
            {tr(bodyKey, {
              source: sourceName,
              error: error ?? tr("extensions.unknownError"),
            })}
          </div>
        </div>
      </div>
      <Button
        theme={theme}
        variant="secondary"
        onClick={openExtensionsManager}
        leadingIcon={<Icon name="layers" size={14} />}
        // 44px: this ships on Android, where the button is a touch target.
        style={{ minHeight: 44, flexShrink: 0, background: theme.bg }}
      >
        {tr("novel.offline.openExtensions")}
      </Button>
    </div>
  );
}
