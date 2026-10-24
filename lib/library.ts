import { Directory, File, Paths } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";

import {
  clampVisibleCount,
  DEFAULT_LANDSCAPE_VISIBLE_COUNT,
  DEFAULT_VISIBLE_COUNT,
  mergedStartY0,
  type ReaderStrip,
} from "./corrections";
import { canMoveFolder, removeFolder, type Folder } from "./folders";
import type { Bookmark } from "./bookmarks";
import { getImagePixelSize } from "./splitStrip";

export type SavedStrip = {
  uri: string;
  width: number;
  height: number;
  pageIndex: number;
  x0?: number;
  y0?: number;
  id?: string;
  parts?: SavedStrip[];
};

export type SavedScore = {
  id: string;
  title: string;
  createdAt: number;
  stripCount: number;
  visibleCount?: number;
  portraitVisibleCount?: number;
  landscapeVisibleCount?: number;
  strips: SavedStrip[];
  garbage?: SavedStrip[];
  // The folder it's filed in; missing or null means the library root.
  folderId?: string | null;
  // Places to jump to (pieces in a book, movements, passages), in reading order.
  bookmarks?: Bookmark[];
  // Legacy name for `bookmarks` (saved by earlier builds); read through `savedBookmarks`.
  songs?: Bookmark[];
};

export type Library = {
  scores: SavedScore[];
  folders?: Folder[];
};

export type SaveScoreInput = {
  id?: string;
  title: string;
  strips: ReaderStrip[];
  garbage?: ReaderStrip[];
  visibleCount?: number;
  portraitVisibleCount?: number;
  landscapeVisibleCount?: number;
  // Where a new score is filed; an existing score keeps its folder.
  folderId?: string | null;
  // Leave out to keep the saved bookmarks; an empty list removes them.
  bookmarks?: Bookmark[];
};

export function resolvePortraitVisibleCount(score: SavedScore): number {
  return clampVisibleCount(
    score.portraitVisibleCount ?? score.visibleCount ?? DEFAULT_VISIBLE_COUNT
  );
}

export function resolveLandscapeVisibleCount(score: SavedScore): number {
  return clampVisibleCount(score.landscapeVisibleCount ?? DEFAULT_LANDSCAPE_VISIBLE_COUNT);
}

export type SaveScoreResult = {
  id: string;
  score: SavedScore;
};

const LIBRARY_FILENAME = "library.json";
const SCORES_DIRNAME = "scores";
const STAGING_SUFFIX = "__writing";

function libraryFile(): File {
  return new File(Paths.document, LIBRARY_FILENAME);
}

function scoresRoot(): Directory {
  return new Directory(Paths.document, SCORES_DIRNAME);
}

function scoreDirectory(scoreId: string): Directory {
  return new Directory(scoresRoot(), scoreId);
}

function stagingDirectory(scoreId: string): Directory {
  return new Directory(scoresRoot(), `${scoreId}${STAGING_SUFFIX}`);
}

function newScoreId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${random}`;
}

function ensureScoresRoot(): Directory {
  const root = scoresRoot();
  if (!root.exists) {
    root.create({ intermediates: true, idempotent: true });
  }
  return root;
}

function deleteDirectoryIfExists(directory: Directory): void {
  if (directory.exists) {
    directory.delete();
  }
}

export function normalizeFileUri(uri: string): string {
  if (uri.startsWith("file:/") && !uri.startsWith("file://")) {
    return `file://${uri.slice("file:/".length)}`;
  }
  return uri;
}

function filenameFromUri(uri: string): string {
  const filename = uri.split("/").pop();
  if (!filename) {
    throw new Error("Invalid strip URI when finalizing save.");
  }
  return filename;
}

function rewriteStripUris(strips: SavedStrip[], finalDir: Directory): SavedStrip[] {
  function rewrite(strip: SavedStrip): SavedStrip {
    const filename = filenameFromUri(strip.uri);
    const next: SavedStrip = {
      ...strip,
      uri: normalizeFileUri(new File(finalDir, filename).uri),
    };
    if (strip.parts && strip.parts.length > 0) {
      next.parts = strip.parts.map(rewrite);
    }
    return next;
  }

  return strips.map(rewrite);
}

function finalizeScoreUris(score: SavedScore): SavedScore {
  const finalDir = scoreDirectory(score.id);
  if (!finalDir.exists) {
    return score;
  }

  return {
    ...score,
    strips: rewriteStripUris(score.strips, finalDir),
  };
}

async function copyFileToDirectory(sourceUri: string, destination: File): Promise<void> {
  const source = new File(sourceUri);
  try {
    await source.copy(destination);
  } catch {
    await LegacyFileSystem.copyAsync({
      from: sourceUri,
      to: destination.uri,
    });
  }
}

/**
 * A saved file keeps its name across saves, and new files get a name never used
 * before. Reusing a name for different pixels would make expo-image serve the
 * old picture from its URI-keyed cache (e.g. an already-split strip reappearing).
 */
function savedFilename(sourceUri: string, scoreId: string, nextIndex: { value: number }): string {
  const existingDir = normalizeFileUri(scoreDirectory(scoreId).uri).replace(/\/?$/, "/");
  const normalizedSource = normalizeFileUri(sourceUri);
  if (normalizedSource.startsWith(existingDir)) {
    return filenameFromUri(normalizedSource);
  }

  const index = nextIndex.value;
  nextIndex.value += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${random}-${String(index).padStart(3, "0")}.png`;
}

async function copyUriIfNeeded(
  sourceUri: string,
  scoreDir: Directory,
  uriMap: Map<string, string>,
  nextIndex: { value: number }
): Promise<string> {
  const cached = uriMap.get(sourceUri);
  if (cached) {
    return cached;
  }

  const scoreId = scoreDir.name.endsWith(STAGING_SUFFIX)
    ? scoreDir.name.slice(0, -STAGING_SUFFIX.length)
    : scoreDir.name;
  const filename = savedFilename(sourceUri, scoreId, nextIndex);
  const destination = new File(scoreDir, filename);
  await copyFileToDirectory(sourceUri, destination);
  uriMap.set(sourceUri, destination.uri);
  return destination.uri;
}

async function copyLeafStrip(
  strip: ReaderStrip,
  scoreDir: Directory,
  uriMap: Map<string, string>,
  nextIndex: { value: number }
): Promise<SavedStrip> {
  const uri = await copyUriIfNeeded(strip.uri, scoreDir, uriMap, nextIndex);
  return {
    uri,
    width: strip.width,
    height: strip.height,
    pageIndex: strip.pageIndex,
    x0: strip.x0,
    y0: strip.y0,
    id: strip.id,
  };
}

async function copyStripToSaved(
  strip: ReaderStrip,
  scoreDir: Directory,
  uriMap: Map<string, string>,
  nextIndex: { value: number }
): Promise<SavedStrip> {
  if (strip.parts && strip.parts.length > 0) {
    const parts: SavedStrip[] = [];
    for (const part of strip.parts) {
      parts.push(await copyLeafStrip(part, scoreDir, uriMap, nextIndex));
    }
    return {
      uri: parts[0].uri,
      width: parts[0].width,
      height: parts.reduce((sum, part) => sum + part.height, 0),
      pageIndex: strip.pageIndex,
      y0: mergedStartY0(strip.parts) ?? strip.y0,
      id: strip.id,
      parts,
    };
  }

  return copyLeafStrip(strip, scoreDir, uriMap, nextIndex);
}

// A strip's width and height are layout units (slicing-raster pixels), and its
// image may be stored at a higher resolution, so only fill them in when missing.
async function refreshLeafDimensions(strip: SavedStrip): Promise<SavedStrip> {
  if (strip.width > 0 && strip.height > 0) {
    return strip;
  }
  try {
    const { width, height } = await getImagePixelSize(strip.uri);
    return {
      ...strip,
      width,
      height,
    };
  } catch {
    return strip;
  }
}

async function refreshSavedStripDimensions(strip: SavedStrip): Promise<SavedStrip> {
  if (strip.parts && strip.parts.length > 0) {
    const parts: SavedStrip[] = [];
    for (const part of strip.parts) {
      parts.push(await refreshLeafDimensions(part));
    }
    return {
      ...strip,
      uri: parts[0].uri,
      width: parts[0].width,
      height: parts.reduce((sum, part) => sum + part.height, 0),
      parts,
    };
  }

  return refreshLeafDimensions(strip);
}

async function refreshScoreDimensions(score: SavedScore): Promise<SavedScore> {
  const strips: SavedStrip[] = [];
  for (const strip of score.strips) {
    strips.push(await refreshSavedStripDimensions(strip));
  }

  const garbage: SavedStrip[] = [];
  for (const piece of score.garbage ?? []) {
    garbage.push(await refreshSavedStripDimensions(piece));
  }

  return {
    ...score,
    strips,
    garbage: garbage.length > 0 ? garbage : undefined,
  };
}

export function savedStripToReaderStrip(saved: SavedStrip): ReaderStrip {
  const strip: ReaderStrip = {
    id: saved.id ?? `${saved.pageIndex}-${saved.uri}`,
    uri: saved.uri,
    width: saved.width,
    height: saved.height,
    pageIndex: saved.pageIndex,
    x0: saved.x0,
    y0: saved.y0,
  };

  if (saved.parts && saved.parts.length > 0) {
    strip.parts = saved.parts.map(savedStripToReaderStrip);
  }

  return strip;
}

export function formatScoreDate(createdAt: number): string {
  return new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function uniqueScoreTitle(baseTitle: string, scores: SavedScore[]): string {
  const trimmed = baseTitle.trim();
  const fallback = trimmed.length > 0 ? trimmed : "Untitled score";
  const taken = new Set(scores.map((score) => score.title));

  if (!taken.has(fallback)) {
    return fallback;
  }

  let suffix = 1;
  while (taken.has(`${fallback} (${suffix})`)) {
    suffix += 1;
  }
  return `${fallback} (${suffix})`;
}

export async function loadLibrary(): Promise<Library> {
  const file = libraryFile();
  if (!file.exists) {
    return { scores: [] };
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as Library;
    if (!parsed || !Array.isArray(parsed.scores)) {
      return { scores: [] };
    }
    return parsed;
  } catch {
    return { scores: [] };
  }
}

export async function writeLibrary(library: Library): Promise<void> {
  const file = libraryFile();
  if (!file.exists) {
    file.create();
  }
  file.write(JSON.stringify(library, null, 2));
}

export async function loadScore(id: string): Promise<SavedScore> {
  const library = await loadLibrary();
  const score = library.scores.find((entry) => entry.id === id);
  if (!score) {
    throw new Error("Saved score not found.");
  }
  return refreshScoreDimensions(finalizeScoreUris(score));
}

export async function saveScore(input: SaveScoreInput): Promise<SaveScoreResult> {
  if (input.strips.length === 0) {
    throw new Error("Nothing to save.");
  }

  const id = input.id ?? newScoreId();
  const stagingDir = stagingDirectory(id);
  deleteDirectoryIfExists(stagingDir);

  ensureScoresRoot();
  stagingDir.create({ intermediates: true, idempotent: true });

  const uriMap = new Map<string, string>();
  const nextIndex = { value: 1 };

  try {
    const savedStrips: SavedStrip[] = [];
    for (const strip of input.strips) {
      savedStrips.push(await copyStripToSaved(strip, stagingDir, uriMap, nextIndex));
    }

    const savedGarbage: SavedStrip[] = [];
    for (const piece of input.garbage ?? []) {
      savedGarbage.push(await copyStripToSaved(piece, stagingDir, uriMap, nextIndex));
    }

    const existing = input.id ? await loadLibrary() : null;
    const previous = existing?.scores.find((entry) => entry.id === id);

    const finalDir = scoreDirectory(id);
    deleteDirectoryIfExists(finalDir);
    stagingDir.rename(id);

    const finalStrips = rewriteStripUris(savedStrips, finalDir);
    const finalGarbage = rewriteStripUris(savedGarbage, finalDir);

    const score: SavedScore = {
      id,
      title: input.title,
      createdAt: previous?.createdAt ?? Date.now(),
      stripCount: finalStrips.length,
      visibleCount: input.portraitVisibleCount ?? input.visibleCount,
      portraitVisibleCount: input.portraitVisibleCount ?? input.visibleCount,
      landscapeVisibleCount:
        input.landscapeVisibleCount ?? DEFAULT_LANDSCAPE_VISIBLE_COUNT,
      strips: finalStrips,
      garbage: finalGarbage.length > 0 ? finalGarbage : undefined,
      folderId: previous ? previous.folderId : (input.folderId ?? null),
      bookmarks: bookmarksToSave(
        input.bookmarks ?? (previous ? savedBookmarks(previous) : undefined)
      ),
    };

    const library = await loadLibrary();
    const withoutCurrent = library.scores.filter((entry) => entry.id !== id);
    const nextLibrary: Library = {
      ...library,
      scores: [score, ...withoutCurrent],
    };
    await writeLibrary(nextLibrary);

    return { id, score };
  } catch (error) {
    deleteDirectoryIfExists(stagingDir);
    throw error;
  }
}

/** A score's bookmarks, including ones saved under their old name, "songs". */
export function savedBookmarks(score: Pick<SavedScore, "bookmarks" | "songs">): Bookmark[] {
  return score.bookmarks ?? score.songs ?? [];
}

function bookmarksToSave(bookmarks: Bookmark[] | undefined): Bookmark[] | undefined {
  return bookmarks && bookmarks.length > 0 ? bookmarks : undefined;
}

export async function deleteScore(id: string): Promise<void> {
  deleteDirectoryIfExists(scoreDirectory(id));

  const library = await loadLibrary();
  const nextLibrary: Library = {
    ...library,
    scores: library.scores.filter((entry) => entry.id !== id),
  };
  await writeLibrary(nextLibrary);
}

export async function renameScore(id: string, title: string): Promise<SavedScore> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    throw new Error("Title cannot be empty.");
  }

  const library = await loadLibrary();
  const index = library.scores.findIndex((entry) => entry.id === id);
  if (index < 0) {
    throw new Error("Saved score not found.");
  }

  const updated: SavedScore = {
    ...library.scores[index],
    title: trimmedTitle,
  };
  const scores = [...library.scores];
  scores[index] = updated;
  await writeLibrary({ ...library, scores });

  return updated;
}

function newFolderId(): string {
  return `folder-${newScoreId()}`;
}

function cleanFolderName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Folder name cannot be empty.");
  }
  return trimmed;
}

export async function createFolder(name: string, parentId: string | null): Promise<Folder> {
  const library = await loadLibrary();
  const folder: Folder = {
    id: newFolderId(),
    name: cleanFolderName(name),
    parentId,
    createdAt: Date.now(),
  };
  await writeLibrary({ ...library, folders: [...(library.folders ?? []), folder] });
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const library = await loadLibrary();
  const trimmed = cleanFolderName(name);
  await writeLibrary({
    ...library,
    folders: (library.folders ?? []).map((folder) =>
      folder.id === id ? { ...folder, name: trimmed } : folder
    ),
  });
}

/** Deletes a folder; what it contained moves up to its parent. Scores are kept. */
export async function deleteFolder(id: string): Promise<void> {
  const library = await loadLibrary();
  const next = removeFolder({ folders: library.folders ?? [], items: library.scores }, id);
  await writeLibrary({ ...library, folders: next.folders, scores: next.items });
}

export async function moveScore(id: string, folderId: string | null): Promise<void> {
  const library = await loadLibrary();
  await writeLibrary({
    ...library,
    scores: library.scores.map((score) => (score.id === id ? { ...score, folderId } : score)),
  });
}

export async function moveFolder(id: string, parentId: string | null): Promise<void> {
  const library = await loadLibrary();
  const folders = library.folders ?? [];
  if (!canMoveFolder(folders, id, parentId)) {
    throw new Error("A folder can't be moved into itself.");
  }
  await writeLibrary({
    ...library,
    folders: folders.map((folder) => (folder.id === id ? { ...folder, parentId } : folder)),
  });
}
