import { isNewerVersion } from "./updateVersion";

/** Show the after-update screen? Keyed only on versions, so it works no
 *  matter who performed the update: us, Orion, Obtainium, F-Droid, adb. */
export function shouldShowWhatsNew({
  bundled,
  lastSeen,
}: {
  bundled: string | null;
  lastSeen: string | undefined;
}): boolean {
  if (!bundled) return false;
  if (lastSeen === undefined) return true;
  return isNewerVersion(bundled, lastSeen);
}
