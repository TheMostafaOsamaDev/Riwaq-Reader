#!/usr/bin/env bash
#
# Refuse to publish an update manifest that would strand a platform.
#
# Why this exists. A latest.json that silently omits linux-aarch64 produces no
# error anywhere: the release looks fine, the file is valid JSON, and those
# users simply never see an update again. Nobody finds out until someone asks
# why their copy is six versions old. The same is true of an empty signature
# string — the client rejects it at install time, long after the release went
# out, and the failure surfaces to the user rather than to us.
#
# A version that disagrees with the tag is the third case: it means the
# manifest was built from stale artifacts, and every client would either skip
# the update or be offered one that does not exist at that URL.
#
# Usage:
#   verify-update-manifest.sh latest.json v0.3.0
#   verify-update-manifest.sh --self-test

set -uo pipefail

# Every platform key the release pipeline publishes. Windows is NSIS-only by
# design (see the spec): one manifest URL per platform means an MSI user
# updated via NSIS would end up with two installs.
REQUIRED=(darwin-x86_64 darwin-aarch64 windows-x86_64 windows-aarch64 linux-x86_64 linux-aarch64)

die() { echo "verify-update-manifest: $*" >&2; exit 1; }

# ── the check ─────────────────────────────────────────────────────────────
# Takes a manifest path and the expected version. Echoes problems and returns
# nonzero. Kept as a function so --self-test drives the REAL logic rather than
# a copy of it.
check_manifest() {
  local manifest="$1" expected="${2#v}" problems=0 version key url sig

  [ -f "$manifest" ] || { echo "no manifest at $manifest"; return 1; }

  version="$(jq -r '.version // empty' "$manifest" 2>/dev/null)"
  if [ -z "$version" ]; then
    echo "manifest has no version"; return 1
  fi
  if [ "$version" != "$expected" ]; then
    echo "version '$version' does not match the tag '$expected'"
    problems=$((problems + 1))
  fi

  for key in "${REQUIRED[@]}"; do
    url="$(jq -r --arg k "$key" '.platforms[$k].url // empty' "$manifest" 2>/dev/null)"
    sig="$(jq -r --arg k "$key" '.platforms[$k].signature // empty' "$manifest" 2>/dev/null)"
    if [ -z "$url" ]; then
      echo "missing url for $key — those users would never see an update"
      problems=$((problems + 1))
    fi
    if [ -z "$sig" ]; then
      echo "empty signature for $key — the client will reject the install"
      problems=$((problems + 1))
    fi
  done

  [ "$problems" -eq 0 ]
}

# ── self-test ─────────────────────────────────────────────────────────────
# The guard is a jq-driven parser. If its parsing silently stopped matching,
# every check would pass vacuously and a holed manifest would ship with a
# green tick — the exact failure it exists to prevent, plus false confidence.
if [ "${1:-}" = "--self-test" ]; then
  command -v jq >/dev/null || die "jq is required"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  fails=0
  expect() { # want_rc label file version
    local want="$1" label="$2" file="$3" ver="$4" out rc
    out="$(check_manifest "$file" "$ver" 2>&1)"; rc=$?
    if [ "$rc" -eq "$want" ]; then echo "  ok   $label"
    else echo "  FAIL $label (rc=$rc, wanted $want): $out"; fails=$((fails + 1)); fi
  }

  full='{"version":"0.3.0","platforms":{'
  for k in "${REQUIRED[@]}"; do full="$full\"$k\":{\"url\":\"u\",\"signature\":\"s\"},"; done
  full="${full%,}}}"
  printf '%s' "$full" > "$tmp/good.json"
  expect 0 "a complete manifest passes" "$tmp/good.json" "v0.3.0"
  expect 0 "the tag's leading v is optional" "$tmp/good.json" "0.3.0"

  jq 'del(.platforms["linux-aarch64"])' "$tmp/good.json" > "$tmp/hole.json"
  expect 1 "a missing platform is caught" "$tmp/hole.json" "v0.3.0"

  jq '.platforms["darwin-aarch64"].signature = ""' "$tmp/good.json" > "$tmp/nosig.json"
  expect 1 "an empty signature is caught" "$tmp/nosig.json" "v0.3.0"

  expect 1 "a version that disagrees with the tag is caught" "$tmp/good.json" "v0.4.0"

  printf '%s' '{"platforms":{}}' > "$tmp/nover.json"
  expect 1 "a manifest with no version is caught" "$tmp/nover.json" "v0.3.0"

  expect 1 "a missing file is caught" "$tmp/nope.json" "v0.3.0"

  [ "$fails" -eq 0 ] || die "$fails self-test failure(s) — the guard itself is broken"
  echo "verify-update-manifest: self-test passed"
  exit 0
fi

MANIFEST="${1:?usage: verify-update-manifest.sh latest.json <version>}"
EXPECTED="${2:?usage: verify-update-manifest.sh latest.json <version>}"
command -v jq >/dev/null || die "jq is required"

if ! out="$(check_manifest "$MANIFEST" "$EXPECTED" 2>&1)"; then
  echo "$out" >&2
  die "refusing to publish this manifest"
fi
echo "verify-update-manifest: ${EXPECTED#v} covers all ${#REQUIRED[@]} platforms"
