#!/usr/bin/env python3
"""Compress the bundled TrueType faces under public/fonts to WOFF2, in place.

Why this exists. Every face the reader offers is self-hosted so the app works
offline, which means all of them ship inside every desktop bundle and the APK.
As raw TrueType that was 5.7 MB — 57% of the whole payload, and the single
largest thing in it. WOFF2 is the same outlines under Brotli plus a glyf
transform: identical rendering, roughly half the bytes.

Why it verifies rather than trusting the encoder. A font that fails to decode
does not raise anything at runtime. The @font-face simply doesn't apply and the
browser falls through to the next family in the stack, so a corrupt or
truncated encode ships as "the Arabic looks a bit off" and is found by nobody.
So every output is decompressed again here and compared against its source on
the things that would actually change if the encode went wrong: glyph count,
units per em, cmap coverage, and — for the eight variable faces — the fvar
axes, since a lost weight axis would silently pin the whole family to one
weight.

Idempotent: a .ttf that already has a sibling .woff2 is skipped, so this can be
re-run after adding a font. It never deletes the sources; remove them yourself
once the CSS points at the new files (src/styles/fontAssets.test.ts fails while
any .ttf is still referenced or left unreferenced on disk).

Requires woff2 (`brew install woff2`). Standard library only otherwise.
"""

from __future__ import annotations

import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "public" / "fonts"


# --- just enough sfnt parsing to fingerprint a face ------------------------


def tables(data: bytes) -> dict[str, bytes]:
    """Table tag -> table bytes, from the sfnt table directory."""
    (num,) = struct.unpack_from(">H", data, 4)
    out = {}
    for i in range(num):
        tag, _checksum, offset, length = struct.unpack_from(">4sIII", data, 12 + i * 16)
        out[tag.decode("latin-1")] = data[offset : offset + length]
    return out


def cmap_coverage(cmap: bytes) -> set[int]:
    """Every codepoint the font maps to a real glyph, across all subtables."""
    covered: set[int] = set()
    (num,) = struct.unpack_from(">H", cmap, 2)
    for i in range(num):
        (offset,) = struct.unpack_from(">I", cmap, 8 + i * 8)
        (fmt,) = struct.unpack_from(">H", cmap, offset)
        if fmt == 4:
            covered |= _cmap4(cmap, offset)
        elif fmt == 12:
            covered |= _cmap12(cmap, offset)
        elif fmt == 6:
            first, count = struct.unpack_from(">HH", cmap, offset + 6)
            covered |= {
                first + n
                for n in range(count)
                if struct.unpack_from(">H", cmap, offset + 10 + n * 2)[0]
            }
        # format 0 is legacy Mac and format 14 is variation selectors; neither
        # carries coverage these fonts don't also express above.
    return covered


def _cmap4(cmap: bytes, base: int) -> set[int]:
    (seg_x2,) = struct.unpack_from(">H", cmap, base + 6)
    segs = seg_x2 // 2
    ends = struct.unpack_from(f">{segs}H", cmap, base + 14)
    starts = struct.unpack_from(f">{segs}H", cmap, base + 16 + seg_x2)
    deltas = struct.unpack_from(f">{segs}h", cmap, base + 16 + seg_x2 * 2)
    range_off_at = base + 16 + seg_x2 * 3
    offsets = struct.unpack_from(f">{segs}H", cmap, range_off_at)

    covered = set()
    for seg in range(segs):
        for cp in range(starts[seg], min(ends[seg], 0xFFFE) + 1):
            if offsets[seg] == 0:
                gid = (cp + deltas[seg]) & 0xFFFF
            else:
                at = range_off_at + seg * 2 + offsets[seg] + (cp - starts[seg]) * 2
                if at + 2 > len(cmap):
                    continue
                (gid,) = struct.unpack_from(">H", cmap, at)
                if gid:
                    gid = (gid + deltas[seg]) & 0xFFFF
            if gid:
                covered.add(cp)
    return covered


def _cmap12(cmap: bytes, base: int) -> set[int]:
    (groups,) = struct.unpack_from(">I", cmap, base + 12)
    covered = set()
    for g in range(groups):
        start, end, _gid = struct.unpack_from(">III", cmap, base + 16 + g * 12)
        covered.update(range(start, end + 1))
    return covered


def fvar_axes(fvar: bytes) -> list[tuple[str, float, float, float]]:
    """(tag, min, default, max) per variation axis — empty for a static face."""
    array_at, _reserved, count, size = struct.unpack_from(">HHHH", fvar, 4)
    axes = []
    for i in range(count):
        tag, lo, default, hi = struct.unpack_from(">4siii", fvar, array_at + i * size)
        axes.append(
            (tag.decode("latin-1"), lo / 65536, default / 65536, hi / 65536)
        )
    return axes


def fingerprint(path: Path) -> tuple:
    """What must survive the round trip. Compared, never stored."""
    t = tables(path.read_bytes())
    (num_glyphs,) = struct.unpack_from(">H", t["maxp"], 4)
    (upem,) = struct.unpack_from(">H", t["head"], 18)
    coverage = cmap_coverage(t["cmap"])
    axes = fvar_axes(t["fvar"]) if "fvar" in t else []
    return num_glyphs, upem, len(coverage), sorted(coverage)[:1], axes, coverage


def describe(fp: tuple) -> str:
    glyphs, upem, mapped, _, axes, _ = fp
    axis_note = " " + ",".join(a[0] for a in axes) if axes else ""
    return f"{glyphs} glyphs, {mapped} mapped, {upem} upem{axis_note}"


# --- conversion ------------------------------------------------------------


def convert(ttf: Path, tmp: Path) -> tuple[int, int]:
    """Compress one face and prove the result decodes back to the same font."""
    woff2 = ttf.with_suffix(".woff2")
    subprocess.run(["woff2_compress", str(ttf)], check=True, capture_output=True)
    if not woff2.exists():
        raise RuntimeError(f"woff2_compress produced no output for {ttf.name}")

    # woff2_decompress writes its .ttf next to its input, which would clobber
    # the source we are checking against — so round-trip in a scratch copy.
    scratch = tmp / woff2.name
    shutil.copy(woff2, scratch)
    subprocess.run(
        ["woff2_decompress", str(scratch)], check=True, capture_output=True
    )

    before, after = fingerprint(ttf), fingerprint(scratch.with_suffix(".ttf"))
    if before != after:
        woff2.unlink()
        raise RuntimeError(
            f"{ttf.name} did not survive the round trip\n"
            f"      source: {describe(before)}\n"
            f"      woff2:  {describe(after)}"
        )
    return ttf.stat().st_size, woff2.stat().st_size


def main() -> int:
    if not shutil.which("woff2_compress"):
        sys.exit("woff2_compress not found — install it with `brew install woff2`")

    sources = sorted(FONT_DIR.rglob("*.ttf"))
    pending = [f for f in sources if not f.with_suffix(".woff2").exists()]
    if not pending:
        print(f"nothing to do — {len(sources)} .ttf, all already converted")
        return 0

    total_before = total_after = 0
    with tempfile.TemporaryDirectory() as td:
        for ttf in pending:
            before, after = convert(ttf, Path(td))
            total_before += before
            total_after += after
            rel = ttf.relative_to(FONT_DIR)
            saved = 100 - after * 100 // before
            print(f"  {rel}  {before // 1024}K -> {after // 1024}K  (-{saved}%)")

    saved = 100 - total_after * 100 // total_before
    print(
        f"\n{len(pending)} faces verified: "
        f"{total_before // 1024}K -> {total_after // 1024}K (-{saved}%)"
    )
    print("sources left in place — delete the .ttf once global.css points at the .woff2")
    return 0


if __name__ == "__main__":
    sys.exit(main())
