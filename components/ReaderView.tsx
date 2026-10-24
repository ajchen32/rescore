import { Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GarbageOverlay } from "./GarbageOverlay";
import { READER_BAR_BOTTOM, ReaderBar } from "./ReaderBar";
import { defaultSaveTitle, SaveNameOverlay } from "./SaveNameOverlay";
import { SongsOverlay } from "./SongsOverlay";
import { SplitOverlay } from "./SplitOverlay";
import { StripColumnView } from "./StripColumnView";
import type { useReaderBar } from "../hooks/useReaderBar";
import type { useReaderPaging } from "../hooks/useReaderPaging";
import type { SaveStatus } from "../hooks/useScorePersistence";
import type { useSongs } from "../hooks/useSongs";
import type { useStripEditing } from "../hooks/useStripEditing";
import { MAX_VISIBLE_COUNT, MIN_VISIBLE_COUNT, type ReaderStrip } from "../lib/corrections";
import { useTheme } from "../lib/theme";

// Space between the reader bar and the edit controls of the system under it.
const EDIT_CONTROLS_GAP = 8;

type ReaderViewProps = {
  strips: ReaderStrip[];
  garbage: ReaderStrip[];
  title: string | null;
  saveStatus: SaveStatus;
  // A full-screen layer (split, removed systems, rename, page picker) is open.
  overlayOpen: boolean;
  paging: ReturnType<typeof useReaderPaging>;
  bar: ReturnType<typeof useReaderBar>;
  edit: ReturnType<typeof useStripEditing>;
  songs: ReturnType<typeof useSongs>;
  renaming: boolean;
  onStartRename: () => void;
  onCancelRename: () => void;
  onRename: (title: string) => void;
  onClose: () => void;
};

/** The full-screen reader: columns of systems, the floating bar and its overlays. */
export function ReaderView({
  strips,
  garbage,
  title,
  saveStatus,
  overlayOpen,
  paging,
  bar,
  edit,
  songs,
  renaming,
  onStartRename,
  onCancelRename,
  onRename,
  onClose,
}: ReaderViewProps) {
  const { darkMode } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: viewportWidth } = useWindowDimensions();
  const { activeVisibleCount } = paging;

  return (
    <View className="relative flex-1" onLayout={paging.handleReaderLayout} {...paging.panHandlers}>
      <Pressable style={{ flex: 1 }} disabled={overlayOpen} onPress={paging.handleReaderPress}>
        <View style={{ flex: 1, position: "relative" }}>
          {paging.preloadedColumns.map(({ column, isActive }) => (
            <View
              key={column.id}
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                opacity: isActive ? 1 : 0,
              }}
              pointerEvents={isActive ? "auto" : "none"}
            >
              <StripColumnView
                column={column}
                columnWidth={viewportWidth - insets.left - insets.right}
                readerHeight={paging.readerHeight}
                slotHeight={paging.slotHeight}
                showSeparators={bar.chromeVisible || edit.editing}
                allStrips={strips}
                editing={edit.editing && isActive}
                firstControlsTop={
                  bar.chromeVisible ? insets.top + READER_BAR_BOTTOM + EDIT_CONTROLS_GAP : undefined
                }
                splitAvailable={edit.splitAvailable}
                inverted={darkMode}
                onMergeUp={edit.handleMergeUp}
                onSplit={edit.handleSplitRequest}
                onDelete={edit.handleDelete}
              />
            </View>
          ))}
        </View>
      </Pressable>

      {!overlayOpen && (
        <ReaderBar
          visible={bar.chromeVisible}
          title={title ?? ""}
          saveStatus={saveStatus}
          visibleCount={activeVisibleCount}
          canDecrease={activeVisibleCount > MIN_VISIBLE_COUNT}
          canIncrease={activeVisibleCount < MAX_VISIBLE_COUNT}
          editing={edit.editing}
          garbageCount={garbage.length}
          songCount={songs.ordered.length}
          currentSongTitle={songs.currentSong?.title ?? null}
          onShow={bar.showBar}
          onBack={onClose}
          onDecrease={paging.decreaseVisibleCount}
          onIncrease={paging.increaseVisibleCount}
          onToggleEdit={edit.toggleEditing}
          onOpenGarbage={() => edit.setShowGarbage(true)}
          onRename={onStartRename}
          onOpenSongs={() => songs.setListOpen(true)}
          onMarkSong={songs.markSongHere}
          onInteraction={bar.bumpBar}
          onMenuOpenChange={bar.setBarMenuOpen}
        />
      )}

      {edit.splitTarget && (
        <SplitOverlay
          strip={edit.splitTarget}
          inverted={darkMode}
          onConfirm={edit.handleSplitConfirm}
          onCancel={edit.handleSplitCancel}
        />
      )}

      {edit.showGarbage && (
        <GarbageOverlay
          garbage={garbage}
          inverted={darkMode}
          onRestore={edit.handleRestoreFromGarbage}
          onClose={() => edit.setShowGarbage(false)}
        />
      )}

      {songs.listOpen && (
        <SongsOverlay
          songs={songs.ordered}
          currentSongId={songs.currentSong?.id ?? null}
          onJump={(songId) => {
            songs.jumpToSong(songId);
            songs.setListOpen(false);
          }}
          onMarkSong={() => {
            songs.setListOpen(false);
            songs.markSongHere();
          }}
          onRename={songs.renameSong}
          onRemove={songs.removeSong}
          onClose={() => songs.setListOpen(false)}
        />
      )}

      {songs.naming && (
        <SaveNameOverlay
          initialTitle={
            songs.naming.kind === "new" ? songs.naming.suggestedTitle : songs.naming.song.title
          }
          saving={false}
          heading={songs.naming.kind === "new" ? "New song starts here" : "Rename song"}
          placeholder="Song name"
          cancelAccessibilityLabel="Cancel"
          confirmAccessibilityLabel={songs.naming.kind === "new" ? "Add song" : "Rename song"}
          onCancel={() => songs.setNaming(null)}
          onConfirm={songs.confirmName}
        />
      )}

      {renaming && (
        <SaveNameOverlay
          initialTitle={defaultSaveTitle(title)}
          saving={false}
          heading="Rename"
          cancelAccessibilityLabel="Cancel rename"
          confirmAccessibilityLabel="Rename"
          onCancel={onCancelRename}
          onConfirm={onRename}
        />
      )}
    </View>
  );
}
