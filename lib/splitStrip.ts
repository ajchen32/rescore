import { requireOptionalNativeModule } from "expo";
import { Image } from "react-native";

import {
  flattenParts,
  isMergedStrip,
  makeSplitPieceFromLeaves,
  makeSplitPieces,
  mergedPartLayouts,
  mergedStackHeight,
  type ReaderStrip,
  type SplitPiece,
} from "./corrections";

const MIN_SPLIT_RATIO = 0.05;
const MAX_SPLIT_RATIO = 0.95;

export const DEFAULT_SPLIT_OVERLAP_RATIO = 0.01;
export const MIN_SPLIT_OVERLAP_RATIO = 0;
export const MAX_SPLIT_OVERLAP_RATIO = 0.15;
export const SPLIT_OVERLAP_STEP = 0.01;

export const SPLIT_REBUILD_MESSAGE =
  "Split requires a native rebuild. From the project folder run: npx expo run:android";

export function isSplitAvailable(): boolean {
  return requireOptionalNativeModule("ExpoImageManipulator") != null;
}

export function clampSplitRatio(ratio: number): number {
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

export function clampOverlapRatio(ratio: number): number {
  return Math.min(MAX_SPLIT_OVERLAP_RATIO, Math.max(MIN_SPLIT_OVERLAP_RATIO, ratio));
}

export function getImagePixelSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error ?? new Error("Could not read strip image size."))
    );
  });
}

/**
 * Size of the coordinate space cut ratios are measured against. For a merged
 * strip that is the stacked height (each part minus the region it duplicates
 * from the next part), which is what both the reader and
 * `splitMergedStripAtRatios` lay parts out in.
 */
export function getStripStackSize(strip: ReaderStrip): { width: number; height: number } {
  const parts = flattenParts(strip);
  if (parts.length === 1) {
    return { width: parts[0].width, height: parts[0].height };
  }

  return {
    width: Math.max(...parts.map((part) => part.width)),
    height: mergedStackHeight(parts),
  };
}

function uniqueCutYs(actualHeight: number, ratios: number[]): number[] {
  const sorted = [...ratios].map(clampSplitRatio).sort((a, b) => a - b);
  const cutYs: number[] = [];

  for (const ratio of sorted) {
    const cutY = Math.min(actualHeight - 1, Math.max(1, Math.round(actualHeight * ratio)));
    if (cutYs.length === 0 || cutYs[cutYs.length - 1] !== cutY) {
      cutYs.push(cutY);
    }
  }

  return cutYs;
}

type PieceBounds = {
  originY: number;
  height: number;
};

/**
 * `overlapRatio` is the fraction of the strip that two adjacent pieces share,
 * which is exactly the band the split preview draws centred on each cut line.
 * Each piece therefore reaches half of that band past its own cut.
 */
function overlapExtentPx(actualHeight: number, overlapRatio: number): number {
  return Math.round((actualHeight * clampOverlapRatio(overlapRatio)) / 2);
}

function computePieceBounds(
  actualHeight: number,
  cutYs: number[],
  overlapPx: number
): PieceBounds[] {
  const boundaries = [0, ...cutYs, actualHeight];
  const pieceCount = boundaries.length - 1;

  const buildPieces = (effectiveOverlap: number): PieceBounds[] | null => {
    const pieces: PieceBounds[] = [];

    for (let index = 0; index < pieceCount; index += 1) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      const originY = index === 0 ? 0 : Math.max(0, start - effectiveOverlap);
      const endY =
        index === pieceCount - 1 ? actualHeight : Math.min(actualHeight, end + effectiveOverlap);
      const height = endY - originY;

      if (height < 1 || endY <= originY) {
        return null;
      }

      pieces.push({ originY, height });
    }

    return pieces;
  };

  if (overlapPx <= 0) {
    const hardCut = buildPieces(0);
    if (!hardCut) {
      throw new Error("Could not create valid split pieces from the cut lines.");
    }
    return hardCut;
  }

  for (let effectiveOverlap = overlapPx; effectiveOverlap >= 0; effectiveOverlap -= 1) {
    const pieces = buildPieces(effectiveOverlap);
    if (pieces) {
      return pieces;
    }
  }

  throw new Error("Could not create valid split pieces from the cut lines.");
}

type PartSegment = {
  part: ReaderStrip;
  stackY0: number;
  stackSpan: number;
};

function getPartSegments(strip: ReaderStrip): PartSegment[] {
  const layouts = mergedPartLayouts(flattenParts(strip));
  let stackY0 = 0;
  return layouts.map((layout) => {
    const segment = { part: layout.part, stackY0, stackSpan: layout.stackSpan };
    stackY0 += layout.stackSpan;
    return segment;
  });
}

type ImageManipulatorModule = typeof import("expo-image-manipulator");

async function cropImageRegion(
  ImageManipulator: ImageManipulatorModule,
  uri: string,
  originY: number,
  cropHeight: number,
  actualWidth: number
): Promise<{ uri: string; width: number; height: number }> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ crop: { originX: 0, originY, width: actualWidth, height: cropHeight } }],
    { compress: 1, format: ImageManipulator.SaveFormat.PNG }
  );

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
  };
}

async function splitSingleStripAtRatios(
  strip: ReaderStrip,
  ratios: number[],
  splitIndex: number,
  overlapRatio: number,
  ImageManipulator: ImageManipulatorModule
): Promise<ReaderStrip[]> {
  const { width: actualWidth, height: actualHeight } = await getImagePixelSize(strip.uri);
  const cutYs = uniqueCutYs(actualHeight, ratios);
  const overlapPx = overlapExtentPx(actualHeight, overlapRatio);
  const pieceBounds = computePieceBounds(actualHeight, cutYs, overlapPx);
  const pieces: SplitPiece[] = [];

  for (const bounds of pieceBounds) {
    const cropped = await cropImageRegion(
      ImageManipulator,
      strip.uri,
      bounds.originY,
      bounds.height,
      actualWidth
    );
    pieces.push({
      ...cropped,
      originY: bounds.originY,
    });
  }

  if (pieces.length === 0) {
    throw new Error("Could not create any strip pieces from the cut lines.");
  }

  return makeSplitPieces({ ...strip, width: pieces[0].width }, pieces, splitIndex);
}

async function splitMergedStripAtRatios(
  strip: ReaderStrip,
  ratios: number[],
  splitIndex: number,
  overlapRatio: number,
  ImageManipulator: ImageManipulatorModule
): Promise<ReaderStrip[]> {
  const segments = getPartSegments(strip);
  const actualHeight = segments.reduce((sum, segment) => sum + segment.stackSpan, 0);
  const cutYs = uniqueCutYs(actualHeight, ratios);
  const overlapPx = overlapExtentPx(actualHeight, overlapRatio);
  const pieceBounds = computePieceBounds(actualHeight, cutYs, overlapPx);
  const results: ReaderStrip[] = [];

  for (let pieceIndex = 0; pieceIndex < pieceBounds.length; pieceIndex += 1) {
    const bounds = pieceBounds[pieceIndex];
    const pieceEndY = bounds.originY + bounds.height;
    const leaves: ReaderStrip[] = [];

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const { part, stackY0, stackSpan } = segments[segmentIndex];
      const stackY1 = stackY0 + stackSpan;
      const intersectStart = Math.max(bounds.originY, stackY0);
      const intersectEnd = Math.min(pieceEndY, stackY1);
      const cropHeight = intersectEnd - intersectStart;

      if (cropHeight < 1) {
        continue;
      }

      const localOriginY = intersectStart - stackY0;
      const { width: actualWidth } = await getImagePixelSize(part.uri);
      const cropped = await cropImageRegion(
        ImageManipulator,
        part.uri,
        localOriginY,
        cropHeight,
        actualWidth
      );

      leaves.push({
        id: `split-${splitIndex}-${pieceIndex}-${segmentIndex}-${cropped.uri}`,
        uri: cropped.uri,
        width: cropped.width,
        height: cropped.height,
        pageIndex: part.pageIndex,
        y0: part.y0 !== undefined ? part.y0 + localOriginY : undefined,
      });
    }

    if (leaves.length === 0) {
      throw new Error("Could not create any strip pieces from the cut lines.");
    }

    results.push(makeSplitPieceFromLeaves(leaves, splitIndex, pieceIndex));
  }

  return results;
}

export async function splitStripAtRatios(
  strip: ReaderStrip,
  ratios: number[],
  splitIndex: number,
  overlapRatio = 0
): Promise<ReaderStrip[]> {
  if (!isSplitAvailable()) {
    throw new Error(SPLIT_REBUILD_MESSAGE);
  }

  if (ratios.length === 0) {
    throw new Error("Add at least one cut line.");
  }

  const ImageManipulator = await import("expo-image-manipulator");
  if (isMergedStrip(strip)) {
    return splitMergedStripAtRatios(strip, ratios, splitIndex, overlapRatio, ImageManipulator);
  }

  return splitSingleStripAtRatios(strip, ratios, splitIndex, overlapRatio, ImageManipulator);
}

export async function splitStripAtRatio(
  strip: ReaderStrip,
  ratio: number,
  splitIndex: number,
  overlapRatio = 0
): Promise<ReaderStrip[]> {
  return splitStripAtRatios(strip, [ratio], splitIndex, overlapRatio);
}
