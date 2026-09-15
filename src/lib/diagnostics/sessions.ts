// Session files on disk: $APPDATA/diagnostics/session-<n>.jsonl
//
// devLog truncated one file at every start, which loses the run that
// matters: a blank launch is only diagnosable from the NEXT launch, and by
// then the old truncate-on-start would have erased it. Keeping the last few
// runs is the difference between a log that describes the bug and one that
// describes the session where the user noticed it.

export const DIAG_DIR = "diagnostics";
/** How many past sessions survive. Three covers "it happened last time" and
 *  "it happened the time before" without unbounded disk use. */
export const RETAIN = 3;

const NAME = /^session-(\d+)\.jsonl$/;

export function sessionFileName(n: number): string {
  return `session-${n}.jsonl`;
}

export function parseSessionNumber(name: string): number | null {
  const m = NAME.exec(name);
  return m ? Number(m[1]) : null;
}

/** Oldest first. Numeric, because "session-10" sorts below "session-9" as a
 *  string and retention would then delete the newest file. */
export function sortSessions(existing: string[]): string[] {
  return existing
    .filter((n) => parseSessionNumber(n) !== null)
    .sort(
      (a, b) => (parseSessionNumber(a) ?? 0) - (parseSessionNumber(b) ?? 0),
    );
}

export function nextSessionNumber(existing: string[]): number {
  const nums = existing
    .map(parseSessionNumber)
    .filter((n): n is number => n !== null);
  return nums.length === 0 ? 1 : Math.max(...nums) + 1;
}

/** The files to remove so that at most `retain` remain. Oldest first. */
export function sessionsToDelete(
  existing: string[],
  retain = RETAIN,
): string[] {
  const sorted = sortSessions(existing);
  const excess = sorted.length - retain;
  return excess > 0 ? sorted.slice(0, excess) : [];
}
