// THROWAWAY harness for eyeballing the reader's Contents panel without Tauri.
// Mounts DesktopReader over an in-memory Arabic novel with volume ranges, so
// the docked TOC, the volume accordion and the header controls can be
// screenshotted in a plain browser. Delete once verified.

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DesktopReader } from "./components/DesktopReader";
import { I18nProvider } from "./i18n/I18nProvider";
import { DEFAULT_TWEAKS } from "./hooks/useTweaks";
import { THEMES, type ThemeKey } from "./styles/tokens";
import type { EpubBook } from "./epub/types";
import type { BookState } from "./store/library";
import type { ActivePanel, TocVolume, Tweaks } from "./types/reader";
import "./styles/global.css";

const VOLUME_SIZES = [3, 12, 9, 14, 7, 11, 6, 15, 8, 10, 13, 9, 12, 7];
const BODY = [
  "«فانغ يوان ، سلِّم غو زيز ربيع الخريف بهدوء وسأعطيك موتًا سريعًا!»",
  "«أيها النذل العجوز فانغ ، توقف عن محاولة المقاومة بالفعل ، اجتمعت اليوم جميع الفصائل الكبرى للعدالة فقط لتدمير عشيرتك.»",
  "لقد كان استنتاجًا يقينيًا أنه سيموت هُنا.",
  "فهم فانغ يوان موقِفَه بوضوحٍ ، ولكن حتى في مواجهة الموت لم يتغيَر تعبيرَهُ ، كان هادئًا.",
  "كانت نظراتُهُ هادئةً ، وعيناهُ مِثلَ بِرَكِ المياه العميقة في بئرٍ ، عميقةٌ بما يكفي لكي تبدو بلا نهايةٍ.",
];

function buildBook(): { book: EpubBook; volumes: TocVolume[] } {
  const volumes: TocVolume[] = [];
  const chapters: EpubBook["chapters"] = [];
  let order = 0;
  VOLUME_SIZES.forEach((size, vi) => {
    volumes.push({
      id: `vol:${vi}`,
      title:
        vi === 0
          ? "المقدمة"
          : `أساطير رين زو — الجزء ${vi}`,
      start: order,
      end: order + size - 1,
    });
    for (let i = 0; i < size; i++) {
      chapters.push({
        id: `ch-${order}`,
        href: `ch-${order}.xhtml`,
        title:
          order === 0
            ? "المقدمة"
            : `الفصل ${order} – قَلبُ الشيطانِ لم يَندم أبدًا حتى في الموت`,
        paragraphs: Array.from({ length: 26 }, (_, p) => ({
          text: BODY[p % BODY.length],
        })),
        order,
      });
      order++;
    }
  });
  return {
    book: {
      id: "harness-book",
      title: "قَلبُ الشيطان لم يَندم أبدًا حتى في الموت",
      author: "القس المجنون",
      language: "ar",
      chapters,
    },
    volumes,
  };
}

const { book, volumes } = buildBook();

function Harness() {
  const [themeKey, setThemeKey] = useState<ThemeKey>("sepia");
  const [locale, setLocale] = useState<"ar" | "en">("ar");
  const [grouped, setGrouped] = useState(true);
  const [activePanel, setActivePanel] = useState<ActivePanel>("toc");
  const [currentChapter, setCurrentChapter] = useState(39);
  const [t, setT] = useState<Tweaks>({
    ...DEFAULT_TWEAKS,
    readingMode: "scroll",
  });

  const state: BookState = {
    bookId: book.id,
    currentChapter,
    paragraphIndex: 0,
    highlights: [],
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: 6,
          font: "12px system-ui",
          background: "#222",
          color: "#fff",
        }}
      >
        <button data-testid="theme" onClick={() => setThemeKey((k) => (k === "sepia" ? "dark" : k === "dark" ? "light" : "sepia"))}>
          theme: {themeKey}
        </button>
        <button data-testid="lang" onClick={() => setLocale((l) => (l === "ar" ? "en" : "ar"))}>
          lang: {locale}
        </button>
        <button data-testid="grouped" onClick={() => setGrouped((g) => !g)}>
          volumes: {grouped ? "on" : "off"}
        </button>
        <button data-testid="panel" onClick={() => setActivePanel((p) => (p ? null : "toc"))}>
          toc: {activePanel ?? "closed"}
        </button>
        <button data-testid="mode" onClick={() => setT((v) => ({ ...v, readingMode: v.readingMode === "scroll" ? "paginated-2" : "scroll" }))}>
          mode: {t.readingMode}
        </button>
        <span>ch {currentChapter}</span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <I18nProvider locale={locale}>
          <DesktopReader
            theme={THEMES[themeKey]}
            themeKey={themeKey}
            t={t}
            setTweak={(k, v) => setT((prev) => ({ ...prev, [k]: v }))}
            book={book}
            state={state}
            currentChapter={currentChapter}
            resumeParagraph={0}
            jumpNonce={0}
            onChapterChange={setCurrentChapter}
            onParagraphChange={() => {}}
            onCreateHighlight={() => {}}
            onDeleteHighlight={() => {}}
            onUpdateHighlightNote={() => {}}
            onJumpToHighlight={() => {}}
            tocVolumes={grouped ? volumes : undefined}
            activePanel={activePanel}
            setActivePanel={setActivePanel}
            onBack={() => {}}
          />
        </I18nProvider>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
