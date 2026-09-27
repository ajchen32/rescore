#include "slicer.h"

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

namespace {

constexpr int32_t PAGE_WIDTH = 800;
constexpr int32_t PAGE_HEIGHT = 1200;
constexpr uint8_t PAPER_GRAY = 240;

void fill_paper(std::vector<uint8_t>& page, uint8_t value = PAPER_GRAY) {
  std::fill(page.begin(), page.end(), value);
}

void draw_horizontal_line(std::vector<uint8_t>& page, int32_t y, int32_t x0, int32_t x1, uint8_t value = 0) {
  if (y < 0 || y >= PAGE_HEIGHT) {
    return;
  }
  uint8_t* row = page.data() + static_cast<size_t>(y) * PAGE_WIDTH;
  for (int32_t x = x0; x <= x1; ++x) {
    if (x >= 0 && x < PAGE_WIDTH) {
      row[x] = value;
    }
  }
}

void draw_filled_rect(
    std::vector<uint8_t>& page,
    int32_t x0,
    int32_t y0,
    int32_t x1,
    int32_t y1,
    uint8_t value = 0) {
  for (int32_t y = y0; y <= y1; ++y) {
    draw_horizontal_line(page, y, x0, x1, value);
  }
}

void draw_grand_staff_block(
    std::vector<uint8_t>& page,
    int32_t top,
    int32_t block_height,
    int32_t interior_gap,
    int32_t staff_x0 = 80) {
  const int32_t treble_top = top + block_height / 8;
  const int32_t treble_lines[5] = {
      treble_top,
      treble_top + 6,
      treble_top + 12,
      treble_top + 18,
      treble_top + 24,
  };
  const int32_t bass_top = treble_lines[4] + interior_gap;
  const int32_t bass_lines[5] = {
      bass_top,
      bass_top + 6,
      bass_top + 12,
      bass_top + 18,
      bass_top + 24,
  };

  for (int32_t line : treble_lines) {
    draw_horizontal_line(page, line, staff_x0, 720);
  }
  for (int32_t line : bass_lines) {
    draw_horizontal_line(page, line, staff_x0, 720);
  }
}

void draw_sparse_ink_band(std::vector<uint8_t>& page, int32_t y, int32_t width_percent) {
  const int32_t ink_width = std::max(1, PAGE_WIDTH * width_percent / 100);
  const int32_t x0 = (PAGE_WIDTH - ink_width) / 2;
  for (int32_t x = x0; x < x0 + ink_width; ++x) {
    draw_horizontal_line(page, y, x, x, 0);
  }
}

void build_systems_page(
    std::vector<uint8_t>& page,
    int32_t system_count,
    int32_t interior_gap,
    int32_t system_gap,
    bool add_gap_ink) {
  fill_paper(page);
  const int32_t system_height = static_cast<int32_t>(PAGE_HEIGHT * 0.18);
  int32_t top = static_cast<int32_t>(PAGE_HEIGHT * 0.06);
  for (int i = 0; i < system_count; ++i) {
    draw_grand_staff_block(page, top, system_height, interior_gap);
    top += system_height;
    if (i < system_count - 1) {
      const int32_t gap_mid = top + system_gap / 2;
      if (add_gap_ink) {
        draw_sparse_ink_band(page, gap_mid - 2, 6);
        draw_sparse_ink_band(page, gap_mid + 2, 4);
      }
      top += system_gap;
    }
  }
}

void build_three_system_page(
    std::vector<uint8_t>& page,
    int32_t interior_gap,
    int32_t system_gap,
    bool add_gap_ink) {
  build_systems_page(page, 3, interior_gap, system_gap, add_gap_ink);
}

void build_split_middle_system_page(
    std::vector<uint8_t>& page,
    int32_t normal_interior_gap,
    int32_t split_interior_gap,
    int32_t system_gap) {
  fill_paper(page);
  const int32_t system_height = static_cast<int32_t>(PAGE_HEIGHT * 0.18);
  int32_t top = static_cast<int32_t>(PAGE_HEIGHT * 0.06);
  for (int i = 0; i < 3; ++i) {
    const int32_t interior_gap = (i == 1) ? split_interior_gap : normal_interior_gap;
    draw_grand_staff_block(page, top, system_height, interior_gap);
    top += system_height;
    if (i < 2) {
      top += system_gap;
    }
  }
}

void draw_brace_system(
    std::vector<uint8_t>& page,
    int32_t brace_x0,
    int32_t brace_x1,
    int32_t staff_x0,
    int32_t brace_y0,
    int32_t brace_height) {
  draw_filled_rect(page, brace_x0, brace_y0, brace_x1, brace_y0 + brace_height - 1);
  draw_grand_staff_block(
      page,
      brace_y0,
      brace_height + static_cast<int32_t>(PAGE_HEIGHT * 0.04),
      static_cast<int32_t>(PAGE_HEIGHT * 0.04),
      staff_x0);
}

void draw_brace_pair(
    std::vector<uint8_t>& page,
    int32_t brace_x0,
    int32_t brace_x1,
    int32_t brace1_y0,
    int32_t brace_height,
    int32_t system_gap,
    int32_t staff_x0 = 80) {
  draw_brace_system(page, brace_x0, brace_x1, staff_x0, brace1_y0, brace_height);

  const int32_t brace2_y0 = brace1_y0 + brace_height + system_gap;
  draw_brace_system(page, brace_x0, brace_x1, staff_x0, brace2_y0, brace_height);
}

constexpr int32_t THIN_BRACE_X0 = 12;
constexpr int32_t THIN_BRACE_X1 = 16;
constexpr int32_t INDENTED_BRACE_X0 = 70;
constexpr int32_t INDENTED_BRACE_X1 = 74;
constexpr int32_t DEEP_INDENTED_BRACE_X0 = 120;
constexpr int32_t DEEP_INDENTED_BRACE_X1 = 124;
constexpr int32_t DEEP_INDENTED_STAFF_X0 = 130;

void build_margined_page(std::vector<uint8_t>& page) {
  fill_paper(page);
  const int32_t header = static_cast<int32_t>(PAGE_HEIGHT * 0.12);
  const int32_t footer = static_cast<int32_t>(PAGE_HEIGHT * 0.10);
  const int32_t brace_height = static_cast<int32_t>(PAGE_HEIGHT * 0.15);
  const int32_t system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  const int32_t brace1_y0 = header + 30;

  for (int32_t y = 30; y < header - 20; y += 12) {
    draw_horizontal_line(page, y, 280, 520);
  }

  draw_brace_pair(page, THIN_BRACE_X0, THIN_BRACE_X1, brace1_y0, brace_height, system_gap);

  // Isolated page-number blob in the top-right margin, separated from the staff.
  draw_filled_rect(page, PAGE_WIDTH - 32, brace1_y0 + 11, PAGE_WIDTH - 18, brace1_y0 + 20);

  // Note just outside the staff on the right; gap is smaller than the peel threshold.
  draw_filled_rect(page, 722, brace1_y0 + 40, 734, brace1_y0 + 52);

  for (int32_t y = PAGE_HEIGHT - footer + 10; y < PAGE_HEIGHT - 10; y += 14) {
    draw_horizontal_line(page, y, 300, 500);
  }
}

void build_brace_grounded_page(std::vector<uint8_t>& page) {
  fill_paper(page);
  const int32_t brace_height = static_cast<int32_t>(PAGE_HEIGHT * 0.15);
  const int32_t system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  const int32_t brace1_y0 = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  draw_brace_pair(page, THIN_BRACE_X0, THIN_BRACE_X1, brace1_y0, brace_height, system_gap);
}

void build_bridging_hairpin_page(std::vector<uint8_t>& page) {
  fill_paper(page);
  const int32_t brace_height = static_cast<int32_t>(PAGE_HEIGHT * 0.15);
  const int32_t system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  const int32_t brace1_y0 = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  draw_brace_pair(page, THIN_BRACE_X0, THIN_BRACE_X1, brace1_y0, brace_height, system_gap);

  const int32_t gap_y0 = brace1_y0 + brace_height;
  const int32_t gap_y1 = brace1_y0 + brace_height + system_gap;
  for (int32_t y = gap_y0; y < gap_y1; ++y) {
    draw_horizontal_line(page, y, 220, 360);
  }
}

void build_gap_text_brace_page(std::vector<uint8_t>& page) {
  fill_paper(page);
  const int32_t brace_height = static_cast<int32_t>(PAGE_HEIGHT * 0.15);
  const int32_t system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  const int32_t brace1_y0 = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  draw_brace_pair(page, THIN_BRACE_X0, THIN_BRACE_X1, brace1_y0, brace_height, system_gap);

  const int32_t gap_y0 = brace1_y0 + brace_height;
  const int32_t gap_y1 = brace1_y0 + brace_height + system_gap;
  for (int32_t y = gap_y0; y < gap_y1; y += 4) {
    draw_horizontal_line(page, y, 64, 64);
    draw_horizontal_line(page, y + 1, 72, 72);
    draw_horizontal_line(page, y + 2, 80, 80);
  }
}

void build_noisy_brace_page(std::vector<uint8_t>& page) {
  fill_paper(page);
  const int32_t brace_height = static_cast<int32_t>(PAGE_HEIGHT * 0.15);
  const int32_t system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  const int32_t brace1_y0 = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  draw_brace_pair(page, THIN_BRACE_X0, THIN_BRACE_X1, brace1_y0, brace_height, system_gap);

  // Sparse verse text in the 8-11% margin should not steal brace detection.
  for (int32_t y = brace1_y0; y < brace1_y0 + brace_height * 2 + system_gap; y += 18) {
    draw_horizontal_line(page, y, 64, 64);
    draw_horizontal_line(page, y + 6, 72, 72);
    draw_horizontal_line(page, y + 12, 80, 80);
  }
}

void build_minority_indent_brace_page(std::vector<uint8_t>& page) {
  fill_paper(page);
  const int32_t brace_height = static_cast<int32_t>(PAGE_HEIGHT * 0.15);
  const int32_t system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  const int32_t brace1_y0 = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  draw_brace_system(
      page,
      DEEP_INDENTED_BRACE_X0,
      DEEP_INDENTED_BRACE_X1,
      DEEP_INDENTED_STAFF_X0,
      brace1_y0,
      brace_height);

  int32_t next_y0 = brace1_y0 + brace_height + system_gap;
  for (int i = 0; i < 3; ++i) {
    draw_brace_system(page, THIN_BRACE_X0, THIN_BRACE_X1, 80, next_y0, brace_height);
    next_y0 += brace_height + system_gap;
  }
}

void build_mixed_indented_brace_page(std::vector<uint8_t>& page) {
  fill_paper(page);
  const int32_t brace_height = static_cast<int32_t>(PAGE_HEIGHT * 0.15);
  const int32_t system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  const int32_t brace1_y0 = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  draw_brace_system(
      page,
      DEEP_INDENTED_BRACE_X0,
      DEEP_INDENTED_BRACE_X1,
      DEEP_INDENTED_STAFF_X0,
      brace1_y0,
      brace_height);

  const int32_t brace2_y0 = brace1_y0 + brace_height + system_gap;
  draw_brace_system(
      page,
      THIN_BRACE_X0,
      THIN_BRACE_X1,
      80,
      brace2_y0,
      brace_height);
}

void build_indented_thin_brace_page(std::vector<uint8_t>& page) {
  fill_paper(page);
  const int32_t brace_height = static_cast<int32_t>(PAGE_HEIGHT * 0.15);
  const int32_t system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  const int32_t brace1_y0 = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  draw_brace_pair(
      page,
      INDENTED_BRACE_X0,
      INDENTED_BRACE_X1,
      brace1_y0,
      brace_height,
      system_gap);
}

void build_merged_brace_page(std::vector<uint8_t>& page) {
  fill_paper(page);
  const int32_t brace_height = static_cast<int32_t>(PAGE_HEIGHT * 0.35);
  const int32_t brace1_y0 = static_cast<int32_t>(PAGE_HEIGHT * 0.05);
  const int32_t brace2_y0 = brace1_y0 + brace_height + 4;
  draw_filled_rect(page, THIN_BRACE_X0, brace1_y0, THIN_BRACE_X1, brace1_y0 + brace_height - 1);
  draw_filled_rect(page, THIN_BRACE_X0, brace2_y0, THIN_BRACE_X1, brace2_y0 + brace_height - 1);
  draw_grand_staff_block(page, brace1_y0, brace_height, static_cast<int32_t>(PAGE_HEIGHT * 0.04));
  draw_grand_staff_block(page, brace2_y0, brace_height, static_cast<int32_t>(PAGE_HEIGHT * 0.04));
}

void build_sparse_margin_no_brace_page(std::vector<uint8_t>& page) {
  fill_paper(page);
  const int32_t interior_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.04);
  const int32_t system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  build_three_system_page(page, interior_gap, system_gap, false);

  for (int32_t y = static_cast<int32_t>(PAGE_HEIGHT * 0.06); y < static_cast<int32_t>(PAGE_HEIGHT * 0.9); y += 22) {
    draw_horizontal_line(page, y, 52, 52);
    draw_horizontal_line(page, y + 8, 60, 60);
    draw_horizontal_line(page, y + 16, 68, 68);
  }
}

void build_no_brace_gap_page(std::vector<uint8_t>& page) {
  fill_paper(page);
  const int32_t brace_height = static_cast<int32_t>(PAGE_HEIGHT * 0.15);
  const int32_t system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  const int32_t system_height = static_cast<int32_t>(PAGE_HEIGHT * 0.18);
  const int32_t interior_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.04);
  const int32_t brace1_y0 = static_cast<int32_t>(PAGE_HEIGHT * 0.08);

  draw_brace_system(page, THIN_BRACE_X0, THIN_BRACE_X1, 80, brace1_y0, brace_height);

  const int32_t middle_top = brace1_y0 + brace_height + system_gap;
  draw_grand_staff_block(page, middle_top, system_height, interior_gap);

  const int32_t brace3_y0 = middle_top + system_height + system_gap;
  draw_brace_system(page, THIN_BRACE_X0, THIN_BRACE_X1, 80, brace3_y0, brace_height);
}

void build_four_staff_no_brace_page(std::vector<uint8_t>& page) {
  const int32_t interior_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.04);
  const int32_t system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.07);
  build_systems_page(page, 4, interior_gap, system_gap, false);
}

void build_brace_with_title_page(std::vector<uint8_t>& page) {
  fill_paper(page);
  const int32_t brace_height = static_cast<int32_t>(PAGE_HEIGHT * 0.15);
  const int32_t system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  const int32_t brace1_y0 = static_cast<int32_t>(PAGE_HEIGHT * 0.22);
  draw_brace_pair(page, THIN_BRACE_X0, THIN_BRACE_X1, brace1_y0, brace_height, system_gap);

  for (int32_t y = static_cast<int32_t>(PAGE_HEIGHT * 0.04); y < brace1_y0 - 8; y += 10) {
    draw_horizontal_line(page, y, 280, 520);
    draw_horizontal_line(page, y + 4, 300, 500);
  }
}

void build_glued_systems_page(
    std::vector<uint8_t>& page,
    int32_t interior_gap,
    int32_t glued_system_gap,
    int32_t normal_system_gap) {
  fill_paper(page);
  const int32_t system_height = static_cast<int32_t>(PAGE_HEIGHT * 0.18);
  int32_t top = static_cast<int32_t>(PAGE_HEIGHT * 0.06);
  for (int i = 0; i < 4; ++i) {
    draw_grand_staff_block(page, top, system_height, interior_gap);
    top += system_height;
    if (i < 3) {
      const int32_t system_gap = (i == 0) ? glued_system_gap : normal_system_gap;
      top += system_gap;
    }
  }
}

bool expect_gutter_between_strips(
    const char* label,
    std::vector<uint8_t>& page,
    int32_t min_gap_px) {
  PppSliceResult* result = ppp_slice_page(page.data(), PAGE_WIDTH, PAGE_HEIGHT, PAGE_WIDTH);
  if (result == nullptr) {
    std::fprintf(stderr, "FAIL [%s]: ppp_slice_page returned null\n", label);
    return false;
  }

  int32_t gap_px = 0;
  if (result->count >= 2) {
    gap_px = result->ranges[1].y0 - result->ranges[0].y1;
  }
  const bool ok = result->count == 2 && gap_px >= min_gap_px;
  std::printf(
      "%s: %d strips, gutter %d px (min %d)\n",
      label,
      result->count,
      gap_px,
      min_gap_px);
  ppp_slice_result_free(result);
  if (!ok) {
    std::fprintf(stderr, "FAIL [%s]: gutter expectation not met\n", label);
  }
  return ok;
}

bool expect_overlap(
    const char* label,
    std::vector<uint8_t>& page,
    bool want_overlap) {
  PppSliceResult* result = ppp_slice_page(page.data(), PAGE_WIDTH, PAGE_HEIGHT, PAGE_WIDTH);
  if (result == nullptr) {
    std::fprintf(stderr, "FAIL [%s]: ppp_slice_page returned null\n", label);
    return false;
  }

  int32_t overlap_px = 0;
  if (result->count >= 2) {
    overlap_px = result->ranges[0].y1 - result->ranges[1].y0;
  }
  const bool overlapped = overlap_px > 0;
  const bool ok = result->count == 2 && overlapped == want_overlap;
  std::printf(
      "%s: %d strips, overlap %d px (%s)\n",
      label,
      result->count,
      overlap_px,
      want_overlap ? "expected" : "not expected");
  ppp_slice_result_free(result);
  if (!ok) {
    std::fprintf(stderr, "FAIL [%s]: overlap expectation not met\n", label);
  }
  return ok;
}

bool expect_trimmed_margins(const char* label, std::vector<uint8_t>& page) {
  PppSliceResult* result = ppp_slice_page(page.data(), PAGE_WIDTH, PAGE_HEIGHT, PAGE_WIDTH);
  if (result == nullptr) {
    std::fprintf(stderr, "FAIL [%s]: ppp_slice_page returned null\n", label);
    return false;
  }

  if (result->count < 2) {
    std::fprintf(stderr, "FAIL [%s]: expected at least 2 strips\n", label);
    ppp_slice_result_free(result);
    return false;
  }

  const int32_t header = static_cast<int32_t>(PAGE_HEIGHT * 0.12);
  const int32_t footer = static_cast<int32_t>(PAGE_HEIGHT * 0.10);
  const PppSliceRange& first = result->ranges[0];
  const PppSliceRange& last = result->ranges[result->count - 1];
  const int32_t crop_width = first.x1 - first.x0;

  const bool top_ok = first.y0 > header / 2;
  const bool bottom_ok = last.y1 < PAGE_HEIGHT - footer / 2;
  const bool side_ok =
      crop_width > 500 && (PAGE_WIDTH - first.x1) > 40;
  const bool corner_ok = first.x1 < PAGE_WIDTH - 25;
  const bool near_note_ok = first.x1 >= 734;
  const bool ok = top_ok && bottom_ok && side_ok && corner_ok && near_note_ok;

  std::printf(
      "%s: first y0=%d y1=%d x0=%d x1=%d, last y1=%d, crop_width=%d\n",
      label,
      first.y0,
      first.y1,
      first.x0,
      first.x1,
      last.y1,
      crop_width);
  ppp_slice_result_free(result);
  if (!ok) {
    std::fprintf(stderr, "FAIL [%s]: margin trim expectation not met\n", label);
  }
  return ok;
}

bool expect_min_strip_count(const char* label, std::vector<uint8_t>& page, int32_t min_count) {
  PppSliceResult* result = ppp_slice_page(page.data(), PAGE_WIDTH, PAGE_HEIGHT, PAGE_WIDTH);
  if (result == nullptr) {
    std::fprintf(stderr, "FAIL [%s]: ppp_slice_page returned null\n", label);
    return false;
  }

  const bool ok = result->count >= min_count;
  std::printf("%s: %d strips (min %d)\n", label, result->count, min_count);
  ppp_slice_result_free(result);
  if (!ok) {
    std::fprintf(stderr, "FAIL [%s]: expected at least %d strips\n", label, min_count);
  }
  return ok;
}

bool expect_strip_count_for(
    const char* label,
    std::vector<uint8_t>& page,
    int32_t width,
    int32_t height,
    int32_t expected_count) {
  PppSliceResult* result = ppp_slice_page(page.data(), width, height, width);
  if (result == nullptr) {
    std::fprintf(stderr, "FAIL [%s]: ppp_slice_page returned null\n", label);
    return false;
  }

  std::printf("%s: %d strips\n", label, result->count);
  const bool ok = result->count == expected_count;
  ppp_slice_result_free(result);
  if (!ok) {
    std::fprintf(stderr, "FAIL [%s]: expected %d strips, got a different count\n", label, expected_count);
  }
  return ok;
}

void draw_horizontal_line_sized(
    std::vector<uint8_t>& page,
    int32_t width,
    int32_t height,
    int32_t y,
    int32_t x0,
    int32_t x1,
    uint8_t value = 0) {
  if (y < 0 || y >= height) {
    return;
  }
  uint8_t* row = page.data() + static_cast<size_t>(y) * static_cast<size_t>(width);
  for (int32_t x = x0; x <= x1; ++x) {
    if (x >= 0 && x < width) {
      row[x] = value;
    }
  }
}

void draw_staff_lines(
    std::vector<uint8_t>& page,
    int32_t width,
    int32_t height,
    int32_t y0,
    int32_t staff_space,
    int32_t line_px,
    int32_t x0,
    int32_t x1) {
  for (int32_t i = 0; i < 5; ++i) {
    const int32_t y = y0 + i * staff_space;
    for (int32_t t = 0; t < line_px; ++t) {
      draw_horizontal_line_sized(page, width, height, y + t, x0, x1, 0);
    }
  }
}

void draw_generated_grand_staff(
    std::vector<uint8_t>& page,
    int32_t width,
    int32_t height,
    int32_t top,
    int32_t staff_space,
    int32_t line_px,
    int32_t interior_gap,
    int32_t staff_x0 = 120,
    int32_t staff_x1 = 1000) {
  draw_staff_lines(page, width, height, top, staff_space, line_px, staff_x0, staff_x1);
  const int32_t bass_top = top + 4 * staff_space + interior_gap;
  draw_staff_lines(page, width, height, bass_top, staff_space, line_px, staff_x0, staff_x1);
}

void build_generated_two_system_brace_page(
    std::vector<uint8_t>& page,
    int32_t width,
    int32_t height,
    int32_t staff_space,
    int32_t line_px) {
  std::fill(page.begin(), page.end(), PAPER_GRAY);
  const int32_t brace_h = staff_space * 30;
  const int32_t interior_gap = staff_space * 6;
  const int32_t system_gap = staff_space * 10;
  const int32_t brace1_y0 = height / 10;
  for (int32_t y = brace1_y0; y < brace1_y0 + brace_h; ++y) {
    draw_horizontal_line_sized(page, width, height, y, 20, 24, 0);
  }
  draw_generated_grand_staff(page, width, height, brace1_y0, staff_space, line_px, interior_gap);
  const int32_t brace2_y0 = brace1_y0 + brace_h + system_gap;
  for (int32_t y = brace2_y0; y < brace2_y0 + brace_h; ++y) {
    draw_horizontal_line_sized(page, width, height, y, 20, 24, 0);
  }
  draw_generated_grand_staff(page, width, height, brace2_y0, staff_space, line_px, interior_gap);
  draw_horizontal_line_sized(page, width, height, height - 40, width / 2 - 40, width / 2 + 40, 0);
}

void build_generated_lone_staff_page(
    std::vector<uint8_t>& page,
    int32_t width,
    int32_t height,
    int32_t staff_space,
    int32_t line_px) {
  std::fill(page.begin(), page.end(), PAPER_GRAY);
  draw_generated_grand_staff(page, width, height, height / 3, staff_space, line_px, staff_space * 6);
}

// Two braced grand staves (staff space 10) on a GEN-sized page. System 1 has
// stems hanging `stem_px` rows below its brace and, optionally, a line of
// "Ped." blobs after a short hole; system 2's brace starts at `brace2_y0`.
struct EdgeSnapPage {
  int32_t brace1_y1 = 0;  // exclusive
  int32_t brace2_y0 = 0;
  int32_t stems_end = 0;  // exclusive
  int32_t pedal_y0 = 0;
  int32_t pedal_y1 = 0;   // exclusive; equal to pedal_y0 when there is no pedal line
};

EdgeSnapPage build_edge_snap_page(
    std::vector<uint8_t>& page,
    int32_t width,
    int32_t height,
    int32_t stem_px,
    bool pedal_line,
    int32_t brace2_y0) {
  std::fill(page.begin(), page.end(), PAPER_GRAY);
  constexpr int32_t kSpace = 10;
  constexpr int32_t kBraceH = 300;
  EdgeSnapPage geo;
  const int32_t brace1_y0 = 180;
  geo.brace1_y1 = brace1_y0 + kBraceH;
  geo.brace2_y0 = brace2_y0;
  for (const int32_t top : {brace1_y0, brace2_y0}) {
    for (int32_t y = top; y < top + kBraceH; ++y) {
      draw_horizontal_line_sized(page, width, height, y, 20, 24, 0);
    }
    draw_generated_grand_staff(page, width, height, top + 60, kSpace, 2, kSpace * 6);
  }
  geo.stems_end = geo.brace1_y1 + stem_px;
  for (int32_t x = 200; x < 1000; x += 90) {
    for (int32_t y = geo.brace1_y1 - 20; y < geo.stems_end; ++y) {
      draw_horizontal_line_sized(page, width, height, y, x, x + 1, 0);
    }
  }
  geo.pedal_y0 = geo.pedal_y1 = geo.stems_end;
  if (pedal_line) {
    geo.pedal_y0 = geo.stems_end + 3;
    geo.pedal_y1 = geo.pedal_y0 + 30;
    for (int32_t x = 180; x < 1000; x += 110) {
      for (int32_t y = geo.pedal_y0; y < geo.pedal_y1; ++y) {
        draw_horizontal_line_sized(page, width, height, y, x, x + 24, 0);
      }
    }
  }
  return geo;
}

// Columns right of the brace where ink continues across an edge placed at y.
int32_t ink_crossings_at(const std::vector<uint8_t>& page, int32_t width, int32_t y) {
  if (y <= 0) {
    return 0;
  }
  int32_t crossings = 0;
  for (int32_t x = 40; x < width; ++x) {
    const size_t above = static_cast<size_t>(y - 1) * static_cast<size_t>(width) + static_cast<size_t>(x);
    crossings += (page[above] < 128 && page[above + static_cast<size_t>(width)] < 128) ? 1 : 0;
  }
  return crossings;
}

bool expect_edge_snap(
    const char* label,
    std::vector<uint8_t>& page,
    int32_t width,
    int32_t height,
    const EdgeSnapPage& geo,
    bool expect_clear_edges) {
  PppSliceResult* result = ppp_slice_page(page.data(), width, height, width);
  if (result == nullptr || result->count != 2) {
    std::fprintf(stderr, "FAIL [%s]: expected 2 strips\n", label);
    ppp_slice_result_free(result);
    return false;
  }
  const PppSliceRange upper = result->ranges[0];
  const PppSliceRange lower = result->ranges[1];
  ppp_slice_result_free(result);
  std::printf("%s: upper y1=%d, lower y0=%d (stems end %d, pedal %d-%d, brace2 %d)\n",
              label, upper.y1, lower.y0, geo.stems_end, geo.pedal_y0, geo.pedal_y1, geo.brace2_y0);

  bool ok = true;
  if (upper.y1 > geo.brace2_y0 || lower.y0 < geo.brace1_y1) {
    std::fprintf(stderr, "FAIL [%s]: an edge moved into the other system's staff\n", label);
    ok = false;
  }
  if (upper.y1 < geo.pedal_y1) {
    std::fprintf(stderr, "FAIL [%s]: upper strip stops before its own stems/pedal line\n", label);
    ok = false;
  }
  if (geo.pedal_y1 > geo.pedal_y0 && lower.y0 < geo.pedal_y1) {
    std::fprintf(stderr, "FAIL [%s]: the portrait cut (lower y0) hides the upper pedal line\n", label);
    ok = false;
  }
  if (expect_clear_edges &&
      (ink_crossings_at(page, width, upper.y1) != 0 || ink_crossings_at(page, width, lower.y0) != 0)) {
    std::fprintf(stderr, "FAIL [%s]: a strip edge cuts through ink\n", label);
    ok = false;
  }
  return ok;
}

bool expect_strip_count(const char* label, std::vector<uint8_t>& page, int32_t expected_count) {
  PppSliceResult* result = ppp_slice_page(page.data(), PAGE_WIDTH, PAGE_HEIGHT, PAGE_WIDTH);
  if (result == nullptr) {
    std::fprintf(stderr, "FAIL [%s]: ppp_slice_page returned null\n", label);
    return false;
  }

  std::printf("%s: %d strips\n", label, result->count);
  for (int32_t i = 0; i < result->count; ++i) {
    std::printf("  strip %d: y0=%d y1=%d height=%d\n",
                i,
                result->ranges[i].y0,
                result->ranges[i].y1,
                result->ranges[i].y1 - result->ranges[i].y0);
  }

  const bool ok = result->count == expected_count;
  ppp_slice_result_free(result);
  if (!ok) {
    std::fprintf(stderr, "FAIL [%s]: expected %d strips, got a different count\n", label, expected_count);
  }
  return ok;
}

bool expect_sharpen_soft_edge() {
  constexpr int32_t width = 5;
  constexpr int32_t height = 5;
  std::vector<uint8_t> strip(static_cast<size_t>(width) * height, 255);
  const int32_t center = 2 * width + 2;
  strip[center] = 120;

  const uint8_t before = strip[center];
  ppp_sharpen_strip(strip.data(), width, height, width);
  const uint8_t after = strip[center];

  if (after >= before) {
    std::fprintf(stderr, "FAIL [sharpen soft edge]: center %u -> %u\n", before, after);
    return false;
  }

  std::printf("sharpen soft edge: center %u -> %u\n", before, after);
  return true;
}

bool expect_sharpen_flat_white() {
  std::vector<uint8_t> strip(100, 255);
  ppp_sharpen_strip(strip.data(), 10, 10, 10);
  for (uint8_t value : strip) {
    if (value != 255) {
      std::fprintf(stderr, "FAIL [sharpen flat white]: pixel changed to %u\n", value);
      return false;
    }
  }

  std::printf("sharpen flat white: unchanged\n");
  return true;
}

} // namespace

int main() {
  const int32_t default_interior_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.025);
  const int32_t large_system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.08);
  const int32_t tight_system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.034);
  const int32_t wide_interior_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.04);
  const int32_t imslp_system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.07);

  std::vector<uint8_t> large_gap_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_three_system_page(large_gap_page, default_interior_gap, large_system_gap, false);

  std::vector<uint8_t> tight_gap_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_three_system_page(tight_gap_page, default_interior_gap, tight_system_gap, false);

  std::vector<uint8_t> dirty_gap_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_three_system_page(dirty_gap_page, default_interior_gap, tight_system_gap, true);

  std::vector<uint8_t> imslp_gap_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_three_system_page(imslp_gap_page, wide_interior_gap, imslp_system_gap, true);

  // Realistic 5-line staff spacing (6px between lines) with IMSLP-like gaps.
  // One-shot peak-gap Otsu would split treble/bass (6 strips); two-stage must yield 3.
  std::vector<uint8_t> realistic_five_line_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_three_system_page(realistic_five_line_page, wide_interior_gap, imslp_system_gap, true);

  // Middle system interior above ceiling forces treble/bass split (4 strips) before normalize.
  const int32_t split_interior_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.085);
  std::vector<uint8_t> half_merge_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_split_middle_system_page(
      half_merge_page,
      wide_interior_gap,
      split_interior_gap,
      imslp_system_gap);

  // First inter-system gap below interior floor glues two systems (3 strips) before normalize.
  const int32_t glued_system_gap = static_cast<int32_t>(PAGE_HEIGHT * 0.02);
  std::vector<uint8_t> double_split_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_glued_systems_page(
      double_split_page,
      wide_interior_gap,
      glued_system_gap,
      imslp_system_gap);

  std::vector<uint8_t> margined_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_margined_page(margined_page);

  std::vector<uint8_t> brace_grounded_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_brace_grounded_page(brace_grounded_page);

  std::vector<uint8_t> noisy_brace_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_noisy_brace_page(noisy_brace_page);

  std::vector<uint8_t> gap_text_brace_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_gap_text_brace_page(gap_text_brace_page);

  std::vector<uint8_t> merged_brace_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_merged_brace_page(merged_brace_page);

  std::vector<uint8_t> indented_brace_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_indented_thin_brace_page(indented_brace_page);

  std::vector<uint8_t> mixed_indented_brace_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_mixed_indented_brace_page(mixed_indented_brace_page);

  std::vector<uint8_t> minority_indent_brace_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_minority_indent_brace_page(minority_indent_brace_page);

  std::vector<uint8_t> sparse_margin_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_sparse_margin_no_brace_page(sparse_margin_page);

  std::vector<uint8_t> no_brace_gap_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_no_brace_gap_page(no_brace_gap_page);

  std::vector<uint8_t> four_staff_no_brace_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_four_staff_no_brace_page(four_staff_no_brace_page);

  std::vector<uint8_t> brace_with_title_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_brace_with_title_page(brace_with_title_page);

  const bool margined_ok = expect_trimmed_margins("margined page", margined_page);
  const bool brace_ok = expect_strip_count("brace-grounded page", brace_grounded_page, 2);
  const bool noisy_brace_ok = expect_strip_count("noisy-brace page", noisy_brace_page, 2);
  const bool gap_text_brace_ok = expect_strip_count("gap-text-brace page", gap_text_brace_page, 2);
  const bool indented_brace_ok = expect_strip_count("indented-thin-brace page", indented_brace_page, 2);
  const bool mixed_indented_brace_ok =
      expect_strip_count("mixed-indented-brace page", mixed_indented_brace_page, 2);
  const bool minority_indent_brace_ok =
      expect_strip_count("minority-indent-brace page", minority_indent_brace_page, 4);
  const bool merged_brace_ok = expect_strip_count("merged-brace page", merged_brace_page, 2);
  const bool sparse_margin_ok = expect_min_strip_count("sparse-margin no-brace page", sparse_margin_page, 1);
  const bool fallback_ok = expect_min_strip_count("no-brace fallback page", large_gap_page, 1);
  const bool large_ok = expect_strip_count("large-gap page", large_gap_page, 3);
  const bool tight_ok = expect_strip_count("tight-gap page", tight_gap_page, 3);
  const bool dirty_ok = expect_strip_count("dirty-gap page", dirty_gap_page, 3);
  const bool imslp_ok = expect_strip_count("imslp-gap page", imslp_gap_page, 3);
  const bool realistic_ok = expect_strip_count("realistic-five-line page", realistic_five_line_page, 3);
  const bool half_ok = expect_strip_count("half-merge page", half_merge_page, 3);
  const bool double_ok = expect_strip_count("double-split page", double_split_page, 4);
  const bool no_brace_gap_ok = expect_strip_count("no-brace-gap page", no_brace_gap_page, 3);
  const bool four_staff_no_brace_ok =
      expect_strip_count("four-staff-no-brace page", four_staff_no_brace_page, 4);
  const bool brace_with_title_ok =
      expect_strip_count("brace-with-title page", brace_with_title_page, 2);

  std::vector<uint8_t> bridging_hairpin_page(static_cast<size_t>(PAGE_WIDTH) * PAGE_HEIGHT, PAPER_GRAY);
  build_bridging_hairpin_page(bridging_hairpin_page);
  const bool clean_gap_no_overlap_ok =
      expect_overlap("clean-gap no overlap", brace_grounded_page, false);
  const bool clean_gap_gutter_ok =
      expect_gutter_between_strips("clean-gap gutter", brace_grounded_page, 12);
  const bool bridging_overlap_ok =
      expect_overlap("bridging-hairpin overlap", bridging_hairpin_page, true);

  constexpr int32_t GEN_WIDTH = 1200;
  constexpr int32_t GEN_HEIGHT = 1800;
  std::vector<uint8_t> generated_two_system_page(
      static_cast<size_t>(GEN_WIDTH) * GEN_HEIGHT, PAPER_GRAY);
  build_generated_two_system_brace_page(generated_two_system_page, GEN_WIDTH, GEN_HEIGHT, 10, 2);
  const bool generated_two_system_ok = expect_strip_count_for(
      "generated-two-system-brace page", generated_two_system_page, GEN_WIDTH, GEN_HEIGHT, 2);

  std::vector<uint8_t> generated_lone_staff_page(
      static_cast<size_t>(GEN_WIDTH) * GEN_HEIGHT, PAPER_GRAY);
  build_generated_lone_staff_page(generated_lone_staff_page, GEN_WIDTH, GEN_HEIGHT, 12, 2);
  const bool generated_lone_staff_ok = expect_strip_count_for(
      "generated-lone-staff page", generated_lone_staff_page, GEN_WIDTH, GEN_HEIGHT, 1);

  // Stems run past the growth cap, then a 3-row hole and a "Ped." line: the
  // upper strip must end below the pedal line on paper, and the lower strip
  // (whose y0 is the portrait cut) must not start above it.
  std::vector<uint8_t> pedal_page(static_cast<size_t>(GEN_WIDTH) * GEN_HEIGHT, PAPER_GRAY);
  const EdgeSnapPage pedal_geo = build_edge_snap_page(pedal_page, GEN_WIDTH, GEN_HEIGHT, 70, true, 720);
  const bool pedal_edge_ok =
      expect_edge_snap("edge-snap pedal line", pedal_page, GEN_WIDTH, GEN_HEIGHT, pedal_geo, true);

  // Stems reach all the way to the next brace, so no paper row exists: edges
  // may cut ink but must stay out of the neighbouring system's staff.
  std::vector<uint8_t> bridged_page(static_cast<size_t>(GEN_WIDTH) * GEN_HEIGHT, PAPER_GRAY);
  EdgeSnapPage bridged_geo = build_edge_snap_page(bridged_page, GEN_WIDTH, GEN_HEIGHT, 120, false, 600);
  bridged_geo.pedal_y0 = bridged_geo.pedal_y1 = bridged_geo.brace1_y1;
  const bool bridged_edge_ok =
      expect_edge_snap("edge-snap bridged gap", bridged_page, GEN_WIDTH, GEN_HEIGHT, bridged_geo, false);

  // A clean gutter: both edges on paper and the stems kept with their system.
  std::vector<uint8_t> clean_page(static_cast<size_t>(GEN_WIDTH) * GEN_HEIGHT, PAPER_GRAY);
  const EdgeSnapPage clean_geo = build_edge_snap_page(clean_page, GEN_WIDTH, GEN_HEIGHT, 10, false, 700);
  const bool clean_edge_ok =
      expect_edge_snap("edge-snap clean gutter", clean_page, GEN_WIDTH, GEN_HEIGHT, clean_geo, true);

  const bool sharpen_edge_ok = expect_sharpen_soft_edge();
  const bool sharpen_flat_ok = expect_sharpen_flat_white();

  if (margined_ok && brace_ok && noisy_brace_ok && gap_text_brace_ok && indented_brace_ok && mixed_indented_brace_ok &&
      minority_indent_brace_ok && merged_brace_ok &&
      sparse_margin_ok &&
      fallback_ok && large_ok && tight_ok && dirty_ok && imslp_ok && realistic_ok && half_ok &&
      double_ok && no_brace_gap_ok && four_staff_no_brace_ok && brace_with_title_ok &&
      clean_gap_no_overlap_ok && clean_gap_gutter_ok && bridging_overlap_ok &&
      generated_two_system_ok && generated_lone_staff_ok &&
      pedal_edge_ok && bridged_edge_ok && clean_edge_ok &&
      sharpen_edge_ok && sharpen_flat_ok) {
    std::printf("PASS: brace-primary and fallback slicer tests succeeded\n");
    return 0;
  }

  return 1;
}
