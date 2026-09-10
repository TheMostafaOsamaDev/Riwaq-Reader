/** Parse `major.minor.patch`, with an optional leading `v` and an optional
 *  prerelease suffix. Null for anything else — a truncated download or a
 *  captive-portal HTML page must never parse as a version. */
function parse(
  v: string,
): { parts: [number, number, number]; prerelease: boolean } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return {
    parts: [Number(m[1]), Number(m[2]), Number(m[3])],
    prerelease: m[4] !== undefined,
  };
}

/** Is `latest` a version worth offering to someone on `current`?
 *
 *  Fails CLOSED: anything unparseable returns false. The cost of a missed
 *  update is one more launch before we notice; the cost of a bogus one is a
 *  user chasing a version that does not exist. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i];
  }
  // Same numbers: a prerelease is older than its release, never newer.
  return b.prerelease && !a.prerelease;
}
