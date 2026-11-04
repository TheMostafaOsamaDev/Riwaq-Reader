// Narrowing a list of sites by a typed query and a chosen language.
//
// Shared because the same two controls sit over two lists — the Store's
// installed sources (SourceMetadata) and the Extensions manager's catalogue
// (CatalogEntry) — and both must agree on what "matches" means. Both shapes
// already carry the four fields below under these names, so either list is
// passed in as it is.

import { useMemo, useState } from "react";
import { useI18n } from "../i18n/useI18n";
import { pickDescription } from "./description";
import type { Locale } from "./types";

export interface FilterFields {
  name: string;
  baseUrl?: string;
  /** The extension's own locale map — see pickDescription. */
  description?: Record<string, string>;
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

// One per UI language: building an Intl.DisplayNames costs several times
// what a lookup does, and every card asks on every keystroke.
const displayNames = new Map<string, Intl.DisplayNames | null>();

function namesFor(uiLocale: string): Intl.DisplayNames | null {
  if (!displayNames.has(uiLocale)) {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([uiLocale], { type: "language" });
    } catch {
      // No Intl.DisplayNames in this engine.
    }
    displayNames.set(uiLocale, names);
  }
  return displayNames.get(uiLocale) ?? null;
}

/** "en" → "English" (or "الإنجليزية" under an Arabic UI). Falls back to
 *  the upper-cased code for anything Intl cannot name, which is how the
 *  cards rendered the field before. */
export function languageName(code: string, uiLocale: string): string {
  try {
    const name = namesFor(uiLocale)?.of(primaryTag(code));
    if (name) return name;
  } catch {
    // Not a valid language tag.
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

/** True when `item` contains `query` (name, URL, or its description in
 *  the UI language — any case) and, when `language` is set, is in that
 *  language. An empty query and a null language match everything. */
export function matchesFilter(
  item: FilterFields,
  query: string,
  language: string | null,
  locale: Locale,
): boolean {
  if (language !== null) {
    if (!item.language || primaryTag(item.language) !== language) return false;
  }
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    item.name,
    item.baseUrl,
    pickDescription(item.description, locale),
  ].some((field) => field?.toLowerCase().includes(q));
}

export interface SiteFilter {
  query: string;
  setQuery: (query: string) => void;
  languages: LanguageOption[];
  /** The chosen language code; null is "All". */
  language: string | null;
  setLanguage: (language: string | null) => void;
  matches: (item: FilterFields) => boolean;
}

/** The query and language state behind a SiteFilterBar, over `items`. */
export function useSiteFilter(items: FilterFields[]): SiteFilter {
  const { locale } = useI18n();
  const [query, setQuery] = useState("");
  const [chosen, setLanguage] = useState<string | null>(null);
  const languages = useMemo(
    () =>
      listLanguages(
        items.map((i) => i.language),
        locale,
      ),
    [items, locale],
  );
  // A language can drop out from under the filter — its only repo removed,
  // say. Its chip goes with it, so keeping it chosen would leave an empty
  // list with no visible way back to "All".
  const language = languages.some((l) => l.code === chosen) ? chosen : null;
  return {
    query,
    setQuery,
    languages,
    language,
    setLanguage,
    matches: (item) => matchesFilter(item, query, language, locale),
  };
}
