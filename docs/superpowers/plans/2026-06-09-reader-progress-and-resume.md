# Reader within-chapter progress bar + exact resume — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a thin within-chapter progress bar to the reader's top header (all readers, desktop + mobile) and upgrade "Continue reading" to restore the exact sub-paragraph scroll position.

**Architecture:** Keep the existing paragraph-index model as the cross-mode anchor. Layer two decoupled signals on top: (1) a live "chapter fraction" computed per-mode and written to a 2px bar imperatively (no React re-render per scroll frame); (2) a normalized `paragraphOffset` (0–1) captured/restored in scroll mode for exact resume. Pure math lives in an isolated, side-effect-free helper module.

**Tech Stack:** React 19 + TypeScript, Tauri 2 (`@tauri-apps/plugin-fs`), Vite. Spec: `docs/superpowers/specs/2026-06-09-reader-progress-and-resume-design.md`.

**Testing note:** This repo has no unit-test runner (none in `package.json`; existing sources/specs verify manually). Adding one is out of scope. Every task's automated gate is `npx tsc --noEmit` (the repo's `build` script is `tsc && vite build`). Integration is verified manually with `npm run tauri dev` + devtools, exactly as the existing readers are. The pure helpers in Task 1 are written side-effect-free so they *could* get a unit runner later.

**Task order** (each type-checks independently — new props/params are optional/additive so no task breaks callers added in a later task): 1 helpers + bar component → 2 persistence schema → 3 PaginatedView progress callback → 4 DesktopReader → 5 MobileReader → 6 App threading → 7 SourceStreamReader threading → 8 build + manual verification.

---

## Task 1: Pure progress helpers + the bar component

**Files:**
- Create: `src/components/readerProgress.ts`
- Create: `src/components/ChapterProgressBar.tsx`

- [ ] **Step 1: Create the pure helper module**

`src/components/readerProgress.ts`:

```ts
// Pure helpers for the reader's within-chapter progress bar (Feature A) and
// exact sub-paragraph resume (Feature B). No DOM / React access — keeping the
// math side-effect-free makes it easy to reason about (and to unit-test later,
// if this repo ever grows a test runner).

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Fraction (0..1) of the current chapter scrolled through, in scroll mode.
 *  When the chapter fits on screen (nothing to scroll) there is no remaining
 *  distance, so it reads as fully shown (1) — consistent with a paginated
 *  single-page chapter: (0 + 1) / 1 = 1. */
export function chapterScrollFraction(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const scrollable = scrollHeight - clientHeight;
  if (scrollable <= 0) return 1;
  return clamp01(scrollTop / scrollable);
}

/** Fraction (0..1) of the way the viewport top sits INTO a paragraph.
 *  0 = the paragraph's top is at the viewport top; 1 = its bottom. Normalized
 *  to the paragraph, so it survives reflow (font size / column width changes)
 *  unlike an absolute scrollTop. */
export function paragraphScrollOffset(
  scrollTop: number,
  paragraphTop: number,
  paragraphHeight: number,
): number {
  if (paragraphHeight <= 0) return 0;
  return clamp01((scrollTop - paragraphTop) / paragraphHeight);
}

/** Inverse of paragraphScrollOffset: the scrollTop that lands the viewport at
 *  the saved offset within a paragraph. */
export function restoreScrollTop(
  paragraphTop: number,
  paragraphHeight: number,
  offset: number,
): number {
  return paragraphTop + clamp01(offset) * paragraphHeight;
}

/** Fraction (0..1) of the chapter consumed in paginated mode; last page = 1. */
export function paginatedFraction(page: number, totalPages: number): number {
  if (totalPages <= 0) return 0;
  return clamp01((page + 1) / totalPages);
}

/** Format a 0..1 fraction as a CSS width percentage string. */
export function fractionToWidth(fraction: number): string {
  return `${clamp01(fraction) * 100}%`;
}
```

- [ ] **Step 2: Create the bar component**

`src/components/ChapterProgressBar.tsx`:

```tsx
import type { RefObject } from "react";
import type { Theme } from "../styles/tokens";
import { fractionToWidth } from "./readerProgress";

interface Props {
  /** The reader writes the fill width imperatively through this ref (e.g. on
   *  every scroll frame) so scrolling never triggers a React re-render. */
  fillRef: RefObject<HTMLDivElement | null>;
  theme: Theme;
  /** Fill grows from the reading-start edge: right in RTL, left in LTR. */
  rtl: boolean;
  /** Width to paint before the reader's first imperative update. 0..1. */
  initialFraction?: number;
}

/** A 2px within-chapter progress indicator, pinned to the bottom edge of the
 *  reader's top header. Indicative only (not draggable) — the footer scrubber
 *  already handles book-level seeking. Absolutely positioned, so its parent
 *  (the header container) must be position:relative or position:absolute. */
export function ChapterProgressBar({
  fillRef,
  theme,
  rtl,
  initialFraction = 0,
}: Props) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 2,
        background: theme.rule,
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      <div
        ref={fillRef}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          ...(rtl ? { right: 0 } : { left: 0 }),
          width: fractionToWidth(initialFraction),
          background: theme.ink,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (`Theme` is exported from `src/styles/tokens.ts`; the module has no other consumers yet.)

- [ ] **Step 4: Commit**

```bash
git add src/components/readerProgress.ts src/components/ChapterProgressBar.tsx
git commit -m "feat(reader): add chapter-progress math helpers + bar component"
```

---

## Task 2: Persistence schema — `paragraphOffset` on EPUB state

**Files:**
- Modify: `src/store/library.ts` (`BookState`, `readState`, `updateParagraphPosition`, `updateReadingPosition`)

- [ ] **Step 1: Add the field to `BookState`**

In `src/store/library.ts`, in `interface BookState`, add after the `paragraphIndex` field:

```ts
  /** 0..1 — how far the viewport top sits INTO the topmost-visible paragraph,
      so resume lands at the exact scroll position, not just the paragraph top.
      Absent on older saves and on paginated captures → treated as 0. */
  paragraphOffset?: number;
```

- [ ] **Step 2: Default it in `readState`**

In `readState`, the default-state object (returned when no `state.json` exists) needs no change (omitting it ⇒ `undefined` ⇒ 0). If `readState` normalizes parsed JSON field-by-field, add `paragraphOffset: parsed.paragraphOffset` (leave `undefined` when absent). Open `readState` and confirm which shape it uses; if it returns the parsed object directly (`as BookState`), no edit is needed here.

- [ ] **Step 3: Persist the offset in `updateParagraphPosition`**

Change the signature and body:

```ts
export async function updateParagraphPosition(
  id: string,
  paragraphIndex: number,
  paragraphOffset?: number,
): Promise<void> {
  const state = await readState(id);
  state.paragraphIndex = paragraphIndex;
  state.paragraphOffset = paragraphOffset ?? 0;
  await writeState(state);
}
```

- [ ] **Step 4: Reset the offset on chapter change in `updateReadingPosition`**

In `updateReadingPosition`, where it sets `state.paragraphIndex = 0` / writes the new chapter, also reset the offset. Find the lines that reset paragraph progress for the new chapter and add:

```ts
  state.paragraphOffset = 0;
```

(Right next to the existing `state.paragraphIndex = 0;` — a new chapter starts at the top.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (`paragraphOffset` is optional; the new third arg is optional, so existing `updateParagraphPosition(id, idx)` calls still type-check.)

- [ ] **Step 6: Commit**

```bash
git add src/store/library.ts
git commit -m "feat(reader): persist sub-paragraph scroll offset in BookState"
```

---

## Task 3: PaginatedView emits chapter progress

**Files:**
- Modify: `src/components/PaginatedView.tsx`

- [ ] **Step 1: Import the helper**

At the top of `src/components/PaginatedView.tsx` add:

```ts
import { paginatedFraction } from "./readerProgress";
```

- [ ] **Step 2: Add the callback prop**

In `interface Props`, after the `onApi?` field, add:

```ts
  /** Fires whenever the within-chapter page position changes, as a 0..1
   *  fraction ((page + 1) / totalPages). Drives the header progress bar. */
  onChapterProgress?: (fraction: number) => void;
```

Add `onChapterProgress` to the destructured props in the component signature (alongside `onApi`).

- [ ] **Step 3: Emit on page / totalPages change**

Add this effect near the existing `onApi` effect (which already depends on `page, totalPages`):

```tsx
  useEffect(() => {
    onChapterProgress?.(paginatedFraction(page, totalPages));
  }, [page, totalPages, onChapterProgress]);
```

(`useEffect` is already imported in this file.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (`onChapterProgress` is optional; DesktopReader doesn't pass it until Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/components/PaginatedView.tsx
git commit -m "feat(reader): PaginatedView reports within-chapter page progress"
```

---

## Task 4: DesktopReader — progress bar + offset capture/restore

**Files:**
- Modify: `src/components/DesktopReader.tsx`

- [ ] **Step 1: Imports**

Add to the existing imports:

```ts
import { ChapterProgressBar } from "./ChapterProgressBar";
import {
  chapterScrollFraction,
  paragraphScrollOffset,
  restoreScrollTop,
  fractionToWidth,
} from "./readerProgress";
```

- [ ] **Step 2: Widen the prop types and add `resumeOffset`**

In `interface Props`:
- change `onParagraphChange: (idx: number) => void;` to
  `onParagraphChange: (idx: number, offset?: number) => void;`
- add after `resumeParagraph: number;`:
  ```ts
    /** 0..1 sub-paragraph scroll offset to resume at (scroll mode). Optional;
        defaults to 0 (paragraph top) for callers that don't track it yet. */
    resumeOffset?: number;
  ```

Destructure `resumeOffset = 0` in the component signature (next to `resumeParagraph`).

- [ ] **Step 3: Track the live offset + add the fill ref**

Near `const livePara = useRef(resumeParagraph);` (~line 111) add:

```ts
  const liveOffset = useRef(resumeOffset);
  const progressFillRef = useRef<HTMLDivElement>(null);
```

In the two `if` blocks that re-seed `livePara.current = resumeParagraph` on chapter / jumpNonce change, also re-seed the offset right after each:

```ts
    liveOffset.current = resumeOffset;
```

- [ ] **Step 4: Emit the offset from `handleParagraphChange`**

The wrapper currently is `(idx) => { livePara.current = idx; onParagraphChange(idx); }`. Replace with:

```ts
  const handleParagraphChange = useCallback(
    (idx: number, offset?: number) => {
      livePara.current = idx;
      if (offset !== undefined) liveOffset.current = offset;
      onParagraphChange(idx, offset);
    },
    [onParagraphChange],
  );
```

- [ ] **Step 5: Compute the offset in the scroll (paragraph) listener**

In the scroll-mode paragraph listener (the `mode !== "scroll"` early-return effect, ~lines 248–272), track the best element and compute the offset before reporting. Replace the loop + report with:

```ts
        const ps = el.querySelectorAll<HTMLElement>("[data-p-index]");
        if (ps.length === 0) return;
        const containerTop = el.getBoundingClientRect().top;
        let best = 0;
        let bestEl: HTMLElement | null = null;
        for (const p of ps) {
          const offset = p.getBoundingClientRect().top - containerTop;
          if (offset > 8) break;
          best = Number(p.dataset.pIndex);
          bestEl = p;
        }
        const intoPara = bestEl
          ? paragraphScrollOffset(el.scrollTop, bestEl.offsetTop, bestEl.offsetHeight)
          : 0;
        onParagraphChangeRef.current(best, intoPara);
```

(`onParagraphChangeRef.current` is `handleParagraphChange`, which now takes the offset.)

- [ ] **Step 6: Restore the offset in the scroll resume effect**

In the scroll-mode resume effect (~lines 203–243), keep the paragraph-0 top-snap only when there is no offset, and otherwise restore the exact position:

```ts
    if (livePara.current === 0 && liveOffset.current <= 0.001) {
      el.scrollTop = 0;
      return;
    }
    const target = el.querySelector<HTMLElement>(
      `[data-p-index="${livePara.current}"]`,
    );
    if (target) {
      el.scrollTop = restoreScrollTop(
        target.offsetTop,
        target.offsetHeight,
        liveOffset.current,
      );
    } else {
      el.scrollTop = 0;
    }
```

- [ ] **Step 7: Add the rAF scroll-progress listener (scroll mode)**

Add a new effect after the paragraph listener:

```tsx
  // Live within-chapter progress for the header bar. Separate from the 250ms
  // paragraph listener (too coarse for a smooth bar) and written imperatively
  // so scrolling never re-renders React.
  useEffect(() => {
    if (mode !== "scroll") return;
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const paint = () => {
      raf = 0;
      if (!progressFillRef.current) return;
      progressFillRef.current.style.width = fractionToWidth(
        chapterScrollFraction(el.scrollTop, el.scrollHeight, el.clientHeight),
      );
    };
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(paint);
    };
    paint(); // initial fill for this chapter
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [mode, currentChapter, book.id]);
```

- [ ] **Step 8: Feed paginated progress to the same bar**

On the `<PaginatedView ... />` element, add:

```tsx
            onChapterProgress={(f) => {
              if (progressFillRef.current)
                progressFillRef.current.style.width = fractionToWidth(f);
            }}
```

- [ ] **Step 9: Render the bar in the header**

Find the top header container (the flex `<div>` with `borderBottom: \`0.5px solid ${theme.rule}\``, `flexShrink: 0`, ~line 619). Add `position: "relative",` to its inline `style`, and add the bar as its **last child** (just before that div's closing `</div>`):

```tsx
        <ChapterProgressBar fillRef={progressFillRef} theme={theme} rtl={rtl} />
```

(`theme` and `rtl` are already in scope: `const rtl = isRtlLanguage(book.language)` at ~line 104.)

- [ ] **Step 10: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (`resumeOffset` optional; `onParagraphChange` widened to accept an optional 2nd arg — App's current `(idx) => …` handler remains assignable.)

- [ ] **Step 11: Commit**

```bash
git add src/components/DesktopReader.tsx
git commit -m "feat(reader): desktop within-chapter bar + exact scroll resume"
```

---

## Task 5: MobileReader — progress bar + offset capture/restore (scroll-only)

**Files:**
- Modify: `src/components/MobileReader.tsx`

MobileReader does not use PaginatedView — it is always scroll mode, so only the scroll path applies.

- [ ] **Step 1: Imports**

```ts
import { ChapterProgressBar } from "./ChapterProgressBar";
import {
  chapterScrollFraction,
  paragraphScrollOffset,
  restoreScrollTop,
  fractionToWidth,
} from "./readerProgress";
```

- [ ] **Step 2: Widen prop types, add `resumeOffset`, add refs**

In `interface Props`:
- change `onParagraphChange: (idx: number) => void;` to `(idx: number, offset?: number) => void;`
- add `resumeOffset?: number;` after `resumeParagraph: number;`.

Destructure `resumeOffset = 0`. Near `const resumeRef = useRef(resumeParagraph); resumeRef.current = resumeParagraph;` (~line 251) add:

```ts
  const resumeOffsetRef = useRef(resumeOffset);
  resumeOffsetRef.current = resumeOffset;
  const progressFillRef = useRef<HTMLDivElement>(null);
  const rtl = isRtlLanguage(book.language);
```

(`isRtlLanguage(book.language)` is already used inline at ~line 863; this names it once.)

- [ ] **Step 3: Restore the offset in the resume effect**

In the resume effect (~lines 262–289), keep the `resumeRef.current === 0` top-snap only when there's no offset, and use `restoreScrollTop` for the target:

```ts
    if (resumeRef.current === 0 && resumeOffsetRef.current <= 0.001) {
      el.scrollTop = 0;
      return;
    }
    const target = el.querySelector<HTMLElement>(
      `[data-p-index="${resumeRef.current}"]`,
    );
    if (!target) {
      el.scrollTop = 0;
      return;
    }
    const chromeOffset =
      showChromeRef.current && chromeRef.current
        ? chromeRef.current.offsetHeight + 8
        : 0;
    el.scrollTop = Math.max(
      0,
      restoreScrollTop(target.offsetTop, target.offsetHeight, resumeOffsetRef.current) -
        chromeOffset,
    );
```

- [ ] **Step 4: Compute the offset in the scroll listener**

In the paragraph scroll listener (~lines 292–309), mirror Task 4 Step 5: track `bestEl`, compute `paragraphScrollOffset(el.scrollTop, bestEl.offsetTop, bestEl.offsetHeight)`, and call `onParagraphChangeRef.current(best, intoPara)`.

- [ ] **Step 5: Add the rAF scroll-progress listener**

```tsx
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const paint = () => {
      raf = 0;
      if (!progressFillRef.current) return;
      progressFillRef.current.style.width = fractionToWidth(
        chapterScrollFraction(el.scrollTop, el.scrollHeight, el.clientHeight),
      );
    };
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(paint);
    };
    paint();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [currentChapter, book.id]);
```

- [ ] **Step 6: Render the bar in the top chrome**

The top chrome container (`ref={chromeRef}`, `position: "absolute"`, ~line 736) is already a positioned ancestor. Add the bar as its **last child** (before its closing tag):

```tsx
        <ChapterProgressBar fillRef={progressFillRef} theme={theme} rtl={rtl} />
```

The bar's 2px height is inside the chrome, so it is already part of `chromeRef.current.offsetHeight` (the value the resume effect subtracts) and slides away with the chrome on auto-hide.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/MobileReader.tsx
git commit -m "feat(reader): mobile within-chapter bar + exact scroll resume"
```

---

## Task 6: App threads the offset for local EPUBs

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add `resumeOffset` to the `Loaded` state shape**

In the `Loaded` interface (the object held in `loaded` state), add `resumeOffset: number;` next to `resumeParagraph: number;`.

- [ ] **Step 2: Seed it in `openBook`**

In `openBook`, where it calls `setLoaded({ ... resumeParagraph: state.paragraphIndex, ... })`, add:

```ts
          resumeOffset: state.paragraphOffset ?? 0,
```

- [ ] **Step 3: Persist + carry the offset in `onParagraphChange`**

Replace the debounced `onParagraphChange` body so it accepts and stores the offset (dedup on both index and offset so within-paragraph scroll still persists):

```ts
  const onParagraphChange = useCallback((idx: number, offset?: number) => {
    if (paragraphSaveTimer.current)
      clearTimeout(paragraphSaveTimer.current);
    paragraphSaveTimer.current = window.setTimeout(() => {
      paragraphSaveTimer.current = null;
      setLoaded((prev) => {
        if (!prev) return prev;
        const off = offset ?? 0;
        if (
          prev.state.paragraphIndex === idx &&
          (prev.state.paragraphOffset ?? 0) === off
        )
          return prev;
        void updateParagraphPosition(prev.book.id, idx, off);
        return {
          ...prev,
          state: { ...prev.state, paragraphIndex: idx, paragraphOffset: off },
        };
      });
    }, 600);
  }, []);
```

- [ ] **Step 4: Reset the offset on chapter change**

In `changeChapter`, where it returns `{ ...prev, currentChapter: clamped, resumeParagraph: 0 }`, add `resumeOffset: 0,`. (`updateReadingPosition` already resets the persisted offset from Task 2.)

- [ ] **Step 5: Pass `resumeOffset` to both readers**

On both `<MobileReader .../>` (~line 449) and `<DesktopReader .../>` (~line 468), add next to `resumeParagraph={loaded!.resumeParagraph}`:

```tsx
            resumeOffset={loaded!.resumeOffset}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(reader): thread exact resume offset through the local reader"
```

---

## Task 7: SourceStreamReader threads the offset for store novels

**Files:**
- Modify: `src/components/SourceStreamReader.tsx`

- [ ] **Step 1: Extend `PersistedState` (de)serialization**

Add `paragraphOffset?: number;` to the `PersistedState` interface. In `readPersisted`, parse it defensively:

```ts
      paragraphOffset:
        typeof parsed.paragraphOffset === "number" ? parsed.paragraphOffset : 0,
```

(`writePersisted` serializes the whole object, so it needs no change once the field is in the persisted state object built below.)

- [ ] **Step 2: Add offset state + restore it**

Add state next to `paragraphIndex`:

```ts
  const [paragraphOffset, setParagraphOffset] = useState(0);
  const [resumeOffset, setResumeOffset] = useState(0);
```

In the load effect, where it restores `setParagraphIndex(persisted?.paragraphIndex ?? 0)` / `setResumeParagraph(...)`, add:

```ts
        setParagraphOffset(persisted?.paragraphOffset ?? 0);
        setResumeOffset(persisted?.paragraphOffset ?? 0);
```

- [ ] **Step 3: Include the offset in the persistence write**

In the persistence effect (`writePersisted(persistKey, { currentChapter, paragraphIndex, highlights })`), add `paragraphOffset,` to the object and add `paragraphOffset` to that effect's dependency array.

- [ ] **Step 4: Capture the offset from the reader callback**

In the `onParagraphChange` callback passed to the readers (currently `(idx) => { setParagraphIndex(idx); … markChapterRead … }`), change to `(idx: number, offset?: number) => { setParagraphIndex(idx); setParagraphOffset(offset ?? 0); … }` (keep the existing last-paragraph `markChapterRead` logic untouched).

- [ ] **Step 5: Reset offset on chapter change**

In `onChapterChange`, where it does `setParagraphIndex(0)` / `setResumeParagraph(0)` for the new chapter, add `setParagraphOffset(0); setResumeOffset(0);`.

- [ ] **Step 6: Pass `resumeOffset` to both readers**

On the `<DesktopReader .../>` and `<MobileReader .../>` rendered by SourceStreamReader, add `resumeOffset={resumeOffset}` next to the existing `resumeParagraph={resumeParagraph}`.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/SourceStreamReader.tsx
git commit -m "feat(reader): thread exact resume offset through the streaming reader"
```

---

## Task 8: Full build + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Build**

Run: `npx tsc --noEmit && npm run build`
Expected: both PASS (pre-existing INEFFECTIVE_DYNAMIC_IMPORT / chunk-size warnings are unrelated).

- [ ] **Step 2: Manual pass with `npm run tauri dev`**

Verify, in devtools and on screen:

- **Progress bar (scroll mode):** open an EPUB in scroll mode → a 2px bar sits on the header's bottom edge, fills smoothly as you scroll, reaches ~100% at chapter end, resets near 0% at the next chapter's top.
- **Progress bar (paginated-2 / paginated-1):** switch modes in settings → the bar steps with page flips and reads `(page+1)/totalPages`.
- **Exact resume (scroll, EPUB):** scroll to the middle of a long paragraph → back out to Library → reopen via "Continue reading" → lands at the exact spot (not the paragraph top).
- **Exact resume (store novel):** same flow with a store/source novel (the one we made appear in Continue reading) → exact position restored from localStorage.
- **RTL:** open an Arabic novel → the bar fills from the right.
- **Mobile (`tauri dev` mobile layout or narrow window):** bar shows on the top chrome, hides with the chrome on tap, and resume position isn't shifted by the chrome bar.
- **Back-compat:** a book last read before this change (no `paragraphOffset`) resumes to the paragraph top as before — no errors.

- [ ] **Step 3: Final branch state**

No code commit here. Confirm `git status` is clean (all task commits landed) and the branch is `feat/reader-progress-and-resume`.

---

## Self-review notes (author)

- **Spec coverage:** Feature A bar (Tasks 1,3,4,5) — scroll + paginated, desktop + mobile, header bottom edge, RTL, mobile auto-hide ✓. Feature B exact resume (Tasks 1,2,4,5,6,7) — normalized offset, capture in scroll mode, restore both readers, EPUB + source, back-compat, chapter-change reset ✓. Footer scrubber / ProgressOverlay untouched (out of scope) ✓.
- **Type consistency:** helper names (`chapterScrollFraction`, `paragraphScrollOffset`, `restoreScrollTop`, `paginatedFraction`, `fractionToWidth`) used identically across Tasks 1/3/4/5. `paragraphOffset` (storage) vs `resumeOffset` (prop) vs `liveOffset`/`resumeOffsetRef` (in-reader) — distinct, intentional names. `onParagraphChange` widened to `(idx, offset?)` in Props (Tasks 4,5) and emitted from App/Source (Tasks 6,7); the old `(idx) => …` handlers stay assignable.
- **Known limitation (documented):** paginated mode multi-page paragraphs resume to the page where the paragraph starts — accepted for v1 per the spec.
