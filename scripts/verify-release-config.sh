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
