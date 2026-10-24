import { useState } from "react";
import { FlatList, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Check, X } from "lucide-react-native";

import { IconButton } from "./IconButton";
import { MusicImage } from "./MusicImage";
import { Toolbar } from "./Toolbar";
import type { ReaderStrip } from "../lib/corrections";
import { newSongId, songAnchor, type Song } from "../lib/songs";
import { colorWithAlpha, useTheme } from "../lib/theme";

const LIST_PADDING = 12;
const MAX_PREVIEW_HEIGHT = 140;

type Row = { startIndex: number; keep: boolean; title: string; renamed: boolean };

type SongReviewOverlayProps = {
  strips: ReaderStrip[];
  // Suggested song starts (strip indices), in reading order.
  starts: number[];
  inverted?: boolean;
  onConfirm: (songs: Song[]) => void;
  // Keep the import as one score, without songs.
  onSkip: () => void;
};

/** After importing a book: confirm, drop or name the suggested song starts. */
export function SongReviewOverlay({
  strips,
  starts,
  inverted = false,
  onConfirm,
  onSkip,
}: SongReviewOverlayProps) {
  const { colors } = useTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const [rows, setRows] = useState<Row[]>(() =>
    starts.map((startIndex, index) => ({
      startIndex,
      keep: true,
      title: `Song ${index + 1}`,
      renamed: false,
    }))
  );
  const keptCount = rows.filter((row) => row.keep).length;
  const previewWidth = viewportWidth - LIST_PADDING * 2;

  const update = (startIndex: number, change: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.startIndex === startIndex ? { ...row, ...change } : row))
    );

  const confirm = () => {
    // Names left as suggested are renumbered over the songs actually kept.
    let number = 0;
    const songs = rows
      .filter((row) => row.keep && strips[row.startIndex])
      .map((row): Song => {
        number += 1;
        const title = row.renamed && row.title.trim() ? row.title.trim() : `Song ${number}`;
        return { id: newSongId(), title, start: songAnchor(strips[row.startIndex]) };
      });
    onConfirm(songs);
  };

  return (
    <View className="absolute inset-0 z-30" style={{ backgroundColor: colors.background }}>
      <SafeAreaView className="flex-1">
        <Toolbar
          title="Songs found"
          subtitle="Keep the ones where a new piece starts"
          left={
            <IconButton
              icon={X}
              label="Keep as one score"
              variant="sm"
              ghost
              iconColor={colors.text}
              onPress={onSkip}
            />
          }
          right={
            <Pressable
              onPress={confirm}
              disabled={keptCount === 0}
              accessibilityRole="button"
              accessibilityLabel={`Save ${keptCount} songs`}
              className={`mx-1 h-8 items-center justify-center rounded-full px-3 ${keptCount === 0 ? "opacity-40" : ""}`}
              style={{ backgroundColor: colors.controlActive }}
            >
              <Text className="text-sm font-semibold" style={{ color: colors.controlActiveText }}>
                Save {keptCount} {keptCount === 1 ? "song" : "songs"}
              </Text>
            </Pressable>
          }
        />
        <FlatList
          data={rows}
          keyExtractor={(row) => String(row.startIndex)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: LIST_PADDING, gap: LIST_PADDING }}
          renderItem={({ item: row }) => {
            const strip = strips[row.startIndex];
            if (!strip) {
              return null;
            }
            const aspect = strip.width > 0 ? strip.width / strip.height : 1;
            const previewHeight = Math.min(MAX_PREVIEW_HEIGHT, previewWidth / aspect);
            return (
              <View
                className={`overflow-hidden rounded-xl border ${row.keep ? "" : "opacity-50"}`}
                style={{ borderColor: colors.border, backgroundColor: colors.surfaceElevated }}
              >
                <Pressable
                  onPress={() => update(row.startIndex, { keep: !row.keep })}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: row.keep }}
                  accessibilityLabel={`Song starting on page ${strip.pageIndex + 1}`}
                  style={{ backgroundColor: inverted ? "#000000" : "#FFFFFF" }}
                >
                  <MusicImage
                    source={{ uri: strip.uri }}
                    style={{ width: previewWidth, height: previewHeight }}
                    contentFit="contain"
                    contentPosition="top"
                    recyclingKey={strip.uri}
                    inverted={inverted}
                  />
                  <View
                    className="absolute left-2 top-2 rounded px-1.5 py-0.5"
                    style={{ backgroundColor: colorWithAlpha(colors.surfaceElevated, 0.9) }}
                  >
                    <Text className="text-xs font-medium" style={{ color: colors.text }}>
                      p. {strip.pageIndex + 1}
                    </Text>
                  </View>
                  <View
                    className="absolute right-2 top-2 h-7 w-7 items-center justify-center rounded-full border"
                    style={{
                      backgroundColor: row.keep ? colors.controlActive : colors.surfaceElevated,
                      borderColor: row.keep ? colors.controlActive : colors.border,
                    }}
                  >
                    {row.keep && <Check size={16} color={colors.controlActiveText} strokeWidth={3} />}
                  </View>
                </Pressable>
                <TextInput
                  value={row.title}
                  onChangeText={(title) => update(row.startIndex, { title, renamed: true })}
                  editable={row.keep}
                  selectTextOnFocus
                  autoCorrect={false}
                  placeholder="Song name"
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel="Song name"
                  className="px-3 py-2 text-base"
                  style={{ color: colors.text }}
                />
              </View>
            );
          }}
        />
      </SafeAreaView>
    </View>
  );
}
