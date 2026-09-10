import { useState } from "react";
import type { Theme } from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";
import { Button } from "./Button";
import { RELEASES_PAGE_URL, type UpdateInfo } from "../store/updates";
import { Z } from "../styles/tokens";

type Phase = "idle" | "working" | "failed";

/** The only update UI.
 *
 *  On the auto channel it installs and relaunches; on the manual channel it
 *  opens the release page and the user installs by hand. One component for
 *  both, so there is one thing to translate, style and keep accessible —
 *  and the manual path cannot quietly rot from disuse, since three of the
 *  seven build targets are always on it. */
export function UpdateBanner({
  info,
  theme,
  onDismiss,
}: {
  info: UpdateInfo;
  theme: Theme;
  onDismiss: () => void;
}) {
  const { tr } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");

  async function act() {
    setPhase("working");
    try {
      if (info.channel === "manual") {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(RELEASES_PAGE_URL);
        onDismiss();
        return;
      }
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (!update) {
        // The manifest offered a version the plugin then declined — a
        // platform key we do not publish, or a signature it would not
        // accept. Say so and let them download instead of spinning.
        setPhase("failed");
        return;
      }
      await update.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      setPhase("failed");
    }
  }

  const failed = phase === "failed";
  const busy = phase === "working";
  const label = busy
    ? tr(info.channel === "auto" ? "update.downloading" : "update.opening")
    : failed || info.channel === "manual"
      ? tr("update.action.download")
      : tr("update.action.install");

  async function onAction() {
    // After a failed self-update the only useful action left is the download,
    // so the button switches channel rather than retrying what just failed.
    if (failed) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(RELEASES_PAGE_URL);
      onDismiss();
      return;
    }
    await act();
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        insetInlineStart: 16,
        insetInlineEnd: 16,
        bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        zIndex: Z.banner,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "12px 14px",
        borderRadius: 12,
        background: theme.chrome,
        color: theme.ink,
        border: `0.5px solid ${theme.ruleStrong}`,
        boxShadow: "0 10px 34px rgba(0,0,0,0.22)",
      }}
    >
      <span style={{ flex: 1, minWidth: 140, fontSize: 13, lineHeight: 1.45 }}>
        {failed
          ? tr("update.failed")
          : tr("update.available", { v: info.version })}
      </span>
      <Button theme={theme} variant="ghost" size="sm" onClick={onDismiss}>
        {tr("update.action.later")}
      </Button>
      <Button
        theme={theme}
        variant="primary"
        size="sm"
        loading={busy}
        disabled={busy}
        onClick={() => void onAction()}
      >
        {label}
      </Button>
    </div>
  );
}
