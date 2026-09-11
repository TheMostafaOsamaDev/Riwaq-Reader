#!/usr/bin/env bash
#
# Publish version-less copies of each installer, so a README button can link
# straight at a download instead of at a page full of files.
#
# Why this exists. GitHub's permanent asset URL is
#   /releases/latest/download/<EXACT FILENAME>
# and every filename Tauri produces carries the version — Riwaq_0.2.1_x64-setup.exe.
# So the "permanent" link is only permanent until the next release, which is the
# worst kind of broken: it works when you test it and 404s for users later.
#
# Uploading a second copy under a stable name fixes that for good. It costs
# duplicate storage on the release; it buys a download button that cannot rot.
#
# Usage: release-aliases.sh <tag>          (in CI, with GITHUB_TOKEN set)
#        release-aliases.sh --self-test

set -uo pipefail

die() { echo "release-aliases: $*" >&2; exit 1; }

# pattern -> stable alias. The pattern is matched against the asset filename;
# exactly one asset must match each, or we would silently alias the wrong file.
map_alias() {
  case "$1" in
    *_x64-setup.exe)        echo "Riwaq-windows-x64-setup.exe" ;;
    *_arm64-setup.exe)      echo "Riwaq-windows-arm64-setup.exe" ;;
    *_universal.dmg)        echo "Riwaq-macos-universal.dmg" ;;
    *_amd64.AppImage)       echo "Riwaq-linux-x86_64.AppImage" ;;
    *_aarch64.AppImage)     echo "Riwaq-linux-aarch64.AppImage" ;;
    *_amd64.deb)            echo "Riwaq-linux-amd64.deb" ;;
    *_arm64.deb)            echo "Riwaq-linux-arm64.deb" ;;
    *.x86_64.rpm)           echo "Riwaq-linux-x86_64.rpm" ;;
    *.aarch64.rpm)          echo "Riwaq-linux-aarch64.rpm" ;;
    app-universal-release.apk) echo "Riwaq-android.apk" ;;
    *)                      echo "" ;;
  esac
}

if [ "${1:-}" = "--self-test" ]; then
  fails=0
  check() {
    local got; got="$(map_alias "$1")"
    if [ "$got" = "$2" ]; then echo "  ok   $1 -> ${2:-<none>}"
    else echo "  FAIL $1 -> '$got', wanted '${2:-<none>}'"; fails=$((fails+1)); fi
  }
  check "Riwaq_0.2.1_x64-setup.exe"      "Riwaq-windows-x64-setup.exe"
  check "Riwaq_0.2.1_arm64-setup.exe"    "Riwaq-windows-arm64-setup.exe"
  check "Riwaq_0.2.1_universal.dmg"      "Riwaq-macos-universal.dmg"
  check "Riwaq_0.2.1_amd64.AppImage"     "Riwaq-linux-x86_64.AppImage"
  check "Riwaq_0.2.1_aarch64.AppImage"   "Riwaq-linux-aarch64.AppImage"
  check "Riwaq_0.2.1_amd64.deb"          "Riwaq-linux-amd64.deb"
  check "Riwaq_0.2.1_arm64.deb"          "Riwaq-linux-arm64.deb"
  check "Riwaq-0.2.1-1.x86_64.rpm"       "Riwaq-linux-x86_64.rpm"
  check "Riwaq-0.2.1-1.aarch64.rpm"      "Riwaq-linux-aarch64.rpm"
  check "app-universal-release.apk"      "Riwaq-android.apk"
  # Things that must NOT be aliased: signatures, the manifest, the updater
  # bundle, the checksums file, and an alias itself (so a re-run is a no-op).
  check "Riwaq_0.2.1_x64-setup.exe.sig"  ""
  check "latest.json"                    ""
  check "SHA256SUMS"                     ""
  check "Riwaq_universal.app.tar.gz"     ""
  check "Riwaq-windows-x64-setup.exe"    ""
  # The .deb patterns must not swallow the .AppImage ones or vice versa.
  check "Riwaq_0.2.1_amd64.AppImage.sig" ""
  [ "$fails" -eq 0 ] || die "$fails self-test failure(s)"
  echo "release-aliases: self-test passed"
  exit 0
fi

TAG="${1:?usage: release-aliases.sh <tag>}"
REPO="${GITHUB_REPOSITORY:-TheMostafaOsamaDev/Riwaq-Reader}"
command -v gh >/dev/null || die "gh is required"

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cd "$work" || die "cannot enter $work"

assets="$(gh release view "$TAG" --repo "$REPO" --json assets -q '.assets[].name')"
[ -n "$assets" ] || die "no assets on $TAG"

made=0
while IFS= read -r name; do
  alias_name="$(map_alias "$name")"
  [ -n "$alias_name" ] || continue
  gh release download "$TAG" --repo "$REPO" --pattern "$name" --output "$name" --clobber \
    || die "could not download $name"
  cp "$name" "$alias_name"
  gh release upload "$TAG" --repo "$REPO" --clobber "$alias_name" \
    || die "could not upload $alias_name"
  echo "  $name  ->  $alias_name"
  rm -f "$name" "$alias_name"
  made=$((made + 1))
done <<< "$assets"

# Ten installers are expected. Fewer means a build target changed name and its
# README button is now pointing at a file that will never exist again.
[ "$made" -ge 10 ] || die "only $made aliases made, expected 10 — a filename pattern has drifted"
echo "release-aliases: $made stable download links published for $TAG"
