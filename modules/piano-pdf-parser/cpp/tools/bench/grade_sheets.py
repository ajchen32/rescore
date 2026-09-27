#!/usr/bin/env python3
"""Build review sheets for a fixed random sample of strips (run after run.py).

Each sheet shows every clip flagged on one strip as a zoomed full-resolution
crop with the visible edge in red. Label each clip in a JSONL file:
  {"clip": "<crop id>", "set": "hidden"|"full", "cat": "note|staff|mark|text|other",
   "own": bool, "bad": bool}
then run aggregate.py.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
SAMPLE_SEED = 7
SAMPLE_SIZES = (("hidden", 120), ("full", 60))
TILES_PER_SHEET = 10


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT / "review")
    args = parser.parse_args()

    structure = json.loads((HERE / "labels" / "baseline" / "structure.json").read_text())
    nonmusic = {r["id"] for r in structure if not r["music"]}
    sheets_dir = args.out / "sheets"
    sheets_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SAMPLE_SEED)
    plan = []

    for view, size in SAMPLE_SIZES:
        records = json.load(open(OUT / f"clips_{view}.json"))
        by_id = {r["id"]: r for r in records}
        strips = [(r["id"], s) for r in records if r["id"] not in nonmusic for s in range(1, r["strips"] + 1)]
        for page_id, strip in rng.sample(strips, size):
            clips = [c for c in by_id[page_id]["clips"] if c["strip"] == strip]
            entry = {"view": view, "page": page_id, "strip": strip, "clips": [c["crop"] for c in clips], "sheets": []}
            for start in range(0, len(clips), TILES_PER_SHEET):
                chunk = clips[start:start + TILES_PER_SHEET]
                sheet = Image.new("RGB", (980, ((len(chunk) + 1) // 2) * 300), "gray")
                for i, clip in enumerate(chunk):
                    tile = Image.new("RGB", (480, 295), "white")
                    tile.paste(Image.open(OUT / f"crops_{view}" / clip["crop"]).resize((480, 270)), (0, 25))
                    side = "ABOVE" if clip["kind"] == "bottom" else "BELOW"
                    ImageDraw.Draw(tile).text((4, 4), f"#{clip['crop'][:-4]}   strip is {side} the red line", fill=(0, 0, 200))
                    sheet.paste(tile, ((i % 2) * 490, (i // 2) * 300))
                name = f"{view}_{page_id}_s{strip}_{start // TILES_PER_SHEET}.png"
                sheet.save(sheets_dir / name)
                entry["sheets"].append(name)
            plan.append(entry)

    (args.out / "review_plan.json").write_text(json.dumps(plan, indent=1))
    clips = sum(len(e["clips"]) for e in plan)
    print(f"{len(plan)} strips, {clips} clips to label on {sum(len(e['sheets']) for e in plan)} sheets in {sheets_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
