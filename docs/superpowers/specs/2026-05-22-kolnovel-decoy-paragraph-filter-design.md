# KolNovel chapter scrape: decoy-paragraph filter

Status: design approved, ready for implementation plan
Owner: Mostafa Osama
Scope: `src/sources/extensions/kolnovel.ts` (chapter-body extraction only)

## Problem

`getChapterContent` in `src/sources/extensions/kolnovel.ts` returns garbage:
duplicated sentences and the Arabic kolnovel.com ad string
(`*إقرأ* رواياتنا* فقط* على* مو*قع م*لوك الرو*ايات ko*lno*vel ko*lno*vel. com`)
appear interleaved with real text. The user perceives this as "shuffled
paragraphs."

## What's actually happening on the page

Inspecting `https://free.kolnovel.com/<chapter-slug>/` via curl + DOMParser:

1. The HTML response embeds an inline `<style>` block that defines a single CSS
   rule targeting **9 random hex-prefixed class names** with the body:
   ```
   height: 0.1px; overflow: hidden; position: fixed;
   opacity: 0; text-indent: -99999px; bottom: -999px;
   ```
   The class names are **regenerated per page load** (sample 1:
   `a82c8c3f68270ab01bf455c4d6bfc4512` etc.; sample 2: `a3bfb0c4cea10e92b7c01f91128695e59` etc.).
2. The chapter body uses malformed nested `<p>` tags. HTML5 auto-closes the
   outer `<p>` when it encounters a new `<p>`, so DOMParser produces ~158 sibling
   `<p>` elements per chapter from what looks like ~81 to a naive regex.
3. Of those 158 paragraphs, ~78 carry one of the 9 hidden-class names. These
   are the decoys. The 80 remaining visible paragraphs are in correct narrative
   order — no actual reordering is happening.

The decoy paragraphs contain (a) the ad string above, (b) sentences copied from
elsewhere in the chapter, or (c) inlined ad-network JS snippets.

## Current bug

`isHiddenInline()` at `src/sources/extensions/kolnovel.ts:202-212` only checks
the inline `style=""` attribute. The obfuscation marks decoys via `class="..."`
referencing the inline `<style>` rule, so every decoy slips through.

The existing `IGNORED_PATTERNS` regex catches the ad string only when it is
the **entire** paragraph. Decoys typically contain the ad string mixed with
other text, so they bypass it.

## Approach (Option A, approved)

Stay on the static-HTML path. Discover the 9 hidden class names from the
page's inline `<style>` blocks at parse time, then filter `<p>` elements
whose class set intersects them. Strengthen the existing pattern filter from
whole-line match to substring strip so any ad-string leak through inline
content is scrubbed.

### File touched
`src/sources/extensions/kolnovel.ts` only. No host, type, or other-source changes.

### Stale comment to update
The block comment at `getChapterContent` (lines 99-104) currently claims
"the hidden decoy paragraphs … are injected by JS at runtime, NOT present
in the server response." That was wrong — they **are** in the server
response, just marked with classes the old check ignored. Rewrite the
comment to reflect the discovered mechanism (class-based hide via inline
`<style>`, rotating class names).

### New helper — `collectHiddenClasses(doc: Document): Set<string>`
- Walks every `<style>` element in `doc`.
- For each CSS rule (split on `{`/`}` boundaries), checks the body for the
  decoy signature: case-insensitive presence of all three tokens `0.1px`,
  `opacity` followed by `0`, and `-99999px`. Matching three independent
  signals lets the site tweak whitespace or property order without breaking us.
- From matching rules' selector lists, extracts `.<hexclass>` tokens where
  the hex tail is ≥ 20 chars. Returns the bare class names as a Set for
  O(1) lookup.

### Modified `extractChapterLines(doc: Document): SourceLine[]`
- At top: `const hiddenClasses = collectHiddenClasses(doc);`
- Inside the paragraph loop, before `paragraphText(p)`: if any token in
  `p.className.split(/\s+/)` is in `hiddenClasses`, skip the paragraph.
- Keeps the existing `isHiddenInline` check (cheap, catches future
  inline-style variants) and the existing dedup-by-text set.

### Renamed `isIgnored` → `stripIgnored(text: string): string`
- Old behavior: returned bool, caller dropped paragraph on match.
- New behavior: runs each `IGNORED_REGEXES` entry as a substring replace,
  then collapses whitespace. Caller drops the paragraph only if the
  resulting text is empty.
- `IGNORED_REGEXES` rebuilt without the `^…$` anchors and with flags `gi`
  so it matches substrings repeatedly. The `*` wildcards in the pattern
  compile to **lazy** `.*?` (not greedy `.*`) so the strip doesn't eat
  legitimate text between two well-separated ad-string occurrences.

### Data flow
```
HTML response
  → parseHtmlDocument (DOMParser, browser-native)
    → collectHiddenClasses(doc)            // scan <style> blocks
    → root.querySelectorAll('p, img')      // existing walk
      → per <p>: skip if class ∈ hiddenClasses   // NEW gate
                 skip if isHiddenInline           // existing fallback
                 text = paragraphText(p)
                 text = stripIgnored(text)        // CHANGED from drop-whole
                 skip if text empty
                 emit SourceLine
```

### Error handling
- No `<style>` block matches the signature → `hiddenClasses` empty Set →
  behavior degrades to today's (still catches via `isHiddenInline` and
  pattern strip).
- Selector list parses to empty → same fallback.
- `<p>` lacks a `class` attribute → `className` is `""`, intersection is
  empty, paragraph kept.

### False-positive risk
A real paragraph could in principle share a class name with a decoy. From
two sampled chapters this never happened: the 9 hidden names are distinct
from every visible paragraph's class. Mitigation already baked in — we
only collect classes from rules that actually match the hide signature.

## Out of scope
- The novel description path (`extractDescriptionText`, series page). No
  evidence of this trick there; leave alone.
- Adding new entries to `IGNORED_PATTERNS`. The one existing pattern plus
  the new class filter covers all observed cases.
- Switching to `host.renderAndExtract` (JS rendering). Static fetch path
  is preserved per the approved approach.
- Test framework. No vitest/jest exists in this repo; verification is
  manual via the running app on a known affected chapter, plus a curled
  HTML fixture for ad-hoc local inspection if needed.

## Verification plan
1. Run `npm run tauri dev`, open the Store tab, browse to a KolNovel chapter
   known to contain the ad string (e.g. the True Martial World chapter used
   during investigation:
   `https://free.kolnovel.com/shaag24true-martial-worldz435ggye-227002249357/`).
2. Confirm chapter reads coherently — no duplicate sentences, no
   `*إقرأ* رواياتنا*…kolnovel.com` artefact, no `pubfuturetag` JS code blobs.
3. Open the Tauri devtools console and look for the `[source:kolnovel]`
   log line counts — expect ~80 emitted lines for the test chapter (vs.
   the ~158 a naive walk would produce).
4. Spot-check a chapter without the obfuscation (older volumes) — should
   still extract correctly; the hidden-class set is empty and behavior is
   unchanged.
