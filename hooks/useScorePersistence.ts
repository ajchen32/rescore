import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { router, useLocalSearchParams } from "expo-router";

import { defaultSaveTitle } from "../components/SaveNameOverlay";
import type { ReaderStrip } from "../lib/corrections";
import { errorFromUnknown } from "../lib/errors";
import {
  loadLibrary,
  loadScore,
  resolveLandscapeVisibleCount,
  resolvePortraitVisibleCount,
  saveScore,
  savedStripToReaderStrip,
  uniqueScoreTitle,
} from "../lib/library";
import {
  buildPersistSnapshot,
  persistSnapshotsEqual,
  type PersistSnapshot,
} from "../lib/persistSnapshot";

const AUTOSAVE_DEBOUNCE_MS = 600;
const SAVE_WAIT_POLL_MS = 50;

export type SaveStatus = "idle" | "saving" | "saved";

type ScorePersistenceOptions = {
  // The reader has a finished score to save (an import completed or a score loaded).
  ready: boolean;
  strips: ReaderStrip[];
  garbage: ReaderStrip[];
  portraitVisibleCount: number;
  landscapeVisibleCount: number;
  selectedName: string | null;
  // The library folder a newly imported score is filed in.
  newScoreFolderId: string | null;
  setStrips: Dispatch<SetStateAction<ReaderStrip[]>>;
  setGarbage: Dispatch<SetStateAction<ReaderStrip[]>>;
  setSelectedName: Dispatch<SetStateAction<string | null>>;
  setPortraitVisibleCount: Dispatch<SetStateAction<number>>;
  setLandscapeVisibleCount: Dispatch<SetStateAction<number>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  // Called once a saved score has been loaded into the reader.
  onScoreLoaded: () => void;
};

/**
 * Loads a saved score from the `scoreId` route param and autosaves the open
 * score: the first save creates the library entry, later edits save after a
 * short debounce, and only one save runs at a time.
 */
export function useScorePersistence({
  ready,
  strips,
  garbage,
  portraitVisibleCount,
  landscapeVisibleCount,
  selectedName,
  newScoreFolderId,
  setStrips,
  setGarbage,
  setSelectedName,
  setPortraitVisibleCount,
  setLandscapeVisibleCount,
  setErrorMessage,
  onScoreLoaded,
}: ScorePersistenceOptions) {
  const { scoreId } = useLocalSearchParams<{ scoreId?: string }>();
  const [savedScoreId, setSavedScoreId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const loadedScoreIdRef = useRef<string | null>(null);
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef(false);
  const savePendingRef = useRef(false);
  const lastSavedSnapshotRef = useRef<PersistSnapshot | null>(null);
  // Bumped when the reader closes, so a save finishing afterwards doesn't refill it.
  const saveEpochRef = useRef(0);

  // The save loop reads the latest values after each await. These are assigned
  // during render (not in an effect) so the autosave effect below, which can save
  // in the same commit, already sees them.
  const stripsRef = useRef(strips);
  const garbageRef = useRef(garbage);
  const portraitVisibleCountRef = useRef(portraitVisibleCount);
  const landscapeVisibleCountRef = useRef(landscapeVisibleCount);
  const selectedNameRef = useRef(selectedName);
  const savedScoreIdRef = useRef(savedScoreId);
  stripsRef.current = strips;
  garbageRef.current = garbage;
  portraitVisibleCountRef.current = portraitVisibleCount;
  landscapeVisibleCountRef.current = landscapeVisibleCount;
  selectedNameRef.current = selectedName;
  savedScoreIdRef.current = savedScoreId;
  const newScoreFolderIdRef = useRef(newScoreFolderId);
  newScoreFolderIdRef.current = newScoreFolderId;
  const onScoreLoadedRef = useRef(onScoreLoaded);
  onScoreLoadedRef.current = onScoreLoaded;

  useEffect(() => {
    return () => {
      if (saveStatusTimeoutRef.current) {
        clearTimeout(saveStatusTimeoutRef.current);
      }
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const requestedScoreId = typeof scoreId === "string" ? scoreId : undefined;
    if (!requestedScoreId || loadedScoreIdRef.current === requestedScoreId) {
      return;
    }

    let cancelled = false;
    loadedScoreIdRef.current = requestedScoreId;

    void (async () => {
      try {
        const score = await loadScore(requestedScoreId);
        if (cancelled) {
          return;
        }

        const loadedStrips = score.strips.map(savedStripToReaderStrip);
        const loadedGarbage = (score.garbage ?? []).map(savedStripToReaderStrip);
        const loadedPortraitVisibleCount = resolvePortraitVisibleCount(score);
        const loadedLandscapeVisibleCount = resolveLandscapeVisibleCount(score);
        lastSavedSnapshotRef.current = buildPersistSnapshot(
          loadedStrips,
          loadedGarbage,
          loadedPortraitVisibleCount,
          loadedLandscapeVisibleCount,
          score.title
        );
        setStrips(loadedStrips);
        setGarbage(loadedGarbage);
        setSelectedName(score.title);
        setPortraitVisibleCount(loadedPortraitVisibleCount);
        setLandscapeVisibleCount(loadedLandscapeVisibleCount);
        setSavedScoreId(score.id);
        setErrorMessage(null);
        onScoreLoadedRef.current();
      } catch (error) {
        if (!cancelled) {
          loadedScoreIdRef.current = null;
          setErrorMessage(errorFromUnknown(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    scoreId,
    setErrorMessage,
    setGarbage,
    setLandscapeVisibleCount,
    setPortraitVisibleCount,
    setSelectedName,
    setStrips,
  ]);

  const persistScore = useCallback(async () => {
    if (stripsRef.current.length === 0) {
      return;
    }

    if (saveInFlightRef.current) {
      savePendingRef.current = true;
      return;
    }

    saveInFlightRef.current = true;

    try {
      while (true) {
        savePendingRef.current = false;

        const currentStrips = stripsRef.current;
        const currentGarbage = garbageRef.current;
        const currentPortraitVisibleCount = portraitVisibleCountRef.current;
        const currentLandscapeVisibleCount = landscapeVisibleCountRef.current;
        const currentSavedScoreId = savedScoreIdRef.current;
        const epoch = saveEpochRef.current;

        let title: string;
        if (!currentSavedScoreId) {
          const library = await loadLibrary();
          title = uniqueScoreTitle(defaultSaveTitle(selectedNameRef.current), library.scores);
        } else {
          title = (selectedNameRef.current ?? "").trim();
          if (title.length === 0) {
            break;
          }
        }

        const snapshot = buildPersistSnapshot(
          currentStrips,
          currentGarbage,
          currentPortraitVisibleCount,
          currentLandscapeVisibleCount,
          title
        );

        if (
          lastSavedSnapshotRef.current &&
          persistSnapshotsEqual(snapshot, lastSavedSnapshotRef.current)
        ) {
          break;
        }

        setSaveStatus("saving");
        setErrorMessage(null);

        const result = await saveScore({
          id: currentSavedScoreId ?? undefined,
          title,
          strips: currentStrips,
          garbage: currentGarbage,
          portraitVisibleCount: currentPortraitVisibleCount,
          landscapeVisibleCount: currentLandscapeVisibleCount,
          folderId: newScoreFolderIdRef.current,
        });

        // The reader was closed while this save ran; don't repopulate it.
        if (epoch !== saveEpochRef.current) {
          break;
        }

        // An edit made while this save was running (whose debounced autosave has
        // not fired yet) must not be overwritten by the older saved result.
        if (stripsRef.current !== currentStrips || garbageRef.current !== currentGarbage) {
          savePendingRef.current = true;
        }

        if (!savePendingRef.current) {
          const nextStrips = result.score.strips.map(savedStripToReaderStrip);
          const nextGarbage = (result.score.garbage ?? []).map(savedStripToReaderStrip);
          setStrips(nextStrips);
          setGarbage(nextGarbage);
          setSavedScoreId(result.id);
          setSelectedName(result.score.title);
          lastSavedSnapshotRef.current = buildPersistSnapshot(
            nextStrips,
            nextGarbage,
            currentPortraitVisibleCount,
            currentLandscapeVisibleCount,
            result.score.title
          );
        }

        setSaveStatus("saved");
        if (saveStatusTimeoutRef.current) {
          clearTimeout(saveStatusTimeoutRef.current);
        }
        saveStatusTimeoutRef.current = setTimeout(() => {
          setSaveStatus("idle");
        }, 2000);

        if (!savePendingRef.current) {
          break;
        }
      }
    } catch (error) {
      setSaveStatus("idle");
      setErrorMessage(errorFromUnknown(error));
    } finally {
      saveInFlightRef.current = false;
    }
    // Setters only: the loop reads everything else through refs, so this stays stable.
  }, [setErrorMessage, setGarbage, setSelectedName, setStrips]);

  useEffect(() => {
    if (!ready || strips.length === 0) {
      return;
    }

    const title = savedScoreId ? (selectedName ?? "").trim() : defaultSaveTitle(selectedName);
    const snapshot = buildPersistSnapshot(
      strips,
      garbage,
      portraitVisibleCount,
      landscapeVisibleCount,
      title
    );

    if (
      lastSavedSnapshotRef.current &&
      persistSnapshotsEqual(snapshot, lastSavedSnapshotRef.current)
    ) {
      return;
    }

    if (!savedScoreId) {
      void persistScore();
      return;
    }

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      void persistScore();
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [
    garbage,
    landscapeVisibleCount,
    persistScore,
    portraitVisibleCount,
    ready,
    savedScoreId,
    selectedName,
    strips,
  ]);

  const openSavedScore = useCallback((id: string) => {
    loadedScoreIdRef.current = null;
    router.setParams({ scoreId: id });
  }, []);

  // Before importing a new score: forget the open one so autosave creates a new entry.
  const startNewScore = useCallback(() => {
    loadedScoreIdRef.current = null;
    lastSavedSnapshotRef.current = null;
    setSavedScoreId(null);
    setSaveStatus("idle");
  }, []);

  // Saves an edit made just before leaving, which may still be waiting on the
  // autosave debounce that closing would otherwise cancel.
  const flushSave = useCallback(async () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    while (saveInFlightRef.current) {
      await new Promise((resolve) => setTimeout(resolve, SAVE_WAIT_POLL_MS));
    }
    await persistScore();
  }, [persistScore]);

  // After closing the reader: drop the score and ignore any save still finishing.
  const endSession = useCallback(() => {
    saveEpochRef.current += 1;
    lastSavedSnapshotRef.current = null;
    loadedScoreIdRef.current = null;
    setSavedScoreId(null);
    setSaveStatus("idle");
  }, []);

  return { saveStatus, openSavedScore, startNewScore, flushSave, endSession };
}
