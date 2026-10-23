#include "raster.h"
#include "slicer.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace {

constexpr uint8_t PAPER = 255;
constexpr uint8_t INK = 0;

std::vector<uint8_t> resample(const std::vector<uint8_t>& src, int32_t sw, int32_t sh, int32_t dw, int32_t dh) {
  std::vector<uint8_t> dst(static_cast<size_t>(dw) * dh, 77);
  ppp_area_resample(src.data(), sw, sh, sw, dst.data(), dw, dh);
  return dst;
}

int64_t ink_sum(const std::vector<uint8_t>& image) {
  int64_t sum = 0;
  for (uint8_t value : image) {
    sum += PAPER - value;
  }
  return sum;
}

bool expect_two_by_two_mean() {
  const std::vector<uint8_t> src = {0, 100, 200, 255, 10, 30, 50, 70};  // 4x2
  const std::vector<uint8_t> dst = resample(src, 4, 2, 2, 1);
  const bool ok = dst[0] == 35 && dst[1] == 144;  // (0+100+10+30)/4, (200+255+50+70)/4 rounded
  std::printf("%s: two-by-two mean -> %d %d\n", ok ? "PASS" : "FAIL", dst[0], dst[1]);
  return ok;
}

// A one-pixel staff line must survive a 4x vertical shrink at every phase, with
// its ink conserved; GPU-style point sampling drops three phases out of four.
bool expect_thin_lines_survive_shrink() {
  constexpr int32_t kWidth = 16;
  constexpr int32_t kHeight = 64;
  bool ok = true;
  for (int32_t phase = 0; phase < 4; ++phase) {
    std::vector<uint8_t> src(static_cast<size_t>(kWidth) * kHeight, PAPER);
    const int32_t y = 20 + phase;
    for (int32_t x = 0; x < kWidth; ++x) {
      src[static_cast<size_t>(y) * kWidth + x] = INK;
    }
    const std::vector<uint8_t> dst = resample(src, kWidth, kHeight, kWidth, kHeight / 4);
    const int64_t before = ink_sum(src);
    const int64_t after = ink_sum(dst) * 4;
    const bool conserved = std::llabs(before - after) <= kWidth * 4;
    if (!conserved) {
      std::printf("FAIL: thin line phase %d ink %lld -> %lld\n", phase,
                  static_cast<long long>(before), static_cast<long long>(after));
      ok = false;
    }
  }
  std::printf("%s: thin lines survive 4x shrink at every phase\n", ok ? "PASS" : "FAIL");
  return ok;
}

// Fill-style stretch: shrink X while enlarging Y; a flat image stays flat and
// the output has exactly the requested size.
bool expect_independent_axes() {
  constexpr int32_t kSrcW = 300;
  constexpr int32_t kSrcH = 40;
  constexpr int32_t kDstW = 107;
  constexpr int32_t kDstH = 61;
  const std::vector<uint8_t> src(static_cast<size_t>(kSrcW) * kSrcH, 123);
  const std::vector<uint8_t> dst = resample(src, kSrcW, kSrcH, kDstW, kDstH);
  bool ok = dst.size() == static_cast<size_t>(kDstW) * kDstH;
  for (uint8_t value : dst) {
    ok = ok && value == 123;
  }
  std::printf("%s: independent X shrink / Y enlarge keeps a flat image flat\n", ok ? "PASS" : "FAIL");
  return ok;
}

bool expect_identity() {
  std::vector<uint8_t> src(37 * 11);
  for (size_t i = 0; i < src.size(); ++i) {
    src[i] = static_cast<uint8_t>((i * 97) % 256);
  }
  const bool ok = resample(src, 37, 11, 37, 11) == src;
  std::printf("%s: same size is an exact copy\n", ok ? "PASS" : "FAIL");
  return ok;
}


// The original direct 3x3 implementation of ppp_sharpen_strip, kept as the
// reference the optimized version must match byte for byte.
void reference_sharpen(std::vector<uint8_t>& gray, int32_t width, int32_t height) {
  std::vector<uint8_t> blurred(gray.size());
  for (int32_t y = 0; y < height; ++y) {
    for (int32_t x = 0; x < width; ++x) {
      int32_t sum = 0;
      for (int32_t dy = -1; dy <= 1; ++dy) {
        for (int32_t dx = -1; dx <= 1; ++dx) {
          const int32_t sy = std::max(0, std::min(height - 1, y + dy));
          const int32_t sx = std::max(0, std::min(width - 1, x + dx));
          sum += gray[static_cast<size_t>(sy) * width + sx];
        }
      }
      blurred[static_cast<size_t>(y) * width + x] = static_cast<uint8_t>(sum / 9);
    }
  }
  for (size_t i = 0; i < gray.size(); ++i) {
    const int32_t delta = static_cast<int32_t>(gray[i]) - static_cast<int32_t>(blurred[i]);
    if (std::abs(delta) < 8) {
      continue;
    }
    const int32_t value = static_cast<int32_t>(std::lround(gray[i] + 0.4 * delta));
    gray[i] = static_cast<uint8_t>(std::max(0, std::min(255, value)));
  }
}

bool expect_sharpen_matches_reference() {
  const int32_t sizes[][2] = {{1, 1}, {1, 7}, {7, 1}, {2, 2}, {2, 9}, {9, 2}, {31, 17}, {640, 120}};
  uint32_t seed = 12345;
  bool ok = true;
  for (const auto& size : sizes) {
    std::vector<uint8_t> image(static_cast<size_t>(size[0]) * size[1]);
    for (uint8_t& value : image) {
      seed = seed * 1664525u + 1013904223u;
      // Mostly paper with dark runs, like a strip, plus noise.
      value = static_cast<uint8_t>((seed >> 28) < 3 ? (seed >> 8) % 90 : 200 + (seed >> 8) % 56);
    }
    std::vector<uint8_t> expected = image;
    reference_sharpen(expected, size[0], size[1]);
    ppp_sharpen_strip(image.data(), size[0], size[1], size[0]);
    if (image != expected) {
      std::printf("FAIL: sharpen differs from reference at %dx%d\n", size[0], size[1]);
      ok = false;
    }
  }
  std::printf("%s: optimized sharpen matches the reference byte for byte\n", ok ? "PASS" : "FAIL");
  return ok;
}

}  // namespace

int main() {
  const bool ok = expect_two_by_two_mean() && expect_thin_lines_survive_shrink() &&
                  expect_independent_axes() && expect_identity() &&
                  expect_sharpen_matches_reference();
  return ok ? 0 : 1;
}
