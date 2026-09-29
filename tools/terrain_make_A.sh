#!/bin/sh
# Build terrain catalogue A in parallel (one Blender per surface).
#   tools/terrain_make_A.sh [name ...]      (no names = all)
cd "$(dirname "$0")/.."
B=${BLENDER:-/opt/homebrew/bin/blender}
NAMES="$*"
[ -z "$NAMES" ] && NAMES=$($B -b -P assets/src/terrain_surfaces_A.py -- --list 2>/dev/null | sed -n 's/^SURFACES //p')
mkdir -p /tmp/hg_terrain_logs
printf '%s\n' $NAMES | xargs -P ${JOBS:-6} -I{} sh -c "$B -b -P assets/src/terrain_surfaces_A.py -- {} > /tmp/hg_terrain_logs/{}.log 2>&1; grep -hE 'HG_TERRAIN|built|Error|Traceback' /tmp/hg_terrain_logs/{}.log | head -5"
