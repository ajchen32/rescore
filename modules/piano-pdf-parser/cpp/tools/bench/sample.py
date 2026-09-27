#!/usr/bin/env python3
"""Rasterize the fixed benchmark page set to grayscale PNGs.

Two sets, both reproducible from the sorted PDF list:
  d<i>_p<page>  first, 1/3 and 2/3 page of every PDF          (93 pages on ~/Piano)
  r<i>_p<page>  up to 6 random inner pages per PDF, seed below (151 pages on ~/Piano)

Pages are rendered at 250 DPI, what resolveDpi picks on a 1080 px wide phone.
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import fitz  # PyMuPDF

DPI = 250
RANDOM_SEED = 20260927
RANDOM_PAGES_PER_PDF = 6


def first_third_pages(page_count: int) -> list[int]:
    return sorted({0, page_count // 3, (2 * page_count) // 3})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path.home() / "Piano")
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "out" / "pages")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(RANDOM_SEED)
    matrix = fitz.Matrix(DPI / 72, DPI / 72)
    manifest = []

    for pdf_index, pdf in enumerate(sorted(args.input.glob("*.pdf"))):
        doc = fitz.open(pdf)
        count = doc.page_count
        fixed = first_third_pages(count)
        pool = [p for p in range(2, count + 1) if (p - 1) not in fixed]
        chosen = [(f"d{pdf_index:02d}_p{p + 1:03d}", p) for p in fixed]
        chosen += [
            (f"r{pdf_index:02d}_p{p:03d}", p - 1)
            for p in sorted(rng.sample(pool, min(RANDOM_PAGES_PER_PDF, len(pool))))
        ]
        for page_id, page_index in chosen:
            target = args.out / f"{page_id}.png"
            if not target.exists():
                pix = doc.load_page(page_index).get_pixmap(matrix=matrix, colorspace=fitz.csGRAY, alpha=False)
                pix.save(target)
            manifest.append({"id": page_id, "pdf": pdf.name, "page": page_index + 1, "pages": count})
        doc.close()

    (args.out.parent / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"{len(manifest)} pages in {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
