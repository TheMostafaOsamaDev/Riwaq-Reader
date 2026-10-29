# Reader text color per theme (+ Markazi Text default font)

Status: design approved in conversation; builder-check answers folded in
Owner: Mostafa Osama
Scope: let the reader pick the **color of the book text**, from a short list that
is different for each of the four themes, with each theme remembering its own
pick. Separately, make **Markazi Text** the default reading font for new installs.
No new themes, no new dependencies.

Touches: `src/styles/tokens.ts` (text-color palettes + resolver),
`src/types/reader.ts` (`Tweaks.textColor`), `src/hooks/useTweaks.ts` (default,
load validation, default font), `src/components/SettingsSection.tsx` (new
`TextColorField`), `src/panels/SettingsPanel.tsx` (place it in the reflow
variant, and in the fixed variant for DOCX), `src/components/SettingsPage.tsx` (place it in Appearance),
`src/components/BookBody.tsx` + `src/components/ChapterOpener.tsx` (use the
chosen color), whatever plumbing carries the color from `App.tsx` to those two
(`DesktopReader.tsx`, `MobileReader.tsx`), `src/reader/fixed/FixedPageViewer.tsx`
+ `FixedPageReader.tsx` (DOCX text and the DOCX quick panel),
`src/i18n/en.ts` + `src/i18n/ar.ts`.

## Why

Each theme has one fixed text color today (`THEMES[key].ink`). Readers want to
tune the text itself without changing the whole theme: a softer ink on Light, a
warmer amber on OLED at night, a navy on white. The choice has to feel like part
of the theme, which is why each theme gets its own colors and keeps its own
pick.

## Goals

- A **Text color** row directly under the Theme row, in the reader's quick panel
  and in the full Settings page.
- Five colors per theme. The first is the theme's current `ink`, so **nothing
  changes for anyone until they pick a color**.
- Each theme remembers its own pick. Switching Light → Dark → Light brings the
  Light pick back.
- When the theme preference is **System**, the reader uses the saved color of
  whichever theme System resolved to (Light or Dark), and the row edits that
  theme's color.
- Every color stays readable on its theme, including where a highlight sits
  behind the text (see the readability rule below).

## Non-goals

- New themes. (Mocked up and explicitly dropped.)
- A free color picker or custom hex input. Fixed list per theme only.
- Recoloring app chrome: top/bottom bars, panels, sheets, menus, buttons, the
  chapter-end card, the progress bar. These keep the theme's `ink` / `chromeInk`.
- PDF books. Their pages are rendered images, so their text color cannot
  change, and the row is not shown in the quick panel while a PDF is open.
  (DOCX is **in**: its pages are real text. See below.)

## Anti-goals (failure even if it "works")

- Any offered color that is hard to read on its theme, or under a highlight.
- Anyone's books changing color on update without them choosing it.
- A bad or partial saved value wiping other saved settings or crashing load.

## Decisions made with the owner

- **Layout B**: Text color is its own row under Theme, shown as chips. Each chip
  is a small swatch of the current theme's page with a two-letter glyph drawn
  in that color and the color's name under it. (Layouts A, dots under the theme
  tiles, and C, dots inside each theme card, were mocked and rejected.)
- Per-theme memory, System behavior, chrome-stays-put, and fixed list: as in
  Goals / Non-goals above.
- **Covers EPUB, web novels and DOCX**; PDF is excluded. (DOCX was first left
  out on the wrong belief that its pages are images; the owner chose to
  include it once that was corrected.)
- **OLED has no "Dim"**: OLED's Default is already as dim as text can be and
  stay readable, so a readable Dim looked identical to it. The owner chose
  **Sage green** in its place.
- **Markazi Text default**: `DEFAULT_TWEAKS.fontFamily` becomes `"markazi"`.
  It reaches new installs and anyone who taps **Reset to defaults**. People
  who already have a saved font keep it.

## The palettes

Persisted by **id**, never by hex, so colors can be retuned later without
migrating anyone. `default` always resolves to the theme's own `THEMES[key].ink`
(do not duplicate the hex; read it from `THEMES`), so retuning a theme's ink
retunes its default text color too.

| Theme | id | Hex | English | Arabic |
|---|---|---|---|---|
| light | default | `THEMES.light.ink` (#1f1a14) | Default | افتراضي |
| light | soft | #4a4238 | Soft | هادئ |
| light | graphite | #2e3338 | Graphite | رصاصي |
| light | navy | #1f3a5f | Navy | كحلي |
| light | brown | #5b3a1e | Brown | بنّي |
| sepia | default | `THEMES.sepia.ink` (#3a2f1f) | Default | افتراضي |
| sepia | deep | #22190e | Deep | داكن |
| sepia | coffee | #5b3a1e | Coffee | قهوة |
| sepia | olive | #3d4a2a | Olive | زيتوني |
| sepia | plum | #4a2a3a | Plum | برقوقي |
| dark | default | `THEMES.dark.ink` (#d8cbb0) | Default | افتراضي |
| dark | paper | #ece6da | Paper | ورقي |
| dark | silver | #c9c1b7 | Silver | فضي |
| dark | amber | #eabb70 | Amber | كهرماني |
| dark | sage | #b8c8a8 | Sage | مريمي |
| oled | default | `THEMES.oled.ink` (#b8ad94) | Default | افتراضي |
| oled | sage | #9fc0a0 | Sage | مريمي |
| oled | amber | #d5a357 | Amber | كهرماني |
| oled | coral | #ff8a75 | Coral | مرجاني |
| oled | moon | #c8ccd2 | Moon | قمري |

The order in the table is the order on screen. Names are translated per id, so
one id used by two themes (e.g. `amber`) shares one name. The Arabic names are
my proposal and may be polished, but keep them short: they sit under a ~50px
chip at ~9px.

Differences from the mockup the owner saw, all forced by the readability rule
measured on the real page surface: Dark's Silver, Amber and Sage and OLED's
Amber were lightened just enough to pass (same hue, same role); OLED's Dim
became Sage green (owner's choice); OLED's "Night red" had to lighten to a
coral to pass, so it is renamed **Coral** (my call: "night red" no longer
describes it).

### Readability rule (enforced by a test)

Book text is drawn on `readingSurfaces(theme).page`, not on `bg`/`paper`. On
Light and Sepia that is `paper`; on the near-black themes it is lifted (Dark
#282422, OLED #0f0f0f), which lowers contrast for light text. DOCX cards use the
same page surface (`--reading-paper`). Every palette color must reach **at
least 4.5:1** (WCAG AA contrast) against:

1. `readingSurfaces(theme).page`,
2. that page with **each** of the eight highlight tints composited on top
   (`HIGHLIGHT_COLORS[c][isDarkTheme ? "dark" : "light"]`, alpha-blended).

The test must compute the page with `readingSurfaces()` itself, not a copied
hex, so a change to the surface step re-checks the palette.

Measured worst cases with the table above: Light 6.91, Sepia 5.84, Dark 4.61,
OLED 4.60. Every Default passes (OLED's Default is the tightest at 4.75).
If a future palette or highlight change breaks the rule, retune the color (lightness first, keep the hue); do not relax the threshold.

## Data model

```ts
// tokens.ts
export type TextColorId = string;            // per-theme ids from the table
export const TEXT_COLORS: Record<ThemeKey, ReadonlyArray<{ id: TextColorId; hex: string | null }>>;
//   hex: null for "default" → resolves to THEMES[key].ink
export function resolveTextColor(themeKey: ThemeKey, picks: Tweaks["textColor"]): string;
//   unknown / missing id → THEMES[themeKey].ink
```

(The exact type shapes are the builder's call; a per-theme string-literal union
is welcome if it stays readable.)

```ts
// types/reader.ts — new field on Tweaks
/** Book-text color per theme, by palette id (see TEXT_COLORS). Each theme keeps
 *  its own pick; "system" uses the entry of whichever theme it resolves to. */
textColor: Record<ThemeKey, TextColorId>;
```

`DEFAULT_TWEAKS.textColor` is `{ light: "default", sepia: "default", dark:
"default", oled: "default" }`.

### Loading saved settings

`loadTweaks()` currently does a **shallow** spread
(`{ ...DEFAULT_TWEAKS, ...parsed }`). That is fine for flat fields but not for
`textColor`:

- Missing `textColor` (every existing install): use the default record.
- Not an object, or `null`: use the default record.
- Partial record, or an id that is not in that theme's list: keep the valid
  entries, fill or replace the rest with `"default"`.
- Unknown extra keys in the record: drop them.

This must never throw and never discard the other saved fields.

### Import Settings and Reset (`applyTweaks`)

`applyTweaks` accepts a key when `typeof value === typeof DEFAULT_TWEAKS[key]`.
For an object field that check passes for `null`, arrays and any foreign
object, so an imported settings file could plant a bad `textColor`. Run
`textColor` through the **same sanitizer** as `loadTweaks()` there (one function,
used in both places). Reset passes `DEFAULT_TWEAKS`, which is already valid.

## Where the color applies

- **`BookBody`**: the `color` in its `common` style (today `theme.ink`). This
  covers paragraphs and the book's own headings, and it covers every reflow
  surface: desktop and mobile readers, EPUB and web novels (SourceStreamReader
  renders through Desktop/MobileReader → BookBody).
- **`ChapterOpener`**: the chapter title (today `color: theme.ink`). It sits on
  the page as part of the text, so it follows the text color. The opener's
  ornament marks (`inkAlpha(theme, …)`) and its muted label stay on the theme.
- **DOCX pages**: `FixedPageViewer` sets `--reading-ink` (today `theme.ink`),
  which only `DocxPageSource` reads. Set it to the resolved color. PDF pages
  ignore the variable. The page-tint filter (`tintFilter`: dim / invert) keeps
  applying on top exactly as it does to the theme ink today.
- Nothing else. `ChapterEnd`, focus-mode chrome, the progress bar, top bar,
  selection toolbar, note editor, highlight cards and the fixed-layout
  reader's own chrome (`FixedPageReader`'s `theme.ink` uses) keep `theme.ink`.

How the resolved color reaches `BookBody` and `ChapterOpener` (an explicit prop, or a
derived theme object for the page subtree) is the builder's call. Prefer the
narrowest option: an object that swaps `ink` for the whole page subtree would
also recolor chrome drawn inside it, which is a non-goal.

`index.html`'s `BOOT_THEMES` first-paint copy is untouched (no book text is on
the first frame).

## The Text color row (`TextColorField`)

Lives in `SettingsSection.tsx` next to `ThemeField` and is built from the same
primitives, so the quick panel and the full page cannot drift.

- `Field` label: "Text color". Trailing hint: "for {theme name}" using the
  **resolved** theme's translated name, so under System it reads e.g. "for
  Dark".
- A 5-column grid of chips, one per palette entry, in table order.
  - Background: the resolved theme's reading page, `readingSurfaces(theme).page`
    (what the text actually sits on). Border: `1.5px solid theme.ink`
    when selected, `1px solid theme.rule` otherwise (same as the theme tiles).
  - Glyph: the theme-preview glyph from `useThemePreviewGlyph()` ("أب" under
    Arabic UI, "Aa" otherwise) drawn in the chip's color, in the **current
    reading font** so the swatch shows what the page will look like.
  - Name under the glyph in `theme.muted`, ~9px, one line, no truncation in
    either language at the quick panel's width.
  - `aria-pressed` on the selected chip; accessible name is the color name.
  - Touch target: at least 44px tall on mobile.
- Tapping a chip sets `textColor[resolvedTheme]` and nothing else.

Placement:

- `SettingsPanel` (reader quick panel): immediately after `ThemeField` in the
  reflow variant. In the `fixed` variant, shown **only when the open book is a
  DOCX** (the panel already receives `docxMode` for DOCX books only). Hidden
  for PDF. A DOCX laid out as flowing text uses the reflow variant and shows
  the row once.
- `SettingsPage`, Appearance category: a new searchable entry, id
  `"textColor"`, immediately after the `"theme"` entry. Shown regardless of
  what book is open (it is a global preference).

## i18n

New keys in both `en.ts` and `ar.ts` (ar is the default UI):

- `settings.textColor`: "Text color" / "لون النص"
- `settings.textColor.for`: "for {theme}" / "لسمة {theme}"
- `settings.textColor.<id>` for each distinct id in the table: `default`,
  `soft`, `graphite`, `navy`, `brown`, `deep`, `coffee`, `olive`, `plum`,
  `paper`, `silver`, `amber`, `sage`, `coral`, `moon`.

## Markazi Text default

- `DEFAULT_TWEAKS.fontFamily`: `"readex"` → `"markazi"`.
- `useTweaks` writes the full settings object on first launch, so every
  install that has ever opened the app already has `fontFamily` saved and keeps
  it. Only fresh installs, and **Reset to defaults**, get Markazi.
- `loadTweaks()`'s fallback for an unknown saved `fontFamily` currently uses
  `DEFAULT_TWEAKS.fontFamily`, so it will now fall back to Markazi. That is
  intended.
- No size work: `useFontScale` already corrects Markazi to read at the same
  apparent size as Readex Pro.
- Check any test that pins the default font.

## Tests

- Palette readability: the rule above, for every theme × color × (page, page +
  each highlight tint). Fails the build on regression.
- Every `TEXT_COLORS` theme has exactly five entries, the first is `default`,
  ids are unique within a theme, and every id has an `en` and an `ar` name.
- `resolveTextColor`: `default` → `THEMES[key].ink`; known id → its hex;
  unknown id → `THEMES[key].ink`.
- `loadTweaks()` and `applyTweaks()`: no `textColor`; `textColor: null`; an array;
  partial record; unknown id; extra key. Each yields a full valid record and
  leaves other fields intact.
- `DEFAULT_TWEAKS.fontFamily === "markazi"`.

## Left to the builder

- Exact TypeScript shapes for ids and the palette table.
- How the resolved color is plumbed to `BookBody` / `ChapterOpener` (within the
  "narrowest option" guidance above).
- Whether `TextColorField` takes the resolved `ThemeKey` or derives it.
- Chip spacing and font sizes, within the look of `ThemeField`.
- Whether to add a component test for `TextColorField` (nice to have).
