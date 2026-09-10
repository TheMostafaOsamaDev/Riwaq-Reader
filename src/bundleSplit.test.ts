// Guards the code-split boundaries that keep startup cheap.
//
// Code splitting is invisible at runtime: if a static import creeps back in and
// quietly pulls a deferred view — or jszip — into the entry chunk, nothing
// breaks and no test fails. The app just gets slower to start, silently. These
// assertions are the only thing that notices.
//
// Measured on 2026-09-11 (isolated per-group compile+exec, median of 7, in each
// engine): the whole eager-parse saving available here is ~14 ms in Chromium
// (the Android WebView engine) and ~26 ms in WebKit. jszip alone is ~6 ms of
// that and is the only group with no shared-chunk overlap.
import { beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";
import react from "@vitejs/plugin-react";

interface BuiltChunk {
  file: string;
  isEntry: boolean;
  modules: string[];
}

/** Modules that must stay OFF the startup path, and why. */
const DEFERRED = [
  "src/components/Store.tsx",
  "src/components/NovelDetailView.tsx",
  "src/components/SourceStreamReader.tsx",
  "src/reader/fixed/FixedPageReader.tsx",
];

let chunks: BuiltChunk[];

function entryChunk(): BuiltChunk {
  const entries = chunks.filter((c) => c.isEntry);
  // A single-entry app. If this ever grows a second entry the assertions below
  // would silently check only one of them, so fail loudly instead.
  expect(entries).toHaveLength(1);
  return entries[0];
}

/** Every module in the build, whichever chunk it landed in. */
function allModules(): string[] {
  return chunks.flatMap((c) => c.modules);
}

beforeAll(async () => {
  const collected: BuiltChunk[] = [];
  await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      react(),
      {
        name: "collect-chunks",
        generateBundle(_options, bundle) {
          for (const [file, chunk] of Object.entries(bundle)) {
            if (chunk.type !== "chunk") continue;
            collected.push({
              file,
              isEntry: chunk.isEntry,
              modules: Object.keys(chunk.modules),
            });
          }
        },
      },
    ],
    build: {
      // Nothing is written to disk — the assertions read the in-memory bundle.
      write: false,
      reportCompressedSize: false,
    },
  });
  chunks = collected;
}, 120_000);

describe("bundle split", () => {
  it("builds a single entry chunk", () => {
    expect(entryChunk().modules.length).toBeGreaterThan(0);
  });

  it("keeps jszip off the startup path", () => {
    const eager = entryChunk().modules.filter((m) => m.includes("jszip"));
    expect(eager).toEqual([]);
  });

  it("still ships jszip somewhere, so the check above cannot pass vacuously", () => {
    expect(allModules().some((m) => m.includes("jszip"))).toBe(true);
  });

  it.each(DEFERRED)("keeps %s off the startup path", (mod) => {
    const eager = entryChunk().modules.filter((m) => m.includes(mod));
    expect(eager).toEqual([]);
  });

  it.each(DEFERRED)("still ships %s in some chunk", (mod) => {
    expect(allModules().some((m) => m.includes(mod))).toBe(true);
  });
});
