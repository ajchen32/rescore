import { View } from "react-native";
import { ArrowUp, Scissors, Trash2 } from "lucide-react-native";

import { ClippedStripImage, StackedStripImages } from "./StripStack";
import { IconButton } from "./IconButton";
import { colorWithAlpha, useTheme } from "../lib/theme";

import {
  flattenParts,
  PAGE_BREAK_EXTRA_HEIGHT,
  type HorizontalInsets,
  type ReaderStrip,
} from "../lib/corrections";

type StripRowProps = {
  strip: ReaderStrip;
  width: number;
  height: number;
  hideBottomOverlapPx?: number;
  insets?: HorizontalInsets;
  extraPageBreakSpacing?: boolean;
  editing?: boolean;
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
          className="absolute right-2 top-2 z-10 flex-row items-center gap-1 rounded-xl p-1"
          style={{ backgroundColor: colorWithAlpha(colors.text, 0.85) }}
        >
          <IconButton
            icon={ArrowUp}
            label="Merge with system above"
            variant="sm"
            ghost
            iconColor={globalIndex === 0 ? colors.textMuted : colors.background}
            onPress={onMergeUp}
            disabled={globalIndex === 0}
          />
          <IconButton
            icon={Scissors}
            label="Split system"
            variant="sm"
            ghost
            iconColor={splitAvailable ? colors.background : colors.textMuted}
            onPress={onSplit}
            disabled={!splitAvailable}
          />
          <IconButton
            icon={Trash2}
            label="Delete system"
            variant="sm"
            ghost
            iconColor={canDelete ? colors.destructive : colors.textMuted}
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
