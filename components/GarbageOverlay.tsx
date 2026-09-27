import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RotateCcw, X } from "lucide-react-native";

import type { ReaderStrip } from "../lib/corrections";
import { IconButton } from "./IconButton";
import { MusicImage } from "./MusicImage";
import { useTheme } from "../lib/theme";

type GarbageOverlayProps = {
  garbage: ReaderStrip[];
  inverted?: boolean;
  onRestore: (index: number) => void;
  onClose: () => void;
};

export function GarbageOverlay({
  garbage,
  inverted = false,
  onRestore,
  onClose,
}: GarbageOverlayProps) {
  const { colors } = useTheme();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const previewWidth = Math.max(120, viewportWidth - 48);
  const maxPreviewHeight = Math.max(120, viewportHeight * 0.35);

  return (
    <View className="absolute inset-0 z-20" style={{ backgroundColor: colors.background }}>
      <SafeAreaView className="flex-1">
        <View
          className="flex-row items-center justify-between border-b px-4 py-3"
          style={{ borderBottomColor: colors.border }}
        >
          <Text className="text-base font-semibold" style={{ color: colors.text }}>
            Garbage ({garbage.length})
          </Text>
          <IconButton
            icon={X}
            label="Close garbage"
            iconColor={colors.text}
            onPress={onClose}
            style={{ backgroundColor: colors.control, borderColor: colors.border }}
          />
        </View>

        {garbage.length === 0 ? (
          <View className="flex-1 items-center justify-center px-6">
            <Text className="text-center text-sm" style={{ color: colors.textMuted }}>
              Nothing removed yet.
            </Text>
          </View>
        ) : (
          <ScrollView className="flex-1 px-4 py-4" contentContainerStyle={{ gap: 16 }}>
            {garbage.map((piece, index) => {
              const aspectRatio = piece.width > 0 ? piece.width / piece.height : 1;
              const previewHeight = Math.min(maxPreviewHeight, previewWidth / aspectRatio);

              return (
                <View
                  key={piece.id}
                  className="rounded-xl border p-3"
                  style={{
                    borderColor: colors.border,
                    backgroundColor: colors.surfaceElevated,
                  }}
                >
                  <View className="mb-3 flex-row items-center justify-between gap-3">
                    <Text className="text-sm" style={{ color: colors.textMuted }}>
                      p. {piece.pageIndex + 1}
                    </Text>
                    <IconButton
                      icon={RotateCcw}
                      label="Restore to score"
                      iconColor={colors.controlActiveText}
                      onPress={() => onRestore(index)}
                      style={{ backgroundColor: colors.controlActive, borderColor: colors.border }}
                    />
                  </View>
                  <MusicImage
                    source={{ uri: piece.uri }}
                    style={{
                      width: previewWidth,
                      height: previewHeight,
                      alignSelf: "center",
                    }}
                    contentFit="contain"
                    recyclingKey={piece.uri}
                    inverted={inverted}
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
