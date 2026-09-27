#!/usr/bin/env python3
"""Is every symbol cut by a strip edge still shown whole in some strip?

For each place ink crosses a strip edge (landscape view, whole strips shown),
the symbol's vertical extent is taken as the ink runs through the crossing
columns. The cut counts as "covered" when another strip - usually the
neighbour, thanks to the overlap - contains that whole extent.

  python3 completeness.py baseline_ranges.txt out/ranges.txt
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import clipcheck

HERE = Path(__file__).resolve().parent


def run_extent(column: np.ndarray, start: int, step: int) -> int:
    """Rows of continuous ink from `start` going in `step` direction."""
    n = 0
    y = start
    while 0 <= y < column.size and column[y]:
        n += 1
        y += step
    return n


def measure(ranges_path: str, exclude: set[str]) -> dict:
    cuts = covered = 0
    strips = strips_with_uncovered = 0
    for path, ranges in clipcheck.read_ranges(ranges_path):
        page_id = Path(path).stem
        if page_id in exclude:
            continue
        ink = np.array(Image.open(path).convert("L")) < clipcheck.INK
        record = clipcheck.analyze_page(path, ranges, "full")
        strips += len(ranges)
        uncovered_strips = set()
        for clip in record["clips"]:
            if clip["kind"] not in ("top", "bottom"):
                continue
            y = clip["pos"]
            top = min(y - run_extent(ink[:, x], y - 1, -1) for x in range(clip["c0"], clip["c1"] + 1))
            bottom = max(y + run_extent(ink[:, x], y, 1) for x in range(clip["c0"], clip["c1"] + 1))
            cuts += 1
            whole = any(y0 <= top and bottom <= y1 and x0 <= clip["c0"] and clip["c1"] < x1
                        for x0, y0, x1, y1 in ranges)
            if whole:
                covered += 1
            else:
                uncovered_strips.add(clip["strip"])
        strips_with_uncovered += len(uncovered_strips)
    return {
        "cuts": cuts,
        "covered_pct": round(100 * covered / max(cuts, 1), 1),
        "strips": strips,
        "strips_all_symbols_whole_somewhere_pct": round(100 * (strips - strips_with_uncovered) / strips, 1),
    }


def main() -> int:
    rows = json.loads((HERE / "labels" / "baseline" / "structure.json").read_text())
    exclude = {r["id"] for r in rows if not r["music"]}
    for ranges_path in sys.argv[1:]:
        print(ranges_path, json.dumps(measure(ranges_path, exclude)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
