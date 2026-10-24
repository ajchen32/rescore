import { useCallback, useEffect, useState } from "react";
import { BackHandler, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { FileText, Images } from "lucide-react-native";

import { HomeView } from "../components/HomeView";
import { Menu } from "../components/Menu";
import { PagePickerOverlay } from "../components/PagePickerOverlay";
import { ReaderView } from "../components/ReaderView";
import { usePageImport, type AppPhase } from "../hooks/usePageImport";
import { useReaderBar } from "../hooks/useReaderBar";
import { useReaderPaging } from "../hooks/useReaderPaging";
import { useScorePersistence } from "../hooks/useScorePersistence";
import { useStripEditing } from "../hooks/useStripEditing";
import {
  DEFAULT_LANDSCAPE_VISIBLE_COUNT,
  DEFAULT_VISIBLE_COUNT,
  type ReaderStrip,
} from "../lib/corrections";
import { useTheme } from "../lib/theme";

const TOOLBAR_HEIGHT = 48;
const MENU_GAP = 4;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { darkMode, colors } = useTheme();
  const [phase, setPhase] = useState<AppPhase>("idle");
  const [strips, setStrips] = useState<ReaderStrip[]>([]);
  const [garbage, setGarbage] = useState<ReaderStrip[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [portraitVisibleCount, setPortraitVisibleCount] = useState(DEFAULT_VISIBLE_COUNT);
  const [landscapeVisibleCount, setLandscapeVisibleCount] = useState(
    DEFAULT_LANDSCAPE_VISIBLE_COUNT
  );
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [libraryQuery, setLibraryQuery] = useState("");

  const showReader = strips.length > 0;
  const edit = useStripEditing({ strips, garbage, setStrips, setGarbage, setErrorMessage });
  const overlayOpen =
    edit.splitTarget !== null || edit.showGarbage || renamingTitle || phase === "choosing";
  const bar = useReaderBar({ showReader, editing: edit.editing, overlayOpen });
  const paging = useReaderPaging({
    strips,
    portraitVisibleCount,
    landscapeVisibleCount,
    setPortraitVisibleCount,
    setLandscapeVisibleCount,
    overlayOpen,
    setChromeVisible: bar.setChromeVisible,
    bumpBar: bar.bumpBar,
  });
  const { setColumnIndex } = paging;
  const resetEditing = edit.reset;
  const resetBar = bar.reset;

  const handleScoreLoaded = useCallback(() => {
    setPhase("done");
    resetEditing();
    setColumnIndex(0);
  }, [resetEditing, setColumnIndex]);

  const persistence = useScorePersistence({
    ready: phase === "done",
    strips,
    garbage,
    portraitVisibleCount,
    landscapeVisibleCount,
    selectedName,
    setStrips,
    setGarbage,
    setSelectedName,
    setPortraitVisibleCount,
    setLandscapeVisibleCount,
    setErrorMessage,
    onScoreLoaded: handleScoreLoaded,
  });
  const { startNewScore, flushSave, endSession } = persistence;

  // Empties the reader (the visible counts carry over to the next score).
  const resetReader = useCallback(() => {
    setStrips([]);
    setGarbage([]);
    setErrorMessage(null);
    setSelectedName(null);
    setColumnIndex(0);
    resetEditing();
    resetBar();
  }, [resetBar, resetEditing, setColumnIndex]);

  const beginImport = useCallback(() => {
    startNewScore();
    resetReader();
    router.setParams({ scoreId: undefined });
    setColumnIndex(0);
  }, [resetReader, setColumnIndex, startNewScore]);

  const pageImport = usePageImport({
    phase,
    setPhase,
    setStrips,
    setGarbage,
    setSelectedName,
    setErrorMessage,
    onBeginImport: beginImport,
  });
  const { reset: resetImport, clearPageSelection } = pageImport;

  const shouldKeepAwake = pageImport.pickBusy || strips.length > 0;
  useEffect(() => {
    const tag = "piano-pdf-parser-reader";
    if (shouldKeepAwake) {
      void activateKeepAwakeAsync(tag);
      return () => {
        void deactivateKeepAwake(tag);
      };
    }
    void deactivateKeepAwake(tag);
    return undefined;
  }, [shouldKeepAwake]);

  // Back to the library, saving any edit still waiting on the autosave debounce.
  const closeReader = useCallback(async () => {
    await flushSave();
    endSession();
    resetReader();
    resetImport();
    setPhase("idle");
    router.setParams({ scoreId: undefined });
    setLibraryVersion((version) => version + 1);
  }, [endSession, flushSave, resetImport, resetReader]);

  const { splitTargetIndex, setSplitTargetIndex, showGarbage, setShowGarbage } = edit;
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (phase === "choosing") {
        clearPageSelection();
        return true;
      }
      if (splitTargetIndex !== null) {
        setSplitTargetIndex(null);
        return true;
      }
      if (showGarbage) {
        setShowGarbage(false);
        return true;
      }
      if (renamingTitle) {
        setRenamingTitle(false);
        return true;
      }
      if (showReader) {
        void closeReader();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [
    clearPageSelection,
    closeReader,
    phase,
    renamingTitle,
    setShowGarbage,
    setSplitTargetIndex,
    showGarbage,
    showReader,
    splitTargetIndex,
  ]);

  const handleRename = useCallback((title: string) => {
    // Autosave picks up the new title along with the rest of the score.
    const trimmed = title.trim();
    if (trimmed.length > 0) {
      setSelectedName(trimmed);
    }
    setRenamingTitle(false);
  }, []);

  const pickPdf = () => void pageImport.handlePickPdf();
  const pickPhotos = () => void pageImport.handlePickPhotos();

  return (
    <View
      className="flex-1"
      style={{
        backgroundColor: showReader ? (darkMode ? "#000000" : "#FFFFFF") : colors.background,
      }}
    >
      <SafeAreaView
        className="flex-1"
        // The reader runs edge to edge at the top (its bar handles the inset).
        edges={showReader ? ["bottom", "left", "right"] : ["top", "bottom", "left", "right"]}
      >
        {/* Reading is full screen: the clock would sit on top of the music. */}
        <StatusBar hidden={showReader} />

        {showReader ? (
          <ReaderView
            strips={strips}
            garbage={garbage}
            title={selectedName}
            saveStatus={persistence.saveStatus}
            overlayOpen={overlayOpen}
            paging={paging}
            bar={bar}
            edit={edit}
            renaming={renamingTitle}
            onStartRename={() => setRenamingTitle(true)}
            onCancelRename={() => setRenamingTitle(false)}
            onRename={handleRename}
            onClose={() => void closeReader()}
          />
        ) : (
          <HomeView
            libraryVersion={libraryVersion}
            query={libraryQuery}
            onQueryChange={setLibraryQuery}
            pickBusy={pageImport.pickBusy}
            busyMessage={pageImport.busy ? pageImport.busyMessage : null}
            onOpenScore={persistence.openSavedScore}
            onOpenImportMenu={() => setImportMenuOpen(true)}
            onPickPdf={pickPdf}
            onPickPhotos={pickPhotos}
            onError={setErrorMessage}
          />
        )}

        {pageImport.pickerReady && selectedName && (
          <PagePickerOverlay
            importMode={pageImport.pageImportMode}
            pdfUri={
              pageImport.pageImportMode === "pdf" ? pageImport.pendingPdfUri ?? undefined : undefined
            }
            fileName={selectedName}
            previews={pageImport.pagePreviews}
            reorderMode={pageImport.reorderMode}
            orderSequence={pageImport.orderSequence}
            selectedPageIndices={pageImport.selectedPageIndices}
            onToggleReorderMode={pageImport.handleToggleReorderMode}
            onTogglePage={pageImport.handleTogglePage}
            onSelectAll={pageImport.handleSelectAllPages}
            onClear={pageImport.handleClearPageSelection}
            onCancel={clearPageSelection}
            onProcess={pageImport.handleProcessSelectedPages}
          />
        )}

        {errorMessage && (
          <Pressable
            onPress={() => setErrorMessage(null)}
            accessibilityRole="button"
            accessibilityHint="Dismiss"
            className="absolute bottom-4 left-4 right-4 z-40 rounded-xl border px-4 py-3"
            style={{ borderColor: colors.border, backgroundColor: colors.surfaceElevated, elevation: 6 }}
          >
            <Text className="text-sm font-medium" style={{ color: colors.text }}>
              {errorMessage}
            </Text>
            <Text className="mt-0.5 text-xs" style={{ color: colors.textMuted }}>
              Tap to dismiss
            </Text>
          </Pressable>
        )}
      </SafeAreaView>

      {importMenuOpen && (
        <Menu
          top={insets.top + TOOLBAR_HEIGHT + MENU_GAP}
          right={insets.right + 8}
          onClose={() => setImportMenuOpen(false)}
          items={[
            { label: "PDF", icon: FileText, onPress: pickPdf },
            { label: "Photos", icon: Images, onPress: pickPhotos },
          ]}
        />
      )}
    </View>
  );
}
