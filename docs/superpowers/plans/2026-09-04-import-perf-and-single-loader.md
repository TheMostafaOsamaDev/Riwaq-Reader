# Import: One Loader, Half the Work — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show exactly one import indicator, and stop the import from writing the book twice or freezing the UI thread.

**Architecture:** The floating progress dock is deleted and the bottom-bar FAB becomes the single indicator, reading the shared `importProgress` store directly so progress ticks stop re-rendering the whole library tree. On the pipeline side: EPUB in-flow images are recorded in a manifest and extracted lazily at read time instead of being copied out of the archive at import; the spine parse loop yields to the event loop on an 8 ms slice and reports per-chapter progress; PDFs are read through a Rust range command via a pdf.js range transport instead of being loaded whole into the webview.

**Tech Stack:** React 19 + Vite + Tauri v2 (desktop + Android), TypeScript, Rust (`zip`, `sha2`), pdf.js 4.7, mammoth + JSZip, vitest (+ happy-dom for DOM-dependent suites).

**Spec:** `docs/superpowers/specs/2026-09-04-import-perf-and-single-loader-design.md`

## Global Constraints

- Test runner is `pnpm test` (vitest). Default environment is **node**; a suite needing DOM must start with `// @vitest-environment happy-dom`. Only `src/**/*.test.ts` is collected — **`.test.tsx` files are not run**, so all new tests are `.ts`.
- Baseline is 137 tests passing in 18 files. Never finish a task with fewer passing.
- Book bytes must never cross the JS→Rust IPC boundary as a `Uint8Array`. Rust→JS is fine via `tauri::ipc::Response` (octet-stream).
- Every Rust command resolves caller paths through `archive.rs`'s existing `resolve()` guard. No new command may accept an absolute path.
- Any new user-visible string needs a key in **both** `src/i18n/en.ts` and `src/i18n/ar.ts`. This plan removes keys and adds none.
- Commit messages are the user's own voice: no Claude/AI attribution, no `Co-Authored-By`.
- `pnpm-workspace.yaml` is untracked and already copied into this worktree — do not commit it.
- Books already in the library must keep rendering their in-flow images with no migration step.

---

### Task 1: One indicator — delete the dock, point the FAB at the store

**Files:**
- Create: `src/store/importIndicator.ts`
- Create: `src/store/importIndicator.test.ts`
- Modify: `src/components/ImportProgress.tsx` (delete `Dock`, `DockSpinner`, `DockCheck`, `DockBang`, the `import-dock-in` keyframe, and the `minimized` branch)
- Modify: `src/store/importReporter.ts` (`failImportRun` un-minimizes)
- Modify: `src/components/Library.tsx` (drop the `importPct` prop chain; `NavFabButton` + `EmptyState` read the store)
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts` (delete three `import.progress.dock*` keys)

**Interfaces:**
- Consumes: `useImportProgress`, `isImportActive`, `setMinimized`, `type ProgressState` from `src/store/importProgress.ts`.
- Produces: `importIndicator(progress: ProgressState, localImporting: boolean): ImportIndicator` and `useImportIndicator(localImporting: boolean): ImportIndicator`, where `ImportIndicator = { busy: boolean; ratio: number | null; action: "pick" | "details" | "none" }`.

- [ ] **Step 1: Write the failing test**

Create `src/store/importIndicator.test.ts`:

```ts
// What the one remaining import indicator (the bottom-bar FAB) shows, and
// what tapping it does. Pure so it can be tested without a renderer — the
// component is a thin wrapper over this.
import { describe, expect, it } from "vitest";
import { importIndicator } from "./importIndicator";
import type { ProgressState } from "./importProgress";

function state(patch: Partial<ProgressState> = {}): ProgressState {
  return {
    active: false,
    minimized: false,
    steps: [],
    overall: 0,
    error: null,
    resultBookId: null,
    finishedAt: null,
    ...patch,
  };
}

describe("importIndicator", () => {
  it("is idle and opens the picker when nothing is running", () => {
    expect(importIndicator(state(), false)).toEqual({
      busy: false,
      ratio: null,
      action: "pick",
    });
  });

  it("spins indeterminately while the file dialog is open", () => {
    // The picker is up: the library knows it's importing, but no reporter
    // exists yet, so there is nothing to be determinate about and nothing
    // to open.
    expect(importIndicator(state(), true)).toEqual({
      busy: true,
      ratio: null,
      action: "none",
    });
  });

  it("tracks a reporting device import and offers the details modal", () => {
    expect(
      importIndicator(state({ active: true, minimized: true, overall: 0.4 }), true),
    ).toEqual({ busy: true, ratio: 0.4, action: "details" });
  });

  it("lights up for a source import the library knows nothing about", () => {
    // Store/Sources imports never touch Library's local state — this is the
    // case the deleted dock used to be the only indicator for.
    expect(
      importIndicator(state({ active: true, overall: 0.7 }), false),
    ).toEqual({ busy: true, ratio: 0.7, action: "details" });
  });

  it("goes quiet once the run finishes", () => {
    expect(
      importIndicator(state({ active: true, overall: 1, finishedAt: 123 }), false),
    ).toEqual({ busy: false, ratio: null, action: "pick" });
  });

  it("goes quiet on failure — the modal owns the error", () => {
    expect(
      importIndicator(
        state({ active: true, error: "boom", finishedAt: 123 }),
        false,
      ),
    ).toEqual({ busy: false, ratio: null, action: "pick" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/store/importIndicator.test.ts`
Expected: FAIL — `Failed to resolve import "./importIndicator"`.

- [ ] **Step 3: Write the implementation**

Create `src/store/importIndicator.ts`:

```ts
// What the single import indicator shows.
//
// There used to be two: a floating circular chip (ImportProgress's Dock,
// bottom-left under RTL) and the ring inside the bottom bar's centre FAB.
// The chip is gone; this is the FAB's brain. It reads the shared
// import-progress store rather than the library's local state so that
// source/Store imports — which never touch that state — light it up too.
//
// Reading the store here, in the leaf component, also keeps progress ticks
// from re-rendering the whole library tree: the store emits ~50 times per
// import, and Library is a large tree with a cover grid in it.

import { isImportActive, useImportProgress, type ProgressState } from "./importProgress";

export interface ImportIndicator {
  /** Render a spinner instead of the "+" glyph. */
  busy: boolean;
  /** 0..1 for a determinate ring, or null for indeterminate. */
  ratio: number | null;
  /** What a tap does. "none" while the file dialog is up — there is no run
   *  to show yet and re-opening the picker would be wrong. */
  action: "pick" | "details" | "none";
}

const IDLE: ImportIndicator = { busy: false, ratio: null, action: "pick" };

export function importIndicator(
  progress: ProgressState,
  localImporting: boolean,
): ImportIndicator {
  const reporting = isImportActive(progress);
  if (reporting) {
    return { busy: true, ratio: progress.overall, action: "details" };
  }
  // Local-only: the picker is open, or a commit is finishing after the
  // reporter already settled.
  if (localImporting) return { busy: true, ratio: null, action: "none" };
  return IDLE;
}

/** Hook form. Subscribes to the store via useSyncExternalStore. */
export function useImportIndicator(localImporting: boolean): ImportIndicator {
  return importIndicator(useImportProgress(), localImporting);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/store/importIndicator.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Delete the dock**

In `src/components/ImportProgress.tsx`:

Replace the render branch (currently lines 45-56) with:

```tsx
  if (!state.active) return null;
  // Minimized means "no chrome at all": the bottom-bar FAB is the only
  // indicator now, and tapping it un-minimizes this modal back into view.
  if (state.minimized) return null;

  return (
    <>
      <KeyframesOnce />
      <Modal theme={theme} />
    </>
  );
```

Delete the `Dock`, `DockSpinner`, `DockCheck` and `DockBang` functions (currently lines 415-572) and the `@keyframes import-dock-in` block from `KEYFRAMES`. Leave `import-pop` in place only if something still references it — it does not once `Dock` is gone, so delete `import-pop` too. Drop `setMinimized` from the import list if the file no longer calls it (the `Modal` still does, so keep it).

Delete these keys from `src/i18n/en.ts` and their counterparts in `src/i18n/ar.ts`:

```
"import.progress.dockAriaLabel"
"import.progress.dockFailedHint"
"import.progress.dockImportingHint"
```

- [ ] **Step 6: Make a failed run surface itself**

In `src/store/importReporter.ts`, a failed device import used to be reachable through the dock. Un-minimize instead so the modal carries the failed step and message:

```ts
/** Mark the run failed; the store keeps the message visible. The modal is
 *  un-minimized because the dock that used to be the way back to it is
 *  gone — a silent failure would leave the error unreachable. */
export function failImportRun(message: string): void {
  failStep(STEP_ID, message);
  setMinimized(false);
}
```

`setMinimized` is already imported in that file.

- [ ] **Step 7: Cut the `importPct` prop chain**

In `src/components/Library.tsx`, delete the `importPct` state and every prop that threads it, and let the two components that rendered it read the store instead. Sites (line numbers from the pre-edit file — search rather than trust them after the first edit):

- 183: delete `const [importPct, setImportPct] = useState<number | null>(null);`
- 670-676: `importRunner`'s `createImportReporter` callback no longer needs to push into local state — pass `() => {}`:
  ```ts
      (reporter ??= createImportReporter(
        // The store is the only consumer now: NavFabButton and EmptyState
        // subscribe to it directly, which keeps a ~50-tick import from
        // re-rendering this whole tree.
        () => {},
        tr("sidebar.importing"),
      ));
  ```
- Delete every `setImportPct(...)` call (in `runImport` and `onImportFolder`).
- Delete `importPct` from `LayoutProps` (1352), `MobileLayoutProps`/`DesktopLayout` destructuring (1474, 1884, 2782), `MobileBottomNav`'s props (2404-2405), `NavFabButtonProps` (2930), `EmptyState`'s props (3452, 3457), and every JSX pass-through (1048, 1569, 1784, 2243, 2388, 2829).

`NavFabButton` becomes:

```tsx
interface NavFabButtonProps {
  theme: Theme;
  importing: boolean;
  onClick: () => void;
}

function NavFabButton({ theme, importing, onClick }: NavFabButtonProps) {
  // The focal action — filled + slightly larger than the outlined siblings
  // (50px vs 38px) + a soft drop shadow so it reads as the primary
  // affordance. Sits flush with the bar rather than protruding above it.
  //
  // While an import is running this is the *only* progress indicator in the
  // app, so it stays tappable: a tap re-opens the stepper modal.
  const { tr } = useI18n();
  const ind = useImportIndicator(importing);
  const label = ind.busy ? tr("sidebar.importing") : tr("library.importEpub");
  return (
    <button
      onClick={ind.action === "details" ? () => setMinimized(false) : onClick}
      disabled={ind.action === "none"}
      aria-label={label}
      aria-busy={ind.busy || undefined}
      title={label}
      style={{
        width: 50,
        height: 50,
        borderRadius: 25,
        border: "none",
        background: theme.ink,
        color: theme.bg,
        cursor: ind.action === "none" ? "progress" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 3px 10px rgba(0,0,0,0.18)",
        opacity: ind.busy ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      {ind.busy ? (
        // Determinate whenever the pipeline has a real ratio — a 200 MB book
        // takes long enough that a bare spinner reads as a hang.
        <Spinner
          size={22}
          strokeWidth={2.5}
          {...(ind.ratio === null ? {} : { value: ind.ratio })}
        />
      ) : (
        <Icon name="plus" size={20} />
      )}
    </button>
  );
}
```

`EmptyState`'s button becomes:

```tsx
  const ind = useImportIndicator(importing);
  ...
      <Button
        theme={theme}
        variant="primary"
        size="md"
        onClick={onImport}
        disabled={ind.busy}
        loading={ind.busy}
        {...(ind.ratio === null ? {} : { loadingProgress: ind.ratio })}
        leadingIcon={<Icon name="plus" size={14} />}
      >
        {ind.busy ? tr("sidebar.importing") : tr("library.emptyCta")}
      </Button>
```

Add to the imports at the top of `Library.tsx`:

```ts
import { useImportIndicator } from "../store/importIndicator";
import { setMinimized } from "../store/importProgress";
```

- [ ] **Step 8: Verify the whole suite and the typechecker**

Run: `pnpm test` — expected: 143 passing (137 + 6), 0 failures.
Run: `pnpm tsc --noEmit` (or `pnpm build`) — expected: no errors. A leftover `importPct` reference anywhere shows up here.

- [ ] **Step 9: Commit**

```bash
git add src/store/importIndicator.ts src/store/importIndicator.test.ts \
        src/components/ImportProgress.tsx src/store/importReporter.ts \
        src/components/Library.tsx src/i18n/en.ts src/i18n/ar.ts
git commit -m "fix(import): one progress indicator instead of two

The floating chip and the bottom-bar ring both tracked the same import.
Delete the chip; the FAB now reads the shared progress store, so Store
imports light it up too and a tap re-opens the stepper. Progress ticks
no longer re-render the library tree."
```

---

### Task 2: Stop the parse from freezing the UI

**Files:**
- Create: `src/lib/yieldToUI.ts`
- Create: `src/lib/yieldToUI.test.ts`
- Modify: `src/epub/parser.ts` (extract the spine-item body, yield on a slice, report per chapter)
- Modify: `src/epub/parser.test.ts` (assert `onChapter`)
- Modify: `src/store/library.ts` (`ImportReporter.parseProgress`, forwarded from `commitEpubAt`)
- Modify: `src/store/importReporter.ts` (implement `parseProgress`)
- Modify: `src/components/Library.tsx` (forward `parseProgress` in the reporter literal)

**Interfaces:**
- Produces: `yieldToUI(): Promise<void>`, `createTimeSlicer(sliceMs?: number): () => Promise<void>` from `src/lib/yieldToUI.ts`.
- Produces: `parseEpubFromSource(src, id, opts?: { onChapter?(done: number, total: number): void })` — third parameter is optional, so existing callers and tests keep compiling.
- Produces: `ImportReporter.parseProgress(ratio: number): void` — **required** on the interface; both implementations are updated in this task.

- [ ] **Step 1: Write the failing test**

Create `src/lib/yieldToUI.test.ts`:

```ts
// The parse loop's only defence against freezing the webview. Both branches
// matter: Android WebView has scheduler.yield(), older WKWebView does not.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTimeSlicer, yieldToUI } from "./yieldToUI";

const g = globalThis as { scheduler?: { yield?: () => Promise<void> } };

afterEach(() => {
  delete g.scheduler;
});

describe("yieldToUI", () => {
  it("prefers scheduler.yield when the platform has it", async () => {
    const y = vi.fn(async () => {});
    g.scheduler = { yield: y };
    await yieldToUI();
    expect(y).toHaveBeenCalledTimes(1);
  });

  it("falls back to a real task boundary", async () => {
    // No scheduler: must still resolve, and must resolve from a task rather
    // than a microtask — a microtask would not let the browser paint, which
    // is the entire point.
    const order: string[] = [];
    const timer = new Promise<void>((r) =>
      setTimeout(() => {
        order.push("timeout");
        r();
      }, 0),
    );
    void Promise.resolve().then(() => order.push("microtask"));
    await yieldToUI();
    order.push("yield");
    await timer;
    expect(order[0]).toBe("microtask");
    expect(order).toContain("yield");
  });
});

describe("createTimeSlicer", () => {
  it("does not yield until the slice is spent", async () => {
    const y = vi.fn(async () => {});
    g.scheduler = { yield: y };
    const slice = createTimeSlicer(60_000);
    await slice();
    await slice();
    expect(y).not.toHaveBeenCalled();
  });

  it("yields once the slice is spent", async () => {
    const y = vi.fn(async () => {});
    g.scheduler = { yield: y };
    const slice = createTimeSlicer(0);
    await slice();
    await slice();
    expect(y).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/yieldToUI.test.ts`
Expected: FAIL — cannot resolve `./yieldToUI`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/yieldToUI.ts`:

```ts
// Handing the main thread back mid-loop.
//
// A loop whose awaits all resolve from a cache never leaves its task: a
// resolved promise is a microtask, and the browser drains every microtask
// before it paints, handles input or fires a timer. The EPUB spine loop has
// exactly that shape — `prefetchText` warms every chapter, so the 114
// `await src.readText(...)` calls that follow are free — which is why
// importing a 114-chapter book froze the app for the whole parse.

interface Scheduler {
  yield?: () => Promise<void>;
}

/** Default budget between yields. Long enough that the yields themselves
 *  cost nothing on a book of tiny chapters, short enough to stay inside one
 *  frame at 60 Hz. */
const SLICE_MS = 8;

/** Yield to the event loop. A real task boundary, not a microtask. */
export function yieldToUI(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Scheduler }).scheduler;
  // Chromium (so: Android WebView) resumes a scheduler.yield() continuation
  // ahead of freshly-queued tasks, so the parse gets the thread back as soon
  // as the browser is done with it.
  if (scheduler?.yield) return scheduler.yield();
  if (typeof MessageChannel === "function") {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Time-sliced cooperative yielding. Call the returned function every
 * iteration; it only crosses a task boundary once `sliceMs` has elapsed
 * since the last one, so a loop over thousands of cheap items doesn't pay a
 * task per item.
 */
export function createTimeSlicer(sliceMs: number = SLICE_MS): () => Promise<void> {
  let last = performance.now();
  return async () => {
    if (performance.now() - last < sliceMs) return;
    await yieldToUI();
    last = performance.now();
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/yieldToUI.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing parser test**

In `src/epub/parser.test.ts`, add to the existing `describe`:

```ts
  it("reports progress once per spine item", async () => {
    const src = await openMemoryZip(await buildFixture());
    const seen: [number, number][] = [];
    await parseEpubFromSource(src, "book-1", {
      onChapter: (done, total) => seen.push([done, total]),
    });
    // The fixture's spine has two documents; both are reported, in order,
    // and the last call lands exactly on total (the ring must reach the end
    // of the parse phase, not 1-of-2 of it).
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
```

Adjust the expected pairs if `buildFixture`'s spine length differs — read the fixture's `<spine>` and use its real `itemref` count.

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm vitest run src/epub/parser.test.ts`
Expected: FAIL — `parseEpubFromSource` takes 2 arguments (TS error) or `seen` is empty.

- [ ] **Step 7: Yield and report in the parser**

In `src/epub/parser.ts`, add the import:

```ts
import { createTimeSlicer } from "../lib/yieldToUI";
```

Add the options type next to `ParsedEpub`'s other exports:

```ts
export interface ParseOptions {
  /** Called after each spine item, whether or not it produced a chapter.
   *  `done` counts spine items, so it always reaches `total`. */
  onChapter?: (done: number, total: number) => void;
}
```

Change the signature and rewrite the spine loop. The per-item body moves into a local function so the three `continue` paths become `return null` and the progress + yield calls run for every item exactly once:

```ts
export async function parseEpubFromSource(
  src: ZipSource,
  id: string,
  opts: ParseOptions = {},
): Promise<ParsedEpub> {
```

```ts
  const imageCollector = new ImageCollector();
  const chapters: EpubChapter[] = [];

  // One spine item → a chapter, or null for the items that carry no reading
  // content (covers whose image we already counted, nav docs that snuck into
  // the spine, empty title pages).
  const parseSpineItem = async (
    idref: string,
    order: number,
  ): Promise<EpubChapter | null> => {
    const manifestItem = manifest.get(idref);
    if (!manifestItem) return null;
    const fullPath = joinPath(basePath, manifestItem.href);
    const xhtml = await src.readText(fullPath);
    if (!xhtml) return null;

    const doc = new DOMParser().parseFromString(xhtml, "application/xhtml+xml");
    // XHTML parse can fail on malformed EPUBs; fall back to HTML parsing.
    const root =
      doc.getElementsByTagName("parsererror").length > 0
        ? new DOMParser().parseFromString(xhtml, "text/html")
        : doc;

    const title =
      navTitles.get(manifestItem.href) ??
      navTitles.get(fullPath) ??
      firstHeadingText(root) ??
      `Chapter ${order + 1}`;

    const instructions = collectChapterInstructions(root);
    const items = resolveChapterItems(
      instructions,
      src,
      dirname(fullPath),
      imageCollector,
    );
    if (items.length === 0) return null;

    return {
      id: idref,
      href: manifestItem.href,
      title,
      paragraphs: items,
      order,
    };
  };

  // Yield to the event loop on an 8 ms slice. Every await in here resolves
  // from the prefetch cache, so without this the whole spine parses inside a
  // single task and the webview cannot paint, take a tap, or render the
  // progress this loop is reporting.
  const slice = createTimeSlicer();
  for (let i = 0; i < spineIds.length; i++) {
    const chapter = await parseSpineItem(spineIds[i], chapters.length);
    if (chapter) chapters.push(chapter);
    opts.onChapter?.(i + 1, spineIds.length);
    await slice();
  }
```

Delete the old `let order = 0;` declaration and the old loop it drove. `chapters.length` now supplies the `order` each kept chapter gets, which preserves the existing "gapless order" behaviour that highlight anchoring depends on.

- [ ] **Step 8: Run the parser suite**

Run: `pnpm vitest run src/epub/parser.test.ts`
Expected: PASS — the new test plus every pre-existing one (chapter order, image de-duplication, cover resolution).

- [ ] **Step 9: Thread parse progress into the reporter**

In `src/store/library.ts`, add to the `ImportReporter` interface:

```ts
  /** Fine-grained progress *within* the parse phase. Separate from
   *  `progress` because that one carries Rust's `StageProgress`, whose
   *  phases are copy/extract — parse has no native counterpart. */
  parseProgress(ratio: number): void;
```

and in `commitEpubAt`, replace the parse call:

```ts
    const { book, cover, images } = await parseEpubFromSource(src, id, {
      onChapter: (done, total) =>
        report?.parseProgress(total > 0 ? done / total : 1),
    });
```

In `src/store/importReporter.ts`, add to the returned reporter:

```ts
    parseProgress(ratio) {
      phase = "parse";
      push(fileFraction("parse", ratio));
    },
```

In `src/components/Library.tsx`'s `importRunner`, forward it alongside the others:

```ts
        phase: (p) => reporter?.phase(p),
        parseProgress: (r) => reporter?.parseProgress(r),
        progress: (p) => reporter?.progress(p),
```

- [ ] **Step 10: Verify and commit**

Run: `pnpm test` — expected: 148 passing (143 + 4 + 1), 0 failures.
Run: `pnpm tsc --noEmit` — expected: clean. Any other `ImportReporter` implementation missing `parseProgress` fails here; fix it by forwarding the same way.

```bash
git add src/lib/yieldToUI.ts src/lib/yieldToUI.test.ts src/epub/parser.ts \
        src/epub/parser.test.ts src/store/library.ts \
        src/store/importReporter.ts src/components/Library.tsx
git commit -m "perf(import): parse the spine without freezing the webview

Every await in the spine loop resolved from the prefetch cache, so a
114-chapter book parsed inside one task and the UI could not paint for
the whole phase. Yield on an 8ms slice and report per chapter, so the
ring moves through the parse instead of parking at it."
```

---

### Task 3: Extract in-flow images at read time, not at import time

**Files:**
- Create: `src/store/epubImages.ts`
- Create: `src/store/epubImages.test.ts`
- Modify: `src/store/library.ts` (`commitEpubAt` writes the manifest and stops bulk-extracting)
- Modify: `src/components/BookBody.tsx` (`useChapterImageUrls` ensures before resolving)

**Interfaces:**
- Consumes: `bookDir(id)` from `src/store/library.ts`; `EpubImageRef` (`{ href, entry, mimeType }`) from `src/epub/types.ts`.
- Produces: `IMAGE_MANIFEST = "images.json"`, `writeImageManifest(bookId: string, images: EpubImageRef[]): Promise<void>`, `ensureEpubImages(bookId: string, srcs: string[]): Promise<void>` from `src/store/epubImages.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/store/epubImages.test.ts`:

```ts
// Lazy in-flow images: the import no longer copies every image out of the
// archive (for a 206 MB illustrated book that was the entire book, written a
// second time), so the reader has to pull a chapter's images on first view.
import { beforeEach, describe, expect, it, vi } from "vitest";

let files: Record<string, string> = {};
let existing = new Set<string>();
const extracted: { path: string; items: { entry: string; dest: string }[] }[] = [];

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: async (p: string) => existing.has(p),
  readTextFile: async (p: string) => {
    const v = files[p];
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  },
  writeTextFile: async (p: string, data: string) => {
    files[p] = data;
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    if (cmd !== "zip_extract") throw new Error(`unexpected command ${cmd}`);
    extracted.push({
      path: args.path as string,
      items: args.items as { entry: string; dest: string }[],
    });
    for (const item of args.items as { dest: string }[]) existing.add(item.dest);
    return (args.items as unknown[]).map(() => true);
  },
}));

import {
  __resetImageManifestCache,
  ensureEpubImages,
  writeImageManifest,
} from "./epubImages";

const DIR = "leaflet/books/b1";

beforeEach(() => {
  files = {};
  existing = new Set();
  extracted.length = 0;
  __resetImageManifestCache();
});

async function seedManifest() {
  await writeImageManifest("b1", [
    { href: "images/img-001.png", entry: "OEBPS/Images/a.png", mimeType: "image/png" },
    { href: "images/img-002.png", entry: "OEBPS/Images/b.png", mimeType: "image/png" },
  ]);
}

describe("ensureEpubImages", () => {
  it("does nothing for a book with no manifest", async () => {
    // Every book imported before this change has its images on disk already.
    await ensureEpubImages("b1", ["images/img-001.png"]);
    expect(extracted).toEqual([]);
  });

  it("extracts only the images that are missing", async () => {
    await seedManifest();
    existing.add(`${DIR}/images/img-001.png`);
    await ensureEpubImages("b1", ["images/img-001.png", "images/img-002.png"]);
    expect(extracted).toEqual([
      {
        path: `${DIR}/book.epub`,
        items: [
          { entry: "OEBPS/Images/b.png", dest: `${DIR}/images/img-002.png` },
        ],
      },
    ]);
  });

  it("does not go back to the archive for images it already pulled", async () => {
    await seedManifest();
    await ensureEpubImages("b1", ["images/img-001.png"]);
    await ensureEpubImages("b1", ["images/img-001.png"]);
    expect(extracted).toHaveLength(1);
  });

  it("ignores srcs the manifest doesn't know", async () => {
    // Streaming books reference remote URLs and have no manifest entry.
    await seedManifest();
    await ensureEpubImages("b1", ["https://example.com/x.png"]);
    expect(extracted).toEqual([]);
  });

  it("survives a corrupt manifest", async () => {
    files[`${DIR}/${"images.json"}`] = "{not json";
    await expect(
      ensureEpubImages("b1", ["images/img-001.png"]),
    ).resolves.toBeUndefined();
    expect(extracted).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/store/epubImages.test.ts`
Expected: FAIL — cannot resolve `./epubImages`.

- [ ] **Step 3: Write the implementation**

Create `src/store/epubImages.ts`:

```ts
// In-flow images, pulled from the archive when a chapter first needs them.
//
// The import used to copy every image out of the EPUB onto disk. For an
// illustrated book that is the whole book written twice: the 206 MB test
// case spent ~206 MB on the staged copy and another ~206 MB on images, and
// ended up occupying ~412 MB for a 206 MB book.
//
// Since `books/<id>/book.epub` is kept forever anyway (it is what lets us
// re-extract a cover later), the archive is always available to extract
// from. So the import records where each image lives — `images.json`, a
// straight serialization of the parser's own EpubImageRef list — and the
// reader extracts a chapter's images the first time it renders them.
//
// Books imported before this existed have no manifest and their images
// already on disk: `ensureEpubImages` returns immediately for them, which is
// the whole migration story.

import { invoke } from "@tauri-apps/api/core";
import { BaseDirectory, exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { EpubImageRef } from "../epub/types";

const BASE = BaseDirectory.AppData;

export const IMAGE_MANIFEST = "images.json";

interface ImageManifest {
  version: 1;
  /** Stored href (`images/img-001.png`) → entry name inside book.epub. */
  entries: Record<string, string>;
}

/** `bookDir` lives in library.ts, which imports plenty; duplicating the one
 *  line it needs here keeps this module free of that dependency (and of the
 *  cycle it would create through BookBody). */
function dirFor(bookId: string): string {
  return `leaflet/books/${bookId}`;
}

/** Per-book manifest, or null when the book has none. `undefined` means "not
 *  looked up yet". */
const manifests = new Map<string, ImageManifest | null>();
/** Hrefs known to be on disk, per book — so a chapter revisit costs nothing. */
const present = new Map<string, Set<string>>();

/** Test seam. */
export function __resetImageManifestCache(): void {
  manifests.clear();
  present.clear();
}

export async function writeImageManifest(
  bookId: string,
  images: EpubImageRef[],
): Promise<void> {
  const entries: Record<string, string> = {};
  for (const img of images) entries[img.href] = img.entry;
  const manifest: ImageManifest = { version: 1, entries };
  await writeTextFile(`${dirFor(bookId)}/${IMAGE_MANIFEST}`, JSON.stringify(manifest), {
    baseDir: BASE,
  });
  manifests.set(bookId, manifest);
}

async function loadManifest(bookId: string): Promise<ImageManifest | null> {
  const cached = manifests.get(bookId);
  if (cached !== undefined) return cached;
  let manifest: ImageManifest | null = null;
  try {
    const raw = await readTextFile(`${dirFor(bookId)}/${IMAGE_MANIFEST}`, {
      baseDir: BASE,
    });
    const parsed = JSON.parse(raw) as ImageManifest;
    // A manifest we can't understand is treated as absent: the images are
    // either already on disk or genuinely unavailable, and either way
    // throwing here would blank the chapter.
    manifest = parsed && typeof parsed.entries === "object" ? parsed : null;
  } catch {
    manifest = null;
  }
  manifests.set(bookId, manifest);
  return manifest;
}

/**
 * Make sure every src in `srcs` that this book's manifest knows about exists
 * on disk. Srcs the manifest doesn't list (remote URLs from the streaming
 * reader, DOCX images, books imported before the manifest existed) are left
 * alone.
 *
 * Never throws: a failed extraction should degrade to a missing image, not
 * take the chapter down with it.
 */
export async function ensureEpubImages(
  bookId: string,
  srcs: string[],
): Promise<void> {
  if (srcs.length === 0) return;
  const manifest = await loadManifest(bookId);
  if (!manifest) return;

  const dir = dirFor(bookId);
  let onDisk = present.get(bookId);
  if (!onDisk) {
    onDisk = new Set();
    present.set(bookId, onDisk);
  }

  const wanted = srcs.filter((s) => manifest.entries[s] && !onDisk.has(s));
  if (wanted.length === 0) return;

  const missing: { entry: string; dest: string }[] = [];
  await Promise.all(
    wanted.map(async (href) => {
      const dest = `${dir}/${href}`;
      try {
        if (await exists(dest, { baseDir: BASE })) {
          onDisk.add(href);
          return;
        }
      } catch {
        // Fall through and try to extract it.
      }
      missing.push({ entry: manifest.entries[href], dest });
    }),
  );
  if (missing.length === 0) return;

  try {
    await invoke<boolean[]>("zip_extract", {
      path: `${dir}/book.epub`,
      items: missing,
      // zip_extract emits progress under this token; nothing listens for a
      // read-time extraction, and an unmatched token is ignored.
      token: `read-${bookId}`,
    });
    for (const href of wanted) onDisk.add(href);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[epubImages] extraction failed:", e);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/store/epubImages.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Stop extracting at import**

In `src/store/library.ts`, import the writer:

```ts
import { writeImageManifest } from "./epubImages";
```

and replace the bulk extract inside `commitEpubAt`:

```ts
    // In-flow images stay in the archive. Record where each one lives and
    // let the reader pull it on first view (see store/epubImages.ts) — for
    // an illustrated book, extracting here means writing the entire book a
    // second time and keeping two copies of it forever.
    if (images.length > 0) {
      await writeImageManifest(id, images);
    }
```

The cover extraction directly below it stays exactly as it is: the library grid needs it immediately and it is one small file.

- [ ] **Step 6: Ensure before resolving in the reader**

In `src/components/BookBody.tsx`, add the import:

```ts
import { ensureEpubImages } from "../store/epubImages";
```

and in `useChapterImageUrls`, ensure before mapping to asset URLs:

```ts
    let cancelled = false;
    (async () => {
      // Images live in book.epub until a chapter asks for them. This is a
      // no-op for books whose images are already on disk and for streaming
      // books, whose srcs are remote URLs.
      await ensureEpubImages(bookId, srcs);
      if (cancelled) return;
      const entries = await Promise.all(
        srcs.map(
          async (src) =>
            [src, await chapterImageSrcFor(bookId, src)] as const,
        ),
      );
      if (cancelled) return;
      setUrls(new Map(entries));
    })();
```

- [ ] **Step 7: Verify and commit**

Run: `pnpm test` — expected: 153 passing (148 + 5), 0 failures.
Run: `pnpm tsc --noEmit` — expected: clean.

```bash
git add src/store/epubImages.ts src/store/epubImages.test.ts \
        src/store/library.ts src/components/BookBody.tsx
git commit -m "perf(import): pull in-flow images when a chapter needs them

Importing an illustrated EPUB copied every image out of the archive, so a
206 MB book wrote ~412 MB and kept both copies. Record each image's zip
entry in images.json instead and extract per chapter on first view; the
archive was already being kept for cover rescans. Books imported before
this keep their on-disk images and skip the new path entirely."
```

---

### Task 4: Read PDFs through a range transport instead of loading them whole

**Files:**
- Modify: `src-tauri/src/archive.rs` (new `read_file_range` command; add `Seek`/`SeekFrom` to the `std::io` import)
- Modify: `src-tauri/src/lib.rs` (register it in `generate_handler!`)
- Create: `src/pdf/rangeSource.ts`
- Create: `src/pdf/rangeSource.test.ts`
- Modify: `src/pdf/pdfjs.ts` (`openPdfDocument` accepts a file source)
- Modify: `src/store/library.ts` (`stagePaths` hands PDFs a path, not bytes)
- Modify: `src/store/fixedImportStage.ts` (`stageFixedImport` takes a source union)
- Modify: `src/reader/fixed/PdfPageSource.ts` (`createPdfPageSource` uses the path)
- Modify: `src/components/import-harness.tsx` (call site of `stageFixedImport`)

**Interfaces:**
- Produces: `readFileRange(path: string, offset: number, length: number): Promise<Uint8Array>`, `RANGE_CHUNK: number`, `createFileRangeTransport(pdfjs, path, length, initialData)` from `src/pdf/rangeSource.ts`.
- Produces: `PdfSource = Uint8Array | { path: string; length: number }`; `openPdfDocument(source: PdfSource): Promise<PdfDoc>`.
- Produces: `stageFixedImport(source: FixedSource, filename, kind?, staged?)` where `FixedSource = { bytes: Uint8Array } | { path: string; length: number }`.

- [ ] **Step 1: Write the failing test**

Create `src/pdf/rangeSource.test.ts`:

```ts
// pdf.js pulls a PDF in slices through Rust instead of us handing it the
// whole file. A 200 MB PDF used to cost ~400 MB of JS heap at import (whole
// file read, then bytes.slice() because pdf.js may detach the buffer) and
// the same again every time the book was opened.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { path: string; offset: number; length: number }[] = [];
let fail = false;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, number | string>) => {
    if (cmd !== "read_file_range") throw new Error(`unexpected command ${cmd}`);
    if (fail) throw new Error("read failed");
    calls.push({
      path: args.path as string,
      offset: args.offset as number,
      length: args.length as number,
    });
    return new Uint8Array([1, 2, 3]).buffer;
  },
}));

import { createFileRangeTransport, readFileRange } from "./rangeSource";

/** Stand-in for pdfjs.PDFDataRangeTransport — records what the transport
 *  hands back to pdf.js. */
class FakeTransport {
  ranges: [number, Uint8Array][] = [];
  aborted = false;
  constructor(
    public length: number,
    public initialData: Uint8Array,
    public progressiveDone: boolean,
  ) {}
  onDataRange(begin: number, chunk: Uint8Array) {
    this.ranges.push([begin, chunk]);
  }
  abort() {
    this.aborted = true;
  }
  requestDataRange(_begin: number, _end: number) {
    throw new Error("abstract");
  }
}

const fakePdfjs = { PDFDataRangeTransport: FakeTransport } as never;

beforeEach(() => {
  calls.length = 0;
  fail = false;
});

describe("readFileRange", () => {
  it("asks Rust for exactly the requested slice", async () => {
    const bytes = await readFileRange("leaflet/books/b1/book.pdf", 1024, 512);
    expect(calls).toEqual([
      { path: "leaflet/books/b1/book.pdf", offset: 1024, length: 512 },
    ]);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});

describe("createFileRangeTransport", () => {
  it("turns a pdf.js range request into a file read", async () => {
    const t = createFileRangeTransport(
      fakePdfjs,
      "leaflet/books/b1/book.pdf",
      9000,
      new Uint8Array([9]),
    ) as unknown as FakeTransport;
    t.requestDataRange(100, 356);
    await vi.waitFor(() => expect(t.ranges).toHaveLength(1));
    expect(calls).toEqual([
      { path: "leaflet/books/b1/book.pdf", offset: 100, length: 256 },
    ]);
    expect(t.ranges[0][0]).toBe(100);
  });

  it("aborts the document rather than hanging when a read fails", async () => {
    // pdf.js has no error channel for a range request; a rejected read that
    // never calls onDataRange would leave it waiting forever.
    fail = true;
    const t = createFileRangeTransport(
      fakePdfjs,
      "leaflet/books/b1/book.pdf",
      9000,
      new Uint8Array([9]),
    ) as unknown as FakeTransport;
    t.requestDataRange(0, 16);
    await vi.waitFor(() => expect(t.aborted).toBe(true));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/pdf/rangeSource.test.ts`
Expected: FAIL — cannot resolve `./rangeSource`.

- [ ] **Step 3: Write the JS side**

Create `src/pdf/rangeSource.ts`:

```ts
// Feeding pdf.js a file it never holds all of.
//
// `getDocument({ data })` needs the whole PDF in JS, and openPdfDocument has
// to `slice()` it because pdf.js may detach the buffer — so a 200 MB book
// peaked at ~400 MB of webview heap, once at import and again on every
// open. On Android that is enough memory pressure to make the whole app
// crawl.
//
// pdf.js's range transport is the supported way out: it asks for byte ranges
// and we serve them from Rust, which is reading a file it already owns.

import { invoke } from "@tauri-apps/api/core";

/** Slice size we advertise to pdf.js. Small enough that a range read is a
 *  cheap invoke, large enough that a page's objects usually come in one. */
export const RANGE_CHUNK = 512 * 1024;

/** Read `length` bytes at `offset` from an app-data-relative path. The
 *  response is an octet-stream, so unlike the JS→Rust direction there is no
 *  JSON-array expansion to worry about. */
export async function readFileRange(
  path: string,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("read_file_range", {
    path,
    offset,
    length,
  });
  return new Uint8Array(buf);
}

type PdfjsModule = Pick<typeof import("pdfjs-dist"), "PDFDataRangeTransport">;
type Transport = InstanceType<typeof import("pdfjs-dist").PDFDataRangeTransport>;

/**
 * A `PDFDataRangeTransport` backed by a file under app-data.
 *
 * `progressiveDone: true` tells pdf.js not to wait for a progressive stream
 * that will never arrive — every byte comes through `requestDataRange`.
 */
export function createFileRangeTransport(
  pdfjs: PdfjsModule,
  path: string,
  length: number,
  initialData: Uint8Array,
): Transport {
  const transport = new pdfjs.PDFDataRangeTransport(length, initialData, true);
  transport.requestDataRange = (begin: number, end: number) => {
    void (async () => {
      try {
        transport.onDataRange(begin, await readFileRange(path, begin, end - begin));
      } catch (e) {
        // There is no way to report a failed range to pdf.js, and a request
        // that never completes hangs the document forever — so tear it down
        // and let the caller's catch handle it.
        // eslint-disable-next-line no-console
        console.warn("[pdf] range read failed, aborting document:", e);
        transport.abort();
      }
    })();
  };
  return transport;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/pdf/rangeSource.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the Rust command**

In `src-tauri/src/archive.rs`, widen the `std::io` import:

```rust
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
```

Add next to the other constants:

```rust
/// Ceiling on one range read. pdf.js asks in `rangeChunkSize` slices, so this
/// is a guard against a caller asking for a whole book in one response, not a
/// limit any real request approaches.
const MAX_RANGE: u64 = 16 * 1024 * 1024;
```

Add the command after `zip_read_bytes`:

```rust
/// Read `length` bytes starting at `offset` from a file under app-data.
///
/// This is what lets pdf.js open a 200 MB book without the webview ever
/// holding it: its range transport asks for slices, and we serve them from
/// the file Rust already owns. Returned through `tauri::ipc::Response` so the
/// bytes travel as an octet-stream rather than a JSON number array.
#[tauri::command]
pub async fn read_file_range<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    offset: u64,
    length: u64,
) -> Result<Response, String> {
    if length > MAX_RANGE {
        return Err(format!("range too large: {length} > {MAX_RANGE}"));
    }
    let file_path = resolve(&app, &path)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut file = File::open(&file_path)
            .map_err(|e| format!("cannot open {}: {e}", file_path.display()))?;
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| format!("seek to {offset} failed: {e}"))?;
        let mut buf = vec![0u8; length as usize];
        let mut filled = 0usize;
        // read() is allowed to return short; a partial range would corrupt
        // whatever object pdf.js is decoding, so loop to EOF or full.
        while filled < buf.len() {
            match file.read(&mut buf[filled..]) {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(e) => return Err(format!("read failed: {e}")),
            }
        }
        buf.truncate(filled);
        Ok(buf)
    })
    .await
    .map_err(|e| format!("range read task failed: {e}"))??;
    Ok(Response::new(bytes))
}
```

In `src-tauri/src/lib.rs`, add `archive::read_file_range,` to `generate_handler!` after `archive::zip_read_bytes,`.

- [ ] **Step 6: Check the Rust builds**

Run: `cd src-tauri && cargo check 2>&1 | tail -20`
Expected: `Finished` with no errors. Warnings about unused imports mean `Seek`/`SeekFrom` went to the wrong line.

- [ ] **Step 7: Teach `openPdfDocument` about file sources**

In `src/pdf/pdfjs.ts`, add the source type and the branch:

```ts
import { createFileRangeTransport, RANGE_CHUNK, readFileRange } from "./rangeSource";

/** Where a PDF's bytes come from. The path form never materializes the file
 *  in JS — see rangeSource.ts. The bytes form is for the dev harness and
 *  tests. */
export type PdfSource = Uint8Array | { path: string; length: number };

export async function openPdfDocument(source: PdfSource): Promise<PdfDoc> {
  const pdfjs = await loadPdfjs();
  const doc = await loadDocument(pdfjs, source);
  // ...rest of the existing body, unchanged
}

async function loadDocument(
  pdfjs: Awaited<ReturnType<typeof loadPdfjs>>,
  source: PdfSource,
) {
  if (source instanceof Uint8Array) {
    // Hand pdf.js its own copy — it may transfer/detach the buffer.
    return pdfjs.getDocument({ data: source.slice() }).promise;
  }
  try {
    const head = await readFileRange(
      source.path,
      0,
      Math.min(RANGE_CHUNK, source.length),
    );
    const range = createFileRangeTransport(
      pdfjs,
      source.path,
      source.length,
      head,
    );
    return await pdfjs.getDocument({
      range,
      rangeChunkSize: RANGE_CHUNK,
      // Fetch what the rendered pages need, nothing more — the point of the
      // exercise is not to pull the whole file.
      disableAutoFetch: true,
      disableStream: true,
    }).promise;
  } catch (e) {
    // Correctness beats memory: if ranges don't work on this platform, fall
    // back to the old whole-file path rather than failing the import.
    // eslint-disable-next-line no-console
    console.warn("[pdf] range transport failed, falling back to whole file:", e);
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const { BaseDirectory } = await import("@tauri-apps/plugin-fs");
    const bytes = await readFile(source.path, { baseDir: BaseDirectory.AppData });
    return pdfjs.getDocument({ data: bytes.slice() }).promise;
  }
}
```

- [ ] **Step 8: Pass paths through the import and the reader**

In `src/store/fixedImportStage.ts`, replace the `bytes` parameter with a source union:

```ts
/** Where the staged file's bytes come from. PDFs are read in slices through
 *  Rust (`{ path, length }`); DOCX still needs the whole buffer, because
 *  mammoth does. */
export type FixedSource = { bytes: Uint8Array } | { path: string; length: number };

export async function stageFixedImport(
  source: FixedSource,
  filename: string,
  kind?: "pdf" | "docx",
  staged?: StagedSource,
): Promise<FixedImportDraft> {
  const format =
    kind ?? ("bytes" in source ? detectBookFormat(source.bytes) : "pdf");
  if (format === "pdf") return stagePdf(source, filename, staged);
  if (!("bytes" in source)) {
    throw new Error("DOCX staging needs the file's bytes");
  }
  return stageDocx(source.bytes, filename, staged);
}
```

`stagePdf` takes the source, passes it straight to `openPdfDocument`, and its `commit` no longer needs `bytes`:

```ts
async function stagePdf(
  source: FixedSource,
  filename: string,
  staged?: StagedSource,
): Promise<FixedImportDraft> {
  const doc = await openPdfDocument("bytes" in source ? source.bytes : source);
```

and inside `commit`:

```ts
      return commitPdfBook({
        ...(staged
          ? { stagedPath: staged.stagedPath }
          : { bytes: "bytes" in source ? source.bytes : new Uint8Array() }),
```

The `bytes` branch of `commitPdfBook` is harness-only (the app always stages), and the harness always has bytes, so that expression is exact rather than lossy — but assert it rather than silently writing an empty file:

```ts
      const fallbackBytes = "bytes" in source ? source.bytes : null;
      if (!staged && !fallbackBytes) {
        throw new Error("cannot commit a PDF without a staged file or bytes");
      }
      return commitPdfBook({
        ...(staged ? { stagedPath: staged.stagedPath } : { bytes: fallbackBytes! }),
```

In `src/store/library.ts`'s `stagePaths`, stop reading PDFs into JS:

```ts
      if (fixed) {
        report?.phase("parse");
        // Dynamic import avoids a static library ↔ staging cycle and keeps the
        // pdf.js / mammoth toolchains out of the initial bundle.
        const { stageFixedImport } = await import("./fixedImportStage");
        // A PDF is read in slices straight off disk (pdf/rangeSource.ts), so
        // its bytes never enter the webview. DOCX still has to cross the
        // bridge — mammoth needs the whole buffer — but Rust→JS responses
        // travel as an octet-stream, so there's no JSON-array expansion.
        const source =
          fixed === "pdf"
            ? { path: stagedPath, length: staged.size }
            : { bytes: await readFile(stagedPath, { baseDir: BASE }) };
        drafts.push(
          await stageFixedImport(source, path, fixed, {
            stagedPath,
            sourceHash: staged.hash,
          }),
        );
      }
```

In `src/reader/fixed/PdfPageSource.ts`:

```ts
import { stat } from "@tauri-apps/plugin-fs";

export async function createPdfPageSource(
  book: PdfBook,
): Promise<FixedPageSource> {
  // Opening a stored PDF used to read the entire file into JS. Hand the page
  // source a path instead; pdf.js pulls the pages it renders.
  const path = `${bookDir(book.id)}/book.pdf`;
  const info = await stat(path, { baseDir: BASE });
  const doc = await openPdfDocument({ path, length: info.size });
  return createPdfPageSourceFrom(doc);
}
```

Split `createPdfPageSourceFromBytes` so both entry points share the body:

```ts
/** Build a page source from PDF bytes — used by the dev harness. */
export async function createPdfPageSourceFromBytes(
  bytes: Uint8Array,
): Promise<FixedPageSource> {
  return createPdfPageSourceFrom(await openPdfDocument(bytes));
}

async function createPdfPageSourceFrom(doc: PdfDoc): Promise<FixedPageSource> {
  // ...everything that followed `openPdfDocument` in the old function
}
```

Import `type PdfDoc` from `../../pdf/pdfjs` if it isn't already. Drop the now-unused `readFile` import if nothing else in the file uses it.

In `src/components/import-harness.tsx`, update the call to the new shape:

```ts
      const draft = await stageFixedImport({ bytes }, f.name);
```

- [ ] **Step 9: Verify and commit**

Run: `pnpm test` — expected: 156 passing (153 + 3), 0 failures.
Run: `pnpm tsc --noEmit` — expected: clean.
Run: `cd src-tauri && cargo check` — expected: clean.

```bash
git add src-tauri/src/archive.rs src-tauri/src/lib.rs src/pdf/rangeSource.ts \
        src/pdf/rangeSource.test.ts src/pdf/pdfjs.ts src/store/library.ts \
        src/store/fixedImportStage.ts src/reader/fixed/PdfPageSource.ts \
        src/components/import-harness.tsx
git commit -m "perf(pdf): read PDFs in ranges instead of loading them whole

Importing or opening a 200 MB PDF read the whole file into the webview and
then copied it again for pdf.js — ~400 MB of heap, which is what made the
app crawl on Android. Serve byte ranges from Rust through pdf.js's range
transport, with a whole-file fallback if ranges misbehave."
```

---

### Task 5: Convert DOCX off the main thread

Lowest-value change in the plan — a DOCX is rarely large — and gated on Task 6's measurement. If the measured DOCX staging block is under ~200 ms for a realistic file, skip this task and say so in the final report rather than shipping a worker nobody needs.

**Files:**
- Create: `src/docx/rawHtml.ts` (worker-safe half of `toFixedDoc`)
- Create: `src/docx/docxWorker.ts` (worker entry)
- Create: `src/docx/convertInWorker.ts` (main-thread wrapper + fallback)
- Create: `src/docx/convertInWorker.test.ts`
- Modify: `src/docx/toFixedDoc.ts` (call the wrapper, keep the DOM pass)

**Interfaces:**
- Consumes: `detectDocDirection` from `src/docx/detectDirection.ts`, `Dir` from the same.
- Produces: `RawDocx = { html: string; images: { href: string; bytes: Uint8Array }[]; dir: Dir }`; `docxToRawHtml(bytes: Uint8Array): Promise<RawDocx>` (in-thread); `docxToRawHtmlInWorker(bytes: Uint8Array): Promise<RawDocx>` (worker, falls back to in-thread).

- [ ] **Step 1: Write the failing test**

Create `src/docx/convertInWorker.test.ts`:

```ts
// The worker is best-effort: mammoth is a browser bundle and a worker has no
// document, so if constructing or running it fails we must still convert.
import { describe, expect, it, vi } from "vitest";

const inThread = vi.fn(async () => ({
  html: "<p>fallback</p>",
  images: [],
  dir: "ltr" as const,
}));
vi.mock("./rawHtml", () => ({ docxToRawHtml: inThread }));

import { docxToRawHtmlInWorker } from "./convertInWorker";

describe("docxToRawHtmlInWorker", () => {
  it("converts in-thread when the platform has no Worker", async () => {
    const saved = (globalThis as { Worker?: unknown }).Worker;
    delete (globalThis as { Worker?: unknown }).Worker;
    try {
      const raw = await docxToRawHtmlInWorker(new Uint8Array([1]));
      expect(raw.html).toBe("<p>fallback</p>");
      expect(inThread).toHaveBeenCalledOnce();
    } finally {
      if (saved) (globalThis as { Worker?: unknown }).Worker = saved;
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/docx/convertInWorker.test.ts`
Expected: FAIL — cannot resolve `./convertInWorker`.

- [ ] **Step 3: Split the conversion**

Create `src/docx/rawHtml.ts` with the first half of the current `docxToFixedDoc` — everything up to and including `mammoth.convertToHtml`, which touches no DOM:

```ts
// The worker-safe half of the DOCX pipeline: unzip, detect direction, run
// mammoth. No DOM here — the sanitize/outline pass needs DOMParser and stays
// on the main thread (see toFixedDoc.ts).

import JSZip from "jszip";
import { detectDocDirection, type Dir } from "./detectDirection";

export interface RawDocx {
  /** mammoth's HTML, unsanitized. */
  html: string;
  images: { href: string; bytes: Uint8Array }[];
  dir: Dir;
}

async function loadMammoth() {
  const m = await import("mammoth/mammoth.browser");
  return m.default;
}

function extensionFromMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "image/bmp":
      return "bmp";
    case "image/tiff":
      return "tiff";
    default:
      return "bin";
  }
}

export async function docxToRawHtml(fileBytes: Uint8Array): Promise<RawDocx> {
  // JSZip wants the underlying buffer; Tauri's readFile may hand back a view
  // over a larger buffer, so slice cleanly when it isn't exact.
  const arrayBuffer =
    fileBytes.byteOffset === 0 &&
    fileBytes.byteLength === fileBytes.buffer.byteLength
      ? (fileBytes.buffer as ArrayBuffer)
      : (fileBytes.slice().buffer as ArrayBuffer);

  const zip = await JSZip.loadAsync(arrayBuffer);
  const { dir } = await detectDocDirection(zip);

  const mammoth = await loadMammoth();
  const images: { href: string; bytes: Uint8Array }[] = [];
  let imgN = 0;
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const buffer = await image.readAsArrayBuffer();
        const bytes = new Uint8Array(buffer);
        imgN += 1;
        const href = `images/img-${String(imgN).padStart(3, "0")}.${extensionFromMime(image.contentType)}`;
        images.push({ href, bytes });
        return { src: href };
      }),
    },
  );

  return { html: result.value, images, dir };
}
```

Delete `extensionFromMime` and the mammoth/JSZip half from `toFixedDoc.ts`, which becomes:

```ts
import { docxToRawHtmlInWorker } from "./convertInWorker";

export async function docxToFixedDoc(
  fileBytes: Uint8Array,
  fallbackTitle: string,
): Promise<FixedDoc> {
  const { html: rawHtml, images, dir } = await docxToRawHtmlInWorker(fileBytes);

  // Sanitize + inject heading anchors + build the outline. DOMParser is
  // available in the webview (this runs at import time inside the app) but
  // not in a worker, which is why this half stayed here.
  const parsed = new DOMParser().parseFromString(rawHtml, "text/html");
  // ...the rest of the existing function, unchanged
}
```

Create `src/docx/docxWorker.ts`:

```ts
/// <reference lib="webworker" />
// Runs the unzip + mammoth pass off the main thread. Image buffers are
// transferred, not copied, so a picture-heavy document doesn't pay for a
// second copy on the way back.

import { docxToRawHtml } from "./rawHtml";

self.onmessage = async (e: MessageEvent<{ bytes: ArrayBuffer }>) => {
  try {
    const raw = await docxToRawHtml(new Uint8Array(e.data.bytes));
    const transfer = raw.images.map((i) => i.bytes.buffer as ArrayBuffer);
    (self as unknown as Worker).postMessage({ ok: true, raw }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
```

Create `src/docx/convertInWorker.ts`:

```ts
// Try the worker; fall back to converting in-thread.
//
// mammoth ships a browser bundle, and a worker has no `document` — if it
// turns out to need one on some platform, a failed import is a much worse
// outcome than a janky one, so every failure path lands on docxToRawHtml.

import { docxToRawHtml, type RawDocx } from "./rawHtml";

export async function docxToRawHtmlInWorker(
  bytes: Uint8Array,
): Promise<RawDocx> {
  if (typeof Worker !== "function") return docxToRawHtml(bytes);
  try {
    return await runWorker(bytes);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[docx] worker conversion failed, converting in-thread:", e);
    return docxToRawHtml(bytes);
  }
}

function runWorker(bytes: Uint8Array): Promise<RawDocx> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./docxWorker.ts", import.meta.url), {
      type: "module",
    });
    const done = (fn: () => void) => {
      worker.terminate();
      fn();
    };
    worker.onerror = (e) => done(() => reject(new Error(e.message)));
    worker.onmessage = (e: MessageEvent<{ ok: boolean; raw?: RawDocx; message?: string }>) => {
      if (e.data.ok && e.data.raw) {
        const raw = e.data.raw;
        done(() => resolve(raw));
      } else {
        done(() => reject(new Error(e.data.message ?? "worker failed")));
      }
    };
    // Copy the input: the caller (fixedImportStage) still needs its buffer
    // for the commit path.
    worker.postMessage({ bytes: bytes.slice().buffer }, []);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/docx/convertInWorker.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Verify and commit**

Run: `pnpm test` — expected: 157 passing, 0 failures.
Run: `pnpm build` — expected: clean, and the output lists a separate chunk for the worker.

```bash
git add src/docx/rawHtml.ts src/docx/docxWorker.ts src/docx/convertInWorker.ts \
        src/docx/convertInWorker.test.ts src/docx/toFixedDoc.ts
git commit -m "perf(docx): unzip and convert in a worker

mammoth and JSZip ran on the main thread, so staging a large DOCX blocked
the UI for the whole conversion. Move that half into a module worker and
transfer the image buffers back; the DOMParser sanitize pass has to stay on
the main thread, and any worker failure falls back to it."
```

---

### Task 6: Measure it on the real 206 MB book

**Files:** none (verification only; may produce a `docs/` note)

- [ ] **Step 1: Protect the real library**

The desktop app writes to the user's actual library. Copy it first and point the run at the copy — or accept that clicking through the app mutates real data. **Do not skip this.**

```bash
APPDATA="$HOME/Library/Application Support/com.leaflet.reader"
cp -R "$APPDATA" "/tmp/leaflet-appdata-backup-$(date +%s)"
du -sh "$APPDATA/leaflet/books" | cat
```

- [ ] **Step 2: Capture the before numbers**

From the **main checkout** (not this worktree), which still has the old pipeline:

```bash
cd /Users/themostafaosama/Desktop/my-work/Riwaq-reader
git stash list   # confirm nothing of ours is here
pnpm tauri dev
```

Import `/Users/themostafaosama/Downloads/لعبة العروش - الطبعة المصورة.epub`, timing it with a stopwatch, then:

```bash
ls -la "$APPDATA/leaflet/books" | tail -3        # newest book dir
du -sh "$APPDATA/leaflet/books/<newest-id>"      # expect ~410M
ls "$APPDATA/leaflet/books/<newest-id>"          # expect book.epub + images/
```

Record: wall-clock, `du` total, whether the UI accepted taps during the parse.

- [ ] **Step 3: Capture the after numbers**

```bash
cd /Users/themostafaosama/Desktop/my-work/Riwaq-reader/.claude/worktrees/perf-import-single-loader
pnpm tauri dev
```

Import the same file and repeat the measurements. Expected:

- `du -sh` of the new book dir ≈ **206M**, not ~410M;
- the directory contains `book.epub`, `book.json`, `images.json`, `cover.*` and **no `images/`**;
- wall-clock materially lower (the second 206 MB write is gone);
- the FAB ring advances during the parse and the UI still responds to taps;
- exactly one indicator on screen — no chip at the bottom corner.

- [ ] **Step 4: Prove lazy extraction actually works**

Open the imported book and page to a chapter with an illustration.

- The image renders.
- `ls "$APPDATA/leaflet/books/<id>/images"` now exists and holds only the images from chapters visited.

If an image fails to render, check the console for `[epubImages] extraction failed` and confirm `images.json` maps the href to a real entry name (`unzip -l` the source file to compare).

- [ ] **Step 5: Check a PDF still opens**

Import a PDF and open it. Watch the console for `[pdf] range transport failed` — if that appears, the range path is broken on this platform and the fallback is carrying it; that is a bug to fix, not a pass.

- [ ] **Step 6: Decide on Task 5**

Import a realistic DOCX and note how long the UI is blocked. Under ~200 ms: revert Task 5's commit and report that the worker was not warranted. Otherwise keep it.

- [ ] **Step 7: Report**

Write the before/after table into the final summary: bytes written, wall-clock, disk footprint, and whether the parse blocked. State plainly anything that did not improve.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Part 1 — delete `Dock`, kill the i18n keys, FAB reads the store, tap opens the modal | Task 1 |
| Part 1 — error visibility after the dock is gone | Task 1, Step 6 |
| 2a — `images.json`, cover still eager, `ensureEpubImages`, `BookBody` hook, no migration | Task 3 |
| 2b — `yieldToUI`, 8 ms slice, `onChapter`, `parseProgress` on the reporter | Task 2 |
| 2c — `read_file_range`, `PDFDataRangeTransport`, `openPdfDocument` source union, `stagePaths` + `createPdfPageSource` | Task 4 |
| 2d — DOCX worker with in-thread fallback | Task 5 (gated) |
| Verification — unit tests per change, real-file measurement on a copied app-data dir | Tasks 1-5 steps + Task 6 |

Not covered, deliberately: the spec's `writeBytesChunked` base64 encoding is untouched — it is bounded to 4 MB slices with an await between them, so it janks rather than freezes, and no measurement in this plan implicates it.

**Placeholder scan:** none. Every code step carries the code. Task 6 is procedural by nature (a human drives a GUI) and its steps name exact commands, paths and expected values.

**Type consistency checks:**
- `ImportIndicator` fields (`busy`, `ratio`, `action`) match between `importIndicator.ts`, its test, `NavFabButton` and `EmptyState`.
- `parseProgress(ratio: number)` is declared on `ImportReporter` (library.ts), implemented in `importReporter.ts`, and forwarded in `Library.tsx` — all three in Task 2.
- `EpubImageRef` (`href`/`entry`/`mimeType`) is what `writeImageManifest` consumes and what `parseEpubFromSource` already returns.
- `PdfSource` / `FixedSource` are distinct on purpose: `PdfSource` allows a bare `Uint8Array` (pdf.js's own shape), `FixedSource` wraps it as `{ bytes }` so `"bytes" in source` discriminates. Task 4 uses each consistently.
- `RawDocx` is produced by `rawHtml.ts` and consumed by `docxWorker.ts`, `convertInWorker.ts` and `toFixedDoc.ts`.
- Test counts are cumulative and consistent: 137 → 143 → 148 → 153 → 156 → 157.
