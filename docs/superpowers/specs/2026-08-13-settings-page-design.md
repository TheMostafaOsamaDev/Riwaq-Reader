# Settings — dedicated page + expanded options

Status: design approved, ready for implementation plan
Owner: Mostafa Osama
Scope: promote the settings surface from a modal **dialog** to a real **top-level
page** (peer of Library/Reader, no router), fold the existing appearance/typography
controls into it, keep the reader's inline quick-panel, and add four groups of
**new settings** (Reading, Behavior, Downloads, Data/About) plus a **selectable UI
(app-chrome) font** with newly self-hosted Arabic-capable families. No new dependencies.

New: `src/components/SettingsPage.tsx` (the page), `src/components/SettingsSection.tsx`
+ shared field primitives (extracted), `src/hooks/useWakeLock.ts`, self-hosted font
assets under `public/fonts/ui/`. Touches
`src/App.tsx` (top-level view + navigation state, wake lock, startup view, reduce-motion
override wiring, `--ui-font` variable), `src/types/reader.ts` (`Tweaks` new fields incl.
`uiFont`), `src/hooks/useTweaks.ts` (defaults + bulk apply + migration),
`src/components/Library.tsx` (rewire `onOpenSettings` to navigate; remove sheet mount;
confirm-delete honoring), `src/panels/SettingsPanel.tsx` (new reading toggles + "Open
full settings" link), `src/store/downloadQueue.ts` (runtime concurrency + Wi-Fi gate),
`src/styles/motion.ts` (reduce-motion override), `src/styles/global.css` (`@font-face`
for the new UI families + Thmanyah serif display), `src/styles/tokens.ts`
(`UI_FONT_STACKS`, `uiFont` resolution, Arabic-capable `FONT_SERIF_DISPLAY`),
`src/i18n/en.ts` + `src/i18n/ar.ts` (new keys, both catalogs).
Removed: `src/components/SettingsSheet.tsx`.

## Problem / motivation

Settings today are split and shallow:

- `SettingsSheet.tsx` — opened from the Library as a full-screen `AnimatedFullScreen`
  **dialog**; only Language + Theme. Its own header comment concedes it is deliberately
  minimal ("Today: the theme picker only").
- `panels/SettingsPanel.tsx` — the richer **reader** side-panel (font, size, line
  height, letter spacing, content width, alignment, reading mode, mobile tap-nav).

There is no single "settings home", and several everyday preferences (startup
behavior, delete confirmation, download limits, keep-awake, data reset/backup)
don't exist. This design makes Settings a proper destination and grows the option
set, while keeping the reader's on-the-fly quick-adjust panel.

## Facts this design rests on (verified by code reconnaissance)

- **No router.** `App.tsx` swaps top-level views by state through the root
  `AnimatedSwap` (`viewKey` = `library` / `reader-mobile` / `reader-desktop`), with a
  separate streaming overlay. Settings will become another `viewKey`.
- **Settings state is one hook.** `useTweaks()` → `Tweaks` (typed in
  `src/types/reader.ts`), persisted to `localStorage` (`leaflet:tweaks:v1`), passed
  down by props. Every control the page and the reader panel expose edits the same
  `Tweaks`, so the two surfaces stay in sync by construction.
- **Settings entry is already abstracted.** Both layouts call
  `onOpenSettings()` (Library.tsx `layoutCommonProps`, LibrarySidebar `NavRow`).
  Rewiring that callback to navigate is a single seam.
- **Download concurrency is a constant.** `downloadQueue.ts:129` `const CONCURRENCY = 2`;
  the module-scoped worker pump can be taught to read a runtime value instead.
- **Reduce motion reads the OS.** `motion.ts` `useReducedMotion()` reflects
  `(prefers-reduced-motion: reduce)`; an app-level override can compose on top.
- **Reading typography is applied inline in `BookBody`.** Line height / letter
  spacing are inline styles; paragraph gap is a hardcoded `marginBottom: "1.4em"`.
  Paragraph spacing and CSS `hyphens` are cheap to make tweak-driven.
- **Platform APIs available.** `@tauri-apps/api/app` `getVersion()`,
  `@tauri-apps/plugin-opener` (already a dep) for external links,
  `@tauri-apps/plugin-dialog` + `plugin-fs` (already deps) for export/import.
- **Fonts are self-hosted.** `global.css` declares `@font-face` for Readex Pro (UI)
  and the reading families (Cairo/Lateef/Tajawal) from `/public/fonts/`; stacks live in
  `tokens.ts` `FONT_STACKS`. The **entire chrome is pinned to `FONT_STACKS.sans`
  (Readex Pro)** — set inline in many components — so making the UI font selectable
  means routing chrome text through a CSS variable rather than the literal stack.
- **Fraunces has no Arabic glyphs.** `FONT_SERIF_DISPLAY` (Fraunces) is the editorial
  display serif, but multiple components special-case `locale === "ar"` to fall back to
  the Readex sans to avoid tofu. The newly bundled **Thmanyah serif display** is an
  Arabic-capable serif that closes this gap.
- **New font assets already copied** into `public/fonts/ui/`: `Alexandria-Variable.ttf`,
  `Vazirmatn-Variable.ttf`, `Almarai-{Regular,Bold}.ttf`,
  `IBMPlexSansArabic-{Regular,Medium,SemiBold,Bold}.ttf`, `thmanyah/*.woff2`
  (Light/Regular/Medium/Bold/Black), each with its OFL license. Cairo & Tajawal are
  reused from the existing `public/fonts/reading/` bundle (not duplicated).
- **i18n has a build gate.** Every user-facing string is a `settings.*`-style key in
  BOTH `src/i18n/en.ts` and `src/i18n/ar.ts`; the catalog completeness gate fails the
  build if a key is missing from either. All new labels must land in both.

## Architecture — settings as a top-level view

Settings state lifts from `Library` to `App`:

```
type TopView = "library" | "reader" | "settings";
```

- `App` holds `settingsOpen` + `settingsReturn: "library" | "reader"`.
  Opening settings records where the user came from; the back button returns there,
  preserving the underlying view (Library scroll / open book) since those views stay
  mounted state-wise exactly as they are for the existing Library↔Reader swap.
- The root `AnimatedSwap` gains a `settings` slot rendering `<SettingsPage>` above/beside
  the current Library/Reader slot. Forward navigation slides/fades in; back reverses —
  consistent with existing motion and reduced-motion handling.
- **Entry points** (unchanged call sites, new behavior): Library sidebar / mobile
  "Settings" → `onOpenSettings()` now calls up to `App` to open the page. The reader's
  quick-panel gains an **"Open full settings"** row that opens the page with
  `settingsReturn = "reader"`.
- `SettingsSheet.tsx` and its two `AnimatedFullScreen` mounts in `Library.tsx` are
  **deleted**; Language + Theme move onto the page.

## New `Tweaks` fields (defaults + migration)

Added to `Tweaks` (with the existing fields kept):

| Field | Type | Default | Group |
|---|---|---|---|
| `uiFont` | `"readex" \| "alexandria" \| "almarai" \| "cairo" \| "ibmplex" \| "tajawal" \| "vazirmatn"` | `"readex"` | Appearance |
| `paragraphSpacing` | `number` (em, 0.8–2.4) | `1.4` | Reading |
| `hyphenation` | `boolean` | `false` | Reading |
| `pageTurnAnimation` | `boolean` | `true` | Reading |
| `keepScreenAwake` | `boolean` | `false` | Reading |
| `startupView` | `"resume" \| "library"` | `"library"` | Behavior |
| `confirmDelete` | `boolean` | `true` | Behavior |
| `reduceMotion` | `"auto" \| "on" \| "off"` | `"auto"` | Behavior |
| `maxConcurrentDownloads` | `number` (1–5) | `2` | Downloads |
| `wifiOnlyDownloads` | `boolean` | `false` | Downloads |

`DEFAULT_TWEAKS` gains these; the existing `{ ...DEFAULT_TWEAKS, ...parsed }` merge in
`useTweaks.load()` back-fills them for existing users — no migration code needed beyond
adding the defaults. `useTweaks` also gains a **bulk apply** (`applyTweaks(partial)`)
used by Import and Reset (validates keys against `DEFAULT_TWEAKS`, ignores unknowns).

## Sections & controls (single centered column)

Layout: sticky header (back button + "Settings" title) over grouped sections built from
the existing `Field` / `SegRow` / `SectionLabel` primitives (extracted into
`SettingsSection.tsx` so the reader panel and the page share them and can't drift). The
content column is centered and `max-width`-capped (~600px) on desktop; full-bleed with
safe-area padding on mobile — mirroring `DownloadQueueView`. Theme-aware and RTL-aware
(logical properties, `rtl-flip-x` on the back chevron) per the existing i18n/RTL work.

1. **Appearance** — Language (Auto/EN/العربية), Theme (4 swatches + System) *[moved
   from the removed sheet]*, **+ new:** UI font picker (each option previewed in its own
   typeface, Arabic name for Arabic UI) — see **UI font & Arabic display serif** below.
2. **Reading** — font family, size, line height, letter spacing, content width,
   alignment, reading mode *[existing]* **+ new:** paragraph spacing (slider),
   hyphenation (On/Off), page-turn animation (On/Off), keep screen awake (On/Off).
   Mobile tap-nav group stays and remains mobile-only. The reading field set is the
   shared component the reader quick-panel also renders.
3. **Behavior** *(new)* — Startup view (Resume last book / Library), Confirm before
   deleting a book (On/Off, default On), Reduce motion (Auto / On / Off).
4. **Downloads** *(new)* — Max concurrent downloads (1–5 stepper/slider), Wi-Fi-only
   downloads (On/Off, with best-effort hint — see below).
5. **Data** *(new)* — Export settings (→ JSON file), Import settings (← JSON file),
   Reset all settings to defaults (danger styling, `ConfirmDialog`). Reset/destructive
   actions are visually separated from the rest.
6. **About** *(new)* — app name + version (`getVersion()`), repository link and MIT
   license link (opened via `plugin-opener`).

## Wiring the new behaviors

- **Paragraph spacing / hyphenation / page-turn** — `paragraphSpacing` replaces the
  hardcoded `1.4em` paragraph gap in `BookBody`; `hyphenation` toggles CSS
  `hyphens: auto` (+ `lang` already set) on paragraphs; `pageTurnAnimation=false`
  short-circuits the paginated page-flip transition (falls back to an instant jump).
- **Keep screen awake** — new `useWakeLock(active)` hook: requests
  `navigator.wakeLock.request("screen")` while `keepScreenAwake && (book open || streaming)`,
  re-acquires on `visibilitychange`, releases on teardown. Wrapped in try/catch —
  **best-effort**: works on desktop webviews, silently no-ops where unsupported (e.g.
  some Android webviews). No user-facing error.
- **Startup view** — on `App` mount, if `startupView === "resume"`, read the library
  index (newest `lastReadAt` entry) and `openBook()` it; otherwise land on the Library
  as today. No-op when the library is empty.
- **Confirm before delete** — `Library.requestDelete` checks `confirmDelete`; when off,
  it deletes immediately (with the existing undo/toast path) instead of showing
  `ConfirmDialog`.
- **Reduce motion override** — `motion.ts` gains a tiny pub-sub
  (`setReduceMotionOverride("auto"|"on"|"off")`) that `App` calls whenever the tweak
  changes; `useReducedMotion()` returns `on → true`, `off → false`, `auto → OS value`,
  and re-renders subscribers on change. Composes cleanly without threading props into
  `AnimatedSwap`/panels.
- **Max concurrent downloads** — `downloadQueue.ts` replaces the `CONCURRENCY` constant
  with a runtime value + `setDownloadConcurrency(n)` (clamped 1–5); the worker pump
  reads the current value when deciding whether to start another job. `App` calls the
  setter on tweak change and at startup. Already-running jobs finish; only new starts
  respect a lowered limit.
- **Wi-Fi-only downloads** — `setWifiOnlyDownloads(bool)`; before starting a **new**
  job the pump consults the Network Information API (`navigator.connection.type` /
  `.effectiveType` / `.saveData`). If it can determine the link is cellular/metered and
  the toggle is on, the job waits (a "waiting for Wi-Fi" hold) instead of starting.
  **Best-effort**: where the platform doesn't report connection type (most desktop
  webviews), it degrades to "allow", and the toggle carries a hint saying so. Full
  native enforcement (a Tauri/Android connectivity command) is an explicit follow-up.

## UI font & Arabic display serif

### Selectable UI (chrome) font
- New `uiFont` tweak (Appearance). Picker options rendered each in their own typeface:
  Readex Pro (default), Alexandria, Almarai, Cairo, IBM Plex Sans Arabic, Tajawal,
  Vazirmatn. All are Latin+Arabic capable.
- `@font-face` (global.css) for the newly bundled families from `/fonts/ui/`:
  Alexandria (variable), Vazirmatn (variable), Almarai (400/700), IBM Plex Sans Arabic
  (400/500/600/700). Cairo, Tajawal, Readex Pro are already declared and reused.
- `tokens.ts` gains `UI_FONT_STACKS: Record<UiFontKey, string>` (7 stacks, each ending in
  the Readex/system fallback).
- **Application via CSS variable, near-zero churn.** `App` sets `--ui-font` on the root
  shell element to `UI_FONT_STACKS[uiFont]`. `FONT_STACKS.sans` is redefined to
  `'var(--ui-font, "Readex Pro", -apple-system, …)'` — so every existing chrome usage of
  `FONT_STACKS.sans` follows the selection automatically, and the var's default value
  reproduces today's Readex Pro exactly when unset.
- **Critical decoupling — chrome font must not bleed into content.** `FONT_STACKS.sans`
  is currently also used content-side (the reader's "sans" reading option and
  `titleFontFor`'s Arabic branch for covers/titles). Those must stay Readex regardless of
  chrome font. Introduce `FONT_READING_SANS` (literal Readex stack) and switch the
  content-side usages to it; the reading-font fallback chains already list the string
  `"Readex Pro"` literally and are unaffected. The Understand phase enumerates every
  `FONT_STACKS.sans` site and classifies it chrome vs content so none are missed.

### Arabic display serif (Thmanyah)
- `@font-face` "Thmanyah Serif Display" (Light/Regular/Medium/Bold/Black) from
  `/fonts/ui/thmanyah/*.woff2`.
- `FONT_SERIF_DISPLAY` becomes
  `'"Fraunces", "Thmanyah Serif Display", "Literata", "Readex Pro", Georgia, serif'` —
  Latin renders in Fraunces where present; Arabic glyphs now fall through to Thmanyah
  instead of tofu/sans.
- The `locale === "ar" ? FONT_STACKS.sans : FONT_SERIF_DISPLAY` heading special-cases
  (App spinner, panel/section headings, chapter titles/drop-caps) switch to using
  `FONT_SERIF_DISPLAY` for Arabic too, so Arabic headings finally render in a real serif
  display. The Understand phase enumerates these spots.

## Reader quick-panel relationship

`panels/SettingsPanel.tsx` stays as the in-reader quick-adjust surface. It (a) renders
the same shared Reading field set as the page's Reading section (so a change in either
is reflected in both, structurally and via shared `Tweaks` state), and (b) gains an
"Open full settings" row that navigates to the page. It is not removed.

## i18n

Every new label/hint is added as a `settings.*` key to **both** `src/i18n/en.ts` and
`src/i18n/ar.ts` (section titles, each control label incl. `settings.uiFont`, the
Wi-Fi/keep-awake best-effort hints, Data action labels + confirm copy, About strings).
The build gate enforces parity. Font family names are proper nouns shown in their own
typeface — not translated. Arabic typography conventions already handled by the shared
primitives (no uppercase/tracking on `ar`) carry over.

## Testing / verification

- Navigation: open Settings from Library and from the reader; back returns to the
  correct origin with state intact; forward/back motion respects reduced-motion.
- Each new tweak persists across reload and drives its effect (paragraph gap,
  hyphenation, page-turn instant vs animated, download limit, confirm-delete skip,
  reduce-motion override, startup resume).
- Export → Import round-trips settings; Reset restores defaults behind a confirm.
- Best-effort items degrade silently where unsupported (no thrown errors, no blocked UI).
- **UI font:** switching `uiFont` re-fonts the whole chrome live and persists; book
  covers, titles, and reading content are unaffected (content-side decoupling holds).
  Arabic headings render in the Thmanyah serif display, not the sans fallback.
- Build passes (TypeScript + i18n catalog gate); Arabic/RTL layout of the page verified
  in both themes on a 375px viewport and desktop.

## Out of scope (YAGNI)

- **Storage usage readout + Clear cache** — deferred (not in this version).
- **A real router / deep-linkable `/settings`** — the state-driven page is enough now.
- **Full native Wi-Fi enforcement** — v1 ships the best-effort web gate only.
- **Font conversion/subsetting pipeline** — fonts ship as provided (.ttf for the sans
  families, .woff2 for Thmanyah); no build-time subsetting. Cairo/Tajawal reused from the
  existing reading bundle rather than re-added.
- Per-book setting overrides; cloud sync of settings.
