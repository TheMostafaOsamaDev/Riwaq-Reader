// Narrowing a list of sites by a typed query and a chosen language.
//
// Shared because the same two controls sit over two lists of different
// shapes — the Store's installed sources (SourceMetadata) and the
// Extensions manager's catalogue (CatalogEntry) — and both must agree on
// what "matches" means. Each call site reduces its item to a
// `FilterFields` first, so nothing here knows either shape.

export interface FilterFields {
  name: string;
  baseUrl?: string;
  /** Already resolved for the UI locale — see pickDescription. */
  description?: string;
  /** BCP-47 tag as the manifest declares it. */
  language?: string;
}

export interface LanguageOption {
  code: string;
  name: string;
}

/** "en-US" and "EN" are both "en". Manifests declare bare primary tags
 *  today, but the field is free text, so a regional one must not split a
 *  language into two filter chips. */
function primaryTag(tag: string): string {
  return tag.trim().toLowerCase().split(/[-_]/)[0];
}

/** "en" → "English" (or "الإنجليزية" under an Arabic UI). Falls back to
 *  the upper-cased code for anything Intl cannot name, which is how the
 *  cards rendered the field before. */
export function languageName(code: string, uiLocale: string): string {
  try {
    const names = new Intl.DisplayNames([uiLocale], { type: "language" });
    const name = names.of(primaryTag(code));
    if (name) return name;
  } catch {
    // Not a valid tag, or no Intl.DisplayNames in this engine.
  }
  return code.toUpperCase();
}

/** The distinct languages present, by display name — the choices the
 *  language filter offers. */
export function listLanguages(
  codes: (string | undefined)[],
  uiLocale: string,
): LanguageOption[] {
  const seen = new Set<string>();
  for (const code of codes) {
    if (code?.trim()) seen.add(primaryTag(code));
  }
  return [...seen]
    .map((code) => ({ code, name: languageName(code, uiLocale) }))
    .sort((a, b) => a.name.localeCompare(b.name, uiLocale));
}

/** True when `item` contains `query` (name, URL or description, any case)
 *  and, when `language` is set, is in that language. An empty query and a
 *  null language match everything. */
export function matchesFilter(
  item: FilterFields,
  query: string,
  language: string | null,
): boolean {
  if (language !== null) {
    if (!item.language || primaryTag(item.language) !== language) return false;
  }
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.name, item.baseUrl, item.description].some((field) =>
    field?.toLowerCase().includes(q),
  );
}
