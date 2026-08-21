# Shelves — design spec

Date: 2026-08-20
Status: proposed (awaiting review)

## 1. Summary

Turn the placeholder "Shelves" feature into a real one: user-created
collections that books can be assigned to. A book can live on multiple
shelves at once, independent of its reading `status`. Shelves and their
membership persist to disk.

This spec covers: shelf CRUD (create / rename / delete), assigning and
removing books (from the library or from the device), a per-shelf page
reachable from the sidebar, a shelf-membership control on the single-book
page, and a "smart" remove flow that only asks about deleting a book from
the library when the removal would leave it on no shelf.

## 2. Current state (what exists today)

- Shelves are an in-memory `string[]` in `Library.tsx` (`shelves`, seeded
  from `shelves.defaultFavorites` / `shelves.defaultToRead`). **Not
  persisted**; create just appends a name; no rename/delete; no book
  assignment.
- `ShelvesPage.tsx` is an explicit placeholder — every shelf renders an
  empty dashed box ("no books in this shelf yet").
- `BookIndexEntry` (in `src/store/library.ts`, persisted in
  `leaflet/library.json`) has `status` (`reading|finished|wishlist`) and
  `kind`, but **no shelf membership**.
- The sidebar (`LibrarySidebar.tsx`) lists shelf names as tree items that
  all call `onOpenShelves` (the all-shelves page) with `active={false}`.
- Navigation (`src/store/navigation.ts`) is History-API-backed.
  `LibraryView` union: `{kind:"shelf"}` (the Library home grid — note the
  confusing name), `{kind:"store"}`, `{kind:"shelves"}` (all-shelves
  overview), `{kind:"novel",…}`. The status filter is deliberately
  ephemeral (not in history); destinations like store/novel are in history.
- Reusable pieces to build on: `AnimatedDialog` (scrim + enter/exit),
  `ConfirmDialog`, `NewShelfDialog` (named-input dialog), `ContextMenu`
  (card right-click: status submenu + delete), `Button` (variants
  primary/outline/destructive, `surface="onImage"`), `VirtualList`,
  `Toast`, `BookCover`/`NovelCard`, `SectionCarousel` (horizontal scroll
  row). Theme tokens: `bg/paper/ink/muted/rule/ruleStrong/chrome/
  chromeHover/hover`, accent `#c96442`.

## 3. Decisions (agreed)

1. **Multiple shelves per book** — yes.
2. **Default shelves (Favorites / To-read)** — normal, fully
   editable/deletable (just seeded once).
3. **Remove one book from a shelf** — *smart*: if the book is still on
   another shelf, unshelve silently (with an Undo toast); only when the
   book would be left on **no** shelf, show a "Keep in library?" dialog
   (default = keep).
4. **Delete a whole shelf** — its books **stay in the library** (delete
   only removes the grouping). A simple destructive confirm, not a
   keep/delete choice. (Rationale: the library is the superset; a
   multi-book delete default is a footgun; books can still be deleted
   individually.)
5. **Shelves overview layout** — each shelf is a **horizontal scroll row**
   of covers ending in an add tile.
6. **Single-book shelf control** — a **"Shelves" button** in the hero
   action cluster opening a **checklist popover** of all shelves.
7. **Per-shelf page from the sidebar** — clicking a shelf in the sidebar
   opens that shelf's **own dedicated page** (a full grid), parallel to how
   Library sub-items open a filtered view.

## 4. Non-goals (YAGNI)

- No per-shelf manual ordering of books (books render in library order).
- No shelf colors / covers / icons / descriptions.
- No drag-and-drop between shelves.
- No cross-device sync (local only, like the rest of the library).
- No nested shelves.

## 5. Data model & persistence

### 5.1 Shelf identity

```ts
// src/store/shelves.ts
export interface Shelf {
  id: string;        // stable — rename never breaks membership
  name: string;
  createdAt: number;
  order: number;     // display order in sidebar + overview
}
```

Persisted as `leaflet/shelves.json` (sibling of `library.json`):
`{ shelves: Shelf[] }`. `id` generated the same way book ids are generated
in `library.ts` (verify the existing scheme at implementation time; use
`crypto.randomUUID()` if there is no shared helper).

### 5.2 Membership on the book

Add one optional field to `BookIndexEntry` (in `library.ts`), persisted in
the existing `library.json`:

```ts
/** Ids of the shelves this book is on. Absent on older entries → []. */
shelfIds?: string[];
```

This keeps every query cheap and one-directional:
- a shelf's books: `books.filter(b => b.shelfIds?.includes(shelfId))`
- shelves a book is on: `book.shelfIds ?? []`
- orphan check on unshelve: `(book.shelfIds ?? []).filter(id => id !== shelfId).length === 0`

### 5.3 Migration / first run

- `library.json`: additive optional field → older entries read back with
  `shelfIds === undefined`, treated as `[]`. No migration code needed.
- `shelves.json`: on first load, if the file is absent, seed it with the
  two default shelves (names from `shelves.defaultFavorites` /
  `shelves.defaultToRead`, each with a fresh id, `order` 0 and 1). After
  that, `shelves.json` is the source of truth and the i18n defaults are no
  longer consulted.
- When a shelf is deleted, its id is removed from every book's `shelfIds`
  (a single index sweep) so no dangling references remain.

## 6. Store API

### 6.1 `src/store/shelves.ts` (new)

```ts
listShelves(): Promise<Shelf[]>                 // seeds defaults on first run
createShelf(name: string): Promise<Shelf>
renameShelf(id: string, name: string): Promise<void>
deleteShelf(id: string): Promise<void>          // also strips id from all books' shelfIds
```

`deleteShelf` calls into the library store to sweep `shelfIds` (see 6.2).

### 6.2 `src/store/library.ts` (add)

```ts
/** Set the shelves a book belongs to (mirrors updateBookStatus). */
updateBookShelfIds(bookId: string, shelfIds: string[]): Promise<void>

/** Remove one shelf id from every book that has it — used by deleteShelf. */
removeShelfFromAllBooks(shelfId: string): Promise<void>
```

Both read/modify/write the index via the existing `readIndex`/`writeIndex`.

## 7. Navigation

Add one `LibraryView` variant:

```ts
| { kind: "shelfDetail"; shelfId: string }
```

- Convenience navigator: `goShelf(shelfId)` → `goLibrary({kind:"shelfDetail", shelfId})`.
- This is a real destination (in history, back/forward works), matching
  store/novel — unlike the ephemeral status filter.
- `Library.tsx` body switch gains a `view.kind === "shelfDetail"` branch;
  `AnimatedSwap` viewKey includes `shelf:${shelfId}` so switching shelves
  cross-fades.

## 8. UI components

Props are `string[]` → `Shelf[]` wherever shelves are passed
(`Library` → `LibrarySidebar`, `ShelvesPage`). Duplicate-name checks in the
name dialog compare against `Shelf.name`.

### 8.1 Shelves overview — `ShelvesPage.tsx` (rewrite)

For each shelf, a **section**:
- **Header row**: layers icon · shelf name (clicking name/section →
  `goShelf(id)`) · book count · a `⋯` overflow button (hover-revealed on
  desktop, always visible on touch) opening a small menu: **Rename**,
  **Delete**.
- **Body**: a horizontal scroll row (reuse/adapt `SectionCarousel`) of
  compact cover cards, ending with a dashed **add tile** (plus icon).
  - Cover click → open the book (its detail view).
  - Cover hover shows a small **×** ("remove from shelf") — see 8.6.
- **Empty shelf**: the row contains **only the add tile** (plus a short
  "Add a book" label). This is the same add affordance as when the shelf
  has books — satisfying the "empty shelf gets an add button" requirement
  without a separate placeholder string.

The page keeps its title/count header and "New shelf" button (already
present).

### 8.2 Single-shelf page (new, rendered by `Library.tsx` for `shelfDetail`)

A focused page for one shelf:
- **Header**: shelf name + count + actions (Rename, Delete, Add) — same
  operations as the overview's `⋯`, surfaced as a small toolbar.
- **Body**: the **existing Library book grid**, filtered to
  `books.filter(b => b.shelfIds?.includes(shelfId))`. Reuse the same grid
  component the Library home uses so cards, covers, context menus, and
  empty state stay identical. Empty grid shows the add affordance.

This mirrors "Library parent = all books; sub-item = focused view," but the
shelf dimension is a nav destination rather than an ephemeral filter.

### 8.3 Add-tile menu (progressive disclosure) — new small popover

Clicking any add tile / add affordance opens a 2-item anchored popover
(styled like `ContextMenu`):
- **Add from library** → opens the picker (8.4) scoped to this shelf.
- **Add from device** → runs the existing import flow
  (`pickBooksForImport` → import queue). On successful import, the new
  book id(s) get this `shelfId` appended to their `shelfIds`
  (`updateBookShelfIds`). Reuses all existing import UI/progress.

### 8.4 "Add from library" picker — `AddToShelfDialog.tsx` (new)

`AnimatedDialog` + card:
- **Search field** (filters by title/author).
- **Multi-select list**: row = cover thumb · title · author · a
  select control. Tap toggles selection. `VirtualList` when the library is
  large (≥ ~50 rows).
- Books **already on this shelf** render as "on shelf" (checked,
  non-actionable) so they can't be double-added.
- **Footer**: primary **"Add {n}"** (disabled when n = 0) + Cancel.
- On confirm: append `shelfId` to each selected book's `shelfIds`; toast
  "Added {n} to {shelf}".

### 8.5 Single-book shelf control — `NovelDetailView.tsx`

Add a **Shelves** action to the hero action cluster (`Button`,
`surface="onImage"`, layers/bookmark icon). It opens a **checklist
popover** of all shelves:
- Each row: checkbox + shelf name; checked = book is on that shelf.
- Toggling immediately calls `updateBookShelfIds` for this book.
- Footer: **+ New shelf** (opens the shelf-name dialog; on create, the new
  shelf is added and the book is placed on it).
- **No orphan/keep-in-library prompt here** — this screen is pure
  membership editing and never deletes the book (you're on its page).
  Unchecking the last shelf just leaves the book in the library.

### 8.6 Remove-from-shelf flow (smart) — shelves overview + card menu

Entry points: a cover's hover **×** on the overview/section, and a
**"Remove from shelf"** item added to `ContextMenu` when a card is shown in
a shelf context.

Logic on "remove book B from shelf S":
- If `B` is still on another shelf → `updateBookShelfIds(B, without S)`
  silently + **Undo** toast ("Removed from {shelf}" · Undo restores S).
- If `S` was `B`'s only shelf → open a `ConfirmDialog`:
  - Title: "Keep {title} in your library?"
  - **Keep in library** (default, focused, outline) → just unshelve.
  - **Remove from library** (destructive) → `deleteBook(B)` (existing).

### 8.7 Shelf name dialog — generalize `NewShelfDialog.tsx`

Extend to serve both **create** and **rename**:
- Props gain `initialName?: string`, `title?`, `confirmLabel?`.
- Duplicate check ignores the shelf being renamed (compare against other
  shelves' names).
- Create path unchanged; rename path calls `renameShelf`.

### 8.8 Delete shelf confirm — `ConfirmDialog`

- Title: "Delete "{name}"?"
- Message: "Its {n} books stay in your library."
- Confirm (destructive): "Delete shelf" → `deleteShelf(id)` (sweeps
  `shelfIds`). If the user was on that shelf's page, navigate back to the
  shelves overview.

### 8.9 Sidebar — `LibrarySidebar.tsx`

- `shelves` prop becomes `Shelf[]`.
- Each shelf tree item: `onClick={() => onOpenShelf(shelf.id)}`,
  `active={view.kind === "shelfDetail" && view.shelfId === shelf.id}`.
- "New shelf" item unchanged.

## 9. i18n

Reuse existing keys where possible (`shelves.*`, `sidebar.*`,
`common.cancel`). Add (both `ar.ts` and `en.ts`):
- `shelves.rename`, `shelves.renameTitle`, `shelves.delete`,
  `shelves.deleteTitle`, `shelves.deleteBody` (with `{n}`),
  `shelves.addBook`, `shelves.addFromLibrary`, `shelves.addFromDevice`,
  `shelves.emptyRowHint` ("Add a book"),
  `shelves.pickerTitle`, `shelves.pickerSearch`, `shelves.pickerAdd`
  (with `{n}`), `shelves.onShelf`,
  `shelves.removeFromShelf`, `shelves.removedToast` (with `{shelf}`),
  `common.undo`,
  `shelves.keepTitle` (with `{title}`), `shelves.keepInLibrary`,
  `shelves.removeFromLibrary`,
  `shelves.addedToast` (with `{n}`, `{shelf}`),
  `novel.shelves` (hero button label), `novel.newShelf`.
- Count strings already exist (`shelves.zeroBooks`); add a general
  `shelves.bookCount` (with `{n}`) if a non-zero count string is missing.

## 10. Edge cases

- Renaming to a duplicate name → inline error (existing dupe UI).
- Deleting the shelf you're currently viewing → route back to overview.
- A book on 0 shelves is normal (lives only in the library); it simply
  appears on no shelf.
- Import from the add-tile that the user cancels → no shelf assignment, no
  error.
- Removing the last book from a shelf via the smart flow leaves an empty
  shelf showing the add tile.
- `shelfIds` referencing a since-deleted shelf can't happen because delete
  sweeps them; defensively, the overview ignores unknown ids.

## 11. Testing

- **Store unit tests** (`shelves.ts`, new `library.ts` helpers): seed
  defaults on first run; create/rename/delete; `deleteShelf` strips ids
  from books; `updateBookShelfIds` add/remove; orphan predicate.
- **Persistence round-trip**: write shelves + membership, reload, assert
  equality; older `library.json` without `shelfIds` loads as `[]`.
- **Component/interaction** (per existing harness conventions): add tile
  menu → picker multi-select adds books; smart remove (orphan vs
  non-orphan) branches; delete-shelf keeps books; single-book checklist
  toggles membership; sidebar shelf click routes to `shelfDetail` and
  highlights.
- **Manual/RTL**: verify Arabic layout of the overview rows, picker,
  checklist popover, and dialogs; both light and dark/oled themes; the
  screenshot's empty-shelf case now shows the add tile.

## 12. Files touched

New:
- `src/store/shelves.ts`
- `src/components/AddToShelfDialog.tsx`
- (single-shelf page + add-tile menu + checklist popover may be new small
  components or live inside `ShelvesPage`/`NovelDetailView` — decided in the
  plan; keep each unit focused).

Modified:
- `src/store/library.ts` (`shelfIds` field, `updateBookShelfIds`,
  `removeShelfFromAllBooks`)
- `src/store/navigation.ts` (`shelfDetail` view, `goShelf`)
- `src/components/Library.tsx` (shelves state → store-backed `Shelf[]`,
  `shelfDetail` body branch, wiring for add/remove/rename/delete, toasts)
- `src/components/ShelvesPage.tsx` (rewrite: rows + add tile + section menu)
- `src/components/LibrarySidebar.tsx` (`Shelf[]`, per-shelf navigation +
  active state)
- `src/components/NewShelfDialog.tsx` (create + rename)
- `src/components/NovelDetailView.tsx` (Shelves button + checklist popover)
- `src/components/ContextMenu.tsx` ("Remove from shelf" in shelf context)
- `src/i18n/ar.ts`, `src/i18n/en.ts` (new keys)
