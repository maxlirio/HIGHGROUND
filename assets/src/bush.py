"""Hawthorn / hazel shrub, 2.4-2.8 m: a many-stemmed stool fanning out into a dense rounded
mound, hawthorn leaves with a few late-summer haws, hazel mixed in.

  blender -b -P assets/src/bush.py            -> assets/glb/bush.glb
  blender -b -P assets/src/bush.py -- leaves  -> also re-render assets/tex/shrub_leaves.png (shared with hedge_shrub)
  HG_SEED=5 blender -b -P assets/src/bush.py  -> assets/glb/bush_s5.glb
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Vector
import _lib as L
import _trees as T
import _veg as V

SEED = 6


def build(seed):
    rng = random.Random(seed); random.seed(seed)
    sk = T.Skel()
    root = sk.add((0, 0, 0), -1, growable=False)
    ns = rng.randint(8, 11); a0 = rng.uniform(0, 6.283); lobes = []
    for k in range(ns):
        a = a0 + k * 2 * math.pi / ns + rng.uniform(-0.3, 0.3)
        tilt = math.radians(rng.uniform(15, 50))
        d = Vector((math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt), math.cos(tilt)))
        s0 = sk.add(Vector((math.cos(a), math.sin(a), 0)) * rng.uniform(0.12, 0.38) + Vector((0, 0, 0.05)), root, False)
        ln = rng.uniform(1.4, 2.3)
        st = T.polyline(sk, s0, d, ln * 0.5, 0.25, rng, kink_every=0.5, kink_deg=18, growable=False)
        T.polyline(sk, st[-1], d, ln * 0.5, 0.25, rng, kink_every=0.5, kink_deg=22, up_bias=0.1)
    # rounded mound: a few overlapping lobes, open at the bottom so the stems show
    for k in range(5):
        a = a0 + k * 1.3 + rng.uniform(-0.3, 0.3); r = rng.uniform(0.3, 0.7) if k else 0
        lobes.append((Vector((math.cos(a) * r, math.sin(a) * r, rng.uniform(1.05, 1.35))),
                      (rng.uniform(1.1, 1.35), rng.uniform(1.1, 1.35), rng.uniform(0.85, 1.0))))
    att = T.lobe_attractors(lobes, 5000, rng, shell=0.5, zmin=0.35)
    T.colonize(sk, att, infl=1.8, kill=0.35, step=0.18, iters=160, tropism=(0, 0, -0.03), jitter=0.22, rng=rng)
    rad = T.pipe_radii(sk, r_tip=0.006, exp=2.1, base_radius=0.13)
    print("BUSH sectors", V.sector_balance(sk, rad, 0.012))

    bark = T.bark_material("bush_bark", plate="#5f574d", plate2="#51493f", crack="#28221d", lichen="#a2a585",
                           moss="#4e5a27", plate_scale=14.0, along=0.6, crack_width=0.2, moss_amount=0.7,
                           lichen_amount=0.45, smooth_below_r=0.04)
    ob = V.wood(sk, rad, "bush_wood", bark, 1300, min_rs=(0.012, 0.015, 0.018, 0.022, 0.026, 0.03, 0.035, 0.04),
                gnarl=0.12, seed=seed)

    centre, ext = V.crown_frame(lobes)
    pts = T.tip_points(sk, rad, r_leaf=0.01, stride=1.6, rng=rng)
    pts += T.tip_points(sk, rad, r_leaf=0.018, stride=4, rng=rng)
    def pick(out, rng):
        if out.z > 0.45 and rng.random() < 0.55: return 2
        if out.z < -0.1 and rng.random() < 0.55: return 3
        return rng.choice((0, 0, 1, 1, 2))
    cs = V.card_lods(pts, V.shrub_atlas(), centre, ext, rng, "bush_leaves", size=(0.62, 0.9), cell_pick=pick,
                     up_bias=0.35, lod_keep=(1.0, 0.3, 0.08), lod_grow=(1.0, 1.6, 2.6), jitter=0.2, spread=0.15)
    print("BUSH cards", [len(c.data.polygons) // 2 for c in cs])
    V.pin_centre(bark, zc=0.5)


def main():
    args = T.script_args()
    seed = T.get_seed(SEED) if (any(a.isdigit() for a in args) or "HG_SEED" in os.environ) else SEED
    name = "bush" if seed == SEED else f"bush_s{seed}"
    L.reset(seed)
    V.shrub_atlas(force="leaves" in args)
    build(seed)
    V.finish(name, tex=512, lods=(1.0, 0.3, 0.1))


main()
