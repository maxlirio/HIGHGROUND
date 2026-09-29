"""Standing dead oak (stag-headed snag), 12-15 m: snapped leader, broken crooked limbs,
bark sloughing off to bleached silver-grey wood, lichen and low moss, a few dead twigs.

  blender -b -P assets/src/dead_tree.py            -> assets/glb/dead_tree.glb
  blender -b -P assets/src/dead_tree.py -- leaves  -> also re-render assets/tex/dead_tree_twigs.png
  HG_SEED=5 blender -b -P assets/src/dead_tree.py  -> assets/glb/dead_tree_s5.glb
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Vector
import _lib as L
import _trees as T
import _veg as V

SEED = 9
PNG = os.path.join(L.TEX_DIR, "dead_tree_twigs.png")


def twigs(force=False):
    def mk():
        cells = [dict(kind="twigs", twig=c, twig_w=0.012, depth=5) for c in ("#8c867c", "#7f796f", "#9a9489", "#736d64")]
        return V.atlas(PNG, cells, seed=31)
    return V.load_or_make(PNG, mk, force)


def bleached(n, l, co, rad, geo):
    """Silver-grey weathered heartwood: long grain streaks, drying checks."""
    c, f = V.noise_col(n, l, co, 6.0, "#958d80", "#aaa293", stretch=(3.5, 3.5, 0.18))
    fine, _ = V.noise_col(n, l, co, 40.0, "#857e71", "#b5ad9e", stretch=(3, 3, 0.12))
    c = T._mix(n, l, c, fine, T._math(n, l, "ADD", 0.0, 0.45))
    vm = n.new("ShaderNodeVectorMath"); vm.operation = "MULTIPLY"; vm.inputs[1].default_value = (1, 1, 0.12)
    l.new(co, vm.inputs[0])
    vo = T._n(n, "ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE", in_Scale=6.0); l.new(vm.outputs[0], vo.inputs["Vector"])
    ck = T._math(n, l, "SUBTRACT", 1.0, T._math(n, l, "DIVIDE", vo.outputs["Distance"], 0.03), clamp=True)
    return T._mix(n, l, c, V.srgb("#4a453e"), T._math(n, l, "MULTIPLY", ck, 0.8))


def bare_mask(n, l, co, rad, geo):
    """Bark lost: patchy, more with height and on thinner limbs."""
    sp = n.new("ShaderNodeSeparateXYZ"); l.new(geo.outputs["Position"], sp.inputs[0])
    nz = T._n(n, "ShaderNodeTexNoise", in_Scale=0.8, in_Detail=6.0, in_Roughness=0.65)
    l.new(geo.outputs["Position"], nz.inputs["Vector"])
    h = T._math(n, l, "MULTIPLY", sp.outputs[2], 0.06)
    th = T._math(n, l, "MULTIPLY", T._math(n, l, "SUBTRACT", 0.35, rad), 0.8, clamp=True)
    v = T._math(n, l, "ADD", T._math(n, l, "ADD", nz.outputs["Fac"], h), th)
    return T._math(n, l, "MULTIPLY", T._math(n, l, "SUBTRACT", v, 0.78), 7.0, clamp=True)


def build(seed):
    rng = random.Random(seed); random.seed(seed)
    H = rng.uniform(13.5, 15.0)
    hb = rng.uniform(3.2, 4.0)
    sk = T.Skel()
    root = sk.add((0, 0, 0), -1, growable=False)
    lean = Vector((rng.gauss(0, 0.06), rng.gauss(0, 0.06), 1)).normalized()
    trunk = T.polyline(sk, root, lean, hb, 0.35, rng, wander=0.2, kink_every=1.6, kink_deg=8, growable=False)
    top = trunk[-1]
    leader = T.polyline(sk, top, Vector((rng.gauss(0, .2), rng.gauss(0, .2), 1)), H - hb - 1.0, 0.5, rng,
                        kink_every=2.0, kink_deg=15, growable=False)       # snapped: ends in a spike
    lobes = []; broken_ids = []; n_limbs = 8; a0 = rng.uniform(0, 6.28)
    k0 = rng.randrange(n_limbs); broken_set = {k0, (k0 + 3) % n_limbs, (k0 + 5) % n_limbs}   # spread out: balanced crown
    for k in range(n_limbs):
        a = a0 + k * 2 * math.pi / n_limbs + rng.uniform(-0.35, 0.35)
        src = top if k < 4 else leader[min(len(leader) - 1, rng.randint(1, max(1, len(leader) // 2)))]
        elev = math.radians(rng.uniform(8, 25) if k < 4 else rng.uniform(35, 55))
        d = Vector((math.cos(a) * math.cos(elev), math.sin(a) * math.cos(elev), math.sin(elev)))
        broken = k in broken_set
        ln = (rng.uniform(1.5, 3.5) if broken else rng.uniform(5.5, 8.0)) * (1 if k < 4 else 0.75)
        limb = T.polyline(sk, src, d, ln, 0.45, rng, kink_every=1.5, kink_deg=30, up_bias=0.35,
                          growable=not broken)
        if broken: broken_ids.append((limb, rng.uniform(0.16, 0.24) * (1 if k < 4 else 0.7)))
        if not broken:
            end = sk.pos[limb[-1]]
            lobes.append((end + Vector((0, 0, 1.0)), (2.4, 2.4, 1.8)))
    # sparse secondary branching (dead crowns keep only the stouter wood)
    att = T.lobe_attractors(lobes, 3200, rng, shell=0.6, zmin=hb + 0.5)
    T.colonize(sk, att, infl=3.0, kill=0.9, step=0.45, iters=140, tropism=(0, 0, 0.05), jitter=0.3, rng=rng)
    rad = T.pipe_radii(sk, r_tip=0.02, exp=1.9, base_radius=rng.uniform(0.6, 0.68))
    rt = rad[top]
    for q, i in enumerate(leader):   # snapped leader stays stout up to the break
        rad[i] = max(rad[i], rt * 0.62 * (1 - 0.55 * q / len(leader)))
    rad[leader[-1]] *= 0.3; rad[leader[-2]] *= 0.7    # snapped top: abrupt, splintered
    for ids, r0 in broken_ids:
        for q, i in enumerate(ids): rad[i] = max(rad[i], r0 * (1 - 0.15 * q / len(ids)))
        rad[ids[-1]] = r0 * 0.35   # snapped: blunt end with a short splinter, not a long horn
        if len(ids) > 2: rad[ids[-2]] = r0 * 0.85
    print("DEAD sectors", V.sector_balance(sk, rad, 0.05))

    bark = T.bark_material("dead_bark", plate="#5e564b", plate2="#4d463d", crack="#241f1a", lichen="#aaa982",
                           plate_scale=4.5, along=0.16, crack_width=0.3, moss_amount=0.75, lichen_amount=0.65)
    V.bark_blend(bark, bleached, bare_mask)
    butt = [(rng.uniform(0, 6.283), rng.uniform(0.35, 0.6), rng.uniform(0.45, 0.75)) for _ in range(5)]
    def flare(z, th):
        lob = 0.35 + sum(h * math.exp(-(math.atan2(math.sin(th - a), math.cos(th - a)) / w) ** 2) for a, h, w in butt)
        return 1.0 + 0.7 * math.exp(-z / 0.45) * lob + 0.12 * math.exp(-z / 1.4)
    ob = V.wood(sk, rad, "dead_wood", bark, 7500, min_rs=(0.03, 0.035, 0.04, 0.05, 0.06, 0.07),
                gnarl=0.14, flare=flare, seed=seed)

    # a few clumps of dead twigs at the surviving branch ends (fine silhouette)
    pts = T.tip_points(sk, rad, r_leaf=0.045, stride=2.5, rng=rng)
    pts = [p for p in pts if p[0].z > hb + 1.0]
    if lobes: centre, ext = V.crown_frame(lobes)
    else: centre, ext = Vector((0, 0, H * 0.7)), (4, 4, 3)
    cs = V.card_lods(pts, twigs(), centre, ext, rng, "dead_twigs", size=(1.0, 1.6), up_bias=0.1,
                     lod_keep=(1.0, 0.25, 0.0), lod_grow=(1.0, 1.5, 1.0), jitter=0.2, spread=0.2)
    print("DEAD cards", [len(c.data.polygons) // 2 for c in cs])
    V.pin_centre(bark, zc=hb)


def main():
    args = T.script_args()
    seed = T.get_seed(SEED) if (any(a.isdigit() for a in args) or "HG_SEED" in os.environ) else SEED
    name = "dead_tree" if seed == SEED else f"dead_tree_s{seed}"
    L.reset(seed)
    twigs(force="leaves" in args)
    build(seed)
    V.finish(name, tex=1024, lods=(1.0, 0.35, 0.12))


main()
