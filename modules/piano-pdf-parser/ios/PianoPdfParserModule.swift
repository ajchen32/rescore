import CryptoKit
import ExpoModulesCore
import PDFKit
import UIKit

private enum SlicerError: Error {
  case coded(code: String, message: String)
}

private struct ProcessPdfOptions: Record {
  @Field var dpi: Double?
  @Field var pageIndices: [Double]?
}

private struct PagePreviewRecord: Record {
  @Field var pageIndex: Double = 0
  @Field var uri: String = ""
  @Field var width: Double = 0
  @Field var height: Double = 0
}

private struct StripRecord: Record {
  @Field var uri: String = ""
  @Field var width: Double = 0
  @Field var height: Double = 0
  @Field var pageIndex: Double = 0
  @Field var x0: Double?
  @Field var y0: Double?
}

private struct ProcessPdfResult: Record {
  @Field var strips: [StripRecord] = []
  @Field var garbage: [StripRecord] = []
  @Field var jobId: String?
  @Field var directoryUri: String?
}

private struct StripRange {
  let x0: Int
  let y0: Int
  let x1: Int
  let y1: Int
}

private let garbageMinHeightRatio = 0.03
private let garbageMinInkRatio = 0.001
private let inkThreshold = 240
private let previewMaxSidePx: CGFloat = 280
private let previewZoomMaxSidePx: CGFloat = 1400

// Strip images are stored at up to masterScale x the slicing resolution (capped
// at maxMasterDpi) so the reader can shrink them to its exact slot size instead
// of enlarging them. Strip metadata stays in slicing-raster pixels.
private let masterScale: CGFloat = 2
private let maxMasterDpi: CGFloat = 500
private let displayCacheMaxFiles = 2000
private let displayCachePrunedFiles = 1500
private let displayCachePruneInterval = 50

// A strip re-rendered from the PDF at master resolution (8-bit gray, tightly packed).
private struct MasterStrip {
  let pixels: [UInt8]
  let width: Int
  let height: Int
}

// PDFDocuments for import workers to render master strips with: PDFKit isn't
// documented as safe for concurrent use of one document, so each concurrent
// render borrows its own.
private final class DocumentPool: @unchecked Sendable {
  private let url: URL
  private let lock = NSLock()
  private var idle: [PDFDocument] = []

  init(url: URL) {
    self.url = url
  }

  func withDocument<T>(_ body: (PDFDocument) throws -> T) throws -> T {
    lock.lock()
    let reused = idle.popLast()
    lock.unlock()

    guard let document = reused ?? Self.open(url) else {
      throw Exception(name: "INVALID_PDF", description: "Unable to open PDF document.", code: "INVALID_PDF")
    }
    defer {
      lock.lock()
      idle.append(document)
      lock.unlock()
    }
    return try body(document)
  }

  private static func open(_ url: URL) -> PDFDocument? {
    guard let document = PDFDocument(url: url) else {
      return nil
    }
    if document.isEncrypted {
      _ = document.unlock(withPassword: "")
    }
    return document
  }
}

// Counts resized images written so the display cache is pruned every
// displayCachePruneInterval writes rather than on each one.
private final class DisplayCachePruner: @unchecked Sendable {
  private let lock = NSLock()
  private var writesSincePrune = 0

  func recordWrite() -> Bool {
    lock.lock()
    defer {
      lock.unlock()
    }
    writesSincePrune += 1
    if writesSincePrune < displayCachePruneInterval {
      return false
    }
    writesSincePrune = 0
    return true
  }
}

public class PianoPdfParserModule: Module {
  private static let resampleSemaphore = DispatchSemaphore(value: 2)
  private static let displayCachePruner = DisplayCachePruner()

  public func definition() -> ModuleDefinition {
    Name("PianoPdfParser")

    Events("onProgress")

    AsyncFunction("resampleForDisplay") { (uri: String, width: Int, height: Int) -> String in
      return try Self.resampleForDisplay(uri: uri, width: width, height: height)
    }

    AsyncFunction("processPdf") { (pdfUri: String, options: ProcessPdfOptions?) -> ProcessPdfResult in
      return try self.processPdf(pdfUri: pdfUri, options: options)
    }

    AsyncFunction("getPdfPagePreviews") { (pdfUri: String) -> [PagePreviewRecord] in
      return try self.getPdfPagePreviews(pdfUri: pdfUri)
    }

    AsyncFunction("getPdfPagePreview") { (pdfUri: String, pageIndex: Double) -> PagePreviewRecord in
      return try self.getPdfPagePreview(pdfUri: pdfUri, pageIndex: Int(pageIndex))
    }

    AsyncFunction("processImages") { (imageUris: [String]) -> ProcessPdfResult in
      return try self.processImages(imageUris: imageUris)
    }

    View(MusicInvertView.self) {
      Prop("inverted") { (view: MusicInvertView, inverted: Bool) in
        view.setInverted(inverted)
      }
    }
  }

  private func processPdf(pdfUri: String, options: ProcessPdfOptions?) throws -> ProcessPdfResult {
    let filePath = try Self.resolvePdfPath(pdfUri)
    try Self.validatePdfHeader(at: filePath)

    guard let document = PDFDocument(url: URL(fileURLWithPath: filePath)) else {
      throw Self.exception(code: "INVALID_PDF", message: "Unable to open PDF document.")
    }

    if document.isEncrypted {
      let unlocked = document.unlock(withPassword: "")
      if !unlocked || document.isLocked {
        throw Self.exception(code: "PASSWORD_PROTECTED", message: "PDF is password protected.")
      }
    }

    let pageCount = document.pageCount
    if pageCount <= 0 {
      throw Self.exception(code: "EMPTY_RESULT", message: "PDF contains no pages.")
    }

    let selectedPages = try Self.resolvePageIndices(options: options, pageCount: pageCount)
    let selectedCount = selectedPages.count

    let jobId = UUID().uuidString.lowercased()
    let outputDir = try Self.createOutputDirectory(jobId: jobId)

    let maxInflight = min(4, ProcessInfo.processInfo.activeProcessorCount)
    let semaphore = DispatchSemaphore(value: maxInflight)
    let workQueue = DispatchQueue(label: "piano-pdf-parser.slice", attributes: .concurrent)
    let group = DispatchGroup()
    let resultLock = NSLock()
    var pageResultsByStep: [PageSliceResult?] = Array(repeating: nil, count: selectedCount)
    var processingError: Error?
    let documentPool = DocumentPool(url: URL(fileURLWithPath: filePath))

    for step in 0..<selectedCount {
      let pageIndex = selectedPages[step]
      guard let page = document.page(at: pageIndex) else {
        throw Self.exception(code: "INVALID_PDF", message: "Missing page \(pageIndex).")
      }

      semaphore.wait()
      let raster: RasterizedPage
      let dpi: CGFloat
      do {
        dpi = Self.resolveDpi(for: page, options: options)
        raster = try Self.rasterizePage(page: page, dpi: dpi)
      } catch {
        semaphore.signal()
        throw error
      }

      let bufferSize = raster.stride * raster.height
      let grayCopy = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
      grayCopy.initialize(from: raster.data, count: bufferSize)
      raster.data.deallocate()

      group.enter()
      workQueue.async {
        defer {
          grayCopy.deallocate()
          semaphore.signal()
          group.leave()
        }

        do {
          let ranges = try Self.sliceRanges(
            pageIndex: pageIndex,
            gray: grayCopy,
            width: raster.width,
            height: raster.height,
            stride: raster.stride
          )
          let masters = try documentPool.withDocument { poolDocument -> [MasterStrip] in
            guard let poolPage = poolDocument.page(at: pageIndex) else {
              throw Self.exception(code: "INVALID_PDF", message: "Missing page \(pageIndex).")
            }
            return try ranges.map { range in
              try Self.renderMasterStrip(page: poolPage, range: range, dpi: dpi, rasterHeight: raster.height)
            }
          }
          let pageResult = try Self.writePageStrips(
            pageIndex: pageIndex,
            gray: grayCopy,
            width: raster.width,
            height: raster.height,
            stride: raster.stride,
            ranges: ranges,
            masters: masters,
            outputDir: outputDir
          )
          resultLock.lock()
          pageResultsByStep[step] = pageResult
          resultLock.unlock()
        } catch {
          resultLock.lock()
          if processingError == nil {
            processingError = error
          }
          resultLock.unlock()
        }
      }
    }

    group.wait()
    if let processingError {
      throw processingError
    }

    var allStrips: [StripRecord] = []
    var allGarbage: [StripRecord] = []
    var stripCountSoFar = 0
    for step in 0..<selectedCount {
      guard let pageResult = pageResultsByStep[step] else {
        continue
      }
      allStrips.append(contentsOf: pageResult.strips)
      allGarbage.append(contentsOf: pageResult.garbage)
      stripCountSoFar += pageResult.strips.count
      sendEvent("onProgress", [
        "pageIndex": step,
        "pageCount": selectedCount,
        "stripCountSoFar": stripCountSoFar,
      ])
    }

    if allStrips.isEmpty {
      throw Self.exception(code: "EMPTY_RESULT", message: "No strips were produced from the PDF.")
    }

    let result = ProcessPdfResult()
    result.strips = allStrips
    result.garbage = allGarbage
    result.jobId = jobId
    var directoryUri = outputDir.absoluteString
    if !directoryUri.hasSuffix("/") {
      directoryUri += "/"
    }
    result.directoryUri = directoryUri
    return result
  }

  private func processImages(imageUris: [String]) throws -> ProcessPdfResult {
    if imageUris.isEmpty {
      throw Self.exception(code: "EMPTY_RESULT", message: "No images selected.")
    }

    let jobId = UUID().uuidString.lowercased()
    let outputDir = try Self.createOutputDirectory(jobId: jobId)
    let imageCount = imageUris.count

    let maxInflight = min(4, ProcessInfo.processInfo.activeProcessorCount)
    let semaphore = DispatchSemaphore(value: maxInflight)
    let workQueue = DispatchQueue(label: "piano-pdf-parser.image-slice", attributes: .concurrent)
    let group = DispatchGroup()
    let resultLock = NSLock()
    var pageResultsByStep: [PageSliceResult?] = Array(repeating: nil, count: imageCount)
    var processingError: Error?

    for step in 0..<imageCount {
      let filePath = try Self.resolvePdfPath(imageUris[step])
      try Self.validateImageFile(at: filePath)

      semaphore.wait()
      let raster: RasterizedPage
      do {
        raster = try Self.rasterizeImage(at: filePath)
      } catch {
        semaphore.signal()
        throw error
      }

      let bufferSize = raster.stride * raster.height
      let grayCopy = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
      grayCopy.initialize(from: raster.data, count: bufferSize)
      raster.data.deallocate()

      let pageIndex = step
      group.enter()
      workQueue.async {
        defer {
          grayCopy.deallocate()
          semaphore.signal()
          group.leave()
        }

        do {
          let ranges = try Self.sliceRanges(
            pageIndex: pageIndex,
            gray: grayCopy,
            width: raster.width,
            height: raster.height,
            stride: raster.stride
          )
          let pageResult = try Self.writePageStrips(
            pageIndex: pageIndex,
            gray: grayCopy,
            width: raster.width,
            height: raster.height,
            stride: raster.stride,
            ranges: ranges,
            masters: nil,
            outputDir: outputDir
          )
          resultLock.lock()
          pageResultsByStep[step] = pageResult
          resultLock.unlock()
        } catch {
          resultLock.lock()
          if processingError == nil {
            processingError = error
          }
          resultLock.unlock()
        }
      }
    }

    group.wait()
    if let processingError {
      throw processingError
    }

    var allStrips: [StripRecord] = []
    var allGarbage: [StripRecord] = []
    var stripCountSoFar = 0
    for step in 0..<imageCount {
      guard let pageResult = pageResultsByStep[step] else {
        continue
      }
      allStrips.append(contentsOf: pageResult.strips)
      allGarbage.append(contentsOf: pageResult.garbage)
      stripCountSoFar += pageResult.strips.count
      sendEvent("onProgress", [
        "pageIndex": step,
        "pageCount": imageCount,
        "stripCountSoFar": stripCountSoFar,
      ])
    }

    if allStrips.isEmpty {
      throw Self.exception(code: "EMPTY_RESULT", message: "No strips were produced from the images.")
    }

    let result = ProcessPdfResult()
    result.strips = allStrips
    result.garbage = allGarbage
    result.jobId = jobId
    var directoryUri = outputDir.absoluteString
    if !directoryUri.hasSuffix("/") {
      directoryUri += "/"
    }
    result.directoryUri = directoryUri
    return result
  }

  private func getPdfPagePreviews(pdfUri: String) throws -> [PagePreviewRecord] {
    let filePath = try Self.resolvePdfPath(pdfUri)
    try Self.validatePdfHeader(at: filePath)

    guard let document = PDFDocument(url: URL(fileURLWithPath: filePath)) else {
      throw Self.exception(code: "INVALID_PDF", message: "Unable to open PDF document.")
    }

    if document.isEncrypted {
      let unlocked = document.unlock(withPassword: "")
      if !unlocked || document.isLocked {
        throw Self.exception(code: "PASSWORD_PROTECTED", message: "PDF is password protected.")
      }
    }

    let pageCount = document.pageCount
    if pageCount <= 0 {
      throw Self.exception(code: "EMPTY_RESULT", message: "PDF contains no pages.")
    }

    let previewId = UUID().uuidString.lowercased()
    let previewDir = try Self.createPreviewDirectory(previewId: previewId)
    var previews: [PagePreviewRecord] = []

    for pageIndex in 0..<pageCount {
      guard let page = document.page(at: pageIndex) else {
        continue
      }

      let rendered = try Self.rasterizePreview(page: page, maxSidePx: previewMaxSidePx)
      let filename = "p\(pageIndex).jpg"
      let outputURL = previewDir.appendingPathComponent(filename)
      guard let jpegData = rendered.image.jpegData(compressionQuality: 0.85) else {
        throw Self.exception(code: "IO_ERROR", message: "Failed to encode preview for page \(pageIndex).")
      }
      try jpegData.write(to: outputURL)

      let preview = PagePreviewRecord()
      preview.pageIndex = Double(pageIndex)
      preview.uri = outputURL.absoluteString
      preview.width = Double(rendered.width)
      preview.height = Double(rendered.height)
      previews.append(preview)
    }

    return previews
  }

  private func getPdfPagePreview(pdfUri: String, pageIndex: Int) throws -> PagePreviewRecord {
    let filePath = try Self.resolvePdfPath(pdfUri)
    try Self.validatePdfHeader(at: filePath)

    guard let document = PDFDocument(url: URL(fileURLWithPath: filePath)) else {
      throw Self.exception(code: "INVALID_PDF", message: "Unable to open PDF document.")
    }

    if document.isEncrypted {
      let unlocked = document.unlock(withPassword: "")
      if !unlocked || document.isLocked {
        throw Self.exception(code: "PASSWORD_PROTECTED", message: "PDF is password protected.")
      }
    }

    let pageCount = document.pageCount
    if pageCount <= 0 {
      throw Self.exception(code: "EMPTY_RESULT", message: "PDF contains no pages.")
    }
    if pageIndex < 0 || pageIndex >= pageCount {
      throw Self.exception(code: "INVALID_PDF", message: "Page index \(pageIndex) is out of range.")
    }

    guard let page = document.page(at: pageIndex) else {
      throw Self.exception(code: "INVALID_PDF", message: "Missing page \(pageIndex).")
    }

    let previewId = UUID().uuidString.lowercased()
    let previewDir = try Self.createPreviewDirectory(previewId: "zoom/\(previewId)")
    let rendered = try Self.rasterizePreview(page: page, maxSidePx: previewZoomMaxSidePx)
    let filename = "p\(pageIndex).jpg"
    let outputURL = previewDir.appendingPathComponent(filename)
    guard let jpegData = rendered.image.jpegData(compressionQuality: 0.85) else {
      throw Self.exception(code: "IO_ERROR", message: "Failed to encode preview for page \(pageIndex).")
    }
    try jpegData.write(to: outputURL)

    let preview = PagePreviewRecord()
    preview.pageIndex = Double(pageIndex)
    preview.uri = outputURL.absoluteString
    preview.width = Double(rendered.width)
    preview.height = Double(rendered.height)
    return preview
  }

  private static func resolvePageIndices(options: ProcessPdfOptions?, pageCount: Int) throws -> [Int] {
    guard let raw = options?.pageIndices else {
      return Array(0..<pageCount)
    }

    let list = raw.map { Int($0) }
    if list.isEmpty {
      throw exception(code: "EMPTY_RESULT", message: "No pages selected.")
    }

    var seen = Set<Int>()
    var ordered: [Int] = []
    for index in list {
      if seen.contains(index) {
        continue
      }
      seen.insert(index)
      if index < 0 || index >= pageCount {
        throw exception(code: "INVALID_PDF", message: "Page index \(index) is out of range.")
      }
      ordered.append(index)
    }
    return ordered
  }

  private static func resolvePdfPath(_ pdfUri: String) throws -> String {
    let trimmed = pdfUri.trimmingCharacters(in: .whitespacesAndNewlines)
    let lowered = trimmed.lowercased()

    if lowered.hasPrefix("content://") || lowered.hasPrefix("http://") || lowered.hasPrefix("https://") {
      throw exception(code: "UNSUPPORTED_URI", message: "Only local file paths are supported.")
    }

    if lowered.hasPrefix("file://") {
      guard let url = URL(string: trimmed) else {
        throw exception(code: "UNSUPPORTED_URI", message: "Invalid file URI.")
      }
      return url.path
    }

    if trimmed.hasPrefix("/") {
      return trimmed
    }

    throw exception(code: "UNSUPPORTED_URI", message: "PDF path must be a file:// URI or absolute path.")
  }

  private static func validatePdfHeader(at path: String) throws {
    let url = URL(fileURLWithPath: path)
    guard let handle = try? FileHandle(forReadingFrom: url) else {
      throw exception(code: "IO_ERROR", message: "Unable to read PDF file.")
    }

    let headerData = try handle.read(upToCount: 4)
    try handle.close()

    guard let headerData, headerData.count == 4, String(data: headerData, encoding: .ascii) == "%PDF" else {
      throw exception(code: "INVALID_PDF", message: "File is not a valid PDF.")
    }
  }

  private static func createOutputDirectory(jobId: String) throws -> URL {
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
    guard let caches else {
      throw exception(code: "IO_ERROR", message: "Unable to access cache directory.")
    }

    let outputDir = caches.appendingPathComponent("slices", isDirectory: true).appendingPathComponent(jobId, isDirectory: true)
    try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
    return outputDir
  }

  private static func createPreviewDirectory(previewId: String) throws -> URL {
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
    guard let caches else {
      throw exception(code: "IO_ERROR", message: "Unable to access cache directory.")
    }

    let previewDir = caches
      .appendingPathComponent("previews", isDirectory: true)
      .appendingPathComponent(previewId, isDirectory: true)
    try FileManager.default.createDirectory(at: previewDir, withIntermediateDirectories: true)
    return previewDir
  }

  private struct PreviewRaster {
    let image: UIImage
    let width: Int
    let height: Int
  }

  private static func rasterizePreview(page: PDFPage, maxSidePx: CGFloat) throws -> PreviewRaster {
    let pageRect = page.bounds(for: .mediaBox)
    let longest = max(pageRect.width, pageRect.height)
    let scale = maxSidePx / max(longest, 1)
    let width = max(Int(pageRect.width * scale), 1)
    let height = max(Int(pageRect.height * scale), 1)

    let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height))
    let image = renderer.image { context in
      UIColor.white.setFill()
      context.fill(CGRect(x: 0, y: 0, width: width, height: height))

      context.cgContext.saveGState()
      context.cgContext.translateBy(x: 0, y: CGFloat(height))
      context.cgContext.scaleBy(x: scale, y: -scale)
      page.draw(with: .mediaBox, to: context.cgContext)
      context.cgContext.restoreGState()
    }

    return PreviewRaster(image: image, width: width, height: height)
  }

  private struct PageSliceResult {
    let strips: [StripRecord]
    let garbage: [StripRecord]
  }

  private static func sliceRanges(
    pageIndex: Int,
    gray: UnsafePointer<UInt8>,
    width: Int,
    height: Int,
    stride: Int
  ) throws -> [StripRange] {
    guard let ranges = ppp_slice_page_objc(
      gray,
      Int32(width),
      Int32(height),
      Int32(stride)
    ) else {
      throw exception(code: "IO_ERROR", message: "Failed to slice page \(pageIndex).")
    }

    return ranges
      .map {
        StripRange(
          x0: Int($0.x0),
          y0: Int($0.y0),
          x1: Int($0.x1),
          y1: Int($0.y1)
        )
      }
      .filter { $0.x1 > $0.x0 && $0.y1 > $0.y0 }
  }

  // Renders one strip straight from the PDF at masterScale x the slicing raster
  // (see rasterizePage). The transform is rasterizePage's, preceded by the map
  // from raster pixels to this strip's master pixels.
  private static func renderMasterStrip(
    page: PDFPage,
    range: StripRange,
    dpi: CGFloat,
    rasterHeight: Int
  ) throws -> MasterStrip {
    let scale = dpi / 72.0
    let k = max(min(masterScale, maxMasterDpi / dpi), 1)
    let masterWidth = max(Int((CGFloat(range.x1 - range.x0) * k).rounded()), 1)
    let masterHeight = max(Int((CGFloat(range.y1 - range.y0) * k).rounded()), 1)

    guard let colorSpace = CGColorSpaceCreateDeviceGray() else {
      throw exception(code: "IO_ERROR", message: "Failed to create grayscale color space.")
    }

    var pixels = [UInt8](repeating: 255, count: masterWidth * masterHeight)
    let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
      guard let context = CGContext(
        data: buffer.baseAddress,
        width: masterWidth,
        height: masterHeight,
        bitsPerComponent: 8,
        bytesPerRow: masterWidth,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.none.rawValue
      ) else {
        return false
      }

      context.setFillColor(gray: 1.0, alpha: 1.0)
      context.fill(CGRect(x: 0, y: 0, width: masterWidth, height: masterHeight))

      context.saveGState()
      // Raster pixel (x, rowFromTop) lands at master pixel k * (x - x0, rowFromTop - y0).
      context.translateBy(
        x: -k * CGFloat(range.x0),
        y: CGFloat(masterHeight) - k * CGFloat(rasterHeight - range.y0)
      )
      context.scaleBy(x: k, y: k)
      context.translateBy(x: 0, y: CGFloat(rasterHeight))
      context.scaleBy(x: scale, y: -scale)
      page.draw(with: .mediaBox, to: context)
      context.restoreGState()
      return true
    }

    if !drawn {
      throw exception(code: "IO_ERROR", message: "Failed to create bitmap context.")
    }
    return MasterStrip(pixels: pixels, width: masterWidth, height: masterHeight)
  }

  // Strip metadata (width/height/x0/y0) is always in slicing-raster pixels; the
  // PNG itself may be larger when a master was rendered.
  private static func writePageStrips(
    pageIndex: Int,
    gray: UnsafePointer<UInt8>,
    width: Int,
    height: Int,
    stride: Int,
    ranges keptRanges: [StripRange],
    masters: [MasterStrip]?,
    outputDir: URL
  ) throws -> PageSliceResult {
    var strips: [StripRecord] = []
    for (stripIndex, range) in keptRanges.enumerated() {
      let filename = "p\(pageIndex)_\(stripIndex).png"
      let outputPath = outputDir.appendingPathComponent(filename).path

      var outWidth: Int32 = 0
      var outHeight: Int32 = 0
      let wrote: Bool
      if let master = masters?[stripIndex] {
        wrote = master.pixels.withUnsafeBufferPointer { buffer in
          ppp_write_png_strip(
            buffer.baseAddress!,
            Int32(master.width),
            Int32(master.height),
            Int32(master.width),
            0,
            0,
            Int32(master.width),
            Int32(master.height),
            outputPath,
            &outWidth,
            &outHeight
          )
        }
      } else {
        wrote = ppp_write_png_strip(
          gray,
          Int32(width),
          Int32(height),
          Int32(stride),
          Int32(range.x0),
          Int32(range.y0),
          Int32(range.x1),
          Int32(range.y1),
          outputPath,
          &outWidth,
          &outHeight
        )
      }

      if !wrote {
        throw exception(code: "IO_ERROR", message: "Failed to write strip PNG for page \(pageIndex).")
      }

      let strip = StripRecord()
      strip.uri = URL(fileURLWithPath: outputPath).absoluteString
      strip.width = Double(range.x1 - range.x0)
      strip.height = Double(range.y1 - range.y0)
      strip.pageIndex = Double(pageIndex)
      strip.x0 = Double(range.x0)
      strip.y0 = Double(range.y0)
      strips.append(strip)
    }

    var garbage: [StripRecord] = []
    var garbageIndex = 0
    for range in complementRanges(kept: keptRanges, width: width, height: height) {
      if !shouldKeepGarbageBand(
        gray: gray,
        width: width,
        height: height,
        stride: stride,
        y0: range.y0,
        y1: range.y1
      ) {
        continue
      }

      let filename = "p\(pageIndex)_g\(garbageIndex).png"
      let outputPath = outputDir.appendingPathComponent(filename).path
      let bandHeight = range.y1 - range.y0

      var outWidth: Int32 = 0
      var outHeight: Int32 = 0
      let wrote = ppp_write_png_strip(
        gray,
        Int32(width),
        Int32(height),
        Int32(stride),
        Int32(range.x0),
        Int32(range.y0),
        Int32(range.x1),
        Int32(range.y1),
        outputPath,
        &outWidth,
        &outHeight
      )

      if !wrote {
        throw exception(code: "IO_ERROR", message: "Failed to write garbage PNG for page \(pageIndex).")
      }

      let piece = StripRecord()
      piece.uri = URL(fileURLWithPath: outputPath).absoluteString
      piece.width = Double(outWidth)
      piece.height = Double(bandHeight)
      piece.pageIndex = Double(pageIndex)
      piece.x0 = Double(range.x0)
      piece.y0 = Double(range.y0)
      garbage.append(piece)
      garbageIndex += 1
    }

    return PageSliceResult(strips: strips, garbage: garbage)
  }

  private static func complementRanges(kept: [StripRange], width: Int, height: Int) -> [StripRange] {
    if kept.isEmpty {
      return [StripRange(x0: 0, y0: 0, x1: width, y1: height)]
    }

    let sorted = kept.sorted { $0.y0 < $1.y0 }
    var result: [StripRange] = []
    var cursor = 0
    for range in sorted {
      if range.y0 > cursor {
        result.append(StripRange(x0: 0, y0: cursor, x1: width, y1: range.y0))
      }
      cursor = max(cursor, range.y1)
    }
    if cursor < height {
      result.append(StripRange(x0: 0, y0: cursor, x1: width, y1: height))
    }
    return result
  }

  private static func countInkInBand(
    gray: UnsafePointer<UInt8>,
    width: Int,
    height: Int,
    stride: Int,
    y0: Int,
    y1: Int
  ) -> Int {
    var ink = 0
    for y in y0..<min(y1, height) {
      let row = gray.advanced(by: y * stride)
      for x in 0..<width {
        if row[x] < inkThreshold {
          ink += 1
        }
      }
    }
    return ink
  }

  private static func shouldKeepGarbageBand(
    gray: UnsafePointer<UInt8>,
    width: Int,
    height: Int,
    stride: Int,
    y0: Int,
    y1: Int
  ) -> Bool {
    let bandHeight = y1 - y0
    let minHeight = max(1, Int(ceil(Double(height) * garbageMinHeightRatio)))
    if bandHeight < minHeight {
      return false
    }

    let ink = countInkInBand(gray: gray, width: width, height: height, stride: stride, y0: y0, y1: y1)
    let minInk = Int(ceil(Double(bandHeight) * Double(width) * garbageMinInkRatio))
    return ink >= minInk
  }

  private static func validateImageFile(at path: String) throws {
    var isDirectory: ObjCBool = false
    if !FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) || isDirectory.boolValue {
      throw exception(code: "IO_ERROR", message: "Image file does not exist.")
    }
  }

  private static func resolveTargetRasterWidthPx() -> Int {
    let screenWidthPixels = UIScreen.main.nativeBounds.width
    return max(Int(screenWidthPixels * 2.0), 1)
  }

  private static func normalizedCGImage(from image: UIImage) -> CGImage? {
    if image.imageOrientation == .up, let cgImage = image.cgImage {
      return cgImage
    }

    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
    let rendered = renderer.image { _ in
      image.draw(in: CGRect(origin: .zero, size: image.size))
    }
    return rendered.cgImage
  }

  private static func rasterizeImage(at path: String) throws -> RasterizedPage {
    guard let image = UIImage(contentsOfFile: path) else {
      throw exception(code: "INVALID_PDF", message: "Unable to decode image.")
    }
    guard let sourceImage = normalizedCGImage(from: image) else {
      throw exception(code: "INVALID_PDF", message: "Unable to decode image.")
    }

    let targetWidth = resolveTargetRasterWidthPx()
    let sourceWidth = CGFloat(sourceImage.width)
    let sourceHeight = CGFloat(sourceImage.height)
    let scale = CGFloat(targetWidth) / max(sourceWidth, 1)
    let width = targetWidth
    let height = max(Int(sourceHeight * scale), 1)
    let stride = width

    let bytesPerRow = width
    let bufferSize = bytesPerRow * height
    let data = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
    data.initialize(repeating: 255, count: bufferSize)

    guard let colorSpace = CGColorSpaceCreateDeviceGray() else {
      data.deallocate()
      throw exception(code: "IO_ERROR", message: "Failed to create grayscale color space.")
    }

    guard let context = CGContext(
      data: data,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: bytesPerRow,
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.none.rawValue
    ) else {
      data.deallocate()
      throw exception(code: "IO_ERROR", message: "Failed to create bitmap context.")
    }

    context.setFillColor(gray: 1.0, alpha: 1.0)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.interpolationQuality = .high
    context.draw(sourceImage, in: CGRect(x: 0, y: 0, width: width, height: height))

    return RasterizedPage(data: data, width: width, height: height, stride: stride)
  }

  private static func resolveDpi(for page: PDFPage, options: ProcessPdfOptions?) -> CGFloat {
    if let userDpi = options?.dpi, userDpi > 0 {
      return CGFloat(min(max(userDpi, 72), 400))
    }

    let screenWidthPixels = UIScreen.main.nativeBounds.width
    let targetWidth = max(screenWidthPixels * 2.0, 1.0)
    let pageWidthInches = max(page.bounds(for: .mediaBox).width / 72.0, 0.1)
    let computed = targetWidth / pageWidthInches
    return CGFloat(min(max(computed, 150.0), 250.0))
  }

  private struct RasterizedPage {
    let data: UnsafeMutablePointer<UInt8>
    let width: Int
    let height: Int
    let stride: Int
  }

  private static func rasterizePage(page: PDFPage, dpi: CGFloat) throws -> RasterizedPage {
    let pageRect = page.bounds(for: .mediaBox)
    let scale = dpi / 72.0
    let width = max(Int(pageRect.width * scale), 1)
    let height = max(Int(pageRect.height * scale), 1)
    let stride = width

    let bytesPerRow = width
    let bufferSize = bytesPerRow * height
    let data = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
    data.initialize(repeating: 255, count: bufferSize)

    guard let colorSpace = CGColorSpaceCreateDeviceGray() else {
      data.deallocate()
      throw exception(code: "IO_ERROR", message: "Failed to create grayscale color space.")
    }

    guard let context = CGContext(
      data: data,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: bytesPerRow,
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.none.rawValue
    ) else {
      data.deallocate()
      throw exception(code: "IO_ERROR", message: "Failed to create bitmap context.")
    }

    context.setFillColor(gray: 1.0, alpha: 1.0)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))

    context.saveGState()
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: scale, y: -scale)
    page.draw(with: .mediaBox, to: context)
    context.restoreGState()

    return RasterizedPage(data: data, width: width, height: height, stride: stride)
  }

  // Shrinks a strip image to exactly width x height pixels with an area filter
  // and caches the result, so the reader can show it 1:1 instead of letting the
  // GPU resample it (which blurs when enlarging and aliases thin staff lines
  // when shrinking). Returns the original uri when there is nothing to shrink.
  private static func resampleForDisplay(uri: String, width: Int, height: Int) throws -> String {
    if width <= 0 || height <= 0 {
      return uri
    }

    let sourcePath = try resolvePdfPath(uri)
    var sourceWidth: Int32 = 0
    var sourceHeight: Int32 = 0
    if !ppp_image_file_size(sourcePath, &sourceWidth, &sourceHeight) {
      throw exception(code: "IO_ERROR", message: "Unable to read strip image size.")
    }
    if width >= Int(sourceWidth) && height >= Int(sourceHeight) {
      return uri
    }

    guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      throw exception(code: "IO_ERROR", message: "Unable to access cache directory.")
    }
    let cacheDir = caches.appendingPathComponent("display", isDirectory: true)
    try FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
    let target = cacheDir.appendingPathComponent("\(try displayCacheKey(path: sourcePath))_\(width)x\(height).png")
    if FileManager.default.fileExists(atPath: target.path) {
      return target.absoluteString
    }

    resampleSemaphore.wait()
    defer {
      resampleSemaphore.signal()
    }
    if FileManager.default.fileExists(atPath: target.path) {
      return target.absoluteString
    }

    // Write under a temporary name so a concurrent request never reads a partial file.
    let temporary = cacheDir.appendingPathComponent("\(target.lastPathComponent).\(UUID().uuidString).tmp")
    if !ppp_resample_image_file(sourcePath, temporary.path, Int32(width), Int32(height)) {
      try? FileManager.default.removeItem(at: temporary)
      throw exception(code: "IO_ERROR", message: "Unable to write resized strip image.")
    }
    do {
      try FileManager.default.moveItem(at: temporary, to: target)
    } catch {
      try? FileManager.default.removeItem(at: temporary)
      if !FileManager.default.fileExists(atPath: target.path) {
        throw exception(code: "IO_ERROR", message: "Unable to write resized strip image.")
      }
    }

    if displayCachePruner.recordWrite() {
      pruneDisplayCache(cacheDir)
    }
    return target.absoluteString
  }

  // Strip files are never rewritten in place, but key on size and mtime too so a
  // replaced file can never be served a stale resize.
  private static func displayCacheKey(path: String) throws -> String {
    let attributes = try FileManager.default.attributesOfItem(atPath: path)
    let size = (attributes[.size] as? NSNumber)?.int64Value ?? 0
    let modified = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
    let digest = Insecure.SHA1.hash(data: Data("\(path)|\(size)|\(modified)".utf8))
    return digest.prefix(10).map { String(format: "%02x", $0) }.joined()
  }

  private static func pruneDisplayCache(_ cacheDir: URL) {
    guard let files = try? FileManager.default.contentsOfDirectory(
      at: cacheDir,
      includingPropertiesForKeys: [.contentModificationDateKey]
    ), files.count > displayCacheMaxFiles else {
      return
    }

    let byAge = files.sorted { lhs, rhs in
      let lhsDate = (try? lhs.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
      let rhsDate = (try? rhs.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
      return lhsDate < rhsDate
    }
    for file in byAge.prefix(files.count - displayCachePrunedFiles) {
      try? FileManager.default.removeItem(at: file)
    }
  }

  private static func exception(code: String, message: String) -> Exception {
    return Exception(name: code, description: message, code: code)
  }
}
