# Reader within-chapter progress bar + exact resume position

Status: design approved, ready for implementation plan
Owner: Mostafa Osama
Scope: two related reader features —
(A) a thin **within-chapter** progress bar at the bottom edge of the reader's
top header, in both `DesktopReader` and `MobileReader`, for both local EPUB and
source/streamed novels; (B) **exact (sub-paragraph) resume** so "Continue
reading" lands at the precise scroll position, not just the paragraph top.
Touches `DesktopReader.tsx`, `MobileReader.tsx`, `PaginatedView.tsx`,
`store/library.ts` (`BookState` + `updateParagraphPosition`), `App.tsx`,
`SourceStreamReader.tsx`, and `types/reader.ts`. No new dependencies.

## Problem / motivation

1. **No within-chapter progress.** The reader's footer scrubber shows
   *book-level* progress (chapter X of N). There is nothing telling the reader
   how far through the **current chapter/page** they are — "how close am I to
   finishing this?". The user wants a thin bar at the bottom edge of the **top**
   header showing exactly that.
2. **Resume loses the exact spot.** Reading position is persisted at
   **paragraph granularity** (`paragraphIndex`). On resume the reader lands the
   correct paragraph at the *top* of the viewport, discarding the sub-paragraph
   scroll offset. Inside a long paragraph this can drop the reader noticeably
   away from where they left off. "Continue reading" should restore the exact
   position.

Both apply to local EPUBs and store/streamed novels, on desktop and mobile.

## Facts this design rests on (verified by code reconnaissance)

- **Three reading modes** (`src/types/reader.ts`): `paginated-2` (default),
  `paginated-1`, `scroll`. Position is preserved across modes via the persisted
  **paragraph index** — that index is the cross-mode anchor (highlights and
  mode-switch both rely on it).
- **Scroll mode** (`DesktopReader`/`MobileReader`): content lives in a scroll
  container (`scrollRef`). A throttled (250 ms) scroll listener finds the
  topmost-visible paragraph (`offset > 8px`) and reports it via
  `onParagraphChange`. Resume scrolls `target.offsetTop` into view (paragraph 0
  snaps to `scrollTop = 0` to keep the chapter heading visible; mobile subtracts
  chrome height).
- **Paginated mode** (`PaginatedView`): CSS multicol with transform-based page
  translation. It already tracks `page` (0-based) and `totalPages` and exposes
  them via `PaginatedAPI`/`onApi`; it emits the earliest paragraph that *starts*
  on the current page via `onParagraphChange`. Resume maps `initialParagraph` →
  the page containing it.
- **Persistence:** EPUB → `BookState { currentChapter, paragraphIndex }` in
  `books/<id>/state.json` (`updateParagraphPosition`, debounced 600 ms). Source
  → `PersistedState { currentChapter, paragraphIndex, highlights }` in
  localStorage `leaflet:stream-state:<sourceId>:<novelUrl>`. Both restore via the
  same `resumeParagraph`/`jumpNonce` props on the shared reader components.
- **Top header:** desktop header is a static flex bar (`borderBottom`,
  `flexShrink: 0`, never hides). Mobile top chrome is `position: absolute` and
  auto-hides via `translateY(-100%)`; its `offsetHeight` is measured to pad the
  scroll container and to offset resume scrolling.
- **Footer scrubber** already renders book-level progress with `theme.ink` fill
  on a `theme.rule` track — the visual language to match.

## Design — Feature A: within-chapter progress bar

A 2px bar pinned to the **bottom edge of the top header** in both readers.

**The fraction (0–1), per mode:**
- **Scroll:** `clamp(scrollTop / (scrollHeight − clientHeight), 0, 1)`, computed
  in a `requestAnimationFrame`-throttled scroll listener (separate from the
  250 ms paragraph/persistence listener, which is too coarse for a live bar).
  When `scrollHeight ≤ clientHeight` (chapter fits on screen, nothing to scroll)
  the fraction is **1** — consistent with paginated's single-page chapter giving
  `(0 + 1) / 1 = 1`. The clamp guards the divide-by-zero.
- **Paginated:** `(page + 1) / totalPages`, surfaced from `PaginatedView` via a
  new `onChapterProgress(fraction: number)` callback fired whenever `page` or
  `totalPages` changes.

**Rendering — imperative, zero per-frame re-renders:** the reader holds a
`progressFillRef` pointing at the bar's fill `<div>`. Both the scroll rAF path
and the paginated callback write `progressFillRef.current.style.width = pct%`
directly. The bar element itself renders once (empty); no React state updates on
scroll. Fill colour `theme.ink` over a faint `theme.rule` track; no width
transition (it tracks scroll/pages directly).

**Direction:** the fill grows from the **reading-start edge** — left→right in
LTR, right→left in RTL (the user reads RTL Arabic novels). Implemented by
anchoring the fill to the start side per `direction`.

**Mobile:** the bar lives inside the auto-hiding top chrome, so it hides with the
header on tap (immersive reading). Its height is included in the chrome
`offsetHeight` already measured for scroll padding / resume offset, so resume
positioning stays correct whether chrome is shown or hidden.

## Design — Feature B: exact (sub-paragraph) resume

**Schema (additive, back-compatible):** add optional `paragraphOffset?: number`
(0–1, normalized scroll offset *within* the resume paragraph) to:
- `BookState` (EPUB `state.json`), and
- `PersistedState` (source localStorage).

Absent (older saves / paginated captures) → behaves exactly as today.

**Capture (scroll mode only):** in the throttled scroll listener, alongside the
topmost paragraph index, compute
`offset = clamp((scrollTop − paraTop) / paraHeight, 0, 1)` for that paragraph and
persist `(paragraphIndex, paragraphOffset)` together. Plumbing:
`onParagraphChange` carries the optional offset; `updateParagraphPosition(id,
paragraphIndex, offset?)` writes both; the source reader mirrors it into
`PersistedState`.

**Restore (scroll mode):** after locating `target` by `data-p-index`, set
`scrollTop = target.offsetTop + paragraphOffset × target.offsetHeight` (mobile
subtracts chrome height as today). Normalized → reflow-stable across
font-size/content-width changes. Paragraph 0 keeps its top-snap when offset ≈ 0.

**Paginated mode:** unchanged — resume already lands the correct *page* via the
paragraph→page mapping. Offset is captured only in scroll mode and ignored here.
**Known limitation:** a single paragraph spanning multiple pages can resume to
the page where that paragraph *starts* (paginated emits a paragraph only when it
*starts* within a page). Rare for novel-length paragraphs; accepted for v1 rather
than storing fragile, reflow-variant page indices.

## Data flow summary

```
scroll mode:
  scroll → rAF listener  → progressFillRef.style.width   (Feature A, live)
         → 250ms listener → onParagraphChange(idx, offset) → persist (Feature B)
  resume → find p[idx] → scrollTop = offsetTop + offset*height (Feature B)

paginated mode:
  page/totalPages change → onChapterProgress(frac) → progressFillRef.style.width
  resume → paragraph→page (unchanged)
```

## Edge cases

- **Back-compat:** missing `paragraphOffset` ⇒ old paragraph-top behavior.
- **Short chapter** (`scrollHeight ≈ clientHeight`): clamp avoids NaN/Infinity.
- **Mode switch mid-chapter:** paragraph index still anchors; offset best-effort
  (meaningful only in scroll mode).
- **RTL:** bar fills from the right; resume math is offset-based (direction-
  agnostic).
- **Chapter change:** resets `paragraphIndex` → 0 and `paragraphOffset` → 0
  (new chapter starts at top), as today.

## Testing / verification

- `tsc --noEmit` and `vite build` green.
- In-app: scroll to the middle of a long paragraph → close → reopen lands at the
  exact spot (EPUB and a store novel); bar tracks scroll smoothly and reaches
  100% at chapter end; in paginated-2 the bar steps with page flips; RTL novel
  fills from the right; mobile bar hides with the chrome and resume isn't shifted
  by the chrome.

## Out of scope (YAGNI)

- Making the new bar draggable/seekable (it is indicative only; the footer
  scrubber already seeks).
- Exact within-page restoration for multi-page paragraphs in paginated mode.
- Any change to the book-level footer scrubber or the `ProgressOverlay` panel.
