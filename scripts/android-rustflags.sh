#!/usr/bin/env bash
# The RUSTFLAGS every Android release build of Riwaq is compiled with.
#
# Printed rather than exported so the release workflow and F-Droid's recipe
# (docs/fdroid/com.riwaq.reader.yml) both run `RUSTFLAGS="$(this script)"`
# and cannot drift apart.
#
# F-Droid ships our signed APK only if its own build of the same commit comes
# out byte-identical. Without this, every native library carried ~540
# absolute paths into the machine's cargo registry, from panic locations in
# dependencies: /home/runner/.cargo/registry/src/... on GitHub, and
# /home/vagrant/.cargo/... on F-Droid's builder. Mapping the cargo home to a
# fixed prefix makes those strings the same everywhere.
#
# Our own crate's paths are already relative, and the standard library's are
# /rustc/<commit>/..., so the cargo home is the only prefix that varies.
# (Cargo's `trim-paths` profile would do this without a flag, but it is not
# stable in the pinned 1.97.1.)
set -euo pipefail
printf -- '--remap-path-prefix=%s=/cargo' "${CARGO_HOME:-$HOME/.cargo}"
