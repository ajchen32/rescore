import { Image } from "react-native";
import { File, Paths } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import type { PagePreview } from "piano-pdf-parser-core";

type ImageAssetInput = {
  uri: string;
  name?: string | null;
};

function sanitizeImageFilename(name: string, index: number): string {
  const base = name.trim() || `photo-${index + 1}.jpg`;
  const withExtension = /\.[a-z0-9]+$/i.test(base) ? base : `${base}.jpg`;
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

async function copyImageToAppCache(sourceUri: string, originalName: string, index: number): Promise<string> {
  const filename = `${Date.now()}-${index}-${sanitizeImageFilename(originalName, index)}`;
  const destination = new File(Paths.cache, filename);

  try {
    return await copyWithNewFileApi(sourceUri, destination);
  } catch {
    return await copyWithLegacyApi(sourceUri, destination);
  }
}

function getImageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      (error) => reject(error)
    );
  });
}

export async function copyImagesToAppCache(assets: ImageAssetInput[]): Promise<string[]> {
  const cachedUris: string[] = [];
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    const name = asset.name ?? `photo-${index + 1}.jpg`;
    const cachedUri = await copyImageToAppCache(asset.uri, name, index);
    cachedUris.push(cachedUri);
  }
  return cachedUris;
}

export async function buildImagePreviews(imageUris: string[]): Promise<PagePreview[]> {
  const previews: PagePreview[] = [];
  for (let pageIndex = 0; pageIndex < imageUris.length; pageIndex += 1) {
    const uri = imageUris[pageIndex];
    const { width, height } = await getImageSize(uri);
    previews.push({
      pageIndex,
      uri,
      width,
      height,
    });
  }
  return previews;
}
