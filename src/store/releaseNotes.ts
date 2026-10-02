// What the app shows from a release's notes. Lenient on purpose: anything
// malformed is dropped, never thrown. scripts/release-notes.mjs is the strict
// gate a release has to pass; this is what a running app does with whatever
// it was handed (an older file, a half-download, a hand edit).

export type ChangeKind = "new" | "improved" | "fixed";
export interface Localized {
  en: string;
  ar: string;
}
export interface NotesCard {
  kind?: ChangeKind;
  image?: string;
  title: Localized;
  body: Localized;
}
export interface ChangeItem extends Localized {
  kind: ChangeKind;
}
export interface ReleaseNotes {
  version: string;
  date: string;
  highlight?: NotesCard;
  stories?: NotesCard[];
  items: ChangeItem[];
}

const KINDS: readonly string[] = ["new", "improved", "fixed"];
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;
const str = (v: unknown): v is string => typeof v === "string" && v !== "";

function localized(v: unknown): Localized | null {
  const o = rec(v);
  return o && str(o.en) && str(o.ar) ? { en: o.en, ar: o.ar } : null;
}

function card(v: unknown): NotesCard | null {
  const o = rec(v);
  if (!o) return null;
  const title = localized(o.title);
  const body = localized(o.body);
  if (!title || !body) return null;
  return {
    title,
    body,
    ...(str(o.image) ? { image: o.image } : {}),
    ...(typeof o.kind === "string" && KINDS.includes(o.kind)
      ? { kind: o.kind as ChangeKind }
      : {}),
  };
}

export function parseReleaseNotes(v: unknown): ReleaseNotes | null {
  const o = rec(v);
  if (!o || !str(o.version)) return null;
  const items: ChangeItem[] = [];
  for (const raw of Array.isArray(o.items) ? o.items : []) {
    const i = rec(raw);
    const l = localized(i);
    if (i && l && typeof i.kind === "string" && KINDS.includes(i.kind)) {
      items.push({ kind: i.kind as ChangeKind, ...l });
    }
  }
  if (items.length === 0) return null;
  const highlight = card(o.highlight) ?? undefined;
  const stories = (Array.isArray(o.stories) ? o.stories : [])
    .map(card)
    .filter((c): c is NotesCard => c !== null);
  return {
    version: o.version,
    date: str(o.date) ? o.date : "",
    ...(highlight ? { highlight } : {}),
    ...(stories.length ? { stories } : {}),
    items,
  };
}

export function pick(l: Localized, locale: "en" | "ar"): string {
  return l[locale] || l.en;
}

/** A release in one line, for a card: the highlight's title, else the
 *  first item, else nothing. */
export function summaryOf(
  notes: ReleaseNotes | null,
  locale: "en" | "ar",
): string {
  if (!notes) return "";
  if (notes.highlight) return pick(notes.highlight.title, locale);
  return notes.items[0] ? pick(notes.items[0], locale) : "";
}
