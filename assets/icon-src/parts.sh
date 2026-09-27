# Shared SVG fragments on a 1080 canvas (108dp adaptive icon grid; safe circle r=330 at 540,540).
INK="#232220"; PAPER="#F2F1EE"; CARD="#FFFFFF"; AMBER="#B8863B"; GHOST="#D3CFC6"; SLOT="#E4E2DD"
staff() { # $1=y0 $2=x0 $3=x1 $4=color $5=width
  for i in 0 1 2 3 4; do y=$(( $1 + i*19 )); echo "<line x1=\"$2\" y1=\"$y\" x2=\"$3\" y2=\"$y\" stroke=\"$4\" stroke-width=\"$5\" stroke-linecap=\"round\"/>"; done
}
brace() { # filled brace, top arm mirrored about y=528; $1=color $2=dx $3=dy
  local arm='M368 410 C328 416 346 498 306 528 C384 502 348 430 368 410 Z'
  echo "<g transform=\"translate($2 $3)\" fill=\"$1\"><path d=\"$arm\"/><path d=\"$arm\" transform=\"translate(0 1056) scale(1 -1)\"/></g>"
}
system() { # $1=ink color $2=dx $3=dy
  echo "<g transform=\"translate($2 $3)\">"
  echo "<line x1=\"372\" y1=\"418\" x2=\"372\" y2=\"638\" stroke=\"$1\" stroke-width=\"9\" stroke-linecap=\"round\"/>"
  staff 420 372 790 "$1" 9; staff 562 372 790 "$1" 9
  echo "</g>"; brace "$1" $2 $3
}
background() {
  echo "<rect width=\"1080\" height=\"1080\" fill=\"$PAPER\"/>"
  # rest of the page: last staff of the previous system, first staff of the next
  echo "<line x1=\"250\" y1=\"250\" x2=\"250\" y2=\"326\" stroke=\"$GHOST\" stroke-width=\"8\"/>"; staff 250 250 830 "$GHOST" 8
  echo "<line x1=\"250\" y1=\"734\" x2=\"250\" y2=\"810\" stroke=\"$GHOST\" stroke-width=\"8\"/>"; staff 734 250 830 "$GHOST" 8
  # the slot the strip was lifted out of
  echo "<rect x=\"289\" y=\"405\" width=\"502\" height=\"270\" rx=\"26\" fill=\"$SLOT\"/>"
}
LIFT='transform="translate(562 506) scale(0.93) translate(-552 -528)"'
foreground() {
  echo "<defs><filter id=\"sh\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"160%\"><feGaussianBlur stdDeviation=\"14\"/></filter></defs>"
  echo "<g $LIFT>"
  echo "<rect x=\"290\" y=\"402\" width=\"540\" height=\"290\" rx=\"28\" fill=\"#000\" opacity=\"0.18\" filter=\"url(#sh)\"/>"
  echo "<rect x=\"282\" y=\"383\" width=\"540\" height=\"290\" rx=\"28\" fill=\"$CARD\" stroke=\"$AMBER\" stroke-width=\"10\"/>"
  system "$INK" 0 0
  echo "</g>"
}
monochrome() {
  echo "<g $LIFT>"
  echo "<rect x=\"282\" y=\"383\" width=\"540\" height=\"290\" rx=\"28\" fill=\"none\" stroke=\"#000\" stroke-width=\"14\"/>"
  system "#000" 0 0
  echo "</g>"
}
svg() { echo "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"$1\" width=\"1024\" height=\"1024\">"; shift; "$@"; echo "</svg>"; }
