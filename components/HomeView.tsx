import { ActivityIndicator, Text, View } from "react-native";
import { FileText, Images, Moon, Plus, Sun } from "lucide-react-native";

import { IconButton } from "./IconButton";
import { LibraryList } from "./LibraryList";
import { SearchField } from "./SearchField";
import { Toolbar } from "./Toolbar";
import { useTheme } from "../lib/theme";

type HomeViewProps = {
  libraryVersion: number;
  // Kept by the parent so a search survives opening and closing a score.
  query: string;
  onQueryChange: (query: string) => void;
  // An import is running or the page picker is open.
  pickBusy: boolean;
  // Message for the full-screen spinner while an import copies or slices; null hides it.
  busyMessage: string | null;
  onOpenScore: (scoreId: string) => void;
  onOpenImportMenu: () => void;
  onPickPdf: () => void;
  onPickPhotos: () => void;
  onError: (message: string) => void;
};

/** The library: search, the import button and the list of saved scores. */
export function HomeView({
  libraryVersion,
  query,
  onQueryChange,
  pickBusy,
  busyMessage,
  onOpenScore,
  onOpenImportMenu,
  onPickPdf,
  onPickPhotos,
  onError,
}: HomeViewProps) {
  const { darkMode, toggleDarkMode, colors } = useTheme();
  const primary = {
    iconColor: colors.controlActiveText,
    style: { backgroundColor: colors.controlActive, borderColor: colors.controlActive },
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
              label="Import"
              variant="sm"
              onPress={onOpenImportMenu}
              disabled={pickBusy}
              {...primary}
            />
          </View>
        }
      />
      <LibraryList
        refreshKey={libraryVersion}
        query={query}
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
