import { useCallback, useEffect, useState } from "react";

const BAR_AUTO_HIDE_MS = 4000;

type ReaderBarOptions = {
  showReader: boolean;
  editing: boolean;
  overlayOpen: boolean;
};

/**
 * The reader opens full screen; the floating bar shows on a vertical swipe or
 * the corner handle, and hides itself again after a few idle seconds.
 */
export function useReaderBar({ showReader, editing, overlayOpen }: ReaderBarOptions) {
  const [chromeVisible, setChromeVisible] = useState(false);
  const [barMenuOpen, setBarMenuOpen] = useState(false);
  const [barActivity, setBarActivity] = useState(0);

  // Any interaction restarts the auto-hide timer.
  const bumpBar = useCallback(() => {
    setBarActivity((count) => count + 1);
  }, []);

  const showBar = useCallback(() => {
    setChromeVisible(true);
    bumpBar();
  }, [bumpBar]);

  const reset = useCallback(() => {
    setChromeVisible(false);
    setBarMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!showReader || !chromeVisible || editing || barMenuOpen || overlayOpen) {
      return undefined;
    }
    const timer = setTimeout(() => setChromeVisible(false), BAR_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [barActivity, barMenuOpen, chromeVisible, editing, overlayOpen, showReader]);

  return { chromeVisible, setChromeVisible, setBarMenuOpen, bumpBar, showBar, reset };
}
