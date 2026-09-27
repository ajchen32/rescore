#include "slicer.h"

#include "slicer_constants.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <utility>
#include <vector>

namespace {

enum class Provenance : int32_t {
  BRACE = 0,
  ORPHAN_INDENT = 1,
  LEFTOVER_STAFF = 2,
  FALLBACK_FULL_PAGE = 3,
  LOW_CONFIDENCE = 4,
};

struct TaggedRange {
  int32_t y0;
  int32_t y1;
  Provenance provenance;
  bool absorbed = false;
  bool low_confidence = false;
};

struct StaffMetrics {
  double line_thickness = -1.0;
  double staff_space = -1.0;
  bool valid() const {
    return line_thickness >= 1.0 && line_thickness <= 4.0 && staff_space >= 4.0 && staff_space <= 24.0;
  }
};

struct YBlob {
  int32_t y0;
  int32_t y1;
};

struct TaggedYBlob {
  YBlob blob;
  Provenance provenance;
};

struct SliceDebugState {
  int32_t exited_empty_left_band = 0;
  int32_t exited_no_thin_runs = 0;
  int32_t exited_brace_blobs_empty = 0;
  int32_t exited_all_brace_strips_empty = 0;
  int32_t ran_leftover_recovery = 0;
  int32_t ran_absorb = 0;
  int32_t exited_full_page_fallback = 0;
  StaffMetrics metrics;
  int32_t left_band_x0 = 0;
  int32_t left_band_x1 = 0;
  std::vector<int32_t> column_centers;
  std::vector<uint8_t> brace_rows;
  std::vector<int32_t> cut_lines;
  struct BarlineSeg {
    int32_t x;
    int32_t y0;
    int32_t y1;
  };
  std::vector<BarlineSeg> barlines;
};

int32_t mode_histogram(const std::vector<int32_t>& counts, int32_t start, int32_t end) {
  if (start >= end) {
    return -1;
  }
  int32_t best = start;
  int32_t best_count = counts[static_cast<size_t>(start)];
  for (int32_t i = start + 1; i < end; ++i) {
    if (counts[static_cast<size_t>(i)] > best_count) {
      best_count = counts[static_cast<size_t>(i)];
      best = i;
    }
  }
  return best_count > 0 ? best : -1;
}

StaffMetrics estimate_staff_metrics(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t height) {
  StaffMetrics metrics;
  std::vector<int32_t> vert_run_hist(9, 0);
  for (int32_t x = 0; x < width; ++x) {
    int32_t run = 0;
    for (int32_t y = 0; y < height; ++y) {
      const uint8_t ink = binary[static_cast<size_t>(y) * static_cast<size_t>(width) + static_cast<size_t>(x)];
      if (ink != 0) {
        run += 1;
      } else if (run > 0) {
        if (run >= 1 && run <= 8) {
          vert_run_hist[static_cast<size_t>(run)] += 1;
        }
        run = 0;
      }
    }
    if (run >= 1 && run <= 8) {
      vert_run_hist[static_cast<size_t>(run)] += 1;
    }
  }

  const int32_t thickness = mode_histogram(vert_run_hist, 1, 9);
  if (thickness <= 0) {
    return metrics;
  }
  metrics.line_thickness = static_cast<double>(thickness);

  const int32_t min_white = std::max(3, thickness * 3);
  const int32_t max_white = 40;
  std::vector<int32_t> white_hist(static_cast<size_t>(max_white + 1), 0);

  // Vertical white runs on columns that cross several staff lines (not horizontal
  // note-to-note gaps). A staff-line column has many thickness-sized black runs.
  for (int32_t x = 0; x < width; ++x) {
    int32_t black_run = 0;
    int32_t white_run = 0;
    int32_t thickness_hits = 0;
    std::vector<int32_t> column_white;
    for (int32_t y = 0; y < height; ++y) {
      const uint8_t ink =
          binary[static_cast<size_t>(y) * static_cast<size_t>(width) + static_cast<size_t>(x)];
      if (ink != 0) {
        if (white_run >= min_white && white_run <= max_white) {
          column_white.push_back(white_run);
        }
        white_run = 0;
        black_run += 1;
      } else {
        if (black_run >= 1 && black_run <= 8) {
          thickness_hits += 1;
        }
        black_run = 0;
        white_run += 1;
      }
    }
    if (thickness_hits < 8) {
      continue;
    }
    for (int32_t run : column_white) {
      white_hist[static_cast<size_t>(run)] += 1;
    }
  }

  const int32_t space = mode_histogram(white_hist, min_white, max_white + 1);
  if (space <= 0) {
    return metrics;
  }
  metrics.staff_space = static_cast<double>(space);
  return metrics;
}

int32_t scale_from_staff_or_ratio(
    double staff_mult,
    double ratio,
    int32_t page_dim,
    const StaffMetrics& metrics) {
  const int32_t ratio_px =
      std::max(1, static_cast<int32_t>(std::ceil(ratio * static_cast<double>(page_dim))));
  if (!metrics.valid()) {
    return ratio_px;
  }
  const int32_t staff_px =
      std::max(1, static_cast<int32_t>(std::ceil(staff_mult * metrics.staff_space)));
  if (staff_px < ratio_px / 2 || staff_px > ratio_px * 2) {
    return ratio_px;
  }
  return staff_px;
}

int32_t scale_thickness_or_ratio(
    double thickness_mult,
    double width_ratio,
    int32_t width,
    const StaffMetrics& metrics) {
  const int32_t ratio_px =
      std::max(1, static_cast<int32_t>(std::ceil(width * width_ratio)));
  if (!metrics.valid()) {
    return ratio_px;
  }
  const int32_t staff_px =
      std::max(1, static_cast<int32_t>(std::ceil(thickness_mult * metrics.line_thickness)));
  return std::max(ratio_px, staff_px);
}

PppSliceRange make_full_width_range(int32_t y0, int32_t y1, int32_t width) {
  return {y0, y1, 0, width};
}

PppSliceRange to_plain(const TaggedRange& tagged, int32_t width) {
  return make_full_width_range(tagged.y0, tagged.y1, width);
}

std::vector<PppSliceRange> to_plain_ranges(const std::vector<TaggedRange>& tagged, int32_t width) {
  std::vector<PppSliceRange> plain;
  for (const TaggedRange& range : tagged) {
    plain.push_back(to_plain(range, width));
  }
  return plain;
}

struct InkColumnRun {
  int32_t x0;
  int32_t x1;
  int64_t ink;
};

std::vector<InkColumnRun> find_ink_column_runs(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t y0,
    int32_t y1,
    int32_t min_col_ink) {
  std::vector<int32_t> column_ink(static_cast<size_t>(width), 0);
  for (int32_t y = y0; y < y1; ++y) {
    const uint8_t* row = binary.data() + static_cast<size_t>(y) * static_cast<size_t>(width);
    for (int32_t x = 0; x < width; ++x) {
      column_ink[static_cast<size_t>(x)] += row[x];
    }
  }

  std::vector<InkColumnRun> runs;
  int32_t x = 0;
  while (x < width) {
    while (x < width && column_ink[static_cast<size_t>(x)] < min_col_ink) {
      x += 1;
    }
    if (x >= width) {
      break;
    }

    const int32_t run_x0 = x;
    int64_t ink = 0;
    while (x < width && column_ink[static_cast<size_t>(x)] >= min_col_ink) {
      ink += column_ink[static_cast<size_t>(x)];
      x += 1;
    }
    runs.push_back({run_x0, x, ink});
  }

  return runs;
}

int32_t measure_run_ink_height(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t y0,
    int32_t y1,
    int32_t run_x0,
    int32_t run_x1) {
  int32_t ink_rows = 0;
  for (int32_t y = y0; y < y1; ++y) {
    const uint8_t* row = binary.data() + static_cast<size_t>(y) * static_cast<size_t>(width);
    for (int32_t x = run_x0; x < run_x1; ++x) {
      if (row[x] != 0) {
        ink_rows += 1;
        break;
      }
    }
  }
  return ink_rows;
}

bool is_isolated_edge_mark(
    const InkColumnRun& mark,
    const InkColumnRun& body,
    bool mark_is_left,
    int32_t width,
    int32_t y0,
    int32_t y1,
    const std::vector<uint8_t>& binary,
    int32_t gap_threshold_px,
    int32_t max_mark_width_px,
    int32_t max_mark_height_px) {
  const int32_t run_width = mark.x1 - mark.x0;
  if (run_width <= 0 || run_width > max_mark_width_px) {
    return false;
  }

  const int32_t run_height = measure_run_ink_height(binary, width, y0, y1, mark.x0, mark.x1);
  if (run_height <= 0 || run_height > max_mark_height_px) {
    return false;
  }

  const int32_t gap = mark_is_left ? body.x0 - mark.x1 : mark.x0 - body.x1;
  if (gap < gap_threshold_px) {
    return false;
  }

  const int32_t edge_margin = std::max(max_mark_width_px * 2, width / 50);
  if (mark_is_left) {
    return mark.x0 <= edge_margin;
  }
  return mark.x1 >= width - edge_margin;
}

void apply_horizontal_bounds(
    PppSliceRange& range,
    const std::vector<uint8_t>& binary,
    int32_t width,
    const StaffMetrics& metrics) {
  if (range.y1 <= range.y0) {
    range.x0 = 0;
    range.x1 = width;
    return;
  }

  if (!metrics.valid()) {
    range.x0 = 0;
    range.x1 = width;
    return;
  }

  const int32_t side_pad =
      std::max(2, static_cast<int32_t>(std::ceil(metrics.staff_space * STRIP_SIDE_PAD_STAFF_MULT)));
  const int32_t gap_threshold_px =
      std::max(8, static_cast<int32_t>(std::ceil(metrics.staff_space * STRIP_EDGE_MARK_GAP_STAFF_MULT)));
  const int32_t max_mark_width_px =
      std::max(4, static_cast<int32_t>(std::ceil(metrics.staff_space * STRIP_EDGE_MARK_MAX_WIDTH_STAFF_MULT)));
  const int32_t max_mark_height_px =
      std::max(4, static_cast<int32_t>(std::ceil(metrics.staff_space * STRIP_EDGE_MARK_MAX_HEIGHT_STAFF_MULT)));

  const std::vector<InkColumnRun> runs =
      find_ink_column_runs(binary, width, range.y0, range.y1, 1);
  if (runs.empty()) {
    range.x0 = 0;
    range.x1 = width;
    return;
  }

  int32_t span_x0 = runs.front().x0;
  int32_t span_x1 = runs.back().x1;

  if (runs.size() >= 2) {
    const InkColumnRun& first = runs.front();
    const InkColumnRun& second = runs[1];
    if (is_isolated_edge_mark(
            first,
            second,
            true,
            width,
            range.y0,
            range.y1,
            binary,
            gap_threshold_px,
            max_mark_width_px,
            max_mark_height_px)) {
      span_x0 = second.x0;
    }
  }

  if (runs.size() >= 2) {
    const InkColumnRun& last = runs.back();
    const InkColumnRun& previous = runs[runs.size() - 2];
    if (is_isolated_edge_mark(
            last,
            previous,
            false,
            width,
            range.y0,
            range.y1,
            binary,
            gap_threshold_px,
            max_mark_width_px,
            max_mark_height_px)) {
      span_x1 = previous.x1;
    }
  }

  range.x0 = std::max(0, span_x0 - side_pad);
  range.x1 = std::min(width, span_x1 + side_pad);
  if (range.x1 <= range.x0) {
    range.x0 = 0;
    range.x1 = width;
  }
}

void apply_horizontal_crop(
    std::vector<PppSliceRange>& ranges,
    const std::vector<uint8_t>& binary,
    int32_t width,
    const StaffMetrics& metrics) {
  for (PppSliceRange& range : ranges) {
    apply_horizontal_bounds(range, binary, width, metrics);
  }
}

std::vector<TaggedRange> from_plain_ranges(
    const std::vector<PppSliceRange>& plain,
    Provenance provenance) {
  std::vector<TaggedRange> tagged;
  for (const PppSliceRange& range : plain) {
    tagged.push_back({range.y0, range.y1, provenance, false, false});
  }
  return tagged;
}

std::vector<TaggedRange> merge_short_tagged_strips(
    std::vector<TaggedRange> ranges,
    int32_t min_strip_height) {
  if (ranges.size() <= 1) {
    return ranges;
  }

  bool merged = true;
  while (merged) {
    merged = false;
    for (size_t i = 0; i < ranges.size(); ++i) {
      const int32_t strip_height = ranges[i].y1 - ranges[i].y0;
      if (strip_height >= min_strip_height) {
        continue;
      }

      if (i > 0) {
        ranges[i - 1].y1 = ranges[i].y1;
        ranges.erase(ranges.begin() + static_cast<std::ptrdiff_t>(i));
      } else if (ranges.size() > 1) {
        ranges[1].y0 = ranges[0].y0;
        ranges.erase(ranges.begin());
      } else {
        break;
      }

      merged = true;
      break;
    }
  }

  return ranges;
}

uint8_t compute_otsu_threshold(const uint8_t* gray, int32_t width, int32_t height, int32_t stride) {
  uint64_t histogram[256] = {0};
  const int64_t total_pixels = static_cast<int64_t>(width) * static_cast<int64_t>(height);

  for (int32_t y = 0; y < height; ++y) {
    const uint8_t* row = gray + static_cast<size_t>(y) * static_cast<size_t>(stride);
    for (int32_t x = 0; x < width; ++x) {
      histogram[row[x]]++;
    }
  }

  double sum = 0.0;
  for (int32_t i = 0; i < 256; ++i) {
    sum += static_cast<double>(i) * static_cast<double>(histogram[i]);
  }

  double sum_background = 0.0;
  uint64_t weight_background = 0;
  double max_variance = -1.0;
  uint8_t best_threshold = 128;

  for (int32_t t = 0; t < 256; ++t) {
    weight_background += histogram[t];
    if (weight_background == 0) {
      continue;
    }

    const uint64_t weight_foreground = static_cast<uint64_t>(total_pixels) - weight_background;
    if (weight_foreground == 0) {
      break;
    }

    sum_background += static_cast<double>(t) * static_cast<double>(histogram[t]);
    const double mean_background = sum_background / static_cast<double>(weight_background);
    const double mean_foreground =
        (sum - sum_background) / static_cast<double>(weight_foreground);

    const double variance_between =
        static_cast<double>(weight_background) * static_cast<double>(weight_foreground) *
        (mean_background - mean_foreground) * (mean_background - mean_foreground);

    if (variance_between > max_variance) {
      max_variance = variance_between;
      best_threshold = static_cast<uint8_t>(t);
    }
  }

  return best_threshold;
}

std::vector<uint8_t> binarize_page(
    const uint8_t* gray,
    int32_t width,
    int32_t height,
    int32_t stride,
    uint8_t threshold) {
  std::vector<uint8_t> binary(static_cast<size_t>(width) * static_cast<size_t>(height), 0);
  for (int32_t y = 0; y < height; ++y) {
    const uint8_t* src = gray + static_cast<size_t>(y) * static_cast<size_t>(stride);
    uint8_t* dst = binary.data() + static_cast<size_t>(y) * static_cast<size_t>(width);
    for (int32_t x = 0; x < width; ++x) {
      dst[x] = src[x] <= threshold ? 1 : 0;
    }
  }
  return binary;
}

std::vector<int32_t> compute_row_sums(const std::vector<uint8_t>& binary, int32_t width, int32_t height) {
  std::vector<int32_t> row_sums(static_cast<size_t>(height), 0);
  for (int32_t y = 0; y < height; ++y) {
    const uint8_t* row = binary.data() + static_cast<size_t>(y) * static_cast<size_t>(width);
    int32_t sum = 0;
    for (int32_t x = 0; x < width; ++x) {
      sum += row[x];
    }
    row_sums[static_cast<size_t>(y)] = sum;
  }
  return row_sums;
}

std::vector<double> smooth_profile(const std::vector<int32_t>& row_sums, int32_t height) {
  const int32_t radius = std::max(1, static_cast<int32_t>(std::round(height * PROFILE_SMOOTH_RATIO)));
  std::vector<double> smoothed(static_cast<size_t>(height), 0.0);

  for (int32_t y = 0; y < height; ++y) {
    const int32_t y0 = std::max(0, y - radius);
    const int32_t y1 = std::min(height - 1, y + radius);
    double sum = 0.0;
    for (int32_t i = y0; i <= y1; ++i) {
      sum += static_cast<double>(row_sums[static_cast<size_t>(i)]);
    }
    smoothed[static_cast<size_t>(y)] = sum / static_cast<double>(y1 - y0 + 1);
  }

  return smoothed;
}

double median_of_positive(const std::vector<double>& values) {
  std::vector<double> positive;
  for (double value : values) {
    if (value > 0.0) {
      positive.push_back(value);
    }
  }

  if (positive.empty()) {
    return 0.0;
  }

  std::sort(positive.begin(), positive.end());
  const size_t mid = positive.size() / 2;
  if (positive.size() % 2 == 0) {
    return (positive[mid - 1] + positive[mid]) / 2.0;
  }
  return positive[mid];
}

std::vector<int32_t> find_local_maxima(
    const std::vector<double>& smoothed,
    int32_t height,
    double peak_threshold) {
  std::vector<int32_t> peaks;
  for (int32_t y = 1; y < height - 1; ++y) {
    const double prev = smoothed[static_cast<size_t>(y - 1)];
    const double curr = smoothed[static_cast<size_t>(y)];
    const double next = smoothed[static_cast<size_t>(y + 1)];
    if (curr >= prev && curr >= next && curr >= peak_threshold) {
      peaks.push_back(y);
    }
  }
  return peaks;
}

struct PeakCluster {
  int32_t start_y;
  int32_t end_y;
  int32_t center_y;
};

double otsu_threshold_for_values(const std::vector<int32_t>& values) {
  if (values.empty()) {
    return 0.0;
  }

  const int32_t max_value = *std::max_element(values.begin(), values.end());
  if (max_value <= 0) {
    return 0.0;
  }

  std::vector<uint64_t> histogram(static_cast<size_t>(max_value) + 1, 0);
  for (int32_t value : values) {
    histogram[static_cast<size_t>(value)]++;
  }

  const int64_t total = static_cast<int64_t>(values.size());
  double sum = 0.0;
  for (int32_t i = 0; i <= max_value; ++i) {
    sum += static_cast<double>(i) * static_cast<double>(histogram[static_cast<size_t>(i)]);
  }

  double sum_background = 0.0;
  uint64_t weight_background = 0;
  double max_variance = -1.0;
  double best_threshold = static_cast<double>(max_value) / 2.0;

  for (int32_t t = 0; t <= max_value; ++t) {
    weight_background += histogram[static_cast<size_t>(t)];
    if (weight_background == 0) {
      continue;
    }

    const uint64_t weight_foreground = static_cast<uint64_t>(total) - weight_background;
    if (weight_foreground == 0) {
      break;
    }

    sum_background += static_cast<double>(t) * static_cast<double>(histogram[static_cast<size_t>(t)]);
    const double mean_background = sum_background / static_cast<double>(weight_background);
    const double mean_foreground = (sum - sum_background) / static_cast<double>(weight_foreground);
    const double variance_between =
        static_cast<double>(weight_background) * static_cast<double>(weight_foreground) *
        (mean_background - mean_foreground) * (mean_background - mean_foreground);

    if (variance_between > max_variance) {
      max_variance = variance_between;
      best_threshold = static_cast<double>(t);
    }
  }

  return best_threshold;
}

bool gaps_are_ambiguous(const std::vector<int32_t>& gaps) {
  if (gaps.size() < 2) {
    return true;
  }

  const int32_t min_gap = *std::min_element(gaps.begin(), gaps.end());
  const int32_t max_gap = *std::max_element(gaps.begin(), gaps.end());
  if (min_gap <= 0) {
    return true;
  }

  return static_cast<double>(max_gap) / static_cast<double>(min_gap) < 1.25;
}

double compute_gap_merge_threshold(const std::vector<int32_t>& gaps, int32_t height) {
  const double fallback = static_cast<double>(
      std::max(1, static_cast<int32_t>(std::ceil(height * MIN_GAP_HEIGHT_RATIO))));

  if (gaps.empty()) {
    return fallback;
  }

  if (gaps_are_ambiguous(gaps)) {
    return fallback;
  }

  if (gaps.size() < 4) {
    std::vector<int32_t> sorted = gaps;
    std::sort(sorted.begin(), sorted.end());
    return static_cast<double>(sorted[sorted.size() / 2]);
  }

  return otsu_threshold_for_values(gaps);
}

std::vector<PeakCluster> merge_peaks_with_max_gap(
    const std::vector<int32_t>& peaks,
    int32_t max_gap_px) {
  if (peaks.empty()) {
    return {};
  }

  std::vector<PeakCluster> clusters;
  int32_t cluster_start = peaks[0];
  int32_t cluster_end = peaks[0];
  int32_t cluster_center = peaks[0];

  for (size_t i = 1; i < peaks.size(); ++i) {
    const int32_t peak_y = peaks[i];
    const int32_t gap = peak_y - cluster_end;
    if (gap <= max_gap_px) {
      cluster_end = peak_y;
    } else {
      clusters.push_back({cluster_start, cluster_end, cluster_center});
      cluster_start = peak_y;
      cluster_end = peak_y;
      cluster_center = peak_y;
    }
  }

  clusters.push_back({cluster_start, cluster_end, cluster_center});
  return clusters;
}

bool should_merge_staff_gap(int32_t gap, int32_t height, double merge_threshold) {
  const int32_t interior_floor =
      std::max(1, static_cast<int32_t>(std::ceil(height * GRAND_STAFF_INTERIOR_FLOOR_RATIO)));
  const int32_t ceiling_px =
      std::max(interior_floor + 1, static_cast<int32_t>(std::ceil(height * GAP_PAIR_CEILING_RATIO)));

  if (gap < interior_floor) {
    return true;
  }
  if (gap >= ceiling_px) {
    return false;
  }

  return static_cast<double>(gap) <= merge_threshold;
}

std::vector<PeakCluster> pair_staff_clusters_even(
    const std::vector<PeakCluster>& staff_clusters) {
  std::vector<PeakCluster> systems;
  for (size_t i = 0; i < staff_clusters.size(); i += 2) {
    if (i + 1 < staff_clusters.size()) {
      const PeakCluster& treble = staff_clusters[i];
      const PeakCluster& bass = staff_clusters[i + 1];
      systems.push_back({
          treble.start_y,
          bass.end_y,
          (treble.center_y + bass.center_y) / 2,
      });
    } else {
      systems.push_back(staff_clusters[i]);
    }
  }
  return systems;
}

std::vector<PeakCluster> merge_staff_clusters_adaptive(
    const std::vector<PeakCluster>& staff_clusters,
    int32_t height) {
  if (staff_clusters.size() <= 1) {
    return staff_clusters;
  }

  std::vector<int32_t> gaps;
  for (size_t i = 0; i + 1 < staff_clusters.size(); ++i) {
    gaps.push_back(staff_clusters[i + 1].start_y - staff_clusters[i].end_y);
  }

  if (gaps_are_ambiguous(gaps) && staff_clusters.size() % 2 == 0) {
    return pair_staff_clusters_even(staff_clusters);
  }

  const double merge_threshold = compute_gap_merge_threshold(gaps, height);

  std::vector<PeakCluster> systems;
  int32_t cluster_start = staff_clusters[0].start_y;
  int32_t cluster_end = staff_clusters[0].end_y;
  int32_t cluster_center = staff_clusters[0].center_y;

  for (size_t i = 1; i < staff_clusters.size(); ++i) {
    const PeakCluster& staff = staff_clusters[i];
    const int32_t gap = staff.start_y - cluster_end;
    if (should_merge_staff_gap(gap, height, merge_threshold)) {
      cluster_end = staff.end_y;
    } else {
      systems.push_back({cluster_start, cluster_end, cluster_center});
      cluster_start = staff.start_y;
      cluster_end = staff.end_y;
      cluster_center = staff.center_y;
    }
  }

  systems.push_back({cluster_start, cluster_end, cluster_center});
  return systems;
}

std::vector<PeakCluster> cluster_peaks_two_stage(
    const std::vector<int32_t>& peaks,
    int32_t height) {
  const int32_t staff_collapse_px =
      std::max(1, static_cast<int32_t>(std::ceil(height * STAFF_COLLAPSE_RATIO)));
  const std::vector<PeakCluster> staff_clusters = merge_peaks_with_max_gap(peaks, staff_collapse_px);
  return merge_staff_clusters_adaptive(staff_clusters, height);
}

int32_t find_minimum_between(
    const std::vector<double>& smoothed,
    int32_t y_start,
    int32_t y_end) {
  if (y_end <= y_start) {
    return y_start;
  }

  int32_t min_y = y_start;
  double min_value = smoothed[static_cast<size_t>(y_start)];
  for (int32_t y = y_start + 1; y <= y_end; ++y) {
    const double value = smoothed[static_cast<size_t>(y)];
    if (value < min_value) {
      min_value = value;
      min_y = y;
    }
  }
  return min_y;
}

struct WhitespaceCut {
  int32_t y;
  bool low_confidence;
};

WhitespaceCut find_whitespace_cut_between(
    const std::vector<int32_t>& row_sums,
    const std::vector<double>& smoothed,
    const std::vector<uint8_t>* brace_rows,
    int32_t gap_start,
    int32_t gap_end) {
  WhitespaceCut result = {find_minimum_between(smoothed, gap_start, gap_end), false};
  if (gap_end <= gap_start) {
    return result;
  }

  int32_t best_y = gap_start;
  int32_t second_y = gap_start;
  int32_t best_ink = row_sums[static_cast<size_t>(gap_start)];
  int32_t second_ink = best_ink;
  for (int32_t y = gap_start + 1; y <= gap_end; ++y) {
    if (brace_rows != nullptr && y < static_cast<int32_t>(brace_rows->size()) &&
        brace_rows->at(static_cast<size_t>(y)) != 0) {
      continue;
    }
    const int32_t ink = row_sums[static_cast<size_t>(y)];
    if (ink < best_ink) {
      second_ink = best_ink;
      second_y = best_y;
      best_ink = ink;
      best_y = y;
    } else if (ink < second_ink) {
      second_ink = ink;
      second_y = y;
    }
  }

  result.y = best_y;
  if (second_ink > 0 && static_cast<double>(best_ink) > static_cast<double>(second_ink) * 0.85) {
    result.low_confidence = true;
  }
  return result;
}

std::vector<int32_t> find_peaks_in_range(
    const std::vector<double>& smoothed,
    int32_t range_y0,
    int32_t range_y1,
    double peak_threshold) {
  std::vector<int32_t> peaks;
  if (range_y1 - range_y0 < 3) {
    return peaks;
  }

  for (int32_t y = range_y0 + 1; y < range_y1 - 1; ++y) {
    const double prev = smoothed[static_cast<size_t>(y - 1)];
    const double curr = smoothed[static_cast<size_t>(y)];
    const double next = smoothed[static_cast<size_t>(y + 1)];
    if (curr >= prev && curr >= next && curr >= peak_threshold) {
      peaks.push_back(y);
    }
  }
  return peaks;
}

double peak_threshold_for_range(
    const std::vector<double>& smoothed,
    int32_t range_y0,
    int32_t range_y1) {
  std::vector<double> band_values;
  for (int32_t y = range_y0; y < range_y1; ++y) {
    band_values.push_back(smoothed[static_cast<size_t>(y)]);
  }
  const double median = median_of_positive(band_values);
  return median * PEAK_PROMINENCE_RATIO;
}

std::vector<int32_t> find_cut_lines_in_range(
    const std::vector<double>& smoothed,
    int32_t range_y0,
    int32_t range_y1,
    int32_t band_height,
    const std::vector<int32_t>* row_sums = nullptr,
    const std::vector<uint8_t>* brace_rows = nullptr,
    std::vector<bool>* low_confidence_cuts = nullptr) {
  if (band_height <= 0 || range_y1 <= range_y0) {
    return {};
  }

  const double peak_threshold = peak_threshold_for_range(smoothed, range_y0, range_y1);
  const std::vector<int32_t> peaks =
      find_peaks_in_range(smoothed, range_y0, range_y1, peak_threshold);
  if (peaks.size() < 2) {
    return {};
  }

  const std::vector<PeakCluster> clusters = cluster_peaks_two_stage(peaks, band_height);
  if (clusters.size() < 2) {
    return {};
  }

  std::vector<int32_t> cut_lines;
  for (size_t i = 0; i + 1 < clusters.size(); ++i) {
    const int32_t gap_start = clusters[i].end_y;
    const int32_t gap_end = clusters[i + 1].start_y;
    if (gap_end <= gap_start) {
      continue;
    }
    if (row_sums != nullptr) {
      const WhitespaceCut cut =
          find_whitespace_cut_between(*row_sums, smoothed, brace_rows, gap_start, gap_end);
      cut_lines.push_back(cut.y);
      if (low_confidence_cuts != nullptr && cut.low_confidence) {
        low_confidence_cuts->push_back(true);
      } else if (low_confidence_cuts != nullptr) {
        low_confidence_cuts->push_back(false);
      }
    } else {
      cut_lines.push_back(find_minimum_between(smoothed, gap_start, gap_end));
    }
  }

  std::sort(cut_lines.begin(), cut_lines.end());
  cut_lines.erase(std::unique(cut_lines.begin(), cut_lines.end()), cut_lines.end());
  return cut_lines;
}

std::vector<int32_t> find_cut_lines(const std::vector<int32_t>& row_sums, int32_t width, int32_t height) {
  const std::vector<double> smoothed = smooth_profile(row_sums, height);
  return find_cut_lines_in_range(smoothed, 0, height, height);
}

int64_t count_ink_in_range(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t y0,
    int32_t y1) {
  int64_t ink = 0;
  for (int32_t y = y0; y < y1; ++y) {
    const uint8_t* row = binary.data() + static_cast<size_t>(y) * static_cast<size_t>(width);
    for (int32_t x = 0; x < width; ++x) {
      ink += row[x];
    }
  }
  return ink;
}

std::vector<PppSliceRange> build_initial_ranges(
    const std::vector<int32_t>& cut_lines,
    int32_t height,
    int32_t width) {
  std::vector<int32_t> boundaries;
  boundaries.push_back(0);
  for (int32_t cut : cut_lines) {
    boundaries.push_back(cut);
  }
  boundaries.push_back(height);

  std::vector<PppSliceRange> ranges;
  for (size_t i = 0; i + 1 < boundaries.size(); ++i) {
    const int32_t y0 = boundaries[i];
    const int32_t y1 = boundaries[i + 1];
    if (y1 > y0) {
      ranges.push_back(make_full_width_range(y0, y1, width));
    }
  }

  if (ranges.empty()) {
    ranges.push_back(make_full_width_range(0, height, width));
  }

  return ranges;
}

bool range_has_min_ink(
    const PppSliceRange& range,
    const std::vector<uint8_t>& binary,
    int32_t width) {
  const int64_t strip_pixels =
      static_cast<int64_t>(width) * static_cast<int64_t>(range.y1 - range.y0);
  const int64_t min_ink = static_cast<int64_t>(std::ceil(strip_pixels * MIN_INK_RATIO));
  const int64_t ink = count_ink_in_range(binary, width, range.y0, range.y1);
  return ink >= min_ink;
}

std::vector<PppSliceRange> filter_empty_strips(
    const std::vector<PppSliceRange>& ranges,
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t height) {
  std::vector<PppSliceRange> filtered;
  for (const PppSliceRange& range : ranges) {
    if (range_has_min_ink(range, binary, width)) {
      filtered.push_back(range);
    }
  }

  if (filtered.empty()) {
    filtered.push_back(make_full_width_range(0, height, width));
  }

  return filtered;
}

std::vector<PppSliceRange> filter_nonempty_strips(
    const std::vector<PppSliceRange>& ranges,
    const std::vector<uint8_t>& binary,
    int32_t width) {
  std::vector<PppSliceRange> filtered;
  for (const PppSliceRange& range : ranges) {
    if (range_has_min_ink(range, binary, width)) {
      filtered.push_back(range);
    }
  }
  return filtered;
}

std::vector<TaggedRange> filter_nonempty_tagged_strips(
    const std::vector<TaggedRange>& ranges,
    const std::vector<uint8_t>& binary,
    int32_t width) {
  std::vector<TaggedRange> filtered;
  for (const TaggedRange& range : ranges) {
    if (range_has_min_ink(to_plain(range, width), binary, width)) {
      filtered.push_back(range);
    }
  }
  return filtered;
}

struct InkSpan {
  int32_t first_y;
  int32_t last_y;
  int32_t height;
  bool valid;
};

int32_t ink_row_threshold(int32_t width) {
  return std::max(1, static_cast<int32_t>(std::ceil(width * GAP_ROW_THRESHOLD_RATIO)));
}

InkSpan compute_ink_span(
    const PppSliceRange& range,
    const std::vector<int32_t>& row_sums,
    int32_t width) {
  const int32_t threshold = ink_row_threshold(width);
  int32_t first_y = -1;
  int32_t last_y = -1;

  for (int32_t y = range.y0; y < range.y1; ++y) {
    if (row_sums[static_cast<size_t>(y)] >= threshold) {
      if (first_y < 0) {
        first_y = y;
      }
      last_y = y;
    }
  }

  if (first_y < 0 || last_y < first_y) {
    return {-1, -1, 0, false};
  }

  return {first_y, last_y, last_y - first_y + 1, true};
}

InkSpan compute_combined_ink_span(
    const PppSliceRange& left,
    const PppSliceRange& right,
    const std::vector<int32_t>& row_sums,
    int32_t width) {
  const InkSpan left_span = compute_ink_span(left, row_sums, width);
  const InkSpan right_span = compute_ink_span(right, row_sums, width);
  if (!left_span.valid || !right_span.valid) {
    return {-1, -1, 0, false};
  }

  return {
      left_span.first_y,
      right_span.last_y,
      right_span.last_y - left_span.first_y + 1,
      true,
  };
}

double median_of_sorted_int32(const std::vector<int32_t>& values) {
  if (values.empty()) {
    return 0.0;
  }

  std::vector<int32_t> sorted = values;
  std::sort(sorted.begin(), sorted.end());
  const size_t mid = sorted.size() / 2;
  if (sorted.size() % 2 == 0) {
    return static_cast<double>(sorted[mid - 1] + sorted[mid]) / 2.0;
  }
  return static_cast<double>(sorted[mid]);
}

double compute_typical_ink_height(
    const std::vector<PppSliceRange>& ranges,
    const std::vector<int32_t>& row_sums,
    int32_t width) {
  std::vector<int32_t> heights;
  for (const PppSliceRange& range : ranges) {
    const InkSpan span = compute_ink_span(range, row_sums, width);
    if (span.valid) {
      heights.push_back(span.height);
    }
  }

  if (heights.size() < 2) {
    return 0.0;
  }

  std::sort(heights.begin(), heights.end());
  const size_t upper_start = heights.size() / 2;
  std::vector<int32_t> upper_half(heights.begin() + static_cast<std::ptrdiff_t>(upper_start), heights.end());
  return median_of_sorted_int32(upper_half);
}

std::vector<PppSliceRange> merge_half_strips(
    std::vector<PppSliceRange> ranges,
    const std::vector<int32_t>& row_sums,
    int32_t width,
    double median_height) {
  if (ranges.size() <= 1 || median_height <= 0.0) {
    return ranges;
  }

  const double half_threshold = median_height * STRIP_HALF_RATIO;
  const double pair_max = median_height * STRIP_HALF_PAIR_MAX_RATIO;

  bool merged = true;
  while (merged) {
    merged = false;
    for (size_t i = 0; i < ranges.size(); ++i) {
      const InkSpan span = compute_ink_span(ranges[i], row_sums, width);
      if (!span.valid || static_cast<double>(span.height) >= half_threshold) {
        continue;
      }

      if (i + 1 < ranges.size()) {
        const InkSpan next_span = compute_ink_span(ranges[i + 1], row_sums, width);
        if (next_span.valid &&
            static_cast<double>(next_span.height) < half_threshold) {
          const InkSpan combined =
              compute_combined_ink_span(ranges[i], ranges[i + 1], row_sums, width);
          if (!combined.valid) {
            continue;
          }

          const bool within_pair_limit =
              static_cast<double>(combined.height) < pair_max;
          const bool within_single_system_limit =
              static_cast<double>(combined.height) < median_height * STRIP_DOUBLE_RATIO;
          if (within_pair_limit || within_single_system_limit) {
            ranges[i].y1 = ranges[i + 1].y1;
            ranges.erase(ranges.begin() + static_cast<std::ptrdiff_t>(i + 1));
            merged = true;
            break;
          }

          // Wide treble/bass interiors exceed pair_max but still belong to one grand staff.
          ranges[i].y1 = ranges[i + 1].y1;
          ranges.erase(ranges.begin() + static_cast<std::ptrdiff_t>(i + 1));
          merged = true;
          break;
        }
      }

      size_t best_neighbor = ranges.size();
      double best_distance = -1.0;

      if (i > 0) {
        const InkSpan combined =
            compute_combined_ink_span(ranges[i - 1], ranges[i], row_sums, width);
        if (combined.valid) {
          const double distance = std::abs(static_cast<double>(combined.height) - median_height);
          best_neighbor = i - 1;
          best_distance = distance;
        }
      }

      if (i + 1 < ranges.size()) {
        const InkSpan combined =
            compute_combined_ink_span(ranges[i], ranges[i + 1], row_sums, width);
        if (combined.valid) {
          const double distance = std::abs(static_cast<double>(combined.height) - median_height);
          if (best_neighbor == ranges.size() || distance < best_distance) {
            best_neighbor = i + 1;
            best_distance = distance;
          }
        }
      }

      if (best_neighbor == ranges.size()) {
        continue;
      }

      if (best_neighbor < i) {
        ranges[best_neighbor].y1 = ranges[i].y1;
        ranges.erase(ranges.begin() + static_cast<std::ptrdiff_t>(i));
      } else {
        ranges[i].y1 = ranges[best_neighbor].y1;
        ranges.erase(ranges.begin() + static_cast<std::ptrdiff_t>(best_neighbor));
      }

      merged = true;
      break;
    }
  }

  return ranges;
}

std::vector<PppSliceRange> split_double_strips(
    std::vector<PppSliceRange> ranges,
    const std::vector<int32_t>& row_sums,
    const std::vector<double>& smoothed,
    int32_t width,
    double median_height) {
  if (ranges.size() <= 1 || median_height <= 0.0) {
    return ranges;
  }

  const double double_threshold = median_height * STRIP_DOUBLE_RATIO;

  for (int pass = 0; pass < 3; ++pass) {
    bool split_any = false;
    std::vector<PppSliceRange> next_ranges;
    next_ranges.reserve(ranges.size() + 1);

    for (const PppSliceRange& range : ranges) {
      const InkSpan span = compute_ink_span(range, row_sums, width);
      if (!span.valid || static_cast<double>(span.height) < double_threshold) {
        next_ranges.push_back(range);
        continue;
      }

      const int32_t edge_margin =
          std::max(1, static_cast<int32_t>(std::round(span.height * DOUBLE_SPLIT_EDGE_RATIO)));
      const int32_t search_start = span.first_y + edge_margin;
      const int32_t search_end = span.last_y - edge_margin;
      if (search_end <= search_start) {
        next_ranges.push_back(range);
        continue;
      }

      double peak_value = 0.0;
      for (int32_t y = span.first_y; y <= span.last_y; ++y) {
        peak_value = std::max(peak_value, smoothed[static_cast<size_t>(y)]);
      }

      int32_t cut_y = search_start;
      double min_value = smoothed[static_cast<size_t>(search_start)];
      for (int32_t y = search_start + 1; y <= search_end; ++y) {
        const double value = smoothed[static_cast<size_t>(y)];
        if (value < min_value) {
          min_value = value;
          cut_y = y;
        }
      }

      if (peak_value <= 0.0 || min_value >= peak_value * DOUBLE_SPLIT_VALLEY_RATIO) {
        next_ranges.push_back(range);
        continue;
      }

      next_ranges.push_back({range.y0, cut_y});
      next_ranges.push_back({cut_y, range.y1});
      split_any = true;
    }

    ranges = std::move(next_ranges);
    if (!split_any) {
      break;
    }
  }

  return ranges;
}

std::vector<PppSliceRange> normalize_strip_sizes(
    std::vector<PppSliceRange> ranges,
    const std::vector<int32_t>& row_sums,
    const std::vector<double>& smoothed,
    int32_t width,
    int32_t /*height*/) {
  if (ranges.size() < 2) {
    return ranges;
  }

  const double typical_height = compute_typical_ink_height(ranges, row_sums, width);
  if (typical_height <= 0.0) {
    return ranges;
  }

  ranges = merge_half_strips(std::move(ranges), row_sums, width, typical_height);
  ranges = split_double_strips(std::move(ranges), row_sums, smoothed, width, typical_height);
  return ranges;
}

std::vector<TaggedRange> normalize_tagged_strip_sizes(
    std::vector<TaggedRange> ranges,
    const std::vector<int32_t>& row_sums,
    const std::vector<double>& smoothed,
    int32_t width) {
  if (ranges.size() < 2) {
    return ranges;
  }

  const Provenance provenance = ranges[0].provenance;
  const std::vector<PppSliceRange> plain = to_plain_ranges(ranges, width);
  const std::vector<PppSliceRange> normalized =
      normalize_strip_sizes(plain, row_sums, smoothed, width, 0);
  if (normalized.size() != ranges.size()) {
    return from_plain_ranges(normalized, provenance);
  }

  for (size_t i = 0; i < ranges.size(); ++i) {
    ranges[i].y0 = normalized[i].y0;
    ranges[i].y1 = normalized[i].y1;
  }
  return ranges;
}

std::vector<PppSliceRange> merge_short_strips(
    std::vector<PppSliceRange> ranges,
    int32_t height) {
  if (ranges.size() <= 1) {
    return ranges;
  }

  const int32_t min_strip_height =
      std::max(1, static_cast<int32_t>(std::ceil(height * MIN_STRIP_HEIGHT_RATIO)));

  bool merged = true;
  while (merged) {
    merged = false;
    for (size_t i = 0; i < ranges.size(); ++i) {
      const int32_t strip_height = ranges[i].y1 - ranges[i].y0;
      if (strip_height >= min_strip_height) {
        continue;
      }

      if (i > 0) {
        ranges[i - 1].y1 = ranges[i].y1;
        ranges.erase(ranges.begin() + static_cast<std::ptrdiff_t>(i));
      } else if (ranges.size() > 1) {
        ranges[1].y0 = ranges[0].y0;
        ranges.erase(ranges.begin());
      } else {
        break;
      }

      merged = true;
      break;
    }
  }

  return ranges;
}

struct LeftBandBounds {
  int32_t x0;
  int32_t x1;
};

LeftBandBounds compute_left_band_bounds(int32_t width, const StaffMetrics& metrics) {
  const int32_t x0 =
      std::min(width, std::max(0, static_cast<int32_t>(std::ceil(width * LEFT_INSET_RATIO))));
  const int32_t band_width = scale_from_staff_or_ratio(
      LEFT_BAND_STAFF_MULT, LEFT_BAND_RATIO, width, metrics);
  const int32_t x1 = std::min(width, std::max(x0 + 1, x0 + band_width));
  return {x0, x1};
}

struct FirstInkRun {
  int32_t length;
  int32_t x_start;
};

FirstInkRun first_ink_run_in_band(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t x0,
    int32_t x1,
    int32_t y) {
  const uint8_t* row = binary.data() + static_cast<size_t>(y) * static_cast<size_t>(width);
  for (int32_t x = x0; x < x1; ++x) {
    if (row[x] == 0) {
      continue;
    }

    const int32_t x_start = x;
    int32_t run = 0;
    while (x < x1 && row[x] != 0) {
      run += 1;
      x += 1;
    }
    return {run, x_start};
  }
  return {0, -1};
}

int32_t compute_brace_column_slack(int32_t width, int32_t max_stroke_px) {
  return std::max(
      max_stroke_px,
      static_cast<int32_t>(std::ceil(width * BRACE_COLUMN_SLACK_RATIO)));
}

bool thin_run_near_column(int32_t x_start, int32_t column_x, int32_t slack) {
  return x_start >= 0 && x_start >= column_x - slack && x_start <= column_x + slack;
}

bool is_thin_brace_run(const FirstInkRun& run, int32_t max_stroke_px) {
  return run.length >= 1 && run.length <= max_stroke_px && run.x_start >= 0;
}

int32_t median_int32(std::vector<int32_t> values) {
  if (values.empty()) {
    return -1;
  }
  const size_t mid = values.size() / 2;
  std::nth_element(values.begin(), values.begin() + mid, values.end());
  return values[mid];
}

struct BraceColumnClusters {
  std::vector<int32_t> kept_centers;
  std::vector<int32_t> rejected_centers;
};

BraceColumnClusters cluster_brace_columns(
    const std::vector<int32_t>& x_samples,
    int32_t slack,
    int32_t min_rows) {
  BraceColumnClusters result;
  if (x_samples.empty()) {
    return result;
  }

  std::vector<int32_t> sorted = x_samples;
  std::sort(sorted.begin(), sorted.end());

  std::vector<std::vector<int32_t>> clusters;
  for (int32_t x : sorted) {
    if (clusters.empty() || x - clusters.back().back() > slack * 2) {
      clusters.push_back({x});
    } else {
      clusters.back().push_back(x);
    }
  }

  for (const std::vector<int32_t>& cluster : clusters) {
    const int32_t center = median_int32(cluster);
    if (static_cast<int32_t>(cluster.size()) < min_rows) {
      result.rejected_centers.push_back(center);
    } else {
      result.kept_centers.push_back(center);
    }
  }
  return result;
}

bool y_blobs_overlap(const YBlob& a, const YBlob& b) {
  return a.y0 <= b.y1 && b.y0 <= a.y1;
}

bool overlaps_any_blob(const YBlob& blob, const std::vector<YBlob>& blobs) {
  for (const YBlob& other : blobs) {
    if (y_blobs_overlap(blob, other)) {
      return true;
    }
  }
  return false;
}

std::vector<uint8_t> build_brace_row_mask_for_columns(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t height,
    int32_t x0,
    int32_t x1,
    int32_t max_stroke_px,
    const std::vector<int32_t>& column_centers,
    int32_t column_slack) {
  std::vector<uint8_t> brace_rows(static_cast<size_t>(height), 0);
  if (column_centers.empty()) {
    return brace_rows;
  }

  for (int32_t y = 0; y < height; ++y) {
    const FirstInkRun run = first_ink_run_in_band(binary, width, x0, x1, y);
    if (!is_thin_brace_run(run, max_stroke_px)) {
      continue;
    }

    for (int32_t column_x : column_centers) {
      if (thin_run_near_column(run.x_start, column_x, column_slack)) {
        brace_rows[static_cast<size_t>(y)] = 1;
        break;
      }
    }
  }
  return brace_rows;
}

std::vector<YBlob> group_brace_rows(
    const std::vector<uint8_t>& brace_rows,
    int32_t height,
    int32_t gap_fill_px) {
  std::vector<YBlob> groups;
  int32_t group_start = -1;
  int32_t group_end = -1;
  int32_t gap_count = 0;

  for (int32_t y = 0; y < height; ++y) {
    if (brace_rows[static_cast<size_t>(y)] != 0) {
      if (group_start < 0) {
        group_start = y;
        group_end = y;
      } else if (gap_count > 0) {
        group_end = y;
      } else {
        group_end = y;
      }
      gap_count = 0;
      continue;
    }

    if (group_start < 0) {
      continue;
    }

    gap_count += 1;
    if (gap_count > gap_fill_px) {
      groups.push_back({group_start, group_end});
      group_start = -1;
      group_end = -1;
      gap_count = 0;
    }
  }

  if (group_start >= 0) {
    groups.push_back({group_start, group_end});
  }

  return groups;
}

int32_t count_band_row_ink(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t x0,
    int32_t x1,
    int32_t y) {
  int32_t ink = 0;
  const uint8_t* row = binary.data() + static_cast<size_t>(y) * static_cast<size_t>(width);
  for (int32_t x = x0; x < x1; ++x) {
    ink += row[x];
  }
  return ink;
}

int32_t find_weakest_band_row(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t x0,
    int32_t x1,
    const YBlob& blob) {
  int32_t weakest_y = blob.y0;
  int32_t weakest_ink = count_band_row_ink(binary, width, x0, x1, blob.y0);
  for (int32_t y = blob.y0 + 1; y <= blob.y1; ++y) {
    const int32_t row_ink = count_band_row_ink(binary, width, x0, x1, y);
    if (row_ink < weakest_ink) {
      weakest_ink = row_ink;
      weakest_y = y;
    }
  }
  return weakest_y;
}

std::vector<YBlob> split_tall_brace_blob(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t x0,
    int32_t x1,
    const YBlob& blob) {
  const int32_t split_y = find_weakest_band_row(binary, width, x0, x1, blob);
  if (split_y <= blob.y0 || split_y >= blob.y1) {
    return {blob};
  }

  return {
      {blob.y0, split_y - 1},
      {split_y + 1, blob.y1},
  };
}

std::vector<YBlob> split_tall_brace_blobs(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t x0,
    int32_t x1,
    int32_t height,
    std::vector<YBlob> blobs,
    int32_t split_height) {
  split_height = std::max(1, split_height);

  for (int pass = 0; pass < 2; ++pass) {
    std::vector<YBlob> next_blobs;
    bool split_any = false;
    for (const YBlob& blob : blobs) {
      const int32_t blob_height = blob.y1 - blob.y0 + 1;
      if (blob_height > split_height) {
        const std::vector<YBlob> pieces = split_tall_brace_blob(binary, width, x0, x1, blob);
        next_blobs.insert(next_blobs.end(), pieces.begin(), pieces.end());
        split_any = true;
      } else {
        next_blobs.push_back(blob);
      }
    }
    blobs = std::move(next_blobs);
    if (!split_any) {
      break;
    }
  }

  return blobs;
}

std::vector<SliceDebugState::BarlineSeg> find_barlines(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t height,
    int32_t x0,
    int32_t x1,
    const StaffMetrics& metrics) {
  const int32_t min_height = scale_from_staff_or_ratio(
      BARLINE_MIN_HEIGHT_STAFF_MULT, 0.06, height, metrics);
  const int32_t bridge_gap = scale_from_staff_or_ratio(
      BARLINE_BRIDGE_GAP_STAFF_MULT, 0.01, height, metrics);

  std::vector<SliceDebugState::BarlineSeg> segments;
  for (int32_t x = x0; x < x1; ++x) {
    int32_t run_start = -1;
    int32_t gap = 0;
    for (int32_t y = 0; y < height; ++y) {
      const uint8_t ink = binary[static_cast<size_t>(y) * static_cast<size_t>(width) + static_cast<size_t>(x)];
      if (ink != 0) {
        if (run_start < 0) {
          run_start = y;
        }
        gap = 0;
      } else if (run_start >= 0) {
        gap += 1;
        if (gap > bridge_gap) {
          const int32_t run_end = y - gap;
          if (run_end - run_start + 1 >= min_height) {
            segments.push_back({x, run_start, run_end});
          }
          run_start = -1;
          gap = 0;
        }
      }
    }
    if (run_start >= 0 && height - run_start >= min_height) {
      segments.push_back({x, run_start, height - 1});
    }
  }

  if (segments.empty()) {
    return segments;
  }

  std::sort(segments.begin(), segments.end(), [](const SliceDebugState::BarlineSeg& a, const SliceDebugState::BarlineSeg& b) {
    return a.y0 < b.y0;
  });

  std::vector<SliceDebugState::BarlineSeg> merged;
  SliceDebugState::BarlineSeg current = segments[0];
  for (size_t i = 1; i < segments.size(); ++i) {
    const SliceDebugState::BarlineSeg& next = segments[i];
    if (std::abs(next.x - current.x) <= BARLINE_MAX_X_DRIFT_PX && next.y0 <= current.y1 + bridge_gap) {
      current.y1 = std::max(current.y1, next.y1);
      current.x = (current.x + next.x) / 2;
    } else {
      merged.push_back(current);
      current = next;
    }
  }
  merged.push_back(current);
  return merged;
}

bool barline_near_blob(
    const YBlob& blob,
    const std::vector<SliceDebugState::BarlineSeg>& barlines,
    int32_t slack_px) {
  for (const SliceDebugState::BarlineSeg& barline : barlines) {
    if (barline.y0 <= blob.y1 + slack_px && barline.y1 >= blob.y0 - slack_px) {
      return true;
    }
  }
  return false;
}

struct BraceDetection {
  std::vector<TaggedYBlob> blobs;
  std::vector<uint8_t> brace_rows;
  std::vector<int32_t> column_centers;
  LeftBandBounds band{};
  bool empty_left_band = false;
  bool no_thin_runs = false;
};

int32_t row_ink_from_x(const std::vector<uint8_t>& binary, int32_t width, int32_t x0, int32_t y);

// True when rows [y0, y1] right of x0 contain at least five staff-like lines:
// runs of rows where ink covers much of the width. Broken or faint lines still
// pass (it counts ink, not unbroken runs); aligned stems and text do not.
bool rows_have_staff_lines(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t x0,
    int32_t y0,
    int32_t y1) {
  const int32_t start = std::clamp(x0, 0, width);
  const int32_t span = width - start;
  if (span <= 0) {
    return false;
  }
  int32_t lines = 0;
  bool in_line = false;
  for (int32_t y = std::max(0, y0); y <= y1; ++y) {
    const bool is_line = row_ink_from_x(binary, width, start, y) >= span * ORPHAN_STAFF_LINE_INK_RATIO;
    if (is_line && !in_line) {
      lines += 1;
    }
    in_line = is_line;
  }
  return lines >= 5;
}

// Single-linkage clustering chains scattered text and note samples together, so
// a second brace column (an indented first system) can vanish inside the main
// cluster. Histogram peaks away from the main column find it again; the orphan
// pass then only accepts brace-sized blobs that no found system covers.
std::vector<int32_t> find_extra_brace_columns(
    const std::vector<int32_t>& x_samples,
    int32_t slack,
    int32_t main_center,
    int32_t min_count) {
  std::vector<int32_t> extra;
  if (x_samples.empty() || slack <= 0) {
    return extra;
  }
  const int32_t max_x = *std::max_element(x_samples.begin(), x_samples.end());
  std::vector<int32_t> bins(static_cast<size_t>(max_x / slack + 2), 0);
  for (int32_t x : x_samples) {
    bins[static_cast<size_t>(x / slack)] += 1;
  }
  for (size_t i = 0; i < bins.size(); ++i) {
    const int32_t left = i > 0 ? bins[i - 1] : 0;
    const int32_t right = i + 1 < bins.size() ? bins[i + 1] : 0;
    if (bins[i] < min_count || bins[i] < left || bins[i] <= right) {
      continue;  // Not a peak (ties go to the left bin).
    }
    std::vector<int32_t> members;
    const int32_t lo = static_cast<int32_t>(i) * slack - slack;
    const int32_t hi = static_cast<int32_t>(i + 1) * slack + slack;
    for (int32_t x : x_samples) {
      if (x >= lo && x < hi) {
        members.push_back(x);
      }
    }
    const int32_t center = median_int32(members);
    if (std::abs(center - main_center) > slack * 2) {
      extra.push_back(center);
    }
  }
  return extra;
}

BraceDetection detect_braces(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t height,
    const StaffMetrics& metrics,
    bool find_extra_columns = false) {
  BraceDetection detection;
  detection.band = compute_left_band_bounds(width, metrics);
  if (detection.band.x1 <= detection.band.x0) {
    detection.empty_left_band = true;
    return detection;
  }

  const int32_t max_stroke_px = scale_thickness_or_ratio(
      BRACE_MAX_STROKE_THICKNESS_MULT, BRACE_MAX_STROKE_RATIO, width, metrics);
  const int32_t column_slack = compute_brace_column_slack(width, max_stroke_px);
  int32_t gap_fill_px = std::max(1, BRACE_ROW_GAP_FILL_PX);
  if (metrics.valid()) {
    gap_fill_px = std::max(
        gap_fill_px,
        static_cast<int32_t>(std::ceil(BRACE_ROW_GAP_FILL_STAFF_MULT * metrics.staff_space)));
  }
  const int32_t min_height = scale_from_staff_or_ratio(
      BRACE_MIN_HEIGHT_STAFF_MULT, BRACE_MIN_HEIGHT_RATIO, height, metrics);
  const int32_t max_height = std::max(
      min_height + 1,
      scale_from_staff_or_ratio(BRACE_MAX_HEIGHT_STAFF_MULT, BRACE_MAX_HEIGHT_RATIO, height, metrics));
  const int32_t split_height_ratio =
      std::max(min_height + 1, static_cast<int32_t>(std::ceil(height * BRACE_SPLIT_MAX_RATIO)));
  const int32_t split_height = metrics.valid()
      ? std::max(
            min_height + 1,
            std::min(
                split_height_ratio,
                static_cast<int32_t>(std::ceil(BRACE_SPLIT_MAX_STAFF_MULT * metrics.staff_space))))
      : split_height_ratio;

  std::vector<int32_t> thin_run_x_samples;
  for (int32_t y = 0; y < height; ++y) {
    const FirstInkRun run =
        first_ink_run_in_band(binary, width, detection.band.x0, detection.band.x1, y);
    if (is_thin_brace_run(run, max_stroke_px)) {
      thin_run_x_samples.push_back(run.x_start);
    }
  }

  if (thin_run_x_samples.empty()) {
    detection.no_thin_runs = true;
  }

  const BraceColumnClusters column_clusters =
      cluster_brace_columns(thin_run_x_samples, column_slack, min_height);
  std::vector<int32_t> column_centers = column_clusters.kept_centers;
  const bool weak_brace_lock = column_centers.empty();
  if (weak_brace_lock) {
    const int32_t page_median = median_int32(thin_run_x_samples);
    if (page_median >= 0) {
      column_centers.push_back(page_median);
    }
  } else {
    // Braces sit left of the staff. Extra kept clusters are usually clefs/stems.
    std::sort(column_centers.begin(), column_centers.end());
    column_centers.resize(1);
  }

  detection.column_centers = column_centers;
  detection.brace_rows = build_brace_row_mask_for_columns(
      binary,
      width,
      height,
      detection.band.x0,
      detection.band.x1,
      max_stroke_px,
      column_centers,
      column_slack);

  std::vector<YBlob> blobs = group_brace_rows(detection.brace_rows, height, gap_fill_px);
  blobs = split_tall_brace_blobs(
      binary, width, detection.band.x0, detection.band.x1, height, std::move(blobs), split_height);

  std::vector<YBlob> filtered_plain;
  for (const YBlob& blob : blobs) {
    const int32_t blob_height = blob.y1 - blob.y0 + 1;
    if (blob_height >= min_height && blob_height <= max_height) {
      detection.blobs.push_back({blob, Provenance::BRACE});
      filtered_plain.push_back(blob);
    }
  }

  // Rejected clusters are revived as before. Histogram columns are a looser
  // signal (aligned stems can form one), so their blobs must also have staff
  // structure beside them.
  std::vector<std::pair<int32_t, bool>> orphan_centers;
  for (int32_t center : column_clusters.rejected_centers) {
    orphan_centers.push_back({center, false});
  }
  if (!weak_brace_lock && find_extra_columns) {
    for (int32_t center : find_extra_brace_columns(
             thin_run_x_samples, column_slack, column_centers.front(), min_height / 2)) {
      orphan_centers.push_back({center, true});
    }
  }
  for (const auto& [rejected_center, needs_staff] : orphan_centers) {
    const std::vector<uint8_t> orphan_rows = build_brace_row_mask_for_columns(
        binary,
        width,
        height,
        detection.band.x0,
        detection.band.x1,
        max_stroke_px,
        {rejected_center},
        column_slack);
    std::vector<YBlob> orphan_blobs = group_brace_rows(orphan_rows, height, gap_fill_px);
    for (const YBlob& blob : orphan_blobs) {
      const int32_t blob_height = blob.y1 - blob.y0 + 1;
      if (blob_height < min_height || blob_height > max_height) {
        continue;
      }
      if (overlaps_any_blob(blob, filtered_plain)) {
        continue;
      }
      if (needs_staff && !rows_have_staff_lines(binary, width, rejected_center + column_slack, blob.y0, blob.y1)) {
        continue;
      }
      detection.blobs.push_back({blob, Provenance::ORPHAN_INDENT});
      filtered_plain.push_back(blob);
    }
  }

  if (weak_brace_lock && !detection.blobs.empty()) {
    const std::vector<SliceDebugState::BarlineSeg> barlines =
        find_barlines(binary, width, height, detection.band.x0, detection.band.x1, metrics);
    if (!barlines.empty()) {
      const int32_t barline_x = barlines.front().x;
      detection.column_centers = {barline_x};
      detection.brace_rows = build_brace_row_mask_for_columns(
          binary,
          width,
          height,
          detection.band.x0,
          detection.band.x1,
          max_stroke_px,
          detection.column_centers,
          column_slack);
    }
  }

  std::sort(detection.blobs.begin(), detection.blobs.end(), [](const TaggedYBlob& a, const TaggedYBlob& b) {
    return a.blob.y0 < b.blob.y0;
  });

  return detection;
}

std::vector<YBlob> find_left_band_brace_blobs(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t height) {
  const StaffMetrics metrics = estimate_staff_metrics(binary, width, height);
  const BraceDetection detection = detect_braces(binary, width, height, metrics);
  std::vector<YBlob> blobs;
  for (const TaggedYBlob& tagged : detection.blobs) {
    blobs.push_back(tagged.blob);
  }
  return blobs;
}

int32_t row_ink_from_x(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t x0,
    int32_t y) {
  if (y < 0 || x0 >= width) {
    return 0;
  }
  const int32_t start = std::max(0, x0);
  const uint8_t* row = binary.data() + static_cast<size_t>(y) * static_cast<size_t>(width);
  int32_t ink = 0;
  for (int32_t x = start; x < width; ++x) {
    ink += row[x] != 0 ? 1 : 0;
  }
  return ink;
}

// Number of columns from x0 where ink runs from row y - 1 into row y, i.e. the
// strokes an edge placed at y would cut.
int32_t row_crossings_from_x(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t x0,
    int32_t y) {
  if (y <= 0 || x0 >= width || static_cast<size_t>(y + 1) * static_cast<size_t>(width) > binary.size()) {
    return 0;
  }
  const int32_t start = std::max(0, x0);
  const uint8_t* above = binary.data() + static_cast<size_t>(y - 1) * static_cast<size_t>(width);
  const uint8_t* below = above + width;
  int32_t crossings = 0;
  for (int32_t x = start; x < width; ++x) {
    crossings += (above[x] != 0 && below[x] != 0) ? 1 : 0;
  }
  return crossings;
}

struct EdgeSnapWindows {
  int32_t near = 0;   // least-crossed row within this distance
  int32_t clear = 0;  // or the first row nothing crosses within this distance
};

// Move an edge outward (dir = +1 down for a strip bottom, -1 up for a strip top),
// never past `limit`. Prefer the nearest row no stroke crosses within
// windows.clear; otherwise take the least-crossed row within windows.near
// (ties keep the row closest to the original edge).
int32_t snap_edge_outward(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t height,
    int32_t ink_x0,
    int32_t edge,
    int32_t dir,
    int32_t limit,
    const EdgeSnapWindows& windows) {
  const auto bound = [&](int32_t window) {
    return dir > 0 ? std::min({edge + window, limit, height - 1}) : std::max({edge - window, limit, 0});
  };
  const auto within = [dir](int32_t y, int32_t far) { return dir > 0 ? y <= far : y >= far; };

  int32_t best = edge;
  int32_t best_crossings = row_crossings_from_x(binary, width, ink_x0, edge);
  const int32_t near_far = bound(windows.near);
  const int32_t clear_far = bound(std::max(windows.near, windows.clear));
  for (int32_t y = edge + dir; best_crossings > 0 && within(y, clear_far); y += dir) {
    const int32_t crossings = row_crossings_from_x(binary, width, ink_x0, y);
    if (crossings == 0 || (crossings < best_crossings && within(y, near_far))) {
      best = y;
      best_crossings = crossings;
    }
  }
  return best;
}

// Walk down from core_end. Returns the exclusive end of rows that still belong
// to this system: ink, plus holes shorter than a real inter-system gap.
int32_t extend_owned_down(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t ink_x0,
    int32_t y_start,
    int32_t y_limit,
    int32_t quiet_ink,
    int32_t min_quiet_run) {
  int32_t owned_end = y_start;
  int32_t quiet_run = 0;
  for (int32_t y = y_start; y < y_limit; ++y) {
    if (row_ink_from_x(binary, width, ink_x0, y) <= quiet_ink) {
      quiet_run += 1;
      if (quiet_run >= min_quiet_run) {
        return owned_end;
      }
    } else {
      quiet_run = 0;
      owned_end = y + 1;
    }
  }
  return owned_end;
}

// Walk up from core_start. Returns the inclusive start of rows that belong
// to this system.
int32_t extend_owned_up(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t ink_x0,
    int32_t y_start,
    int32_t y_limit,
    int32_t quiet_ink,
    int32_t min_quiet_run) {
  int32_t owned_start = y_limit;
  int32_t quiet_run = 0;
  for (int32_t y = y_limit - 1; y >= y_start; --y) {
    if (row_ink_from_x(binary, width, ink_x0, y) <= quiet_ink) {
      quiet_run += 1;
      if (quiet_run >= min_quiet_run) {
        return owned_start;
      }
    } else {
      quiet_run = 0;
      owned_start = y;
    }
  }
  return owned_start;
}

// From a system's owned ink edge `owned` (exclusive end when dir = +1, inclusive
// start when dir = -1), look past the gutter for one short line of marks such as
// "Ped." signs or a tempo word. Returns the extended edge when that line sits
// closer to this system than to `other_owned` (the neighbouring system's ink edge
// in the same direction), otherwise `owned`.
int32_t attach_mark_line(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t ink_x0,
    int32_t owned,
    int32_t dir,
    int32_t other_owned,
    int32_t max_gap,
    int32_t max_line,
    int32_t min_quiet_run) {
  const auto quiet = [&](int32_t y) { return row_ink_from_x(binary, width, ink_x0, y) == 0; };
  const auto inside = [&](int32_t y) { return dir > 0 ? y < other_owned : y >= other_owned; };
  // First row past the owned edge in scan direction.
  int32_t y = dir > 0 ? owned : owned - 1;
  const int32_t first = y;
  while (inside(y) && quiet(y)) {
    y += dir;
  }
  if (!inside(y) || std::abs(y - first) > max_gap) {
    return owned;
  }

  const int32_t line_start = y;
  int32_t line_last = y;
  int32_t quiet_run = 0;
  for (; inside(y) && quiet_run < min_quiet_run; y += dir) {
    if (quiet(y)) {
      quiet_run += 1;
    } else {
      quiet_run = 0;
      line_last = y;
    }
  }
  if (quiet_run < min_quiet_run || std::abs(line_last - line_start) + 1 > max_line) {
    return owned;  // Runs into the neighbour or is too tall to be a line of marks.
  }

  const int32_t gap_here = std::abs(line_start - first);
  const int32_t gap_there = dir > 0 ? other_owned - line_last - 1 : line_last - other_owned;
  if (gap_here >= gap_there) {
    return owned;
  }
  return dir > 0 ? line_last + 1 : line_last;
}

struct GapBridge {
  bool has_paper = false;
  int32_t valley_y = 0;
};

GapBridge measure_gap_bridge(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t ink_x0,
    int32_t y0,
    int32_t y1,
    int32_t quiet_ink,
    int32_t min_quiet_run) {
  GapBridge bridge;
  bridge.valley_y = y0;
  if (y1 <= y0) {
    bridge.has_paper = true;
    return bridge;
  }

  int32_t min_ink = row_ink_from_x(binary, width, ink_x0, y0);
  int32_t quiet_run = 0;
  int32_t best_run_start = y0;
  int32_t best_run_len = 0;
  int32_t run_start = y0;
  int32_t run_len = 0;

  for (int32_t y = y0; y < y1; ++y) {
    const int32_t ink = row_ink_from_x(binary, width, ink_x0, y);
    min_ink = std::min(min_ink, ink);
    if (ink <= quiet_ink) {
      quiet_run += 1;
      if (quiet_run >= min_quiet_run) {
        bridge.has_paper = true;
      }
    } else {
      quiet_run = 0;
    }
  }

  const int32_t near_min = min_ink + std::max(1, quiet_ink);
  for (int32_t y = y0; y < y1; ++y) {
    const int32_t ink = row_ink_from_x(binary, width, ink_x0, y);
    if (ink <= near_min) {
      if (run_len == 0) {
        run_start = y;
      }
      run_len += 1;
      if (run_len > best_run_len) {
        best_run_len = run_len;
        best_run_start = run_start;
      }
    } else {
      run_len = 0;
    }
  }

  if (best_run_len > 0) {
    bridge.valley_y = best_run_start + best_run_len / 2;
  }
  return bridge;
}

struct PaddedBrace {
  TaggedRange range;
  int32_t core_y0 = 0;
  int32_t core_y1 = 0;
};

std::vector<TaggedRange> tagged_blobs_to_ranges(
    const std::vector<TaggedYBlob>& blobs,
    int32_t height,
    const StaffMetrics& metrics,
    const std::vector<uint8_t>* binary,
    int32_t width,
    int32_t ink_x0) {
  const int32_t pad = scale_from_staff_or_ratio(BRACE_PAD_STAFF_MULT, BRACE_PAD_RATIO, height, metrics);
  std::vector<PaddedBrace> padded;
  padded.reserve(blobs.size());
  for (const TaggedYBlob& tagged : blobs) {
    const int32_t core_y0 = std::max(0, tagged.blob.y0);
    const int32_t core_y1 = std::min(height, tagged.blob.y1 + 1);
    const int32_t y0 = std::max(0, core_y0 - pad);
    const int32_t y1 = std::min(height, core_y1 + pad);
    if (y1 <= y0 || core_y1 <= core_y0) {
      continue;
    }
    padded.push_back({{y0, y1, tagged.provenance, false, false}, core_y0, core_y1});
  }

  std::sort(padded.begin(), padded.end(), [](const PaddedBrace& a, const PaddedBrace& b) {
    return a.core_y0 < b.core_y0;
  });

  const bool can_measure_gap = binary != nullptr && width > 0 && !binary->empty();
  const int32_t quiet_ink = metrics.valid()
      ? std::max(1, static_cast<int32_t>(std::floor(metrics.line_thickness)) - 1)
      : std::max(1, static_cast<int32_t>(std::ceil(std::max(width, 1) * OVERLAP_QUIET_INK_RATIO)));
  const int32_t min_quiet_run = metrics.valid()
      ? std::max(2, static_cast<int32_t>(std::ceil(metrics.staff_space * OVERLAP_MIN_QUIET_RUN_STAFF_MULT)))
      : std::max(2, pad / 4);
  const int32_t paper_margin = metrics.valid()
      ? std::max(1, static_cast<int32_t>(std::ceil(metrics.staff_space * OVERLAP_PAPER_MARGIN_STAFF_MULT)))
      : std::max(1, pad / 6);
  const int32_t extent = metrics.valid()
      ? std::max(pad, static_cast<int32_t>(std::ceil(metrics.staff_space * SYSTEM_INK_EXTENT_STAFF_MULT)))
      : std::max(pad, pad * 2);
  const int32_t attach_quiet = metrics.valid()
      ? std::max(
            min_quiet_run,
            static_cast<int32_t>(std::ceil(metrics.staff_space * SYSTEM_INK_ATTACH_QUIET_STAFF_MULT)))
      : min_quiet_run;
  const int32_t clamped_ink_x0 = std::clamp(ink_x0, 0, std::max(width, 0));
  const int32_t mark_gap =
      scale_from_staff_or_ratio(MARK_LINE_MAX_GAP_STAFF_MULT, EDGE_SNAP_CLEAR_RATIO, height, metrics);
  const int32_t mark_line =
      scale_from_staff_or_ratio(MARK_LINE_MAX_HEIGHT_STAFF_MULT, EDGE_SNAP_CLEAR_RATIO, height, metrics);
  const EdgeSnapWindows snap_window{
      scale_from_staff_or_ratio(EDGE_SNAP_STAFF_MULT, EDGE_SNAP_RATIO, height, metrics),
      scale_from_staff_or_ratio(EDGE_SNAP_CLEAR_STAFF_MULT, EDGE_SNAP_CLEAR_RATIO, height, metrics)};

  for (size_t i = 0; i + 1 < padded.size(); ++i) {
    PaddedBrace& upper = padded[i];
    PaddedBrace& lower = padded[i + 1];
    const int32_t upper_core = upper.core_y1;
    const int32_t lower_core = lower.core_y0;

    if (!can_measure_gap || lower_core <= upper_core) {
      const int32_t mid = (upper.range.y1 + lower.range.y0) / 2;
      upper.range.y1 = std::min(upper.range.y1, mid);
      lower.range.y0 = std::max(lower.range.y0, mid);
      continue;
    }

    // Any ink counts here. A slur crest is often a single pixel, which the
    // gutter test treats as paper.
    const int32_t upper_content = extend_owned_down(
        *binary,
        width,
        clamped_ink_x0,
        upper_core,
        std::min(lower_core, upper_core + extent),
        0,
        attach_quiet);
    const int32_t lower_content = extend_owned_up(
        *binary,
        width,
        clamped_ink_x0,
        std::max(upper_core, lower_core - extent),
        lower_core,
        0,
        attach_quiet);
    // A pedal or dynamics line past the gutter goes to whichever system it is nearer.
    const int32_t upper_owned = attach_mark_line(
        *binary, width, clamped_ink_x0, upper_content, 1, lower_content, mark_gap, mark_line, min_quiet_run);
    const int32_t lower_owned = attach_mark_line(
        *binary, width, clamped_ink_x0, lower_content, -1, upper_content, mark_gap, mark_line, min_quiet_run);
    const GapBridge bridge = measure_gap_bridge(
        *binary, width, clamped_ink_x0, upper_core, lower_core, quiet_ink, min_quiet_run);

    int32_t upper_edge = std::min(lower_core, std::max(upper_core + pad, upper_owned + paper_margin));
    int32_t lower_edge = std::max(upper_core, std::min(lower_core - pad, lower_owned - paper_margin));

    if (!bridge.has_paper) {
      // No empty band. Also share a short window around the quietest ink.
      const int32_t half_span = metrics.valid()
          ? std::max(1, static_cast<int32_t>(std::ceil(metrics.staff_space * OVERLAP_HALF_SPAN_STAFF_MULT)))
          : std::max(4, pad / 3);
      const int32_t share_y0 = std::max(upper_core, bridge.valley_y - half_span);
      const int32_t share_y1 = std::min(lower_core, bridge.valley_y + half_span);
      if (share_y1 > share_y0) {
        upper_edge = std::max(upper_edge, share_y1);
        lower_edge = std::min(lower_edge, share_y0);
      }
    }

    upper.range.y1 = std::min(lower_core, std::max(upper_core, upper_edge));
    lower.range.y0 = std::max(upper_core, std::min(lower_core, lower_edge));
    // The portrait reader cuts the upper strip at lower.range.y0, so both edges matter.
    upper.range.y1 = snap_edge_outward(
        *binary, width, height, clamped_ink_x0, upper.range.y1, 1, lower_core, snap_window);
    lower.range.y0 = snap_edge_outward(
        *binary, width, height, clamped_ink_x0, lower.range.y0, -1, upper_core, snap_window);
    // Growth stops at the extent cap, so a pedal line can still sit just past the
    // snapped edge. Give it to the nearer system.
    upper.range.y1 = std::min(lower_core, attach_mark_line(
        *binary, width, clamped_ink_x0, upper.range.y1, 1, lower_owned, mark_gap, mark_line, min_quiet_run));
    lower.range.y0 = std::max(upper_core, attach_mark_line(
        *binary, width, clamped_ink_x0, lower.range.y0, -1, upper_owned, mark_gap, mark_line, min_quiet_run));
  }

  if (can_measure_gap && !padded.empty()) {
    PaddedBrace& first = padded.front();
    const int32_t owned_top = extend_owned_up(
        *binary,
        width,
        clamped_ink_x0,
        std::max(0, first.core_y0 - extent),
        first.core_y0,
        0,
        attach_quiet);
    const int32_t first_owned = attach_mark_line(
        *binary, width, clamped_ink_x0, owned_top, -1, 0, mark_gap, mark_line, min_quiet_run);
    first.range.y0 = std::max(0, std::min(first.range.y0, first_owned - paper_margin));
    first.range.y0 = snap_edge_outward(
        *binary, width, height, clamped_ink_x0, first.range.y0, -1, 0, snap_window);
    first.range.y0 = attach_mark_line(
        *binary, width, clamped_ink_x0, first.range.y0, -1, 0, mark_gap, mark_line, min_quiet_run);

    PaddedBrace& last = padded.back();
    const int32_t owned_bottom = extend_owned_down(
        *binary,
        width,
        clamped_ink_x0,
        last.core_y1,
        std::min(height, last.core_y1 + extent),
        0,
        attach_quiet);
    const int32_t last_owned = attach_mark_line(
        *binary, width, clamped_ink_x0, owned_bottom, 1, height, mark_gap, mark_line, min_quiet_run);
    last.range.y1 = std::min(height, std::max(last.range.y1, last_owned + paper_margin));
    last.range.y1 = snap_edge_outward(
        *binary, width, height, clamped_ink_x0, last.range.y1, 1, height, snap_window);
    last.range.y1 = attach_mark_line(
        *binary, width, clamped_ink_x0, last.range.y1, 1, height, mark_gap, mark_line, min_quiet_run);
  }

  std::vector<TaggedRange> ranges;
  ranges.reserve(padded.size());
  for (const PaddedBrace& item : padded) {
    if (item.range.y1 > item.range.y0) {
      ranges.push_back(item.range);
    }
  }
  return ranges;
}

std::vector<PppSliceRange> brace_blobs_to_ranges(
    const std::vector<YBlob>& blobs,
    int32_t height,
    int32_t width) {
  const StaffMetrics metrics;
  std::vector<TaggedYBlob> tagged;
  for (const YBlob& blob : blobs) {
    tagged.push_back({blob, Provenance::BRACE});
  }
  return to_plain_ranges(tagged_blobs_to_ranges(tagged, height, metrics, nullptr, 0, 0), width);
}

std::vector<PppSliceRange> find_brace_ranges(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t height) {
  const std::vector<YBlob> blobs = find_left_band_brace_blobs(binary, width, height);
  if (blobs.empty()) {
    return {};
  }
  return brace_blobs_to_ranges(blobs, height, width);
}

std::vector<PppSliceRange> build_initial_ranges_in_band(
    const std::vector<int32_t>& cut_lines,
    int32_t band_y0,
    int32_t band_y1,
    int32_t width) {
  std::vector<int32_t> boundaries;
  boundaries.push_back(band_y0);
  for (int32_t cut : cut_lines) {
    if (cut > band_y0 && cut < band_y1) {
      boundaries.push_back(cut);
    }
  }
  boundaries.push_back(band_y1);

  std::vector<PppSliceRange> ranges;
  for (size_t i = 0; i + 1 < boundaries.size(); ++i) {
    const int32_t y0 = boundaries[i];
    const int32_t y1 = boundaries[i + 1];
    if (y1 > y0) {
      ranges.push_back(make_full_width_range(y0, y1, width));
    }
  }

  if (ranges.empty()) {
    ranges.push_back(make_full_width_range(band_y0, band_y1, width));
  }

  return ranges;
}

std::vector<PppSliceRange> find_fallback_ranges_in_band(
    const std::vector<int32_t>& row_sums,
    const std::vector<double>& smoothed,
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t band_y0,
    int32_t band_y1) {
  const int32_t band_height = band_y1 - band_y0;
  if (band_height <= 0) {
    return {};
  }

  const std::vector<int32_t> cut_lines =
      find_cut_lines_in_range(smoothed, band_y0, band_y1, band_height);

  std::vector<PppSliceRange> ranges;
  if (cut_lines.empty()) {
    ranges.push_back(make_full_width_range(band_y0, band_y1, width));
  } else {
    ranges = build_initial_ranges_in_band(cut_lines, band_y0, band_y1, width);
  }

  ranges = filter_nonempty_strips(ranges, binary, width);
  ranges = merge_short_strips(std::move(ranges), band_height);
  ranges = normalize_strip_sizes(std::move(ranges), row_sums, smoothed, width, band_height);
  return ranges;
}

std::vector<PppSliceRange> find_fallback_ranges(
    const std::vector<int32_t>& row_sums,
    const std::vector<double>& smoothed,
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t height) {
  return find_fallback_ranges_in_band(row_sums, smoothed, binary, width, 0, height);
}

struct UncoveredBand {
  int32_t y0;
  int32_t y1;
};

std::vector<UncoveredBand> complement_uncovered_bands(
    const std::vector<PppSliceRange>& kept_ranges,
    int32_t height) {
  if (kept_ranges.empty()) {
    return {{0, height}};
  }

  std::vector<PppSliceRange> sorted = kept_ranges;
  std::sort(sorted.begin(), sorted.end(), [](const PppSliceRange& a, const PppSliceRange& b) {
    return a.y0 < b.y0;
  });

  std::vector<UncoveredBand> bands;
  int32_t cursor = 0;
  for (const PppSliceRange& range : sorted) {
    if (range.y0 > cursor) {
      bands.push_back({cursor, range.y0});
    }
    cursor = std::max(cursor, range.y1);
  }
  if (cursor < height) {
    bands.push_back({cursor, height});
  }
  return bands;
}

bool band_has_staff_structure(
    const std::vector<double>& smoothed,
    int32_t band_y0,
    int32_t band_y1,
    int32_t page_height,
    const StaffMetrics& metrics) {
  const int32_t band_height = band_y1 - band_y0;
  const int32_t min_band_height =
      std::max(1, static_cast<int32_t>(std::ceil(page_height * MIN_STRIP_HEIGHT_RATIO)));
  if (band_height < min_band_height) {
    return false;
  }

  const double peak_threshold = peak_threshold_for_range(smoothed, band_y0, band_y1);
  const std::vector<int32_t> peaks =
      find_peaks_in_range(smoothed, band_y0, band_y1, peak_threshold);
  if (peaks.size() < 5) {
    return false;
  }

  const int32_t staff_collapse_px = metrics.valid()
      ? std::max(1, static_cast<int32_t>(std::ceil(metrics.staff_space * 2.0)))
      : std::max(1, static_cast<int32_t>(std::ceil(page_height * STAFF_COLLAPSE_RATIO)));
  const std::vector<PeakCluster> staff_clusters = merge_peaks_with_max_gap(peaks, staff_collapse_px);
  if (staff_clusters.empty()) {
    return false;
  }

  const int32_t min_dense_staff_px = metrics.valid()
      ? std::max(1, static_cast<int32_t>(std::ceil(metrics.staff_space * 4.0)))
      : std::max(1, static_cast<int32_t>(std::ceil(page_height * STAFF_COLLAPSE_RATIO * 4.0)));
  int32_t max_cluster_peak_count = 0;
  int32_t dense_staff_cluster_count = 0;
  for (const PeakCluster& cluster : staff_clusters) {
    if (cluster.end_y - cluster.start_y < min_dense_staff_px) {
      continue;
    }

    int32_t peak_count = 0;
    for (int32_t peak : peaks) {
      if (peak >= cluster.start_y && peak <= cluster.end_y) {
        peak_count += 1;
      }
    }
    if (peak_count < 5) {
      continue;
    }

    dense_staff_cluster_count += 1;
    max_cluster_peak_count = std::max(max_cluster_peak_count, peak_count);
  }
  if (dense_staff_cluster_count == 0) {
    // After page-scale smoothing, a 5-line staff is often a single peak.
    // A treble/bass pair spaced like a grand staff still counts.
    if (metrics.valid() && peaks.size() >= 2) {
      const double min_interior = 3.0 * metrics.staff_space;
      const double max_interior = 12.0 * metrics.staff_space;
      for (size_t i = 0; i + 1 < peaks.size(); ++i) {
        const double gap = static_cast<double>(peaks[i + 1] - peaks[i]);
        if (gap >= min_interior && gap <= max_interior) {
          return true;
        }
      }
    }
    return false;
  }
  if (dense_staff_cluster_count == 1 && max_cluster_peak_count > 10) {
    return false;
  }

  return true;
}

std::vector<TaggedRange> find_fallback_tagged_ranges_in_band(
    const std::vector<int32_t>& row_sums,
    const std::vector<double>& smoothed,
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t band_y0,
    int32_t band_y1,
    const StaffMetrics& metrics,
    std::vector<int32_t>* cut_lines_out,
    const std::vector<uint8_t>* brace_rows = nullptr,
    Provenance provenance = Provenance::FALLBACK_FULL_PAGE) {
  const int32_t band_height = band_y1 - band_y0;
  if (band_height <= 0) {
    return {};
  }

  std::vector<bool> low_confidence_cuts;
  const std::vector<int32_t> cut_lines = find_cut_lines_in_range(
      smoothed,
      band_y0,
      band_y1,
      band_height,
      &row_sums,
      brace_rows,
      &low_confidence_cuts);
  if (cut_lines_out != nullptr) {
    cut_lines_out->insert(cut_lines_out->end(), cut_lines.begin(), cut_lines.end());
  }

  std::vector<TaggedRange> ranges;
  if (cut_lines.empty()) {
    ranges.push_back({band_y0, band_y1, provenance, false, false});
  } else {
    const std::vector<PppSliceRange> plain =
        build_initial_ranges_in_band(cut_lines, band_y0, band_y1, width);
    ranges = from_plain_ranges(plain, provenance);
    for (size_t i = 0; i < ranges.size(); ++i) {
      if (i < low_confidence_cuts.size() && low_confidence_cuts[i]) {
        ranges[i].low_confidence = true;
      }
      if (i + 1 < ranges.size() && i < low_confidence_cuts.size() && low_confidence_cuts[i]) {
        ranges[i + 1].low_confidence = true;
      }
    }
  }

  ranges = filter_nonempty_tagged_strips(ranges, binary, width);
  const int32_t min_strip_height = scale_from_staff_or_ratio(
      MIN_STRIP_HEIGHT_STAFF_MULT, MIN_STRIP_HEIGHT_RATIO, band_height, metrics);
  ranges = merge_short_tagged_strips(std::move(ranges), min_strip_height);
  ranges = normalize_tagged_strip_sizes(std::move(ranges), row_sums, smoothed, width);
  return ranges;
}

std::vector<TaggedRange> recover_leftover_tagged_staffs(
    std::vector<TaggedRange> kept_ranges,
    const std::vector<int32_t>& row_sums,
    const std::vector<double>& smoothed,
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t height,
    const StaffMetrics& metrics,
    std::vector<int32_t>* cut_lines_out,
    const std::vector<uint8_t>* brace_rows = nullptr) {
  const std::vector<UncoveredBand> uncovered =
      complement_uncovered_bands(to_plain_ranges(kept_ranges, width), height);
  for (const UncoveredBand& band : uncovered) {
    if (!band_has_staff_structure(smoothed, band.y0, band.y1, height, metrics)) {
      continue;
    }

    if (!range_has_min_ink(make_full_width_range(band.y0, band.y1, width), binary, width)) {
      continue;
    }
    kept_ranges.push_back({band.y0, band.y1, Provenance::LEFTOVER_STAFF, false, false});
  }

  std::sort(kept_ranges.begin(), kept_ranges.end(), [](const TaggedRange& a, const TaggedRange& b) {
    return a.y0 < b.y0;
  });
  return kept_ranges;
}

std::vector<TaggedRange> absorb_non_staff_leftovers_tagged(
    std::vector<TaggedRange> ranges,
    const std::vector<double>& /*smoothed*/,
    int32_t /*height*/,
    const StaffMetrics& /*metrics*/) {
  std::sort(ranges.begin(), ranges.end(), [](const TaggedRange& a, const TaggedRange& b) {
    return a.y0 < b.y0;
  });
  return ranges;
}

void mark_barline_confidence(
    std::vector<TaggedRange>& ranges,
    const std::vector<SliceDebugState::BarlineSeg>& barlines,
    int32_t slack_px) {
  for (TaggedRange& range : ranges) {
    if (range.provenance != Provenance::BRACE && range.provenance != Provenance::ORPHAN_INDENT) {
      continue;
    }
    const YBlob blob = {range.y0, range.y1 - 1};
    if (!barline_near_blob(blob, barlines, slack_px)) {
      range.low_confidence = true;
    }
  }

  for (const SliceDebugState::BarlineSeg& barline : barlines) {
    bool matched = false;
    for (const TaggedRange& range : ranges) {
      if (range.provenance != Provenance::BRACE && range.provenance != Provenance::ORPHAN_INDENT) {
        continue;
      }
      const YBlob blob = {range.y0, range.y1 - 1};
      if (barline_near_blob(blob, {barline}, slack_px)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Barline without brace — informational only in debug overlays.
    }
  }
}

struct SlicePageOutput {
  std::vector<TaggedRange> ranges;
  SliceDebugState debug;
  std::vector<TaggedYBlob> brace_blobs;
};

SlicePageOutput slice_page_impl(
    const uint8_t* gray,
    int32_t width,
    int32_t height,
    int32_t stride) {
  SlicePageOutput output;
  if (gray == nullptr || width <= 0 || height <= 0 || stride < width) {
    return output;
  }

  const uint8_t threshold = compute_otsu_threshold(gray, width, height, stride);
  const std::vector<uint8_t> binary = binarize_page(gray, width, height, stride, threshold);
  const std::vector<int32_t> row_sums = compute_row_sums(binary, width, height);
  const std::vector<double> smoothed = smooth_profile(row_sums, height);

  output.debug.metrics = estimate_staff_metrics(binary, width, height);
  const StaffMetrics& metrics = output.debug.metrics;

  const BraceDetection brace_detection = detect_braces(binary, width, height, metrics, true);
  output.debug.left_band_x0 = brace_detection.band.x0;
  output.debug.left_band_x1 = brace_detection.band.x1;
  output.debug.column_centers = brace_detection.column_centers;
  output.debug.brace_rows = brace_detection.brace_rows;
  output.debug.exited_empty_left_band = brace_detection.empty_left_band ? 1 : 0;
  output.debug.exited_no_thin_runs = brace_detection.no_thin_runs ? 1 : 0;

  output.brace_blobs = brace_detection.blobs;

  const std::vector<SliceDebugState::BarlineSeg> barlines =
      find_barlines(binary, width, height, brace_detection.band.x0, brace_detection.band.x1, metrics);
  output.debug.barlines = barlines;

  std::vector<TaggedRange> ranges;
  if (brace_detection.empty_left_band || brace_detection.no_thin_runs || brace_detection.blobs.empty()) {
    if (brace_detection.blobs.empty() && !brace_detection.empty_left_band && !brace_detection.no_thin_runs) {
      output.debug.exited_brace_blobs_empty = 1;
    }
    output.debug.exited_full_page_fallback = 1;
    ranges = find_fallback_tagged_ranges_in_band(
        row_sums,
        smoothed,
        binary,
        width,
        0,
        height,
        metrics,
        &output.debug.cut_lines,
        &brace_detection.brace_rows);
  } else {
    const int32_t overlap_ink_x0 = brace_detection.column_centers.empty()
        ? brace_detection.band.x1
        : brace_detection.column_centers.front() +
              scale_thickness_or_ratio(
                  BRACE_MAX_STROKE_THICKNESS_MULT, BRACE_MAX_STROKE_RATIO, width, metrics) +
              2;
    ranges = tagged_blobs_to_ranges(
        brace_detection.blobs, height, metrics, &binary, width, overlap_ink_x0);
    ranges = filter_nonempty_tagged_strips(ranges, binary, width);
    if (ranges.empty()) {
      output.debug.exited_all_brace_strips_empty = 1;
      output.debug.exited_full_page_fallback = 1;
      ranges = find_fallback_tagged_ranges_in_band(
          row_sums,
          smoothed,
          binary,
          width,
          0,
          height,
          metrics,
          &output.debug.cut_lines,
          &brace_detection.brace_rows);
    } else {
      output.debug.ran_leftover_recovery = 1;
      ranges = recover_leftover_tagged_staffs(
          std::move(ranges),
          row_sums,
          smoothed,
          binary,
          width,
          height,
          metrics,
          &output.debug.cut_lines,
          &brace_detection.brace_rows);
      output.debug.ran_absorb = 1;
      ranges = absorb_non_staff_leftovers_tagged(std::move(ranges), smoothed, height, metrics);
      ranges = filter_nonempty_tagged_strips(ranges, binary, width);
      if (ranges.empty()) {
        output.debug.exited_full_page_fallback = 1;
        ranges = find_fallback_tagged_ranges_in_band(
            row_sums,
            smoothed,
            binary,
            width,
            0,
            height,
            metrics,
            &output.debug.cut_lines,
            &brace_detection.brace_rows);
      } else {
        mark_barline_confidence(ranges, barlines, 12);
      }
    }
  }

  output.ranges = std::move(ranges);
  return output;
}

void free_debug_result_internal(PppSliceDebugResult* result) {
  if (result == nullptr) {
    return;
  }
  std::free(result->ranges);
  std::free(result->column_centers);
  std::free(result->brace_rows);
  std::free(result->brace_blobs);
  std::free(result->cut_lines);
  std::free(result->barline_x);
  std::free(result->barline_y0);
  std::free(result->barline_y1);
  std::free(result);
}

PppSliceDebugResult* make_debug_result(const SlicePageOutput& output) {
  auto* result = static_cast<PppSliceDebugResult*>(std::malloc(sizeof(PppSliceDebugResult)));
  if (result == nullptr) {
    return nullptr;
  }

  std::memset(result, 0, sizeof(PppSliceDebugResult));
  result->count = static_cast<int32_t>(output.ranges.size());
  result->exited_empty_left_band = output.debug.exited_empty_left_band;
  result->exited_no_thin_runs = output.debug.exited_no_thin_runs;
  result->exited_brace_blobs_empty = output.debug.exited_brace_blobs_empty;
  result->exited_all_brace_strips_empty = output.debug.exited_all_brace_strips_empty;
  result->ran_leftover_recovery = output.debug.ran_leftover_recovery;
  result->ran_absorb = output.debug.ran_absorb;
  result->exited_full_page_fallback = output.debug.exited_full_page_fallback;
  result->staff_space = output.debug.metrics.staff_space;
  result->line_thickness = output.debug.metrics.line_thickness;
  result->left_band_x0 = output.debug.left_band_x0;
  result->left_band_x1 = output.debug.left_band_x1;
  result->brace_rows_height = static_cast<int32_t>(output.debug.brace_rows.size());

  if (result->count > 0) {
    result->ranges = static_cast<PppTaggedSliceRange*>(
        std::malloc(sizeof(PppTaggedSliceRange) * output.ranges.size()));
    if (result->ranges == nullptr) {
      std::free(result);
      return nullptr;
    }
    for (size_t i = 0; i < output.ranges.size(); ++i) {
      result->ranges[i].y0 = output.ranges[i].y0;
      result->ranges[i].y1 = output.ranges[i].y1;
      result->ranges[i].provenance = static_cast<int32_t>(output.ranges[i].provenance);
      result->ranges[i].absorbed = output.ranges[i].absorbed ? 1 : 0;
      result->ranges[i].low_confidence = output.ranges[i].low_confidence ? 1 : 0;
    }
  }

  result->column_center_count = static_cast<int32_t>(output.debug.column_centers.size());
  if (result->column_center_count > 0) {
    result->column_centers = static_cast<int32_t*>(std::malloc(sizeof(int32_t) * output.debug.column_centers.size()));
    if (result->column_centers == nullptr) {
      free_debug_result_internal(result);
      return nullptr;
    }
    std::memcpy(result->column_centers, output.debug.column_centers.data(), sizeof(int32_t) * output.debug.column_centers.size());
  }

  if (result->brace_rows_height > 0) {
    result->brace_rows = static_cast<uint8_t*>(std::malloc(output.debug.brace_rows.size()));
    if (result->brace_rows == nullptr) {
      free_debug_result_internal(result);
      return nullptr;
    }
    std::memcpy(result->brace_rows, output.debug.brace_rows.data(), output.debug.brace_rows.size());
  }

  result->brace_blob_count = static_cast<int32_t>(output.brace_blobs.size());
  if (result->brace_blob_count > 0) {
    result->brace_blobs = static_cast<PppBraceBlob*>(std::malloc(sizeof(PppBraceBlob) * output.brace_blobs.size()));
    if (result->brace_blobs == nullptr) {
      free_debug_result_internal(result);
      return nullptr;
    }
    for (size_t i = 0; i < output.brace_blobs.size(); ++i) {
      result->brace_blobs[i].y0 = output.brace_blobs[i].blob.y0;
      result->brace_blobs[i].y1 = output.brace_blobs[i].blob.y1;
      result->brace_blobs[i].provenance = static_cast<int32_t>(output.brace_blobs[i].provenance);
    }
  }

  result->cut_line_count = static_cast<int32_t>(output.debug.cut_lines.size());
  if (result->cut_line_count > 0) {
    result->cut_lines = static_cast<int32_t*>(std::malloc(sizeof(int32_t) * output.debug.cut_lines.size()));
    if (result->cut_lines == nullptr) {
      free_debug_result_internal(result);
      return nullptr;
    }
    std::memcpy(result->cut_lines, output.debug.cut_lines.data(), sizeof(int32_t) * output.debug.cut_lines.size());
  }

  result->barline_count = static_cast<int32_t>(output.debug.barlines.size());
  if (result->barline_count > 0) {
    result->barline_x = static_cast<int32_t*>(std::malloc(sizeof(int32_t) * output.debug.barlines.size()));
    result->barline_y0 = static_cast<int32_t*>(std::malloc(sizeof(int32_t) * output.debug.barlines.size()));
    result->barline_y1 = static_cast<int32_t*>(std::malloc(sizeof(int32_t) * output.debug.barlines.size()));
    if (result->barline_x == nullptr || result->barline_y0 == nullptr || result->barline_y1 == nullptr) {
      free_debug_result_internal(result);
      return nullptr;
    }
    for (size_t i = 0; i < output.debug.barlines.size(); ++i) {
      result->barline_x[i] = output.debug.barlines[i].x;
      result->barline_y0[i] = output.debug.barlines[i].y0;
      result->barline_y1[i] = output.debug.barlines[i].y1;
    }
  }

  return result;
}

std::vector<PppSliceRange> recover_leftover_staffs(
    std::vector<PppSliceRange> kept_ranges,
    const std::vector<int32_t>& row_sums,
    const std::vector<double>& smoothed,
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t height) {
  const std::vector<UncoveredBand> uncovered = complement_uncovered_bands(kept_ranges, height);
  for (const UncoveredBand& band : uncovered) {
    const StaffMetrics metrics;
    if (!band_has_staff_structure(smoothed, band.y0, band.y1, height, metrics)) {
      continue;
    }

    const std::vector<PppSliceRange> promoted = find_fallback_ranges_in_band(
        row_sums, smoothed, binary, width, band.y0, band.y1);
    kept_ranges.insert(kept_ranges.end(), promoted.begin(), promoted.end());
  }

  std::sort(kept_ranges.begin(), kept_ranges.end(), [](const PppSliceRange& a, const PppSliceRange& b) {
    return a.y0 < b.y0;
  });
  return kept_ranges;
}

std::vector<PppSliceRange> absorb_non_staff_leftovers(
    std::vector<PppSliceRange> ranges,
    const std::vector<double>& /*smoothed*/,
    int32_t /*height*/) {
  std::sort(ranges.begin(), ranges.end(), [](const PppSliceRange& a, const PppSliceRange& b) {
    return a.y0 < b.y0;
  });
  return ranges;
}

PppSliceResult* make_result(const std::vector<PppSliceRange>& ranges) {
  auto* result = static_cast<PppSliceResult*>(std::malloc(sizeof(PppSliceResult)));
  if (result == nullptr) {
    return nullptr;
  }

  result->count = static_cast<int32_t>(ranges.size());
  if (result->count == 0) {
    result->ranges = nullptr;
    return result;
  }

  result->ranges = static_cast<PppSliceRange*>(std::malloc(sizeof(PppSliceRange) * ranges.size()));
  if (result->ranges == nullptr) {
    std::free(result);
    return nullptr;
  }

  std::memcpy(result->ranges, ranges.data(), sizeof(PppSliceRange) * ranges.size());
  return result;
}

} // namespace

PppSliceResult* ppp_slice_page(
    const uint8_t* gray,
    int32_t width,
    int32_t height,
    int32_t stride) {
  if (gray == nullptr || width <= 0 || height <= 0 || stride < width) {
    return nullptr;
  }

  const SlicePageOutput output = slice_page_impl(gray, width, height, stride);
  std::vector<PppSliceRange> plain = to_plain_ranges(output.ranges, width);
  const uint8_t threshold = compute_otsu_threshold(gray, width, height, stride);
  const std::vector<uint8_t> binary = binarize_page(gray, width, height, stride, threshold);
  apply_horizontal_crop(plain, binary, width, output.debug.metrics);
  return make_result(plain);
}

PppSliceDebugResult* ppp_slice_page_debug(
    const uint8_t* gray,
    int32_t width,
    int32_t height,
    int32_t stride) {
  if (gray == nullptr || width <= 0 || height <= 0 || stride < width) {
    return nullptr;
  }

  const SlicePageOutput output = slice_page_impl(gray, width, height, stride);
  return make_debug_result(output);
}

void ppp_slice_page_debug_free(PppSliceDebugResult* result) {
  free_debug_result_internal(result);
}

void ppp_slice_result_free(PppSliceResult* result) {
  if (result == nullptr) {
    return;
  }
  if (result->ranges != nullptr) {
    std::free(result->ranges);
  }
  std::free(result);
}

void ppp_sharpen_strip(uint8_t* gray, int32_t width, int32_t height, int32_t stride) {
  if (gray == nullptr || width <= 0 || height <= 0 || stride < width) {
    return;
  }

  constexpr double kAmount = 0.4;
  constexpr int32_t kThreshold = 8;

  const size_t pixel_count = static_cast<size_t>(width) * static_cast<size_t>(height);
  std::vector<uint8_t> blurred(pixel_count);

  for (int32_t y = 0; y < height; ++y) {
    for (int32_t x = 0; x < width; ++x) {
      int32_t sum = 0;
      for (int32_t dy = -1; dy <= 1; ++dy) {
        for (int32_t dx = -1; dx <= 1; ++dx) {
          const int32_t sample_y = std::max(0, std::min(height - 1, y + dy));
          const int32_t sample_x = std::max(0, std::min(width - 1, x + dx));
          sum += gray[static_cast<size_t>(sample_y) * static_cast<size_t>(stride) + sample_x];
        }
      }
      blurred[static_cast<size_t>(y) * static_cast<size_t>(width) + x] =
          static_cast<uint8_t>(sum / 9);
    }
  }

  for (int32_t y = 0; y < height; ++y) {
    for (int32_t x = 0; x < width; ++x) {
      const size_t offset = static_cast<size_t>(y) * static_cast<size_t>(stride) + x;
      const uint8_t src = gray[offset];
      const uint8_t blur =
          blurred[static_cast<size_t>(y) * static_cast<size_t>(width) + x];
      const int32_t delta = static_cast<int32_t>(src) - static_cast<int32_t>(blur);
      if (std::abs(delta) < kThreshold) {
        continue;
      }

      const double sharpened = static_cast<double>(src) + kAmount * static_cast<double>(delta);
      const int32_t clamped = static_cast<int32_t>(std::lround(sharpened));
      gray[offset] = static_cast<uint8_t>(std::max(0, std::min(255, clamped)));
    }
  }
}
