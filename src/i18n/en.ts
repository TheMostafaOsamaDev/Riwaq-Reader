// English UI catalog — the SOURCE OF TRUTH for message keys. Every key here
// MUST have an Arabic counterpart in ./ar.ts (the `Messages` type makes a
// missing key a compile error). Keys are flat + dot-namespaced.
export const en = {
  // common (reused across surfaces)
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.back": "Back",
  "common.done": "Done",
  "common.delete": "Delete",
  "common.retry": "Retry",
  "common.confirm": "Confirm",
  "common.save": "Save",
  "common.saving": "Saving…",
  // Display-time fallback for a blank `Book.author` — NEVER persist this
  // string itself into data (a UI-locale string baked into a data field
  // would freeze in whatever language was active at save time and stay
  // wrong forever after). Apply only at read-only display sites, e.g.
  // `book.author || tr(...)` in BookCover/Library — never in an editable
  // input's `value`.
  "common.unknownAuthor": "Unknown author",

  // settings panel
  "settings.title": "Reading",
  "settings.subtitle": "Appearance & typography",
  "settings.language": "Language",
  "settings.language.auto": "Auto",
  "settings.language.en": "English",
  "settings.language.ar": "العربية",
  "settings.theme": "Theme",
  "settings.theme.system": "System",
  "settings.theme.systemHint": "Follows your OS light / dark setting",
  "settings.theme.systemHintDevice": "Follows your device's light / dark setting",
  "settings.theme.light": "Light",
  "settings.theme.sepia": "Sepia",
  "settings.theme.dark": "Dark",
  "settings.theme.oled": "OLED",
  "settings.font": "Font",
  "settings.fontSize": "Font size · {n}px",
  "settings.lineHeight": "Line height · {n}",
  "settings.letterSpacing": "Letter spacing · {n}em",
  "settings.contentWidth": "Content width · {n}%",
  "settings.alignment": "Alignment",
  "settings.align.auto": "Auto",
  "settings.readingMode": "Reading mode",
  "settings.mode.paginated2": "Two pages",
  "settings.mode.paginated1": "Single page",
  "settings.mode.scroll": "Scroll",
  "settings.tapToTurn": "Tap to turn pages",
  "settings.on": "On",
  "settings.off": "Off",
  "settings.tapZoneWidth": "Tap zone width · {n}%",
  "settings.tapStride": "Tap scroll length · {n}%",
  "settings.moreOptionsHint":
    "More reading options (font, size, line height) live inside the reader's Settings panel.",

  // app-root
  "app.loadingBook": "Loading book…",
  "panel.close": "Close panel",

  // library sidebar
  "sidebar.searchLibrary": "Search library",
  "sidebar.main": "Main",
  "sidebar.library": "Library",
  "sidebar.reading": "Reading",
  "sidebar.finished": "Finished",
  "sidebar.wishlist": "Wishlist",
  "sidebar.store": "Store",
  "sidebar.shelves": "Shelves",
  "sidebar.newShelf": "New shelf",
  "sidebar.downloads": "Downloads",
  "sidebar.settings": "Settings",
  "sidebar.importBook": "Import book",
  "sidebar.importing": "Importing…",
  "sidebar.moreImport": "More import options",
  "sidebar.folderOfEpubs": "Folder of EPUBs",
  "sidebar.wordDoc": "Word document",
  "sidebar.expand": "Expand {name}",
  "sidebar.collapse": "Collapse {name}",
  "sidebar.doubleClickExpand": "Double-click to expand",
  "sidebar.doubleClickCollapse": "Double-click to collapse",

  // library home (shelf grid, hero, tabs, empty/error states, mobile nav)
  "library.loading": "Loading your library…",
  "library.loadingShort": "Loading…",
  "library.yourShelf": "Your shelf",
  "library.currentlyReading": "Currently reading",
  "library.shelf": "Shelf",
  "library.bookCountOne": "{n} book · sorted by recent",
  "library.bookCountOther": "{n} books · sorted by recent",
  "library.continueReading": "Continue reading",
  "library.continue": "Continue",
  "library.startReading": "Start reading",
  "library.byAuthorChapters": "by {author} · {n} chapters",
  "library.chaptersAgo": "{n} chapters · {rel}",
  "library.justNow": "just now",
  "library.minAgo": "{n}m ago",
  "library.hourAgo": "{n}h ago",
  "library.dayAgo": "{n}d ago",
  "library.weekAgo": "{n}w ago",
  "library.monthAgo": "{n}mo ago",
  "library.resumeReadingCta": "Resume reading →",
  "library.startReadingCta": "Start reading →",
  "library.editDetails": "Edit details",
  "library.removeFromLibrary": "Remove from library",
  "library.emptyTitle": "Your shelf is empty",
  "library.emptyBody":
    "Import an EPUB to start reading. Riwaq parses it locally — no uploads, no accounts.",
  "library.emptyCta": "Import your first EPUB",
  "library.emptyReading": "No books marked as reading yet.",
  "library.emptyFinished": "No finished books yet.",
  "library.emptyWishlist": "Nothing on your wishlist yet.",
  "library.emptyGeneric": "Nothing here.",
  "library.setStatusHint": "Right-click a book to set its status.",
  "library.newBadge": "New",
  "library.newBadgeAriaLabel": "New — not started yet",
  "library.importFailedPrefix": "Import failed:",
  "library.removeConfirmTitle": "Remove from library?",
  "library.removeConfirmSuffix":
    "will be removed from your library, including its reading progress. This can't be undone.",
  "library.remove": "Remove",
  "library.backToLibrary": "Back to library",
  "library.openStore": "Open store",
  "library.openDownloads": "Open downloads",
  "library.importWordDoc": "Import Word document",
  "library.importEpub": "Import EPUB",
  "library.scrollTabsLeft": "Scroll tabs left",
  "library.scrollTabsRight": "Scroll tabs right",

  // shelves page + new-shelf dialog
  "shelves.title": "Shelves",
  "shelves.countOne": "{n} shelf · your collections",
  "shelves.countOther": "{n} shelves · your collections",
  "shelves.newShelf": "New shelf",
  "shelves.empty": "No shelves yet",
  "shelves.emptyHint": "Create a shelf to group books your way.",
  "shelves.zeroBooks": "0 books",
  "shelves.sectionEmpty": "No books in this shelf yet.",
  "shelves.dialogHint": "Name a collection. You can add books to it later.",
  "shelves.namePlaceholder": "e.g. Favorites, Summer reads…",
  "shelves.duplicateName": "A shelf with that name already exists.",
  "shelves.create": "Create shelf",

  // reader chrome (desktop + mobile toolbars, chapter progress, mobile sheet)
  "reader.backToLibrary": "Back to library",
  "reader.prevChapter": "Previous chapter",
  "reader.nextChapter": "Next chapter",
  "reader.chapterProgress": "Chapter progress",
  "reader.toc": "Table of contents",
  "reader.highlights": "Highlights",
  "reader.progress": "Progress",
  "reader.settings": "Settings",
  "reader.chapterOfTotal": "Chapter {n} of {total}",
  "reader.chapterDash": "Chapter {n} — {title}",
  "reader.keepScrollingNext": "Keep scrolling for next chapter",
  "reader.keepScrollingPrev": "Keep scrolling for previous chapter",
  "reader.hideProgressBar": "Hide progress bar",
  "reader.showProgressBar": "Show progress bar",
  "reader.readingSettings": "Reading settings",
  "reader.readingProgress": "Reading progress",

  // TOC panel (reuses reader.toc for its own title — see PanelShell usage)
  "toc.searchChapters": "Search chapters",
  "toc.clearSearch": "Clear search",
  "toc.noMatches": "No chapters match “{term}”.",
  "toc.now": "Now",

  // Highlights panel
  "highlights.title": "Highlights",
  "highlights.subtitleNone": "None yet",
  "highlights.subtitleCountOne": "{n} in this book",
  "highlights.subtitleCountOther": "{n} in this book",
  "highlights.emptyTitle": "No highlights yet",
  "highlights.emptyBody":
    "Select text while reading to highlight it, then add a note to remember why it mattered.",
  "highlights.chapterLabel": "Chapter {n}",
  "highlights.addNote": "Add note",
  "highlights.editNote": "Edit note",
  "highlights.notePlaceholder": "Note…",
  "highlights.actions": "Highlight actions",
  "highlights.delete": "Delete highlight",

  // Progress overlay (heading reuses reader.readingProgress)
  "progress.ofBook": "of book",
  "progress.chapterOfTotal": "chapter {n} of {total}",
  "progress.chaptersLeft": "{n} left",

  // search overlay (⌘K / Ctrl-K command palette)
  "search.placeholder": "Search books, authors…",
  "search.results": "Results",
  "search.noMatches": "No matches — filter the shelf for “{term}”",
  "search.recentSearches": "Recent searches",
  "search.clearHistory": "Clear history",
  "search.removeRecent": "Remove {term}",
  "search.jumpTo": "Jump to",

  // edit-book modal
  "dialog.editBook.ariaLabel": "Edit book details",
  "dialog.editBook.title": "Edit book",
  "dialog.editBook.subtitle": "Title, author, description, and cover",
  "dialog.editBook.replaceCover": "Replace cover…",
  "dialog.editBook.rescanCover": "Rescan from EPUB",
  "dialog.editBook.fieldTitle": "Title",
  "dialog.editBook.fieldAuthor": "Author",
  "dialog.editBook.fieldDescription": "Description",

  // docx import-choice modal
  "import.choice.title": "Import a Word document",
  "import.choice.subtitle": "How would you like to handle this document?",
  "import.choice.directTitle": "Add directly to library",
  "import.choice.directDesc":
    "Convert and import as-is. The first image becomes the cover.",
  "import.choice.manageTitle": "Manage before importing",
  "import.choice.manageDesc":
    "Pick the cover, trim pages, and review images before adding.",

  // docx import-progress modal/dock
  "import.progress.titleFailed": "Import failed",
  "import.progress.titleComplete": "Import complete",
  "import.progress.titleImporting": "Importing document",
  "import.progress.continueInBackground": "Continue in background",
  "import.progress.dismiss": "Dismiss",
  "import.progress.addedToLibrary": "Added to your library.",
  "import.progress.staysRunning": "Stays running if you close this.",
  "import.progress.dockAriaLabel": "Open import progress",
  "import.progress.dockFailedHint": "Import failed — click to view",
  "import.progress.dockImportingHint": "Importing — click to view",

  // download-range dialog (source-backed novels)
  "downloads.range.title": "Download a chapter range",
  "downloads.range.body":
    "Pick the first and last chapter to include. Chapters are queued for download and show up in the downloads panel — already-downloaded chapters are skipped.",
  "downloads.range.loading": "Loading chapter list…",
  "downloads.range.preloadLabel": "Loading every volume's chapters…",
  "downloads.range.volumeLoadError":
    'Volume "{title}" couldn\'t be loaded — {error}. Range can still target loaded volumes.',
  "downloads.range.needsLibrary":
    "This range download requires the novel to be in your library first.",
  "downloads.range.from": "From",
  "downloads.range.to": "To",
  "downloads.range.queueCountOne":
    "{n} chapter will be queued for download{extra}.",
  "downloads.range.queueCountOther":
    "{n} chapters will be queued for download{extra}.",
  "downloads.range.alreadyOnDisk": " ({n} already on disk)",
  "downloads.range.loadingVolumes": "Loading volumes…",
  "downloads.range.nothingToDownload": "Nothing to download",
  "downloads.range.queueButton": "Queue {n}",

  // save-as-offline-book dialog
  "downloads.saveOffline.title": "Save as offline book",
  "downloads.saveOffline.loading": "Loading volume listing…",
  "downloads.saveOffline.readError":
    "Couldn't read this novel's snapshot. Try reopening it from the library and try again.",
  "downloads.saveOffline.description":
    "Bakes the novel into a standalone EPUB that lives in your library alongside imported books. Chapters that aren't downloaded yet will be fetched on the fly during conversion. The original entry in your library stays put.",
  "downloads.saveOffline.singleTitle": "Save as one book",
  "downloads.saveOffline.singleDetail":
    "Volumes become sections inside a single EPUB. Best when you read on a tablet or e-reader and prefer one big file.",
  "downloads.saveOffline.perVolumeTitle": "Save each volume as its own book",
  "downloads.saveOffline.perVolumeDetailOne":
    "Creates {n} separate EPUB in your library, one per volume. Better for novels with many volumes; you can read one at a time and finish it cleanly.",
  "downloads.saveOffline.perVolumeDetailOther":
    "Creates {n} separate EPUBs in your library, one per volume. Better for novels with many volumes; you can read one at a time and finish it cleanly.",
  "downloads.saveOffline.onlyOneVolume": "This novel only has one volume.",
  "downloads.saveOffline.volumesCountOne": "{n} volume",
  "downloads.saveOffline.volumesCountOther": "{n} volumes",
  "downloads.saveOffline.chaptersCountOne": "{n} chapter",
  "downloads.saveOffline.chaptersCountOther": "{n} chapters",
  "downloads.saveOffline.alreadyDownloaded": "{n} already downloaded",
  "downloads.saveOffline.volumesNotLoadedOne":
    "{n} volume not loaded — open the detail view first",
  "downloads.saveOffline.volumesNotLoadedOther":
    "{n} volumes not loaded — open the detail view first",

  // download queue view (Downloads dialog)
  "downloads.emptyState":
    'No downloads yet. Tap the download icon on any chapter to save it offline, or use "Save as offline book" from a novel\'s detail page to bake it into your library.',
  "downloads.sectionInterrupted": "Interrupted",
  "downloads.retryAll": "Retry all",
  "downloads.sectionSavingOffline": "Saving as offline book",
  "downloads.sectionDownloading": "Downloading chapters",
  "downloads.sectionRecent": "Recent",
  "downloads.cancelDownload": "Cancel download",
  "downloads.interruptedOne": "{n} interrupted",
  "downloads.interruptedOther": "{n} interrupted",
  "downloads.activeCountOne": "{n} in progress",
  "downloads.activeCountOther": "{n} in progress",
  "downloads.allCaughtUp": "All caught up",
  "downloads.clearCompleted": "Clear completed",
  "downloads.statusWaiting": "Waiting…",
  "downloads.statusSavedOne": "Saved {n} book",
  "downloads.statusSavedOther": "Saved {n} books",
  "downloads.statusDownloaded": "Downloaded",
  "downloads.statusFailed": "Failed: {error}",
  "downloads.unknownError": "unknown error",
  "downloads.statusCancelled": "Cancelled",
  "downloads.statusInterruptedPartialOne":
    "Interrupted — {n} book already saved",
  "downloads.statusInterruptedPartialOther":
    "Interrupted — {n} books already saved",
  "downloads.statusInterruptedResume": "Interrupted — tap Retry to resume",

  // store — sources list + a source's home (browse/search its homepage)
  "store.title": "Sources",
  "store.subtitle":
    "Browse novels from supported websites, then add them to your library or stream them inline.",
  "store.noSources": "No sources installed yet.",
  "store.backToSources": "Back to sources",
  "store.searchPlaceholder": "Search…",
  "store.searching": "Searching…",
  "store.suggestError": "Couldn't load suggestions — {error}",
  "store.noSuggestMatches": "No matches for “{query}”.",
  "store.loadSourceError": "Couldn't load this source — {error}",
  "store.noSections": "No sections found.",
  "store.itemsCountOne": "{n} item",
  "store.itemsCountOther": "{n} items",
  "store.resultsFor": "Results for “{query}”",
  "store.clear": "Clear",
  "store.searchFailed": "Search failed — {error}",
  "store.noResults": "No matches.",
  "store.notInstalled": "Source “{sourceId}” isn't installed.",

  // source — app-authored copy shipped with the bundled source extensions.
  // Brand names/ids (KolNovel, Cenele, …) and anything scraped from a
  // source's own site are NOT here — only the app's own English sentences:
  // the sources-list card descriptions, and the fallback section headings
  // used on the rare occasion a source's homepage doesn't yield one.
  "source.cenele.description":
    "Arabic translations of Asian web novels from cenele.com (فضاء الروايات).",
  "source.kolnovel.description":
    "Arabic translations of Asian novels from free.kolnovel.com.",
  "source.kolnovelPro.description":
    "Arabic novels from kolnovel.com delivered as PDF chapters with the official illustrations.",
  "source.section.trendingFallback": "Trending",
  "source.section.hotUpdatesFallback": "Hot updates",

  // novel detail view (NovelDetailView.tsx) — action row, chapter search,
  // volumes accordion, per-chapter download button. The novel's own
  // scraped title/synopsis/author name/chapter+volume titles are NOT
  // here — those render as raw data. "novel.volumeFallback" backs the
  // "Volume N" placeholder title kolnovel-theme.ts/cenele.ts generate
  // when a source's own volume has no scraped label (surfaced in this
  // view + the downloads dialogs).
  "novel.loadError": "Couldn't load this novel — {error}",
  "novel.noDataReturned": "no data returned",
  "novel.noCover": "No cover",
  "novel.descMore": "more",
  "novel.descLess": "less",
  "novel.read": "Read",
  "novel.addToLibrary": "Add to library",
  "novel.adding": "Adding…",
  "novel.removing": "Removing…",
  "novel.downloadRange": "Download range",
  "novel.removeConfirm":
    "Remove this novel from your library? Your downloaded chapter ranges (if any) are kept.",
  "novel.searchChaptersPlaceholder": "Search chapters…",
  "novel.clearChapterSearch": "Clear chapter search",
  "novel.searchingChapters": "Searching chapters…",
  "novel.searchChaptersError": "Couldn't search chapters — {error}",
  "novel.chaptersHeading": "Chapters",
  "novel.chapterCountShort": "{n} ch.",
  "novel.chaptersLoadError": "Couldn't load chapters — {error}",
  "novel.queuedClickCancel": "Queued — click to cancel",
  "novel.downloadingClickCancel": "Downloading ({pct}%) — click to cancel",
  "novel.downloadChapter": "Download chapter",
  "novel.volumeFallback": "Volume {n}",
  // Rare technical fallback (deferred from Task 10): a scraped chapter with
  // no usable title text after sanitization. Same rationale + pattern as
  // volumeFallback above — synthesized directly in the (non-React) source
  // parser via `makeTr(currentUiLocale())`, since it's a fallback DATA value
  // that gets persisted, not something rendered through a single display
  // site later.
  "novel.chapterNoTitleFallback": "{n} - No Title",

  // streaming reader (SourceStreamReader.tsx) — status/error chrome unique
  // to the source-backed streaming reader (novel load, chapter fetch). The
  // reader's own toolbar/back/prev/next/TOC/progress/settings chrome reuses
  // reader.* — DesktopReader/MobileReader render it directly and already
  // resolve it from the UI locale. Scraped chapter content, and the novel's
  // own title, are NOT here — they render as raw data.
  "stream.loadingNovel": "Loading novel…",
  "stream.noChapters": "This novel has no chapters.",
  "stream.loadErrorTitle": "Couldn't load this novel",
  "stream.loadingChapter": "Loading chapter…",
  "stream.chapterErrorTitle": "Couldn't load this chapter",
  "stream.backToNovel": "Back to novel",

  // docx manage-import view (DocxManageView.tsx) — the "manage before
  // importing" section manager for staged .docx conversions. The document's
  // OWN content (source filename, detected language code, section/heading
  // text, body preview, and unrecognized block-tag names) is DATA and is
  // NOT translated here — it renders raw / as interpolation params.
  // "RTL"/"LTR" and the H1–H6/IMG/P block-type codes are technical
  // structure notation (same rationale as "OLED"/"px" above) and stay
  // literal Latin abbreviations in both locales; only the spelled-out
  // block-type words (LIST/QUOTE/TABLE) are localized.
  "docx.manageImport": "Manage import",
  "docx.sectionsKept": "{n} of {total} sections kept",
  "docx.removedCount": "{n} removed",
  "docx.imageCountOne": "{n} image",
  "docx.imageCountOther": "{n} images",
  "docx.noCoverInline": "no cover",
  "docx.coverSelectedInline": "cover selected",
  "docx.titleLabel": "Title",
  "docx.authorLabel": "Author",
  "docx.addToLibrary": "Add to library",
  "docx.adding": "Adding…",
  "docx.addFailedPrefix": "Couldn't add:",
  "docx.nothingToImport":
    "Nothing to import — restore at least one section.",
  "docx.coverGalleryAriaLabel": "Cover gallery",
  "docx.coverHeading": "Cover",
  "docx.coverOneSelected": "1 image selected",
  "docx.pickImage": "Pick an image",
  "docx.noImages": "No images",
  "docx.noCoverTitle": "Use no cover (auto-generated placeholder)",
  "docx.noCoverButton": "No cover",
  "docx.galleryEmpty": "The gallery of the doc is empty.",
  "docx.autoCoverHint": "An auto-generated cover will be used.",
  "docx.coverCandidatesAriaLabel": "Cover candidates",
  "docx.thumbSelected": "Selected",
  "docx.imageIndex": "Image {n}",
  "docx.documentContentAriaLabel": "Document content",
  "docx.sectionCountOne": "{n} section",
  "docx.sectionCountOther": "{n} sections",
  "docx.selectedCount": "{n} selected",
  "docx.clearSelection": "Clear",
  "docx.deleteSelectedCount": "Delete {n}",
  "docx.selectAll": "Select all",
  "docx.hideDeleted": "Hide deleted",
  "docx.showDeletedCount": "Show deleted ({n})",
  "docx.restoreAll": "Restore all",
  "docx.emptyNoContent": "This document has no readable content.",
  "docx.emptyAllRemoved":
    "Every section has been removed. Restore at least one to import.",
  "docx.documentSectionsAriaLabel": "Document sections",
  "docx.pageNumber": "Page {n}",
  "docx.removedTag": "removed",
  "docx.placeholderImage": "(image)",
  "docx.placeholderTable": "(table)",
  "docx.placeholderEmpty": "(empty)",
  "docx.deleteSection": "Delete this section",
  "docx.restoreSection": "Restore this section",
  "docx.blockTypeList": "LIST",
  "docx.blockTypeQuote": "QUOTE",
  "docx.blockTypeTable": "TABLE",

  // ── Task 13: user-facing error / status message sweep ──────────────────
  // Library.tsx toast bodies (dynamic parts — book/doc titles, counts, and
  // caught-error `.message` text — travel as interpolation params; see the
  // BOUNDARY note in the task brief).
  "status.importedDocOne": "Imported “{title}” — {n} chapter.",
  "status.importedDocOther": "Imported “{title}” — {n} chapters.",
  "status.importFailed": "Import failed: {error}",
  "status.docReadError": "Couldn't read document: {error}",
  "status.addToLibraryError": "Couldn't add to library: {error}",
  "status.emptyFolderImport":
    "That folder has no EPUB files at its top level — can't import an empty folder.",
  "status.importedFolderSkippedOne":
    "Imported {n} book, skipped {skipped} that couldn't be parsed.",
  "status.importedFolderSkippedOther":
    "Imported {n} books, skipped {skipped} that couldn't be parsed.",
  "status.importedFolderOne": "Imported {n} book.",
  "status.importedFolderOther": "Imported {n} books.",
  "status.coverNotFoundInEpub":
    "Couldn't find a cover in the original EPUB. Try “Set cover…” to pick an image yourself.",

  // Progress-phase labels. `job.phase` (download queue conversions) and
  // import `Step.label` (source + docx importers) are free-form English
  // strings set deep in non-React modules with no `tr` access — translated
  // at the DISPLAY site via `src/i18n/statusLabels.ts`'s `phaseLabel()`,
  // which maps the raw string to one of these keys (falling back to the
  // raw text for anything unrecognized). The producing modules keep
  // emitting the same fixed English text; treat it as a stable code.
  "status.phase.queued": "Queued",
  "status.phase.loadingSnapshot": "Loading snapshot",
  "status.phase.buildingEpub": "Building EPUB",
  "status.phase.savingToLibrary": "Saving to library",
  "status.phase.addingToLibrary": "Adding to library",
  "status.phase.readingFile": "Reading file",
  "status.phase.detectingLanguage": "Detecting language",
  "status.phase.convertingDocument": "Converting document",
  "status.phase.detectingChapters": "Detecting chapters",
  "status.phase.preparingPages": "Preparing pages",
  "status.phase.fetchingCover": "Fetching cover",
  "status.phase.fetchingChapters": "Fetching chapters",
  "status.phase.downloadingInlineImages": "Downloading inline images",
  "status.phase.loadingSourcePage": "Loading {source} page",
  "status.phase.fetchingChapterProgress": "Fetching chapter {n} / {total}",
  "status.phase.downloadingInlineImagesProgress":
    "Downloading inline images ({n}/{total})",
  "status.phase.loadingVolume": "Loading volume {n} / {total}: {title}",
  "status.phase.readingChapterProgress": "Reading chapter {n} / {total}",
  "status.phase.fetchingImageProgress": "Fetching image {n} / {total}",
  "status.phase.savedTitled": "Saved “{title}”",
  "status.phase.resumingVolume": "Resuming at volume {n} / {total}",
  "status.phase.buildingVolume": "Building volume {n} / {total}",
  "status.phase.savingVolume": "Saving volume {n}",
  "status.percentOnly": "{pct}%",
  "status.phaseWithPercent": "{phase} · {pct}%",

  // Stable, app-authored `Error.message` strings recognized by
  // `errorLabel()` (same file) at the display site (Library.tsx toasts,
  // DownloadQueueView's job.error, ImportProgress's state.error). Anything
  // NOT one of these stays raw — see BOUNDARY note.
  "error.anotherImportRunning": "Another import is already running",
  "error.anotherImportInProgress": "Another import is still in progress.",
  "error.novelNoChaptersToConvert": "This novel has no chapters to convert.",
  "error.sourceNotInstalledBuild":
    "Source “{sourceId}” isn't installed in this build.",
  "error.sourceNotInstalledDownload":
    "Source “{sourceId}” isn't installed — can't download this chapter.",

  // System (OS-level) download notifications — src/store/downloadNotifier.ts
  // runs outside the component tree, so it resolves the UI locale the same
  // way kolnovel-theme.ts / cenele.ts already do (`document.documentElement.lang`)
  // and calls `makeTr()` directly rather than using `useI18n()`.
  "status.notif.convertingTitle": "Converting {novel}",
  "status.notif.percentDone": "{pct}% done",
  "status.notif.preparingOfflineBook": "Preparing offline book",
  "status.notif.jobsDoneOf": "{done} of {total} jobs done",
  "status.notif.downloadingChapterTitle": "Downloading {novel} — Ch. {n}",
  "status.notif.chapterOfTotal": "Chapter {n} of {total}{suffix}",
  "status.notif.novelsSuffix": " ({n} novels)",
  "status.notif.downloadingChaptersTitle": "Downloading chapters",
  "status.notif.chaptersOfTotal": "{done} of {total} chapters",
  "status.notif.backgroundWorkFinished": "Background work finished",
  "status.notif.completedCount": "{n} completed",
  "status.notif.failedCount": "{n} failed",
  "status.notif.cancelledCount": "{n} cancelled",
  "status.notif.allDone": "All done",
  "status.notif.jobsCompleteOne": "1 job complete",
  "status.notif.jobsCompleteOther": "{n} jobs complete",

  // ContextMenu.tsx — status submenu labels reuse sidebar.reading/finished/
  // wishlist; these cover the menu's own remaining chrome.
  "contextMenu.status": "Status",
  "contextMenu.statusNone": "None",
  "contextMenu.editBookInfo": "Edit book info",
  "contextMenu.removeBook": "Remove book",
} as const;
