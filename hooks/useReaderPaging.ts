import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  PanResponder,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";

import {
  chunkStrips,
  clampVisibleCount,
  DEFAULT_LANDSCAPE_VISIBLE_COUNT,
  DEFAULT_VISIBLE_COUNT,
  stripSlotHeight,
  type ReaderStrip,
} from "../lib/corrections";

const CHROME_SWIPE_THRESHOLD = 36;
const SWIPE_BACK_THRESHOLD = 36;

type ReaderLayoutSnapshot = {
  width: number;
  height: number;
  portraitVisibleCount: number;
  landscapeVisibleCount: number;
};

type ReaderPagingOptions = {
  strips: ReaderStrip[];
  portraitVisibleCount: number;
  landscapeVisibleCount: number;
  setPortraitVisibleCount: Dispatch<SetStateAction<number>>;
  setLandscapeVisibleCount: Dispatch<SetStateAction<number>>;
  overlayOpen: boolean;
  setChromeVisible: Dispatch<SetStateAction<boolean>>;
  bumpBar: () => void;
};

/**
 * Which column of systems is on screen, and the taps, swipes and rotation
 * handling that move between columns.
 */
export function useReaderPaging({
  strips,
  portraitVisibleCount,
  landscapeVisibleCount,
  setPortraitVisibleCount,
  setLandscapeVisibleCount,
  overlayOpen,
  setChromeVisible,
  bumpBar,
}: ReaderPagingOptions) {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const isLandscape = viewportWidth > viewportHeight;
  const [readerHeight, setReaderHeight] = useState(0);
  const [columnIndex, setColumnIndex] = useState(0);
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
  // Separators overlay the strip boundaries, so they take no layout space.
  const slotHeight = stripSlotHeight(readerHeight, activeVisibleCount);

  // The pan responder is created once, so it reads these through refs.
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

  // Taps turn pages: the left third goes back, the rest forward.
  const handleReaderPress = useCallback(
    (event: GestureResponderEvent) => {
      bumpBar();
      const tapX = event.nativeEvent.locationX;
      if (tapX < viewportWidth / 3) {
        goToPreviousColumn();
        return;
      }
      goToNextColumn();
    },
    [bumpBar, goToNextColumn, goToPreviousColumn, viewportWidth]
  );

  const goToPreviousColumnRef = useRef(goToPreviousColumn);
  goToPreviousColumnRef.current = goToPreviousColumn;

  // A vertical swipe toggles the bar; a swipe to the right goes back a page.
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

  // On rotation, keep the first visible system on screen.
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

  const decreaseVisibleCount = useCallback(() => {
    if (isLandscape) {
      setLandscapeVisibleCount((count) => clampVisibleCount(count - 1));
    } else {
      setPortraitVisibleCount((count) => clampVisibleCount(count - 1));
    }
    setColumnIndex(0);
  }, [isLandscape, setLandscapeVisibleCount, setPortraitVisibleCount]);

  const increaseVisibleCount = useCallback(() => {
    if (isLandscape) {
      setLandscapeVisibleCount((count) => clampVisibleCount(count + 1));
    } else {
      setPortraitVisibleCount((count) => clampVisibleCount(count + 1));
    }
    setColumnIndex(0);
  }, [isLandscape, setLandscapeVisibleCount, setPortraitVisibleCount]);

  return {
    activeVisibleCount,
    preloadedColumns,
    readerHeight,
    slotHeight,
    setColumnIndex,
    handleReaderLayout,
    handleReaderPress,
    panHandlers: readerPanResponder.panHandlers,
    decreaseVisibleCount,
    increaseVisibleCount,
  };
}
