"""Orchard apple (Malus domestica, old standard), 4.2-5 m: short leaning gnarled trunk,
low crooked scaffold limbs, round spreading crown with sparse late-summer apples.

  blender -b -P assets/src/fruit_tree.py            -> assets/glb/fruit_tree.glb
  blender -b -P assets/src/fruit_tree.py -- leaves  -> also re-render assets/tex/fruit_tree_leaves.png
  HG_SEED=5 blender -b -P assets/src/fruit_tree.py  -> assets/glb/fruit_tree_s5.glb
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Vector
import _lib as L
import _trees as T
import _veg as V

SEED = 4
PNG = os.path.join(L.TEX_DIR, "fruit_tree_leaves.png")


def leaves(force=False):
    g = ("#5e7c32", "#688838", "#72923c", "#56722e")
    apples = ["#b3432a", "#c4552c", "#a9ad48", "#b94a2c", "#c8782f"]
    def mk():
        base = dict(kind="spray", outline=V.apple_outline, greens=g, leaf_len=0.085, leaves=55, per_tip=8,
                    spread=0.4, twig="#5b4a3c", twig_w=0.0045, dry="#a39a45", dry_p=0.07)
        cells = [dict(base, fruit=(3, 0.042, apples)), dict(base, tint=(0.95, 1.0, 0.96), fruit=(3, 0.042, apples)),
                 dict(base, tint=(1.15, 1.12, 0.88), fruit=(4, 0.042, apples)), dict(base, tint=(0.82, 0.88, 0.86))]
        return V.atlas(PNG, cells, seed=41)
    return V.load_or_make(PNG, mk, force)


def build(seed):
    rng = random.Random(seed); random.seed(seed)
    ht = rng.uniform(1.3, 1.6)
    sk = T.Skel()
    root = sk.add((0, 0, 0), -1, growable=False)
    lean = Vector((rng.gauss(0, 0.15), rng.gauss(0, 0.15), 1)).normalized()
    trunk = T.polyline(sk, root, lean, ht, 0.2, rng, wander=0.3, kink_every=0.6, kink_deg=12, growable=False)
    top = trunk[-1]; tp = sk.pos[top]
    lobes = []; n = rng.randint(4, 5); a0 = rng.uniform(0, 6.283)
    for k in range(n):
        a = a0 + k * 2 * math.pi / n + rng.uniform(-0.3, 0.3)
        el = math.radians(rng.uniform(22, 45))
        d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
        src = top if k < 3 else trunk[-2]
        limb = T.polyline(sk, src, d, rng.uniform(1.7, 2.4), 0.25, rng, kink_every=0.6, kink_deg=28, up_bias=0.25,
                          keep_heading=0.7)
        end = sk.pos[limb[-1]]
        dh = Vector((end.x - tp.x, end.y - tp.y, 0)).normalized()
        lobes.append((end + dh * 0.6 - Vector((0, 0, 0.15)), (1.45, 1.45, 0.95)))
    lobes.append((tp + Vector((0, 0, 2.5)), (1.3, 1.3, 0.9)))
    ztop = max(c.z + r[2] for c, r in lobes); s = min(1.0, (4.6 - ht) / (ztop - ht))
    lobes = [(Vector((c.x, c.y, ht + (c.z - ht) * s)), (r[0], r[1], r[2] * s)) for c, r in lobes]
    att = T.lobe_attractors(lobes, 5000, rng, shell=0.6, zmin=ht + 0.2)
    T.colonize(sk, att, infl=2.0, kill=0.4, step=0.2, iters=200, tropism=(0, 0, -0.07), jitter=0.2, rng=rng)
    rad = T.pipe_radii(sk, r_tip=0.007, exp=2.0, base_radius=rng.uniform(0.15, 0.17))
    print("APPLE sectors", V.sector_balance(sk, rad, 0.015))

    bark = T.bark_material("apple_bark", plate="#5f564a", plate2="#4f473d", crack="#2b241e", lichen="#a8ab86",
                           moss="#56622a", plate_scale=13.0, along=0.7, crack_width=0.32, moss_amount=0.55,
                           lichen_amount=0.6, smooth_below_r=0.03)
    V.bark_blend(bark, V.const("#5a4a3c"), V.thin_mask(0.015, 0.03))
    def flare(z, th):
        return 1.0 + 0.4 * math.exp(-z / 0.2) * (1 + 0.4 * math.cos(2 * th + seed))
    ob = V.wood(sk, rad, "apple_wood", bark, 3000, min_rs=(0.01, 0.012, 0.015, 0.018, 0.022, 0.026, 0.03),
                gnarl=0.14, flare=flare, seed=seed)

    centre, ext = V.crown_frame(lobes)
    pts = T.tip_points(sk, rad, r_leaf=0.012, stride=1.4, rng=rng)
    pts += T.tip_points(sk, rad, r_leaf=0.02, stride=4, rng=rng)
    def pick(out, rng):
        if out.z > 0.5 and rng.random() < 0.6: return 2
        if out.z < -0.2 and rng.random() < 0.6: return 3
        return rng.choice((0, 1, 2, 3))
    cs = V.card_lods(pts, leaves(), centre, ext, rng, "fruit_tree_leaves", size=(0.7, 1.0), cell_pick=pick,
                     up_bias=0.35, lod_keep=(1.0, 0.3, 0.08), lod_grow=(1.0, 1.65, 2.8), jitter=0.25, spread=0.2)
    print("APPLE cards", [len(c.data.polygons) // 2 for c in cs])
    V.pin_centre(bark, zc=ht)


def main():
    args = T.script_args()
    seed = T.get_seed(SEED) if (any(a.isdigit() for a in args) or "HG_SEED" in os.environ) else SEED
    name = "fruit_tree" if seed == SEED else f"fruit_tree_s{seed}"
    L.reset(seed)
    leaves(force="leaves" in args)
    build(seed)
    V.finish(name, tex=1024, lods=(1.0, 0.35, 0.18))


main()
