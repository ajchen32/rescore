import { Pressable, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GarbageOverlay } from "./GarbageOverlay";
import { READER_BAR_BOTTOM, ReaderBar } from "./ReaderBar";
import { defaultSaveTitle, SaveNameOverlay } from "./SaveNameOverlay";
import { BookmarksOverlay } from "./BookmarksOverlay";
import { SplitOverlay } from "./SplitOverlay";
import { StripColumnView } from "./StripColumnView";
import type { useReaderBar } from "../hooks/useReaderBar";
import type { useReaderPaging } from "../hooks/useReaderPaging";
import type { SaveStatus } from "../hooks/useScorePersistence";
import type { useBookmarks } from "../hooks/useBookmarks";
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
  bookmarks: ReturnType<typeof useBookmarks>;
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
  bookmarks,
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
                bookmarksByStart={bookmarks.byStartIndex}
                onToggleBookmark={bookmarks.toggleBookmarkAt}
                onRenameBookmark={bookmarks.setRenaming}
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
          bookmarkCount={bookmarks.ordered.length}
          currentBookmarkTitle={bookmarks.currentBookmark?.title ?? null}
          onShow={bar.showBar}
          onBack={onClose}
          onDecrease={paging.decreaseVisibleCount}
          onIncrease={paging.increaseVisibleCount}
          onToggleEdit={edit.toggleEditing}
          onOpenGarbage={() => edit.setShowGarbage(true)}
          onRename={onStartRename}
          onOpenBookmarks={() => bookmarks.setListOpen(true)}
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

      {bookmarks.listOpen && (
        <BookmarksOverlay
          bookmarks={bookmarks.ordered}
          currentBookmarkId={bookmarks.currentBookmark?.id ?? null}
          onJump={(bookmarkId) => {
            bookmarks.jumpToBookmark(bookmarkId);
            bookmarks.setListOpen(false);
          }}
          onRename={bookmarks.setRenaming}
          onRemove={bookmarks.removeBookmark}
          onClose={() => bookmarks.setListOpen(false)}
        />
      )}

      {bookmarks.renaming && (
        <SaveNameOverlay
          initialTitle={bookmarks.renaming.title}
          saving={false}
          heading="Rename bookmark"
          placeholder="Bookmark name"
          cancelAccessibilityLabel="Cancel"
          confirmAccessibilityLabel="Rename bookmark"
          onCancel={() => bookmarks.setRenaming(null)}
          onConfirm={bookmarks.confirmRename}
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
