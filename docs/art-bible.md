# HIGHGROUND — Art Bible

Every asset in this game is made by us, in code. Nothing is downloaded: no textures, no models, no HDRIs, no fonts-as-art.
**Quality floor: Age of Empires IV / AoE II DE realism *at worst*.** Aim above it. Seen from the game camera, the asset must read instantly as what it is. Up close, it must hold up with real materials, wear, and irregularity.

## World
- Period: 13th–14th century northern European frontier (England / Low Countries / Rhineland / Scandinavian borderlands), **low fantasy**. Magic is rare. It is expressed in a few mana sites (ley stones, springs) and a mage tower, never in glowing everything.
- Nothing is pristine. Weathering, soot, moss at the bases, mud splash on the lower 40 cm of walls, sagging ridgelines, uneven courses of stone, repairs in different-coloured timber.
- Nothing is perfectly straight or repeated. Jitter every plank, stone, shingle and post (±2–6 % size, ±1–3° rotation). Never tile a visibly identical module.

## Scale and units
- **1 Blender unit = 1 metre.** Z up. The asset sits on z = 0, centred on the origin (`_lib.finish` does this).
- Reference sizes: a man is 1.72 m, a door 1.9–2.1 m, a single storey 2.6–3.0 m, a cottage 5×8 m, a town hall/keep 14–22 m tall, a curtain wall 6–9 m high and 2–3 m thick, an oak 16–24 m tall, a pine 18–30 m.
- Orientation: the building front / wall outer face faces **−Y**.

## Materials (procedural node trees, baked by `_lib.finish`)
- Build every material from procedural nodes: noise, voronoi, wave, musgrave-style FBM, and colour ramps, plus geometry-driven variation (object random, position, pointiness/AO for grime in crevices).
- Every material needs at least **3 frequency layers**: large blotch (colour drift), mid (per-stone/plank variation), and fine (grain/pitting). It also needs a bump/normal chain.
- Palette anchors (sRGB), to be varied, not copied:
  - limestone `#b8ad96`, granite `#7f7d78`, sandstone `#b58f63`
  - oak timber `#6b5236`, weathered timber `#8c8374`, fresh-cut wood `#c9a877`
  - thatch `#a88d55` (aged `#7c6a45`), clay tile `#9a5a3c`, slate `#4b4f55`
  - daub/lime plaster `#d8ccb3`, iron `#3b3a38`, soil `#5a4632`, grass `#5d6b35`
  - team colours: **blue `#2f5fa8`, red `#a8322f`** (banners, shields, pennants only)
- **No pure black and no pure white.** Albedo stays within roughly sRGB 30–240.
- Metals are dark and rough. Nothing shiny except water and wet mud.

## Geometry
- Model real construction, not boxes with textures. Timber frames have real posts, braces and sill beams. Stone walls have individual blocks (or a displaced block pattern with real depth) and crenellations with merlons. Roofs have real overhang, fascia and ridge, and thatch has thickness.
- Bevel everything (0.5–3 cm). Silhouettes matter most from the eagle camera: roof shapes, chimneys, towers, and tree crowns carry recognition.
- Poly budget for LOD0 (triangles): props ≤ 3k, trees ≤ 12k (+ leaf cards), houses ≤ 12k, large buildings ≤ 40k, wall segments ≤ 6k. `finish()` makes LOD1/LOD2 by decimation.
- Texture size (`finish(tex=)`): props 512–1024, houses/trees 1024–2048, keep/gatehouse 2048.
- Foliage: leaf clusters are alpha-cutout cards whose texture you also generate procedurally (render or bake a leaf cluster to an image with alpha). Mark those card objects `obj["hg_nobake"] = True` and give them `L.make_image_material()`. Trunks and branches are real geometry (a skin modifier or curves with taper), baked normally.

## Building states
Every building ships as separate GLBs: `<name>.glb` (complete), `<name>_build1.glb` (foundation + stakes/lines), `<name>_build2.glb` (frame/half-height with scaffolding), and `<name>_ruin.glb` (burned/damaged: charred timbers, collapsed roof section, rubble). Make these from one script with a `STATE` switch.

## Lighting (the booth and the game use the same rig)
Warm sun `(1.0, 0.95, 0.86)` at 42° elevation from the south-west, a soft blue sky fill, and AgX view transform. Do not tune your materials to look good under any other light.

## Review: mandatory for every asset
1. `blender -b -P assets/src/<name>.py`: it must print `HG_EXPORT …`.
2. `blender -b -P tools/booth.py -- assets/glb/<name>.glb` renders `assets/booth/<name>_{34,close,game}.png`.
3. **Look at all three renders yourself** (Read the PNGs). Critique them honestly against the AoE bar: flat colour? tiling? primitive-looking? wrong scale? floating? Then iterate. Expect 3–6 iterations; the first result is never good enough.
4. Report the final triangle count, your self-critique, and the booth PNG paths.

## Terrain surfaces (separate pipeline, see terrain-materials)
The ground is a three.js splat-blended terrain. Surfaces are seamless tileable texture sets (albedo, normal, roughness, height) baked in Blender from procedural materials at a stated real-world tile size. There are **many** surface types. Each maps to simulation properties in `js/sim/terrain-types.js`: movement per arm, footing, fatigue, cover, concealment, dust, charge viability, and dig-in ability.
