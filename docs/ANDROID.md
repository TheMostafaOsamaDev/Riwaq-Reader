# Android

Tauri v2 has first-class Android support. The app's frontend is the same bundle as desktop; the shell is a native `Activity` hosting the system WebView.

## One-time environment

1. Install Android Studio. Use its SDK Manager to install:
   - Android SDK Platform 34 (or later)
   - Android SDK Build-Tools
   - NDK (side by side) — latest LTS
   - CMake
2. Accept the SDK licenses:
   ```bash
   $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses
   ```
3. Ensure JDK 17 is the default `java` — Tauri will reject 21.
   ```bash
   java -version
   ```
4. Export env vars (see [`setup.md`](./setup.md) snippet).

## Rust Android targets

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

## Init the Android project

From the project root:

```bash
pnpm tauri android init
```

This generates `src-tauri/gen/android/` with a Gradle project. Commit this folder — it's the Android analogue of `src-tauri/`.

## Dev loop

With an emulator running or a device plugged in with USB debugging on:

```bash
pnpm tauri android dev
```

First run is slow (Gradle + NDK). Subsequent runs are a normal Vite HMR loop.

## Release build

```bash
pnpm android:build            # arm64 only, then verifies JNI + signing
pnpm android:build:universal  # arm64 + armeabi-v7a in one APK
```

Outputs:
- `src-tauri/gen/android/app/build/outputs/apk/release/app-release.apk`
- `src-tauri/gen/android/app/build/outputs/bundle/release/app-release.aab` (for Play Store)

## Release signing

**The keystore is irreplaceable.** Android refuses to install an update whose
signing certificate differs from the installed one, so if you lose this file
nobody who installed Riwaq can ever upgrade — they have to uninstall first,
which deletes their library. Back it up somewhere that survives losing your
laptop, and keep the passwords with it.

### The silent-fallback trap

`gen/android/app/build.gradle.kts` falls back to the **debug** signing config
when `key.properties` is absent:

```kotlin
signingConfig = if (keystorePropertiesFile.exists()) {
    signingConfigs.getByName("release")
} else {
    signingConfigs.getByName("debug")
}
```

The build succeeds and says nothing. Every release built before this was set
up went out debug-signed for exactly that reason, and a missing or misspelled
CI secret reproduces it perfectly. So the guard is a check on the artifact,
not on the configuration — see `scripts/verify-apk-signing.sh`, which runs
automatically after `pnpm android:build` and in CI before anything is
uploaded.

### Creating the keystore (once)

Run this yourself, in your own terminal, and choose your own passwords:

```bash
keytool -genkeypair -v \
  -keystore riwaq-release.jks \
  -alias riwaq \
  -keyalg RSA -keysize 4096 \
  -validity 10000 \
  -dname "CN=Riwaq, O=Riwaq, C=EG"
```

10000 days (~27 years) matters: an expired key can't sign updates either.

### Building locally with it

Create `src-tauri/gen/android/key.properties` — gitignored, along with
`*.jks` and `*.keystore`:

```properties
storeFile=/absolute/path/to/riwaq-release.jks
storePassword=…
keyAlias=riwaq
keyPassword=…
```

### CI secrets

Four repository secrets, under Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -i riwaq-release.jks` (one line, no newlines) |
| `ANDROID_KEYSTORE_PASSWORD` | the store password |
| `ANDROID_KEY_ALIAS` | `riwaq` |
| `ANDROID_KEY_PASSWORD` | the key password |

On macOS, `base64 -i file | pbcopy` puts it straight on the clipboard.

A **tag push with no keystore fails the build.** A `workflow_dispatch` smoke
test without one still builds, debug-signed, with a loud warning — it must not
be published.

### Pinning the certificate (recommended, after the first release)

Rejecting debug signing catches the common mistake, but not signing with the
*wrong* real key. Capture the fingerprint once:

```bash
pnpm verify:signing --print   # or: bash scripts/verify-apk-signing.sh --print
```

and set the `SHA256` value as a repository **variable** (not a secret — a
public-key fingerprint isn't one) named `ANDROID_SIGNING_CERT_SHA256`. From
then on the build fails unless the APK is signed by exactly that key.

### Verifying by hand

```bash
bash scripts/verify-apk-signing.sh              # newest release APK
bash scripts/verify-apk-signing.sh path/to.apk
bash scripts/verify-apk-signing.sh --self-test  # check the guard itself
```

## Launcher icon

Android draws the launcher icon from an adaptive icon: a background layer (a flat
cream, `values/ic_launcher_background.xml`) and a foreground layer
(`mipmap-*/ic_launcher_foreground.png`). Both layers are 108dp, but the launcher
only shows the central 72dp and only guarantees the middle 66dp circle — the rest
is headroom for the mask shape and for parallax.

`pnpm tauri icon` scales the source across the whole 108dp canvas, which leaves no
headroom at all, so every mask clips the phoenix's wingtips. After running it,
rebuild the foreground with its own padding:

```bash
./scripts/android-launcher-icon.sh
```

The script needs ImageMagick (`brew install imagemagick`). The legacy
pre-API-26 bitmaps (`ic_launcher.png`, `ic_launcher_round.png`) are drawn
unmasked and `tauri icon` already pads them, so they're left alone.

## Permissions

Riwaq reads books through the system file picker (`@tauri-apps/plugin-dialog`),
which grants scoped access, so it declares no storage permission. What the
manifest does declare:

| Permission | Why |
|---|---|
| `INTERNET` | sources, book downloads, and the daily update check |
| `ACCESS_NETWORK_STATE` | "Over mobile data" for updates: `isActiveNetworkMetered` and the wait-for-Wi-Fi callback |
| `POST_NOTIFICATIONS` | download progress and "Riwaq x.y.z is installed" |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`, `WAKE_LOCK` | `TaskService` (book downloads) and `UpdateService` (the update APK) |
| `REQUEST_INSTALL_PACKAGES` | in-app updates, below. Android also asks the user once ("Install unknown apps → Allow from this source") |

The manifest at `src-tauri/gen/android/app/src/main/AndroidManifest.xml` is
committed and edited by hand; its `<queries>` block lists the store apps
Riwaq looks up (Android 11+ package visibility).

## In-app updates

Spec: [`docs/superpowers/specs/2026-10-02-android-in-app-updates-design.md`](superpowers/specs/2026-10-02-android-in-app-updates-design.md).

### Who gets which flow

`AppUpdater.installSource` reads the installer of record
(`getInstallSourceInfo`, API 30+). `androidChannel()` in `src/store/updateFlow.ts`
maps it:

- **in-app**: no installer, `com.android.shell` (adb), the system package
  installer, or Riwaq itself (after one in-app update). The full flow below.
- **store-assisted**: `com.orion.store`, `dev.imranr.obtainium[.fdroid]`. The
  pill and notes as usual, but the button opens that store. If the store app is
  gone, Android clears the installer of record and the install is in-app again.
- **managed**: F-Droid clients, Play, any other installer. No pill, no prompt,
  and nothing fetched beyond the daily `latest.json`; Settings → About names the
  store.
- **manual**: the lookup threw. The old release-page banner.

What actually matters is keyed on the **running version**, never the installer:
cached files at or below it are deleted at launch, and What's new shows once
per running version whoever did the update.

### The flow

1. The daily check (Rust, `check_update_manifest`) finds a newer `latest.json`.
   Only then, and only for an **in-app** or **store-assisted** install, the
   store's `offer()` asks Rust for that release's `whats-new.json` + highlight
   image (held in memory as a `data:` URL), its `SHA256SUMS` line for
   `app-universal-release.apk`, and the APK's size (HEAD). A managed or manual
   install makes none of these requests (see the channels above). No checksum
   line, no offer.
2. Pill → notes sheet → **Update** (on a metered network: Ask first / Always /
   Wait for Wi-Fi, per Settings).
3. `UpdateService` (foreground, `dataSync`, notification id 1003) runs
   `AppUpdater`'s download in plain Kotlin. It resumes with
   `Range: bytes=<part size>-`, so a dropped connection costs nothing already
   downloaded.
4. Verify: SHA-256 against `SHA256SUMS`, then package name, a higher
   `versionCode`, and the same signing certificate as the installed app. Any
   mismatch deletes the file.
5. **Install now** → (first time only) Android's "Install unknown apps" screen;
   coming back with the switch on continues by itself → a `PackageInstaller`
   session → Android's "Do you want to update this app?".
6. Android replaces the app and kills it. `PackageReplacedReceiver`
   (`MY_PACKAGE_REPLACED`) frees the update's storage and, only when Riwaq did
   the install itself, posts "Riwaq x.y.z is installed · Tap to open it"
   (id 1004). The next launch shows the release's story pages or short list once.

State lives in `cacheDir/updates/state.json` and the UI polls it
(`android_update_status`, every 500 ms while something is moving and the page is
visible).

### Where the files live, and when they go

Everything is under the app's cache dir:

```
/data/data/com.riwaq.reader/cache/updates/
  riwaq-<version>.apk.part   while downloading
  riwaq-<version>.apk        verified, waiting for Install now
  state.json                 the status the UI polls (a few hundred bytes)
```

- One pending APK at most; starting another version deletes the rest.
- Deleted at once on Cancel, Skip this version, a checksum or signature
  mismatch, or a newer release superseding it.
- Deleted when the update lands (the receiver), and again on every launch once
  the running version is at or past the cached one (`cleanupAsync`).
- Every `PackageInstaller` session of ours that is not the one being installed
  is abandoned (each holds a staged copy of the APK in system storage).

The 2026-10-02 emulator run measured the app's data before an update and after
relaunching on the new version: 4904 KB → 4944 KB, the difference all in the
WebView profile; no sessions, no staged `/data/app/vmdl*` dirs.

### Testing it on the emulator

Two debug builds signed with the same debug key, versions `0.6.90` and `0.6.91`,
each built with `--config` overriding `version` and
`plugins.updater.endpoints` (`http://127.0.0.1:<port>/latest.json`). Build the
frontend from a scratch copy whose `package.json` carries the test version and
whose `release-notes/` holds the test notes (point `build.beforeBuildCommand`
and `build.frontendDist` at it), so nothing in the repo changes. Serve
`latest.json`, `whats-new.json`, the images, `SHA256SUMS` and the APK as
`app-universal-release.apk` with a server that honours `Range`, then
`adb reverse tcp:<port> tcp:<port>`. Debug builds already allow cleartext
(`usesCleartextTraffic` is true for the debug build type only).

Two traps:
- `adb install -i <pkg>` records **no** installer unless `<pkg>` is installed.
  To test the F-Droid or Orion channels, install a stub APK with that package
  name first.
- Airplane mode does not stop traffic through `adb reverse`; to test a failing
  download, make the server fail.

## Known rough edges

- **EPUB swipe vs. system back gesture**: on gesture-nav devices, horizontal swipe from the edge triggers Android's back. We mitigate by setting `android:windowLayoutInDisplayCutoutMode="shortEdges"` and wiring touch listeners inside a safe inset. See `Reader.tsx`.
- **WebView updates**: users on old Android WebView may see layout glitches with epub.js. We target WebView 90+ which covers ~95% of devices; older users get a friendly notice.
- **Large EPUB import**: Android intents cap at ~1MB for `content://` returns on some OEMs; Tauri's dialog plugin streams the file instead. No extra work needed.
