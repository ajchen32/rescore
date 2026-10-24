import { Pressable, Text, View } from "react-native";
import { ArrowUpToLine, Bookmark as BookmarkIcon, Scissors, Trash2 } from "lucide-react-native";

import { ClippedStripImage, StackedStripImages } from "./StripStack";
import { IconButton } from "./IconButton";
import type { Bookmark } from "../lib/bookmarks";
import { colorWithAlpha, useTheme } from "../lib/theme";

import {
  flattenParts,
  PAGE_BREAK_EXTRA_HEIGHT,
  type HorizontalInsets,
  type ReaderStrip,
} from "../lib/corrections";

const CONTROLS_MARGIN = 8;
// Leaves room for the edit controls on the right of the bookmark tag.
const TAG_MAX_WIDTH_RATIO = 0.5;

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
  // The bookmark starting at this system, if any.
  bookmark?: Bookmark | null;
  onToggleBookmark?: () => void;
  onRenameBookmark?: () => void;
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
  bookmark = null,
  onToggleBookmark,
  onRenameBookmark,
  onMergeUp,
  onSplit,
  onDelete,
}: StripRowProps) {
  const { colors } = useTheme();
  const contentHeight = extraPageBreakSpacing
    ? Math.max(0, height - PAGE_BREAK_EXTRA_HEIGHT)
    : height;
  const parts = flattenParts(strip);
  // Floating pills (edit controls, bookmark tag) over the music.
  const pillStyle = {
    backgroundColor: colorWithAlpha(colors.surfaceElevated, 0.96),
    borderColor: colors.border,
    elevation: 6,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  };
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
      {editing && bookmark && (
        <Pressable
          onPress={onRenameBookmark}
          accessibilityRole="button"
          accessibilityLabel={`Rename bookmark ${bookmark.title}`}
          className="absolute z-10 flex-row items-center gap-1 rounded-full border px-2.5 py-1.5"
          style={[
            pillStyle,
            { top: controlsTop, left: CONTROLS_MARGIN, maxWidth: width * TAG_MAX_WIDTH_RATIO },
          ]}
        >
          <BookmarkIcon
            size={14}
            color={colors.controlActive}
            fill={colors.controlActive}
            strokeWidth={2}
          />
          <Text className="text-sm font-semibold" style={{ color: colors.text }} numberOfLines={1}>
            {bookmark.title}
          </Text>
        </Pressable>
      )}

      {editing && (
        <View
          className="absolute z-10 flex-row items-center rounded-full border px-1 py-0.5"
          style={[pillStyle, { top: controlsTop, right: CONTROLS_MARGIN }]}
        >
          <Pressable
            onPress={onToggleBookmark}
            accessibilityRole="button"
            accessibilityLabel={bookmark ? "Remove bookmark" : "Add a bookmark here"}
            accessibilityState={{ selected: bookmark !== null }}
            hitSlop={4}
            className="h-9 w-9 items-center justify-center rounded-xl"
          >
            <BookmarkIcon
              size={20}
              color={bookmark ? colors.controlActive : colors.text}
              fill={bookmark ? colors.controlActive : "transparent"}
              strokeWidth={2}
            />
          </Pressable>
          <View className="mx-0.5 h-5 w-px" style={{ backgroundColor: colors.border }} />
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
