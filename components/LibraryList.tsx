import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, FlatList, Pressable, Text, TextInput, View } from "react-native";

import { SaveNameOverlay } from "./SaveNameOverlay";
import { errorFromUnknown } from "../lib/errors";
import {
  deleteScore,
  formatScoreDate,
  loadLibrary,
  renameScore,
  type SavedScore,
} from "../lib/library";
import { useTheme } from "../lib/theme";

const LONG_PRESS_DELAY_MS = 250;
// Below this many scores the list fits on screen and a search field is clutter.
const SEARCH_MIN_SCORES = 8;

type LibraryListProps = {
  // Change to reload the list (e.g. after closing a score that was just saved).
  refreshKey: number;
  onOpen: (scoreId: string) => void;
  onError: (message: string) => void;
  // Shown under the empty state.
  emptyAction?: ReactNode;
};

export function LibraryList({ refreshKey, onOpen, onError, emptyAction }: LibraryListProps) {
  const { colors } = useTheme();
  const [scores, setScores] = useState<SavedScore[] | null>(null);
  const [renameTarget, setRenameTarget] = useState<SavedScore | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadLibrary()
      .then((library) => {
        if (!cancelled) {
          setScores(library.scores);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setScores([]);
          onError(errorFromUnknown(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onError, refreshKey]);

  const filteredScores = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!scores || needle.length === 0) {
      return scores ?? [];
    }
    return scores.filter((score) => score.title.toLowerCase().includes(needle));
  }, [query, scores]);

  const handleDelete = useCallback(
    async (score: SavedScore) => {
      try {
        await deleteScore(score.id);
        setScores((current) => (current ?? []).filter((entry) => entry.id !== score.id));
      } catch (error) {
        onError(errorFromUnknown(error));
      }
    },
    [onError]
  );

  const showActions = useCallback(
    (score: SavedScore) => {
      Alert.alert(score.title, undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Rename", onPress: () => setRenameTarget(score) },
        {
          text: "Delete",
          style: "destructive",
          onPress: () =>
            Alert.alert(`Delete "${score.title}"?`, "This can't be undone.", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => void handleDelete(score) },
            ]),
        },
      ]);
    },
    [handleDelete]
  );

  const handleRenameConfirm = useCallback(
    async (title: string) => {
      if (!renameTarget) {
        return;
      }
      setRenaming(true);
      try {
        const updated = await renameScore(renameTarget.id, title);
        setScores((current) =>
          (current ?? []).map((score) => (score.id === updated.id ? updated : score))
        );
        setRenameTarget(null);
      } catch (error) {
        onError(errorFromUnknown(error));
      } finally {
        setRenaming(false);
      }
    },
    [onError, renameTarget]
  );

  if (scores === null) {
    return <View className="flex-1" />;
  }

  return (
    <View className="flex-1">
      {scores.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-4 px-6">
          <Text className="text-center text-base" style={{ color: colors.textMuted }}>
            Import a PDF or photos of sheet music to start.
          </Text>
          {emptyAction}
        </View>
      ) : (
        <>
          {scores.length >= SEARCH_MIN_SCORES && (
            <View className="px-3 py-2">
              <TextInput
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                className="rounded-lg border px-3 py-2 text-base"
                style={{
                  borderColor: colors.border,
                  backgroundColor: colors.surfaceElevated,
                  color: colors.text,
                }}
                placeholder="Search"
                placeholderTextColor={colors.textMuted}
              />
            </View>
          )}
          <FlatList
            data={filteredScores}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <Text className="px-4 py-6 text-center text-base" style={{ color: colors.textMuted }}>
                No matching scores.
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => onOpen(item.id)}
                onLongPress={() => showActions(item)}
                delayLongPress={LONG_PRESS_DELAY_MS}
                className="border-b px-4 py-2.5"
                style={{ borderBottomColor: colors.border }}
              >
                <Text className="text-base font-medium" style={{ color: colors.text }} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text className="text-xs" style={{ color: colors.textMuted }}>
                  {formatScoreDate(item.createdAt)} · {item.stripCount}{" "}
                  {item.stripCount === 1 ? "system" : "systems"}
                </Text>
              </Pressable>
            )}
          />
        </>
      )}

      {renameTarget && (
        <SaveNameOverlay
          initialTitle={renameTarget.title}
          saving={renaming}
          heading="Rename"
          cancelAccessibilityLabel="Cancel rename"
          confirmAccessibilityLabel={renaming ? "Renaming" : "Rename"}
          onCancel={() => {
            if (!renaming) {
              setRenameTarget(null);
            }
          }}
          onConfirm={(title) => void handleRenameConfirm(title)}
        />
      )}
    </View>
  );
}
