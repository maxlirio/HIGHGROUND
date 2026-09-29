# Tree recipe (for pine, birch, dead tree, orchard, bushes…)

Reference implementation: `assets/src/oak.py`, built on the shared toolkit `assets/src/_trees.py`.
Read `docs/art-bible.md` first. Everything is procedural: no downloaded images or models.

## Pipeline (all functions are in `_trees.py`)
1. **Seed**: `T.get_seed(default)` reads a numeric argv after `--` or `HG_SEED`. Map named variants to seeds in the script. Pick seeds whose crown is balanced; the oak dropped seed 11 because it grew one-sided.
2. **Scaffold**: `sk = T.Skel()`, then add a root node and build the trunk and main limbs with `T.polyline(sk, start, dir, length, step, rng, kink_every, kink_deg, up_bias, keep_heading)`. Kinks give oak/dead-tree crookedness. Use `kink_deg≈3` for a straight pine or birch. `keep_heading` stops a limb from doubling back toward the trunk. Pass `growable=False` for the clear bole so colonization doesn't sprout from it.
3. **Crown volume**: `T.lobe_attractors(lobes, count, rng, shell, zmin)`, where `lobes = [(centre, (rx, ry, rz)), …]`. The crown silhouette is decided by the lobe layout:
   - oak: one lobe per limb end, plus 1–2 smaller clumps along each limb, all flattened (`rz < rx`). This gives lumps with sky gaps.
   - pine: a stack of shrinking discs up the stem (a cone); birch: a narrow ellipsoid with a weeping tropism; bush: 3–6 small lobes near the ground.
   - `shell≈0.5` keeps leaves on the outside and the interior hollow, as on real trees.
4. **Grow**: `T.colonize(sk, att, infl, kill, step, iters, tropism, jitter)` does space colonization with numpy brute force (about 2k nodes in ~10 s). A negative-z `tropism` gives drooping twigs; a positive one gives upswept twigs.
5. **Radii**: `T.pipe_radii(sk, r_tip, exp, base_radius)`. Lower `exp` (1.8–1.9) gives heavier limbs (oak); 2.3–2.5 gives a thin-limbed look (birch).
6. **Bark mesh**: `T.build_tubes(sk, rad, min_r, gnarl, flare=f(z, θ), seed)`. It decomposes the skeleton into chains (the thickest child continues each chain) and skins them with parallel-transport rings. Side counts come from `T.sides_for(r)`, and trunk chain 0 gets `flare`. Loop through `min_r` values until the tris fit the 12k budget. Branches thinner than `min_r` are left out on purpose, because the leaf cards imply them. The mesh carries UVs `bk_a` (r cosθ, r sinθ) and `bk_b` (arc length, radius), which give a seamless tube space for the bark shader. Vertices are clamped to z ≥ 0 because `finish()` grounds by bbox. For logs and stumps, pass `tip=False, caps=True` to get fan-capped ends. Cap faces get `material_index 1` (give the object `[bark, cutwood]` materials), and `cap_z(x, y)` reshapes the end cap, for example into an axe notch.
7. **Bark material**: `T.bark_material(name, plate, plate2, crack, lichen, moss, plate_scale, along, crack_width, moss_amount)`. It uses stretched voronoi plates plus distorted cracks, with smooth bark below `smooth_below_r`, lichen, and north/low/limb-top moss. Birch: a pale plate colour, `along≈3` (horizontal lenticels instead of vertical cracks), thin cracks. Pine: a red-brown plate with a large `plate_scale`. Dead tree: `moss_amount` high, lichen high, greyed plate.
8. **Leaf atlas**: `T.leaf_atlas(png, outline_fn, grid=2, leaves, greens, cell_tints)` models lobed leaves on twigs, renders them top-down in ortho under a uniform white sky (which gives albedo × AO), bleeds RGB into the transparent texels, and saves to `assets/tex/<name>_leaves.png`. Write your own `outline_fn(rng) -> [(half_width, t)]`: birch is a toothed ovate, and for pine, emit needle fans (thin 2-point outlines). Cell convention: 0 and 1 are mid tones, 2 is sunlit (yellower), 3 is shade.
9. **Cards**: `T.scatter_cards(T.tip_points(sk, rad, r_leaf), image, centre, extents, rng, size, cell_pick, up_bias)` makes one quad per twig tip. Each card comes out with:
   - `hg_nobake` set and `L.make_image_material` (alpha MASK).
   - Mostly random geometric facing (`facing_random`), which avoids edge-on slivers on the silhouette, while the *shading* normal stays crown-outward.
   - **Two offset one-sided layers** with backface culling, so every visible face is a front face. Engines flip normals on back faces, which otherwise turns half the crown black.
   - Custom normals pointing outward from the crown ellipsoid, plus an up-bias, for soft volumetric shading.
10. `L.finish(name, tex=2048)`. The PNG is embedded in the GLB; the exporter forces PNG whenever alpha is used.

## Gotchas that were learned the hard way
- The glTF exporter only writes `alphaMode: MASK` when alpha goes through a Math node (Round / `1-(a<c)`). `_lib.make_image_material` now does this. A direct link exports as BLEND.
- Booth: the default Cycles transparent bounce limit of 8 makes shadow rays through many card layers go black. `tools/booth.py` now sets 128. If a crown looks black on its sun side, check this before touching materials.
- Never stretch the attractor volume vertically to hit a target height, because the tree turns into broccoli. Reach height with the leader and steep upper limbs, and only ever compress.
- The PNG from the render is straight alpha, so never divide RGB by alpha (that gave pale fringes).
- Check crown balance per seed (the 8-sector node histogram). Pick seeds; don't accept one-sided crowns unless you mean it (forest-edge variant).
- Stump / lumber state: `oak.py:build_stump` and `log()` reuse `build_tubes(caps=True)` + `cutwood_material` (end grain from planar `bk_a` coords). Copy them for other species.
- The buttress flare should be wide and soft (Gaussian width ≥0.45 rad, amplitude ≤0.6). Narrow bumps turn into flat fins on the ground.
- Bark `crack_width≈0.3` gives a broad bump profile (rounded ridges). Colour only the deep core (`crackc`), or the bark reads as a thin-line snakeskin net.
- The machine is shared with other agents, and a tree build (2048 bake) can take 10–20 min under load. Run variants in parallel in the background.
