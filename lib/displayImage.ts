import { useEffect, useState } from "react";
import { PixelRatio } from "react-native";
import { resampleForDisplay } from "piano-pdf-parser-core";

const SIZE_SETTLE_MS = 120;

// Resized copies already produced this session, and requests still running,
// keyed by source uri and pixel size.
const resolved = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function displayKey(uri: string, width: number, height: number): string {
  return `${width}x${height}|${uri}`;
}

function requestDisplayUri(uri: string, width: number, height: number): Promise<string> {
  const key = displayKey(uri, width, height);
  const inFlight = pending.get(key);
  if (inFlight) {
    return inFlight;
  }

  const request = resampleForDisplay(uri, width, height)
    .then((displayUri) => {
      resolved.set(key, displayUri);
      return displayUri;
    })
    // Drawing the original is always a valid fallback.
    .catch(() => uri)
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, request);
  return request;
}

/**
 * The image to draw for strip `uri` in a `layoutWidth` x `layoutHeight` box:
 * a copy resized to the box's exact pixel size once it is ready. Until then it
 * keeps whatever this strip last showed (the original on first render), so a
 * size change never flashes blank.
 */
export function useDisplayUri(uri: string, layoutWidth: number, layoutHeight: number): string {
  const width = PixelRatio.getPixelSizeForLayoutSize(layoutWidth);
  const height = PixelRatio.getPixelSizeForLayoutSize(layoutHeight);
  const key = displayKey(uri, width, height);
  const [shown, setShown] = useState<{ sourceUri: string; displayUri: string }>(() => ({
    sourceUri: uri,
    displayUri: resolved.get(key) ?? uri,
  }));

  useEffect(() => {
    const cached = resolved.get(key);
    if (cached) {
      setShown({ sourceUri: uri, displayUri: cached });
      return undefined;
    }
    if (width <= 0 || height <= 0) {
      return undefined;
    }

    // Wait for the size to settle: the reader lays out once with a fallback slot
    // height, and +/- taps change it in quick succession.
    let cancelled = false;
    const timer = setTimeout(() => {
      void requestDisplayUri(uri, width, height).then((displayUri) => {
        if (!cancelled) {
          setShown({ sourceUri: uri, displayUri });
        }
      });
    }, SIZE_SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [height, key, uri, width]);

  const cached = resolved.get(key);
  if (cached) {
    return cached;
  }
  return shown.sourceUri === uri ? shown.displayUri : uri;
}
