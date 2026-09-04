// One-time localStorage key migration for the Leaflet → Riwaq rename.
//
// Every key the app owns is namespaced `riwaq:…`; before the rename the same
// keys were `leaflet:…`. The Tauri identifier did not change, so the WebView
// keeps the same origin and the old values are still there to be moved.
//
// Call `migrateStorageKey("riwaq:whatever")` immediately before the first read
// of a key. It moves `leaflet:whatever` across only when the new key is absent,
// so a value written since the rename always wins.

const PREFIX = "riwaq:";
const LEGACY_PREFIX = "leaflet:";

/** Move the pre-rename value for `key` into place, if there is one to move.
 *  No-op unless `key` starts with `riwaq:`. Safe to call repeatedly and on
 *  every render — it costs two `getItem`s once the migration has happened. */
export function migrateStorageKey(key: string): void {
  if (!key.startsWith(PREFIX)) return;
  try {
    if (localStorage.getItem(key) !== null) return;
    const legacyKey = LEGACY_PREFIX + key.slice(PREFIX.length);
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === null) return;
    localStorage.setItem(key, legacy);
    localStorage.removeItem(legacyKey);
  } catch {
    // Private mode, disabled storage, or a quota error — the caller falls
    // back to its defaults, which is the same as a first run.
  }
}
