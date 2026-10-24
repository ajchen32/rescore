import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import type { ReaderStrip } from "../lib/corrections";
import {
  addSong,
  newSongId,
  orderedSongs,
  songAnchor,
  songAtStrip,
  songStartIndices,
  type Song,
} from "../lib/songs";

export type SongNaming =
  | { kind: "new"; start: Song["start"]; suggestedTitle: string }
  | { kind: "rename"; song: Song };

/**
 * The song list and naming dialog. Separate from `useSongs` because whether they
 * are open is needed (as "an overlay is open") before paging, which `useSongs` uses.
 */
export function useSongDialogs() {
  const [listOpen, setListOpen] = useState(false);
  const [naming, setNaming] = useState<SongNaming | null>(null);
  const reset = useCallback(() => {
    setListOpen(false);
    setNaming(null);
  }, []);
  return { listOpen, setListOpen, naming, setNaming, open: listOpen || naming !== null, reset };
}

type SongsOptions = {
  strips: ReaderStrip[];
  songs: Song[];
  setSongs: Dispatch<SetStateAction<Song[]>>;
  // The system at the top of the screen.
  firstStripIndex: number;
  jumpToStrip: (stripIndex: number) => void;
  dialogs: ReturnType<typeof useSongDialogs>;
};

/** The reader's song list for books: jump to a song, mark a new one, rename or remove. */
export function useSongs({
  strips,
  songs,
  setSongs,
  firstStripIndex,
  jumpToStrip,
  dialogs,
}: SongsOptions) {
  const { listOpen, setListOpen, naming, setNaming } = dialogs;

  const ordered = useMemo(() => orderedSongs(strips, songs), [songs, strips]);
  const currentSong = useMemo(
    () => songAtStrip(strips, songs, firstStripIndex),
    [firstStripIndex, songs, strips]
  );

  const jumpToSong = useCallback(
    (songId: string) => {
      const start = songStartIndices(strips, songs).get(songId);
      if (start !== undefined) {
        jumpToStrip(start);
      }
    },
    [jumpToStrip, songs, strips]
  );

  // Starts a song at the system at the top of the screen, or renames the one already there.
  const markSongHere = useCallback(() => {
    const strip = strips[firstStripIndex];
    if (!strip) {
      return;
    }
    const existing = ordered.find(({ startIndex }) => startIndex === firstStripIndex);
    if (existing) {
      setNaming({ kind: "rename", song: existing.song });
      return;
    }
    setNaming({
      kind: "new",
      start: songAnchor(strip),
      suggestedTitle: `Song ${ordered.filter(({ startIndex }) => startIndex < firstStripIndex).length + 1}`,
    });
  }, [firstStripIndex, ordered, setNaming, strips]);

  const confirmName = useCallback(
    (title: string) => {
      const trimmed = title.trim();
      if (!naming || trimmed.length === 0) {
        setNaming(null);
        return;
      }
      if (naming.kind === "new") {
        setSongs((current) => addSong(current, { id: newSongId(), title: trimmed, start: naming.start }));
      } else {
        setSongs((current) =>
          current.map((song) => (song.id === naming.song.id ? { ...song, title: trimmed } : song))
        );
      }
      setNaming(null);
    },
    [naming, setNaming, setSongs]
  );

  const removeSong = useCallback(
    (songId: string) => {
      setSongs((current) => current.filter((song) => song.id !== songId));
    },
    [setSongs]
  );

  return {
    ordered,
    currentSong,
    listOpen,
    setListOpen,
    naming,
    setNaming,
    jumpToSong,
    markSongHere,
    renameSong: (song: Song) => setNaming({ kind: "rename", song }),
    confirmName,
    removeSong,
  };
}
