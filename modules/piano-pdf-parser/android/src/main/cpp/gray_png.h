#pragma once

#include <cstdint>

// Writes an 8-bit grayscale PNG. Strips are grayscale, and Android's
// Bitmap.compress can only write RGBA, which is ~2.5x larger on disk.
// `compression_level` is zlib's 0-9 (1 = fastest).
bool write_gray_png(
    const char* path,
    const uint8_t* gray,
    int32_t width,
    int32_t height,
    int32_t stride,
    int compression_level);
