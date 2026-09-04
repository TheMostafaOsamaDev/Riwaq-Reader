# Design notes

## Source

The design came as a handoff bundle from Claude Design, extracted to
`/tmp/design-extract/e-book-reader/`. The companion spec export is
`E-Book Reader.html` from the Riwaq design spec.

These notes mirror the tokens actually in `src/styles/tokens.ts` — when the
notes and the code disagree, the code is the source of truth.

Key source files read before implementing:

- `README.md` — instructions ("read the chat first, implement pixel-perfect,
  don't copy the prototype's internal structure unless it fits").
- `chats/chat1.md` — the design conversation. Most important info:
  - **Aesthetic**: warm, sepia-leaning defaults, rounded corners, friendly.
  - **Content**: web-novel tone (Reverend Insanity, Lord of the Mysteries
    vibes — cultivation/mystery fiction).
  - **Mobile gestures**: tap center to show/hide chrome.
  - **Library**: mixed — hero "continue reading" then grid.
  - **Tweaks**: theme (light/sepia/dark/OLED), font family
    (serif/sans/dyslexic), font size, alignment, line-height + letter-
    spacing, RTL toggle.
  - **RTL**: Arabic should be first-class, not a bolt-on.
- `project/reader-core.jsx` — theme tokens, highlight color primitives,
  paragraph renderer, icon set.
- `project/reader-data.jsx` — chapter list, paragraphs (with the inline
  highlight ranges), library, bookmarks, highlights, RTL excerpt.
- `project/reader-panels.jsx` — TOC, Bookmarks, Highlights, Settings panels.
- `project/reader-desktop.jsx` — desktop reader shell.
- `project/reader-mobile.jsx` — mobile reader + library.
- `project/reader-library.jsx` — desktop library hero + grid.

## Themes / tokens

Four themes, all defined in `THEMES` keyed by `light | sepia | dark | oled`.
The Library screenshot uses `sepia`. Tokens were ported verbatim from the
prototype:

| Token | sepia | light | dark | oled |
| --- | --- | --- | --- | --- |
| `bg` | `#f4ecd8` | `#faf8f3` | `#1a1614` | `#000000` |
| `paper` | `#f4ecd8` | `#ffffff` | `#1a1614` | `#000000` |
| `ink` | `#3a2f1f` | `#1f1a14` | `#d8cbb0` | `#b8ad94` |
| `muted` | `#8b7355` | `#8b7e6a` | `#887a60` | `#6a6148` |
| `chrome` | `#ebe0c5` | `#f0ece2` | `#24201c` | `#0c0a08` |
| `rule` | `rgba(58,47,31,0.14)` | `rgba(31,26,20,0.10)` | `rgba(216,203,176,0.14)` | `rgba(184,173,148,0.10)` |

Accent (warm copper amber): `#c96442` — used sparingly, for focus rings and
highlight affordances.

Highlight colors (semantically used as filters in `HighlightsPanel`):

- yellow → "Quotes"
- blue → "Facts"
- pink → "Questions"
- green → "Definitions"

## Typography

- **Fraunces** — display serif, italic by default on headings / logo / book
  titles. Variable font, weights 400–700, optical size 9–144. Falls back to
  `Literata`, `Georgia`.
- **Literata** — body serif, book-optimized. Default reader font; switchable
  to `Atkinson Hyperlegible` (the dyslexic-friendly option) via the Settings
  panel.
- **Inter** — UI chrome / nav / buttons, with `-apple-system` and `system-ui`
  fallbacks.
- **Amiri** — Arabic body/heading font, falling back to `Noto Naskh Arabic`
  and `Scheherazade New`. Used for book titles in RTL languages and the
  reader body when `book.language` matches `ar|he|fa|ur`.

Display font name constant:
`FONT_SERIF_DISPLAY = '"Fraunces", "Literata", Georgia, serif'`.

All fonts are Google-Fonts-hosted and preconnected in `index.html`; no self-
hosting, no font bundling, no `@font-face` rules.

## Library screen layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Riwaq    Library  Reading  Finished  Wishlist              + Import    │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────┐   CONTINUE READING                                         │
│  │ [cover]  │   Book title (big italic serif)                            │
│  │          │   by Author · N chapters                                   │
│  │          │                                                            │
│  │          │   ┌────────────────────────────────────┐                   │
│  │          │   │ ▓▓▓░░░░░░░░░░░░░  1% · 10h ago    │                   │
│  │          │   │ [ Resume reading → ]               │                   │
│  └──────────┘   └────────────────────────────────────┘                   │
│                                                                          │
│  Your shelf                                                              │
│  0 books · sorted by recent                                              │
│                                                                          │
│  [ grid, minmax(140px, 1fr), gap 32 ]                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

## Book covers

Originally, any EPUB that didn't declare a cover through one of the two
standard mechanisms fell through to `BookCover`'s placeholder path — a
palette gradient with the title in italic serif and the author in spaced
small caps.

`BookCover.tsx` already supports an `src` prop and shows a real `<img>` when
it's truthy. The pipeline simply wasn't supplying one for EPUBs that:

- wrap the cover in an XHTML page (Calibre/Sigil convention),
- declare the cover image with `application/octet-stream`, or
- declare no cover at all.

The parser (`src/epub/parser.ts`) was extended to handle those cases. See
`docs/progress.md` for the five-tier resolution logic.

The placeholder path is kept on purpose — for the rare EPUB with genuinely no
image inside, we still want the card to look like a book, not like a blank
rectangle.

## Motion / interaction

- Card hover: soft delete `×` fades in (opacity 0 → 1 over ~120ms) in the
  top-right.
- Nav pills: active pill uses `theme.hover` background, not a solid accent.
- Buttons: dark pill, `theme.ink` background on `theme.bg` text. Hover states
  are minimal by design.
- Reader page turn: handled by the reader itself (`BookBody.tsx`) — not the
  library.

## Responsive rules

- Desktop: `DesktopLibrary` renders via `Library.tsx`. Two-column hero (cover
  left, card right), `repeat(auto-fill, minmax(140px, 1fr))` shelf grid.
- Mobile: `MobileLibrary` — cover inlined next to a compact Continue card;
  shelf collapses to a 3-col grid. Uses `useMediaQuery` to decide which to
  render.

## Pixel-perfectness

Where a value was in the prototype, it was ported verbatim: paddings, border
widths, shadow tuples, `boxShadow` strings on book covers, corner radii. The
only numeric changes:

- Desktop minimum window size set to 720×540 (prototype had no native window;
  720 matches the mobile breakpoint).
- Mobile ribbon top position bumped slightly so it doesn't collide with safe-
  area insets (the prototype used a fixed iOS frame offset).

## Deliberately skipped from the prototype

- `ios-frame.jsx` — fake iPhone chrome used for the design canvas. A real app
  on Android doesn't need it.
- `tweaks-panel.jsx` — floating debug panel wired to the design-canvas host's
  edit protocol. Real reader settings live in `SettingsPanel`.
- `reader-sync.jsx` — a dedicated sync / conflict-resolution splash screen.
  We show cloud-synced status in the topbar but did not port the full
  conflict UI yet (it's a pillar-showcase feature).
- `design-canvas.jsx` — the Figma-style pan/zoom wrapper that presented every
  artboard side by side. The real app is just the artboards.
- The RTL mirrored *chrome* (not content): the prototype mirrored the topbar
  layout when `rtl` was on. We keep the chrome LTR and only flip the reading
  surface — standard for reading apps, avoids re-mirroring the settings UI.
