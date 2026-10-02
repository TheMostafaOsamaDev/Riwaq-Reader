/** How long to wait between background checks. Once a day is plenty for an
 *  app that ships every few weeks, and keeps launch off the network. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Should we hit the network now?
 *
 *  The check is always on; only the throttle skips it. `manual` is the
 *  "Check now" button, which bypasses the throttle. */
export function shouldCheck({
  lastCheck,
  now,
  manual,
}: {
  lastCheck: number | undefined;
  now: number;
  manual: boolean;
}): boolean {
  if (manual) return true;
  if (lastCheck === undefined) return true;
  // A timestamp in the future means a clock change or a hand-edited file.
  // Treat it as never-checked rather than blocking checks indefinitely.
  if (lastCheck > now) return true;
  return now - lastCheck >= CHECK_INTERVAL_MS;
}
