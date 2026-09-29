"""Scots pine (Pinus sylvestris), mature, 19-23 m: tall clear bole, grey plated bark below
turning to flaky orange on the upper trunk and limbs, flat-topped irregular crown in plates.

  blender -b -P assets/src/pine.py            -> assets/glb/pine.glb
  blender -b -P assets/src/pine.py -- leaves  -> also re-render assets/tex/pine_leaves.png
  HG_SEED=5 blender -b -P assets/src/pine.py  -> assets/glb/pine_s5.glb (seed hunting)
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Vector
import _lib as L
import _trees as T
import _veg as V

SEED = 21
PNG = os.path.join(L.TEX_DIR, "pine_leaves.png")


def leaves(force=False):
    g = ("#667f50", "#708a57", "#7a945c", "#5e774d")
    def mk():
        base = dict(kind="needles", outline=V.needle_outline, greens=g, leaf_len=0.1, shoots=8, needles=80,
                    tuft=18, twig="#6a4a32", dry="#8a7a45", dry_p=0.04)
        tints = [(1, 1, 1), (0.95, 1.0, 0.97), (1.18, 1.14, 0.9), (0.8, 0.86, 0.88)]
        return V.atlas(PNG, [dict(base, tint=t) for t in tints], seed=8)
    return V.load_or_make(PNG, mk, force)


def orange_bark(n, l, co, rad, geo):
    c, f = V.noise_col(n, l, co, 9.0, "#a15f3d", "#bd8458", stretch=(1, 1, 0.35))
    # papery flakes: paler scales with thin dark edges
    vo = T._n(n, "ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE", in_Scale=14.0)
    vm = n.new("ShaderNodeVectorMath"); vm.operation = "MULTIPLY"; vm.inputs[1].default_value = (1, 1, 0.5)
    l.new(co, vm.inputs[0]); l.new(vm.outputs[0], vo.inputs["Vector"])
    edge = T._math(n, l, "SUBTRACT", 1.0, T._math(n, l, "DIVIDE", vo.outputs["Distance"], 0.05), clamp=True)
    c = T._mix(n, l, c, V.srgb("#6e4630"), T._math(n, l, "MULTIPLY", edge, 0.7))
    fl = T._n(n, "ShaderNodeTexNoise", in_Scale=40.0, in_Detail=3.0); l.new(co, fl.inputs["Vector"])
    c = T._mix(n, l, c, V.srgb("#d2a57a"), T._math(n, l, "MULTIPLY", T._math(n, l, "SUBTRACT", fl.outputs["Fac"], 0.55), 2.5, clamp=True))
    big = T._n(n, "ShaderNodeTexNoise", in_Scale=0.6, in_Detail=2.0); l.new(geo.outputs["Position"], big.inputs["Vector"])
    c = T._mix(n, l, c, V.srgb("#8f5a3c"), T._math(n, l, "MULTIPLY", big.outputs["Fac"], 0.5))
    return c


def build(seed):
    rng = random.Random(seed); random.seed(seed)
    H = rng.uniform(20.0, 22.5)
    hb = H * rng.uniform(0.60, 0.66)            # clear bole: crown only in the top third
    sk = T.Skel()
    root = sk.add((0, 0, 0), -1, growable=False)
    lean = Vector((rng.gauss(0, 0.035), rng.gauss(0, 0.035), 1)).normalized()
    stem = T.polyline(sk, root, lean, hb, 0.5, rng, wander=0.12, kink_every=3.0, kink_deg=4, growable=False)
    # upper stem into the crown (slight sweep; leader loses dominance -> flat top)
    top_dir = Vector((rng.gauss(0, 0.12), rng.gauss(0, 0.12), 1))
    upper = T.polyline(sk, stem[-1], top_dir, H - hb - 1.2, 0.5, rng, wander=0.18, kink_every=1.6, kink_deg=10,
                       growable=False)
    col = stem + upper
    lobes = []; stubs = []
    # a few long limbs, each carrying a FLAT PLATE of foliage at staggered heights -> layered,
    # irregular crown with sky between the tiers and orange limbs showing
    n_pl = rng.randint(8, 9); a = rng.uniform(0, 6.283)
    for k in range(n_pl):
        t = k / (n_pl - 1)
        z = hb + (H - hb - 2.2) * t + rng.uniform(-0.3, 0.3)
        src = col[min(range(len(col)), key=lambda i: abs(sk.pos[col[i]].z - z))]
        a += rng.uniform(1.9, 2.9)
        elev = math.radians(rng.uniform(0, 14) + 18 * t)
        d = Vector((math.cos(a) * math.cos(elev), math.sin(a) * math.cos(elev), math.sin(elev)))
        ln = (5.4 - 3.4 * t) * rng.uniform(0.8, 1.15)
        limb = T.polyline(sk, src, d, ln, 0.4, rng, kink_every=1.0, kink_deg=18, up_bias=0.3, keep_heading=0.85)
        end = sk.pos[limb[-1]]
        pr = (2.6 - 0.7 * t) * rng.uniform(0.85, 1.15)
        lobes.append((end + Vector((0, 0, 0.45)), (pr, pr * rng.uniform(0.75, 1.0), rng.uniform(0.5, 0.7))))
        if rng.random() < 0.6:
            mid = sk.pos[limb[len(limb) // 2]]; side = Vector((-d.y, d.x, 0)).normalized() * rng.choice((-0.7, 0.7))
            lobes.append((mid + side + Vector((0, 0, 0.4)), (1.2, 1.1, 0.45)))
    # flat umbrella top
    tp = sk.pos[upper[-1]]
    lobes.append((tp + Vector((0, 0, 0.5)), (rng.uniform(2.4, 2.8), rng.uniform(2.1, 2.5), 0.7)))
    for k in range(2):
        b = rng.uniform(0, 6.283)
        lobes.append((tp + Vector((math.cos(b) * 1.8, math.sin(b) * 1.8, -0.4)), (1.7, 1.5, 0.55)))
    # dead branch stubs on the bole (self-pruned)
    for k in range(rng.randint(7, 11)):
        z = rng.uniform(3.5, hb - 0.5)
        src = stem[min(range(len(stem)), key=lambda i: abs(sk.pos[stem[i]].z - z))]
        a = rng.uniform(0, 6.283); d = Vector((math.cos(a), math.sin(a), rng.uniform(-0.4, 0.1))).normalized()
        ids = T.polyline(sk, src, d, rng.uniform(0.25, 0.7), 0.15, rng, kink_deg=10, growable=False)
        stubs.append(ids)
    att = T.lobe_attractors(lobes, 7000, rng, shell=0.35, zmin=hb - 0.8)
    T.colonize(sk, att, infl=2.6, kill=0.45, step=0.28, iters=220, tropism=(0, 0, 0.0), jitter=0.15, rng=rng)
    rad = T.pipe_radii(sk, r_tip=0.01, exp=2.1, base_radius=rng.uniform(0.3, 0.34))
    for ids in stubs:
        for q, i in enumerate(ids): rad[i] = 0.05 * (1 - 0.3 * q / max(1, len(ids)))
    print("PINE sectors", V.sector_balance(sk, rad))

    bark = T.bark_material("pine_bark", plate="#6a5243", plate2="#574336", crack="#2b221c", lichen="#9ea08a",
                           plate_scale=3.2, along=0.2, crack_width=0.34, moss_amount=0.3, lichen_amount=0.25)
    V.bark_zblend(bark, orange_bark, hb * 0.72, hb * 1.0, r_max=0.045, bump_scale=0.35)
    def flare(z, th):
        return 1.0 + 0.45 * math.exp(-z / 0.35) * (1 + 0.35 * math.cos(3 * th + seed))
    ob = V.wood(sk, rad, "pine_wood", bark, 4200, gnarl=0.06, flare=flare, seed=seed)

    centre, ext = V.crown_frame(lobes)
    pts = T.tip_points(sk, rad, r_leaf=0.022, rng=rng)
    pts += T.tip_points(sk, rad, r_leaf=0.04, stride=4, rng=rng)
    pts = [p for p in pts if p[0].z > hb - 1.5]
    def pick(out, rng):
        if out.z > 0.5 and rng.random() < 0.65: return 2
        if out.z < -0.2 and rng.random() < 0.6: return 3
        return rng.choice((0, 1, 2, 3))
    cs = V.card_lods(pts, leaves(), centre, ext, rng, "pine_leaves", size=(0.95, 1.4), cell_pick=pick,
                     up_bias=0.6, facing_random=0.9, lod_keep=(1.0, 0.3, 0.08), lod_grow=(1.0, 1.65, 2.9), jitter=0.3)
    print("PINE cards", [len(c.data.polygons) // 2 for c in cs])
    V.pin_centre(bark, zc=hb)


def main():
    args = T.script_args()
    seed = T.get_seed(SEED) if (any(a.isdigit() for a in args) or "HG_SEED" in os.environ) else SEED
    name = "pine" if seed == SEED else f"pine_s{seed}"
    L.reset(seed)
    leaves(force="leaves" in args)
    build(seed)
    V.finish(name, tex=1024, lods=(1.0, 0.35, 0.18))


main()
