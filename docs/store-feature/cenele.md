# Cenele — `src/sources/extensions/cenele.ts`

Site: <https://cenele.com> (فضاء الروايات)

Theme: Madara WordPress theme with a custom **novelhub** child theme.
The novelhub child theme replaces the chapter listing with a JS-driven
accordion that loads each volume over AJAX, and replaces the search
input with a live-suggest dropdown.

## Capabilities

| Method                | Supported | Endpoint |
|-----------------------|-----------|----------|
| `getHomeSections`     | ✓         | GET `/` — parse `section.nhv-section` blocks |
| `search`              | —         | site has no `/?s=<q>` results page |
| `searchSuggest`       | ✓         | GET admin-ajax `nhv_manga_suggest` |
| `getNovel`            | ✓ + AJAX  | GET `/cont/<slug>/` + POST admin-ajax `nhv_manga_single_chapters_page` per volume |
| `searchChapters`      | ✓         | POST admin-ajax `nhv_search_manga_chapters` |
| `getChapterContent`   | ✓         | static GET; decoys stripped |

## AJAX endpoints

All four custom endpoints live under `wp-admin/admin-ajax.php` and
follow the WordPress AJAX convention:

```
POST /wp-admin/admin-ajax.php
Content-Type: application/x-www-form-urlencoded
action=<NAME>&nonce=<NONCE>&… other args
```

### `nhv_manga_suggest`

GET, not POST. Used by the homepage search input for the live
dropdown.

```
?action=nhv_manga_suggest&term=<q>&nonce=<SUGGEST_NONCE>
→ { success: true, data: { items: [{title, url, thumb}, …] } }
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

WordPress generates per-session, per-action nonces. They are
embedded in inline scripts on every page render.

| Action                                | Nonce variable | Where it lives |
|---------------------------------------|----------------|----------------|
| `nhv_manga_suggest`                   | inline literal | `/cont/` page — the suggest JS does `'&nonce=' + "<HEX>"` |
| `nhv_manga_single_chapters_page` and `nhv_search_manga_chapters` | `nhvMangaSingleAjax.nonce` | every novel page — `var nhvMangaSingleAjax = {nonce:"<HEX>", manga_id:"<INT>", …}` |

The two endpoints share one nonce because they share one WP action
prefix. The suggest action's nonce is separate because it lives
behind a different WP nonce key.

We cache both: `suggestNonceCache` per source-instance (any /cont/
fetch refills it), and the chapter nonce lives inside the per-novel
`CachedNovel` entry built during `getNovel`. The suggest call has
one retry on `success: false` (re-fetches /cont/ and re-tries the
query); the chapters call doesn't retry because at the time we issue
it we have fresh nonces from the just-loaded page.

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

| Field           | Selector |
|-----------------|----------|
| Title           | `.manga-title h2` |
| Original title  | `.manga-alt-title .manga-alt-label` |
| Cover image     | `.summary_image img[src]` |
| Tags / genres   | `.nhv-genres-chips a.nhv-genre-chip` |
| Status          | `.manga-status .nhv-meta-value` |
| Meta rows       | `.manga-data > div, .manga-author, .manga-artists, .manga-type, .released-chapters, .manga-status, .manga-views` — each has `.nhv-meta-label` + `.nhv-meta-value` |
| Author          | meta row labeled `مؤلف` / `كاتب` / `author` / `writer` |
| Description     | `.nhv-synopsis-excerpt` (full synopsis loads via separate AJAX; the excerpt is enough) |
| Volume shells   | `.nhv-volume-card[data-volume]` — pre-rendered ones; if none, fall back to `meta_only=1` AJAX |
| Manga config    | inline `var nhvMangaSingleAjax = {…}` (regex-extracted) |

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
