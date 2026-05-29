// The Sources subsystem. A "Source" is an installable extension that knows
// how to browse + scrape a specific website (or family of sites) for
// novels/books. Every source implements the `Source` interface below; the
// host (Leaflet) drives them through their lifecycle, persists results
// into the library, and isolates them from each other.
//
// Compared to the older NovelScraper C# tool, the same scraping logic lives
// here as a small TS module, but the heavy lifting (HTTP, JS rendering) is
// delegated to the Rust side through the `SourceHost` bridge — keeping the
// extension code itself short and reviewable.
//
// Three layers of data shape:
//   - NovelCard: cheap stub used in homepage rows + search results
//                (just enough to render a clickable card).
//   - SourceNovel: full novel metadata + chapter listing (no chapter bodies)
//                  — returned by getNovel(url).
//   - SourceLine / SourceChapter: chapter body content — populated by
//                                  getChapterContent(chapter).
//
// All shapes are JSON-serializable so a snapshot of any scrape can be
// persisted for resume / debugging without losing fidelity.

// ── chapter-body shapes (unchanged from the original importer) ─────────────

export type SourceLineType = "text" | "image";

export interface SourceLine {
  type: SourceLineType;
  /** For text: the paragraph's plain text. For image: an absolute URL the
   *  host can fetch (no inline data: URIs — the host downloads + packages). */
  content: string;
}

export interface SourceChapter {
  /** Source-assigned numeric id, stable across one scrape session. */
  id: number;
  title: string;
  url: string;
  /** Empty until getChapterContent populates it. */
  lines: SourceLine[];
}

export interface SourceVolume {
  /** 1-based. Sources without volumes return a single pseudo-volume. */
  id: number;
  title: string;
  chapters: SourceChapter[];
  /** Total chapter count when the source knows it before the chapters
   *  themselves have been fetched. Used by the lazy-volume path: the
   *  detail view can render a "(N chapters)" badge before expanding,
   *  and the skeleton renders the right number of placeholder rows. */
  chapterCount?: number;
  /** Opaque source-specific token to identify this volume on a later
   *  `getVolumeChapters` call. Required by sources that declare
   *  `hasLazyVolumes` because our 1-based `id` doesn't always match
   *  the source's internal volume numbering (e.g. cenele uses 0 for
   *  the "no volumes" pseudo-volume; our id is monotonic). Sources
   *  with eager chapter loading can leave this undefined. */
  key?: string;
}

// ── novel header / card shapes ──────────────────────────────────────────────

export interface NovelCard {
  /** URL of the novel's index/series page. Used as the stable identity for
   *  this novel across UI state — what the user clicked. */
  url: string;
  title: string;
  /** Absolute URL of the cover thumbnail. Optional — some card layouts
   *  don't surface a cover at all (e.g., text-only list views). */
  coverUrl?: string;
  /** Secondary title shown under the main title (original-language name,
   *  alternate translation, latest-chapter snippet, etc.). Free-form. */
  subtitle?: string;
  /** Tiny chip-style genre/tag labels, when the listing surfaces them. */
  badges?: string[];
}

/** A row on a source's homepage. KolNovel for example surfaces "Latest
 *  Updates", "Completed Novels", "Recommendations" — each is a section. */
export interface SourceSection {
  /** Stable identifier within this source (e.g., "latest", "completed").
   *  Useful for caching and for the "load more" affordance on long
   *  sections. */
  id: string;
  /** Display name from the page heading. */
  title: string;
  cards: NovelCard[];
  /** Optional URL the user can open to see more of this section. The store
   *  UI exposes this as a "View all" link next to the section title. */
  viewMoreUrl?: string;
}

export interface SourceSearchResult {
  cards: NovelCard[];
  /** True when the source's pagination indicates more pages exist. The UI
   *  uses this to surface a "Load more" button. */
  hasMore: boolean;
  /** Echoed from the input — convenient for the UI's loading-state check. */
  query: string;
  /** 1-based current page. */
  page: number;
}

// ── full novel + metadata ───────────────────────────────────────────────────

export interface SourceNovelMeta {
  /** Free-form name → value pairs the source lifts off the novel page.
   *  KolNovel surfaces these via the `.serl` rows (author, translator,
   *  original language, year, type, etc.). The store UI renders them as a
   *  definition list so we don't have to hardcode every field. */
  label: string;
  value: string;
  /** When the value links somewhere on the source (e.g., the author's
   *  page), keep the URL so the UI can render it as a link. Optional. */
  url?: string;
}

export interface SourceNovel {
  title: string;
  /** Best-effort author name. Sources unable to detect it return "Unknown".
   *  The user can rename via the library's edit dialog post-import. */
  author: string;
  /** Original-language title (e.g. "Master of Gu kol" for the Arabic
   *  KolNovel translation of "Reverend Insanity"). Surfaced in the header
   *  under the main title. */
  originalTitle?: string;
  /** BCP-47-ish language code, lowercase. Drives the EPUB's xml:lang +
   *  reader direction. */
  language: string;
  direction: "ltr" | "rtl";
  /** Absolute URL of the cover image, when the source identifies one. */
  coverUrl?: string;
  /** Free-form HTML or text synopsis lifted from the novel page. The UI
   *  treats this as plaintext and renders it inside a <p>. */
  description?: string;
  /** Genre / tag chips. Free-form strings the source uses for the same
   *  concept the user calls "tags" or "genres". */
  tags: string[];
  /** "Completed", "Ongoing", "Hiatus" — source-defined free string. Render
   *  as a small badge next to the title. Optional. */
  status?: string;
  /** Additional source-specific metadata (translator, year, type, …). The
   *  store UI renders these as a definition list in the novel header. */
  meta: SourceNovelMeta[];
  /** Volumes with their chapter listings, but without chapter content
   *  populated. */
  volumes: SourceVolume[];
}

// ── host bridge ─────────────────────────────────────────────────────────────

export interface FetchResponse {
  status: number;
  /** Response body as text. UTF-8 decoded by the host. */
  text: string;
  /** Response headers, lowercased keys. */
  headers: Record<string, string>;
}

export interface FetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
}

export interface RenderExtractOptions {
  /** JS expression body returning a boolean, polled at 150ms intervals
   *  until it returns true or timeoutMs elapses. */
  waitForPredicate?: string;
  /** Shorthand: wait until the selector matches at least one element with
   *  non-empty textContent. */
  waitForSelector?: string;
  /** JS function body returning (or async-returning) JSON-serializable
   *  data. Runs after the predicate succeeds. */
  script: string;
  /** Hard ceiling for predicate-polling + script-execution. Default 30s. */
  timeoutMs?: number;
}

export interface SourceHost {
  fetch(url: string, options?: FetchOptions): Promise<FetchResponse>;
  fetchBytes(url: string, options?: FetchOptions): Promise<Uint8Array>;
  renderAndExtract<T = unknown>(
    url: string,
    options: RenderExtractOptions,
  ): Promise<T>;
  log(level: "debug" | "info" | "warn" | "error", message: string): void;
}

// ── the Source interface itself ─────────────────────────────────────────────

export interface SourceMetadata {
  /** Stable machine-readable id, kebab-case. */
  id: string;
  /** Display name. */
  name: string;
  /** Origin the source handles. Used to validate pasted URLs + as the
   *  default destination of the source-home view. */
  baseUrl: string;
  /** BCP-47 language tag the source primarily produces. */
  language: string;
  /** One-line description shown in the sources list. */
  description?: string;
  /** Absolute URL of an icon/logo. Shown on the source card in the store.
   *  When absent the UI falls back to a generated avatar from the name. */
  iconUrl?: string;
  version: string;
}

/**
 * The Source interface. Every method may throw; the store UI translates
 * exceptions into inline error states.
 *
 * Capabilities are advisory: a source may not implement search if its site
 * has none. The UI checks via `typeof source.search === "function"` rather
 * than via a separate flag.
 */
export interface Source {
  readonly meta: SourceMetadata;

  /** Cheap predicate — does the URL look like one of this source's pages? */
  canHandle(url: string): boolean;

  /** Browse the source's homepage. The store's source-home view renders
   *  one section per element in the returned array, in order. */
  getHomeSections(): Promise<SourceSection[]>;

  /** Search for novels matching `query`. Page is 1-based. Implementations
   *  may ignore the `page` argument when the site doesn't paginate, in
   *  which case `hasMore` should be false. */
  search?(query: string, page?: number): Promise<SourceSearchResult>;

  /** Live as-you-type suggestion search. Sources that surface only an
   *  inline-dropdown search (no separate results page) implement this and
   *  leave `search` undefined — the store UI then runs a debounced
   *  `searchSuggest` while the user types and shows results as a dropdown
   *  beneath the input. Sources with both can drive the dropdown via
   *  suggest and the full grid via search. Result count is whatever the
   *  source returns (typically 5-10). */
  searchSuggest?(query: string): Promise<NovelCard[]>;

  /** True when this source's chapter listing is loaded per-volume on
   *  demand: `getNovel` returns volumes with empty `chapters[]` arrays
   *  (and `chapterCount` filled in when known), and the UI calls
   *  `getVolumeChapters` to populate one volume at a time. False or
   *  absent means `getNovel` returns fully-populated volumes. */
  readonly hasLazyVolumes?: boolean;

  /** Full novel metadata + chapter listing (without chapter bodies). The
   *  `url` here is the novel's index/series page URL (matches NovelCard.url).
   *  When `hasLazyVolumes` is true, the returned volumes may have empty
   *  `chapters[]` arrays; the UI calls `getVolumeChapters` for each
   *  volume the user expands. */
  getNovel(url: string): Promise<SourceNovel>;

  /** Populate the chapters of one volume. Required when
   *  `hasLazyVolumes` is true; ignored otherwise. The `novelUrl`
   *  argument is the same URL that was passed to `getNovel`, and the
   *  `volume` argument is the SourceVolume the source returned from
   *  that call (so the source can recover any opaque state stashed in
   *  `volume.key`). Returns the chapters in source order. */
  getVolumeChapters?(
    novelUrl: string,
    volume: SourceVolume,
  ): Promise<SourceChapter[]>;

  /** Search inside one novel's chapter list. Used for novels with too
   *  many chapters to browse comfortably through the volumes accordion —
   *  the detail view surfaces a chapter-search input above the accordion
   *  when this method is present. `novelUrl` is the same URL that was
   *  passed to getNovel() in this session, so the source can look up any
   *  per-novel state it cached (manga ids, nonces, …). Returns chapter
   *  stubs in the same shape `getNovel` populates the volumes with —
   *  identity is via `.url`, not `.id`, since search results often span
   *  volumes and a fresh id sequence wouldn't line up. */
  searchChapters?(
    novelUrl: string,
    query: string,
  ): Promise<SourceChapter[]>;

  /** Populate `lines` for one chapter. */
  getChapterContent(chapter: SourceChapter): Promise<SourceLine[]>;

  /** Optional. When a source emits image SourceLines whose `content` is NOT
   *  a host-fetchable URL (e.g. images extracted from a downloaded PDF), the
   *  importer calls resolveImage(content) to obtain the bytes out-of-band
   *  instead of host.fetchBytes. Return null to fall back to URL fetch.
   *  The returned shape matches the importer's internal DownloadedImage. */
  resolveImage?(
    ref: string,
  ): Promise<{ bytes: Uint8Array; mimeType: string; extension: string } | null>;
}

// ── error sentinels ─────────────────────────────────────────────────────────

export class SourceUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceUnsupportedError";
  }
}

export class SourceUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceUrlError";
  }
}
