import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Minus, Plus, Scissors, Trash2, X } from "lucide-react-native";

import { flattenParts, type ReaderStrip } from "../lib/corrections";
import { IconButton } from "./IconButton";
import { ClippedStripImage, StackedStripImages } from "./StripStack";
import { colorWithAlpha, useTheme } from "../lib/theme";
import {
  getRememberedOverlapRatio,
  loadRememberedOverlapRatio,
  rememberOverlapRatio,
} from "../lib/splitPreferences";
import {
  clampOverlapRatio,
  clampSplitRatio,
  getImagePixelSize,
  getStripStackSize,
  MAX_SPLIT_OVERLAP_RATIO,
  MIN_SPLIT_OVERLAP_RATIO,
} from "../lib/splitStrip";

const MAX_CUTS = 8;
const MIN_GAP = 0.04;
const MIN_ADD_GAP = 0.08;
const SELECT_THRESHOLD_PX = 24;
const TITLE_MARGIN = 12;
const BUTTON_MARGIN = 16;
const VERTICAL_PADDING = 24;
const MIN_PREVIEW_HEIGHT = 80;

type SplitOverlayProps = {
  strip: ReaderStrip;
  inverted?: boolean;
  onConfirm: (ratios: number[], overlapRatio: number) => Promise<void>;
  onCancel: () => void;
};

function overlapLabel(overlapRatio: number): string {
  if (overlapRatio <= MIN_SPLIT_OVERLAP_RATIO) {
    return "None";
  }
  if (overlapRatio >= MAX_SPLIT_OVERLAP_RATIO) {
    return "More";
  }
  return `${Math.round(overlapRatio * 100)}%`;
}

function sortRatios(ratios: number[]): number[] {
  return [...ratios].sort((a, b) => a - b);
}

function largestGapMidpoint(ratios: number[]): number | null {
  const sorted = sortRatios(ratios);
  const bounds = [0.05, ...sorted, 0.95];
  let bestGap = 0;
  let bestMid: number | null = null;

  for (let index = 0; index < bounds.length - 1; index += 1) {
    const gap = bounds[index + 1] - bounds[index];
    if (gap > bestGap && gap >= MIN_ADD_GAP) {
      bestGap = gap;
      bestMid = (bounds[index] + bounds[index + 1]) / 2;
    }
  }

  return bestMid;
}

function clampRatioBetweenNeighbors(ratios: number[], index: number, value: number): number {
  const minBound = index === 0 ? 0.05 : ratios[index - 1] + MIN_GAP;
  const maxBound = index === ratios.length - 1 ? 0.95 : ratios[index + 1] - MIN_GAP;
  return clampSplitRatio(Math.min(maxBound, Math.max(minBound, value)));
}

function closestCutIndex(ratios: number[], y: number, displayHeight: number): number {
  let closest = 0;
  let minDistance = Number.POSITIVE_INFINITY;

  ratios.forEach((ratio, index) => {
    const distance = Math.abs(ratio * displayHeight - y);
    if (distance < minDistance) {
      minDistance = distance;
      closest = index;
    }
  });

  return closest;
}

export function SplitOverlay({
  strip,
  inverted = false,
  onConfirm,
  onCancel,
}: SplitOverlayProps) {
  const { colors } = useTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const parts = flattenParts(strip);
  const stacked = parts.length > 1;
  const [ratios, setRatios] = useState<number[]>([0.5]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [overlapRatio, setOverlapRatio] = useState(getRememberedOverlapRatio);
  const [working, setWorking] = useState(false);
  const [containerHeight, setContainerHeight] = useState(0);
  const [containerWidth, setContainerWidth] = useState(viewportWidth);
  const [titleHeight, setTitleHeight] = useState(0);
  const [buttonsHeight, setButtonsHeight] = useState(0);
  const [pixelSize, setPixelSize] = useState<{ width: number; height: number } | null>(null);
  const ratiosRef = useRef<number[]>([0.5]);
  const selectedIndexRef = useRef(0);
  const dragIndexRef = useRef<number | null>(null);
  const dragOffsetRef = useRef(0);

  useEffect(() => {
    void loadRememberedOverlapRatio().then((ratio) => {
      setOverlapRatio(ratio);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPixelSize(null);

    if (stacked) {
      setPixelSize(getStripStackSize(strip));
      return () => {
        cancelled = true;
      };
    }

    void getImagePixelSize(strip.uri)
      .then((size) => {
        if (!cancelled) {
          setPixelSize(size);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPixelSize(getStripStackSize(strip));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [stacked, strip]);

  const updateOverlapRatio = useCallback((nextRatio: number) => {
    const clamped = clampOverlapRatio(nextRatio);
    setOverlapRatio(clamped);
    void rememberOverlapRatio(clamped);
  }, []);

  const previewWidth = containerWidth > 0 ? containerWidth : viewportWidth;

  const displayHeight = useMemo(() => {
    const sourceWidth = pixelSize?.width ?? strip.width;
    const sourceHeight = pixelSize?.height ?? strip.height;
    const aspect = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 4.2;
    const naturalHeight = previewWidth / aspect;
    const chrome =
      titleHeight + buttonsHeight + TITLE_MARGIN + BUTTON_MARGIN + VERTICAL_PADDING;
    const remainingHeight = containerHeight > chrome ? containerHeight - chrome : 0;
    const maxHeight = Math.max(MIN_PREVIEW_HEIGHT, remainingHeight);
    return Math.min(naturalHeight, maxHeight);
  }, [
    buttonsHeight,
    containerHeight,
    previewWidth,
    pixelSize?.height,
    pixelSize?.width,
    strip.height,
    strip.width,
    titleHeight,
  ]);

  const handleContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainerWidth(width);
    setContainerHeight(height);
  }, []);

  const handleTitleLayout = useCallback((event: LayoutChangeEvent) => {
    setTitleHeight(event.nativeEvent.layout.height);
  }, []);

  const handleButtonsLayout = useCallback((event: LayoutChangeEvent) => {
    setButtonsHeight(event.nativeEvent.layout.height);
  }, []);

  const canAddCut = ratios.length < MAX_CUTS && largestGapMidpoint(ratios) !== null;
  const canDeleteCut = ratios.length > 1;
  const overlapBandHeight = overlapRatio * displayHeight;
  const canDecreaseOverlap = overlapRatio > MIN_SPLIT_OVERLAP_RATIO;
  const canIncreaseOverlap = overlapRatio < MAX_SPLIT_OVERLAP_RATIO;

  const updateRatios = useCallback((nextRatios: number[], nextSelectedIndex: number) => {
    const sorted = sortRatios(nextRatios);
    ratiosRef.current = sorted;
    selectedIndexRef.current = nextSelectedIndex;
    setRatios(sorted);
    setSelectedIndex(nextSelectedIndex);
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          dragIndexRef.current = null;
          const current = ratiosRef.current;
          if (current.length === 0 || displayHeight <= 0) {
            return;
          }

          const y = event.nativeEvent.locationY;
          const closest = closestCutIndex(current, y, displayHeight);
          const lineY = current[closest] * displayHeight;
          // Only drag a line the touch actually landed on, otherwise a touch
          // anywhere in the preview would yank the selected line to the finger.
          if (Math.abs(lineY - y) > SELECT_THRESHOLD_PX) {
            return;
          }

          // Keep the grab point on the line so it does not jump on first move.
          dragIndexRef.current = closest;
          dragOffsetRef.current = lineY - y;
          selectedIndexRef.current = closest;
          setSelectedIndex(closest);
        },
        onPanResponderMove: (event) => {
          const index = dragIndexRef.current;
          if (index === null || displayHeight <= 0) {
            return;
          }

          const current = ratiosRef.current;
          const y = event.nativeEvent.locationY + dragOffsetRef.current;
          const nextRatio = clampRatioBetweenNeighbors(current, index, y / displayHeight);
          const nextRatios = [...current];
          nextRatios[index] = nextRatio;
          // Clamping keeps the line between its neighbours, so the order holds.
          updateRatios(nextRatios, index);
        },
        onPanResponderRelease: () => {
          dragIndexRef.current = null;
        },
        onPanResponderTerminate: () => {
          dragIndexRef.current = null;
        },
      }),
    [displayHeight, updateRatios]
  );

  const handleAddCut = () => {
    const midpoint = largestGapMidpoint(ratios);
    if (midpoint === null || ratios.length >= MAX_CUTS) {
      return;
    }
    const nextRatios = sortRatios([...ratios, midpoint]);
    const newIndex = nextRatios.indexOf(midpoint);
    updateRatios(nextRatios, newIndex);
  };

  const handleDeleteCut = () => {
    if (ratios.length <= 1) {
      return;
    }
    const nextRatios = ratios.filter((_, index) => index !== selectedIndex);
    const nextSelected = Math.min(selectedIndex, nextRatios.length - 1);
    updateRatios(nextRatios, nextSelected);
  };

  const handleDecreaseOverlap = () => {
    updateOverlapRatio(Math.max(MIN_SPLIT_OVERLAP_RATIO, Math.round(overlapRatio * 100 - 1) / 100));
  };

  const handleIncreaseOverlap = () => {
    updateOverlapRatio(Math.min(MAX_SPLIT_OVERLAP_RATIO, Math.round(overlapRatio * 100 + 1) / 100));
  };

  const handleConfirm = async () => {
    setWorking(true);
    try {
      void rememberOverlapRatio(overlapRatio);
      await onConfirm(sortRatios(ratiosRef.current), overlapRatio);
    } catch {
      // Parent shows the error banner; keep overlay open for retry or cancel.
    } finally {
      setWorking(false);
    }
  };

  return (
    <View className="absolute inset-0 z-20 overflow-hidden" style={{ backgroundColor: colors.background }}>
      <View className="flex-1 px-4 py-3" onLayout={handleContainerLayout}>
        <Text
          onLayout={handleTitleLayout}
          className="mb-3 text-center text-base font-medium"
          style={{ color: colors.text }}
        >
          Split
        </Text>

        <View
          style={{ width: previewWidth, height: displayHeight, alignSelf: "center" }}
          className={`overflow-hidden rounded-lg ${inverted ? "bg-black" : "bg-white"}`}
          {...panResponder.panHandlers}
        >
          {/* Non-touchable so drag coordinates stay relative to this container
              instead of whichever child image the finger landed on. */}
          <View pointerEvents="none">
            {stacked ? (
              <StackedStripImages
                parts={parts}
                width={previewWidth}
                height={displayHeight}
                inverted={inverted}
              />
            ) : (
              <ClippedStripImage
                uri={strip.uri}
                width={previewWidth}
                height={displayHeight}
                hideBottomOverlapPx={0}
                sourceHeight={strip.height}
                inverted={inverted}
              />
            )}
          </View>
          {overlapRatio > 0 &&
            ratios.map((ratio, index) => {
              const lineY = ratio * displayHeight;
              const bandTop = Math.max(0, lineY - overlapBandHeight / 2);
              const bandBottom = Math.min(displayHeight, lineY + overlapBandHeight / 2);
              const selected = index === selectedIndex;
              return (
                <View
                  key={`overlap-${index}`}
                  pointerEvents="none"
                  className="absolute left-0 right-0"
                  style={{
                    top: bandTop,
                    height: Math.max(0, bandBottom - bandTop),
                    backgroundColor: colorWithAlpha(colors.text, selected ? 0.45 : 0.3),
                  }}
                />
              );
            })}
          {ratios.map((ratio, index) => {
            const lineY = ratio * displayHeight;
            const selected = index === selectedIndex;
            const lineHeight = selected ? 1.5 : 1;
            return (
              <View
                key={`cut-${index}`}
                pointerEvents="none"
                className="absolute left-0 right-0"
                style={{
                  top: lineY - lineHeight / 2,
                  height: lineHeight,
                  backgroundColor: colorWithAlpha(colors.text, selected ? 0.75 : 0.45),
                }}
              />
            );
          })}
        </View>

        <View onLayout={handleButtonsLayout} className="mt-4 w-full">
          <View className="mb-3 items-center">
            <Text className="text-center text-sm font-medium" style={{ color: colors.text }}>
              Overlap
            </Text>
            <View className="mt-2 flex-row items-center gap-3">
              <IconButton
                icon={Minus}
                label="Decrease overlap"
                iconColor={colors.text}
                onPress={handleDecreaseOverlap}
                disabled={working || !canDecreaseOverlap}
                className="h-9 w-9 min-h-9 min-w-9"
                style={{ backgroundColor: colors.control, borderColor: colors.border }}
              />
              <Text
                className="min-w-16 text-center text-sm font-semibold"
                style={{ color: colors.text }}
              >
                {overlapLabel(overlapRatio)}
              </Text>
              <IconButton
                icon={Plus}
                label="Increase overlap"
                iconColor={colors.text}
                onPress={handleIncreaseOverlap}
                disabled={working || !canIncreaseOverlap}
                className="h-9 w-9 min-h-9 min-w-9"
                style={{ backgroundColor: colors.control, borderColor: colors.border }}
              />
            </View>
          </View>

          <View className="w-full flex-row flex-wrap justify-center gap-2">
            <IconButton
              icon={Scissors}
              label="Add cut line"
              iconColor={colors.text}
              onPress={handleAddCut}
              disabled={working || !canAddCut}
              style={{ backgroundColor: colors.control, borderColor: colors.border }}
            />
            <IconButton
              icon={Trash2}
              label="Delete cut line"
              iconColor={colors.text}
              onPress={handleDeleteCut}
              disabled={working || !canDeleteCut}
              style={{ backgroundColor: colors.control, borderColor: colors.border }}
            />
            <IconButton
              icon={X}
              label="Cancel split"
              iconColor={colors.text}
              onPress={onCancel}
              disabled={working}
              style={{ backgroundColor: colors.control, borderColor: colors.border }}
            />
            <Pressable
              onPress={() => void handleConfirm()}
              disabled={working}
              accessibilityLabel="Apply cuts"
              accessibilityRole="button"
              className="min-h-11 min-w-11 items-center justify-center rounded-xl px-4"
              style={{ backgroundColor: colors.controlActive }}
            >
              {working ? (
                <ActivityIndicator color={colors.controlActiveText} />
              ) : (
                <Scissors size={22} color={colors.controlActiveText} strokeWidth={2} />
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}
