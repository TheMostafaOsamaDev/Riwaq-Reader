// Dev-only measuring rig for the Contents panel on very long books.
//
// The question this answers: with Contents DOCKED it stays mounted while you
// read, so it re-renders on every chapter turn instead of being dismissed.
// How much does that actually cost on a 2000-chapter scraped novel, and is a
// windowing engine worth its risk over plain CSS containment?
//
// Renders the real TOCPanel — not a mock of it — over synthetic chapters, and
// times the two things that matter: first mount, and a re-render caused by
// advancing `currentChapter` (exactly what a chapter turn does).
//
// Nothing here is imported by the app. Open it with `pnpm dev` at
// /toc-harness.html.

import { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { TOCPanel } from "./TOCPanel";
import { I18nProvider } from "../i18n/I18nProvider";
import type { EpubChapter } from "../epub/types";
import type { TocVolume } from "../types/reader";
import { THEMES, FONT_STACKS } from "../styles/tokens";
import "../styles/global.css";

function makeChapters(n: number): EpubChapter[] {
  // Titles vary in length on purpose: a wrapped two-line row is the case that
  // breaks fixed-height virtualisation, so the rig has to contain some.
  const long =
    "The Long Road Out of the Sunken City and What Was Waiting on the Other Side";
  return Array.from({ length: n }, (_, i) => ({
    id: `ch-${i}`,
    href: `ch-${i}.xhtml`,
    title: i % 7 === 0 ? `${i + 1}. ${long}` : `Chapter ${i + 1}`,
    paragraphs: [],
    order: i,
  }));
}

function makeVolumes(n: number, per: number): TocVolume[] {
  const out: TocVolume[] = [];
  for (let start = 0; start < n; start += per) {
    out.push({
      id: `vol-${out.length}`,
      title: `Volume ${out.length + 1}`,
      start,
      end: Math.min(n - 1, start + per - 1),
    });
  }
  return out;
}

function Harness() {
  const [count, setCount] = useState(2000);
  const [grouped, setGrouped] = useState(false);
  const [current, setCurrent] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const chapters = useMemo(() => makeChapters(count), [count]);
  const volumes = useMemo(
    () => (grouped ? makeVolumes(count, 50) : undefined),
    [grouped, count],
  );

  const say = useCallback(
    (line: string) => setLog((prev) => [line, ...prev].slice(0, 12)),
    [],
  );

  // Time a commit by bracketing it with a forced style+layout read, so the
  // number includes React's reconciliation AND the browser's layout for the
  // rows — measuring only the React half would flatter every option equally.
  const timed = useCallback(
    (label: string, fn: () => void) => {
      const t0 = performance.now();
      fn();
      requestAnimationFrame(() => {
        document.body.getBoundingClientRect();
        const ms = performance.now() - t0;
        const rows = document.querySelectorAll("#toc-host button").length;
        say(`${label}: ${ms.toFixed(1)}ms · ${rows} buttons in DOM`);
      });
    },
    [say],
  );

  const theme = THEMES.sepia;

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        fontFamily: FONT_STACKS.sans,
        background: theme.bg,
        color: theme.ink,
      }}
    >
      <div
        id="toc-host"
        style={{ width: 340, display: "flex", borderInlineEnd: `1px solid ${theme.rule}` }}
      >
        {mounted && (
          <TOCPanel
            theme={theme}
            bookTitle="Synthetic Novel"
            chapters={chapters}
            currentChapter={current}
            volumes={volumes}
            width={340}
            onJump={setCurrent}
          />
        )}
      </div>

      <div style={{ flex: 1, padding: 24, display: "grid", gap: 12, alignContent: "start" }}>
        <h1 style={{ fontSize: 16, margin: 0 }}>Contents panel — cost on long books</h1>

        <label style={{ fontSize: 13 }}>
          Chapters:{" "}
          <input
            type="number"
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 0)}
            style={{ width: 90 }}
          />
        </label>

        <label style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={grouped}
            onChange={(e) => setGrouped(e.target.checked)}
          />{" "}
          group into volumes of 50
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => timed("mount", () => setMounted(true))}>
            Mount panel
          </button>
          <button onClick={() => timed("unmount", () => setMounted(false))}>
            Unmount
          </button>
          <button
            onClick={() =>
              timed("chapter turn", () => setCurrent((c) => c + 1))
            }
          >
            Chapter turn (re-render)
          </button>
        </div>

        <pre style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {log.join("\n")}
        </pre>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <I18nProvider locale="en">
    <Harness />
  </I18nProvider>,
);
