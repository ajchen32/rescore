import { NativeModule, requireNativeModule } from "expo";

export type Strip = {
  uri: string;
  width: number;
  height: number;
  pageIndex: number;
  y0?: number;
};

export type PagePreview = {
  pageIndex: number;
  uri: string;
  width: number;
  height: number;
};

export type ProcessPdfOptions = {
  dpi?: number;
  pageIndices?: number[];
};

export type ProcessPdfResult = {
  strips: Strip[];
  garbage?: Strip[];
  jobId?: string;
  directoryUri?: string;
};

export type ProgressEvent = {
  pageIndex: number;
  pageCount: number;
  stripCountSoFar: number;
};

export type SlicerErrorCode =
  | "INVALID_PDF"
  | "PASSWORD_PROTECTED"
  | "IO_ERROR"
  | "EMPTY_RESULT"
  | "UNSUPPORTED_URI";

declare class PianoPdfParserNative extends NativeModule<{
  onProgress: (event: ProgressEvent) => void;
}> {
  processPdf(
    pdfUri: string,
    options?: ProcessPdfOptions
  ): Promise<ProcessPdfResult>;
  getPdfPagePreviews(pdfUri: string): Promise<PagePreview[]>;
  getPdfPagePreview(pdfUri: string, pageIndex: number): Promise<PagePreview>;
  processImages(imageUris: string[]): Promise<ProcessPdfResult>;
}

const native = requireNativeModule<PianoPdfParserNative>("PianoPdfParser");

export function addProgressListener(listener: (event: ProgressEvent) => void) {
  return native.addListener("onProgress", listener);
}

export async function getPdfPagePreviews(pdfUri: string): Promise<PagePreview[]> {
  return native.getPdfPagePreviews(pdfUri);
}

export async function getPdfPagePreview(
  pdfUri: string,
  pageIndex: number
): Promise<PagePreview> {
  return native.getPdfPagePreview(pdfUri, pageIndex);
}

export async function processPdf(
  pdfUri: string,
  options?: ProcessPdfOptions
): Promise<ProcessPdfResult> {
  const result = await native.processPdf(pdfUri, options);
  return {
    strips: result.strips,
    garbage: result.garbage ?? [],
    jobId: result.jobId,
    directoryUri: result.directoryUri,
  };
}

export async function processImages(imageUris: string[]): Promise<ProcessPdfResult> {
  const result = await native.processImages(imageUris);
  return {
    strips: result.strips,
    garbage: result.garbage ?? [],
    jobId: result.jobId,
    directoryUri: result.directoryUri,
  };
}
