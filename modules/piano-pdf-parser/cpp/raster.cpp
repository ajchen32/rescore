#include "raster.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace {

// Source pixels feeding one output pixel along one axis, with their weights.
struct Taps {
  int32_t first = 0;
  std::vector<float> weights;
};

std::vector<Taps> build_taps(int32_t src_len, int32_t dst_len) {
  std::vector<Taps> taps(static_cast<size_t>(dst_len));
  const double scale = static_cast<double>(src_len) / static_cast<double>(dst_len);

  for (int32_t i = 0; i < dst_len; ++i) {
    Taps& tap = taps[static_cast<size_t>(i)];
    if (scale >= 1.0) {
      // Shrink: average the source span [i * scale, (i + 1) * scale).
      const double begin = i * scale;
      const double end = begin + scale;
      const int32_t first = static_cast<int32_t>(std::floor(begin));
      const int32_t last =
          std::min(src_len - 1, static_cast<int32_t>(std::ceil(end)) - 1);
      tap.first = first;
      for (int32_t s = first; s <= last; ++s) {
        const double covered =
            std::min(end, s + 1.0) - std::max(begin, static_cast<double>(s));
        tap.weights.push_back(static_cast<float>(covered / scale));
      }
      continue;
    }

    // Enlarge: linear interpolation between the two nearest source centres.
    const double center = (i + 0.5) * scale - 0.5;
    const int32_t s0 =
        std::clamp(static_cast<int32_t>(std::floor(center)), 0, src_len - 1);
    const int32_t s1 = std::min(s0 + 1, src_len - 1);
    const float t = static_cast<float>(std::clamp(center - s0, 0.0, 1.0));
    tap.first = s0;
    if (s1 == s0) {
      tap.weights = {1.0f};
    } else {
      tap.weights = {1.0f - t, t};
    }
  }
  return taps;
}

}  // namespace

void ppp_area_resample(
    const uint8_t* src,
    int32_t src_width,
    int32_t src_height,
    int32_t src_stride,
    uint8_t* dst,
    int32_t dst_width,
    int32_t dst_height) {
  if (src == nullptr || dst == nullptr || src_width <= 0 || src_height <= 0 ||
      src_stride < src_width || dst_width <= 0 || dst_height <= 0) {
    return;
  }

  const std::vector<Taps> x_taps = build_taps(src_width, dst_width);
  const std::vector<Taps> y_taps = build_taps(src_height, dst_height);

  // Horizontal pass into floats, then the vertical pass into the output.
  std::vector<float> rows(static_cast<size_t>(src_height) * static_cast<size_t>(dst_width));
  for (int32_t y = 0; y < src_height; ++y) {
    const uint8_t* in = src + static_cast<size_t>(y) * static_cast<size_t>(src_stride);
    float* out = rows.data() + static_cast<size_t>(y) * static_cast<size_t>(dst_width);
    for (int32_t x = 0; x < dst_width; ++x) {
      const Taps& tap = x_taps[static_cast<size_t>(x)];
      float sum = 0.0f;
      for (size_t k = 0; k < tap.weights.size(); ++k) {
        sum += tap.weights[k] * static_cast<float>(in[tap.first + static_cast<int32_t>(k)]);
      }
      out[x] = sum;
    }
  }

  for (int32_t y = 0; y < dst_height; ++y) {
    const Taps& tap = y_taps[static_cast<size_t>(y)];
    uint8_t* out = dst + static_cast<size_t>(y) * static_cast<size_t>(dst_width);
    for (int32_t x = 0; x < dst_width; ++x) {
      float sum = 0.0f;
      for (size_t k = 0; k < tap.weights.size(); ++k) {
        const size_t row = static_cast<size_t>(tap.first) + k;
        sum += tap.weights[k] * rows[row * static_cast<size_t>(dst_width) + static_cast<size_t>(x)];
      }
      out[x] = static_cast<uint8_t>(std::clamp(sum + 0.5f, 0.0f, 255.0f));
    }
  }
}
