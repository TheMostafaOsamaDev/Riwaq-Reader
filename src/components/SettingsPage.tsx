// Full Settings page — a top-level view (peer of Library/Reader), not a dialog.
// Opened from the Library sidebar/mobile nav and from the reader's quick-panel
// ("All settings"). Back returns to wherever it was opened from.
//
// Layout: a single centered column of grouped sections built from the shared
// primitives in SettingsSection.tsx, so its Appearance/Reading controls are the
// exact same components the reader's quick-panel renders — no drift, one
// `Tweaks` source of truth. Theme- and RTL-aware.

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { BrandMark } from "./BrandMark";
import { Toast, type ToastMessage } from "./Toast";
import { ConfirmDialog } from "./ConfirmDialog";
import { AnimatedDialog } from "./AnimatedDialog";
import {
  ActionRow,
  Field,
  LanguageField,
  ReadingControls,
  SectionHeader,
  SegRow,
  ThemeField,
  UiFontField,
} from "./SettingsSection";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import {
  FONT_STACKS,
  type Theme,
  type ThemeKey,
} from "../styles/tokens";
import type { Tweaks } from "../types/reader";
import type { UiFontKey } from "../styles/tokens";
import type { UiLangPref } from "../i18n";
import { useI18n } from "../i18n/useI18n";

const REPO_URL = "https://github.com/TheMostafaOsamaDev/Riwaq-ebook-reader";
const LICENSE_URL =
  "https://github.com/TheMostafaOsamaDev/Riwaq-ebook-reader/blob/main/LICENSE";

interface Props {
  theme: Theme;
  themeKey: ThemeKey;
  t: Tweaks;
  setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
  applyTweaks: (partial: Partial<Tweaks>) => void;
  layout: "mobile" | "desktop";
  onClose: () => void;
}

export function SettingsPage({
  theme,
  themeKey,
  t,
  setTweak,
  applyTweaks,
  layout,
  onClose,
}: Props) {
  const { tr, locale } = useI18n();
  const isMobile = layout === "mobile";
  const isAr = locale === "ar";
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [version, setVersion] = useState<string>("");

  useEffect(() => {
    let alive = true;
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then((v) => {
        if (alive) setVersion(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const notify = (kind: ToastMessage["kind"], text: string) =>
    setToast({ id: Date.now(), kind, text });

  const exportSettings = async () => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: "leaflet-settings.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return; // cancelled
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, JSON.stringify(t, null, 2));
      notify("info", tr("settings.exportDone"));
    } catch (e) {
      console.error("settings export failed", e);
      notify("error", tr("settings.exportError"));
    }
  };

  const importSettings = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path || typeof path !== "string") return; // cancelled
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const raw = await readTextFile(path);
      const parsed = JSON.parse(raw) as Partial<Tweaks>;
      if (!parsed || typeof parsed !== "object") throw new Error("not an object");
      applyTweaks(parsed);
      notify("info", tr("settings.importDone"));
    } catch (e) {
      console.error("settings import failed", e);
      notify("error", tr("settings.importError"));
    }
  };

  const openExternal = async (url: string) => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch (e) {
      console.error("open url failed", e);
    }
  };

  const confirmReset = () => {
    applyTweaks(DEFAULT_TWEAKS);
    setResetOpen(false);
  };

  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      style={{
        width: "100%",
        height: "100%",
        background: theme.bg,
        color: theme.ink,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: FONT_STACKS.sans,
        ...(isMobile
          ? {
              paddingTop: "env(safe-area-inset-top, 0px)",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
              paddingLeft: "env(safe-area-inset-left, 0px)",
              paddingRight: "env(safe-area-inset-right, 0px)",
              boxSizing: "border-box",
            }
          : null),
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 18px 14px",
          borderBottom: `0.5px solid ${theme.rule}`,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onClose}
          aria-label={tr("common.back")}
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            border: `0.5px solid ${theme.rule}`,
            background: theme.bg,
            color: theme.ink,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon name="arrowL" size={16} className="rtl-flip-x" />
        </button>
        <h1
          style={{
            // Follows the selectable UI font (not the editorial serif) so the
            // page title reflects the user's chosen interface font.
            fontFamily: FONT_STACKS.sans,
            fontWeight: 600,
            fontSize: 22,
            margin: 0,
            letterSpacing: "-0.01em",
          }}
        >
          {tr("sidebar.settings")}
        </h1>
      </div>

      {/* Scroll body */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "20px 14px 48px" }}>
          <Section theme={theme} icon={<Icon name="sun" size={13} />} title={tr("settings.section.appearance")}>
            <LanguageField
              theme={theme}
              value={t.uiLang}
              onChange={(v: UiLangPref) => setTweak("uiLang", v)}
            />
            <UiFontField
              theme={theme}
              value={t.uiFont}
              onChange={(v: UiFontKey) => setTweak("uiFont", v)}
            />
            <ThemeField theme={theme} pref={t.theme} onChange={(p) => setTweak("theme", p)} />
          </Section>

          <Section theme={theme} icon={<Icon name="type" size={13} />} title={tr("settings.section.reading")}>
            <ReadingControls
              theme={theme}
              t={t}
              setTweak={setTweak}
              mobile={isMobile}
              showPageTurn={!isMobile}
            />
          </Section>

          <Section theme={theme} icon={<Icon name="settings" size={13} />} title={tr("settings.section.behavior")}>
            <Field label={tr("settings.startupView")} theme={theme}>
              <SegRow<Tweaks["startupView"]>
                theme={theme}
                value={t.startupView}
                onChange={(v) => setTweak("startupView", v)}
                options={[
                  { value: "library", label: tr("settings.startup.library") },
                  { value: "resume", label: tr("settings.startup.resume") },
                ]}
              />
            </Field>
            <Field label={tr("settings.confirmDelete")} theme={theme}>
              <SegRow<"on" | "off">
                theme={theme}
                value={t.confirmDelete ? "on" : "off"}
                onChange={(v) => setTweak("confirmDelete", v === "on")}
                options={[
                  { value: "on", label: tr("settings.on") },
                  { value: "off", label: tr("settings.off") },
                ]}
              />
            </Field>
            <Field label={tr("settings.reduceMotion")} theme={theme}>
              <SegRow<Tweaks["reduceMotion"]>
                theme={theme}
                value={t.reduceMotion}
                onChange={(v) => setTweak("reduceMotion", v)}
                options={[
                  { value: "auto", label: tr("settings.reduceMotion.auto") },
                  { value: "on", label: tr("settings.on") },
                  { value: "off", label: tr("settings.off") },
                ]}
              />
            </Field>
          </Section>

          <Section theme={theme} icon={<Icon name="download" size={13} />} title={tr("settings.section.downloads")}>
            <Field
              label={tr("settings.maxConcurrentDownloads", { n: t.maxConcurrentDownloads })}
              theme={theme}
            >
              <input
                type="range"
                aria-label={tr("settings.maxConcurrentDownloads", { n: t.maxConcurrentDownloads })}
                min={1}
                max={5}
                step={1}
                value={t.maxConcurrentDownloads}
                onChange={(e) => setTweak("maxConcurrentDownloads", +e.target.value)}
                style={{ width: "100%", color: theme.ink }}
              />
            </Field>
            <Field label={tr("settings.wifiOnly")} theme={theme}>
              <SegRow<"on" | "off">
                theme={theme}
                value={t.wifiOnlyDownloads ? "on" : "off"}
                onChange={(v) => setTweak("wifiOnlyDownloads", v === "on")}
                options={[
                  { value: "on", label: tr("settings.on") },
                  { value: "off", label: tr("settings.off") },
                ]}
              />
              <p style={{ margin: "8px 2px 0", fontSize: 10.5, color: theme.muted, lineHeight: 1.5 }}>
                {tr("settings.wifiOnly.hint")}
              </p>
            </Field>
          </Section>

          <Section theme={theme} icon={<Icon name="doc" size={13} />} title={tr("settings.section.data")}>
            <ActionRow
              theme={theme}
              icon={<Icon name="download" size={16} />}
              label={tr("settings.exportSettings")}
              onClick={exportSettings}
            />
            <ActionRow
              theme={theme}
              icon={<Icon name="folder" size={16} />}
              label={tr("settings.importSettings")}
              onClick={importSettings}
            />
            <ActionRow
              theme={theme}
              icon={<Icon name="trash" size={16} />}
              label={tr("settings.resetSettings")}
              onClick={() => setResetOpen(true)}
              danger
            />
          </Section>

          <Section theme={theme} icon={<Icon name="info" size={13} />} title={tr("settings.section.about")}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                padding: "20px 18px 18px",
                borderBottom: `0.5px solid ${theme.rule}`,
              }}
            >
              <BrandMark themeKey={themeKey} size={56} />
              <span style={{ fontSize: 12, color: theme.muted, textAlign: "center" }}>
                {tr("settings.about.tagline")}
              </span>
              {version && (
                <span style={{ fontSize: 11.5, color: theme.muted }}>
                  {tr("settings.about.version", { n: version })}
                </span>
              )}
            </div>
            <ActionRow
              theme={theme}
              icon={<Icon name="globe" size={16} />}
              label={tr("settings.about.sourceCode")}
              onClick={() => void openExternal(REPO_URL)}
              trailing={<Icon name="chevronR" size={16} className="rtl-flip-x" style={{ opacity: 0.5 }} />}
            />
            <ActionRow
              theme={theme}
              icon={<Icon name="doc" size={16} />}
              label={tr("settings.about.license")}
              onClick={() => void openExternal(LICENSE_URL)}
              trailing={<Icon name="chevronR" size={16} className="rtl-flip-x" style={{ opacity: 0.5 }} />}
            />
          </Section>
        </div>
      </div>

      <Toast theme={theme} toast={toast} onDismiss={() => setToast(null)} />
      <AnimatedDialog open={resetOpen} onScrimClick={() => setResetOpen(false)} zIndex={300}>
        {resetOpen && (
          <ConfirmDialog
            theme={theme}
            title={tr("settings.reset.confirmTitle")}
            message={tr("settings.reset.confirmBody")}
            confirmLabel={tr("settings.reset.confirmCta")}
            cancelLabel={tr("common.cancel")}
            onConfirm={confirmReset}
            onCancel={() => setResetOpen(false)}
          />
        )}
      </AnimatedDialog>
    </div>
  );
}

/** A titled group: a header label over a bordered block of Fields. */
function Section({
  theme,
  title,
  icon,
  children,
}: {
  theme: Theme;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={{ marginBottom: 26 }}>
      <SectionHeader theme={theme} label={title} icon={icon} />
      <div
        style={{
          background: theme.paper,
          borderRadius: 12,
          overflow: "hidden",
          border: `0.5px solid ${theme.rule}`,
        }}
      >
        {children}
      </div>
    </section>
  );
}
