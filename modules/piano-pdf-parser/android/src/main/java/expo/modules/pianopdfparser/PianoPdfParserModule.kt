package expo.modules.pianopdfparser

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.DisplayMetrics
import androidx.core.os.bundleOf
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private data class StripRange(val x0: Int, val y0: Int, val x1: Int, val y1: Int)

private class GrayImage(val gray: ByteArray, val width: Int, val height: Int)

// A page raster at slicing resolution, its strip ranges in that raster's pixels,
// and (for PDFs) each strip re-rendered at master resolution.
private class PageRaster(
  val gray: ByteArray,
  val width: Int,
  val height: Int,
  val ranges: List<StripRange>,
  val masters: List<GrayImage>?,
)

// One PdfRenderer per import worker thread, for rendering master strips. A
// renderer can only have one page open at a time, so workers can't share the
// main loop's; Android serializes the underlying pdfium calls across renderers.
private class WorkerRenderers(private val file: File) : AutoCloseable {
  private val opened = ConcurrentLinkedQueue<Pair<ParcelFileDescriptor, PdfRenderer>>()
  private val perThread = ThreadLocal<PdfRenderer>()

  fun forCurrentThread(): PdfRenderer {
    perThread.get()?.let { return it }
    val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    val renderer = try {
      PdfRenderer(descriptor)
    } catch (error: Exception) {
      descriptor.close()
      throw error
    }
    opened.add(descriptor to renderer)
    perThread.set(renderer)
    return renderer
  }

  override fun close() {
    for ((descriptor, renderer) in opened) {
      renderer.close()
      descriptor.close()
    }
    opened.clear()
  }
}

private const val GARBAGE_MIN_HEIGHT_RATIO = 0.03
private const val GARBAGE_MIN_INK_RATIO = 0.001
private const val INK_THRESHOLD = 240
private const val PREVIEW_MAX_SIDE_PX = 280
private const val PREVIEW_ZOOM_MAX_SIDE_PX = 1400

// Strip images are stored at up to MASTER_SCALE x the slicing resolution (capped
// at MAX_MASTER_DPI) so the reader can shrink them to its exact slot size instead
// of enlarging them. Strip metadata stays in slicing-raster pixels.
private const val MASTER_SCALE = 2f
private const val MAX_MASTER_DPI = 500f
private const val MASTER_PNG_LEVEL = 6
private const val DISPLAY_PNG_LEVEL = 1
private const val DISPLAY_CACHE_MAX_FILES = 2000
private const val DISPLAY_CACHE_PRUNED_FILES = 1500
private const val DISPLAY_CACHE_PRUNE_INTERVAL = 50
private const val MAX_CONCURRENT_RESAMPLES = 2

class PianoPdfParserModule : Module() {
  private val resampleSemaphore = Semaphore(MAX_CONCURRENT_RESAMPLES)
  private val displayWritesSincePrune = AtomicInteger(0)

  override fun definition() = ModuleDefinition {
    Name("PianoPdfParser")

    Events("onProgress")

    AsyncFunction("resampleForDisplay") { uri: String, width: Int, height: Int ->
      resampleForDisplay(uri, width, height)
    }

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

        // Each in-flight page holds its raster plus its master strips, so keep this low.
        val maxInflight = min(3, Runtime.getRuntime().availableProcessors().coerceAtLeast(1))
        val semaphore = Semaphore(maxInflight)
        val executor = Executors.newFixedThreadPool(maxInflight)
        val pageFutures = mutableListOf<Future<Map<String, List<Map<String, Any>>>>>()
        val workerRenderers = WorkerRenderers(File(filePath))

        try {
          for (pageIndex in selectedPages) {
            semaphore.acquire()
            val gray: ByteArray
            val width: Int
            val height: Int
            val pageScaleX: Float
            val pageScaleY: Float
            val masterScale: Float
            try {
              pdfRenderer.openPage(pageIndex).use { page ->
                val dpi = resolveDpi(page.width, options)
                val scale = dpi / 72f
                width = max((page.width * scale).roundToInt(), 1)
                height = max((page.height * scale).roundToInt(), 1)
                // The page is stretched to the rounded bitmap size, so these are
                // the slicing raster's true points-to-pixels scales.
                pageScaleX = width.toFloat() / page.width
                pageScaleY = height.toFloat() / page.height
                masterScale = resolveMasterScale(dpi)

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
                  val ranges = sliceRanges(pageIndex, gray, width, height)
                  val masters = workerRenderers.forCurrentThread().openPage(pageIndex).use { page ->
                    ranges.map { range ->
                      renderMasterStrip(page, range, pageScaleX, pageScaleY, masterScale)
                    }
                  }
                  writePageStrips(pageIndex, PageRaster(gray, width, height, ranges, masters), outputDir)
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
          // Workers may still be rendering if an earlier page failed; let them
          // finish before their renderers are closed.
          executor.shutdown()
          executor.awaitTermination(1, TimeUnit.MINUTES)
          workerRenderers.close()
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
              val ranges = sliceRanges(pageIndex, gray, width, height)
              writePageStrips(pageIndex, PageRaster(gray, width, height, ranges, null), outputDir)
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

  private fun resolveMasterScale(sliceDpi: Float): Float {
    return min(MASTER_SCALE, MAX_MASTER_DPI / sliceDpi).coerceAtLeast(1f)
  }

  private fun sliceRanges(pageIndex: Int, gray: ByteArray, width: Int, height: Int): List<StripRange> {
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
    return keptRanges
  }

  // Renders one strip straight from the PDF at `masterScale` x the slicing
  // raster, which maps page points to pixels at (pageScaleX, pageScaleY).
  private fun renderMasterStrip(
    page: PdfRenderer.Page,
    range: StripRange,
    pageScaleX: Float,
    pageScaleY: Float,
    masterScale: Float,
  ): GrayImage {
    val masterWidth = max(((range.x1 - range.x0) * masterScale).roundToInt(), 1)
    val masterHeight = max(((range.y1 - range.y0) * masterScale).roundToInt(), 1)
    val bitmap = Bitmap.createBitmap(masterWidth, masterHeight, Bitmap.Config.ARGB_8888)
    try {
      bitmap.eraseColor(Color.WHITE)
      val transform = Matrix().apply {
        setScale(pageScaleX * masterScale, pageScaleY * masterScale)
        postTranslate(-range.x0 * masterScale, -range.y0 * masterScale)
      }
      page.render(bitmap, null, transform, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
      return GrayImage(bitmapToGrayscale(bitmap, masterWidth, masterHeight), masterWidth, masterHeight)
    } finally {
      bitmap.recycle()
    }
  }

  // Strip metadata (width/height/x0/y0) is always in slicing-raster pixels; the
  // PNG itself may be larger when a master was rendered.
  private fun writePageStrips(
    pageIndex: Int,
    raster: PageRaster,
    outputDir: File,
  ): Map<String, List<Map<String, Any>>> {
    val strips = mutableListOf<Map<String, Any>>()
    raster.ranges.forEachIndexed { stripIndex, range ->
      val image = raster.masters?.get(stripIndex) ?: cropGray(raster, range)
      SlicerNative.sharpenStrip(image.gray, image.width, image.height, image.width)
      val outputFile = File(outputDir, "p${pageIndex}_$stripIndex.png")
      if (!RasterNative.writeGrayPng(image.gray, image.width, image.height, outputFile.absolutePath, MASTER_PNG_LEVEL)) {
        throw coded("IO_ERROR", "Failed to write strip PNG for page $pageIndex.")
      }

      strips.add(
        mapOf(
          "uri" to "file://${outputFile.absolutePath}",
          "width" to range.x1 - range.x0,
          "height" to range.y1 - range.y0,
          "pageIndex" to pageIndex,
          "x0" to range.x0,
          "y0" to range.y0,
        ),
      )
    }

    val garbage = mutableListOf<Map<String, Any>>()
    var garbageIndex = 0
    for (range in complementRanges(raster.ranges, raster.width, raster.height)) {
      if (!shouldKeepGarbageBand(raster.gray, raster.width, raster.height, range.y0, range.y1)) {
        continue
      }

      val image = cropGray(raster, range)
      val outputFile = File(outputDir, "p${pageIndex}_g$garbageIndex.png")
      if (!RasterNative.writeGrayPng(image.gray, image.width, image.height, outputFile.absolutePath, MASTER_PNG_LEVEL)) {
        throw coded("IO_ERROR", "Failed to write garbage PNG for page $pageIndex.")
      }

      garbage.add(
        mapOf(
          "uri" to "file://${outputFile.absolutePath}",
          "width" to image.width,
          "height" to image.height,
          "pageIndex" to pageIndex,
          "x0" to range.x0,
          "y0" to range.y0,
        ),
      )
      garbageIndex += 1
    }

    return mapOf(
      "strips" to strips,
      "garbage" to garbage,
    )
  }

  private fun cropGray(raster: PageRaster, range: StripRange): GrayImage {
    val cropWidth = range.x1 - range.x0
    val cropHeight = range.y1 - range.y0
    val cropped = ByteArray(cropWidth * cropHeight)
    for (y in 0 until cropHeight) {
      System.arraycopy(
        raster.gray,
        (range.y0 + y) * raster.width + range.x0,
        cropped,
        y * cropWidth,
        cropWidth,
      )
    }
    return GrayImage(cropped, cropWidth, cropHeight)
  }

  // Shrinks a strip image to exactly width x height pixels with an area filter
  // and caches the result, so the reader can show it 1:1 instead of letting the
  // GPU resample it (which blurs when enlarging and aliases thin staff lines
  // when shrinking). Returns the original uri when there is nothing to shrink.
  private fun resampleForDisplay(uri: String, width: Int, height: Int): String {
    if (width <= 0 || height <= 0) {
      return uri
    }

    val context = appContext.reactContext ?: throw coded("IO_ERROR", "React context is unavailable.")
    val source = File(resolveLocalPath(uri))
    if (!source.isFile) {
      throw coded("IO_ERROR", "Strip image does not exist.")
    }

    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(source.path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
      throw coded("IO_ERROR", "Unable to read strip image size.")
    }
    if (width >= bounds.outWidth && height >= bounds.outHeight) {
      return uri
    }

    val cacheDir = File(context.cacheDir, "display")
    if (!cacheDir.exists() && !cacheDir.mkdirs()) {
      throw coded("IO_ERROR", "Unable to create display cache directory.")
    }
    val target = File(cacheDir, "${displayCacheKey(source)}_${width}x$height.png")
    if (target.isFile) {
      return "file://${target.absolutePath}"
    }

    resampleSemaphore.acquire()
    try {
      if (target.isFile) {
        return "file://${target.absolutePath}"
      }

      val decodeOptions = BitmapFactory.Options().apply {
        inPreferredConfig = Bitmap.Config.ARGB_8888
      }
      val bitmap = BitmapFactory.decodeFile(source.path, decodeOptions)
        ?: throw coded("IO_ERROR", "Unable to decode strip image.")
      val gray = try {
        bitmapToGrayscale(bitmap, bitmap.width, bitmap.height)
      } finally {
        bitmap.recycle()
      }

      val resized = ByteArray(width * height)
      if (!RasterNative.areaResample(gray, bounds.outWidth, bounds.outHeight, resized, width, height)) {
        throw coded("IO_ERROR", "Unable to resize strip image.")
      }

      // Write under a temporary name so a concurrent request never reads a partial file.
      val temporary = File(cacheDir, "${target.name}.${UUID.randomUUID()}.tmp")
      if (!RasterNative.writeGrayPng(resized, width, height, temporary.absolutePath, DISPLAY_PNG_LEVEL) ||
        !temporary.renameTo(target)
      ) {
        temporary.delete()
        throw coded("IO_ERROR", "Unable to write resized strip image.")
      }
    } finally {
      resampleSemaphore.release()
    }

    if (displayWritesSincePrune.incrementAndGet() >= DISPLAY_CACHE_PRUNE_INTERVAL) {
      displayWritesSincePrune.set(0)
      pruneDisplayCache(cacheDir)
    }
    return "file://${target.absolutePath}"
  }

  // Strip files are never rewritten in place, but key on size and mtime too so a
  // replaced file can never be served a stale resize.
  private fun displayCacheKey(source: File): String {
    val digest = MessageDigest.getInstance("SHA-1")
      .digest("${source.absolutePath}|${source.length()}|${source.lastModified()}".toByteArray())
    return digest.take(10).joinToString("") { "%02x".format(it) }
  }

  private fun pruneDisplayCache(cacheDir: File) {
    val files = cacheDir.listFiles() ?: return
    if (files.size <= DISPLAY_CACHE_MAX_FILES) {
      return
    }
    files.sortedBy { it.lastModified() }
      .take(files.size - DISPLAY_CACHE_PRUNED_FILES)
      .forEach { it.delete() }
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
    if (bitmap.config == Bitmap.Config.ARGB_8888) {
      if (!RasterNative.bitmapToGray(bitmap, gray)) {
        throw coded("IO_ERROR", "Unable to read bitmap pixels.")
      }
      return gray
    }

    val converted = bitmap.copy(Bitmap.Config.ARGB_8888, false)
      ?: throw coded("IO_ERROR", "Unable to convert bitmap.")
    try {
      if (!RasterNative.bitmapToGray(converted, gray)) {
        throw coded("IO_ERROR", "Unable to read bitmap pixels.")
      }
    } finally {
      converted.recycle()
    }
    return gray
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
