import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RotateCcw, X } from "lucide-react-native";

import type { ReaderStrip } from "../lib/corrections";
import { IconButton } from "./IconButton";
import { MusicImage } from "./MusicImage";
import { Toolbar } from "./Toolbar";
import { colorWithAlpha, useTheme } from "../lib/theme";

type GarbageOverlayProps = {
  garbage: ReaderStrip[];
  inverted?: boolean;
  onRestore: (index: number) => void;
  onClose: () => void;
};

const LIST_PADDING = 8;
const LIST_GAP = 8;
// Two columns once each would still be at least this wide.
const MIN_TWO_COLUMN_WIDTH = 360;
// Room for the page label and restore button drawn over the image; thinner
// strips (a page number, one line of text) are centred inside this.
const MIN_PREVIEW_HEIGHT = 52;

export function GarbageOverlay({
  garbage,
  inverted = false,
  onRestore,
  onClose,
}: GarbageOverlayProps) {
  const { colors } = useTheme();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const columns = (viewportWidth - LIST_PADDING * 2 - LIST_GAP) / 2 >= MIN_TWO_COLUMN_WIDTH ? 2 : 1;
  const previewWidth = (viewportWidth - LIST_PADDING * 2 - LIST_GAP * (columns - 1)) / columns;
  const maxPreviewHeight = Math.max(120, viewportHeight * 0.35);

  return (
    <View className="absolute inset-0 z-20" style={{ backgroundColor: colors.background }}>
      <SafeAreaView className="flex-1">
        <Toolbar
          title="Removed systems"
          subtitle={garbage.length > 0 ? "Restore puts a system back where it was" : undefined}
          left={
            <IconButton
              icon={X}
              label="Close removed systems"
              variant="sm"
              ghost
              iconColor={colors.text}
              onPress={onClose}
            />
          }
        />

        {garbage.length === 0 ? (
          <View className="flex-1 items-center justify-center px-6">
            <Text className="text-center text-sm" style={{ color: colors.textMuted }}>
              Nothing removed yet.
            </Text>
          </View>
        ) : (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{
              padding: LIST_PADDING,
              gap: LIST_GAP,
              flexDirection: "row",
              flexWrap: "wrap",
            }}
          >
            {garbage.map((piece, index) => {
              const aspectRatio = piece.width > 0 ? piece.width / piece.height : 1;
              const previewHeight = Math.max(
                MIN_PREVIEW_HEIGHT,
                Math.min(maxPreviewHeight, previewWidth / aspectRatio)
              );

              return (
                <View
                  key={piece.id}
                  className="overflow-hidden rounded-lg border"
                  style={{
                    width: previewWidth,
                    borderColor: colors.border,
                    backgroundColor: inverted ? "#000000" : "#FFFFFF",
                  }}
                >
                  <MusicImage
                    source={{ uri: piece.uri }}
                    style={{ width: previewWidth, height: previewHeight }}
                    contentFit="contain"
                    recyclingKey={piece.uri}
                    inverted={inverted}
                  />
                  <View
                    className="absolute left-1 top-1 rounded px-1.5 py-0.5"
                    style={{ backgroundColor: colorWithAlpha(colors.surfaceElevated, 0.9) }}
                  >
                    <Text className="text-xs font-medium" style={{ color: colors.text }}>
                      p. {piece.pageIndex + 1}
                    </Text>
                  </View>
                  <IconButton
                    icon={RotateCcw}
                    label="Restore to score"
                    variant="sm"
                    iconColor={colors.controlActiveText}
                    onPress={() => onRestore(index)}
                    className="absolute right-1 top-1"
                    style={{ backgroundColor: colors.controlActive, borderColor: colors.controlActive }}
                  />
                </View>
              );
            })}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}
