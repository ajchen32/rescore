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
    int32_t band_height) {
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
    cut_lines.push_back(find_minimum_between(smoothed, gap_start, gap_end));
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
      ranges.push_back({y0, y1, 0, width});
    }
  }

  if (ranges.empty()) {
    ranges.push_back({0, height, 0, width});
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
    filtered.push_back({0, height, 0, width});
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

struct YBlob {
  int32_t y0;
  int32_t y1;
};

struct LeftBandBounds {
  int32_t x0;
  int32_t x1;
};

LeftBandBounds compute_left_band_bounds(int32_t width) {
  const int32_t x0 =
      std::min(width, std::max(0, static_cast<int32_t>(std::ceil(width * LEFT_INSET_RATIO))));
  const int32_t x1 =
      std::min(width, std::max(x0 + 1, static_cast<int32_t>(std::ceil(width * LEFT_BAND_RATIO))));
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
    std::vector<YBlob> blobs) {
  const int32_t split_height =
      std::max(1, static_cast<int32_t>(std::ceil(height * BRACE_SPLIT_MAX_RATIO)));

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

std::vector<YBlob> find_left_band_brace_blobs(
    const std::vector<uint8_t>& binary,
    int32_t width,
    int32_t height) {
  const LeftBandBounds band = compute_left_band_bounds(width);
  if (band.x1 <= band.x0) {
    return {};
  }

  const int32_t max_stroke_px =
      std::max(1, static_cast<int32_t>(std::ceil(width * BRACE_MAX_STROKE_RATIO)));
  const int32_t column_slack = compute_brace_column_slack(width, max_stroke_px);
  const int32_t gap_fill_px = std::max(1, BRACE_ROW_GAP_FILL_PX);
  const int32_t min_height =
      std::max(1, static_cast<int32_t>(std::ceil(height * BRACE_MIN_HEIGHT_RATIO)));
  const int32_t max_height =
      std::max(min_height + 1, static_cast<int32_t>(std::ceil(height * BRACE_MAX_HEIGHT_RATIO)));

  std::vector<int32_t> thin_run_x_samples;
  for (int32_t y = 0; y < height; ++y) {
    const FirstInkRun run = first_ink_run_in_band(binary, width, band.x0, band.x1, y);
    if (is_thin_brace_run(run, max_stroke_px)) {
      thin_run_x_samples.push_back(run.x_start);
    }
  }

  const BraceColumnClusters column_clusters =
      cluster_brace_columns(thin_run_x_samples, column_slack, min_height);
  std::vector<int32_t> column_centers = column_clusters.kept_centers;
  if (column_centers.empty()) {
    const int32_t page_median = median_int32(thin_run_x_samples);
    if (page_median >= 0) {
      column_centers.push_back(page_median);
    }
  }

  const std::vector<uint8_t> brace_rows = build_brace_row_mask_for_columns(
      binary, width, height, band.x0, band.x1, max_stroke_px, column_centers, column_slack);
  std::vector<YBlob> blobs = group_brace_rows(brace_rows, height, gap_fill_px);
  blobs = split_tall_brace_blobs(binary, width, band.x0, band.x1, height, std::move(blobs));

  std::vector<YBlob> filtered;
  for (const YBlob& blob : blobs) {
    const int32_t blob_height = blob.y1 - blob.y0 + 1;
    if (blob_height >= min_height && blob_height <= max_height) {
      filtered.push_back(blob);
    }
  }

  for (int32_t rejected_center : column_clusters.rejected_centers) {
    const std::vector<uint8_t> orphan_rows = build_brace_row_mask_for_columns(
        binary,
        width,
        height,
        band.x0,
        band.x1,
        max_stroke_px,
        {rejected_center},
        column_slack);
    std::vector<YBlob> orphan_blobs = group_brace_rows(orphan_rows, height, gap_fill_px);
    for (const YBlob& blob : orphan_blobs) {
      const int32_t blob_height = blob.y1 - blob.y0 + 1;
      if (blob_height < min_height || blob_height > max_height) {
        continue;
      }
      if (overlaps_any_blob(blob, filtered)) {
        continue;
      }
      filtered.push_back(blob);
    }
  }

  std::sort(filtered.begin(), filtered.end(), [](const YBlob& a, const YBlob& b) {
    return a.y0 < b.y0;
  });

  return filtered;
}

std::vector<PppSliceRange> brace_blobs_to_ranges(
    const std::vector<YBlob>& blobs,
    int32_t height,
    int32_t width) {
  const int32_t pad = std::max(1, static_cast<int32_t>(std::ceil(height * BRACE_PAD_RATIO)));
  std::vector<PppSliceRange> ranges;
  for (const YBlob& blob : blobs) {
    const int32_t y0 = std::max(0, blob.y0 - pad);
    const int32_t y1 = std::min(height, blob.y1 + 1 + pad);
    if (y1 > y0) {
      ranges.push_back({y0, y1, 0, width});
    }
  }

  std::sort(ranges.begin(), ranges.end(), [](const PppSliceRange& a, const PppSliceRange& b) {
    return a.y0 < b.y0;
  });

  for (size_t i = 0; i + 1 < ranges.size(); ++i) {
    const int32_t mid = (ranges[i].y1 + ranges[i + 1].y0) / 2;
    ranges[i].y1 = std::min(ranges[i].y1, mid);
    ranges[i + 1].y0 = std::max(ranges[i + 1].y0, mid);
  }

  return ranges;
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
      ranges.push_back({y0, y1, 0, width});
    }
  }

  if (ranges.empty()) {
    ranges.push_back({band_y0, band_y1, 0, width});
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
    ranges.push_back({band_y0, band_y1, 0, width});
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
    int32_t page_height) {
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

  const int32_t staff_collapse_px =
      std::max(1, static_cast<int32_t>(std::ceil(band_height * STAFF_COLLAPSE_RATIO)));
  const std::vector<PeakCluster> staff_clusters = merge_peaks_with_max_gap(peaks, staff_collapse_px);
  if (staff_clusters.empty()) {
    return false;
  }

  const int32_t min_dense_staff_px =
      std::max(1, static_cast<int32_t>(std::ceil(band_height * STAFF_COLLAPSE_RATIO * 4.0)));
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
    return false;
  }
  if (dense_staff_cluster_count == 1 && max_cluster_peak_count > 10) {
    return false;
  }

  const int32_t min_system_span = std::max(
      static_cast<int32_t>(std::ceil(page_height * 0.08)),
      static_cast<int32_t>(std::ceil(band_height * 0.15)));
  const std::vector<PeakCluster> systems = cluster_peaks_two_stage(peaks, band_height);
  for (const PeakCluster& system : systems) {
    if (system.end_y - system.start_y >= min_system_span) {
      return true;
    }
  }

  return false;
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
    if (!band_has_staff_structure(smoothed, band.y0, band.y1, height)) {
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
    const std::vector<double>& smoothed,
    int32_t height) {
  if (ranges.empty()) {
    return ranges;
  }

  std::sort(ranges.begin(), ranges.end(), [](const PppSliceRange& a, const PppSliceRange& b) {
    return a.y0 < b.y0;
  });

  const std::vector<UncoveredBand> uncovered = complement_uncovered_bands(ranges, height);
  for (const UncoveredBand& band : uncovered) {
    if (band_has_staff_structure(smoothed, band.y0, band.y1, height)) {
      continue;
    }

    if (ranges.empty()) {
      break;
    }

    if (band.y0 == 0) {
      ranges[0].y0 = 0;
      continue;
    }

    if (band.y1 == height) {
      ranges.back().y1 = height;
      continue;
    }

    for (size_t i = 0; i + 1 < ranges.size(); ++i) {
      if (ranges[i].y1 <= band.y0 && ranges[i + 1].y0 >= band.y1) {
        ranges[i].y1 = ranges[i + 1].y0;
        break;
      }
    }
  }

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

PppSliceResult* ppp_slice_page_legacy(
    const uint8_t* gray,
    int32_t width,
    int32_t height,
    int32_t stride) {
  if (gray == nullptr || width <= 0 || height <= 0 || stride < width) {
    return nullptr;
  }

  const uint8_t threshold = compute_otsu_threshold(gray, width, height, stride);
  const std::vector<uint8_t> binary = binarize_page(gray, width, height, stride, threshold);
  const std::vector<int32_t> row_sums = compute_row_sums(binary, width, height);
  const std::vector<double> smoothed = smooth_profile(row_sums, height);

  const std::vector<PppSliceRange> brace_ranges = find_brace_ranges(binary, width, height);
  std::vector<PppSliceRange> ranges;
  if (brace_ranges.empty()) {
    ranges = find_fallback_ranges(row_sums, smoothed, binary, width, height);
  } else {
    ranges = filter_nonempty_strips(brace_ranges, binary, width);
    if (ranges.empty()) {
      ranges = find_fallback_ranges(row_sums, smoothed, binary, width, height);
    } else {
      ranges = recover_leftover_staffs(ranges, row_sums, smoothed, binary, width, height);
      ranges = absorb_non_staff_leftovers(std::move(ranges), smoothed, height);
      ranges = filter_nonempty_strips(ranges, binary, width);
      if (ranges.empty()) {
        ranges = find_fallback_ranges(row_sums, smoothed, binary, width, height);
      }
    }
  }

  return make_result(ranges);
}

