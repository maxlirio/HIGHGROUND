#!/bin/bash
# Machine-wide limiter for heavy jobs (Blender bakes, battle sims, battle-mc, headless Chrome).
# The owner's laptop (10 cores) froze once when agents stacked ~18 processes. Every agent runs heavy work through
# this: at most HEAVY_SLOTS (default 3) heavy jobs at once across ALL agents, each niced. It waits for a free slot.
#   tools/heavy.sh <command...>          e.g. tools/heavy.sh node tools/battle-mc.mjs line
# Env for the wrapped command: WORKERS=2 (battle-mc worker pool). Blender: pass -t 2 yourself.
SLOTS=${HEAVY_SLOTS:-3}
DIR=/tmp/highground-heavy
mkdir -p "$DIR"
while true; do
  for i in $(seq 1 "$SLOTS"); do
    if mkdir "$DIR/slot$i" 2>/dev/null; then
      echo $$ > "$DIR/slot$i/pid"
      trap 'rm -rf "$DIR/slot'"$i"'"' EXIT INT TERM
      WORKERS=${WORKERS:-2} nice -n 10 "$@"
      exit $?
    fi
    # reclaim a slot whose owner died
    p=$(cat "$DIR/slot$i/pid" 2>/dev/null); if [ -n "$p" ] && ! kill -0 "$p" 2>/dev/null; then rm -rf "$DIR/slot$i"; fi
  done
  sleep 5
done
