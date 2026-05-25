# GitHub Actions release pipeline

**Date:** 2026-05-26
**Branch:** feat/release-pipeline

## Problem

There's no automated build pipeline. Anyone wanting to install Leaflet has to
clone the repo, install Tauri's prerequisites for their platform, run
`pnpm tauri build`, and hope nothing breaks. That's the gap between "the
README mentions GitHub Releases" and "actual installable binaries on GitHub
Releases."

This pipeline cuts a release on every `v*` tag push, producing installable
binaries for Linux, Windows, and Android, attached to a draft GitHub Release.

## Decisions (from the brainstorm)

- **Platforms:** Linux x86_64 (`.deb`, AppImage, `.rpm`), Windows x86_64
  (`.msi`, NSIS `.exe`), Android (APK, debug-signed). macOS and iOS skipped
  for v1.
- **Code signing:** none. README already documents the SmartScreen
  "Right-click → Unblock" workaround and the macOS Gatekeeper `xattr -d`
  trick — but with macOS dropped from this pipeline, only SmartScreen
  matters. Android uses the debug keystore (acceptable for sideload v1; will
  break upgrade path when a real keystore lands later — users will need to
  uninstall + reinstall once).
- **Triggers:** `push: tags: ['v*']` for real releases + `workflow_dispatch:`
  for manual builds without cutting a tag.
- **Release shape:** draft, auto-generated notes from commit subjects since
  the previous tag.
- **No secrets required.** Default `GITHUB_TOKEN` is enough.

## Architecture

### File

`.github/workflows/release.yml` — single workflow, three parallel jobs.

### Triggers

```yaml
on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
```

### Job: `linux`

- Runner: `ubuntu-22.04`.
- Steps:
  1. `actions/checkout@v4` (full history so release-note generation has the
     previous tag to diff against).
  2. `pnpm/action-setup@v4` (pnpm 9) + `actions/setup-node@v4` (Node 20,
     `cache: 'pnpm'`).
  3. `dtolnay/rust-toolchain@stable`.
  4. `swatinem/rust-cache@v2` keyed on `src-tauri/Cargo.lock`, workspaces
     `src-tauri`.
  5. APT system deps for Tauri 2 on Ubuntu 22.04:
     `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`,
     `patchelf`, `libssl-dev`.
  6. `pnpm install --frozen-lockfile`.
  7. `tauri-apps/tauri-action@v0` with:
     - `tagName: ${{ github.ref_name }}` (the `v0.1.0` tag)
     - `releaseName: ${{ github.ref_name }}`
     - `releaseDraft: true`
     - `prerelease: false`
     - `generate_release_notes: true` (delegated to GitHub via the action)
     - `args: ''` (default, builds all enabled bundles for the platform).

### Job: `windows`

- Runner: `windows-latest`.
- Steps: same as `linux` minus the APT install. Tauri-action handles
  WiX/NSIS toolchain on Windows runners automatically.

### Job: `android`

- Runner: `ubuntu-22.04` (Android builds use a Linux toolchain).
- Steps:
  1. `actions/checkout@v4`.
  2. `pnpm/action-setup@v4` + `actions/setup-node@v4`.
  3. `actions/setup-java@v4` with `distribution: temurin`, `java-version: 17`
     (Tauri 2 Android build needs JDK 17; 21 occasionally causes Gradle
     warnings).
  4. `android-actions/setup-android@v3` — installs SDK platform-tools and
     `platforms;android-36` (matches `compileSdk = 36` in
     `src-tauri/gen/android/app/build.gradle.kts`).
  5. Install NDK r26 (a known-good version for Tauri 2 on Android):
     `sdkmanager "ndk;26.1.10909125"`. Export `ANDROID_NDK_HOME` and
     `NDK_HOME` to the resolved path.
  6. `dtolnay/rust-toolchain@stable` with
     `targets: aarch64-linux-android, armv7-linux-androideabi`.
     **Skip x86 / x86_64 Android targets** — phones are ARM; saves ~5 min
     per run. Emulator-only x86 builds can be added later as a separate
     workflow if ever needed.
  7. `swatinem/rust-cache@v2` keyed on the Cargo.lock + the Android target
     suffix (so it doesn't collide with the Linux job's cache).
  8. Gradle cache via `actions/cache@v4` on `~/.gradle/caches` and
     `~/.gradle/wrapper`.
  9. `pnpm install --frozen-lockfile`.
  10. `pnpm tauri android build --apk --target aarch64-linux-android,armv7-linux-androideabi`
      Produces APKs under
      `src-tauri/gen/android/app/build/outputs/apk/universalRelease/`
      (or per-ABI dirs, depending on the Tauri version).
  11. Upload the APK(s) to the same draft release using
      `softprops/action-gh-release@v2`:
      - `tag_name: ${{ github.ref_name }}`
      - `draft: true`
      - `files: src-tauri/gen/android/app/build/outputs/apk/**/*.apk`
      - `fail_on_unmatched_files: true` (catch glob misses early)
      - `generate_release_notes: false` (the Linux/Windows jobs already
        generated them; this just appends artifacts).

### Race / idempotency

All three jobs race to write to a release identified by the tag name.
Both `tauri-action` and `softprops/action-gh-release` are idempotent on
release creation — whichever job lands first creates the draft release,
the others append their artifacts. No `needs:` dependencies between jobs
required.

## Files touched

| File | Change |
|---|---|
| `.github/workflows/release.yml` | **New file.** ~150 lines of YAML. |
| `.github/` | New directory if not already present. |

That's it. No source-code changes. No `package.json` script changes (we
already have `pnpm tauri build` and `pnpm tauri android build`).

## What this does NOT include (deferred)

- **macOS / iOS builds.** Requires a `macos-latest` runner (10× the
  Linux/Windows runner cost on GitHub Actions for public repos — though
  free up to 2000 minutes/month) and Apple Developer signing. Add later
  when needed.
- **Code signing.** Windows EV cert ($300–$500/yr), Apple Developer Program
  ($99/yr), Android release keystore. The README already documents the
  unsigned-binary workarounds for v1. Revisit when there are users
  complaining about SmartScreen.
- **F-Droid publishing.** Requires an `metadata/com.leaflet.reader.yml`
  manifest in the upstream f-droid/fdroiddata repo plus a build recipe.
  Whole separate process; defer.
- **Auto version-bump from tag.** Currently you edit `package.json`,
  `Cargo.toml`, and `tauri.conf.json` by hand before tagging. Could be
  automated by a "Bump version" workflow that takes the new version as
  input, edits the three files, commits, and tags. Out of scope.
- **PR-time CI** (typecheck, lint on every PR). Different workflow, much
  cheaper to run (no native build needed). Separate spec.
- **Universal APK / per-ABI split decision.** Tauri 2 generates a universal
  APK by default. We accept that; splitting into ARM-only and ARM64-only
  APKs would shrink APK size by ~30% but adds release-management complexity.
  Defer.
- **Self-hosted runners.** GitHub-hosted runners are fine for the scale of
  this project.
- **Tag → version sync verification.** Currently nothing checks that the
  pushed tag `v0.1.0` matches `package.json` "version": "0.1.0". A future
  PR-CI step could fail the build if they disagree. Out of scope.

## Caches

| Cache | Key | Layer |
|---|---|---|
| pnpm store | derived from `pnpm-lock.yaml` | `pnpm/action-setup@v4` |
| Cargo registry + git index + target dir | OS + `Cargo.lock` | `swatinem/rust-cache@v2` |
| Gradle wrapper + caches | `Cargo.lock` + Android target suffix | `actions/cache@v4` |

Expected cold run: 25–35 minutes. Warm run (caches hit): 12–18 minutes.

## Secrets

None. The default `GITHUB_TOKEN` is automatically scoped to the repo and
sufficient for creating releases + uploading artifacts.

If we ever add code signing, the secrets would live under
*Settings → Secrets and variables → Actions*. Specifically:
- `WINDOWS_CERT` + `WINDOWS_CERT_PASSWORD` (base64-encoded PFX).
- `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
- `ANDROID_KEY_BASE64`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS`.

## Test plan

1. After this workflow lands on `main`, push a dry-run tag:
   `git tag v0.0.1-rc && git push origin v0.0.1-rc`.
2. Open the Actions tab. The "Release" workflow should be running, with
   three parallel jobs: `linux`, `windows`, `android`.
3. Each job should complete successfully. Total wall-clock time ≈ 20–30
   minutes cold.
4. The Releases page should show a new **draft** release `v0.0.1-rc` with:
   - Auto-generated release notes from commits since the previous tag (or
     "Initial release" content if this is the first one).
   - Linux artifacts: at least one `.deb`, one `.AppImage`, one `.rpm`.
   - Windows artifacts: one `.msi` and/or one NSIS `.exe`.
   - Android artifact: one `.apk` (universal or per-ABI).
5. Download each artifact and install on the respective platform. Confirm
   the app launches and the Library appears.
6. Once verified, delete the draft release and the dry-run tag:
   ```bash
   gh release delete v0.0.1-rc --cleanup-tag
   ```
   (Or via the GitHub web UI: delete the release, then go to *Code → Tags
   → Delete*.)
7. When ready for real v1: bump `version` in `package.json`,
   `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` to `0.1.0`, commit,
   tag `v0.1.0`, push tags.

## Risks / known issues to monitor

- **`tauri-action` major-version churn.** The `@v0` tag pins to the v0.x
  series. If the action publishes a v1 with breaking changes, our pipeline
  silently keeps working on v0 until we explicitly bump it.
- **Ubuntu 22.04 deprecation timeline.** Tauri 2's Linux deps target
  webkit2gtk 4.1, which ships on Ubuntu 22.04+. When Ubuntu 22.04 reaches
  EOL on GitHub Actions runners (currently scheduled for early 2027 per
  GitHub's runner deprecation policy), we'll need to update to
  `ubuntu-24.04` and verify webkit2gtk-4.1 is still available (it should
  be).
- **Android NDK version skew.** Pinning NDK r26 today is safe; Tauri 2
  works with r25 through r27. If Tauri changes the supported range, the
  pinned version may need a bump.
- **Build-time blowout.** Cold-start time of ~30 min is acceptable. If it
  ever creeps to 45+ min, consider splitting the Linux job into a separate
  job per bundle target (`.deb` vs AppImage) and parallelizing them.
