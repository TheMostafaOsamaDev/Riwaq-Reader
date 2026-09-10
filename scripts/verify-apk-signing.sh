#!/usr/bin/env bash
#
# Refuse to ship an Android APK that isn't signed with the real release key.
#
# Why this exists. gen/android/app/build.gradle.kts falls back to the DEBUG
# signing config when key.properties is absent:
#
#     signingConfig = if (keystorePropertiesFile.exists()) {
#         signingConfigs.getByName("release")
#     } else {
#         signingConfigs.getByName("debug")
#     }
#
# That fallback is silent. The build succeeds, the APK installs, and nothing
# says a word — which is exactly how every release built before this script
# went out debug-signed. The cost is not cosmetic: Android refuses to install
# an update whose signing certificate differs from the installed one, so every
# user who sideloaded a debug-signed build has to UNINSTALL to move to a
# properly signed one, losing their whole library on the way.
#
# A missing or misspelled CI secret reproduces the fallback exactly. So the
# guard cannot be "we set the secret" — it has to be a check on the artifact.
#
# Usage:
#   verify-apk-signing.sh [APK]        verify (default: newest release APK)
#   verify-apk-signing.sh --print [APK] print the signer's SHA-256, exit 0
#   verify-apk-signing.sh --self-test   check the classifier itself
#
# Pinning: export ANDROID_SIGNING_CERT_SHA256 (or set it as a repo variable in
# CI) and the signer's digest must match it EXACTLY. Without it the script
# still rejects debug and unsigned APKs, but cannot tell one real key from
# another — so pin it after the first release.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK_DIR="$ROOT/src-tauri/gen/android/app/build/outputs/apk"

# The identity every Android SDK ships and auto-generates. Matching on the CN
# alone is deliberate: the rest of the DN (OU, L, ST) varies between SDK
# versions and platforms, and CN=Android Debug is the invariant.
DEBUG_CN="CN=Android Debug"

die() { echo "verify-apk-signing: $*" >&2; exit 1; }

# ── the classifier ────────────────────────────────────────────────────────
# Reads `apksigner verify --print-certs` output on stdin, prints the signer's
# SHA-256 digest (lowercase, no separators). Empty output means no signer
# certificate was found, which callers treat as unsigned.
signer_digest() {
  # apksigner labels the signer differently depending on which signature
  # schemes the APK carries:
  #
  #   Signer #1 certificate SHA-256 digest: …   (v1 / JAR signature present)
  #   V2 Signer: certificate SHA-256 digest: …  (v2-only, what Gradle emits
  #   V3 Signer: certificate SHA-256 digest: …   for minSdk 24+, which needs
  #                                               no v1 signature)
  #
  # Matching only the first form made this reject a correctly signed release
  # APK — it failed CLOSED, which is the right direction, but it still blocked
  # a good build. Anchor on the part both forms share instead.
  sed -n 's/^.*certificate SHA-256 digest: *//p' \
    | head -n1 | tr 'A-Z' 'a-z' | tr -d ' :'
}

# Prints the signer's DN, or nothing.
signer_dn() {
  # Same two label forms as signer_digest above.
  sed -n 's/^.*certificate DN: *//p' | head -n1
}

# Is this DN the Android debug identity? Both the self-test and the real check
# call THIS — an earlier version inlined the match in each place, so the
# self-test was exercising a copy and could pass while the real one broke.
is_debug_dn() {
  case "$1" in (*"$DEBUG_CN"*) return 0 ;; (*) return 1 ;; esac
}

# ── self-test ─────────────────────────────────────────────────────────────
# The classifier is the whole guard. If its parsing silently stopped matching
# — an apksigner output change, a stray edit — every check below would pass
# vacuously and debug-signed APKs would ship again with a green tick. So the
# parser is exercised against recorded output before it is trusted.
if [ "${1:-}" = "--self-test" ]; then
  debug_out='Signer #1 certificate DN: CN=Android Debug, O=Android, C=US
Signer #1 certificate SHA-256 digest: A1B2C3D4E5F600000000000000000000000000000000000000000000000000AA
Signer #1 certificate SHA-1 digest: 0000000000000000000000000000000000000000'
  release_out='Signer #1 certificate DN: CN=Riwaq, O=Riwaq, C=EG
Signer #1 certificate SHA-256 digest: ffee0011223344556677889900aabbccddeeff00112233445566778899aabbcc
Signer #1 certificate SHA-1 digest: 1111111111111111111111111111111111111111'
  fails=0
  check() { # name expected actual
    if [ "$2" = "$3" ]; then echo "  ok   $1"; else
      echo "  FAIL $1: expected '$2', got '$3'"; fails=$((fails+1)); fi
  }
  check "debug DN is recognised" \
        "CN=Android Debug, O=Android, C=US" "$(printf '%s\n' "$debug_out" | signer_dn)"
  yn() { if is_debug_dn "$1"; then echo yes; else echo no; fi; }
  check "debug DN is classified as debug" \
        "yes" "$(yn "$(printf '%s\n' "$debug_out" | signer_dn)")"
  check "release DN is NOT classified as debug" \
        "no" "$(yn "$(printf '%s\n' "$release_out" | signer_dn)")"
  check "a DN that merely mentions debug is not the debug cert" \
        "no" "$(yn "CN=Riwaq Debug Builds, O=Riwaq, C=EG")"
  check "digest is lowercased and stripped" \
        "a1b2c3d4e5f600000000000000000000000000000000000000000000000000aa" \
        "$(printf '%s\n' "$debug_out" | signer_digest)"
  check "release digest parses" \
        "ffee0011223344556677889900aabbccddeeff00112233445566778899aabbcc" \
        "$(printf '%s\n' "$release_out" | signer_digest)"
  check "unsigned output yields no digest" "" "$(printf 'DOES NOT VERIFY\n' | signer_digest)"
  # The real output from a Gradle-built release APK (minSdk 24, v2-only).
  # This exact shape is what slipped past the original parser.
  v2_out='V2 Signer: certificate DN: CN=Riwaq, O=Riwaq, C=EG
V2 Signer: certificate SHA-256 digest: 83cb81f108b4f2448b20a5f5f714ea22d4a0f6712035a6df9c4bf7f2d10291e2
V2 Signer: certificate SHA-1 digest: c79ab541f88dd6cd5e71547fe4752ed888d84120'
  v2_debug='V2 Signer: certificate DN: CN=Android Debug, O=Android, C=US
V2 Signer: certificate SHA-256 digest: AAAA1111BBBB2222CCCC3333DDDD4444EEEE5555FFFF6666AAAA7777BBBB8888'
  check "V2-only DN is read" \
        "CN=Riwaq, O=Riwaq, C=EG" "$(printf '%s\n' "$v2_out" | signer_dn)"
  check "V2-only digest is read" \
        "83cb81f108b4f2448b20a5f5f714ea22d4a0f6712035a6df9c4bf7f2d10291e2" \
        "$(printf '%s\n' "$v2_out" | signer_digest)"
  check "V2-only debug cert is still classified as debug" \
        "yes" "$(yn "$(printf '%s\n' "$v2_debug" | signer_dn)")"
  check "V3 label is read too" \
        "CN=Riwaq, O=Riwaq, C=EG" \
        "$(printf 'V3 Signer: certificate DN: CN=Riwaq, O=Riwaq, C=EG\n' | signer_dn)"
  check "only the FIRST signer is read" \
        "ffee0011223344556677889900aabbccddeeff00112233445566778899aabbcc" \
        "$(printf '%s\nSigner #2 certificate SHA-256 digest: DEADBEEF\n' "$release_out" | signer_digest)"
  [ "$fails" -eq 0 ] || die "$fails self-test failure(s) — the guard itself is broken"
  echo "verify-apk-signing: self-test passed"
  exit 0
fi

PRINT_ONLY=0
if [ "${1:-}" = "--print" ]; then PRINT_ONLY=1; shift; fi

# ── locate apksigner ──────────────────────────────────────────────────────
# Mirrors how verify-jni-bridge.sh finds apkanalyzer. apksigner lives in
# build-tools, so take the highest-numbered one available.
APKSIGNER="$(command -v apksigner || true)"
if [ -z "$APKSIGNER" ]; then
  for sdk in "${ANDROID_SDK_ROOT:-}" "${ANDROID_HOME:-}" "$HOME/Library/Android/sdk"; do
    [ -n "$sdk" ] && [ -d "$sdk/build-tools" ] || continue
    cand="$(ls -1 "$sdk/build-tools" 2>/dev/null | sort -V | tail -n1)"
    [ -n "$cand" ] && [ -x "$sdk/build-tools/$cand/apksigner" ] || continue
    APKSIGNER="$sdk/build-tools/$cand/apksigner"; break
  done
fi
[ -n "$APKSIGNER" ] || die "apksigner not found (ships with the Android build-tools)."

# ── locate the APK ────────────────────────────────────────────────────────
APK="${1:-}"
if [ -z "$APK" ]; then
  APK="$(find "$APK_DIR" -name '*.apk' -type f 2>/dev/null \
         | grep -v -- '-debug' | sort | tail -n1)"
fi
[ -n "$APK" ] && [ -f "$APK" ] || die "no APK given and none found under $APK_DIR"

# ── verify ────────────────────────────────────────────────────────────────
out="$("$APKSIGNER" verify --print-certs "$APK" 2>&1)" || {
  echo "$out" >&2
  die "apksigner could not verify $(basename "$APK") — it is unsigned or corrupt."
}

dn="$(printf '%s\n' "$out" | signer_dn)"
digest="$(printf '%s\n' "$out" | signer_digest)"
[ -n "$digest" ] || { echo "$out" >&2; die "no signer certificate in $(basename "$APK")"; }

if [ "$PRINT_ONLY" -eq 1 ]; then
  echo "APK:    $(basename "$APK")"
  echo "DN:     $dn"
  echo "SHA256: $digest"
  exit 0
fi

if is_debug_dn "$dn"; then
  cat >&2 <<EOF
verify-apk-signing: REFUSING a debug-signed release APK.

  APK: $(basename "$APK")
  DN:  $dn

key.properties was missing or unreadable, so Gradle fell back to the debug
keystore. Shipping this would strand every user who installs it: moving them
to a properly signed build later requires an UNINSTALL, which deletes their
library.

Set the four signing secrets (docs/ANDROID.md) and rebuild.
EOF
  exit 1
fi

expected="${ANDROID_SIGNING_CERT_SHA256:-}"
expected="$(printf '%s' "$expected" | tr 'A-Z' 'a-z' | tr -d ' :')"
if [ -n "$expected" ] && [ "$expected" != "$digest" ]; then
  cat >&2 <<EOF
verify-apk-signing: WRONG SIGNING KEY.

  APK:      $(basename "$APK")
  DN:       $dn
  expected: $expected
  actual:   $digest

This APK is signed, but not by the key this project ships with. Installing it
over an existing Riwaq would be rejected by Android. If you rotated the key on
purpose, update the ANDROID_SIGNING_CERT_SHA256 repo variable.
EOF
  exit 1
fi

echo "verify-apk-signing: $(basename "$APK") is release-signed"
echo "  DN:     $dn"
echo "  SHA256: $digest"
[ -n "$expected" ] && echo "  (matches the pinned ANDROID_SIGNING_CERT_SHA256)" \
                   || echo "  NOTE: ANDROID_SIGNING_CERT_SHA256 is not pinned — set it to catch a key swap."
exit 0
