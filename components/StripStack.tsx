import { View } from "react-native";

import { MusicImage } from "./MusicImage";
import { useDisplayUri } from "../lib/displayImage";
import {
  mergedPartColumns,
  mergedPartLayouts,
  type ReaderStrip,
} from "../lib/corrections";

export function ClippedStripImage({
  uri,
  width,
  height,
  hideBottomOverlapPx,
  sourceHeight,
  inverted = false,
}: {
  uri: string;
  width: number;
  height: number;
  hideBottomOverlapPx: number;
  sourceHeight: number;
  inverted?: boolean;
}) {
  const clipFraction =
    hideBottomOverlapPx > 0 && sourceHeight > hideBottomOverlapPx
      ? hideBottomOverlapPx / sourceHeight
      : 0;
  const clipped = clipFraction > 0 && clipFraction < 1;
  const imageHeight = clipped ? height / (1 - clipFraction) : height;
  // recyclingKey stays on the strip's own uri: changing it would blank the view
  // while the resized copy loads.
  const displayUri = useDisplayUri(uri, width, imageHeight);

  if (!clipped) {
    return (
      <MusicImage
        source={{ uri: displayUri }}
        style={{ width: "100%", height }}
        contentFit="fill"
        recyclingKey={uri}
        inverted={inverted}
      />
    );
  }

  return (
    <View style={{ width, height, overflow: "hidden" }}>
      <MusicImage
        source={{ uri: displayUri }}
        style={{ width: "100%", height: imageHeight }}
        contentFit="fill"
        recyclingKey={uri}
        inverted={inverted}
      />
    </View>
  );
}

/**
 * Renders the parts of a merged strip stacked in the same geometry the split
 * math uses: each part occupies its `stackSpan` (its height minus the region it
 * duplicates from the next part), and that duplicated region is clipped away.
 */
export function StackedStripImages({
  parts,
  width,
  height,
  hideBottomOverlapPx = 0,
  inverted = false,
}: {
  parts: ReaderStrip[];
  width: number;
  height: number;
  hideBottomOverlapPx?: number;
  inverted?: boolean;
}) {
  const layouts = mergedPartLayouts(parts);
  const columns = mergedPartColumns(parts);
  // The last part also hides whatever it shares with the next strip, so its
  // span shrinks by that much; otherwise it is squeezed into less room than
  // the other parts and renders stretched.
  const stackSpans = layouts.map((layout, index) =>
    index === layouts.length - 1 && hideBottomOverlapPx < layout.part.height
      ? Math.max(1, layout.stackSpan - hideBottomOverlapPx)
      : layout.stackSpan
  );
  const totalStackSpan = stackSpans.reduce((sum, span) => sum + span, 0);

  return (
    <View style={{ width, height }}>
      {layouts.map((layout, index) => {
        const partHeight =
          totalStackSpan > 0
            ? (stackSpans[index] / totalStackSpan) * height
            : height / layouts.length;
        const isLast = index === layouts.length - 1;
        const partWidth = columns[index].widthFraction * width;

        return (
          <View
            key={layout.part.id}
            style={{
              width: partWidth,
              height: partHeight,
              marginLeft: columns[index].leftFraction * width,
            }}
          >
            <ClippedStripImage
              uri={layout.part.uri}
              width={partWidth}
              height={partHeight}
              hideBottomOverlapPx={
                isLast ? hideBottomOverlapPx : layout.hideBottomOverlapPx
              }
              sourceHeight={layout.part.height}
              inverted={inverted}
            />
          </View>
        );
      })}
    </View>
  );
}
