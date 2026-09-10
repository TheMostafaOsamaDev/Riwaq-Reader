#!/usr/bin/env bash
#
# Re-encode the in-app brand art in public/brand as right-sized WebP.
#
# Why this exists. The four PNGs were 1,076 KB — a tenth of the whole dist
# payload — to paint a 34px mark in the sidebar and a 56px one in Settings.
# Two separate problems hid behind that one number:
#
#   mark-{ink,cream}.png  1018x1101, drawn at 34px. Thirty times oversized, so
#                         resampling is most of the win and the format is the
#                         rest.
#   icon-{light,dark}.png 256x256, drawn at 56px (BrandMark declares up to 88,
#                         which 256 still covers at 3x). Already the right
#                         size, so the format is the ENTIRE win here: 84 KB of
#                         PNG becomes 12 KB of WebP for identical pixels.
#
# Together: 1,076 KB -> ~48 KB. The art is flat two-tone with gold accents and
# no gradients, which is the case lossy WebP handles without visible ringing —
# verified at 1:1, not assumed.
#
# WebP and not SVG, which is the obvious question for flat vector-looking art:
# there is no vector source in the repo, the feather work is intricate enough
# that tracing 1018px raster would plausibly cost more in path data than 48 KB,
# and both marks render at one fixed small size and never scale, so vector's
# scale-freedom buys nothing. If a real vector master ever appears, swapping is
# a one-line change in BrandMark.tsx and LibrarySidebar.tsx.
#
# The full-resolution transparent masters move to src-tauri/icons/source/,
# alongside app-icon-{light,dark}.png. Nothing bundles that directory —
# tauri.conf.json lists its five icon files explicitly — so the art is kept
# without being shipped.
#
# WebP needs WKWebView on macOS 11, which is why tauri.conf.json now pins
# bundle.macOS.minimumSystemVersion to "11.0". Android is unaffected: minSdk is
# 24 and WebP-with-alpha has been supported since 4.2.
#
# Idempotent — a file already converted is skipped, so this is safe to re-run
# after dropping a new PNG in.
#
# Requires the WebP tools (`brew install webp`).

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
brand="$root/public/brand"
masters="$root/src-tauri/icons/source"

# Encoder settings. -q 88 is where flat art stops changing visibly; alpha stays
# lossless so the transparent marks keep clean edges against any theme.
quality=88
alpha_quality=100

# file:longest-edge. The marks are resampled on the way in; the icons are
# already at their target size and 256 is a no-op resize for them.
targets=(
  "mark-ink:136"
  "mark-cream:136"
  "icon-light:256"
  "icon-dark:256"
)

# Only these two are full-resolution art worth keeping out of the payload; the
# icons are themselves derived from app-icon-{light,dark}.png, already in
# masters/.
keep_master=("mark-ink" "mark-cream")

command -v cwebp >/dev/null 2>&1 || {
  echo "error: cwebp not found — install the WebP tools (brew install webp)" >&2
  exit 1
}

kb() { echo "$(( ($(wc -c <"$1") + 1023) / 1024 ))K"; }

before=0
after=0

for target in "${targets[@]}"; do
  name="${target%%:*}"
  edge="${target##*:}"
  png="$brand/$name.png"
  webp="$brand/$name.webp"

  if [[ ! -f "$png" ]]; then
    if [[ -f "$webp" ]]; then
      printf '  %-12s already WebP (%s), skipping\n' "$name" "$(kb "$webp")"
      after=$((after + $(wc -c <"$webp")))
      continue
    fi
    echo "error: neither $name.png nor $name.webp exists in public/brand" >&2
    exit 1
  fi

  png_bytes=$(wc -c <"$png")
  cwebp -quiet -resize "$edge" 0 -q "$quality" -alpha_q "$alpha_quality" \
    "$png" -o "$webp"
  webp_bytes=$(wc -c <"$webp")

  before=$((before + png_bytes))
  after=$((after + webp_bytes))

  printf '  %-12s %5s -> %5s  (%sx longest edge)\n' \
    "$name" "$(kb "$png")" "$(kb "$webp")" "$edge"

  # Only now that the WebP is written: keep the master if it is one, then drop
  # the PNG so nothing ships it twice.
  for keeper in "${keep_master[@]}"; do
    if [[ "$name" == "$keeper" ]]; then
      mkdir -p "$masters"
      mv "$png" "$masters/$name-full.png"
      printf '  %-12s master kept at icons/source/%s-full.png\n' "" "$name"
      continue 2
    fi
  done
  rm "$png"
done

echo
if (( before == 0 )); then
  printf 'public/brand: %s, nothing to convert\n' "$(( (after + 1023) / 1024 ))K"
else
  printf 'public/brand: %s -> %s\n' \
    "$(( (before + 1023) / 1024 ))K" "$(( (after + 1023) / 1024 ))K"
fi
