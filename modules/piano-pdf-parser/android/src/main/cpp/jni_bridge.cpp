#include <jni.h>

#include <cstdint>
#include <vector>

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
