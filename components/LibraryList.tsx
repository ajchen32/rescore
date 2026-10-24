import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Folder as FolderIcon,
  FolderInput,
  PencilLine,
  Trash2,
} from "lucide-react-native";

import { ActionSheet, type ActionSheetItem } from "./ActionSheet";
import { ConfirmDialog } from "./ConfirmDialog";
import { FolderPickerOverlay } from "./FolderPickerOverlay";
import { SaveNameOverlay } from "./SaveNameOverlay";
import { errorFromUnknown } from "../lib/errors";
import {
  canMoveFolder,
  childFolders,
  folderItemCount,
  folderPath,
  resolveParentId,
  type Folder,
} from "../lib/folders";
import {
  deleteFolder,
  deleteScore,
  formatScoreDate,
  loadLibrary,
  moveFolder,
  moveScore,
  renameFolder,
  renameScore,
  type Library,
  type SavedScore,
} from "../lib/library";
import type { Song } from "../lib/songs";
import { useTheme } from "../lib/theme";

const LONG_PRESS_DELAY_MS = 250;

type LibraryListProps = {
  // Change to reload the list (e.g. after closing a score that was just saved).
  refreshKey: number;
  // Search text from the home toolbar; searches the whole library by name.
  query: string;
  // Folder ids from the root to the open folder; empty at the library root.
  folderPath: string[];
  onNavigate: (folderPath: string[]) => void;
  // Opens a score, at a song when one is given.
  onOpen: (scoreId: string, songId?: string) => void;
  onError: (message: string) => void;
  // Shown under the empty state.
  emptyAction?: ReactNode;
};

type Row =
  | { kind: "folder"; folder: Folder; location?: string }
  | { kind: "score"; score: SavedScore; location?: string }
  | { kind: "song"; score: SavedScore; song: Song; location?: string };

type Target = { kind: "folder"; folder: Folder } | { kind: "score"; score: SavedScore };

function targetName(target: Target): string {
  return target.kind === "folder" ? target.folder.name : target.score.title;
}

export function LibraryList({
  refreshKey,
  query,
  folderPath: openPath,
  onNavigate,
  onOpen,
  onError,
  emptyAction,
}: LibraryListProps) {
  const { colors } = useTheme();
  const [library, setLibrary] = useState<Library | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [actionTarget, setActionTarget] = useState<Target | null>(null);
  const [renameTarget, setRenameTarget] = useState<Target | null>(null);
  const [moveTarget, setMoveTarget] = useState<Target | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Target | null>(null);
  const [renaming, setRenaming] = useState(false);
  // Books whose song list is shown.
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void loadLibrary()
      .then((loaded) => {
        if (!cancelled) {
          setLibrary(loaded);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLibrary({ scores: [] });
          onError(errorFromUnknown(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onError, refreshKey, reloadCount]);

  const folders = useMemo(() => library?.folders ?? [], [library]);
  const scores = useMemo(() => library?.scores ?? [], [library]);
  const openFolderId = openPath.at(-1) ?? null;
  // The open folder's real path (it may have been moved or deleted meanwhile).
  const currentPath = useMemo(() => folderPath(folders, openFolderId), [folders, openFolderId]);
  const currentFolder = currentPath.at(-1) ?? null;
  const currentFolderId = currentFolder?.id ?? null;

  useEffect(() => {
    if (library === null) {
      return;
    }
    const actualPath = currentPath.map((folder) => folder.id);
    if (actualPath.join("/") !== openPath.join("/")) {
      onNavigate(actualPath);
    }
  }, [currentPath, library, onNavigate, openPath]);

  const locationOf = useCallback(
    (folderId: string | null | undefined) => {
      const path = folderPath(folders, resolveParentId(folders, folderId));
      return path.length > 0 ? path.map((folder) => folder.name).join(" › ") : "Library";
    },
    [folders]
  );

  const searching = query.trim().length > 0;
  const rows = useMemo<Row[]>(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length > 0) {
      return [
        ...folders
          .filter((folder) => folder.name.toLowerCase().includes(needle))
          .map((folder): Row => ({ kind: "folder", folder, location: locationOf(folder.parentId) })),
        ...scores
          .filter((score) => score.title.toLowerCase().includes(needle))
          .map((score): Row => ({ kind: "score", score, location: locationOf(score.folderId) })),
        ...scores.flatMap((score) =>
          (score.songs ?? [])
            .filter((song) => song.title.toLowerCase().includes(needle))
            .map((song): Row => ({ kind: "song", score, song, location: score.title }))
        ),
      ];
    }
    return [
      ...childFolders(folders, currentFolderId).map((folder): Row => ({ kind: "folder", folder })),
      ...scores
        .filter((score) => resolveParentId(folders, score.folderId) === currentFolderId)
        .flatMap((score): Row[] => [
          { kind: "score", score },
          ...(expandedBooks.has(score.id)
            ? (score.songs ?? []).map((song): Row => ({ kind: "song", score, song }))
            : []),
        ]),
    ];
  }, [currentFolderId, expandedBooks, folders, locationOf, query, scores]);

  const toggleBook = useCallback((scoreId: string) => {
    setExpandedBooks((current) => {
      const next = new Set(current);
      if (next.has(scoreId)) {
        next.delete(scoreId);
      } else {
        next.add(scoreId);
      }
      return next;
    });
  }, []);

  const reload = useCallback(() => setReloadCount((count) => count + 1), []);

  const runAndReload = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        onError(errorFromUnknown(error));
      }
      reload();
    },
    [onError, reload]
  );

  const handleDeleteConfirm = useCallback(() => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) {
      return;
    }
    void runAndReload(() =>
      target.kind === "score" ? deleteScore(target.score.id) : deleteFolder(target.folder.id)
    );
  }, [deleteTarget, runAndReload]);

  const cancelDelete = useCallback(() => setDeleteTarget(null), []);

  const actionItems = (target: Target): ActionSheetItem[] => [
    { label: "Rename", icon: PencilLine, onPress: () => setRenameTarget(target) },
    { label: "Move to…", icon: FolderInput, onPress: () => setMoveTarget(target) },
    {
      label: target.kind === "folder" ? "Delete folder" : "Delete",
      icon: Trash2,
      destructive: true,
      onPress: () => setDeleteTarget(target),
    },
  ];

  const handleRenameConfirm = useCallback(
    async (name: string) => {
      if (!renameTarget) {
        return;
      }
      setRenaming(true);
      try {
        if (renameTarget.kind === "score") {
          await renameScore(renameTarget.score.id, name);
        } else {
          await renameFolder(renameTarget.folder.id, name);
        }
        setRenameTarget(null);
        reload();
      } catch (error) {
        onError(errorFromUnknown(error));
      } finally {
        setRenaming(false);
      }
    },
    [onError, reload, renameTarget]
  );

  const handleMove = useCallback(
    (folderId: string | null) => {
      const target = moveTarget;
      setMoveTarget(null);
      if (!target) {
        return;
      }
      void runAndReload(() =>
        target.kind === "score"
          ? moveScore(target.score.id, folderId)
          : moveFolder(target.folder.id, folderId)
      );
    },
    [moveTarget, runAndReload]
  );

  if (library === null) {
    return <View className="flex-1" />;
  }

  const libraryEmpty = scores.length === 0 && folders.length === 0;

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === "folder") {
      const { folder } = item;
      const count = folderItemCount({ folders, items: scores }, folder.id);
      return (
        <Pressable
          onPress={() => onNavigate(folderPath(folders, folder.id).map((entry) => entry.id))}
          onLongPress={() => setActionTarget({ kind: "folder", folder })}
          delayLongPress={LONG_PRESS_DELAY_MS}
          className="flex-row items-center gap-3 border-b px-4 py-2.5"
          style={{ borderBottomColor: colors.border }}
        >
          <FolderIcon size={22} color={colors.controlActive} strokeWidth={2} />
          <View className="min-w-0 flex-1">
            <Text className="text-base font-medium" style={{ color: colors.text }} numberOfLines={1}>
              {folder.name}
            </Text>
            <Text className="text-xs" style={{ color: colors.textMuted }} numberOfLines={1}>
              {item.location ? `${item.location} · ` : ""}
              {count} {count === 1 ? "item" : "items"}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textMuted} strokeWidth={2} />
        </Pressable>
      );
    }

    if (item.kind === "song") {
      const { score, song } = item;
      return (
        <Pressable
          onPress={() => onOpen(score.id, song.id)}
          className="flex-row items-center gap-3 border-b py-2.5 pr-4"
          style={{
            borderBottomColor: colors.border,
            paddingLeft: item.location ? 16 : 40,
          }}
        >
          <View className="min-w-0 flex-1">
            <Text className="text-base" style={{ color: colors.text }} numberOfLines={1}>
              {song.title}
            </Text>
            {item.location && (
              <Text className="text-xs" style={{ color: colors.textMuted }} numberOfLines={1}>
                in {item.location}
              </Text>
            )}
          </View>
          <Text className="text-xs" style={{ color: colors.textMuted }}>
            p. {song.start.pageIndex + 1}
          </Text>
        </Pressable>
      );
    }

    const { score } = item;
    const songCount = score.songs?.length ?? 0;
    const expanded = expandedBooks.has(score.id);
    const Chevron = expanded ? ChevronDown : ChevronRight;
    return (
      <Pressable
        onPress={() => onOpen(score.id)}
        onLongPress={() => setActionTarget({ kind: "score", score })}
        delayLongPress={LONG_PRESS_DELAY_MS}
        className="flex-row items-center border-b py-2.5 pl-4 pr-2"
        style={{ borderBottomColor: colors.border }}
      >
        <View className="min-w-0 flex-1">
          <Text className="text-base font-medium" style={{ color: colors.text }} numberOfLines={1}>
            {score.title}
          </Text>
          <Text className="text-xs" style={{ color: colors.textMuted }} numberOfLines={1}>
            {item.location ? `${item.location} · ` : ""}
            {formatScoreDate(score.createdAt)} ·{" "}
            {songCount > 0
              ? `${songCount} ${songCount === 1 ? "song" : "songs"}`
              : `${score.stripCount} ${score.stripCount === 1 ? "system" : "systems"}`}
          </Text>
        </View>
        {songCount > 0 && !searching && (
          <Pressable
            onPress={() => toggleBook(score.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={expanded ? "Hide songs" : "Show songs"}
            className="h-9 w-9 items-center justify-center rounded-full"
          >
            <Chevron size={20} color={colors.textMuted} strokeWidth={2} />
          </Pressable>
        )}
      </Pressable>
    );
  };

  return (
    <View className="flex-1">
      {currentFolder && !searching && (
        <Pressable
          onPress={() => onNavigate(currentPath.slice(0, -1).map((folder) => folder.id))}
          accessibilityRole="button"
          accessibilityLabel={`Back to ${locationOf(currentFolder.parentId)}`}
          className="flex-row items-center gap-1 border-b px-2 py-2"
          style={{ borderBottomColor: colors.border, backgroundColor: colors.surfaceElevated }}
        >
          <ChevronLeft size={20} color={colors.text} strokeWidth={2} />
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold" style={{ color: colors.text }} numberOfLines={1}>
              {currentFolder.name}
            </Text>
            {currentPath.length > 1 && (
              <Text className="text-xs" style={{ color: colors.textMuted }} numberOfLines={1}>
                {locationOf(currentFolder.parentId)}
              </Text>
            )}
          </View>
        </Pressable>
      )}

      {libraryEmpty ? (
        <View className="flex-1 items-center justify-center gap-4 px-6">
          <Text className="text-center text-base" style={{ color: colors.textMuted }}>
            Import a PDF or photos of sheet music to start.
          </Text>
          {emptyAction}
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) =>
            item.kind === "folder"
              ? `f-${item.folder.id}`
              : item.kind === "song"
                ? `s-${item.score.id}-${item.song.id}`
                : item.score.id
          }
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text className="px-4 py-6 text-center text-base" style={{ color: colors.textMuted }}>
              {searching ? "No matching scores." : "This folder is empty."}
            </Text>
          }
          renderItem={renderRow}
        />
      )}

      {actionTarget && (
        <ActionSheet
          title={targetName(actionTarget)}
          items={actionItems(actionTarget)}
          onClose={() => setActionTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={
            deleteTarget.kind === "score"
              ? `Delete "${deleteTarget.score.title}"?`
              : `Delete folder "${deleteTarget.folder.name}"?`
          }
          message={
            deleteTarget.kind === "score"
              ? "This can't be undone."
              : `Its scores and folders move to ${locationOf(deleteTarget.folder.parentId)}.`
          }
          confirmLabel="Delete"
          destructive
          onConfirm={handleDeleteConfirm}
          onCancel={cancelDelete}
        />
      )}

      {moveTarget && (
        <FolderPickerOverlay
          title={`Move "${targetName(moveTarget)}"`}
          folders={folders}
          currentFolderId={resolveParentId(
            folders,
            moveTarget.kind === "folder" ? moveTarget.folder.parentId : moveTarget.score.folderId
          )}
          isDisabled={
            moveTarget.kind === "folder"
              ? (folderId) => !canMoveFolder(folders, moveTarget.folder.id, folderId)
              : undefined
          }
          onPick={handleMove}
          onCancel={() => setMoveTarget(null)}
        />
      )}

      {renameTarget && (
        <SaveNameOverlay
          initialTitle={targetName(renameTarget)}
          saving={renaming}
          heading={renameTarget.kind === "folder" ? "Rename folder" : "Rename"}
          placeholder={renameTarget.kind === "folder" ? "Folder name" : "Piece name"}
          cancelAccessibilityLabel="Cancel rename"
          confirmAccessibilityLabel={renaming ? "Renaming" : "Rename"}
          onCancel={() => {
            if (!renaming) {
              setRenameTarget(null);
            }
          }}
          onConfirm={(name) => void handleRenameConfirm(name)}
        />
      )}
    </View>
  );
}
