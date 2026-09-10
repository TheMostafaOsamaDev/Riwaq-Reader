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

Riwaq needs read access to pick EPUBs:

- `android.permission.READ_EXTERNAL_STORAGE` is **not** required — we use the system file picker via `@tauri-apps/plugin-dialog`, which grants scoped access.
- No network permission is declared, because we don't fetch anything.

The manifest template at `src-tauri/gen/android/app/src/main/AndroidManifest.xml` is generated on init — don't edit it before `init` runs.

## Known rough edges

- **EPUB swipe vs. system back gesture**: on gesture-nav devices, horizontal swipe from the edge triggers Android's back. We mitigate by setting `android:windowLayoutInDisplayCutoutMode="shortEdges"` and wiring touch listeners inside a safe inset. See `Reader.tsx`.
- **WebView updates**: users on old Android WebView may see layout glitches with epub.js. We target WebView 90+ which covers ~95% of devices; older users get a friendly notice.
- **Large EPUB import**: Android intents cap at ~1MB for `content://` returns on some OEMs; Tauri's dialog plugin streams the file instead. No extra work needed.
