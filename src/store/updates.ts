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

/** `/releases/latest/` always resolves to the newest PUBLISHED, non-prerelease
 *  release, so the pipeline's draft release changes nothing in the world until
 *  it is published by hand. That keeps the existing verify-then-publish gate. */
export const MANIFEST_URL = `${REPO}/releases/latest/download/latest.json`;

/** Where the manual channel sends people. */
export const RELEASES_PAGE_URL = `${REPO}/releases/latest`;

export interface UpdateInfo {
  version: string;
  notes?: string;
  channel: UpdateChannel;
}

/** GET the manifest and read its version. Null on any failure — offline is the
 *  normal case here, not an exception worth reporting. */
export async function fetchManifestVersion(
  fetchImpl: typeof fetch,
): Promise<{ version: string; notes?: string } | null> {
  try {
    const res = await fetchImpl(MANIFEST_URL);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!body || typeof body !== "object") return null;
    const { version, notes } = body as { version?: unknown; notes?: unknown };
    if (typeof version !== "string" || version === "") return null;
    return { version, notes: typeof notes === "string" ? notes : undefined };
  } catch {
    return null;
  }
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
  return {
    version: latest.version,
    notes: latest.notes,
    channel: resolveChannel(env),
  };
}
