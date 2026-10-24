import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PencilLine, Trash2, X } from "lucide-react-native";

import { ActionSheet } from "./ActionSheet";
import { IconButton } from "./IconButton";
import { Toolbar } from "./Toolbar";
import type { Bookmark } from "../lib/bookmarks";
import { useTheme } from "../lib/theme";

type BookmarksOverlayProps = {
  bookmarks: { bookmark: Bookmark; startIndex: number }[];
  currentBookmarkId: string | null;
  onJump: (bookmarkId: string) => void;
  onRename: (bookmark: Bookmark) => void;
  onRemove: (bookmarkId: string) => void;
  onClose: () => void;
};

/** A score's bookmarks: tap to jump, long-press to rename or remove. */
export function BookmarksOverlay({
  bookmarks,
  currentBookmarkId,
  onJump,
  onRename,
  onRemove,
  onClose,
}: BookmarksOverlayProps) {
  const { colors } = useTheme();
  const [actionBookmark, setActionBookmark] = useState<Bookmark | null>(null);

  return (
    <View className="absolute inset-0 z-20" style={{ backgroundColor: colors.background }}>
      <SafeAreaView className="flex-1">
        <Toolbar
          title="Bookmarks"
          subtitle={`${bookmarks.length} ${bookmarks.length === 1 ? "bookmark" : "bookmarks"}`}
          left={
            <IconButton
              icon={X}
              label="Close bookmarks"
              variant="sm"
              ghost
              iconColor={colors.text}
              onPress={onClose}
            />
          }
        />
        <FlatList
          data={bookmarks}
          keyExtractor={({ bookmark }) => bookmark.id}
          ListEmptyComponent={
            <Text className="px-6 py-8 text-center text-sm" style={{ color: colors.textMuted }}>
              No bookmarks yet. Tap Edit, then the bookmark button on the system where one should
              start.
            </Text>
          }
          renderItem={({ item: { bookmark } }) => {
            const current = bookmark.id === currentBookmarkId;
            return (
              <Pressable
                onPress={() => onJump(bookmark.id)}
                onLongPress={() => setActionBookmark(bookmark)}
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
                  {bookmark.title}
                </Text>
                <Text className="text-xs" style={{ color: colors.textMuted }}>
                  p. {bookmark.start.pageIndex + 1}
                </Text>
              </Pressable>
            );
          }}
        />
      </SafeAreaView>

      {actionBookmark && (
        <ActionSheet
          title={actionBookmark.title}
          items={[
            { label: "Rename", icon: PencilLine, onPress: () => onRename(actionBookmark) },
            {
              label: "Remove bookmark",
              icon: Trash2,
              destructive: true,
              onPress: () => onRemove(actionBookmark.id),
            },
          ]}
          onClose={() => setActionBookmark(null)}
        />
      )}
    </View>
  );
}
