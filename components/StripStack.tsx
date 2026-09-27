import { View } from "react-native";

import { MusicImage } from "./MusicImage";
import { mergedPartLayouts, type ReaderStrip } from "../lib/corrections";

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

  if (clipFraction <= 0 || clipFraction >= 1) {
    return (
      <MusicImage
        source={{ uri }}
        style={{ width: "100%", height }}
        contentFit="fill"
        recyclingKey={uri}
        inverted={inverted}
      />
    );
  }

  const imageHeight = height / (1 - clipFraction);
  return (
    <View style={{ width, height, overflow: "hidden" }}>
      <MusicImage
        source={{ uri }}
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
  const totalStackSpan = layouts.reduce((sum, layout) => sum + layout.stackSpan, 0);

  return (
    <View style={{ width, height }}>
      {layouts.map((layout, index) => {
        const partHeight =
          totalStackSpan > 0
            ? (layout.stackSpan / totalStackSpan) * height
            : height / layouts.length;
        const isLast = index === layouts.length - 1;

        return (
          <ClippedStripImage
            key={layout.part.id}
            uri={layout.part.uri}
            width={width}
            height={partHeight}
            hideBottomOverlapPx={
              isLast ? hideBottomOverlapPx : layout.hideBottomOverlapPx
            }
            sourceHeight={layout.part.height}
            inverted={inverted}
          />
        );
      })}
    </View>
  );
}
