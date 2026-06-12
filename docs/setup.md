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
