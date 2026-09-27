# Rescore

On-device PDF slicing for piano scores. Pick a PDF, slice it into scrollable music-system strips, and read them full-width on your phone.

**Expo Go will not work.** This app uses a custom native module (`piano-pdf-parser-core`) and requires a development build.

## Requirements

- Node.js 18+
- Android Studio (Android) or Xcode (iOS) for native builds

## Setup

```sh
npm install
```

## Run (development build)

Generate native projects with the Expo Dev Client, then build and install:

```sh
npm run prebuild:dev
npx expo run:android
# or
npx expo run:ios
```

Start Metro for the dev client:

```sh
npm start
```

## Production APK (no Metro / Dev Client splash)

Builds a standalone release APK without `expo-dev-client`:

```sh
npm run build:apk
adb install -r dist/rescore-release.apk
```

After a release build, regenerate the Android project for day-to-day Metro work:

```sh
npm run prebuild:dev
npx expo run:android
```

After adding native dependencies (e.g. `expo-image-manipulator` for **Split** in Correct mode), rebuild the dev client — Metro reload alone is not enough:

```sh
npx expo run:android
# or
npx expo run:ios
```

Merge and delete in Correct mode work after a JS reload; split requires this rebuild.

## Picking a PDF on Android

- The system picker opens on **Recents**, not a full folder tree.
- **Internal storage** root often looks empty — that is normal.
- Open **Downloads** or other sources from the **☰** menu in the picker.
- The app accepts any file type in the picker (`*/*`) and validates `.pdf` by filename or MIME type in JavaScript (MIME filters can hide IMSLP downloads).

## Architecture

- **UI (this repo):** Expo + React Native + NativeWind. Copies the picked PDF into app cache (`Paths.cache`), then calls `processPdf(cachedUri)` from `piano-pdf-parser-core`.
- **Native module:** `modules/piano-pdf-parser` — on-device rasterization and projection-profile slicing. No backend, no upload.

## Mock mode

Until the native slicer is fully wired, `modules/piano-pdf-parser/src/index.ts` may be a mock that emits sample progress events and placeholder strip images. The UI imports only:

```ts
import { processPdf, addProgressListener } from "piano-pdf-parser-core";
```

Swapping mock → real native wrapper requires no UI changes.
