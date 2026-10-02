# Android in-app updates, and "What's new" everywhere

Date: 2026-10-02
Builds on: [In-app updates: two channels, one banner](2026-09-10-in-app-updates-design.md),
and PR #166 (the update check moved to Rust).

The 2026-09-10 design gave Android a "manual" channel: a banner that opened
the GitHub release page, after which the user found the APK, downloaded it
and installed it by hand. That design ruled out in-app install:
`REQUEST_INSTALL_PACKAGES` alarms people, and the Kotlin is real work. This
design reverses that decision, and adds the piece neither channel ever had:
**telling people what the new version actually does.**

Decided with the user, 2026-10-02, after reviewing clickable mockups
(`.superpowers/brainstorm/…/update-flow.html` in the `Riwaq-update-check`
worktree):

- **Android downloads and installs in-app** (option "B": pill + sheet).
- **F-Droid installs stay silent.** F-Droid ships the update itself, the same
  way Flathub does for Flatpak (#154).
- **Release notes are written by hand, per release, in English and Arabic**,
  and shown before updating, once after updating, and in Settings.
- **Everything temporary is cleaned up**: the APK, the downloaded notes, and
  the "already shown" / "skipped" flags.

## What the user sees

The approved flow, in order. "Pill" means a small floating chip above the
library's bottom bar; "sheet" means a bottom sheet over a scrim.

| # | State | UI | Leads to |
|---|---|---|---|
| 1 | **Available** | Pill: `↑ Update available · 0.6.0 ›` | tap → 2 |
| 2 | **What's new** | Sheet: app icon, version, date, size; the release's *highlight* (image, title, sentence); then every other change as a tagged line (*New / Improved / Fixed*); **Update · 19 MB**, **Later**, **Skip this version** | Update → 4 (or 3 on mobile data); Later → L; Skip → S |
| 3 | **Mobile data** | Same sheet, with a warning row "You're on mobile data. This update is 19 MB." and **Wait for Wi-Fi** / **Update anyway** | Wait → W; anyway → 4 |
| L | **Later** | Pill gone; a **dot on the Settings icon**; a toast "It'll wait for you in Settings → About" with **Show** | Settings → About shows the update card |
| S | **Skipped** | Toast "Riwaq won't remind you about 0.6.0. You'll still hear about the next one." with **Undo** | — |
| 4 | **Downloading** | Sheet closes; the pill becomes a **progress ring** `◔ Downloading · 37%`; Android's notification shows the same progress | tap pill → sheet with bar, MB, **Cancel** / **Hide** |
| W | **Waiting for Wi-Fi** | Quiet pill `Waiting for Wi-Fi · 0.6.0` | starts on its own when an unmetered network appears |
| F | **Failed** | Red pill `Download failed · Retry` → sheet: "Your connection dropped at 62%. Nothing was changed." **Resume download** | resumes from the byte it stopped at |
| 5 | **First time: allow** | Our sheet explains Android's one-time "Allow from this source" switch, then **Open Android settings** | Android's settings screen; returning re-checks automatically |
| 6 | **Ready** | Sheet: "Downloaded and verified. Your books, highlights and progress stay exactly where they are." **Install now** | Android's own install dialog |
| 7 | **After updating** | Once, on the first launch of the new version: **story pages** if the release defines them (big releases), otherwise a **short list** sheet with **Got it** | Settings → About → *What's new in this version* reopens it any time |

Settings → About gains: an update card (version, one-line summary, **See
what's new**, **Update**), and an **Over mobile data** row (*Ask first*
(default) / *Always* / *Wait for Wi-Fi*). **Check now** becomes a full-width
button with its result line under it.

**The "Check for updates" on/off toggle is removed** (decided with the user,
2026-10-02). The daily check is always on. This reverses the 2026-09-10
promise of "off in one tap", so the README's Updates section and the
Settings hint must say plainly what still holds: one unauthenticated GET per
day, no identifiers, nothing downloaded without a tap. A stored
`autoCheckUpdates: false` from an older build is dropped on load, not
honoured.

**Desktop** gets the notes too, through the same React components, but keeps
its own install path (the Tauri updater, PR #166). The banner gains a
**What's new** button that opens the same notes as a dialog, and the
after-update screen appears there exactly as on Android. The pill, ring,
Wi-Fi and permission states are Android-only.

Every string has an Arabic translation (parity is a compile error). Every
state is built from existing theme tokens. Tags and errors carry an icon and
words, never colour alone. The sheet and toasts are `aria-live="polite"`, and
both work in RTL.

### Desktop: the same flow, in the sidebar (decided 2026-10-02)

The user reviewed three desktop placements and chose the **sidebar card**. It
replaces today's bottom `UpdateBanner` on desktop:

| State | Sidebar card (above Import) | Click opens |
|---|---|---|
| available | "Riwaq 0.6.0 is available" · "What's new ›" | centred dialog: highlight, tagged notes, **Update** (or **Download** on .deb/.rpm), **Later**, **Skip this version** |
| downloading | "Downloading 0.6.0…", progress bar, "5.1 of 12 MB" | dialog with the progress and **Hide**. There is no Cancel: the Tauri updater cannot abort a download |
| ready | "Riwaq 0.6.0 is ready", **Restart now** | — (never restarts by itself mid-chapter) |
| failed | red card, "The update didn't finish", **Try again** | dialog with **Try again** and **Download from GitHub** |
| Later | card hidden; a **dot on Settings** in the sidebar; toast "It'll wait for you in Settings" | Settings → About shows the update card |
| Skip | card hidden; toast with **Undo** | — |

**How the install works.** The download and the install are split, so the
restart happens when the user chooses it:

1. `update.download(onEvent)` fetches the bundle and reports progress.
2. **Restart now** calls `update.install()`. On macOS and the AppImage it
   replaces the bundle, then `relaunch()` restarts the app. On Windows (NSIS)
   the plugin runs the installer and exits the app itself.

**Which installs get it.**
- `.deb`/`.rpm` (manual channel) get the same card and dialog, but the button
  is **Download** and opens the release page.
- Flatpak (managed) shows nothing.

**Desktop never shows story pages** (user, 2026-10-02): every release,
big releases included, gets the centred after-update dialog, with the
stories as cards and a scrolling body.

**Reused pieces.** `NotesView`, `StoryPages` (phone only), `fetchNotes`, the after-update
screen, and the `skippedUpdateVersion` / `lastSeenWhatsNew` tweaks. The card
lives in the sidebar, so it is not visible in the reader or focus mode. The
Settings dot stays until the update is handled.

**Desktop storage.** tauri-plugin-updater 2.11 on Windows writes the installer
to `%TEMP%\Riwaq-<ver>-updater-XXXX\Riwaq-<ver>-installer.exe`, using
`tempdir().keep()`, then exits the process. That folder is never deleted, so
each update leaves about 10 MB behind. On every desktop launch, in the
background, Riwaq deletes any temp-dir entry named `<productName>-<ver>-updater-*`
whose `<ver>` is ≤ the running version. macOS and the Linux AppImage already
leave nothing: their `TempDir`s are dropped normally.

## Where the content comes from

The GitHub release body is generated from PR titles ("perf(reader): give
desktop wheel scrolling back to the browser by @… in #130"). That is a
changelog for developers: English only, full of links. `latest.json`'s `notes`
field is empty. Neither is something to show a reader.

### `release-notes/<version>.json`, written by hand

One file per release, committed with the version bump:

```json
{
  "version": "0.6.0",
  "date": "2026-10-15",
  "highlight": {
    "image": "0.6.0-card-styles.webp",
    "title": { "en": "Make the library yours", "ar": "اجعل المكتبة على ذوقك" },
    "body":  { "en": "The Continue Reading card now comes in four styles…",
               "ar": "بطاقة «تابع القراءة» تأتي الآن بأربعة أنماط…" }
  },
  "stories": [
    { "kind": "new", "image": "0.6.0-updates.webp",
      "title": { "en": "…", "ar": "…" }, "body": { "en": "…", "ar": "…" } }
  ],
  "items": [
    { "kind": "new",      "en": "Updates now install inside the app", "ar": "…" },
    { "kind": "improved", "en": "…", "ar": "…" },
    { "kind": "fixed",    "en": "…", "ar": "…" }
  ]
}
```

- `highlight` and `stories` are optional; `items` is required and non-empty.
  No `stories` means the after-update screen is the short list. That is the
  rule that keeps a two-fix release from getting a three-page tour.
- Images live beside the file (`release-notes/img/`), as WebP, **≤150 KB
  each**. No image → the UI uses a built-in icon for that slot.
- `kind` is exactly `new | improved | fixed`.

A schema and a validator (`scripts/verify-release-notes.mjs`) enforce all of
this: every string present in both languages, version matching the tag,
images present and under the cap, no unknown keys. It runs in `pnpm check`
for the current version's file and in the release workflow's `preflight` job.
**A missing or invalid notes file fails the release**, the same way an unsigned
APK does. Forgetting it is the likely failure, and the in-app fallback (below)
is a safety net, not the plan.

### One file, three places

| Where | How it gets the notes |
|---|---|
| **Update sheet** (old version, before updating) | It cannot have the new notes, so Rust fetches `whats-new.json` (and the highlight image) from the **versioned** release: `/releases/download/v0.6.0/…`, not `/latest/`, so a release published mid-read cannot swap them. This happens only when the sheet first opens, not on every check. |
| **After-update screen + Settings** (new version) | The build already contains its own notes. A small Vite plugin resolves `virtual:whats-new` to `release-notes/<package.json version>.json` and bundles only that file's images. No network is needed, and it works for F-Droid and Flathub users, whose store updated the app silently. |
| **GitHub release page** | The workflow renders the same file into the release body (English, then Arabic), above GitHub's generated changelog. |

The release workflow uploads `whats-new.json` (a copy of the version's file)
and its images as release assets, and `SHA256SUMS` covers them.

**Fallback.** If the notes cannot be fetched (offline mid-way, or an old
release without the asset), the sheet shows the version and size with a
**Release notes on GitHub** link. Nothing blocks the update.

## Architecture

```
React (shared)                       Rust (src-tauri)                 Kotlin (Android only)
─────────────────────────────────    ─────────────────────────────    ─────────────────────────────
useUpdateCheck ── invoke ──────────► check_update_manifest  (#166)
UpdatePill / UpdateSheet ─ invoke ─► fetch_release_notes(v)  ───────  (Rust HTTP, same client)
                          invoke ──► android_update_start(v,url,sha) ► AppUpdater.start()
                          invoke ──► android_update_status() ◄──────── AppUpdater.status()  (JSON)
                          invoke ──► android_update_cancel/install ──► AppUpdater.cancel()/install()
WhatsNew (after update) ◄ virtual:whats-new (bundled)
installer_source() ◄────────────── invoke ─ install_source ─────────► PackageManager
```

### Rust

- `fetch_release_notes(version)`: the same client and caps as
  `check_update_manifest`. It returns the parsed notes, plus the highlight
  image as a `data:` URL (≤150 KB, checked), so the webview never makes its own
  network request (CORS, and the privacy promise).
- `fetch_apk_checksum(version)`: GETs that release's `SHA256SUMS` and returns
  the hex for `app-universal-release.apk`. A missing line is an error, never a
  skip.
- `install_source()`: Android only. The installer package name from Kotlin,
  mapped to `sideload | fdroid | store | unknown`.
- `android_update_*`: thin JNI calls into `AppUpdater`, in the style
  `notify.rs` already uses (`find_app_class`, static methods). **Every new JNI
  signature goes into `proguard-rules.pro` in the same commit**, or release
  builds break while debug builds work.

### Kotlin: `AppUpdater` (new)

The APK bytes never cross the JS↔Rust bridge (it is slow per byte and dies
past ~128 MB). Download, verification and install all stay in Kotlin.

1. **Download** into `cacheDir/updates/riwaq-<version>.apk.part`, inside a
   new `UpdateService` (`dataSync` foreground service, notification id 1003).
   *Changed during planning:* the existing `TaskService` was the first
   choice, but JS stops it whenever the book-download queue empties, and its
   notification id 1001 belongs to the download notifier. The APK download is
   pure Kotlin and needs no WebView, so it gets its own service. That service
   keeps running when the task is swiped away; the next launch finds the
   file "ready".
   - Use `HttpURLConnection`, following GitHub's redirect.
   - Resume with `Range: bytes=<partSize>-`. The asset host answers `206`;
     verified 2026-10-02. Each resume re-requests the GitHub URL, because the
     signed redirect URL expires after about an hour.
   - Progress is throttled to 4 updates/s into a status object and the
     existing `DownloadNotifier` channel.
2. **Verify**: SHA-256 of the finished file against `fetch_apk_checksum`.
   Then `PackageManager.getPackageArchiveInfo(…, GET_SIGNING_CERTIFICATES)`:
   package name must equal ours, `versionCode` must be higher, and the signing
   certificate must equal the installed app's. Any mismatch deletes the file
   and reports `failed` with a reason. Android enforces the signature anyway;
   checking first turns its opaque "App not installed" into an explained
   failure.
3. **Permission**: on API 26+, `canRequestPackageInstalls()`. If false, the UI
   shows state 5, and the button opens
   `ACTION_MANAGE_UNKNOWN_APP_SOURCES` for our package. Re-checked on
   `visibilitychange`/`onResume`. On API 24–25 there is no per-app switch;
   Android's own dialog covers it.
4. **Install** with a `PackageInstaller` session, not `ACTION_VIEW` on a file
   URI. Sessions report their result.
   - `STATUS_PENDING_USER_ACTION`: launch the confirm intent (Android's
     dialog).
   - `SUCCESS`: Android replaces the app and **kills the running process**.
     It does not relaunch it, and Android 10+ forbids starting an activity
     from the background. So a `MY_PACKAGE_REPLACED` receiver posts one
     notification, "Riwaq 0.6.0 is installed · Open". Opening it (or Riwaq
     itself) lands on the after-update screen.
   - `FAILURE_*` / `ABORTED`: report `failed` or `ready` (cancelled), and
     keep the verified APK, so **Install now** works again without a second
     download.
5. **Network**: `isActiveNetworkMetered` decides state 3. "Wait for Wi-Fi"
   registers a `NetworkCallback` for an unmetered network while the app runs.
   If the app is closed, the wait resumes on next launch. No WorkManager: it
   would be a new dependency for an edge the next launch already covers.

State lives in Kotlin and is polled by JS (`android_update_status`, every
500 ms while a download is active and the page is visible, otherwise not at
all), matching the existing `consume_*` pattern rather than adding a native
callback.

### Who gets which flow: installers and stores

Riwaq is distributed as the GitHub APK directly, through **Obtainium**
(`dev.imranr.obtainium`, `dev.imranr.obtainium.fdroid`) and **Orion Store**
(`com.orion.store`), and later through F-Droid (Android) and Flathub (Linux).
Obtainium and Orion install **our own GitHub APK**. F-Droid's is
byte-identical, because the build is reproducible (`docs/fdroid/`,
`.github/workflows/fdroid-verify.yml`). So every Android build carries the
same signing key, and any of them can update any other.

**Rule 1: correctness never depends on knowing the installer.** Obtainium
and Orion can install through Shizuku, which records the installer as
`com.android.shell`, so the installer can be wrong. Everything that matters
is therefore keyed on the **running `versionCode`**:

- On every launch, a cached APK whose version is ≤ the running one is
  deleted, whoever did the update.
- The pill, dot and offer exist only while `latest.json` is newer than the
  running app. A store that updated first makes them vanish on the next
  check.
- "What's new" shows once per running version, so it appears after an
  Orion, Obtainium or F-Droid update too, from the notes bundled in that
  build.
- `skippedUpdateVersion` is cleared once anything higher is offered or
  running.
- A store update that lands **during** an in-app download kills the process
  mid-write. The next launch sees a running version ≥ the cached one and
  deletes the `.part`.

**Rule 2: the installer only picks which button the user sees.**

| Installer of record (`getInstallSourceInfo().installingPackageName`, API 30+; `getInstallerPackageName` below) | Channel | What the user gets |
|---|---|---|
| `com.riwaq.reader` (us, after one in-app update), `com.google.android.packageinstaller`, `com.android.packageinstaller`, `com.android.shell`, none | **in-app** | the full flow |
| `com.orion.store`, `dev.imranr.obtainium`, `dev.imranr.obtainium.fdroid` | **store-assisted** | the pill and the notes sheet as usual, but the primary button is **Update in Orion Store** / **Update in Obtainium**, which opens that app (`getLaunchIntentForPackage`). If that store app is no longer installed, the channel falls back to **in-app**. |
| F-Droid clients: `org.fdroid.fdroid`, `org.fdroid.basic`, `com.looker.droidify`, `com.machiav3lli.fdroid`, `in.sunilpaulmathew.izzyondroid` | **managed** | no pill, no dot, no prompt. Settings → About says "Updates for this install come from F-Droid" with an **Open F-Droid** button. |
| `com.android.vending`, `com.aurora.store`, and any other installer | **managed** | same, naming the store when its label can be read (`getApplicationLabel`), otherwise "your app store", plus a **Download from GitHub** link |
| lookup throws | **manual** | the old behaviour: the release page link |
| Flatpak (desktop) | managed (#154) | |
| other desktop | unchanged (#166) | |

Why store-assisted and not silent: Orion and Obtainium fetch from our GitHub
release, so they are as current as we are. Telling the user, and handing them
to the app that manages their install, avoids two installers fighting over
one app. F-Droid is managed because its builds lag a day or two behind ours.
F-Droid's policy also expects the app not to update itself.

The F-Droid build declares `REQUEST_INSTALL_PACKAGES` too (one manifest has to
serve both). It is never exercised there; its metadata should state that.
Review the anti-feature flags before the first F-Droid release that carries
this.

## Persisted state and cleanup

New tweaks: `skippedUpdateVersion?: string`, `lastSeenWhatsNew?: string`,
`updateOverMobile: "ask" | "always" | "wifi"` (default `"ask"`).

| What | Kept until | Then |
|---|---|---|
| After-update screen | shown once; `lastSeenWhatsNew = current` | never again for that version; Settings reopens it |
| Fresh install (not an update) | — | no stored tweaks at all → set `lastSeenWhatsNew = current` silently: a new user gets no "what's new" tour |
| Bundled notes | — | a build contains only its own version's file; nothing accumulates |
| `cacheDir/updates/*.apk(.part)` | installed, or Cancel | deleted on first launch when the running `versionCode` ≥ the file's; deleted on hash/signature mismatch; deleted when a newer release supersedes the pending one, so there is never more than one APK |
| Fetched notes and image | while that update is pending | deleted with the APK |
| `skippedUpdateVersion` | until a newer version is published | cleared when the manifest offers anything higher |
| Settings dot | while an update is pending and not skipped | gone after install or skip |

`cacheDir` also means Android may reclaim the APK under storage pressure.
That is fine: the download restarts from zero, and the UI handles a missing
file as "available" again.

### Storage: updates never grow the app

Decided with the user, 2026-10-02: after any number of updates, Riwaq's
storage must be what it was before them. Every update resource is freed as
soon as nothing needs it:

- **One pending APK, ever** (about 19 MB). Starting a download for another
  version deletes everything else in `cacheDir/updates/`.
- **Deleted on the first launch of the new version** (`cleanupAsync` in
  `MainActivity.onCreate`, and again from the `MY_PACKAGE_REPLACED`
  receiver). This holds whoever did the update.
- **Deleted at once** on Cancel, on **Skip this version**, and when a newer
  release supersedes the pending one. It is not kept for "next launch".
- **Install sessions are abandoned.** Android stages a copy of the APK for
  every `PackageInstaller` session. Any session that fails or is cancelled
  is abandoned immediately, and `cleanupAsync` abandons every stale session
  of ours (`packageInstaller.mySessions`), so no staged copy lingers in
  system storage.
- **Notes never touch disk.** The next version's notes and highlight image
  are held in memory only, as a `data:` URL; the bundled notes are part of
  the APK and replaced with it.
- **Proof:** the emulator end-to-end measures the app's storage (cache, data,
  staged sessions) before the update and after relaunching on the new
  version. The two must match, within noise.

## Error handling

Every failure leaves the installed app untouched, and says so in words.

| Failure | User sees |
|---|---|
| offline / timeout during download | red pill; sheet "connection dropped at N%"; **Resume** continues from the byte offset |
| checksum mismatch | "The file didn't match what was published, so it was deleted." **Try again** (fresh download) |
| signature / package / version mismatch | same message; never offers install |
| storage full | "Not enough space: needs 19 MB free." |
| permission refused | stays at state 5; **Later** works; nothing nags |
| user cancels Android's dialog | back to **Ready**; the APK is kept |
| notes fetch fails | sheet without notes + GitHub link; update still offered |
| `SHA256SUMS` missing the APK line | update **not offered**: unverifiable means not installable |

## Testing

**Unit (vitest)**
- The update state machine: transitions, mobile-data branch, skip/undo,
  supersede.
- `resolveChannel` per install source.
- The cleanup rules as pure functions of (running version, cached file,
  tweaks).
- The fresh-install vs updated rule.
- The notes renderer: highlight, story vs short-list choice, Arabic.

Each test gets tamper-checked: break the code on purpose and confirm the test fails, as in #166.

**Rust**
- `SHA256SUMS` parsing: missing line, extra whitespace, uppercase hex.
- Notes parsing and caps.
- An `#[ignore]` live test against a real release.

**Validator**
- `verify-release-notes.mjs` against fixtures: missing Arabic, oversize image,
  wrong version, unknown kind. Each must fail.

**End to end, on the emulator** (the counterpart of the macOS proof in #166)
- Two debug builds, 0.6.90 → 0.6.91, signed with the same debug key, with
  `plugins.updater` and the release base URL pointed at the host through
  `adb reverse` (cleartext allowed in debug only).
- A local server serving `latest.json`, `whats-new.json`, `SHA256SUMS` and
  the APK.
- Prove each of the following:
  - pill → sheet with notes → download (kill the server mid-way → red pill →
    restart → resume from the same offset) → first-time permission → Android dialog → the "installed · Open" notification → 0.6.91 opens with the library intact;
  - the story pages show once;
  - the cache dir is empty afterwards.
- Plus:
  - a tampered APK is rejected;
  - an install whose installer is set to `org.fdroid.fdroid`
    (`adb install -i org.fdroid.fdroid`) never shows the pill;
  - `-i com.orion.store` shows the pill with **Update in Orion Store**;
  - a "store update" mid-download (`adb install -r` of 0.6.91 while the
    in-app download runs) leaves the cache empty and no pill on the next
    launch, and still shows What's new once.

## Out of scope

- Delta or patch updates. The full 19 MB APK each time is fine.
- Staged rollouts, and update checks more often than daily.
- Showing notes for versions the user skipped over. The sheet shows the
  version being installed, not a history.
- iOS.

## Files

New:
- `src-tauri/gen/android/app/src/main/java/com/riwaq/reader/AppUpdater.kt`
- `src-tauri/src/android_update.rs`
- `src/components/update/` (`UpdatePill`, `UpdateSheet`, `WhatsNew`,
  `StoryPages`)
- `src/store/updateFlow.ts` (the state machine)
- `src/store/releaseNotes.ts`
- `release-notes/` (schema, `0.6.0.json`, `img/`)
- `scripts/verify-release-notes.mjs`
- `vite-plugin-whats-new.ts`

Modified:
- `AndroidManifest.xml` (`REQUEST_INSTALL_PACKAGES`; the
  `MY_PACKAGE_REPLACED` receiver. No FileProvider change: a PackageInstaller
  session streams the bytes, it never shares a URI)
- `proguard-rules.pro`
- `src-tauri/src/updates.rs` (notes + checksum fetches)
- `src/store/updateChannel.ts`, `src/hooks/useUpdateCheck.ts`,
  `src/hooks/useTweaks.ts`
- `src/components/UpdateBanner.tsx` (desktop What's new button)
- `src/components/SettingsPage.tsx`
- `src/i18n/en.ts`, `src/i18n/ar.ts`
- `.github/workflows/release.yml` (validate, upload, render body)
- `docs/RELEASING.md` (the notes step), `README.md` (privacy paragraph: the
  extra GETs are the same release, still no identifiers)

## Results (2026-10-02, emulator and macOS)

Run on the `leaflet` AVD (API 36, arm64) with two debug builds, 0.6.90 → 0.6.91,
signed with the same debug key, against a local server through `adb reverse`
(port 8766: 8765 was taken on the host), and on macOS with the throwaway-key recipe
under `com.riwaq.reader.updatetest`. The full log, with every command and number,
is `.superpowers/sdd/2026-10-02-android-in-app-updates/task-14-report.md`.

**Proven on Android**
- Release (R8) build: `verify:jni` reports all 17 JNI members kept, before and after
  the fixes below; the minified APK ran on the emulator and checked GitHub from Rust.
- Pill → notes sheet (highlight image as a `data:` URL, tagged lines, 197.2 MB) →
  Update → progress ring and notification 1003.
- Server killed at 40%: red pill, "Your connection dropped at 41%"; **Resume** sent
  `Range: bytes=85458944-`, exactly the `.part` size, and the server answered 206 with
  the remaining 121,337,614 bytes. The joined file verified.
- First-time permission: our sheet → Android's "Install unknown apps" → toggle → back
  → Android's install dialog with no further tap.
- Cancel on Android's dialog → Ready, APK kept, session abandoned. Home during the
  session copy → the dialog was blocked, and Install now worked on return (a new
  session, the old one abandoned).
- Update → the `MY_PACKAGE_REPLACED` receiver (exported=false) posted
  "Riwaq 0.6.91 is installed · Tap to open it" → story pages once → library intact.
- Storage: app data 4904 KB before, 4944 KB after relaunching on 0.6.91 (+40 KB, all
  WebView profile); `cache/updates` empty; no active or staged install sessions.
- Failures: an instant download failure four times in a row, no foreground-service
  crash; Cancel removes notification 1003 for good; cancel-then-start restarts in 2 s;
  a tampered APK is rejected ("didn't match"), deleted, and no Install is offered.
- Stores (with stub store APKs, since `adb install -i` records no installer for a
  package that is not installed): F-Droid gets no pill and the "Updates for this install
  come from F-Droid" line; Orion gets **Update in Orion Store**, which opens Orion; with
  Orion uninstalled Android clears the installer and the in-app flow returns; a store
  update during an in-app download leaves `cache/updates` empty, no pill, and What's new
  shown once.

**Changed as a result**
- A managed or manual install no longer fetches the notes, `SHA256SUMS` or the APK's
  size (it did, on every check). It makes only the daily `latest.json` request.
- "Installed · Open" is posted only after Riwaq's own update; a store's update no
  longer gets a second notification next to the store's.

**Proven on macOS** (checklist item 14: PASS with an unexplained run-1 restart, see
"Not proven" below): sidebar card → What's new dialog → Update → progress → "ready"
with **Restart now**; the app stayed on 0.6.90 for 75 s until Restart now; relaunch
as 0.6.91 → story pages once; no `Riwaq*`/`*updater*` leftovers in `$TMPDIR`.

**Changed after the macOS proof** (so that proof predates them; it is re-run in
final verification):
- de95c82: Restart now is its own element, away from Update / Try again, and it
  ignores clicks for a second after it appears; story pages do the same per page.
- f7466b9: `restart()` itself refuses a call within a second of the download
  finishing, and closing and reopening the notes dialog re-arms Restart now.
- 0c31506: desktop never shows story pages; every release gets the scrolling
  after-update dialog.

**Not proven, or open**
- Windows (`%TEMP%` sweep) and the Linux AppImage were not run end to end; the sweep
  is covered by its unit and tempdir tests only.
- The real Obtainium and Orion apps were not installed; stubs stood in for them, so
  each store's own launch screen and update behaviour are untested.
- The "Wait for Wi-Fi" path and a real metered network were not exercised (the
  emulator reports Wi-Fi as unmetered; airplane mode showed the mobile-data sheet).
- In the first macOS run the app restarted by itself about 2 s after the download
  finished, and skipped its story pages. Three later runs did not reproduce it, and no
  code path restarts without a press on Restart now. A second click or other stray
  input on the old Update spot is suspected, not confirmed; de95c82 and f7466b9 guard
  against it either way.
- The Linux .deb/.rpm manual path (card → Download → release page) was not run end to
  end.
- The desktop proof covers WKWebView (macOS) only: WebKitGTK (Linux) and WebView2
  (Windows) were not exercised.
- On the tablet layout the pill is centred on the window, not on the content pane.
