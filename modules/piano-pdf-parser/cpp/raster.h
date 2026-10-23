#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Resize an 8-bit grayscale image to exactly dst_w x dst_h, scaling X and Y
// independently. Shrinking averages every source pixel each output pixel covers
// (exact area coverage, so thin staff lines never alias); enlarging falls back
// to linear interpolation. `dst` is tightly packed (stride == dst_w).
void ppp_area_resample(
    const uint8_t* src,
    int32_t src_width,
    int32_t src_height,
    int32_t src_stride,
    uint8_t* dst,
    int32_t dst_width,
    int32_t dst_height);

#ifdef __cplusplus
}
#endif
