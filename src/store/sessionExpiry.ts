// "This source needs verifying again" notification.
//
// Lives in its own module rather than in downloadNotifier because that
// one already imports downloadQueue, and the queue is what needs to fire
// this — routing it through downloadNotifier would close an import cycle.
// Depends only on the notifier's transport, which imports nothing local.

import { makeTr, type Locale } from "../i18n";
import {
  DOWNLOAD_REAUTH_ID,
  pushDownloadNotification,
} from "./downloadNotifier/transport";

/** Marker the Rust session transport prefixes onto its error when an
 *  origin's browser check has lapsed and re-clearing it needs the user.
 *  Kept in sync with `SESSION_EXPIRED` in src-tauri/src/sources.rs. */
const SESSION_EXPIRED_MARKER = "SESSION_EXPIRED:";

/** Mirrors the identically-named helper in the source extensions: this
 *  module runs outside the component tree, so it reads the lang
 *  attribute App.tsx keeps in sync rather than useI18n(). */
function currentUiLocale(): Locale {
  if (typeof document !== "undefined" && document.documentElement.lang === "ar") {
    return "ar";
  }
  return "en";
}

/** True when a job failed because a source's browser session went stale
 *  rather than for an ordinary network reason. */
export function isSessionExpiredError(message: string): boolean {
  return message.includes(SESSION_EXPIRED_MARKER);
}

/** Fired at most once per host per run, so a stalled batch of chapters
 *  can't put one notification per chapter in the tray. */
const reauthNotified = new Set<string>();

/** Tell the user a source needs verifying again. Downloads run in the
 *  background — often with the app not in front — so a queue that stalls
 *  on a lapsed session is otherwise invisible. */
export async function notifySessionExpired(message: string): Promise<void> {
  const host = message.match(/SESSION_EXPIRED:\s*(\S+)/)?.[1] ?? "the source";
  if (reauthNotified.has(host)) return;
  reauthNotified.add(host);
  const tr = makeTr(currentUiLocale());
  await pushDownloadNotification({
    id: DOWNLOAD_REAUTH_ID,
    title: tr("status.notif.reauthTitle"),
    body: tr("status.notif.reauthBody", { host }),
    progress: 0,
    max: 0,
    ongoing: false,
  });
}

/** Re-arm the notice once downloads are flowing again, so a later lapse
 *  notifies afresh instead of staying silent for the rest of the run. */
export function resetSessionExpiredNotices(): void {
  reauthNotified.clear();
}
