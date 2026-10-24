import type { Strip } from "piano-pdf-parser-core";

export type ReaderStrip = Strip & {
  id: string;
  parts?: ReaderStrip[];
};

export type StripColumn = {
  id: string;
  strips: ReaderStrip[];
  startIndex: number;
};

export const DEFAULT_ASPECT_RATIO = 4.2;
export const MIN_VISIBLE_COUNT = 1;
export const MAX_VISIBLE_COUNT = 10;
export const DEFAULT_VISIBLE_COUNT = 3;
export const DEFAULT_LANDSCAPE_VISIBLE_COUNT = 1;

export function clampVisibleCount(count: number): number {
  return Math.min(MAX_VISIBLE_COUNT, Math.max(MIN_VISIBLE_COUNT, count));
}
export const STRIP_SEPARATOR_HEIGHT = 12;
export const PAGE_BREAK_EXTRA_HEIGHT = 12;

/**
 * Top of a merged strip on its starting page. Parts are in reading order and
 * may continue onto later pages, so only parts on the first part's page count;
 * taking the smallest y0 across pages would place the strip too high.
 */
export function mergedStartY0(parts: ReaderStrip[]): number | undefined {
  const pageIndex = parts[0]?.pageIndex;
  return parts.find((part) => part.pageIndex === pageIndex && part.y0 !== undefined)?.y0;
}

export function stripPagePosition(strip: ReaderStrip): { pageIndex: number; y0: number } {
  if (strip.parts && strip.parts.length > 0) {
    return {
      pageIndex: strip.parts[0].pageIndex,
      y0: mergedStartY0(strip.parts) ?? Number.MAX_SAFE_INTEGER,
    };
  }

  return {
    pageIndex: strip.pageIndex,
    y0: strip.y0 ?? Number.MAX_SAFE_INTEGER,
  };
}

export function comparePagePosition(a: ReaderStrip, b: ReaderStrip): number {
  const posA = stripPagePosition(a);
  const posB = stripPagePosition(b);
  if (posA.pageIndex !== posB.pageIndex) {
    return posA.pageIndex - posB.pageIndex;
  }
  return posA.y0 - posB.y0;
}

export function sortByPagePosition(strips: ReaderStrip[]): ReaderStrip[] {
  return [...strips].sort(comparePagePosition);
}

export function insertAtPagePosition(
  strips: ReaderStrip[],
  item: ReaderStrip
): ReaderStrip[] {
  const position = stripPagePosition(item);
  if (position.y0 === Number.MAX_SAFE_INTEGER) {
    let insertIndex = strips.length;
    for (let index = strips.length - 1; index >= 0; index -= 1) {
      if (strips[index].pageIndex <= position.pageIndex) {
        insertIndex = index + 1;
        break;
      }
      insertIndex = index;
    }
    const next = [...strips];
    next.splice(insertIndex, 0, item);
    return next;
  }

  const insertIndex = strips.findIndex((strip) => comparePagePosition(item, strip) < 0);
  const next = [...strips];
  if (insertIndex < 0) {
    next.push(item);
  } else {
    next.splice(insertIndex, 0, item);
  }
  return next;
}

export function toReaderStrips(strips: Strip[]): ReaderStrip[] {
  return sortByPagePosition(
    strips.map((strip, index) => ({
      ...strip,
      id: `${index}-${strip.uri}`,
    }))
  );
}

export function flattenParts(strip: ReaderStrip): ReaderStrip[] {
  if (strip.parts && strip.parts.length > 0) {
    return strip.parts;
  }
  return [strip];
}

export function isMergedStrip(strip: ReaderStrip): boolean {
  return Boolean(strip.parts && strip.parts.length > 0);
}

function stripTopY(strip: ReaderStrip): number | undefined {
  const parts = flattenParts(strip);
  return parts[0]?.y0;
}

function stripBottomY(strip: ReaderStrip): number | undefined {
  const parts = flattenParts(strip);
  const lastPart = parts[parts.length - 1];
  if (lastPart?.y0 === undefined) {
    return undefined;
  }
  return lastPart.y0 + lastPart.height;
}

/**
 * Whether `next` continues on the page `strip` ends on. A merged strip can
 * span a page break, so compare its last part with the next strip's first part
 * rather than the strips' own `pageIndex`, which is where they start.
 */
export function continuesOnSamePage(strip: ReaderStrip, next: ReaderStrip): boolean {
  const lastPart = flattenParts(strip).at(-1);
  const firstNextPart = flattenParts(next)[0];
  return lastPart?.pageIndex === firstNextPart?.pageIndex;
}

export function overlapPxWithNext(strip: ReaderStrip, next: ReaderStrip): number {
  if (!continuesOnSamePage(strip, next)) {
    return 0;
  }

  const bottomY = stripBottomY(strip);
  const topY = stripTopY(next);
  if (bottomY === undefined || topY === undefined) {
    return 0;
  }

  const overlap = bottomY - topY;
  return overlap > 0 ? overlap : 0;
}

export type MergedPartLayout = {
  part: ReaderStrip;
  stackSpan: number;
  hideBottomOverlapPx: number;
};

export function mergedPartLayouts(parts: ReaderStrip[]): MergedPartLayout[] {
  return parts.map((part, index) => {
    const next = parts[index + 1];
    const hideBottomOverlapPx =
      next !== undefined ? overlapPxWithNext(part, next) : 0;
    const stackSpan = Math.max(1, part.height - hideBottomOverlapPx);
    return { part, stackSpan, hideBottomOverlapPx };
  });
}

export function mergedStackHeight(parts: ReaderStrip[]): number {
  return mergedPartLayouts(parts).reduce((sum, layout) => sum + layout.stackSpan, 0);
}

export type MergedPartColumn = {
  leftFraction: number;
  widthFraction: number;
};

/**
 * Each system is cropped to its own horizontal span, so stacking parts at full
 * width stretches them by different amounts. Placing them by their page `x0`
 * inside the union of their spans keeps barlines lined up. Parts saved before
 * `x0` was recorded fall back to full width.
 */
export function mergedPartColumns(parts: ReaderStrip[]): MergedPartColumn[] {
  const fullWidth = parts.map(() => ({ leftFraction: 0, widthFraction: 1 }));
  if (parts.some((part) => part.x0 === undefined)) {
    return fullWidth;
  }

  const minX = Math.min(...parts.map((part) => part.x0 as number));
  const maxX = Math.max(...parts.map((part) => (part.x0 as number) + part.width));
  const span = maxX - minX;
  if (span <= 0) {
    return fullWidth;
  }

  return parts.map((part) => ({
    leftFraction: ((part.x0 as number) - minX) / span,
    widthFraction: part.width / span,
  }));
}

export type PageFrame = {
  x0: number;
  x1: number;
};

// A strip this much wider than its page's median strip (a title sliced together
// with the first system, a mark poking into the margin) doesn't mark where the
// page's systems start and end.
const FRAME_OUTLIER_WIDTH_RATIO = 1.05;

/**
 * Where each page's systems start and end horizontally, in slicing-raster
 * pixels: the leftmost start and rightmost end among its strips, ignoring
 * unusually wide ones. Laying strips out inside this frame keeps an indented
 * first system indented and every system on a page at one horizontal scale.
 */
export function pageFrames(strips: ReaderStrip[]): Map<number, PageFrame> {
  const partsByPage = new Map<number, ReaderStrip[]>();
  for (const strip of strips) {
    for (const part of flattenParts(strip)) {
      if (part.x0 === undefined) {
        continue;
      }
      const pageParts = partsByPage.get(part.pageIndex) ?? [];
      pageParts.push(part);
      partsByPage.set(part.pageIndex, pageParts);
    }
  }

  const frames = new Map<number, PageFrame>();
  for (const [pageIndex, parts] of partsByPage) {
    const widths = parts.map((part) => part.width).sort((a, b) => a - b);
    const medianWidth = widths[Math.floor(widths.length / 2)];
    const regular = parts.filter((part) => part.width <= medianWidth * FRAME_OUTLIER_WIDTH_RATIO);
    frames.set(pageIndex, {
      x0: Math.min(...regular.map((part) => part.x0 as number)),
      x1: Math.max(...regular.map((part) => (part.x0 as number) + part.width)),
    });
  }
  return frames;
}

export type HorizontalInsets = {
  left: number;
  right: number;
};

const NO_INSETS: HorizontalInsets = { left: 0, right: 0 };

/**
 * How far in from each side of its row a strip should be drawn, as fractions of
 * the row width, so it sits where it does within its page's frame. Strips that
 * reach past the frame on a side get no inset on that side.
 */
export function stripInsets(strip: ReaderStrip, frames: Map<number, PageFrame>): HorizontalInsets {
  const parts = flattenParts(strip);
  if (parts.some((part) => part.x0 === undefined)) {
    return NO_INSETS;
  }
  const frame = frames.get(parts[0].pageIndex);
  const span = frame ? frame.x1 - frame.x0 : 0;
  if (!frame || span <= 0) {
    return NO_INSETS;
  }

  const x0 = Math.min(...parts.map((part) => part.x0 as number));
  const x1 = Math.max(...parts.map((part) => (part.x0 as number) + part.width));
  const left = Math.max(0, x0 - frame.x0) / span;
  const right = Math.max(0, frame.x1 - x1) / span;
  return left + right < 1 ? { left, right } : NO_INSETS;
}

export function mergedStackWidth(parts: ReaderStrip[]): number {
  if (parts.some((part) => part.x0 === undefined)) {
    return Math.max(...parts.map((part) => part.width));
  }
  const minX = Math.min(...parts.map((part) => part.x0 as number));
  const maxX = Math.max(...parts.map((part) => (part.x0 as number) + part.width));
  return Math.max(1, maxX - minX);
}

function mergedStackX0(parts: ReaderStrip[]): number | undefined {
  if (parts.some((part) => part.x0 === undefined)) {
    return undefined;
  }
  return Math.min(...parts.map((part) => part.x0 as number));
}

export function stripSlotHeight(readerHeight: number, visibleCount: number): number {
  if (readerHeight <= 0 || visibleCount <= 0) {
    return 0;
  }
  return Math.max(1, readerHeight / visibleCount);
}

/**
 * The column holding strip `stripIndex`. Used to keep the system that was at the
 * top of the screen visible when columns are rebuilt (the -/+ buttons, rotation).
 */
export function columnContainingStrip(columns: StripColumn[], stripIndex: number): number {
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    if (columns[index].startIndex <= stripIndex) {
      return index;
    }
  }
  return 0;
}

/**
 * Groups strips into columns of `visibleCount`. A column also starts at every
 * index in `breaks` (where a song begins), so each song opens on a fresh screen.
 */
export function chunkStrips(
  strips: ReaderStrip[],
  visibleCount: number,
  breaks: number[] = []
): StripColumn[] {
  const columns: StripColumn[] = [];
  const breakSet = new Set(breaks);
  let index = 0;
  while (index < strips.length) {
    let end = index + 1;
    while (end < strips.length && end - index < visibleCount && !breakSet.has(end)) {
      end += 1;
    }
    columns.push({
      id: `col-${strips[index].id}`,
      strips: strips.slice(index, end),
      startIndex: index,
    });
    index = end;
  }
  return columns;
}

function newMergedId(parts: ReaderStrip[]): string {
  return `merged-${parts.map((part) => part.id).join("-")}`;
}

export function mergeWithAbove(strips: ReaderStrip[], index: number): ReaderStrip[] {
  if (index <= 0 || index >= strips.length) {
    return strips;
  }

  const above = strips[index - 1];
  const current = strips[index];
  const parts = [...flattenParts(above), ...flattenParts(current)];
  const merged: ReaderStrip = {
    id: newMergedId(parts),
    uri: parts[0].uri,
    width: mergedStackWidth(parts),
    height: mergedStackHeight(parts),
    pageIndex: parts[0].pageIndex,
    x0: mergedStackX0(parts),
    y0: mergedStartY0(parts),
    parts,
  };

  const next = [...strips];
  next.splice(index - 1, 2, merged);
  return next;
}

export function moveToGarbage(
  strips: ReaderStrip[],
  garbage: ReaderStrip[],
  index: number
): { strips: ReaderStrip[]; garbage: ReaderStrip[] } {
  if (strips.length <= 1 || index < 0 || index >= strips.length) {
    return { strips, garbage };
  }

  const removed = strips[index];
  const nextStrips = strips.filter((_, stripIndex) => stripIndex !== index);
  const nextGarbage = sortByPagePosition([...garbage, removed]);
  return { strips: nextStrips, garbage: nextGarbage };
}

export function restoreFromGarbage(
  strips: ReaderStrip[],
  garbage: ReaderStrip[],
  garbageIndex: number
): { strips: ReaderStrip[]; garbage: ReaderStrip[] } {
  if (garbageIndex < 0 || garbageIndex >= garbage.length) {
    return { strips, garbage };
  }

  const restored = garbage[garbageIndex];
  const nextGarbage = garbage.filter((_, index) => index !== garbageIndex);
  const nextStrips = insertAtPagePosition(strips, restored);
  return { strips: nextStrips, garbage: nextGarbage };
}

export function replaceAt(
  strips: ReaderStrip[],
  index: number,
  replacements: ReaderStrip[]
): ReaderStrip[] {
  if (index < 0 || index >= strips.length || replacements.length === 0) {
    return strips;
  }
  const next = [...strips];
  next.splice(index, 1, ...replacements);
  return next;
}

export type SplitPiece = {
  uri: string;
  width: number;
  height: number;
  originY?: number;
};

export function makeSplitStrips(
  source: ReaderStrip,
  topUri: string,
  bottomUri: string,
  topHeight: number,
  bottomHeight: number,
  splitIndex: number
): ReaderStrip[] {
  return makeSplitPieces(
    source,
    [
      { uri: topUri, width: source.width, height: topHeight },
      { uri: bottomUri, width: source.width, height: bottomHeight },
    ],
    splitIndex
  );
}

export function makeSplitPieces(
  source: ReaderStrip,
  pieces: SplitPiece[],
  splitIndex: number
): ReaderStrip[] {
  return pieces.map((piece, pieceIndex) => {
    const y0 =
      source.y0 !== undefined && piece.originY !== undefined
        ? source.y0 + piece.originY
        : undefined;

    return {
      id: `split-${splitIndex}-${pieceIndex}-${piece.uri}`,
      uri: piece.uri,
      width: piece.width,
      height: piece.height,
      pageIndex: source.pageIndex,
      x0: source.x0,
      y0,
    };
  });
}

export function makeSplitPieceFromLeaves(
  leaves: ReaderStrip[],
  splitIndex: number,
  pieceIndex: number
): ReaderStrip {
  if (leaves.length === 0) {
    throw new Error("Could not create a split piece without image data.");
  }
  if (leaves.length === 1) {
    return leaves[0];
  }

  return {
    id: `split-${splitIndex}-${pieceIndex}-merged-${leaves.map((part) => part.id).join("-")}`,
    uri: leaves[0].uri,
    width: mergedStackWidth(leaves),
    height: leaves.reduce((sum, part) => sum + part.height, 0),
    pageIndex: leaves[0].pageIndex,
    x0: mergedStackX0(leaves),
    y0: mergedStartY0(leaves),
    parts: leaves,
  };
}
