import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  GestureResponderEvent,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  addProgressListener,
  getPdfPagePreviews,
  processImages,
  processPdf,
  type PagePreview,
  type ProgressEvent,
} from "piano-pdf-parser-core";

import { GarbageOverlay } from "../components/GarbageOverlay";
import { PagePickerOverlay } from "../components/PagePickerOverlay";
import { defaultSaveTitle } from "../components/SaveNameOverlay";
import { SplitOverlay } from "../components/SplitOverlay";
import { StripColumnView } from "../components/StripColumnView";
import { subscribeScoreDeleted } from "../lib/discardedScores";
import { errorFromUnknown } from "../lib/errors";
import {
  chunkStrips,
  clampVisibleCount,
  DEFAULT_LANDSCAPE_VISIBLE_COUNT,
  DEFAULT_VISIBLE_COUNT,
  MAX_VISIBLE_COUNT,
  mergeWithAbove,
  MIN_VISIBLE_COUNT,
  moveToGarbage,
  replaceAt,
  restoreFromGarbage,
  stripSlotHeight,
  toReaderStrips,
  type ReaderStrip,
} from "../lib/corrections";
import {
  deleteScore,
  formatScoreDate,
  loadLibrary,
  loadScore,
  resolveLandscapeVisibleCount,
  resolvePortraitVisibleCount,
  saveScore,
  savedStripToReaderStrip,
  uniqueScoreTitle,
  type SavedScore,
} from "../lib/library";
import { buildImagePreviews, copyImagesToAppCache } from "../lib/images";
import { copyPdfToAppCache, isPdfAsset, pickerCopyToCacheDirectory } from "../lib/pdf";
import { IconButton } from "../components/IconButton";
import { useTheme } from "../lib/theme";
import { isSplitAvailable, SPLIT_REBUILD_MESSAGE, splitStripAtRatios } from "../lib/splitStrip";
import {
  BookOpen,
  Check,
  FileText,
  Images,
  Minus,
  Moon,
  Pencil,
  Plus,
  Sun,
  Trash2,
} from "lucide-react-native";

type AppPhase =
  | "idle"
  | "copying"
  | "loadingPreviews"
  | "choosing"
  | "processing"
  | "done"
  | "error";
type PageImportMode = "pdf" | "photos";
type SaveStatus = "idle" | "saving" | "saved";

type ReaderLayoutSnapshot = {
  width: number;
  height: number;
  portraitVisibleCount: number;
  landscapeVisibleCount: number;
};

const CHROME_SWIPE_THRESHOLD = 36;
const SWIPE_BACK_THRESHOLD = 36;
const AUTOSAVE_DEBOUNCE_MS = 600;

type PersistSnapshot = {
  stripsJson: string;
  garbageJson: string;
  portraitVisibleCount: number;
  landscapeVisibleCount: number;
  title: string;
};

function buildPersistSnapshot(
  strips: ReaderStrip[],
  garbage: ReaderStrip[],
  portraitVisibleCount: number,
  landscapeVisibleCount: number,
  title: string
): PersistSnapshot {
  return {
    stripsJson: JSON.stringify(strips),
    garbageJson: JSON.stringify(garbage),
    portraitVisibleCount,
    landscapeVisibleCount,
    title,
  };
}

function persistSnapshotsEqual(a: PersistSnapshot, b: PersistSnapshot): boolean {
  return (
    a.stripsJson === b.stripsJson &&
    a.garbageJson === b.garbageJson &&
    a.portraitVisibleCount === b.portraitVisibleCount &&
    a.landscapeVisibleCount === b.landscapeVisibleCount &&
    a.title === b.title
  );
}

export default function HomeScreen() {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const isLandscape = viewportWidth > viewportHeight;
  const { scoreId, deletedScoreId } = useLocalSearchParams<{
    scoreId?: string;
    deletedScoreId?: string;
  }>();
  const [phase, setPhase] = useState<AppPhase>("idle");
  const [strips, setStrips] = useState<ReaderStrip[]>([]);
  const [garbage, setGarbage] = useState<ReaderStrip[]>([]);
  const [showGarbage, setShowGarbage] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [portraitVisibleCount, setPortraitVisibleCount] = useState(DEFAULT_VISIBLE_COUNT);
  const [landscapeVisibleCount, setLandscapeVisibleCount] = useState(
    DEFAULT_LANDSCAPE_VISIBLE_COUNT
  );
  const [readerHeight, setReaderHeight] = useState(0);
  const [editing, setEditing] = useState(false);
  const [splitTargetIndex, setSplitTargetIndex] = useState<number | null>(null);
  const [savedScoreId, setSavedScoreId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [chromeVisible, setChromeVisible] = useState(true);
  const [recents, setRecents] = useState<SavedScore[]>([]);
  const [pageImportMode, setPageImportMode] = useState<PageImportMode>("pdf");
  const [pendingPdfUri, setPendingPdfUri] = useState<string | null>(null);
  const [pendingImageUris, setPendingImageUris] = useState<string[]>([]);
  const [pagePreviews, setPagePreviews] = useState<PagePreview[]>([]);
  const [selectedPageIndices, setSelectedPageIndices] = useState<Set<number>>(new Set());
  const [reorderMode, setReorderMode] = useState(false);
  const [orderSequence, setOrderSequence] = useState<number[]>([]);
  const [columnIndex, setColumnIndex] = useState(0);
  const { darkMode, toggleDarkMode, colors } = useTheme();
  const progressSubscription = useRef<ReturnType<typeof addProgressListener> | null>(null);
  const loadedScoreIdRef = useRef<string | null>(null);
  const saveStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef(false);
  const savePendingRef = useRef(false);
  const lastSavedSnapshotRef = useRef<PersistSnapshot | null>(null);
  const saveEpochRef = useRef(0);
  const discardedScoreIdsRef = useRef(new Set<string>());
  const stripsRef = useRef(strips);
  const garbageRef = useRef(garbage);
  const portraitVisibleCountRef = useRef(portraitVisibleCount);
  const landscapeVisibleCountRef = useRef(landscapeVisibleCount);
  const selectedNameRef = useRef(selectedName);
  const savedScoreIdRef = useRef(savedScoreId);
  const readerLayoutRef = useRef<ReaderLayoutSnapshot>({
    width: viewportWidth,
    height: viewportHeight,
    portraitVisibleCount: DEFAULT_VISIBLE_COUNT,
    landscapeVisibleCount: DEFAULT_LANDSCAPE_VISIBLE_COUNT,
  });

  const activeVisibleCount = isLandscape ? landscapeVisibleCount : portraitVisibleCount;

  const columns = useMemo(
    () => chunkStrips(strips, activeVisibleCount),
    [activeVisibleCount, strips]
  );
  const clampedColumnIndex =
    columns.length > 0 ? Math.min(columnIndex, columns.length - 1) : 0;
  const preloadedColumns = useMemo(() => {
    if (columns.length === 0) {
      return [];
    }

    const indices = new Set<number>();
    for (const offset of [-1, 0, 1]) {
      const index = clampedColumnIndex + offset;
      if (index >= 0 && index < columns.length) {
        indices.add(index);
      }
    }

    return [...indices]
      .sort((a, b) => a - b)
      .map((index) => ({
        index,
        column: columns[index],
        isActive: index === clampedColumnIndex,
      }));
  }, [clampedColumnIndex, columns]);
  const slotHeight = stripSlotHeight(readerHeight, activeVisibleCount, chromeVisible);
  const splitTarget = splitTargetIndex !== null ? strips[splitTargetIndex] : null;
  const splitAvailable = isSplitAvailable();
  const showReader = strips.length > 0;
  const overlayOpen = splitTarget !== null || showGarbage || phase === "choosing";

  stripsRef.current = strips;
  garbageRef.current = garbage;
  portraitVisibleCountRef.current = portraitVisibleCount;
  landscapeVisibleCountRef.current = landscapeVisibleCount;
  selectedNameRef.current = selectedName;
  savedScoreIdRef.current = savedScoreId;
  const pickBusy =
    phase === "copying" ||
    phase === "loadingPreviews" ||
    phase === "processing" ||
    phase === "choosing";

  const overlayOpenRef = useRef(overlayOpen);
  overlayOpenRef.current = overlayOpen;
  const columnCountRef = useRef(columns.length);
  columnCountRef.current = columns.length;

  const goToNextColumn = useCallback(() => {
    setColumnIndex((current) => Math.min(current + 1, Math.max(columnCountRef.current - 1, 0)));
  }, []);

  const goToPreviousColumn = useCallback(() => {
    setColumnIndex((current) => Math.max(current - 1, 0));
  }, []);

  const handleReaderPress = useCallback(
    (event: GestureResponderEvent) => {
      const tapX = event.nativeEvent.locationX;
      if (tapX < viewportWidth / 3) {
        goToPreviousColumn();
        return;
      }
      goToNextColumn();
    },
    [goToNextColumn, goToPreviousColumn, viewportWidth]
  );

  const goToPreviousColumnRef = useRef(goToPreviousColumn);
  goToPreviousColumnRef.current = goToPreviousColumn;

  const readerPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        if (overlayOpenRef.current) {
          return false;
        }
        const { dx, dy } = gestureState;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (absDy >= CHROME_SWIPE_THRESHOLD && absDy > absDx) {
          return true;
        }
        if (dx >= SWIPE_BACK_THRESHOLD && absDx > absDy) {
          return true;
        }
        return false;
      },
      onPanResponderTerminationRequest: () => true,
      onPanResponderRelease: (_, gestureState) => {
        if (overlayOpenRef.current) {
          return;
        }
        const { dx, dy } = gestureState;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (absDy >= CHROME_SWIPE_THRESHOLD && absDy > absDx) {
          setChromeVisible((visible) => !visible);
          return;
        }
        if (dx >= SWIPE_BACK_THRESHOLD && absDx > absDy) {
          goToPreviousColumnRef.current();
        }
      },
    })
  ).current;

  const shouldKeepAwake =
    phase === "copying" ||
    phase === "loadingPreviews" ||
    phase === "choosing" ||
    phase === "processing" ||
    strips.length > 0;

  const clearProgressSubscription = useCallback(() => {
    progressSubscription.current?.remove();
    progressSubscription.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearProgressSubscription();
      if (saveStatusTimeoutRef.current) {
        clearTimeout(saveStatusTimeoutRef.current);
      }
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [clearProgressSubscription]);

  useFocusEffect(
    useCallback(() => {
      if (strips.length > 0) {
        return;
      }
      void loadLibrary().then((library) => {
        setRecents(library.scores.slice(0, 5));
      });
    }, [strips.length])
  );

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
        setPhase("done");
        setEditing(false);
        setSplitTargetIndex(null);
        setShowGarbage(false);
        setErrorMessage(null);
        setColumnIndex(0);
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
  }, [scoreId]);

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

  useEffect(() => {
    const previous = readerLayoutRef.current;
    const wasLandscape = previous.width > previous.height;
    const sizeChanged =
      previous.width !== viewportWidth || previous.height !== viewportHeight;

    if (sizeChanged && strips.length > 0 && previous.width > 0) {
      const oldVisibleCount = wasLandscape
        ? previous.landscapeVisibleCount
        : previous.portraitVisibleCount;
      const firstStripIndex = columnIndex * oldVisibleCount;
      const newColumnIndex = Math.floor(firstStripIndex / activeVisibleCount);
      setColumnIndex(newColumnIndex);
    }

    readerLayoutRef.current = {
      width: viewportWidth,
      height: viewportHeight,
      portraitVisibleCount,
      landscapeVisibleCount,
    };
  }, [
    activeVisibleCount,
    landscapeVisibleCount,
    portraitVisibleCount,
    columnIndex,
    strips.length,
    viewportHeight,
    viewportWidth,
  ]);

  useEffect(() => {
    if (columns.length === 0) {
      setColumnIndex(0);
      return;
    }
    if (columnIndex >= columns.length) {
      setColumnIndex(columns.length - 1);
    }
  }, [columnIndex, columns.length]);

  const handleReaderLayout = useCallback((event: LayoutChangeEvent) => {
    setReaderHeight(event.nativeEvent.layout.height);
  }, []);

  const resetResults = useCallback(() => {
    setStrips([]);
    setGarbage([]);
    setProgress(null);
    setErrorMessage(null);
    setSelectedName(null);
    setPageImportMode("pdf");
    setPendingPdfUri(null);
    setPendingImageUris([]);
    setPagePreviews([]);
    setSelectedPageIndices(new Set());
    setReorderMode(false);
    setOrderSequence([]);
    setColumnIndex(0);
    setEditing(false);
    setSplitTargetIndex(null);
    setShowGarbage(false);
    setChromeVisible(true);
  }, []);

  const clearPageSelection = useCallback(() => {
    setPageImportMode("pdf");
    setPendingPdfUri(null);
    setPendingImageUris([]);
    setPagePreviews([]);
    setSelectedPageIndices(new Set());
    setReorderMode(false);
    setOrderSequence([]);
    setPhase("idle");
  }, []);

  const openSavedScore = useCallback((id: string) => {
    loadedScoreIdRef.current = null;
    router.replace({
      pathname: "/",
      params: { scoreId: id },
    });
  }, []);

  const discardOpenScore = useCallback(() => {
    const openId = savedScoreIdRef.current;
    if (openId) {
      discardedScoreIdsRef.current.add(openId);
    }
    saveEpochRef.current += 1;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    savePendingRef.current = false;
    lastSavedSnapshotRef.current = null;
    loadedScoreIdRef.current = null;
    resetResults();
    setSavedScoreId(null);
    setPhase("idle");
    setSaveStatus("idle");
    router.setParams({ scoreId: undefined, deletedScoreId: undefined });
  }, [resetResults]);

  useEffect(() => {
    if (!deletedScoreId || savedScoreIdRef.current !== deletedScoreId) {
      return;
    }
    discardOpenScore();
  }, [deletedScoreId, discardOpenScore]);

  useEffect(() => {
    return subscribeScoreDeleted((id) => {
      if (savedScoreIdRef.current === id) {
        discardOpenScore();
      }
    });
  }, [discardOpenScore]);

  useFocusEffect(
    useCallback(() => {
      const openId = savedScoreIdRef.current;
      if (!openId || stripsRef.current.length === 0) {
        return;
      }

      let cancelled = false;
      void loadScore(openId)
        .then((score) => {
          if (!cancelled) {
            setSelectedName(score.title);
          }
        })
        .catch(() => {
          if (!cancelled) {
            discardOpenScore();
          }
        });

      return () => {
        cancelled = true;
      };
    }, [discardOpenScore])
  );

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
          title = uniqueScoreTitle(
            defaultSaveTitle(selectedNameRef.current),
            library.scores
          );
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
        });

        if (epoch !== saveEpochRef.current) {
          if (currentSavedScoreId && discardedScoreIdsRef.current.has(currentSavedScoreId)) {
            discardedScoreIdsRef.current.delete(currentSavedScoreId);
            try {
              await deleteScore(result.id);
            } catch {
              // The library delete already removed it, or a later save cleaned it up.
            }
          }
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
  }, []);

  useEffect(() => {
    if (phase !== "done" || strips.length === 0) {
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
    phase,
    portraitVisibleCount,
    savedScoreId,
    selectedName,
    strips,
  ]);

  const scrollReaderToStart = useCallback(() => {
    setColumnIndex(0);
  }, []);

  const processSelectedPages = useCallback(
    async (cachedUri: string, pageIndices: number[]) => {
      clearProgressSubscription();
      progressSubscription.current = addProgressListener((event) => {
        setProgress(event);
      });

      setPhase("processing");
      try {
        const { strips: nextStrips, garbage: nextGarbage } = await processPdf(cachedUri, {
          pageIndices,
        });
        setStrips(toReaderStrips(nextStrips));
        setGarbage(toReaderStrips(nextGarbage ?? []));
        setPageImportMode("pdf");
        setPendingPdfUri(null);
        setPendingImageUris([]);
        setPagePreviews([]);
        setSelectedPageIndices(new Set());
        setPhase("done");
      } catch (error) {
        setPhase("error");
        setErrorMessage(errorFromUnknown(error));
      } finally {
        clearProgressSubscription();
        setProgress(null);
      }
    },
    [clearProgressSubscription]
  );

  const processSelectedImages = useCallback(
    async (imageUris: string[]) => {
      clearProgressSubscription();
      progressSubscription.current = addProgressListener((event) => {
        setProgress(event);
      });

      setPhase("processing");
      try {
        const { strips: nextStrips, garbage: nextGarbage } = await processImages(imageUris);
        setStrips(toReaderStrips(nextStrips));
        setGarbage(toReaderStrips(nextGarbage ?? []));
        setPageImportMode("pdf");
        setPendingPdfUri(null);
        setPendingImageUris([]);
        setPagePreviews([]);
        setSelectedPageIndices(new Set());
        setPhase("done");
      } catch (error) {
        setPhase("error");
        setErrorMessage(errorFromUnknown(error));
      } finally {
        clearProgressSubscription();
        setProgress(null);
      }
    },
    [clearProgressSubscription]
  );

  const handlePickPdf = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: pickerCopyToCacheDirectory(),
    });

    if (result.canceled || !result.assets?.length) {
      return;
    }

    const asset = result.assets[0];
    if (!isPdfAsset(asset.name, asset.mimeType)) {
      setPhase("error");
      setErrorMessage("Please choose a PDF file.");
      return;
    }

    loadedScoreIdRef.current = null;
    lastSavedSnapshotRef.current = null;
    setSavedScoreId(null);
    setSaveStatus("idle");
    resetResults();
    router.setParams({ scoreId: undefined, deletedScoreId: undefined });
    setColumnIndex(0);

    setPageImportMode("pdf");
    setSelectedName(asset.name);
    setPhase("copying");

    try {
      const cachedUri = await copyPdfToAppCache(asset.uri, asset.name);
      setPendingPdfUri(cachedUri);
      setPendingImageUris([]);
      setPhase("loadingPreviews");

      const previews = await getPdfPagePreviews(cachedUri);
      setPagePreviews(previews);
      setSelectedPageIndices(new Set(previews.map((preview) => preview.pageIndex)));
      setPhase("choosing");
    } catch (error) {
      setPhase("error");
      setErrorMessage(errorFromUnknown(error));
      setPendingPdfUri(null);
      setPendingImageUris([]);
      setPagePreviews([]);
      setSelectedPageIndices(new Set());
    }
  }, [resetResults]);

  const handlePickPhotos = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPhase("error");
      setErrorMessage("Photo library access is required to import photos.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      orderedSelection: true,
      quality: 1,
    });

    if (result.canceled || !result.assets?.length) {
      return;
    }

    loadedScoreIdRef.current = null;
    lastSavedSnapshotRef.current = null;
    setSavedScoreId(null);
    setSaveStatus("idle");
    resetResults();
    router.setParams({ scoreId: undefined, deletedScoreId: undefined });
    setColumnIndex(0);

    const firstAsset = result.assets[0];
    setPageImportMode("photos");
    setSelectedName(firstAsset.fileName ?? "Photos");
    setPhase("copying");

    try {
      const cachedUris = await copyImagesToAppCache(
        result.assets.map((asset, index) => ({
          uri: asset.uri,
          name: asset.fileName ?? `photo-${index + 1}.jpg`,
        }))
      );
      setPendingImageUris(cachedUris);
      setPendingPdfUri(null);
      setPhase("loadingPreviews");

      const previews = await buildImagePreviews(cachedUris);
      setPagePreviews(previews);
      setSelectedPageIndices(new Set(previews.map((preview) => preview.pageIndex)));
      setPhase("choosing");
    } catch (error) {
      setPhase("error");
      setErrorMessage(errorFromUnknown(error));
      setPendingImageUris([]);
      setPagePreviews([]);
      setSelectedPageIndices(new Set());
    }
  }, [resetResults]);

  const handleToggleReorderMode = useCallback(() => {
    if (reorderMode) {
      const picked = new Set(orderSequence);
      const byPageIndex = new Map(pagePreviews.map((preview) => [preview.pageIndex, preview]));
      const orderedPicked = orderSequence
        .map((pageIndex) => byPageIndex.get(pageIndex))
        .filter((preview): preview is PagePreview => preview !== undefined);
      const unpicked = pagePreviews.filter((preview) => !picked.has(preview.pageIndex));
      setPagePreviews([...orderedPicked, ...unpicked]);
      setSelectedPageIndices(picked);
      setReorderMode(false);
      return;
    }

    const initialSequence = pagePreviews
      .filter((preview) => selectedPageIndices.has(preview.pageIndex))
      .map((preview) => preview.pageIndex);
    setOrderSequence(initialSequence);
    setReorderMode(true);
  }, [orderSequence, pagePreviews, reorderMode, selectedPageIndices]);

  const handleTogglePage = useCallback(
    (pageIndex: number) => {
      if (reorderMode) {
        setOrderSequence((current) => {
          const existingIndex = current.indexOf(pageIndex);
          if (existingIndex >= 0) {
            return current.filter((_, index) => index !== existingIndex);
          }
          return [...current, pageIndex];
        });
        return;
      }

      setSelectedPageIndices((current) => {
        const next = new Set(current);
        if (next.has(pageIndex)) {
          next.delete(pageIndex);
        } else {
          next.add(pageIndex);
        }
        return next;
      });
    },
    [reorderMode]
  );

  const handleSelectAllPages = useCallback(() => {
    if (reorderMode) {
      setOrderSequence(pagePreviews.map((preview) => preview.pageIndex));
      return;
    }
    setSelectedPageIndices(new Set(pagePreviews.map((preview) => preview.pageIndex)));
  }, [pagePreviews, reorderMode]);

  const handleClearPageSelection = useCallback(() => {
    if (reorderMode) {
      setOrderSequence([]);
      return;
    }
    setSelectedPageIndices(new Set());
  }, [reorderMode]);

  const handleProcessSelectedPages = useCallback(() => {
    const orderedPageIndices = reorderMode
      ? orderSequence
      : pagePreviews
          .filter((preview) => selectedPageIndices.has(preview.pageIndex))
          .map((preview) => preview.pageIndex);

    if (orderedPageIndices.length === 0) {
      return;
    }

    if (pageImportMode === "photos") {
      const imageUris = orderedPageIndices
        .map((pageIndex) => pendingImageUris[pageIndex])
        .filter((uri): uri is string => typeof uri === "string" && uri.length > 0);
      if (imageUris.length === 0) {
        return;
      }
      void processSelectedImages(imageUris);
      return;
    }

    if (!pendingPdfUri) {
      return;
    }

    void processSelectedPages(pendingPdfUri, orderedPageIndices);
  }, [
    orderSequence,
    pageImportMode,
    pagePreviews,
    pendingImageUris,
    pendingPdfUri,
    processSelectedImages,
    processSelectedPages,
    reorderMode,
    selectedPageIndices,
  ]);

  const decreaseVisibleCount = useCallback(() => {
    if (isLandscape) {
      setLandscapeVisibleCount((count) => clampVisibleCount(count - 1));
    } else {
      setPortraitVisibleCount((count) => clampVisibleCount(count - 1));
    }
    scrollReaderToStart();
  }, [isLandscape, scrollReaderToStart]);

  const increaseVisibleCount = useCallback(() => {
    if (isLandscape) {
      setLandscapeVisibleCount((count) => clampVisibleCount(count + 1));
    } else {
      setPortraitVisibleCount((count) => clampVisibleCount(count + 1));
    }
    scrollReaderToStart();
  }, [isLandscape, scrollReaderToStart]);

  const handleMergeUp = useCallback((index: number) => {
    setStrips((current) => mergeWithAbove(current, index));
  }, []);

  const handleDelete = useCallback((index: number) => {
    const next = moveToGarbage(strips, garbage, index);
    setStrips(next.strips);
    setGarbage(next.garbage);
  }, [garbage, strips]);

  const handleRestoreFromGarbage = useCallback((garbageIndex: number) => {
    const next = restoreFromGarbage(strips, garbage, garbageIndex);
    setStrips(next.strips);
    setGarbage(next.garbage);
  }, [garbage, strips]);

  const handleSplitRequest = useCallback(
    (index: number) => {
      if (!splitAvailable) {
        setErrorMessage(SPLIT_REBUILD_MESSAGE);
        return;
      }
      setSplitTargetIndex(index);
    },
    [splitAvailable]
  );

  const handleSplitCancel = useCallback(() => {
    setSplitTargetIndex(null);
    setErrorMessage(null);
  }, []);

  const handleSplitConfirm = useCallback(
    async (ratios: number[], overlapRatio: number) => {
      if (splitTargetIndex === null) {
        return;
      }
      const target = strips[splitTargetIndex];
      if (!target) {
        return;
      }

      try {
        const replacements = await splitStripAtRatios(
          target,
          ratios,
          splitTargetIndex,
          overlapRatio
        );
        setStrips((current) => replaceAt(current, splitTargetIndex, replacements));
        setSplitTargetIndex(null);
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(errorFromUnknown(error));
      }
    },
    [splitTargetIndex, strips]
  );

  const safeAreaEdges = ["top", "bottom"] as const;

  return (
    <View
      className="flex-1"
      style={{
        backgroundColor: showReader && darkMode ? "#000000" : colors.background,
      }}
    >
    <SafeAreaView
      className="flex-1"
      style={{
        backgroundColor: showReader && darkMode ? "#000000" : colors.background,
      }}
      edges={safeAreaEdges}
    >
      <StatusBar hidden={showReader && !chromeVisible} />
      {(!showReader || chromeVisible) && (
      <View
        className="border-b px-4 py-3"
        style={{ backgroundColor: colors.surfaceElevated, borderBottomColor: colors.border }}
      >
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={handlePickPdf}
            disabled={pickBusy}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-xl px-4 py-3"
            style={{
              backgroundColor: pickBusy ? colors.border : colors.controlActive,
            }}
          >
            <FileText size={20} color={colors.controlActiveText} strokeWidth={2} />
            <Text className="text-base font-semibold" style={{ color: colors.controlActiveText }}>
              {pickBusy ? "…" : "PDF"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void handlePickPhotos()}
            disabled={pickBusy}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-xl px-4 py-3"
            style={{ backgroundColor: pickBusy ? colors.border : colors.controlActive }}
          >
            <Images size={20} color={colors.controlActiveText} strokeWidth={2} />
            <Text className="text-base font-semibold" style={{ color: colors.controlActiveText }}>
              {pickBusy ? "…" : "Photos"}
            </Text>
          </Pressable>
          <IconButton
            icon={BookOpen}
            label="Library"
            iconColor={colors.text}
            onPress={() => router.push("/library")}
            disabled={pickBusy}
            style={{ backgroundColor: colors.control, borderColor: colors.border }}
          />
          <IconButton
            icon={darkMode ? Sun : Moon}
            label={darkMode ? "Light mode" : "Dark mode"}
            iconColor={colors.text}
            onPress={toggleDarkMode}
            disabled={pickBusy}
            style={{ backgroundColor: colors.control, borderColor: colors.border }}
          />
        </View>
        {selectedName && (strips.length > 0 || phase !== "idle") && (
          <Text className="mt-2 text-xs" style={{ color: colors.textMuted }} numberOfLines={1}>
            {selectedName}
          </Text>
        )}
      </View>
      )}

      {(phase === "copying" || phase === "loadingPreviews" || phase === "processing") && (
        <View className="items-center px-4 py-6">
          <ActivityIndicator size="large" color={colors.text} />
          <Text className="mt-3 text-base" style={{ color: colors.text }}>
            {phase === "copying"
              ? pageImportMode === "photos"
                ? "Copying photos into app cache…"
                : "Copying PDF into app cache…"
              : phase === "loadingPreviews"
                ? pageImportMode === "photos"
                  ? "Loading photo previews…"
                  : "Loading page previews…"
                : progress
                  ? pageImportMode === "photos"
                    ? `Slicing image ${progress.pageIndex + 1} of ${progress.pageCount}…`
                    : `Slicing page ${progress.pageIndex + 1} of ${progress.pageCount}…`
                  : pageImportMode === "photos"
                    ? "Slicing photos…"
                    : "Slicing PDF…"}
          </Text>
        </View>
      )}

      {phase === "choosing" &&
        pagePreviews.length > 0 &&
        selectedName &&
        (pageImportMode === "pdf" ? pendingPdfUri : pendingImageUris.length > 0) && (
        <PagePickerOverlay
          importMode={pageImportMode}
          pdfUri={pageImportMode === "pdf" ? pendingPdfUri ?? undefined : undefined}
          fileName={selectedName}
          previews={pagePreviews}
          reorderMode={reorderMode}
          orderSequence={orderSequence}
          selectedPageIndices={selectedPageIndices}
          onToggleReorderMode={handleToggleReorderMode}
          onTogglePage={handleTogglePage}
          onSelectAll={handleSelectAllPages}
          onClear={handleClearPageSelection}
          onCancel={clearPageSelection}
          onProcess={handleProcessSelectedPages}
        />
      )}

      {errorMessage && (
        <View
          className="mx-4 mt-4 rounded-xl border px-4 py-3"
          style={{ borderColor: colors.border, backgroundColor: colors.surfaceElevated }}
        >
          <Text className="text-sm font-medium" style={{ color: colors.text }}>
            {errorMessage}
          </Text>
        </View>
      )}

      {showReader && (
        <View className="flex-1">
          {chromeVisible && (
          <View
            className="border-b px-4 py-3"
            style={{ backgroundColor: colors.surfaceElevated, borderBottomColor: colors.border }}
          >
            <View className="flex-row items-center justify-between gap-2">
              <View className="flex-row items-center gap-1">
                {saveStatus !== "idle" && (
                  <Text
                    className="min-w-14 px-1 text-sm"
                    style={{ color: colors.textMuted }}
                    accessibilityLiveRegion="polite"
                  >
                    {saveStatus === "saving" ? "Saving" : "Saved"}
                  </Text>
                )}
                <View className="relative">
                  <IconButton
                    icon={Trash2}
                    label={`Garbage, ${garbage.length} items`}
                    iconColor={colors.text}
                    onPress={() => setShowGarbage(true)}
                    style={{ backgroundColor: colors.control, borderColor: colors.border }}
                  />
                  {garbage.length > 0 && (
                    <View
                      className="absolute -right-1 -top-1 min-h-5 min-w-5 items-center justify-center rounded-full px-1"
                      style={{ backgroundColor: colors.controlActive }}
                    >
                      <Text className="text-[10px] font-bold" style={{ color: colors.controlActiveText }}>
                        {garbage.length}
                      </Text>
                    </View>
                  )}
                </View>
                {editing ? (
                  <IconButton
                    icon={Check}
                    label="Done editing"
                    iconColor={colors.controlActiveText}
                    onPress={() => {
                      setEditing(false);
                      setSplitTargetIndex(null);
                    }}
                    style={{ backgroundColor: colors.controlActive, borderColor: colors.border }}
                  />
                ) : (
                  <IconButton
                    icon={Pencil}
                    label="Correct systems"
                    iconColor={colors.text}
                    onPress={() => setEditing(true)}
                    style={{ backgroundColor: colors.control, borderColor: colors.border }}
                  />
                )}
              </View>
              <View className="flex-row items-center gap-2">
                <IconButton
                  icon={Minus}
                  label="Show fewer systems"
                  iconColor={colors.text}
                  onPress={decreaseVisibleCount}
                  disabled={activeVisibleCount <= MIN_VISIBLE_COUNT}
                  className="h-9 w-9 min-h-9 min-w-9"
                  style={{ backgroundColor: colors.control, borderColor: colors.border }}
                />
                <Text
                  className="min-w-6 text-center text-sm font-semibold"
                  style={{ color: colors.text }}
                >
                  {activeVisibleCount}
                </Text>
                <IconButton
                  icon={Plus}
                  label="Show more systems"
                  iconColor={colors.text}
                  onPress={increaseVisibleCount}
                  disabled={activeVisibleCount >= MAX_VISIBLE_COUNT}
                  className="h-9 w-9 min-h-9 min-w-9"
                  style={{ backgroundColor: colors.control, borderColor: colors.border }}
                />
              </View>
            </View>
          </View>
          )}

          <View
            className="relative flex-1"
            onLayout={handleReaderLayout}
            {...readerPanResponder.panHandlers}
          >
            <Pressable
              style={{ flex: 1 }}
              disabled={overlayOpen}
              onPress={handleReaderPress}
            >
              <View style={{ flex: 1, position: "relative" }}>
                {preloadedColumns.map(({ column, isActive }) => (
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
                      columnWidth={viewportWidth}
                      readerHeight={readerHeight}
                      slotHeight={slotHeight}
                      allStrips={strips}
                      showSeparators={chromeVisible}
                      editing={editing && isActive}
                      splitAvailable={splitAvailable}
                      inverted={darkMode}
                      onMergeUp={handleMergeUp}
                      onSplit={handleSplitRequest}
                      onDelete={handleDelete}
                    />
                  </View>
                ))}
              </View>
            </Pressable>

            {splitTarget && (
              <SplitOverlay
                strip={splitTarget}
                inverted={darkMode}
                onConfirm={handleSplitConfirm}
                onCancel={handleSplitCancel}
              />
            )}

            {showGarbage && (
              <GarbageOverlay
                garbage={garbage}
                inverted={darkMode}
                onRestore={handleRestoreFromGarbage}
                onClose={() => setShowGarbage(false)}
              />
            )}
          </View>
        </View>
      )}

      {phase === "idle" && strips.length === 0 && !errorMessage && (
        <View className="flex-1 px-4 py-6">
          {recents.length > 0 && (
            <View
              className="mb-6 rounded-xl border"
              style={{ borderColor: colors.border, backgroundColor: colors.surfaceElevated }}
            >
              <Text
                className="border-b px-4 py-3 text-sm font-semibold"
                style={{ color: colors.text, borderBottomColor: colors.border }}
              >
                Recent
              </Text>
              {recents.map((score) => (
                <Pressable
                  key={score.id}
                  onPress={() => openSavedScore(score.id)}
                  className="border-b px-4 py-3 last:border-b-0"
                  style={{ borderBottomColor: colors.border }}
                >
                  <Text className="text-base font-medium" style={{ color: colors.text }} numberOfLines={1}>
                    {score.title}
                  </Text>
                  <Text className="mt-1 text-sm" style={{ color: colors.textMuted }}>
                    {formatScoreDate(score.createdAt)} · {score.stripCount}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <View className="flex-1 items-center justify-center px-2">
            <Text className="text-center text-base" style={{ color: colors.textMuted }}>
              Pick a PDF or photos to start.
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
    </View>
  );
}
