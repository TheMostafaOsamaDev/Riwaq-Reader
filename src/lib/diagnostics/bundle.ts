// The export document.
//
// Written for someone reading it cold with no other context, which means
// the verdict comes first and the raw events come last. A blank launch is
// called out by name at the top rather than left to be inferred from a
// missing line in a timeline.

import { BOOT_MARKS, type LaunchVerdict } from "./breadcrumbs";

export interface BundleInput {
  app: { version: string; platform: string; ua: string };
  verbose: boolean;
  launches: LaunchVerdict[];
  sessions: { name: string; lines: string[] }[];
}

export function bundleFileName(date: Date): string {
  const iso = date.toISOString().slice(0, 10);
  return `riwaq-diagnostics-${iso}.txt`;
}

/**
 * The blank launches that are only visible in the retained session logs.
 *
 * `launches` holds at most ONE verdict, because index.html keeps a single
 * previous boot record and SettingsPage passes `readPreviousLaunch()` alone.
 * So three launches — blank, then two healthy ones — leave the live verdict
 * healthy while the middle launch's own `previousLaunchBlank` event still
 * sits in a retained session file further down this very document. Counting
 * only `launches` makes the one line a cold reader is told to trust say
 * "0 blank" with the evidence to the contrary pasted below it.
 *
 * The dedupe matters as much as the count. The current session records a
 * `previousLaunchBlank` built from the SAME boot record `readPreviousLaunch`
 * returns, so without matching one logged entry per live blank verdict, the
 * ordinary case (last launch was blank, export now) would report it twice.
 */
function extraBlankLaunches(
  launches: LaunchVerdict[],
  sessions: { lines: string[] }[],
): number {
  const logged: {
    reached: unknown;
    stalledAt: unknown;
    durationMs: unknown;
  }[] = [];
  for (const s of sessions) {
    for (const line of s.lines) {
      // Cheap reject first: most lines are not this event, and every line
      // would otherwise be JSON.parsed on every export.
      if (!line.includes('"previousLaunchBlank"')) continue;
      try {
        const ev = JSON.parse(line) as { kind?: string; data?: unknown };
        if (ev?.kind !== "previousLaunchBlank") continue;
        const d = (ev.data ?? {}) as Record<string, unknown>;
        logged.push({
          reached: d.reached ?? null,
          stalledAt: d.stalledAt ?? null,
          durationMs: d.durationMs ?? null,
        });
      } catch {
        // A half-written tail line is not worth failing the summary over.
      }
    }
  }

  for (const v of launches.filter((l) => !l.ok)) {
    const i = logged.findIndex(
      (l) =>
        l.reached === v.reached &&
        l.stalledAt === v.stalledAt &&
        l.durationMs === v.durationMs,
    );
    if (i >= 0) logged.splice(i, 1);
  }
  return logged.length;
}

function renderLaunch(v: LaunchVerdict, i: number): string {
  const when = new Date(v.at).toISOString();
  const reachedLabel = v.reached ?? "nothing";
  const head = v.ok
    ? `launch ${i + 1} — ${when} — reached mounted in ${v.durationMs}ms`
    : `launch ${i + 1} — ${when} — BLANK LAUNCH: reached ${reachedLabel}, never reached ${v.stalledAt}`;
  const timeline = BOOT_MARKS.map((m) => {
    const at = v.marks[m];
    return at === undefined ? `  ${m} — MISSING` : `  ${m} +${at}ms`;
  }).join("\n");
  return `${head}\n${timeline}`;
}

export function buildBundle(input: BundleInput): string {
  const { app, launches, sessions, verbose } = input;
  const out: string[] = [];
  const blankCount = launches.filter((v) => !v.ok).length;
  const extraBlank = extraBlankLaunches(launches, sessions);
  const totalBlank = blankCount + extraBlank;

  out.push("Riwaq diagnostics");
  out.push("=================");
  out.push(`version: ${app.version}`);
  out.push(`platform: ${app.platform}`);
  out.push(`detailed diagnostics: ${verbose ? "on" : "off"}`);
  out.push(
    `launches: ${launches.length} recorded, ${blankCount} blank` +
      (extraBlank > 0
        ? ` (+${extraBlank} more blank in the retained session logs)`
        : ""),
  );
  if (totalBlank > 0) {
    // Two shapes on purpose. With nothing but the live verdicts there is no
    // provenance to disambiguate and the plain sentence reads best; once the
    // session logs contribute, the banner has to say which half came from
    // where, or a reader cannot reconcile it with the "Launches" section
    // directly below — that section only ever lists `launches`.
    out.push(
      extraBlank === 0
        ? `*** ${blankCount} OF ${launches.length} LAUNCHES FAILED TO REACH THE SCREEN ***`
        : `*** ${totalBlank} BLANK ${totalBlank === 1 ? "LAUNCH" : "LAUNCHES"} — ${blankCount} OF THE ${launches.length} RECORDED BELOW, ${extraBlank} MORE REPORTED IN THE RETAINED SESSION LOGS ***`,
    );
  }
  out.push(`user agent: ${app.ua}`);
  out.push("");

  out.push("Launches");
  out.push("--------");
  if (launches.length === 0) {
    out.push("no launches recorded");
  } else {
    out.push(launches.map(renderLaunch).join("\n\n"));
  }
  out.push("");

  out.push("Sessions");
  out.push("--------");
  if (sessions.length === 0) {
    out.push("no session logs retained");
  } else {
    for (const s of sessions) {
      out.push(`--- ${s.name} (${s.lines.length} events)`);
      out.push(s.lines.join("\n"));
      out.push("");
    }
  }

  return out.join("\n");
}
