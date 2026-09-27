import { File, Paths } from "expo-file-system";

import {
  clampOverlapRatio,
  DEFAULT_SPLIT_OVERLAP_RATIO,
} from "./splitStrip";

const PREFS_FILENAME = "split-preferences.json";

type Preferences = {
  overlapRatio?: number;
  darkMode?: boolean;
};

let rememberedOverlapRatio: number | null = null;
let rememberedDarkMode: boolean | undefined;
let darkModePreferenceLoaded = false;

function preferencesFile(): File {
  return new File(Paths.document, PREFS_FILENAME);
}

async function readPreferences(): Promise<Preferences> {
  const file = preferencesFile();
  if (!file.exists) {
    return {};
  }

  try {
    return JSON.parse(await file.text()) as Preferences;
  } catch {
    return {};
  }
}

async function writePreferences(): Promise<void> {
  const file = preferencesFile();
  if (!file.exists) {
    file.create();
  }
  file.write(
    JSON.stringify(
      {
        overlapRatio: getRememberedOverlapRatio(),
        ...(rememberedDarkMode !== undefined ? { darkMode: rememberedDarkMode } : {}),
      },
      null,
      2
    )
  );
}

export function getRememberedOverlapRatio(): number {
  return rememberedOverlapRatio ?? DEFAULT_SPLIT_OVERLAP_RATIO;
}

export async function loadRememberedOverlapRatio(): Promise<number> {
  if (rememberedOverlapRatio !== null) {
    return rememberedOverlapRatio;
  }

  const parsed = await readPreferences();
  rememberedOverlapRatio = clampOverlapRatio(
    typeof parsed.overlapRatio === "number"
      ? parsed.overlapRatio
      : DEFAULT_SPLIT_OVERLAP_RATIO
  );
  if (typeof parsed.darkMode === "boolean") {
    rememberedDarkMode = parsed.darkMode;
    darkModePreferenceLoaded = true;
  }

  return rememberedOverlapRatio;
}

export async function loadRememberedDarkMode(): Promise<boolean | undefined> {
  if (darkModePreferenceLoaded) {
    return rememberedDarkMode;
  }

  const parsed = await readPreferences();
  if (typeof parsed.overlapRatio === "number") {
    rememberedOverlapRatio = clampOverlapRatio(parsed.overlapRatio);
  }
  if (typeof parsed.darkMode === "boolean") {
    rememberedDarkMode = parsed.darkMode;
  }
  darkModePreferenceLoaded = true;

  return rememberedDarkMode;
}

export async function rememberOverlapRatio(ratio: number): Promise<void> {
  rememberedOverlapRatio = clampOverlapRatio(ratio);
  await writePreferences();
}

export async function rememberDarkMode(enabled: boolean): Promise<void> {
  rememberedDarkMode = enabled;
  darkModePreferenceLoaded = true;
  await writePreferences();
}
