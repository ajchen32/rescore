import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { SafeAreaView } from "react-native-safe-area-context";

import { HomeView } from "../components/HomeView";
import { PagePickerOverlay } from "../components/PagePickerOverlay";
import { ReaderView } from "../components/ReaderView";
import { SongReviewOverlay } from "../components/SongReviewOverlay";
import { usePageImport, type AppPhase } from "../hooks/usePageImport";
import { useReaderBar } from "../hooks/useReaderBar";
import { useReaderPaging } from "../hooks/useReaderPaging";
import { useScorePersistence } from "../hooks/useScorePersistence";
import { useSongDialogs, useSongs } from "../hooks/useSongs";
import { useStripEditing } from "../hooks/useStripEditing";
import {
  DEFAULT_LANDSCAPE_VISIBLE_COUNT,
  DEFAULT_VISIBLE_COUNT,
  type ReaderStrip,
} from "../lib/corrections";
import { songStartIndices, type Song } from "../lib/songs";
import { useTheme } from "../lib/theme";

export default function HomeScreen() {
  const { darkMode, colors } = useTheme();
  const [phase, setPhase] = useState<AppPhase>("idle");
  const [strips, setStrips] = useState<ReaderStrip[]>([]);
  const [garbage, setGarbage] = useState<ReaderStrip[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [portraitVisibleCount, setPortraitVisibleCount] = useState(DEFAULT_VISIBLE_COUNT);
  const [landscapeVisibleCount, setLandscapeVisibleCount] = useState(
    DEFAULT_LANDSCAPE_VISIBLE_COUNT
  );
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [libraryQuery, setLibraryQuery] = useState("");
  // Folder ids from the library root to the open folder.
  const [folderPath, setFolderPath] = useState<string[]>([]);
  // A song to open at once its score has loaded (from tapping a song in the library).
  const pendingSongIdRef = useRef<string | null>(null);
  const [songToShow, setSongToShow] = useState<string | null>(null);

  const showReader = strips.length > 0;
  const edit = useStripEditing({ strips, garbage, setStrips, setGarbage, setErrorMessage });
  const songDialogs = useSongDialogs();
  const overlayOpen =
    edit.splitTarget !== null ||
    edit.showGarbage ||
    renamingTitle ||
    songDialogs.open ||
    phase === "choosing" ||
    phase === "reviewingSongs";
  const bar = useReaderBar({ showReader, editing: edit.editing, overlayOpen });
  const paging = useReaderPaging({
    strips,
    songs,
    portraitVisibleCount,
    landscapeVisibleCount,
    setPortraitVisibleCount,
    setLandscapeVisibleCount,
    overlayOpen,
    setChromeVisible: bar.setChromeVisible,
    bumpBar: bar.bumpBar,
  });
  const { setColumnIndex, jumpToStrip } = paging;
  const songsApi = useSongs({
    strips,
    songs,
    setSongs,
    firstStripIndex: paging.firstStripIndex,
    jumpToStrip,
    dialogs: songDialogs,
  });
  const resetEditing = edit.reset;
  const resetBar = bar.reset;
  const resetSongDialogs = songDialogs.reset;

  const handleScoreLoaded = useCallback(() => {
    setPhase("done");
    resetEditing();
    resetSongDialogs();
    setColumnIndex(0);
    setSongToShow(pendingSongIdRef.current);
    pendingSongIdRef.current = null;
  }, [resetEditing, resetSongDialogs, setColumnIndex]);

  // Opening a song from the library: jump once the score's columns exist.
  useEffect(() => {
    if (songToShow === null || strips.length === 0) {
      return;
    }
    const start = songStartIndices(strips, songs).get(songToShow);
    if (start !== undefined) {
      jumpToStrip(start);
    }
    setSongToShow(null);
  }, [jumpToStrip, songToShow, songs, strips]);

  const persistence = useScorePersistence({
    ready: phase === "done",
    strips,
    garbage,
    portraitVisibleCount,
    landscapeVisibleCount,
    selectedName,
    songs,
    newScoreFolderId: folderPath.at(-1) ?? null,
    setStrips,
    setGarbage,
    setSelectedName,
    setSongs,
    setPortraitVisibleCount,
    setLandscapeVisibleCount,
    setErrorMessage,
    onScoreLoaded: handleScoreLoaded,
  });
  const { startNewScore, flushSave, endSession, openSavedScore } = persistence;

  const openScore = useCallback(
    (scoreId: string, songId?: string) => {
      pendingSongIdRef.current = songId ?? null;
      openSavedScore(scoreId);
    },
    [openSavedScore]
  );

  // Empties the reader (the visible counts carry over to the next score).
  const resetReader = useCallback(() => {
    setStrips([]);
    setGarbage([]);
    setErrorMessage(null);
    setSelectedName(null);
    setSongs([]);
    setColumnIndex(0);
    resetEditing();
    resetBar();
    resetSongDialogs();
  }, [resetBar, resetEditing, resetSongDialogs, setColumnIndex]);

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
    setSongs,
    setErrorMessage,
    onBeginImport: beginImport,
  });
  const { reset: resetImport, clearPageSelection, finishSongReview } = pageImport;

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
  const {
    naming: songNaming,
    setNaming: setSongNaming,
    listOpen: songListOpen,
    setListOpen: setSongListOpen,
  } = songDialogs;
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (phase === "choosing") {
        clearPageSelection();
        return true;
      }
      if (phase === "reviewingSongs") {
        finishSongReview([]);
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
      if (songNaming) {
        setSongNaming(null);
        return true;
      }
      if (songListOpen) {
        setSongListOpen(false);
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
      if (folderPath.length > 0) {
        setFolderPath((path) => path.slice(0, -1));
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [
    clearPageSelection,
    closeReader,
    finishSongReview,
    folderPath.length,
    phase,
    renamingTitle,
    setShowGarbage,
    setSongListOpen,
    setSongNaming,
    setSplitTargetIndex,
    showGarbage,
    songListOpen,
    songNaming,
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
            songs={songsApi}
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
            folderPath={folderPath}
            onFolderPathChange={setFolderPath}
            pickBusy={pageImport.pickBusy}
            busyMessage={pageImport.busy ? pageImport.busyMessage : null}
            onOpenScore={openScore}
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

        {phase === "reviewingSongs" && (
          <SongReviewOverlay
            strips={strips}
            starts={pageImport.suggestedSongStarts}
            inverted={darkMode}
            onConfirm={finishSongReview}
            onSkip={() => finishSongReview([])}
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
    </View>
  );
}
