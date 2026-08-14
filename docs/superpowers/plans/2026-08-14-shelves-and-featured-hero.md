# Shelves and Featured Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build persistent many-to-many shelves, shelf-aware folder import and add-book flows, plus a reusable, theme-safe featured reading hero.

**Architecture:** Persist shelf records in the local library index and isolate pure name/membership/import-policy helpers for unit testing. Keep import orchestration, dialogs, refreshes, and feedback in `Library`; extract the existing hero into a variant-driven presentation component.

**Tech Stack:** React 19, TypeScript, Vite, Tauri v2, inline token-driven styles, Vitest.

## Global Constraints

- Preserve the current editorial Riwaq direction and use `Theme` tokens; add semantic tokens to all four themes only where necessary.
- Support desktop, Android/mobile, Arabic RTL, light, sepia, dark, and OLED.
- Shelves are many-to-many: assignment never removes membership elsewhere.
- Folder imports skip existing EPUBs, never overwrite library data, and report imported/skipped/error counts.
- Controls require accessible names, 44px mobile targets, visible focus states, Escape cancellation, and reduced-motion-safe transitions.
- Do not add automatic carousel rotation.

---

## File structure

- `src/store/shelves.ts`: pure shelf name, membership, and duplicate policy.
- `src/store/library.ts`: index migration, persistence, shelf APIs, and folder import.
- `src/components/ShelfDestinationDialog.tsx`: library/new/existing destination choice.
- `src/components/ShelfBookPicker.tsx`: existing-library multi-select.
- `src/components/ShelvesPage.tsx`: real shelf sections and add cards.
- `src/components/FeaturedBookHero.tsx`: reusable hero variants.
- `src/components/Library.tsx`: async orchestration and hero integration.
- `src/i18n/en.ts`, `src/i18n/ar.ts`, `src/styles/tokens.ts`: copy and semantic colors.
- `src/store/shelves.test.ts`, `src/components/*.test.tsx`: regression coverage.
- `package.json`, `vite.config.ts`: Vitest setup.

### Task 1: Add test support and pure shelf policy

**Files:**
- Create: `src/store/shelves.ts`, `src/store/shelves.test.ts`
- Modify: `package.json`, `vite.config.ts`

**Interfaces:**
- Produces `type Shelf = { id: string; name: string; bookIds: string[]; createdAt: number }`.
- Produces `normalizeShelfName(name)`, `validateShelfName(name, shelves)`, `addBookIdsToShelf(shelf, ids)`, and `bookIdsNotOnShelf(shelf, ids)`.

- [ ] **Step 1: Write the failing policy tests**

```ts
it("rejects a case-insensitive duplicate shelf name", () => {
  expect(validateShelfName(" favorites ", [{ id: "a", name: "Favorites", bookIds: [], createdAt: 1 }]))
    .toEqual({ ok: false, reason: "duplicate" });
});
it("adds only IDs not already on a shelf", () => {
  expect(addBookIdsToShelf({ id: "a", name: "Favorites", bookIds: ["one"], createdAt: 1 }, ["one", "two", "two"]).bookIds)
    .toEqual(["one", "two"]);
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `pnpm test -- src/store/shelves.test.ts`

Expected: FAIL because the command and helpers do not exist.

- [ ] **Step 3: Add Vitest and implement the helpers**

```ts
export function validateShelfName(name: string, shelves: readonly Shelf[]) {
  const normalized = normalizeShelfName(name);
  if (!normalized) return { ok: false as const, reason: "empty" as const };
  return shelves.some((s) => normalizeShelfName(s.name) === normalized)
    ? { ok: false as const, reason: "duplicate" as const }
    : { ok: true as const };
}
```

Add `"test": "vitest run"` and a `jsdom` test environment.

- [ ] **Step 4: Run focused and full tests**

Run: `pnpm test -- src/store/shelves.test.ts && pnpm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vite.config.ts src/store/shelves.ts src/store/shelves.test.ts
git commit -m "test: add shelf policy coverage"
```

### Task 2: Persist shelves and de-duplicate folder imports

**Files:**
- Modify: `src/store/library.ts`
- Test: `src/store/shelves.test.ts`

**Interfaces:**
- Consumes Task 1 helpers.
- Produces `listShelves()`, `createShelf(name)`, `addBooksToShelf(shelfId, bookIds)`, and `pickAndImportFolder(destination)`.
- Defines `FolderImportDestination = { kind: "library" } | { kind: "new-shelf"; name: string } | { kind: "existing-shelf"; shelfId: string }`.

- [ ] **Step 1: Write migration and duplicate-partition tests**

```ts
it("migrates a legacy index to an empty shelf array", () => {
  expect(normalizeLibraryIndex({ version: 1, books: [] }).shelves).toEqual([]);
});
it("keeps imported duplicates out of candidates", () => {
  expect(partitionImportCandidates(["same.epub", "new.epub"], new Set(["same.epub"])))
    .toEqual({ existing: ["same.epub"], candidates: ["new.epub"] });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- src/store/shelves.test.ts`

Expected: FAIL because normalization and partition helpers are absent.

- [ ] **Step 3: Implement migration, membership, and import policy**

Extend `LibraryFile` with `shelves: Shelf[]`; accept indexes that lack that property. Remove a deleted book ID from every shelf. Persist a stable content fingerprint on locally imported EPUB entries and use it—not only filename—to skip duplicate imports. Assign only successfully imported entries to the requested new or existing shelf.

```ts
export async function addBooksToShelf(shelfId: string, bookIds: string[]) {
  const idx = await readIndex();
  const shelf = idx.shelves.find((item) => item.id === shelfId);
  if (!shelf) return { added: 0, missingShelf: true };
  const valid = new Set(idx.books.map((book) => book.id));
  const next = addBookIdsToShelf(shelf, bookIds.filter((id) => valid.has(id)));
  const added = next.bookIds.length - shelf.bookIds.length;
  Object.assign(shelf, next);
  await writeIndex(idx);
  return { added, missingShelf: false };
}
```

- [ ] **Step 4: Run store tests and typecheck**

Run: `pnpm test -- src/store/shelves.test.ts && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/library.ts src/store/shelves.ts src/store/shelves.test.ts
git commit -m "feat: persist shelf memberships"
```

### Task 3: Create accessible assignment dialogs

**Files:**
- Create: `src/components/ShelfDestinationDialog.tsx`, `src/components/ShelfBookPicker.tsx`, `src/components/ShelfDestinationDialog.test.tsx`, `src/components/ShelfBookPicker.test.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/ar.ts`, `src/styles/tokens.ts`

**Interfaces:**
- `ShelfDestinationDialog` receives shelves and calls `onConfirm(destination)` only for valid data.
- `ShelfBookPicker` receives a target shelf and books, excludes existing member IDs, and calls `onConfirm(bookIds)` with a non-empty selection.

- [ ] **Step 1: Write failing dialog tests**

```tsx
it("disables importing until the new shelf has a unique name", async () => {
  render(<ShelfDestinationDialog {...props} />);
  await user.click(screen.getByRole("radio", { name: /new shelf/i }));
  await user.type(screen.getByLabelText(/shelf name/i), "Favorites");
  expect(screen.getByRole("button", { name: /import/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- src/components/ShelfDestinationDialog.test.tsx`

Expected: FAIL because the dialog does not exist.

- [ ] **Step 3: Implement dialogs**

Use the existing `AnimatedDialog` wrapper from `Library`. Use labelled radio controls, associated error/live text, keyboard focus, Escape/cancel paths, and `theme.bg/paper/ink/muted/rule/hover` plus any named focus token. The book picker uses cover thumbnails, title/author, selected count, and explicit checked state.

- [ ] **Step 4: Run dialog tests**

Run: `pnpm test -- src/components/ShelfDestinationDialog.test.tsx src/components/ShelfBookPicker.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ShelfDestinationDialog.tsx src/components/ShelfBookPicker.tsx src/components/*.test.tsx src/i18n/en.ts src/i18n/ar.ts src/styles/tokens.ts
git commit -m "feat: add shelf assignment dialogs"
```

### Task 4: Wire import destination and shelf add actions through Library

**Files:**
- Modify: `src/components/Library.tsx`, `src/components/LibrarySidebar.tsx`
- Test: `src/components/Library.test.tsx`

**Interfaces:**
- Consumes Task 2 APIs and Task 3 dialogs.
- Passes shelf objects/IDs—not just names—to sidebar and shelf page.
- Provides `onImportFolder(destination)`, `onAddFromFolder(shelfId)`, and `onAddExistingBooks(shelfId, ids)`.

- [ ] **Step 1: Write the failing integration test**

```tsx
it("refreshes and announces imported and skipped counts after existing-shelf import", async () => {
  render(<Library {...libraryProps} />);
  await user.click(screen.getByRole("button", { name: /folder of epubs/i }));
  await user.click(screen.getByRole("radio", { name: /existing shelf/i }));
  await user.click(screen.getByRole("button", { name: /import/i }));
  expect(await screen.findByRole("status")).toHaveTextContent(/imported.*skipped/i);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm test -- src/components/Library.test.tsx`

Expected: FAIL because Library has no destination state.

- [ ] **Step 3: Implement orchestration**

Show destination selection before opening the folder picker. Set busy state only for the actual import, then refresh books/shelves and announce imported, skipped, and error totals. The add-card action chooses folder import or existing-book picker; it never silently changes another shelf membership. Sidebar child rows open their associated shelf.

- [ ] **Step 4: Run focused test and build**

Run: `pnpm test -- src/components/Library.test.tsx && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Library.tsx src/components/LibrarySidebar.tsx src/components/Library.test.tsx src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat: choose shelf during folder import"
```

### Task 5: Render populated shelves and extract the featured hero

**Files:**
- Create: `src/components/FeaturedBookHero.tsx`, `src/components/FeaturedBookHero.test.tsx`, `src/components/ShelvesPage.test.tsx`
- Modify: `src/components/ShelvesPage.tsx`, `src/components/Library.tsx`, `src/styles/tokens.ts`

**Interfaces:**
- `FeaturedBookHero` receives `{ theme, book, coverSrc, variant: "library" | "compact", onPrimaryAction, secondaryActions? }`.
- `ShelvesPage` receives real shelves, books, covers, target-shelf add callbacks, and optional selected shelf ID.

- [ ] **Step 1: Write failing page and hero tests**

```tsx
it("adds a book-sized add card after shelf books", () => {
  render(<ShelvesPage {...props} />);
  expect(screen.getByRole("button", { name: /add books to favorites/i })).toBeVisible();
});
it.each(["light", "sepia", "dark", "oled"] as const)("renders the primary action in %s", (key) => {
  render(<FeaturedBookHero theme={THEMES[key]} book={book} variant="library" onPrimaryAction={vi.fn()} />);
  expect(screen.getByRole("button", { name: /resume reading/i })).toBeEnabled();
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm test -- src/components/ShelvesPage.test.tsx src/components/FeaturedBookHero.test.tsx`

Expected: FAIL because page remains placeholder-only and the hero is not extracted.

- [ ] **Step 3: Implement shelf grids and reusable hero**

Render assigned book cards per shelf; empty shelves show a large add panel, populated shelves append an aspect-ratio-matched add card. Extract desktop/mobile current hero logic into a media layer with a theme-backed gradient/scrim fallback, title, metadata, progress, primary start/resume action, and quiet secondary actions. Library uses `library`; mobile uses `compact`. Preserve cover dimensions, long-press context-menu behavior, title-font selection, RTL logical properties, and no auto-rotation.

- [ ] **Step 4: Run component tests and build**

Run: `pnpm test -- src/components/ShelvesPage.test.tsx src/components/FeaturedBookHero.test.tsx && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/FeaturedBookHero.tsx src/components/FeaturedBookHero.test.tsx src/components/ShelvesPage.tsx src/components/ShelvesPage.test.tsx src/components/Library.tsx src/styles/tokens.ts src/i18n/en.ts src/i18n/ar.ts
git commit -m "feat: add shelf grids and featured reading hero"
```

### Task 6: Production accessibility, theme, and responsive audit

**Files:**
- Modify only files found deficient in Tasks 1–5.

- [ ] **Step 1: Exercise the acceptance matrix**

Run: `pnpm dev`

Check desktop 1440px, tablet 768px, mobile 375px; every theme; English and Arabic; keyboard traversal; Escape; focus visibility; reduced motion; empty/populated shelves; new/existing shelf import; duplicate import; and multi-select assignment.

- [ ] **Step 2: Correct observed defects**

Keep normal text contrast at 4.5:1, retain token-only component colors, use logical layout properties for RTL, reserve image/add-card dimensions, and announce changes via the existing toast/live-region path.

- [ ] **Step 3: Run final verification**

Run: `pnpm test && pnpm build && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 4: Commit the audit fixes**

```bash
git add src package.json pnpm-lock.yaml vite.config.ts
git commit -m "fix: polish shelves and featured hero"
```

