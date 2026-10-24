import { stripPagePosition, type ReaderStrip } from "./corrections";

/**
 * A place to jump to: a piece in a book, a movement, a passage. It starts at a
 * page position rather than a strip index or id, so merging, splitting,
 * deleting or restoring systems doesn't lose it: the bookmark begins at the
 * first system at or after that position.
 */
export type Bookmark = {
  id: string;
  title: string;
  start: { pageIndex: number; y0: number };
};

function comparePosition(
  a: { pageIndex: number; y0: number },
  b: { pageIndex: number; y0: number }
): number {
  return a.pageIndex !== b.pageIndex ? a.pageIndex - b.pageIndex : a.y0 - b.y0;
}

/** Where a bookmark starting at `strip` is anchored. */
export function bookmarkAnchor(strip: ReaderStrip): Bookmark["start"] {
  return stripPagePosition(strip);
}

/** The strip index each bookmark starts at; bookmarks past the last strip are left out. */
export function bookmarkStartIndices(
  strips: ReaderStrip[],
  bookmarks: Bookmark[]
): Map<string, number> {
  const positions = strips.map(stripPagePosition);
  const starts = new Map<string, number>();
  for (const bookmark of bookmarks) {
    const index = positions.findIndex((position) => comparePosition(position, bookmark.start) >= 0);
    if (index >= 0) {
      starts.set(bookmark.id, index);
    }
  }
  return starts;
}

/**
 * Bookmarks in reading order with their start index, dropping any that resolve
 * to the same strip.
 */
export function orderedBookmarks(
  strips: ReaderStrip[],
  bookmarks: Bookmark[]
): { bookmark: Bookmark; startIndex: number }[] {
  const starts = bookmarkStartIndices(strips, bookmarks);
  const seen = new Set<number>();
  return bookmarks
    .filter((bookmark) => starts.has(bookmark.id))
    .map((bookmark) => ({ bookmark, startIndex: starts.get(bookmark.id) as number }))
    .sort((a, b) => a.startIndex - b.startIndex)
    .filter(({ startIndex }) => {
      if (seen.has(startIndex)) {
        return false;
      }
      seen.add(startIndex);
      return true;
    });
}

/** The bookmark a strip belongs to: the last one starting at or before it. */
export function bookmarkAtStrip(
  strips: ReaderStrip[],
  bookmarks: Bookmark[],
  stripIndex: number
): Bookmark | null {
  let current: Bookmark | null = null;
  for (const { bookmark, startIndex } of orderedBookmarks(strips, bookmarks)) {
    if (startIndex > stripIndex) {
      break;
    }
    current = bookmark;
  }
  return current;
}

/** Strip indices where a new column must begin so every bookmark starts on a fresh screen. */
export function bookmarkBreaks(strips: ReaderStrip[], bookmarks: Bookmark[]): number[] {
  return orderedBookmarks(strips, bookmarks)
    .map(({ startIndex }) => startIndex)
    .filter((index) => index > 0);
}

/** Adds a bookmark starting at `strip`, keeping bookmarks in reading order. */
export function addBookmark(bookmarks: Bookmark[], bookmark: Bookmark): Bookmark[] {
  return [...bookmarks, bookmark].sort((a, b) => comparePosition(a.start, b.start));
}

/**
 * Bookmarks for pages marked in the import picker, in import order: each starts
 * at its page's first system. `pageOrder` lists the imported pages (picker
 * indices) in import order; marks on pages not imported are dropped.
 */
export function pageBookmarks(pageOrder: number[], markedPages: Set<number>): Bookmark[] {
  let count = 0;
  return pageOrder.flatMap((page, position) => {
    if (!markedPages.has(page)) {
      return [];
    }
    count += 1;
    return [{ id: newBookmarkId(), title: `Bookmark ${count}`, start: { pageIndex: position, y0: 0 } }];
  });
}

export function newBookmarkId(): string {
  return `bookmark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
