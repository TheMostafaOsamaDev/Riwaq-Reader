# Progress Log

A calm, minimal EPUB reader built with **Tauri v2 + React + TypeScript**. Desktop + Android. This file is the running, chronological log of what was implemented, in order.

---

## 2026-04-24 — Day 1

### Done
- Fetched the design bundle, confirmed it is a Claude Design handoff tarball.
- Extracted it to `/tmp/design-extract/e-book-reader/` and read the README, chat
  transcript, and every JSX source file.
- Identified what to implement (the app: reader, panels, library, themes) vs.
  what to skip (design-canvas wrapper, iOS status bar frame, tweaks debug panel,
  sync-conflict splash — all prototype-only chrome).
- Scaffolded a Tauri v2 + React 19 + TypeScript + Vite project with
  `cargo create-tauri-app` (pnpm package manager, react-ts template).
- Pinned the Tauri window to sensible reader defaults in `tauri.conf.json`
  (1280×820, min 720×540, resizable, proper product name/title).

### Next
- ~~Implement the design system (tokens, fonts, global CSS).~~ **Done** —
  `src/styles/tokens.ts` + `src/styles/global.css`.
- ~~Port reader-data into a TypeScript module.~~ **Done** — `src/data/book.ts`.
- ~~Build ReaderCore.~~ **Done** — `src/components/BookBody.tsx` + `Icon.tsx`.
- ~~Build the 5 panels.~~ **Done** — `src/panels/*`.
- ~~Build the desktop shell, mobile shell, and library.~~ **Done** —
  `DesktopReader.tsx`, `MobileReader.tsx` (with tap-to-toggle chrome + bottom
  sheets via `MobileSheet.tsx`), `Library.tsx`.
- **Deferred** — `pnpm tauri android init`. This host doesn't have the Android
  SDK / NDK / rustup targets installed. `docs/setup.md` walks the user through
  installing them and then running `pnpm tauri android init` once. The app
  code itself is already Android-ready: no web-only APIs, no Electron-isms,
  responsive breakpoint at 720px, safe-area-inset padding on the mobile
  chrome, and `mobile_entry_point` wired in `src-tauri/src/lib.rs`.

### Verifications
- `pnpm build` — passes clean, 237 KB JS bundle (72 KB gzipped), 1.7 KB CSS.
- `cargo check` — passes clean on the Tauri crate.
- TypeScript is strict; no `any` leaks, no suppressions.

### Decisions
- **Keep the prototype's visual vocabulary verbatim** (the tokens, color
  palettes, typography scale) but rewrite the logic idiomatically in React +
  TypeScript instead of transplanting the `Object.assign(window, …)` pattern.
- **Skip the iOS device frame.** The prototype wrapped the mobile view in a
  fake iPhone chrome for presentation; in a real Tauri app the OS provides the
  chrome, so rendering an iOS frame on Android would be absurd. The mobile
  layout adapts via `@media (max-width)` instead.
- **No design canvas.** The prototype was a Figma-style zoomable canvas
  showing every state side-by-side. The real app just needs to *be* those
  states.

---

## 2026-04-24 — Day 2 · EPUB upload & reading

### Done
- Removed the dummy book module. Content now comes from imported EPUBs.
- Added `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-fs`, `jszip`, and
  the matching Rust plugins (`tauri-plugin-dialog`, `tauri-plugin-fs`) plus
  `dialog:default` + `fs:*` permissions in `capabilities/default.json`.
- Wrote `src/epub/parser.ts` — a client-side EPUB 2/3 parser using JSZip +
  DOMParser. Handles: `META-INF/container.xml` → OPF resolution, OPF
  manifest + spine + DC metadata, EPUB 3 `nav.xhtml` TOC, EPUB 2 NCX TOC
  fallback, and per-chapter block-level paragraph extraction. Chapter
  titles come from the nav/NCX when available, first heading otherwise.
- Wrote `src/store/library.ts` — a file-backed library on top of Tauri's
  `$APPDATA/leaflet/` directory:
  - `books/<id>/book.json` — the parsed EpubBook
  - `books/<id>/state.json` — bookmarks + current chapter
  - `library.json` — index so the Library view can render without
    touching per-book files
  - Exports: `pickAndImportEpub`, `listBooks`, `loadBook`,
    `updateReadingPosition`, `saveBookmark`, `deleteBookmark`,
    `deleteBook`.
- Added `src/store/palette.ts` — deterministic OKLCH-derived 3-color
  palette from a book id so covers stay distinct without extracted
  images. (Extracting real EPUB cover art is a follow-up.)
- Rewrote `BookBody` to render a single `EpubChapter` + `chapterCount`,
  auto-stripping a duplicate chapter-title paragraph when the EPUB's
  XHTML already contains the heading.
- `Library` now loads real entries, renders an empty state ("Import your
  first EPUB"), has an Import button in both desktop and mobile layouts,
  per-card hover delete on desktop, and friendly error banners.
- `DesktopReader` + `MobileReader` take a real `book + state +
  currentChapter`, with prev/next chapter navigation (desktop also wires
  ←/→ keyboard shortcuts), a progress bar scaled to `currentChapter /
  chapterCount`, and a bookmark toggle that writes through the store.
- `TOCPanel` takes real chapters and jumps to `chapter.order`.
- `BookmarksPanel` + `HighlightsPanel` got empty states; bookmarks gain
  jump-to-chapter + delete affordances.
- `ProgressOverlay` pulls its numbers from the live book state instead
  of hardcoded strings.

### Verifications
- `pnpm build` → clean, 345 KB JS (106 KB gzipped) including JSZip.
- `cargo check` → clean with the new `tauri-plugin-dialog` +
  `tauri-plugin-fs` crates pulled in.

### Deferred (real follow-ups, not skipped-forever)
- **Inline highlights.** The paragraph model is `{ text }[]` — plain
  text only. To persist user highlights we'll need a stable offset
  scheme (paragraph index + character range, already the shape the
  `InlineHighlight` prototype used). Highlights are defined in the
  `Highlight` type and stored under `state.highlights`, but the reader
  UI doesn't yet render them inline.
- **Text selection → highlight / note creation.** Needs a small
  selection-popover component; out of scope for this pass.
- **Rich inline formatting.** We throw away `<em>`, `<strong>`, `<a>`,
  etc. during paragraph extraction. Preserving these would mean keeping
  a sanitized HTML string per paragraph (or a small AST) rather than
  plain text. Defer until highlights need it.
- **Search inside a book.** Chapter text is all in memory after load,
  so a simple `includes()` sweep will work — just no UI for it yet.

---

## 2026-04-24 — Day 2 · Cover extraction

### Done
- `parseEpub` now also returns any cover image. Detection order:
  1. EPUB 3 manifest item with `properties="cover-image"`.
  2. EPUB 2 `<meta name="cover" content="<idref>"/>` in the OPF.
  3. Filename/id heuristic (`*cover*` in a manifest item that's `image/*`).
  Cover bytes + MIME type + extension come back as `EpubCover`.
- On import, the store writes the cover to `books/<id>/cover.<ext>` and
  records `coverFile` on the index entry.
- Enabled Tauri's `assetProtocol` in `tauri.conf.json` with a scope of
  `$APPDATA/leaflet/**` (and `$APPLOCALDATA` for good measure), so the
  webview can read cover files directly via `convertFileSrc`.
- `coverSrcFor(entry)` in `store/library.ts` builds the asset URL on
  demand (with a cache-buster tied to `addedAt`).
- `Library` resolves all cover URLs up front in parallel and passes
  them through to `BookCover`.
- `BookCover` got an optional `src` prop: when set it renders the
  real image; on `onError` or when `src` is missing, it falls back to
  the existing palette + title design. The spine-shadow gradient is
  kept in both modes so the cover still reads as a book spine.

---

## 2026-04-24 — Cover extraction fix

**Problem reported:** the Continue Reading card rendered the book's title on a green gradient instead of the EPUB's actual cover image. The book in question is an Arabic fan-translated web novel (*المجلد الأول: طبيعة الشيطان لا تتغير* by Gu Zen Ren).

**Root cause:** `src/epub/parser.ts → readCover()` only accepted a manifest item as a cover when:

1. it carried `properties="cover-image"` (EPUB 3), or
2. a `<meta name="cover">` pointed at it (EPUB 2), or
3. its id/href contained `cover` AND its `media-type` started with `image/`.

That last `AND` is where the Gu Zen Ren EPUB slipped through. Many fan-translated EPUBs (and Calibre-exported ones) do one of:

- Wrap the cover image in a `cover.xhtml` page and mark that xhtml as the EPUB 2 `meta[name=cover]` target, instead of pointing directly at the image.
- Tag the cover image file with `application/octet-stream` — so `startsWith("image/")` returns false.
- Ship a `cover.xhtml` with `<svg><image xlink:href="…"></svg>` rather than a plain `<img>`.
- Declare no cover metadata at all, just put the cover image as the first manifest/spine entry.

**Fix:** `readCover()` now has multiple tiers, in order:

| Tier | Strategy |
| --- | --- |
| 1 | `properties="cover-image"` (EPUB 3) |
| 2 | `<meta name="cover">` (EPUB 2) |
| 3 | If tiers 1–2 landed on an XHTML, unwrap it — read the first `<img src>` or `<svg><image xlink:href>` inside, resolve against the wrapper's dir, match back to a manifest entry |
| 4 | Scan the first four spine items; unwrap any XHTML whose id/href looks like a cover page |
| 5 | Filename heuristic (`/cover/` in id or href) on any manifest item that *looks* like an image — judged by mime **or** by extension (`.jpg .jpeg .png .gif .webp .svg .avif`) |
| 6 | Last resort: the first image-like manifest entry |

Accepting by extension fixes the `application/octet-stream` case. Unwrapping XHTML fixes the Calibre/Sigil case.

> Note: the earlier "Cover extraction" entry above describes `readCover()` as a 3-step detection order; this entry reflects the expanded tiered version that supersedes it.

**Blast radius:** zero — existing books that already have `coverFile` set keep working exactly as before. The new paths only run when the old ones fail.

**Note for the user:** the book already in your library was imported *before* this fix, so its index entry has no `coverFile`. To see the cover:

1. Hover the card in the shelf → click the small × in the top-right to delete it, or use the Continue Reading delete path.
2. Click **+ Import EPUB** and pick the same file again.

Going forward, every new import will find the cover if the EPUB has one at all.

---

## 2026-04-24 (second pass) — Self-healing covers

**Problem:** the parser fix from the earlier pass only helps **new** imports. The book already in the library (the Gu Zen Ren one in the screenshot) was written by the old code and its index entry has no `coverFile`, so no amount of parser improvement can retroactively help it.

**Fix:** changes that make covers heal themselves from now on.

1. **`importEpubBytes` now saves `book.epub`.** The original zip lives at `$APPDATA/leaflet/books/<id>/book.epub` alongside `book.json`. Costs a few MB of disk per book but unlocks everything below.
2. **`rescanCover(id)`** — new public function. Reads the stored EPUB, re-runs the parser, writes the newly-found cover to disk, updates `coverFile` + `coverBust` on the index entry.
3. **`setCoverFromFile(id)`** — new public function. Opens the file picker for images, copies whichever one the user picks into the book dir as the cover.
4. **Auto-backfill** — `listBooks()` fires a background `backfillMissingCovers` that loops every entry without a cover and quietly calls `rescanCover` on it. No UI flash; the next `listBooks()` call shows populated covers.
5. **`coverBust` timestamp** — the index entry now stores a bump counter, and `coverSrcFor` uses it to cache-bust the asset URL. Without this, the webview would serve the stale placeholder even after we replaced the file on disk.
6. **UI affordance — `CoverFixHint`.** Only shown when a card is falling back to the placeholder; overlays two tiny pill buttons at the bottom of the cover: **Rescan** (re-runs extraction from saved EPUB) and **Set cover…** (opens the image picker). Both stop propagation so clicking them doesn't also open the book.

**For the book already in the library (pre-fix):** it has no saved `book.epub`, so `Rescan` will surface "Couldn't find a cover in the original EPUB." Use **Set cover…** to attach any image, or delete it and use Import EPUB again — the re-import will both save the zip *and* extract the cover with the new parser.

Every future book is covered either way: if the EPUB has a cover anywhere findable, the auto-backfill finds it on the next app launch; if not, **Set cover…** is a one-click escape hatch.

**Files touched in this pass:**

- `src/store/library.ts` — added `book.epub` persistence, `rescanCover`, `setCoverFromFile`, `backfillMissingCovers`, `coverBust` field.
- `src/components/Library.tsx` — added `CoverFixHint` overlay; threaded `onRescanCover` / `onSetCover` through Library → DesktopLibrary → HeroContinueCard + LibraryCard.

---

## Current architecture

- **Frontend**: React 19 + TypeScript + Vite in `src/`.
- **EPUB parser**: pure JS, in `src/epub/parser.ts`, using `jszip` + `DOMParser`. No epub.js — we chose a leaner custom parser that emits paragraph-level text.
- **Library persistence**: Tauri's `plugin-fs` writes under `$APPDATA/leaflet/books/<bookId>/`, with a top-level `library.json` index. Cover images live alongside `book.json` so the asset protocol can serve them directly.
- **Asset protocol**: `src-tauri/tauri.conf.json` exposes `$APPDATA/leaflet/**` and `$APPLOCALDATA/leaflet/**` to the webview via `convertFileSrc`. No cover ever has to be base64'd into the DOM — they load as native `<img src>`.
- **Mobile**: Tauri v2's mobile target uses the same webview bundle. The frontend branches between `DesktopReader` and `MobileReader` based on a media query in `useMediaQuery.ts`.

## File map

```
.
├── docs/                        ← this file + design/arch/setup/android notes
├── src/
│   ├── App.tsx                  # book load/unload, state wiring
│   ├── main.tsx
│   ├── components/
│   │   ├── Library.tsx          ← passes covers[id] → <BookCover src={…}>
│   │   ├── BookCover.tsx        ← renders <img> when src is truthy
│   │   ├── DesktopReader.tsx
│   │   ├── MobileReader.tsx
│   │   ├── BookBody.tsx
│   │   ├── Icon.tsx
│   │   └── MobileSheet.tsx
│   ├── epub/
│   │   ├── parser.ts            # JSZip + DOMParser EPUB 2/3 parser
│   │   └── types.ts             # EpubBook, EpubChapter
│   ├── store/
│   │   ├── library.ts           # $APPDATA-backed import/list/load; coverSrcFor uses convertFileSrc
│   │   └── palette.ts           # deterministic cover palette
│   ├── panels/                  ← PanelShell / TOC / Bookmarks / Highlights / Settings / ProgressOverlay
│   ├── hooks/                   # useTweaks, useMediaQuery
│   ├── styles/                  # tokens.ts, global.css
│   └── types/                   # reader.ts → ActivePanel, Tweaks
├── src-tauri/
│   ├── src/ (lib.rs, main.rs)
│   ├── capabilities/default.json
│   ├── icons/
│   ├── Cargo.toml
│   └── tauri.conf.json
├── index.html
├── package.json
├── tsconfig*.json
└── vite.config.ts
```

## What to run locally

```bash
pnpm install             # or npm install
pnpm tauri dev           # desktop
pnpm tauri android init  # one time, then:
pnpm tauri android dev   # android emulator / device
```

## Open follow-ups (not done this session)

- Persist original EPUB bytes on import so we can retroactively re-scan covers when the parser improves — currently a parser fix doesn't help books that were imported earlier. (Addressed in the self-healing covers pass above via `importEpubBytes` saving `book.epub`.)
- Add a dev-only "Re-scan" action on the library card's hover menu for the same purpose, as a lighter alternative. (Now shipped as `CoverFixHint`'s **Rescan** pill.)
- Tauri `android` target has never been initialized here; `src-tauri/gen/android/` doesn't exist yet. Run `pnpm tauri android init` once you're in a shell.
```
