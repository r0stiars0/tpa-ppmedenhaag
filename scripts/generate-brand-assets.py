#!/usr/bin/env python3
"""Regenerate every derived PPME brand asset from the master logo files.

The masters in ``assets/brand/`` are the vendor-supplied PNGs (3564x1844,
aspect 1.933:1) in the three official colourways. Nothing in the app reads
them directly — they are the source of truth this script derives from, so
an icon or wordmark is never hand-edited and can always be rebuilt:

    python3 scripts/generate-brand-assets.py

Requires Pillow (``pip install Pillow``); it is not a project dependency
because the app itself never resizes an image at build or run time. Run
this only when the masters change.

Two things worth keeping right if you edit this:

* **Never square a wordmark.** The masters are 1.933:1. The web wordmarks
  keep that ratio exactly; the square icons crop the globe mark out of the
  artwork instead of letterboxing the whole lockup, which is what made the
  previous icon set illegible at launcher size.
* **The maskable icon has a smaller safe zone than it looks.** Android may
  crop everything outside a centred circle of 80% of the canvas (409px of
  512). The mark's artwork reaches 1.35x its own half-width at the corners
  where the orbit arcs run out, so it is scaled to 58% — at which the
  furthest pixel sits at radius ~200px, just inside the 204.8px limit and
  therefore safe under any mask shape.
"""

from __future__ import annotations

import base64
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "assets" / "brand"
PUBLIC = ROOT / "public"
ICONS = PUBLIC / "icons"
FUNCTION_LIB = ROOT / "netlify" / "functions" / "lib"

# Brand primary (checklist §0 / ADR-007). Sampled straight out of the blue
# master, which is exactly this value.
PPME_BLUE = (13, 80, 160, 255)

# The globe mark, as a box in master-image coordinates. Includes the orbit
# arcs that sweep around it and stops well short of the "PPME" wordmark,
# whose leftmost pixel is at x=1591.
MARK_BOX = (140, 140, 1500, 1500)

# Web wordmark width. The largest the logo is ever drawn is the 64px-tall
# sign-in mark, ~124px wide, so 720px is still comfortably past what a 3x
# display asks for — and it matters that this stays modest, because the
# service worker precaches both colourways on first load.
WORDMARK_WIDTH = 720

# Width of the white wordmark embedded in the year-end report PDF. Drawn at
# ~78pt wide, so this is roughly 6x — comfortably past what any printer
# resolves, and still a small enough buffer to inline as base64.
PDF_LOGO_WIDTH = 460


def load(name: str) -> Image.Image:
    return Image.open(BRAND / name).convert("RGBA")


def wordmark(src: Image.Image, out: Path, width: int = WORDMARK_WIDTH) -> None:
    height = round(width * src.height / src.width)
    src.resize((width, height), Image.LANCZOS).save(out, optimize=True)
    print(f"  {out.relative_to(ROOT)}  {width}x{height}")


def icon(mark: Image.Image, out: Path, size: int, fraction: float) -> None:
    """Square icon: the globe mark centred on an opaque brand-blue field."""
    canvas = Image.new("RGBA", (size, size), PPME_BLUE)
    side = round(size * fraction)
    canvas.alpha_composite(mark.resize((side, side), Image.LANCZOS), ((size - side) // 2,) * 2)
    canvas.save(out, optimize=True)
    print(f"  {out.relative_to(ROOT)}  {size}x{size} (mark {fraction:.0%})")


def badge(mark: Image.Image, out: Path, size: int, fraction: float) -> None:
    """Android notification badge: a white silhouette on transparency.

    The status-bar icon is **masked by its alpha channel** — Android throws
    the colours away and redraws whatever is opaque in the system tint. So
    a normal app icon, which is an opaque square, comes out as a solid
    white block, and that is exactly what `icon-192.png` was producing
    before this existed. Only the mark's own alpha is kept here, and every
    visible pixel is forced to pure white so nothing survives except the
    shape.

    96px because Chrome asks for a badge at roughly 4x the 24dp status-bar
    slot; anything larger is thrown away by the downscale.
    """
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    side = round(size * fraction)
    resized = mark.resize((side, side), Image.LANCZOS)
    silhouette = Image.new("RGBA", resized.size, (255, 255, 255, 255))
    silhouette.putalpha(resized.getchannel("A"))
    canvas.alpha_composite(silhouette, ((size - side) // 2,) * 2)
    canvas.save(out, optimize=True)
    opaque = sum(1 for a in canvas.getchannel("A").getdata() if a > 8)
    print(f"  {out.relative_to(ROOT)}  {size}x{size} silhouette, {opaque * 100 // (size * size)}% coverage")


def pdf_logo_module(src: Image.Image, out: Path) -> None:
    """Inline the PDF header wordmark as base64 in a TypeScript module.

    Deliberately *not* `included_files` in netlify.toml: a bundled Function
    resolves runtime file paths differently under `netlify dev` than on
    deployed Netlify, and getting that wrong would only ever surface at
    publish time in production. A base64 constant is bundled by esbuild
    into the Function itself, so both environments load byte-identical
    bytes with no filesystem involved.
    """
    height = round(PDF_LOGO_WIDTH * src.height / src.width)
    resized = src.resize((PDF_LOGO_WIDTH, height), Image.LANCZOS)
    tmp = out.parent / "_logo_tmp.png"
    resized.save(tmp, optimize=True)
    data = base64.b64encode(tmp.read_bytes()).decode("ascii")
    tmp.unlink()

    wrapped = "'\n  + '".join(data[i : i + 96] for i in range(0, len(data), 96))
    out.write_text(
        f'''// GENERATED by scripts/generate-brand-assets.py — do not edit by hand.
//
// The reversed (white) PPME wordmark, {PDF_LOGO_WIDTH}x{height}, inlined as base64 so the
// year-end report PDF header can draw the real logo instead of typesetting
// its name. Inlined rather than shipped as a file next to the Function
// because runtime file resolution differs between `netlify dev` and
// deployed Netlify; a string constant is bundled by esbuild and behaves
// identically in both. Regenerate with the script above, never by editing
// this literal.
const LOGO_WHITE_PNG_BASE64 =
  '{wrapped}'

/**
 * The header logo as a Buffer, or `null` if it cannot be decoded — the PDF
 * renderer falls back to a typographic wordmark in that case, so a publish
 * can never fail over branding.
 */
export function getHeaderLogoPng(): Buffer | null {{
  try {{
    const buffer = Buffer.from(LOGO_WHITE_PNG_BASE64, 'base64')
    return buffer.length > 0 ? buffer : null
  }} catch {{
    return null
  }}
}}

/** Intrinsic pixel size, so the caller can scale without probing the bitmap. */
export const HEADER_LOGO_ASPECT = {PDF_LOGO_WIDTH} / {height}
'''
    )
    print(f"  {out.relative_to(ROOT)}  ({PDF_LOGO_WIDTH}x{height}, {len(data) // 1024} KB base64)")


def main() -> None:
    blue = load("ppme-logo-blue.png")
    white = load("ppme-logo-white.png")

    print("web wordmarks:")
    wordmark(blue, PUBLIC / "logo.png")
    wordmark(white, PUBLIC / "logo-white.png")

    mark = white.crop(MARK_BOX)
    print("PWA icons:")
    icon(mark, ICONS / "icon-192.png", 192, 0.86)
    icon(mark, ICONS / "icon-512.png", 512, 0.86)
    icon(mark, ICONS / "icon-maskable-512.png", 512, 0.58)
    icon(mark, ICONS / "favicon-32.png", 32, 0.92)
    icon(mark, ICONS / "favicon-16.png", 16, 1.0)

    print("notification badge:")
    badge(mark, ICONS / "badge-96.png", 96, 0.92)

    print("PDF header:")
    pdf_logo_module(white, FUNCTION_LIB / "logoAsset.ts")


if __name__ == "__main__":
    main()
