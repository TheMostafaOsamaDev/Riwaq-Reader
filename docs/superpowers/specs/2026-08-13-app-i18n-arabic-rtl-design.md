# App UI internationalization (i18n) — Arabic + RTL

Status: design approved, ready for implementation plan
Owner: Mostafa Osama
Scope: introduce a lightweight, typed i18n layer for the **application chrome**
(not book content) and ship **Arabic** as the first non-English UI language,
selectable in Settings, with the whole app shell mirroring to **RTL** when the
UI language is Arabic. Auto-detects the OS/browser locale on first run, with a
manual override. No new dependencies.

New: `src/i18n/` (catalogs, provider, hook). Touches `src/types/reader.ts`
(`Tweaks.uiLang`), `src/hooks/useTweaks.ts` (default + migration), `src/App.tsx`
(root `dir`/`lang` + provider), `src/panels/SettingsPanel.tsx` (language field),
and the primary-chrome components enumerated under **Coverage** — for string
extraction and RTL logical-property conversion. `index.html` `lang` attr is
overridden at runtime.

## Problem / motivation

The app is Arabic-forward in brand (title `رواق`, wordmark "Riwaq", Arabic fonts
bundled) but every UI string is hardcoded English and the shell is pinned
`dir="ltr"`. Arabic-reading users get an English, left-to-right interface. We
want the interface itself available in Arabic with correct right-to-left layout,
built on an architecture that makes adding further languages mechanical.

This is distinct from **book-content** localization, which already works: a
book's reading direction is derived per-book from its language
(`src/docx/detectDirection.ts`) and rendered by `BookBody` setting its own `dir`.
That stays untouched.

## Core principle — two independent directions

The codebase already separates **chrome direction** from **content direction**
(App.tsx:389 pins the shell `dir="ltr"` with a comment explaining that book
content sets its own `dir`). This design formalizes that seam:

- **UI direction** — driven by the selected UI language. Arabic → RTL, English →
  LTR. Flips the entire app shell: sidebar side, panel slide-in side, row/text
  alignment, directional icons.
- **Content direction** — unchanged, derived per-book. An English UI can display
  an Arabic book and an Arabic UI an English book; neither forces the other.

Invariant to preserve and verify: `BookBody`/reader content keep setting their
own `dir` explicitly and are **not** affected by the UI language.

## Facts this design rests on (verified by code reconnaissance)

- **No i18n today.** ~150–250 user-facing strings (JSX text, `aria-label`,
  `title`, placeholders) hardcoded English across ~90 TS/TSX files.
- **Settings model.** `Tweaks` (`src/types/reader.ts`) is the app's typed
  preferences bag, persisted to `localStorage` key `leaflet:tweaks:v1` by
  `useTweaks`. It already holds an **app-level** pref (`theme`) alongside
  reader prefs, so `uiLang` belongs here too. `load()` spreads
  `{ ...DEFAULT_TWEAKS, ...parsed }`, so a newly added default is picked up by
  existing stored data automatically — no migration code needed for the add.
- **`theme: "system"` precedent.** `theme` supports a `"system"` value resolved
  at render time via `resolveTheme(pref, prefersDark)` in `src/styles/tokens.ts`.
  `uiLang: "system"` mirrors this exactly.
- **Name collision.** The `Tweaks` object is conventionally passed as the prop
  `t` throughout the reader (`t.fontSize`, `t.theme`). The translator therefore
  must **not** be named `t`; it is named **`tr`**.
- **Arabic fonts already bundled** (Cairo, Lateef, Tajawal, Amiri) via
  `FONT_STACKS` and the `index.html` font link — available for chrome text.
- **Panels take a `side` prop** (`"left" | "right"`) and slide in from that side
  (`SettingsPanel`, `PanelShell`, and siblings) — the hook for dir-aware entry.
- **Directional icons** exist in `src/components/Icon.tsx` (`chevronR`,
  back/arrow glyphs) — these must mirror in RTL; non-directional icons must not.

## Architecture — the i18n module

New directory `src/i18n/`, zero new dependencies:

```
src/i18n/
  en.ts              // source of truth: const en = { "settings.theme": "Theme", ... } as const
  ar.ts              // const ar: Messages = { "settings.theme": "المظهر", ... }
  index.ts           // Locale, Dir, MsgKey, Messages types; catalog map; detectLocale(); DIR_FOR
  I18nProvider.tsx   // context: resolves pref -> locale, exposes { locale, dir, tr }
  useI18n.ts         // hook -> { locale, dir, tr }
```

- **Keys:** flat, dot-namespaced strings (`"sidebar.search"`,
  `"settings.language"`, `"reader.back"`). `en.ts` is the single source of truth.
  `type MsgKey = keyof typeof en`. `type Messages = Record<MsgKey, string>`, and
  `ar.ts` is annotated `: Messages` — so **a missing or misspelled Arabic key is
  a compile-time error**, with full editor autocomplete on `tr("…")`.
- **Translator `tr`:** `tr(key: MsgKey, params?: Record<string, string | number>)`.
  Interpolates `{name}`-style placeholders. A tiny plural helper handles the few
  count strings that need singular/plural (Arabic dual/plural handled per-string,
  not via a general ICU engine — deliberately minimal).
- **Runtime fallback:** missing Arabic string → English → the key itself (never
  throws, never blank).
- **Provider:** `I18nProvider` receives the resolved `locale` (computed at the
  root from `Tweaks.uiLang`) and exposes `{ locale, dir, tr }` via context.
  `useI18n()` reads it. Switching language re-renders subscribers live; no reload.

## State, persistence & detection

- Add `uiLang: "system" | "en" | "ar"` to `Tweaks`.
- `DEFAULT_TWEAKS.uiLang = "system"`.
- No new persistence path — rides `leaflet:tweaks:v1` via `useTweaks`. Existing
  users get `"system"` for free through the `load()` default-spread.
- **`detectLocale(pref, navigatorLang): Locale`** in `src/i18n/index.ts`:
  - `"en"` / `"ar"` → pin that locale.
  - `"system"` → inspect `navigator.language` (webview reports the OS locale);
    `ar*` → `"ar"`, otherwise `"en"`.
- **`DIR_FOR: Record<Locale, Dir>`** — `ar → "rtl"`, `en → "ltr"`.
- Resolved once at the app root, exactly like `resolveTheme`.

## Direction & RTL application

- **Root effect (App.tsx):** set `document.documentElement.lang = locale` and
  `document.documentElement.dir = dir`; replace the hardcoded shell `dir="ltr"`
  (App.tsx:389) with the resolved UI `dir`.
- **Logical-property conversion (the real RTL work).** `dir="rtl"` does not flip
  *physical* CSS, so the primary-chrome components are audited and their
  direction-sensitive inline styles converted:
  - `textAlign: "left"` → `"start"` (and `"right"` → `"end"` where it means "the
    trailing edge").
  - `left` / `right` → `insetInlineStart` / `insetInlineEnd`.
  - `marginLeft` / `marginRight` → `marginInlineStart` / `marginInlineEnd`
    (incl. `marginLeft: "auto"` push-to-end patterns).
  - `paddingLeft` / `paddingRight` → `paddingInlineStart` / `paddingInlineEnd`.
  - `borderLeft` / `borderRight` → `borderInlineStart` / `borderInlineEnd`; and
    mirror hard-coded asymmetric `borderRadius` corners.
  - Direction-agnostic transforms (`translateX(-50%)` centering) are left as-is.
- **Directional icons:** back arrows and collapse chevrons (`chevronR`, and any
  left/right arrow) flip horizontally under RTL (via a dir-aware `scaleX(-1)` or
  swapped glyph); non-directional icons (search, settings, download, grid…) do
  not change.
- **Panels:** the `side` prop and slide-in animation for `SettingsPanel` /
  `TOCPanel` / `HighlightsPanel` become dir-aware — a panel entering from the
  right in LTR enters from the left in RTL.
- **Sidebar:** with the shell `dir="rtl"` the flex layout moves the sidebar to
  the right automatically; its internal physical styles are converted to logical
  so inner alignment mirrors correctly.
- **Chrome font:** Arabic UI text renders in an Arabic-appropriate UI font
  (Cairo/Tajawal from `FONT_STACKS`), independent of the reader's *content* font.
- RTL/bidi best-practices and the accessibility checklist are sourced from the
  **`ui-ux-pro-max`** skill at implementation time (per repo CLAUDE.md rule), so
  mirroring follows a vetted pattern rather than ad-hoc fixes.

## Settings UI

A new **"Language"** field in `SettingsPanel`, reusing the existing `SegRow`
component for visual consistency:

`[ Auto ]  [ English ]  [ العربية ]`

- Bound to `t.uiLang` via `setTweak("uiLang", …)`.
- English/Arabic labels shown each in their own script; "Auto" localized.
- Changing it re-renders the whole app live (context + resolved `dir`).

## Coverage — "infra + all primary chrome" (this pass)

Extract and translate strings (including `aria-label` / `title`) across the
surfaces the user navigates:

- Navigation & library: `LibrarySidebar`, `Library` + tabs, `ShelvesPage`,
  `NewShelfDialog`.
- Settings: `SettingsPanel`, `SettingsSheet`.
- Reader chrome: `DesktopReader`, `MobileReader` toolbars (back/close/progress),
  `ChapterProgressBar` labels, `MobileSheet` chrome.
- Panels: `TOCPanel`, `HighlightsPanel`, `ProgressOverlay`, `PanelShell`.
- Search: `SearchOverlay`.
- Dialogs & flows: `ConfirmDialog`, `EditBookModal`, `ImportChoiceModal`,
  `DownloadRangeDialog`, `SaveAsOfflineBookDialog`, `ImportProgress`,
  `DownloadQueueView`.
- Cross-cutting: toast messages (`Toast`), the `App.tsx` spinner/error labels.

**Deferred (still render English this pass):** deep Store / source-extension
internals (`SourceHomeView`, `SourcesListView`, `NovelDetailView`,
`SourceStreamReader`, `src/sources/**`) and raw thrown-error strings. The typed
catalog makes finishing these mechanical later — every new string added anywhere
goes through `tr` from now on.

## Testing / verification

- **`tsc` passes** — proves `ar.ts` covers every `MsgKey` (no missing
  translations) and no `t`/`tr` collisions.
- **Drive the app** (`run` skill / Playwright):
  1. Settings → Language: `Auto → English → العربية`.
  2. Under العربية: whole shell mirrors RTL, sidebar moves to the right, panels
     slide from the correct side, back/chevron icons flip, chrome text is Arabic.
  3. **Decoupling check:** open an Arabic book while UI = English (content RTL,
     chrome LTR) and an English book while UI = العربية (content LTR, chrome RTL)
     — each content keeps the book's own direction, unaffected by the UI.
  4. Reload → language + direction persist (via `leaflet:tweaks:v1`).

## Out of scope (YAGNI)

- Languages beyond `en` / `ar` (architecture supports them; none added now).
- Translating deferred Store/source internals and low-level error messages.
- Per-book UI-language overrides.
- A full ICU / plural-rules framework.
- Server/remote translation loading (catalogs are static TS modules).
