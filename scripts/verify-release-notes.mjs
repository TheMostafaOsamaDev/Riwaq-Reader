// pnpm verify:notes                  — every release-notes/*.json must be valid
// pnpm verify:notes --require 0.6.0  — …and 0.6.0's file must exist (releases)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { validateReleaseNotes } from "./release-notes.mjs";

const DIR = "release-notes";
const args = process.argv.slice(2);
const required =
  args[0] === "--require" ? args[1]?.replace(/^v/, "") : undefined;
const imageBytes = (name) => {
  const p = join(DIR, "img", name);
  return existsSync(p) ? statSync(p).size : undefined;
};

let failed = false;
const files = existsSync(DIR)
  ? readdirSync(DIR).filter((f) => /^\d+\.\d+\.\d+\.json$/.test(f))
  : [];
for (const f of files) {
  const version = f.replace(/\.json$/, "");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  } catch (e) {
    console.error(`✗ ${f}: not valid JSON (${e.message})`);
    failed = true;
    continue;
  }
  const errs = validateReleaseNotes(parsed, { version, imageBytes });
  if (errs.length) {
    failed = true;
    console.error(`✗ ${f}`);
    for (const e of errs) console.error(`    ${e}`);
  } else {
    console.log(`✓ ${f}`);
  }
}
if (required && !files.includes(`${required}.json`)) {
  console.error(
    `✗ release-notes/${required}.json is missing — every release needs its notes (English and Arabic).`,
  );
  failed = true;
}
process.exit(failed ? 1 : 0);
