#!/usr/bin/env python3
"""Draw baseline vs current strips side by side for the given page ids."""
import sys
from PIL import Image, ImageDraw

COLORS = [(40, 110, 255), (255, 140, 0), (0, 170, 90), (200, 40, 160)]


def draw(page_id: str, ranges_file: str, height: int = 900) -> Image.Image:
    line = next(l for l in open(ranges_file) if f"/{page_id}.png" in l).split()
    n = int(line[2])
    ranges = [tuple(int(v) for v in line[3 + 4 * i: 7 + 4 * i]) for i in range(n)]
    im = Image.open(f"out/pages/{page_id}.png").convert("RGB")
    s = height / im.height
    im = im.resize((int(im.width * s), height))
    overlay = Image.new("RGBA", im.size)
    d = ImageDraw.Draw(overlay)
    for i, (x0, y0, x1, y1) in enumerate(ranges):
        c = COLORS[i % 4]
        d.rectangle([x0 * s, y0 * s, x1 * s, y1 * s], fill=c + (45,), outline=c + (255,), width=2)
    return Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")


pages = sys.argv[2:]
tiles = []
for page in pages:
    a, b = draw(page, "baseline_ranges.txt"), draw(page, "out/ranges.txt")
    t = Image.new("RGB", (a.width + b.width + 10, 920), "gray")
    t.paste(a, (0, 20)); t.paste(b, (a.width + 10, 20))
    ImageDraw.Draw(t).text((4, 4), f"{page}: baseline | now", fill=(255, 255, 255))
    tiles.append(t)
sheet = Image.new("RGB", (sum(t.width for t in tiles) + 10 * len(tiles), 920), "black")
x = 0
for t in tiles:
    sheet.paste(t, (x, 0)); x += t.width + 10
sheet.save(sys.argv[1])
