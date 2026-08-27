# Riwaq Extensions — design

**Date:** 2026-08-27
**Status:** approved, pending implementation plan

## Summary

Move source extensions out of the app bundle into a separate repository
(`Riwaq-Extensions`), and turn them into artifacts the app downloads,
installs, updates and deletes at runtime. Unify every source behind a
single search flow: type, press Enter, get a results grid. Ship a
contributor guide so anyone can write and submit an extension.

## Goals

- An extension is a downloadable artifact, not a compiled-in module.
- The app can add an extension repo, and install / update / delete
  individual extensions from it.
- Every extension declares title, version, language and icon.
- One search interaction across all sources. No live-suggestion
  dropdowns.
- A `README.md` in the extensions repo good enough that a stranger can
  ship an extension from it.
- Anyone can host their own repo; the official one is not privileged
  beyond being pre-added.

## Non-goals

- Sandboxing extensions away from the app's origin (see *Security*).
- A declarative/DSL extension format. Real sites need real code.
- Paid, signed, or centrally-reviewed extension distribution.
- Changing the reader, library, or download-queue subsystems.

## Background — what exists today

`src/sources/` holds the subsystem: `types.ts` (the `Source` interface),
`host.ts` (the `SourceHost` bridge to Rust), `registry.ts` (a static
`BUILTINS` array), and `extensions/` (three TypeScript modules compiled
into the app bundle).

Two properties of the current code make this change cheaper than it
looks:

1. `getSource(id)` already returns `null` for an unknown id, and **all
   eight call sites null-check it** with a clear user-facing message
   (`storeConversion.ts:101`, `downloadQueue.ts:677`, `library.ts:523`,
   `library.ts:645`, and the four view components). Deleting an
   extension a book depends on is therefore already a handled state:
   downloaded chapters keep reading offline, live operations fail with
   "Source X isn't installed".
2. `src-tauri` already has everything needed. `source_fetch_bytes`
   downloads bundles, `protocol-asset` is enabled with
   `$APPDATA/leaflet/**` in scope, `@tauri-apps/plugin-fs` has app-data
   read/write, and SHA-256 is available via WebCrypto. **No Rust
   changes are required.**

`withGlobalTauri` is not set, so `window.__TAURI__` is not injected into
the webview. Extension code cannot reach Tauri IPC by ambient access.

## Field findings — 2026-08-27

Both target sites were driven live with Playwright before this design
was finalized. The findings changed two decisions, so they are recorded
here rather than left implicit.

### cenele.com

Unchanged and still correct:

- Chapter-list AJAX: action `nhv_manga_single_chapters_page`, params
  `{nonce, manga_id, volume, page, per_page, meta_only, order}`,
  response `{success, html, total, page, per_page, has_more, volumes,
  mixed}`. Verified live: 225 chapters, 50/page,
  `volumes: [{num: 0, label: "بدون مجلدات", count: 225}]`.
- Chapter-list markup: `li.wp-manga-chapter`, `.nhv-chapter-name`.
- Chapter body root `.reading-content .text-left`. The existing decoy
  filter was run against a live chapter: 15 decoy elements stripped, 65
  clean paragraphs kept, no boilerplate survivors.
- Home sections `nhv-popular` and `nhv-newreleases` parse.

Broken:

- `var nhvMangaSingleAjax` no longer exists. Replaced by
  `var nhvNovelV2 = {ajaxurl, nonce, postId, chaptersNonce, …}`. The
  chapters AJAX takes `chaptersNonce` and `postId`; the separate
  `nonce` belongs to the `nhv_novel_v2_section` tab-content action.
- **Every novel-page metadata selector returns zero nodes.** The novel
  page was redesigned into a tabbed shell. New mapping:

  | Field | Old (dead) | New |
  |---|---|---|
  | title | `.manga-title h2` | `.nhv-novel-title` |
  | original title | `.manga-alt-title .manga-alt-label` | `.nhv-novel-kicker` (strip leading `رواية `) |
  | cover | `.summary_image img` | `.nhv-novel-cover img` |
  | meta rows | `.manga-data > div` | `.nhv-novel-meta > div` (`span` = label, `strong` = value, `strong a` = url) |
  | status | `.manga-status .nhv-meta-value` | `.nhv-novel-status strong` (row identified by `is-ongoing` / `is-completed`) |
  | genres | `.nhv-genres-chips a.nhv-genre-chip` | `.nhv-novel-genres a` |
  | tags | *(merged with genres)* | `.nhv-novel-tags a` |
  | description | `.nhv-synopsis-excerpt` | `.nhv-novel-synopsis` |

New capability:

- A real search results page exists:
  `https://cenele.com/page/<N>/?s=<query>&post_type=wp-manga`
  (page 1 omits the `/page/1/` segment). 12 results per page. Cards are
  `.row.c-tabs-item__content`; title `.post-title h3.h4 > a`; cover
  `.tab-thumb img`; original title `.mg_alternative .summary-content`;
  genres `.mg_genres .summary-content a`. Next page exists when
  `.nav-links .nav-previous a` is present. This returns strictly more
  data than the suggest dropdown it replaces.
- `nhv_refresh_front_nonces` action exists for refreshing a 403'd nonce.
- A `section.nhv-gems-lb` home section (6 novels) is not currently
  parsed. Optional addition.

### kolnovel.com

- **`free.kolnovel.com` returns `301 → https://kolnovel.com/`.** The
  free mirror no longer exists. The `kolnovel` extension's
  `canHandle` tests `hostname === "free.kolnovel.com"`, which can never
  match a live URL, and the Store shows two cards for one website.
- `kolnovel.ts` builds page 2+ as `?s=<q>&paged=<N>`. That URL returns
  **HTTP 500**, as does `/page/2/?s=<q>`. KolNovel search renders every
  result on one page — `.pagination` is present but empty and no paged
  links exist — so `hasMore` must always be false.
- The site returns **HTTP 500 for broad queries**: `رواية` and `ال`
  both produce WordPress error pages, while `سيد` returns 21 results.
  Search must have a first-class error state.
- Search result parsing still works: `.listupd .maindet`, with
  `.mdinfo h2 a`, `.mdthumb img`, `.contexcerpt p`, `.mdgenre a`.
- Home sections parse: 5 usable sections via `.trendarea` (2 items),
  `.homehot` (12), `.bixbox` (24 / 5 / 10).
- `kolnovel-pro.search()` calls the autocomplete endpoint
  `ts_ac_do_search` and returns `hasMore: false` — a suggest wearing a
  `search()` costume, returning thinner data than the `?s=` page.
- A third domain `kolnovel.online` appears in "view more" links.

## Architecture

### The contract — `@riwaq/extension-api`

A single package in the extensions repo, the only thing an extension
imports. Split by authority:

- **Capabilities live on the injected `host` object**: `fetch`,
  `fetchBytes`, `renderAndExtract`, `log`, `locale`, and
  `pdf.extractChapter`. An extension can only reach the network,
  the filesystem, or heavy host-owned dependencies through `host`.
- **Pure helpers are bundled from the package**: `parseHtml`,
  `absoluteUrl`, `textOf`, `attrOf`, `sanitizeText`. These need no
  authority, so inlining them keeps the host surface small.

`pdf.extractChapter` moves onto `host` specifically because pdf.js is
too heavy to bundle per-extension and must stay a single shared
instance owned by the app.

Two existing couplings are cut:

- Extensions currently `import { makeTr } from "../../i18n"`. Replaced
  by `host.locale` (`"en" | "ar"`); extensions ship their own strings.
- `SourceMetadata.descriptionKey` referenced app i18n message keys, which
  a third-party extension cannot do. Replaced by a manifest
  manifest `description` locale map (`Record<string, string>`, e.g.
  `{ en, ar }`) resolved by `pickDescription(map, locale)`, which falls
  back to `en` and then to the first entry present.

The package carries a major version. Manifests declare `apiVersion`.
The host refuses to construct an extension whose major does not match.

### Extension layout

```
extensions/<id>/
├── manifest.json
├── icon.png          # 128×128
├── src/index.ts      # export default (host: SourceHost) => Source
├── README.md         # site quirks, selectors, gotchas
└── tests/            # fixture tests
```

```jsonc
{
  "id": "cenele",
  "name": "فضاء الروايات",
  "version": "1.0.0",
  "apiVersion": 1,
  "language": "ar",
  "baseUrl": "https://cenele.com",
  "icon": "icon.png",
  "description": { "en": "…", "ar": "…" },
  "author": "…"
}
```

### Repo index & distribution

`scripts/build.ts` bundles each extension with esbuild
(`format: esm`, `platform: browser`, `target: es2022`, `minify`), emits
`dist/<id>/{index.js,manifest.json,icon.png}`, computes a SHA-256 per
bundle, and writes `dist/index.min.json`:

```jsonc
{
  "name": "Riwaq Official Extensions",
  "apiVersion": 1,
  "extensions": [
    {
      "id": "cenele", "name": "فضاء الروايات", "version": "1.0.0",
      "apiVersion": 1, "language": "ar", "baseUrl": "https://cenele.com",
      "description": { "en": "…", "ar": "…" },
      "code": "cenele/index.js", "icon": "cenele/icon.png",
      "sha256": "…", "size": 18234
    }
  ]
}
```

`code` and `icon` are **relative to the index URL**, so a fork or mirror
works without editing any URL.

CI publishes `dist/` to a `repo` branch served by GitHub Pages at
`https://themostafaosamadev.github.io/Riwaq-Extensions/`. A PR check
builds, typechecks, runs fixture tests, validates every manifest, and
**fails if an extension's source changed without a version bump**
(compared against the manifest on the `repo` branch).

### App runtime — `src/extensions/`

| Module | Responsibility |
|---|---|
| `repos.ts` | add / remove / list repos; fetch + validate `index.min.json`; cache last-good index |
| `storage.ts` | app-data layout; read/write manifests and bundles |
| `install.ts` | download → verify SHA-256 → write atomically → register |
| `loader.ts` | evaluate a bundle into a factory; `apiVersion` gate; capture load errors |
| `catalog.ts` | merge installed + available; detect updates |

```
$APPDATA/leaflet/extensions/
├── repos.json                 # [{ url, name, addedAt, lastFetchedAt }]
├── index-cache/<hash>.json    # last good index per repo
└── installed/<id>/
    ├── index.js
    ├── manifest.json
    ├── icon.png
    └── .origin.json           # { repoUrl, sha256, installedAt }
```

**Loading mechanism.** Read the bundle bytes, wrap in a `Blob` with type
`text/javascript`, `URL.createObjectURL`, then dynamic `import()` and
take `mod.default`. Blob-URL module import behaves identically on
desktop and Android and does not depend on the asset-protocol scope.
`convertFileSrc()` + `asset://` is the fallback if blob imports
misbehave on any target.

> **Spike first.** Confirm blob-URL dynamic `import()` works in both the
> macOS WKWebView and the Android WebView before building on it. This is
> the only genuinely uncertain mechanism in the design; everything else
> is ordinary code.

Icons render from disk via `convertFileSrc()`. `SourceIcon` already
takes an `iconUrl` prop, so no component change is needed.

### Registry

`src/sources/registry.ts` is rewritten but **keeps its exact public
signatures**, so all existing call sites are untouched:

```ts
export async function initExtensions(): Promise<void>  // new; called once from App.tsx
export function listSources(): SourceMetadata[]
export function getSource(id: string): Source | null
export function getSourceMeta(id: string): SourceMetadata | null
export function findSourceForUrl(url: string): Source | null
```

Loading is async at startup; every accessor stays synchronous
afterwards. `App.tsx` gains an init gate before the Store can render.

`SourceMetadata` gains `installedFrom?: string` and drops
`descriptionKey`.

### Id aliases

Merging `kolnovel-pro` into `kolnovel` changes an id that library books
persist as `sourceId`. The registry carries a small alias table:

```ts
const ID_ALIASES: Record<string, string> = { "kolnovel-pro": "kolnovel" };
```

`getSource` and `getSourceMeta` resolve through it. Existing books keep
working with no data rewrite and no user action, and the same mechanism
covers any future rename. Aliases are app-side, not extension-declared,
so a third-party extension cannot claim another extension's id.

## Unified search

`Source.searchSuggest` is **removed** from the interface.
`Source.search(query, page)` becomes **required**.

`SourceHomeView.tsx` loses `SuggestState`, the 220 ms debounce effect,
`SUGGEST_DEBOUNCE_MS`, `SUGGEST_MIN_CHARS`, `canSuggest`, the dropdown
component and its six props, and the `onSubmitSearch` branch that opened
the first suggestion instead of searching. One flow remains: type →
Enter → results grid → optional Load more → Esc/clear returns to
sections.

`SourceSearchResult.hasMore` is currently dead — `search` is only ever
called with page 1. The unified flow wires it to a **Load more** control
that calls `search(query, page + 1)` and appends. Cenele paginates and
returns `hasMore: true`; KolNovel returns everything at once and always
returns `false`. Both are correct.

Search gains a **first-class error state**. This is not defensive
programming: kolnovel.com returns HTTP 500 for broad queries today.

## The three extensions

### cenele

- Read `nhvNovelV2` for `postId` and `chaptersNonce` instead of
  `nhvMangaSingleAjax`.
- Rewrite `parseNovelPage` against the new `.nhv-novel-*` markup per the
  table in *Field findings*. Genres and tags become separate lists.
  `status` keeps the site's own text (`.nhv-novel-status strong`) because
  `NovelDetailView` renders it verbatim as a badge; the
  `is-ongoing` / `is-completed` class only identifies which meta row it
  is.
- Implement `search()` against
  `/page/<N>/?s=<q>&post_type=wp-manga`; `hasMore` from
  `.nav-links .nav-previous a`.
- Drop `searchSuggest` and the `/cont/` suggest-nonce scrape entirely.
- Keep `getChapterContent`, the decoy filter, `getVolumeChapters`,
  `searchChapters` and the home-section parsers as they are — all
  verified working.
- Optional: parse the new `section.nhv-gems-lb` home section.

### kolnovel (merged)

`kolnovel` and `kolnovel-pro` become one extension with id `kolnovel`.

- `canHandle` accepts `kolnovel.com`, `www.kolnovel.com`,
  `free.kolnovel.com` (for URLs already saved in libraries), and
  `kolnovel.online`.
- Keep kolnovel-pro's chapter path — inline `.epcontent` HTML with the
  `ts_ln_dl_url` PDF-token fallback through `host.pdf.extractChapter`.
  It is a superset of the free mirror's.
- Replace the `ts_ac_do_search` autocomplete search with the real `?s=`
  results page. Always `hasMore: false`; never emit `paged=` or
  `/page/N/` URLs, which 500.
- `kolnovel-theme.ts` becomes a private module inside the extension
  rather than a shared app-level file.

## Security

Extension bundles are evaluated in the app's webview and receive
capability only through the injected `host`. Protection is:

1. **Integrity** — SHA-256 per bundle in the index, verified after
   download, before write. Mismatch refuses the install and says so.
2. **Explicit trust** — adding a repo shows a one-time notice that
   extensions from it run with the app's access. Per repo, not per
   extension.
3. **No ambient authority** — `@tauri-apps/*` is not in an extension's
   bundle graph, and `withGlobalTauri` is off so `window.__TAURI__` does
   not exist.
4. **Reviewability** — the official repo's PR process is the human
   control. Bundles are built by CI from reviewed source, never
   uploaded pre-built.

Worker-based isolation was considered and rejected for v1: `DOMParser`
does not exist in workers, so it would require rewriting every
extension's selector code against a bundled HTML-parser shim. It stays
open as future work.

`csp` is currently `null` in `tauri.conf.json`. Tightening it is
out of scope here, but any future CSP must permit `blob:` in
`script-src` or the loader breaks.

## Errors and edge cases

| Situation | Behaviour |
|---|---|
| Bundle throws on load | Extension marked `broken`; inline error + Retry on its card; Store keeps working |
| `apiVersion` major mismatch | Card reads "Requires a newer version of Riwaq"; never constructed |
| SHA-256 mismatch | Install refused, hash mismatch surfaced |
| Repo unreachable | Fall back to cached index, show "last updated …" |
| Offline first launch | Available list empty with Retry; Installed unaffected |
| Delete an extension a book uses | Already safe — every `getSource` caller null-checks; offline chapters still read. Delete dialog states this |
| Source returns HTTP 500 | Search error state with the message and a Retry |

## Testing

**Extensions repo.** Per-extension fixture tests: saved HTML in, asserted
parsed shape out. Cenele gets a fixture pinning the `nhvNovelV2` config
and the `.nhv-novel-*` metadata so this exact regression cannot recur
silently. Run on every PR.

**App.** Vitest (already configured) for: `index.min.json` schema
validation, SHA-256 verification, semver compare / update detection,
the installed-vs-available merge, and id-alias resolution.

## README outline

One substantial `README.md` in the extensions repo:

1. What this repo is and how Riwaq consumes it
2. For users — adding the repo URL in Store → Repos
3. For contributors:
   - prerequisites, `pnpm install`, `pnpm new-extension <id>` scaffold
   - the `Source` interface, method by method
   - manifest field reference table
   - `host` API reference
   - local testing: `pnpm dev-repo` serves `dist/` on
     `http://localhost:8787`, which you add as a repo in the app and
     iterate against live
   - rules: search is Enter-only, no suggestions; capability only via
     `host`; version bump required; 128×128 PNG icon
   - PR checklist and review policy
   - a worked end-to-end example
4. Writing fixture tests

`CONTRIBUTING.md` stays short and points at the README.

## Rollout and first run

The app ships with the official repo URL in its default `repos.json`:
`https://themostafaosamadev.github.io/Riwaq-Extensions/`. It is an
ordinary entry the user can remove, and carries no privilege beyond
being present by default.

**Fresh install.** No extensions are installed. The Store opens on the
Extensions screen with an empty *Installed* segment and the official
repo's catalogue under *Available*, so the first screen is actionable
rather than blank. Nothing executes until the user installs something.

**Upgrade from a bundled build.** Existing users have library books
whose `sourceId` is `cenele`, `kolnovel` or `kolnovel-pro`, but the
matching code no longer ships. On first run after the upgrade, the app:

1. reads the library index for distinct source-backed `sourceId`s,
2. resolves them through `ID_ALIASES`,
3. installs those extensions from the official repo in the background,
4. reports failures as a dismissible notice, not a blocking error.

This is a one-time reconciliation keyed to "a library book needs this
extension" — not a general auto-install of everything in the catalogue.
If it fails (offline, repo down), the books behave exactly as they do
today when a source is missing: downloaded chapters still read, live
operations report "Source X isn't installed", and the user can install
manually later.

## Phases

1. **Cenele hotfix in the app** — `nhvNovelV2` config, `parseNovelPage`
   rewrite, real `search()`. Unblocks the Store immediately; the work
   carries over verbatim to the port.
2. **Extensions repo** — API package, build script, CI, README, and the
   three extensions ported (kolnovel merged).
3. **App runtime** — `src/extensions/`, registry rewrite with aliases,
   first-run reconciliation, remove the bundled extensions. Blob-import
   spike first.
4. **Extensions UI** — Installed / Available / Repos, install, update,
   delete. Invoke `ui-ux-pro-max` first, per `CLAUDE.md`.
5. **Unified search** — remove `searchSuggest`, simplify
   `SourceHomeView`, wire Load more and the error state.

## Risks

- **Blob-URL dynamic import** may behave differently across WKWebView
  and Android WebView. Spiked in phase 3 before anything depends on it;
  `asset://` is the fallback.
- **Startup cost** — `initExtensions()` adds an async gate before the
  Store renders. Should be a few file reads; measure it.
- **Repo availability** — with the built-ins removed, a dead official
  repo means an empty Store on a fresh install. The cached index covers
  returning users; a fresh install genuinely needs the network.
- **Site drift** — this design does not stop sites changing. It makes
  the fix shippable without an app release, and fixture tests make the
  breakage loud.
