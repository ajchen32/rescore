import type { SlicerErrorCode } from "piano-pdf-parser-core";

const SLICER_MESSAGES: Record<SlicerErrorCode, string> = {
  INVALID_PDF: "This file does not look like a valid PDF.",
  PASSWORD_PROTECTED: "This PDF is password-protected. Remove the password and try again.",
  IO_ERROR: "Could not read the PDF from device storage. Try picking it again.",
  EMPTY_RESULT: "No music systems were found in this PDF.",
  UNSUPPORTED_URI: "The selected file could not be opened. Pick the PDF again.",
};

export function slicerErrorMessage(code: string | undefined, fallback?: string): string {
  if (code && code in SLICER_MESSAGES) {
    return SLICER_MESSAGES[code as SlicerErrorCode];
  }
  return fallback ?? "Something went wrong while slicing the PDF.";
}

export function errorFromUnknown(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: string }).code);
    const message =
      "message" in error && typeof (error as { message?: string }).message === "string"
        ? (error as { message: string }).message
        : undefined;
    return slicerErrorMessage(code, message);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong while slicing the PDF.";
}
