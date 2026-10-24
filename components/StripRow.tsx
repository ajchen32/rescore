import { View } from "react-native";
import { ArrowUpToLine, Scissors, Trash2 } from "lucide-react-native";

import { ClippedStripImage, StackedStripImages } from "./StripStack";
import { IconButton } from "./IconButton";
import { colorWithAlpha, useTheme } from "../lib/theme";

import {
  flattenParts,
  PAGE_BREAK_EXTRA_HEIGHT,
  type HorizontalInsets,
  type ReaderStrip,
} from "../lib/corrections";

const CONTROLS_MARGIN = 8;

type StripRowProps = {
  strip: ReaderStrip;
  width: number;
  height: number;
  hideBottomOverlapPx?: number;
  insets?: HorizontalInsets;
  extraPageBreakSpacing?: boolean;
  editing?: boolean;
  // Distance of the edit controls from the strip's top (moved down to clear the reader bar).
  controlsTop?: number;
  splitAvailable?: boolean;
  inverted?: boolean;
  globalIndex: number;
  canDelete: boolean;
  onMergeUp?: () => void;
  onSplit?: () => void;
  onDelete?: () => void;
};

export function StripRow({
  strip,
  width,
  height,
  hideBottomOverlapPx = 0,
  insets,
  extraPageBreakSpacing = false,
  editing = false,
  controlsTop = CONTROLS_MARGIN,
  splitAvailable = true,
  inverted = false,
  globalIndex,
  canDelete,
  onMergeUp,
  onSplit,
  onDelete,
}: StripRowProps) {
  const { colors } = useTheme();
  const contentHeight = extraPageBreakSpacing
    ? Math.max(0, height - PAGE_BREAK_EXTRA_HEIGHT)
    : height;
  const parts = flattenParts(strip);
  const imageLeft = (insets?.left ?? 0) * width;
  const imageWidth = width - imageLeft - (insets?.right ?? 0) * width;

  return (
    <View
      className={`w-full ${inverted ? "bg-black" : "bg-white"}`}
      style={{
        width,
        height,
        paddingBottom: extraPageBreakSpacing ? PAGE_BREAK_EXTRA_HEIGHT : 0,
      }}
    >
      {editing && (
        <View
          className="absolute z-10 flex-row items-center rounded-full border px-1 py-0.5"
          style={{
            top: controlsTop,
            right: CONTROLS_MARGIN,
            backgroundColor: colorWithAlpha(colors.surfaceElevated, 0.96),
            borderColor: colors.border,
            elevation: 6,
            shadowColor: "#000000",
            shadowOpacity: 0.18,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 },
          }}
        >
          {globalIndex > 0 && (
            <>
              <IconButton
                icon={ArrowUpToLine}
                label="Merge with system above"
                variant="sm"
                ghost
                iconColor={colors.text}
                onPress={onMergeUp}
              />
              <View className="mx-0.5 h-5 w-px" style={{ backgroundColor: colors.border }} />
            </>
          )}
          <IconButton
            icon={Scissors}
            label="Split system"
            variant="sm"
            ghost
            iconColor={colors.text}
            onPress={onSplit}
            disabled={!splitAvailable}
          />
          <IconButton
            icon={Trash2}
            label="Delete system"
            variant="sm"
            ghost
            iconColor={colors.destructive}
            onPress={onDelete}
            disabled={!canDelete}
          />
        </View>
      )}

      <View style={{ marginLeft: imageLeft, width: imageWidth, height: contentHeight }}>
        {parts.length > 1 ? (
          <StackedStripImages
            parts={parts}
            width={imageWidth}
            height={contentHeight}
            hideBottomOverlapPx={hideBottomOverlapPx}
            inverted={inverted}
          />
        ) : (
          <ClippedStripImage
            uri={strip.uri}
            width={imageWidth}
            height={contentHeight}
            hideBottomOverlapPx={hideBottomOverlapPx}
            sourceHeight={strip.height}
            inverted={inverted}
          />
        )}
      </View>
    </View>
  );
}
