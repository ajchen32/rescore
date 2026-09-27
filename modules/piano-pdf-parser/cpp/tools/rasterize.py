#!/usr/bin/env python3
"""Rasterize PDF pages to grayscale PNG for slicer_debug."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_INPUT = Path("/home/aaron/Piano")
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "out"
DEFAULT_DPI = 200


def rasterize_with_pymupdf(pdf_path: Path, output_dir: Path, dpi: int, pages: list[int]) -> list[Path]:
    import fitz  # type: ignore

    outputs: list[Path] = []
    doc = fitz.open(pdf_path)
    for page_index in pages:
        if page_index < 0 or page_index >= doc.page_count:
            continue
        page = doc.load_page(page_index)
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=matrix, colorspace=fitz.csGRAY, alpha=False)
        out_path = output_dir / f"{pdf_path.stem}_p{page_index + 1:03d}.png"
        pix.save(out_path)
        outputs.append(out_path)
    doc.close()
    return outputs


def rasterize_with_pdftoppm(pdf_path: Path, output_dir: Path, dpi: int, pages: list[int]) -> list[Path]:
    outputs: list[Path] = []
    for page_index in pages:
        prefix = output_dir / f"{pdf_path.stem}_p{page_index + 1:03d}"
        cmd = [
            "pdftoppm",
            "-png",
            "-gray",
            "-r",
            str(dpi),
            "-f",
            str(page_index + 1),
            "-l",
            str(page_index + 1),
            str(pdf_path),
            str(prefix),
        ]
        subprocess.run(cmd, check=True)
        generated = sorted(output_dir.glob(f"{pdf_path.stem}_p{page_index + 1:03d}*.png"))
        if generated:
            final = output_dir / f"{pdf_path.stem}_p{page_index + 1:03d}.png"
            generated[0].rename(final)
            outputs.append(final)
    return outputs


def choose_pages(page_count: int, explicit: list[int] | None) -> list[int]:
    if explicit:
        return [p for p in explicit if 0 <= p < page_count]
    if page_count <= 1:
        return [0]
    return [0, 1, min(2, page_count - 1)]


def main() -> int:
    parser = argparse.ArgumentParser(description="Rasterize PDFs for slicer debug overlays")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Directory containing PDFs")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Output directory for PNG files")
    parser.add_argument("--dpi", type=int, default=DEFAULT_DPI, help="Rasterization DPI")
    parser.add_argument("--limit", type=int, default=8, help="Maximum number of PDFs to process")
    parser.add_argument("--page", type=int, action="append", help="Explicit page index (0-based), repeatable")
    parser.add_argument(
        "files",
        nargs="*",
        type=Path,
        help="Specific PDF files (default: first --limit PDFs in --input)",
    )
    args = parser.parse_args()

    if not args.input.exists():
        print(f"Input directory not found: {args.input}", file=sys.stderr)
        return 1

    args.output.mkdir(parents=True, exist_ok=True)

    use_pymupdf = False
    try:
        import fitz  # noqa: F401

        use_pymupdf = True
    except ImportError:
        if shutil.which("pdftoppm") is None:
            print("Need PyMuPDF (pip install pymupdf) or pdftoppm in PATH", file=sys.stderr)
            return 1

    if args.files:
        pdfs = []
        for path in args.files:
            if not path.is_file():
                candidate = args.input / path
                if candidate.is_file():
                    pdfs.append(candidate)
                else:
                    print(f"PDF not found: {path}", file=sys.stderr)
                    return 1
            else:
                pdfs.append(path)
    else:
        pdfs = sorted(args.input.glob("*.pdf"))[: args.limit]
    if not pdfs:
        print(f"No PDFs found in {args.input}", file=sys.stderr)
        return 1

    all_outputs: list[Path] = []
    for pdf_path in pdfs:
        if use_pymupdf:
            import fitz

            page_count = fitz.open(pdf_path).page_count
            pages = choose_pages(page_count, args.page)
            outputs = rasterize_with_pymupdf(pdf_path, args.output, args.dpi, pages)
        else:
            pages = choose_pages(9999, args.page)
            outputs = rasterize_with_pdftoppm(pdf_path, args.output, args.dpi, pages)
        all_outputs.extend(outputs)
        print(f"{pdf_path.name}: {len(outputs)} page(s)")

    print(f"Wrote {len(all_outputs)} PNG(s) to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
