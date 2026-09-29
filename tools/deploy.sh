#!/bin/bash
# Publish the playable build to GitHub Pages (maxlirio.github.io/HIGHGROUND).
# Ships only what the game loads: code, GLB models, map data, terrain albedo/normal at the 512 px the
# splat actually uses. Built fresh into a temp dir and force-pushed to the gh-pages branch.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=$(mktemp -d)/site
mkdir -p "$OUT/assets/terrain" "$OUT/maps/vale"
rsync -a index.html css js "$OUT/"
rsync -a --include='*.glb' --exclude='*' assets/glb/ "$OUT/assets/glb/"
cp assets/footprints.json "$OUT/assets/"
[ -f assets/castle-kit.json ] && cp assets/castle-kit.json "$OUT/assets/"
[ -d assets/tex/castle ] && mkdir -p "$OUT/assets/tex" && rsync -a assets/tex/castle/ "$OUT/assets/tex/castle/"   # (the castle kit's shared texture library, fetched only when a castle exists)
[ -d assets/units ] && rsync -a --exclude "*.blend*" assets/units/ "$OUT/assets/units/"
[ -d assets/audio ] && rsync -a assets/audio/ "$OUT/assets/audio/"
for f in meta.json height.f32 surface.u8 water.f32 canopy.u8 vegetation.json objects.json settlements.json; do
  [ -f "maps/vale/$f" ] && cp "maps/vale/$f" "$OUT/maps/vale/"
done
for j in assets/terrain/*.json; do
  n=$(basename "$j" .json); cp "$j" "$OUT/assets/terrain/"
  for k in albedo normal; do
    [ -f "assets/terrain/${n}_$k.png" ] && sips -Z 512 "assets/terrain/${n}_$k.png" --out "$OUT/assets/terrain/${n}_$k.png" >/dev/null
  done
done
touch "$OUT/.nojekyll"
du -sh "$OUT"
cd "$OUT" && git init -q -b gh-pages && git add -A && git commit -qm "HIGHGROUND playable build $(date '+%Y-%m-%d %H:%M')" \
  && git remote add origin https://github.com/maxlirio/HIGHGROUND.git && git push -f origin gh-pages 2>&1 | tail -2
echo "==> https://maxlirio.github.io/HIGHGROUND/"
