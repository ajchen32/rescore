#!/usr/bin/env python3
"""Find ink severed by the strip edges the reader actually shows.

Visible region of strip i:
  "hidden" view (portrait columns): x in [x0, x1), y in [y0, min(y1, next.y0)),
    because the reader hides the band a strip shares with the next one
    (overlapPxWithNext in lib/corrections.ts).
  "full" view (landscape, or the last strip of a column): the whole strip.

A clip is a cluster of ink columns that run continuously across a visible edge.
Severity is the smaller fragment's extent in px (250 dpi: 1 px = 0.1 mm).
Clips of <= MIN_PX are ignored as antialiasing / speckle.
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

INK = 160
MIN_PX = 3
GAP = 4


def read_ranges(path: str) -> list[tuple[str, list[tuple[int, int, int, int]]]]:
    """Page paths in the file are relative to the file's directory."""
    base = os.path.dirname(os.path.abspath(path))
    pages = []
    for line in open(path):
        t = line.split()
        n = int(t[2])
        pages.append((os.path.join(base, t[0]), [tuple(int(v) for v in t[3 + 4 * i: 7 + 4 * i]) for i in range(n)]))
    return pages


def _run(ink_line: np.ndarray) -> int:
    if ink_line.size == 0 or not ink_line[0]:
        return 0
    paper = np.flatnonzero(~ink_line)
    return int(paper[0]) if paper.size else int(ink_line.size)


def _clusters(idx: np.ndarray) -> list[tuple[int, int]]:
    if idx.size == 0:
        return []
    groups, start = [], idx[0]
    for a, b in zip(idx[:-1], idx[1:]):
        if b - a > GAP:
            groups.append((int(start), int(a)))
            start = b
    groups.append((int(start), int(idx[-1])))
    return groups


def visible_regions(ranges, view: str):
    regions = []
    for i, (x0, y0, x1, y1) in enumerate(ranges):
        bottom = min(y1, ranges[i + 1][1]) if (view == "hidden" and i + 1 < len(ranges)) else y1
        regions.append((x0, y0, x1, max(bottom, y0 + 1)))
    return regions


def analyze_page(path: str, ranges, view: str, crops_dir: str | None = None) -> dict:
    page_id = os.path.basename(path)[:-4]
    gray = np.array(Image.open(path).convert("L"))
    height, width = gray.shape
    ink = gray < INK
    regions = visible_regions(ranges, view)

    edges = []  # (kind, position, lo, hi, strip index)
    for i, (x0, y0, x1, y1) in enumerate(regions):
        if view == "full" or i == 0 or y0 != regions[i - 1][3]:
            edges.append(("top", y0, x0, x1, i))
        edges.append(("bottom", y1, x0, x1, i))
        edges.append(("left", x0, y0, y1, i))
        edges.append(("right", x1, y0, y1, i))

    clips = []
    for kind, pos, lo, hi, strip in edges:
        horizontal = kind in ("top", "bottom")
        limit = height if horizontal else width
        if pos <= 0 or pos >= limit:
            continue
        a = ink[pos - 1, lo:hi] if horizontal else ink[lo:hi, pos - 1]
        b = ink[pos, lo:hi] if horizontal else ink[lo:hi, pos]
        for c0, c1 in _clusters(np.flatnonzero(a & b) + lo):
            if horizontal:
                before = max(_run(ink[pos - 1::-1, x]) for x in range(c0, c1 + 1))
                after = max(_run(ink[pos:, x]) for x in range(c0, c1 + 1))
            else:
                before = max(_run(ink[y, pos - 1::-1]) for y in range(c0, c1 + 1))
                after = max(_run(ink[y, pos:]) for y in range(c0, c1 + 1))
            severity = min(before, after)
            if severity > MIN_PX:
                clip = {"kind": kind, "strip": strip + 1, "pos": int(pos), "c0": c0, "c1": c1, "sev": int(severity)}
                clips.append(clip)

    shown = np.zeros_like(ink)
    for x0, y0, x1, y1 in regions:
        shown[y0:y1, x0:x1] = True
    hidden = ink & ~shown

    if crops_dir:
        os.makedirs(crops_dir, exist_ok=True)
        for k, clip in enumerate(clips):
            clip["crop"] = f"{page_id}_c{k:02d}.png"
            _write_crop(gray, clip, os.path.join(crops_dir, clip["crop"]))

    return {
        "id": page_id,
        "strips": len(ranges),
        "clips": clips,
        "hidden_ink_px": int(hidden.sum()),
        "ink_px": int(ink.sum()),
        "strip_px": int(sum(y1 - y0 for _, y0, _, y1 in ranges)),
    }


def _write_crop(gray: np.ndarray, clip: dict, path: str) -> None:
    height, width = gray.shape
    mid = (clip["c0"] + clip["c1"]) // 2
    if clip["kind"] in ("top", "bottom"):
        box = (max(0, mid - 160), max(0, clip["pos"] - 90), min(width, mid + 160), min(height, clip["pos"] + 90))
    else:
        box = (max(0, clip["pos"] - 160), max(0, mid - 90), min(width, clip["pos"] + 160), min(height, mid + 90))
    im = Image.fromarray(gray[box[1]:box[3], box[0]:box[2]]).convert("RGB")
    im = im.resize((im.width * 2, im.height * 2), Image.NEAREST)
    draw = ImageDraw.Draw(im)
    if clip["kind"] in ("top", "bottom"):
        y = (clip["pos"] - box[1]) * 2
        draw.line([(0, y), (im.width, y)], fill=(255, 0, 0), width=1)
    else:
        x = (clip["pos"] - box[0]) * 2
        draw.line([(x, 0), (x, im.height)], fill=(255, 0, 0), width=1)
    im.save(path)


def analyze(ranges_path: str, view: str, crops_dir: str | None = None) -> list[dict]:
    return [analyze_page(path, ranges, view, crops_dir) for path, ranges in read_ranges(ranges_path)]


def summarize(records: list[dict], exclude: set[str]) -> dict:
    kept = [r for r in records if r["id"] not in exclude]
    strips = sum(r["strips"] for r in kept)
    any_clip = {(r["id"], c["strip"]) for r in kept for c in r["clips"]}
    big_clip = {(r["id"], c["strip"]) for r in kept for c in r["clips"] if c["sev"] >= 10}
    return {
        "pages": len(kept),
        "strips": strips,
        "clean_pct": round(100 * (strips - len(any_clip)) / strips, 1),
        "clean_1mm_pct": round(100 * (strips - len(big_clip)) / strips, 1),
        "clips": sum(len(r["clips"]) for r in kept),
        "ink_not_shown_pct": round(100 * sum(r["hidden_ink_px"] for r in kept) / sum(r["ink_px"] for r in kept), 2),
        "strip_px": sum(r["strip_px"] for r in kept),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ranges")
    parser.add_argument("view", choices=["hidden", "full"])
    parser.add_argument("--crops", help="write a full-resolution crop per clip into this directory")
    parser.add_argument("--json", help="write per-page records here")
    args = parser.parse_args()
    records = analyze(args.ranges, args.view, args.crops)
    if args.json:
        json.dump(records, open(args.json, "w"), indent=1)
    print(json.dumps(summarize(records, set()), indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
