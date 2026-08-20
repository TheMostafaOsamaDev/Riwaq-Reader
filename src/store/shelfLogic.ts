// Pure, deterministic shelf list + membership helpers. No IO, no Date.now /
// Math.random / crypto here — timestamps and ids are injected by callers so
// everything in this module is unit-testable. The Tauri-fs wrapper lives in
// shelves.ts.

export interface Shelf {
  id: string;
  name: string;
  createdAt: number;
  order: number;
}

export function buildDefaultShelves(
  names: string[],
  makeId: () => string,
  now: number,
): Shelf[] {
  return names.map((name, i) => ({ id: makeId(), name, createdAt: now, order: i }));
}

export function isDuplicateName(
  shelves: Shelf[],
  name: string,
  exceptId?: string,
): boolean {
  const n = name.trim().toLowerCase();
  return shelves.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === n);
}

export function appendShelf(shelves: Shelf[], shelf: Shelf): Shelf[] {
  return [...shelves, shelf];
}

export function renameInList(shelves: Shelf[], id: string, name: string): Shelf[] {
  return shelves.map((s) => (s.id === id ? { ...s, name: name.trim() } : s));
}

export function removeFromList(shelves: Shelf[], id: string): Shelf[] {
  return shelves.filter((s) => s.id !== id);
}

export function normalizeShelfIds(ids: string[] | undefined): string[] {
  return Array.isArray(ids) ? [...new Set(ids)] : [];
}

export function isOnShelf(ids: string[] | undefined, shelfId: string): boolean {
  return normalizeShelfIds(ids).includes(shelfId);
}

export function toggleMembership(ids: string[] | undefined, shelfId: string): string[] {
  const set = new Set(normalizeShelfIds(ids));
  if (set.has(shelfId)) set.delete(shelfId);
  else set.add(shelfId);
  return [...set];
}

export function removeMembership(ids: string[] | undefined, shelfId: string): string[] {
  return normalizeShelfIds(ids).filter((id) => id !== shelfId);
}

export function wouldOrphan(ids: string[] | undefined, shelfId: string): boolean {
  return removeMembership(ids, shelfId).length === 0;
}

export function booksOnShelf<T extends { shelfIds?: string[] }>(
  books: T[],
  shelfId: string,
): T[] {
  return books.filter((b) => isOnShelf(b.shelfIds, shelfId));
}
