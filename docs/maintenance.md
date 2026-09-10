# Maintenance

Housekeeping that is worth doing periodically and easy to forget. Everything
below was checked on **11 September 2026**; re-run the commands rather than
trusting the lists.

## Stale remote branches

61 remote branches, of which 36 are fully merged into `main` — their tips are
ancestors of it, so deleting them loses nothing. The oldest is from 13 June.

Check first, always, rather than trusting the list below:

```bash
git fetch --prune origin
git branch -r --merged origin/main --format='%(refname:short) %(committerdate:short)'
```

Then, to delete the merged ones:

```bash
git push origin --delete \
  ci/fix-arm64-appimage-xdg ci/pr-checks ci/release-more-artifacts \
  docs/install-unsigned-notes feat/background-tasks \
  feat/cenele-repair-unified-search feat/cenele-session-webview \
  feat/download-range-mobile feat/download-range-sheet feat/hero-float \
  feat/open-with-and-drag-drop feat/reading-colors-and-highlights \
  feat/reading-font-library feat/settings-page feat/shelves \
  feat/sidebar-nav feat/single-font-rtl-wordmark feat/store-website-search \
  feat/toc-dock-desktop feat/unified-reader-chrome \
  fix/android-adaptive-icon fix/android-download-crash \
  fix/android-release-signing fix/carousel-arrows-and-reader-layout \
  fix/downloads-progress-percentage fix/fixed-reader-viewer-mobile \
  fix/pdf-page-mode-turns fix/reader-content-width-and-sheet-float \
  fix/reader-parity-and-pdf-highlights fix/reimport-repairs-dead-entry \
  fix/search-overlay-contrast fix/store-cover-uses-local-file \
  fix/toc-sheet-jelly perf/android-cold-start perf/cover-thumbnails \
  perf/large-books-and-libraries
```

Two branches are merged but deliberately **left out** of that list:

- **`feat/in-app-updates`** is checked out in the main working copy. Deleting
  the remote while someone is on the local branch is a confusing thing to do to
  yourself.
- **`origin`** — there is a remote branch literally named `origin`, so its ref
  is `origin/origin`. Almost certainly a typo'd `git push origin origin` at some
  point. Worth looking at before deleting, since the name makes every future
  `git branch -r` listing read strangely.

The other 23 remote branches are **not** merged and carry commits that exist
nowhere else. Leave them.

## Dependencies

Everything is one patch or minor behind, which is fine and not worth a PR on
its own. One exception:

- **`pdfjs-dist`** is pinned `^4.7.76` and resolves to 4.10.38, the last 4.x.
  Latest is **6.x** — two majors behind, not one. pdf.js majors move the
  worker/API surface around, and this app drives the text layer and highlight
  geometry directly, so the upgrade is a real piece of work with a real chance
  of moving glyph rects. Worth scheduling deliberately, with the fixed-layout
  reader open next to it. Not a release blocker.

```bash
pnpm outdated
```

## Font licensing

Every bundled family carries its OFL text next to it. If you add one, add the
license in the same commit — a tagged release is a distribution, and an
unlicensed font in a release is much harder to walk back than one in a branch.
