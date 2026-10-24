import { Fragment, useMemo } from "react";
import { View } from "react-native";

import {
  continuesOnSamePage,
  DEFAULT_ASPECT_RATIO,
  overlapPxWithNext,
  pageFrames,
  stripInsets,
  type ReaderStrip,
  type StripColumn,
} from "../lib/corrections";
import { StripRow } from "./StripRow";
import { StripSeparator } from "./StripSeparator";
import { STRIP_SEPARATOR_HEIGHT } from "../lib/corrections";

type StripColumnViewProps = {
  column: StripColumn;
  columnWidth: number;
  readerHeight: number;
  slotHeight: number;
  allStrips: ReaderStrip[];
  showSeparators?: boolean;
  editing?: boolean;
  // Top offset for the first strip's edit controls, so they clear the reader bar.
  firstControlsTop?: number;
  splitAvailable?: boolean;
  inverted?: boolean;
  onMergeUp?: (index: number) => void;
  onSplit?: (index: number) => void;
  onDelete?: (index: number) => void;
};

export function StripColumnView({
  column,
  columnWidth,
  readerHeight,
  slotHeight,
  allStrips,
  showSeparators = true,
  editing = false,
  firstControlsTop,
  splitAvailable = true,
  inverted = false,
  onMergeUp,
  onSplit,
  onDelete,
}: StripColumnViewProps) {
  const resolvedSlotHeight =
    slotHeight > 0 ? slotHeight : columnWidth / DEFAULT_ASPECT_RATIO;
  const frames = useMemo(() => pageFrames(allStrips), [allStrips]);

  return (
    <View
      style={{
        width: columnWidth,
        height: readerHeight,
        backgroundColor: inverted ? "#000000" : "#FFFFFF",
      }}
    >
      {column.strips.map((strip, index) => {
        const globalIndex = column.startIndex + index;
        const nextStrip = allStrips[globalIndex + 1];
        const nextInColumn = column.strips[index + 1];
        const extraPageBreakSpacing =
          nextStrip !== undefined && !continuesOnSamePage(strip, nextStrip);
        const hideBottomOverlapPx =
          nextInColumn !== undefined ? overlapPxWithNext(strip, nextInColumn) : 0;

        return (
          <Fragment key={strip.id}>
            <StripRow
              strip={strip}
              width={columnWidth}
              height={resolvedSlotHeight}
              hideBottomOverlapPx={hideBottomOverlapPx}
              insets={stripInsets(strip, frames)}
              extraPageBreakSpacing={extraPageBreakSpacing}
              editing={editing}
              controlsTop={index === 0 ? firstControlsTop : undefined}
              splitAvailable={splitAvailable}
              inverted={inverted}
              globalIndex={globalIndex}
              canDelete={allStrips.length > 1}
              onMergeUp={() => onMergeUp?.(globalIndex)}
              onSplit={() => onSplit?.(globalIndex)}
              onDelete={() => onDelete?.(globalIndex)}
            />
          </Fragment>
        );
      })}
      {/* Drawn over the boundary, not between strips, so toggling them never moves the music. */}
      {showSeparators &&
        column.strips.slice(1).map((strip, index) => (
          <View
            key={`separator-${strip.id}`}
            pointerEvents="none"
            className="absolute left-0 right-0"
            style={{ top: (index + 1) * resolvedSlotHeight - STRIP_SEPARATOR_HEIGHT / 2 }}
          >
            <StripSeparator />
          </View>
        ))}
    </View>
  );
}
