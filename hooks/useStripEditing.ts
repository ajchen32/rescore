import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

import {
  mergeWithAbove,
  moveToGarbage,
  replaceAt,
  restoreFromGarbage,
  type ReaderStrip,
} from "../lib/corrections";
import { errorFromUnknown } from "../lib/errors";
import { isSplitAvailable, SPLIT_REBUILD_MESSAGE, splitStripAtRatios } from "../lib/splitStrip";

type StripEditingOptions = {
  strips: ReaderStrip[];
  garbage: ReaderStrip[];
  setStrips: Dispatch<SetStateAction<ReaderStrip[]>>;
  setGarbage: Dispatch<SetStateAction<ReaderStrip[]>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
};

/** Edit mode: merge, split and delete systems, and the removed-systems list. */
export function useStripEditing({
  strips,
  garbage,
  setStrips,
  setGarbage,
  setErrorMessage,
}: StripEditingOptions) {
  const [editing, setEditing] = useState(false);
  const [splitTargetIndex, setSplitTargetIndex] = useState<number | null>(null);
  const [showGarbage, setShowGarbage] = useState(false);

  const splitTarget = splitTargetIndex !== null ? strips[splitTargetIndex] : null;
  const splitAvailable = isSplitAvailable();

  const toggleEditing = useCallback(() => {
    if (editing) {
      setEditing(false);
      setSplitTargetIndex(null);
    } else {
      setEditing(true);
    }
  }, [editing]);

  const reset = useCallback(() => {
    setEditing(false);
    setSplitTargetIndex(null);
    setShowGarbage(false);
  }, []);

  const handleMergeUp = useCallback(
    (index: number) => {
      setStrips((current) => mergeWithAbove(current, index));
    },
    [setStrips]
  );

  const handleDelete = useCallback(
    (index: number) => {
      const next = moveToGarbage(strips, garbage, index);
      setStrips(next.strips);
      setGarbage(next.garbage);
    },
    [garbage, setGarbage, setStrips, strips]
  );

  const handleRestoreFromGarbage = useCallback(
    (garbageIndex: number) => {
      const next = restoreFromGarbage(strips, garbage, garbageIndex);
      setStrips(next.strips);
      setGarbage(next.garbage);
    },
    [garbage, setGarbage, setStrips, strips]
  );

  const handleSplitRequest = useCallback(
    (index: number) => {
      if (!splitAvailable) {
        setErrorMessage(SPLIT_REBUILD_MESSAGE);
        return;
      }
      setSplitTargetIndex(index);
    },
    [setErrorMessage, splitAvailable]
  );

  const handleSplitCancel = useCallback(() => {
    setSplitTargetIndex(null);
    setErrorMessage(null);
  }, [setErrorMessage]);

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
    [setErrorMessage, setStrips, splitTargetIndex, strips]
  );

  return {
    editing,
    setEditing,
    toggleEditing,
    splitTargetIndex,
    setSplitTargetIndex,
    splitTarget,
    splitAvailable,
    showGarbage,
    setShowGarbage,
    reset,
    handleMergeUp,
    handleDelete,
    handleRestoreFromGarbage,
    handleSplitRequest,
    handleSplitCancel,
    handleSplitConfirm,
  };
}
