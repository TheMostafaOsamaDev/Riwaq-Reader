# Store feature

The **Store** is the in-app browser for source-backed novel sites. It
lets the user browse a site's homepage, search it, read a novel's
detail page, stream chapters inline, or import a chapter range as an
EPUB into the library.

## Where things live

```
src/
├── components/
│   ├── Store.tsx                  # tab shell — switches Sources / Source-home / Detail / Reader
│   ├── SourcesListView.tsx        # one card per installed source
│   ├── SourceHomeView.tsx         # one source's homepage + search (type, Enter, results grid)
│   ├── searchPaging.ts            # search-result pagination: merge/dedupe cards, pick which body to show
│   ├── NovelDetailView.tsx        # one novel — header, action row, chapter search, volumes accordion
│   ├── SourceStreamReader.tsx     # streaming inline reader (no import needed)
│   ├── NovelCard.tsx              # cover-art card with thumbnail/full fallback
│   └── DownloadRangeDialog.tsx    # "download chapters X to Y" picker
├── sources/
│   ├── types.ts                   # Source interface + shared shapes
│   ├── host.ts                    # SourceHost bridge to the Rust scraper
│   ├── registry.ts                # static registry of built-in extensions
│   ├── importer.ts                # scrape → EPUB → library pipeline
│   ├── images.ts                  # thumbnail derivation + missing-cover detection
│   └── extensions/
│       ├── kolnovel.ts            # kolnovel.com (free.kolnovel.com redirects here)
│       ├── kolnovel-pro.ts        # kolnovel.com "Pro" — HTML-first chapters, PDF fallback
│       ├── kolnovel-theme.ts      # DOM parsers shared by kolnovel.ts and kolnovel-pro.ts
│       └── cenele.ts              # cenele.com (فضاء الروايات)
└── src-tauri/src/sources.rs       # source_fetch / source_fetch_bytes /
                                   # source_render_and_extract Tauri commands
```

## Files in this folder

- [`sources.md`](./sources.md) — how the Source interface works,
  including the required `search` method and the optional capability
  (`searchChapters`), and how the store UI adapts to which ones a
  source declares.
- [`offline-and-queue.md`](./offline-and-queue.md) — how source-backed
  library entries persist their snapshot, what's offline-available,
  the per-chapter download flow, the download queue, and read-state
  dimming.
- [`importer.md`](./importer.md) — the original scrape → EPUB pipeline
  (now legacy; new downloads go through the queue, not this).
- [`kolnovel.md`](./kolnovel.md) — selector + behavior notes for the
  KolNovel extension.
- [`cenele.md`](./cenele.md) — selector + behavior notes for the Cenele
  extension, including AJAX flows, nonce extraction, and the anti-
  piracy decoy stripping in chapter bodies.
