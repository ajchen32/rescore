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

export function stripPagePosition(strip: ReaderStrip): { pageIndex: number; y0: number } {
  if (strip.parts && strip.parts.length > 0) {
    const y0Values = strip.parts
      .map((part) => part.y0)
      .filter((value): value is number => value !== undefined);
    return {
      pageIndex: strip.pageIndex,
      y0: y0Values.length > 0 ? Math.min(...y0Values) : Number.MAX_SAFE_INTEGER,
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

export function overlapPxWithNext(strip: ReaderStrip, next: ReaderStrip): number {
  if (strip.pageIndex !== next.pageIndex) {
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

export function stripSlotHeight(
  readerHeight: number,
  visibleCount: number,
  includeSeparators = true
): number {
  if (readerHeight <= 0 || visibleCount <= 0) {
    return 0;
  }
  const gutterTotal = includeSeparators
    ? Math.max(0, visibleCount - 1) * STRIP_SEPARATOR_HEIGHT
    : 0;
  const withGutters = (readerHeight - gutterTotal) / visibleCount;
  if (withGutters > 0) {
    return withGutters;
  }
  return Math.max(1, readerHeight / visibleCount);
}

export function chunkStrips(strips: ReaderStrip[], visibleCount: number): StripColumn[] {
  const columns: StripColumn[] = [];
  for (let index = 0; index < strips.length; index += visibleCount) {
    columns.push({
      id: `col-${strips[index]?.id ?? index}`,
      strips: strips.slice(index, index + visibleCount),
      startIndex: index,
    });
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
  const y0Values = parts
    .map((part) => part.y0)
    .filter((value): value is number => value !== undefined);
  const merged: ReaderStrip = {
    id: newMergedId(parts),
    uri: parts[0].uri,
    width: parts[0].width,
    height: mergedStackHeight(parts),
    pageIndex: parts[0].pageIndex,
    y0: y0Values.length > 0 ? Math.min(...y0Values) : parts[0].y0,
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

  const y0Values = leaves
    .map((part) => part.y0)
    .filter((value): value is number => value !== undefined);
  return {
    id: `split-${splitIndex}-${pieceIndex}-merged-${leaves.map((part) => part.id).join("-")}`,
    uri: leaves[0].uri,
    width: leaves[0].width,
    height: leaves.reduce((sum, part) => sum + part.height, 0),
    pageIndex: leaves[0].pageIndex,
    y0: y0Values.length > 0 ? Math.min(...y0Values) : leaves[0].y0,
    parts: leaves,
  };
}
