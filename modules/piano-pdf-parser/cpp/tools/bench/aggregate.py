#!/usr/bin/env python3
"""Per-strip clipping rates from labelled review sheets, with Wilson 95% CIs.

  python3 aggregate.py labels/baseline            # baseline plan + labels
  python3 aggregate.py out/review out/review/labels
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

ROWS = (
    ("clean", "no visibly cut symbol"),
    ("music", "note, staff or mark cut"),
    ("notes", "note or staff cut"),
    ("marks", "mark cut (pedal, fingering, slur...)"),
    ("text", "text cut"),
)


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    p = k / n
    denom = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return 100 * (centre - margin) / denom, 100 * (centre + margin) / denom


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan_dir", type=Path, help="directory with review_plan.json")
    parser.add_argument("labels_dir", type=Path, nargs="?", help="directory with *.jsonl labels (default: plan_dir)")
    args = parser.parse_args()

    plan = json.loads((args.plan_dir / "review_plan.json").read_text())
    labels_dir = args.labels_dir or args.plan_dir
    clip_views: dict[str, set[str]] = {}
    for entry in plan:
        for crop in entry["clips"]:
            clip_views.setdefault(crop[:-4], set()).add(entry["view"])

    labels = {}
    for path in sorted(labels_dir.glob("*.jsonl")):
        for line in path.read_text().splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            clip = row["clip"].lstrip("#")
            view = row.get("set") or (next(iter(clip_views[clip])) if len(clip_views.get(clip, ())) == 1 else None)
            if view:
                labels[(view, clip)] = row

    missing = [(e["view"], c[:-4]) for e in plan for c in e["clips"] if (e["view"], c[:-4]) not in labels]
    if missing:
        print(f"warning: {len(missing)} clips have no label, e.g. {missing[:3]}")

    for view in ("hidden", "full"):
        entries = [e for e in plan if e["view"] == view]
        if not entries:
            continue
        counts = dict.fromkeys((name for name, _ in ROWS), 0)
        for entry in entries:
            bad = [labels[(view, c[:-4])] for c in entry["clips"] if (view, c[:-4]) in labels]
            bad = [row for row in bad if row["bad"]]
            cats = {row["cat"] for row in bad}
            counts["clean"] += not bad
            counts["music"] += bool(cats & {"note", "staff", "mark"})
            counts["notes"] += bool(cats & {"note", "staff"})
            counts["marks"] += "mark" in cats
            counts["text"] += "text" in cats
        n = len(entries)
        print(f"\n{view} view, {n} random music strips")
        for name, label in ROWS:
            lo, hi = wilson(counts[name], n)
            print(f"  {label:38s} {counts[name]:4d}/{n} = {100 * counts[name] / n:4.0f}%  (95% CI {lo:.0f}-{hi:.0f}%)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
