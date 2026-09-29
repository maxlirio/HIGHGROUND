"""HIGHGROUND - shared kit for the yard buildings (archery_range, fletcher, stables, horse_paddock).

Materials and construction helpers lifted from the approved town_hall.py (same node recipes,
same Batch/beam/Face/frame_face/roof_rows techniques) plus the pieces these buildings need:
thatch, turf, straw, hay, muck, feathers, water, post-and-rail fencing, mounds, lathe solids.

    import _kit_yards as K
    K.init(state, seed)          # state: complete | build1 | build2 | ruin
    K.build_materials()
    ... K.B("oak") / K.beam(...) ...
    K.finalize(name, tex)
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector, Matrix
import _lib as L

STATE = "complete"
FULL = RUIN = B1 = B2 = False
R = random.Random(11)


def init(state, seed=11):
    global STATE, FULL, RUIN, B1, B2
    assert state in ("complete", "build1", "build2", "ruin"), state
    STATE = state
    FULL, RUIN, B1, B2 = state == "complete", state == "ruin", state == "build1", state == "build2"
    L.reset(seed=seed)
    R.seed(seed)
    MAT.clear(); BATCHES.clear(); SOLIDS.clear()


def state_from_argv():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return os.environ.get("HG_STATE") or (argv[0] if argv else "complete")


MAT = {}
BATCHES = {}
SOLIDS = []


def jit(a):
    return R.uniform(-a, a)


# =====================================================================  node helper
def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c) + (1.0,)


class G:
    def __init__(s, name):
        s.m, s.n, s.l, s.b = L.mat(name)
        s.geo = s.n.new("ShaderNodeNewGeometry")
        s.P = s.geo.outputs["Position"]
        s.N = s.geo.outputs["Normal"]

    def _set(s, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            s.l.new(v, sock)
        elif isinstance(v, str):
            sock.default_value = srgb(v)
        elif v is not None:
            sock.default_value = v

    def node(s, t, ins=(), **props):
        nd = s.n.new(t)
        for k, v in props.items():
            setattr(nd, k, v)
        for k, v in ins:
            s._set(nd.inputs[k], v)
        return nd

    def math(s, op, a, b=0.0, clamp=False):
        return s.node("ShaderNodeMath", [(0, a), (1, b)], operation=op, use_clamp=clamp).outputs[0]

    def add(s, a, b): return s.math("ADD", a, b)
    def sub(s, a, b): return s.math("SUBTRACT", a, b)
    def mul(s, a, b): return s.math("MULTIPLY", a, b)
    def mx(s, a, b): return s.math("MAXIMUM", a, b)
    def mn(s, a, b): return s.math("MINIMUM", a, b)
    def gt(s, a, b): return s.math("GREATER_THAN", a, b)
    def clamp(s, a): return s.math("ADD", a, 0.0, clamp=True)
    def inv(s, a): return s.math("SUBTRACT", 1.0, a, clamp=True)

    def sep(s, v):
        nd = s.node("ShaderNodeSeparateXYZ", [(0, v)])
        return nd.outputs[0], nd.outputs[1], nd.outputs[2]

    def comb(s, x, y, z):
        return s.node("ShaderNodeCombineXYZ", [(0, x), (1, y), (2, z)]).outputs[0]

    def vmul(s, v, f):
        return s.node("ShaderNodeVectorMath", [(0, v), (1, f)], operation="MULTIPLY").outputs[0]

    def attr(s, name):
        nd = s.node("ShaderNodeAttribute", attribute_name=name)
        return nd.outputs["Vector"], nd.outputs["Factor"]

    def noise(s, v, scale, detail=4.0, rough=0.55, dist=0.0):
        return s.node("ShaderNodeTexNoise", [("Vector", v), ("Scale", scale), ("Detail", detail),
                                             ("Roughness", rough), ("Distortion", dist)]).outputs[0]

    def vor(s, v, scale, feature="F1", rand=1.0):
        return s.node("ShaderNodeTexVoronoi", [("Vector", v), ("Scale", scale), ("Randomness", rand)],
                      feature=feature).outputs[0]

    def white(s, v):
        return s.node("ShaderNodeTexWhiteNoise", [("Vector", v)]).outputs["Value"]

    def brick(s, v, bw, rh, msize, smooth, c1=(0, 0, 0, 1), c2=(1, 1, 1, 1), squash=0.75, sf=3):
        nd = s.node("ShaderNodeTexBrick", [("Vector", v), ("Color1", c1), ("Color2", c2), ("Mortar", (1, 1, 1, 1)),
                                           ("Scale", 1.0), ("Mortar Size", msize), ("Mortar Smooth", smooth),
                                           ("Bias", 0.0), ("Brick Width", bw), ("Row Height", rh)],
                    offset=0.5, offset_frequency=2, squash=squash, squash_frequency=sf)
        return nd.outputs["Color"], nd.outputs["Factor"]

    def ramp(s, f, stops):
        nd = s.node("ShaderNodeValToRGB", [(0, f)])
        el = nd.color_ramp.elements
        while len(el) > 2:
            el.remove(el[-1])
        for i, (p, c) in enumerate(stops):
            e = el[i] if i < 2 else el.new(p)
            e.position = p
            e.color = srgb(c) if isinstance(c, str) else c
        return nd.outputs["Color"]

    def mix(s, f, a, b, blend="MIX"):
        nd = s.node("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        s._set(nd.inputs[0], f)
        s._set(nd.inputs[6], a)
        s._set(nd.inputs[7], b)
        return nd.outputs[2]

    def mr(s, v, a, b, c=0.0, d=1.0, smooth=True):
        return s.node("ShaderNodeMapRange", [(0, v), (1, a), (2, b), (3, c), (4, d)], clamp=True,
                      interpolation_type="SMOOTHSTEP" if smooth else "LINEAR").outputs[0]

    def out(s, col, rough, height=None, strength=1.0, dist=0.02):
        s._set(s.b.inputs["Base Color"], col)
        s._set(s.b.inputs["Roughness"], rough)
        if height is not None:
            bp = s.node("ShaderNodeBump", [("Height", height), ("Strength", strength), ("Distance", dist)])
            s.l.new(bp.outputs["Normal"], s.b.inputs["Normal"])
        return s.m

    # shared weathering (mud splash, base moss) for anything touching the ground
    def ground_grime(s, col, z, vertical, moss_amt=1.0, mud_h=0.42):
        P = s.P
        md = s.mr(s.add(z, s.mul(s.sub(s.noise(P, 5.0, 3), 0.5), 0.45)), mud_h, 0.04)
        splash = s.mul(s.inv(s.mr(s.vor(P, 26.0), 0.0, 0.18)), s.mr(z, mud_h + 0.35, mud_h - 0.1))
        md = s.mul(s.mx(md, s.mul(splash, 0.8)), vertical)
        mudc = s.ramp(s.noise(P, 3.0, 3), [(0.3, "#3f3226"), (0.7, "#5a4632")])
        col = s.mix(md, col, mudc)
        mb = s.mr(s.add(z, s.mul(s.sub(s.noise(P, 1.6, 3), 0.5), 1.1)), 1.25, 0.25)
        mb = s.mul(s.mul(mb, s.mr(s.noise(P, 7.0, 4), 0.42, 0.62)), moss_amt)
        mossc = s.ramp(s.noise(P, 5.0, 3), [(0.3, "#3f4a26"), (0.75, "#66713a")])
        col = s.mix(s.mul(mb, 0.85), col, mossc)
        return col, md, mb


# =====================================================================  materials
def m_stone(name, tones, mortar_hex, rowh=0.3, bw=0.62, joints=True, soot_top=None, bump=1.0,
            moss=1.0, charred=0.0):
    g = G(name)
    P, N = g.P, g.N
    x, y, z = g.sep(P)
    nx, ny, nz = g.sep(N)
    s = g.gt(g.math("ABSOLUTE", nz), 0.7)          # horizontal face?
    vert = g.inv(s)
    h = g.add(x, g.mul(y, vert))
    v = g.add(g.mul(z, vert), g.mul(y, s))
    _, rnd = g.attr("hg_rnd")
    if joints:
        v2 = g.add(v, g.mul(g.sub(g.noise(P, 0.3, 2), 0.5), 0.5))
        h2 = g.add(h, g.mul(g.sub(g.noise(P, 2.5, 2), 0.5), 0.09))
        uv = g.comb(h2, v2, 0.0)
        per1, mort1 = g.brick(uv, bw, rowh, 0.028, 0.25)
        uvb = g.comb(g.add(h2, 0.37), g.add(v2, 0.11), 0.0)
        per2, mort2 = g.brick(uvb, bw * 0.7, rowh * 0.62, 0.03, 0.25, squash=0.6, sf=2)
        patch = g.gt(g.noise(P, 0.22, 2), 0.56)
        mort = g.add(g.mul(mort1, g.inv(patch)), g.mul(mort2, patch))
        perv = g.add(g.mul(g.math("ADD", per1, 0.0), g.inv(patch)), g.mul(g.math("ADD", per2, 0.0), patch))
        edge = g.vor(g.vmul(uv, (1.0 / bw, 1.0 / rowh, 1.0)), 1.3, "DISTANCE_TO_EDGE")
        crack = g.mul(g.inv(g.mr(edge, 0.0, 0.045)), g.gt(perv, 0.55))
        mort = g.mx(mort, crack)
        _, soft1 = g.brick(uv, bw, rowh, 0.1, 1.0)
        _, soft2 = g.brick(uvb, bw * 0.7, rowh * 0.62, 0.08, 1.0, squash=0.6, sf=2)
        pillow = g.inv(g.add(g.mul(soft1, g.inv(patch)), g.mul(soft2, patch)))
        sid = g.add(g.mul(perv, 0.85), g.mul(g.noise(P, 0.9), 0.3))
    else:
        mort = 0.0
        pillow = g.noise(P, 1.5, 2)
        sid = g.add(g.mul(rnd, 0.8), g.mul(g.noise(P, 0.9), 0.3))
    col = g.ramp(sid, tones)
    hue = g.white(g.comb(g.math("FLOOR", g.mul(sid, 13.0)), 3.0, 0.0))
    col = g.mix(g.mul(g.gt(hue, 0.78), 0.55), col, g.mix(1.0, col, "#c8a883", "MULTIPLY"))
    col = g.mix(g.mul(g.math("LESS_THAN", hue, 0.12), 0.5), col, g.mix(1.0, col, "#8d8f94", "MULTIPLY"))
    blot = g.noise(P, 0.13, 3)
    col = g.mix(0.55, col, g.ramp(blot, [(0.3, "#6f6f73"), (0.5, "#808080"), (0.72, "#a08c6c")]), "OVERLAY")
    fine = g.noise(P, 30.0, 6, 0.62)
    col = g.mix(0.45, col, fine, "OVERLAY")
    pits = g.inv(g.mr(g.vor(P, 55.0), 0.0, 0.14))
    col = g.mix(g.mul(pits, 0.4), col, g.mix(1.0, col, (0.5, 0.5, 0.5, 1), "MULTIPLY"))
    # lichen blooms on vertical faces
    li = g.mul(g.inv(g.mr(g.vor(P, 5.0), 0.05, 0.16)), g.mr(g.noise(P, 1.2, 3), 0.5, 0.62))
    col = g.mix(g.mul(g.mul(li, vert), 0.55), col, "#a8a37f")
    if joints:
        mcol = g.mix(0.5, mortar_hex, fine, "OVERLAY")
        col = g.mix(mort, col, mcol)
    # rain streaks running down from ledges
    st = g.noise(g.comb(g.mul(h, 2.4), g.mul(v, 0.08), 0.0), 1.0, 3)
    sf = g.mul(g.mr(st, 0.5, 0.74), 0.5)
    col = g.mix(g.mul(sf, vert), col, g.mix(1.0, col, "#8a8580", "MULTIPLY"))
    base = g.mul(g.mr(g.add(z, g.mul(g.noise(P, 0.6, 2), 1.5)), 3.5, 0.3), 0.45)
    col = g.mix(g.mul(base, vert), col, g.mix(1.0, col, "#8e8c74", "MULTIPLY"))
    # moss on upward faces
    mt = g.mul(g.mul(s, g.gt(nz, 0.0)), g.mr(g.noise(P, 1.1, 4), 0.44, 0.6))
    mt = g.mul(mt, moss * 0.8)
    col = g.mix(mt, col, g.ramp(g.noise(P, 6.0), [(0.3, "#4a5329"), (0.7, "#6d7440")]))
    col, md, mb = g.ground_grime(col, z, vert, moss)
    if soot_top is not None:
        so = g.mul(g.mr(z, soot_top - 2.4, soot_top), g.add(0.55, g.mul(g.noise(P, 2.0), 0.6)))
        col = g.mix(g.clamp(so), col, "#34302c")
    if charred > 0:
        ch = g.mul(g.mr(g.add(z, g.mul(g.noise(P, 0.35, 3), 6.0)), 3.0, 9.0, 0.0, 1.0), charred)
        col = g.mix(g.clamp(ch), col, g.mix(0.6, "#2e2a27", fine, "OVERLAY"))
    rough = g.add(0.84, g.mul(mort if joints else 0.0, 0.08))
    rough = g.sub(rough, g.mul(md, 0.18))
    height = g.add(g.mul(pillow, g.inv(mort) if joints else 1.0), g.mul(fine, 0.35))
    height = g.sub(height, g.mul(pits, 0.25))
    return g.out(col, rough, height, 1.0, 0.035 * bump)


def m_wood(name, tones, weather_hex="#8c8374", weathered=0.5, fresh=0.0, charred=0.0, grain_k=1.0):
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    off = g.mul(rnd, 37.0)
    grain = g.noise(g.comb(g.add(g.mul(lx, 16 * grain_k), off), g.mul(ly, 16 * grain_k), g.mul(lz, 0.7)),
                    1.0, 10, 0.62, 0.35)
    fib = g.noise(g.comb(g.add(g.mul(lx, 70), off), g.mul(ly, 70), g.mul(lz, 1.6)), 1.0, 4, 0.6)
    chk = g.vor(g.comb(g.add(g.mul(lx, 6), off), g.mul(ly, 6), g.mul(lz, 0.3)), 2.2, "DISTANCE_TO_EDGE")
    cracks = g.mul(g.inv(g.mr(chk, 0.0, 0.035)), g.mr(g.noise(g.comb(lx, ly, g.add(lz, off)), 1.3), 0.45, 0.6))
    col = g.ramp(g.add(g.mul(rnd, 0.85), g.mul(g.noise(P, 0.7), 0.3)), tones)
    col = g.mix(0.75, col, grain, "OVERLAY")
    col = g.mix(0.35, col, fib, "OVERLAY")
    w = g.mul(g.mr(g.noise(P, 0.5, 3), 0.32, 0.68), weathered)
    wc = g.mix(0.6, weather_hex, grain, "OVERLAY")
    col = g.mix(w, col, wc)
    if fresh > 0:
        fr = g.gt(rnd, 1.0 - fresh)
        col = g.mix(fr, col, g.mix(0.6, "#9e8360", grain, "OVERLAY"))
    col = g.mix(g.mul(cracks, 0.8), col, "#2f2721")
    x, y, z = g.sep(P)
    col, md, mb = g.ground_grime(col, z, 1.0, 0.7, 0.3)
    if charred > 0:
        ch = g.mul(g.mr(g.noise(P, 0.6, 3), 0.3, 0.55), charred)
        cc = g.mix(g.mul(g.inv(g.mr(g.vor(g.comb(lx, ly, g.mul(lz, 0.4)), 9.0, "DISTANCE_TO_EDGE"), 0.0, 0.05)), 0.8),
                   "#27231f", "#5e5750")
        col = g.mix(ch, col, cc)
    rough = g.add(0.74, g.mul(w, 0.12))
    height = g.sub(g.add(g.mul(grain, 0.6), g.mul(fib, 0.3)), g.mul(cracks, 1.2))
    return g.out(col, rough, height, 1.0, 0.006)


def m_daub(name, charred=0.0):
    g = G(name)
    P = g.P
    x, y, z = g.sep(P)
    col = g.ramp(g.noise(P, 0.35, 3), [(0.25, "#ae9b7b"), (0.5, "#c0ae8d"), (0.75, "#ccbd9f")])
    fine = g.noise(P, 22.0, 6, 0.6)
    col = g.mix(0.35, col, fine, "OVERLAY")
    wash = g.mr(g.noise(P, 1.4, 4), 0.55, 0.7)
    col = g.mix(g.mul(wash, 0.3), col, "#d3c6aa")
    dmg = g.mr(g.noise(P, 0.8, 5, 0.6), 0.665, 0.69)
    wat = g.node("ShaderNodeTexWave", [("Vector", g.vmul(P, (1, 1, 1))), ("Scale", 6.0), ("Distortion", 3.0),
                                       ("Detail", 3.0)], bands_direction="Z").outputs[1]
    wc = g.ramp(wat, [(0.2, "#5a4a33"), (0.8, "#80694a")])
    col = g.mix(dmg, col, wc)
    ring = g.mul(g.mr(g.noise(P, 0.8, 5, 0.6), 0.62, 0.665), g.inv(dmg))
    col = g.mix(g.mul(ring, 0.5), col, "#a39679")
    dirt = g.mul(g.mr(g.add(z, g.mul(g.noise(P, 2.0), 0.8)), 2.8, 0.9), 0.75)
    col = g.mix(dirt, col, "#8a7a5e")
    st = g.noise(g.comb(g.mul(g.add(x, y), 3.0), g.mul(z, 0.1), 0.0), 1.0, 3)
    col = g.mix(g.mul(g.mr(st, 0.48, 0.72), 0.5), col, "#8e8068")
    if charred > 0:
        col = g.mix(charred, col, g.mix(0.5, "#3a342e", fine, "OVERLAY"))
    height = g.sub(g.add(g.mul(g.noise(P, 2.5, 3), 0.8), g.mul(fine, 0.3)), g.mul(dmg, 1.5))
    return g.out(col, 0.93, height, 1.0, 0.02)


def m_tiles(name, tones, cell=0.25, curve=0.6, lichen=1.0, moss=1.0, wood=False, charred=0.0):
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    cu = g.math("DIVIDE", g.add(lx, g.mul(rnd, 0.5)), cell)
    cid = g.math("FLOOR", cu)
    fr = g.math("FRACT", cu)
    tr = g.white(g.comb(cid, g.mul(rnd, 91.0), 0.0))
    gap = g.inv(g.mr(g.mn(fr, g.sub(1.0, fr)), 0.02, 0.1))
    curv = g.math("SINE", g.mul(fr, math.pi))
    col = g.ramp(tr, tones)
    blot = g.noise(P, 0.3, 3)
    col = g.mix(0.5, col, blot, "OVERLAY")
    fine = g.noise(P, 26.0, 5, 0.6)
    col = g.mix(0.35, col, fine, "OVERLAY")
    if wood:
        gr = g.noise(g.comb(g.mul(lx, 30), g.mul(ly, 1.5), g.mul(tr, 9.0)), 1.0, 8, 0.6, 0.3)
        col = g.mix(0.7, col, gr, "OVERLAY")
    col = g.mix(g.mul(gap, 0.75), col, g.mix(1.0, col, (0.3, 0.3, 0.3, 1), "MULTIPLY"))
    # lower edge of each course darker (tiles lift off the one below)
    edge = g.mr(ly, 0.0, 0.07)
    col = g.mix(g.mul(g.inv(edge), 0.35), col, g.mix(1.0, col, (0.45, 0.45, 0.45, 1), "MULTIPLY"))
    li = g.mul(g.inv(g.mr(g.vor(P, 4.5), 0.05, 0.17)), g.mr(g.noise(P, 0.8, 3), 0.48, 0.6))
    col = g.mix(g.mul(li, 0.75 * lichen), col, "#aca780")
    mo = g.mul(g.mr(g.noise(P, 0.45, 4), 0.56, 0.7), g.mr(ly, 0.25, 0.0))
    mo = g.mx(mo, g.mul(g.mr(g.noise(P, 0.9, 4), 0.62, 0.72), 0.8))
    col = g.mix(g.mul(mo, 0.85 * moss), col, g.ramp(g.noise(P, 7.0), [(0.3, "#434b27"), (0.7, "#69703b")]))
    x, y, z = g.sep(P)
    if charred > 0:
        col = g.mix(g.mul(g.mr(g.noise(P, 0.5, 3), 0.35, 0.6), charred), col, "#2b2724")
    height = g.add(g.sub(g.mul(curv, curve), g.mul(gap, 0.9)), g.mul(fine, 0.2))
    height = g.add(height, g.mul(edge, 0.4))
    return g.out(col, g.add(0.72, g.mul(mo, 0.15)), height, 1.0, 0.018)


def m_simple(name, hexa, hexb, rough=0.8, scale=2.0, rust=False):
    g = G(name)
    P = g.P
    col = g.ramp(g.noise(P, scale, 4), [(0.3, hexa), (0.7, hexb)])
    fine = g.noise(P, 40.0, 5)
    col = g.mix(0.3, col, fine, "OVERLAY")
    if rust:
        r = g.mr(g.noise(P, 3.5, 5), 0.52, 0.66)
        col = g.mix(r, col, "#5c3c29")
    return g.out(col, rough, fine, 0.6, 0.004)
# =====================================================================  geometry batches
class Batch:
    def __init__(s, name, material):
        s.name, s.mat = name, material
        s.V, s.F, s.LOC, s.RND = [], [], [], []

    def add(s, pts, faces, M=None, rnd=None, loc=None):
        M = M or Matrix.Identity(4)
        base = len(s.V)
        r = R.random() if rnd is None else rnd
        for i, p in enumerate(pts):
            s.V.append(tuple(M @ Vector(p)))
            s.LOC.append(tuple(loc[i]) if loc else tuple(p))
            s.RND.append(r)
        for f in faces:
            s.F.append([base + i for i in f])

    def build(s):
        if not s.V:
            return None
        me = bpy.data.meshes.new(s.name)
        me.from_pydata(s.V, [], s.F)
        a = me.attributes.new("hg_loc", "FLOAT_VECTOR", "POINT")
        a.data.foreach_set("vector", [c for p in s.LOC for c in p])
        b = me.attributes.new("hg_rnd", "FLOAT", "POINT")
        b.data.foreach_set("value", s.RND)
        me.validate()
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new(s.name, me)
        bpy.context.scene.collection.objects.link(ob)
        L.assign(ob, MAT[s.mat])
        return ob




def B(key, mat=None):
    if key not in BATCHES:
        BATCHES[key] = Batch(key, mat or key)
    return BATCHES[key]


BOX_F = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]


def hull(pts):
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    r = bmesh.ops.convex_hull(bm, input=vs)
    bmesh.ops.delete(bm, geom=list({g for g in r["geom_interior"] + r["geom_unused"] if isinstance(g, bmesh.types.BMVert)}),
                     context="VERTS")
    bmesh.ops.dissolve_limit(bm, angle_limit=0.002, verts=bm.verts[:], edges=bm.edges[:])
    bm.verts.index_update()
    P = [tuple(v.co) for v in bm.verts]
    F = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return P, F


def box_geo(sx, sy, sz, bev=0.0):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    if bev <= 0:
        P = [((-hx, hx)[i & 1], (-hy, hy)[(i >> 1) & 1], (-hz, hz)[(i >> 2) & 1]) for i in range(8)]
        return P, BOX_F
    b = min(bev, hx * 0.45, hy * 0.45, hz * 0.45)
    pts = []
    for sxn in (-1, 1):
        for syn in (-1, 1):
            for szn in (-1, 1):
                pts += [(sxn * hx, syn * (hy - b), szn * (hz - b)),
                        (sxn * (hx - b), syn * hy, szn * (hz - b)),
                        (sxn * (hx - b), syn * (hy - b), szn * hz)]
    return hull(pts)


def TRS(loc, rot=(0, 0, 0)):
    return Matrix.Translation(Vector(loc)) @ Matrix.Rotation(rot[2], 4, "Z") @ \
        Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[0], 4, "X")


def box(bt, lo, hi, bev=0.0, rot=(0, 0, 0), rnd=None):
    """axis-aligned box from lo..hi corners (world), optional small rotation about its centre."""
    lo, hi = Vector(lo), Vector(hi)
    c = (lo + hi) / 2
    d = hi - lo
    P, F = box_geo(abs(d.x), abs(d.y), abs(d.z), bev)
    bt.add(P, F, TRS(c, rot), rnd)


def prism_hull(bt, pts_world, rnd=None, loc=None):
    P, F = hull(pts_world)
    bt.add(P, F, None, rnd)


def beam(bt, p0, p1, w, d, bev=0.012, side=None, rnd=None, ext=0.0, twist=0.0):
    """timber from p0 to p1 (world), cross-section w x d. `side` = the axis the d dimension points along."""
    p0, p1 = Vector(p0), Vector(p1)
    a = (p1 - p0)
    Lh = a.length
    a.normalize()
    side = Vector(side) if side is not None else (Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((0, 1, 0)))
    xax = side.cross(a).normalized()
    yax = a.cross(xax).normalized()
    rot = Matrix((xax, yax, a)).transposed().to_4x4()
    if twist:
        rot = rot @ Matrix.Rotation(twist, 4, "Z")
    M = Matrix.Translation((p0 + p1) / 2) @ rot
    P, F = box_geo(w, d, Lh + 2 * ext, bev)
    bt.add(P, F, M, rnd)


def cyl(bt, p0, p1, r0, r1=None, n=8, rnd=None, bulge=0.0):
    p0, p1 = Vector(p0), Vector(p1)
    a = p1 - p0
    Lh = a.length
    an = a.normalized()
    side = Vector((0, 0, 1)) if abs(an.z) < 0.9 else Vector((0, 1, 0))
    xax = side.cross(an).normalized()
    yax = an.cross(xax)
    r1 = r0 if r1 is None else r1
    rings = 3 if bulge else 2
    pts = []
    for k in range(rings):
        t = k / (rings - 1)
        r = r0 + (r1 - r0) * t + (bulge if k == 1 else 0)
        for i in range(n):
            th = 2 * math.pi * i / n
            pts.append((math.cos(th) * r, math.sin(th) * r, (t - 0.5) * Lh))
    rot = Matrix((xax, yax, an)).transposed().to_4x4()
    P, F = hull(pts)
    bt.add(P, F, Matrix.Translation((p0 + p1) / 2) @ rot, rnd)


# ---------------------------------------------------------------- face frames
class Face:
    """Wall-face frame: u along the face (left->right seen from outside), d inward, v = world z."""

    def __init__(s, origin, n):
        n = Vector(n)
        s.n = n
        s.inw = -n
        s.up = Vector((0, 0, 1))
        s.al = s.inw.cross(s.up)
        s.o = Vector(origin)

    def p(s, u, d, v):
        return s.o + s.al * u + s.inw * d + s.up * v

    def M(s):
        m = Matrix((s.al, s.inw, s.up)).transposed().to_4x4()
        m.translation = s.o
        return m

    def box(s, bt, u0, u1, d0, d1, v0, v1, bev=0.0, rnd=None, tilt=0.0):
        c = s.p((u0 + u1) / 2, (d0 + d1) / 2, (v0 + v1) / 2)
        P, F = box_geo(abs(u1 - u0), abs(d1 - d0), abs(v1 - v0), bev)
        rot = Matrix((s.al, s.inw, s.up)).transposed().to_4x4()
        if tilt:
            rot = rot @ Matrix.Rotation(tilt, 4, "Y")
        bt.add(P, F, Matrix.Translation(c) @ rot, rnd)

    def prism(s, bt, prof_uv, d0, d1, rnd=None):
        pts = [s.p(u, d, v) for (u, v) in prof_uv for d in (d0, d1)]
        prism_hull(bt, pts, rnd)

    def prism_dv(s, bt, prof_dv, u0, u1, rnd=None):
        pts = [s.p(u, d, v) for (d, v) in prof_dv for u in (u0, u1)]
        prism_hull(bt, pts, rnd)

    def timber(s, bt, u0, v0, u1, v1, w=0.2, d=0.18, d0=0.0, bev=0.014, ext=0.0):
        j = 0.012
        beam(bt, s.p(u0 + jit(j), d0 + d / 2 + jit(0.008), v0 + jit(j)),
             s.p(u1 + jit(j), d0 + d / 2 + jit(0.008), v1 + jit(j)), w * R.uniform(0.93, 1.07), d,
             bev, side=s.inw, ext=ext)


def arch_profile(w, h, kind, seg=8):
    r = w / 2
    if kind == "flat":
        return [(-r, 0), (r, 0), (r, h), (-r, h)]
    if kind == "round":
        spring = h - r
        return [(-r, 0), (r, 0)] + [(r * math.cos(a), spring + r * math.sin(a))
                                    for a in [math.pi * i / seg for i in range(seg + 1)]]
    # equilateral lancet
    spring = h - w * 0.866
    pts = [(-r, 0), (r, 0)]
    for i in range(seg // 2 + 1):
        a = math.pi * 2 / 3 * i / (seg // 2) / 2  # 0 .. 60deg
        pts.append((-r + w * math.cos(a), spring + w * math.sin(a)))
        pts.append((r - w * math.cos(a), spring + w * math.sin(a)))
    return pts


def cutter_obj(bt):
    ob = bt.build()
    ob.hide_render = True
    return ob


def apply_boolean(target, cutter):
    mod = target.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutter
    bpy.context.view_layer.objects.active = target
    for o in bpy.context.selected_objects:
        o.select_set(False)
    target.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

# =====================================================================  roofs
def roof_rows(bt, M, x0, x1, eave, ridge, row_w=0.34, lap=0.72, thick=0.035, lift=0.03, sag=0.07,
              seg=8, wob=0.012, stop=None, under=False):
    """courses of tiles/slates from eave (y,z) to ridge (y,z), running along local x.
    stop: fraction of rows to build (for collapsed roofs)."""
    ey, ez = eave
    ry, rz = ridge
    d = Vector((0, ry - ey, rz - ez))
    Ls = d.length
    dn = d / Ls
    n = Vector((1, 0, 0)).cross(dn)
    if n.z < 0:
        n = -n
    step = row_w * lap
    rows = max(2, int(math.ceil((Ls - row_w) / step)) + 1)
    step = (Ls - row_w) / (rows - 1)
    base = Vector((0, ey, ez))
    for r in range(rows):
        if stop is not None and not stop(r / (rows - 1)):
            continue
        s0 = r * step
        rr = R.random()
        pts, loc = [], []
        rl = row_w * R.uniform(0.97, 1.03)
        for k in range(seg + 1):
            t = k / seg
            x = x0 + (x1 - x0) * t + (jit(0.03) if 0 < k < seg else 0)
            sg = -sag * math.sin(math.pi * t) * (0.35 + 0.65 * s0 / Ls)
            wz = jit(wob)
            lo = base + dn * s0
            up = base + dn * (s0 + rl)
            for (P0, off, lyv) in ((lo, 0.0, 0.0), (lo, thick, 0.0), (up, thick * 0.4, rl), (up, -thick * 0.6, rl)):
                lft = lift if lyv == 0.0 else 0.0
                q = Vector((x, P0.y, P0.z)) + n * (off + lft + sg + wz)
                pts.append(tuple(M @ q))
                loc.append((x, lyv, off))
        F = []
        for k in range(seg):
            a = k * 4
            b = a + 4
            for i in range(4 if under else 3):   # underside (3->0) only when asked (thatch overhang)
                j = (i + 1) % 4
                F.append((a + i, a + j, b + j, b + i))
        F.append((0, 1, 2, 3))
        F.append((seg * 4 + 3, seg * 4 + 2, seg * 4 + 1, seg * 4))
        bt.add(pts, F, None, rr, loc)


def ridge_tiles(bt, M, x0, x1, y, z, r=0.14, piece=0.42, n=6):
    x = x0
    while x < x1 - 0.05:
        l = min(piece * R.uniform(0.95, 1.05), x1 - x)
        pts = []
        for xx in (x, x + l + 0.03):
            for i in range(n + 1):
                a = math.pi * i / n
                pts.append(tuple(M @ Vector((xx, y + r * math.cos(a) * 1.1, z + r * math.sin(a) * 0.9 + jit(0.006)))))
        P, F = hull(pts)
        bt.add(P, F, None, None)
        x += l

def door_leaf(f, u, v0, w, h, depth, arch=True):
    """planked oak door with iron straps set back in the opening."""
    n = 6 if w > 1 else 5
    pw = w / n
    prof = arch_profile(w - 0.02, h - 0.01, "round" if arch else "flat")
    for i in range(n):
        ua = u - w / 2 + i * pw
        # height of the arch at this plank's centre
        uc = ua + pw / 2 - u
        if arch:
            r = w / 2
            top = v0 + h - r + math.sqrt(max(0.0, r * r - uc * uc)) - 0.02
        else:
            top = v0 + h
        f.box(B("plank"), ua + 0.004, ua + pw - 0.004, depth - 0.07, depth, v0, top, 0.008)
    for vv in (v0 + 0.35, v0 + h * 0.55):
        f.box(B("iron"), u - w / 2 + 0.05, u + w / 2 - 0.1, depth - 0.09, depth - 0.07, vv, vv + 0.07)
    f.box(B("iron"), u + w / 2 - 0.3, u + w / 2 - 0.22, depth - 0.1, depth - 0.07, v0 + 1.0, v0 + 1.1)

def frame_face(f, length, z0, z1, posts, rails, openings, braces=(), d0=0.0, stud=0.2, slab=True,
               char=False, keep_frac=1.0):
    """timber framing + daub infill on a face. openings: (u0,u1,v0,v1,kind)."""
    oak = B("oak")
    tsel = lambda: (R.random() < keep_frac)
    # posts / studs broken around openings
    for u in posts:
        segs = [(z0, z1)]
        for (a, b, v0, v1, kind) in openings:
            if a - 0.05 < u < b + 0.05:
                new = []
                for (s0, s1) in segs:
                    if s1 <= v0 or s0 >= v1:
                        new.append((s0, s1)); continue
                    if s0 < v0: new.append((s0, v0))
                    if s1 > v1: new.append((v1, s1))
                segs = new
        for (s0, s1) in segs:
            if s1 - s0 > 0.1 and tsel():
                top = s1 if not char else s0 + (s1 - s0) * R.uniform(0.3, 1.0)
                f.timber(oak, u, s0, u, top, stud, 0.18, d0)
    # rails broken around openings
    for v in rails:
        segs = [(-0.1, length + 0.1)]
        for (a, b, v0, v1, kind) in openings:
            if v0 + 0.02 < v < v1 - 0.02:
                new = []
                for (s0, s1) in segs:
                    if s1 <= a or s0 >= b:
                        new.append((s0, s1)); continue
                    if s0 < a: new.append((s0, a))
                    if s1 > b: new.append((b, s1))
                segs = new
        for (s0, s1) in segs:
            # split long rails into lengths with scarf joints
            u = s0
            while u < s1 - 0.05:
                l = min(R.uniform(2.6, 4.2), s1 - u)
                if tsel():
                    f.timber(oak, u, v, u + l, v, 0.19, 0.18, d0 - 0.005, ext=0.0)
                u += l
    for (ua, va, ub, vb) in braces:
        if tsel():
            f.timber(oak, ua, va, ub, vb, 0.16, 0.14, d0 + 0.015, ext=0.05)
    # opening dressings
    for (a, b, v0, v1, kind) in openings:
        if kind == "win":
            f.box(B("dark"), a - 0.05, b + 0.05, d0 + 0.3, d0 + 0.34, v0 - 0.05, v1 + 0.05)
            n = max(2, int((b - a) / 0.42))
            for i in range(1, n):
                uu = a + (b - a) * i / n
                beam(oak, f.p(uu, d0 + 0.11, v0), f.p(uu, d0 + 0.11, v1), 0.085, 0.085, 0.01, side=f.inw,
                         twist=math.pi / 4)
            # a sill + an open shutter on one side
            f.box(oak, a - 0.08, b + 0.08, d0 - 0.04, d0 + 0.16, v0 - 0.1, v0 + 0.01, 0.01)
            if R.random() < 0.7 and not char:
                sw = (b - a) / 2
                hinge = f.p(a - 0.02, d0 - 0.02, (v0 + v1) / 2)
                ang = math.radians(R.uniform(100, 130))
                ddir = -f.al * math.cos(ang) - f.inw * math.sin(ang)
                for k in range(3):
                    vv0 = v0 + 0.03 + k * (v1 - v0 - 0.06) / 3
                    vv1 = vv0 + (v1 - v0 - 0.06) / 3 - 0.012
                    p0 = hinge + ddir * 0.0
                    p1 = hinge + ddir * sw
                    beam(B("plank"), Vector((p0.x, p0.y, vv0)) + ddir * 0.0 + Vector((0, 0, (vv1 - vv0) / 2)),
                         Vector((p1.x, p1.y, vv0)) + Vector((0, 0, (vv1 - vv0) / 2)), vv1 - vv0, 0.035, 0.006,
                         side=Vector((0, 0, 1)).cross(ddir))
        elif kind == "door":
            f.box(B("dark"), a - 0.05, b + 0.05, d0 + 0.3, d0 + 0.34, v0, v1 + 0.05)
            door_leaf(f, (a + b) / 2, v0, b - a, v1 - v0, d0 + 0.2, arch=False)
    if slab:
        s = Batch("daub_%d" % len(BATCHES), "daub")
        f.box(s, -0.02, length + 0.02, d0 + 0.05, d0 + 0.2, z0, z1)
        c = Batch("dcut_%d" % len(BATCHES), "dark")
        for (a, b, v0, v1, kind) in openings:
            f.box(c, a, b, d0 - 0.1, d0 + 0.3, v0, v1)
        BATCHES["_slab%d" % len(BATCHES)] = (s, c)

def grid(a, b, step, jitter=0.04):
    n = max(1, round((b - a) / step))
    return [a + (b - a) * i / n + (jit(jitter) if 0 < i < n else 0) for i in range(n + 1)]

def barrel(p, r=0.3, h=0.85, lying=False):
    p = Vector(p)
    if lying:
        a, b = p + Vector((0, -h / 2, r)), p + Vector((0, h / 2, r))
    else:
        a, b = p, p + Vector((0, 0, h))
    cyl(B("plank"), a, b, r * 0.86, r * 0.86, n=12, bulge=r * 0.14)
    for t in (0.14, 0.86):
        q0 = a.lerp(b, t - 0.04)
        q1 = a.lerp(b, t + 0.04)
        rr = r * 0.86 + r * 0.14 * math.sin(math.pi * t) + 0.012
        cyl(B("iron"), q0, q1, rr, n=12)


def log_pile(x0, y0, x1, z0=0.0, rows=4, r=0.11, length=1.0):
    y = y0
    for row in range(rows):
        n = int((x1 - x0) / (2 * r)) - row
        for i in range(n):
            x = x0 + r + row * r + i * 2 * r + jit(0.02)
            zc = z0 + r + row * r * 1.75
            cyl(B("plank"), (x, y + jit(0.08), zc), (x + jit(0.05), y + length + jit(0.08), zc),
                r * R.uniform(0.8, 1.05), n=7)

def scaffold_face(p0, p1, n, z_top, standoff=1.3):
    """putlog scaffold along a wall face from p0 to p1 (ground points), outward normal n."""
    p0, p1, n = Vector(p0), Vector(p1), Vector(n)
    pl = B("plank")
    oak = B("oak")
    Ln = (p1 - p0).length
    d = (p1 - p0).normalized()
    ns = max(2, int(Ln / 2.4) + 1)
    lifts = [z for z in (1.9, 3.8, 5.7, 7.6, 9.5, 11.4) if z < z_top - 0.3]
    for i in range(ns):
        q = p0 + d * (Ln * i / (ns - 1)) + n * standoff
        cyl(oak, q + Vector((jit(0.05), jit(0.05), 0)), q + Vector((jit(0.12), jit(0.12), z_top + 1.3)), 0.07, 0.055,
            n=6)
    for z in lifts:
        cyl(oak, p0 + n * (standoff + 0.05) + Vector((0, 0, z)) - d * 0.4,
            p1 + n * (standoff + 0.05) + Vector((0, 0, z + jit(0.08))) + d * 0.4, 0.05, n=6)
        for i in range(int(Ln / 1.2) + 1):
            q = p0 + d * (i * 1.2 + 0.3)
            beam(oak, q + Vector((0, 0, z + 0.06)) - n * 0.2, q + n * (standoff + 0.25) + Vector((0, 0, z + 0.06)),
                 0.08, 0.08, 0.0)
        for k in range(3):
            off = 0.25 + k * 0.33
            beam(pl, p0 + n * off + Vector((0, 0, z + 0.13)) - d * 0.1,
                 p1 + n * off + Vector((0, 0, z + 0.13 + jit(0.03))) + d * 0.1, 0.3, 0.04, 0.0, side=(0, 0, 1))
    # ladder
    q = p0 + d * (Ln * 0.3) + n * (standoff + 0.6)
    for s in (-0.22, 0.22):
        beam(oak, q + d * s, q + d * s + Vector((0, 0, lifts[-1] + 1.0)) - n * 0.5, 0.07, 0.07, 0.0)
    for z in [0.3 * k for k in range(1, int((lifts[-1] + 0.8) / 0.3))]:
        t = z / (lifts[-1] + 1.0)
        beam(oak, q - d * 0.22 + Vector((0, 0, z)) - n * 0.5 * t, q + d * 0.22 + Vector((0, 0, z)) - n * 0.5 * t,
             0.04, 0.04, 0.0)


def stone_pile(cx, cy, n=18, r=1.2, big=0.45):
    for i in range(n):
        a = R.uniform(0, 2 * math.pi)
        rr = r * math.sqrt(R.random())
        x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
        h = (r - rr) * 0.6
        s = big * R.uniform(0.5, 1.0)
        box(B("ashlar"), (x - s / 2, y - s * 0.35, h * R.uniform(0.2, 0.9)),
            (x + s / 2, y + s * 0.35, h * R.uniform(0.2, 0.9) + s * 0.55), 0.03,
            rot=(jit(0.3), jit(0.3), R.uniform(0, 3)))


def rubble_heap(cx, cy, rx, ry, h, n=40, mat="rubble"):
    for i in range(n):
        a = R.uniform(0, 2 * math.pi)
        rr = math.sqrt(R.random())
        x, y = cx + math.cos(a) * rr * rx, cy + math.sin(a) * rr * ry
        z = h * (1 - rr * rr) * R.uniform(0.5, 1.0)
        s = R.uniform(0.25, 0.6)
        box(B(mat), (x - s / 2, y - s / 2, max(0, z - s / 2) - 0.1), (x + s / 2, y + s * 0.3, max(0, z - s / 2) + s * 0.6),
            0.04, rot=(jit(0.5), jit(0.5), R.uniform(0, 3)))


def timber_stack(x0, y0, length=4.0, rows=3, along_x=True):
    for r in range(rows):
        for i in range(4 - r):
            off = i * 0.28 + r * 0.14
            z = 0.12 + r * 0.24
            if along_x:
                beam(B("oak"), (x0, y0 + off, z), (x0 + length + jit(0.2), y0 + off, z), 0.24, 0.24, 0.012)
            else:
                beam(B("oak"), (x0 + off, y0, z), (x0 + off, y0 + length + jit(0.2), z), 0.24, 0.24, 0.012)
    for dx in (0.5, length - 0.5):
        if along_x:
            beam(B("plank"), (x0 + dx, y0 - 0.1, 0.0), (x0 + dx, y0 + 1.2, 0.0), 0.12, 0.12, 0.0)


def m_banner(name, Lf, Hf):
    g = G(name)
    loc = g.attr("hg_loc")[0]
    u, _, v = g.sep(loc)
    t = g.math("ABSOLUTE", g.sub(u, Lf * 0.5))
    line = g.sub(Hf * 0.78, g.mul(t, 0.85))
    band = g.inv(g.mr(g.math("ABSOLUTE", g.sub(v, line)), 0.11, 0.13, 0.0, 1.0, False))
    weave = g.noise(g.comb(g.mul(u, 1.0), g.mul(v, 1.0), 0.0), 60.0, 3)
    col = g.mix(band, "#2f5fa8", "#d6c79d")
    col = g.mix(0.35, col, weave, "OVERLAY")
    folds = g.noise(g.comb(g.mul(u, 2.5), g.mul(v, 0.3), 0.0), 1.0, 3)
    col = g.mix(0.4, col, folds, "OVERLAY")
    edge = g.mr(g.mn(g.mn(u, v), g.sub(Hf, v)), 0.0, 0.08)
    col = g.mix(g.mul(g.inv(edge), 0.4), col, "#403a33")
    return g.out(col, 0.9, g.add(g.mul(weave, 0.3), folds), 1.0, 0.01)


# =====================================================================  yard materials
def m_thatch(name, tones, charred=0.0, moss=1.0, fresh=0.0):
    """long-straw / reed thatch: fibres run down the slope (roof_rows loc = (x, along-slope, off))."""
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    off = g.mul(rnd, 53.0)
    fib = g.noise(g.comb(g.mul(lx, 48.0), g.mul(ly, 1.1), off), 1.0, 6, 0.7, 0.3)
    fib2 = g.noise(g.comb(g.mul(lx, 190.0), g.mul(ly, 3.0), off), 1.0, 3, 0.6)
    base = g.add(g.mul(g.noise(P, 0.3, 3), 0.75), g.mul(rnd, 0.25))
    col = g.ramp(base, tones)
    streak = g.mr(fib, 0.3, 0.72, 0.0, 1.0, False)
    col = g.mix(streak, g.mix(1.0, col, (0.62, 0.58, 0.52, 1), "MULTIPLY"), g.mix(1.0, col, (1.2, 1.15, 1.05, 1), "MULTIPLY"))
    col = g.mix(0.45, col, fib2, "OVERLAY")
    gaps = g.mr(fib, 0.34, 0.24)
    col = g.mix(g.mul(gaps, 0.5), col, g.mix(1.0, col, (0.4, 0.37, 0.33, 1), "MULTIPLY"))
    # grey weathering of the older coat, greener algae in damp patches, lighter new patches
    w = g.mr(g.noise(P, 0.22, 3), 0.42, 0.66)
    col = g.mix(g.mul(w, 0.6), col, g.mix(0.7, "#6f6555", fib, "OVERLAY"))
    al = g.mul(g.mr(g.noise(P, 0.55, 4), 0.6, 0.72), 0.45 * moss)
    col = g.mix(al, col, g.ramp(g.noise(P, 5.0), [(0.3, "#4a4a2e"), (0.7, "#5f5d3a")]))
    if fresh > 0:
        nw = g.mul(g.mr(g.noise(P, 0.4, 2), 0.6, 0.7), fresh)
        col = g.mix(nw, col, g.mix(0.7, "#b39a60", fib, "OVERLAY"))
    # butt ends (bottom of every coat) are stubbly and darker
    butt = g.inv(g.mr(ly, 0.0, 0.06))
    stub = g.inv(g.mr(g.vor(g.comb(g.mul(lx, 1.0), g.mul(lz, 1.0), g.mul(ly, 1.0)), 90.0), 0.0, 0.3))
    col = g.mix(g.mul(butt, 0.2), col, g.mix(g.mul(stub, 0.6), "#6e5f42", "#8a7650"))
    x, y, z = g.sep(P)
    if charred > 0:
        ch = g.mul(g.mr(g.noise(P, 0.5, 3), 0.3, 0.55), charred)
        col = g.mix(ch, col, g.mix(0.5, "#2a2521", fib, "OVERLAY"))
    height = g.add(g.mul(fib, 1.0), g.mul(fib2, 0.35))
    height = g.sub(height, g.mul(gaps, 0.5))
    return g.out(col, g.add(0.86, g.mul(al, 0.06)), height, 1.0, 0.03)


def m_turf(name, charred=0.0, dry=0.0):
    """cut turves / earth banks: grass on up-facing faces and the top rim of each turf, soil + roots on the sides."""
    g = G(name)
    P, N = g.P, g.N
    nx, ny, nz = g.sep(N)
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    earth = g.ramp(g.add(g.mul(g.noise(P, 2.5, 4), 0.8), g.mul(rnd, 0.3)),
                   [(0.2, "#3b3229"), (0.5, "#4a3f31"), (0.8, "#5a4d3b")])
    fine = g.noise(P, 38.0, 6, 0.65)
    earth = g.mix(0.5, earth, fine, "OVERLAY")
    roots = g.noise(g.comb(g.mul(g.add(g.sep(P)[0], g.sep(P)[1]), 30.0), g.mul(g.sep(P)[2], 4.0), 0.0), 1.0, 4)
    earth = g.mix(g.mul(g.mr(roots, 0.6, 0.7), 0.5), earth, "#7b6a4c")
    peb = g.inv(g.mr(g.vor(P, 24.0), 0.0, 0.09))
    earth = g.mix(g.mul(peb, g.mr(g.noise(P, 3.0), 0.5, 0.6)), earth, "#8f8672")
    gr = g.ramp(g.add(g.mul(g.noise(P, 2.5, 5), 0.6), g.mul(rnd, 0.3)),
                [(0.2, "#4b5a2e"), (0.5, "#566531"), (0.8, "#646e3a"), (1.0, "#737446")])
    blades = g.noise(P, 90.0, 4, 0.7)
    gr = g.mix(0.55, gr, blades, "OVERLAY")
    dr = g.mul(g.mr(g.noise(P, 1.7, 3), 0.5, 0.66), 0.3 + dry)
    gr = g.mix(dr, gr, g.mix(0.5, "#8c8255", blades, "OVERLAY"))
    edge = g.mul(g.sub(g.noise(P, 14.0, 3), 0.5), 0.25)
    gm = g.mx(g.mr(g.add(nz, edge), 0.3, 0.55), g.mr(g.add(lz, g.mul(edge, 0.12)), 0.035, 0.06))
    col = g.mix(gm, earth, gr)
    x, y, z = g.sep(P)
    if charred > 0:
        ch = g.mul(g.mr(g.noise(P, 0.6, 3), 0.35, 0.6), charred)
        col = g.mix(ch, col, g.mix(0.6, "#2c2723", fine, "OVERLAY"))
    height = g.add(g.mul(g.mix(gm, g.noise(P, 6.0, 4), blades), 1.0), g.mul(fine, 0.3))
    return g.out(col, g.sub(0.93, g.mul(gm, 0.05)), height, 1.0, 0.03)


def m_straw(name, tones, rings=False, halfth=0.1, rr=0.6, charred=0.0):
    """straw: coiled for a target boss (loc z = axis), bundled fibres otherwise."""
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    r = g.node("ShaderNodeVectorMath", [(0, g.comb(lx, ly, 0.0))], operation="LENGTH").outputs["Value"]
    coil = g.noise(g.comb(g.mul(r, 1.0), g.mul(lz, 0.0), g.mul(rnd, 7.0)), 30.0, 3, 0.5, 0.2)
    wisp = g.noise(g.comb(g.mul(lx, 60.0), g.mul(ly, 60.0), g.mul(lz, 4.0)), 1.0, 5, 0.65, 0.5)
    col = g.ramp(g.add(g.mul(g.noise(P, 1.2, 3), 0.7), g.mul(rnd, 0.3)), tones)
    col = g.mix(0.55, col, wisp, "OVERLAY")
    col = g.mix(0.45, col, coil, "OVERLAY")
    face = None
    if rings:
        face = g.mr(g.math("ABSOLUTE", lz), halfth - 0.025, halfth - 0.005)
        t = g.math("DIVIDE", r, rr)
        band = lambda a, b: g.mul(g.mr(t, a - 0.012, a + 0.012), g.inv(g.mr(t, b - 0.012, b + 0.012)))
        ragged = g.mul(g.sub(g.noise(P, 18.0, 3), 0.5), 0.35)
        paint = g.mr(g.add(g.noise(P, 6.0, 3), ragged), 0.3, 0.45)
        rings_c = col
        rings_c = g.mix(g.mul(band(0.0, 0.62), 0.9), rings_c, g.mix(0.35, "#c9c0aa", wisp, "OVERLAY"))
        rings_c = g.mix(g.mul(band(0.0, 0.42), 0.95), rings_c, g.mix(0.3, "#8e3a2a", wisp, "OVERLAY"))
        rings_c = g.mix(g.mul(band(0.0, 0.2), 0.95), rings_c, g.mix(0.3, "#cdc4ad", wisp, "OVERLAY"))
        rings_c = g.mix(g.mul(band(0.0, 0.07), 1.0), rings_c, "#34302b")
        col = g.mix(g.mul(face, paint), col, rings_c)
    if charred > 0:
        ch = g.mul(g.mr(g.noise(P, 1.5, 3), 0.3, 0.55), charred)
        col = g.mix(ch, col, "#2b2622")
    height = g.add(g.mul(wisp, 0.8), g.mul(coil, 0.8))
    return g.out(col, 0.9, height, 1.0, 0.012)


def m_hay(name, charred=0.0, rot_top=0.0):
    g = G(name)
    P = g.P
    x, y, z = g.sep(P)
    _, rnd = g.attr("hg_rnd")
    wisp = g.noise(P, 26.0, 8, 0.7, 1.4)
    wisp2 = g.noise(g.vmul(P, (1.0, 1.0, 3.0)), 70.0, 4, 0.6, 0.8)
    col = g.ramp(g.add(g.mul(g.noise(P, 0.8, 3), 0.8), g.mul(rnd, 0.2)),
                 [(0.15, "#645d3e"), (0.4, "#7b714c"), (0.65, "#908257"), (0.9, "#a09062")])
    col = g.mix(1.0, col, wisp, "OVERLAY")
    col = g.mix(0.6, col, wisp2, "OVERLAY")
    lay = g.noise(g.comb(g.mul(x, 1.5), g.mul(y, 1.5), g.mul(z, 9.0)), 1.0, 3, 0.5)
    col = g.mix(0.5, col, lay, "OVERLAY")
    hol = g.mr(wisp, 0.38, 0.26)
    col = g.mix(g.mul(hol, 0.6), col, "#3e3726")
    if rot_top > 0:
        wt = g.mul(g.mr(g.add(z, g.mul(g.noise(P, 1.5), 0.8)), 1.8, 3.0), rot_top)
        col = g.mix(wt, col, g.mix(0.6, "#6e6553", wisp, "OVERLAY"))
    col, md, mb = g.ground_grime(col, z, 1.0, 0.4, 0.25)
    if charred > 0:
        col = g.mix(charred, col, g.mix(0.6, "#2b2622", wisp, "OVERLAY"))
    return g.out(col, 0.92, g.add(g.add(wisp, g.mul(wisp2, 0.4)), g.mul(lay, 0.6)), 1.0, 0.05)


def m_muck(name):
    g = G(name)
    P = g.P
    x, y, z = g.sep(P)
    col = g.ramp(g.noise(P, 1.5, 4), [(0.25, "#3d3020"), (0.55, "#554329"), (0.85, "#6b5738")])
    fine = g.noise(P, 30.0, 6, 0.6, 0.6)
    col = g.mix(0.5, col, fine, "OVERLAY")
    st = g.noise(P, 18.0, 6, 0.7, 2.0)
    strw = g.mr(st, 0.55, 0.64)
    col = g.mix(g.mul(strw, 0.8), col, g.ramp(g.noise(P, 5.0), [(0.3, "#7d6a3f"), (0.7, "#9a8650")]))
    wet = g.mr(g.noise(P, 0.9, 3), 0.5, 0.62)
    col = g.mix(g.mul(wet, 0.4), col, g.mix(1.0, col, (0.6, 0.6, 0.6, 1), "MULTIPLY"))
    rough = g.sub(0.9, g.mul(wet, 0.42))
    return g.out(col, rough, g.add(g.mul(st, 0.8), fine), 1.0, 0.03)


def m_feather(name):
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    col = g.ramp(g.add(g.mul(rnd, 0.8), g.mul(g.noise(P, 3.0), 0.3)),
                 [(0.1, "#8e8a82"), (0.4, "#c2bdb2"), (0.7, "#d7d2c4"), (0.95, "#a39c8e")])
    barb = g.noise(g.comb(g.mul(lx, 160.0), g.mul(ly, 160.0), g.mul(lz, 20.0)), 1.0, 3, 0.6, 0.3)
    col = g.mix(0.4, col, barb, "OVERLAY")
    bar = g.mr(g.math("SINE", g.mul(g.add(lz, g.mul(rnd, 3.0)), 70.0)), 0.6, 0.9)
    col = g.mix(g.mul(bar, g.gt(rnd, 0.6)), col, g.mix(1.0, col, (0.7, 0.68, 0.64, 1), "MULTIPLY"))
    return g.out(col, 0.75, barb, 0.6, 0.004)


def m_water(name):
    g = G(name)
    P = g.P
    col = g.ramp(g.noise(P, 1.2, 3), [(0.3, "#2a3530"), (0.7, "#35423a")])
    scum = g.mr(g.noise(P, 4.0, 4), 0.62, 0.7)
    col = g.mix(g.mul(scum, 0.6), col, "#4d5534")
    rip = g.noise(P, 9.0, 3)
    return g.out(col, g.add(0.06, g.mul(scum, 0.6)), rip, 0.15, 0.004)


def m_wicker(name, tones=("#6d5a3f", "#8a7552")):
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    ang = g.math("ARCTAN2", ly, lx)
    uv = g.comb(g.mul(ang, 1.0), g.mul(lz, 1.0), 0.0)
    per, mort = g.brick(uv, 0.22, 0.04, 0.006, 0.8, squash=1.0, sf=1)
    col = g.ramp(g.add(g.math("ADD", per, 0.0), g.mul(g.noise(P, 2.0), 0.4)),
                 [(0.2, tones[0]), (0.8, tones[1])])
    col = g.mix(g.mul(mort, 0.8), col, "#2e2720")
    fine = g.noise(P, 50.0, 4)
    col = g.mix(0.3, col, fine, "OVERLAY")
    return g.out(col, 0.85, g.sub(g.math("ADD", per, 0.0), mort), 1.0, 0.006)


def std_materials(ch=0.0):
    """the shared set every yard building uses. ch = char amount (ruins)."""
    MAT["rubble"] = m_stone("rubble", [(0.0, "#9a8f7a"), (0.25, "#b3a68b"), (0.5, "#c0b398"),
                                        (0.75, "#a99d86"), (1.0, "#8d8474")], "#6f675b",
                            rowh=0.26, bw=0.48, charred=ch * 0.8)
    MAT["ashlar"] = m_stone("ashlar", [(0.0, "#a89c83"), (0.4, "#b9ac91"), (0.7, "#b0a48b"),
                                        (1.0, "#9d917b")], "#9a9280", joints=False, bump=0.6, charred=ch * 0.6)
    MAT["oak"] = m_wood("oak", [(0.0, "#4e3b27"), (0.5, "#5f4830"), (1.0, "#6b5236")],
                        weather_hex="#7d7466", weathered=0.55, fresh=0.06, charred=ch)
    MAT["plank"] = m_wood("plank", [(0.0, "#7b6f5e"), (0.5, "#8c8374"), (1.0, "#978a73")],
                          weather_hex="#8f887c", weathered=0.4, fresh=0.1, charred=ch, grain_k=1.2)
    MAT["fresh"] = m_wood("fresh", [(0.0, "#a98a60"), (0.5, "#bf9f70"), (1.0, "#c9a877")],
                          weather_hex="#b09a78", weathered=0.15, charred=ch * 0.5, grain_k=1.3)
    MAT["daub"] = m_daub("daub", charred=ch * 0.7)
    MAT["shingle"] = m_tiles("shingle", [(0.0, "#6c604f"), (0.5, "#80766a"), (1.0, "#8f8474")],
                             cell=0.17, curve=0.15, wood=True, lichen=0.5, charred=ch)
    MAT["thatch"] = m_thatch("thatch", [(0.0, "#66573a"), (0.35, "#7b6942"), (0.65, "#90794b"),
                                         (1.0, "#a28953")], charred=ch)
    MAT["iron"] = m_simple("iron", "#35332f", "#45403a", 0.72, rust=True)
    MAT["dark"] = m_simple("dark", "#2c2621", "#3a3129", 0.9)
    MAT["soil"] = m_simple("soil", "#4a3a2a", "#5f4a35", 0.95, 1.2)
    MAT["rope"] = m_simple("rope", "#7a6a4c", "#958259", 0.9, 8.0)
    MAT["ash"] = m_stone("ashrubble", [(0.0, "#6e675d"), (0.5, "#8d8577"), (1.0, "#5e5850")],
                         "#4a4540", joints=False, charred=0.4)
    MAT["char"] = m_wood("char", [(0.0, "#2b2622"), (0.5, "#35302a"), (1.0, "#3f3831")],
                         weather_hex="#4a443d", weathered=0.3, charred=1.0)


# =====================================================================  yard geometry
def smooth_noise(seed, n=4):
    """cheap smooth periodic noise f(theta) in [-1, 1] from a few random harmonics."""
    rr = random.Random(seed)
    hs = [(k, rr.uniform(0, 6.283), rr.uniform(0.4, 1.0) / k) for k in range(1, n + 1)]
    s = sum(a for _, _, a in hs)
    return lambda th: sum(a * math.sin(k * th + p) for k, p, a in hs) / s


def mound(bt, cx, cy, rx, ry, h, rings=6, seg=18, rough=0.12, power=1.4, rot=0.0, z0=0.0, flat=0.0,
          seed=None, rnd=None):
    """irregular dome/heap as a polar grid, base at z0 (skirts 5 cm below). loc = (dx, dy, height)."""
    seed = R.randint(0, 99999) if seed is None else seed
    fr = smooth_noise(seed, 4)
    fh = smooth_noise(seed + 1, 5)
    ca, sa = math.cos(rot), math.sin(rot)
    pts, loc = [], []
    pts.append((cx, cy, z0 + h * (1 + fh(0.3) * rough * 0.5))); loc.append((0, 0, h))
    for i in range(1, rings + 1):
        t = i / rings
        for j in range(seg):
            th = 2 * math.pi * j / seg
            rad = t * (1 + fr(th) * rough * 1.6 + fh(th * 3 + t * 5) * rough * 0.35)
            px, py = math.cos(th) * rad * rx, math.sin(th) * rad * ry
            if i == rings:
                zz = -0.05
            elif flat:
                zz = h * min(1.0, (1 - t) / max(1e-3, 1 - flat)) ** power * (1 + fh(th + t * 3) * rough * 0.5)
            else:
                zz = h * (max(0.0, 1 - t ** 2)) ** power * (1 + fh(th + t * 3) * rough)
            wx, wy = cx + px * ca - py * sa, cy + px * sa + py * ca
            pts.append((wx, wy, z0 + zz)); loc.append((px, py, max(zz, 0.0)))
    F = []
    for j in range(seg):
        F.append((0, 1 + j, 1 + (j + 1) % seg))
    for i in range(rings - 1):
        a0 = 1 + i * seg
        a1 = a0 + seg
        for j in range(seg):
            jn = (j + 1) % seg
            F.append((a0 + j, a1 + j, a1 + jn, a0 + jn))
    bt.add(pts, F, None, rnd, loc)


def lathe(bt, c, prof, seg=16, rough=0.0, seed=None, rnd=None, cap_top=True, tilt=(0.0, 0.0)):
    """solid of revolution about the z axis through c. prof = [(r, z), ...] bottom->top."""
    seed = R.randint(0, 99999) if seed is None else seed
    fr = smooth_noise(seed, 5)
    c = Vector(c)
    Mt = Matrix.Rotation(tilt[0], 4, "X") @ Matrix.Rotation(tilt[1], 4, "Y")
    pts, loc = [], []
    ring_idx = []
    for (r, z) in prof:
        if r <= 1e-4:
            ring_idx.append([len(pts)])
            pts.append(tuple(c + (Mt @ Vector((0, 0, z))))); loc.append((0, 0, z))
            continue
        idx = []
        for j in range(seg):
            th = 2 * math.pi * j / seg
            rr = r * (1 + rough * fr(th + z * 1.7))
            v = Vector((math.cos(th) * rr, math.sin(th) * rr, z))
            idx.append(len(pts))
            pts.append(tuple(c + (Mt @ v))); loc.append(tuple(v))
        ring_idx.append(idx)
    F = []
    for a, b in zip(ring_idx[:-1], ring_idx[1:]):
        if len(a) == 1 and len(b) > 1:
            for j in range(seg): F.append((a[0], b[(j + 1) % seg], b[j]))
        elif len(b) == 1 and len(a) > 1:
            for j in range(seg): F.append((a[j], a[(j + 1) % seg], b[0]))
        elif len(a) > 1:
            for j in range(seg):
                jn = (j + 1) % seg
                F.append((a[j], a[jn], b[jn], b[j]))
    if cap_top and len(ring_idx[-1]) > 1:
        F.append(tuple(reversed(ring_idx[-1])))
    bt.add(pts, F, None, rnd, loc)


def tube(bt, path, radii, sides=6, rnd=None, caps=True, flat=1.0, rough=0.0):
    """swept polygon along a polyline (parallel-transport frames). loc = (x, y, arclength)."""
    path = [Vector(p) for p in path]
    if not isinstance(radii, (list, tuple)):
        radii = [radii] * len(path)
    n = len(path)
    tans = []
    for i in range(n):
        a = path[max(0, i - 1)]; b = path[min(n - 1, i + 1)]
        tans.append((b - a).normalized())
    up = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = up.cross(tans[0]).normalized()
    pts, loc = [], []
    s = 0.0
    for i in range(n):
        if i > 0:
            s += (path[i] - path[i - 1]).length
            ax = tans[i - 1].cross(tans[i])
            if ax.length > 1e-6:
                ang = tans[i - 1].angle(tans[i])
                nrm = (Matrix.Rotation(ang, 3, ax.normalized()) @ nrm).normalized()
        bi = tans[i].cross(nrm).normalized()
        for k in range(sides):
            th = 2 * math.pi * k / sides + 0.3
            rr = radii[i] * (1 + (R.uniform(-rough, rough) if rough else 0))
            ox, oy = math.cos(th) * rr, math.sin(th) * rr * flat
            pts.append(tuple(path[i] + nrm * ox + bi * oy)); loc.append((ox, oy, s))
    F = []
    for i in range(n - 1):
        a, b = i * sides, (i + 1) * sides
        for k in range(sides):
            kn = (k + 1) % sides
            F.append((a + k, a + kn, b + kn, b + k))
    if caps:
        F.append(tuple(reversed(range(sides))))
        F.append(tuple(range((n - 1) * sides, n * sides)))
    bt.add(pts, F, None, rnd, loc)


def cleft(bt, p0, p1, r, sides=5, rnd=None, sag=0.0):
    """riven (split) timber: irregular polygon section, optional sag in the middle (two hulls)."""
    p0, p1 = Vector(p0), Vector(p1)
    a = (p1 - p0)
    Lh = a.length
    an = a.normalized()
    side = Vector((0, 0, 1)) if abs(an.z) < 0.9 else Vector((0, 1, 0))
    xa = side.cross(an).normalized(); ya = an.cross(xa)
    sec = []
    for k in range(sides):
        th = 2 * math.pi * k / sides + R.uniform(-0.25, 0.25)
        rr = r * R.uniform(0.7, 1.15)
        sec.append((math.cos(th) * rr, math.sin(th) * rr * 0.8))
    mids = [p0, (p0 + p1) / 2 + Vector((0, 0, -sag)) + xa * jit(sag * 0.5), p1] if sag else [p0, p1]
    rr = R.random() if rnd is None else rnd
    for q0, q1 in zip(mids[:-1], mids[1:]):
        pts = []
        for q in (q0, q1):
            for (sx, sy) in sec:
                pts.append(tuple(q + xa * sx + ya * sy))
        P, F = hull(pts)
        # loc for grain: along axis = z
        loc = []
        for p in P:
            v = Vector(p) - p0
            loc.append((v.dot(xa), v.dot(ya), v.dot(an)))
        bt.add(P, F, None, rr, loc)


def post(bt, x, y, h, w=0.16, d=0.14, lean=0.02, cap="slope", z0=-0.05, rot=None):
    """riven oak post with a weathered, sloped/rounded top."""
    rz = R.uniform(-0.25, 0.25) if rot is None else rot
    top = h + jit(0.03)
    pts = []
    for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1), (0, -1.15), (1.12, 0)):
        pts.append((sx * w / 2 * R.uniform(0.9, 1.05), sy * d / 2 * R.uniform(0.9, 1.05), z0))
    for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1), (0, -1.15), (1.12, 0)):
        zt = top - (0.06 if cap == "slope" and sy > 0 else 0.0) - (0.03 if cap == "round" and abs(sx) + abs(sy) > 1.5 else 0)
        pts.append((sx * w / 2 * R.uniform(0.85, 1.0), sy * d / 2 * R.uniform(0.85, 1.0), zt))
    M = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(rz, 4, "Z") @ \
        Matrix.Rotation(jit(lean), 4, "X") @ Matrix.Rotation(jit(lean), 4, "Y")
    P, F = hull(pts)
    bt.add(P, F, M, None, [(p[0], p[1], p[2]) for p in P])


def fence(p0, p1, step=2.6, rails=(0.45, 0.8, 1.15), h=1.3, bt_post=None, bt_rail=None, keep=1.0,
          gap=None, first_post=True, last_post=True, broken=0.0, rail_r=0.055, lean=0.02):
    """post-and-rail run from p0 to p1 (ground xy). gap=(t0,t1) along-run fraction left open (gateway).
    keep: probability each rail exists (build/ruin). broken: probability a rail is snapped + dropped."""
    bp = bt_post or B("oak")
    br = bt_rail or B("plank")
    p0, p1 = Vector((p0[0], p0[1], 0)), Vector((p1[0], p1[1], 0))
    Ln = (p1 - p0).length
    d = (p1 - p0).normalized()
    nb = max(1, round(Ln / step))
    ts = [i / nb for i in range(nb + 1)]
    ps = []
    for i, t in enumerate(ts):
        q = p0.lerp(p1, t) + (Vector((jit(0.04), jit(0.04), 0)) if 0 < i < nb else Vector())
        ps.append(q)
        if (i == 0 and not first_post) or (i == nb and not last_post):
            continue
        post(bp, q.x, q.y, h + jit(0.05), lean=lean, rot=math.atan2(d.y, d.x) + jit(0.12))
    for i in range(nb):
        tm = (ts[i] + ts[i + 1]) / 2
        if gap and gap[0] < tm < gap[1]:
            continue
        for k, z in enumerate(rails):
            if R.random() > keep:
                continue
            a = ps[i] - d * 0.09 + Vector((0, 0, z + jit(0.03)))
            b = ps[i + 1] + d * 0.09 + Vector((0, 0, z + jit(0.03)))
            if broken and R.random() < broken:
                # snapped: one end dropped to the ground
                if R.random() < 0.5:
                    b = a.lerp(b, R.uniform(0.6, 1.0)); b.z = R.uniform(0.02, 0.1); b += Vector((jit(0.3), jit(0.3), 0))
                else:
                    a = b.lerp(a, R.uniform(0.6, 1.0)); a.z = R.uniform(0.02, 0.1); a += Vector((jit(0.3), jit(0.3), 0))
            cleft(br, a, b, rail_r * R.uniform(0.85, 1.15), sag=0.015 * (b - a).length / 2.6)
    return ps


def gate(p0, p1, h=1.25, open_ang=0.0, bt=None):
    """field gate hung at p0 closing toward p1: heel + head stiles, 5 bars, diagonal brace."""
    bt = bt or B("plank")
    p0, p1 = Vector((p0[0], p0[1], 0)), Vector((p1[0], p1[1], 0))
    w = (p1 - p0).length - 0.08
    d0 = (p1 - p0).normalized()
    d = Matrix.Rotation(open_ang, 3, "Z") @ d0
    o = p0 + d * 0.04
    beam(bt, o + Vector((0, 0, 0.12)), o + Vector((0, 0, h)), 0.1, 0.09, 0.01)
    beam(bt, o + d * w + Vector((0, 0, 0.12)), o + d * w + Vector((0, 0, h - 0.05)), 0.08, 0.07, 0.01)
    for k, z in enumerate((0.2, 0.43, 0.66, 0.89, h - 0.04)):
        zz = z + (0.0 if k < 4 else 0)
        beam(bt, o + Vector((0, 0, zz)), o + d * w + Vector((0, 0, zz - 0.02 * k / 4)), 0.09 if k == 4 else 0.07,
             0.04, 0.008, side=Vector((0, 0, 1)).cross(d))
    beam(bt, o + d * 0.06 + Vector((0, 0, 0.22)), o + d * (w - 0.06) + Vector((0, 0, h - 0.08)), 0.07, 0.04, 0.008,
         side=Vector((0, 0, 1)).cross(d))
    for z in (0.3, h - 0.2):
        beam(B("iron"), o + Vector((0, 0, z)), o + d * 0.5 + Vector((0, 0, z)), 0.035, 0.012, 0.0,
             side=Vector((0, 0, 1)).cross(d))


def trough(cx, cy, l=2.2, w=0.7, h=0.6, rot=0.0, stone=True, water=True):
    """hewn trough (stone) or plank trough on bearers, with water."""
    M = Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(rot, 4, "Z")
    bt = B("ashlar") if stone else B("plank")
    t = 0.12 if stone else 0.05
    parts = [((-l / 2, -w / 2, 0.0), (l / 2, w / 2, 0.14 if stone else 0.3)),
             ((-l / 2, -w / 2, 0.0), (l / 2, -w / 2 + t, h)), ((-l / 2, w / 2 - t, 0.0), (l / 2, w / 2, h)),
             ((-l / 2, -w / 2, 0.0), (-l / 2 + t, w / 2, h)), ((l / 2 - t, -w / 2, 0.0), (l / 2, w / 2, h))]
    if not stone:
        parts[0] = ((-l / 2, -w / 2, 0.22), (l / 2, w / 2, 0.28))
        for sx in (-l / 2 + 0.25, l / 2 - 0.25):
            prism_hull(B("oak"), [tuple(M @ Vector(p)) for p in
                                  [(sx - 0.08, -w / 2 - 0.1, 0), (sx + 0.08, -w / 2 - 0.1, 0), (sx - 0.08, w / 2 + 0.1, 0),
                                   (sx + 0.08, w / 2 + 0.1, 0), (sx - 0.08, -w / 2 - 0.1, 0.22), (sx + 0.08, -w / 2 - 0.1, 0.22),
                                   (sx - 0.08, w / 2 + 0.1, 0.22), (sx + 0.08, w / 2 + 0.1, 0.22)]])
    for lo, hi in parts:
        lo2 = Vector(lo) + Vector((jit(0.01), jit(0.01), 0)); hi2 = Vector(hi) + Vector((jit(0.01), jit(0.01), jit(0.015)))
        P, F = box_geo(*(hi2 - lo2), 0.02)
        bt.add(P, F, M @ Matrix.Translation((lo2 + hi2) / 2), None)
    if water:
        wz = h - 0.12
        zb = 0.14 if stone else 0.28
        P, F = box_geo(l - 2 * t + 0.01, w - 2 * t + 0.01, wz - zb)
        B("water").add(P, F, M @ Matrix.Translation((0, 0, (wz + zb) / 2)), 0.5)


def ladder(p0, p1, w=0.45, rung=0.3, bt=None):
    bt = bt or B("plank")
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0)
    Ln = d.length
    dn = d.normalized()
    side = Vector((0, 0, 1)).cross(dn)
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    for s in (-w / 2, w / 2):
        cyl(bt, p0 + side * s, p1 + side * s, 0.035, 0.03, n=5)
    k = rung
    while k < Ln - 0.1:
        q = p0 + dn * k
        cyl(bt, q - side * (w / 2 + 0.03), q + side * (w / 2 + 0.03), 0.018, n=4)
        k += rung


def pitchfork(p0, p1):
    p0, p1 = Vector(p0), Vector(p1)
    tube(B("plank"), [p0, p1], 0.018, sides=5)
    d = (p1 - p0).normalized()
    side = Vector((0, 0, 1)).cross(d)
    if side.length < 1e-3: side = Vector((1, 0, 0))
    side.normalize()
    for s in (-0.06, 0.0, 0.06):
        a = p1 + side * s * 0.5
        tube(B("iron"), [a, a + d * 0.12 + side * s, a + d * 0.32 + side * s * 1.1], [0.007, 0.006, 0.003], sides=4)


def barrow(cx, cy, rot=0.0, load=None):
    """13th-c. wheelbarrow: plank box on two long handles over a spoked wheel."""
    M = Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(rot, 4, "Z")
    W = lambda x, y, z: tuple(M @ Vector((x, y, z)))
    for s in (-0.28, 0.28):
        beam(B("oak"), W(0.55, s * 0.8, 0.3), W(-0.95, s, 0.52), 0.06, 0.06, 0.008)
        beam(B("oak"), W(-0.55, s, 0.0), W(-0.55, s, 0.42), 0.05, 0.05, 0.006)
    for (x0, x1, y0, y1, z0, z1) in ((-0.5, 0.35, -0.3, 0.3, 0.36, 0.4), (-0.5, 0.35, -0.32, -0.29, 0.38, 0.65),
                                     (-0.5, 0.35, 0.29, 0.32, 0.38, 0.65), (-0.52, -0.49, -0.3, 0.3, 0.38, 0.68),
                                     (0.32, 0.36, -0.3, 0.3, 0.38, 0.6)):
        P, F = box_geo(x1 - x0, y1 - y0, z1 - z0, 0.006)
        B("plank").add(P, F, M @ Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), None)
    wc = Vector(W(0.55, 0, 0.27))
    ax = (M.to_3x3() @ Vector((0, 1, 0))).normalized()
    cyl(B("plank"), wc - ax * 0.03, wc + ax * 0.03, 0.27, n=12)
    cyl(B("iron"), wc - ax * 0.035, wc + ax * 0.035, 0.28, 0.28, n=12)
    if load == "muck":
        mound(B("muck"), *W(-0.08, 0, 0.0)[:2], 0.38, 0.26, 0.2, rings=3, seg=10, z0=0.55, rot=rot)
    elif load == "turf":
        for i in range(3):
            P, F = box_geo(0.4, 0.28, 0.1, 0.01)
            B("turf").add(P, F, M @ Matrix.Translation((-0.1 + jit(0.1), jit(0.08), 0.46 + i * 0.1)) @
                          Matrix.Rotation(jit(0.2), 4, "Z"), None)


def basket(cx, cy, r=0.28, h=0.4, fill=None):
    lathe(B("wicker"), (cx, cy, 0), [(r * 0.8, 0.0), (r, h * 0.6), (r * 1.05, h)], seg=12, rough=0.04, cap_top=False)
    lathe(B("wicker"), (cx, cy, 0), [(r * 0.98, h), (r * 0.9, h * 0.1), (0.0, 0.02)], seg=12, cap_top=False)
    if fill:
        mound(B(fill), cx, cy, r * 0.95, r * 0.95, 0.12, rings=3, seg=12, z0=h - 0.04, rough=0.2)


def arrow(tip, direc, length=0.76, bt_shaft=None, fletch=True, head=True):
    """a single arrow from its tip back along -direc (so direc points where it flies)."""
    tip = Vector(tip); dn = Vector(direc).normalized()
    nock = tip - dn * length
    bt = bt_shaft or B("fresh")
    tube(bt, [nock, tip - dn * 0.04], 0.0055, sides=4, caps=False)
    if head:
        side = Vector((0, 0, 1)).cross(dn)
        if side.length < 1e-3: side = Vector((1, 0, 0))
        side.normalize(); up = dn.cross(side)
        B("iron").add([tuple(tip), tuple(tip - dn * 0.06 + side * 0.009), tuple(tip - dn * 0.06 - side * 0.009),
                       tuple(tip - dn * 0.06 + up * 0.009), tuple(tip - dn * 0.06 - up * 0.009)],
                      [(0, 1, 3), (0, 3, 2), (0, 2, 4), (0, 4, 1), (1, 4, 2, 3)])
    if fletch:
        side = Vector((0, 0, 1)).cross(dn)
        if side.length < 1e-3: side = Vector((1, 0, 0))
        side.normalize(); up = dn.cross(side)
        for v in (side, (up * 0.87 - side * 0.5), (-up * 0.87 - side * 0.5)):
            a = nock + dn * 0.03
            b = nock + dn * 0.2
            pts = [tuple(a), tuple(b), tuple(b + v * 0.004), tuple(a + v * 0.022)]
            B("feather").add(pts, [(0, 1, 2, 3), (3, 2, 1, 0)], None, None,
                             [(0, 0, 0), (0, 0, 0.17), (0.004, 0, 0.17), (0.022, 0, 0)])


def arrow_sheaf(c, direc=(0, 0, 1), n=24, length=0.76, tie=True):
    """a sheaf of 24 arrows bound at the waist, as one waisted bundle (cheap)."""
    c = Vector(c); dn = Vector(direc).normalized()
    # shafts section: lathe-like tube with a waist
    p0 = c; p1 = c + dn * length
    tube(B("fresh"), [p0, p0.lerp(p1, 0.35), p0.lerp(p1, 0.5), p0.lerp(p1, 0.72)],
         [0.045, 0.034, 0.03, 0.05], sides=8, caps=True, rough=0.05)
    tube(B("feather"), [p0.lerp(p1, 0.72), p0.lerp(p1, 0.8), p0.lerp(p1, 0.97), p1],
         [0.05, 0.078, 0.072, 0.04], sides=9, caps=True, rough=0.12)
    tube(B("iron"), [p0 - dn * 0.05, p0], [0.02, 0.04], sides=8, caps=True)
    if tie:
        tube(B("rope"), [p0.lerp(p1, 0.47), p0.lerp(p1, 0.53)], 0.034, sides=8)


def bow_stave(p0, p1, r=0.017, bend=0.03, strung=False, bt=None):
    """longbow stave: D-section, tapering to the nocks, gentle follow."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    side = Vector((0, 0, 1)).cross(d.normalized())
    if side.length < 1e-3: side = Vector((1, 0, 0))
    side.normalize()
    pts, rad = [], []
    for i in range(9):
        t = i / 8
        pts.append(p0 + d * t + side * bend * math.sin(math.pi * t))
        rad.append(r * (0.45 + 0.55 * math.sin(math.pi * (0.1 + 0.8 * t))))
    tube(bt or B("fresh"), pts, rad, sides=5, flat=0.8)
    if strung:
        tube(B("rope"), [pts[0], pts[-1]], 0.0035, sides=3, caps=False)


def billet(bt, p0, p1, r):
    """cleft stave billet: a pie-slice of a log (bark on the back)."""
    p0, p1 = Vector(p0), Vector(p1)
    a = (p1 - p0).normalized()
    side = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((0, 1, 0))
    xa = side.cross(a).normalized(); ya = a.cross(xa)
    th0 = R.uniform(0, 6.28); span = R.uniform(0.9, 1.4)
    sec = [(0.0, 0.0)] + [(math.cos(th0 + span * k / 4) * r, math.sin(th0 + span * k / 4) * r) for k in range(5)]
    pts = [tuple(q + xa * sx + ya * sy + a * jit(0.02)) for q in (p0, p1) for (sx, sy) in sec]
    P, F = hull(pts)
    loc = [((Vector(p) - p0).dot(xa), (Vector(p) - p0).dot(ya), (Vector(p) - p0).dot(a)) for p in P]
    bt.add(P, F, None, None, loc)


def yealm_stack(cx, cy, n=12, rot=0.0):
    """bundles of prepared thatching straw (yealms) stacked for build states."""
    for i in range(n):
        row = i // 4; k = i % 4
        a = rot + jit(0.15)
        dx, dy = math.cos(a), math.sin(a)
        ox = cx - math.sin(rot) * (k * 0.34 - 0.5) + jit(0.03)
        oy = cy + math.cos(rot) * (k * 0.34 - 0.5) + jit(0.03)
        z = 0.16 + row * 0.26
        tube(B("thatch"), [(ox - dx * 0.7, oy - dy * 0.7, z), (ox, oy, z + 0.02), (ox + dx * 0.7, oy + dy * 0.7, z)],
             [0.15, 0.1, 0.15], sides=9, rough=0.15)


# =====================================================================  thatched roof

def thatch_rows(bt, M, x0, x1, eave, ridge, T=0.34, step=0.3, delta=0.07, lift=0.0, sag=0.1, seg=10, wob=0.03,
                stop=None):
    """coats of thatch from eave to ridge along local x. Each coat is a thin wedge whose butt shows only
    a `delta` step above the coat below (no buried area wasted in the bake atlas). The first coat shows
    the full eave thickness T and its underside."""
    ey, ez = eave
    ry, rz = ridge
    d = Vector((0, ry - ey, rz - ez))
    Ls = d.length
    dn = d / Ls
    n = Vector((1, 0, 0)).cross(dn)
    if n.z < 0:
        n = -n
    rows = max(1, int(math.ceil(Ls / step)))
    step = Ls / rows
    base = Vector((0, ey, ez))
    Lr = step * 1.25
    for r in range(rows):
        if stop is not None and not stop(r / max(1, rows - 1)):
            continue
        s0 = r * step
        first = r == 0 or (stop is not None and not stop((r - 1) / max(1, rows - 1)))
        rr = R.random()
        wf = smooth_noise(R.randint(0, 99999), 4)
        pts, loc = [], []
        # rows near the ridge taper off (thinner coats up top)
        Tr = T * (1.0 - 0.25 * s0 / Ls)
        b0 = 0.0 if first else Tr - delta - 0.035
        prof = [(0.0, b0), (0.0, Tr), (Lr, Tr - delta), (Lr, 0.0 if first else Tr - delta - 0.035)]
        for k in range(seg + 1):
            t = k / seg
            x = x0 + (x1 - x0) * t
            sg = -sag * math.sin(math.pi * t) * (0.35 + 0.65 * s0 / Ls)
            wz = wob * wf(x * 2.3 + 1.7)
            wv = 0.02 * wf(x * 0.8)
            for (a, o) in prof:
                q = Vector((x, 0, 0)) + base + dn * (s0 + a + (wv if a == 0.0 and r > 0 else 0.0)) + n * (o + sg + wz + lift)
                pts.append(tuple(M @ q))
                loc.append((x, a, o))
        F = []
        for k in range(seg):
            a = k * 4
            b = a + 4
            F.append((a + 0, a + 1, b + 1, b + 0))      # butt
            F.append((a + 1, a + 2, b + 2, b + 1))      # top
            if first:
                F.append((a + 3, a + 0, b + 0, b + 3))  # underside of the eave coat
        F.append((0, 1, 2, 3))
        F.append((seg * 4 + 3, seg * 4 + 2, seg * 4 + 1, seg * 4))
        bt.add(pts, F, None, rr, loc)
    return Ls

def thatch_roof(x0, x1, eave, ridge, M=None, thick=0.32, row_w=0.9, lap=0.6, sag=0.12, verge=0.3,
                stop=None, gaps=(), apron=True, seg=10, bt=None, ridge_cap=True, verges=True, lift=0.02):
    """both slopes of a gabled thatched roof along local x from x0..x1.
    eave = (y, z) of the FRONT eave (y < ridge y); the back slope is mirrored about ridge y.
    gaps = [(xa, xb, tmax)]: skip front courses below fraction tmax between xa..xb (for dormers)."""
    bt = bt or B("thatch")
    M = M or Matrix.Identity(4)
    ey, ez = eave
    ry, rz = ridge
    mir = M @ Matrix.Translation((0, 2 * ry, 0)) @ Matrix.Scale(-1, 4, (0, 1, 0))
    kw = dict(T=thick, step=row_w * lap, delta=0.014, lift=lift, sag=sag, seg=seg, wob=0.01)
    for side, MM in ((0, M), (1, mir)):
        pieces = [(x0 - verge, x1 + verge, None)]
        if side == 0 and gaps:
            pieces = []
            xa = x0 - verge
            for (ga, gb, tm) in sorted(gaps):
                pieces.append((xa, ga, None))
                pieces.append((ga, gb, tm))
                xa = gb
            pieces.append((xa, x1 + verge, None))
        for (a, b, tm) in pieces:
            st = stop
            if tm is not None:
                st = (lambda t, tm=tm, s0=stop: t > tm and (s0 is None or s0(t)))
            thatch_rows(bt, MM, a, b, (ey, ez), (ry, rz), stop=st, **kw)
    # geometry of the slope for trims
    d = Vector((0, ry - ey, rz - ez)); Ls = d.length; dn = d / Ls
    n = Vector((1, 0, 0)).cross(dn)
    if n.z < 0: n = -n
    surf = lambda s: Vector((0, ey, ez)) + dn * s + n * (thick * 0.8 - 0.04 + lift)
    # verge rolls: rounded edges on the gables
    for xv in ((x0 - verge + 0.02, x1 + verge - 0.02) if verges else ()):
        for MM in (M, mir):
            path = [MM @ (surf(Ls * t) - n * (thick * 0.45) + Vector((xv, 0, 0))) for t in (0.0, 0.33, 0.66, 0.97)]
            tube(bt, path, thick * 0.55, sides=7, caps=True, flat=0.8)
    # ridge: roll + scalloped apron + hazel liggers & spars
    if not ridge_cap:
        return
    rl = []
    x = x0 - verge * 0.6
    while x < x1 + verge * 0.6 - 0.01:
        rl.append(x); x += 0.5
    rl.append(x1 + verge * 0.6)
    tube(bt, [M @ Vector((xx, ry, (surf(Ls)).z + 0.05 + jit(0.015))) for xx in rl], 0.26, sides=8, flat=0.75)
    if not apron:
        return
    ap = 0.85
    for MM in (M, mir):
        x = x0 - verge * 0.5
        k = 0
        while x < x1 + verge * 0.5 - 0.1:
            w = min(0.55, x1 + verge * 0.5 - x)
            s_top = Ls + 0.05
            s_lo = Ls - ap
            pts = []
            for (px, s, o) in ((x, s_top, 0.0), (x + w, s_top, 0.0), (x, s_lo + 0.14, 0.0), (x + w, s_lo + 0.14, 0.0),
                               (x + w / 2, s_lo, 0.0)):
                q = surf(min(s, Ls)) + dn * (s - min(s, Ls)) + Vector((px, 0, 0))
                pts += [tuple(MM @ (q - n * 0.06)), tuple(MM @ (q + n * (0.1 if s > s_lo + 0.05 else 0.03)))]
            prism_hull(bt, pts)
            x += w; k += 1
        # liggers (hazel rods) along the apron + zig-zag spars between them
        for s in (Ls - ap * 0.35, Ls - ap * 0.7):
            path = [MM @ (surf(s) + n * 0.1 + Vector((xx, 0, jit(0.01)))) for xx in rl]
            tube(B("plank"), path, 0.013, sides=4, caps=False)
        xs = rl[0]
        while xs < rl[-1] - 0.25:
            a = MM @ (surf(Ls - ap * 0.35) + n * 0.11 + Vector((xs, 0, 0)))
            b = MM @ (surf(Ls - ap * 0.7) + n * 0.11 + Vector((xs + 0.22, 0, 0)))
            c = MM @ (surf(Ls - ap * 0.35) + n * 0.11 + Vector((xs + 0.44, 0, 0)))
            tube(B("plank"), [a, b], 0.01, sides=3, caps=False)
            tube(B("plank"), [b, c], 0.01, sides=3, caps=False)
            xs += 0.44


def slope_frame(eave, ridge, thick):
    """helper returning (dn, n, Ls) for a slope from eave to ridge in local yz."""
    ey, ez = eave; ry, rz = ridge
    d = Vector((0, ry - ey, rz - ez)); Ls = d.length; dn = d / Ls
    n = Vector((1, 0, 0)).cross(dn)
    if n.z < 0: n = -n
    return dn, n, Ls


def plank_wall(f, u0, u1, v0, v1, d0=0.0, bw=0.26, t=0.035, bt=None, keep=1.0, ragged=0.0, gap=0.008):
    """vertical boarding on face f from u0..u1, v0..v1 (outer face at depth d0)."""
    bt = bt or B("plank")
    u = u0
    while u < u1 - 0.02:
        w = min(bw * R.uniform(0.8, 1.2), u1 - u)
        if R.random() < keep:
            top = v1 + jit(0.01)
            bot = v0 + jit(0.01) + (R.uniform(0, ragged) if ragged else 0)
            if ragged and R.random() < 0.3:
                top = v0 + (v1 - v0) * R.uniform(0.4, 0.9)
            f.box(bt, u + gap / 2, u + w - gap / 2, d0 + jit(0.004), d0 + t, bot, top, 0.0, tilt=jit(0.006))
        u += w


def stable_door(f, u0, u1, v0, v1, d0, open_top=False, open_all=False, bt=None):
    """two-leaf stable door (lower and upper leaf), ledged + braced, strap hinges on the left."""
    bt = bt or B("plank")
    w = u1 - u0
    vm = v0 + (v1 - v0) * 0.52
    f.box(B("dark"), u0 - 0.02, u1 + 0.02, d0 + 0.25, d0 + 0.3, v0, v1)   # interior darkness
    for (a, b, is_top) in ((v0 + 0.02, vm - 0.01, False), (vm + 0.01, v1 - 0.01, True)):
        if (is_top and (open_top or open_all)) or (not is_top and open_all):
            # leaf swung open ~110 deg against the wall, hinged at u0
            ang = math.radians(R.uniform(100, 125))
            hinge = f.p(u0 - 0.02, d0, 0)
            dd = -f.al * math.cos(ang) - f.inw * math.sin(ang)
            nb = max(3, int(w / 0.2))
            for k in range(nb):
                s0 = w * k / nb
                q0 = hinge + dd * (s0 + 0.004)
                q1 = hinge + dd * (s0 + w / nb - 0.004)
                c = (q0 + q1) / 2
                beam(bt, Vector((c.x, c.y, a)), Vector((c.x, c.y, b)), (w / nb) - 0.008, 0.035, 0.005,
                     side=Vector((0, 0, 1)).cross(dd))
            continue
        nb = max(3, int(w / 0.2))
        for k in range(nb):
            ua = u0 + w * k / nb
            f.box(bt, ua + 0.004, ua + w / nb - 0.004, d0 + 0.05 + jit(0.003), d0 + 0.085, a, b, 0.005)
        # ledges + brace (on the outside, as on stable doors)
        f.box(bt, u0 + 0.06, u1 - 0.06, d0 + 0.015, d0 + 0.05, a + 0.08, a + 0.2, 0.006)
        f.box(bt, u0 + 0.06, u1 - 0.06, d0 + 0.015, d0 + 0.05, b - 0.2, b - 0.08, 0.006)
        f.timber(bt, u0 + 0.12, a + 0.2, u1 - 0.12, b - 0.2, 0.1, 0.035, d0 + 0.015, 0.006)
        for vv in (a + 0.12, b - 0.14):
            f.box(B("iron"), u0 - 0.03, u0 + w * 0.6, d0 + 0.0, d0 + 0.016, vv, vv + 0.05)
    # latch
    f.box(B("iron"), u1 - 0.18, u1 - 0.08, -0.0 + d0, d0 + 0.02, vm - 0.12, vm - 0.07)


# =====================================================================  finalize
def depth_in_solid(p):
    best = 0.0
    for lo, hi in SOLIDS:
        if all(lo[i] < p[i] < hi[i] for i in range(3)):
            best = max(best, min(p[0] - lo[0], hi[0] - p[0], p[1] - lo[1], hi[1] - p[1], p[2] - lo[2], hi[2] - p[2]))
    return best


def cleanup_bottoms(no_cull=()):
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        bm = bmesh.new(); bm.from_mesh(o.data)
        kill = [f for f in bm.faces if f.normal.z < -0.95 and all(v.co.z < 0.005 for v in f.verts)]
        if SOLIDS and not (no_cull and o.name.startswith(tuple(no_cull))):
            ks = set(kill)
            kill += [f for f in bm.faces if f not in ks and
                     depth_in_solid(f.calc_center_median() + f.normal * 0.3) >= 0.35]
        if kill:
            bmesh.ops.delete(bm, geom=kill, context="FACES_ONLY")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(o.data); bm.free()


def finalize(name, tex=2048, lods=(1.0, 0.4, 0.12), no_cull=()):
    for k, v in list(BATCHES.items()):
        if isinstance(v, tuple):
            s, c = v
            ob = s.build()
            if c is not None and c.F:
                apply_boolean(ob, cutter_obj(c))
        elif not k.startswith("_"):
            v.build()
    cleanup_bottoms(no_cull)
    stats = {}
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and not o.hide_render:
            k = o.data.materials[0].name if o.data.materials else "?"
            t, a = stats.get(k, (0, 0))
            stats[k] = (t + sum(len(p.vertices) - 2 for p in o.data.polygons), a + sum(p.area for p in o.data.polygons))
    tot = 0
    for k, (t, a) in sorted(stats.items(), key=lambda x: -x[1][0]):
        print("HG_STAT %-10s tris %6d area %7.1f" % (k, t, a))
        tot += t
    print("HG_TRIS_PRE", tot)
    for o in [o for o in bpy.context.scene.objects if o.hide_render]:
        bpy.data.objects.remove(o, do_unlink=True)
    if os.environ.get("HG_DRY"):
        return
    L.finish(name, tex=tex, lods=lods)
