#!/usr/bin/env python3
"""kudmascot grid: batch generation helpers (one image call draws up to 9 icons).

usage:
  grid.py refsheet <out.png> <cols> <icon1.png> [icon2.png ...]
      Lays the apps' original icons out in the same cols x rows order the grid
      prompt asks for, on white, so the model sees each cell's identity.
  grid.py split <sheet.png> <cols> <rows> <n> <outdir> <stem>
      Cuts a generated contact sheet into its first n cells. Each cell is trimmed
      of the white gutter (bbox of non-white pixels), centre-cropped to a square
      and inset a few px to drop gutter fringe. Writes <outdir>/<stem>-<i>.png
      (raw, un-muted; mute.py runs after) and prints one path per line.
"""
import os
import sys
from PIL import Image

CELL = 256
GAP = 24


def refsheet(out, cols, icons):
    rows = (len(icons) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * CELL + (cols + 1) * GAP, rows * CELL + (rows + 1) * GAP), "white")
    for i, p in enumerate(icons):
        if not p or not os.path.exists(p):
            continue
        im = Image.open(p).convert("RGBA").resize((CELL, CELL), Image.LANCZOS)
        x = GAP + (i % cols) * (CELL + GAP)
        y = GAP + (i // cols) * (CELL + GAP)
        sheet.paste(im, (x, y), im)
    sheet.save(out)
    print(out)


def split(path, cols, rows, n, outdir, stem):
    img = Image.open(path).convert("RGB")
    W, H = img.size
    for i in range(n):
        c, r = i % cols, i // cols
        cell = img.crop((c * W // cols, r * H // rows, (c + 1) * W // cols, (r + 1) * H // rows))
        # gutter = near-white; the tile background is a brand colour, so its bbox is the tile
        mask = cell.convert("L").point(lambda v: 255 if v < 238 else 0)
        bb = mask.getbbox() or (0, 0, cell.width, cell.height)
        t = cell.crop(bb)
        s = min(t.size)
        inset = max(2, s // 80)
        x0, y0 = (t.width - s) // 2 + inset, (t.height - s) // 2 + inset
        t = t.crop((x0, y0, x0 + s - 2 * inset, y0 + s - 2 * inset))
        out = os.path.join(outdir, f"{stem}-{i + 1}.png")
        t.save(out)
        print(out)


def main(a):
    if len(a) >= 4 and a[1] == "refsheet":
        refsheet(a[2], int(a[3]), a[4:])
        return 0
    if len(a) == 8 and a[1] == "split":
        split(a[2], int(a[3]), int(a[4]), int(a[5]), a[6], a[7])
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
