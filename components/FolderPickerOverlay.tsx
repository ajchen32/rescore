import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Folder as FolderIcon, Library, X } from "lucide-react-native";

import { IconButton } from "./IconButton";
import { Toolbar } from "./Toolbar";
import { childFolders, type Folder } from "../lib/folders";
import { useTheme } from "../lib/theme";

const INDENT_PER_LEVEL = 20;

type FolderPickerOverlayProps = {
  title: string;
  folders: Folder[];
  // Where the item is now (shown but not selectable).
  currentFolderId: string | null;
  // Folders that can't be chosen, e.g. a folder being moved and its subfolders.
  isDisabled?: (folderId: string) => boolean;
  onPick: (folderId: string | null) => void;
  onCancel: () => void;
};

type Row = { folder: Folder | null; depth: number };

function folderRows(folders: Folder[]): Row[] {
  const rows: Row[] = [{ folder: null, depth: 0 }];
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of childFolders(folders, parentId)) {
      rows.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 1);
  return rows;
}

/** "Move to…": the library's folders as an indented tree. */
export function FolderPickerOverlay({
  title,
  folders,
  currentFolderId,
  isDisabled,
  onPick,
  onCancel,
}: FolderPickerOverlayProps) {
  const { colors } = useTheme();

  return (
    <View className="absolute inset-0 z-30" style={{ backgroundColor: colors.background }}>
      <SafeAreaView className="flex-1" edges={["bottom", "left", "right"]}>
        <Toolbar
          title={title}
          subtitle="Choose a folder"
          left={
            <IconButton
              icon={X}
              label="Cancel move"
              variant="sm"
              ghost
              iconColor={colors.text}
              onPress={onCancel}
            />
          }
        />
        <ScrollView>
          {folderRows(folders).map(({ folder, depth }) => {
            const id = folder?.id ?? null;
            const isCurrent = id === currentFolderId;
            const disabled = isCurrent || (id !== null && (isDisabled?.(id) ?? false));
            const Icon = folder ? FolderIcon : Library;
            return (
              <Pressable
                key={id ?? "root"}
                disabled={disabled}
                onPress={() => onPick(id)}
                accessibilityRole="button"
                className={`flex-row items-center gap-3 border-b py-3 pr-4 ${disabled ? "opacity-40" : ""}`}
                style={{ paddingLeft: 16 + depth * INDENT_PER_LEVEL, borderBottomColor: colors.border }}
              >
                <Icon size={20} color={colors.text} strokeWidth={2} />
                <Text className="flex-1 text-base" style={{ color: colors.text }} numberOfLines={1}>
                  {folder ? folder.name : "Library"}
                </Text>
                {isCurrent && (
                  <Text className="text-xs" style={{ color: colors.textMuted }}>
                    Current
                  </Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
