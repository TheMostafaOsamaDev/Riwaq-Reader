// Persistent shelves — a riwaq/shelves.json sibling of library.json.
// Pure list logic lives in shelfLogic.ts; this module is the thin Tauri-fs
// wrapper (load/seed/save + CRUD). Deleting a shelf also strips its id from
// every book via library.removeShelfFromAllBooks.

import {
  BaseDirectory,
  exists,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { makeTr, type Locale } from "../i18n";
import {
  appendShelf,
  buildDefaultShelves,
  removeFromList,
  renameInList,
  type Shelf,
} from "./shelfLogic";
import { ensureRoot, removeShelfFromAllBooks } from "./library";
import { ROOT } from "./paths";

export type { Shelf };

const BASE = BaseDirectory.AppData;
const FILE = `${ROOT}/shelves.json`;

// Same locale probe pattern as library.ts's currentUiLocale().
function currentUiLocale(): Locale {
  if (typeof document !== "undefined" && document.documentElement.lang === "ar") {
    return "ar";
  }
  return "en";
}

function makeShelfId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `shelf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function read(): Promise<Shelf[]> {
  try {
    const raw = await readTextFile(FILE, { baseDir: BASE });
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.shelves) ? (parsed.shelves as Shelf[]) : [];
  } catch {
    return [];
  }
}

async function write(shelves: Shelf[]): Promise<void> {
  await ensureRoot();
  await writeTextFile(FILE, JSON.stringify({ shelves }, null, 2), { baseDir: BASE });
}

/** Load shelves. On the very first run (file absent) seed the two defaults
 *  and persist them. Once the file exists it is the source of truth — an
 *  empty file (user deleted all shelves) is NOT re-seeded. */
export async function listShelves(): Promise<Shelf[]> {
  if (!(await exists(FILE, { baseDir: BASE }))) {
    const tr = makeTr(currentUiLocale());
    const seeded = buildDefaultShelves(
      [tr("shelves.defaultFavorites"), tr("shelves.defaultToRead")],
      makeShelfId,
      Date.now(),
    );
    await write(seeded);
    return seeded;
  }
  return read();
}

export async function createShelf(name: string): Promise<Shelf> {
  const shelves = await read();
  const shelf: Shelf = {
    id: makeShelfId(),
    name: name.trim(),
    createdAt: Date.now(),
    order: shelves.length,
  };
  await write(appendShelf(shelves, shelf));
  return shelf;
}

export async function renameShelf(id: string, name: string): Promise<void> {
  const shelves = await read();
  await write(renameInList(shelves, id, name));
}

export async function deleteShelf(id: string): Promise<void> {
  const shelves = await read();
  await write(removeFromList(shelves, id));
  await removeShelfFromAllBooks(id);
}
