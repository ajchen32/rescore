import { stripPagePosition, type ReaderStrip } from "./corrections";

/**
 * A piece inside a book. It starts at a page position rather than a strip index
 * or id, so merging, splitting, deleting or restoring systems doesn't lose it:
 * the song begins at the first system at or after that position.
 */
export type Song = {
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

/** Where a song starting at `strip` is anchored. */
export function songAnchor(strip: ReaderStrip): Song["start"] {
  return stripPagePosition(strip);
}

/** The strip index each song starts at; songs past the last strip are left out. */
export function songStartIndices(strips: ReaderStrip[], songs: Song[]): Map<string, number> {
  const positions = strips.map(stripPagePosition);
  const starts = new Map<string, number>();
  for (const song of songs) {
    const index = positions.findIndex((position) => comparePosition(position, song.start) >= 0);
    if (index >= 0) {
      starts.set(song.id, index);
    }
  }
  return starts;
}

/** Songs in reading order with their start index, dropping any that resolve to the same strip. */
export function orderedSongs(
  strips: ReaderStrip[],
  songs: Song[]
): { song: Song; startIndex: number }[] {
  const starts = songStartIndices(strips, songs);
  const seen = new Set<number>();
  return songs
    .filter((song) => starts.has(song.id))
    .map((song) => ({ song, startIndex: starts.get(song.id) as number }))
    .sort((a, b) => a.startIndex - b.startIndex)
    .filter(({ startIndex }) => {
      if (seen.has(startIndex)) {
        return false;
      }
      seen.add(startIndex);
      return true;
    });
}

/** The song a strip belongs to: the last one starting at or before it. */
export function songAtStrip(
  strips: ReaderStrip[],
  songs: Song[],
  stripIndex: number
): Song | null {
  let current: Song | null = null;
  for (const { song, startIndex } of orderedSongs(strips, songs)) {
    if (startIndex > stripIndex) {
      break;
    }
    current = song;
  }
  return current;
}

/** Strip indices where a new column must begin so every song starts on a fresh screen. */
export function songBreaks(strips: ReaderStrip[], songs: Song[]): number[] {
  return orderedSongs(strips, songs)
    .map(({ startIndex }) => startIndex)
    .filter((index) => index > 0);
}

/** Adds a song starting at `strip`, keeping songs in reading order. */
export function addSong(songs: Song[], song: Song): Song[] {
  return [...songs, song].sort((a, b) => comparePosition(a.start, b.start));
}

export function newSongId(): string {
  return `song-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
