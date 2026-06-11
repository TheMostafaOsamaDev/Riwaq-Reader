# GitHub Actions Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `.github/workflows/release.yml` that builds Leaflet on every `v*` tag push for Linux x86_64, Windows x86_64, and Android (ARM + ARM64), and attaches all binaries to a draft GitHub Release with auto-generated notes.

**Architecture:** Single workflow file, three parallel jobs (`linux`, `windows`, `android`), each producing one platform's bundles. Linux + Windows use the official `tauri-apps/tauri-action@v0`. Android uses a custom recipe (JDK 17 + Android SDK 36 + NDK r26 + Rust Android targets + `pnpm tauri android build`) and uploads its APK via `softprops/action-gh-release@v2`. Both upload paths are idempotent on release creation. `workflow_dispatch` builds run without publishing.

**Tech Stack:** GitHub Actions YAML, `tauri-apps/tauri-action@v0`, `softprops/action-gh-release@v2`, `swatinem/rust-cache@v2`, `pnpm/action-setup@v4`.

**Spec:** `docs/superpowers/specs/2026-05-26-github-release-pipeline-design.md`

---

## File Structure

| File | Purpose | New? |
|---|---|---|
| `.github/workflows/release.yml` | The whole pipeline — three jobs in one workflow. | New |

`.github/` doesn't exist yet; the Write tool will create it implicitly. No other files change.

---

## Task 1: Write `.github/workflows/release.yml`

**Files:**
- Create: `.github/workflows/release.yml`

The whole workflow lands in one commit. No subtasks worth splitting — the three jobs are tightly related and live in the same file.

### Step 1.1: Write the workflow file

Use the Write tool. Path: `.github/workflows/release.yml`

```yaml
# GitHub Actions release pipeline for Leaflet.
#
# Two trigger paths:
#   - push tag `v*`     → real release. Creates a DRAFT GitHub Release
#                         named after the tag (e.g. `v0.1.0`), with all
#                         platform binaries attached + auto-generated
#                         notes. You manually hit "Publish" once you've
#                         downloaded + verified the binaries.
#   - workflow_dispatch → manual smoke test. Builds all three platforms
#                         but doesn't create or upload to any release.
#                         Useful when iterating on the workflow itself.
#
# No secrets required. Default GITHUB_TOKEN is sufficient.
#
# Out of scope (deferred): macOS / iOS builds, code signing (Windows EV,
# Apple Dev ID, Android release keystore), F-Droid metadata.

name: Release

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

# Allow the workflow to create and upload to releases.
permissions:
  contents: write

jobs:
  # ──────────────────────────────────────────────────────────────────
  # Linux x86_64 — .deb, .AppImage, .rpm
  # ──────────────────────────────────────────────────────────────────
  linux:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # full history so release-note generation
                          # can diff against the previous tag

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install Linux build dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            patchelf \
            libssl-dev

      - uses: dtolnay/rust-toolchain@stable

      - uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
          key: linux

      - name: Install JS dependencies
        run: pnpm install --frozen-lockfile

      - name: Build + (on tag) publish
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          # On a tag push, fill these to create / upload to a release.
          # On workflow_dispatch, leave them empty so tauri-action just
          # builds and skips the upload.
          tagName: ${{ startsWith(github.ref, 'refs/tags/') && github.ref_name || '' }}
          releaseName: ${{ startsWith(github.ref, 'refs/tags/') && github.ref_name || '' }}
          releaseDraft: true
          prerelease: false
          generateReleaseNotes: true

  # ──────────────────────────────────────────────────────────────────
  # Windows x86_64 — .msi (WiX) + .exe (NSIS)
  # ──────────────────────────────────────────────────────────────────
  windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - uses: dtolnay/rust-toolchain@stable

      - uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
          key: windows

      - name: Install JS dependencies
        run: pnpm install --frozen-lockfile

      - name: Build + (on tag) publish
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ startsWith(github.ref, 'refs/tags/') && github.ref_name || '' }}
          releaseName: ${{ startsWith(github.ref, 'refs/tags/') && github.ref_name || '' }}
          releaseDraft: true
          prerelease: false
          generateReleaseNotes: true

  # ──────────────────────────────────────────────────────────────────
  # Android — APK (ARM + ARM64; x86 / x86_64 skipped, phones are ARM)
  # ──────────────────────────────────────────────────────────────────
  android:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17

      - uses: android-actions/setup-android@v3
        with:
          packages: 'platforms;android-36 build-tools;36.0.0 platform-tools'

      - name: Install Android NDK r26
        run: |
          sdkmanager "ndk;26.1.10909125"
          echo "ANDROID_NDK_HOME=$ANDROID_SDK_ROOT/ndk/26.1.10909125" >> $GITHUB_ENV
          echo "NDK_HOME=$ANDROID_SDK_ROOT/ndk/26.1.10909125" >> $GITHUB_ENV

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-linux-android,armv7-linux-androideabi

      - uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
          key: android

      - name: Cache Gradle
        uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
          key: ${{ runner.os }}-gradle-${{ hashFiles('src-tauri/gen/android/**/*.gradle*', 'src-tauri/gen/android/**/gradle-wrapper.properties') }}
          restore-keys: |
            ${{ runner.os }}-gradle-

      - name: Install JS dependencies
        run: pnpm install --frozen-lockfile

      - name: Build Android APK (ARM + ARM64)
        run: pnpm tauri android build --apk --target aarch64-linux-android,armv7-linux-androideabi

      - name: Upload APK(s) to draft release (on tag push only)
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          name: ${{ github.ref_name }}
          draft: true
          generate_release_notes: true
          fail_on_unmatched_files: true
          files: src-tauri/gen/android/app/build/outputs/apk/**/*.apk
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload APK(s) as workflow artifact (always)
        # Even on workflow_dispatch (no tag), keep the APK reachable so
        # the manual smoke-test produces something the user can download
        # and install on a phone.
        uses: actions/upload-artifact@v4
        with:
          name: android-apk
          path: src-tauri/gen/android/app/build/outputs/apk/**/*.apk
          if-no-files-found: error
          retention-days: 14
```

### Step 1.2: YAML sanity check

The workflow file uses GitHub Actions YAML, not standard YAML — no local linter perfectly validates it. Two quick checks that catch the most common mistakes:

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"
```
Expected: no output, exit 0. Confirms basic YAML syntax is valid.

Run:
```bash
grep -c "^  [a-z]*:$" .github/workflows/release.yml
```
Expected: at least 3 (the three job names — `linux`, `windows`, `android`).

If either check fails, re-read the file and fix indentation / spelling.

### Step 1.3: Commit

```bash
git add .github/workflows/release.yml
git commit -m "$(cat <<'EOF'
ci: add release workflow for Linux / Windows / Android

Three parallel jobs build on every `v*` tag push and on manual
workflow_dispatch. Tag pushes produce a draft GitHub Release with
auto-generated notes; manual runs build everything but skip the
release upload.

Linux + Windows go through tauri-apps/tauri-action@v0. Android is
a custom recipe (JDK 17 + Android SDK 36 + NDK r26 + Rust ARM/ARM64
targets + softprops/action-gh-release@v2 for the APK upload).

No code signing yet — README documents the SmartScreen / Gatekeeper
workarounds for unsigned binaries. Adding signing later is an
incremental change to this workflow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Step 1.4: Sanity check the commit

Run:
```bash
git show HEAD --stat
```

Expected: exactly one file added — `.github/workflows/release.yml`. Roughly 150–170 lines of inserts, zero deletions.

---

## Task 2: User pushes the branch and opens a PR

**Cannot be done by an implementer subagent — requires the user's GitHub credentials.**

### - [ ] Step 2.1: Push the branch

```bash
git push -u origin feat/release-pipeline
```

Expected output ends with a link like `https://github.com/TheMostafaOsamaDev/Leaflet-ebook-reader/pull/new/feat/release-pipeline`.

### - [ ] Step 2.2: Open the PR

Click the link above (or visit the URL manually). Fill in:

- **Title:** `ci: add release workflow for Linux / Windows / Android`
- **Body:** see the controller's PR-URL message after Task 1; the body covers what's in, what's deferred, and the dry-run verification plan.

Click "Create pull request".

### - [ ] Step 2.3: Merge the PR

Self-review the diff in the GitHub web UI, then merge to `main`.

The workflow file only becomes available to trigger from the `main` branch once it's merged (technically, `workflow_dispatch` can run from any branch where the workflow exists — but to test the real `tag push` path you want the file on `main`).

---

## Task 3: User runs the dry-run verification

**Cannot be done by an implementer subagent — requires manually pushing a tag and inspecting the GitHub UI.**

This is the equivalent of the on-device verification from the notification spec: the implementation can be confirmed correct only by exercising it.

### - [ ] Step 3.1: Sync local main

```bash
git checkout main
git pull origin main
```

### - [ ] Step 3.2: Cut a dry-run tag

The "rc" suffix (release candidate) flags this as a test; you'll delete it at the end. Use a leading-zero version so it sorts before real releases in the Releases list.

```bash
git tag v0.0.1-rc
git push origin v0.0.1-rc
```

### - [ ] Step 3.3: Watch the workflow

Open `https://github.com/TheMostafaOsamaDev/Leaflet-ebook-reader/actions` in a browser.

Click the running "Release" workflow. You should see three jobs in parallel: `linux`, `windows`, `android`.

Expected total wall-clock time:
- Cold caches (first run): 25–35 minutes.
- Warm caches (subsequent runs): 12–18 minutes.

While they run, you can move on to step 3.4 — the workflow will continue regardless.

### - [ ] Step 3.4: Inspect the draft release

While jobs are running (or once they finish), open `https://github.com/TheMostafaOsamaDev/Leaflet-ebook-reader/releases`.

A new **draft** release titled `v0.0.1-rc` should appear. As each job finishes it appends its artifacts. Expected when all three are green:

- Linux: at least one `.deb`, one `.AppImage`, one `.rpm`.
- Windows: at least one `.msi` and one `.exe` (NSIS).
- Android: at least one `.apk`.
- Auto-generated release notes listing commits since the previous tag.

### - [ ] Step 3.5: Smoke-test the binaries

- **Linux:** download the AppImage, `chmod +x` it, run it. Confirm the app window opens and the Library renders. The `.deb` and `.rpm` are bonus — verify they at least install via `sudo dpkg -i …` / `sudo rpm -i …` without errors. Don't need to fully exercise the app on all three.
- **Windows:** download the `.msi`. Install. Confirm the Start Menu shortcut launches the app. SmartScreen will warn — right-click installer → Properties → check "Unblock" → re-run. This is expected; documented in the README.
- **Android:** download the APK from the release. Sideload onto your phone (Settings → Apps → permission for the browser to install unknown apps, or `adb install path/to/file.apk` from the dev machine). Confirm the app opens. Trigger one chapter download to verify the native progress notification still works (the feature that just landed depends on this APK being built correctly).

### - [ ] Step 3.6: Verify the workflow_dispatch path

In the Actions tab, click "Release" → "Run workflow" (top right) → pick the `main` branch → "Run workflow".

Expected: all three jobs run, all succeed, **no new release is created**. The Linux/Windows tauri-action skips its upload (empty `tagName` input), and the Android upload step is gated on `startsWith(github.ref, 'refs/tags/')`.

The Android job uploads its APK as a **workflow artifact** instead (downloadable from the workflow run page for 14 days). Confirm the artifact is there. Linux/Windows artifacts aren't currently uploaded on workflow_dispatch — adding that is a future polish item.

---

## Task 4: User cleans up the dry-run release

**Cannot be done by an implementer subagent.**

### - [ ] Step 4.1: Delete the draft release

In `https://github.com/TheMostafaOsamaDev/Leaflet-ebook-reader/releases`, hover over the `v0.0.1-rc` draft → "..." menu → "Delete".

### - [ ] Step 4.2: Delete the dry-run tag

```bash
git push --delete origin v0.0.1-rc
git tag -d v0.0.1-rc
```

### - [ ] Step 4.3: Cut the real v0.1.0 (when ready)

Pre-flight:

```bash
# Confirm versions agree across the three places they live.
grep '"version"' package.json
grep '^version =' src-tauri/Cargo.toml
grep '"version"' src-tauri/tauri.conf.json
```

All three should read `0.1.0` (or whatever your first release number is). If not, edit them, commit on a branch, PR, merge to main.

Then:

```bash
git checkout main
git pull
git tag v0.1.0
git push origin v0.1.0
```

The workflow fires automatically. Wait for it to complete (~15-30 min). Visit the Releases page, click into the draft `v0.1.0`, edit the auto-generated notes if you want to add a human touch, and click "Publish release".

---

## Spec-coverage cross-check

| Spec requirement | Task |
|---|---|
| Trigger on `v*` tag push | Task 1 (`on: push: tags: ['v*']`) |
| Trigger on workflow_dispatch | Task 1 (`on: workflow_dispatch:`) |
| Linux x86_64 builds (deb, AppImage, rpm) | Task 1 — `linux` job |
| Windows x86_64 builds (msi, NSIS exe) | Task 1 — `windows` job |
| Android APK build (ARM + ARM64 only) | Task 1 — `android` job with `--target aarch64-linux-android,armv7-linux-androideabi` |
| Draft release with auto-generated notes | Task 1 — `releaseDraft: true` + `generateReleaseNotes: true` on tauri-action; mirror on softprops step |
| Caching: pnpm, Cargo, Gradle | Task 1 — `pnpm/action-setup@v4 + cache: pnpm`, `swatinem/rust-cache@v2`, `actions/cache@v4` for Gradle |
| No code signing | Task 1 — no signing inputs; relies on debug-keystore for Android |
| No secrets | Task 1 — only `GITHUB_TOKEN` used |
| workflow_dispatch skips release upload | Task 1 — empty `tagName` expression + `if: startsWith(github.ref, 'refs/tags/')` on softprops step |
| Dry-run verification with `v0.0.1-rc` | Task 3 |
| Cleanup steps | Task 4 |

---

## Risks / known issues

- **`tauri-apps/tauri-action@v0` parameter naming.** The plan uses `tagName`, `releaseName`, `releaseDraft`, `prerelease`, `generateReleaseNotes`. These are the v0.5+ names. If the action's input names have drifted, the implementer should consult the current README at `https://github.com/tauri-apps/tauri-action`.
- **Android NDK version pin.** `ndk;26.1.10909125` is a specific full version. If `sdkmanager` no longer offers that exact version when this runs, switch to a nearby r26 — e.g., `26.3.11579264`. Both work with Tauri 2.
- **Ubuntu 22.04 deprecation.** GitHub Actions tentatively retires `ubuntu-22.04` in early 2027. When the runner shifts to `ubuntu-24.04`, verify `libwebkit2gtk-4.1-dev` is still available (it should be — Ubuntu 24.04 ships the same package).
- **`generateReleaseNotes` on multiple jobs.** Both `tauri-action` and `softprops` are passed `generateReleaseNotes: true` / `generate_release_notes: true`. They're idempotent on this — the first job to create the release fills in the notes; subsequent calls don't overwrite.
- **Linux deps may need updates over time.** `libwebkit2gtk-4.1-dev` and `libayatana-appindicator3-dev` are the current correct package names on Ubuntu 22.04 for Tauri 2. If the build fails with a missing-pkg error, check the Tauri 2 Linux setup docs.

---

## Post-implementation

- Task 1 produces one commit on `feat/release-pipeline`.
- Tasks 2-4 are user-side and don't add commits.
- After the dry-run passes, the PR can merge to `main`.
- The first real release (`v0.1.0`) is a user action that the workflow handles automatically.

End-of-flow: a `v0.1.0` release on the Releases page with installable binaries for three platforms. The README links to that page; non-technical users can finally download Leaflet.
