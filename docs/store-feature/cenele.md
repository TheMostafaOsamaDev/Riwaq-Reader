# Cenele — `src/sources/extensions/cenele.ts`

Site: <https://cenele.com> (فضاء الروايات)

Theme: Madara WordPress theme with a custom **novelhub** child theme.
The novelhub child theme replaces the chapter listing with a JS-driven
accordion that loads each volume over AJAX. Search runs through the
site's normal WordPress results page — not a live-suggest dropdown; the
app has one search interaction: type, Enter, results grid.

## Capabilities

| Method                | Supported | Endpoint |
|-----------------------|-----------|----------|
| `getHomeSections`     | ✓         | GET `/` — parse `section.nhv-section` blocks |
| `search`              | ✓         | GET `/?s=<q>&post_type=wp-manga` (page 1) or `/page/<N>/?s=<q>&post_type=wp-manga` (page N>1) — 12 results/page; `hasMore` from `.nav-links .nav-previous a` |
| `getNovel`            | ✓ + AJAX  | GET `/cont/<slug>/` + POST admin-ajax `nhv_manga_single_chapters_page` per volume |
| `searchChapters`      | ✓         | POST admin-ajax `nhv_search_manga_chapters` |
| `getChapterContent`   | ✓         | static GET; decoys stripped |

## Search

Page 1 is `GET https://cenele.com/?s=<q>&post_type=wp-manga`; page N>1
takes a `/page/<N>/` prefix in front of the same query string
(`searchUrl` in `cenele.ts`). The site returns 12 results per page.
`parseSearchPage` reads each `.row.c-tabs-item__content` row for its
title, cover, original-title subtitle ("رواية …") and genre badges, and
derives `hasMore` from the presence of `.nav-links .nav-previous a` — the
theme is RTL, so the "previous" slot holds the *older* (i.e. next) page
link, and there is no numeric pager on this template.

## AJAX endpoints

All three custom endpoints live under `wp-admin/admin-ajax.php` and
follow the WordPress AJAX convention:

```
POST /wp-admin/admin-ajax.php
Content-Type: application/x-www-form-urlencoded
action=<NAME>&nonce=<NONCE>&… other args
```

### `nhv_manga_single_chapters_page`

POST. Two modes:

**Meta-only** — discover the volume list of a novel:

```
action=nhv_manga_single_chapters_page
nonce=<CHAPTERS_NONCE>
manga_id=<POST_ID>
meta_only=1
→ { success: true, volumes: [{num, label, count}, …], mixed: bool }
```

**Volume page** — fetch one paginated slice of one volume's chapters:

```
action=nhv_manga_single_chapters_page
nonce=<CHAPTERS_NONCE>
manga_id=<POST_ID>
volume=<INT>     # 0 means "no volume"
page=<INT>       # 1-based
per_page=50
→ { success: true, html: "<li data-chapter-id=… ><a href=… >TITLE</a>…</li> …",
    page, per_page, has_more, total, volumes, mixed }
```

The HTML response is a sequence of `<li>` blocks; we parse them with
DOMParser into `SourceChapter[]`. `getNovel` paginates per volume
until `has_more === false`.

### `nhv_search_manga_chapters`

POST. In-novel chapter search — drives the chapter-search input the
detail view shows above the volumes accordion.

```
action=nhv_search_manga_chapters
nonce=<CHAPTERS_NONCE>           # same nonce as the chapters endpoint
manga_id=<POST_ID>
query=<TEXT>
limit=80
→ { success: true, items: [{id, title, title_html, url, time}, …],
    html: "<li>…</li>…" }
```

We use `items` (the structured array) rather than `html`.

## Nonces

WordPress generates per-session, per-action nonces. They are embedded
in inline scripts on every page render.

The novel page exposes `var nhvNovelV2 = {ajaxurl:"…", nonce:"<HEX>",
postId:"<INT>", chaptersNonce:"<HEX>", …}`. This replaced
`nhvMangaSingleAjax` when the site redesigned its novel page — the
`extractNovelConfig` doc comment in `cenele.ts` points here by name, so
keep this table in sync with that function. A stale version of this
contract (still describing `nhvMangaSingleAjax`) is exactly what broke
chapter fetching and caused the regression this branch fixes.

| Field                      | Belongs to | Used for |
|----------------------------|------------|----------|
| `nhvNovelV2.chaptersNonce` | `nhv_manga_single_chapters_page` and `nhv_search_manga_chapters` (they share it) | sent as `nonce` on both chapter actions |
| `nhvNovelV2.postId`        | same two actions | sent as `manga_id` |
| `nhvNovelV2.nonce`         | `nhv_novel_v2_section` (tab-content action) | **not used by this extension** — a different nonce; never send it as `chaptersNonce` |

We cache `postId` and `chaptersNonce` inside the per-novel `CachedNovel`
entry built during `getNovel`; `extractNovelConfig` re-derives both from
the novel page on a cache miss (e.g. `getVolumeChapters` called after an
app restart, before `getNovel` has re-run for this session).

## Homepage section shapes

Four section variants the homepage emits. All are
`<section class="nhv-section nhv-X">` with a heading at
`<h3 class="nhv-title">…</h3>`.

| Class           | Cards under              | Notes |
|-----------------|--------------------------|-------|
| `nhv-popular`   | `a.nhv-pitem`            | views-count `.nhv-badge`, title `.nhv-ptitle` |
| `nhv-newseries` | `article.nhv-feature`    | longer cards with description + chips |
| `nhv-manual`    | `.nhv-manual__capsule`   | author-picks capsules — no description |
| `nhv-newreleases` | `article.nhv-nrRow`    | latest-chapter rows; subtitle is the latest chapter |

Other `nhv-section` variants (theme A/B tests, ad blocks) get skipped
silently — `parseHomeSections` filters anything that returns no cards.

## Novel-page selectors

The site redesigned its novel-page markup; these are the current
selectors (see `parseNovelPage` in `cenele.ts`).

| Field           | Selector |
|-----------------|----------|
| Title           | `.nhv-novel-title` |
| Original title  | `.nhv-novel-kicker`, stripped of its leading "رواية " prefix |
| Cover image     | `.nhv-novel-cover img` |
| Genres          | `.nhv-novel-genres a` |
| Tags            | `.nhv-novel-tags a` (genres + tags are flattened into one `tags` array — the reader treats both the same way) |
| Status          | `.nhv-novel-status strong` |
| Meta rows       | `.nhv-novel-meta > div`, each `<div><span>label</span><strong>value</strong></div>` |
| Author          | meta row labeled `مؤلف` / `كاتب` / `author` / `writer` |
| Synopsis        | `.nhv-novel-synopsis` — only its `<p>` children; the container also holds an `<h2>` title repeat and a trailing `<h3>` of promo copy that must not leak into the description |
| Volume shells   | none — the redesigned page ships no volume markup; `extractVolumeShells` always returns `[]` and `getNovel` gets the canonical volume list from the `meta_only=1` AJAX call instead |
| Manga config    | inline `var nhvNovelV2 = {…}` (regex-extracted) — see Nonces above |

## Chapter-body decoy stripping

Chapter pages mix legitimate paragraphs with anti-piracy decoys
hidden by inline CSS. Detection markers used by `isDecoyElement`:

- `aria-hidden="true"` — definitive
- `data-nosnippet="true"` — definitive
- `role="presentation"` — definitive
- inline `style="position:absolute;…"` plus any of: `opacity:0`,
  `width:0`, `width:1px`, `height:0`, `height:1px`,
  `transform:scale(0.0…)`, `filter:blur`, `pointer-events:none`
- `translate="no"` **plus** one of the style markers above
  (`translate="no"` is legitimate on real text in other contexts;
  paired with the style it's a decoy)

We `.remove()` matching elements before walking paragraphs, so a real
`<p>` containing a nested decoy `<span>` is preserved with its real
text intact.

`looksLikePiracyDecoy` is a final-line keyword check for paragraphs
that slip past the structural filter — it matches on the boilerplate
"مسروقة" + "فضاء الروايات / cenele.com" combo, which is unique
enough to never hit real content. The match normalizes zero-width
joiners the decoys insert between letters.

A sample run against `chapter-0-0` (the chapter the user flagged as
"chapters with tricks") prunes 174 decoy elements and surfaces 52
clean text lines.

## URL handling

Cenele uses Arabic in path segments — percent-encoded when emitted
from AJAX and the volume HTML. `host.fetch` passes the URL through to
`reqwest` which handles the encoding correctly. We pass URLs through
`new URL(href, BASE_URL).toString()` to normalize, but **don't**
decode the path — the server expects the encoded form.

## Mobile

Cenele only uses `host.fetch` (no `renderAndExtract`), so it works
identically on desktop and Android.
