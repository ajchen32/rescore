# Phase 3 takeaways (gated — no deletions yet)

Overlay runs from `slicer_debug` on rasterized `/home/aaron/Piano` pages.

## Layers that fire often

- **BRACE** — primary path on most piano pages with left-margin braces.
- **ran_leftover_recovery** — fires when brace strips leave uncovered bands with staff structure (e.g. middle unbraced system).
- **ran_absorb** — fires on most brace pages to swallow title/header gutters.

## Layers that fire sometimes

- **ORPHAN_INDENT** — minority x-cluster revival; visible on mixed-indent synthetic tests, occasional on real scores with indented first systems.
- **LEFTOVER_STAFF** — promoted bands from `recover_leftover_staffs`.
- **Barline column lock** — used when brace column clustering is weak (`kept_centers` empty).

## Layers that fire rarely / not yet justified to remove

- **exited_no_thin_runs** — rare on real piano PDFs; keep.
- **exited_full_page_fallback** — blank/text pages and non-piano layouts; keep.
- **ORPHAN_INDENT** — still needed where barline lock alone does not recover indented braces; do **not** remove until barline-per-system overlays show redundant cases.

## Deferred removals (Phase 3)

No pipeline stages removed in this pass. `ppp_slice_page_legacy` remains for diffing. Revisit after more overlay samples.
