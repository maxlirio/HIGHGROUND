#!/bin/sh
# Build terrain catalogue B in parallel (one Blender per surface).
#   tools/terrain_make_B.sh [name ...]      (no names = all)
cd "$(dirname "$0")/.."
B=${BLENDER:-/opt/homebrew/bin/blender}
NAMES="$*"
[ -z "$NAMES" ] && NAMES=$($B -b -P assets/src/terrain_surfaces_B.py -- --list 2>/dev/null | sed -n 's/^SURFACES //p')
export B LOG=${TMPDIR:-/tmp}/hg_terrain_logs_B; mkdir -p "$LOG"
printf '%s\n' $NAMES | xargs -P ${JOBS:-5} -n 1 sh tools/_terrain_one_B.sh
