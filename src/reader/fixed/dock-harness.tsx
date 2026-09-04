// Dev-only rig for the DOCKED Contents panel in the FIXED-PAGE reader.
//
// The point of this one is parity. Docking was implemented once before and
// removed again because it existed only in the reflowable reader, so opening
// Contents shrank the column on an EPUB and floated over the page on a PDF.
// This rig mounts the real FixedPageReader so the PDF/DOCX side can be checked
// to behave the same way, without needing a real PDF or a Tauri backend.
//
// The page source is a stand-in that draws a labelled block per page: enough
// to prove the viewer gets the width left over beside the docked strip and
// re-fits when it changes, which is the layout question. It is NOT pdf.js, so
// nothing here says anything about real page rendering.
//
// Nothing here is imported by the app. Open it with `pnpm dev` at
// /fixed-dock-harness.html.

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FixedPageReader } from "./FixedPageReader";
import type { FixedPageSource } from "./FixedPageSource";
import { I18nProvider } from "../../i18n/I18nProvider";
import { DEFAULT_TWEAKS } from "../../hooks/useTweaks";
import { THEMES } from "../../styles/tokens";
import type { BookState } from "../../store/library";
import type { Tweaks, TocEntry } from "../../types/reader";
import "../../styles/global.css";

const PAGES = 240;

function makeOutline(): TocEntry[] {
  return Array.from({ length: 60 }, (_, i) => ({
    title:
      i % 5 === 0
        ? `${i + 1}. A Section Heading Long Enough To Wrap Onto Two Lines`
        : `Section ${i + 1}`,
    dest: { fmt: "page", page: i * 4 },
    level: i % 5 === 0 ? 0 : 1,
  }));
}

function fakeSource(): FixedPageSource {
  return {
    kind: "pdf",
    pageCount: PAGES,
    outline: makeOutline(),
    hasTextLayer: false,
    async pageSize() {
      return { w: 816, h: 1056 };
    },
    async renderPage(i, host) {
      // Synchronous fill — the viewer treats an empty host as "still needs
      // rendering" and would ask again every frame.
      host.textContent = `Page ${i + 1}`;
      Object.assign(host.style, {
        display: "grid",
        placeItems: "center",
        background: "#fff",
        color: "#111",
        font: "600 28px system-ui, sans-serif",
        border: "1px solid #ddd",
      });
    },
    destroy() {},
  };
}

function Harness() {
  const [t, setT] = useState<Tweaks>(DEFAULT_TWEAKS);
  const themeKey = t.theme === "system" ? "sepia" : t.theme;

  const state: BookState = {
    bookId: "harness-pdf",
    currentChapter: 0,
    paragraphIndex: 0,
    currentPage: 0,
    highlights: [],
  };

  return (
    <FixedPageReader
      theme={THEMES[themeKey] ?? THEMES.sepia}
      themeKey={themeKey}
      t={t}
      setTweak={(k, v) => setT((prev) => ({ ...prev, [k]: v }))}
      book={{
        id: "harness-pdf",
        title: "A Scanned Report",
        author: "Anon",
        format: "pdf",
      } as never}
      state={state}
      highlights={[]}
      onCreateHighlight={() => {}}
      onDeleteHighlight={() => {}}
      onUpdateHighlightNote={() => {}}
      layout="desktop"
      uiDir="ltr"
      createSource={async () => fakeSource()}
      onBack={() => {}}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <I18nProvider locale="en">
    <Harness />
  </I18nProvider>,
);
