#!/usr/bin/env python3
"""Objective slicer benchmark: sample pages, slice them, measure clipped ink.

  python3 run.py                  # compare against baseline.json
  python3 run.py --save-baseline  # record the current slicer as the baseline

Visual grading of a strip sample is a separate step (grade_sheets.py, aggregate.py).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import clipcheck

HERE = Path(__file__).resolve().parent
CPP = HERE.parent.parent
OUT = HERE / "out"
BASELINE = HERE / "baseline.json"
BASELINE_RANGES = HERE / "baseline_ranges.txt"
ITERATIONS = 5


def build() -> Path:
    build_dir = OUT / "build"
    subprocess.run(["cmake", "-S", str(CPP), "-B", str(build_dir), "-DCMAKE_BUILD_TYPE=Release"],
                   check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["cmake", "--build", str(build_dir), "-j", "--target", "slicer_bench", "slicer_test"],
                   check=True, stdout=subprocess.DEVNULL)
    return build_dir


def nonmusic_pages() -> set[str]:
    rows = json.loads((HERE / "labels" / "baseline" / "structure.json").read_text())
    return {r["id"] for r in rows if not r["music"]}


def strip_counts(ranges_path: Path) -> dict[str, int]:
    return {Path(line.split()[0]).stem: int(line.split()[2]) for line in open(ranges_path)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", default=str(Path.home() / "Piano"))
    parser.add_argument("--save-baseline", action="store_true")
    args = parser.parse_args()

    OUT.mkdir(exist_ok=True)
    build_dir = build()
    subprocess.run([sys.executable, str(HERE / "sample.py"), "--input", args.input, "--out", str(OUT / "pages")], check=True)
    pages = sorted(f"pages/{p.name}" for p in (OUT / "pages").glob("*.png"))

    ranges_path = OUT / "ranges.txt"
    with open(ranges_path, "w") as handle:
        subprocess.run([str(build_dir / "slicer_bench"), str(ITERATIONS), *pages], check=True, stdout=handle, cwd=OUT)
    times = sorted(float(line.split()[1]) for line in open(ranges_path))

    exclude = nonmusic_pages()
    result = {"desktop_median_ms": times[len(times) // 2], "views": {}}
    for view in ("hidden", "full"):
        records = clipcheck.analyze(str(ranges_path), view, str(OUT / f"crops_{view}"))
        json.dump(records, open(OUT / f"clips_{view}.json", "w"), indent=1)
        result["views"][view] = clipcheck.summarize(records, exclude)

    if args.save_baseline:
        BASELINE.write_text(json.dumps(result, indent=1) + "\n")
        BASELINE_RANGES.write_text(ranges_path.read_text())
        print(json.dumps(result, indent=1))
        print(f"saved {BASELINE.name} and {BASELINE_RANGES.name}")
        return 0

    base = json.loads(BASELINE.read_text())
    print(f"{'metric':22s} {'view':7s} {'baseline':>10s} {'now':>10s}")
    for view in ("hidden", "full"):
        for key in ("clean_pct", "clean_1mm_pct", "clips", "ink_not_shown_pct"):
            print(f"{key:22s} {view:7s} {base['views'][view][key]:>10} {result['views'][view][key]:>10}")
    growth = 100 * (result["views"]["hidden"]["strip_px"] / base["views"]["hidden"]["strip_px"] - 1)
    print(f"{'strip height change':22s} {'':7s} {'':>10s} {growth:>+9.1f}%")
    print(f"{'desktop median ms':22s} {'':7s} {base['desktop_median_ms']:>10} {result['desktop_median_ms']:>10}")

    before, after = strip_counts(BASELINE_RANGES), strip_counts(ranges_path)
    changed = {k: (before.get(k), after[k]) for k in after if before.get(k) != after[k]}
    print(f"pages whose strip count changed: {len(changed)}")
    for page, (old, new) in sorted(changed.items()):
        print(f"  {page}: {old} -> {new}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
