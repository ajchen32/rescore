#!/usr/bin/env bash
# Regenerates the app icons in ../ from these SVG sources: bash build.sh
set -euo pipefail
cd "$(dirname "$0")"
. ./parts.sh
full() { background; foreground; }
svg "0 0 1080 1080" background > background.svg
svg "0 0 1080 1080" foreground > foreground.svg
svg "0 0 1080 1080" monochrome > monochrome.svg
# Full-bleed composite; the launcher / store applies its own mask.
svg "0 0 1080 1080" full > icon.svg
# Splash and favicon: zoomed to the lifted strip so it reads at small sizes.
svg "230 226 660 660" full > icon-tight.svg
r() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; }
r background.svg 1024 ../android-icon-background.png
r foreground.svg 1024 ../android-icon-foreground.png
r monochrome.svg 1024 ../android-icon-monochrome.png
r icon.svg 1024 ../icon.png
r icon-tight.svg 48 ../favicon.png
svg "240 300 620 413" foreground | sed 's/height="1024"/height="683"/' > splash.svg
rsvg-convert -w 1024 splash.svg -o ../splash-icon.png
