import type { ReaderStrip } from "./corrections";
import type { Bookmark } from "./bookmarks";

/** What autosave compares to decide whether the open score changed since its last save. */
export type PersistSnapshot = {
  stripsJson: string;
  garbageJson: string;
  portraitVisibleCount: number;
  landscapeVisibleCount: number;
  title: string;
  bookmarksJson: string;
};

export function buildPersistSnapshot(
  strips: ReaderStrip[],
  garbage: ReaderStrip[],
  portraitVisibleCount: number,
  landscapeVisibleCount: number,
  title: string,
  bookmarks: Bookmark[] = []
): PersistSnapshot {
  return {
    stripsJson: JSON.stringify(strips),
    garbageJson: JSON.stringify(garbage),
    portraitVisibleCount,
    landscapeVisibleCount,
    title,
    bookmarksJson: JSON.stringify(bookmarks),
  };
}

export function persistSnapshotsEqual(a: PersistSnapshot, b: PersistSnapshot): boolean {
  return (
    a.stripsJson === b.stripsJson &&
    a.garbageJson === b.garbageJson &&
    a.portraitVisibleCount === b.portraitVisibleCount &&
    a.landscapeVisibleCount === b.landscapeVisibleCount &&
    a.title === b.title &&
    a.bookmarksJson === b.bookmarksJson
  );
}
