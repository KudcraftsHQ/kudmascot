#!/usr/bin/env python3
"""kudmascot macos: the macOS-shaped icon from the same muted full-bleed art.

usage: macos.py <in.png> <out.png|out.icns> [--mute] [--size 1024]

Follows the macOS (pre-Tahoe, Big Sur-style) icon grid, matching ntfy-bar's mac icon:
1024 canvas, an 824 px body centred, continuous-corner squircle (a superellipse, n=5, which
tracks Apple's template corner of r~185 at 824 to within a pixel), a soft drop shadow, and
transparent outside the body. --mute runs style/mute.py's mute on the input first (pass the raw
1024 px generation for a sharper body than the 512 px muted draft). An .icns output gets every
size from 16 to 1024.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mute import mute  # noqa: E402

BODY = 824 / 1024
N = 5.0          # superellipse exponent
SS = 4           # supersampling for the anti-aliased mask
SHADOW_ALPHA = 72
SHADOW_DY = 0.012
SHADOW_BLUR = 0.02


def squircle_mask(size: int) -> Image.Image:
    big = size * SS
    a = big / 2
    pts = []
    steps = 720
    import math
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        x = a + a * (abs(c) ** (2 / N)) * (1 if c >= 0 else -1)
        y = a + a * (abs(s) ** (2 / N)) * (1 if s >= 0 else -1)
        pts.append((x, y))
    m = Image.new("L", (big, big), 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def square_crop(img: Image.Image) -> Image.Image:
    w, h = img.size
    s = min(w, h)
    return img.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))


def mac_icon(art: Image.Image, canvas: int = 1024) -> Image.Image:
    body = round(canvas * BODY)
    off = (canvas - body) // 2
    a = square_crop(art.convert("RGB")).resize((body, body), Image.LANCZOS).convert("RGBA")
    a.putalpha(squircle_mask(body))
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, SHADOW_ALPHA), (off, off + round(canvas * SHADOW_DY)), a.getchannel("A"))
    out.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(canvas * SHADOW_BLUR)))
    out.alpha_composite(a, (off, off))
    return out


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    size = int(argv[argv.index("--size") + 1]) if "--size" in argv else 1024
    art = Image.open(argv[1])
    if "--mute" in argv:
        art = mute(art)
    icon = mac_icon(art, size)
    if argv[2].endswith(".icns"):
        icon.save(argv[2], sizes=[(s, s) for s in (16, 32, 64, 128, 256, 512, 1024)])
    else:
        icon.save(argv[2], "PNG", optimize=True)
    print(argv[2])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
