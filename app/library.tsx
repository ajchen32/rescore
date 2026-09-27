import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Trash2 } from "lucide-react-native";

import { IconButton } from "../components/IconButton";
import { SaveNameOverlay } from "../components/SaveNameOverlay";
import { markScoreDeleted } from "../lib/discardedScores";
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

export default function LibraryScreen() {
  const { colors } = useTheme();
  const [scores, setScores] = useState<SavedScore[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<SavedScore | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [query, setQuery] = useState("");

  const filteredScores = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return scores;
    }
    return scores.filter((score) => score.title.toLowerCase().includes(needle));
  }, [query, scores]);

  const refreshLibrary = useCallback(async () => {
    try {
      const library = await loadLibrary();
      setScores(library.scores);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(errorFromUnknown(error));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshLibrary();
    }, [refreshLibrary])
  );

  const handleOpen = useCallback((scoreId: string) => {
    router.replace({
      pathname: "/",
      params: { scoreId },
    });
  }, []);

  const handleDelete = useCallback(async (scoreId: string) => {
    setDeletingId(scoreId);
    setErrorMessage(null);
    try {
      await deleteScore(scoreId);
      setScores((current) => current.filter((score) => score.id !== scoreId));
      markScoreDeleted(scoreId);
      router.setParams({ deletedScoreId: scoreId });
    } catch (error) {
      setErrorMessage(errorFromUnknown(error));
    } finally {
      setDeletingId(null);
    }
  }, []);

  const handleRenameRequest = useCallback((score: SavedScore) => {
    setErrorMessage(null);
    setRenameTarget(score);
  }, []);

  const handleRenameCancel = useCallback(() => {
    if (!renaming) {
      setRenameTarget(null);
    }
  }, [renaming]);

  const handleRenameConfirm = useCallback(
    async (title: string) => {
      if (!renameTarget) {
        return;
      }

      setRenaming(true);
      setErrorMessage(null);
      try {
        const updated = await renameScore(renameTarget.id, title);
        setScores((current) =>
          current.map((score) => (score.id === updated.id ? updated : score))
        );
        setRenameTarget(null);
      } catch (error) {
        setErrorMessage(errorFromUnknown(error));
      } finally {
        setRenaming(false);
      }
    },
    [renameTarget]
  );

  const renderItem = useCallback(
    ({ item }: { item: SavedScore }) => (
      <View
        className="flex-row items-center gap-3 border-b px-4 py-3"
        style={{ borderBottomColor: colors.border }}
      >
        <Pressable
          className="flex-1"
          onPress={() => handleOpen(item.id)}
          onLongPress={() => handleRenameRequest(item)}
          delayLongPress={LONG_PRESS_DELAY_MS}
        >
          <Text className="text-base font-semibold" style={{ color: colors.text }} numberOfLines={1}>
            {item.title}
          </Text>
          <Text className="mt-1 text-sm" style={{ color: colors.textMuted }}>
            {formatScoreDate(item.createdAt)} · {item.stripCount}
          </Text>
        </Pressable>
        <IconButton
          icon={Trash2}
          label={deletingId === item.id ? "Deleting" : "Delete score"}
          iconColor={deletingId === item.id ? colors.textMuted : colors.destructive}
          onPress={() => void handleDelete(item.id)}
          disabled={deletingId === item.id}
          style={{ backgroundColor: colors.control, borderColor: colors.border }}
        />
      </View>
    ),
    [colors, deletingId, handleDelete, handleOpen, handleRenameRequest]
  );

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }} edges={["bottom"]}>
      {errorMessage && (
        <View
          className="mx-4 mt-4 rounded-xl border px-4 py-3"
          style={{ borderColor: colors.border, backgroundColor: colors.surfaceElevated }}
        >
          <Text className="text-sm font-medium" style={{ color: colors.text }}>
            {errorMessage}
          </Text>
        </View>
      )}

      {scores.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-base" style={{ color: colors.textMuted }}>
            No saved scores yet.
          </Text>
        </View>
      ) : (
        <View className="flex-1">
          <View
            className="border-b px-4 py-3"
            style={{ borderBottomColor: colors.border, backgroundColor: colors.surfaceElevated }}
          >
            <TextInput
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              className="rounded-xl border px-4 py-3 text-base"
              style={{
                borderColor: colors.border,
                backgroundColor: colors.background,
                color: colors.text,
              }}
              placeholder="Search"
              placeholderTextColor={colors.textMuted}
            />
          </View>
          {filteredScores.length === 0 ? (
            <View className="flex-1 items-center justify-center px-6">
              <Text className="text-center text-base" style={{ color: colors.textMuted }}>
                No matching scores.
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredScores}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              style={{ backgroundColor: colors.surfaceElevated }}
            />
          )}
        </View>
      )}

      {renameTarget && (
        <SaveNameOverlay
          initialTitle={renameTarget.title}
          saving={renaming}
          heading="Rename"
          cancelAccessibilityLabel="Cancel rename"
          confirmAccessibilityLabel={renaming ? "Renaming" : "Rename"}
          onCancel={handleRenameCancel}
          onConfirm={(title) => void handleRenameConfirm(title)}
        />
      )}
    </SafeAreaView>
  );
}
