// The one network request Riwaq makes on its own behalf.
//
// It is a single unauthenticated GET for a static file: no identifiers, no
// library contents, no reading data. The Settings toggle turns it off
// entirely, and the app is fully functional without it. The README says so
// too — an app that advertises privacy and then quietly phones home, even
// harmlessly, spends trust it cannot re-earn.

import { isNewerVersion } from "./updateVersion";
import {
  resolveChannel,
  type ChannelEnv,
  type UpdateChannel,
} from "./updateChannel";

const REPO = "https://github.com/TheMostafaOsamaDev/Riwaq-Reader";

// The manifest itself is fetched from `plugins.updater.endpoints` in
// tauri.conf.json — `/releases/latest/download/latest.json`. `/releases/latest/`
// always resolves to the newest PUBLISHED, non-prerelease release, so the
// pipeline's draft release changes nothing in the world until it is published
// by hand. That keeps the existing verify-then-publish gate.

/** Where the manual channel sends people. */
export const RELEASES_PAGE_URL = `${REPO}/releases/latest`;

export interface UpdateInfo {
  version: string;
  notes?: string;
  /** Never "none": that channel is expressed by there being no UpdateInfo. */
  channel: Exclude<UpdateChannel, "none">;
}

type Invoke = (command: string) => Promise<unknown>;

/** Ask the Rust side for the manifest's version. Null on any failure.
 *
 *  This is deliberately NOT a `fetch()`. GitHub's release-asset download sends
 *  no CORS headers, so a webview fetch of the manifest is blocked on every
 *  platform — it was, in every build through 0.5.3, and because the failure
 *  was swallowed as "no update" nobody was ever offered one. The request is
 *  made in `src-tauri/src/updates.rs`, which reads the URL from the same
 *  `plugins.updater.endpoints` the installer uses. */
export async function fetchManifestVersion(
  invokeImpl: Invoke,
): Promise<{ version: string; notes?: string } | null> {
  try {
    const body: unknown = await invokeImpl("check_update_manifest");
    if (!body || typeof body !== "object") return null;
    const { version, notes } = body as { version?: unknown; notes?: unknown };
    if (typeof version !== "string" || version === "") return null;
    return { version, notes: typeof notes === "string" ? notes : undefined };
  } catch {
    return null;
  }
}

/** What one check found. "failed" is kept apart from "upToDate" on purpose:
 *  folding them together is how a check that could never succeed went
 *  unnoticed for five releases. "managed" is an install a store updates
 *  (Flatpak), where there is nothing for the app itself to offer. */
export type CheckResult =
  | { kind: "update"; info: UpdateInfo }
  | { kind: "upToDate"; current: string }
  | { kind: "managed" }
  | { kind: "failed" };

/** Classify a check. Only "update" ever shows the banner. */
export function resolveCheck({
  latest,
  current,
  env,
}: {
  latest: { version: string; notes?: string } | null;
  current: string;
  env: ChannelEnv;
}): CheckResult {
  if (!latest) return { kind: "failed" };
  if (resolveChannel(env) === "none") return { kind: "managed" };
  const info = evaluateUpdate({ latest, current, env });
  if (info) return { kind: "update", info };
  // An unknown running version is not "up to date" — it is a check that could
  // not finish, and saying otherwise would be the same lie as before.
  return current ? { kind: "upToDate", current } : { kind: "failed" };
}

/** Turn a fetched manifest into an offer, or nothing. */
export function evaluateUpdate({
  latest,
  current,
  env,
}: {
  latest: { version: string; notes?: string } | null;
  current: string;
  env: ChannelEnv;
}): UpdateInfo | null {
  if (!latest) return null;
  // isNewerVersion fails closed on an empty `current`, which is what
  // getVersion() yields if it throws — so an unknown running version offers
  // nothing rather than offering an update on every launch.
  if (!isNewerVersion(latest.version, current)) return null;
  const channel = resolveChannel(env);
  // Null rather than an UpdateInfo carrying "none": no info means the banner
  // never renders, so nothing downstream has to know this channel exists.
  if (channel === "none") return null;
  return { version: latest.version, notes: latest.notes, channel };
}
