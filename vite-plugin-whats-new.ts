// `virtual:whats-new`: this build's own release notes, their images, and
// the app version, available synchronously at startup with no network.
// Only the file for package.json's version is bundled — notes never
// accumulate across releases.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { IMAGE_NAME } from "./scripts/release-notes.mjs";

const ID = "virtual:whats-new";
const RESOLVED = `\0${ID}`;

export function whatsNew(): Plugin {
  return {
    name: "riwaq-whats-new",
    resolveId: (id) => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const version: string = JSON.parse(readFileSync("package.json", "utf8")).version;
      const file = resolve("release-notes", `${version}.json`);
      const head = `export const appVersion = ${JSON.stringify(version)};\n`;
      if (!existsSync(file)) return `${head}export const images = {};\nexport default null;\n`;
      this.addWatchFile(file);
      const notes = JSON.parse(readFileSync(file, "utf8"));
      // Each image once (a story may reuse the highlight's), and only a plain
      // file name: the validator checks this too, but a name that reaches an
      // import path here is never allowed to climb out of release-notes/img.
      const names: string[] = [
        ...new Set(
          [
            notes.highlight?.image,
            ...(notes.stories ?? []).map((s: { image?: string }) => s.image),
          ].filter((n): n is string => typeof n === "string"),
        ),
      ];
      for (const n of names) {
        if (!IMAGE_NAME.test(n)) this.error(`release-notes/${version}.json: bad image name ${JSON.stringify(n)}`);
      }
      const imports = names
        .map((n, i) => `import img${i} from ${JSON.stringify(resolve("release-notes/img", n))};`)
        .join("\n");
      const map = names.map((n, i) => `${JSON.stringify(n)}: img${i}`).join(", ");
      return `${imports}\n${head}export const images = { ${map} };\nexport default ${JSON.stringify(notes)};\n`;
    },
  };
}
