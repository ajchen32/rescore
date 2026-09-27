package expo.modules.pianopdfparser

object SlicerNative {
  init {
    System.loadLibrary("piano_pdf_parser_core")
  }

  external fun slicePage(gray: ByteArray, width: Int, height: Int, stride: Int): IntArray?

  external fun sharpenStrip(gray: ByteArray, width: Int, height: Int, stride: Int)
}
