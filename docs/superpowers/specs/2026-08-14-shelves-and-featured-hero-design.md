# Shelves and Featured Reading Hero Design

**Date:** 2026-08-14  
**Status:** Approved design; awaiting written-spec review before implementation

## Goal

Turn shelves into persistent, many-to-many book collections; provide a clear
destination choice when importing EPUB folders; and replace the Library's
one-off continue-reading presentation with a reusable, theme-aware featured
book hero.

## Scope

### Persistent shelves

- Extend the existing local `library.json` index with named shelf records and
  their member book IDs.
- A book can belong to zero, one, or many shelves. Assigning it to one shelf
  never removes it from another.
- New shelf names are trimmed and compared case-insensitively against existing
  shelves. Duplicate names are rejected with an inline, accessible message.
- Existing first-run Favorites and To read shelves continue to be offered, but
  are migrated/persisted rather than remaining component-local state.

### Importing a folder

- After a folder has been selected, show a destination dialog with three
  mutually exclusive choices: Library only, New shelf, Existing shelf.
- New shelf requires a unique name. Existing shelf requires selecting a shelf.
- Books imported from the folder are added to the chosen shelf only after they
  successfully enter the library.
- EPUBs already in the library are skipped by default. Existing library data
  and shelf membership are never overwritten or removed. A summary toast
  reports imported and skipped counts.
- Folder import continues to support per-file errors without cancelling the
  successful imports.

### Adding books from shelves

- Every empty shelf has a focused Add books panel.
- A populated shelf appends a book-sized Add books card to its cover grid.
- The same action sheet offers:
  1. Import an EPUB folder directly into this shelf.
  2. Select one or more books already in the library and add them to this
     shelf.
- The existing-book picker excludes books already assigned to the target shelf
  from selectable results, and reports the number of assignments made.
- All flows can be cancelled without changing membership. Success and failure
  feedback use the existing toast/error mechanisms.

## FeaturedBookHero

- Introduce a reusable `FeaturedBookHero` presentation component with explicit
  variants instead of copying Library markup.
- Library's primary variant is an immersive, cover-art-led continue-reading
  hero: gradient/scrim treatment, reading label, title, author/chapter
  metadata, progress, and an unambiguous primary resume/start action.
- Secondary actions remain present but visually subordinate and accessible.
- A future shelf/context variant is compact and does not inherit Library-only
  actions. It is not required to render on every shelf in this change.
- The initial release features the most recently read eligible book; it does
  not auto-rotate. If multiple active books are later exposed, manual controls
  and optional reading stats can be added without changing the component
  contract.

## Visual, theme, and responsive requirements

- Preserve the existing calm, editorial Riwaq direction and use `Theme` tokens
  for surfaces, text, borders, hover, focus, controls, and progress rather
  than adding raw component colors.
- Where the current theme model cannot represent an accessible semantic state,
  add a named token to every light, sepia, dark, and OLED theme.
- The hero uses cover art only as a background/media layer; a theme-aware
  overlay preserves contrast for all text and actions.
- Add cards match book-grid dimensions and communicate their action with icon,
  label, border, hover/pressed state, and visible keyboard focus.
- Desktop uses a spacious editorial hero; tablet reduces density; mobile
  stacks content and retains 44px controls with no horizontal overflow.
- RTL uses logical alignment/order and avoids Latin-only tracking or casing
  conventions for Arabic copy.
- Animations use opacity/transform only, are short and interruptible, and
  honor `prefers-reduced-motion`.

## Accessibility and error handling

- Dialogs use focus management, Escape dismissal, clear labels, and keyboard
  operability.
- Meaningful cover images retain descriptive alt text; decorative icons are
  hidden from assistive technology when adjacent labels already describe them.
- Error and destination-validation messages are associated with their related
  controls and announced through an appropriate live region.
- No state is conveyed by color alone. Focus, disabled, hover, pressed, and
  selected states remain distinguishable in every theme.

## Architecture

- `src/store/library.ts`: shelf record persistence, membership APIs, and
  duplicate-aware folder-import support.
- `Library`: owns asynchronous actions, refreshes, dialog state, and toast
  reporting, preserving its source-book routing behavior.
- `ShelfDestinationDialog`: selects library-only/new/existing shelf placement
  for a folder import.
- `ShelfBookPicker`: selects unassigned library books for a target shelf.
- `ShelvesPage`: renders real shelf sections and delegates mutations through
  focused callbacks.
- `FeaturedBookHero`: reusable, context-aware hero presentation.

## Verification

- Add unit tests for shelf persistence, add/remove-safe membership operations,
  destination validation, duplicate skip behavior, and eligible featured-book
  selection.
- Run TypeScript/build validation.
- Manually inspect desktop and mobile at light, sepia, dark, and OLED themes,
  including Arabic RTL, keyboard navigation, focus visibility, and reduced
  motion.

## Non-goals

- Drag-and-drop organization, shelf renaming/deletion, and automatic rotating
  carousels are not part of this implementation.
- Individual EPUB import and Word import retain their existing destinations;
  this change targets folder import plus shelf-local add flows.
