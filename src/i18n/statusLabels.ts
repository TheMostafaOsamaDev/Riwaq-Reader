// Small helpers that turn stable, app-authored English strings — produced
// deep in non-React modules (src/store, src/sources) that have no access to
// `useI18n()` — into localized text at the point they're finally rendered.
//
// The modules that PRODUCE these strings (downloadQueue.ts, storeConversion.ts,
// importer.ts, library.ts, downloadNotifier.ts) keep emitting the exact same
// fixed English text as before; think of that text as a stable "code" the
// lookup tables below recognize. Anything NOT recognized (a raw network /
// parsing error message, scraper-specific technical detail, or any future
// code path we haven't enumerated) is returned unchanged — which is the
// correct behavior for genuinely dynamic/unpredictable text that isn't
// app-authored UI copy.

import type { Tr } from "./index";

/** Translate a `ConversionJob.phase` / import `Step.label` string produced
 *  by the download queue, the source importer, or the docx importer. These
 *  are free-form progress labels set deep in non-React modules — some are
 *  fixed strings, others carry embedded counts/titles. Unrecognized input
 *  is returned as-is so a future phase string doesn't silently disappear. */
export function phaseLabel(raw: string, tr: Tr): string {
  switch (raw) {
    case "Queued":
      return tr("status.phase.queued");
    case "Loading snapshot":
      return tr("status.phase.loadingSnapshot");
    case "Building EPUB":
      return tr("status.phase.buildingEpub");
    case "Saving to library":
      return tr("status.phase.savingToLibrary");
    case "Adding to library":
      return tr("status.phase.addingToLibrary");
    case "Reading file":
      return tr("status.phase.readingFile");
    case "Detecting language":
      return tr("status.phase.detectingLanguage");
    case "Converting document":
      return tr("status.phase.convertingDocument");
    case "Detecting chapters":
      return tr("status.phase.detectingChapters");
    case "Preparing pages":
      return tr("status.phase.preparingPages");
    case "Fetching cover":
      return tr("status.phase.fetchingCover");
    case "Fetching chapters":
      return tr("status.phase.fetchingChapters");
    case "Downloading inline images":
      return tr("status.phase.downloadingInlineImages");
  }

  let m: RegExpMatchArray | null;
  if ((m = raw.match(/^Loading (.+) page$/))) {
    return tr("status.phase.loadingSourcePage", { source: m[1] });
  }
  if ((m = raw.match(/^Fetching chapter (\d+) \/ (\d+)$/))) {
    return tr("status.phase.fetchingChapterProgress", {
      n: m[1],
      total: m[2],
    });
  }
  if ((m = raw.match(/^Downloading inline images \((\d+)\/(\d+)\)$/))) {
    return tr("status.phase.downloadingInlineImagesProgress", {
      n: m[1],
      total: m[2],
    });
  }
  if ((m = raw.match(/^Loading volume (\d+) \/ (\d+): (.+)$/))) {
    return tr("status.phase.loadingVolume", {
      n: m[1],
      total: m[2],
      title: m[3],
    });
  }
  if ((m = raw.match(/^Reading chapter (\d+) \/ (\d+)$/))) {
    return tr("status.phase.readingChapterProgress", {
      n: m[1],
      total: m[2],
    });
  }
  if ((m = raw.match(/^Fetching image (\d+) \/ (\d+)$/))) {
    return tr("status.phase.fetchingImageProgress", { n: m[1], total: m[2] });
  }
  if ((m = raw.match(/^Saved "(.+)"$/))) {
    return tr("status.phase.savedTitled", { title: m[1] });
  }
  if ((m = raw.match(/^Resuming at volume (\d+) \/ (\d+)$/))) {
    return tr("status.phase.resumingVolume", { n: m[1], total: m[2] });
  }
  if ((m = raw.match(/^Building volume (\d+) \/ (\d+)$/))) {
    return tr("status.phase.buildingVolume", { n: m[1], total: m[2] });
  }
  if ((m = raw.match(/^Saving volume (\d+)$/))) {
    return tr("status.phase.savingVolume", { n: m[1] });
  }
  if ((m = raw.match(/^Saved (\d+) books?$/))) {
    const n = Number(m[1]);
    return tr(
      n === 1 ? "downloads.statusSavedOne" : "downloads.statusSavedOther",
      { n },
    );
  }
  return raw;
}

/** Translate a stable, app-authored `Error.message` thrown deep in
 *  src/store or src/sources — the handful of literal guard-clause messages
 *  we fully control (e.g. "Another import is already running"). Everything
 *  else (network failures, scraper-specific technical detail, underlying
 *  library errors) is intentionally left as-is: that's the "dynamic
 *  `.message` payload" this i18n pass treats as data, not UI copy, because
 *  we can't enumerate every message an external call might produce. */
export function errorLabel(raw: string, tr: Tr): string {
  switch (raw) {
    case "Another import is already running":
      return tr("error.anotherImportRunning");
    case "Another import is still in progress.":
      return tr("error.anotherImportInProgress");
    case "This novel has no chapters to convert.":
      return tr("error.novelNoChaptersToConvert");
    case "Couldn't read the novel's snapshot — try reopening it from the library first.":
      return tr("downloads.saveOffline.readError");
  }

  let m: RegExpMatchArray | null;
  if ((m = raw.match(/^Source "(.+)" isn't installed in this build\.$/))) {
    return tr("error.sourceNotInstalledBuild", { sourceId: m[1] });
  }
  if (
    (m = raw.match(
      /^Source "(.+)" isn't installed — can't download this chapter\.$/,
    ))
  ) {
    return tr("error.sourceNotInstalledDownload", { sourceId: m[1] });
  }
  return raw;
}
