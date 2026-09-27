import { View } from "react-native";
import { ArrowUp, Scissors, Trash2 } from "lucide-react-native";

import { ClippedStripImage, StackedStripImages } from "./StripStack";
import { IconButton } from "./IconButton";
import { colorWithAlpha, useTheme } from "../lib/theme";

import {
  flattenParts,
  PAGE_BREAK_EXTRA_HEIGHT,
  type ReaderStrip,
} from "../lib/corrections";

type StripRowProps = {
  strip: ReaderStrip;
  width: number;
  height: number;
  hideBottomOverlapPx?: number;
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
          className="absolute left-0 right-0 top-0 z-10 flex-row items-center justify-between px-1 py-1"
          style={{ backgroundColor: colorWithAlpha(colors.text, 0.85) }}
        >
          <IconButton
            icon={ArrowUp}
            label="Merge with system above"
            iconColor={globalIndex === 0 ? colors.textMuted : colors.background}
            onPress={onMergeUp}
            disabled={globalIndex === 0}
            className="min-h-10 min-w-10"
          />
          <IconButton
            icon={Scissors}
            label="Split system"
            iconColor={splitAvailable ? colors.background : colors.textMuted}
            onPress={onSplit}
            disabled={!splitAvailable}
            className="min-h-10 min-w-10"
          />
          <IconButton
            icon={Trash2}
            label="Delete system"
            iconColor={canDelete ? colors.destructive : colors.textMuted}
            onPress={onDelete}
            disabled={!canDelete}
            className="min-h-10 min-w-10"
          />
        </View>
      )}

      {parts.length > 1 ? (
        <StackedStripImages
          parts={parts}
          width={width}
          height={contentHeight}
          hideBottomOverlapPx={hideBottomOverlapPx}
          inverted={inverted}
        />
      ) : (
        <ClippedStripImage
          uri={strip.uri}
          width={width}
          height={contentHeight}
          hideBottomOverlapPx={hideBottomOverlapPx}
          sourceHeight={strip.height}
          inverted={inverted}
        />
      )}
    </View>
  );
}
