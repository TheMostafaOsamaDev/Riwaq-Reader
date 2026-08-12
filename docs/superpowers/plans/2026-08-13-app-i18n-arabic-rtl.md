# App UI i18n (Arabic + RTL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app's own UI an Arabic language option (auto-detected, overridable in Settings) that mirrors the entire chrome to RTL, while book-content direction stays independently derived per book.

**Architecture:** A dependency-free, typed i18n layer under `src/i18n/` (English catalog is the source of truth; Arabic is `Record<MsgKey,string>` so missing keys are compile errors). A React context (`I18nProvider`) exposes `{ locale, dir, tr }`; the resolved locale is computed at the app root from a new `Tweaks.uiLang` preference (mirrors the existing `theme:"system"` pattern) and drives `document.documentElement.dir`/`lang` and the shell `dir`. Chrome components consume `tr(...)` for text and are converted from physical CSS (`left`/`marginLeft`/`textAlign:"left"`) to logical properties (`insetInlineStart`/`marginInlineStart`/`textAlign:"start"`) so they mirror under RTL.

**Tech Stack:** React 19, Vite 8, TypeScript ~6, Tauri 2 (desktop + Android). UI sans font is **Readex Pro**, a Latin+Arabic variable family already bundled — Arabic chrome text renders in it with no font work.

## Global Constraints

- **No new dependencies** (runtime or dev). The i18n layer is hand-rolled TS.
- **No unit-test runner exists** in this repo and the no-deps rule forbids adding one. Per the established pattern (see prior specs), each task's automated gate is **`npx tsc --noEmit`** and behavior is verified by **driving the app** (Playwright MCP is configured; the `run` skill launches it). `tsc` is load-bearing here: it enforces that `ar.ts` covers every message key.
- **Translator is named `tr`, never `t`** — `t` is the `Tweaks` prop used throughout the reader (`t.fontSize`, `t.theme`). A `t`/`tr` collision is a review-blocking bug.
- **Message keys are flat, dot-namespaced strings** (`"sidebar.search"`). `src/i18n/en.ts` is the single source of truth; `type MsgKey = keyof typeof en`.
- **UI direction is independent of book-content direction.** `BookBody` and reader content keep setting their own `dir`; do not couple them to the UI locale.
- **`Tweaks.uiLang` default is `"system"`**; existing stored settings pick it up automatically via `useTweaks`'s `{ ...DEFAULT_TWEAKS, ...parsed }` merge (no migration code needed).
- **RTL conversion uses CSS logical properties**, not `dir`-branched physical values, wherever a single logical property does the job.
- Follow existing code style: inline-style objects, `theme.*` tokens, `FONT_STACKS.*`, no CSS-in-JS libs.

---

### Task 1: i18n foundation — module, catalogs, provider, root wiring

Stands up the whole engine and flips the app to RTL end-to-end, before any strings are extracted. Deliverable: setting `uiLang` (via Settings in Task 2, or temporarily via localStorage) makes `<html dir="rtl" lang="ar">` and the shell mirror.

**Files:**
- Create: `src/i18n/en.ts`, `src/i18n/ar.ts`, `src/i18n/index.ts`, `src/i18n/I18nProvider.tsx`, `src/i18n/useI18n.ts`
- Modify: `src/types/reader.ts` (add `uiLang` to `Tweaks`), `src/hooks/useTweaks.ts` (default), `src/App.tsx:383-397` (provider + root `dir`/`lang`)

**Interfaces:**
- Produces:
  - `type Locale = "en" | "ar"`, `type Dir = "ltr" | "rtl"`, `type UiLangPref = "system" | Locale`
  - `type MsgKey = keyof typeof en`, `type Messages = Record<MsgKey, string>`
  - `detectLocale(pref: UiLangPref, navLang: string | undefined): Locale`
  - `interpolate(template: string, params?: Record<string, string|number>): string`
  - `DIR_FOR: Record<Locale, Dir>`, `makeTr(locale): Tr`, `type Tr = (key: MsgKey, params?: Record<string,string|number>) => string`
  - `<I18nProvider locale={Locale}>`, `useI18n(): { locale: Locale; dir: Dir; tr: Tr }`
  - `Tweaks.uiLang: UiLangPref`

- [ ] **Step 1: Create `src/i18n/en.ts` — seed catalog (source of truth)**

Seed with the keys Task 2 needs plus a `common.*` group later tasks reuse. Keep expanding this file in later tasks; every key added here forces an `ar.ts` entry (Task's tsc gate).

```ts
// English UI catalog — the SOURCE OF TRUTH for message keys. Every key here
// MUST have an Arabic counterpart in ./ar.ts (the `Messages` type makes a
// missing key a compile error). Keys are flat + dot-namespaced.
export const en = {
  // common (reused across surfaces)
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.back": "Back",
  "common.done": "Done",
  "common.delete": "Delete",
  "common.retry": "Retry",

  // settings panel
  "settings.title": "Reading",
  "settings.subtitle": "Appearance & typography",
  "settings.language": "Language",
  "settings.language.auto": "Auto",
  "settings.language.en": "English",
  "settings.language.ar": "العربية",
  "settings.theme": "Theme",
  "settings.theme.system": "System",
  "settings.theme.systemHint": "Follows your OS light / dark setting",
  "settings.font": "Font",
  "settings.fontSize": "Font size · {n}px",
  "settings.lineHeight": "Line height · {n}",
  "settings.letterSpacing": "Letter spacing · {n}em",
  "settings.contentWidth": "Content width · {n}%",
  "settings.alignment": "Alignment",
  "settings.align.auto": "Auto",
  "settings.readingMode": "Reading mode",
  "settings.mode.paginated2": "Two pages",
  "settings.mode.paginated1": "Single page",
  "settings.mode.scroll": "Scroll",
  "settings.tapToTurn": "Tap to turn pages",
  "settings.on": "On",
  "settings.off": "Off",
  "settings.tapZoneWidth": "Tap zone width · {n}%",
  "settings.tapStride": "Tap scroll length · {n}%",

  // app-root
  "app.loadingBook": "Loading book…",
  "panel.close": "Close panel",
} as const;
```

- [ ] **Step 2: Create `src/i18n/ar.ts` — Arabic catalog**

Typed `: Messages`, so tsc rejects it until every key above is present.

```ts
import type { Messages } from "./index";

// Arabic UI catalog. Typed as `Messages` so a missing/renamed key from en.ts
// is a compile-time error. Keep key order in sync with en.ts for readability.
export const ar: Messages = {
  "common.close": "إغلاق",
  "common.cancel": "إلغاء",
  "common.back": "رجوع",
  "common.done": "تم",
  "common.delete": "حذف",
  "common.retry": "إعادة المحاولة",

  "settings.title": "القراءة",
  "settings.subtitle": "المظهر والخطوط",
  "settings.language": "اللغة",
  "settings.language.auto": "تلقائي",
  "settings.language.en": "English",
  "settings.language.ar": "العربية",
  "settings.theme": "السمة",
  "settings.theme.system": "النظام",
  "settings.theme.systemHint": "يتبع إعداد الفاتح / الداكن في نظامك",
  "settings.font": "الخط",
  "settings.fontSize": "حجم الخط · {n}ب",
  "settings.lineHeight": "ارتفاع السطر · {n}",
  "settings.letterSpacing": "تباعد الأحرف · {n}م",
  "settings.contentWidth": "عرض المحتوى · {n}٪",
  "settings.alignment": "المحاذاة",
  "settings.align.auto": "تلقائي",
  "settings.readingMode": "وضع القراءة",
  "settings.mode.paginated2": "صفحتان",
  "settings.mode.paginated1": "صفحة واحدة",
  "settings.mode.scroll": "تمرير",
  "settings.tapToTurn": "انقر لتقليب الصفحات",
  "settings.on": "تشغيل",
  "settings.off": "إيقاف",
  "settings.tapZoneWidth": "عرض منطقة النقر · {n}٪",
  "settings.tapStride": "مسافة تمرير النقرة · {n}٪",

  "app.loadingBook": "جارٍ تحميل الكتاب…",
  "panel.close": "إغلاق اللوحة",
};
```

- [ ] **Step 3: Create `src/i18n/index.ts` — types, helpers, catalog registry**

```ts
import { en } from "./en";
import { ar } from "./ar";

export type Locale = "en" | "ar";
export type Dir = "ltr" | "rtl";

/** Stored UI-language preference. "system" resolves from the OS/browser
 *  locale at render time — mirrors ThemePref's "system". */
export type UiLangPref = "system" | Locale;

export type MsgKey = keyof typeof en;
export type Messages = Record<MsgKey, string>;

export const CATALOGS: Record<Locale, Messages> = { en, ar };
export const DIR_FOR: Record<Locale, Dir> = { en: "ltr", ar: "rtl" };

/** Resolve a stored preference to a concrete locale. "system" inspects the
 *  provided navigator language (primary subtag): Arabic → "ar", else "en". */
export function detectLocale(
  pref: UiLangPref,
  navLang: string | undefined,
): Locale {
  if (pref === "en" || pref === "ar") return pref;
  const primary = (navLang ?? "en").toLowerCase().split(/[-_]/)[0];
  return primary === "ar" ? "ar" : "en";
}

/** Replace {name} placeholders. Missing params are left verbatim. */
export function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) =>
    k in params ? String(params[k]) : m,
  );
}

export type Tr = (
  key: MsgKey,
  params?: Record<string, string | number>,
) => string;

/** Build a translator bound to a locale. Fallback: locale → en → key. */
export function makeTr(locale: Locale): Tr {
  const dict = CATALOGS[locale];
  return (key, params) => interpolate(dict[key] ?? en[key] ?? key, params);
}
```

- [ ] **Step 4: Create `src/i18n/I18nProvider.tsx`**

```tsx
import { createContext, useMemo, type ReactNode } from "react";
import { DIR_FOR, makeTr, type Dir, type Locale, type Tr } from "./index";

interface I18nValue {
  locale: Locale;
  dir: Dir;
  tr: Tr;
}

export const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({ locale, dir: DIR_FOR[locale], tr: makeTr(locale) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
```

- [ ] **Step 5: Create `src/i18n/useI18n.ts`**

```ts
import { useContext } from "react";
import { I18nContext } from "./I18nProvider";

/** Access the resolved UI locale, direction, and translator.
 *  Named `tr` (not `t`) to avoid colliding with the Tweaks prop `t`. */
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within <I18nProvider>");
  return ctx;
}
```

- [ ] **Step 6: Add `uiLang` to `Tweaks`** — `src/types/reader.ts`

Add the import and field:

```ts
import type { ThemePref } from "../styles/tokens";
import type { UiLangPref } from "../i18n";
```

Inside `interface Tweaks` (top, next to `theme`):

```ts
  /** UI-language preference for the app chrome (NOT book content). "system"
      resolves from the OS/browser locale; "en"/"ar" pin a language. Drives the
      shell's reading direction. Book content direction stays derived per-book. */
  uiLang: UiLangPref;
```

- [ ] **Step 7: Default `uiLang` in `DEFAULT_TWEAKS`** — `src/hooks/useTweaks.ts:6`

Add `uiLang: "system",` as the first field of `DEFAULT_TWEAKS`. No migration needed — `load()`'s `{ ...DEFAULT_TWEAKS, ...parsed }` supplies it to existing users.

- [ ] **Step 8: Wire provider + root direction in `App.tsx`**

Add imports near the other i18n-adjacent imports:

```ts
import { I18nProvider } from "./i18n/I18nProvider";
import { detectLocale, DIR_FOR } from "./i18n";
```

Inside `App()`, after `const theme = THEMES[themeKey];` (App.tsx:104):

```ts
  const uiLocale = detectLocale(
    t.uiLang,
    typeof navigator !== "undefined" ? navigator.language : "en",
  );
  const uiDir = DIR_FOR[uiLocale];
```

Add a root-direction effect (next to the theme effect at App.tsx:106):

```ts
  useEffect(() => {
    document.documentElement.lang = uiLocale;
    document.documentElement.dir = uiDir;
  }, [uiLocale, uiDir]);
```

Change the shell wrapper (App.tsx:389) from the hardcoded `dir="ltr"` to `dir={uiDir}`, and update the adjacent comment to: `// Shell direction follows the UI language. BookBody sets its own dir, so book content stays independent of the chrome.` Wrap the returned tree in `<I18nProvider locale={uiLocale}> … </I18nProvider>` (outermost, around the shell `<div>`).

- [ ] **Step 9: Verify — tsc**

Run: `npx tsc --noEmit`
Expected: PASS (proves `ar.ts` covers every key and `uiLang` types thread through).

- [ ] **Step 10: Verify — behavior (temporary override)**

Launch the app (`run` skill / `pnpm dev` + Playwright MCP). In devtools console set an Arabic UI without the selector yet:
`localStorage.setItem("leaflet:tweaks:v1", JSON.stringify({ ...JSON.parse(localStorage.getItem("leaflet:tweaks:v1")||"{}"), uiLang: "ar" })); location.reload();`
Expected: `document.documentElement` shows `dir="rtl" lang="ar"`; the shell `<div>` is `dir="rtl"`; the app visibly mirrors (layout flips). Contract checks to eyeball while here: `detectLocale("system","ar-EG")→"ar"`, `detectLocale("system","en-US")→"en"`, `detectLocale("en","ar")→"en"`. Reset `uiLang` to `"system"` afterward.

- [ ] **Step 11: Commit**

```bash
git add src/i18n src/types/reader.ts src/hooks/useTweaks.ts src/App.tsx
git commit -m "feat(i18n): add typed i18n foundation + RTL-aware app shell"
```

---

### Task 2: Language selector + Settings panel translated + panel RTL

First real consumer of `tr`. Adds the `[ Auto | English | العربية ]` control and translates the whole Settings surface; makes `PanelShell` mirror.

**Files:**
- Modify: `src/panels/SettingsPanel.tsx` (Language field + `tr` for all strings), `src/panels/PanelShell.tsx` (logical border + close aria), `src/components/SettingsSheet.tsx` (read it; if it renders its own settings markup rather than `<SettingsPanel>`, add the same Language field there)

**Interfaces:**
- Consumes: `useI18n` from Task 1; `UiLangPref` from `src/i18n`; existing `SegRow`, `Field` in `SettingsPanel.tsx`.

- [ ] **Step 1: Import i18n in `SettingsPanel.tsx`**

```ts
import { useI18n } from "../i18n/useI18n";
import type { UiLangPref } from "../i18n";
```

Inside `SettingsPanel(...)` body, first line: `const { tr } = useI18n();`

- [ ] **Step 2: Add the Language field** as the FIRST `<Field>` in the panel (above Theme):

```tsx
      <Field label={tr("settings.language")} theme={theme}>
        <SegRow<UiLangPref>
          theme={theme}
          value={t.uiLang}
          onChange={(v) => setTweak("uiLang", v)}
          options={[
            { value: "system", label: tr("settings.language.auto") },
            { value: "en", label: "English" },
            { value: "ar", label: "العربية" },
          ]}
        />
      </Field>
```

- [ ] **Step 3: Replace hardcoded Settings strings with `tr(...)`**

Swap each literal for its key: `title="Reading"` → `title={tr("settings.title")}`, `subtitle="Appearance & typography"` → `tr("settings.subtitle")`, `"Theme"` → `tr("settings.theme")`, `"System"` → `tr("settings.theme.system")`, the system hint → `tr("settings.theme.systemHint")`, `"Font"` → `tr("settings.font")`, the interpolated labels via params, e.g. `` `Font size · ${t.fontSize}px` `` → `tr("settings.fontSize", { n: t.fontSize })`, `` `Line height · ${t.lineHeight.toFixed(2)}` `` → `tr("settings.lineHeight", { n: t.lineHeight.toFixed(2) })`, `` `Letter spacing · ${t.letterSpacing.toFixed(2)}em` `` → `tr("settings.letterSpacing", { n: t.letterSpacing.toFixed(2) })`, `` `Content width · ${t.contentWidth}%` `` → `tr("settings.contentWidth", { n: t.contentWidth })`, `"Alignment"` → `tr("settings.alignment")`, the Auto alignment option → `tr("settings.align.auto")`, `"Reading mode"` → `tr("settings.readingMode")`, the three mode labels → `tr("settings.mode.paginated2"|"paginated1"|"scroll")`, `"Tap to turn pages"` → `tr("settings.tapToTurn")`, On/Off → `tr("settings.on"|"settings.off")`, the tap-zone / tap-stride labels via `{ n }` params. Leave the font-family sub-labels (Serif/Sans/Cairo…) as proper names — they are brand names, not translated.

- [ ] **Step 4: Make `PanelShell` border logical + translate close** — `src/panels/PanelShell.tsx`

Replace the `borderSide` block (lines 30-35) so the border faces the reader column regardless of direction:

```tsx
  const borderSide =
    side === "left"
      ? { borderInlineEnd: `0.5px solid ${theme.rule}` }
      : side === "right"
      ? { borderInlineStart: `0.5px solid ${theme.rule}` }
      : {};
```

Add `import { useI18n } from "../i18n/useI18n";`, `const { tr } = useI18n();` in the body, and change `aria-label="Close panel"` → `aria-label={tr("panel.close")}`.

- [ ] **Step 5: Check `SettingsSheet.tsx`**

Read `src/components/SettingsSheet.tsx`. If it wraps `<SettingsPanel .../>`, nothing more is needed (it inherits the new field). If it renders its own settings controls, add the same Language `SegRow` there using `useI18n` + `setTweak("uiLang", v)`.

- [ ] **Step 6: Verify — tsc**

Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 7: Verify — behavior**

Drive the app: open Settings → the new **Language** control shows `Auto / English / العربية`. Select **العربية**: the Settings panel text switches to Arabic live, the app shell mirrors to RTL, and the panel's border/close sit on the mirrored side. Switch back to **English**: reverts. Reload: selection persists.

- [ ] **Step 8: Commit**

```bash
git add src/panels/SettingsPanel.tsx src/panels/PanelShell.tsx src/components/SettingsSheet.tsx
git commit -m "feat(i18n): language selector + translated, RTL-aware settings panel"
```

---

### Task 3: Directional-icon flipping + shared RTL primitives

Adds the one reusable mechanism the chrome tasks depend on: horizontally mirrored directional icons.

**Files:**
- Modify: `src/components/Icon.tsx` (add `className` passthrough), `src/styles/global.css` (RTL flip rule)

**Interfaces:**
- Produces: `Icon` accepts `className?: string`; global CSS class `rtl-flip-x` that mirrors an element under `[dir="rtl"]`. Convention for later tasks: pass `className="rtl-flip-x"` to purely horizontal directional icons (`arrowL`, `arrowR`, back/next); for icons that ALSO carry an inline `transform` (rotating disclosure chevrons), compose the flip inline using `dir` from `useI18n()` instead.

- [ ] **Step 1: Add `className` to `Icon`** — `src/components/Icon.tsx`

Add `className?: string;` to `IconProps`, destructure it, and pass `className={className}` onto the `<svg>`.

- [ ] **Step 2: Add the RTL flip rule** — append to `src/styles/global.css`

```css
/* Horizontally mirror directional icons (back/next arrows, disclosure
   chevrons) when the UI language is right-to-left. Applied via className on
   the specific icons that encode a left/right meaning — never blanket-applied,
   so non-directional glyphs (search, settings, download) stay upright. */
[dir="rtl"] .rtl-flip-x {
  transform: scaleX(-1);
}
```

- [ ] **Step 3: Verify — tsc**

Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 4: Verify — behavior (deferred to consumers)**

No standalone visual yet — this task ships the mechanism. Confirm the build is clean; the flip is exercised in Tasks 4/6/7 (back buttons, chevrons).

- [ ] **Step 5: Commit**

```bash
git add src/components/Icon.tsx src/styles/global.css
git commit -m "feat(i18n): directional-icon RTL flip primitive"
```

---

### Task 4: Sidebar — translate + RTL (`LibrarySidebar.tsx`)

The largest chrome surface (16 physical-CSS spots). New catalog keys + logical-property conversion + disclosure-chevron flip.

**Files:**
- Modify: `src/components/LibrarySidebar.tsx`, `src/i18n/en.ts` (add keys), `src/i18n/ar.ts` (add translations)

**Interfaces:**
- Consumes: `useI18n`, `Icon` (`className`), `rtl-flip-x` from Tasks 1/3.

- [ ] **Step 1: Add sidebar keys to `en.ts` and `ar.ts`**

`en.ts` (append):

```ts
  "sidebar.searchLibrary": "Search library",
  "sidebar.main": "Main",
  "sidebar.library": "Library",
  "sidebar.reading": "Reading",
  "sidebar.finished": "Finished",
  "sidebar.wishlist": "Wishlist",
  "sidebar.store": "Store",
  "sidebar.shelves": "Shelves",
  "sidebar.newShelf": "New shelf",
  "sidebar.downloads": "Downloads",
  "sidebar.settings": "Settings",
  "sidebar.importBook": "Import book",
  "sidebar.importing": "Importing…",
  "sidebar.moreImport": "More import options",
  "sidebar.folderOfEpubs": "Folder of EPUBs",
  "sidebar.wordDoc": "Word document",
  "sidebar.expand": "Expand {name}",
  "sidebar.collapse": "Collapse {name}",
  "sidebar.doubleClickExpand": "Double-click to expand",
  "sidebar.doubleClickCollapse": "Double-click to collapse",
```

`ar.ts` (append — keep order in sync):

```ts
  "sidebar.searchLibrary": "بحث في المكتبة",
  "sidebar.main": "الرئيسية",
  "sidebar.library": "المكتبة",
  "sidebar.reading": "قيد القراءة",
  "sidebar.finished": "منتهية",
  "sidebar.wishlist": "قائمة الرغبات",
  "sidebar.store": "المتجر",
  "sidebar.shelves": "الأرفف",
  "sidebar.newShelf": "رف جديد",
  "sidebar.downloads": "التنزيلات",
  "sidebar.settings": "الإعدادات",
  "sidebar.importBook": "استيراد كتاب",
  "sidebar.importing": "جارٍ الاستيراد…",
  "sidebar.moreImport": "خيارات استيراد أخرى",
  "sidebar.folderOfEpubs": "مجلد ملفات EPUB",
  "sidebar.wordDoc": "مستند Word",
  "sidebar.expand": "توسيع {name}",
  "sidebar.collapse": "طي {name}",
  "sidebar.doubleClickExpand": "انقر مرتين للتوسيع",
  "sidebar.doubleClickCollapse": "انقر مرتين للطي",
```

- [ ] **Step 2: Consume `tr`/`dir` and translate strings**

Add `import { useI18n } from "../i18n/useI18n";`. In `LibrarySidebar(...)`: `const { tr, dir } = useI18n();`. Replace literals: `"Search library"`, `"Main"`, `"Downloads"`, `"Settings"`, the split-button `importing ? "Importing…" : "Import book"`, `aria-label="More import options"`, menu `"Folder of EPUBs"` / `"Word document"`, `"New shelf"`, and the `TREE` labels. The `TREE` array holds `label` literals — translate at render, not in the module-scope const:

```tsx
  const TREE_KEYS: { key: LibraryTab; k: MsgKey }[] = [
    { key: "reading", k: "sidebar.reading" },
    { key: "finished", k: "sidebar.finished" },
    { key: "wishlist", k: "sidebar.wishlist" },
  ];
```
and map with `label={tr(t.k)}`. Translate the `CollapsibleRow` labels passed in (`"Library"`, `"Shelves"`) via `tr("sidebar.library"|"sidebar.shelves")`. In `CollapsibleRow`, the `title` and `aria-label` template strings become `tr("sidebar.doubleClickExpand"| "…Collapse")` and `tr(open ? "sidebar.collapse" : "sidebar.expand", { name: label })`.

- [ ] **Step 3: Convert physical CSS → logical properties**

In `LibrarySidebar.tsx`, replace every direction-sensitive physical value: `textAlign: "left"` → `textAlign: "start"`; `marginLeft: "auto"` → `marginInlineStart: "auto"`; the `Tree` component's `margin: "4px 0 0 22px"` + `paddingLeft: 14` → `marginBlockStart: 4, marginInlineStart: 22, paddingInlineStart: 14`; the tree connector spans using `left: 0` / `left: -14` → `insetInlineStart: 0` / `insetInlineStart: -14`; the split-button corner radii `borderRadius: "11px 0 0 11px"` and `"0 11px 11px 0"` → logical corners (`borderStartStartRadius`/`borderEndStartRadius` = 11 with the other two 0, and the mirror for the chevron half); `borderRight` divider → `borderInlineEnd`; the Downloads progress fill `left: 0` → `insetInlineStart: 0`; the count/percent badge `marginLeft: "auto"` → `marginInlineStart: "auto"`; the import-menu popover `left: 0, right: 0` stays (symmetric) . Use the grep `grep -nE 'left:|right:|margin(Left|Right)|padding(Left|Right)|border(Left|Right)|textAlign' src/components/LibrarySidebar.tsx` to find all 16 and convert each.

- [ ] **Step 4: Flip the disclosure chevron under RTL**

`CollapsibleRow`'s `chevronR` rotates 90° when open. Compose the RTL flip inline (do NOT use `rtl-flip-x` here, it would be overridden by the inline transform):

```tsx
<Icon name="chevronR" size={15} style={{ transform: `${dir === "rtl" ? "scaleX(-1) " : ""}${open ? "rotate(90deg)" : "none"}`, transition: "transform 180ms ease" }} />
```
The bottom import split-button's `chevronD` is vertical — leave it unflipped.

- [ ] **Step 5: Verify — tsc**

Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 6: Verify — behavior**

Drive the app with UI=العربية: sidebar sits on the **right**, section label/nav rows are right-aligned, the tree connector lines and indent are on the correct side, the collapsed disclosure chevron points inline-start (left), and all labels are Arabic. Switch to English: sidebar returns to the left, LTR. Toggle a collapsible group in both directions — indent/lines stay attached.

- [ ] **Step 7: Commit**

```bash
git add src/components/LibrarySidebar.tsx src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(i18n): translate + RTL-mirror the library sidebar"
```

---

### Task 5: Library home + tabs + Shelves + New-shelf dialog

**Files:**
- Modify: `src/components/Library.tsx`, `src/components/ShelvesPage.tsx`, `src/components/NewShelfDialog.tsx`, `src/i18n/en.ts`, `src/i18n/ar.ts`

**Interfaces:**
- Consumes: `useI18n` from Task 1.

- [ ] **Step 1: Add keys** to `en.ts` / `ar.ts` for the strings these files render. Extract with:
`grep -nE '>[A-Z][^<{]+<|aria-label="[^"]+"|placeholder="[^"]+"|title="[^"]+"' src/components/Library.tsx src/components/ShelvesPage.tsx src/components/NewShelfDialog.tsx`
Known strings to key (add both catalogs): `"Continue reading"`, `"Currently reading"`, `"No cover"`, `"No shelves yet"`, `"Create a shelf to group books your way."`, `"New shelf"`, `"Results"`, plus the library tab labels if rendered here. Example additions:

```ts
// en.ts
  "library.continueReading": "Continue reading",
  "library.currentlyReading": "Currently reading",
  "library.noCover": "No cover",
  "shelves.empty": "No shelves yet",
  "shelves.emptyHint": "Create a shelf to group books your way.",
  "shelves.newShelf": "New shelf",
  "shelves.namePlaceholder": "Shelf name",
  "shelves.create": "Create",
```
```ts
// ar.ts
  "library.continueReading": "متابعة القراءة",
  "library.currentlyReading": "تقرأ حاليًا",
  "library.noCover": "بدون غلاف",
  "shelves.empty": "لا أرفف بعد",
  "shelves.emptyHint": "أنشئ رفًا لتجميع كتبك بطريقتك.",
  "shelves.newShelf": "رف جديد",
  "shelves.namePlaceholder": "اسم الرف",
  "shelves.create": "إنشاء",
```

- [ ] **Step 2: Consume `tr`** in each file (`const { tr } = useI18n();`) and replace the literals with the keys above.

- [ ] **Step 3: Convert physical CSS → logical** in `Library.tsx` (6 spots) and any in `ShelvesPage.tsx`/`NewShelfDialog.tsx`, using the same recipe as Task 4 (`grep -nE 'left:|right:|margin(Left|Right)|padding(Left|Right)|border(Left|Right)|textAlign'` per file).

- [ ] **Step 4: Verify — tsc** → `npx tsc --noEmit` PASS.

- [ ] **Step 5: Verify — behavior** — Drive with UI=العربية: library grid, "Continue reading" hero, tab labels, empty-shelf state, and the New-shelf dialog are Arabic and right-aligned; dialog input caret starts on the right. English reverts cleanly.

- [ ] **Step 6: Commit**

```bash
git add src/components/Library.tsx src/components/ShelvesPage.tsx src/components/NewShelfDialog.tsx src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(i18n): translate + RTL library home, shelves, new-shelf dialog"
```

---

### Task 6: Reader chrome — Desktop + Mobile readers, chapter progress, mobile sheet

Translate reader toolbars/labels and mirror them; flip prev/next chapter arrows. (Reader **content** stays untouched — verify decoupling.)

**Files:**
- Modify: `src/components/DesktopReader.tsx`, `src/components/MobileReader.tsx`, `src/components/ChapterProgressBar.tsx`, `src/components/MobileSheet.tsx`, `src/i18n/en.ts`, `src/i18n/ar.ts`

**Interfaces:**
- Consumes: `useI18n`, `Icon` `className`/`rtl-flip-x` from Tasks 1/3.

- [ ] **Step 1: Add reader keys.** Extract per file with the Task-5 grep. Known aria/labels to key: `"Back to library"`, `"Back"`, `"Previous chapter"`, `"Next chapter"`, `"Chapter progress"`, `"Chapter {n}"`, `"Table of contents"`, `"Highlights"`, `"Settings"`, `"Progress"`, and any `Chapter {n} of {total}` footer text. Example:

```ts
// en.ts
  "reader.backToLibrary": "Back to library",
  "reader.prevChapter": "Previous chapter",
  "reader.nextChapter": "Next chapter",
  "reader.chapterProgress": "Chapter progress",
  "reader.toc": "Table of contents",
  "reader.highlights": "Highlights",
  "reader.progress": "Progress",
  "reader.chapterOfTotal": "Chapter {n} of {total}",
```
```ts
// ar.ts
  "reader.backToLibrary": "العودة إلى المكتبة",
  "reader.prevChapter": "الفصل السابق",
  "reader.nextChapter": "الفصل التالي",
  "reader.chapterProgress": "تقدّم الفصل",
  "reader.toc": "قائمة المحتويات",
  "reader.highlights": "التظليلات",
  "reader.progress": "التقدّم",
  "reader.chapterOfTotal": "الفصل {n} من {total}",
```

- [ ] **Step 2: Consume `tr`** in each reader file and replace the literal `aria-label`s / labels with keys (interpolate chapter numbers via `{ n, total }`).

- [ ] **Step 3: Flip prev/next chapter arrows.** These use `arrowL`/`arrowR` (or `chevronR`/left) for navigation — add `className="rtl-flip-x"` so "previous" always points to the start edge and "next" to the end edge under RTL. **Semantics note:** in RTL, previous is on the right. Flipping the glyph horizontally + the buttons mirroring with the shell `dir` yields the correct arrangement; verify visually in Step 6.

- [ ] **Step 4: Convert physical CSS → logical** in `DesktopReader.tsx` (5), `MobileReader.tsx` (9), `MobileSheet.tsx`, `ChapterProgressBar.tsx` via the recipe grep. Watch for absolute-positioned chrome (`left`/`right`) → `insetInlineStart`/`End`, and any `translateX` used for edge-anchored elements (leave centering `translateX(-50%)`; convert edge offsets).

- [ ] **Step 5: Verify — tsc** → PASS.

- [ ] **Step 6: Verify — behavior + DECOUPLING.** Drive with UI=العربية opening an **English** book: reader chrome is Arabic + RTL (back on the right, prev/next arrows mirrored), but the **book text stays LTR/left-aligned** (its own `dir`). Then UI=English opening an **Arabic** book: chrome LTR, book text RTL. This is the core invariant — confirm both.

- [ ] **Step 7: Commit**

```bash
git add src/components/DesktopReader.tsx src/components/MobileReader.tsx src/components/ChapterProgressBar.tsx src/components/MobileSheet.tsx src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(i18n): translate + RTL reader chrome (content dir unchanged)"
```

---

### Task 7: Reader panels — TOC, Highlights, Progress overlay

**Files:**
- Modify: `src/panels/TOCPanel.tsx`, `src/panels/HighlightsPanel.tsx`, `src/panels/ProgressOverlay.tsx`, `src/i18n/en.ts`, `src/i18n/ar.ts`

**Interfaces:**
- Consumes: `useI18n`; `PanelShell` (already dir-aware from Task 2).

- [ ] **Step 1: Add panel keys.** Extract per file. Known: `"Table of contents"` (reuse `reader.toc`), `"Highlights"`, `"Add note"`, `"Edit note"`, `"Delete highlight"` / `"Remove highlight"`, `"Highlight actions"` / `"Highlight options"`, `"Jump to"`, `"Progress"`, `"Hide progress bar"`, `"Chapter progress"`, plus any empty-state copy. Example:

```ts
// en.ts
  "highlights.title": "Highlights",
  "highlights.addNote": "Add note",
  "highlights.editNote": "Edit note",
  "highlights.delete": "Delete highlight",
  "highlights.actions": "Highlight actions",
  "highlights.empty": "No highlights yet",
  "toc.title": "Table of contents",
  "progress.title": "Progress",
```
```ts
// ar.ts
  "highlights.title": "التظليلات",
  "highlights.addNote": "إضافة ملاحظة",
  "highlights.editNote": "تعديل الملاحظة",
  "highlights.delete": "حذف التظليل",
  "highlights.actions": "خيارات التظليل",
  "highlights.empty": "لا تظليلات بعد",
  "toc.title": "قائمة المحتويات",
  "progress.title": "التقدّم",
```

- [ ] **Step 2: Consume `tr`** and replace literals (titles, aria-labels, empty states). Pass translated `title`/`side` to `PanelShell` (side stays `"left"`/`"right"`; PanelShell now mirrors it via logical borders).

- [ ] **Step 3: Convert physical CSS → logical** in each panel (1 spot each per the earlier count, plus any list-indent/`textAlign`).

- [ ] **Step 4: Verify — tsc** → PASS.

- [ ] **Step 5: Verify — behavior.** UI=العربية: open TOC / Highlights / Progress — panels slide in from the mirrored side, titles + actions Arabic, list rows right-aligned, note/delete affordances mirrored. English reverts.

- [ ] **Step 6: Commit**

```bash
git add src/panels/TOCPanel.tsx src/panels/HighlightsPanel.tsx src/panels/ProgressOverlay.tsx src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(i18n): translate + RTL reader panels (toc, highlights, progress)"
```

---

### Task 8: Search overlay, dialogs, import/download surfaces, toasts, app-root labels

Finishes primary-chrome coverage. Mostly text extraction; a few RTL spots (SearchOverlay 2).

**Files:**
- Modify: `src/components/SearchOverlay.tsx`, `src/components/ConfirmDialog.tsx`, `src/components/EditBookModal.tsx`, `src/components/ImportChoiceModal.tsx`, `src/components/DownloadRangeDialog.tsx`, `src/components/SaveAsOfflineBookDialog.tsx`, `src/components/ImportProgress.tsx`, `src/components/DownloadQueueView.tsx`, `src/components/Toast.tsx`, `src/App.tsx` (spinner label + error already-keyed), `src/i18n/en.ts`, `src/i18n/ar.ts`

**Interfaces:**
- Consumes: `useI18n` from Task 1.

- [ ] **Step 1: Add keys.** Extract each file with the Task-5 grep. Known strings across these surfaces to key: `"Search library"`/`"Search chapters"`, `"Clear search"`, `"Clear chapter search"`, `"Results"`, `"Jump to"`, `"Edit book details"`, `"Title"`, `"Author"`, `"Description"`, `"Add to library"` / `"Add directly to library"`, `"Continue in background"`, `"Stays running if you close this."`, `"Download range"`, `"Download chapter"`, `"Downloading chapters"`, `"Building EPUB"`, `"All caught up"`, `"Clear completed"`, `"Cancel download"`, `"Added to your library."`, and the App spinner `"Loading book…"` (already keyed `app.loadingBook` in Task 1 — apply it now). Add en/ar for each (follow the established key naming: `search.*`, `dialog.editBook.*`, `import.*`, `downloads.*`, `toast.*`).

- [ ] **Step 2: Consume `tr`** in each file and replace literals; apply `tr("app.loadingBook")` at `App.tsx` `FullPageSpinner` usage (App.tsx:398). Interpolate counts (e.g. `"Downloading {n} chapters"`).

- [ ] **Step 3: Convert physical CSS → logical** in `SearchOverlay.tsx` (2) and any dialog with `textAlign`/`left`/`right` (dialogs are mostly centered; convert only genuine start/end offsets).

- [ ] **Step 4: Verify — tsc** → PASS.

- [ ] **Step 5: Verify — behavior.** UI=العربية: open global search (⌘K), the Edit-book modal, the import-choice modal, a download-range dialog, and trigger a toast — all Arabic + right-aligned; inputs start the caret on the right. English reverts.

- [ ] **Step 6: Commit**

```bash
git add src/components/SearchOverlay.tsx src/components/ConfirmDialog.tsx src/components/EditBookModal.tsx src/components/ImportChoiceModal.tsx src/components/DownloadRangeDialog.tsx src/components/SaveAsOfflineBookDialog.tsx src/components/ImportProgress.tsx src/components/DownloadQueueView.tsx src/components/Toast.tsx src/App.tsx src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat(i18n): translate + RTL search, dialogs, import/download, toasts"
```

---

### Task 9: Final RTL audit, full drive-through, build gate

Catch stragglers and lock the invariants.

**Files:**
- Modify: any file surfaced by the audit greps below (targeted fixes only)

- [ ] **Step 1: Untranslated-string sweep.** Across the covered surfaces, find leftover hardcoded chrome text:
`grep -rnE '"[A-Z][a-z]+( [A-Za-z…]+)*"' src/components src/panels src/App.tsx | grep -vE 'FONT_|theme\.|Icon name=|aria-label=\{|import |from "'`
Review hits; route any real UI string through `tr` (add keys to both catalogs). Deferred Store/source files (`SourceHomeView`, `SourcesListView`, `NovelDetailView`, `SourceStreamReader`, `src/sources/**`) and raw thrown errors are out of scope — do not translate them this pass.

- [ ] **Step 2: Residual physical-CSS sweep** in covered files:
`grep -rnE 'textAlign: "(left|right)"|margin(Left|Right):|padding(Left|Right):|border(Left|Right):|[^a-zA-Z](left|right): ' src/components src/panels | grep -vE 'translateX|SourceHome|SourcesList|NovelDetail|SourceStream|sources/'`
Convert any remaining direction-sensitive value in a covered chrome file to its logical equivalent. (Symmetric `left:0;right:0` pairs and centering transforms are fine.)

- [ ] **Step 3: Verify — full build**

Run: `npx tsc --noEmit && pnpm build`
Expected: both PASS (production bundle compiles; catalogs complete).

- [ ] **Step 4: Verify — full drive-through matrix** (Playwright / `run` skill). For UI ∈ {Auto, English, العربية}:
  1. Language switch is live (no reload) and persists across reload.
  2. Under العربية every covered surface is Arabic + mirrored: sidebar right, panels from the correct side, back/prev-next/disclosure icons flipped, text right-aligned.
  3. **Decoupling matrix:** {Arabic UI + English book} → chrome RTL, content LTR; {English UI + Arabic book} → chrome LTR, content RTL. Content direction never follows the UI.
  4. Themes (light/sepia/dark/oled/system) still switch correctly under both directions.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(i18n): final RTL audit + build gate for Arabic UI"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- i18n module (catalogs/types/provider/hook) → Task 1. ✓
- `Tweaks.uiLang` + default + no-migration → Task 1 (Steps 6–7). ✓
- Auto-detect (`detectLocale`) + `DIR_FOR` → Task 1 (Step 3, 8). ✓
- Root `dir`/`lang` + shell `dir` replaces hardcoded `ltr` → Task 1 (Step 8). ✓
- Settings Language selector (`[Auto|English|العربية]`) → Task 2. ✓
- Logical-property RTL conversion → Tasks 4–8, audited in Task 9. ✓
- Directional-icon flipping → Task 3 (primitive) + Tasks 4/6 (applied). ✓
- Dir-aware panel `side`/slide → Task 2 (PanelShell) + Task 7 (panels). ✓
- Coverage set (sidebar, library, reader chrome, panels, search, dialogs, import/download, toasts, app-root) → Tasks 4–8. ✓
- Deferred Store/source internals + raw errors → explicitly excluded in Tasks 8–9. ✓
- Chrome Arabic font → no task needed (Readex Pro sans already Latin+Arabic; noted in Tech Stack). ✓
- Verification: tsc + drive matrix + decoupling → each task's Verify steps + Task 9. ✓

**Placeholder scan:** No "TBD/TODO/handle edge cases". Per-surface tasks give the extraction grep + concrete example keys/values + the exact conversion recipe rather than a full 200-key dump; completeness is enforced by the tsc gate (`ar.ts: Messages`). This is intentional, not a placeholder.

**Type consistency:** `tr`, `Tr`, `MsgKey`, `Messages`, `Locale`, `Dir`, `UiLangPref`, `detectLocale`, `interpolate`, `DIR_FOR`, `makeTr`, `I18nProvider`, `useI18n` are named identically everywhere they appear. `useI18n()` returns `{ locale, dir, tr }` consistently. `Tweaks.uiLang: UiLangPref` matches the `SegRow<UiLangPref>` in Task 2.
