// Dev-only harness for browser-verifying the fixed-layout reader without the
// Tauri runtime. PDF: pick a file (Playwright can drive the DOM input). DOCX:
// a "Sample DOCX" button feeds hand-written HTML straight into the paginator
// (createDocxPageSourceFromParts), so the pagination logic is verifiable with
// no .docx file. Served by vite dev at /harness.html; not in the prod build.

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../i18n/I18nProvider";
import { THEMES, resolveTheme, type ThemeKey } from "../../styles/tokens";
import { DEFAULT_TWEAKS } from "../../hooks/useTweaks";
import { setReduceMotionOverride } from "../../styles/motion";
import type { Tweaks } from "../../types/reader";
import { FixedPageReader } from "./FixedPageReader";
import { createPdfPageSourceFromBytes } from "./PdfPageSource";
import { createDocxPageSourceFromParts } from "./DocxPageSource";
import type { FixedPageSource } from "./FixedPageSource";
import type { FixedBook, Highlight } from "../../store/library";

interface Entry {
  book: FixedBook;
  makeSource: () => Promise<FixedPageSource>;
}

// A multi-page Arabic RTL sample: 3 headings (anchored) + enough paragraphs to
// span several pages, exercising pagination + heading→page outline mapping.
function sampleDocx(): { html: string; outline: { title: string; level: number; anchorId: string }[] } {
  const para =
    "حين تخطو للمرة الأولى إلى بوابة هذه المدرسة، لا يخطر ببالك أن الأمر أعقد مما يبدو. الجميع يبتسم، والجميع يبدو متساوياً، لكن تحت هذا السطح الهادئ تجري حساباتٌ لا تتوقف، وكل كلمة لها وزنها.";
  const chapters = [
    { id: "docx-h-0", title: "الفصل الأول: هيكل المجتمع" },
    { id: "docx-h-1", title: "الفصل الثاني: مدرسة الأحلام" },
    { id: "docx-h-2", title: "الفصل الثالث: طلاب الفصل" },
  ];
  let html = "";
  for (const c of chapters) {
    html += `<h2 id="${c.id}">${c.title}</h2>`;
    for (let i = 0; i < 14; i++) html += `<p>${para}</p>`;
  }
  const outline = chapters.map((c) => ({ title: c.title, level: 0, anchorId: c.id }));
  return { html, outline };
}

function Harness() {
  const [tweaks, setTweaks] = useState<Tweaks>(() => {
    const q = new URLSearchParams(location.search);
    return {
      ...DEFAULT_TWEAKS,
      theme: (q.get("theme") as Tweaks["theme"]) || "sepia",
      fixedFlow: (q.get("flow") as Tweaks["fixedFlow"]) || "scroll",
      fixedFit: (q.get("fit") as Tweaks["fixedFit"]) || "width",
      inkColor: q.get("ink") || DEFAULT_TWEAKS.inkColor,
      paperColor: q.get("paper") || DEFAULT_TWEAKS.paperColor,
    };
  });
  const [locale, setLocale] = useState<"ar" | "en">("ar");
  const [entry, setEntry] = useState<Entry | null>(null);
  const [layout, setLayout] = useState<"mobile" | "desktop">("desktop");
  const [status, setStatus] = useState("no file");
  const [highlights, setHighlights] = useState<Highlight[]>([]);

  // Reduced motion is ON by default so screenshot runs are deterministic;
  // append ?motion=1 to exercise the real enter/exit + page-turn animations.
  useEffect(() => {
    const on = new URLSearchParams(location.search).get("motion");
    setReduceMotionOverride(on === "1" ? "off" : "on");
  }, []);

  const setTweak = <K extends keyof Tweaks>(k: K, v: Tweaks[K]) =>
    setTweaks((prev) => ({ ...prev, [k]: v }));
  const themeKey = resolveTheme(tweaks.theme, false) as ThemeKey;
  const theme = THEMES[themeKey];

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (/\.docx$/i.test(f.name)) {
        setStatus("converting docx…");
        const { docxToFixedDoc } = await import("../../docx/toFixedDoc");
        const fixed = await docxToFixedDoc(bytes, f.name.replace(/\.docx$/i, ""));
        // Resolve image hrefs to blob URLs (no Tauri asset:// in the browser).
        const doc = new DOMParser().parseFromString(fixed.html, "text/html");
        const map = new Map(
          fixed.images.map((im) => [im.href, URL.createObjectURL(new Blob([im.bytes.slice().buffer]))]),
        );
        doc.querySelectorAll("img").forEach((img) => {
          const s = img.getAttribute("src");
          if (s && map.has(s)) img.setAttribute("src", map.get(s)!);
        });
        const html = doc.body.innerHTML;
        setEntry({
          book: { id: "h-docx-real", kind: "docx", title: fixed.title, author: "", dir: fixed.dir, outline: fixed.outline },
          makeSource: async () => {
            const src = await createDocxPageSourceFromParts({ html, dir: fixed.dir, outline: fixed.outline });
            setStatus(`docx (${fixed.dir}): ${src.pageCount} pages`);
            return src;
          },
        });
        return;
      }
      setStatus("loading pdf…");
      setEntry({
        book: { id: "h-pdf", kind: "pdf", title: "فصل النخبة — المجلد ١", author: "", pageCount: 0, outline: [] },
        makeSource: () => createPdfPageSourceFromBytes(bytes),
      });
      setStatus("pdf loaded");
    } catch (err) {
      setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function loadSampleDocx() {
    const { html, outline } = sampleDocx();
    setStatus("paginating docx…");
    setEntry({
      book: { id: "h-docx", kind: "docx", title: "مستند تجريبي", author: "", dir: "rtl", outline },
      makeSource: async () => {
        const src = await createDocxPageSourceFromParts({ html, dir: "rtl", outline });
        setStatus(`docx paginated: ${src.pageCount} pages`);
        return src;
      },
    });
  }

  return (
    <I18nProvider locale={locale}>
      <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "#1a1614", color: "#e9ddc7", zIndex: 100, fontFamily: "system-ui", fontSize: 12 }}>
          <input type="file" accept="application/pdf,.pdf" onChange={onFile} data-testid="pdf-input" />
          <button onClick={loadSampleDocx} data-testid="docx-btn">Sample DOCX</button>
          <button onClick={() => setLocale((l) => (l === "ar" ? "en" : "ar"))}>lang: {locale}</button>
          <button data-testid="layout-btn" onClick={() => setLayout((l) => (l === "mobile" ? "desktop" : "mobile"))}>layout: {layout}</button>
          <button data-testid="theme-btn" onClick={() => setTweak("theme", tweaks.theme === "dark" ? "sepia" : "dark")}>theme: {tweaks.theme}</button>
          <span data-testid="status">{status}</span>
        </div>
        <div style={{ position: "relative", flex: 1 }}>
          {entry && (
            <FixedPageReader
              key={entry.book.id}
              theme={theme}
              themeKey={themeKey}
              t={tweaks}
              setTweak={setTweak}
              book={entry.book}
              state={{ bookId: entry.book.id, currentChapter: 0, paragraphIndex: 0, highlights: [] }}
              highlights={highlights}
              onCreateHighlight={(h) =>
                setHighlights((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    chapter: 0,
                    paragraphIndex: 0,
                    charStart: 0,
                    charEnd: 0,
                    ts: Date.now(),
                    text: h.text,
                    color: h.color,
                    note: h.note,
                    groupId: h.groupId,
                    fixed: h.fixed,
                  },
                ])
              }
              onDeleteHighlight={(id) =>
                setHighlights((prev) => prev.filter((x) => x.id !== id))
              }
              onUpdateHighlightNote={(id, note) =>
                setHighlights((prev) =>
                  prev.map((x) =>
                    x.id === id ? { ...x, note: note.trim() || undefined } : x,
                  ),
                )
              }
              layout={layout}
              uiDir={locale === "ar" ? "rtl" : "ltr"}
              createSource={entry.makeSource}
              onBack={() => setStatus("(back)")}
            />
          )}
        </div>
      </div>
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
