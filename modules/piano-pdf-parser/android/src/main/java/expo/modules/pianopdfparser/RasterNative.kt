package expo.modules.pianopdfparser

import android.graphics.Bitmap

object RasterNative {
  init {
    System.loadLibrary("piano_pdf_parser_core")
  }

  // Fills `gray` (width * height bytes) with the luminance of an ARGB_8888 bitmap.
  external fun bitmapToGray(bitmap: Bitmap, gray: ByteArray): Boolean

  external fun areaResample(
    src: ByteArray,
    srcWidth: Int,
    srcHeight: Int,
    dst: ByteArray,
    dstWidth: Int,
    dstHeight: Int,
  ): Boolean

  external fun writeGrayPng(
    gray: ByteArray,
    width: Int,
    height: Int,
    path: String,
    compressionLevel: Int,
  ): Boolean
}
