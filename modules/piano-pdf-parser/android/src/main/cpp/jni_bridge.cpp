#include <android/bitmap.h>
#include <jni.h>

#include <cmath>
#include <cstdint>
#include <vector>

#include "gray_png.h"
#include "raster.h"
#include "slicer.h"

extern "C" JNIEXPORT jintArray JNICALL
Java_expo_modules_pianopdfparser_SlicerNative_slicePage(
    JNIEnv* env,
    jobject /* thiz */,
    jbyteArray grayArray,
    jint width,
    jint height,
    jint stride) {
  if (grayArray == nullptr || width <= 0 || height <= 0 || stride < width) {
    return nullptr;
  }

  const jsize arrayLength = env->GetArrayLength(grayArray);
  const jsize required = static_cast<jsize>(stride) * static_cast<jsize>(height);
  if (arrayLength < required) {
    return nullptr;
  }

  jbyte* grayBytes = env->GetByteArrayElements(grayArray, nullptr);
  if (grayBytes == nullptr) {
    return nullptr;
  }

  PppSliceResult* result = ppp_slice_page(
      reinterpret_cast<const uint8_t*>(grayBytes),
      width,
      height,
      stride);

  env->ReleaseByteArrayElements(grayArray, grayBytes, JNI_ABORT);

  if (result == nullptr) {
    return nullptr;
  }

  const jint outputLength = result->count * 4;
  jintArray output = env->NewIntArray(outputLength);
  if (output == nullptr) {
    ppp_slice_result_free(result);
    return nullptr;
  }

  std::vector<jint> flat(static_cast<size_t>(outputLength));
  for (int32_t i = 0; i < result->count; ++i) {
    flat[static_cast<size_t>(i) * 4] = result->ranges[i].x0;
    flat[static_cast<size_t>(i) * 4 + 1] = result->ranges[i].y0;
    flat[static_cast<size_t>(i) * 4 + 2] = result->ranges[i].x1;
    flat[static_cast<size_t>(i) * 4 + 3] = result->ranges[i].y1;
  }

  env->SetIntArrayRegion(output, 0, outputLength, flat.data());
  ppp_slice_result_free(result);
  return output;
}

extern "C" JNIEXPORT void JNICALL
Java_expo_modules_pianopdfparser_SlicerNative_sharpenStrip(
    JNIEnv* env,
    jobject /* thiz */,
    jbyteArray grayArray,
    jint width,
    jint height,
    jint stride) {
  if (grayArray == nullptr || width <= 0 || height <= 0 || stride < width) {
    return;
  }

  const jsize arrayLength = env->GetArrayLength(grayArray);
  const jsize required = static_cast<jsize>(stride) * static_cast<jsize>(height);
  if (arrayLength < required) {
    return;
  }

  jbyte* grayBytes = env->GetByteArrayElements(grayArray, nullptr);
  if (grayBytes == nullptr) {
    return;
  }

  ppp_sharpen_strip(reinterpret_cast<uint8_t*>(grayBytes), width, height, stride);
  env->ReleaseByteArrayElements(grayArray, grayBytes, 0);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_pianopdfparser_RasterNative_areaResample(
    JNIEnv* env,
    jobject /* thiz */,
    jbyteArray srcArray,
    jint srcWidth,
    jint srcHeight,
    jbyteArray dstArray,
    jint dstWidth,
    jint dstHeight) {
  if (srcArray == nullptr || dstArray == nullptr || srcWidth <= 0 || srcHeight <= 0 ||
      dstWidth <= 0 || dstHeight <= 0) {
    return JNI_FALSE;
  }
  if (env->GetArrayLength(srcArray) < static_cast<jsize>(srcWidth) * static_cast<jsize>(srcHeight) ||
      env->GetArrayLength(dstArray) < static_cast<jsize>(dstWidth) * static_cast<jsize>(dstHeight)) {
    return JNI_FALSE;
  }

  jbyte* srcBytes = env->GetByteArrayElements(srcArray, nullptr);
  if (srcBytes == nullptr) {
    return JNI_FALSE;
  }
  jbyte* dstBytes = env->GetByteArrayElements(dstArray, nullptr);
  if (dstBytes == nullptr) {
    env->ReleaseByteArrayElements(srcArray, srcBytes, JNI_ABORT);
    return JNI_FALSE;
  }

  ppp_area_resample(
      reinterpret_cast<const uint8_t*>(srcBytes),
      srcWidth,
      srcHeight,
      srcWidth,
      reinterpret_cast<uint8_t*>(dstBytes),
      dstWidth,
      dstHeight);

  env->ReleaseByteArrayElements(srcArray, srcBytes, JNI_ABORT);
  env->ReleaseByteArrayElements(dstArray, dstBytes, 0);
  return JNI_TRUE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_pianopdfparser_RasterNative_writeGrayPng(
    JNIEnv* env,
    jobject /* thiz */,
    jbyteArray grayArray,
    jint width,
    jint height,
    jstring pathString,
    jint compressionLevel) {
  if (grayArray == nullptr || pathString == nullptr || width <= 0 || height <= 0) {
    return JNI_FALSE;
  }
  if (env->GetArrayLength(grayArray) < static_cast<jsize>(width) * static_cast<jsize>(height)) {
    return JNI_FALSE;
  }

  const char* path = env->GetStringUTFChars(pathString, nullptr);
  if (path == nullptr) {
    return JNI_FALSE;
  }
  jbyte* grayBytes = env->GetByteArrayElements(grayArray, nullptr);
  if (grayBytes == nullptr) {
    env->ReleaseStringUTFChars(pathString, path);
    return JNI_FALSE;
  }

  const bool written = write_gray_png(
      path,
      reinterpret_cast<const uint8_t*>(grayBytes),
      width,
      height,
      width,
      compressionLevel);

  env->ReleaseByteArrayElements(grayArray, grayBytes, JNI_ABORT);
  env->ReleaseStringUTFChars(pathString, path);
  return written ? JNI_TRUE : JNI_FALSE;
}

// Luminance of an RGBA_8888 bitmap, matching the Kotlin formula it replaces
// (0.299 R + 0.587 G + 0.114 B, rounded) evaluated in the same order with no
// fused multiply-add, so slicing sees exactly the same gray values.
extern "C" JNIEXPORT jboolean JNICALL
Java_expo_modules_pianopdfparser_RasterNative_bitmapToGray(
    JNIEnv* env,
    jobject /* thiz */,
    jobject bitmap,
    jbyteArray grayArray) {
  if (bitmap == nullptr || grayArray == nullptr) {
    return JNI_FALSE;
  }

  AndroidBitmapInfo info;
  if (AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS ||
      info.format != ANDROID_BITMAP_FORMAT_RGBA_8888) {
    return JNI_FALSE;
  }
  const jsize required = static_cast<jsize>(info.width) * static_cast<jsize>(info.height);
  if (env->GetArrayLength(grayArray) < required) {
    return JNI_FALSE;
  }

  void* pixels = nullptr;
  if (AndroidBitmap_lockPixels(env, bitmap, &pixels) != ANDROID_BITMAP_RESULT_SUCCESS ||
      pixels == nullptr) {
    return JNI_FALSE;
  }
  jbyte* grayBytes = env->GetByteArrayElements(grayArray, nullptr);
  if (grayBytes == nullptr) {
    AndroidBitmap_unlockPixels(env, bitmap);
    return JNI_FALSE;
  }

  for (uint32_t y = 0; y < info.height; ++y) {
    const uint8_t* row = static_cast<const uint8_t*>(pixels) + static_cast<size_t>(y) * info.stride;
    jbyte* out = grayBytes + static_cast<size_t>(y) * info.width;
    for (uint32_t x = 0; x < info.width; ++x) {
#pragma clang fp contract(off)
      const uint8_t* pixel = row + static_cast<size_t>(x) * 4;
      const double luminance = 0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2];
      out[x] = static_cast<jbyte>(static_cast<int32_t>(std::floor(luminance + 0.5)));
    }
  }

  env->ReleaseByteArrayElements(grayArray, grayBytes, 0);
  AndroidBitmap_unlockPixels(env, bitmap);
  return JNI_TRUE;
}
