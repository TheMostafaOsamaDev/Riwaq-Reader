// release-notes/<v>.json → markdown for the GitHub release body.
//
// English only. The notes file still carries Arabic for everything, and the
// app still shows it: `whats-new.json` is a separate artifact, and the in-app
// sheet is where an Arabic reader actually reads the notes, in an interface
// already in their language. The GitHub release page is not that audience, and
// a second copy of every line there made the body twice as long to scroll for
// no one in particular.
import { readFileSync } from "node:fs";

const v = process.argv[2]?.replace(/^v/, "");
const n = JSON.parse(readFileSync(`release-notes/${v}.json`, "utf8"));
const label = { new: "New", improved: "Improved", fixed: "Fixed" };

const out = [];
// First, above everything: the release body is the only place a copy that
// cannot reach this release will ever be read from.
if (n.installNote) out.push(`> ⚠️ ${n.installNote.en}`, "");
if (n.highlight)
  out.push(`**${n.highlight.title.en}**: ${n.highlight.body.en}`, "");
for (const k of ["new", "improved", "fixed"]) {
  const items = n.items.filter((i) => i.kind === k);
  if (items.length)
    out.push(`### ${label[k]}`, ...items.map((i) => `- ${i.en}`), "");
}

process.stdout.write(`<!-- riwaq-notes -->\n${out.join("\n")}\n`);
