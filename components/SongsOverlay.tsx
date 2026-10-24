import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PencilLine, Trash2, X } from "lucide-react-native";

import { ActionSheet } from "./ActionSheet";
import { IconButton } from "./IconButton";
import { Toolbar } from "./Toolbar";
import type { Song } from "../lib/songs";
import { useTheme } from "../lib/theme";

type SongsOverlayProps = {
  songs: { song: Song; startIndex: number }[];
  currentSongId: string | null;
  onJump: (songId: string) => void;
  onMarkSong: () => void;
  onRename: (song: Song) => void;
  onRemove: (songId: string) => void;
  onClose: () => void;
};

/** A book's songs: tap to jump, long-press to rename or remove. */
export function SongsOverlay({
  songs,
  currentSongId,
  onJump,
  onMarkSong,
  onRename,
  onRemove,
  onClose,
}: SongsOverlayProps) {
  const { colors } = useTheme();
  const [actionSong, setActionSong] = useState<Song | null>(null);

  return (
    <View className="absolute inset-0 z-20" style={{ backgroundColor: colors.background }}>
      <SafeAreaView className="flex-1">
        <Toolbar
          title="Songs"
          subtitle={`${songs.length} ${songs.length === 1 ? "song" : "songs"}`}
          left={
            <IconButton
              icon={X}
              label="Close songs"
              variant="sm"
              ghost
              iconColor={colors.text}
              onPress={onClose}
            />
          }
          right={
            <Pressable
              onPress={onMarkSong}
              accessibilityRole="button"
              accessibilityLabel="Mark a song starting at the top of the screen"
              hitSlop={8}
              className="mx-1 h-8 items-center justify-center rounded-full px-3"
              style={{ backgroundColor: colors.controlActive }}
            >
              <Text className="text-sm font-semibold" style={{ color: colors.controlActiveText }}>
                Mark here
              </Text>
            </Pressable>
          }
        />
        <FlatList
          data={songs}
          keyExtractor={({ song }) => song.id}
          ListEmptyComponent={
            <Text className="px-6 py-8 text-center text-sm" style={{ color: colors.textMuted }}>
              No songs yet. Close this list, turn to where a piece starts, then come back and tap
              Mark here.
            </Text>
          }
          renderItem={({ item: { song } }) => {
            const current = song.id === currentSongId;
            return (
              <Pressable
                onPress={() => onJump(song.id)}
                onLongPress={() => setActionSong(song)}
                delayLongPress={250}
                accessibilityRole="button"
                className="flex-row items-center gap-3 border-b px-4 py-3"
                style={{
                  borderBottomColor: colors.border,
                  backgroundColor: current ? colors.control : undefined,
                }}
              >
                <View
                  className="h-full w-1 rounded-full"
                  style={{ backgroundColor: current ? colors.controlActive : "transparent" }}
                />
                <Text
                  className={`min-w-0 flex-1 text-base ${current ? "font-semibold" : ""}`}
                  style={{ color: colors.text }}
                  numberOfLines={1}
                >
                  {song.title}
                </Text>
                <Text className="text-xs" style={{ color: colors.textMuted }}>
                  p. {song.start.pageIndex + 1}
                </Text>
              </Pressable>
            );
          }}
        />
      </SafeAreaView>

      {actionSong && (
        <ActionSheet
          title={actionSong.title}
          items={[
            { label: "Rename", icon: PencilLine, onPress: () => onRename(actionSong) },
            {
              label: "Remove song mark",
              icon: Trash2,
              destructive: true,
              onPress: () => onRemove(actionSong.id),
            },
          ]}
          onClose={() => setActionSong(null)}
        />
      )}
    </View>
  );
}
