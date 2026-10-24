import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import type { ReaderStrip } from "../lib/corrections";
import {
  addBookmark,
  bookmarkAnchor,
  bookmarkAtStrip,
  bookmarkStartIndices,
  newBookmarkId,
  orderedBookmarks,
  type Bookmark,
} from "../lib/bookmarks";

/**
 * The bookmark list and rename dialog. Separate from `useBookmarks` because whether
 * they are open is needed (as "an overlay is open") before paging, which
 * `useBookmarks` uses.
 */
export function useBookmarkDialogs() {
  const [listOpen, setListOpen] = useState(false);
  const [renaming, setRenaming] = useState<Bookmark | null>(null);
  const reset = useCallback(() => {
    setListOpen(false);
    setRenaming(null);
  }, []);
  const open = listOpen || renaming !== null;
  return { listOpen, setListOpen, renaming, setRenaming, open, reset };
}

type BookmarksOptions = {
  strips: ReaderStrip[];
  bookmarks: Bookmark[];
  setBookmarks: Dispatch<SetStateAction<Bookmark[]>>;
  // The system at the top of the screen.
  firstStripIndex: number;
  jumpToStrip: (stripIndex: number) => void;
  dialogs: ReturnType<typeof useBookmarkDialogs>;
};

/** Bookmarks in the reader: jump to one, add or remove one on a system, rename. */
export function useBookmarks({
  strips,
  bookmarks,
  setBookmarks,
  firstStripIndex,
  jumpToStrip,
  dialogs,
}: BookmarksOptions) {
  const { listOpen, setListOpen, renaming, setRenaming } = dialogs;

  const ordered = useMemo(() => orderedBookmarks(strips, bookmarks), [bookmarks, strips]);
  // The bookmark starting at each strip index, for the edit-mode buttons and tags.
  const byStartIndex = useMemo(
    () => new Map(ordered.map(({ bookmark, startIndex }) => [startIndex, bookmark])),
    [ordered]
  );
  const currentBookmark = useMemo(
    () => bookmarkAtStrip(strips, bookmarks, firstStripIndex),
    [firstStripIndex, bookmarks, strips]
  );

  const jumpToBookmark = useCallback(
    (bookmarkId: string) => {
      const start = bookmarkStartIndices(strips, bookmarks).get(bookmarkId);
      if (start !== undefined) {
        jumpToStrip(start);
      }
    },
    [jumpToStrip, bookmarks, strips]
  );

  // Adds a bookmark starting at this system, or removes the one already there.
  const toggleBookmarkAt = useCallback(
    (stripIndex: number) => {
      const strip = strips[stripIndex];
      if (!strip) {
        return;
      }
      const existing = byStartIndex.get(stripIndex);
      if (existing) {
        setBookmarks((current) => current.filter((bookmark) => bookmark.id !== existing.id));
        return;
      }
      const position = ordered.filter(({ startIndex }) => startIndex < stripIndex).length + 1;
      setBookmarks((current) =>
        addBookmark(current, {
          id: newBookmarkId(),
          title: `Bookmark ${position}`,
          start: bookmarkAnchor(strip),
        })
      );
    },
    [byStartIndex, ordered, setBookmarks, strips]
  );

  const confirmRename = useCallback(
    (title: string) => {
      const trimmed = title.trim();
      if (renaming && trimmed.length > 0) {
        setBookmarks((current) =>
          current.map((bookmark) =>
            bookmark.id === renaming.id ? { ...bookmark, title: trimmed } : bookmark
          )
        );
      }
      setRenaming(null);
    },
    [renaming, setBookmarks, setRenaming]
  );

  const removeBookmark = useCallback(
    (bookmarkId: string) => {
      setBookmarks((current) => current.filter((bookmark) => bookmark.id !== bookmarkId));
    },
    [setBookmarks]
  );

  return {
    ordered,
    byStartIndex,
    currentBookmark,
    listOpen,
    setListOpen,
    renaming,
    setRenaming,
    jumpToBookmark,
    toggleBookmarkAt,
    confirmRename,
    removeBookmark,
  };
}
