package expo.modules.pianopdfparser

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.DisplayMetrics
import androidx.core.os.bundleOf
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.Semaphore
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private data class StripRange(val x0: Int, val y0: Int, val x1: Int, val y1: Int)

private const val GARBAGE_MIN_HEIGHT_RATIO = 0.03
private const val GARBAGE_MIN_INK_RATIO = 0.001
private const val INK_THRESHOLD = 240
private const val PREVIEW_MAX_SIDE_PX = 280
private const val PREVIEW_ZOOM_MAX_SIDE_PX = 1400

class PianoPdfParserModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PianoPdfParser")

    Events("onProgress")

    AsyncFunction("processPdf") { pdfUri: String, options: Map<String, Any?>? ->
      processPdf(pdfUri, options)
    }

    AsyncFunction("getPdfPagePreviews") { pdfUri: String ->
      getPdfPagePreviews(pdfUri)
    }

    AsyncFunction("getPdfPagePreview") { pdfUri: String, pageIndex: Int ->
      getPdfPagePreview(pdfUri, pageIndex)
    }

    AsyncFunction("processImages") { imageUris: List<String> ->
      processImages(imageUris)
    }

    View(MusicInvertView::class) {
      Prop("inverted") { view: MusicInvertView, inverted: Boolean ->
        view.setInverted(inverted)
      }
    }
  }

  private fun processPdf(pdfUri: String, options: Map<String, Any?>?): Map<String, Any> {
    val context = appContext.reactContext ?: throw coded("IO_ERROR", "React context is unavailable.")
    val filePath = resolvePdfPath(pdfUri)
    validatePdfHeader(filePath)

    val descriptor = try {
      ParcelFileDescriptor.open(File(filePath), ParcelFileDescriptor.MODE_READ_ONLY)
    } catch (_: SecurityException) {
      throw coded("PASSWORD_PROTECTED", "PDF is password protected.")
    } catch (error: Exception) {
      throw coded("INVALID_PDF", "Unable to open PDF: ${error.message}")
    }

    descriptor.use { parcel ->
      val renderer = try {
        PdfRenderer(parcel)
      } catch (error: SecurityException) {
        throw coded("PASSWORD_PROTECTED", "PDF is password protected.")
      } catch (error: Exception) {
        throw coded("INVALID_PDF", "Unable to render PDF: ${error.message}")
      }

      renderer.use { pdfRenderer ->
        val pageCount = pdfRenderer.pageCount
        if (pageCount <= 0) {
          throw coded("EMPTY_RESULT", "PDF contains no pages.")
        }

        val selectedPages = resolvePageIndices(options, pageCount)
        val selectedCount = selectedPages.size

        val jobId = UUID.randomUUID().toString().lowercase()
        val outputDir = File(context.cacheDir, "slices/$jobId")
        if (!outputDir.exists() && !outputDir.mkdirs()) {
          throw coded("IO_ERROR", "Unable to create output directory.")
        }

        val maxInflight = min(4, Runtime.getRuntime().availableProcessors().coerceAtLeast(1))
        val semaphore = Semaphore(maxInflight)
        val executor = Executors.newFixedThreadPool(maxInflight)
        val pageFutures = mutableListOf<Future<Map<String, List<Map<String, Any>>>>>()

        try {
          for (pageIndex in selectedPages) {
            semaphore.acquire()
            val gray: ByteArray
            val width: Int
            val height: Int
            try {
              pdfRenderer.openPage(pageIndex).use { page ->
                val dpi = resolveDpi(page.width, options)
                val scale = dpi / 72f
                width = max((page.width * scale).roundToInt(), 1)
                height = max((page.height * scale).roundToInt(), 1)

                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                try {
                  bitmap.eraseColor(Color.WHITE)
                  page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                  gray = bitmapToGrayscale(bitmap, width, height)
                } finally {
                  bitmap.recycle()
                }
              }
            } catch (error: Exception) {
              semaphore.release()
              throw error
            }

            pageFutures.add(
              executor.submit<Map<String, List<Map<String, Any>>>> {
                try {
                  writePageStrips(pageIndex, gray, width, height, outputDir)
                } finally {
                  semaphore.release()
                }
              },
            )
          }

          val strips = mutableListOf<Map<String, Any>>()
          val garbage = mutableListOf<Map<String, Any>>()
          var stripCountSoFar = 0
          for (step in 0 until selectedCount) {
            val pageResult = try {
              pageFutures[step].get()
            } catch (error: ExecutionException) {
              throw error.cause ?: error
            }
            val pageStrips = pageResult["strips"] ?: emptyList()
            val pageGarbage = pageResult["garbage"] ?: emptyList()
            strips.addAll(pageStrips)
            garbage.addAll(pageGarbage)
            stripCountSoFar += pageStrips.size
            sendEvent(
              "onProgress",
              bundleOf(
                "pageIndex" to step,
                "pageCount" to selectedCount,
                "stripCountSoFar" to stripCountSoFar,
              ),
            )
          }

          if (strips.isEmpty()) {
            throw coded("EMPTY_RESULT", "No strips were produced from the PDF.")
          }

          return mapOf(
            "strips" to strips,
            "garbage" to garbage,
            "jobId" to jobId,
            "directoryUri" to "file://${outputDir.absolutePath}/",
          )
        } finally {
          executor.shutdown()
        }
      }
    }
  }

  private fun processImages(imageUris: List<String>): Map<String, Any> {
    if (imageUris.isEmpty()) {
      throw coded("EMPTY_RESULT", "No images selected.")
    }

    val context = appContext.reactContext ?: throw coded("IO_ERROR", "React context is unavailable.")
    val jobId = UUID.randomUUID().toString().lowercase()
    val outputDir = File(context.cacheDir, "slices/$jobId")
    if (!outputDir.exists() && !outputDir.mkdirs()) {
      throw coded("IO_ERROR", "Unable to create output directory.")
    }

    val targetWidth = resolveTargetRasterWidthPx()
    val maxInflight = min(4, Runtime.getRuntime().availableProcessors().coerceAtLeast(1))
    val semaphore = Semaphore(maxInflight)
    val executor = Executors.newFixedThreadPool(maxInflight)
    val pageFutures = mutableListOf<Future<Map<String, List<Map<String, Any>>>>>()

    try {
      for (step in imageUris.indices) {
        val imageUri = imageUris[step]
        val path = resolveLocalPath(imageUri)
        validateImageFile(path)

        semaphore.acquire()
        val gray: ByteArray
        val width: Int
        val height: Int
        try {
          val decoded =
            BitmapFactory.decodeFile(path) ?: throw coded("INVALID_PDF", "Unable to decode image.")
          val scaled = scaleBitmapToTargetWidth(decoded, targetWidth)
          if (scaled !== decoded) {
            decoded.recycle()
          }
          width = scaled.width
          height = scaled.height
          gray = bitmapToGrayscale(scaled, width, height)
          scaled.recycle()
        } catch (error: Exception) {
          semaphore.release()
          throw error
        }

        val pageIndex = step
        pageFutures.add(
          executor.submit<Map<String, List<Map<String, Any>>>> {
            try {
              writePageStrips(pageIndex, gray, width, height, outputDir)
            } finally {
              semaphore.release()
            }
          },
        )
      }

      val strips = mutableListOf<Map<String, Any>>()
      val garbage = mutableListOf<Map<String, Any>>()
      var stripCountSoFar = 0
      for (step in imageUris.indices) {
        val pageResult = try {
          pageFutures[step].get()
        } catch (error: ExecutionException) {
          throw error.cause ?: error
        }
        val pageStrips = pageResult["strips"] ?: emptyList()
        val pageGarbage = pageResult["garbage"] ?: emptyList()
        strips.addAll(pageStrips)
        garbage.addAll(pageGarbage)
        stripCountSoFar += pageStrips.size
        sendEvent(
          "onProgress",
          bundleOf(
            "pageIndex" to step,
            "pageCount" to imageUris.size,
            "stripCountSoFar" to stripCountSoFar,
          ),
        )
      }

      if (strips.isEmpty()) {
        throw coded("EMPTY_RESULT", "No strips were produced from the images.")
      }

      return mapOf(
        "strips" to strips,
        "garbage" to garbage,
        "jobId" to jobId,
        "directoryUri" to "file://${outputDir.absolutePath}/",
      )
    } finally {
      executor.shutdown()
    }
  }

  private fun getPdfPagePreviews(pdfUri: String): List<Map<String, Any>> {
    val context = appContext.reactContext ?: throw coded("IO_ERROR", "React context is unavailable.")
    val filePath = resolvePdfPath(pdfUri)
    validatePdfHeader(filePath)

    val descriptor = try {
      ParcelFileDescriptor.open(File(filePath), ParcelFileDescriptor.MODE_READ_ONLY)
    } catch (_: SecurityException) {
      throw coded("PASSWORD_PROTECTED", "PDF is password protected.")
    } catch (error: Exception) {
      throw coded("INVALID_PDF", "Unable to open PDF: ${error.message}")
    }

    descriptor.use { parcel ->
      val renderer = try {
        PdfRenderer(parcel)
      } catch (error: SecurityException) {
        throw coded("PASSWORD_PROTECTED", "PDF is password protected.")
      } catch (error: Exception) {
        throw coded("INVALID_PDF", "Unable to render PDF: ${error.message}")
      }

      renderer.use { pdfRenderer ->
        val pageCount = pdfRenderer.pageCount
        if (pageCount <= 0) {
          throw coded("EMPTY_RESULT", "PDF contains no pages.")
        }

        val previewId = UUID.randomUUID().toString().lowercase()
        val previewDir = File(context.cacheDir, "previews/$previewId")
        if (!previewDir.exists() && !previewDir.mkdirs()) {
          throw coded("IO_ERROR", "Unable to create preview directory.")
        }

        val previews = mutableListOf<Map<String, Any>>()
        for (pageIndex in 0 until pageCount) {
          previews.add(
            renderPagePreview(pdfRenderer, pageIndex, previewDir, PREVIEW_MAX_SIDE_PX),
          )
        }

        return previews
      }
    }
  }

  private fun getPdfPagePreview(pdfUri: String, pageIndex: Int): Map<String, Any> {
    val context = appContext.reactContext ?: throw coded("IO_ERROR", "React context is unavailable.")
    val filePath = resolvePdfPath(pdfUri)
    validatePdfHeader(filePath)

    val descriptor = try {
      ParcelFileDescriptor.open(File(filePath), ParcelFileDescriptor.MODE_READ_ONLY)
    } catch (_: SecurityException) {
      throw coded("PASSWORD_PROTECTED", "PDF is password protected.")
    } catch (error: Exception) {
      throw coded("INVALID_PDF", "Unable to open PDF: ${error.message}")
    }

    descriptor.use { parcel ->
      val renderer = try {
        PdfRenderer(parcel)
      } catch (error: SecurityException) {
        throw coded("PASSWORD_PROTECTED", "PDF is password protected.")
      } catch (error: Exception) {
        throw coded("INVALID_PDF", "Unable to render PDF: ${error.message}")
      }

      renderer.use { pdfRenderer ->
        val pageCount = pdfRenderer.pageCount
        if (pageCount <= 0) {
          throw coded("EMPTY_RESULT", "PDF contains no pages.")
        }
        if (pageIndex < 0 || pageIndex >= pageCount) {
          throw coded("INVALID_PDF", "Page index $pageIndex is out of range.")
        }

        val previewId = UUID.randomUUID().toString().lowercase()
        val previewDir = File(context.cacheDir, "previews/zoom/$previewId")
        if (!previewDir.exists() && !previewDir.mkdirs()) {
          throw coded("IO_ERROR", "Unable to create preview directory.")
        }

        return renderPagePreview(pdfRenderer, pageIndex, previewDir, PREVIEW_ZOOM_MAX_SIDE_PX)
      }
    }
  }

  private fun renderPagePreview(
    pdfRenderer: PdfRenderer,
    pageIndex: Int,
    previewDir: File,
    maxSidePx: Int,
  ): Map<String, Any> {
    if (pageIndex < 0 || pageIndex >= pdfRenderer.pageCount) {
      throw coded("INVALID_PDF", "Page index $pageIndex is out of range.")
    }

    pdfRenderer.openPage(pageIndex).use { page ->
      val pageWidth = page.width
      val pageHeight = page.height
      val longest = max(pageWidth, pageHeight).toFloat().coerceAtLeast(1f)
      val scale = maxSidePx / longest
      val width = max((pageWidth * scale).roundToInt(), 1)
      val height = max((pageHeight * scale).roundToInt(), 1)

      val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      try {
        bitmap.eraseColor(Color.WHITE)
        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
        val outputFile = File(previewDir, "p$pageIndex.jpg")
        if (!writeJpeg(bitmap, outputFile)) {
          throw coded("IO_ERROR", "Failed to write preview for page $pageIndex.")
        }
        return mapOf(
          "pageIndex" to pageIndex,
          "uri" to "file://${outputFile.absolutePath}",
          "width" to width,
          "height" to height,
        )
      } finally {
        bitmap.recycle()
      }
    }
  }

  private fun resolvePageIndices(options: Map<String, Any?>?, pageCount: Int): List<Int> {
    val raw = options?.get("pageIndices")
    if (raw == null) {
      return (0 until pageCount).toList()
    }

    val list = when (raw) {
      is List<*> -> raw.mapNotNull { (it as? Number)?.toInt() }
      else -> emptyList()
    }
    if (list.isEmpty()) {
      throw coded("EMPTY_RESULT", "No pages selected.")
    }

    val seen = mutableSetOf<Int>()
    val ordered = mutableListOf<Int>()
    for (index in list) {
      if (!seen.add(index)) {
        continue
      }
      if (index < 0 || index >= pageCount) {
        throw coded("INVALID_PDF", "Page index $index is out of range.")
      }
      ordered.add(index)
    }
    return ordered
  }

  private fun resolveTargetRasterWidthPx(): Int {
    val context = appContext.reactContext ?: return 2000
    val metrics: DisplayMetrics = context.resources.displayMetrics
    return max(metrics.widthPixels * 2, 1)
  }

  private fun scaleBitmapToTargetWidth(source: Bitmap, targetWidth: Int): Bitmap {
    if (source.width == targetWidth) {
      return source
    }
    val scale = targetWidth.toFloat() / source.width.toFloat()
    val targetHeight = max((source.height * scale).roundToInt(), 1)
    return Bitmap.createScaledBitmap(source, targetWidth, targetHeight, true)
  }

  private fun validateImageFile(path: String) {
    val file = File(path)
    if (!file.exists() || !file.isFile) {
      throw coded("IO_ERROR", "Image file does not exist.")
    }
  }

  private fun resolveLocalPath(fileUri: String): String = resolvePdfPath(fileUri)

  private fun resolvePdfPath(pdfUri: String): String {
    val trimmed = pdfUri.trim()
    val lowered = trimmed.lowercase()

    if (lowered.startsWith("content://") || lowered.startsWith("http://") || lowered.startsWith("https://")) {
      throw coded("UNSUPPORTED_URI", "Only local file paths are supported.")
    }

    if (lowered.startsWith("file://")) {
      return File(java.net.URI(trimmed)).path
    }

    if (trimmed.startsWith("/")) {
      return trimmed
    }

    throw coded("UNSUPPORTED_URI", "PDF path must be a file:// URI or absolute path.")
  }

  private fun validatePdfHeader(path: String) {
    val file = File(path)
    if (!file.exists() || !file.isFile) {
      throw coded("IO_ERROR", "PDF file does not exist.")
    }

    file.inputStream().use { input ->
      val header = ByteArray(4)
      val read = input.read(header)
      if (read != 4 || !header.contentEquals("%PDF".toByteArray())) {
        throw coded("INVALID_PDF", "File is not a valid PDF.")
      }
    }
  }

  private fun resolveDpi(pageWidthPoints: Int, options: Map<String, Any?>?): Float {
    val userDpi = (options?.get("dpi") as? Number)?.toFloat()
    if (userDpi != null && userDpi > 0f) {
      return min(max(userDpi, 72f), 400f)
    }

    val context = appContext.reactContext ?: return 200f
    val metrics: DisplayMetrics = context.resources.displayMetrics
    val targetWidth = max(metrics.widthPixels * 2f, 1f)
    val pageWidthInches = max(pageWidthPoints / 72f, 0.1f)
    val computed = targetWidth / pageWidthInches
    return min(max(computed, 150f), 250f)
  }

  private fun writePageStrips(
    pageIndex: Int,
    gray: ByteArray,
    width: Int,
    height: Int,
    outputDir: File,
  ): Map<String, List<Map<String, Any>>> {
    val ranges = SlicerNative.slicePage(gray, width, height, width)
      ?: throw coded("IO_ERROR", "Failed to slice page $pageIndex.")

    val keptRanges = mutableListOf<StripRange>()
    var rangeOffset = 0
    while (rangeOffset + 3 < ranges.size) {
      val x0 = ranges[rangeOffset]
      val y0 = ranges[rangeOffset + 1]
      val x1 = ranges[rangeOffset + 2]
      val y1 = ranges[rangeOffset + 3]
      rangeOffset += 4
      if (x1 > x0 && y1 > y0) {
        keptRanges.add(StripRange(x0, y0, x1, y1))
      }
    }

    val strips = mutableListOf<Map<String, Any>>()
    var stripIndex = 0
    for (range in keptRanges) {
      val stripWidth = range.x1 - range.x0
      val stripHeight = range.y1 - range.y0
      val stripBitmap = Bitmap.createBitmap(stripWidth, stripHeight, Bitmap.Config.ARGB_8888)
      try {
        copyGrayStripToBitmap(
          gray,
          width,
          height,
          range.x0,
          range.y0,
          range.x1,
          range.y1,
          stripBitmap,
          sharpen = true,
        )
        val outputFile = File(outputDir, "p${pageIndex}_$stripIndex.png")
        if (!writePng(stripBitmap, outputFile)) {
          throw coded("IO_ERROR", "Failed to write strip PNG for page $pageIndex.")
        }

        strips.add(
          mapOf(
            "uri" to "file://${outputFile.absolutePath}",
            "width" to stripWidth,
            "height" to stripHeight,
            "pageIndex" to pageIndex,
            "y0" to range.y0,
          ),
        )
        stripIndex += 1
      } finally {
        stripBitmap.recycle()
      }
    }

    val garbage = mutableListOf<Map<String, Any>>()
    var garbageIndex = 0
    for (range in complementRanges(keptRanges, width, height)) {
      val bandHeight = range.y1 - range.y0
      if (!shouldKeepGarbageBand(gray, width, height, range.y0, range.y1)) {
        continue
      }

      val garbageBitmap = Bitmap.createBitmap(width, bandHeight, Bitmap.Config.ARGB_8888)
      try {
        copyGrayStripToBitmap(
          gray,
          width,
          height,
          range.x0,
          range.y0,
          range.x1,
          range.y1,
          garbageBitmap,
        )
        val outputFile = File(outputDir, "p${pageIndex}_g$garbageIndex.png")
        if (!writePng(garbageBitmap, outputFile)) {
          throw coded("IO_ERROR", "Failed to write garbage PNG for page $pageIndex.")
        }

        garbage.add(
          mapOf(
            "uri" to "file://${outputFile.absolutePath}",
            "width" to width,
            "height" to bandHeight,
            "pageIndex" to pageIndex,
            "y0" to range.y0,
          ),
        )
        garbageIndex += 1
      } finally {
        garbageBitmap.recycle()
      }
    }

    return mapOf(
      "strips" to strips,
      "garbage" to garbage,
    )
  }

  private fun complementRanges(kept: List<StripRange>, width: Int, height: Int): List<StripRange> {
    if (kept.isEmpty()) {
      return listOf(StripRange(0, 0, width, height))
    }

    val sorted = kept.sortedBy { it.y0 }
    val result = mutableListOf<StripRange>()
    var cursor = 0
    for (range in sorted) {
      if (range.y0 > cursor) {
        result.add(StripRange(0, cursor, width, range.y0))
      }
      cursor = max(cursor, range.y1)
    }
    if (cursor < height) {
      result.add(StripRange(0, cursor, width, height))
    }
    return result
  }

  private fun countInkInBand(
    gray: ByteArray,
    width: Int,
    pageHeight: Int,
    y0: Int,
    y1: Int,
  ): Int {
    var ink = 0
    for (y in y0 until min(y1, pageHeight)) {
      val rowOffset = y * width
      for (x in 0 until width) {
        val value = gray[rowOffset + x].toInt() and 0xFF
        if (value < INK_THRESHOLD) {
          ink += 1
        }
      }
    }
    return ink
  }

  private fun shouldKeepGarbageBand(
    gray: ByteArray,
    width: Int,
    pageHeight: Int,
    y0: Int,
    y1: Int,
  ): Boolean {
    val bandHeight = y1 - y0
    val minHeight = max(1, (pageHeight * GARBAGE_MIN_HEIGHT_RATIO).roundToInt())
    if (bandHeight < minHeight) {
      return false
    }

    val ink = countInkInBand(gray, width, pageHeight, y0, y1)
    val minInk = ceil(bandHeight.toDouble() * width * GARBAGE_MIN_INK_RATIO).toInt()
    return ink >= minInk
  }

  private fun bitmapToGrayscale(bitmap: Bitmap, width: Int, height: Int): ByteArray {
    val gray = ByteArray(width * height)
    val pixels = IntArray(width)
    for (y in 0 until height) {
      bitmap.getPixels(pixels, 0, width, 0, y, width, 1)
      val rowOffset = y * width
      for (x in 0 until width) {
        val pixel = pixels[x]
        val r = Color.red(pixel)
        val g = Color.green(pixel)
        val b = Color.blue(pixel)
        val lum = (0.299 * r + 0.587 * g + 0.114 * b).roundToInt()
        gray[rowOffset + x] = lum.toByte()
      }
    }
    return gray
  }

  private fun copyGrayStripToBitmap(
    gray: ByteArray,
    width: Int,
    pageHeight: Int,
    x0: Int,
    y0: Int,
    x1: Int,
    y1: Int,
    stripBitmap: Bitmap,
    sharpen: Boolean = false,
  ) {
    val stripWidth = x1 - x0
    val stripHeight = y1 - y0
    val stripGray = ByteArray(stripWidth * stripHeight)
    for (y in 0 until stripHeight) {
      val srcY = y0 + y
      if (srcY < 0 || srcY >= pageHeight) {
        continue
      }
      val rowOffset = srcY * width
      for (x in 0 until stripWidth) {
        stripGray[y * stripWidth + x] = gray[rowOffset + x0 + x]
      }
    }

    if (sharpen) {
      SlicerNative.sharpenStrip(stripGray, stripWidth, stripHeight, stripWidth)
    }

    val pixels = IntArray(stripWidth)
    for (y in 0 until stripHeight) {
      val rowOffset = y * stripWidth
      for (x in 0 until stripWidth) {
        val value = stripGray[rowOffset + x].toInt() and 0xFF
        pixels[x] = Color.rgb(value, value, value)
      }
      stripBitmap.setPixels(pixels, 0, stripWidth, 0, y, stripWidth, 1)
    }
  }

  private fun writePng(bitmap: Bitmap, outputFile: File): Boolean {
    return try {
      FileOutputStream(outputFile).use { stream ->
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
      }
      true
    } catch (_: Exception) {
      false
    }
  }

  private fun writeJpeg(bitmap: Bitmap, outputFile: File): Boolean {
    return try {
      FileOutputStream(outputFile).use { stream ->
        bitmap.compress(Bitmap.CompressFormat.JPEG, 85, stream)
      }
      true
    } catch (_: Exception) {
      false
    }
  }

  private fun coded(code: String, message: String): CodedException {
    return CodedException(code, message, null)
  }
}
