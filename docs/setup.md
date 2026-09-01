# Setup

Leaflet is a Tauri v2 + React 19 + TypeScript + Vite app targeting **desktop
(Linux / macOS / Windows)** and **Android**.

## Prerequisites

| Tool | Minimum version | Why |
| --- | --- | --- |
| Node | 20+ | Vite baseline / project scaffold |
| pnpm | 9+ | package manager this repo uses (matches how the project was scaffolded) |
| Rust | stable (1.75+) | Tauri v2 baseline; host target installed |
| `tauri-cli` | 2.x | pulled in as a dev dep — `npx tauri` / `pnpm tauri` works |

> Note: an earlier draft listed Node 18 (Vite 5 baseline); this reflects the
> Node 20+ / pnpm 9+ toolchain the project is scaffolded against.

If you installed Rust via your distro's package manager (e.g. `pacman -S rust`
on Arch/CachyOS), you already have the host target — that's all desktop builds
need.

### Desktop platform extras

Platform-specific Tauri system deps, per
<https://tauri.app/start/prerequisites/> (the Tauri v2 guide covers this in
more depth):

- **Linux**: `webkit2gtk-4.1` (`libwebkit2gtk-4.1-dev`), `libsoup-3.0-dev`,
  `libjavascriptcoregtk-4.1-dev`, `libappindicator-gtk3`
  (`libappindicator3-dev`), `librsvg2`, `patchelf`, and a working GTK stack.
- **macOS**: Xcode Command Line Tools.
- **Windows**: Microsoft Edge WebView2 Runtime (ships with / usually
  preinstalled on Windows 11) + Visual Studio 2022 Build Tools (MSVC) with
  "Desktop development with C++".

### Android (additional)

Android builds need a richer toolchain than desktop. See `docs/android.md`
for the full walkthrough; the essentials:

1. **rustup** (not just distro rust). The rustup multi-target story is what
   Tauri's Android build uses; distro rust doesn't support adding Android
   targets. Install from <https://rustup.rs>.
2. **Android SDK + Platform Tools + Build Tools** (API 33+ recommended).
   Easiest via Android Studio → SDK Manager.
3. **Android NDK** (25+). Install via the SDK Manager → "NDK (Side by side)".
4. **Java 17 JDK** (Tauri's Android project uses Gradle 8+, which needs 17).
5. Export these env vars in your shell (e.g. in `~/.zshrc` or `~/.bashrc`):
   ```sh
   export ANDROID_HOME="$HOME/Android/Sdk"
   export NDK_HOME="$ANDROID_HOME/ndk/<version>"
   export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
   ```
6. Add the four Android Rust targets:
   ```sh
   rustup target add aarch64-linux-android armv7-linux-androideabi \
                     i686-linux-android    x86_64-linux-android
   ```

## First-time setup

This project uses **pnpm** (see `tauri.conf.json`'s `beforeDevCommand`). If
you prefer npm or bun, swap `pnpm` below — just make sure `tauri.conf.json`'s
before-command matches.

```sh
# From the repo root:
cd Leaflet-ebook-reader
pnpm install
```

## Run — desktop

```sh
pnpm tauri dev          # hot-reloading dev window
pnpm tauri build        # production bundle (DMG / MSI / AppImage / deb)
```

The app opens against Vite's dev server at `http://localhost:1420`. HMR is
live for the React side; the Rust side rebuilds automatically on save.

### Production desktop build

`pnpm tauri build` artifacts land in `src-tauri/target/release/bundle/`:

- `.dmg` / `.app` on macOS
- `.msi` / `.exe` on Windows
- `.deb` / `.AppImage` / `.rpm` on Linux

### Installing the macOS app locally

To use Riwaq as a normal app — Spotlight, Launchpad, Dock — instead of keeping
`pnpm tauri dev` running:

```sh
pnpm mac:install     # build, ad-hoc sign, copy to /Applications
```

Then launch it from Spotlight ("Riwaq") or `open -a Riwaq`.

This is a **release** build: the frontend is compiled and embedded in the
bundle, so it does not hot-reload. Re-run `pnpm mac:install` after any change
you want to see in the installed app. Keep using `pnpm tauri dev` for
development.

Related scripts: `pnpm mac:build` (bundle only, no install) and `pnpm mac:dmg`
(a `.dmg` to hand to someone else).

**On signing.** Tauri only invokes `codesign` when a signing identity is
configured, so an unconfigured build keeps just the linker's ad-hoc signature:
resources unsealed, `Info.plist` unbound, and a generated identifier like
`leaflet-9ad04e75f33efb1c` rather than the real bundle id. It still launches —
an app you built yourself carries no `com.apple.quarantine` attribute, so
Gatekeeper does not gate it — but the signature fails `codesign --verify`.
`scripts/mac-install.sh` re-signs ad-hoc (no Apple Developer account required)
so the bundle is well-formed and its identity is stable across rebuilds.

A `.dmg` sent to another Mac *does* get quarantined on download, and an ad-hoc
signature will not satisfy Gatekeeper there. Distributing to other people needs
a Developer ID certificate and notarisation.

**Shared data.** Dev and release builds both key off the `com.leaflet.reader`
identifier, so they read and write the same library at
`~/Library/Application Support/com.leaflet.reader/leaflet/`. Handy — the
installed app sees your existing books — but it also means anything destructive
you try in `tauri dev` hits the real library.

## Run — Android

See `docs/android.md`. Quick version:

```sh
pnpm tauri android init      # one time, inside the repo
pnpm tauri android dev       # run on emulator / attached device
pnpm tauri android build     # release AAB/APK
```

`android init` writes `src-tauri/gen/android/` into the repo. Don't commit
build artifacts under it (`.gradle/`, `build/`, `app/build/`) — `.gitignore`
is configured accordingly. The release `android build` AAB/APK lands in
`src-tauri/gen/android/app/build/outputs`.

## Fallback: run the UI in a plain browser

The UI is pure web, so you can iterate on the design without the Tauri
native shell:

```sh
pnpm dev        # Vite dev server at http://localhost:1420
pnpm build      # static bundle in dist/
```

This is often faster than `pnpm tauri dev` when you're just tweaking
typography / colors.

## Icons

Placeholder PNGs are referenced in `src-tauri/tauri.conf.json`. Once you have
a real leaf mark ready:

```sh
pnpm tauri icon path/to/leaf-1024.png
```

That regenerates every platform-specific icon size automatically.

## Troubleshooting

- **Blank window on desktop** — Vite port mismatch; check `tauri.conf.json`
  `build.devUrl` matches `vite.config.ts`'s `server.port`.
- **`cargo check` hangs on Linux** — it's blocked on `webkit2gtk-4.1`
  link flags. Install the distro's `webkit2gtk-4.1` dev package.
- **`webview_version` error on Linux** — install `libwebkit2gtk-4.1-dev` (the
  `-4.0` variant is for Tauri v1 only).
- **Android build complains `rustup` not found** — distro rust isn't
  sufficient for Android cross-compilation; install rustup per above.
- **Android build "SDK not found"** — `ANDROID_HOME` must be exported *in the
  same shell* you run `pnpm`/`npm run` in. In `~/.bashrc`:
  ```sh
  export ANDROID_HOME="$HOME/Android/Sdk"
  export NDK_HOME="$ANDROID_HOME/ndk/$(ls $ANDROID_HOME/ndk | sort -V | tail -1)"
  export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
  ```
- **Theme flash on startup** — the selected theme is persisted in
  `localStorage` under `leaflet:tweaks:v1` and applied on first paint via a
  `useEffect` in `App.tsx`. If you clear storage you'll briefly see the sepia
  default.
## Testing file associations

### macOS

macOS only registers associations for an **installed** app. A `tauri dev`
build never appears in "Open With", so testing means installing first: build
the app bundle with the Tauri CLI, then copy it into `/Applications`:

```bash
pnpm tauri build --bundles app
ditto "src-tauri/target/release/bundle/macos/Riwaq.app" /Applications/Riwaq.app
```

(`ditto`, not `cp -R` — it preserves the ad-hoc code signature. Some
checkouts also carry `mac:build`/`mac:install` package scripts that wrap
these two steps plus re-signing; check `package.json` for them first.)

Confirm the registration took:

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/\
LaunchServices.framework/Support/lsregister -dump | grep -i -A 3 riwaq
```

Then the smoke test — quit Riwaq first, so this exercises the cold-launch
path (`RunEvent::Opened`, not argv; macOS never uses argv for this):

```bash
open -a Riwaq ~/Downloads/test.epub
```

Run it a second time to check dedup: the same book should open with its
reading position intact, and no second library entry should appear.

### Android

```bash
adb shell am start -a android.intent.action.VIEW \
  -d "file:///sdcard/Download/test.epub" -t application/epub+zip \
  -n com.leaflet.reader/.MainActivity
```

Run it once with the app closed (cold, `onCreate`) and once with it
foregrounded (warm, `onNewIntent`) — they are different code paths.

Two VIEW intent-filters exist, not one: many file managers report a
`.epub` as `application/octet-stream`, so the MIME-typed filter misses the
common case and a `pathPattern` filter covers it. Test with a real file
manager, not only `adb`.

**Any new static Kotlin field reached from Rust over JNI needs a matching
keep rule in `proguard-rules.pro`.** Without one the debug build works
perfectly and only the release build dies. Always confirm with
`pnpm android:build`, which chains `verify:jni` — the release build is
the check that proves the keep rule works.

### Windows and Linux

**Unverified.** The association config in `tauri.conf.json` is shared
across all three desktop platforms, so registration is likely fine; the
untested part is *delivery* — argv on cold start, and
`tauri-plugin-single-instance` forwarding the path into an already-running
window. Without the plugin, opening a book while Riwaq runs starts a
second copy of the app pointed at its own library.

### Drag-and-drop

Desktop only. Dropped folders are read one level deep — a shelf of books
works, a nested tree does not. Everything the drop resolves to is imported
through the same pipeline as the picker.

The drop overlay is legible across light, dark, and sepia themes. On the
OLED theme (black background, no grey), the card sits over a `rgba(0,0,0,0.42)`
scrim and relies on the blurred content behind it plus a strengthened border
for contrast. If visual testing finds this marginal, the lever to adjust is
the card's fill color, not the scrim.
