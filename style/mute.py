#!/usr/bin/env python3
"""kudmascot mute: the one deterministic post-process step for every icon.

usage: mute.py <in.png> <out.png> [--size 512]

1. desaturate:  ImageEnhance.Color(img).enhance(0.62)
2. warm wash:   Image.blend(img, solid #F4ECDC, 0.08)
3. centre-crop to square, resize to size x size. Full bleed, opaque, NO mask:
   the pack ships each icon as an adaptive icon, so the launcher applies the
   user's own icon shape (circle, squircle, square, teardrop...).
"""
import sys
from PIL import Image, ImageEnhance

SAT = 0.62
WASH = (0xF4, 0xEC, 0xDC)
WASH_ALPHA = 0.08


def mute(img: Image.Image) -> Image.Image:
    img = img.convert("RGB")
    img = ImageEnhance.Color(img).enhance(SAT)
    return Image.blend(img, Image.new("RGB", img.size, WASH), WASH_ALPHA)


def square(img: Image.Image, size: int = 512) -> Image.Image:
    w, h = img.size
    s = min(w, h)
    img = img.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
    return img.resize((size, size), Image.LANCZOS)


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    size = 512
    if "--size" in argv:
        size = int(argv[argv.index("--size") + 1])
    square(mute(Image.open(argv[1])), size).save(argv[2], "PNG", optimize=True)
    print(argv[2])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
