// Dev-only harness for browser-verifying the ImportDetailsDialog with real
// cover candidates (PDF page thumbnails / DOCX embedded images) — no Tauri.
// Stages the picked file, then renders the dialog with total=2 so the queue
// controls (Skip / Skip the rest) are exercised. onConfirm/onSkip just log +
// close; commit() is never called (it needs the Tauri fs). Served by vite dev
// at /import-harness.html; not in the prod build.

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../i18n/I18nProvider";
import { THEMES, resolveTheme, type ThemeKey } from "../styles/tokens";
import { setReduceMotionOverride } from "../styles/motion";
import { ImportDetailsDialog } from "./ImportDetailsDialog";
import { stageFixedImport, type FixedImportDraft } from "../store/fixedImportStage";

function pickImage(): Promise<{ bytes: Uint8Array; ext: string } | null> {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      const bytes = new Uint8Array(await f.arrayBuffer());
      const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
      resolve({ bytes, ext });
    };
    inp.click();
  });
}

function fmtAr(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
}

function Harness() {
  const [draft, setDraft] = useState<FixedImportDraft | null>(null);
  const [status, setStatus] = useState("no file");
  const themeKey = resolveTheme("sepia", false) as ThemeKey;
  const theme = THEMES[themeKey];
  setReduceMotionOverride("on");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setStatus("staging…");
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const d = await stageFixedImport(bytes, f.name);
      setDraft(d);
      setStatus(`staged ${d.kind}: ${d.candidates.length} candidates`);
    } catch (err) {
      setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <I18nProvider locale="ar">
      <div style={{ position: "fixed", inset: 0, background: theme.bg }}>
        <div style={{ padding: 10, display: "flex", gap: 10, alignItems: "center", background: "#1a1614", color: "#e9ddc7", fontFamily: "system-ui", fontSize: 12 }}>
          <input type="file" accept=".pdf,.docx" onChange={onFile} data-testid="file-input" />
          <button onClick={() => setDraft(null)}>close</button>
          <span data-testid="status">{status}</span>
        </div>
        {draft && (
          <ImportDetailsDialog
            theme={theme}
            draft={draft}
            index={0}
            total={2}
            busy={false}
            onConfirm={(title, cover) => {
              setStatus(`confirm: "${title}" cover=${JSON.stringify(cover.kind)}`);
              setDraft(null);
            }}
            onSkip={() => {
              setStatus("skip");
              setDraft(null);
            }}
            onSkipRest={() => {
              setStatus("skip rest");
              setDraft(null);
            }}
            onCancel={() => {
              setStatus("cancel");
              setDraft(null);
            }}
            pickCustomImage={pickImage}
            fmt={fmtAr}
          />
        )}
      </div>
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
