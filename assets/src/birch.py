"""Silver birch (Betula pendula), 15-17.5 m: slender white trunk with dark lenticels and a
black rugged base, light airy crown of ascending limbs with weeping twig curtains.

  blender -b -P assets/src/birch.py            -> assets/glb/birch.glb
  blender -b -P assets/src/birch.py -- leaves  -> also re-render assets/tex/birch_leaves.png
  HG_SEED=5 blender -b -P assets/src/birch.py  -> assets/glb/birch_s5.glb
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Vector
import _lib as L
import _trees as T
import _veg as V

SEED = 14
PNG = os.path.join(L.TEX_DIR, "birch_leaves.png")


def leaves(force=False):
    g = ("#7a9c3e", "#87a846", "#94b350", "#6e8f38")
    def mk():
        base = dict(kind="spray", outline=V.birch_outline, greens=g, leaf_len=0.036, leaves=150, per_tip=14,
                    spread=0.42, twig="#4a3a30", twig_w=0.003, dry="#b3a646", dry_p=0.07)
        tints = [(1, 1, 1), (0.95, 1.0, 0.95), (1.16, 1.12, 0.86), (0.82, 0.88, 0.86)]
        return V.atlas(PNG, [dict(base, tint=t) for t in tints], seed=11)
    return V.load_or_make(PNG, mk, force)


def rugged(n, l, co, rad, geo):
    """Black, deeply fissured base bark with grey ridges."""
    vm = n.new("ShaderNodeVectorMath"); vm.operation = "MULTIPLY"; vm.inputs[1].default_value = (1, 1, 0.25)
    l.new(co, vm.inputs[0])
    vo = T._n(n, "ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE", in_Scale=9.0); l.new(vm.outputs[0], vo.inputs["Vector"])
    ridge = T._math(n, l, "DIVIDE", vo.outputs["Distance"], 0.12, clamp=True)
    return T._mix(n, l, V.srgb("#2c2825"), V.srgb("#6f6a60"), T._math(n, l, "POWER", ridge, 0.7))


def base_mask(z0, z1):
    def f(n, l, co, rad, geo):
        sp = n.new("ShaderNodeSeparateXYZ"); l.new(geo.outputs["Position"], sp.inputs[0])
        nz = T._n(n, "ShaderNodeTexNoise", in_Scale=1.6, in_Detail=5.0, in_Roughness=0.7)
        l.new(geo.outputs["Position"], nz.inputs["Vector"])
        z = T._math(n, l, "ADD", sp.outputs[2], T._math(n, l, "MULTIPLY", T._math(n, l, "SUBTRACT", nz.outputs["Fac"], 0.5), 2.2))
        return T._math(n, l, "DIVIDE", T._math(n, l, "SUBTRACT", z1, z), z1 - z0, clamp=True)
    return f


def diamonds(n, l, co, rad, geo):
    """Sparse black diamond/blotch marks on the white stem (scars under old branches)."""
    vm = n.new("ShaderNodeVectorMath"); vm.operation = "MULTIPLY"; vm.inputs[1].default_value = (1, 1, 0.55)
    l.new(co, vm.inputs[0])
    vo = T._n(n, "ShaderNodeTexVoronoi", in_Scale=2.2); vo.feature = "F1"; l.new(vm.outputs[0], vo.inputs["Vector"])
    sc = n.new("ShaderNodeSeparateColor"); l.new(vo.outputs["Color"], sc.inputs[0])
    pick = T._math(n, l, "GREATER_THAN", sc.outputs[0], 0.72)
    spot = T._math(n, l, "SUBTRACT", 1.0, T._math(n, l, "DIVIDE", vo.outputs["Distance"], 0.2), clamp=True)
    thick = T._math(n, l, "DIVIDE", T._math(n, l, "SUBTRACT", rad, 0.06), 0.05, clamp=True)
    return T._math(n, l, "MULTIPLY", T._math(n, l, "MULTIPLY", pick, T._math(n, l, "MULTIPLY", spot, 3.0, clamp=True)), thick)


def build(seed):
    rng = random.Random(seed); random.seed(seed)
    H = rng.uniform(15.5, 17.5)
    hb = rng.uniform(4.0, 5.2)
    sk = T.Skel()
    root = sk.add((0, 0, 0), -1, growable=False)
    lean = Vector((rng.gauss(0, 0.05), rng.gauss(0, 0.05), 1)).normalized()
    stem = T.polyline(sk, root, lean, hb, 0.45, rng, wander=0.12, kink_every=2.5, kink_deg=4, growable=False)
    leader = T.polyline(sk, stem[-1], Vector((rng.gauss(0, 0.08), rng.gauss(0, 0.08), 1)), H - hb - 1.2, 0.45, rng,
                        wander=0.15, kink_every=1.5, kink_deg=6)
    col = stem[-2:] + leader
    lobes = []; a = rng.uniform(0, 6.283); z = hb - 0.2
    while z < H - 1.8:
        t = (z - hb) / (H - hb)
        src = col[min(range(len(col)), key=lambda i: abs(sk.pos[col[i]].z - z))]
        a += math.radians(137.5) + rng.gauss(0, 0.3)
        elev = math.radians(rng.uniform(38, 58) + 10 * t)
        d = Vector((math.cos(a) * math.cos(elev), math.sin(a) * math.cos(elev), math.sin(elev)))
        ln = rng.uniform(3.0, 4.8) * (1 - 0.5 * t)
        limb = T.polyline(sk, src, d, ln, 0.4, rng, kink_every=1.4, kink_deg=10, droop=0.18, keep_heading=0.85)
        end = sk.pos[limb[-1]]
        if rng.random() < 0.8:
            dh = Vector((end.x, end.y, 0)).normalized()
            lobes.append((end + dh * 0.5 - Vector((0, 0, 1.1)), (1.4, 1.4, 2.3)))   # weeping curtain
        z += rng.uniform(0.45, 0.8)
    # airy main crown: narrow ellipsoid built from overlapping loose lobes
    for k in range(6):
        zc = hb + 1.5 + (H - hb - 2.5) * k / 5
        w = 2.6 * math.sin(math.pi * (0.25 + 0.7 * k / 5)) + 0.5
        off = Vector((rng.gauss(0, 0.5), rng.gauss(0, 0.5), 0))
        lobes.append((Vector((0, 0, zc)) + off, (w, w * rng.uniform(0.85, 1.1), 1.7)))
    att = T.lobe_attractors(lobes, 6500, rng, shell=0.6, zmin=hb - 0.5)
    T.colonize(sk, att, infl=2.8, kill=0.5, step=0.3, iters=220, tropism=(0, 0, -0.32), jitter=0.2, rng=rng)
    rad = T.pipe_radii(sk, r_tip=0.008, exp=2.45, base_radius=rng.uniform(0.21, 0.24))
    print("BIRCH sectors", V.sector_balance(sk, rad, 0.02))

    bark = T.bark_material("birch_bark", plate="#dcd8cc", plate2="#cdc7b8", crack="#34302b", lichen="#b4b596",
                           moss="#5a6430", plate_scale=5.0, along=3.2, crack_width=0.07, moss_amount=0.25,
                           lichen_amount=0.2, smooth_below_r=0.03)
    V.bark_blend(bark, V.const("#2f2b28"), diamonds)
    V.bark_blend(bark, rugged, base_mask(0.6, 2.3))
    V.bark_blend(bark, V.const("#5b4639"), V.thin_mask(0.012, 0.03))    # dark purple-brown twigs
    def flare(z, th):
        return 1.0 + 0.35 * math.exp(-z / 0.3) * (1 + 0.3 * math.cos(3 * th + seed))
    ob = V.wood(sk, rad, "birch_wood", bark, 3800, min_rs=(0.012, 0.015, 0.018, 0.022, 0.026, 0.03, 0.035, 0.04),
                gnarl=0.05, flare=flare, seed=seed)

    centre, ext = V.crown_frame(lobes)
    pts = T.tip_points(sk, rad, r_leaf=0.016, stride=1.15, rng=rng)
    pts = [p for p in pts if p[0].z > hb - 1.0]
    def pick(out, rng):
        if out.z > 0.5 and rng.random() < 0.6: return 2
        if out.z < -0.2 and rng.random() < 0.5: return 3
        return rng.choice((0, 1, 2, 3))
    cs = V.card_lods(pts, leaves(), centre, ext, rng, "birch_leaves", size=(0.75, 1.1), cell_pick=pick,
                     up_bias=0.3, lod_keep=(1.0, 0.3, 0.08), lod_grow=(1.0, 1.65, 2.9), jitter=0.3)
    print("BIRCH cards", [len(c.data.polygons) // 2 for c in cs])
    V.pin_centre(bark, zc=hb)


def main():
    args = T.script_args()
    seed = T.get_seed(SEED) if (any(a.isdigit() for a in args) or "HG_SEED" in os.environ) else SEED
    name = "birch" if seed == SEED else f"birch_s{seed}"
    L.reset(seed)
    leaves(force="leaves" in args)
    build(seed)
    V.finish(name, tex=1024, lods=(1.0, 0.35, 0.18))


main()
