# Extensions integration — design

**Date:** 2026-09-17
**Status:** approved, pending implementation plan
**Supersedes (app side):** `2026-08-27-riwaq-extensions-design.md`, whose
"App runtime" and "Registry" sections this document replaces. That
document's extensions-repo half (contract, layout, build, publish) shipped
and is unchanged.

## Summary

Turn the reader's compiled-in source list into a runtime extension system:
the app discovers extensions from one or more repos, installs, updates and
removes them individually, and loads them from app data. In the same pass,
bring the extensions repo's catalogue up to date — refresh `cenele`, and
add two new sources, `seanovel.org` and `sunovels.com`.

## Goals

- `src/sources/extensions/` no longer exists. Every source is downloaded.
- Each installed extension can be updated on its own, and removed.
- Users can add and remove extension repos by URL.
- A Cloudflare challenge is the host's problem, not an extension's.
- Four working extensions published from the official repo.

## Non-goals

- Sandboxing extensions away from the app's origin.
- An Android session-webview transport (`sessionFetch` stays desktop-only).
- Changes to the reader, library, or download-queue subsystems.
- Publishing `@riwaq/extension-api` to a package registry.

## Background — the two repos today

**`Riwaq-Extensions` is complete and live.** It holds the contract package
(`@riwaq/extension-api`), an esbuild bundler that emits per-extension
bundles plus a SHA-256'd `dist/index.min.json`, CI that refuses a changed
extension without a version bump, and a publish workflow that appends
`dist/` to a `repo` branch served by GitHub Pages at
`https://themostafaosamadev.github.io/Riwaq-Extensions/`. Two extensions
are published there: `cenele` and `kolnovel`, both at `1.0.0`.

**The reader never consumed any of it.** `src/sources/registry.ts` is
still a static `BUILTINS` array of three compiled-in sources (`cenele`,
`kolnovel`, `kolnovel-pro`). Two properties make this migration cheaper
than it looks, and both still hold:

1. All nine `getSource(id)` call sites already null-check the result and
   surface a user-facing message. "Extension not installed" is therefore
   an already-handled state, not a new one to design.
2. `src-tauri` needs no changes. `$APPDATA/riwaq/**` is already in
   `assetProtocol.scope`, `fs:allow-appdata-{read,write,meta}-recursive`
   are already granted, `source_fetch_bytes` already downloads bundles,
   and SHA-256 is available via WebCrypto.

### The contracts have drifted, and the app's copy is ahead

| | app `src/sources/types.ts` | repo `@riwaq/extension-api` |
|---|---|---|
| `host.sessionFetch` | present | absent |
| `host.locale` | absent | present |
| `host.pdf.extractChapter` | absent | present |
| `Source.meta` | present | removed |
| `SourceMetadata.description` | `string` + `descriptionKey` | `Record<string, string>` |
| `API_VERSION` | absent | `1` |

This drift is load-bearing in both directions:

- The app's `cenele` routes **every** request through `host.sessionFetch`
  (commit `bc6467f`, "fetch cenele through a session webview"), a
  capability the contract does not have. The repo's `cenele` still calls
  plain `fetch`, which is why it is considered broken.
- Both published extensions call `host.locale`, and `kolnovel` calls
  `host.pdf.extractChapter`. The app's `createHost()` provides neither, so
  the app as it stands would load a published extension and throw on the
  first chapter.

### Field check — 2026-09-17

Run before this design was finalized; these observations set the
Cloudflare decision and the two new extensions' approach.

- **cenele.com** — a plain GET of `https://cenele.com/cont/a-sorce-s-jour/`
  with a browser User-Agent returned the real page (191 KB, `nhvNovelV2`
  present). Cloudflare's challenge script is on the page but did not gate
  the request. The block is therefore **intermittent, not absolute** — the
  transport must handle a challenge when one appears, but must not assume
  one always will.
- **seanovel.org** — Next.js, server-rendered. Novel pages at
  `/novels/<slug>`, chapters at `/novels/<slug>/chapters/<n>`. Titles and
  links are present in the initial HTML, so no JS rendering is needed.
- **sunovels.com** — Next.js, server-rendered. Novels at `/novel/<slug>`,
  plus `/library`, `/search` and a `/dev` route that may document a JSON
  API worth preferring over HTML selectors.

## Architecture

### 1. Contract reconciliation

`src/sources/extensions/` is deleted in full — `cenele.ts`, `kolnovel.ts`,
`kolnovel-pro.ts`, `kolnovel-theme.ts` and their tests. The decoy-filter
and theme logic they hold is not lost: it already lives in the repo's
copies, and anything cenele has that the repo's copy lacks is ported as
part of the cenele workstream (below) before the app's copy is removed.

`src/sources/types.ts` becomes a verbatim copy of the repo's
`packages/extension-api/src/types.ts`, with a header naming the canonical
file and the commit it was taken from.

**Vendored, not published.** The app needs only the *types*, at compile
time — the contract's runtime helpers (`parseHtml`, `absoluteUrl`, …) are
bundled into each extension by the repo's builder, not imported by the
host. Drift can therefore only ever produce a TypeScript error in the
app's own tree; it cannot produce a runtime mismatch. `apiVersion` in the
manifest is the real runtime gate. Publishing the package to a registry
would add a release step to every contract tweak and buy nothing this
integration needs.

`src/sources/host.ts` changes to match:

- **add `locale`** — read from the app's i18n, typed `"en" | "ar"`.
- **add `pdf.extractChapter`** — a thin wrapper over the existing
  `extractPdfLines` in `src/sources/pdf/pdfChapter.ts`, whose
  `ExtractedImage` / options shape already matches the contract's.
- **add the Cloudflare fallback** (below).
- **remove `sessionFetch`** — once cenele no longer calls it, nothing does.

### 2. Cloudflare as a host concern

Extensions only ever call plain `fetch` / `fetchBytes`. The host detects a
challenge response and transparently retries that one request through
`source_session_fetch`:

```
extension:      await host.fetch(url)          // plain, always
                      │
 host.fetch  ─────────┘
   ├─ 200 + real body ────────────────→ return
   └─ challenge detected
        ├─ desktop → session webview → return
        └─ android → Error("needs browser check")
```

Detection is on the response, never the URL, and **status comes first**:
the response must carry an HTTP 403 or 503 *and* an interstitial marker in
its body or headers (a `cf-mitigated` header, or a `<title>Just a
moment…</title>`-class body). A 200 is never treated as a challenge.

That ordering is not incidental. The field check found `challenge-platform`
in the body of a **successful** 200 response — it is part of Cloudflare's
always-on beacon script, not a challenge signal. Keying on that string
alone would send every single cenele request through the session webview,
which is exactly the desktop-only behaviour this design exists to avoid.

The retry happens once per request; a second challenge is a real failure
and propagates.

Three reasons this beats adding `sessionFetch` to the contract:

- The contract does not change at all, so the three extension workstreams
  are independent of the app integration **and of each other**.
- It protects every extension, present and future, not just cenele.
- Because the block is intermittent, cenele keeps working on Android for
  every request that is not actually challenged. Declaring the capability
  in the contract would instead route 100% of cenele's traffic down a
  path that is hard-dead on mobile.

The cost is honest and accepted: a genuinely challenged request fails on
Android with a clear message rather than a silent wrong result.

### 3. Extension runtime — `src/extensions/`

| Module | Responsibility |
|---|---|
| `repos.ts` | add / remove / list repos; fetch and validate `index.min.json`; cache last-good index per repo |
| `storage.ts` | app-data layout; read/write manifests, bundles and origin records |
| `install.ts` | download → verify SHA-256 → write atomically → register |
| `loader.ts` | evaluate a bundle into a factory; `apiVersion` major gate; capture load errors |
| `catalog.ts` | merge installed with available; detect per-extension updates |

On-disk layout, under the app-data root the rest of the app already uses:

```
$APPDATA/riwaq/extensions/
├── repos.json                 # [{ url, name, addedAt, lastFetchedAt }]
├── index-cache/<hash>.json    # last good index per repo
└── installed/<id>/
    ├── index.js
    ├── manifest.json
    ├── icon.png
    └── .origin.json           # { repoUrl, sha256, installedAt }
```

**Loading mechanism — spike first.** Read the bundle bytes, wrap in a
`Blob` of type `text/javascript`, `URL.createObjectURL`, dynamic
`import()`, take `mod.default`. This is the one genuinely uncertain
mechanism in the design, and it is proved on both the macOS WKWebView and
the Android WebView **before** any runtime module is built on it.
`convertFileSrc()` + `asset://` is the fallback if blob imports misbehave
on either target; `$APPDATA/riwaq/**` is already in the asset-protocol
scope, so that fallback needs no config change.

Icons render from disk via `convertFileSrc()`. `SourceIcon` already takes
an `iconUrl` prop, so no component change is needed.

### 4. Registry

`src/sources/registry.ts` is rewritten and **keeps its exact public
signatures**, so none of the nine call sites change:

```ts
export async function initExtensions(): Promise<void>  // new
export function listSources(): SourceMetadata[]
export function getSource(id: string): Source | null
export function getSourceMeta(id: string): SourceMetadata | null
export function findSourceForUrl(url: string): Source | null
```

Loading is async once at startup; every accessor stays synchronous after.
`SourceMetadata` drops `descriptionKey` — `SourcesListView`'s description
filter resolves the locale map instead. It gains `installedFrom?: string`,
the repo URL the extension was installed from, which the manager UI uses
to group installed cards by repo and to tell the user what they lose when
they remove a repo that still has extensions installed from it.

**`initExtensions()` must not gate first paint.** The app has a scar here:
a previous Android blank-launch came from `main.tsx` awaiting a filesystem
call before mounting React. The init gate therefore goes around the
*Store view* — which renders its own loading state — and never around the
React mount. A cold launch paints exactly as it does today.

**Id aliases.** Library books persist `sourceId`, and `kolnovel-pro` has
been merged into `kolnovel` upstream. The registry carries an app-side
alias table (`{ "kolnovel-pro": "kolnovel" }`) that `getSource` and
`getSourceMeta` resolve through, so existing books keep working with no
data rewrite. Aliases are app-side, never extension-declared, so a
third-party extension cannot claim another's id.

### 5. Extensions manager UI

The Store's existing `sources` view is unchanged — it lists installed
sources and is what the user browses. A new `extensions` view, reached
from the Store header, manages them:

- **Installed** — name, icon, version; **Update** on a card whose index
  entry is a higher semver; **Remove**. An "Update all" control runs the
  same per-extension path over each outdated entry.
- **Available** — everything in the merged index that is not installed,
  with **Install** and download progress.
- **Repos** — add and remove by URL. Adding shows a one-time notice that
  extensions from that repo run with the app's access. The official repo
  is pre-added and removable like any other.

  Removing a repo does **not** uninstall its extensions. They keep working
  and keep reading; they simply stop being offered updates, and the
  confirm dialog says so by name. This keeps repo removal reversible and
  non-destructive — re-adding the URL restores update checks without a
  reinstall. An extension whose origin repo is gone shows no Update
  control, and `install.ts` never silently re-resolves it against a
  different repo that happens to publish the same id.

Card states the runtime must surface: `broken` (bundle threw on load —
inline error plus Retry, Store keeps working), `apiVersion` mismatch
("Requires a newer version of Riwaq", never constructed), SHA-256 mismatch
(install refused, hash surfaced), repo unreachable (cached index plus
"last updated …"), and removing an extension a book depends on (already
safe — downloaded chapters still read offline; the confirm dialog says so).

Per `CLAUDE.md`, the `ui-ux-pro-max` skill runs before this view is built.
The structure above is information architecture and state coverage, not
visual design.

### 6. Extension workstreams

**cenele — refresh.** Port the app's newer implementation into the repo:
`nhvNovelV2` credentials (`postId`, `chaptersNonce`), the redesigned
`.nhv-novel-*` novel-page metadata, and the
`/page/<N>/?s=<q>&post_type=wp-manga` search. Convert every `sessionFetch`
call back to plain `fetch`, now that the host handles challenges.
Re-verify against the live site, refresh fixtures, bump the version.

**seanovel.org — new.** Arabic translations of Korean/Chinese/Japanese
novels. Next.js, server-rendered; static fetch and parse.

**sunovels.com — new.** Probe `/dev` for a documented JSON API and prefer
it if one exists; otherwise HTML selectors against the server-rendered
markup. Saved fixtures either way.

Each is a standard extension: `manifest.json`, `icon.png`,
`src/index.ts`, `README.md` documenting site quirks, and fixture tests.

## Work breakdown and isolation

Four worktrees, placed outside their repo directories:

| Worktree | Repo | Branch |
|---|---|---|
| runtime | Riwaq-reader | `feat/extensions-runtime` |
| cenele | Riwaq-Extensions | `fix/cenele-refresh` |
| seanovel | Riwaq-Extensions | `feat/seanovel` |
| sunovels | Riwaq-Extensions | `feat/sunovels` |

The blob-import spike runs first and alone, because a negative result
changes `loader.ts`. Everything else then proceeds in parallel: the three
extension branches touch disjoint directories and, because the contract
does not change, share no interface with the app work either.

The three extension branches each bump only their own manifest, so the
repo's version-bump CI gate is satisfied per branch regardless of merge
order. Each merge to `main` republishes the index; the app picks up
whatever is published at the time it fetches.

## Testing

**Extensions repo** — fixture tests per extension (saved HTML in, asserted
parsed shape out). CI already typechecks, validates every manifest, runs
the fixtures, and fails an extension changed without a version bump.

**App** — Vitest for: `index.min.json` schema validation, SHA-256
verification (including the mismatch-refuses-install path), semver update
detection, the installed-vs-available merge, and id-alias resolution.

**End to end** — install all four extensions from the live repo in the
desktop app and import a novel from each; one Android run confirming the
loader works and the non-cenele sources function there.

The app's test suite has a documented history of false greens, so each
test is tampered with once — break the thing it covers and confirm it goes
red — rather than trusted because it passes.

## Risks

| Risk | Mitigation |
|---|---|
| Blob-URL `import()` unsupported on a target | Spiked before anything depends on it; `asset://` fallback already in scope |
| Cenele challenged on Android | Accepted. Intermittent, so most requests succeed; failure message is explicit |
| seanovel / sunovels reshape their Next.js markup | Fixture tests pin the parse — a break is a red test, not a silent empty screen |
| A published index changes mid-integration | The app validates schema and SHA-256 and falls back to the cached index |
| Deleting the app's cenele loses an unported fix | The app's copy is removed only after its diff against the repo's copy is reconciled |
