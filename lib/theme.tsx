import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import { colorScheme } from "nativewind";

import { loadRememberedDarkMode, rememberDarkMode } from "./splitPreferences";

export type ThemeColors = {
  background: string;
  surfaceElevated: string;
  text: string;
  textMuted: string;
  border: string;
  control: string;
  controlActive: string;
  controlActiveText: string;
  needsReview: string;
  needsReviewBg: string;
  destructive: string;
  destructiveBg: string;
};

const LIGHT_COLORS: ThemeColors = {
  background: "#F2F1EE",
  surfaceElevated: "#FFFFFF",
  text: "#232220",
  textMuted: "#6B6862",
  border: "#D8D5CE",
  control: "#E4E2DD",
  controlActive: "#232220",
  controlActiveText: "#F2F1EE",
  needsReview: "#B8863B",
  needsReviewBg: "#F3E6CE",
  destructive: "#A6483F",
  destructiveBg: "#F2E0DD",
};

const DARK_COLORS: ThemeColors = {
  background: "#1B1A18",
  surfaceElevated: "#242220",
  text: "#EDEBE6",
  textMuted: "#9A968D",
  border: "#3A3733",
  control: "#2E2C29",
  controlActive: "#EDEBE6",
  controlActiveText: "#1B1A18",
  needsReview: "#D9A45C",
  needsReviewBg: "#3A2E1C",
  destructive: "#C97A70",
  destructiveBg: "#3A2622",
};

function getColors(darkMode: boolean): ThemeColors {
  return darkMode ? DARK_COLORS : LIGHT_COLORS;
}

export function colorWithAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type ThemeContextValue = {
  darkMode: boolean;
  toggleDarkMode: () => void;
  colors: ThemeColors;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const systemDarkMode = systemScheme === "dark";
  const [darkMode, setDarkMode] = useState(systemDarkMode);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const [hasSavedPreference, setHasSavedPreference] = useState(false);

  useEffect(() => {
    void loadRememberedDarkMode().then((saved) => {
      if (typeof saved === "boolean") {
        setDarkMode(saved);
        setHasSavedPreference(true);
      }
      setPreferenceLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!preferenceLoaded || hasSavedPreference) {
      return;
    }
    setDarkMode(systemDarkMode);
  }, [systemDarkMode, preferenceLoaded, hasSavedPreference]);

  useEffect(() => {
    colorScheme.set(darkMode ? "dark" : "light");
  }, [darkMode]);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((current) => {
      const next = !current;
      void rememberDarkMode(next);
      setHasSavedPreference(true);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      darkMode,
      toggleDarkMode,
      colors: getColors(darkMode),
    }),
    [darkMode, toggleDarkMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
