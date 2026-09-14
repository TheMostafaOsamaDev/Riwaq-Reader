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

function renderLaunch(v: LaunchVerdict, i: number): string {
  const when = new Date(v.at).toISOString();
  const head = v.ok
    ? `launch ${i + 1} — ${when} — reached mounted in ${v.durationMs}ms`
    : `launch ${i + 1} — ${when} — BLANK LAUNCH: reached ${v.reached}, never reached ${v.stalledAt}`;
  const timeline = BOOT_MARKS.map((m) => {
    const at = v.marks[m];
    return at === undefined ? `  ${m} — MISSING` : `  ${m} +${at}ms`;
  }).join("\n");
  return `${head}\n${timeline}`;
}

export function buildBundle(input: BundleInput): string {
  const { app, launches, sessions, verbose } = input;
  const out: string[] = [];

  out.push("Riwaq diagnostics");
  out.push("=================");
  out.push(`version: ${app.version}`);
  out.push(`platform: ${app.platform}`);
  out.push(`detailed diagnostics: ${verbose ? "on" : "off"}`);
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
