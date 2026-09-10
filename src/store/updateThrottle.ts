/** How long to wait between background checks. Once a day is plenty for an
 *  app that ships every few weeks, and keeps launch off the network. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Should we hit the network now?
 *
 *  `manual` is the "Check now" button, which bypasses both the toggle and the
 *  throttle: pressing it IS the consent the toggle otherwise withholds. */
export function shouldCheck({
  enabled,
  lastCheck,
  now,
  manual,
}: {
  enabled: boolean;
  lastCheck: number | undefined;
  now: number;
  manual: boolean;
}): boolean {
  if (manual) return true;
  if (!enabled) return false;
  if (lastCheck === undefined) return true;
  // A timestamp in the future means a clock change or a hand-edited file.
  // Treat it as never-checked rather than blocking checks indefinitely.
  if (lastCheck > now) return true;
  return now - lastCheck >= CHECK_INTERVAL_MS;
}
