# Slicer benchmark

Measures what the reader actually shows: whether strip edges cut through printed symbols, and how fast slicing runs.

## Objective run (about 3 minutes)

```sh
python3 run.py                  # compare the current slicer with baseline.json
python3 run.py --save-baseline  # accept the current slicer as the new baseline
```

This builds `slicer_bench` in `out/build`. It renders the fixed page set from `~/Piano` into `out/pages` at 250 DPI, the phone's DPI (`sample.py`). It then slices every page with the production `ppp_slice_page` and runs `clipcheck.py` in both reader views. Everything under `out/` is generated and safe to delete.

- **Page set:** the first, one-third and two-thirds page of each PDF (`d…` ids), plus up to 6 random inner pages per PDF (`r…` ids, fixed seed).
- **Reader views:**
  - `hidden`: portrait columns. The reader hides the band a strip shares with the next strip.
  - `full`: landscape, where each strip is shown whole.
- **Clean strip:** no ink stroke crosses any visible edge of the strip.
- **Pages with no music** (listed in `labels/baseline/structure.json`) are excluded from the percentages.

The output also lists pages whose strip count changed since the baseline. A change there is either a structural fix or a regression, so check each one.

## Visual grading (optional)

The objective detector also flags harmless crossings, such as a stray pixel of a slur. To get per-strip rates that match what a reader would notice:

```sh
python3 grade_sheets.py   # out/review/sheets: every clip on 120 + 60 fixed-seed random strips
# label each clip in out/review/labels/*.jsonl (format in grade_sheets.py)
python3 aggregate.py out/review out/review/labels
```

`labels/baseline/` holds the labels for the baseline slicer. `python3 aggregate.py labels/baseline` prints those numbers:

- Portrait: 61% of strips clean.
- Landscape: 52% clean.

`labels/baseline/structure.json` is the per-page grading of the first 93 pages: 408 of 411 systems were found as exactly one strip.

`labels/edge-snap/` holds the same grading after edges started snapping to quiet rows and short mark lines (pedal, dynamics) started attaching to the nearer system. Per-strip clean rates:

| View | Baseline | Edge-snap |
|---|---|---|
| Portrait | 61% (95% CI 52–69) | 80% (95% CI 72–86) |
| Landscape | 52% (95% CI 39–64) | 65% (95% CI 52–76) |

Most of the cuts that remain are low beams or ledger notes on pages where the ink runs unbroken from one system into the next.

Strips overlap on purpose. A symbol cut at one strip's edge is often shown whole in the neighbouring strip. `python3 completeness.py baseline_ranges.txt out/ranges.txt` measures this for the landscape view, where whole strips are shown. Results on the 228 music pages:

| | Baseline | Edge-snap |
|---|---|---|
| Cut symbols shown whole in another strip | 59% | 92% |
| Strips whose cut symbols are all shown whole somewhere | 65% | 90% |

A symbol's extent is measured as the ink running vertically through the cut columns.

## Other tools

- `compare_pages.py out/x.png <page ids…>` draws the baseline and current strips side by side.
- `strip_diff.py` builds `out/strip_diff.png`, a sheet of every strip that exists only in the baseline or only in the current run.

## Phone timing

`bench.cpp` cross-compiles with the NDK:

```sh
$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang++ -O2 -std=c++17 \
  -static-libstdc++ -I.. -I. -I../.. tools/bench/bench.cpp slicer.cpp slicer_legacy.cpp -o slicer_bench_arm64
adb push slicer_bench_arm64 out/pages /data/local/tmp/rescore/
adb shell "cd /data/local/tmp/rescore && ./slicer_bench_arm64 7 pages/*.png"
```

Run it from `cpp/`, and adjust the include paths if you run it from elsewhere.
