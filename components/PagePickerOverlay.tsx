import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getPdfPagePreview, type PagePreview } from "piano-pdf-parser-core";
import { ArrowDownUp, CheckSquare, Moon, Play, Square, Sun, X } from "lucide-react-native";

import { IconButton } from "./IconButton";
import { MusicImage } from "./MusicImage";
import { useTheme } from "../lib/theme";

type PageImportMode = "pdf" | "photos";

type PagePickerOverlayProps = {
  importMode: PageImportMode;
  pdfUri?: string;
  fileName: string;
  previews: PagePreview[];
  reorderMode: boolean;
  orderSequence: number[];
  selectedPageIndices: Set<number>;
  onToggleReorderMode: () => void;
  onTogglePage: (pageIndex: number) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onCancel: () => void;
  onProcess: () => void;
};

type ZoomState = {
  pageIndex: number;
  preview: PagePreview | null;
  loading: boolean;
};

const GRID_COLUMNS = 3;
const GRID_GAP = 10;
const LONG_PRESS_DELAY_MS = 250;
const ZOOM_FADE_MS = 150;

export function PagePickerOverlay({
  importMode,
  pdfUri,
  fileName,
  previews,
  reorderMode,
  orderSequence,
  selectedPageIndices,
  onToggleReorderMode,
  onTogglePage,
  onSelectAll,
  onClear,
  onCancel,
  onProcess,
}: PagePickerOverlayProps) {
  const { darkMode, toggleDarkMode, colors } = useTheme();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const horizontalPadding = 16;
  const tileWidth =
    (viewportWidth - horizontalPadding * 2 - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  const selectedCount = reorderMode ? orderSequence.length : selectedPageIndices.size;
  const [zoomState, setZoomState] = useState<ZoomState | null>(null);
  const zoomRequestIdRef = useRef(0);
  const zoomStateRef = useRef<ZoomState | null>(null);
  const zoomOpacity = useRef(new Animated.Value(0)).current;
  const zoomAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  zoomStateRef.current = zoomState;

  const stopZoomAnimation = useCallback(() => {
    zoomAnimationRef.current?.stop();
    zoomAnimationRef.current = null;
  }, []);

  const fadeZoomIn = useCallback(() => {
    stopZoomAnimation();
    zoomOpacity.setValue(0);
    zoomAnimationRef.current = Animated.timing(zoomOpacity, {
      toValue: 1,
      duration: ZOOM_FADE_MS,
      useNativeDriver: true,
    });
    zoomAnimationRef.current.start(() => {
      zoomAnimationRef.current = null;
    });
  }, [stopZoomAnimation, zoomOpacity]);

  const fadeZoomOut = useCallback(
    (onComplete: () => void) => {
      stopZoomAnimation();
      zoomAnimationRef.current = Animated.timing(zoomOpacity, {
        toValue: 0,
        duration: ZOOM_FADE_MS,
        useNativeDriver: true,
      });
      zoomAnimationRef.current.start(({ finished }) => {
        zoomAnimationRef.current = null;
        if (finished) {
          onComplete();
        }
      });
    },
    [stopZoomAnimation, zoomOpacity]
  );

  const openZoom = useCallback(
    (state: ZoomState) => {
      setZoomState(state);
      fadeZoomIn();
    },
    [fadeZoomIn]
  );

  const closeZoom = useCallback(() => {
    zoomRequestIdRef.current += 1;
    if (!zoomStateRef.current) {
      return;
    }
    fadeZoomOut(() => {
      setZoomState(null);
      zoomOpacity.setValue(0);
    });
  }, [fadeZoomOut, zoomOpacity]);

  useEffect(() => {
    return () => {
      stopZoomAnimation();
    };
  }, [stopZoomAnimation]);

  const handleLongPress = useCallback(
    (pageIndex: number) => {
      const gridPreview = previews.find((preview) => preview.pageIndex === pageIndex);
      if (importMode === "photos") {
        if (!gridPreview) {
          return;
        }
        openZoom({ pageIndex, preview: gridPreview, loading: false });
        return;
      }

      if (!pdfUri) {
        return;
      }

      const requestId = zoomRequestIdRef.current + 1;
      zoomRequestIdRef.current = requestId;
      openZoom({ pageIndex, preview: null, loading: true });

      void getPdfPagePreview(pdfUri, pageIndex)
        .then((preview) => {
          if (zoomRequestIdRef.current !== requestId) {
            return;
          }
          setZoomState({ pageIndex, preview, loading: false });
        })
        .catch(() => {
          if (zoomRequestIdRef.current !== requestId) {
            return;
          }
          fadeZoomOut(() => {
            setZoomState(null);
            zoomOpacity.setValue(0);
          });
        });
    },
    [fadeZoomOut, importMode, openZoom, pdfUri, previews, zoomOpacity]
  );

  const countLabel = reorderMode
    ? `${selectedCount} in order`
    : `${selectedCount} / ${previews.length}`;

  return (
    <View className="absolute inset-0 z-30" style={{ backgroundColor: colors.background }}>
      <SafeAreaView className="flex-1">
        <View className="border-b px-4 py-3" style={{ borderBottomColor: colors.border }}>
          <Text className="text-base font-semibold" style={{ color: colors.text }} numberOfLines={1}>
            Pages
          </Text>
          <Text className="mt-1 text-xs" style={{ color: colors.textMuted }} numberOfLines={1}>
            {fileName}
          </Text>
          <Text className="mt-1 text-xs" style={{ color: colors.textMuted }}>{countLabel}</Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <IconButton
              icon={darkMode ? Sun : Moon}
              label={darkMode ? "Light mode" : "Dark mode"}
              iconColor={colors.text}
              onPress={toggleDarkMode}
              style={{ backgroundColor: colors.control, borderColor: colors.border }}
            />
            <IconButton
              icon={ArrowDownUp}
              label={reorderMode ? "Done reordering" : "Reorder pages"}
              iconColor={reorderMode ? colors.controlActiveText : colors.text}
              onPress={onToggleReorderMode}
              style={{
                backgroundColor: reorderMode ? colors.controlActive : colors.control,
                borderColor: colors.border,
              }}
            />
            <IconButton
              icon={CheckSquare}
              label="Select all pages"
              iconColor={colors.text}
              onPress={onSelectAll}
              style={{ backgroundColor: colors.control, borderColor: colors.border }}
            />
            <IconButton
              icon={Square}
              label="Clear selection"
              iconColor={colors.text}
              onPress={onClear}
              style={{ backgroundColor: colors.control, borderColor: colors.border }}
            />
            <IconButton
              icon={X}
              label="Cancel"
              iconColor={colors.text}
              onPress={onCancel}
              style={{ backgroundColor: colors.control, borderColor: colors.border }}
            />
            <IconButton
              icon={Play}
              label="Process selected pages"
              iconColor={selectedCount === 0 ? colors.textMuted : colors.controlActiveText}
              onPress={onProcess}
              disabled={selectedCount === 0}
              style={{
                backgroundColor: selectedCount === 0 ? colors.border : colors.controlActive,
                borderColor: colors.border,
              }}
            />
          </View>
        </View>

        <FlatList
          data={previews}
          keyExtractor={(item) => `page-${item.pageIndex}`}
          numColumns={GRID_COLUMNS}
          contentContainerStyle={{
            paddingHorizontal: horizontalPadding,
            paddingVertical: 16,
            gap: GRID_GAP,
          }}
          columnWrapperStyle={{ gap: GRID_GAP }}
          renderItem={({ item }) => {
            const sequencePosition = reorderMode
              ? orderSequence.indexOf(item.pageIndex)
              : -1;
            const inSequence = sequencePosition >= 0;
            const selected = reorderMode
              ? inSequence
              : selectedPageIndices.has(item.pageIndex);
            const aspectRatio = item.width > 0 ? item.width / item.height : 0.7;
            const tileHeight = tileWidth / aspectRatio;
            const caption =
              reorderMode && inSequence
                ? importMode === "pdf"
                  ? `${sequencePosition + 1} · p. ${item.pageIndex + 1}`
                  : String(sequencePosition + 1)
                : importMode === "pdf"
                  ? `p. ${item.pageIndex + 1}`
                  : null;

            return (
              <Pressable
                onPress={() => onTogglePage(item.pageIndex)}
                onLongPress={() => handleLongPress(item.pageIndex)}
                delayLongPress={LONG_PRESS_DELAY_MS}
                onPressOut={closeZoom}
                className="overflow-hidden rounded-lg border"
                style={{
                  width: tileWidth,
                  borderColor: colors.border,
                  backgroundColor: darkMode ? "#000000" : "#FFFFFF",
                }}
              >
                <View style={{ opacity: selected ? 1 : 0.35 }}>
                  <MusicImage
                    source={{ uri: item.uri }}
                    style={{ width: tileWidth, height: tileHeight }}
                    contentFit="contain"
                    recyclingKey={item.uri}
                    inverted={darkMode}
                  />
                </View>
                <View
                  className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: selected ? colors.controlActive : colors.control,
                  }}
                >
                  {reorderMode && inSequence ? (
                    <Text
                      className="text-xs font-bold"
                      style={{ color: selected ? colors.controlActiveText : colors.textMuted }}
                    >
                      {sequencePosition + 1}
                    </Text>
                  ) : selected ? (
                    <Text className="text-xs font-bold" style={{ color: colors.controlActiveText }}>
                      ✓
                    </Text>
                  ) : null}
                </View>
                {caption !== null && (
                  <View
                    className="border-t px-2 py-1"
                    style={{
                      borderTopColor: colors.border,
                      backgroundColor: darkMode ? colors.background : colors.surfaceElevated,
                    }}
                  >
                    <Text className="text-center text-xs font-medium" style={{ color: colors.text }}>
                      {caption}
                    </Text>
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      </SafeAreaView>

      {zoomState && (
        <Animated.View
          style={{ opacity: zoomOpacity }}
          className="absolute inset-0 z-40 items-center justify-center bg-black/90 px-4"
          pointerEvents="none"
        >
          {zoomState.loading ? (
            <ActivityIndicator size="large" color={colors.text} />
          ) : zoomState.preview ? (
            <View className="w-full flex-1 items-center justify-center">
              <MusicImage
                source={{ uri: zoomState.preview.uri }}
                style={{
                  width: viewportWidth - 32,
                  height: Math.min(
                    viewportHeight - 120,
                    (viewportWidth - 32) *
                      (zoomState.preview.height / Math.max(zoomState.preview.width, 1))
                  ),
                }}
                contentFit="contain"
                recyclingKey={zoomState.preview.uri}
                inverted={darkMode}
              />
              <Text className="mt-3 text-sm font-medium" style={{ color: colors.text }}>
                {zoomState.pageIndex + 1}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      )}
    </View>
  );
}
