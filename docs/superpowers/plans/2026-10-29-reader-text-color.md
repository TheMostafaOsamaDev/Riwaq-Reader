# Reader Text Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let readers pick the book-text color from a fixed, readable five-color list per theme, remembered per theme, applied to EPUB/web-novel text and DOCX pages; and make Markazi Text the default book font for fresh installs.

**Architecture:** The palettes, the per-theme picks type, a resolver and a sanitizer live in `src/styles/tokens.ts` beside the theme and highlight tokens. `Tweaks.textColor` stores one palette id per theme, sanitized on load and on import. Readers resolve the color once (`resolveTextColor(themeKey, t.textColor)`) and hand it to the two places that draw book text — `BookBody` (which passes it to `ChapterOpener`'s title) and `FixedPageViewer`'s `--reading-ink` for DOCX cards. A new `TextColorField` sits under `ThemeField` in the reader quick panel (reflow, and fixed only for DOCX) and in Settings ▸ Appearance.

**Tech Stack:** React 19 + TypeScript, Vitest (happy-dom for DOM tests, `renderToStaticMarkup` for markup tests), Biome, Tauri.

**Spec:** `docs/superpowers/specs/2026-10-29-reader-text-color-design.md`

## Global Constraints

- Palette values, names (English and Arabic), and on-screen order are exactly the spec's table; `default` has no hex and resolves to `THEMES[key].ink`.
- Persist palette **ids**, never hex.
- Every palette color reaches ≥ 4.5:1 against `readingSurfaces(THEMES[k]).page` and against that page with each `hlBg(c, k)` tint composited over it. Never relax 4.5.
- Chrome keeps `theme.ink` / `chromeInk`: only `BookBody` text, the `ChapterOpener` title, and DOCX card text (`--reading-ink`) change. `ChapterOpener` ornaments and muted label stay on the theme.
- PDF is untouched; the quick-panel row is hidden while a PDF is open.
- No new dependencies. Both `en.ts` and `ar.ts` get every new key (`ar` is typed `Messages`, so a miss is a compile error).
- Tests run with `NODE_OPTIONS=--no-experimental-webstorage` on local Node 26 (CI is Node 20). Full gate: `NODE_OPTIONS=--no-experimental-webstorage pnpm check`.
- Commits: conventional (`feat(reader): …`, `test: …`), each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **System theme:** with `t.theme === "system"` the row edits and names the theme System resolved to (e.g. "for Dark"), and a tap changes only that theme's pick. → Task 3 test `picks for the theme on screen and leaves the others`.
- **Reset to defaults:** after picks on several themes, Reset puts every theme back to `default`. → Task 2 test `reset puts every theme back on its own ink`.
- **Settings from the old free color-picker build** (stored `inkColor` / `paperColor`, no `textColor`, removed in cf2c59e) load with default text colors and keep the rest. → Task 2 test `loads settings saved by the old Text/Page color picker`.
- **Export → Import round-trip** keeps a valid `textColor` as-is. → Task 2 test `an exported textColor imports unchanged`.
- **DOCX as flowing text** (`variant` reflow with `docxMode="flow"`) shows the row exactly once. → Task 3 test `appears once for a DOCX laid out as flowing text`.

---

### Task 1: Text-color palettes, resolver and sanitizer

**Files:**
- Modify: `src/styles/tokens.ts` (new block after `HIGHLIGHT_COLOR_ORDER`, ~line 295)
- Test: `src/styles/textColors.test.ts` (create)

**Interfaces:**
- Produces:
  - `type TextColorId = "default" | "soft" | "graphite" | "navy" | "brown" | "deep" | "coffee" | "olive" | "plum" | "paper" | "silver" | "amber" | "sage" | "coral" | "moon"`
  - `const TEXT_COLOR_IDS: readonly TextColorId[]` (every id once, in the order above)
  - `const TEXT_COLORS: Record<ThemeKey, ReadonlyArray<{ id: TextColorId; hex: string | null }>>`
  - `type TextColorPicks = Record<ThemeKey, TextColorId>`
  - `const DEFAULT_TEXT_COLORS: TextColorPicks` (all four `"default"`)
  - `function resolveTextColor(themeKey: ThemeKey, picks: TextColorPicks): string`
  - `function sanitizeTextColors(v: unknown): TextColorPicks`

- [ ] **Step 1: Write the failing tests** in `src/styles/textColors.test.ts`

Test-local helpers (not exported from production code): `rgbOf(color)` parsing `#rrggbb` and `rgba(r,g,b,a)`, `luminance(rgb)` (WCAG relative luminance), `contrast(a, b)`, and `over(bg, rgba)` alpha-compositing a tint onto an opaque color.

```ts
const KEYS = ["light", "sepia", "dark", "oled"] as const;

it("offers five colors per theme, Default first, no repeats", () => {
  for (const k of KEYS) {
    const ids = TEXT_COLORS[k].map((c) => c.id);
    expect(ids).toHaveLength(5);
    expect(ids[0]).toBe("default");
    expect(TEXT_COLORS[k][0].hex).toBeNull();
    expect(new Set(ids).size).toBe(5);
  }
  expect(TEXT_COLORS.light.map((c) => c.id)).toEqual(["default", "soft", "graphite", "navy", "brown"]);
  expect(TEXT_COLORS.sepia.map((c) => c.id)).toEqual(["default", "deep", "coffee", "olive", "plum"]);
  expect(TEXT_COLORS.dark.map((c) => c.id)).toEqual(["default", "paper", "silver", "amber", "sage"]);
  expect(TEXT_COLORS.oled.map((c) => c.id)).toEqual(["default", "sage", "amber", "coral", "moon"]);
});

it("Default is the theme's own ink", () => {
  for (const k of KEYS) expect(resolveTextColor(k, DEFAULT_TEXT_COLORS)).toBe(THEMES[k].ink);
});

it("resolves a pick to its color and keeps each theme's own pick", () => {
  const picks = { ...DEFAULT_TEXT_COLORS, light: "navy", dark: "amber", oled: "sage" } as const;
  expect(resolveTextColor("light", picks)).toBe("#1f3a5f");
  expect(resolveTextColor("dark", picks)).toBe("#eabb70");
  expect(resolveTextColor("oled", picks)).toBe("#9fc0a0");
  expect(resolveTextColor("sepia", picks)).toBe(THEMES.sepia.ink);
});

it("falls back to the theme ink for an id the theme does not offer", () => {
  expect(resolveTextColor("light", { ...DEFAULT_TEXT_COLORS, light: "moon" })).toBe(THEMES.light.ink);
});

it("every color stays readable on the page and under every highlight", () => {
  for (const k of KEYS) {
    const page = readingSurfaces(THEMES[k]).page;
    for (const { id } of TEXT_COLORS[k]) {
      const ink = resolveTextColor(k, { ...DEFAULT_TEXT_COLORS, [k]: id });
      expect(contrast(ink, page), `${k}/${id} on page`).toBeGreaterThanOrEqual(4.5);
      for (const c of HIGHLIGHT_COLOR_ORDER) {
        expect(contrast(ink, over(page, hlBg(c, k))), `${k}/${id} under ${c}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

describe("sanitizeTextColors", () => {
  it("gives the defaults for anything that is not a plain object", () => {
    for (const v of [undefined, null, [], "navy", 3]) expect(sanitizeTextColors(v)).toEqual(DEFAULT_TEXT_COLORS);
  });
  it("keeps valid picks, repairs the rest and drops unknown keys", () => {
    expect(sanitizeTextColors({ light: "navy", sepia: 3, dark: "bogus", oled: "coral", extra: "x" }))
      .toEqual({ light: "navy", sepia: "default", dark: "default", oled: "coral" });
  });
  it("rejects an id that belongs to a different theme", () => {
    expect(sanitizeTextColors({ light: "moon" }).light).toBe("default");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/styles/textColors.test.ts`
Expected: FAIL — `TEXT_COLORS` / `resolveTextColor` / `sanitizeTextColors` are not exported.

- [ ] **Step 3: Implement the block in `src/styles/tokens.ts`**

Hex values in table order (`default` is `hex: null`): light `#4a4238 #2e3338 #1f3a5f #5b3a1e`; sepia `#22190e #5b3a1e #3d4a2a #4a2a3a`; dark `#ece6da #c9c1b7 #eabb70 #b8c8a8`; oled `#9fc0a0 #d5a357 #ff8a75 #c8ccd2`. Give the block a doc comment carrying the spec's readability rule (≥ 4.5:1 on the page and under every highlight; retune lightness, never the threshold) and the reason `default` reads `THEMES[key].ink` instead of a copied hex. `resolveTextColor` looks the id up in that theme's list and falls back to `THEMES[themeKey].ink` when the id is `default`, missing, or not offered. `sanitizeTextColors` returns a fresh `TextColorPicks` built key-by-key over the four `ThemeKey`s, keeping a value only if it is an id in that theme's list.

- [ ] **Step 4: Run to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/styles/textColors.test.ts`
Expected: PASS (6 tests + 3 sanitizer tests).

- [ ] **Step 5: Commit**

```bash
git add src/styles/tokens.ts src/styles/textColors.test.ts
git commit -m "feat(reader): per-theme text-color palettes, readable under highlights"
```

---

### Task 2: `Tweaks.textColor` — default, load, import, reset

**Files:**
- Modify: `src/types/reader.ts` (add the field to `Tweaks`, near `theme`)
- Modify: `src/hooks/useTweaks.ts` (`DEFAULT_TWEAKS`, `acceptsTweak`, `loadTweaks`, `applyTweaks`)
- Test: `src/hooks/useTweaks.migration.test.ts` (add a `describe("textColor")`)

**Interfaces:**
- Consumes: `TextColorPicks`, `DEFAULT_TEXT_COLORS`, `sanitizeTextColors` (Task 1).
- Produces:
  - `Tweaks.textColor: TextColorPicks` (doc comment from the spec's data-model section).
  - `export function mergeTweaks(prev: Tweaks, partial: Record<string, unknown>): Tweaks` in `useTweaks.ts` — the body of today's `applyTweaks` loop, pulled out so it is testable; `applyTweaks` becomes `setT((prev) => mergeTweaks(prev, partial))`.

- [ ] **Step 1: Write the failing tests** (in the existing file's style: `beforeEach(() => localStorage.clear())`, store under `"riwaq:tweaks:v1"`)

```ts
describe("textColor", () => {
  beforeEach(() => localStorage.clear());
  const store = (o: object) => localStorage.setItem("riwaq:tweaks:v1", JSON.stringify(o));

  it("starts every theme on its own ink", () => {
    expect(DEFAULT_TWEAKS.textColor).toEqual(DEFAULT_TEXT_COLORS);
    expect(loadTweaks().textColor).toEqual(DEFAULT_TEXT_COLORS);
  });
  it("an install from before text color loads the defaults and keeps the rest", () => {
    store({ fontSize: 19 });
    const t = loadTweaks();
    expect(t.textColor).toEqual(DEFAULT_TEXT_COLORS);
    expect(t.fontSize).toBe(19);
  });
  it("loads settings saved by the old Text/Page color picker", () => {
    store({ inkColor: "#ff0000", paperColor: "#000000", fontSize: 19 });
    const t = loadTweaks();
    expect(t.textColor).toEqual(DEFAULT_TEXT_COLORS);
    expect(t.fontSize).toBe(19);
  });
  it("keeps valid saved picks and repairs the rest", () => {
    store({ textColor: { light: "navy", dark: "bogus", extra: "x" }, fontSize: 19 });
    expect(loadTweaks().textColor).toEqual({ ...DEFAULT_TEXT_COLORS, light: "navy" });
  });
  it("a saved null or array becomes the defaults", () => {
    store({ textColor: null }); expect(loadTweaks().textColor).toEqual(DEFAULT_TEXT_COLORS);
    store({ textColor: [] });   expect(loadTweaks().textColor).toEqual(DEFAULT_TEXT_COLORS);
  });
  it("import takes a plain object only", () => {
    expect(acceptsTweak("textColor", { light: "navy" })).toBe(true);
    expect(acceptsTweak("textColor", null)).toBe(false);
    expect(acceptsTweak("textColor", [])).toBe(false);
  });
  it("an exported textColor imports unchanged", () => {
    const picks = { light: "navy", sepia: "olive", dark: "amber", oled: "coral" };
    expect(mergeTweaks(DEFAULT_TWEAKS, { textColor: picks }).textColor).toEqual(picks);
  });
  it("an imported textColor is repaired, not trusted", () => {
    const next = mergeTweaks(DEFAULT_TWEAKS, { textColor: { light: "moon", dark: "amber" }, fontSize: 20 });
    expect(next.textColor).toEqual({ ...DEFAULT_TEXT_COLORS, dark: "amber" });
    expect(next.fontSize).toBe(20);
  });
  it("reset puts every theme back on its own ink", () => {
    const picked = { ...DEFAULT_TWEAKS, textColor: { light: "navy", sepia: "olive", dark: "amber", oled: "coral" } as const };
    expect(mergeTweaks(picked, DEFAULT_TWEAKS as unknown as Record<string, unknown>).textColor).toEqual(DEFAULT_TEXT_COLORS);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/hooks/useTweaks.migration.test.ts`
Expected: FAIL — `textColor` undefined on `DEFAULT_TWEAKS`; `mergeTweaks` not exported.

- [ ] **Step 3: Implement**

- `DEFAULT_TWEAKS.textColor = DEFAULT_TEXT_COLORS`.
- `acceptsTweak`: add `!(k === "textColor" && (v === null || Array.isArray(v)))` beside the other per-key guards.
- `loadTweaks`: after the `merged` spread, `merged.textColor = sanitizeTextColors(merged.textColor);`.
- `mergeTweaks`: today's `applyTweaks` loop; for an accepted `textColor` it stores `sanitizeTextColors(v)` instead of `v`.

- [ ] **Step 4: Run to verify they pass, plus the whole suite (the `Tweaks` shape changed)**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/hooks/useTweaks.migration.test.ts && NODE_OPTIONS=--no-experimental-webstorage pnpm test && pnpm exec tsc --noEmit`
Expected: all PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/reader.ts src/hooks/useTweaks.ts src/hooks/useTweaks.migration.test.ts
git commit -m "feat(reader): remember a text color per theme in settings"
```

---

### Task 3: The Text color row — strings, `TextColorField`, panel and Settings page

**Files:**
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts` (keys right after `"settings.theme.oled"`, same order in both)
- Modify: `src/components/SettingsSection.tsx` (`TextColorField` after `ThemeField`)
- Modify: `src/panels/SettingsPanel.tsx` (render it after `ThemeField`)
- Modify: `src/components/SettingsPage.tsx` (Appearance entry after `id: "theme"`, ~line 309)
- Test: `src/panels/textColorRow.test.tsx` (create; copy the mount/teardown harness from `src/panels/docxLayoutToggle.test.tsx`)

**Interfaces:**
- Consumes: `TEXT_COLORS`, `TEXT_COLOR_IDS`, `TextColorPicks`, `DEFAULT_TEXT_COLORS` (Task 1); `Tweaks.textColor` (Task 2).
- Produces: `export function TextColorField(props: { theme: Theme; themeKey: ThemeKey; picks: TextColorPicks; fontFamily: FontFamilyKey; onChange: (next: TextColorPicks) => void }): JSX.Element`

Strings (en / ar):

| key | en | ar |
|---|---|---|
| `settings.textColor` | Text color | لون النص |
| `settings.textColor.for` | for {theme} | لسمة {theme} |
| `settings.textColor.default` | Default | افتراضي |
| `settings.textColor.soft` | Soft | هادئ |
| `settings.textColor.graphite` | Graphite | رصاصي |
| `settings.textColor.navy` | Navy | كحلي |
| `settings.textColor.brown` | Brown | بنّي |
| `settings.textColor.deep` | Deep | داكن |
| `settings.textColor.coffee` | Coffee | قهوة |
| `settings.textColor.olive` | Olive | زيتوني |
| `settings.textColor.plum` | Plum | برقوقي |
| `settings.textColor.paper` | Paper | ورقي |
| `settings.textColor.silver` | Silver | فضي |
| `settings.textColor.amber` | Amber | كهرماني |
| `settings.textColor.sage` | Sage | مريمي |
| `settings.textColor.coral` | Coral | مرجاني |
| `settings.textColor.moon` | Moon | قمري |

- [ ] **Step 1: Write the failing tests** in `src/panels/textColorRow.test.tsx`

Helpers: `row()` = `host.querySelector('[role="group"][aria-label="Text color"]')`; `chips()` = its `button`s; `names()` = their `aria-label`s. Mount `SettingsPanel` with `t = { ...DEFAULT_TWEAKS, uiLang: "en" }` like the toggle test.

```ts
it("shows five named colors in the reflow panel", () => {
  mount(<SettingsPanel theme={THEMES.light} themeKey="light" t={tweaks} setTweak={() => {}} />);
  expect(names()).toEqual(["Default", "Soft", "Graphite", "Navy", "Brown"]);
});
it("shows on a DOCX in the fixed panel, not on a PDF", () => {
  // fixed variant without docxMode → no row; with docxMode="pages" → row
});
it("appears once for a DOCX laid out as flowing text", () => {
  // reflow variant + docxMode="flow" + onDocxModeChange → exactly one row
});
it("picks for the theme on screen and leaves the others", () => {
  const setTweak = vi.fn();
  mount(<SettingsPanel theme={THEMES.dark} themeKey="dark" t={{ ...tweaks, theme: "system" }} setTweak={setTweak} />);
  act(() => chips().find((b) => b.getAttribute("aria-label") === "Amber")!.click());
  expect(setTweak).toHaveBeenCalledWith("textColor", { ...DEFAULT_TEXT_COLORS, dark: "amber" });
});
it("names the theme it is editing", () => {
  // themeKey="dark", t.theme="system" → row text contains "for Dark"
});
it("marks the current pick", () => {
  // t.textColor.light = "navy" → only the Navy chip has aria-pressed="true"
});
it("has an English and an Arabic name for every color", () => {
  for (const id of TEXT_COLOR_IDS) {
    expect(en[`settings.textColor.${id}` as MsgKey]).toBeTruthy();
    expect(ar[`settings.textColor.${id}` as MsgKey]).toBeTruthy();
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/panels/textColorRow.test.tsx`
Expected: FAIL — no `[role="group"][aria-label="Text color"]` in the panel; missing keys.

- [ ] **Step 3: Add the strings** from the table to `en.ts` and `ar.ts`.

- [ ] **Step 4: Implement `TextColorField`** in `SettingsSection.tsx`

Built from `Field` like `ThemeField`. Label `tr("settings.textColor")`; hint `tr("settings.textColor.for", { theme: tr(\`settings.theme.${themeKey}\`) })` on the label line, styled like other hints. Chip grid `role="group"` with `aria-label={tr("settings.textColor")}`, five columns, `gap: 6`. Each chip: `aria-label` = translated name, `aria-pressed` = selected, `minHeight: TOUCH_TARGET_MIN`, background `readingSurfaces(theme).page`, border as `ThemeField` (`1.5px solid theme.ink` selected, else `1px solid theme.rule`), glyph `useThemePreviewGlyph().previewGlyph` in `readingStack(fontFamily)` colored with the chip's resolved color, name ~9px in `theme.muted`, single line. Tap: `onChange({ ...picks, [themeKey]: id })`.

- [ ] **Step 5: Wire it in**

- `SettingsPanel`: directly after `ThemeField`, render `TextColorField` with `themeKey={props.themeKey}`, `picks={t.textColor}`, `fontFamily={t.fontFamily}`, `onChange={(v) => setTweak("textColor", v)}` when `!fixed || docxMode != null`. Update the header comment's variant list to say the fixed variant shows it for DOCX.
- `SettingsPage`: new entry `{ id: "textColor", label: tr("settings.textColor"), node: <TextColorField …themeKey={themeKey}… /> }` immediately after the `"theme"` entry.

- [ ] **Step 6: Run to verify they pass, plus types**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/panels/textColorRow.test.tsx src/panels/docxLayoutToggle.test.tsx && pnpm exec tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/i18n/en.ts src/i18n/ar.ts src/components/SettingsSection.tsx src/panels/SettingsPanel.tsx src/components/SettingsPage.tsx src/panels/textColorRow.test.tsx
git commit -m "feat(reader): Text color row under Theme in the reader and Settings"
```

---

### Task 4: Book text and chapter titles use the chosen color

**Files:**
- Modify: `src/components/ChapterOpener.tsx` (title color, ~line 216)
- Modify: `src/components/BookBody.tsx` (`Props`, `common.color` ~line 176, the `<ChapterOpener>` call ~line 241)
- Modify: `src/components/DesktopReader.tsx` (both `<BookBody>` sites, ~1232 and ~1303; the comment above `contentTheme` ~188)
- Modify: `src/components/MobileReader.tsx` (`<BookBody>` ~1358)
- Test: `src/components/chapterOpener.test.tsx` (add one case), `src/components/readerTextColor.test.tsx` (create)

**Interfaces:**
- Consumes: `resolveTextColor` (Task 1); `Tweaks.textColor` (Task 2).
- Produces: `ChapterOpener` prop `titleInk?: string` (defaults to `theme.ink`); `BookBody` prop `textInk?: string` (defaults to `theme.ink`, also passed on as `titleInk`).

- [ ] **Step 1: Write the failing tests**

In `chapterOpener.test.tsx` (uses its `render` helper, theme sepia):

```ts
it("sets the title in the chosen text color and keeps the ornaments on the theme", () => {
  const html = render({ titleInk: "#3d4a2a" });
  expect(html).toContain("color:#3d4a2a");
  expect(html).toContain("rgba(58,47,31,"); // inkAlpha(THEMES.sepia, …) on the marks
});
```

In `readerTextColor.test.tsx`, static-render `MobileReader` with the props/`BOOK`/`STATE` from `mobileReaderChrome.test.tsx`, and `DesktopReader` with the props from `desktopFocusRail.test.tsx` (static `renderToStaticMarkup` is enough; mock `@tauri-apps/api/core` the same way):

```ts
const olive = { ...DEFAULT_TWEAKS, textColor: { ...DEFAULT_TEXT_COLORS, sepia: "olive" } } as const;
it("the phone reader draws the book in the chosen color", () => {
  expect(mobileMarkup(olive)).toContain("color:#3d4a2a");
  expect(mobileMarkup(DEFAULT_TWEAKS)).not.toContain("#3d4a2a");
});
it("the desktop reader draws the book in the chosen color", () => {
  expect(desktopMarkup(olive)).toContain("color:#3d4a2a");
  expect(desktopMarkup(DEFAULT_TWEAKS)).not.toContain("#3d4a2a");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/components/chapterOpener.test.tsx src/components/readerTextColor.test.tsx`
Expected: FAIL — no `color:#3d4a2a` in either markup.

- [ ] **Step 3: Implement**

- `ChapterOpener`: title `color: titleInk ?? theme.ink`; marks and label unchanged.
- `BookBody`: `common.color = textInk ?? theme.ink`; `<ChapterOpener titleInk={textInk} …>`.
- `DesktopReader` and `MobileReader`: `const textInk = resolveTextColor(themeKey, t.textColor);` next to `contentTheme`, passed as `textInk={textInk}` to every `<BookBody>`. Rewrite DesktopReader's stale comment above `contentTheme` (it still describes the removed ink/paper overrides) to say the page takes the theme and the book text takes `textInk`.

- [ ] **Step 4: Run to verify they pass**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/components/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChapterOpener.tsx src/components/BookBody.tsx src/components/DesktopReader.tsx src/components/MobileReader.tsx src/components/chapterOpener.test.tsx src/components/readerTextColor.test.tsx
git commit -m "feat(reader): book text and chapter titles take the chosen text color"
```

---

### Task 5: DOCX pages use the chosen color

**Files:**
- Modify: `src/reader/fixed/FixedPageViewer.tsx` (`Props` ~line 193; `"--reading-ink"` ~line 2266)
- Modify: `src/reader/fixed/FixedPageReader.tsx` (`<FixedPageViewer>` ~line 872)
- Test: `src/reader/fixed/docxTextInk.test.tsx` (create; harness from `src/reader/fixed/savePlace.test.tsx`)

**Interfaces:**
- Consumes: `resolveTextColor` (Task 1); `Tweaks.textColor` (Task 2).
- Produces: `FixedPageViewer` prop `textInk?: string` (defaults to `theme.ink`).

- [ ] **Step 1: Write the failing test**

```ts
/** The element that hands DOCX cards their colors. */
const inkHost = () =>
  [...host.querySelectorAll<HTMLElement>("*")].find((e) => e.style.getPropertyValue("--reading-ink"));

it("DOCX cards take the chosen text color", () => {
  mountViewer({ textInk: "#1f3a5f" });
  expect(inkHost()!.style.getPropertyValue("--reading-ink")).toBe("#1f3a5f");
});
it("without a choice they keep the theme ink", () => {
  mountViewer({});
  expect(inkHost()!.style.getPropertyValue("--reading-ink")).toBe(THEMES.light.ink);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/reader/fixed/docxTextInk.test.tsx`
Expected: FAIL on the first case (`--reading-ink` is the theme ink).

- [ ] **Step 3: Implement**

`FixedPageViewer`: `"--reading-ink": textInk ?? theme.ink` (comment: only DOCX cards read it; PDF pages ignore it; the tint filter still applies on top). `FixedPageReader`: pass `textInk={resolveTextColor(themeKey, t.textColor)}`.

- [ ] **Step 4: Run to verify it passes, plus the fixed reader's tests**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/reader/fixed/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reader/fixed/FixedPageViewer.tsx src/reader/fixed/FixedPageReader.tsx src/reader/fixed/docxTextInk.test.tsx
git commit -m "feat(reader): DOCX pages take the chosen text color"
```

---

### Task 6: Markazi Text is the default book font

**Files:**
- Modify: `src/hooks/useTweaks.ts` (`DEFAULT_TWEAKS.fontFamily`)
- Test: `src/hooks/useTweaks.migration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("a fresh install reads in Markazi Text; a saved font is kept", () => {
  localStorage.clear();
  expect(DEFAULT_TWEAKS.fontFamily).toBe("markazi");
  expect(loadTweaks().fontFamily).toBe("markazi");
  localStorage.setItem("riwaq:tweaks:v1", JSON.stringify({ fontFamily: "readex" }));
  expect(loadTweaks().fontFamily).toBe("readex");
  localStorage.setItem("riwaq:tweaks:v1", JSON.stringify({ fontFamily: "no-such-font" }));
  expect(loadTweaks().fontFamily).toBe("markazi");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm vitest run src/hooks/useTweaks.migration.test.ts`
Expected: FAIL — default is `"readex"`.

- [ ] **Step 3: Set `DEFAULT_TWEAKS.fontFamily` to `"markazi"`**

- [ ] **Step 4: Run the full gate** (other tests render readers from `DEFAULT_TWEAKS`, so the font change can surface anywhere)

Run: `NODE_OPTIONS=--no-experimental-webstorage pnpm check`
Expected: format, lint, build and all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTweaks.ts src/hooks/useTweaks.migration.test.ts
git commit -m "feat(reader): Markazi Text is the default book font for new installs"
```
