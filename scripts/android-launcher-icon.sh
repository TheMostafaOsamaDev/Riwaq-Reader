#!/usr/bin/env bash
#
# Rebuild the Android adaptive launcher icon from the light app-icon source.
#
# `tauri icon` stretches the source across the whole 108dp adaptive-icon canvas.
# Android only ever shows the central 72dp of that canvas and only guarantees the
# middle 66dp circle, so every launcher mask clips the phoenix's wingtips. The
# foreground therefore has to carry its own padding: this script draws the
# phoenix at the same size it has inside the legacy (pre-API-26) tile, centred on
# a transparent 108dp canvas, and leaves the cream to the background layer.
#
# Legacy mipmap-*/ic_launcher.png and ic_launcher_round.png already carry that
# padding, so they are left alone.
#
# Requires ImageMagick 7 (`brew install imagemagick`).

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/src-tauri/icons/source/app-icon-light.png"
res="$root/src-tauri/gen/android/app/src/main/res"

# Background of the source artwork, and therefore of the adaptive background
# layer — keep it in step with values/ic_launcher_background.xml.
cream="#EFE2BA"

# Artwork width as a share of the 108dp canvas. 0.836 is the phoenix's share of
# the legacy 48dp tile, rescaled to the 72dp the launcher actually shows
# (0.836 × 72 / 108), which keeps the wingtips inside the 66dp safe circle.
art_fraction=0.557

command -v magick >/dev/null 2>&1 || {
  echo "error: ImageMagick 7 (magick) not found" >&2
  exit 1
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Drop the cream so the background layer shows through; the phoenix's own cream
# slivers become transparent too, which is why the two must be the same colour.
magick "$src" -fuzz 12% -transparent "$cream" "$work/phoenix.png"

for density in mdpi:108 hdpi:162 xhdpi:216 xxhdpi:324 xxxhdpi:432; do
  name="${density%%:*}"
  canvas="${density##*:}"
  art="$(awk -v c="$canvas" -v f="$art_fraction" 'BEGIN { printf "%d", c * f + 0.5 }')"

  # -strip and the excluded chunks keep the output byte-identical between runs,
  # so re-running this doesn't churn the diff.
  magick -size "${canvas}x${canvas}" xc:none \
    \( "$work/phoenix.png" -resize "${art}x${art}" \) \
    -gravity center -composite \
    -strip -define png:exclude-chunk=date,time \
    "PNG32:$res/mipmap-$name/ic_launcher_foreground.png"

  echo "mipmap-$name/ic_launcher_foreground.png — ${canvas}px canvas, ${art}px artwork"
done
