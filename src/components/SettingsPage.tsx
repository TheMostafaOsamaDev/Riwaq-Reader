// Full Settings page — a top-level view (peer of Library/Reader), not a dialog.
// Opened from the Library sidebar/mobile nav and from the reader's quick-panel.
//
// Layout:
//  - Desktop: a left rail matching the app sidebar's chrome. Opening settings
//    slides the category items in (the "morph"); the content pane shows the
//    active category and slides when you switch. A scoped search box filters
//    settings across categories.
//  - Mobile: a drill-down — a category list; tapping slides its page in with a
//    back arrow. Search at the list level filters across categories.
// Controls are the exact same components the reader quick-panel renders
// (SettingsSection), so nothing drifts and everything edits one Tweaks source.

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconProps } from "./Icon";
import { BrandMark } from "./BrandMark";
import { Toast, type ToastMessage } from "./Toast";
import { ConfirmDialog } from "./ConfirmDialog";
import { AnimatedDialog } from "./AnimatedDialog";
import {
  ActionRow,
  CATEGORY_META,
  CATEGORY_ORDER,
  Field,
  LanguageField,
  SectionHeader,
  SegRow,
  Slider,
  ThemeField,
  readingItems,
  renderEntries,
  type CategoryKey,
  type SettingEntry,
} from "./SettingsSection";
import { Spinner } from "./Spinner";
import { DEFAULT_TWEAKS } from "../hooks/useTweaks";
import { copyText } from "../lib/clipboard";
import { readPreviousLaunch } from "../lib/diagnostics/breadcrumbs";
import { buildBundle, bundleFileName } from "../lib/diagnostics/bundle";
import { flushSession, listSessions } from "../lib/diagnostics/store";
import { useReducedMotion } from "../styles/motion";
import { FONT_STACKS, type Theme, type ThemeKey, Z } from "../styles/tokens";
import type { Tweaks } from "../types/reader";
import type { UiLangPref } from "../i18n";
import { useI18n } from "../i18n/useI18n";
import { Button } from "./Button";

const REPO_URL = "https://github.com/TheMostafaOsamaDev/Riwaq-Reader";
const LICENSE_URL =
  "https://github.com/TheMostafaOsamaDev/Riwaq-Reader/blob/main/LICENSE";

interface Props {
  theme: Theme;
  themeKey: ThemeKey;
  t: Tweaks;
  setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void;
  applyTweaks: (partial: Partial<Tweaks>) => void;
  layout: "mobile" | "desktop";
  onClose: () => void;
  /** Run an update check now, bypassing both the toggle and the 24h throttle
   *  — pressing the button IS the consent the toggle otherwise withholds.
   *  Threaded from App so this page shares the one check, rather than
   *  running a second, independent one. */
  onCheckUpdates: () => void;
  updateChecking: boolean;
}

export function SettingsPage({
  theme,
  themeKey,
  t,
  setTweak,
  applyTweaks,
  layout,
  onClose,
  onCheckUpdates,
  updateChecking,
}: Props) {
  const { tr, locale } = useI18n();
  const isMobile = layout === "mobile";
  const isAr = locale === "ar";
  const reduced = useReducedMotion();
  const slideFrom = isAr ? "-10px" : "10px";

  // null = the mobile category list (level 0). Desktop always shows a category.
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(
    isMobile ? null : "appearance",
  );
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [version, setVersion] = useState<string>("");
  /** Which diagnostics action is in flight, or null. Assembling the bundle
   *  reads every retained session file over the IPC bridge, so both actions
   *  need a visible busy state and a guard against a second tap. */
  const [diagBusy, setDiagBusy] = useState<null | "export" | "copy">(null);
  // A snapshot of what the previous launch left behind, taken once when the
  // page opens: index.html rotated that record aside before this launch wrote
  // its first mark, so it cannot change while Settings is on screen.
  const [previousLaunch] = useState(() => readPreviousLaunch());

  useEffect(() => {
    let alive = true;
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then((v) => alive && setVersion(v))
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
        defaultPath: "riwaq-settings.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
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
      if (!path || typeof path !== "string") return;
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const parsed = JSON.parse(await readTextFile(path)) as Partial<Tweaks>;
      if (!parsed || typeof parsed !== "object")
        throw new Error("not an object");
      applyTweaks(parsed);
      notify("info", tr("settings.importDone"));
    } catch (e) {
      console.error("settings import failed", e);
      notify("error", tr("settings.importError"));
    }
  };

  // One document, two ways out of the device. Both actions build it the same
  // way so a copied report and a saved one are never subtly different.
  const buildDiagnostics = async () => {
    // The session buffer is otherwise only emptied by App's 2-second
    // interval, and `listSessions` reads files — so without this the export
    // ends just before whatever the user tapped Export to report. That tail
    // is the part worth having. `flushSession` swallows its own write failures
    // and no-ops when there is nothing buffered or no bridge, so this cannot
    // turn a flush problem into a failed export.
    await flushSession();
    return buildBundle({
      app: {
        version: version || "dev",
        platform: navigator.platform || "unknown",
        ua: navigator.userAgent,
      },
      verbose: t.verboseDiagnostics,
      launches: previousLaunch ? [previousLaunch] : [],
      sessions: await listSessions(),
    });
  };

  const exportDiagnostics = async () => {
    if (diagBusy) return;
    setDiagBusy("export");
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: bundleFileName(new Date()),
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (!path) return;
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, await buildDiagnostics());
      notify("info", tr("settings.diagnostics.exportDone"));
    } catch (e) {
      console.error("diagnostics export failed", e);
      notify("error", tr("settings.diagnostics.exportError"));
    } finally {
      // In a finally so a throw — or the early return on a cancelled save
      // dialog — can't leave the row spinning for the rest of the session.
      setDiagBusy(null);
    }
  };

  const copyDiagnostics = async () => {
    if (diagBusy) return;
    setDiagBusy("copy");
    try {
      const ok = await copyText(await buildDiagnostics());
      notify(
        ok ? "info" : "error",
        ok
          ? tr("settings.diagnostics.copied")
          : tr("settings.diagnostics.copyError"),
      );
    } catch (e) {
      console.error("diagnostics copy failed", e);
      notify("error", tr("settings.diagnostics.copyError"));
    } finally {
      setDiagBusy(null);
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

  // ── build every category's entries (also the search index) ────────────────
  const entriesByCat: Record<CategoryKey, SettingEntry[]> = {
    appearance: [
      {
        id: "language",
        label: tr("settings.language"),
        node: (
          <LanguageField
            theme={theme}
            value={t.uiLang}
            onChange={(v: UiLangPref) => setTweak("uiLang", v)}
          />
        ),
      },
      {
        id: "theme",
        label: tr("settings.theme"),
        node: (
          <ThemeField
            theme={theme}
            pref={t.theme}
            onChange={(p) => setTweak("theme", p)}
          />
        ),
      },
    ],
    reading: readingItems({
      theme,
      t,
      setTweak,
      tr,
      showPageTurn: !isMobile,
    }),
    behavior: [
      {
        id: "startupView",
        label: tr("settings.startupView"),
        node: (
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
        ),
      },
      {
        id: "confirmDelete",
        label: tr("settings.confirmDelete"),
        node: (
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
        ),
      },
      {
        id: "reduceMotion",
        label: tr("settings.reduceMotion"),
        node: (
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
        ),
      },
    ],
    downloads: [
      {
        id: "maxConcurrent",
        label: tr("settings.maxConcurrentDownloads", {
          n: t.maxConcurrentDownloads,
        }),
        node: (
          <Field
            label={tr("settings.maxConcurrentDownloads", {
              n: t.maxConcurrentDownloads,
            })}
            theme={theme}
          >
            <Slider
              theme={theme}
              ariaLabel={tr("settings.maxConcurrentDownloads", {
                n: t.maxConcurrentDownloads,
              })}
              min={1}
              max={5}
              step={1}
              value={t.maxConcurrentDownloads}
              onChange={(n) => setTweak("maxConcurrentDownloads", n)}
              // One tick per selectable value — the range is only 1–5.
              ticks={5}
            />
          </Field>
        ),
      },
      {
        id: "wifiOnly",
        label: tr("settings.wifiOnly"),
        node: (
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
            <p
              style={{
                margin: "8px 2px 0",
                fontSize: 10.5,
                color: theme.muted,
                lineHeight: 1.5,
              }}
            >
              {tr("settings.wifiOnly.hint")}
            </p>
          </Field>
        ),
      },
    ],
    data: [
      {
        id: "export",
        label: tr("settings.exportSettings"),
        node: (
          <ActionRow
            theme={theme}
            icon={<Icon name="download" size={16} />}
            label={tr("settings.exportSettings")}
            onClick={exportSettings}
          />
        ),
      },
      {
        id: "import",
        label: tr("settings.importSettings"),
        node: (
          <ActionRow
            theme={theme}
            icon={<Icon name="folder" size={16} />}
            label={tr("settings.importSettings")}
            onClick={importSettings}
          />
        ),
      },
      // Nothing is rendered when there is no previous launch on record (first
      // ever run, or storage unavailable). An absent row is honest; a row
      // reading "unknown" is noise in the one place a reader is looking for a
      // straight answer.
      ...(previousLaunch
        ? [
            {
              id: "diagnostics-last-launch",
              label: tr("settings.diagnostics"),
              node: (
                <Field label={tr("settings.diagnostics")} theme={theme}>
                  {/* Icon AND sentence, both independent of the tint: the
                      colour is reinforcement, and the row has to still say
                      which way it went with colour taken away. */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: theme.ink,
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        flexShrink: 0,
                        color: previousLaunch.ok ? theme.ink : "#c04a3a",
                      }}
                    >
                      <Icon
                        name={previousLaunch.ok ? "check" : "xCirc"}
                        size={16}
                      />
                    </span>
                    <span>
                      {previousLaunch.ok
                        ? tr("settings.diagnostics.lastLaunchOk")
                        : tr("settings.diagnostics.lastLaunchBlank", {
                            stage: previousLaunch.stalledAt ?? "—",
                          })}
                    </span>
                  </div>
                </Field>
              ),
            },
          ]
        : []),
      {
        id: "diagnostics-verbose",
        label: tr("settings.diagnostics.verbose"),
        node: (
          <Field label={tr("settings.diagnostics.verbose")} theme={theme}>
            <SegRow<"on" | "off">
              theme={theme}
              value={t.verboseDiagnostics ? "on" : "off"}
              // The recorder's live tier is pushed from App, off this same
              // tweak — so Import settings and Reset to defaults apply it too,
              // and this stays the plain setter every other toggle here is.
              onChange={(v) => setTweak("verboseDiagnostics", v === "on")}
              options={[
                { value: "on", label: tr("settings.on") },
                { value: "off", label: tr("settings.off") },
              ]}
            />
            <p
              style={{
                margin: "8px 2px 0",
                fontSize: 10.5,
                color: theme.muted,
                lineHeight: 1.5,
              }}
            >
              {tr("settings.diagnostics.verbose.hint")}
            </p>
          </Field>
        ),
      },
      {
        id: "diagnostics-export",
        label: tr("settings.diagnostics.export"),
        node: (
          <ActionRow
            theme={theme}
            // Not the bare `download` this category already uses for Export
            // settings — two rows one above the other with the same glyph
            // read as the same action.
            icon={<Icon name="downloadCirc" size={16} />}
            label={tr("settings.diagnostics.export")}
            onClick={exportDiagnostics}
            trailing={diagBusy === "export" ? <Spinner size={16} /> : undefined}
          />
        ),
      },
      {
        id: "diagnostics-copy",
        label: tr("settings.diagnostics.copy"),
        node: (
          <ActionRow
            theme={theme}
            icon={<Icon name="doc" size={16} />}
            label={tr("settings.diagnostics.copy")}
            onClick={copyDiagnostics}
            trailing={diagBusy === "copy" ? <Spinner size={16} /> : undefined}
          />
        ),
      },
      // Last in the category on purpose: it is the only destructive action
      // here, and it stays separated from the ordinary ones rather than being
      // buried mid-list by the rows above.
      {
        id: "reset",
        label: tr("settings.resetSettings"),
        node: (
          <ActionRow
            theme={theme}
            icon={<Icon name="trash" size={16} />}
            label={tr("settings.resetSettings")}
            onClick={() => setResetOpen(true)}
            danger
          />
        ),
      },
    ],
    about: [
      {
        id: "about-info",
        label: tr("settings.about.version", { n: version || "" }),
        node: (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              padding: "22px 18px 18px",
              borderBottom: `0.5px solid ${theme.rule}`,
            }}
          >
            <BrandMark themeKey={themeKey} size={56} />
            <span
              style={{ fontSize: 12, color: theme.muted, textAlign: "center" }}
            >
              {tr("settings.about.tagline")}
            </span>
            {version && (
              <span style={{ fontSize: 11.5, color: theme.muted }}>
                {tr("settings.about.version", { n: version })}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "updates",
        label: tr("settings.updates"),
        node: (
          <Field label={tr("settings.updates")} theme={theme}>
            <SegRow<"on" | "off">
              theme={theme}
              value={t.autoCheckUpdates ? "on" : "off"}
              onChange={(v) => setTweak("autoCheckUpdates", v === "on")}
              options={[
                { value: "on", label: tr("settings.on") },
                { value: "off", label: tr("settings.off") },
              ]}
            />
            <div style={{ marginTop: 10 }}>
              <Button
                theme={theme}
                variant="secondary"
                size="sm"
                loading={updateChecking}
                disabled={updateChecking}
                onClick={onCheckUpdates}
              >
                {updateChecking
                  ? tr("settings.updates.checking")
                  : tr("settings.updates.checkNow")}
              </Button>
            </div>
            <p
              style={{
                margin: "8px 2px 0",
                fontSize: 10.5,
                color: theme.muted,
                lineHeight: 1.5,
              }}
            >
              {tr("settings.updates.hint")}
            </p>
          </Field>
        ),
      },
      {
        id: "sourceCode",
        label: tr("settings.about.sourceCode"),
        node: (
          <ActionRow
            theme={theme}
            icon={<Icon name="globe" size={16} />}
            label={tr("settings.about.sourceCode")}
            onClick={() => void openExternal(REPO_URL)}
            trailing={
              <Icon
                name="chevronR"
                size={16}
                className="rtl-flip-x"
                style={{ opacity: 0.5 }}
              />
            }
          />
        ),
      },
      {
        id: "license",
        label: tr("settings.about.license"),
        node: (
          <ActionRow
            theme={theme}
            icon={<Icon name="doc" size={16} />}
            label={tr("settings.about.license")}
            onClick={() => void openExternal(LICENSE_URL)}
            trailing={
              <Icon
                name="chevronR"
                size={16}
                className="rtl-flip-x"
                style={{ opacity: 0.5 }}
              />
            }
          />
        ),
      },
    ],
  };

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const results = searching
    ? CATEGORY_ORDER.map((c) => ({
        cat: c,
        entries: entriesByCat[c].filter((e) =>
          e.label.toLowerCase().includes(q),
        ),
      })).filter((g) => g.entries.length > 0)
    : [];

  const slideStyle = reduced
    ? undefined
    : ({ ["--slide-from" as string]: slideFrom } as CSSProperties);

  const card = (children: ReactNode) => (
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
  );

  const searchResults = (
    <div>
      {results.length === 0 ? (
        <p
          style={{
            textAlign: "center",
            color: theme.muted,
            fontSize: 13,
            padding: "40px 0",
          }}
        >
          {tr("settings.searchNoResults")}
        </p>
      ) : (
        results.map((g) => (
          <section key={g.cat} style={{ marginBottom: 22 }}>
            <SectionHeader
              theme={theme}
              label={tr(CATEGORY_META[g.cat].labelKey)}
              icon={<Icon name={CATEGORY_META[g.cat].icon} size={13} />}
            />
            {card(renderEntries(g.entries))}
          </section>
        ))
      )}
    </div>
  );

  const searchBox = (
    <div
      style={{ position: "relative", display: "flex", alignItems: "center" }}
    >
      <span
        style={{
          position: "absolute",
          insetInlineStart: 11,
          display: "flex",
          color: theme.muted,
          pointerEvents: "none",
        }}
      >
        <Icon name="search" size={15} />
      </span>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tr("settings.search")}
        aria-label={tr("settings.search")}
        style={{
          width: "100%",
          boxSizing: "border-box",
          paddingInlineStart: 34,
          paddingInlineEnd: 12,
          paddingTop: 9,
          paddingBottom: 9,
          borderRadius: 10,
          border: `1px solid ${theme.rule}`,
          background: theme.bg,
          color: theme.ink,
          fontFamily: FONT_STACKS.sans,
          fontSize: 13,
          outline: "none",
        }}
      />
    </div>
  );

  // ── mobile: drill-down ────────────────────────────────────────────────────
  if (isMobile) {
    const inCategory = activeCategory !== null;
    return (
      <Shell theme={theme} isMobile isAr={isAr}>
        <Header
          theme={theme}
          isAr={isAr}
          title={
            inCategory
              ? tr(CATEGORY_META[activeCategory].labelKey)
              : tr("sidebar.settings")
          }
          onBack={inCategory ? () => setActiveCategory(null) : onClose}
        />
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <div style={{ padding: "16px 14px 48px" }}>
            {inCategory ? (
              <div
                key={activeCategory}
                className={reduced ? undefined : "riwaq-settings-slide-in"}
                style={slideStyle}
              >
                {card(renderEntries(entriesByCat[activeCategory]))}
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 16 }}>{searchBox}</div>
                {searching
                  ? searchResults
                  : card(
                      CATEGORY_ORDER.map((c) => (
                        <MobileCategoryRow
                          key={c}
                          theme={theme}
                          icon={CATEGORY_META[c].icon}
                          label={tr(CATEGORY_META[c].labelKey)}
                          onClick={() => setActiveCategory(c)}
                        />
                      )),
                    )}
              </>
            )}
          </div>
        </div>
        {overlays()}
      </Shell>
    );
  }

  // ── desktop: morphing rail + content ──────────────────────────────────────
  const displayCategory: CategoryKey = activeCategory ?? "appearance";
  return (
    <Shell theme={theme} isAr={isAr}>
      <div
        style={{ display: "flex", flex: 1, minHeight: 0, padding: 16, gap: 16 }}
      >
        {/* rail — matches the app sidebar's chrome; items slide in on open */}
        <aside
          style={{
            width: 252,
            flexShrink: 0,
            background: theme.chrome,
            border: `1.5px solid ${theme.rule}`,
            borderRadius: 16,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            overflowY: "auto",
          }}
        >
          <button
            onClick={onClose}
            aria-label={tr("common.back")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              border: "none",
              background: "transparent",
              color: theme.muted,
              cursor: "pointer",
              fontFamily: FONT_STACKS.sans,
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 8,
              textAlign: "start",
            }}
          >
            <Icon name="arrowL" size={16} className="rtl-flip-x" />
            {tr("common.back")}
          </button>
          {searchBox}
          <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {CATEGORY_ORDER.map((c, i) => (
              <button
                key={c}
                onClick={() => {
                  setActiveCategory(c);
                  setQuery("");
                }}
                aria-pressed={!searching && c === displayCategory}
                className={reduced ? undefined : "riwaq-settings-slide-in"}
                style={{
                  ...(reduced
                    ? null
                    : { ...slideStyle, animationDelay: `${i * 28}ms` }),
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "9px 12px",
                  border: "none",
                  borderRadius: 10,
                  background:
                    !searching && c === displayCategory
                      ? theme.ink
                      : "transparent",
                  color:
                    !searching && c === displayCategory
                      ? theme.paper
                      : theme.ink,
                  fontWeight: !searching && c === displayCategory ? 600 : 500,
                  fontSize: 13.5,
                  fontFamily: FONT_STACKS.sans,
                  cursor: "pointer",
                  textAlign: "start",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    color:
                      !searching && c === displayCategory
                        ? theme.paper
                        : theme.muted,
                  }}
                >
                  <Icon name={CATEGORY_META[c].icon} size={18} />
                </span>
                {tr(CATEGORY_META[c].labelKey)}
              </button>
            ))}
          </nav>
        </aside>

        {/* content */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <div
            style={{ maxWidth: 640, margin: "0 auto", padding: "6px 8px 60px" }}
          >
            {searching ? (
              searchResults
            ) : (
              <div
                key={displayCategory}
                className={reduced ? undefined : "riwaq-settings-slide-in"}
                style={slideStyle}
              >
                <SectionHeader
                  theme={theme}
                  label={tr(CATEGORY_META[displayCategory].labelKey)}
                  icon={
                    <Icon
                      name={CATEGORY_META[displayCategory].icon}
                      size={13}
                    />
                  }
                />
                {card(renderEntries(entriesByCat[displayCategory]))}
              </div>
            )}
          </div>
        </div>
      </div>
      {overlays()}
    </Shell>
  );

  function overlays() {
    return (
      <>
        <Toast theme={theme} toast={toast} onDismiss={() => setToast(null)} />
        <AnimatedDialog
          open={resetOpen}
          onScrimClick={() => setResetOpen(false)}
          zIndex={Z.dialogAbove}
        >
          {resetOpen && (
            <ConfirmDialog
              theme={theme}
              title={tr("settings.reset.confirmTitle")}
              message={tr("settings.reset.confirmBody")}
              confirmLabel={tr("settings.reset.confirmCta")}
              cancelLabel={tr("common.cancel")}
              onConfirm={() => {
                applyTweaks(DEFAULT_TWEAKS);
                setResetOpen(false);
              }}
              onCancel={() => setResetOpen(false)}
            />
          )}
        </AnimatedDialog>
      </>
    );
  }
}

/** Full-viewport settings shell (theme + RTL + safe-area on mobile). */
function Shell({
  theme,
  isMobile = false,
  isAr,
  children,
}: {
  theme: Theme;
  isMobile?: boolean;
  isAr: boolean;
  children: ReactNode;
}) {
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
      {children}
    </div>
  );
}

/** Sticky header with a back button + title (mobile + shared). */
function Header({
  theme,
  isAr,
  title,
  onBack,
}: {
  theme: Theme;
  isAr: boolean;
  title: string;
  onBack: () => void;
}) {
  const { tr } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        borderBottom: `0.5px solid ${theme.rule}`,
        flexShrink: 0,
      }}
    >
      <button
        onClick={onBack}
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
          fontFamily: FONT_STACKS.sans,
          fontWeight: 600,
          fontSize: 20,
          margin: 0,
          letterSpacing: isAr ? "normal" : "-0.01em",
        }}
      >
        {title}
      </h1>
    </div>
  );
}

/** A tappable category row for the mobile drill-down list. */
function MobileCategoryRow({
  theme,
  icon,
  label,
  onClick,
}: {
  theme: Theme;
  icon: IconProps["name"];
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 18px",
        background: "transparent",
        color: theme.ink,
        border: "none",
        borderBottom: `0.5px solid ${theme.rule}`,
        cursor: "pointer",
        fontFamily: FONT_STACKS.sans,
        fontSize: 14,
        fontWeight: 500,
        textAlign: "start",
      }}
    >
      <span style={{ display: "flex", color: theme.chromeInk }}>
        <Icon name={icon} size={18} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      <Icon
        name="chevronR"
        size={16}
        className="rtl-flip-x"
        style={{ opacity: 0.4 }}
      />
    </button>
  );
}
