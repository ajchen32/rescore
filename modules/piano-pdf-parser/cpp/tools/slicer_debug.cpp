#include "../slicer.h"

#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#define STBI_ONLY_PGM
#include "stb_image.h"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

namespace {

const char* provenance_name(int32_t provenance) {
  switch (provenance) {
    case PPP_PROVENANCE_BRACE:
      return "BRACE";
    case PPP_PROVENANCE_ORPHAN_INDENT:
      return "ORPHAN_INDENT";
    case PPP_PROVENANCE_LEFTOVER_STAFF:
      return "LEFTOVER_STAFF";
    case PPP_PROVENANCE_FALLBACK_FULL_PAGE:
      return "FALLBACK_FULL_PAGE";
    case PPP_PROVENANCE_LOW_CONFIDENCE:
      return "LOW_CONFIDENCE";
    default:
      return "UNKNOWN";
  }
}

struct Rgba {
  uint8_t r;
  uint8_t g;
  uint8_t b;
  uint8_t a;
};

Rgba provenance_color(int32_t provenance) {
  switch (provenance) {
    case PPP_PROVENANCE_BRACE:
      return {40, 180, 90, 180};
    case PPP_PROVENANCE_ORPHAN_INDENT:
      return {230, 140, 40, 180};
    case PPP_PROVENANCE_LEFTOVER_STAFF:
      return {70, 120, 255, 180};
    case PPP_PROVENANCE_FALLBACK_FULL_PAGE:
      return {220, 60, 60, 180};
    case PPP_PROVENANCE_LOW_CONFIDENCE:
      return {200, 60, 200, 180};
    default:
      return {180, 180, 180, 180};
  }
}

void blend_pixel(std::vector<uint8_t>& rgba, int32_t width, int32_t x, int32_t y, Rgba color) {
  if (x < 0 || y < 0) {
    return;
  }
  const size_t idx = static_cast<size_t>(y) * static_cast<size_t>(width) * 4 + static_cast<size_t>(x) * 4;
  if (idx + 3 >= rgba.size()) {
    return;
  }
  const float alpha = static_cast<float>(color.a) / 255.0f;
  rgba[idx + 0] = static_cast<uint8_t>(rgba[idx + 0] * (1.0f - alpha) + color.r * alpha);
  rgba[idx + 1] = static_cast<uint8_t>(rgba[idx + 1] * (1.0f - alpha) + color.g * alpha);
  rgba[idx + 2] = static_cast<uint8_t>(rgba[idx + 2] * (1.0f - alpha) + color.b * alpha);
  rgba[idx + 3] = 255;
}

void draw_vline(std::vector<uint8_t>& rgba, int32_t width, int32_t height, int32_t x, Rgba color) {
  for (int32_t y = 0; y < height; ++y) {
    blend_pixel(rgba, width, x, y, color);
    blend_pixel(rgba, width, x + 1, y, color);
  }
}

void draw_hline(std::vector<uint8_t>& rgba, int32_t width, int32_t height, int32_t y, Rgba color) {
  for (int32_t x = 0; x < width; ++x) {
    blend_pixel(rgba, width, x, y, color);
  }
}

void draw_rect_outline(
    std::vector<uint8_t>& rgba,
    int32_t width,
    int32_t height,
    int32_t x0,
    int32_t y0,
    int32_t x1,
    int32_t y1,
    Rgba color) {
  for (int32_t x = x0; x <= x1; ++x) {
    draw_hline(rgba, width, height, y0, color);
    draw_hline(rgba, width, height, y1, color);
    blend_pixel(rgba, width, x, y0, color);
    blend_pixel(rgba, width, x, y1, color);
  }
  for (int32_t y = y0; y <= y1; ++y) {
    blend_pixel(rgba, width, x0, y, color);
    blend_pixel(rgba, width, x1, y, color);
  }
}

void print_debug_summary(const PppSliceDebugResult* result) {
  std::printf("=== early exits ===\n");
  std::printf("empty_left_band=%d no_thin_runs=%d brace_blobs_empty=%d all_brace_strips_empty=%d\n",
      result->exited_empty_left_band,
      result->exited_no_thin_runs,
      result->exited_brace_blobs_empty,
      result->exited_all_brace_strips_empty);
  std::printf("ran_leftover_recovery=%d ran_absorb=%d full_page_fallback=%d\n",
      result->ran_leftover_recovery,
      result->ran_absorb,
      result->exited_full_page_fallback);
  std::printf("staff_space=%.1f line_thickness=%.1f\n", result->staff_space, result->line_thickness);
  std::printf("left_band=[%d,%d) column_centers=%d brace_blobs=%d barlines=%d cut_lines=%d\n",
      result->left_band_x0,
      result->left_band_x1,
      result->column_center_count,
      result->brace_blob_count,
      result->barline_count,
      result->cut_line_count);
  if (result->brace_blobs != nullptr) {
    for (int32_t i = 0; i < result->brace_blob_count; ++i) {
      std::printf("blob %d: y0=%d y1=%d prov=%s\n",
          i,
          result->brace_blobs[i].y0,
          result->brace_blobs[i].y1,
          provenance_name(result->brace_blobs[i].provenance));
    }
  }

  int32_t counts[8] = {0};
  for (int32_t i = 0; i < result->count; ++i) {
    const PppTaggedSliceRange& strip = result->ranges[i];
    if (strip.provenance >= 0 && strip.provenance < 8) {
      counts[strip.provenance] += 1;
    }
    int32_t overlap_with_next = 0;
    if (i + 1 < result->count) {
      overlap_with_next = strip.y1 - result->ranges[i + 1].y0;
    }
    std::printf("strip %d: y0=%d y1=%d prov=%s absorbed=%d low_conf=%d overlap_below=%d\n",
        i,
        strip.y0,
        strip.y1,
        provenance_name(strip.provenance),
        strip.absorbed,
        strip.low_confidence,
        overlap_with_next);
  }

  std::printf("=== provenance counts ===\n");
  std::printf("BRACE=%d ORPHAN_INDENT=%d LEFTOVER_STAFF=%d FALLBACK=%d LOW_CONF=%d\n",
      counts[PPP_PROVENANCE_BRACE],
      counts[PPP_PROVENANCE_ORPHAN_INDENT],
      counts[PPP_PROVENANCE_LEFTOVER_STAFF],
      counts[PPP_PROVENANCE_FALLBACK_FULL_PAGE],
      counts[PPP_PROVENANCE_LOW_CONFIDENCE]);
}

bool write_overlay(
    const uint8_t* gray,
    int32_t width,
    int32_t height,
    const PppSliceDebugResult* result,
    const std::string& output_path) {
  std::vector<uint8_t> rgba(static_cast<size_t>(width) * static_cast<size_t>(height) * 4, 255);
  for (int32_t y = 0; y < height; ++y) {
    for (int32_t x = 0; x < width; ++x) {
      const uint8_t value = gray[static_cast<size_t>(y) * static_cast<size_t>(width) + static_cast<size_t>(x)];
      const size_t idx = static_cast<size_t>(y) * static_cast<size_t>(width) * 4 + static_cast<size_t>(x) * 4;
      rgba[idx + 0] = value;
      rgba[idx + 1] = value;
      rgba[idx + 2] = value;
      rgba[idx + 3] = 255;
    }
  }

  const Rgba band_color = {255, 255, 0, 60};
  for (int32_t x = result->left_band_x0; x < result->left_band_x1; ++x) {
    for (int32_t y = 0; y < height; ++y) {
      blend_pixel(rgba, width, x, y, band_color);
    }
  }

  for (int32_t i = 0; i < result->column_center_count; ++i) {
    draw_vline(rgba, width, height, result->column_centers[i], {255, 0, 255, 220});
  }

  if (result->brace_rows != nullptr) {
    for (int32_t y = 0; y < result->brace_rows_height; ++y) {
      if (result->brace_rows[y] != 0) {
        draw_hline(rgba, width, height, y, {0, 255, 255, 200});
      }
    }
  }

  if (result->brace_blobs != nullptr) {
    for (int32_t i = 0; i < result->brace_blob_count; ++i) {
      const PppBraceBlob& blob = result->brace_blobs[i];
      draw_rect_outline(
          rgba,
          width,
          height,
          result->left_band_x0,
          blob.y0,
          result->left_band_x1 - 1,
          blob.y1,
          provenance_color(blob.provenance));
    }
  }

  if (result->barline_x != nullptr) {
    for (int32_t i = 0; i < result->barline_count; ++i) {
      draw_rect_outline(
          rgba,
          width,
          height,
          result->barline_x[i],
          result->barline_y0[i],
          result->barline_x[i] + 1,
          result->barline_y1[i],
          {255, 128, 0, 220});
    }
  }

  if (result->cut_lines != nullptr) {
    for (int32_t i = 0; i < result->cut_line_count; ++i) {
      draw_hline(rgba, width, height, result->cut_lines[i], {255, 0, 0, 220});
    }
  }

  for (int32_t i = 0; i + 1 < result->count; ++i) {
    const int32_t overlap_y0 = result->ranges[i + 1].y0;
    const int32_t overlap_y1 = result->ranges[i].y1;
    if (overlap_y1 <= overlap_y0) {
      continue;
    }
    const Rgba overlap_color = {180, 80, 220, 90};
    for (int32_t y = overlap_y0; y < overlap_y1; ++y) {
      for (int32_t x = 0; x < width; ++x) {
        blend_pixel(rgba, width, x, y, overlap_color);
      }
    }
  }

  for (int32_t i = 0; i < result->count; ++i) {
    const PppTaggedSliceRange& strip = result->ranges[i];
    const Rgba color = provenance_color(strip.provenance);
    draw_hline(rgba, width, height, strip.y0, color);
    draw_hline(rgba, width, height, strip.y1 - 1, color);
    for (int32_t x = 0; x < width; ++x) {
      blend_pixel(rgba, width, x, strip.y0, color);
      blend_pixel(rgba, width, x, strip.y1 - 1, color);
    }
  }

  return stbi_write_png(output_path.c_str(), width, height, 4, rgba.data(), width * 4) != 0;
}

} // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "Usage: %s <input.png|pgm> [output_overlay.png]\n", argv[0]);
    return 1;
  }

  int width = 0;
  int height = 0;
  int channels = 0;
  uint8_t* loaded = stbi_load(argv[1], &width, &height, &channels, 1);
  if (loaded == nullptr) {
    std::fprintf(stderr, "Failed to load image: %s\n", argv[1]);
    return 1;
  }

  const int32_t stride = width;
  PppSliceDebugResult* result =
      ppp_slice_page_debug(loaded, width, height, stride);
  if (result == nullptr) {
    std::fprintf(stderr, "ppp_slice_page_debug failed\n");
    stbi_image_free(loaded);
    return 1;
  }

  print_debug_summary(result);

  std::string output_path;
  if (argc >= 3) {
    output_path = argv[2];
  } else {
    output_path = std::string(argv[1]) + ".overlay.png";
  }

  if (!write_overlay(loaded, width, height, result, output_path)) {
    std::fprintf(stderr, "Failed to write overlay: %s\n", output_path.c_str());
    ppp_slice_page_debug_free(result);
    stbi_image_free(loaded);
    return 1;
  }

  std::printf("overlay: %s\n", output_path.c_str());
  ppp_slice_page_debug_free(result);
  stbi_image_free(loaded);
  return 0;
}
