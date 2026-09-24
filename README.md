<div align="center">

<img src="public/brand/mark-ink.webp" width="96" alt="Riwaq"/>

# رواق · Riwaq

**A calm, offline-first e-book reader.**
EPUB · PDF · Word — Windows, macOS, Linux and Android.

<a href="https://github.com/TheMostafaOsamaDev/Riwaq-Reader/releases/latest"><img height="60" alt="Download from GitHub Releases" src="https://img.shields.io/badge/Download-GitHub%20Releases-3a2f1f?style=for-the-badge&logo=github"/></a>
<a href="https://f-droid.org/packages/com.riwaq.reader"><img height="60" alt="Get it on F-Droid" src="https://fdroid.gitlab.io/artwork/badge/get-it-on.png"/></a>
<a href="https://flathub.org/apps/io.github.themostafaosamadev.Riwaq"><img height="60" alt="Get it on Flathub" src="https://flathub.org/api/badge?svg&locale=en"/></a>
<a href="https://github.com/RookieEnough/Orion-Store"><img height="60" alt="Get it on Orion Store" src="https://raw.githubusercontent.com/RookieEnough/Orion-Store/refs/heads/main/assets/orion-badge.png"/></a>

<sub>F-Droid, Flathub and Orion listings are in review — GitHub Releases works today.</sub>

</div>

---

Riwaq (رواق) is a reading app for people who read a lot, in Arabic and in English, and who
would rather own their books than rent them. No account. No sync. No telemetry. Everything
is a file on your disk.

What follows is the app in the order you'd meet it.

---

## 1 · You start with a library

Books come in from a file picker, a folder of EPUBs, drag and drop, or **Open with** from
your file manager and Android's share sheet. Re-importing the same file reuses the book
rather than duplicating it.

![The Riwaq library on desktop](docs/screenshots/desktop/01-library.png)

Progress sits on every cover. Format badges mark PDFs and Word files, source badges mark
web novels. Filter by Reading, Finished or Wishlist, or make shelves of your own. `⌘K`
opens a palette over the whole app — find a book as you type, or jump to any view.

---

## 2 · Or you find one on the web

Riwaq browses Arabic web-novel sites from inside the app, rendering each site's own home
page as native carousels and searching it without opening a browser.

![Browsing a source in the Store](docs/screenshots/desktop/11-store-browse.png)

Every novel gets a real detail page — synopsis, genres, volumes, the full chapter list.
From here you can read it online, add it to your library, download a range of chapters, or
bake the whole novel into a standalone EPUB.

![A novel detail page](docs/screenshots/desktop/12-store-novel.png)

**No website is compiled into Riwaq.** Every source is an extension, installed from a
repository and updated on its own schedule — so a site that changes its markup gets fixed
without waiting for a new version of the app. Riwaq's own repository is configured out of
the box; add another and its extensions appear beside them.

![The extensions manager](docs/screenshots/desktop/25-extensions.png)

An extension runs inside the app, with the app's reach, so adding a repository asks you to
confirm you trust whoever publishes it. A repository that can't be reached falls back to the
copy saved on your device rather than emptying the list.

![Repositories, with Riwaq's own and a field to add another](docs/screenshots/desktop/26-extension-repos.png)

---

## 3 · Then you read it

The reader is the point, and most of the work went here.

![Reading, two-page RTL spread](docs/screenshots/desktop/02-reader.png)

**Sixteen bundled faces** across Naskh book faces, modern sans, Kufi and display. One
picker drives both scripts: every row previews Arabic and Latin side by side. Each face is
corrected to a common apparent size, so `17px` reads the same whichever you pick — the size
slider keeps meaning one thing across all sixteen.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/desktop/05-fonts.png" alt="Font picker previewing both scripts"/></td>
<td width="50%"><img src="docs/screenshots/desktop/04-typography.png" alt="Typography controls"/></td>
</tr>
</table>

Then tune it: size, line height, letter spacing, paragraph spacing, content width,
alignment, hyphenation. Read as two pages, a single page, or a continuous scroll. Four
themes — Light, Sepia, Dark, true-black OLED — or follow the system.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/desktop/19-dark-reader.png" alt="Reader in dark theme"/></td>
<td width="50%"><img src="docs/screenshots/desktop/18-arabic-rtl.png" alt="The interface in Arabic, fully right-to-left"/></td>
</tr>
</table>

Switch the interface to العربية and it mirrors all the way down — sidebar to the right,
icons flipped, every label followed through. Right-to-left is first-class here, not a
stylesheet afterthought.

---

## 4 · And when you want only the book

One control and everything but the page disappears. No toolbar, no progress bar, no chrome
— on the phone, not even the Android system bars.

![Focus mode](docs/screenshots/desktop/03-focus-mode.png)

On desktop the controls return when the pointer nears an edge. The phone has no pointer, so
it says what it is instead: entering names the mode and the way out, and a small lock stays
in the corner so a reader who looks away and back can still tell. Leaving takes a deliberate
double-tap — or a tap on that lock, which is a real button, because a mode whose only exit
is a gesture is a mode someone can get stuck in.

<table>
<tr>
<td width="33%"><img src="docs/screenshots/mobile/02-reader.png" alt="Focus mode lives in the header's corner"/><br/><b>Enter</b> — from the header</td>
<td width="33%"><img src="docs/screenshots/mobile/09-focus-entry.png" alt="Entering names the mode and the exit"/><br/><b>Arrive</b> — it says what it is</td>
<td width="33%"><img src="docs/screenshots/mobile/10-focus-mode.png" alt="At rest: the page, and a lock"/><br/><b>Stay</b> — the page, and a lock</td>
</tr>
</table>

---

## 5 · You mark what mattered

Select any passage, pick one of four colours, attach a note about why. The sidebar collects
every highlight in the book with its chapter, so you can walk back through them later.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/desktop/07-highlight-colors.png" alt="Highlight colour picker on a selection"/></td>
<td width="50%"><img src="docs/screenshots/desktop/06-highlights.png" alt="Highlights and notes sidebar"/></td>
</tr>
</table>

Navigation keeps up: contents grouped by volume, chapter search, a *Now* marker and
jump-to-current, and a scrubber across the whole book.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/desktop/08-contents.png" alt="Contents"/></td>
<td width="50%"><img src="docs/screenshots/desktop/09-progress.png" alt="Progress"/></td>
</tr>
</table>

---

## 6 · You keep it, or you don't

A real download queue: per-chapter and per-volume, concurrency limits, Wi-Fi-only mode,
retry for interrupted jobs, notifications while it works.

![Download queue](docs/screenshots/desktop/13-downloads.png)

Baking a novel into an EPUB asks how you want it — one file, or one per volume, which for a
fourteen-volume novel is the difference between a book you can finish and a book you can
only scroll.

![Saving a novel as a standalone EPUB](docs/screenshots/desktop/27-save-as-epub.png)

And you can take it back. Hover a downloaded chapter and its marker becomes a delete button
— one click, and a toast offers the download straight back. A volume will drop just the
chapters you've read, or all of them; or long-press (right-click on desktop) to select a run
and delete the lot. Deleting only removes the file: the chapter stays in the list, still
readable online, and your reading progress is untouched.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/desktop/23-delete-selection.png" alt="Several chapters selected for deletion"/></td>
<td width="50%"><img src="docs/screenshots/desktop/24-delete-volume-menu.png" alt="A volume offering to delete read downloads or all"/></td>
</tr>
</table>

---

## 7 · It reads more than EPUB

PDFs render through pdf.js with their own page controls — fit to width or page, scroll or
paged flow, zoom, and a page tint that dims or inverts a harsh scan. Word documents are
converted on import, with a step to pick the cover and review images first.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/desktop/14-pdf.png" alt="Reading an Arabic PDF"/></td>
<td width="50%"><img src="docs/screenshots/desktop/15-pdf-controls.png" alt="PDF page controls"/></td>
</tr>
</table>

---

## 8 · And it does the same on a phone

One codebase, two shells: bottom navigation and sheets on a phone, a sidebar and panels on
a desktop. Not a responsive compromise — each is laid out for the device it's on.

<table>
  <tr>
    <td align="center" width="25%"><img src="docs/screenshots/mobile/01-library.png" alt="Library"/><br/><b>Library</b></td>
    <td align="center" width="25%"><img src="docs/screenshots/mobile/03-reading-sheet.png" alt="Reading sheet"/><br/><b>Reading sheet</b></td>
    <td align="center" width="25%"><img src="docs/screenshots/mobile/05-toc.png" alt="Contents"/><br/><b>Contents</b></td>
    <td align="center" width="25%"><img src="docs/screenshots/mobile/07-store.png" alt="Store"/><br/><b>Store</b></td>
  </tr>
  <tr>
    <td align="center" width="25%"><img src="docs/screenshots/mobile/04-novel-detail.png" alt="Novel"/><br/><b>Novel</b></td>
    <td align="center" width="25%"><img src="docs/screenshots/mobile/06-pdf.png" alt="PDF"/><br/><b>PDF</b></td>
    <td align="center" width="25%"><img src="docs/screenshots/mobile/08-settings.png" alt="Settings"/><br/><b>Settings</b></td>
    <td align="center" width="25%"><img src="docs/screenshots/desktop/17-settings.png" alt="Desktop settings"/><br/><b>…and on desktop</b></td>
  </tr>
</table>

---

## Everything else, briefly

| | |
|---|---|
| **Formats** | EPUB 2 / 3, PDF, `.docx` |
| **Reader** | Two-page / single-page / scrolling, tap-to-turn with adjustable zones, page-turn animation, keep-screen-awake |
| **Settings** | A full settings page with its own search. Export, import, or reset every preference. |
| **Privacy** | No account, no sync, no telemetry. State is plain JSON on your disk. The only network traffic is the Store, when you use it. |
| **Licence** | [MIT](LICENSE). Every bundled font ships with its own licence text. |

---

## Download

Builds are attached to each [GitHub Release](https://github.com/TheMostafaOsamaDev/Riwaq-Reader/releases).
Pick the file for your platform:

| Platform | File |
|---|---|
| **Windows** (most PCs) | `Riwaq_<ver>_x64-setup.exe` |
| **Windows on ARM** | `Riwaq_<ver>_arm64-setup.exe` |
| **macOS** (Intel **and** Apple Silicon) | `Riwaq_<ver>_universal.dmg` |
| **Linux** — Debian / Ubuntu | `Riwaq_<ver>_amd64.deb` · `_arm64.deb` |
| **Linux** — Fedora / RHEL | `Riwaq-<ver>-1.x86_64.rpm` · `.aarch64.rpm` |
| **Linux** — portable | `Riwaq_<ver>_amd64.AppImage` · `_aarch64.AppImage` |
| **Android** | `app-universal-release.apk` |

Windows ships the NSIS installer only. The `.msi` was dropped in v0.2.0 so there
is one install path and one upgrade path — if you installed v0.1.0 from the
`.msi`, uninstall it before installing a newer version.

### Android: get updates automatically

Riwaq can tell you when a new version exists, but on Android it cannot install
one — that is how sideloaded APKs work, so you would be tapping through a
download every time. [Obtainium](https://github.com/ImranR98/Obtainium) removes
that: it watches this repository and installs each release for you, the way an
app store would, with no account and nothing else in the middle.

<a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/%7B%22id%22%3A%22com.riwaq.reader%22%2C%22url%22%3A%22https%3A%2F%2Fgithub.com%2FTheMostafaOsamaDev%2FRiwaq-Reader%22%2C%22author%22%3A%22TheMostafaOsamaDev%22%2C%22name%22%3A%22Riwaq%22%7D"><img height="54" alt="Get Riwaq on Obtainium" src="https://raw.githubusercontent.com/ImranR98/Obtainium/main/assets/graphics/badge_obtainium.png"></a>

Open that on the phone itself. It hands Obtainium the whole app definition —
id, repository, name — so there is nothing to type. Without Obtainium
installed, the link explains where to get it rather than failing silently.

Prefer to do it by hand? Add `https://github.com/TheMostafaOsamaDev/Riwaq-Reader`
as a **GitHub** source in Obtainium, or just grab the `.apk` above.

### First launch

The builds aren't code-signed yet, so desktop systems warn once. These steps don't recur.

<details>
<summary><b>Windows</b></summary>

SmartScreen shows *"Windows protected your PC"* → **More info** → **Run anyway**.
Or before launching: right-click the installer → **Properties** → tick **Unblock** → OK.
</details>

<details>
<summary><b>macOS</b></summary>

Gatekeeper blocks unsigned, un-notarized apps. Open the `.dmg`, drag **Riwaq** to
Applications, then **right-click the app → Open → Open**. If it still refuses, clear the
quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/Riwaq.app
```
</details>

<details>
<summary><b>Linux</b></summary>

The `.deb` / `.rpm` install and run as-is. For the AppImage, mark it executable first:

```bash
chmod +x Riwaq_*.AppImage && ./Riwaq_*.AppImage
```
</details>

<details>
<summary><b>Android</b></summary>

Sideload the APK — your browser or file manager will ask you to allow *"install from
unknown sources"*. Play Store distribution isn't planned; F-Droid is a possible future
channel.
</details>

<details>
<summary><b>Verifying your download</b></summary>

Every release ships a `SHA256SUMS` manifest. Put it next to your download and check:

- Linux: `sha256sum --ignore-missing -c SHA256SUMS`
- macOS: `shasum -a 256 <file>`, then compare with the matching line in `SHA256SUMS`
</details>

### Updates

Riwaq asks GitHub, at most once a day, whether a newer version exists. That is
the only network request the app makes on its own behalf, and it is a single
unauthenticated GET for one static file. **Nothing about you or your books is
sent** — no identifiers, no library contents, no reading data — and nothing is
downloaded until you tap Update.

Turn it off in **Settings → About → Check for updates**, and the app stays
fully functional with it off.

Where a new version can be installed from inside the app, it is: Windows, macOS,
and Linux via the AppImage. The other three — Android, and Linux `.deb`/`.rpm`
— can't be updated in place, so Riwaq shows the same notice and takes you to the
download instead. That is a limitation of how those packages install, not a
choice about who gets updates.

---

## Sources

Sources are extensions, published from
[Riwaq-Extensions](https://github.com/TheMostafaOsamaDev/Riwaq-Extensions) — the repository
Riwaq is configured with out of the box. The roster changes there rather than here, so
**Store → Extensions** in the app is always the current list. At the time of writing it
offers:

| Extension | Site | What it carries |
|---|---|---|
| **فضاء الروايات** | [cenele.com](https://cenele.com) | Chinese and Korean web novels translated into Arabic. Some pages sit behind bot protection, so the first request to a chapter may need a session refresh. |
| **ملوك الروايات** | [kolnovel.com](https://kolnovel.com) | Arabic translations of web novels from KolNovel. |
| **بحر الروايات** | [seanovel.org](https://seanovel.org) | Korean, Chinese and Japanese web novels translated into Arabic. |
| **شمس الروايات** | [sunovels.com](https://sunovels.com) | Arabic translated and original web novels, updated daily. |

Riwaq hosts and redistributes nothing. The Store reads publicly available pages so you can
read them offline. Support the translators and official releases where they exist.

---

## Development

```bash
pnpm install
pnpm tauri dev          # desktop, with Vite HMR
pnpm android:dev        # Android, on a device or emulator
pnpm test               # unit tests (Vitest)
pnpm check              # format, lint, typecheck, build, test — what CI runs
pnpm tauri build        # production bundles for the current OS
```

Vite serves on port **1420** (HMR on 1421) and a single dev server backs both the desktop
window and Android at once. For Android, the device must reach the host over your LAN — or
use `adb reverse tcp:1420 tcp:1420` on an emulator.

[`CONTRIBUTING.md`](CONTRIBUTING.md) covers the conventions worth knowing before the first
PR. More detail lives in [`docs/`](docs/): [`setup.md`](docs/setup.md) for toolchains and
bundling, [`architecture.md`](docs/architecture.md) for module boundaries and data flow,
[`ANDROID.md`](docs/ANDROID.md) for the Android specifics,
[`store-feature/`](docs/store-feature/README.md) for how source extensions work, and
[`maintenance.md`](docs/maintenance.md) for the periodic housekeeping.

### Stack

- **[Tauri 2](https://tauri.app)** — desktop + mobile shell (Rust)
- **[React 19](https://react.dev)** + **TypeScript** + **[Vite](https://vite.dev)**
- **[pdf.js](https://mozilla.github.io/pdf.js/)** for PDFs, **[JSZip](https://stuk.github.io/jszip/)** for EPUB, **[Mammoth](https://github.com/mwilliamson/mammoth.js)** for `.docx`
- State persists as JSON through Tauri's filesystem plugin — no SQLite, no IndexedDB, no server

---

## Fonts

Every face ships inside the app and is served locally — Riwaq makes no font requests at
runtime.

Bundled under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL), each with its
license text alongside it in [`public/fonts/`](public/fonts):

**Readex Pro** (interface) · **Noto Naskh Arabic** · **Scheherazade New** ·
**Markazi Text** · **Mirza** · **Lateef** · **Cairo** · **Tajawal** · **Almarai** ·
**IBM Plex Sans Arabic** · **Alexandria** · **Vazirmatn** · **El Messiri** ·
**Noto Kufi Arabic** · **Changa** · **Lalezar**

Every bundled face carries its license text. Nothing ships without one.

---

## License

[MIT](LICENSE).
