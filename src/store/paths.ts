// Where the library lives under app-data, in one place.
//
// This used to be a `const ROOT` private to library.ts, with the literal
// re-typed wherever else it was needed. That is a quiet trap: the folder name
// has changed before, and a stale copy of it doesn't fail loudly — it just
// looks in a directory that isn't there and reports nothing found.
//
// A leaf module (no imports of its own) so anything can depend on it without
// risking a cycle through library.ts.

/** Root folder for everything the app stores, relative to app-data. */
export const ROOT = "riwaq";
/** What {@link ROOT} was called before the Leaflet → Riwaq rename. An install
 *  from <= v0.1.0 keeps its whole library here until `migrateLegacyRoot()`
 *  (./legacyRoot.ts) moves it across. Keep until it is safe to assume nobody
 *  is upgrading from a Leaflet-era install any more. */
export const LEGACY_ROOT = "leaflet";
export const BOOKS = `${ROOT}/books`;
export const INDEX = `${ROOT}/library.json`;
/** Where a picked file lands before we know what it is. */
export const STAGING = `${ROOT}/staging`;

/** A book's own directory, relative to app-data. */
export function bookDir(id: string): string {
  return `${BOOKS}/${id}`;
}
