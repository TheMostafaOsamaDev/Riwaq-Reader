#!/usr/bin/env bash
#
# Preflight for a release tag. Runs in seconds, before any platform builds.
#
# Why this exists. Every other guard in this pipeline checks an ARTIFACT, which
# means it can only fail after the ~30 minutes of building that produced it —
# and then it reports the symptom, not the cause. The v0.2.0 dry run found
# three faults that all present identically as "the manifest job failed with
# missing url for <platform>":
#
#   * bundle.createUpdaterArtifacts absent (it defaults to FALSE), so the
#     bundler emits no .sig and no updater bundle at all;
#   * plugins.updater.pubkey empty, which ships a binary that can never be
#     updated — permanently, because the key is compiled in;
#   * the four version fields disagreeing with the tag.
#
# release.yml's own comment blamed the first on missing signing secrets, so the
# maintainer would have wired up all six secrets and watched it fail the same
# way. Catching the cause up front is worth more than catching the symptom late.
#
# Usage:
#   verify-release-config.sh v0.2.0
#   verify-release-config.sh --self-test

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { echo "verify-release-config: $*" >&2; exit 1; }

# ── the checks ────────────────────────────────────────────────────────────
# Echoes problems, returns nonzero if any. A function so --self-test drives the
# real logic rather than a copy.
check_config() {
  local root="$1" tag="${2#v}" problems=0
  local conf="$root/src-tauri/tauri.conf.json"
  local pkg="$root/package.json"
  local cargo="$root/src-tauri/Cargo.toml"

  for f in "$conf" "$pkg" "$cargo"; do
    [ -f "$f" ] || { echo "missing $f"; return 1; }
  done

  local v_conf v_pkg v_cargo pubkey updater_artifacts
  v_conf="$(jq -r '.version // empty' "$conf")"
  v_pkg="$(jq -r '.version // empty' "$pkg")"
  v_cargo="$(sed -n 's/^version = "\(.*\)"/\1/p' "$cargo" | head -n1)"
  pubkey="$(jq -r '.plugins.updater.pubkey // empty' "$conf")"
  updater_artifacts="$(jq -r '.bundle.createUpdaterArtifacts // false' "$conf")"

  # Versions must agree with each other AND with the tag. Android derives its
  # versionCode from tauri.conf.json, the updater compares against it, and
  # cargo --locked fails if Cargo.toml drifts from Cargo.lock.
  for pair in "tauri.conf.json:$v_conf" "package.json:$v_pkg" "Cargo.toml:$v_cargo"; do
    local name="${pair%%:*}" val="${pair#*:}"
    if [ -z "$val" ]; then
      echo "$name has no version"; problems=$((problems + 1))
    elif [ -n "$tag" ] && [ "$val" != "$tag" ]; then
      echo "$name is $val but the tag says $tag"; problems=$((problems + 1))
    fi
  done

  # Cargo.lock has to carry the same version or `cargo check --locked` fails
  # in every build job, ~25 minutes apart, for a one-line reason.
  local lock="$root/src-tauri/Cargo.lock"
  if [ -f "$lock" ] && [ -n "$v_cargo" ]; then
    if ! grep -q "^name = \"riwaq\"$" "$lock" \
       || ! awk '/^name = "riwaq"$/{f=1;next} f&&/^version = /{print;exit}' "$lock" \
            | grep -q "\"$v_cargo\""; then
      echo "Cargo.lock does not record riwaq $v_cargo — run 'cargo update --workspace'"
      problems=$((problems + 1))
    fi
  fi

  # The updater is configured, so it must be able to actually produce and
  # verify an update. Either of these being wrong ships a dead feature.
  if [ "$(jq -r 'has("plugins") and (.plugins | has("updater"))' "$conf")" = "true" ]; then
    if [ -z "$pubkey" ]; then
      echo "plugins.updater.pubkey is EMPTY — the key is compiled into every binary, so this release could never be updated, even by a later fixed one. Run 'pnpm tauri signer generate' and paste the public half."
      problems=$((problems + 1))
    fi
    if [ "$updater_artifacts" != "true" ]; then
      echo "bundle.createUpdaterArtifacts is not true — the bundler emits no .sig and no updater bundle, so latest.json cannot be built no matter which secrets are set."
      problems=$((problems + 1))
    fi
  fi


  # The Rust toolchain must be pinned, and pinned to ONE version.
  #
  # F-Droid ships our signed APK only if its build comes out byte-identical to
  # the published one, which it cannot do against "whatever stable was current
  # that day". rustup reads rust-toolchain.toml; the workflows cannot, because
  # dtolnay/rust-toolchain selects by its own git ref. So the version is
  # written twice and this check is what stops the two rotting apart — a drift
  # here means the APK users get and the APK F-Droid builds differ for a
  # reason nothing else in the pipeline would report.
  local wfdir="$root/.github/workflows" tc="$root/rust-toolchain.toml"
  if [ -d "$wfdir" ]; then
    local channel refs bad
    channel="$(sed -n 's/^[[:space:]]*channel[[:space:]]*=[[:space:]]*"\(.*\)".*/\1/p' "$tc" 2>/dev/null | head -n1)"
    if [ -z "$channel" ]; then
      echo "rust-toolchain.toml has no [toolchain] channel — the Rust version is unpinned, so no release built from it can ever be reproduced"
      problems=$((problems + 1))
    else
      refs="$(grep -ho 'dtolnay/rust-toolchain@[^[:space:]]*' "$wfdir"/*.yml 2>/dev/null | sed 's|.*@||' | sort -u)"
      bad="$(printf '%s\n' "$refs" | grep -v "^$channel$" || true)"
      if [ -n "$bad" ]; then
        echo "workflows pin dtolnay/rust-toolchain@$(printf '%s' "$bad" | tr '\n' ' ' | sed 's/ $//') but rust-toolchain.toml says $channel"
        problems=$((problems + 1))
      fi
    fi
  fi

  # The F-Droid recipe must build the way release.yml does.
  #
  # F-Droid builds our tag with docs/fdroid/com.riwaq.reader.yml and ships the
  # published APK only if its build is byte-identical. A different NDK, a
  # different Rust, or a build without the path-remapping RUSTFLAGS each make
  # every build differ, and F-Droid then simply stops publishing Riwaq, with
  # nothing in this repository failing.
  local recipe="$root/docs/fdroid/com.riwaq.reader.yml" rel="$wfdir/release.yml"
  if [ -f "$recipe" ] && [ -f "$rel" ]; then
    local ndk_rel ndk_rec rust_rec
    # `ndk=<version>` in the install step, or a literal `ndk;<version>`.
    ndk_rel="$(grep -o -E '(^[[:space:]]*ndk=|ndk;)[0-9][0-9.]*' "$rel" | head -n1 | sed -E 's/.*(=|;)//')"
    ndk_rec="$(sed -n 's/^[[:space:]]*ndk:[[:space:]]*\([0-9.]*\).*/\1/p' "$recipe" | head -n1)"
    if [ "$ndk_rel" != "$ndk_rec" ]; then
      echo "docs/fdroid recipe builds with NDK '${ndk_rec}' but release.yml installs '${ndk_rel}'"
      problems=$((problems + 1))
    fi
    rust_rec="$(grep -o -- '--default-toolchain [0-9.]*' "$recipe" | head -n1 | sed 's/.* //')"
    if [ -n "${channel:-}" ] && [ "$rust_rec" != "$channel" ]; then
      echo "docs/fdroid recipe installs Rust '${rust_rec}' but rust-toolchain.toml says $channel"
      problems=$((problems + 1))
    fi
    local f
    for f in "$recipe" "$rel"; do
      if ! grep -q 'scripts/android-rustflags.sh' "$f"; then
        echo "${f#"$root"/} does not build with scripts/android-rustflags.sh, so its native library carries that machine's paths"
        problems=$((problems + 1))
      fi
    done
  fi

  # ...and the recipe must name the release being cut.
  #
  # Its Builds entry is the copy fdroiddata carries, and F-Droid's checkupdates
  # only adds LATER tags on top of it, so a stale entry is the floor for every
  # version after it. Nothing else here reports one: fdroid-verify.yml rewrites
  # these three fields for its test build, so the reproducibility check passes
  # green against a recipe that would be wrong the moment it reached fdroiddata.
  # That is how `versionName: 0.5.4` — a version that was never released — sat
  # in this file while 0.5.3 was the published build.
  # The same arithmetic Android applies to tauri.conf.json's version.
  local want_code=""
  [ -n "$tag" ] && want_code="$(printf '%s' "$tag" | awk -F. '{printf "%d", $1*1000000 + $2*1000 + $3}')"

  if [ -f "$recipe" ] && [ -n "$tag" ]; then
    local rec_name rec_code rec_commit cur_name cur_code
    rec_name="$(sed -n 's/^[[:space:]]*-[[:space:]]*versionName:[[:space:]]*\(.*\)/\1/p' "$recipe" | head -n1)"
    rec_code="$(sed -n 's/^[[:space:]]*versionCode:[[:space:]]*\(.*\)/\1/p' "$recipe" | head -n1)"
    rec_commit="$(sed -n 's/^[[:space:]]*commit:[[:space:]]*\(.*\)/\1/p' "$recipe" | head -n1)"
    cur_name="$(sed -n 's/^CurrentVersion:[[:space:]]*\(.*\)/\1/p' "$recipe" | head -n1)"
    cur_code="$(sed -n 's/^CurrentVersionCode:[[:space:]]*\(.*\)/\1/p' "$recipe" | head -n1)"
    local pair
    for pair in "versionName:$rec_name:$tag" "commit:$rec_commit:v$tag" \
                "versionCode:$rec_code:$want_code" \
                "CurrentVersion:$cur_name:$tag" "CurrentVersionCode:$cur_code:$want_code"; do
      local field="${pair%%:*}" rest="${pair#*:}"
      local got="${rest%%:*}" want="${rest#*:}"
      if [ "$got" != "$want" ]; then
        echo "docs/fdroid recipe says $field '$got' but this release is '$want'"
        problems=$((problems + 1))
      fi
    done
  fi

  # F-Droid reads the release notes it shows from a file named after the
  # versionCode, so a missing one publishes the update with a blank changelog
  # in both languages — and the file can only be added by cutting ANOTHER
  # release, because the name is the code. Over 500 characters it is truncated
  # mid-sentence in the client.
  if [ -n "$tag" ] && [ -d "$root/fastlane/metadata/android" ]; then
    local lang notes chars
    for lang in en-US ar; do
      notes="$root/fastlane/metadata/android/$lang/changelogs/$want_code.txt"
      if [ ! -s "$notes" ]; then
        echo "${notes#"$root"/} is missing or empty — F-Droid would publish $tag with no changelog in $lang"
        problems=$((problems + 1))
      else
        chars="$(wc -m < "$notes" | tr -d ' ')"
        if [ "$chars" -gt 500 ]; then
          echo "${notes#"$root"/} is $chars characters — F-Droid truncates at 500"
          problems=$((problems + 1))
        fi
      fi
    done
  fi

  [ "$problems" -eq 0 ]
}

# ── self-test ─────────────────────────────────────────────────────────────
if [ "${1:-}" = "--self-test" ]; then
  command -v jq >/dev/null || die "jq is required"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  fails=0
  mk() { # dir version pubkey artifacts
    local d="$tmp/$1"; mkdir -p "$d/src-tauri"
    printf '{"version":"%s"}\n' "$2" > "$d/package.json"
    printf 'version = "%s"\n' "$2" > "$d/src-tauri/Cargo.toml"
    printf 'name = "riwaq"\nversion = "%s"\n' "$2" > "$d/src-tauri/Cargo.lock"
    jq -n --arg v "$2" --arg pk "$3" --argjson ua "$4" \
      '{version:$v, bundle:{createUpdaterArtifacts:$ua}, plugins:{updater:{pubkey:$pk}}}' \
      > "$d/src-tauri/tauri.conf.json"
    echo "$d"
  }
  expect() { # want label dir tag
    local out rc; out="$(check_config "$3" "$4" 2>&1)"; rc=$?
    if [ "$rc" -eq "$1" ]; then echo "  ok   $2"
    else echo "  FAIL $2 (rc=$rc want $1): $out"; fails=$((fails+1)); fi
  }
  expect 0 "a fully configured release passes"        "$(mk good 0.2.0 KEY true)"     v0.2.0
  expect 0 "the tag's leading v is optional"          "$(mk good2 0.2.0 KEY true)"    0.2.0
  expect 1 "an empty pubkey is caught"                "$(mk nokey 0.2.0 '' true)"     v0.2.0
  expect 1 "createUpdaterArtifacts=false is caught"   "$(mk noart 0.2.0 KEY false)"   v0.2.0
  expect 1 "a version that disagrees with the tag"    "$(mk good3 0.2.0 KEY true)"    v0.3.0
  d="$(mk skew 0.2.0 KEY true)"; printf '{"version":"0.1.0"}\n' > "$d/package.json"
  expect 1 "package.json out of step is caught"       "$d"                            v0.2.0
  d2="$(mk lock 0.2.0 KEY true)"; printf 'name = "riwaq"\nversion = "0.1.0"\n' > "$d2/src-tauri/Cargo.lock"
  expect 1 "a stale Cargo.lock is caught"             "$d2"                           v0.2.0

  # toolchain pinning
  mktc() { # dir channel workflow-ref
    local d; d="$(mk "$1" 0.2.0 KEY true)"; mkdir -p "$d/.github/workflows"
    [ -n "$2" ] && printf '[toolchain]\nchannel = "%s"\n' "$2" > "$d/rust-toolchain.toml"
    printf 'jobs:\n  b:\n    steps:\n      - uses: dtolnay/rust-toolchain@%s\n' "$3" \
      > "$d/.github/workflows/ci.yml"
    echo "$d"
  }
  expect 0 "a pinned toolchain matching the workflows"  "$(mktc tcok 1.97.1 1.97.1)"  v0.2.0
  expect 1 "a workflow pinned to a different version"   "$(mktc tcdrift 1.97.1 1.96.0)" v0.2.0
  expect 1 "a workflow still floating on @stable"       "$(mktc tcfloat 1.97.1 stable)" v0.2.0
  expect 1 "no rust-toolchain.toml at all"              "$(mktc tcnone "" 1.97.1)"    v0.2.0

  # F-Droid recipe in step with release.yml
  # A recipe carries the release's version as well as its toolchain, so the
  # fixture writes both and the version half defaults to the tag under test.
  mkfd() { # dir recipe-ndk recipe-rust recipe-flags release-ndk release-flags [name] [code]
    local d; d="$(mktc "$1" 1.97.1 1.97.1)"; mkdir -p "$d/docs/fdroid"
    local name="${7:-0.2.0}" code="${8:-2000}"
    printf 'Builds:\n  - versionName: %s\n    versionCode: %s\n    commit: v%s\n' \
      "$name" "$code" "$name" > "$d/docs/fdroid/com.riwaq.reader.yml"
    printf '    build:\n      - x --default-toolchain %s\n      - %s\n    ndk: %s\n' \
      "$3" "$4" "$2" >> "$d/docs/fdroid/com.riwaq.reader.yml"
    printf 'CurrentVersion: %s\nCurrentVersionCode: %s\n' "$name" "$code" \
      >> "$d/docs/fdroid/com.riwaq.reader.yml"
    printf 'run: sdkmanager "ndk;%s"\nrun: %s\n' "$5" "$6" \
      > "$d/.github/workflows/release.yml"
    mkdir -p "$d/fastlane/metadata/android/en-US/changelogs" \
             "$d/fastlane/metadata/android/ar/changelogs"
    echo "notes" > "$d/fastlane/metadata/android/en-US/changelogs/2000.txt"
    echo "ملاحظات" > "$d/fastlane/metadata/android/ar/changelogs/2000.txt"
    echo "$d"
  }
  ok='RUSTFLAGS="$(bash scripts/android-rustflags.sh)" pnpm tauri android build'
  expect 0 "a recipe in step with release.yml"    "$(mkfd fdok 26.1.1 1.97.1 "$ok" 26.1.1 "$ok")"      v0.2.0
  expect 1 "a recipe on a different NDK"          "$(mkfd fdndk 27.0.1 1.97.1 "$ok" 26.1.1 "$ok")"     v0.2.0
  expect 1 "a recipe on a different Rust"         "$(mkfd fdrust 26.1.1 1.96.0 "$ok" 26.1.1 "$ok")"    v0.2.0
  expect 1 "a recipe without the RUSTFLAGS script" "$(mkfd fdflag 26.1.1 1.97.1 "pnpm tauri" 26.1.1 "$ok")" v0.2.0
  expect 1 "release.yml without the RUSTFLAGS script" "$(mkfd fdrel 26.1.1 1.97.1 "$ok" 26.1.1 "pnpm tauri")" v0.2.0
  d3="$(mkfd fdvar 29.0.1 1.97.1 "$ok" 0 "$ok")"
  printf '        run: |\n          ndk=29.0.1\n          sdkmanager "ndk;$ndk"\nrun: %s\n' "$ok" > "$d3/.github/workflows/release.yml"
  expect 0 "an NDK set through ndk= in release.yml"   "$d3"                                               v0.2.0
  printf '        run: |\n          ndk=29.0.2\n          sdkmanager "ndk;$ndk"\nrun: %s\n' "$ok" > "$d3/.github/workflows/release.yml"
  expect 1 "ndk= in release.yml that disagrees"       "$d3"                                               v0.2.0

  # the recipe's own version — the 0.5.4 case
  expect 1 "a recipe left on an older release"   "$(mkfd fdold 26.1.1 1.97.1 "$ok" 26.1.1 "$ok" 0.1.0 1000)" v0.2.0
  expect 1 "a recipe whose versionCode is wrong" "$(mkfd fdcode 26.1.1 1.97.1 "$ok" 26.1.1 "$ok" 0.2.0 2)"   v0.2.0
  d4="$(mkfd fdcommit 26.1.1 1.97.1 "$ok" 26.1.1 "$ok")"
  sed -i.bak 's/^    commit: .*/    commit: main/' "$d4/docs/fdroid/com.riwaq.reader.yml"
  expect 1 "a recipe building a branch, not the tag" "$d4"                                                   v0.2.0
  d5="$(mkfd fdcur 26.1.1 1.97.1 "$ok" 26.1.1 "$ok")"
  sed -i.bak 's/^CurrentVersion: .*/CurrentVersion: 0.1.0/' "$d5/docs/fdroid/com.riwaq.reader.yml"
  expect 1 "a stale CurrentVersion"                  "$d5"                                                   v0.2.0

  # the F-Droid changelog, which is named after the versionCode
  d6="$(mkfd fdnotes 26.1.1 1.97.1 "$ok" 26.1.1 "$ok")"
  rm "$d6/fastlane/metadata/android/ar/changelogs/2000.txt"
  expect 1 "a missing Arabic changelog"              "$d6"                                                   v0.2.0
  d7="$(mkfd fdlong 26.1.1 1.97.1 "$ok" 26.1.1 "$ok")"
  head -c 501 /dev/zero | tr '\0' 'x' > "$d7/fastlane/metadata/android/en-US/changelogs/2000.txt"
  expect 1 "a changelog past F-Droid's 500 chars"    "$d7"                                                   v0.2.0
  [ "$fails" -eq 0 ] || die "$fails self-test failure(s) — the guard itself is broken"
  echo "verify-release-config: self-test passed"
  exit 0
fi

TAG="${1:-}"
command -v jq >/dev/null || die "jq is required"
if ! out="$(check_config "$ROOT" "$TAG" 2>&1)"; then
  echo "$out" | sed 's/^/  /' >&2
  die "release config is not ready to tag"
fi
echo "verify-release-config: config is ready${TAG:+ for $TAG}"
