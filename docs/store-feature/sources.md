# Source extensions

A **Source** is the unit the store browses through. Each source knows
how to talk to one site (or one family of sites — kolnovel.com vs.
free.kolnovel.com both fall under the KolNovel extension). The
interface is in `src/sources/types.ts`.

## The two layers

```
┌──────────────────────────────────────────┐
│  React (Store UI, importer, reader)      │
│       │                                  │
│       ▼  static TS calls                 │
│  Source extension (TS, per-site)         │
│       │                                  │
│       ▼  through SourceHost              │
│  src-tauri/src/sources.rs                │
│       │                                  │
│       ▼  reqwest / WebviewWindowBuilder  │
│  the live website                        │
└──────────────────────────────────────────┘
```

Why the split:

- The **Source** lives in TypeScript so the per-site logic
  (selectors, AJAX shapes, anti-bot quirks) is reviewable and editable
  without rebuilding Rust.
- The **SourceHost** is the only thing extensions can touch — they
  can't reach Tauri APIs, the filesystem, or another extension's
  state. Adding a new extension is "write `src/sources/extensions/X.ts`
  and put it in `registry.ts`."
- The **Rust scraper** handles two things browsers can't do from a
  CORS-pinned webview: arbitrary HTTP (`source_fetch`) and headless
  JS rendering (`source_render_and_extract`, desktop only).

## The required interface

Every source must implement four methods:

```ts
interface Source {
  readonly meta: SourceMetadata;
  canHandle(url: string): boolean;
  getHomeSections(): Promise<SourceSection[]>;
  getNovel(url: string): Promise<SourceNovel>;
  getChapterContent(chapter: SourceChapter): Promise<SourceLine[]>;
}
```

`getNovel` returns the full chapter listing (`volumes[*].chapters[*]`)
but leaves `chapter.lines` empty. `getChapterContent` populates the
lines for a single chapter — text paragraphs and image URLs the
importer downloads inline. The two-step shape lets the detail view
render the volumes accordion before any chapter has been fetched.

## Optional capabilities

Methods declared optional on the interface mean **"this source may or
may not support it"**. The UI checks `typeof source.X === "function"`
to decide whether to surface the feature.

### `search(query, page) → SourceSearchResult`

Pagination-style search: takes a query, returns a result grid + a
`hasMore` flag. The store UI fires this on Enter from the search
input and renders a grid below the homepage sections.

KolNovel implements this. Cenele does not — the site has no full
search page.

### `searchSuggest(query) → NovelCard[]`

Live as-you-type suggestion search. The store UI:

- debounces calls (~220ms) so it fires once after the user stops typing
- hides them behind a `SUGGEST_MIN_CHARS` (2) threshold
- renders results as a dropdown anchored to the search input
- highlights the first suggestion and, when the source has **only**
  `searchSuggest` (no `search`), opens that first suggestion on Enter

Cenele implements this. KolNovel doesn't — keystroke-driven calls
against KolNovel's heavyweight search page would be too slow.

A source can implement both: the dropdown is the immediate feedback
loop, and Enter still drops the user into the full results grid.

### `searchChapters(novelUrl, query) → SourceChapter[]`

In-novel chapter search. The detail view shows a search input above
the volumes accordion when this is present. Search is debounced (~250ms)
and runs against the novel currently rendered.

Identity for chapter search results uses `.url`, not `.id`. Search
results often span volumes the user hasn't expanded — those chapters
don't have a stable numeric id yet, so we match by URL against the
novel's volume listing and pick up the existing id where it exists.
Search-only chapters (not present in any volume) render but aren't
clickable; that's strictly better than swallowing them.

Cenele implements this. KolNovel doesn't.

## Source identity & registry

`src/sources/registry.ts` is a static list of `{meta, factory}` pairs.
- `listSources()` returns the metadata without constructing anything
  (used by the sources panel and by the importer when it just needs
  display names).
- `getSource(id)` lazily constructs and caches the instance for the
  session. Construction is a single function call (`createXSource(host)`)
  so the per-source factory has cheap setup; any per-novel state
  belongs inside that closure.
- `findSourceForUrl(url)` walks every source's `canHandle(url)` and
  returns the first match. Used by the import-from-URL dialog.

The instance cache means caches a source keeps in its closure
(`Map<novelUrl, …>`, `let suggestNonce = null`, etc.) persist across
all calls in the session but reset on app restart.

## How the host talks to Rust

`SourceHost` is the only abstraction extensions see. Three primitives:

```ts
host.fetch(url, options?)            // static HTTP, returns { status, text, headers }
host.fetchBytes(url, options?)       // same but returns Uint8Array (cover images)
host.renderAndExtract(url, options)  // hidden webview, JS-rendered pages — DESKTOP ONLY
```

`renderAndExtract` opens a hidden `WebviewWindow`, navigates it, runs
the caller's wait-predicate + extractor script, and exfiltrates the
result via `document.title` (the only channel that crosses the
Tauri/webview boundary without registering a runtime in the page).
See `src-tauri/src/sources.rs` for the implementation and the title-
prefix protocol.

The mobile build of `renderAndExtract` is a stub that throws — Android
Tauri can't spawn a second hidden webview. Mobile-ready sources
(KolNovel, Cenele) avoid the headless path entirely by using static
fetch + AJAX endpoints.

## Adding a new extension

1. Create `src/sources/extensions/<id>.ts` exporting a
   `createXSource(host: SourceHost): Source` factory.
2. Implement the four required methods. Skip optional ones the site
   doesn't support.
3. Add a `{meta, factory}` entry to `BUILTINS` in
   `src/sources/registry.ts`.
4. Document the site's quirks in `docs/store-feature/<id>.md`.

The Tauri command surface doesn't change — `source_fetch` and friends
handle any URL. No Rust edits required.
