"""Laid hedge section (hawthorn + blackthorn, a little hazel), 3.0 m long along local X,
~1.3 m thick, ~1.8 m tall. Pleachers (part-cut stems laid at ~30 deg, all leaning +X) with
upright regrowth, dense foliage. Foliage runs ~0.15 m past each end so sections placed
end-to-end every ~2.9 m along a hedge line (rot = line heading) merge without gaps.

  blender -b -P assets/src/hedge_shrub.py            -> assets/glb/hedge_shrub.glb
  HG_SEED=5 blender -b -P assets/src/hedge_shrub.py  -> assets/glb/hedge_shrub_s5.glb
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Vector
import _lib as L
import _trees as T
import _veg as V

SEED = 2
LEN = 3.0


def build(seed):
    rng = random.Random(seed); random.seed(seed)
    bark = T.bark_material("hedge_bark", plate="#5c544a", plate2="#4d463d", crack="#27211c", lichen="#a2a585",
                           moss="#4e5a27", plate_scale=14.0, along=0.6, crack_width=0.2, moss_amount=0.8,
                           lichen_amount=0.4, smooth_below_r=0.04)
    # foliage volume: overlapping lobes along X, slightly irregular top and sides
    lobes = []
    for k in range(5):
        x = -LEN / 2 + 0.25 + (LEN - 0.5) * k / 4 + rng.uniform(-0.08, 0.08)
        lobes.append((Vector((x, rng.uniform(-0.08, 0.08), rng.uniform(0.98, 1.1))),
                      (rng.uniform(0.55, 0.62), rng.uniform(0.55, 0.62), rng.uniform(0.62, 0.72))))
    for k in range(4):   # dense bottom: a laid hedge is stock-proof down to the ground
        x = -LEN / 2 + 0.35 + (LEN - 0.7) * k / 3 + rng.uniform(-0.1, 0.1)
        lobes.append((Vector((x, rng.uniform(-0.06, 0.06), 0.5)), (0.6, rng.uniform(0.5, 0.58), 0.4)))
    att_all = T.lobe_attractors(lobes, 7500, rng, shell=0.4, zmin=0.12)
    stools = [-LEN / 2 + 0.1 + k * 0.52 + rng.uniform(-0.08, 0.08) for k in range(6)]
    woods = []; pts = []
    for i, x0 in enumerate(stools):
        sk = T.Skel(); y0 = rng.uniform(-0.25, 0.25)
        root = sk.add((x0, y0, 0), -1, growable=False)
        stub = sk.add((x0 + 0.03, y0, 0.12), root, growable=False)
        T.polyline(sk, stub, Vector((rng.gauss(0, .3), rng.gauss(0, .3), 1)), 0.35, 0.12, rng, kink_deg=15)  # basal regrowth
        # the laid pleacher: rises at ~25-35 deg toward +X, drifting across the line
        el = math.radians(rng.uniform(16, 26)); yd = rng.uniform(-0.25, 0.25)
        d = Vector((math.cos(el), yd, math.sin(el))).normalized()
        ln = max(0.6, min(rng.uniform(1.4, 1.9), (LEN / 2 + 0.1 - x0) / max(0.5, d.x)))
        pl = T.polyline(sk, stub, d, ln, 0.18, rng, kink_every=0.4, kink_deg=12, growable=False)
        # upright regrowth from the top of the pleacher (the hedge's body)
        for j, nid in enumerate(pl[2::2]):
            if rng.random() < 0.75:
                ud = Vector((rng.gauss(0, 0.25), rng.gauss(0, 0.3), 1)).normalized()
                T.polyline(sk, nid, ud, rng.uniform(0.3, 0.6), 0.15, rng, kink_every=0.3, kink_deg=15)
        # attractors nearest this stool's reach
        xs = [sk.pos[i_].x for i_ in pl]
        lo, hi = min(xs) - 0.35, max(xs) + 0.35
        att = att_all[(att_all[:, 0] > lo) & (att_all[:, 0] < hi)]
        T.colonize(sk, att, infl=1.3, kill=0.28, step=0.14, iters=120, tropism=(0, 0, 0.03), jitter=0.25, rng=rng)
        rad = T.pipe_radii(sk, r_tip=0.005, exp=2.1, base_radius=rng.uniform(0.045, 0.06))
        for q, nid in enumerate([root, stub]): rad[nid] = max(rad[nid], 0.055)
        ob = V.wood(sk, rad, f"hedge_wood{i}", bark, 180, min_rs=(0.02, 0.025, 0.03, 0.035, 0.04, 0.05),
                    gnarl=0.1, seed=seed + i)
        woods.append(ob)
        pts += T.tip_points(sk, rad, r_leaf=0.009, stride=2.2, rng=rng)
    # a couple of rotten hazel stakes still standing in the line
    for x in (rng.uniform(-1.1, -0.5), rng.uniform(0.4, 1.0)):
        sk = T.Skel(); p = sk.add((x, rng.uniform(-0.1, 0.1), 0), -1)
        for k in range(1, 5): p = sk.add((sk.pos[p].x + rng.gauss(0, .01), sk.pos[p].y + rng.gauss(0, .01), 1.2 * k / 4), p)
        woods.append(V.wood(sk, [0.03] * 5, "stake", bark, 200, min_rs=(0.01,), gnarl=0.05, seed=seed,
                            sides=lambda r: 5, spacing=lambda r: 0.3))
    print("HEDGE wood tris", sum(T.tri_count(o) for o in woods))
    centre = Vector((0, 0, 0.9)); ext = (LEN / 2 + 0.3, 0.7, 0.9)
    def pick(out, rng):
        if out.z > 0.45 and rng.random() < 0.5: return 2
        if abs(out.z) < 0.45 and rng.random() < 0.35: return 3
        return rng.choice((0, 0, 0, 1, 3))
    cs = V.card_lods(pts, V.shrub_atlas(), centre, ext, rng, "hedge_leaves", size=(0.6, 0.85), cell_pick=pick,
                     up_bias=0.3, lod_keep=(1.0, 0.3, 0.08), lod_grow=(1.0, 1.6, 2.6), jitter=0.15, spread=0.12)
    print("HEDGE cards", [len(c.data.polygons) // 2 for c in cs])
    V.pin_centre(bark, zc=0.5)


def main():
    args = T.script_args()
    seed = T.get_seed(SEED) if (any(a.isdigit() for a in args) or "HG_SEED" in os.environ) else SEED
    name = "hedge_shrub" if seed == SEED else f"hedge_shrub_s{seed}"
    L.reset(seed)
    V.shrub_atlas(force="leaves" in args)
    build(seed)
    V.finish(name, tex=512, lods=(1.0, 0.3, 0.1))


main()
