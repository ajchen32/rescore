#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Grayscale input: 0 = black (ink), 255 = white (paper). Row-major, honor stride.
typedef struct {
  int32_t y0; // inclusive
  int32_t y1; // exclusive
  int32_t x0; // inclusive
  int32_t x1; // exclusive
} PppSliceRange;

typedef struct {
  PppSliceRange* ranges;
  int32_t count;
} PppSliceResult;

// Strip provenance (debug / overlay only; not exposed through ppp_slice_page).
typedef enum {
  PPP_PROVENANCE_BRACE = 0,
  PPP_PROVENANCE_ORPHAN_INDENT = 1,
  PPP_PROVENANCE_LEFTOVER_STAFF = 2,
  PPP_PROVENANCE_FALLBACK_FULL_PAGE = 3,
  PPP_PROVENANCE_LOW_CONFIDENCE = 4,
} PppProvenance;

typedef struct {
  int32_t y0;
  int32_t y1;
  int32_t provenance; // PppProvenance
  int32_t absorbed;   // 0 or 1
  int32_t low_confidence; // 0 or 1 (brace/barline mismatch, ambiguous cut)
} PppTaggedSliceRange;

typedef struct {
  int32_t y0;
  int32_t y1;
  int32_t provenance; // PppProvenance
} PppBraceBlob;

typedef struct {
  PppTaggedSliceRange* ranges;
  int32_t count;

  // Early-exit / pass flags (0 or 1).
  int32_t exited_empty_left_band;
  int32_t exited_no_thin_runs;
  int32_t exited_brace_blobs_empty;
  int32_t exited_all_brace_strips_empty;
  int32_t ran_leftover_recovery;
  int32_t ran_absorb;
  int32_t exited_full_page_fallback;

  // Per-page staff metrics (-1 when unset). A future caller could pass a
  // document-level estimate instead of relying on per-page histogram modes.
  double staff_space;
  double line_thickness;

  // Overlay geometry (may be nullptr / 0 when unused).
  int32_t left_band_x0;
  int32_t left_band_x1;
  int32_t* column_centers;
  int32_t column_center_count;
  uint8_t* brace_rows; // height bytes, 1 = brace row tick
  int32_t brace_rows_height;
  PppBraceBlob* brace_blobs;
  int32_t brace_blob_count;
  int32_t* cut_lines;
  int32_t cut_line_count;
  int32_t* barline_x; // one x per detected barline segment (debug)
  int32_t* barline_y0;
  int32_t* barline_y1;
  int32_t barline_count;
} PppSliceDebugResult;

// Slice a page into horizontal strip ranges. Returns nullptr on allocation failure.
PppSliceResult* ppp_slice_page(
    const uint8_t* gray,
    int32_t width,
    int32_t height,
    int32_t stride);

void ppp_slice_result_free(PppSliceResult* result);

// Debug side-channel: tagged strips + overlay geometry. JNI/Swift do not call this.
PppSliceDebugResult* ppp_slice_page_debug(
    const uint8_t* gray,
    int32_t width,
    int32_t height,
    int32_t stride);

void ppp_slice_page_debug_free(PppSliceDebugResult* result);

// Frozen pre-plan slicer (page-relative constants only). For diff / regression.
PppSliceResult* ppp_slice_page_legacy(
    const uint8_t* gray,
    int32_t width,
    int32_t height,
    int32_t stride);

// Mild unsharp mask on a copied strip buffer (in-place). Does not affect slicing input.
void ppp_sharpen_strip(uint8_t* gray, int32_t width, int32_t height, int32_t stride);

#ifdef __cplusplus
}
#endif
