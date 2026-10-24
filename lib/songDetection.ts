import type { ReaderStrip } from "./corrections";

/*
 * Where a new piece probably starts in a freshly sliced book. The slicer has no
 * idea of titles, but a title leaves two marks on the first system of a page:
 *   - folded into the system: the system then starts at the very top of the
 *     page and is clearly taller than the page's other systems, or
 *   - sliced on its own (a short heading like "II."): a short strip at the very
 *     top of the page.
 * A tall removed band above the first system (a title the slicer left out) also
 * counts. Continuation pages start a little lower, below the page number.
 *
 * Tuned on scanned books (Tchaikovsky Seasons 12/12, Chopin Nocturnes 19/19 with
 * one false start, Rachmaninov Preludes 7/10, Mozart sonatas 4/5) with no false
 * starts on single pieces. Pieces that begin partway down a page are not found.
 * All values are slicing-raster pixels, compared as ratios.
 */

// The first system "starts at the top" when its y0 is within this fraction of the
// page's typical system height (continuation pages start ~5% of it lower).
const TOP_RATIO = 0.03;
// Taller than the page's other systems by this much: a title folded in.
const TALL_RATIO = 1.12;
// A heading sliced on its own: this short relative to the page's other systems.
const SHORT_MIN_RATIO = 0.5;
const SHORT_MAX_RATIO = 0.8;
// A removed band at least this tall (of the page) ending at the first system.
const TITLE_BAND_RATIO = 0.15;
// A band "ends at" a system when they're within this fraction of the page.
const TOUCH_RATIO = 0.01;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

type PageStrip = { index: number; y0: number; height: number };

/**
 * Strip indices where songs probably start, always including 0. Only plain
 * (unmerged) strips straight from the slicer are considered.
 */
export function suggestSongStarts(strips: ReaderStrip[], garbage: ReaderStrip[]): number[] {
  const byPage = new Map<number, PageStrip[]>();
  strips.forEach((strip, index) => {
    if (strip.y0 === undefined) {
      return;
    }
    const page = byPage.get(strip.pageIndex) ?? [];
    page.push({ index, y0: strip.y0, height: strip.height });
    byPage.set(strip.pageIndex, page);
  });

  const starts = new Set<number>([0]);
  for (const [pageIndex, pageStrips] of byPage) {
    if (pageStrips.length < 2) {
      continue;
    }
    pageStrips.sort((a, b) => a.y0 - b.y0);
    const [first, ...rest] = pageStrips;
    const typical = median(rest.map((strip) => strip.height));
    if (typical <= 0) {
      continue;
    }
    const ratio = first.height / typical;
    const atTop = first.y0 <= TOP_RATIO * typical;
    if (atTop && (ratio >= TALL_RATIO || (ratio >= SHORT_MIN_RATIO && ratio <= SHORT_MAX_RATIO))) {
      starts.add(first.index);
      continue;
    }

    // A title the slicer left out as its own band, right above the first system.
    const pageGarbage = garbage.filter((band) => band.pageIndex === pageIndex && band.y0 !== undefined);
    const pageHeight = Math.max(
      ...pageStrips.map((strip) => strip.y0 + strip.height),
      ...pageGarbage.map((band) => (band.y0 as number) + band.height)
    );
    const titleBand = pageGarbage.find((band) => {
      const bottom = (band.y0 as number) + band.height;
      return (
        Math.abs(bottom - first.y0) <= TOUCH_RATIO * pageHeight &&
        band.height >= TITLE_BAND_RATIO * pageHeight
      );
    });
    if (titleBand) {
      starts.add(first.index);
    }
  }

  return [...starts].sort((a, b) => a - b);
}
