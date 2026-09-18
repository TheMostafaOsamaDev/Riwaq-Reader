// Resolving an extension's one-line description for display.
//
// The published contract carries `description` as a locale map
// (`{ en: "...", ar: "..." }`) rather than a single string, because an
// extension ships its own copy and cannot reach the app's message
// catalogue. This is the app's side of that: pick the entry for the UI
// language, with the fallback chain the contract documents.
//
// Shared rather than inlined because the same map shape arrives from two
// directions — an installed extension's manifest (SourceMetadata) and a
// repo index entry (RepoIndexEntry) — and both render it the same way.

// Deliberately the CONTRACT's Locale, not the app's own `../i18n` one.
// Both are `"en" | "ar"` today, but types.ts is under a standing
// verbatim-recopy instruction, so the two can drift independently. Taking
// the contract's here makes the call sites (which pass `useI18n().locale`)
// the seam where a drift surfaces as a type error, instead of `host.locale`
// and `pickDescription` silently disagreeing about the UI language.
import type { Locale } from "./types";

/** The description to show for `locale`: that locale, else `en`, else
 *  whatever the extension did ship. Undefined when there is nothing to
 *  show, so callers can use it directly as a render guard. */
export function pickDescription(
  map: Record<string, string> | undefined,
  locale: Locale,
): string | undefined {
  if (!map) return undefined;
  // An empty entry is a missing translation, not a deliberate blank, so
  // fall through it rather than rendering nothing when a good fallback
  // exists.
  return (
    map[locale] || map.en || Object.values(map).find((v) => v) || undefined
  );
}
