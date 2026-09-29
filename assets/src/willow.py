"""Pollarded crack willow (Salix fragilis), 7-8.5 m: short fat leaning trunk, a knuckled
bolling (pollard head) and a burst of straight shoots with narrow grey-green leaves.

  blender -b -P assets/src/willow.py            -> assets/glb/willow.glb
  blender -b -P assets/src/willow.py -- leaves  -> also re-render assets/tex/willow_leaves.png
  HG_SEED=5 blender -b -P assets/src/willow.py  -> assets/glb/willow_s5.glb
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Vector
import _lib as L
import _trees as T
import _veg as V

SEED = 3
PNG = os.path.join(L.TEX_DIR, "willow_leaves.png")


def leaves(force=False):
    g = ("#86976a", "#91a274", "#9cad7f", "#a8b78c")
    def mk():
        base = dict(kind="spray", outline=V.willow_outline, greens=g, leaf_len=0.1, leaves=85, per_tip=3,
                    spread=0.42, twig="#7a6a3e", twig_w=0.004, dry="#a8a150", dry_p=0.06)
        tints = [(1, 1, 1), (0.97, 1.0, 1.0), (1.14, 1.12, 0.9), (0.82, 0.87, 0.88)]
        return V.atlas(PNG, [dict(base, tint=t) for t in tints], seed=23)
    return V.load_or_make(PNG, mk, force)


def build(seed):
    rng = random.Random(seed); random.seed(seed)
    sk = T.Skel(); rad = []
    def add(p, par, r):
        rad.append(r); return sk.add(p, par, False)
    root = add((0, 0, 0), -1, 0.46)
    ht = rng.uniform(2.2, 2.6)
    lean = Vector((rng.gauss(0, 0.12), rng.gauss(0, 0.12), 1)).normalized()
    prev = root; n = 8
    for k in range(1, n + 1):
        t = k / n
        p = lean * ht * t + Vector((rng.gauss(0, 0.03), rng.gauss(0, 0.03), 0))
        prev = add(p, prev, 0.46 - 0.08 * t)
    top = prev; tp = sk.pos[top]
    cap = add(tp + lean * 0.35, top, 0.36)   # crown of the bolling (trunk chain ends here)
    shoots = []
    nk = rng.randint(7, 9); a0 = rng.uniform(0, 6.283)
    for k in range(nk):
        a = a0 + k * 2 * math.pi / nk + rng.uniform(-0.3, 0.3)
        el = math.radians(rng.uniform(20, 55))
        d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
        src = top if k % 2 else cap
        kl = rng.uniform(0.3, 0.6); kr = rng.uniform(0.15, 0.22)
        k1 = add(sk.pos[src] + d * kl * 0.5 + Vector((0, 0, 0.05)), src, kr)
        k2 = add(sk.pos[k1] + (d + Vector((0, 0, 0.8))).normalized() * kl * 0.5, k1, kr * 0.9)
        # burst of straight rods from each knuckle
        for j in range(rng.randint(4, 6)):
            sp = math.radians(rng.uniform(10, 55))
            b = a + rng.uniform(-0.9, 0.9)
            sd = Vector((math.cos(b) * math.sin(sp), math.sin(b) * math.sin(sp), math.cos(sp)))
            ln = rng.uniform(3.4, 5.4) * (0.8 if sp > math.radians(40) else 1.0)
            r0 = rng.uniform(0.03, 0.055); m = max(4, int(ln / 0.45)); pv = k2
            base = sk.pos[k2] + d * rng.uniform(0.0, 0.08)
            ids = []
            for s in range(1, m + 1):
                t = s / m
                q = base + sd * ln * t + Vector((sd.x, sd.y, 0)) * 0.25 * ln * t * t   # gentle outward arc
                pv = add(q, pv, max(0.008, r0 * (1 - 0.85 * t))); ids.append(pv)
            shoots.append(ids)
    # a few thin side shoots (twiggy fill)
    for ids in shoots:
        for s in ids[len(ids) // 3::3]:
            if rng.random() < 0.5:
                pd = sk.pos[s] - sk.pos[sk.par[s]]
                sd = (pd.normalized() + Vector((rng.gauss(0, .6), rng.gauss(0, .6), 0.1))).normalized()
                q = add(sk.pos[s] + sd * rng.uniform(0.5, 1.0), s, 0.008)

    bark = T.bark_material("willow_bark", plate="#5b5248", plate2="#4b433a", crack="#231e19", lichen="#9c9e84",
                           moss="#4c5a27", plate_scale=3.4, along=0.22, crack_width=0.4, moss_amount=0.95,
                           lichen_amount=0.25, smooth_below_r=0.06)
    V.bark_blend(bark, V.const("#7a6b40"), V.thin_mask(0.035, 0.07))    # young olive-yellow rods
    butt = [(rng.uniform(0, 6.283), rng.uniform(0.2, 0.45)) for _ in range(6)]
    def flare(z, th):
        lob = sum(h * math.exp(-(math.atan2(math.sin(th - a), math.cos(th - a)) / 0.5) ** 2) for a, h in butt)
        head = math.exp(-((z - ht - 0.1) / 0.4) ** 2) * (0.55 + 1.3 * lob)            # the knuckled bolling
        return 1.0 + 0.5 * math.exp(-z / 0.35) * (0.4 + lob) + head
    ob = V.wood(sk, rad, "willow_wood", bark, 5200, min_rs=(0.007, 0.009, 0.012, 0.016, 0.02, 0.025, 0.03),
                gnarl=0.16, flare=flare, seed=seed,
                spacing=lambda r: 0.6 if r < 0.07 else min(1.1, max(0.22, r * 2.2)))  # rods are straight

    # leaf cards all along the rods (upper 80 %)
    pts = []
    for ids in shoots:
        for s in ids[int(len(ids) * 0.38):]:
            pts.append((sk.pos[s].copy(), sk.pos[s] - sk.pos[sk.par[s]]))
    for i, p in enumerate(sk.pos):
        if rad[i] <= 0.008 and sk.par[i] >= 0: pts.append((p.copy(), p - sk.pos[sk.par[i]]))
    lo = Vector((min(p.x for p, _ in pts), min(p.y for p, _ in pts), min(p.z for p, _ in pts)))
    hi = Vector((max(p.x for p, _ in pts), max(p.y for p, _ in pts), max(p.z for p, _ in pts)))
    centre = (lo + hi) / 2; ext = [(hi[i] - lo[i]) / 2 + 0.5 for i in range(3)]
    def pick(out, rng):
        if out.z > 0.5 and rng.random() < 0.55: return 2
        if out.z < -0.2 and rng.random() < 0.5: return 3
        return rng.choice((0, 1, 2, 3))
    cs = V.card_lods(pts, leaves(), centre, ext, rng, "willow_leaves", size=(0.9, 1.35), cell_pick=pick,
                     up_bias=0.3, lod_keep=(1.0, 0.3, 0.08), lod_grow=(1.0, 1.65, 2.8), jitter=0.3, per_point=2)
    print("WILLOW cards", [len(c.data.polygons) // 2 for c in cs], "shoots", len(shoots))
    V.pin_centre(bark, zc=ht)


def main():
    args = T.script_args()
    seed = T.get_seed(SEED) if (any(a.isdigit() for a in args) or "HG_SEED" in os.environ) else SEED
    name = "willow" if seed == SEED else f"willow_s{seed}"
    L.reset(seed)
    leaves(force="leaves" in args)
    build(seed)
    V.finish(name, tex=1024, lods=(1.0, 0.35, 0.18))


main()
