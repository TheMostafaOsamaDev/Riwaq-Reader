# KolNovel — `src/sources/extensions/kolnovel.ts`

Site: <https://free.kolnovel.com> (also `kolnovel.com`)

Theme: custom WordPress build; relatively static — most data lives in
the initial HTML.

## Capabilities

| Method                | Supported | Notes |
|-----------------------|-----------|-------|
| `getHomeSections`     | ✓         | parses `.trendarea`, `.homehot`, `.bixbox + .listupd` |
| `search`              | ✓         | `/?s=<q>&paged=<n>` — full WordPress search |
| `searchSuggest`       | —         | site has no live-suggest endpoint |
| `getNovel`            | ✓         | `/series/<slug>/` — `.sertobig` + `.ts-chl-collapsible` |
| `searchChapters`      | —         | no in-novel search on the site |
| `getChapterContent`   | ✓         | **pure static fetch** — body is in the initial HTML |

## Why no headless rendering

The original NovelScraper C# tool used Playwright to wait for chapter
text to appear, because the visible chapter body is injected by JS
shortly after page load. But the JS-injected content is the
**decoy** — invisible paragraphs the site uses to defeat copy-paste
("position: fixed; height: 0.1px; opacity: 0"). The real chapter text
ships in the server-rendered HTML. So `getChapterContent` uses a static
`host.fetch` and walks `#kol_content`'s `<p>` elements, with a defensive
filter for any decoys that do come through:

```ts
function isHiddenInline(p: Element): boolean {
  const style = (p.getAttribute("style") || "").toLowerCase();
  return (
    style.includes("0.1px") &&
    style.includes("position") &&
    style.includes("fixed") &&
    style.includes("opacity") &&
    style.includes("text-indent")
  );
}
```

This makes the extension mobile-ready: it never calls the desktop-only
`renderAndExtract` path.

## Card-URL filtering

KolNovel surfaces both novel-index URLs (`/series/<slug>/`) and direct
chapter URLs (`/shaag24…/…`) in the same homepage rows. We filter every
parsed card so only series-URL ones make it through — the store UI
assumes a card click navigates to a novel detail page, not a chapter.

## Ignored-line patterns

`IGNORED_PATTERNS` near the top of the file lists fuzzy templates the
site puts in line-of-text decoys (e.g. "إقرأ روايتنا فقط على موقع
ملوك الروايات…"). Translated to regexes at module load. Add new
patterns when the site introduces fresh decoy variants — they're
visible after import as repeated suspicious-looking lines.

## Metadata harvesting

`.serl` rows on the novel page are key:value pairs (Arabic labels) for
author, translator, original language, year, type, … We keep them all
in `SourceNovel.meta` so the detail view's definition list is complete,
and pluck out the author by label-matching `/كاتب|writer|author/i`.
