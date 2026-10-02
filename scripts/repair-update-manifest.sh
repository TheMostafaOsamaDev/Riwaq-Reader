#!/usr/bin/env bash
#
# Put back the platforms that never made it into latest.json.
#
# Why this exists. Five build jobs upload to the same draft release and each
# one rewrites latest.json: it reads whatever is there, adds its own platform
# and uploads the result. That is a read-modify-write with no lock, across
# machines, so two jobs finishing close together can both read the same file
# and the second one's upload silently drops the first one's platform.
#
# It is not theoretical and it is not reliable in either direction: v0.4.1,
# v0.5.0 and v0.5.1 all merged correctly, and v0.6.0 lost BOTH Linux jobs —
# the AppImages and their .sig files uploaded fine, and latest.json simply had
# no linux-x86_64 or linux-aarch64 in it. Every Linux install would have gone
# on believing it was up to date.
#
# verify-update-manifest.sh already refuses to publish that. Refusing is the
# right floor, but it turns a dice roll into a failed release every time it
# comes up, and the fix is always the same mechanical thing: the signature is
# sitting on the release as <artifact>.sig, and the URL is just where that
# artifact already is. So rebuild the missing entries from the release's own
# assets rather than rebuilding the world.
#
# This only ever ADDS entries. A platform already in the manifest is left
# exactly as tauri-action wrote it, so a correct manifest comes out unchanged.
#
# Usage:
#   repair-update-manifest.sh latest.json <sig-dir> <url-base>
#   repair-update-manifest.sh --self-test
#
#   <sig-dir>   a directory holding the release's *.sig files
#   <url-base>  https://github.com/<owner>/<repo>/releases/download/<tag>
#
# Writes the manifest back in place and prints what it restored. Exits 0 when
# there was nothing to do.

set -uo pipefail

# Which artifact carries the update for each platform key the updater asks
# for. The signature in latest.json IS the contents of that artifact's .sig
# file, so the glob finds both at once.
#
# Windows is NSIS-only by design, and both macOS architectures are served by
# the one universal .app tarball — the same mapping tauri-action uses, written
# down here because this script has to agree with it.
PLATFORM_KEYS=(darwin-x86_64 darwin-aarch64 windows-x86_64 windows-aarch64 linux-x86_64 linux-aarch64)
sig_glob_for() {
  case "$1" in
    darwin-x86_64 | darwin-aarch64) echo '*.app.tar.gz.sig' ;;
    windows-x86_64)                 echo '*_x64-setup.exe.sig' ;;
    windows-aarch64)                echo '*_arm64-setup.exe.sig' ;;
    linux-x86_64)                   echo '*_amd64.AppImage.sig' ;;
    linux-aarch64)                  echo '*_aarch64.AppImage.sig' ;;
    *)                              echo '' ;;
  esac
}

die() { echo "repair-update-manifest: $*" >&2; exit 1; }

# ── the repair ────────────────────────────────────────────────────────────
# A function so --self-test drives the real logic rather than a copy.
repair_manifest() {
  local manifest="$1" sigdir="$2" urlbase="$3" restored=0
  local key glob match sig url tmp artifact signed

  [ -f "$manifest" ] || { echo "no manifest at $manifest"; return 1; }
  [ -d "$sigdir" ] || { echo "no signature directory at $sigdir"; return 1; }

  for key in "${PLATFORM_KEYS[@]}"; do
    # Present and complete? Leave it alone — tauri-action's own entry wins.
    if [ -n "$(jq -r --arg k "$key" '.platforms[$k].url // empty' "$manifest")" ] &&
       [ -n "$(jq -r --arg k "$key" '.platforms[$k].signature // empty' "$manifest")" ]; then
      continue
    fi

    glob="$(sig_glob_for "$key")"
    # shellcheck disable=SC2086 # the glob must be split to expand
    match="$(ls -1 $sigdir/$glob 2>/dev/null | head -n1)"
    if [ -z "$match" ]; then
      echo "$key is missing and no $glob was published — cannot repair it"
      return 1
    fi

    sig="$(cat "$match")"
    if [ -z "$sig" ]; then
      echo "$key: $(basename "$match") is empty, so there is no signature to restore"
      return 1
    fi

    # The artifact sits beside its signature, under the same name.
    artifact="$(basename "${match%.sig}")"
    url="$urlbase/$artifact"

    # Does this signature actually belong to that artifact? Tauri writes the
    # file it signed, and the version, into the signature's trusted comment —
    # the one part an attacker cannot change without invalidating it, and the
    # one part that catches the way this script could do real harm: a wrong
    # glob would hand every Linux user a signature for something else, and the
    # update would fail on their machine rather than here.
    #
    # macOS is the one legitimate mismatch: tauri signs `Riwaq.app.tar.gz` and
    # uploads it as `Riwaq_universal.app.tar.gz`, so the infix is allowed.
    signed="$(printf '%s' "$sig" | base64 -d 2>/dev/null \
      | sed -n 's/.*file:\([^	]*\).*/\1/p' | head -n1)"
    if [ -n "$signed" ] && [ "$signed" != "$artifact" ] &&
       [ "$signed" != "${artifact/_universal/}" ]; then
      echo "$key: $(basename "$match") is a signature for '$signed', not '$artifact'"
      return 1
    fi

    tmp="$(mktemp)"
    jq --arg k "$key" --arg u "$url" --arg s "$sig" \
      '.platforms[$k] = {url: $u, signature: $s}' "$manifest" > "$tmp" || {
        rm -f "$tmp"; echo "$key: could not be written into the manifest"; return 1
      }
    mv "$tmp" "$manifest"
    echo "restored $key from $(basename "$match")"
    restored=$((restored + 1))
  done

  if [ "$restored" -eq 0 ]; then
    echo "every platform was already present — nothing to repair"
  fi
  return 0
}

# ── self-test ─────────────────────────────────────────────────────────────
# The repair reaches for files by glob and edits JSON by key. Either could
# stop matching without erroring, and then it would "repair" nothing while
# reporting success — leaving the hole it exists to fill.
if [ "${1:-}" = "--self-test" ]; then
  command -v jq >/dev/null || die "jq is required"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  fails=0
  base="https://example.invalid/releases/download/v0.6.0"

  mksigs() { # dir
    mkdir -p "$1"
    echo "SIG-APPIMAGE-AMD64"  > "$1/Riwaq_0.6.0_amd64.AppImage.sig"
    echo "SIG-APPIMAGE-ARM64"  > "$1/Riwaq_0.6.0_aarch64.AppImage.sig"
    echo "SIG-NSIS-X64"        > "$1/Riwaq_0.6.0_x64-setup.exe.sig"
    echo "SIG-NSIS-ARM64"      > "$1/Riwaq_0.6.0_arm64-setup.exe.sig"
    echo "SIG-MACOS"           > "$1/Riwaq_universal.app.tar.gz.sig"
  }
  mkmanifest() { # file key...   (only these keys present)
    local f="$1"; shift
    local j='{"version":"0.6.0","platforms":{}}'
    for k in "$@"; do
      j="$(printf '%s' "$j" | jq --arg k "$k" '.platforms[$k] = {url:"EXISTING",signature:"EXISTING"}')"
    done
    printf '%s' "$j" > "$f"
  }
  check() { # label expr
    if eval "$2"; then echo "  ok   $1"; else echo "  FAIL $1"; fails=$((fails + 1)); fi
  }

  sigs="$tmp/sigs"; mksigs "$sigs"

  # The real case: both Linux jobs lost, everything else present.
  m="$tmp/holed.json"
  mkmanifest "$m" darwin-x86_64 darwin-aarch64 windows-x86_64 windows-aarch64
  out="$(repair_manifest "$m" "$sigs" "$base" 2>&1)"; rc=$?
  check "the v0.6.0 case repairs and exits 0" "[ $rc -eq 0 ]"
  check "it says what it restored" '[ "$(printf %s "$out" | grep -c ^restored)" -eq 2 ]'
  check "linux-x86_64 gets the amd64 AppImage URL" \
    '[ "$(jq -r ".platforms[\"linux-x86_64\"].url" "$m")" = "$base/Riwaq_0.6.0_amd64.AppImage" ]'
  check "linux-x86_64 gets that file's signature" \
    '[ "$(jq -r ".platforms[\"linux-x86_64\"].signature" "$m")" = "SIG-APPIMAGE-AMD64" ]'
  check "linux-aarch64 gets the aarch64 one, not the amd64 one" \
    '[ "$(jq -r ".platforms[\"linux-aarch64\"].signature" "$m")" = "SIG-APPIMAGE-ARM64" ]'
  check "an entry that was already there is untouched" \
    '[ "$(jq -r ".platforms[\"darwin-aarch64\"].url" "$m")" = "EXISTING" ]'
  check "the version is left alone" '[ "$(jq -r .version "$m")" = "0.6.0" ]'
  check "the repaired manifest now passes the guard" \
    'bash "$(dirname "${BASH_SOURCE[0]}")/verify-update-manifest.sh" "$m" v0.6.0 >/dev/null 2>&1'

  # A manifest that needs nothing must come out byte-identical.
  m2="$tmp/full.json"
  mkmanifest "$m2" darwin-x86_64 darwin-aarch64 windows-x86_64 windows-aarch64 linux-x86_64 linux-aarch64
  cp "$m2" "$tmp/full.before"
  out2="$(repair_manifest "$m2" "$sigs" "$base" 2>&1)"
  check "a complete manifest is left byte-identical" 'cmp -s "$m2" "$tmp/full.before"'
  check "and it says so" '[ -n "$(printf %s "$out2" | grep "nothing to repair")" ]'

  # An empty signature is a hole too — the client rejects that install.
  m3="$tmp/emptysig.json"
  mkmanifest "$m3" darwin-x86_64 darwin-aarch64 windows-x86_64 windows-aarch64 linux-aarch64
  jq '.platforms["linux-x86_64"] = {url:"u",signature:""}' "$m3" > "$m3.t" && mv "$m3.t" "$m3"
  repair_manifest "$m3" "$sigs" "$base" >/dev/null 2>&1
  check "an empty signature is refilled, not kept" \
    '[ "$(jq -r ".platforms[\"linux-x86_64\"].signature" "$m3")" = "SIG-APPIMAGE-AMD64" ]'

  # If the artifact genuinely was not built, say so rather than invent one.
  bare="$tmp/bare"; mkdir -p "$bare"
  m4="$tmp/nosigs.json"
  mkmanifest "$m4" darwin-x86_64 darwin-aarch64 windows-x86_64 windows-aarch64
  out4="$(repair_manifest "$m4" "$bare" "$base" 2>&1)"; rc4=$?
  check "a missing artifact fails instead of inventing a URL" "[ $rc4 -ne 0 ]"
  check "and names the platform it could not repair" \
    '[ -n "$(printf %s "$out4" | grep linux-x86_64)" ]'

  # A signature carries the name of the file it signed. Pointing a platform at
  # the wrong artifact is the one way this script could ship something worse
  # than the hole it fills, so it has to be caught here and not on a user's
  # machine. These fixtures are shaped like real tauri signatures.
  mkrealsig() { # file signed-name
    printf 'untrusted comment: signature from tauri secret key\nRWQfake\ntrusted comment: timestamp:1790945013\tfile:%s\tversion:0.6.0\nfakesig\n' "$2" \
      | base64 | tr -d '\n' > "$1"
  }
  real="$tmp/real"; mkdir -p "$real"
  mkrealsig "$real/Riwaq_0.6.0_amd64.AppImage.sig"   Riwaq_0.6.0_amd64.AppImage
  mkrealsig "$real/Riwaq_0.6.0_aarch64.AppImage.sig" Riwaq_0.6.0_aarch64.AppImage
  mkrealsig "$real/Riwaq_0.6.0_x64-setup.exe.sig"    Riwaq_0.6.0_x64-setup.exe
  mkrealsig "$real/Riwaq_0.6.0_arm64-setup.exe.sig"  Riwaq_0.6.0_arm64-setup.exe
  # The real rename: signed as Riwaq.app.tar.gz, uploaded as _universal.
  mkrealsig "$real/Riwaq_universal.app.tar.gz.sig"   Riwaq.app.tar.gz

  m6="$tmp/realsigs.json"
  mkmanifest "$m6" windows-x86_64 windows-aarch64
  out6="$(repair_manifest "$m6" "$real" "$base" 2>&1)"; rc6=$?
  check "signatures that name their own artifact are accepted" "[ $rc6 -eq 0 ]"
  check "the macOS _universal rename is not treated as a mismatch" \
    '[ "$(jq -r ".platforms[\"darwin-aarch64\"].url" "$m6")" = "$base/Riwaq_universal.app.tar.gz" ]'

  crossed="$tmp/crossed"; mkdir -p "$crossed"
  cp "$real"/* "$crossed"/
  # The aarch64 slot now holds a signature for the amd64 build.
  mkrealsig "$crossed/Riwaq_0.6.0_aarch64.AppImage.sig" Riwaq_0.6.0_amd64.AppImage
  m7="$tmp/crossed.json"
  mkmanifest "$m7" darwin-x86_64 darwin-aarch64 windows-x86_64 windows-aarch64 linux-x86_64
  out7="$(repair_manifest "$m7" "$crossed" "$base" 2>&1)"; rc7=$?
  check "a signature for a DIFFERENT artifact is refused" "[ $rc7 -ne 0 ]"
  check "and it names both sides of the mismatch" \
    '[ -n "$(printf %s "$out7" | grep "Riwaq_0.6.0_amd64.AppImage")" ]'

  # An empty .sig file on the release is not a signature.
  blank="$tmp/blank"; mksigs "$blank"; : > "$blank/Riwaq_0.6.0_amd64.AppImage.sig"
  m5="$tmp/blanksig.json"
  mkmanifest "$m5" darwin-x86_64 darwin-aarch64 windows-x86_64 windows-aarch64
  out5="$(repair_manifest "$m5" "$blank" "$base" 2>&1)"; rc5=$?
  check "an empty .sig on the release is refused" "[ $rc5 -ne 0 ]"

  [ "$fails" -eq 0 ] || die "$fails self-test failure(s) — the repair itself is broken"
  echo "repair-update-manifest: self-test passed"
  exit 0
fi

MANIFEST="${1:?usage: repair-update-manifest.sh latest.json <sig-dir> <url-base>}"
SIGDIR="${2:?usage: repair-update-manifest.sh latest.json <sig-dir> <url-base>}"
URLBASE="${3:?usage: repair-update-manifest.sh latest.json <sig-dir> <url-base>}"
command -v jq >/dev/null || die "jq is required"

if ! out="$(repair_manifest "$MANIFEST" "$SIGDIR" "$URLBASE" 2>&1)"; then
  echo "$out" | sed 's/^/  /' >&2
  die "could not rebuild the missing platform entries"
fi
echo "$out"
