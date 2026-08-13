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
  "search.unknownAuthor": "Unknown",

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
} as const;
