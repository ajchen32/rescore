#!/usr/bin/env python3
"""Sheet of strips that exist only in the baseline (LOST) or only now (NEW)."""
from PIL import Image, ImageDraw


def load(path):
    pages = {}
    for line in open(path):
        t = line.split()
        n = int(t[2])
        pages[t[0].split("/")[-1][:-4]] = [tuple(int(v) for v in t[3 + 4 * i: 7 + 4 * i]) for i in range(n)]
    return pages


def unmatched(a, b):
    out = []
    for page, strips in a.items():
        for x0, y0, x1, y1 in strips:
            cover = max([max(0, min(y1, q[3]) - max(y0, q[1])) for q in b[page]] + [0])
            if cover < 0.5 * (y1 - y0):
                out.append((page, y0, y1))
    return out


base, now = load("baseline_ranges.txt"), load("out/ranges.txt")
items = [("LOST",) + s for s in unmatched(base, now)] + [("NEW",) + s for s in unmatched(now, base)]
tiles = []
for tag, page, y0, y1 in items:
    im = Image.open(f"out/pages/{page}.png").convert("RGB")
    im = im.crop((0, y0, im.width, y1))
    im.thumbnail((700, 160))
    tile = Image.new("RGB", (700, 180), "white")
    tile.paste(im, (0, 18))
    ImageDraw.Draw(tile).text((2, 2), f"{tag} {page} {y0}-{y1}", fill=(200, 0, 0) if tag == "LOST" else (0, 120, 0))
    tiles.append(tile)
cols = 3
sheet = Image.new("RGB", (cols * 710, max(1, (len(tiles) + cols - 1) // cols) * 185), "gray")
for i, tile in enumerate(tiles):
    sheet.paste(tile, ((i % cols) * 710, (i // cols) * 185))
sheet.save("out/strip_diff.png")
print(len(items), "unmatched strips")
