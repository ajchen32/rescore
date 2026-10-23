# piano-pdf-parser-core

On-device PDF rasterization and projection-profile slicing for **Rescore**.

This local Expo module accepts a sandbox PDF path, rasterizes one page at a time with native APIs (PDFKit on iOS, `PdfRenderer` on Android), slices piano **systems** (not individual staves) using shared C++, writes PNG strips to cache, and returns strip metadata to JavaScript.

**Pixel buffers never cross the JS bridge.**

## Why Expo Go cannot run this

Expo Go ships a fixed set of prebuilt native modules. This module includes:

- Custom Swift / Kotlin code
- Shared C++ (`cpp/slicer.cpp`) compiled per platform
- Android CMake / NDK (`piano_pdf_parser_core` shared library)
- iOS CocoaPods with PDFKit + ObjC++ bridge

Those binaries are not in Expo Go. You must use a **development build**:

1. `expo-dev-client` in the host app
2. `npx expo prebuild` to generate `ios/` and `android/`
3. `npx expo run:ios` or `npx expo run:android` to compile and install

## Architecture

```text
JS (processPdf)
  → Expo Module (Swift / Kotlin)
    → rasterize one page (PDFKit / PdfRenderer)
    → 8-bit grayscale buffer
    → C ABI ppp_slice_page()
    → C++ Otsu + projection profile
    → { x0, y0, x1, y1 } ranges
    → Android: re-render each strip from the PDF at 2x (≤ 500 DPI) as a master
    → PNG encode (Android: 8-bit grayscale via C++; iOS: platform encoder)
    → file:// URIs + layout metadata

JS (resampleForDisplay, Android)
  → decode a strip PNG
  → C++ ppp_area_resample() to the reader slot's exact pixel size
  → cached PNG drawn 1:1, so the GPU never resamples the music
```

### C++ linking

| Platform | How `cpp/slicer.cpp` is linked |
|----------|--------------------------------|
| iOS | `PianoPdfParser.podspec` compiles `../cpp/slicer.cpp` into the pod; `SlicerBridge.mm` calls `ppp_slice_page`. |
| Android | `android/CMakeLists.txt` builds `libpiano_pdf_parser_core.so` from `jni_bridge.cpp`, `gray_png.cpp`, `../cpp/slicer.cpp` and `../cpp/raster.cpp`; Kotlin calls `SlicerNative` / `RasterNative` via JNI. |

Swift/Kotlin own PDF rasterization. C++ owns slicing geometry, sharpening and resampling (`cpp/raster.cpp`); on Android it also encodes the grayscale PNGs.

### Grayscale convention

- Input: `0` = black (ink), `255` = white (paper)
- After Otsu binarization: ink = `1`, paper = `0`

### Slicing constants (`cpp/slicer_constants.h`)

- `GAP_ROW_THRESHOLD_RATIO = 0.02`
- `MIN_GAP_HEIGHT_RATIO = 0.045` — skips the treble/bass gap inside a piano grand staff
- `MIN_STRIP_HEIGHT_RATIO = 0.03`

## Public API

Package name: `piano-pdf-parser-core`

```ts
import { processPdf, addProgressListener } from "piano-pdf-parser-core";
```

See [`src/index.ts`](src/index.ts) for the frozen TypeScript contract.

## Host app setup

In the Expo app root `package.json`:

```json
{
  "dependencies": {
    "piano-pdf-parser-core": "file:./modules/piano-pdf-parser",
    "expo-dev-client": "~6.0.0"
  }
}
```

Autolinking discovers `modules/piano-pdf-parser` automatically when it contains `expo-module.config.json`.

## Build commands (from Expo app root)

```bash
npm install

# Generate native projects (first time or after native changes)
npx expo prebuild

# iOS (requires macOS + Xcode)
npx expo run:ios

# Android (requires Android SDK + NDK)
npx expo run:android
```

After native code changes, rebuild the dev client. JS/TS changes hot-reload; C++/Swift/Kotlin do not.

## C++ host test (Linux / macOS / Windows)

No mobile SDK required:

```bash
cd modules/piano-pdf-parser
npm run test:cpp
```

Or manually:

```bash
cmake -S cpp -B cpp/build
cmake --build cpp/build
./cpp/build/slicer_test
./cpp/build/raster_test
```

Expected: synthetic 3-system page → **3 strips**, not 15 staff-line fragments.

## Output layout

Strips are written to:

```text
{caches}/slices/{jobId}/p{pageIndex}_{stripIndex}.png
```

Each returned `Strip` includes:

- `uri` — `file://` path to the PNG
- `width`, `height`, `x0`, `y0` — the strip's size and position in **layout units**: pixels of the page raster it was sliced from. Merging, splitting and overlap all work in these units. The PNG itself may be larger (Android PDF imports store a 2x master), so never derive geometry from the image's pixel size.
- `pageIndex` — 0-based PDF page

## Memory model

Up to three pages in flight: the main thread rasterizes pages one at a time; worker threads slice, render masters (each worker has its own `PdfRenderer`) and write PNGs. Peak memory ≈ three page rasters plus their master strips, not the full score.

`resampleForDisplay` caches its output under `{caches}/display/` (pruned to the newest 1500 files once it passes 2000) and resizes at most two strips at a time.

## Errors

Native code throws coded errors consumed by JS as `{ code, message }`:

| Code | Meaning |
|------|---------|
| `INVALID_PDF` | Missing/invalid `%PDF` header or unreadable document |
| `PASSWORD_PROTECTED` | Encrypted PDF |
| `IO_ERROR` | Filesystem or encode failure |
| `EMPTY_RESULT` | No pages or no strips produced |
| `UNSUPPORTED_URI` | Non-local URI (`content://`, `http://`, etc.) |

The frontend must copy Android picker URIs into app cache before calling `processPdf`.
