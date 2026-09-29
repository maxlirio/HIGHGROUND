#!/bin/sh
# helper for terrain_make_B.sh: build one surface, print its summary / traceback
"$B" -b -P assets/src/terrain_surfaces_B.py -- "$1" > "$LOG/$1.log" 2>&1
grep -hE 'HG_TERRAIN|built' "$LOG/$1.log" | head -3
grep -A14 Traceback "$LOG/$1.log" | tail -10
