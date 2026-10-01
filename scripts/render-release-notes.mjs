// release-notes/<v>.json → markdown for the GitHub release body. English
// first, then Arabic (RTL via the dir attribute GitHub preserves).
import { readFileSync } from "node:fs";

const v = process.argv[2]?.replace(/^v/, "");
const n = JSON.parse(readFileSync(`release-notes/${v}.json`, "utf8"));
const label = {
  new: ["New", "جديد"],
  improved: ["Improved", "تحسينات"],
  fixed: ["Fixed", "إصلاحات"],
};
const section = (lang, idx) => {
  const out = [];
  if (n.highlight)
    out.push(`**${n.highlight.title[lang]}**: ${n.highlight.body[lang]}`, "");
  for (const k of ["new", "improved", "fixed"]) {
    const items = n.items.filter((i) => i.kind === k);
    if (items.length)
      out.push(`### ${label[k][idx]}`, ...items.map((i) => `- ${i[lang]}`), "");
  }
  return out.join("\n");
};
process.stdout.write(
  `<!-- riwaq-notes -->\n${section("en", 0)}\n<div dir="rtl">\n\n${section("ar", 1)}\n</div>\n\n`,
);
