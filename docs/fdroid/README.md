# F-Droid

Two halves. The first is done and lives in this repository; the second is a
merge request on GitLab that only the maintainer can open.

## In this repository: `fastlane/metadata/android/`

F-Droid reads an app's listing out of the app's own repository, in fastlane
layout. Present for `en-US` and `ar`:

| File | Limit | Actual |
|---|---|---|
| `title.txt` | 50 | 5 / 4 |
| `short_description.txt` | 80 | 77 / 63 |
| `full_description.txt` | 4000 | 2192 / 1663 |
| `changelogs/5001.txt` | 500 | 424 / 312 |

Plus `images/icon.png` (512x512), `images/featureGraphic.png` (1024x500) and
`images/phoneScreenshots/` (1080x2400, captured on the API 36 emulator).

**The changelog file is named after the versionCode, not the version.** The
code is `major*1000000 + minor*1000 + patch`, so 0.5.1 is `5001`. Confirmed
against a device: the installed 0.4.1 build reports `versionCode=4001`.

Add `changelogs/<code>.txt` for every release, or F-Droid shows nothing.

## Not in this repository: the fdroiddata merge request

`docs/fdroid/com.riwaq.reader.yml` is a draft of the recipe that goes in a
fork of [fdroiddata](https://gitlab.com/fdroid/fdroiddata) as
`metadata/com.riwaq.reader.yml`. It is **untested** and will need iteration
against F-Droid's own builder, which is the only place it can be run.

## The decision to make first: who signs the APK

This one cannot be undone later, so it is worth settling before submitting.

By default **F-Droid builds the app and signs it with F-Droid's key.** That
signature differs from the release keystore used for the GitHub APK, and
Android refuses to update an installed app with a differently-signed one. A
reader who installed from GitHub would have to uninstall, losing their
library, to move to the F-Droid build. The two channels become separate
worlds.

The alternative is a [reproducible build](https://f-droid.org/docs/Reproducible_Builds/):
F-Droid builds the app, verifies its output matches the APK published here,
and then ships the binary signed with *this* project's key. Both channels
stay one lineage and readers can move freely between them.

F-Droid's own guidance is that this is worth doing for a *new* app precisely
because it cannot be adopted retroactively. Riwaq is new to F-Droid, so the
choice is still open. It costs a `AllowedAPKSigningKeys` line plus making the
build actually byte-reproducible, which for a Rust and Node build is real work.

## Reproducible builds: what still blocks it

The recipe now asks F-Droid to verify its build against the published APK and
ship ours (`Binaries:` plus `AllowedAPKSigningKeys:`). Two things in this
repository stop that working today, both found by reading the release
pipeline rather than by guessing.

**1. The Rust toolchain is not pinned.** `.github/workflows/release.yml` uses
`dtolnay/rust-toolchain@stable`, so every release is built with whatever
stable happened to be current that day. F-Droid cannot reproduce a build
whose compiler is "whatever was newest in September". A `rust-toolchain.toml`
pinning an exact version is a prerequisite, and it changes what CI installs,
so it wants its own change rather than riding along with documentation.

**2. The NDK version has to stay in step.** `release.yml` installs
`ndk;26.1.10909125`. The recipe now pins the same string. If one moves and
the other does not, the builds differ and verification fails with no obvious
cause. Worth a comment in both files, or a check in `verify-release-config.sh`.

Beyond those, reproducibility usually turns on build paths, timestamps and
archive ordering leaking into the APK. None of that has been tested here,
because testing it means running F-Droid's builder.

**Do not submit until the toolchain is pinned.** Submitting with `@stable`
means the first verification attempt fails, and the usual outcome is falling
back to F-Droid signing, which is the thing reproducible builds exist to
avoid and cannot be undone afterwards.
