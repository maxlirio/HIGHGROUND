"""HIGHGROUND - shared kit for the craft/camp buildings (blacksmith, weaver, lumber_camp, mining_camp).

Node-material helper, geometry batches and construction helpers lifted from town_hall.py
(the approved proof asset) plus extra materials/props for workshops: thatch, bark + end grain,
charcoal, ore, wool, dyed cloth, water, earth mounds, logs.

A script does:
    from _craft import *        # sets STATE / FULL / RUIN / B1 / B2 from argv or HG_STATE
    build_materials()
    ... geometry into B("<mat>") batches ...
    run("<name>")               # materialise, cull, stats, L.finish
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector, Matrix
import _lib as L

_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
STATE = os.environ.get("HG_STATE") or (_argv[0] if _argv else "complete")
assert STATE in ("complete", "build1", "build2", "ruin"), STATE
FULL = STATE == "complete"
RUIN = STATE == "ruin"
B2 = STATE == "build2"
B1 = STATE == "build1"

R = random.Random(11)

# All four states of a building must share one pivot, so geometry is authored centred on the
# footprint (x/y origin = footprint centre, z=0 = ground) and finish() must not re-centre it
# on each state's own bounding box (scaffolds / rubble would shift the building between states).
L.ground_origin = lambda objs: None


def seed(s):
    L.reset(seed=s)
    R.seed(s * 13 + 5)


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


MAT = {}


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
            q = M @ Vector(p)
            s.V.append((q.x, q.y, max(q.z, 0.0)))
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


BATCHES = {}


def B(key, mat=None):
    if key not in BATCHES:
        BATCHES[key] = Batch(key, mat or key)
    return BATCHES[key]


BOX_F = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]


def hull(pts):
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    r = bmesh.ops.convex_hull(bm, input=vs)
    dead = list({g for g in r["geom_interior"] + r["geom_unused"] if isinstance(g, bmesh.types.BMVert)})
    if dead:
        bmesh.ops.delete(bm, geom=dead, context="VERTS")
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


# =====================================================================  masonry features
SOLIDS = []  # boxes (lo, hi) used to skip hidden detail


def hidden(p, pad=0.0):
    for lo, hi in SOLIDS:
        if all(lo[i] + pad < p[i] < hi[i] - pad for i in range(3)):
            return True
    return False


def edges_of(outline, closed=True):
    n = len(outline)
    out = []
    for i in range(n if closed else n - 1):
        a, b = Vector(outline[i] + (0,)), Vector(outline[(i + 1) % n] + (0,))
        d = (b - a)
        nrm = Vector((d.y, -d.x, 0)).normalized()
        out.append((a, b, nrm))
    return out


def plinth(outline, closed=True, h=1.15, proud=0.42, bt=None):
    bt = bt or B("rubble")
    for a, b, nrm in edges_of(outline, closed):
        f = Face(a, nrm)
        Lh = (b - a).length
        prof = [(-proud, 0), (0.3, 0), (0.3, h), (-0.03, h), (-proud, 0.28)]
        f.prism_dv(bt, prof, -proud, Lh + proud)


def string_course(outline, z, closed=True, seg=1.25, proud=0.13, skipfn=None, bt=None):
    bt = bt or B("ashlar")
    for a, b, nrm in edges_of(outline, closed):
        f = Face(a, nrm)
        Lh = (b - a).length
        u = -proud
        end = Lh + proud
        while u < end - 0.05:
            l = min(seg * R.uniform(0.75, 1.2), end - u)
            if l < 0.25 and u > -proud:
                l = end - u
            mid = f.p(u + l / 2, 0, z)
            if not (skipfn and skipfn(mid)) and not hidden(mid, 0.15):
                prof = [(-proud, z), (0.22, z), (0.22, z + 0.26), (-0.015, z + 0.26), (-proud, z + 0.15)]
                f.prism_dv(bt, prof, u + 0.006, u + l - 0.006)
            u += l


def quoins(corner, nA, nB, z0, z1, course=0.43, la=0.62, lb=0.34, proud=0.022, bt=None):
    """long-and-short quoin blocks on a convex corner. nA, nB = outward normals of the two faces."""
    bt = bt or B("ashlar")
    C = Vector(corner + (0,)) if len(corner) == 2 else Vector(corner)
    nA, nB = Vector(nA), Vector(nB)
    z = z0
    k = 0
    while z < z1 - 0.1:
        hgt = min(course * R.uniform(0.88, 1.1), z1 - z)
        a_len, b_len = (la, lb) if k % 2 == 0 else (lb, la)
        a_len *= R.uniform(0.9, 1.12); b_len *= R.uniform(0.9, 1.12)
        # along face A goes -nB, along face B goes -nA
        p0 = C + nA * proud + nB * proud
        p1 = C - nB * a_len - nA * b_len
        lo = Vector((min(p0.x, p1.x), min(p0.y, p1.y), z + 0.007))
        hi = Vector((max(p0.x, p1.x), max(p0.y, p1.y), z + hgt - 0.007))
        if not hidden((lo + hi) / 2, 0.2):
            box(bt, lo, hi, 0.0, rot=(0, 0, jit(0.008)))
        z += hgt
        k += 1


def merlons(f, u0, u1, v0, dd0, dd1, mw=1.0, gap=0.62, mh=1.05, bt=None, slits=False):
    """merlons on a parapet in face frame f between u0..u1, thickness d0..d1."""
    bt = bt or B("rubble")
    span = u1 - u0
    n = max(1, int((span + gap) / (mw + gap)))
    w = (span - (n - 1) * gap) / n
    for i in range(n):
        a = u0 + i * (w + gap)
        hh = mh * R.uniform(0.96, 1.04)
        dm = (dd0 + dd1) / 2
        prof = []
        for u in (a + jit(0.01), a + w + jit(0.01)):
            prof += [(u, dd0, v0), (u, dd1, v0), (u, dd0, v0 + hh), (u, dd1, v0 + hh), (u, dm, v0 + hh + 0.13)]
        prism_hull(bt, [f.p(*p) for p in prof])


def window(f, cut, u, v0, w, h, kind="round", depth=0.75, twin=False, surround=True, backdark=True):
    """cut an opening in face f: cutter prisms go to `cut` batch, dressings to ashlar/dark."""
    lights = [(u - (w / 2 + 0.12), w), (u + (w / 2 + 0.12), w)] if twin else [(u, w)]
    ash = B("ashlar")
    for (uc, ww) in lights:
        prof = [(uc + a, v0 + b) for (a, b) in arch_profile(ww, h, kind)]
        f.prism(cut, prof, -0.4, depth)
        if backdark:
            f.box(B("dark"), uc - ww / 2 - 0.02, uc + ww / 2 + 0.02, depth - 0.07, depth - 0.02, v0 - 0.02, v0 + h)
        if not surround:
            continue
        r = ww / 2
        # voussoirs / lintel
        if kind in ("round", "lancet"):
            spring = v0 + h - (r if kind == "round" else ww * 0.866)
            nv = 7 if kind == "round" else 6
            ro = r + 0.27
            for i in range(nv):
                a0, a1 = math.pi * i / nv, math.pi * (i + 1) / nv
                pts = []
                for a in (a0 + 0.012, a1 - 0.012):
                    for rr in (r - 0.004, ro * R.uniform(0.97, 1.05)):
                        for d in (-0.025, 0.32):
                            if kind == "round":
                                pts.append((uc + rr * math.cos(a), d, spring + rr * math.sin(a)))
                            else:
                                side = -1 if a > math.pi / 2 else 1
                                aa = (math.pi - a) if side < 0 else a
                                # map to lancet arcs: each half arc spans 0..60deg of radius w
                                t = aa / (math.pi / 2) * (math.pi / 3)
                                rw = ww + (rr - r)
                                pts.append((uc + side * (rw * math.cos(t) - r) , d, spring + rw * math.sin(t)))
                prism_hull(ash, [f.p(*p) for p in pts])
        else:
            f.box(ash, uc - r - 0.22, uc + r + 0.22, -0.025, 0.3, v0 + h - 0.004, v0 + h + 0.3, 0.012)
            spring = v0 + h
        # jambs, alternating
        for sgn in (-1, 1):
            vv = v0
            k = 0
            while vv < spring - 0.08:
                hh = min(0.34 * R.uniform(0.85, 1.1), spring - vv)
                wd = (0.36 if (k + (sgn > 0)) % 2 == 0 else 0.22) * R.uniform(0.9, 1.1)
                ua = uc + sgn * (r - 0.004)
                ub = uc + sgn * (r + wd)
                f.box(ash, min(ua, ub), max(ua, ub), -0.022, 0.3, vv + 0.006, vv + hh - 0.006)
                vv += hh
                k += 1
    # sill
    ul = lights[0][0] - lights[0][1] / 2 - 0.16
    ur = lights[-1][0] + lights[-1][1] / 2 + 0.16
    if surround:
        f.box(ash, ul, ur, -0.08, 0.34, v0 - 0.15, v0 + 0.004, 0.015)
    if twin and surround:
        # central colonnette + capital between the lights
        cu = u
        spring = v0 + h - w / 2
        f.box(ash, cu - 0.08, cu + 0.08, 0.02, 0.26, v0, spring - 0.14, 0.02)
        f.box(ash, cu - 0.14, cu + 0.14, -0.02, 0.3, spring - 0.16, spring, 0.02)


def slit(f, cut, u, v0, h=1.25):
    window(f, cut, u, v0, 0.13, h, "flat", depth=0.9, surround=False, backdark=False)
    ash = B("ashlar")
    # small dressed surround
    vv = v0
    k = 0
    while vv < v0 + h - 0.05:
        hh = min(0.3, v0 + h - vv)
        wd = 0.2 if k % 2 else 0.3
        for sgn in (-1, 1):
            ua, ub = u + sgn * 0.063, u + sgn * (0.063 + wd)
            f.box(ash, min(ua, ub), max(ua, ub), -0.018, 0.25, vv + 0.006, vv + hh - 0.006)
        vv += hh
        k += 1
    f.box(ash, u - 0.3, u + 0.3, -0.018, 0.25, v0 + h - 0.002, v0 + h + 0.26)
    f.box(ash, u - 0.3, u + 0.3, -0.018, 0.25, v0 - 0.26, v0 + 0.002)


def putlogs(f, cut, us, v):
    for u in us:
        f.box(cut, u - 0.08 + jit(0.01), u + 0.08, -0.3, 0.28, v - 0.08, v + 0.08 + jit(0.01))


def corbels(f, u0, u1, v_top, proud=0.17, step=0.62, bt=None):
    bt = bt or B("ashlar")
    n = int((u1 - u0) / step)
    for i in range(n):
        u = u0 + (i + 0.5) * (u1 - u0) / n
        prof = [(-proud, v_top), (0.25, v_top), (0.25, v_top - 0.48), (-0.01, v_top - 0.48), (-proud, v_top - 0.22)]
        f.prism_dv(bt, prof, u - 0.12, u + 0.12)


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


def gable_face(f, y0, y1, z0, apex_z, apex_u, char=False):
    """triangular framed gable above the tie beam. u-space y0..y1."""
    oak = B("oak")
    s = Batch("gdaub_%d" % len(BATCHES), "daub")
    pts = [f.p(u, d, v) for (u, v) in ((y0, z0), (y1, z0), (apex_u, apex_z)) for d in (0.05, 0.2)]
    prism_hull(s, pts)
    BATCHES["_gslab%d" % len(BATCHES)] = (s, None)
    f.timber(oak, y0, z0, y1, z0, 0.2, 0.18)
    # principal rafters in the gable plane
    f.timber(oak, y0 + 0.05, z0 + 0.05, apex_u, apex_z - 0.1, 0.2, 0.18, ext=0.0)
    f.timber(oak, y1 - 0.05, z0 + 0.05, apex_u, apex_z - 0.1, 0.2, 0.18)
    f.timber(oak, apex_u, z0, apex_u, apex_z - 0.2, 0.2, 0.18)
    cz = z0 + (apex_z - z0) * 0.5
    half = (apex_u - y0) * 0.5
    f.timber(oak, apex_u - half, cz, apex_u + half, cz, 0.18, 0.18)
    for sgn in (-1, 1):
        f.timber(oak, apex_u + sgn * half * 1.6, z0, apex_u + sgn * half * 0.95, cz, 0.18, 0.18)
        f.timber(oak, apex_u, cz + 0.1, apex_u + sgn * half * 0.55, cz + (apex_z - cz) * 0.45, 0.15, 0.14, 0.015)
    # small gable window
    f.box(B("dark"), apex_u - 0.28, apex_u + 0.28, 0.25, 0.3, cz - 1.05, cz - 0.2)
    f.box(oak, apex_u - 0.36, apex_u + 0.36, -0.03, 0.16, cz - 1.12, cz - 1.02, 0.01)
    beam(oak, f.p(apex_u, 0.1, cz - 1.05), f.p(apex_u, 0.1, cz - 0.2), 0.08, 0.08, 0.01, side=f.inw, twist=0.78)


def grid(a, b, step, jitter=0.04):
    n = max(1, round((b - a) / step))
    return [a + (b - a) * i / n + (jit(jitter) if 0 < i < n else 0) for i in range(n + 1)]


# =====================================================================  roofs
def roof_rows(bt, M, x0, x1, eave, ridge, row_w=0.34, lap=0.72, thick=0.035, lift=0.03, sag=0.07,
              seg=8, wob=0.012, stop=None, row_w_ridge=None, jitx=0.03):
    """courses of tiles/slates from eave (y,z) to ridge (y,z), running along local x.
    stop: fraction of rows to build (for collapsed roofs). row_w_ridge: graduated courses
    (stone slates diminish from eave to ridge)."""
    ey, ez = eave
    ry, rz = ridge
    d = Vector((0, ry - ey, rz - ez))
    Ls = d.length
    dn = d / Ls
    n = Vector((1, 0, 0)).cross(dn)
    if n.z < 0:
        n = -n
    if row_w_ridge is None:
        step = row_w * lap
        rows = max(2, int(math.ceil((Ls - row_w) / step)) + 1)
        step = (Ls - row_w) / (rows - 1)
        starts = [(r * step, row_w) for r in range(rows)]
    else:
        starts, s_ = [], 0.0
        while True:
            w_ = row_w + (row_w_ridge - row_w) * min(1.0, s_ / Ls)
            if s_ + w_ >= Ls:
                starts.append((Ls - w_, w_))
                break
            starts.append((s_, w_))
            s_ += w_ * lap
        rows = len(starts)
    base = Vector((0, ey, ez))
    for r, (s0, rw_) in enumerate(starts):
        if stop is not None and not stop(r / max(1, rows - 1)):
            continue
        rr = R.random()
        pts, loc = [], []
        rl = rw_ * R.uniform(0.97, 1.03)
        for k in range(seg + 1):
            t = k / seg
            x = x0 + (x1 - x0) * t + (jit(jitx) if 0 < k < seg else 0)
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
            for i in range(3):          # underside (3->0) never seen: skip it
                j = (i + 1) % 4
                F.append((a + i, a + j, b + j, b + i))
        F.append((0, 1, 2, 3))
        F.append((seg * 4 + 3, seg * 4 + 2, seg * 4 + 1, seg * 4))
        bt.add(pts, F, None, rr, loc)


def saddle_ridge(bt, M, x0, x1, ry, rz, pitch, w=0.24, piece=0.6, top=0.17):
    """solid stone ridge saddles that sit down onto both slopes (no gap under them).
    rz = height of the slate surface at the ridge line."""
    tn = math.tan(pitch)
    x = x0
    while x < x1 - 0.05:
        l = min(piece * R.uniform(0.9, 1.1), x1 - x)
        pts = []
        for xx in (x + 0.004, x + l - 0.004):
            dz = jit(0.01)
            for sgn in (-1, 1):
                pts.append((xx, ry + sgn * w, rz - w * tn - 0.03 + dz))
                pts.append((xx, ry + sgn * w, rz - w * tn + 0.05 + dz))
                pts.append((xx, ry + sgn * w * 0.55, rz + top * 0.8 + dz))
            pts.append((xx, ry, rz + top + dz))
        P, F = hull([tuple(M @ Vector(p)) for p in pts])
        bt.add(P, F, None, None)
        x += l


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

def depth_in_solid(p):
    best = 0.0
    for lo, hi in SOLIDS:
        if all(lo[i] < p[i] < hi[i] for i in range(3)):
            best = max(best, min(p[0] - lo[0], hi[0] - p[0], p[1] - lo[1], hi[1] - p[1], p[2] - lo[2], hi[2] - p[2]))
    return best


NO_CULL = ("wall_",)


def cleanup_bottoms():
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        bm = bmesh.new(); bm.from_mesh(o.data)
        kill = [f for f in bm.faces if f.normal.z < -0.95 and all(v.co.z < 0.005 for v in f.verts)]
        if not o.name.startswith(NO_CULL):
            # faces buried in the masonry / hall volume, facing inward (probe along the normal)
            ks = set(kill)
            kill += [f for f in bm.faces if f not in ks and
                     depth_in_solid(f.calc_center_median() + f.normal * 0.3) >= 0.35]
        if kill:
            bmesh.ops.delete(bm, geom=kill, context="FACES_ONLY")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(o.data); bm.free()



# =====================================================================  craft materials
def m_thatch(name, tones, charred=0.0, moss=1.0, ridge=False):
    """long-straw / reed thatch. loc = (along ridge, along slope from eave, depth); ly < 0 = butt face."""
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    straw = g.noise(g.comb(g.mul(lx, 60.0), g.mul(ly, 2.2), g.mul(rnd, 7.0)), 1.0, 6, 0.65, 0.25)
    straw2 = g.noise(g.comb(g.mul(lx, 170.0), g.mul(ly, 6.0), 3.0), 1.0, 3, 0.6)
    blot = g.noise(P, 0.35, 3)
    col = g.ramp(g.add(g.mul(blot, 0.7), g.mul(g.noise(P, 1.3, 3), 0.4)), tones)
    col = g.mix(0.8, col, straw, "OVERLAY")
    col = g.mix(0.35, col, straw2, "OVERLAY")
    # courses: faint bands where each coat of straw was laid
    crs = g.math("FRACT", g.add(g.mul(ly, 1.55), g.mul(g.noise(P, 1.0, 2), 0.35)))
    band = g.mul(g.mr(crs, 0.0, 0.12), g.mr(crs, 1.0, 0.8))
    col = g.mix(g.mul(g.inv(band), 0.32), col, g.mix(1.0, col, (0.5, 0.47, 0.44, 1), "MULTIPLY"))
    # bunches (yealms): long cells running down the slope with dark gaps between them
    bun = g.node("ShaderNodeTexVoronoi", [("Vector", g.comb(g.mul(lx, 9.0), g.mul(ly, 1.1), g.mul(rnd, 4.0))),
                                          ("Scale", 1.0), ("Randomness", 1.0)], feature="DISTANCE_TO_EDGE").outputs[0]
    bgap = g.inv(g.mr(bun, 0.0, 0.12))
    col = g.mix(g.mul(bgap, 0.45), col, g.mix(1.0, col, (0.45, 0.42, 0.4, 1), "MULTIPLY"))
    # grey weathering on the exposed surface, darker wet streaks down the slope
    wg = g.mul(g.mr(g.noise(P, 0.6, 4), 0.3, 0.7), 0.7)
    col = g.mix(wg, col, g.mix(0.6, "#6b6356", straw, "OVERLAY"))
    # patched repairs: lighter, newer straw in irregular blocks
    rep = g.mul(g.gt(g.noise(g.comb(g.mul(lx, 0.6), g.mul(ly, 0.9), g.mul(rnd, 3.0)), 1.0, 2), 0.66), 0.7)
    col = g.mix(rep, col, g.mix(0.7, tones[-1][1], straw, "OVERLAY"))
    st = g.noise(g.comb(g.mul(lx, 3.5), g.mul(ly, 0.25), 0.0), 1.0, 3)
    col = g.mix(g.mul(g.mr(st, 0.52, 0.72), 0.45), col, "#4e463b")
    # moss creeping up from the eave and in hollows
    mo = g.mul(g.mr(g.add(ly, g.mul(g.noise(P, 0.9, 3), 1.6)), 1.6, 0.2), g.mr(g.noise(P, 2.6, 4), 0.4, 0.62))
    col = g.mix(g.mul(mo, 0.8 * moss), col, g.ramp(g.noise(P, 8.0), [(0.3, "#3f4826"), (0.7, "#5f6a35")]))
    # butt ends on eave / verge faces: dotted cut straw
    butt = g.math("LESS_THAN", ly, 0.0)
    dots = g.vor(g.comb(g.mul(lx, 90.0), g.mul(lz, 90.0), g.mul(ly, 90.0)), 1.0)
    bc = g.ramp(dots, [(0.05, "#3a3126"), (0.35, tones[1][1]), (0.9, tones[-1][1])])
    col = g.mix(butt, col, bc)
    if charred > 0:
        ch = g.mul(g.mr(g.noise(P, 0.5, 3), 0.3, 0.6), charred)
        col = g.mix(ch, col, g.mix(0.4, "#2b2622", straw, "OVERLAY"))
    height = g.add(g.mul(straw, 0.8), g.mul(straw2, 0.3))
    height = g.sub(height, g.mul(g.inv(band), 0.6))
    height = g.sub(height, g.mul(bgap, 0.7))
    height = g.add(height, g.mul(dots, butt))
    return g.out(col, g.add(0.86, g.mul(mo, 0.08)), height, 1.0, 0.035)


def m_bark(name, tones, lichen=0.6, charred=0.0, fis_amt=0.85, stretch=1.3):
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    off = g.mul(rnd, 23.0)
    q = g.comb(g.add(g.mul(lx, 9.0), off), g.mul(ly, 9.0), g.mul(lz, stretch))
    edge = g.node("ShaderNodeTexVoronoi", [("Vector", q), ("Scale", 3.0), ("Randomness", 0.9)],
                  feature="DISTANCE_TO_EDGE").outputs[0]
    fis = g.inv(g.mr(edge, 0.0, 0.09))
    plate = g.noise(g.comb(g.mul(lx, 20.0), g.mul(ly, 20.0), g.mul(lz, 4.0)), 1.0, 5, 0.6)
    col = g.ramp(g.add(g.mul(rnd, 0.6), g.mul(g.noise(P, 0.8), 0.5)), tones)
    col = g.mix(0.6, col, plate, "OVERLAY")
    col = g.mix(g.mul(fis, fis_amt), col, "#2e2721")
    li = g.mul(g.mr(g.noise(P, 2.2, 4), 0.55, 0.68), g.inv(fis))
    col = g.mix(g.mul(li, lichen), col, "#8f9072")
    if charred > 0:
        col = g.mix(g.mul(g.mr(g.noise(P, 0.7, 3), 0.25, 0.55), charred), col, "#26221f")
    x, y, z = g.sep(P)
    col, md, mb = g.ground_grime(col, z, 1.0, 0.5, 0.25)
    height = g.sub(g.mul(plate, 0.5), g.mul(fis, 1.2))
    return g.out(col, 0.88, height, 1.0, 0.012)


def m_endgrain(name, tones, grey=0.3, charred=0.0):
    """sawn log ends: growth rings, heart, radial checks. loc = disc-local xy (centre 0)."""
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    dist = g.mul(g.sub(g.noise(g.comb(lx, ly, g.mul(rnd, 9.0)), 6.0, 3), 0.5), 0.012)
    r = g.add(g.node("ShaderNodeVectorMath", [(0, g.comb(lx, ly, 0.0))], operation="LENGTH").outputs["Value"], dist)
    rings = g.math("SINE", g.mul(r, 2 * math.pi * 55.0))
    rings = g.mr(rings, -0.2, 1.0)
    ang = g.math("ARCTAN2", ly, lx)
    chk = g.noise(g.comb(g.mul(ang, 2.2), g.mul(r, 1.5), g.mul(rnd, 5.0)), 2.0, 2)
    crack = g.mul(g.inv(g.mr(g.math("ABSOLUTE", g.sub(chk, 0.5)), 0.0, 0.018)), g.mr(r, 0.01, 0.05))
    col = g.ramp(g.add(g.mul(rnd, 0.5), g.mul(g.noise(P, 3.0), 0.4)), tones)
    col = g.mix(g.mul(rings, 0.28), col, g.mix(1.0, col, (0.55, 0.45, 0.35, 1), "MULTIPLY"))
    heart = g.mr(r, 0.05, 0.02)
    col = g.mix(g.mul(heart, 0.45), col, "#7a5a3a")
    rim = g.mr(r, 0.0, 1.0)  # placeholder so the bark ring darkens via AO
    col = g.mix(g.mul(g.mr(g.noise(P, 1.5, 3), 0.3, 0.7), grey), col, "#8a8274")
    col = g.mix(g.mul(crack, 0.9), col, "#3a2f24")
    col = g.mix(0.25, col, g.noise(P, 40.0, 4), "OVERLAY")
    if charred > 0:
        col = g.mix(charred, col, "#2a2521")
    height = g.sub(g.mul(rings, 0.25), g.mul(crack, 1.0))
    return g.out(col, 0.82, height, 1.0, 0.004)


def m_heap(name, tones, lump=14.0, rough=0.9, moss=0.0, pebble=0.0, sheen=0.0, grass=0.0):
    """loose material: earth, spoil, charcoal, ore, sawdust. Lumps from voronoi."""
    g = G(name)
    P = g.P
    x, y, z = g.sep(P)
    cell = g.node("ShaderNodeTexVoronoi", [("Vector", P), ("Scale", lump), ("Randomness", 1.0)], feature="F1")
    cd, cc = cell.outputs["Distance"], cell.outputs["Color"]
    cr = g.sep(cc)[0]
    col = g.ramp(g.add(g.mul(cr, 0.55), g.mul(g.noise(P, 0.9, 3), 0.55)), tones)
    fine = g.noise(P, lump * 4.0, 5, 0.6)
    col = g.mix(0.35, col, fine, "OVERLAY")
    col = g.mix(0.4, col, g.noise(P, 0.25, 2), "OVERLAY")
    if pebble > 0:
        pb = g.inv(g.mr(g.vor(P, lump * 0.45), 0.0, 0.2))
        col = g.mix(g.mul(pb, pebble), col, g.ramp(g.white(g.math("FLOOR", g.mul(g.vor(P, lump * 0.45), 50.0))),
                                                     [(0.2, "#6f6a62"), (0.8, "#9a9284")]))
    if grass > 0:
        gm = g.mul(g.mr(g.noise(P, 0.7, 4), 0.5, 0.64), grass)
        col = g.mix(gm, col, g.ramp(g.noise(P, 9.0, 3), [(0.3, "#46512a"), (0.7, "#66703b")]))
    if moss > 0:
        mo = g.mul(g.mr(g.noise(P, 1.3, 4), 0.55, 0.68), moss)
        col = g.mix(mo, col, "#56602f")
    height = g.add(g.mul(g.inv(g.mr(cd, 0.0, 0.5)), 0.8), g.mul(fine, 0.3))
    rgh = g.sub(rough, g.mul(g.gt(cr, 0.8), sheen))
    return g.out(col, rgh, height, 1.0, 0.03)


def m_cloth(name, hexa, hexb, weave=180.0, rough=0.93, dirt=0.4, stripes=None):
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    wa = g.math("SINE", g.mul(g.add(lx, ly), weave))
    wb = g.math("SINE", g.mul(lz, weave))
    wv = g.mul(g.add(g.mul(wa, wb), 1.0), 0.5)
    col = g.ramp(g.add(g.mul(g.noise(P, 1.2, 3), 0.7), g.mul(rnd, 0.3)), [(0.25, hexa), (0.8, hexb)])
    if stripes:
        s = g.math("FRACT", g.mul(lz, stripes[0]))
        col = g.mix(g.mul(g.gt(s, 0.72), 0.8), col, stripes[1])
    col = g.mix(0.25, col, wv, "OVERLAY")
    col = g.mix(0.3, col, g.noise(P, 30.0, 4), "OVERLAY")
    x, y, z = g.sep(P)
    col = g.mix(g.mul(g.mr(g.add(z, g.mul(g.noise(P, 3.0), 0.6)), 0.9, 0.1), dirt), col, "#5a4a38")
    return g.out(col, rough, g.add(wv, g.mul(g.noise(P, 6.0, 3), 1.5)), 0.6, 0.004)


def m_wool(name, tones):
    g = G(name)
    P = g.P
    f1 = g.noise(P, 18.0, 8, 0.7, 0.6)
    f2 = g.noise(P, 70.0, 4, 0.6)
    col = g.ramp(g.add(g.mul(g.noise(P, 1.5, 3), 0.6), g.mul(f1, 0.4)), tones)
    col = g.mix(0.4, col, f2, "OVERLAY")
    x, y, z = g.sep(P)
    col = g.mix(g.mul(g.mr(z, 0.35, 0.0), 0.6), col, "#6f604c")
    return g.out(col, 0.97, g.add(f1, g.mul(f2, 0.5)), 1.0, 0.02)


def m_wicker(name, hexa="#7d6a4a", hexb="#9c8660"):
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    ang = g.math("ARCTAN2", ly, lx)
    rows = g.math("SINE", g.mul(lz, 2 * math.pi * 32.0))
    stake = g.math("SINE", g.mul(ang, 18.0))
    over = g.mul(g.add(g.mul(rows, stake), 1.0), 0.5)
    col = g.ramp(g.add(g.mul(over, 0.6), g.mul(g.noise(P, 4.0, 3), 0.4)), [(0.2, hexa), (0.8, hexb)])
    gap = g.mr(g.math("ABSOLUTE", rows), 0.0, 0.25)
    col = g.mix(g.mul(g.inv(gap), 0.6), col, "#3a3025")
    col = g.mix(0.3, col, g.noise(P, 50.0, 4), "OVERLAY")
    return g.out(col, 0.85, g.add(g.mul(over, 0.6), g.mul(gap, 0.6)), 1.0, 0.006)


def m_liquid(name, hexa, hexb, rough=0.12):
    g = G(name)
    P = g.P
    col = g.ramp(g.noise(P, 3.0, 3), [(0.3, hexa), (0.75, hexb)])
    scum = g.mr(g.noise(P, 9.0, 4), 0.6, 0.72)
    col = g.mix(g.mul(scum, 0.35), col, g.mix(1.0, col, (1.3, 1.25, 1.2, 1), "MULTIPLY"))
    return g.out(col, g.add(rough, g.mul(scum, 0.35)), g.noise(P, 12.0, 2), 0.15, 0.003)


def m_warp(name, cloth_hex, band_hex, thread_hex, split):
    """warp-weighted loom web: woven cloth above z=split (loc z), bare warp threads below."""
    g = G(name)
    P = g.P
    loc = g.attr("hg_loc")[0]
    lx, ly, lz = g.sep(loc)
    thr = g.math("SINE", g.mul(lx, 2 * math.pi * 55.0))
    woven = g.gt(lz, split)
    tw = g.math("SINE", g.mul(lz, 2 * math.pi * 60.0))
    wv = g.mul(g.add(g.mul(thr, tw), 1.0), 0.5)
    stripe = g.gt(g.math("FRACT", g.mul(lz, 3.2)), 0.8)
    cc = g.mix(g.mul(stripe, 0.85), cloth_hex, band_hex)
    cc = g.mix(0.3, cc, wv, "OVERLAY")
    gaps = g.mr(thr, -0.2, 0.4)
    tc = g.mix(gaps, "#2c2824", thread_hex)
    col = g.mix(woven, tc, cc)
    col = g.mix(0.25, col, g.noise(P, 20.0, 3), "OVERLAY")
    return g.out(col, 0.95, g.add(g.mul(wv, woven), g.mul(gaps, g.inv(woven))), 0.8, 0.004)


def build_materials(extra=None):
    ch = 0.9 if RUIN else 0.0
    mo = 0.12 if (B1 or B2) else 1.0          # new masonry has not grown moss yet
    MAT["rubble"] = m_stone("rubble", [(0.0, "#8f8573"), (0.25, "#a79b84"), (0.5, "#b5a88d"),
                                        (0.75, "#9e937e"), (1.0, "#857c6d")], "#6f675b",
                            rowh=0.3, bw=0.55, charred=ch * 0.8, moss=mo)
    MAT["ashlar"] = m_stone("ashlar", [(0.0, "#a89c83"), (0.4, "#b9ac91"), (0.7, "#b0a48b"),
                                        (1.0, "#9d917b")], "#9a9280", joints=False, bump=0.6, charred=ch * 0.6,
                            moss=mo)
    MAT["oak"] = m_wood("oak", [(0.0, "#4e3b27"), (0.5, "#5f4830"), (1.0, "#6b5236")],
                        weather_hex="#7d7466", weathered=0.55, fresh=0.06, charred=ch)
    MAT["plank"] = m_wood("plank", [(0.0, "#7b6f5e"), (0.5, "#8c8374"), (1.0, "#978a73")],
                          weather_hex="#8f887c", weathered=0.4, fresh=0.1, charred=ch, grain_k=1.2)
    MAT["fresh"] = m_wood("fresh", [(0.0, "#b0915f"), (0.5, "#c3a371"), (1.0, "#cfb07f")],
                          weather_hex="#b39b78", weathered=0.25, charred=ch, grain_k=1.1)
    MAT["pole"] = m_wood("pole", [(0.0, "#5e5040"), (0.5, "#6f6050"), (1.0, "#7c6c58")],
                         weather_hex="#8a8070", weathered=0.5, charred=ch)
    MAT["daub"] = m_daub("daub", charred=ch * 0.7)
    MAT["shingle"] = m_tiles("shingle", [(0.0, "#6c604f"), (0.5, "#80766a"), (1.0, "#8f8474")],
                             cell=0.17, curve=0.15, wood=True, lichen=0.5, charred=ch)
    MAT["iron"] = m_simple("iron", "#35332f", "#45403a", 0.72, rust=True)
    MAT["dark"] = m_simple("dark", "#2a2520", "#35302a", 0.95)
    MAT["soil"] = m_heap("soil", [(0.2, "#4a3a2a"), (0.55, "#5a4632"), (0.9, "#66513a")], 10.0, pebble=0.35)
    MAT["ash"] = m_heap("ash", [(0.1, "#3a3531"), (0.5, "#5e5850"), (0.9, "#827a6f")], 9.0, pebble=0.2)
    MAT["bark"] = m_bark("bark", [(0.0, "#4a4036"), (0.5, "#5a4f42"), (1.0, "#6b5f50")], charred=ch)
    MAT["endgrain"] = m_endgrain("endgrain", [(0.0, "#b0905f"), (0.5, "#c2a26f"), (1.0, "#cfb283")],
                                 grey=0.35, charred=ch * 0.8)
    MAT["rope"] = m_cloth("rope", "#7a6a50", "#8f7d5f", weave=90.0, dirt=0.2)
    MAT["leather"] = m_simple("leather", "#4a3526", "#5e4431", 0.7, 3.0)
    if extra:
        extra(MAT, ch)


# =====================================================================  craft geometry
def ring_pts(r, n, z=0.0, jr=0.0, jz=0.0, a0=0.0):
    return [(math.cos(a0 + 2 * math.pi * i / n) * (r + jit(jr)), math.sin(a0 + 2 * math.pi * i / n) * (r + jit(jr)),
             z + jit(jz)) for i in range(n)]


def mound(bt, cx, cy, rx, ry, h, rings=6, segs=18, noise=0.12, power=1.6, lumpy=0.0, z0=0.0, rot=0.0):
    """irregular dome/heap whose rim sits on the ground. power<1 = conical, >1 = domed."""
    pts = [(cx, cy, z0 + h * (1 + jit(noise * 0.5)))]
    ph = [R.uniform(0, 6.28) for _ in range(3)]
    ca, sa = math.cos(rot), math.sin(rot)
    for k in range(1, rings + 1):
        t = k / rings
        for i in range(segs):
            a = 2 * math.pi * i / segs
            wob = 1 + noise * (0.5 * math.sin(3 * a + ph[0]) + 0.3 * math.sin(5 * a + ph[1]) + 0.2 * math.sin(7 * a + ph[2]))
            wob += jit(noise * 0.4)
            lx, ly = math.cos(a) * rx * t * wob, math.sin(a) * ry * t * wob
            x, y = cx + lx * ca - ly * sa, cy + lx * sa + ly * ca
            zz = h * (1 - t ** power) if k < rings else 0.0
            zz = max(0.0, zz + (jit(lumpy) if k < rings else 0.0))
            pts.append((x, y, z0 + zz))
    F = []
    for i in range(segs):
        F.append((0, 1 + i, 1 + (i + 1) % segs))
    for k in range(1, rings):
        a0, b0 = 1 + (k - 1) * segs, 1 + k * segs
        for i in range(segs):
            j = (i + 1) % segs
            F.append((a0 + i, b0 + i, b0 + j, a0 + j))
    # close the base so normal recalculation sees a solid (cleanup_bottoms drops it at z=0)
    last = 1 + (rings - 1) * segs
    F.append(tuple(last + i for i in reversed(range(segs))))
    bt.add(pts, F, None, None, [(p[0] - cx, p[1] - cy, p[2]) for p in pts])


def disc(bt, center, normal, r, n=12, jr=0.0, rnd=None, th=0.012):
    """thin closed coin facing `normal` (surface of liquids, sawn ends). loc = disc-local, centre 0."""
    c, nn = Vector(center), Vector(normal).normalized()
    side = Vector((0, 0, 1)) if abs(nn.z) < 0.9 else Vector((0, 1, 0))
    xa = side.cross(nn).normalized()
    ya = nn.cross(xa)
    loc, pts = [], []
    for zz in (-th, 0.0):
        for i in range(n):
            a = 2 * math.pi * i / n
            lx, ly = math.cos(a) * r * (1 + jit(jr)), math.sin(a) * r * (1 + jit(jr))
            pts.append(tuple(c + xa * lx + ya * ly + nn * zz))
            loc.append((lx, ly, zz))
    F = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        F.append((i, j, n + j, n + i))
    bt.add(pts, F, None, rnd, loc)


def log(p0, p1, r, r1=None, n=9, ends=(True, True), bark="bark", endmat="endgrain", bulge=0.0):
    """barked log with sawn end-grain caps."""
    p0, p1 = Vector(p0), Vector(p1)
    r1 = r if r1 is None else r1
    cyl(B(bark), p0, p1, r, r1, n=n, bulge=bulge)
    d = (p1 - p0).normalized()
    rr = R.random()
    if ends[0]:
        disc(B(endmat), p0 - d * 0.004, -d, r * 0.93, n=max(8, n), rnd=rr)
    if ends[1]:
        disc(B(endmat), p1 + d * 0.004, d, r1 * 0.93, n=max(8, n), rnd=rr)


def stump(p, r, h, top_mat="endgrain"):
    p = Vector(p)
    cyl(B("bark"), p, p + Vector((0, 0, h)), r * 1.12, r, n=10, bulge=0.0)
    disc(B(top_mat), p + Vector((0, 0, h + 0.004)), (0, 0, 1), r * 0.94, n=10)


def tub(p, r, h, liquid=None, level=0.8, hoops="iron", n=14, lip=0.03):
    """staved tub / vat; liquid batch fills it to `level`."""
    p = Vector(p)
    # staves as individual boards for a real ragged rim
    for i in range(n):
        a = 2 * math.pi * (i + 0.5) / n
        c = p + Vector((math.cos(a) * r, math.sin(a) * r, 0))
        top = h + jit(0.012)
        wd = 2 * math.pi * r / n * 1.02
        beam(B("plank"), c, c + Vector((0, 0, top)), wd, 0.035, 0.0, side=Vector((math.cos(a), math.sin(a), 0)))
    for t in (0.18, 0.78):
        cyl(B(hoops), p + Vector((0, 0, h * t - 0.025)), p + Vector((0, 0, h * t + 0.025)), r + 0.022, n=n)
    if liquid:
        disc(B(liquid), p + Vector((0, 0, h * level)), (0, 0, 1), r - 0.01, n=n)
    else:
        disc(B("dark"), p + Vector((0, 0, 0.06)), (0, 0, 1), r - 0.01, n=n)


def sack(p, sx, sy, sz, mat="sacking", rot=0.0, tie=True):
    p = Vector(p)
    P, F = box_geo(sx, sy, sz, min(sx, sy, sz) * 0.42)
    pts = []
    for q in P:
        q = Vector(q)
        # slump: wider at the bottom, pinched top
        k = 1.0 + 0.12 * (-(q.z / (sz / 2)))
        pts.append((q.x * k + jit(0.01), q.y * k + jit(0.01), q.z + jit(0.01)))
    B(mat).add(pts, F, TRS(p + Vector((0, 0, sz / 2)), (jit(0.05), jit(0.05), rot)))
    if tie:
        top = p + Vector((0, 0, sz))
        cyl(B("rope"), top - Vector((0, 0, 0.02)), top + Vector((0, 0, 0.09)), min(sx, sy) * 0.14, n=6)


def plank_stack(x0, y0, length, width, layers, pw=0.28, pt=0.05, along_x=True, mat="fresh", sticker=True):
    z = 0.0
    # bearers on the ground
    nb = max(2, int(length / 1.4) + 1)
    for i in range(nb):
        t = 0.3 + (length - 0.6) * i / (nb - 1)
        if along_x:
            beam(B("oak"), (x0 + t, y0 - 0.1, 0.07), (x0 + t, y0 + width + 0.1, 0.07), 0.14, 0.14, 0.01, side=(0, 0, 1))
        else:
            beam(B("oak"), (x0 - 0.1, y0 + t, 0.07), (x0 + width + 0.1, y0 + t, 0.07), 0.14, 0.14, 0.01, side=(0, 0, 1))
    z = 0.14
    for lay in range(layers):
        n = max(1, int(width / (pw + 0.02)))
        for i in range(n):
            off = i * (width / n) + width / n / 2
            ln = length * R.uniform(0.9, 1.0)
            s0 = R.uniform(0, length - ln)
            if along_x:
                beam(B(mat), (x0 + s0, y0 + off + jit(0.01), z + pt / 2), (x0 + s0 + ln, y0 + off + jit(0.01), z + pt / 2),
                     width / n - 0.02, pt, 0.006, side=(0, 0, 1))
            else:
                beam(B(mat), (x0 + off + jit(0.01), y0 + s0, z + pt / 2), (x0 + off + jit(0.01), y0 + s0 + ln, z + pt / 2),
                     width / n - 0.02, pt, 0.006, side=(0, 0, 1))
        z += pt
        if sticker and lay < layers - 1:
            for i in range(nb):
                t = 0.3 + (length - 0.6) * i / (nb - 1)
                if along_x:
                    beam(B("plank"), (x0 + t, y0 - 0.03, z + 0.02), (x0 + t, y0 + width + 0.03, z + 0.02), 0.04, 0.04, 0.0,
                         side=(0, 0, 1))
                else:
                    beam(B("plank"), (x0 - 0.03, y0 + t, z + 0.02), (x0 + width + 0.03, y0 + t, z + 0.02), 0.04, 0.04, 0.0,
                         side=(0, 0, 1))
            z += 0.04
    return z


def tool(p_foot, p_top, kind="pick"):
    """long-handled tool leaning from foot to top. kind: pick|shovel|axe|mattock|rake"""
    a, b = Vector(p_foot), Vector(p_top)
    d = (b - a).normalized()
    if kind == "shovel":
        cyl(B("pole"), a + d * 0.25, b, 0.018, n=6)
        side = d.cross(Vector((0, 0, 1)))
        if side.length < 0.1:
            side = Vector((1, 0, 0))
        side.normalize()
        beam(B("iron"), a, a + d * 0.3, 0.2, 0.012, 0.004, side=d.cross(side))
        beam(B("pole"), b, b + side * 0.001 + d * 0.01, 0.14, 0.03, 0.0)
    else:
        cyl(B("pole"), a, b, 0.019, n=6)
        side = d.cross(Vector((0, 0, 1)))
        if side.length < 0.1:
            side = Vector((1, 0, 0))
        side.normalize()
        up = side.cross(d)
        hl = {"pick": 0.26, "axe": 0.09, "mattock": 0.2}.get(kind, 0.2)
        h = b - d * 0.05
        if kind == "axe":
            beam(B("iron"), h, h + side * 0.16, 0.12, 0.02, 0.004, side=up)
            beam(B("iron"), h, h - side * 0.04, 0.05, 0.035, 0.004, side=up)
        else:
            cyl(B("iron"), h - side * hl, h + side * hl, 0.022, 0.012 if kind == "pick" else 0.022, n=5)


def spoil_bank(a, b, width=0.9, h=0.32, mat="soil"):
    """long low heap of dug earth along the line a->b (trench spoil)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    L_ = d.length
    n = max(1, int(L_ / 2.2))
    rot = math.atan2(d.y, d.x)
    for i in range(n):
        c = a + d * ((i + 0.5) / n)
        mound(B(mat), c.x + jit(0.1), c.y + jit(0.1), L_ / n * 0.62, width * R.uniform(0.8, 1.1), h * R.uniform(0.7, 1.1),
              rings=3, segs=14, noise=0.18, power=1.6, lumpy=0.02, rot=rot)


def ground_pad(cx, cy, rx, ry, mat="soil", h=0.035, rot=0.0):
    mound(B(mat), cx, cy, rx, ry, h, rings=4, segs=22, noise=0.18, power=5.0, lumpy=0.006, rot=rot)


def thatch_slope(bt, M, x0, x1, eave, ridge, thick=0.34, nx=14, ns=7, sag=0.08, lump=0.025, eave_face=True,
                 verges=True, flare=0.0):
    """one thick thatch slope in a local frame (x along ridge, y/z slope plane), transformed by M.
    loc = (x, dist from eave along slope, depth) with the butt faces given negative loc.y."""
    ey, ez = eave
    ry, rz = ridge
    d = Vector((0, ry - ey, rz - ez))
    Ls = d.length
    dn = d / Ls
    nrm = Vector((1, 0, 0)).cross(dn)
    if nrm.z < 0:
        nrm = -nrm
    base = Vector((0, ey, ez))
    top, bot, ltop, lbot = [], [], [], []
    # sample rows: dense near the eave and verges so the thatch rolls over them (bullnose)
    svals = [0.0, 0.1, 0.28] + [0.28 + (Ls - 0.28) * k / (ns - 2) for k in range(1, ns - 1)]
    span = x1 - x0
    xin = [x0 + span * k / (nx - 4) for k in range(1, nx - 4)]
    xvals = [x0, x0 + 0.1, x0 + 0.26] + [x for x in xin if x0 + 0.4 < x < x1 - 0.4] + [x1 - 0.26, x1 - 0.1, x1]
    ph = [R.uniform(0, 6.3) for _ in range(4)]
    roll_s = {0: (0.38, -0.1), 1: (0.8, -0.02)}      # row -> (thickness factor, push past eave)
    roll_x = {0: (0.45, 0.08), 1: (0.85, 0.02)}
    NX = len(xvals) - 1
    NS = len(svals) - 1
    for j, s_ in enumerate(svals):
        for i, x in enumerate(xvals):
            t = (x - x0) / span
            sg = -sag * math.sin(math.pi * t) * (0.4 + 0.6 * s_ / Ls)
            und = 0.035 * math.sin(1.7 * x + ph[0]) * math.sin(2.1 * s_ + ph[1]) + \
                0.02 * math.sin(4.3 * x + ph[2] + 1.3 * s_) + 0.015 * math.sin(3.1 * s_ + ph[3])
            edge = j in roll_s or (verges and (i in roll_x or (NX - i) in roll_x))
            th = thick * (1.0 - 0.22 * s_ / Ls) + und * lump / 0.025 + (0 if edge else jit(lump * 0.5))
            push = Vector((0, 0, 0))
            if j in roll_s:
                th *= roll_s[j][0]
                push += dn * (roll_s[j][1] - flare)
            if verges:
                for ii, sgn in ((i, -1), (NX - i, 1)):
                    if ii in roll_x:
                        th *= roll_x[ii][0]
                        push += Vector((sgn * roll_x[ii][1], 0, 0))
            q = base + dn * s_ + Vector((x, 0, 0)) + nrm * sg
            top.append(tuple(M @ (q + push + nrm * th)))
            bot.append(tuple(M @ (q + push * 0.5)))
            ltop.append((x, s_, th))
            lbot.append((x, s_, 0.0))
    nx, ns = NX, NS
    W = nx + 1
    pts = top + bot
    loc = ltop + lbot
    off = len(top)
    main, special = [], []
    for j in range(ns):
        for i in range(nx):
            a = j * W + i
            main.append((a, a + 1, a + W + 1, a + W))
            main.append((off + a, off + a + W, off + a + W + 1, off + a + 1))
    if eave_face:
        for i in range(nx):
            special.append(((off + i, off + i + 1, i + 1, i), "butt"))
    for j in range(ns):                          # verges
        a = j * W
        special.append(((a, a + W, off + a + W, off + a), "verge"))
        a = j * W + nx
        special.append(((off + a, off + a + W, a + W, a), "verge"))
    for f, kind in special:
        nf = []
        for v in f:
            lx_, ly_, lz_ = loc[v]
            pts.append(pts[v])
            # butt ends: loc.y < 0 flags them; (x, depth) map the cut straw dots
            loc.append((lx_ if kind == "butt" else ly_, -0.05 - lz_, lz_ * 3.0 + (0 if kind == "butt" else lx_)))
            nf.append(len(pts) - 1)
        main.append(tuple(nf))
    bt.add(pts, main, None, None, loc)
    return Ls, nrm


def scalloped_ridge(bt, M, x0, x1, ry, rz, half_w, pitch, depth=0.7, piece=0.46, thick=0.3, proud=0.13):
    """block-cut thatch ridge: one solid saddle per piece straddling the ridge, its lower edge cut
    into points down both slopes; a ridge roll on top. thick = slope thatch thickness at the ridge."""
    cp, sp = math.cos(pitch), math.sin(pitch)
    apex = Vector((0, ry, rz + (thick + proud) / cp))
    x = x0
    k = 0
    while x < x1 - 0.05:
        w = min(piece * R.uniform(0.95, 1.05), x1 - x)
        pts = []
        for sgn in (-1, 1):
            n = Vector((0, sgn * sp, cp))
            dvec = Vector((0, sgn * cp, -sp))
            for (xx, s, off) in ((x, 0.0, proud), (x + w, 0.0, proud), (x, depth, proud * 0.8),
                                 (x + w, depth, proud * 0.8), (x + w / 2, depth + 0.28, proud * 0.45)):
                q = Vector((xx, ry, rz)) + dvec * s + n * (thick + off)
                pts.append(tuple(M @ q))
                pts.append(tuple(M @ (Vector((xx, ry, rz)) + dvec * s + n * (thick - 0.12))))
        for xx in (x, x + w):
            pts.append(tuple(M @ (apex + Vector((xx, 0, 0)))))
        P, F = hull(pts)
        bt.add(P, F, None, None)
        x += w
        k += 1
    # ridge roll bedded into the saddle
    pts = []
    for xx in (x0 - 0.03, x1 + 0.03):
        for i in range(9):
            a = math.pi * i / 8
            pts.append(tuple(M @ (apex + Vector((xx, math.cos(a) * 0.26, -0.1 + math.sin(a) * 0.2)))))
    P, F = hull(pts)
    bt.add(P, F, None, None)
    # hazel liggers pinning the ridge down
    for sgn in (-1, 1):
        n = Vector((0, sgn * sp, cp))
        dvec = Vector((0, sgn * cp, -sp))
        for s in (0.22, 0.52):
            q = Vector((0, ry, rz)) + dvec * s + n * (thick + proud + 0.012)
            a_, b_ = M @ (q + Vector((x0 + 0.1, 0, 0))), M @ (q + Vector((x1 - 0.1, 0, 0)))
            cyl(B("pole"), a_, b_, 0.018, n=5)


def gable_roof_thatch(x0, x1, yf, yb, plate, pitch, over=0.45, overx=0.35, mat="thatch", ridge_mat="thatch_ridge",
                      thick=0.36, ridge=True, keep=None):
    """full thatched gable roof, ridge along x. keep(side) -> bool to drop a slope (ruin)."""
    ry = (yf + yb) / 2
    half = (yb - yf) / 2 + over
    rz = plate + ((yb - yf) / 2) * math.tan(pitch)
    ez = rz - half * math.tan(pitch)
    I = Matrix.Identity(4)
    mir = Matrix.Translation((0, 2 * ry, 0)) @ Matrix.Scale(-1, 4, (0, 1, 0))
    for side, M in (("front", I), ("back", mir)):
        if keep and not keep(side):
            continue
        thatch_slope(B(mat), M, x0 - overx, x1 + overx, (ry - half, ez), (ry, rz), thick=thick, nx=16, ns=8,
                     lump=0.03)
    if ridge:
        scalloped_ridge(B(ridge_mat), I, x0 - overx + 0.12, x1 + overx - 0.12, ry, rz, half, pitch,
                        thick=thick * 0.78)
    return ry, rz, ez


def run(name, tex=2048, lods=(1.0, 0.4, 0.12)):
    for k, v in list(BATCHES.items()):
        if isinstance(v, tuple):
            s, c = v
            ob = s.build()
            if c is not None and c.F:
                apply_boolean(ob, cutter_obj(c))
        elif not k.startswith("_"):
            v.build()
    cleanup_bottoms()
    stats = {}
    tris = 0
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and not o.hide_render:
            k = o.data.materials[0].name if o.data.materials else "?"
            t = sum(len(p.vertices) - 2 for p in o.data.polygons)
            tris += t
            a = sum(p.area for p in o.data.polygons)
            t0, a0 = stats.get(k, (0, 0))
            stats[k] = (t0 + t, a0 + a)
    print("HG_TRIS_PRE", tris)
    for k, (t, a) in sorted(stats.items(), key=lambda x: -x[1][0]):
        print("HG_STAT %-12s tris %6d area %7.1f" % (k, t, a))
    for o in [o for o in bpy.context.scene.objects if o.hide_render]:
        bpy.data.objects.remove(o, do_unlink=True)
    if os.environ.get("HG_DRY"):
        return
    if not FULL:
        tex = min(tex, 1024)                        # build/ruin states: 1024 (art bible house range)
    tex = int(os.environ.get("HG_TEX", tex))      # quick review bakes: HG_TEX=1024
    L.finish(name if FULL else name + "_" + STATE, tex=tex, lods=lods)
