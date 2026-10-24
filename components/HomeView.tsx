import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { FileText, FolderPlus, Images, Moon, Plus, Sun } from "lucide-react-native";

import { IconButton } from "./IconButton";
import { LibraryList } from "./LibraryList";
import { Menu } from "./Menu";
import { SaveNameOverlay } from "./SaveNameOverlay";
import { SearchField } from "./SearchField";
import { Toolbar } from "./Toolbar";
import { errorFromUnknown } from "../lib/errors";
import { createFolder } from "../lib/library";
import { useTheme } from "../lib/theme";

const TOOLBAR_HEIGHT = 48;
const MENU_GAP = 4;
const MENU_RIGHT = 8;

type HomeViewProps = {
  libraryVersion: number;
  // Kept by the parent so a search and the open folder survive opening a score.
  query: string;
  onQueryChange: (query: string) => void;
  folderPath: string[];
  onFolderPathChange: (folderPath: string[]) => void;
  // An import is running or the page picker is open.
  pickBusy: boolean;
  // Message for the full-screen spinner while an import copies or slices; null hides it.
  busyMessage: string | null;
  onOpenScore: (scoreId: string) => void;
  onPickPdf: () => void;
  onPickPhotos: () => void;
  onError: (message: string) => void;
};

/** The library: search, the import menu, folders and saved scores. */
export function HomeView({
  libraryVersion,
  query,
  onQueryChange,
  folderPath,
  onFolderPathChange,
  pickBusy,
  busyMessage,
  onOpenScore,
  onPickPdf,
  onPickPhotos,
  onError,
}: HomeViewProps) {
  const { darkMode, toggleDarkMode, colors } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [savingFolder, setSavingFolder] = useState(false);
  const [localVersion, setLocalVersion] = useState(0);
  const primary = {
    iconColor: colors.controlActiveText,
    style: { backgroundColor: colors.controlActive, borderColor: colors.controlActive },
  };

  const handleCreateFolder = async (name: string) => {
    setSavingFolder(true);
    try {
      await createFolder(name, folderPath.at(-1) ?? null);
      setCreatingFolder(false);
      setLocalVersion((version) => version + 1);
    } catch (error) {
      onError(errorFromUnknown(error));
    } finally {
      setSavingFolder(false);
    }
  };

  return (
    <View className="flex-1">
      <Toolbar
        center={<SearchField value={query} onChangeText={onQueryChange} />}
        right={
          <View className="flex-row items-center gap-1">
            <IconButton
              icon={darkMode ? Sun : Moon}
              label={darkMode ? "Light mode" : "Dark mode"}
              variant="sm"
              ghost
              iconColor={colors.text}
              onPress={toggleDarkMode}
            />
            <IconButton
              icon={Plus}
              label="Import or add a folder"
              variant="sm"
              onPress={() => setMenuOpen(true)}
              disabled={pickBusy}
              {...primary}
            />
          </View>
        }
      />
      <LibraryList
        refreshKey={libraryVersion + localVersion}
        query={query}
        folderPath={folderPath}
        onNavigate={onFolderPathChange}
        onOpen={onOpenScore}
        onError={onError}
        emptyAction={
          <View className="flex-row gap-2">
            <IconButton
              icon={FileText}
              label="Import a PDF"
              onPress={onPickPdf}
              disabled={pickBusy}
              {...primary}
            />
            <IconButton
              icon={Images}
              label="Import photos"
              onPress={onPickPhotos}
              disabled={pickBusy}
              iconColor={colors.text}
              style={{ backgroundColor: colors.control, borderColor: colors.border }}
            />
          </View>
        }
      />

      {menuOpen && (
        <Menu
          top={TOOLBAR_HEIGHT + MENU_GAP}
          right={MENU_RIGHT}
          onClose={() => setMenuOpen(false)}
          items={[
            { label: "PDF", icon: FileText, onPress: onPickPdf },
            { label: "Photos", icon: Images, onPress: onPickPhotos },
            { label: "New folder", icon: FolderPlus, onPress: () => setCreatingFolder(true) },
          ]}
        />
      )}

      {creatingFolder && (
        <SaveNameOverlay
          initialTitle=""
          saving={savingFolder}
          heading="New folder"
          placeholder="Folder name"
          cancelAccessibilityLabel="Cancel new folder"
          confirmAccessibilityLabel="Create folder"
          onCancel={() => {
            if (!savingFolder) {
              setCreatingFolder(false);
            }
          }}
          onConfirm={(name) => void handleCreateFolder(name)}
        />
      )}

      {busyMessage !== null && (
        <View
          className="absolute inset-0 items-center justify-center"
          style={{ backgroundColor: colors.background }}
        >
          <ActivityIndicator size="large" color={colors.text} />
          <Text className="mt-3 text-base" style={{ color: colors.text }}>
            {busyMessage}
          </Text>
        </View>
      )}
    </View>
  );
}
