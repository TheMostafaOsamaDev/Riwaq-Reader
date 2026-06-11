# Leaflet

E-book reader for Arabic readers and Asian web-novel translations. Local-first, cross-platform, no accounts, no telemetry.

![Leaflet — the Library on desktop](docs/screenshots/desktop/01-library.png)

## What it is

Leaflet is a cross-platform e-book reader (desktop + mobile) built on Tauri 2 and React 19. It reads EPUB and `.docx` files from disk, ships an in-app Store that browses two Arabic web-novel sources, and is tuned for Arabic typography — RTL flow, dedicated reading fonts, theming for long sessions.

Everything is local. Books and reading state live in your own filesystem.

## Features

- **Library** — shelf with reading progress, status filters (Reading / Finished / Wishlist)
- **Reader** — paginated or scrolling layout, theme picker, font + size controls, dynamic line-height
- **Highlights & notes** — text-level highlights in four colors, with optional notes; sidebar to revisit them
- **Themes** — sepia (default), paper, dark
- **Import** — direct EPUB, folder import, `.docx` import with auto-conversion (via Mammoth)
- **Store** — browse novel sources, download chapters as offline EPUB, or stream live in a built-in reader
- **Download queue** — system-level notifications track per-volume progress, survives app restarts
- **Mobile + desktop** — same codebase, layout-aware shells; phone shows a bottom nav, desktop shows a header strip

## Screenshots

### Desktop

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/desktop/02-reader.png" alt="Reader" width="100%"/><br/><b>Reader</b> — paginated or scrolling, RTL-aware typography</td>
    <td width="50%"><img src="docs/screenshots/desktop/03-customize-reading.png" alt="Reading appearance & typography" width="100%"/><br/><b>Customize</b> — themes, fonts, size, line-height, width</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/desktop/04-taking-note.png" alt="Taking a note" width="100%"/><br/><b>Notes</b> — attach a note to any passage</td>
    <td width="50%"><img src="docs/screenshots/desktop/05-highlights-sidebar.png" alt="Highlights & notes sidebar" width="100%"/><br/><b>Highlights</b> — revisit highlights &amp; notes from the sidebar</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/desktop/06-store.png" alt="Store sources" width="100%"/><br/><b>Store</b> — browse supported novel sources</td>
    <td width="50%"><img src="docs/screenshots/desktop/07-word-import.png" alt="Word document import" width="100%"/><br/><b>Import</b> — bring in <code>.docx</code> documents</td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/desktop/08-edit-book.png" alt="Edit book metadata" width="100%"/><br/><b>Edit</b> — title, author, description, cover</td>
    <td width="50%"></td>
  </tr>
</table>

### Mobile

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/mobile/01-library.jpg" alt="Library" width="150"/><br/><b>Library</b></td>
    <td align="center"><img src="docs/screenshots/mobile/02-reader.jpg" alt="Reader" width="150"/><br/><b>Reader</b></td>
    <td align="center"><img src="docs/screenshots/mobile/03-customize-reading.jpg" alt="Typography" width="150"/><br/><b>Typography</b></td>
    <td align="center"><img src="docs/screenshots/mobile/04-store.jpg" alt="Store" width="150"/><br/><b>Store</b></td>
    <td align="center"><img src="docs/screenshots/mobile/05-browse-source.jpg" alt="Browse a source" width="150"/><br/><b>Browse</b></td>
  </tr>
</table>

## Install

Pre-built binaries land on [GitHub Releases](https://github.com/TheMostafaOsamaDev/Leaflet-ebook-reader/releases) when a `v*` tag is cut.

**Windows note:** binaries aren't code-signed yet, so SmartScreen will warn. After downloading: right-click the installer → Properties → check "Unblock" → re-run.

**macOS note:** unsigned and un-notarized. Gatekeeper will refuse to open the `.dmg` until you remove the quarantine attribute: `xattr -d com.apple.quarantine /path/to/Leaflet.dmg`.

**Linux:** the AppImage / `.deb` is unsigned but should run as-is.

**Android:** sideload the APK from Releases. Play Store distribution isn't planned — F-Droid is a possible future channel.

## Supported sources

- **[Kolnovel](https://kolnovel.com)** — Arabic translations of Korean / Chinese / Japanese web novels.
- **[Cenele](https://cenele.com)** — Arabic translations of Asian web novels. Some pages are behind Cloudflare bot protection; the first request to a chapter may need a manual session refresh from your system browser.

No content is hosted or redistributed by Leaflet. The Store feature accesses publicly available pages from these sites for personal reading.

## Development

```bash
pnpm install
pnpm tauri dev          # desktop dev (HMR via Vite on :1420)
pnpm tauri android dev  # Android dev (LAN; phone/emulator must reach the host's IP)
pnpm tauri build        # production binaries for the current OS
```

The Vite dev server runs on port 1420 with HMR on 1421. For Android dev, your host firewall must allow your LAN subnet to reach both ports, and the device/emulator must be on the same network as the host.

### Tech stack

- [Tauri 2](https://tauri.app) — cross-platform desktop + mobile shell
- [React 19](https://react.dev) + [TypeScript 5.8](https://typescriptlang.org) + [Vite 7](https://vite.dev)
- [JSZip](https://stuk.github.io/jszip/) for EPUB unpacking, [Mammoth](https://github.com/mwilliamson/mammoth.js) for `.docx`
- All app state persists to disk via Tauri's FS plugin — no SQLite, no IndexedDB, no cloud

## Fonts & attribution

Bundled and used under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL):

- **Readex Pro** — UI typeface (Latin + Arabic, variable)
- **Cairo**, **Lateef**, **Tajawal** — Arabic reading fonts

Loaded from Google Fonts at runtime, also under SIL OFL:

- **Amiri** — Arabic reading font
- **Fraunces**, **Literata** — Latin reading fonts
- **Atkinson Hyperlegible** — high-legibility reading font for accessibility

## License

[MIT](LICENSE) — see the file for full text.

## Disclaimer

Leaflet is a personal-use reader. The Store feature accesses publicly available pages from third-party sites; no content is hosted, modified, or redistributed by this project. Respect translators and content creators — support official channels where they exist.
