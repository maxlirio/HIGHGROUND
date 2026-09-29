"""Common alder (Alnus glutinosa), riverside, 13-15 m, multi-stemmed from one stool:
dark fissured bark, conical-oval dense dark-green crown.

  blender -b -P assets/src/alder.py            -> assets/glb/alder.glb
  blender -b -P assets/src/alder.py -- leaves  -> also re-render assets/tex/alder_leaves.png
  HG_SEED=5 blender -b -P assets/src/alder.py  -> assets/glb/alder_s5.glb
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Vector
import _lib as L
import _trees as T
import _veg as V

SEED = 7
PNG = os.path.join(L.TEX_DIR, "alder_leaves.png")


def leaves(force=False):
    g = ("#687a2e", "#728636", "#7c903a", "#606f2a")
    def mk():
        base = dict(kind="spray", outline=V.alder_outline, greens=g, leaf_len=0.075, leaves=60, per_tip=8,
                    spread=0.4, twig="#4b3a30", twig_w=0.0035, dry="#8c8a3c", dry_p=0.05)
        tints = [(1, 1, 1), (0.94, 1.0, 0.96), (1.16, 1.12, 0.86), (0.84, 0.88, 0.84)]
        return V.atlas(PNG, [dict(base, tint=t) for t in tints], seed=17)
    return V.load_or_make(PNG, mk, force)


def build(seed):
    rng = random.Random(seed); random.seed(seed)
    H = rng.uniform(13.5, 15.0)
    sk = T.Skel()
    root = sk.add((0, 0, 0), -1, growable=False)
    n_st = 3; a0 = rng.uniform(0, 6.283); lobes = []
    for s in range(n_st):
        a = a0 + s * 2 * math.pi / n_st + rng.uniform(-0.4, 0.4)
        tilt = math.radians(rng.uniform(6, 13))
        d = Vector((math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt), math.cos(tilt)))
        # stems part from a low stool
        st0 = sk.add(Vector((math.cos(a), math.sin(a), 0)) * 0.12 + Vector((0, 0, 0.35)), root, growable=False)
        Hs = H * (1.0 if s == 0 else rng.uniform(0.8, 0.92))
        bole = T.polyline(sk, st0, d, 3.1, 0.4, rng, wander=0.12, kink_every=2.0, kink_deg=5, growable=False)
        lead = T.polyline(sk, bole[-1], d + Vector((0, 0, 0.6)), Hs - 4.0, 0.45, rng, wander=0.14, kink_every=1.6, kink_deg=7)
        col = bole[-1:] + lead
        z = 3.6; b = rng.uniform(0, 6.283)
        while z < Hs - 1.3:
            t = (z - 2.5) / (Hs - 2.5)
            src = col[min(range(len(col)), key=lambda i: abs(sk.pos[col[i]].z - z))]
            b += math.radians(137.5) + rng.gauss(0, 0.35)
            # branches point away from the sibling stems (clump-shaped crown, not three cones)
            outw = Vector((math.cos(a), math.sin(a), 0)); bd = Vector((math.cos(b), math.sin(b), 0))
            if bd.dot(outw) < -0.4 and rng.random() < 0.7: b += math.pi; bd = -bd
            elev = math.radians(rng.uniform(15, 35) + 25 * t)
            dd = Vector((bd.x * math.cos(elev), bd.y * math.cos(elev), math.sin(elev)))
            ln = (3.4 * (1 - t) ** 0.8 + 0.8) * rng.uniform(0.8, 1.15)
            T.polyline(sk, src, dd, ln, 0.4, rng, kink_every=1.3, kink_deg=14, up_bias=0.15, keep_heading=0.8)
            z += rng.uniform(0.5, 0.8)
        # conical-oval crown: stacked lobes along the stem, widest at ~30 % of crown height
        top = sk.pos[lead[-1]]; base = sk.pos[bole[-1]]
        for k in range(6):
            t = k / 5
            c = base.lerp(top, 0.2 + 0.76 * t)
            w = (3.2 * (1 - t) ** 0.6 * min(1.0, (t + 0.25) / 0.45) + 0.7) * (1.0 if s == 0 else 0.85)
            c = c + Vector((math.cos(a), math.sin(a), 0)) * w * 0.25
            lobes.append((c, (w, w * rng.uniform(0.85, 1.1), 1.7)))
    att = T.lobe_attractors(lobes, 11000, rng, shell=0.5, zmin=3.5)
    T.colonize(sk, att, infl=2.8, kill=0.5, step=0.3, iters=240, tropism=(0, 0, -0.04), jitter=0.16, rng=rng)
    rad = T.pipe_radii(sk, r_tip=0.009, exp=2.2, base_radius=0.36)
    print("ALDER sectors", V.sector_balance(sk, rad, 0.02))

    bark = T.bark_material("alder_bark", plate="#554c43", plate2="#463f38", crack="#221d19", lichen="#8f937a",
                           moss="#4a5626", plate_scale=8.5, along=0.55, crack_width=0.26, moss_amount=0.6,
                           lichen_amount=0.3, smooth_below_r=0.05)
    V.bark_blend(bark, V.const("#4f4038"), V.thin_mask(0.03, 0.055))
    def flare(z, th):
        return 1.0 + 0.5 * math.exp(-z / 0.3) * (1 + 0.4 * math.cos(3 * th + seed))
    ob = V.wood(sk, rad, "alder_wood", bark, 4200, min_rs=(0.015, 0.02, 0.025, 0.03, 0.035, 0.04, 0.05, 0.06),
                gnarl=0.08, flare=flare, seed=seed)

    centre, ext = V.crown_frame(lobes)
    pts = T.tip_points(sk, rad, r_leaf=0.02, stride=2.3, rng=rng)
    pts += T.tip_points(sk, rad, r_leaf=0.035, stride=6.0, rng=rng)
    pts = [p for p in pts if p[0].z > 3.4]
    def pick(out, rng):
        if out.z > 0.5 and rng.random() < 0.6: return 2
        if out.z < -0.2 and rng.random() < 0.6: return 3
        return rng.choice((0, 1, 2, 3))
    cs = V.card_lods(pts, leaves(), centre, ext, rng, "alder_leaves", size=(0.95, 1.4), cell_pick=pick,
                     up_bias=0.35, lod_keep=(1.0, 0.28, 0.07), lod_grow=(1.0, 1.7, 3.0), jitter=0.35)
    print("ALDER cards", [len(c.data.polygons) // 2 for c in cs])
    V.pin_centre(bark, zc=3.5)


def main():
    args = T.script_args()
    seed = T.get_seed(SEED) if (any(a.isdigit() for a in args) or "HG_SEED" in os.environ) else SEED
    name = "alder" if seed == SEED else f"alder_s{seed}"
    L.reset(seed)
    leaves(force="leaves" in args)
    build(seed)
    V.finish(name, tex=1024, lods=(1.0, 0.35, 0.18))


main()
