import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import {
  addProgressListener,
  getPdfPagePreviews,
  processImages,
  processPdf,
  type PagePreview,
  type ProgressEvent,
} from "piano-pdf-parser-core";

import { pageBookmarks, type Bookmark } from "../lib/bookmarks";
import { relabelPages, toReaderStrips, type ReaderStrip } from "../lib/corrections";
import { errorFromUnknown } from "../lib/errors";
import { buildImagePreviews, copyImagesToAppCache } from "../lib/images";
import { copyPdfToAppCache, isPdfAsset, pickerCopyToCacheDirectory } from "../lib/pdf";

export type AppPhase =
  | "idle"
  | "copying"
  | "loadingPreviews"
  | "choosing"
  | "processing"
  | "done"
  | "error";
export type PageImportMode = "pdf" | "photos";

type PageImportOptions = {
  phase: AppPhase;
  setPhase: Dispatch<SetStateAction<AppPhase>>;
  setStrips: Dispatch<SetStateAction<ReaderStrip[]>>;
  setGarbage: Dispatch<SetStateAction<ReaderStrip[]>>;
  setSelectedName: Dispatch<SetStateAction<string | null>>;
  setBookmarks: Dispatch<SetStateAction<Bookmark[]>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  // Clears the open score before a new import starts.
  onBeginImport: () => void;
};

/**
 * Importing a score: pick a PDF or photos, choose (and optionally reorder) the
 * pages, then slice them into systems.
 */
export function usePageImport({
  phase,
  setPhase,
  setStrips,
  setGarbage,
  setSelectedName,
  setBookmarks,
  setErrorMessage,
  onBeginImport,
}: PageImportOptions) {
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [pageImportMode, setPageImportMode] = useState<PageImportMode>("pdf");
  const [pendingPdfUri, setPendingPdfUri] = useState<string | null>(null);
  const [pendingImageUris, setPendingImageUris] = useState<string[]>([]);
  const [pagePreviews, setPagePreviews] = useState<PagePreview[]>([]);
  const [selectedPageIndices, setSelectedPageIndices] = useState<Set<number>>(new Set());
  const [reorderMode, setReorderMode] = useState(false);
  const [orderSequence, setOrderSequence] = useState<number[]>([]);
  const [bookmarkMode, setBookmarkMode] = useState(false);
  // Picker pages marked as where a piece starts.
  const [bookmarkedPages, setBookmarkedPages] = useState<Set<number>>(new Set());
  const progressSubscription = useRef<ReturnType<typeof addProgressListener> | null>(null);

  const clearProgressSubscription = useCallback(() => {
    progressSubscription.current?.remove();
    progressSubscription.current = null;
  }, []);

  useEffect(() => clearProgressSubscription, [clearProgressSubscription]);

  const reset = useCallback(() => {
    setProgress(null);
    setPageImportMode("pdf");
    setPendingPdfUri(null);
    setPendingImageUris([]);
    setPagePreviews([]);
    setSelectedPageIndices(new Set());
    setReorderMode(false);
    setOrderSequence([]);
    setBookmarkMode(false);
    setBookmarkedPages(new Set());
  }, []);

  const showSlicedScore = useCallback(
    (sliced: ReaderStrip[], slicedGarbage: ReaderStrip[], bookmarks: Bookmark[]) => {
      setStrips(sliced);
      setGarbage(slicedGarbage);
      setBookmarks(bookmarks);
      setPhase("done");
    },
    [setBookmarks, setGarbage, setPhase, setStrips]
  );

  const clearPageSelection = useCallback(() => {
    setPageImportMode("pdf");
    setPendingPdfUri(null);
    setPendingImageUris([]);
    setPagePreviews([]);
    setSelectedPageIndices(new Set());
    setReorderMode(false);
    setOrderSequence([]);
    setBookmarkMode(false);
    setBookmarkedPages(new Set());
    setPhase("idle");
  }, [setPhase]);

  const processSelectedPages = useCallback(
    async (cachedUri: string, pageIndices: number[], bookmarks: Bookmark[]) => {
      clearProgressSubscription();
      progressSubscription.current = addProgressListener((event) => {
        setProgress(event);
      });

      setPhase("processing");
      try {
        const { strips: nextStrips, garbage: nextGarbage } = await processPdf(cachedUri, {
          pageIndices,
        });
        setPageImportMode("pdf");
        setPendingPdfUri(null);
        setPendingImageUris([]);
        setPagePreviews([]);
        setSelectedPageIndices(new Set());
        // Strips come back labelled with PDF page numbers; use import positions so a
        // chosen page order survives (strips are sorted by page) and matches bookmarks.
        showSlicedScore(
          toReaderStrips(relabelPages(nextStrips, pageIndices)),
          toReaderStrips(relabelPages(nextGarbage ?? [], pageIndices)),
          bookmarks
        );
      } catch (error) {
        setPhase("error");
        setErrorMessage(errorFromUnknown(error));
      } finally {
        clearProgressSubscription();
        setProgress(null);
      }
    },
    [clearProgressSubscription, setErrorMessage, setPhase, showSlicedScore]
  );

  const processSelectedImages = useCallback(
    async (imageUris: string[], bookmarks: Bookmark[]) => {
      clearProgressSubscription();
      progressSubscription.current = addProgressListener((event) => {
        setProgress(event);
      });

      setPhase("processing");
      try {
        const { strips: nextStrips, garbage: nextGarbage } = await processImages(imageUris);
        setPageImportMode("pdf");
        setPendingPdfUri(null);
        setPendingImageUris([]);
        setPagePreviews([]);
        setSelectedPageIndices(new Set());
        // Photos are already labelled by import position.
        showSlicedScore(toReaderStrips(nextStrips), toReaderStrips(nextGarbage ?? []), bookmarks);
      } catch (error) {
        setPhase("error");
        setErrorMessage(errorFromUnknown(error));
      } finally {
        clearProgressSubscription();
        setProgress(null);
      }
    },
    [clearProgressSubscription, setErrorMessage, setPhase, showSlicedScore]
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

    onBeginImport();
    reset();

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
  }, [onBeginImport, reset, setErrorMessage, setPhase, setSelectedName]);

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

    onBeginImport();
    reset();

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
  }, [onBeginImport, reset, setErrorMessage, setPhase, setSelectedName]);

  const toggleBookmark = useCallback((pageIndex: number) => {
    setBookmarkedPages((current) => {
      const next = new Set(current);
      if (next.has(pageIndex)) {
        next.delete(pageIndex);
      } else {
        next.add(pageIndex);
      }
      return next;
    });
  }, []);

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
    setBookmarkMode(false);
    setReorderMode(true);
  }, [orderSequence, pagePreviews, reorderMode, selectedPageIndices]);

  // Bookmarking and reordering both take over page taps, so one ends the other.
  const handleToggleBookmarkMode = useCallback(() => {
    if (!bookmarkMode && reorderMode) {
      handleToggleReorderMode();
    }
    setBookmarkMode(!bookmarkMode);
  }, [bookmarkMode, handleToggleReorderMode, reorderMode]);

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
    const bookmarks = pageBookmarks(orderedPageIndices, bookmarkedPages);

    if (pageImportMode === "photos") {
      const imageUris = orderedPageIndices
        .map((pageIndex) => pendingImageUris[pageIndex])
        .filter((uri): uri is string => typeof uri === "string" && uri.length > 0);
      if (imageUris.length === 0) {
        return;
      }
      void processSelectedImages(imageUris, bookmarks);
      return;
    }

    if (!pendingPdfUri) {
      return;
    }

    void processSelectedPages(pendingPdfUri, orderedPageIndices, bookmarks);
  }, [
    bookmarkedPages,
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

  // Busy covers the full-screen spinner; pickBusy also covers the page picker.
  const busy = phase === "copying" || phase === "loadingPreviews" || phase === "processing";
  const pickBusy = busy || phase === "choosing";
  const busyMessage =
    phase === "copying"
      ? pageImportMode === "photos"
        ? "Copying photos…"
        : "Copying PDF…"
      : phase === "loadingPreviews"
        ? "Loading pages…"
        : progress
          ? `Slicing ${pageImportMode === "photos" ? "image" : "page"} ${progress.pageIndex + 1} of ${progress.pageCount}…`
          : "Slicing…";
  const pickerReady =
    phase === "choosing" &&
    pagePreviews.length > 0 &&
    (pageImportMode === "pdf" ? pendingPdfUri !== null : pendingImageUris.length > 0);

  return {
    busy,
    pickBusy,
    busyMessage,
    pickerReady,
    pageImportMode,
    pendingPdfUri,
    pagePreviews,
    reorderMode,
    orderSequence,
    selectedPageIndices,
    bookmarkMode,
    bookmarkedPages,
    handleToggleBookmarkMode,
    toggleBookmark,
    reset,
    clearPageSelection,
    handlePickPdf,
    handlePickPhotos,
    handleToggleReorderMode,
    handleTogglePage,
    handleSelectAllPages,
    handleClearPageSelection,
    handleProcessSelectedPages,
  };
}
