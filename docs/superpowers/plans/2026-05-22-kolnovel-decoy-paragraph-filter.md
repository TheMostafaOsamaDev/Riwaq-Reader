# KolNovel Decoy-Paragraph Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop emitting KolNovel's hidden decoy paragraphs and inline ad strings when scraping chapter bodies.

**Architecture:** Stay on the existing static-HTML fetch path. Read the rotating set of hidden hex-class names from the page's inline `<style>` block at parse time, filter `<p>` elements whose class set intersects that set, and strengthen the existing ad-pattern check from whole-line match to substring strip.

**Tech Stack:** TypeScript, browser-native `DOMParser` (already used via `src/sources/host.ts`), Tauri shell for manual verification. No new dependencies.

---

## Background

Read first:
- Spec: `docs/superpowers/specs/2026-05-22-kolnovel-decoy-paragraph-filter-design.md`
- Reference (C# scraper, similar filter via `getComputedStyle`): `Infrastructure/Websites/KolNovel.cs` at https://github.com/TheMostafaOsamaDev/NovelScraper

Investigation snapshot to keep in mind while implementing:
- A KolNovel chapter HTML response carries one inline `<style>` rule whose body contains `height:0.1px`, `position:fixed`, `opacity:0`, `text-indent:-99999px`, `bottom:-999px`, applied to **9 random hex class names**.
- Those class names are regenerated per page load (sample 1: `a82c8c3f68270ab01bf455c4d6bfc4512`; sample 2: `a3bfb0c4cea10e92b7c01f91128695e59`). Don't hardcode them.
- `DOMParser` splits the malformed nested `<p>` tags into ~158 sibling `<p>` elements per chapter; ~78 carry one of the 9 class names. Filtering those out leaves ~80 real paragraphs in correct narrative order.

## File Structure

Only `src/sources/extensions/kolnovel.ts` is touched.

Within that file:
- `extractHiddenClassesFromCss(cssText: string): Set<string>` — new pure helper. Pure string-in → Set-out, easy to reason about.
- `collectHiddenClasses(doc: Document): Set<string>` — new helper. Walks `doc.querySelectorAll("style")`, feeds each block's text to `extractHiddenClassesFromCss`, unions the results.
- `extractChapterLines(doc: Document): SourceLine[]` — existing function, modified to consume the Set.
- `isIgnored(line: string): boolean` — existing, renamed to `stripIgnored(line: string): string` with substring-strip semantics.
- `toIgnoreRegex(pattern: string): RegExp` — existing, modified to drop anchors and switch to lazy wildcards + `gi` flags.
- Block comment inside `getChapterContent` (currently lines 99-104) — rewritten to reflect the actual obfuscation mechanism.

---

## Task 1: Add `extractHiddenClassesFromCss` helper

**Files:**
- Modify: `src/sources/extensions/kolnovel.ts`

**Why:** A CSS-text-only function that decides which class names are decoys. Keeping the regex logic separate from DOM access makes the rule trivial to reason about: given a CSS string, what classes does it hide?

- [ ] **Step 1: Add the helper near the other top-level helpers**

Add this function in `src/sources/extensions/kolnovel.ts`, just below the existing `toIgnoreRegex` definition (around line 49):

```ts
/** Given the textContent of a single <style> block, return the set of
 *  class names whose rule body matches the KolNovel decoy signature.
 *  The site re-rolls these names on every page load, so we discover them
 *  rather than hardcoding. The signature looks for three independent
 *  tokens — `0.1px`, `opacity` followed by `0`, and `-99999px` — so the
 *  match still works if the site reorders properties or tweaks
 *  whitespace. Only `.[hex]{20,}` selectors are collected; that's the
 *  shape KolNovel uses (random hex with an `a` prefix), and limiting to
 *  long hex avoids snagging legitimate semantic class names. */
function extractHiddenClassesFromCss(cssText: string): Set<string> {
  const out = new Set<string>();
  // Split on rule boundaries — each match is one `selectors { body }` group.
  const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRegex.exec(cssText)) !== null) {
    const selectors = m[1];
    const body = m[2].toLowerCase();
    if (
      !body.includes("0.1px") ||
      !body.includes("-99999px") ||
      !/opacity\s*:\s*0\b/.test(body)
    ) {
      continue;
    }
    const classMatches = selectors.match(/\.([a-f0-9]{20,})/g) || [];
    for (const c of classMatches) out.add(c.slice(1));
  }
  return out;
}
```

- [ ] **Step 2: Sanity-check the regex manually**

Write a one-off scratch file (any path that's gitignored or /tmp works) — keeps shell escaping out of the picture:

```bash
cat > /tmp/check-hidden-classes.mjs <<'JS'
function extractHiddenClassesFromCss(cssText) {
  const out = new Set();
  const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
  let m;
  while ((m = ruleRegex.exec(cssText)) !== null) {
    const selectors = m[1];
    const body = m[2].toLowerCase();
    if (!body.includes('0.1px') || !body.includes('-99999px') || !/opacity\s*:\s*0\b/.test(body)) continue;
    const classMatches = selectors.match(/\.([a-f0-9]{20,})/g) || [];
    for (const c of classMatches) out.add(c.slice(1));
  }
  return out;
}
const css = '.a82c8c3f68270ab01bf455c4d6bfc4512,.ac188ab1ceae89c342b6428f7a1e9f8d3 { height: 0.1px; overflow: hidden; position: fixed; opacity: 0; text-indent: -99999px; bottom: -999px; }';
console.log(extractHiddenClassesFromCss(css));
JS
node /tmp/check-hidden-classes.mjs
```

Expected output:
```
Set(2) { 'a82c8c3f68270ab01bf455c4d6bfc4512', 'ac188ab1ceae89c342b6428f7a1e9f8d3' }
```

If the Set is empty or has unexpected entries, fix the regex in `extractHiddenClassesFromCss` (and re-paste it into the scratch file) before moving on. Do **not** keep the code change if this sanity check fails.

Delete `/tmp/check-hidden-classes.mjs` when done.

- [ ] **Step 3: Commit**

```bash
git add src/sources/extensions/kolnovel.ts
git commit -m "feat(kolnovel): add extractHiddenClassesFromCss helper"
```

---

## Task 2: Add `collectHiddenClasses` helper

**Files:**
- Modify: `src/sources/extensions/kolnovel.ts`

**Why:** Bridges the pure CSS-text function to the parsed Document. Tiny, but worth its own function so `extractChapterLines` reads cleanly.

- [ ] **Step 1: Add the helper just below `extractHiddenClassesFromCss`**

```ts
/** Discover every decoy class name across all inline <style> blocks in
 *  the parsed chapter document. Returns an empty Set when no rule
 *  matches the hide signature — callers must treat that as "no
 *  class-based decoys to filter" rather than an error. */
function collectHiddenClasses(doc: Document): Set<string> {
  const out = new Set<string>();
  for (const styleEl of Array.from(doc.querySelectorAll("style"))) {
    const css = styleEl.textContent || "";
    if (!css) continue;
    for (const c of extractHiddenClassesFromCss(css)) out.add(c);
  }
  return out;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/sources/extensions/kolnovel.ts
git commit -m "feat(kolnovel): add collectHiddenClasses(doc) helper"
```

---

## Task 3: Convert ignore-pattern check from match → substring strip

**Files:**
- Modify: `src/sources/extensions/kolnovel.ts:40-49, 224-226`

**Why:** Today's `isIgnored` only rejects paragraphs whose *entire* text equals the ad pattern. If the ad string ever embeds inline inside a real paragraph (or survives class filtering for any reason), the current check leaks it. The new `stripIgnored` removes every occurrence of the pattern, then the caller drops only the paragraphs that end up empty.

- [ ] **Step 1: Rewrite `toIgnoreRegex` to produce a substring-strip regex**

Replace the existing function (originally at lines 45-49) with:

```ts
/** Compile an ignore pattern into a regex suitable for substring stripping.
 *  - Leading/trailing `*` are trimmed first — they were only meaningful
 *    for the old whole-line `^…$` match; for substring strip they make
 *    the lazy wildcard scan back into legitimate text.
 *  - Interior `*` wildcards become **lazy** `.*?` so a stray match
 *    doesn't bridge two well-separated ad occurrences across real text.
 *  - The compiled regex is padded with optional `\s*\*?\s*` on both
 *    ends so a stray `*` marker that the obfuscator left adjacent to
 *    the phrase boundary in the source line gets absorbed too. This is
 *    how we handle inputs like `real text. *<ad pattern>* more text`
 *    without leaving a dangling `*` behind.
 *  - `gi` flags so `String.replace` strips every occurrence. */
function toIgnoreRegex(pattern: string): RegExp {
  const trimmed = pattern.replace(/^\*+|\*+$/g, "");
  const escaped = trimmed.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, ".*?");
  return new RegExp(`\\s*\\*?\\s*${withWildcards}\\s*\\*?\\s*`, "gi");
}
```

- [ ] **Step 2: Replace `isIgnored` with `stripIgnored`**

Replace the existing function (originally at lines 224-226) with:

```ts
/** Strip every occurrence of every ignore pattern from `line`, then
 *  collapse whitespace. Each match is replaced with a single space so
 *  surrounding text doesn't get glued together; the final whitespace
 *  collapse normalises the result. Callers should drop the paragraph
 *  when the returned string is empty. */
function stripIgnored(line: string): string {
  let out = line;
  for (const r of IGNORED_REGEXES) out = out.replace(r, " ");
  return out.replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 3: Sanity-check the substring strip across all cases**

```bash
cat > /tmp/check-strip.mjs <<'JS'
function toIgnoreRegex(pattern) {
  const trimmed = pattern.replace(/^\*+|\*+$/g, "");
  const escaped = trimmed.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped.replace(/\*/g, ".*?");
  return new RegExp(`\\s*\\*?\\s*${withWildcards}\\s*\\*?\\s*`, "gi");
}
function stripIgnored(line, regexes) {
  let out = line;
  for (const r of regexes) out = out.replace(r, " ");
  return out.replace(/\s+/g, " ").trim();
}
const pat = "*إقرأ* رواياتنا* فقط* على* مو*قع م*لوك الرو*ايات ko*lno*vel ko*lno*vel. com";
const regexes = [toIgnoreRegex(pat)];
const cases = [
  "كان الأمر نفسه. *إقرأ* رواياتنا* فقط* على* مو*قع م*لوك الرو*ايات kolnovel kolnovel. com بقية الجملة",
  "*إقرأ* رواياتنا* فقط* على* مو*قع م*لوك الرو*ايات kolnovel kolnovel. com",
  "real one. *إقرأ* رواياتنا* فقط* على* مو*قع م*لوك الرو*ايات ko*lno*vel ko*lno*vel. com",
  "no ad here, just text",
];
for (const c of cases) {
  console.log("in :", JSON.stringify(c));
  console.log("out:", JSON.stringify(stripIgnored(c, regexes)));
  console.log();
}
JS
node /tmp/check-strip.mjs
```

Expected output:
```
in : "كان الأمر نفسه. *إقرأ* رواياتنا* فقط* على* مو*قع م*لوك الرو*ايات kolnovel kolnovel. com بقية الجملة"
out: "كان الأمر نفسه. بقية الجملة"

in : "*إقرأ* رواياتنا* فقط* على* مو*قع م*لوك الرو*ايات kolnovel kolnovel. com"
out: ""

in : "real one. *إقرأ* رواياتنا* فقط* على* مو*قع م*لوك الرو*ايات ko*lno*vel ko*lno*vel. com"
out: "real one."

in : "no ad here, just text"
out: "no ad here, just text"
```

If any case differs, the regex change in Step 1 is wrong — fix it before continuing.

Delete `/tmp/check-strip.mjs` when done.

- [ ] **Step 4: Commit**

```bash
git add src/sources/extensions/kolnovel.ts
git commit -m "refactor(kolnovel): strip ignore pattern as substring instead of full-line match"
```

---

## Task 4: Wire `collectHiddenClasses` + `stripIgnored` into `extractChapterLines`

**Files:**
- Modify: `src/sources/extensions/kolnovel.ts:114-162`

**Why:** This is the actual fix. The helpers from Tasks 1-3 are inert until consumed here.

- [ ] **Step 1: Replace the body of `extractChapterLines`**

Replace the existing function (originally at lines 114-162) with:

```ts
function extractChapterLines(doc: Document): SourceLine[] {
  // Discover the per-page-load set of decoy class names from the
  // chapter's inline <style> block (KolNovel rotates these on each
  // request). Empty Set is a valid result — older/un-obfuscated
  // chapters simply produce no class-based filter.
  const hiddenClasses = collectHiddenClasses(doc);

  // Prefer the canonical chapter body (`#kol_content`); fall back to the
  // first `.entry-content` for theme variations. Walking inside this
  // single container scopes us away from sidebar/related-posts widgets
  // that share the `.entry-content` class but aren't part of the
  // chapter the user wants.
  const root =
    doc.querySelector("#kol_content") ||
    doc.querySelector(".entry-content") ||
    doc.body;

  // Walk all `<p>` and `<img>` descendants in document order. A chapter
  // page on KolNovel mixes inline illustrations (book maps, character
  // art) with text paragraphs at sibling depth, so we have to handle
  // both — image-only chapters and prose-only chapters alike.
  const items = root.querySelectorAll("p, img");

  const lines: SourceLine[] = [];
  const seenText = new Set<string>();
  const seenImage = new Set<string>();
  for (const el of Array.from(items)) {
    if (el.tagName === "IMG") {
      const img = el as HTMLImageElement;
      if (isDecorativeImage(img)) continue;
      const src = absoluteImageSrc(img);
      if (!src) continue;
      if (seenImage.has(src)) continue;
      seenImage.add(src);
      lines.push({ type: "image", content: src });
      continue;
    }
    const p = el;
    if (hasHiddenClass(p, hiddenClasses)) continue;
    if (isHiddenInline(p)) continue;
    const rawText = paragraphText(p);
    if (rawText.length === 0) continue;
    const text = stripIgnored(rawText);
    if (text.length === 0) continue;
    if (seenText.has(text)) continue;
    seenText.add(text);
    lines.push({ type: "text", content: text });
  }
  return lines;
}

/** True when `p` carries any class name in the discovered hidden set.
 *  Reads `className` directly (cheap) and splits on whitespace. */
function hasHiddenClass(p: Element, hidden: Set<string>): boolean {
  if (hidden.size === 0) return false;
  const cls = (p.getAttribute("class") || "").trim();
  if (!cls) return false;
  for (const c of cls.split(/\s+/)) {
    if (hidden.has(c)) return true;
  }
  return false;
}
```

- [ ] **Step 2: Type-check**

Run from the project root:

```bash
npx tsc --noEmit
```

Expected: no errors. If TypeScript reports an unused-symbol error for `isIgnored`, that's because Task 3 removed the symbol — make sure no other call site references it. If it reports a missing-symbol error for the same, double-check Task 3's rename landed.

- [ ] **Step 3: Commit**

```bash
git add src/sources/extensions/kolnovel.ts
git commit -m "fix(kolnovel): filter decoy paragraphs by class + strip embedded ad text"
```

---

## Task 5: Update the stale block comment in `getChapterContent`

**Files:**
- Modify: `src/sources/extensions/kolnovel.ts:99-104`

**Why:** The current comment claims hidden decoys are JS-injected at runtime and absent from the server response. The investigation in the spec proves that's wrong — the decoys are in the static HTML, marked by `class` attributes that reference an inline `<style>` rule whose class names rotate per request. Leaving the wrong comment in place will mislead the next reader.

- [ ] **Step 1: Replace the comment block**

In `getChapterContent`, replace the existing comment (originally lines 99-104) with:

```ts
      // Chapter content is in the initial HTML on KolNovel. The
      // anti-scrape decoys (paragraphs containing duplicated sentences,
      // the kolnovel.com ad string, and inline ad-network JS) are
      // present in the server response, NOT injected at runtime — they're
      // marked by `class` attributes that reference an inline <style>
      // rule whose 9 hex class names rotate per page load.
      // `extractChapterLines` discovers those names from the <style>
      // block and filters the matching <p> tags.
```

- [ ] **Step 2: Commit**

```bash
git add src/sources/extensions/kolnovel.ts
git commit -m "docs(kolnovel): correct getChapterContent comment about decoy paragraphs"
```

---

## Task 6: Manual verification in the running app

**Why:** This repo has no test framework (no `vitest`/`jest`, no `*.test.ts` files). Adding one solely for this fix would be feature creep per the project's "don't add features beyond what the task requires" guidance. Manual end-to-end verification is the established pattern for source extensions here.

- [ ] **Step 1: Start the Tauri dev shell**

```bash
npm run tauri dev
```

Wait for the desktop window to open. (If the dev server is already running from a prior task, this step is a no-op.)

- [ ] **Step 2: Open a KolNovel chapter known to be affected**

In the app:
1. Open the Store tab → KolNovel source.
2. Search for "True Martial World" (or any title whose chapter URLs follow the `/shaag24…-227002249XXX/` shape).
3. Open the novel detail page and start the first chapter that loads.

For a direct fixture, use this chapter URL — captured during investigation, known to contain decoys + ad strings:
```
https://free.kolnovel.com/shaag24true-martial-worldz435ggye-227002249357/
```

- [ ] **Step 3: Inspect the chapter content**

Confirm in the reader:
- Text reads coherently — no duplicated sentences mid-paragraph.
- No occurrence of `*إقرأ* رواياتنا* فقط* على* مو*قع م*لوك الرو*ايات ko*lno*vel ko*lno*vel. com` anywhere.
- No `222222222 window.pubfuturetag = …` style JS-blob artefacts.
- Sentence flow matches what's visible at the same URL in a regular browser tab.

- [ ] **Step 4: Spot-check via devtools**

Open the Tauri devtools console (right-click in the app → Inspect, or platform shortcut). Look for the source's log lines tagged `[source:kolnovel]`. For the True Martial World fixture chapter, the resulting `SourceLine` count should be in the ~80 range, not the ~158 a naive walk would produce.

If counts look right but content still has artefacts, re-read the spec's verification section and check whether a new decoy variant exists in the page — capture the new variant and decide whether to extend `IGNORED_PATTERNS` (separate work item).

- [ ] **Step 5: Spot-check an older chapter to make sure regression is impossible**

Pick any chapter from a novel published years ago (lower-numbered series). Confirm it still imports correctly — the obfuscation may not be applied there, and `hiddenClasses` should be empty in that case (no harm: behavior is unchanged from before this fix).

- [ ] **Step 6: No commit needed for this task**

Verification is observation-only. If anything fails, return to Task 4 or Task 3, fix, and re-verify.

---

## Done condition

- All five code commits land on the working branch.
- Both the True Martial World fixture chapter and one older chapter render coherently with no kolnovel.com ad string artefacts.
- `npx tsc --noEmit` is clean.
