# F-Droid

Riwaq is built by F-Droid from source and shipped with **our** signature, as a
[reproducible build](https://f-droid.org/docs/Reproducible_Builds/): F-Droid
builds the tagged commit with `com.riwaq.reader.yml`, downloads the APK
published on the GitHub release, and ships ours only if the two are
byte-identical. That keeps GitHub, Obtainium and F-Droid on one signing
lineage, so a reader can move between them without uninstalling and losing
their library. If a build does not match, F-Droid does not publish that
version. It does not fall back to its own key by itself, and it must never be
asked to, because that cannot be undone.

## What lives where

| | |
|---|---|
| `fastlane/metadata/android/` | The store listing, `en-US` and `ar`: title, descriptions, icon, feature graphic, screenshots, and a changelog per release |
| `docs/fdroid/com.riwaq.reader.yml` | The build recipe. fdroiddata carries a copy as `metadata/com.riwaq.reader.yml` |
| `scripts/android-rustflags.sh` | The `RUSTFLAGS` both the release job and the recipe build with |
| `.github/workflows/fdroid-verify.yml` | Builds a commit in F-Droid's own build image and compares it with our APK |

## Every release

1. Add `fastlane/metadata/android/{en-US,ar}/changelogs/<versionCode>.txt`,
   500 characters at most. The name is the **versionCode**, not the version:
   `major*1000000 + minor*1000 + patch`, so 0.5.4 is `5004`.
2. Tag and let the Release workflow build the draft. `F-Droid verify` then runs
   on its own against that build. **Don't publish a release whose F-Droid
   verify failed:** F-Droid would build it, fail to match, and skip it.
3. Publish the release. F-Droid needs the APK at its public download URL.
4. Nothing to submit. F-Droid's `checkupdates` sees the new tag
   (`AutoUpdateMode: Version`) and adds the build to fdroiddata; it appears in
   the F-Droid client after their next build cycle, usually within days.

## Keeping the builds identical

F-Droid's builder is Debian trixie, as user `vagrant` under `/home/vagrant`.
Everything that would make its build differ from ours is pinned in both
places, and `scripts/verify-release-config.sh` fails the release preflight if
they drift:

| | Release job | Recipe |
|---|---|---|
| Rust | `dtolnay/rust-toolchain@1.97.1` | `--default-toolchain 1.97.1` (and `rust-toolchain.toml`) |
| NDK | 29.0.14206865, the only NDK on the runner | `ndk: 29.0.14206865` |
| RUSTFLAGS | `scripts/android-rustflags.sh` | `scripts/android-rustflags.sh` |
| JDK | Temurin 21 | trixie's OpenJDK 21 |
| Node, pnpm | 20, 9 | trixie's Node 20, pnpm 9 |

**Why the NDK is the only one installed.** The Tauri CLI links with the
newest NDK under `$ANDROID_HOME/ndk`, whatever `NDK_HOME` says. The release
job once installed r26b and every release was still linked by the runner's
r29 (each library's `.comment` says `clang version 21.0.0`), which the first
F-Droid test build, linked by r26b, could never match. So the job deletes the
runner's other NDKs, and a step after the build checks the library's
`.comment` against the pinned NDK's clang.

**Why the RUSTFLAGS.** Without them, each native library carried ~540
absolute paths into the building machine's cargo registry, from panic
locations in dependencies: `/home/runner/.cargo/registry/src/...` on GitHub,
`/home/vagrant/.cargo/...` on F-Droid. The script maps the cargo home to
`/cargo`. Cargo's `trim-paths` profile would do the same without a flag, but
it is not stable in Rust 1.97.1.

**The recipe differs from the release job in three places,** each because
F-Droid requires it, none affecting the APK's contents:

- JS dependencies install in `build`, not `prebuild`, so `node_modules` is not
  in the tree F-Droid's scanner checks.
- fdroidserver deletes `gradle-wrapper.jar` by itself, so the recipe
  regenerates it in `build`, at the version the committed wrapper pins: the
  Tauri CLI runs `./gradlew`. It does so in an empty directory, because the
  project's settings include `tauri.settings.gradle`, which only exists once
  the Tauri CLI has started its build. (Listing the jar under `scandelete` as well is
  an error, "Unused scandelete path".)
- The debug-signing fallback in `app/build.gradle.kts` is switched off in
  `prebuild`, so the build comes out unsigned for F-Droid to compare.
  fdroidserver strips the `signingConfigs { }` block itself, but not the
  multi-line `signingConfig = if (...)` that picks the fallback.
