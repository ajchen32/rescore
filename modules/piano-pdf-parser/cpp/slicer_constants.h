#pragma once

// Projection-profile slicing constants for Rescore.
//
// Input grayscale convention: 0 = black (ink), 255 = white (paper).
// After Otsu binarization: ink = 1, paper = 0.
//
// Primary slicer: thin vertical strokes in the left margin (one brace = one system strip).
// Fallback slicer: peak/gap clustering when brace count == 0 (non-piano pages).

// --- Brace detection (left band) ---

// Skip this fraction of page width from the left edge (page-edge noise).
static constexpr double LEFT_INSET_RATIO = 0.008;

// Search braces in x ∈ [LEFT_INSET, LEFT_BAND_RATIO * width).
static constexpr double LEFT_BAND_RATIO = 0.20;

// Minimum brace vertical span (reject specks and barline stubs).
static constexpr double BRACE_MIN_HEIGHT_RATIO = 0.08;

// Maximum brace vertical span (reject left border / full-page rules).
static constexpr double BRACE_MAX_HEIGHT_RATIO = 0.40;

// Vertical padding added above/below each brace span (dynamics, lyrics).
static constexpr double BRACE_PAD_RATIO = 0.03;

// Max contiguous ink run in a row to count as a thin brace stroke (not a staff line).
static constexpr double BRACE_MAX_STROKE_RATIO = 0.015;

// Reconnect broken Otsu holes inside one brace; inter-system paper is longer than this.
static constexpr int32_t BRACE_ROW_GAP_FILL_PX = 3;

// Bridge staff-line holes in a real brace (~1–2 spaces); still shorter than inter-system gaps.
static constexpr double BRACE_ROW_GAP_FILL_STAFF_MULT = 1.0;

// Horizontal slack around the detected brace column when matching thin runs.
static constexpr double BRACE_COLUMN_SLACK_RATIO = 0.01;

// Split blobs taller than this at the weakest left-band row (merged systems).
static constexpr double BRACE_SPLIT_MAX_RATIO = 0.65;

// --- Gap / peak fallback (when brace count == 0) ---

// Floor for treating a row as empty-ish (ignore specks).
static constexpr double GAP_ROW_THRESHOLD_RATIO = 0.02;

// Fallback staff-to-staff merge distance when gap pairing is ambiguous.
static constexpr double MIN_GAP_HEIGHT_RATIO = 0.032;

// Stage 1: merge peaks within this fraction of page height into one 5-line staff.
static constexpr double STAFF_COLLAPSE_RATIO = 0.022;

// Stage 2: staff gaps below this are always merged (treble + bass interior).
static constexpr double GRAND_STAFF_INTERIOR_FLOOR_RATIO = 0.035;

// Stage 2: staff gaps above this are never merged (inter-system breaks).
static constexpr double GAP_PAIR_CEILING_RATIO = 0.08;

// Strips shorter than this fraction of page height are merged into the neighbor above.
static constexpr double MIN_STRIP_HEIGHT_RATIO = 0.03;

// Drop strips whose ink fraction is below this threshold (nearly empty margins).
static constexpr double MIN_INK_RATIO = 0.001;

// Box-filter radius for smoothing the row-sum profile (~1.2% of page height).
static constexpr double PROFILE_SMOOTH_RATIO = 0.012;

// A local maximum must exceed this fraction of the profile median to count as a peak.
static constexpr double PEAK_PROMINENCE_RATIO = 0.35;

// Post-pass: ink span below this fraction of median is a half-staff (treble or bass only).
static constexpr double STRIP_HALF_RATIO = 0.65;

// Post-pass: ink span at or above this fraction of median is a double-system strip.
static constexpr double STRIP_DOUBLE_RATIO = 1.55;

// Post-pass: two consecutive halves may merge if their combined ink span is below this.
static constexpr double STRIP_HALF_PAIR_MAX_RATIO = 1.45;

// Post-pass: when splitting doubles, search for valleys in the middle fraction of ink span.
static constexpr double DOUBLE_SPLIT_EDGE_RATIO = 0.25;

// Post-pass: valley must drop below this fraction of the strip peak to count as a cut.
static constexpr double DOUBLE_SPLIT_VALLEY_RATIO = 0.45;

// --- Staff-space multiples (used when per-page staff_space / line_thickness are estimated) ---

// Max brace stroke width ≈ 1.5× staff line thickness.
static constexpr double BRACE_MAX_STROKE_THICKNESS_MULT = 1.5;

// Brace vertical span bounds in staff-space units (~one grand staff).
static constexpr double BRACE_MIN_HEIGHT_STAFF_MULT = 14.0;
static constexpr double BRACE_MAX_HEIGHT_STAFF_MULT = 40.0;

// Minimum air above/below a brace when nothing sticks out, in staff spaces.
static constexpr double BRACE_PAD_STAFF_MULT = 3.0;

// Ledger lines, slurs, and 8va marks can sit this far outside the brace.
// Growth stops at a blank gutter shorter than this, so the next system stays put.
static constexpr double SYSTEM_INK_EXTENT_STAFF_MULT = 6.0;

// Holes this long still belong to the same system (ledger lines, a slur above the staff).
static constexpr double SYSTEM_INK_ATTACH_QUIET_STAFF_MULT = 2.0;

// A gap row is paper when ink to the right of the brace is at or below
// (line thickness - 1). A real stem is about one line thick, so it still counts.
static constexpr double OVERLAP_QUIET_INK_RATIO = 0.0015;

// Paper run this many staff-spaces long separates two systems.
// Shorter holes (a broken slur, a staff-line gap) stay with the ink.
static constexpr double OVERLAP_MIN_QUIET_RUN_STAFF_MULT = 0.45;

// Blank paper kept past the last ink when the systems do not touch.
static constexpr double OVERLAP_PAPER_MARGIN_STAFF_MULT = 0.5;

// Horizontal crop: keep this much paper past the ink on each side of a strip.
static constexpr double STRIP_SIDE_PAD_STAFF_MULT = 2.0;

// Drop an isolated page-edge mark only when the paper gap is at least this wide.
static constexpr double STRIP_EDGE_MARK_GAP_STAFF_MULT = 4.0;

// Marks wider or taller than this are treated as music, not page numbers.
static constexpr double STRIP_EDGE_MARK_MAX_WIDTH_STAFF_MULT = 3.0;
static constexpr double STRIP_EDGE_MARK_MAX_HEIGHT_STAFF_MULT = 2.0;

// When ink bridges the gap, share this many staff spaces on each side of the
// quietest row. The rest of each system stays on its own strip.
static constexpr double OVERLAP_HALF_SPAN_STAFF_MULT = 2.0;

// After a strip edge is placed, look this far further out for the row that the
// fewest ink strokes cross, so edges run through paper instead of "Ped." marks,
// low beams or fingerings. Edges only ever move outward.
static constexpr double EDGE_SNAP_STAFF_MULT = 1.5;
static constexpr double EDGE_SNAP_RATIO = 0.009;
// A row no stroke crosses is worth reaching further for: far enough to clear a
// whole "Ped." glyph or a fingering stack below the staff.
static constexpr double EDGE_SNAP_CLEAR_STAFF_MULT = 4.0;
static constexpr double EDGE_SNAP_CLEAR_RATIO = 0.024;

// A short line of marks (pedal, dynamics, a tempo word) separated from a system
// by a gutter belongs to the nearer system when it is within this gap of that
// system's ink and no taller than the line height below.
static constexpr double MARK_LINE_MAX_GAP_STAFF_MULT = 4.0;
static constexpr double MARK_LINE_MAX_HEIGHT_STAFF_MULT = 4.0;

// An extra brace column found by histogram is only trusted when rows beside it
// look like staff lines: ink across at least this share of the width to its right.
static constexpr double ORPHAN_STAFF_LINE_INK_RATIO = 0.25;

// Split brace blobs taller than this many staff-space units.
static constexpr double BRACE_SPLIT_MAX_STAFF_MULT = 50.0;

// Left search band width in staff-space units (from page left inset).
static constexpr double LEFT_BAND_STAFF_MULT = 14.0;

// Minimum strip height and band_has_staff_structure spans in staff-space units.
static constexpr double MIN_STRIP_HEIGHT_STAFF_MULT = 4.0;
static constexpr double MIN_SYSTEM_SPAN_STAFF_MULT = 12.0;
static constexpr double BAND_MIN_SYSTEM_SPAN_STAFF_MULT = 8.0;

// Barline: minimum vertical span and max horizontal drift (staff-space units).
static constexpr double BARLINE_MIN_HEIGHT_STAFF_MULT = 6.0;
static constexpr double BARLINE_BRIDGE_GAP_STAFF_MULT = 1.0;
static constexpr int32_t BARLINE_MAX_X_DRIFT_PX = 2;
