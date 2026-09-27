import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";

const PDF_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "com.adobe.pdf",
]);

export function isPdfAsset(name: string, mimeType?: string | null): boolean {
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith(".pdf")) {
    return true;
  }
  if (!mimeType) {
    return false;
  }
  const normalized = mimeType.toLowerCase();
  return PDF_MIME_TYPES.has(normalized) || normalized.includes("pdf");
}

function sanitizeFilename(name: string): string {
  const base = name.trim() || "document.pdf";
  const withExtension = base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
  return withExtension.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function copyWithNewFileApi(sourceUri: string, destination: File): Promise<string> {
  const source = new File(sourceUri);
  await source.copy(destination);
  return destination.uri;
}

async function copyWithLegacyApi(sourceUri: string, destination: File): Promise<string> {
  await LegacyFileSystem.copyAsync({
    from: sourceUri,
    to: destination.uri,
  });
  return destination.uri;
}

export async function copyPdfToAppCache(
  sourceUri: string,
  originalName: string
): Promise<string> {
  const filename = `${Date.now()}-${sanitizeFilename(originalName)}`;
  const destination = new File(Paths.cache, filename);

  try {
    return await copyWithNewFileApi(sourceUri, destination);
  } catch {
    return await copyWithLegacyApi(sourceUri, destination);
  }
}

export function pickerCopyToCacheDirectory(): boolean {
  return Platform.OS === "ios";
}
