import { Fragment } from "react";
import { View } from "react-native";

import {
  DEFAULT_ASPECT_RATIO,
  overlapPxWithNext,
  type ReaderStrip,
  type StripColumn,
} from "../lib/corrections";
import { StripRow } from "./StripRow";
import { StripSeparator } from "./StripSeparator";

type StripColumnViewProps = {
  column: StripColumn;
  columnWidth: number;
  readerHeight: number;
  slotHeight: number;
  allStrips: ReaderStrip[];
  showSeparators?: boolean;
  editing?: boolean;
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
  splitAvailable = true,
  inverted = false,
  onMergeUp,
  onSplit,
  onDelete,
}: StripColumnViewProps) {
  const resolvedSlotHeight =
    slotHeight > 0 ? slotHeight : columnWidth / DEFAULT_ASPECT_RATIO;

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
          nextStrip !== undefined && nextStrip.pageIndex !== strip.pageIndex;
        const hideBottomOverlapPx =
          nextInColumn !== undefined ? overlapPxWithNext(strip, nextInColumn) : 0;

        return (
          <Fragment key={strip.id}>
            {index > 0 && showSeparators && <StripSeparator />}
            <StripRow
              strip={strip}
              width={columnWidth}
              height={resolvedSlotHeight}
              hideBottomOverlapPx={hideBottomOverlapPx}
              extraPageBreakSpacing={extraPageBreakSpacing}
              editing={editing}
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
    </View>
  );
}
