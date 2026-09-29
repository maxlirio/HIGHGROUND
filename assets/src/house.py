"""HIGHGROUND - peasant houses (the village building grid: 42 plots per village).

  house_a  cruck-framed longhouse 5 x 12 m: wattle-and-daub on a low stone sill, cruck feet
           showing in the long walls, thick hipped thatch with a smoke louvre, byre end with
           its own wide half-door, drain slot and dung heap.
  house_b  two-bay timber-framed cottage 5 x 8 m: close-studded front, limewashed panels,
           thatched gable roof with a daubed smoke hood, boarded lean-to outshut behind.
  house_c  upland stone cottage 5 x 9 m (Rookham's rocky side): rubble gritstone walls with
           quoins, graded stone-flag roof, gable chimney stack.
  Each with doors, shutters, water butt, woodpile, hurdle fence stub and dung heap.

    blender -b -P assets/src/house.py -- <a|b|c> [complete|build1|build2|ruin]
    (or HG_VARIANT=b HG_STATE=ruin blender -b -P assets/src/house.py)

house_a is also exported as `house` (the settlement file references `house`).
Front faces -Y. 1 unit = 1 m. Helpers (G, materials, Batch, Face, roof_rows) are adapted from
town_hall.py, the approved proof asset.
"""
import sys, os, math, random, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector, Matrix
from mathutils import noise as MN
import _lib as L

_argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
VARIANT = os.environ.get("HG_VARIANT") or (_argv[0] if _argv else "a")
STATE = os.environ.get("HG_STATE") or (_argv[1] if len(_argv) > 1 else "complete")
assert VARIANT in ("a", "b", "c"), VARIANT
assert STATE in ("complete", "build1", "build2", "ruin"), STATE
FULL = STATE == "complete"
RUIN = STATE == "ruin"
B2 = STATE == "build2"
B1 = STATE == "build1"

L.reset(seed=31)
R = random.Random({"a": 101, "b": 202, "c": 303}[VARIANT])


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
            moss=1.0, charred=0.0, irr=0.0):
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
        h2 = g.add(h, g.mul(g.sub(g.noise(P, 2.5, 2), 0.5), 0.09 + 0.25 * irr))
        if irr:
            v2 = g.add(v2, g.mul(g.sub(g.noise(P, 1.6, 2), 0.5), 0.16 * irr))
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
        if irr:
            # random rubble: irregular voronoi stones, flatter than tall, instead of brick courses
            vuv = g.comb(g.mul(h2, 1.0 / bw), g.mul(v2, 1.0 / rowh), 0.0)
            vf = g.node("ShaderNodeTexVoronoi", [("Vector", vuv), ("Scale", 1.0), ("Randomness", 1.0)], feature="F1")
            ve = g.vor(vuv, 1.0, "DISTANCE_TO_EDGE")
            mort = g.inv(g.mr(ve, 0.0, 0.07))
            pillow = g.mr(ve, 0.0, 0.3)
            sid = g.add(g.mul(g.white(vf.outputs["Position"]), 0.85), g.mul(g.noise(P, 0.9), 0.3))
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


# =====================================================================  house materials
def m_thatch(name, aged=0.6, moss=1.0, fresh=0.25, soot=None, ridge=False, charred=0.0):
    """long-straw / reed thatch. hg_loc = (u along eave in m, v up-slope in m, w face kind):
    w=0 top surface, 0.5 underside, 1 cut butt-ends (eaves, verges)."""
    g = G(name)
    P, N = g.P, g.N
    loc = g.attr("hg_loc")[0]
    _, rnd = g.attr("hg_rnd")
    u, v, w = g.sep(loc)
    x, y, z = g.sep(P)
    nx, ny, nz = g.sep(N)
    butt = g.mr(w, 0.7, 0.9)
    under = g.mul(g.mr(w, 0.3, 0.6), g.inv(butt))
    # straws run down-slope: fast across u, slow along v
    s1 = g.noise(g.comb(g.mul(u, 16.0), g.mul(v, 0.55), 0.0), 1.0, 6, 0.62, 0.25)
    s2 = g.noise(g.comb(g.mul(u, 55.0), g.mul(v, 1.6), 5.0), 1.0, 3, 0.5)
    # combed grooves between clumps of straw: dark vertical furrows
    grv = g.vor(g.comb(g.mul(u, 7.0), g.mul(v, 0.35), 2.0), 1.0, "DISTANCE_TO_EDGE")
    groove = g.inv(g.mr(grv, 0.0, 0.09))
    # yealm/bundle clumps ~0.3 m wide, and laid courses up the slope
    cl = g.noise(g.comb(g.mul(u, 3.2), g.mul(v, 0.7), 9.0), 1.0, 3, 0.5)
    crs = g.math("FRACT", g.add(g.mul(v, 1.0 / 0.55), g.mul(g.noise(g.comb(g.mul(u, 0.8), 1.0, 2.0), 1.0, 2), 0.6)))
    cedge = g.mr(crs, 0.82, 0.97)
    blot = g.noise(P, 0.3, 3)
    if ridge:
        tones = [(0.25, "#7f6d4a"), (0.5, "#907b53"), (0.75, "#a18a5d")]
    else:
        tones = [(0.18, "#56492f"), (0.4, "#6f5d3c"), (0.6, "#8a7245"), (0.82, "#a3864f")]
    base = g.ramp(g.add(g.mul(blot, 0.75), g.mul(cl, 0.35)), tones)
    # silver-grey weathering on the exposed upper surface
    grey = g.mul(g.mr(g.noise(P, 0.55, 4), 0.42, 0.7), aged * 0.5)
    col = g.mix(grey, base, "#77705f")
    # patched repairs in fresher golden straw (bundle-shaped blocks)
    if fresh > 0:
        pid = g.white(g.comb(g.math("FLOOR", g.mul(u, 1.0 / 1.6)), g.math("FLOOR", g.mul(v, 1.0 / 1.1)), 7.0))
        fr = g.mul(g.gt(pid, 1.0 - fresh * 0.35), g.mr(g.noise(P, 1.3, 2), 0.35, 0.5))
        col = g.mix(g.mul(fr, 0.85), col, "#a98f58")
    col = g.mix(0.85, col, s1, "OVERLAY")
    col = g.mix(0.45, col, s2, "OVERLAY")
    col = g.mix(g.mul(groove, 0.55), col, g.mix(1.0, col, (0.42, 0.4, 0.37, 1), "MULTIPLY"))
    # course shadows (the tuck line of each laid course)
    col = g.mix(g.mul(cedge, 0.28), col, g.mix(1.0, col, (0.55, 0.52, 0.48, 1), "MULTIPLY"))
    # dark rain runs down the slope
    st = g.noise(g.comb(g.mul(u, 4.0), g.mul(v, 0.22), 1.7), 1.0, 3)
    col = g.mix(g.mul(g.mr(st, 0.54, 0.74), 0.55), col, g.mix(1.0, col, "#5a5246", "MULTIPLY"))
    # moss & algae: lower slope, north side (+Y), under the ridge drip; patchy
    northy = g.add(0.45, g.mul(g.mr(ny, -0.3, 0.6), 0.55))
    low = g.add(0.35, g.mul(g.mr(v, 2.2, 0.3), 0.65))
    mo = g.mul(g.mul(g.mr(g.noise(P, 0.8, 4), 0.47, 0.64), low), northy)
    mo = g.mul(mo, moss)
    col = g.mix(g.clamp(mo), col, g.ramp(g.noise(P, 7.0), [(0.3, "#3c4425"), (0.7, "#5c6533")]))
    # underside: shadowed, sooty straw
    col = g.mix(under, col, g.mix(0.4, "#43392b", s1, "OVERLAY"))
    # cut butt ends: packed stalk ends, dark holes between
    dots = g.vor(P, 42.0)
    bc = g.ramp(g.add(g.mul(dots, 1.2), g.mul(g.noise(P, 4.0), 0.3)),
                [(0.15, "#261f17"), (0.32, "#5e4f35"), (0.6, "#8a744a")])
    bc = g.mix(0.35, bc, g.mix(1.0, bc, col, "MULTIPLY"))
    col = g.mix(butt, col, bc)
    if soot is not None:
        sp = g.node("ShaderNodeVectorMath", [(0, P), (1, soot)], operation="DISTANCE").outputs["Value"]
        so = g.mul(g.mr(sp, 1.7, 0.25), g.add(0.55, g.mul(g.noise(P, 2.5), 0.6)))
        col = g.mix(g.clamp(so), col, "#2f2a24")
    if charred > 0:
        ch = g.clamp(g.mul(g.mr(g.noise(P, 0.6, 3), 0.3, 0.55), charred))
        col = g.mix(ch, col, g.mix(0.5, "#29241f", s1, "OVERLAY"))
    height = g.add(g.add(g.mul(s1, 0.9), g.mul(cl, 0.9)), g.mul(s2, 0.35))
    height = g.sub(height, g.mul(groove, 0.8))
    height = g.sub(height, g.mul(cedge, 0.6))
    height = g.sub(height, g.mul(g.mul(butt, g.inv(g.mr(dots, 0.0, 0.3))), 1.2))
    return g.out(col, g.add(0.86, g.mul(mo, 0.08)), height, 1.0, 0.045)


def m_daub2(name, tones, lime=0.0, charred=0.0):
    g = G(name)
    P = g.P
    x, y, z = g.sep(P)
    col = g.ramp(g.noise(P, 0.35, 3), tones)
    fine = g.noise(P, 22.0, 6, 0.6)
    col = g.mix(0.35, col, fine, "OVERLAY")
    # hand-smeared daub lumps
    smear = g.noise(g.vmul(P, (1.0, 1.0, 1.6)), 3.5, 3, 0.6, 0.6)
    col = g.mix(0.25, col, smear, "OVERLAY")
    if lime > 0:
        lw = g.mul(g.mr(g.noise(P, 0.9, 4), 0.36, 0.52), lime)
        col = g.mix(lw, col, g.mix(0.3, "#cdc1a6", fine, "OVERLAY"))
    # daub fallen away: wattle showing
    dmg = g.mr(g.noise(P, 0.8, 5, 0.6), 0.672, 0.695)
    wat = g.node("ShaderNodeTexWave", [("Vector", P), ("Scale", 7.0), ("Distortion", 2.0),
                                       ("Detail", 3.0)], bands_direction="Z").outputs[1]
    wc = g.ramp(wat, [(0.2, "#4d3f2c"), (0.8, "#7b6446")])
    col = g.mix(dmg, col, wc)
    ring = g.mul(g.mr(g.noise(P, 0.8, 5, 0.6), 0.62, 0.672), g.inv(dmg))
    col = g.mix(g.mul(ring, 0.5), col, "#8f7f63")
    # damp rising from the sill, dirt splash, rain streaks
    dirt = g.mul(g.mr(g.add(z, g.mul(g.noise(P, 2.0), 0.6)), 1.6, 0.55), 0.7)
    col = g.mix(dirt, col, "#76674f")
    st = g.noise(g.comb(g.mul(g.add(x, y), 3.0), g.mul(z, 0.1), 0.0), 1.0, 3)
    col = g.mix(g.mul(g.mr(st, 0.48, 0.72), 0.45), col, g.mix(1.0, col, "#8e8068", "MULTIPLY"))
    if charred > 0:
        ch = g.mul(g.mr(g.add(g.noise(P, 0.7, 3), g.mul(z, 0.12)), 0.35, 0.6), charred)
        col = g.mix(g.clamp(ch), col, g.mix(0.5, "#352f29", fine, "OVERLAY"))
    height = g.sub(g.add(g.mul(smear, 0.8), g.mul(fine, 0.3)), g.mul(dmg, 1.4))
    return g.out(col, 0.93, height, 1.0, 0.02)


def m_wattle(name, charred=0.0):
    """woven hazel rods on a flat panel: hg_loc x along the panel, z up."""
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    rh = 0.034
    k = g.math("FLOOR", g.mul(lz, 1.0 / rh))
    fr = g.math("FRACT", g.mul(lz, 1.0 / rh))
    rod = g.math("SINE", g.mul(fr, math.pi))
    ph = g.math("SINE", g.add(g.mul(lx, math.pi / 0.3), g.mul(k, math.pi)))
    prom = g.mul(rod, g.add(0.62, g.mul(ph, 0.38)))
    rc = g.ramp(g.add(g.mul(g.white(g.comb(k, g.mul(rnd, 13.0), 0.0)), 0.8), g.mul(g.noise(P, 1.0), 0.3)),
                [(0.2, "#5b4a35"), (0.5, "#76624a"), (0.8, "#8a785c")])
    bark = g.noise(g.comb(g.mul(lx, 20.0), g.mul(lz, 120.0), 0.0), 1.0, 4)
    rc = g.mix(0.4, rc, bark, "OVERLAY")
    col = g.mix(g.inv(g.mr(prom, 0.05, 0.4)), rc, "#241d16")
    # clods of old daub stuck in the weave
    cl = g.mr(g.noise(P, 3.0, 3), 0.6, 0.66)
    col = g.mix(g.mul(cl, 0.8), col, "#a39170")
    if charred > 0:
        col = g.mix(g.mul(g.mr(g.noise(P, 0.9, 3), 0.3, 0.6), charred), col, "#2a2521")
    return g.out(col, 0.85, g.add(prom, g.mul(bark, 0.1)), 1.0, 0.02)


def m_dung(name):
    g = G(name)
    P = g.P
    x, y, z = g.sep(P)
    col = g.ramp(g.noise(P, 2.2, 5, 0.6), [(0.3, "#46382a"), (0.55, "#5e4b34"), (0.8, "#735e42")])
    # soiled bedding straw: criss-cross fibres in two directions
    f1 = g.vor(g.vmul(P, (3.0, 30.0, 30.0)), 1.0, "DISTANCE_TO_EDGE")
    f2 = g.vor(g.vmul(P, (30.0, 3.0, 30.0)), 1.0, "DISTANCE_TO_EDGE")
    fib = g.mx(g.inv(g.mr(f1, 0.0, 0.06)), g.inv(g.mr(f2, 0.0, 0.06)))
    straw = g.mul(fib, g.mr(g.noise(P, 1.2, 3), 0.35, 0.6))
    col = g.mix(g.mul(straw, 0.9), col, g.ramp(g.noise(P, 6.0), [(0.3, "#6e5b38"), (0.7, "#9a8250")]))
    fine = g.noise(P, 30.0, 5)
    col = g.mix(0.3, col, fine, "OVERLAY")
    wet = g.mr(z, 0.25, 0.0)
    col = g.mix(g.mul(wet, 0.4), col, "#2e251c")
    return g.out(col, g.sub(0.86, g.mul(wet, 0.3)), g.add(g.add(g.noise(P, 5.0, 4), g.mul(fine, 0.3)), g.mul(straw, 0.6)), 1.0, 0.03)


def m_water(name):
    g = G(name)
    col = g.ramp(g.noise(g.P, 3.0), [(0.3, "#1f2422"), (0.7, "#2c3230")])
    return g.out(col, 0.06, g.noise(g.P, 12.0, 2), 0.2, 0.002)


def m_ash(name):
    """burnt debris: charcoal, grey and pale wood ash, a few scorched-straw remnants."""
    g = G(name)
    P = g.P
    x, y, z = g.sep(P)
    blot = g.noise(P, 1.1, 4, 0.6)
    col = g.ramp(blot, [(0.3, "#221f1c"), (0.48, "#3b3632"), (0.62, "#6b665f"), (0.78, "#9a948a")])
    char = g.vor(P, 9.0, "DISTANCE_TO_EDGE")
    cracks = g.inv(g.mr(char, 0.0, 0.05))
    col = g.mix(g.mul(cracks, 0.7), col, "#1b1815")
    fine = g.noise(P, 35.0, 5)
    col = g.mix(0.4, col, fine, "OVERLAY")
    straw = g.mul(g.mr(g.noise(g.vmul(P, (6.0, 6.0, 40.0)), 1.0, 3), 0.62, 0.7), g.mr(g.noise(P, 0.7), 0.55, 0.7))
    col = g.mix(g.mul(straw, 0.7), col, "#5b4a30")
    height = g.add(g.mul(g.noise(P, 4.0, 4), 1.0), g.mul(fine, 0.3))
    height = g.sub(height, g.mul(cracks, 0.8))
    return g.out(col, 0.93, height, 1.0, 0.03)


MAT = {}


def build_materials():
    ch = 0.9 if RUIN else 0.0
    MAT["thatch"] = m_thatch("thatch", aged=0.65 if VARIANT == "a" else 0.45, moss=1.0 if VARIANT == "a" else 0.7,
                             soot=SOOT, charred=ch)
    MAT["ridge"] = m_thatch("ridge", aged=0.2, moss=0.25, fresh=0.0, ridge=True, soot=SOOT, charred=ch)
    MAT["burnt"] = m_thatch("burnt", aged=0.3, moss=0.2, fresh=0.0, charred=2.2)
    MAT["straw"] = m_thatch("straw", aged=0.05, moss=0.0, fresh=0.0, ridge=True)
    MAT["oak"] = m_wood("oak", [(0.0, "#4a3927"), (0.5, "#5b4630"), (1.0, "#6b5236")],
                        weather_hex="#7d7466", weathered=0.6, fresh=0.05, charred=ch)
    MAT["timber_new"] = m_wood("timber_new", [(0.0, "#a8895f"), (0.5, "#b99a6c"), (1.0, "#c9a877")],
                               weather_hex="#b59f7c", weathered=0.15, fresh=0.0)
    MAT["plank"] = m_wood("plank", [(0.0, "#6f6454"), (0.5, "#80766a"), (1.0, "#8f8474")],
                          weather_hex="#8f887c", weathered=0.5, fresh=0.08, charred=ch, grain_k=1.2)
    MAT["pole"] = m_wood("pole", [(0.0, "#5a4a38"), (0.5, "#6a5842"), (1.0, "#77664e")],
                         weather_hex="#7b7264", weathered=0.4, charred=ch, grain_k=2.0)
    MAT["daub"] = m_daub2("daub", [(0.25, "#7f6a50"), (0.5, "#8f785c"), (0.75, "#9d8669")],
                          lime=0.0, charred=ch * 0.8)
    MAT["lime"] = m_daub2("lime", [(0.25, "#a99a7e"), (0.5, "#b8aa8d"), (0.75, "#c2b597")],
                          lime=0.35, charred=ch * 0.8)
    MAT["hood"] = m_daub2("hood", [(0.25, "#6d604e"), (0.5, "#7d6e59"), (0.75, "#8a7a63")],
                          lime=0.0, charred=0.55)
    MAT["wattle"] = m_wattle("wattle", charred=ch * 0.8)
    grit = [(0.0, "#6f6a60"), (0.25, "#878073"), (0.5, "#948b7a"), (0.75, "#7e786d"), (1.0, "#9f9583")]
    MAT["rubble"] = m_stone("rubble", grit, "#6c665b", rowh=0.22, bw=0.46, charred=ch * 0.6, irr=1.0)
    MAT["sill"] = m_stone("sill", [(0.0, "#7c7466"), (0.5, "#9a8f7a"), (1.0, "#8a8173")], "#5f584d",
                          rowh=0.2, bw=0.42, charred=ch * 0.5, moss=0.15 if (B1 or B2) else 1.4)
    MAT["ashlar"] = m_stone("ashlar", [(0.0, "#8e8676"), (0.5, "#a09682"), (1.0, "#92897a")], "#7a7466",
                            joints=False, bump=0.6, charred=ch * 0.5)
    MAT["chimney"] = m_stone("chimney", grit, "#5f594f", rowh=0.22, bw=0.45, soot_top=CHIM_TOP)
    MAT["flag"] = m_tiles("flag", [(0.0, "#5a5347"), (0.25, "#6b6252"), (0.5, "#7a6f5b"), (0.75, "#877b64"),
                                   (1.0, "#625b50")], cell=1.0, curve=0.0, lichen=1.6, moss=1.4, charred=ch)
    MAT["shingle"] = m_tiles("shingle", [(0.0, "#675c4c"), (0.5, "#7a7062"), (1.0, "#8a7f6d")],
                             cell=0.16, curve=0.15, wood=True, lichen=0.6, charred=ch)
    MAT["iron"] = m_simple("iron", "#35332f", "#45403a", 0.72, rust=True)
    MAT["dark"] = m_simple("dark", "#211d19", "#2c2620", 0.95)
    MAT["soil"] = m_simple("soil", "#4c4234", "#62553f", 0.95, 1.2)
    MAT["dung"] = m_dung("dung")
    MAT["water"] = m_water("water")
    MAT["ash"] = m_ash("ash")
    MAT["char"] = m_wood("char", [(0.0, "#2a2521"), (0.5, "#35302a"), (1.0, "#433c34")],
                         weather_hex="#4a443d", weathered=0.3, charred=1.0)
# =====================================================================  geometry batches
class Batch:
    def __init__(s, name, material):
        s.name, s.mat = name, material
        s.V, s.F, s.LOC, s.RND = [], [], [], []
        s.H = []   # optional per-face outward hint (None -> recalc)

    def add(s, pts, faces, M=None, rnd=None, loc=None, hints=None):
        M = M or Matrix.Identity(4)
        base = len(s.V)
        r = R.random() if rnd is None else rnd
        for i, p in enumerate(pts):
            s.V.append(tuple(M @ Vector(p)))
            s.LOC.append(tuple(loc[i]) if loc else tuple(p))
            s.RND.append(r)
        for k, f in enumerate(faces):
            s.F.append([base + i for i in f])
            s.H.append(hints[k] if hints else None)

    def build(s):
        if not s.V:
            return None
        me = bpy.data.meshes.new(s.name)
        # nothing may dip below the ground plane: finish() grounds the lowest vertex at z=0
        me.from_pydata([(p[0], p[1], max(0.0, p[2])) for p in s.V], [], s.F)
        a = me.attributes.new("hg_loc", "FLOAT_VECTOR", "POINT")
        a.data.foreach_set("vector", [c for p in s.LOC for c in p])
        b = me.attributes.new("hg_rnd", "FLOAT", "POINT")
        b.data.foreach_set("value", s.RND)
        me.validate()
        bm = bmesh.new(); bm.from_mesh(me)
        bm.faces.ensure_lookup_table(); bm.normal_update()
        if any(h is not None for h in s.H) and len(bm.faces) == len(s.H):
            for f, h in zip(bm.faces, s.H):
                if h is not None and f.normal.dot(Vector(h)) < 0:
                    f.normal_flip()
            free = [f for f, h in zip(bm.faces, s.H) if h is None]
            if free:
                bmesh.ops.recalc_face_normals(bm, faces=free)
        else:
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

def cutter_obj(bt):
    ob = bt.build()
    ob.hide_render = True
    return ob


def apply_boolean(target, cutter):
    mod = target.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.use_self = True
    mod.object = cutter
    bpy.context.view_layer.objects.active = target
    for o in bpy.context.selected_objects:
        o.select_set(False)
    target.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

def roof_rows(bt, M, x0, x1, eave, ridge, row_w=0.34, lap=0.72, thick=0.035, lift=0.03, sag=0.07,
              seg=8, wob=0.012, stop=None):
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
            for i in range(3):          # underside (3->0) never seen: skip it
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



# =====================================================================  generic house geometry
def nz3(x, y, z, s=1.0, seed=0.0):
    return MN.noise(Vector((x * s + seed * 17.1, y * s - seed * 5.3, z * s + seed * 3.7)))


def shell(bt, grid, periodic, thick, U, V, inner_keep=lambda j: False, close=(True, True, True, True),
          rnd=None, wbase=0.0):
    """thick surface from an outer grid[j][i] (Vector). Outer normals come from the grid, oriented
    by `up` bias; inner = outer - n*thick(j,i). close = (row0, rowLast, col0, colLast) bands.
    hg_loc = (U[i], V[j], w): w 0 outer, 0.5 inner, 1 band."""
    J, I = len(grid), len(grid[0])

    def g(j, i):
        if periodic:
            return grid[j][i % I]
        return grid[j][min(max(i, 0), I - 1)]

    Nn = []
    for j in range(J):
        row = []
        for i in range(I):
            du = g(j, i + 1) - g(j, i - 1)
            dv = grid[min(j + 1, J - 1)][i] - grid[max(j - 1, 0)][i]
            n = du.cross(dv)
            if n.length < 1e-9:
                n = Vector((0, 0, 1))
            n.normalize()
            row.append(n)
        Nn.append(row)
    # orient: majority should point up/outward
    if sum(n.z for r in Nn for n in r) < 0:
        Nn = [[-n for n in r] for r in Nn]
    pts, loc, F, H = [], [], [], []

    def addv(p, l):
        pts.append(tuple(p)); loc.append(l)
        return len(pts) - 1

    O = [[addv(grid[j][i], (U[i], V[j], wbase)) for i in range(I)] for j in range(J)]
    IN = [[addv(grid[j][i] - Nn[j][i] * thick(j, i), (U[i], V[j], 0.5)) for i in range(I)] for j in range(J)]

    def quad(a, b, c, d, hint):
        pa, pb, pc = Vector(pts[a]), Vector(pts[b]), Vector(pts[c])
        pd = Vector(pts[d])
        if ((pc - pa).cross(pd - pb)).length < 1e-7:
            return
        F.append((a, b, c, d)); H.append(tuple(hint))

    ni = I if periodic else I - 1
    for j in range(J - 1):
        for i in range(ni):
            i2 = (i + 1) % I
            h = Nn[j][i] + Nn[j + 1][i2]
            quad(O[j][i], O[j][i2], O[j + 1][i2], O[j + 1][i], h)
            if inner_keep(j):
                quad(IN[j][i], IN[j + 1][i], IN[j + 1][i2], IN[j][i2], -h)
    # bands (cut straw ends)
    def band(ring_o, ring_i, interior_o, uvs):
        bo = [addv(pts[a], (uvs[k][0], uvs[k][1], 1.0)) for k, a in enumerate(ring_o)]
        bi = [addv(pts[a], (uvs[k][0], uvs[k][1] - 0.4, 1.0)) for k, a in enumerate(ring_i)]
        n = len(ring_o)
        rng = range(n) if (periodic and len(ring_o) == I) else range(n - 1)
        for k in rng:
            k2 = (k + 1) % n
            mid = (Vector(pts[ring_o[k]]) + Vector(pts[ring_o[k2]])) / 2
            inn = (Vector(pts[interior_o[k]]) + Vector(pts[interior_o[k2]])) / 2
            quad(bo[k], bo[k2], bi[k2], bi[k], mid - inn)
    if close[0]:
        band(O[0], IN[0], O[1], [(U[i], V[0]) for i in range(I)])
    if close[1]:
        band(O[J - 1], IN[J - 1], O[J - 2], [(U[i], V[J - 1]) for i in range(I)])
    if not periodic:
        if close[2]:
            band([O[j][0] for j in range(J)], [IN[j][0] for j in range(J)], [O[j][1] for j in range(J)],
                 [(V[j], U[0]) for j in range(J)])
        if close[3]:
            band([O[j][I - 1] for j in range(J)], [IN[j][I - 1] for j in range(J)], [O[j][I - 2] for j in range(J)],
                 [(V[j], U[I - 1]) for j in range(J)])
    bt.add(pts, F, None, rnd if rnd is not None else R.random(), loc, hints=H)
    return Nn


def crest_z(d, ze, ay, s, d0=0.4):
    """roof surface height at horizontal distance d from the ridge line (rounded crest)."""
    zr = ze + s * ay
    if d > d0:
        return zr - s * d
    return zr - s * d0 / 2 - s * d * d / (2 * d0)


def rrect_ring(hx, hy, rc, nx, ny, nc):
    pts = []
    ax, ay = hx - rc, hy - rc

    def seg(p0, p1, n):
        for k in range(n):
            t = k / n
            pts.append((p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t))

    def arc(cx, cy, a0, n):
        for k in range(n):
            a = a0 + (math.pi / 2) * k / n
            pts.append((cx + rc * math.cos(a), cy + rc * math.sin(a)))
    seg((-ax, -hy), (ax, -hy), nx); arc(ax, -ay, -math.pi / 2, nc)
    seg((hx, -ay), (hx, ay), ny); arc(ax, ay, 0.0, nc)
    seg((ax, hy), (-ax, hy), nx); arc(-ax, ay, math.pi / 2, nc)
    seg((-hx, ay), (-hx, -ay), ny); arc(-ax, -ay, math.pi, nc)
    return pts


class HipRoof:
    """thick hipped thatch over a Lx x W footprint (centred), eave overhang ov."""

    def __init__(s, Lx, W, ov, ze, pitch, thick_e=0.5, thick=0.32, step=0.42, r0=1.3, lump=0.045,
                 sag=0.07, seed=1.0, cx=0.0, stop=None):
        s.ax, s.ay = Lx / 2 + ov, W / 2 + ov
        s.s = math.tan(pitch)
        s.rh = s.ax - s.ay
        s.ze, s.cx = ze, cx
        ay = s.ay
        s.D = [ay - (ay - 0.95) * k / 9 for k in range(10)] + [0.66, 0.44, 0.26, 0.13, 0.0]
        s.nx = max(4, int(round(2 * (s.ax - r0) / step)))
        s.ny = max(3, int(round(2 * (ay - r0) / step)))
        s.nc = 5
        grid, V = [], []
        for j, d in enumerate(s.D):
            hx, hy = s.rh + d, d
            rc = min(r0 * (0.55 + 0.45 * d / ay), hy * 0.97)
            ring = rrect_ring(hx, hy, rc, s.nx, s.ny, s.nc)
            z0 = crest_z(d, ze, ay, s.s)
            row = []
            for (x, y) in ring:
                t = 1 - d / ay
                z = z0
                z += lump * nz3(x, y, z0, 0.9, seed) + 0.03 * nz3(x, y, 0, 3.0, seed + 2) * (1 - t)
                z -= sag * (1 - min(1.0, (x / s.ax) ** 2)) * t
                if j == 0:
                    z += 0.035 * nz3(x, y, 0, 0.6, seed + 4)
                row.append(Vector((x + cx, y, z)))
            grid.append(row)
            V.append((ay - d) * math.sqrt(1 + s.s ** 2))
        ring0 = grid[0]
        U = [0.0]
        for i in range(1, len(ring0)):
            U.append(U[-1] + (ring0[i] - ring0[i - 1]).length)
        s.grid, s.U, s.V = grid, U, V
        s.thick = lambda j, i: thick_e if j == 0 else (thick + (thick_e - thick) * max(0.0, 1 - j / 3))
        s.stop = stop

    def build(s, key="thatch"):
        bt = B(key)
        g = s.grid
        if s.stop is not None:
            g = [[p for p in row] for row in g]
        s.N = shell(bt, g, True, s.thick, s.U, s.V, inner_keep=lambda j: j <= 2, close=(True, False, 0, 0))
        return s

    def build_part(s, i0, i1, j1, key="thatch", slump=None):
        """a section of the thatch: columns i0..i1 (wrapping), rows 0..j1. slump(p, j) -> p
        deforms it (collapsed roof in the ruin)."""
        I = len(s.grid[0])
        idx = [i % I for i in range(i0, i1 + 1)]
        sub = []
        for j in range(j1 + 1):
            row = [s.grid[j][i].copy() for i in idx]
            if slump:
                row = [slump(p, j) for p in row]
            sub.append(row)
        U = [s.U[i] + (s.U[-1] if i < idx[0] else 0.0) for i in idx]
        shell(B(key), sub, False, s.thick, U, s.V[:j1 + 1], inner_keep=lambda j: j <= 2)
        return s

    def ridge_cap(s, k0=10, off=0.1, zig=True, key="ridge"):
        """ridge covering over the top rows (from row k0 up), zig-zag cut lower edge, liggers."""
        g = s.grid
        rows = []
        I = len(g[0])
        for j in range(k0 - 1, len(g)):
            row = []
            for i in range(I):
                p = g[j][i] + (s.N[j][i] * off if j < len(g) - 1 else Vector((0, 0, off * 1.2)))
                if j == k0 - 1 and zig:
                    q = g[k0][i] + s.N[k0][i] * off
                    p = p.lerp(q, 0.0 if i % 2 == 0 else R.uniform(0.35, 0.6))
                row.append(p)
            rows.append(row)
        Vr = [s.V[j] for j in range(k0 - 1, len(g))]
        shell(B(key), rows, True, lambda j, i: off - 0.01, s.U, Vr, close=(True, False, 0, 0))
        # hazel liggers along the straight part of the ridge, both sides
        for j in (k0 + 1,):
            for side in (0, 1):
                idx = list(range(0, s.nx + 1)) if side == 0 else \
                    list(range(s.nx + s.nc * 2 + s.ny, s.nx * 2 + s.nc * 2 + s.ny + 1))
                path = [g[j][i % I] + s.N[j][i % I] * (off + 0.015) for i in idx]
                tube(B("pole"), path, 0.018)
        return s

    def surface_z(s, x, y):
        d = max(0.0, abs(y)) if abs(x - s.cx) <= s.rh else math.hypot(abs(x - s.cx) - s.rh, y)
        return crest_z(d, s.ze, s.ay, s.s)


def tube(bt, path, r, sides=3):
    """cheap open tube through a polyline (no caps)."""
    pts, F = [], []
    n = len(path)
    for k, p in enumerate(path):
        a = (path[min(k + 1, n - 1)] - path[max(k - 1, 0)]).normalized()
        sd = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((1, 0, 0))
        xa = sd.cross(a).normalized(); ya = a.cross(xa)
        for m in range(sides):
            th = 2 * math.pi * m / sides + 0.5
            pts.append(tuple(p + (xa * math.cos(th) + ya * math.sin(th)) * r))
    for k in range(n - 1):
        for m in range(sides):
            m2 = (m + 1) % sides
            F.append((k * sides + m, k * sides + m2, (k + 1) * sides + m2, (k + 1) * sides + m))
    bt.add(pts, F, None, None)


class GableRoof:
    """thick thatch over a gable roof: one grid across the ridge (no seam), verges rolled down."""

    def __init__(s, x0, x1, W, ov, ze, pitch, thick_e=0.48, thick=0.3, step=0.4, lump=0.045, sag=0.06,
                 seed=2.0, yc=0.0):
        s.ay = W / 2 + ov
        s.s = math.tan(pitch)
        s.ze, s.yc = ze, yc
        ay = s.ay
        dl = [ay - (ay - 0.95) * k / 8 for k in range(9)] + [0.66, 0.44, 0.26, 0.12]
        prof = [-d for d in dl] + [0.0] + [d for d in reversed(dl)]
        s.prof = prof
        nxs = max(4, int(round((x1 - x0) / step)))
        xs = [x0 + (x1 - x0) * i / nxs for i in range(nxs + 1)]
        grid, V = [], []
        acc = 0.0
        for j, yy in enumerate(prof):
            d = abs(yy)
            z0 = crest_z(d, ze, ay, s.s)
            row = []
            for i, x in enumerate(xs):
                z = z0 + lump * nz3(x, yy, z0, 0.9, seed) + (0.03 * nz3(x, yy, 0, 3.0, seed + 2) * (d / ay))
                z -= sag * math.sin(math.pi * (x - x0) / (x1 - x0)) * (1 - d / ay)
                xx = x
                e = min(i, nxs - i)
                if e == 0:
                    z -= 0.16; xx += (0.07 if i == 0 else -0.07)
                elif e == 1:
                    z -= 0.05
                if d > ay - 0.01:
                    z += 0.035 * nz3(x, yy, 0, 0.6, seed + 4)
                row.append(Vector((xx, yy + yc, z)))
            if j > 0:
                acc += (row[nxs // 2] - grid[-1][nxs // 2]).length
            grid.append(row)
            V.append(acc)
        s.grid, s.xs, s.V = grid, xs, V
        s.U = [x - x0 for x in xs]
        s.J = len(prof)
        s.thick_e, s.thick = thick_e, thick
        s.x0, s.x1 = x0, x1

    def th(s, j, i):
        e = min(j, s.J - 1 - j)
        return s.thick_e if e == 0 else s.thick + (s.thick_e - s.thick) * max(0.0, 1 - e / 3)

    def build(s, key="thatch"):
        J = s.J
        s.N = shell(B(key), s.grid, False, s.th, s.U, s.V,
                    inner_keep=lambda j: j <= 2 or j >= J - 4)
        return s

    def build_part(s, j0, j1, i0, i1, key="thatch", slump=None):
        sub = []
        for j in range(j0, j1 + 1):
            row = [s.grid[j][i].copy() for i in range(i0, i1 + 1)]
            if slump:
                row = [slump(p, j) for p in row]
            sub.append(row)
        th = lambda j, i: s.th(j + j0, i + i0)
        shell(B(key), sub, False, th, s.U[i0:i1 + 1], s.V[j0:j1 + 1], inner_keep=lambda j: True)
        return s

    def ridge_cap(s, k=4, off=0.1, key="ridge"):
        c = s.J // 2
        rows = []
        for j in range(c - k, c + k + 1):
            row = []
            for i in range(len(s.xs)):
                p = s.grid[j][i] + s.N[j][i] * off
                if j in (c - k, c + k):
                    jj = j + (1 if j < c else -1)
                    q = s.grid[jj][i] + s.N[jj][i] * off
                    p = p.lerp(q, 0.1 if i % 2 == 0 else R.uniform(0.55, 0.85))
                row.append(p)
            rows.append(row)
        Vr = s.V[c - k:c + k + 1]
        shell(B(key), rows, False, lambda j, i: off - 0.01, s.U, Vr)
        for j in (c - k + 2, c + k - 2):
            path = [s.grid[j][i] + s.N[j][i] * (off + 0.015) for i in range(1, len(s.xs) - 1)]
            tube(B("pole"), path, 0.018)
        return s

    def under_z(s, y):
        """underside height at |y - yc| (for gable walls)."""
        return crest_z(abs(y - s.yc), s.ze, s.ay, s.s) - s.thick / math.cos(math.atan(s.s)) - 0.04


# ---------------------------------------------------------------- wall framing
def frame_wall(f, length, z0, z1, posts, rails, openings, braces=(), stud=0.2, sd=0.18, infill="daub",
               bev=0.014, keep=1.0, char=False, slab=True, oak="oak", slab_z=None):
    """timber framing with daub infill on face f (u 0..length). openings (u0,u1,v0,v1,kind)."""
    ob = B(oak)
    tsel = lambda: (R.random() < keep)
    for u in posts:
        segs = [(z0, z1)]
        for (a, b, v0, v1, kind) in openings:
            if a - 0.06 < u < b + 0.06:
                new = []
                for (s0, s1) in segs:
                    if s1 <= v0 or s0 >= v1:
                        new.append((s0, s1)); continue
                    if s0 < v0: new.append((s0, v0))
                    if s1 > v1: new.append((v1, s1))
                segs = new
        for (s0, s1) in segs:
            if s1 - s0 > 0.1 and tsel():
                top = s1 if not char else s0 + (s1 - s0) * R.uniform(0.35, 1.0)
                corner = u < 0.05 or u > length - 0.05
                f.timber(ob, u, s0, u, top, stud * (1.15 if corner else 1.0), sd, 0.0, bev=bev if corner else 0.0)
    for v in rails:
        segs = [(0.0, length)]
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
            if s1 - s0 > 0.05 and tsel():
                f.timber(ob, s0, v, s1, v, 0.17, sd - 0.01, 0.005, bev=bev)
    for (ua, va, ub, vb) in braces:
        if tsel():
            f.timber(ob, ua, va, ub, vb, 0.15, sd - 0.03, 0.02, bev=bev, ext=0.04)
    for (a, b, v0, v1, kind) in openings:
        dress_opening(f, a, b, v0, v1, kind, char)
    if slab:
        s = Batch("slab_%d" % len(BATCHES), infill)
        za, zb = slab_z or (z0, z1)
        f.box(s, 0.0, length, 0.05, 0.19, za, zb)
        c = Batch("scut_%d" % len(BATCHES), "dark")
        for (a, b, v0, v1, kind) in openings:
            f.box(c, a, b, -0.1, 0.3, v0, v1)
        BATCHES["_slab%d" % len(BATCHES)] = (s, c)


def dress_opening(f, a, b, v0, v1, kind, char=False, depth=0.19, stone=False):
    """dark interior, lintel/sill, shutters, doors."""
    dk = B("dark")
    f.box(dk, a - 0.04, b + 0.04, depth + 0.12, depth + 0.16, v0 - 0.04, v1 + 0.04)
    if kind == "win":
        # diamond stick mullions + sill; a plank shutter, open or closed
        n = max(2, int((b - a) / 0.2))
        for i in range(1, n):
            uu = a + (b - a) * i / n
            beam(B("oak"), f.p(uu, 0.09, v0), f.p(uu, 0.09, v1), 0.06, 0.06, 0.0, side=f.inw, twist=math.pi / 4)
        if not stone:
            f.box(B("oak"), a - 0.06, b + 0.06, -0.05, 0.14, v0 - 0.09, v0 + 0.01, 0.01)
        if char:
            return
        r = R.random()
        w = b - a
        if r < 0.3:           # closed shutter
            for k in range(3):
                f.box(B("plank"), a + w * k / 3 + 0.004, a + w * (k + 1) / 3 - 0.004, -0.02, 0.015,
                      v0 + 0.01, v1 - 0.01, 0.004)
            f.box(B("oak"), a, b, -0.05, -0.02, v1 - 0.16, v1 - 0.08)
        else:                  # open, hinged on one side, swung back against the wall
            left = r < 0.65
            hinge = f.p(a - 0.02 if left else b + 0.02, -0.04, 0.0)
            ang = math.radians(R.uniform(150, 172))
            dirv = (-f.al if left else f.al) * math.cos(math.pi - ang) - f.inw * math.sin(math.pi - ang)
            for k in range(3):
                q0 = Vector((hinge.x, hinge.y, 0)) + dirv * (w * k / 3 + 0.004)
                q1 = Vector((hinge.x, hinge.y, 0)) + dirv * (w * (k + 1) / 3 - 0.004)
                pts = []
                for (qq, vv) in ((q0, v0 + 0.01), (q1, v0 + 0.01), (q1, v1 - 0.01), (q0, v1 - 0.01)):
                    for dd in (0.0, 0.03):
                        nrm = Vector((0, 0, 1)).cross(dirv).normalized()
                        pts.append(qq + nrm * dd + Vector((0, 0, vv)))
                prism_hull(B("plank"), pts)
            # ledge across the shutter
            q0 = Vector((hinge.x, hinge.y, 0)); q1 = q0 + dirv * w
            nrm = Vector((0, 0, 1)).cross(dirv).normalized()
            beam(B("oak"), q0 + Vector((0, 0, v0 + 0.12)) + nrm * 0.045, q1 + Vector((0, 0, v0 + 0.12)) + nrm * 0.045,
                 0.07, 0.025, 0.0, side=nrm)
    elif kind in ("door", "byre"):
        if not stone:
            f.box(B("sill" if kind == "byre" else "oak"), a - 0.1, b + 0.1, -0.12, 0.2, 0.0, v0 + 0.04, 0.02)
        if char:
            return
        door_leaf2(f, a, b, v0, v1, half=(kind == "byre"))
    elif kind == "vent":
        pass


def door_leaf2(f, a, b, v0, v1, half=False, depth=0.1):
    w = b - a
    n = max(3, int(round(w / 0.24)))
    pw = w / n
    tops = [v1] * n
    if half:
        split = v0 + 1.05
        for i in range(n):
            ua = a + i * pw
            f.box(B("plank"), ua + 0.004, ua + pw - 0.004, depth, depth + 0.04, v0 + 0.02, split - 0.01)
        # upper leaf swung open outward against the wall
        hinge = f.p(b + 0.02, -0.02, 0.0)
        dirv = f.al * 0.995 - f.inw * 0.07
        dirv.normalize()
        pts = []
        nrm = Vector((0, 0, 1)).cross(dirv).normalized()
        for (qq, vv) in ((0.0, split + 0.01), (w, split + 0.01), (w, v1 - 0.02), (0.0, v1 - 0.02)):
            for dd in (0.0, 0.04):
                pts.append(Vector((hinge.x, hinge.y, 0)) + dirv * qq + nrm * dd + Vector((0, 0, vv)))
        prism_hull(B("plank"), pts)
        for vv in (split + 0.15, v1 - 0.2):
            beam(B("iron"), Vector((hinge.x, hinge.y, vv)) - nrm * 0.01, Vector((hinge.x, hinge.y, vv)) + dirv * w * 0.7
                 - nrm * 0.01, 0.05, 0.012, 0.0, side=nrm)
        for vv in (v0 + 0.25, split - 0.2):
            f.box(B("iron"), a + 0.04, b - 0.2, depth - 0.012, depth, vv, vv + 0.05)
        return
    for i in range(n):
        ua = a + i * pw
        f.box(B("plank"), ua + 0.004, ua + pw - 0.004, depth, depth + 0.045, v0 + 0.02, v1 - 0.005 - 0.02 * R.random())
    for vv in (v0 + 0.3, v1 - 0.35):
        f.box(B("iron"), a + 0.04, b - 0.22, depth - 0.012, depth, vv, vv + 0.055)
    # ring handle
    f.box(B("iron"), b - 0.18, b - 0.12, depth - 0.03, depth, v0 + 0.95, v0 + 1.02)


def sill_wall(f, length, h, proud=0.08, t=0.46, seglen=(2.0, 3.2), bt="sill", skip=()):
    u = -proud
    end = length + proud
    while u < end - 0.05:
        l = min(R.uniform(*seglen), end - u)
        if end - (u + l) < 0.5:
            l = end - u
        if not any(a < u + l / 2 < b for (a, b) in skip):
            f.box(B(bt), u + 0.005, u + l - 0.005, -proud, t - proud, 0.0, h + jit(0.035), 0.03)
        u += l


# ---------------------------------------------------------------- props
def barrel(p, r=0.3, h=0.85, lying=False, water=False, mat="plank"):
    p = Vector(p)
    if lying:
        a, b = p + Vector((0, -h / 2, r)), p + Vector((0, h / 2, r))
    else:
        a, b = p, p + Vector((0, 0, h))
    cyl(B(mat), a, b, r * 0.86, r * 0.86, n=12, bulge=r * 0.14)
    for t in (0.12, 0.88):
        q0 = a.lerp(b, t - 0.035)
        q1 = a.lerp(b, t + 0.035)
        rr = r * 0.86 + r * 0.14 * math.sin(math.pi * t) + 0.012
        cyl(B("iron"), q0, q1, rr, n=12)
    if water and not lying:
        cyl(B("water"), b, b + Vector((0, 0, 0.006)), r * 0.8, n=12)


def woodpile(p0, p1, h=1.1, depth=0.7, char=False):
    """split billets stacked between two end stakes, p0->p1 along the ground (z=0)."""
    p0, p1 = Vector((p0[0], p0[1], 0.0)), Vector((p1[0], p1[1], 0.0))
    d = (p1 - p0); Ln = d.length; d.normalize()
    n = Vector((-d.y, d.x, 0))
    mat = "char" if char else "plank"
    rows = int(h / 0.19)
    for r_ in range(rows):
        cnt = int(Ln / 0.19)
        z = 0.09 + r_ * 0.175
        topfrac = 1.0 if r_ < rows - 1 else 0.65
        for i in range(int(cnt * topfrac)):
            q = p0 + d * (0.1 + i * Ln / cnt + jit(0.02)) + Vector((0, 0, z + jit(0.015)))
            l = depth * R.uniform(0.85, 1.05)
            rr = R.uniform(0.075, 0.095)
            cyl(B(mat), q - n * l / 2 + n * jit(0.05), q + n * l / 2 + n * jit(0.05), rr, rr * R.uniform(0.9, 1.0),
                n=R.choice((3, 4)))
    for q in (p0 - d * 0.05, p1 + d * 0.05):
        for sgn in (-1, 1):
            cyl(B("pole"), q + n * sgn * depth * 0.4, q + n * sgn * depth * 0.4 + Vector((jit(0.04), jit(0.04), h + 0.1)),
                0.04, 0.03, n=5)


def chopping_block(p, axe=True):
    p = Vector(p)
    cyl(B("oak"), p, p + Vector((0, 0, 0.45)), 0.24, 0.23, n=9)
    if axe:
        a = p + Vector((0.02, 0.0, 0.5))
        b = a + Vector((0.25, 0.35, 0.45))
        cyl(B("pole"), a, b, 0.018, n=5)
        box(B("iron"), a + Vector((-0.09, -0.03, -0.12)), a + Vector((0.09, 0.03, 0.03)), 0.0,
            rot=(0.0, 0.0, math.atan2(0.35, 0.25)))


def hurdle(p0, p1, h=1.05, rods=9, char=False):
    """woven hazel hurdle panel on sharpened zales."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0; Ln = d.length; d.normalize()
    n = Vector((-d.y, d.x, 0))
    nz = max(4, int(Ln / 0.3))
    mat = "char" if char else "pole"
    zales = [p0 + d * (Ln * k / nz) for k in range(nz + 1)]
    for k, q in enumerate(zales):
        top = h + (0.12 if k in (0, nz) else 0.02) + jit(0.03)
        if char:
            top *= R.uniform(0.3, 0.9)
        cyl(B(mat), q, q + Vector((jit(0.02), jit(0.02), top)), 0.03, 0.02, n=4)
    for r_ in range(rods):
        z = 0.14 + (h - 0.2) * r_ / (rods - 1)
        if char and z > h * R.uniform(0.3, 0.9):
            continue
        path = []
        for k, q in enumerate(zales):
            path.append(q + n * (0.035 if (k + r_) % 2 == 0 else -0.035) + Vector((0, 0, z + jit(0.015))))
        tube(B(mat), path, 0.034, sides=3)


def icoblob(bt, c, rx, ry, h, sub=2, seed=0.0, rough=0.25):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    pts = []
    for v in bm.verts:
        p = v.co
        k = 1.0 + rough * MN.noise(p * 1.7 + Vector((seed, seed * 2, 0)))
        z = max(0.0, p.z * h * k)
        pts.append((c[0] + p.x * rx * k, c[1] + p.y * ry * k, z))
    F = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    bt.add(pts, F, None, None)


def dung_heap(c, rx=1.1, ry=0.8, h=0.7, fork=True):
    """midden: a spread, lumpy heap of muck and soiled straw bedding, a fork left in it."""
    c = Vector(c)
    icoblob(B("dung"), c, rx, ry, h, 3, seed=c.x, rough=0.28)
    for k in range(3):   # forked-out lumps round the edge
        a = R.uniform(0, 6.28)
        q = c + Vector((math.cos(a) * rx * 0.85, math.sin(a) * ry * 0.85, 0))
        icoblob(B("dung"), q, rx * 0.35, ry * 0.35, h * 0.35, 2, seed=a, rough=0.5)
    for i in range(14):
        a = R.uniform(0, 6.28); rr = R.uniform(0.1, 0.8)
        q = c + Vector((math.cos(a) * rx * rr, math.sin(a) * ry * rr, h * (1 - rr * rr) * 0.75 + 0.02))
        e = Vector((R.uniform(-0.35, 0.35), R.uniform(-0.35, 0.35), R.uniform(-0.05, 0.08)))
        beam(B("straw"), q, q + e, R.uniform(0.04, 0.09), 0.015, 0.0)
    if fork:
        a = c + Vector((0.15, 0.05, h * 0.55))
        d = Vector((0.3, 0.25, 1.0)).normalized()
        cyl(B("pole"), a, a + d * 1.35, 0.02, n=5)
        for k in (-1, 0, 1):
            q = a + Vector((k * 0.045, 0, 0))
            cyl(B("iron"), q, q - d * 0.25, 0.008, 0.004, n=3)


def ladder(p0, p1, w=0.42, mat="pole"):
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0)
    sd = Vector((-d.y, d.x, 0)).normalized() if abs(d.x) + abs(d.y) > 1e-4 else Vector((1, 0, 0))
    for s_ in (-1, 1):
        cyl(B(mat), p0 + sd * s_ * w / 2, p1 + sd * s_ * w / 2, 0.035, 0.03, n=5)
    for k in range(1, int(d.length / 0.3)):
        q = p0 + d * (k * 0.3 / d.length)
        cyl(B(mat), q - sd * w / 2, q + sd * w / 2, 0.018, n=4)


def straw_bundles(c, n=10, along_x=True):
    c = Vector(c)
    k = 0
    row = 0
    while k < n:
        per = max(1, 5 - row)
        for i in range(per):
            if k >= n:
                break
            off = (i - (per - 1) / 2) * 0.27
            z = 0.13 + row * 0.22
            q = c + (Vector((0, off, z)) if along_x else Vector((off, 0, z)))
            dv = Vector((0.55, jit(0.06), 0)) if along_x else Vector((jit(0.06), 0.55, 0))
            cyl(B("straw"), q - dv, q + dv, 0.13, 0.11, n=6)
            k += 1
        row += 1


def trestle_timbers(c, length=3.5, n=4, mat="timber_new", along_x=True):
    c = Vector(c)
    for i in range(n):
        o = (i - (n - 1) / 2) * 0.3
        z = 0.12
        if along_x:
            beam(B(mat), c + Vector((-length / 2, o, z)), c + Vector((length / 2 + jit(0.2), o, z)), 0.22, 0.22, 0.01)
        else:
            beam(B(mat), c + Vector((o, -length / 2, z)), c + Vector((o, length / 2 + jit(0.2), z)), 0.22, 0.22, 0.01)
    for k in (-0.35, 0.35):
        o = Vector((length * k, 0, 0)) if along_x else Vector((0, length * k, 0))
        a = Vector((0, -0.7, 0.0)) if along_x else Vector((-0.7, 0, 0))
        beam(B("pole"), c + o + a, c + o - a, 0.1, 0.02, 0.0)


def site_ground(x0, x1, y0, y1):
    """cleared, trodden building-site earth under and around the footprint."""
    icoblob(B("soil"), ((x0 + x1) / 2, (y0 + y1) / 2), (x1 - x0) / 2, (y1 - y0) / 2, 0.04, 3, seed=x0 * 0.37, rough=0.15)


def scaffold_run(x0, x1, y_wall, z_deck, out=-1, standoff=(0.35, 1.3)):
    """independent pole scaffold with a plank staging along a wall (out = -1: in front, -Y)."""
    ya, yb = y_wall + out * standoff[0], y_wall + out * standoff[1]
    xs = grid(x0, x1, 2.2, 0.1)
    for x in xs:
        for yy in (ya, yb):
            cyl(B("pole"), (x + jit(0.04), yy + jit(0.04), 0), (x + jit(0.08), yy + jit(0.06), z_deck + 1.25),
                0.055, 0.045, n=6)
        beam(B("pole"), (x, ya - out * 0.15, z_deck - 0.06), (x, yb + out * 0.15, z_deck - 0.06), 0.08, 0.08, 0.0)
    for yy in (ya, yb):
        cyl(B("pole"), (x0 - 0.3, yy, z_deck - 0.16), (x1 + 0.3, yy, z_deck - 0.16 + jit(0.04)), 0.045, n=5)
        cyl(B("pole"), (x0 - 0.3, yy, z_deck + 0.95), (x1 + 0.3, yy, z_deck + 0.95 + jit(0.04)), 0.035, n=4)
    for k in range(3):
        yy = ya + (yb - ya) * (k + 0.5) / 3
        beam(B("plank"), (x0 - 0.25, yy, z_deck + 0.02), (x1 + 0.25, yy + jit(0.02), z_deck + 0.02 + jit(0.01)),
             0.29, 0.045, 0.0, side=(0, 0, 1))
    # cross bracing on the outer row
    for k in range(len(xs) - 1):
        a_, b_ = xs[k], xs[k + 1]
        cyl(B("pole"), (a_, yb, 0.2), (b_, yb, z_deck - 0.2), 0.035, n=4)


def stake_out(corners, h=0.8):
    for (x, y) in corners:
        cyl(B("pole"), (x, y, 0), (x + jit(0.03), y + jit(0.03), h), 0.035, 0.02, n=5)
    n = len(corners)
    for k in range(n):
        a, b = corners[k], corners[(k + 1) % n]
        beam(B("iron"), (a[0], a[1], h - 0.12), (b[0], b[1], h - 0.12 + jit(0.02)), 0.01, 0.01, 0.0)


def stone_pile(cx, cy, n=18, r=1.2, big=0.45, mat="rubble"):
    for i in range(n):
        a = R.uniform(0, 2 * math.pi)
        rr = r * math.sqrt(R.random())
        x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
        hh = (r - rr) * 0.55
        s_ = big * R.uniform(0.5, 1.0)
        z0 = hh * R.uniform(0.2, 0.9)
        box(B(mat), (x - s_ / 2, y - s_ * 0.35, z0), (x + s_ / 2, y + s_ * 0.35, z0 + s_ * 0.5), 0.03,
            rot=(jit(0.25), jit(0.25), R.uniform(0, 3)))


def rubble_heap(cx, cy, rx, ry, h, n=30, mat="rubble", size=(0.2, 0.5)):
    for i in range(n):
        a = R.uniform(0, 2 * math.pi)
        rr = math.sqrt(R.random())
        x, y = cx + math.cos(a) * rr * rx, cy + math.sin(a) * rr * ry
        z = h * (1 - rr * rr) * R.uniform(0.5, 1.0)
        s_ = R.uniform(*size)
        box(B(mat), (x - s_ / 2, y - s_ / 2, max(0, z - s_ / 2)), (x + s_ / 2, y + s_ * 0.3, max(0, z - s_ / 2) + s_ * 0.55),
            0.0, rot=(jit(0.4), jit(0.4), R.uniform(0, 3)))


def charred_beams(x0, x1, y0, y1, n=6, lmin=1.4, lmax=3.2, w=0.18):
    for i in range(n):
        x = R.uniform(x0, x1); y = R.uniform(y0, y1)
        a = R.uniform(0, math.pi); l = R.uniform(lmin, lmax)
        beam(B("char"), (x, y, w / 2), (x + math.cos(a) * l, y + math.sin(a) * l, R.uniform(0.1, 0.9)), w, w, 0.0)


def ash_mound(x0, x1, y0, y1, h=0.45):
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    icoblob(B("ash"), (cx, cy), (x1 - x0) / 2, (y1 - y0) / 2, h * 0.6, 3, seed=3.3, rough=0.25)
    for k in range(5):     # heaps where roof sections fell
        x = R.uniform(x0 + 1.0, x1 - 1.0); y = R.uniform(y0 + 0.8, y1 - 0.8)
        icoblob(B("ash"), (x, y), R.uniform(0.8, 1.6), R.uniform(0.6, 1.1), h * R.uniform(1.0, 1.8), 2, seed=x, rough=0.4)


# =====================================================================  shared bits
def studs(length, spacing, fixed=(), avoid=(), clear=0.3):
    n = max(1, int(round(length / spacing)))
    out = [length * k / n + (jit(0.04) if 0 < k < n else 0) for k in range(n + 1)]
    out = [u for u in out if all(abs(u - f) > clear for f in list(fixed) + list(avoid))]
    return sorted(out + list(fixed))


def four_faces(x0, x1, y0, y1):
    return {"front": (Face((x0, y0, 0), (0, -1, 0)), x1 - x0),
            "back": (Face((x1, y1, 0), (0, 1, 0)), x1 - x0),
            "left": (Face((x0, y1, 0), (-1, 0, 0)), y1 - y0),
            "right": (Face((x1, y0, 0), (1, 0, 0)), y1 - y0)}


def ruin_panels(f, length, z0, ztop, openings, mat="daub", keep=0.7):
    """broken daub panels left standing after a fire (wattle exposed where daub fell)."""
    u = 0.0
    while u < length - 0.05:
        l = min(R.uniform(0.9, 2.0), length - u)
        if not any(a - 0.1 < u + l / 2 < b + 0.1 for (a, b, v0, v1, k) in openings):
            top = z0 + (ztop - z0) * R.uniform(0.25, 0.95)
            if R.random() < keep:
                f.box(B(mat), u, u + l, 0.05, 0.19, z0, top)
                # ragged top: a couple of lumps
                for k in range(2):
                    a = u + R.uniform(0, l - 0.3)
                    f.box(B(mat), a, a + R.uniform(0.15, 0.4), 0.05, 0.19, top - 0.02, top + R.uniform(0.08, 0.3))
            else:
                f.box(B("wattle"), u, u + l, 0.09, 0.14, z0, z0 + (ztop - z0) * R.uniform(0.3, 0.8))
        u += l


# =====================================================================  HOUSE A: cruck longhouse
A_X0, A_X1, A_Y0, A_Y1 = -6.0, 6.0, -2.5, 2.5
A_SILL, A_PLATE, A_ZE, A_PITCH = 0.5, 2.45, 2.3, math.radians(50)
A_CRUCKS = (-3.2, 0.0, 3.2)
A_AY = 3.0


def a_blade_path(x, sgn, full):
    """cruck blade centre line; sgn -1 front / +1 back. full: up past the apex."""
    s = math.tan(A_PITCH)
    pts = [(-2.41, 0.5), (-2.40, 1.4), (-2.30, 2.3)]
    if full:
        for yy in (-1.6, -0.9, -0.3, 0.14):
            pts.append((yy, A_ZE + s * (A_AY + yy) - 0.72))
    else:
        pts.append((-2.08, 2.78))
    return [Vector((x + jit(0.015), sgn * -y, z)) for (y, z) in pts]


def a_blade(x, sgn, full=False, mat="oak", cut=None):
    path = a_blade_path(x, sgn, full)
    Lacc = 0.0
    for k in range(len(path) - 1):
        p0, p1 = path[k], path[k + 1]
        seg = (p1 - p0).length
        if cut is not None and Lacc + seg > cut:
            if cut - Lacc > 0.2:
                beam(B(mat), p0, p0.lerp(p1, (cut - Lacc) / seg), 0.3, 0.24, 0.02, side=(1, 0, 0), ext=0.02)
            return
        beam(B(mat), p0, p1, 0.3 - 0.015 * k, 0.24, 0.02 if k < 2 else 0.0, side=(1, 0, 0), ext=0.06)
        Lacc += seg


def a_openings():
    return {
        "front": [(1.45, 2.05, 1.2, 1.8, "win"), (4.05, 4.65, 1.2, 1.8, "win"),
                  (6.5, 7.5, 0.05, 1.9, "door"), (9.9, 11.2, 0.05, 1.85, "byre")],
        "back": [(4.5, 5.5, 0.05, 1.9, "door"), (8.7, 9.3, 1.25, 1.75, "win"), (1.3, 1.62, 1.5, 1.8, "vent")],
        "left": [(2.2, 2.7, 1.3, 1.75, "win")],
        "right": [(2.3, 2.7, 1.6, 1.78, "vent")],
    }


def a_walls(stage):
    faces = four_faces(A_X0, A_X1, A_Y0, A_Y1)
    ops = a_openings()
    crk = {"front": [x - A_X0 for x in A_CRUCKS], "back": [A_X1 - x for x in A_CRUCKS], "left": [], "right": []}
    for key, (f, Ln) in faces.items():
        op = ops[key]
        doors = [(a, b) for (a, b, v0, v1, k) in op if k in ("door", "byre")]
        skip = [(a - 0.02, b + 0.02) for (a, b) in doors]
        if key == "right":
            skip.append((2.28, 2.62))
        if stage == "build1":
            continue
        sill_wall(f, Ln, A_SILL, skip=skip)
        for (a, b) in doors:     # threshold stone
            f.box(B("sill"), a - 0.02, b + 0.02, -0.12, 0.38, 0.0, 0.07, 0.02)
        if key == "right":        # byre drain slot with a lintel stone over it
            f.box(B("sill"), 2.25, 2.65, -0.1, 0.38, 0.2, A_SILL, 0.02)
            f.box(B("dark"), 2.3, 2.6, 0.3, 0.34, 0.0, 0.2)
            f.box(B("dung"), 2.3, 2.6, -0.5, 0.2, 0.0, 0.03)
        fixed = [0.0, Ln] + [u for (a, b) in doors for u in (a - 0.1, b + 0.1)]
        posts = studs(Ln, 1.05, fixed=fixed, avoid=crk[key], clear=0.34)
        braces = [(0.1, 1.55, 0.9, 2.3), (Ln - 0.1, 1.55, Ln - 0.9, 2.3)]
        # door jambs down to the threshold
        for (a, b) in doors:
            for u in (a - 0.1, b + 0.1):
                f.timber(B("oak"), u, 0.07, u, A_SILL + 0.05, 0.2, 0.18, 0.0)
        z1 = A_PLATE
        if stage == "complete":
            frame_wall(f, Ln, A_SILL, z1, posts, [A_SILL + 0.09, 1.5, z1 - 0.09], op, braces,
                       infill="daub", slab_z=(A_SILL + 0.05, z1 - 0.04))
        elif stage == "build2":
            wat = key == "front"
            frame_wall(f, Ln, A_SILL, z1, posts if key != "back" else posts[::2], [A_SILL + 0.09, 1.5, z1 - 0.09],
                       [o for o in op if o[4] in ("door", "byre")] if not wat else op, braces,
                       infill="wattle", slab=wat, oak="timber_new", slab_z=(A_SILL + 0.05, z1 - 0.04))
        else:  # ruin
            frame_wall(f, Ln, A_SILL, z1, posts, [A_SILL + 0.09], op, braces[:1], keep=0.6, char=True,
                       slab=False, oak="char")
            ruin_panels(f, Ln, A_SILL + 0.05, z1 - 0.05, op)


def a_louvre(x, zc):
    """timber smoke louvre on the ridge."""
    dk, oak, pl = B("dark"), B("oak"), B("plank")
    w, d, h = 0.78, 0.6, 0.55
    z0 = zc - 0.2
    box(dk, (x - w / 2 + 0.05, -d / 2 + 0.05, z0), (x + w / 2 - 0.05, d / 2 - 0.05, z0 + h))
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(oak, (x + sx * w / 2 - 0.05, sy * d / 2 - 0.05, z0), (x + sx * w / 2 + 0.05, sy * d / 2 + 0.05, z0 + h + 0.05))
    for sy in (-1, 1):   # louvre boards, tilted
        for k in range(3):
            zz = z0 + 0.18 + k * 0.14
            box(pl, (x - w / 2 + 0.05, sy * d / 2 - 0.02, zz), (x + w / 2 - 0.05, sy * d / 2 + 0.02, zz + 0.12), 0.0,
                rot=(sy * 0.6, 0, 0))
    # little pitched cap, ridge along x
    zt = z0 + h + 0.05
    for sy in (-1, 1):
        pts = []
        for xx in (x - w / 2 - 0.12, x + w / 2 + 0.12):
            for (yy, zz) in ((sy * (d / 2 + 0.14), zt), (0.0, zt + 0.34)):
                pts += [(xx, yy, zz), (xx, yy, zz + 0.05)]
        prism_hull(B("shingle"), pts)


def house_a():
    st = STATE
    fr, bk = four_faces(A_X0, A_X1, A_Y0, A_Y1)["front"][0], None
    if st == "complete":
        a_walls("complete")
        for x in A_CRUCKS:
            for sgn in (-1, 1):
                a_blade(x, sgn)
        roof = HipRoof(A_X1 - A_X0, A_Y1 - A_Y0, 0.5, A_ZE, A_PITCH, seed=1.3).build()
        roof.ridge_cap(k0=11, off=0.1)
        zc = crest_z(0.0, A_ZE, A_AY, math.tan(A_PITCH)) - 0.07 * 0.9 * (1 - (-2.0 / 6.5) ** 2)
        a_louvre(-2.0, zc + 0.1)
        a_props()
    elif st == "build2":
        a_walls("build2")
        s = math.tan(A_PITCH)
        for x in A_CRUCKS:
            for sgn in (-1, 1):
                a_blade(x, sgn, full=True, mat="timber_new")
            zt = A_PLATE - 0.12
            beam(B("timber_new"), (x, -2.42, zt), (x, 2.42, zt), 0.24, 0.22, 0.015, ext=0.1)
            beam(B("timber_new"), (x, -1.05, 3.9), (x, 1.05, 3.9), 0.18, 0.16, 0.012, ext=0.12)
        zr = A_ZE + s * A_AY - 0.72 - 0.05
        beam(B("timber_new"), (-3.55, 0, zr), (3.55, 0, zr), 0.2, 0.2, 0.015)
        for sgn in (-1, 1):
            zp = A_ZE + s * (A_AY - 1.5) - 0.72 + 0.17
            beam(B("timber_new"), (-4.3, sgn * 1.5, zp), (4.3, sgn * 1.5, zp), 0.18, 0.18, 0.012)
            for sx in (-1, 1):   # hip rafters
                beam(B("timber_new"), (sx * 3.5, 0, zr + 0.1), (sx * 6.05, sgn * 2.55, A_PLATE), 0.14, 0.16, 0.0)
        # common rafters: back slope done, front only started; laths on the back
        for i, x in enumerate([-3.3 + 0.47 * k for k in range(15)]):
            for sgn in ((1, -1) if i % 3 == 0 else (1,)):
                beam(B("pole"), (x, sgn * 2.62, A_PLATE + 0.02), (x, sgn * 0.05, zr + 0.14), 0.1, 0.12, 0.0)
        for k in range(7):
            yy = 2.45 - k * 0.3
            zz = A_ZE + s * (A_AY - yy) - 0.72 + 0.27
            cyl(B("pole"), (-3.5, yy, zz), (3.5, yy, zz + jit(0.02)), 0.025, n=4)
        ladder((1.3, -3.9, 0), (1.3, -2.6, A_PLATE + 0.7))
        roof = HipRoof(A_X1 - A_X0, A_Y1 - A_Y0, 0.5, A_ZE, A_PITCH, seed=1.3)
        # thatchers work from the east hip round onto the back slope; front still bare
        roof.build_part(roof.nx + roof.nc - 1, roof.nx + 2 * roof.nc + roof.ny + int(roof.nx * 0.55), 11)
        scaffold_run(A_X0 + 0.3, A_X1 - 0.3, A_Y0, 1.75)
        site_ground(A_X0 - 1.6, A_X1 + 1.6, A_Y0 - 2.2, A_Y1 + 1.6)
        straw_bundles((-3.2, -4.3, 0), 12)
        straw_bundles((7.7, 0.4, 0), 8, along_x=False)
        trestle_timbers((-8.2, 0.5, 0), 3.0, 3, along_x=False)
        chopping_block((6.9, -2.6, 0), axe=True)
    elif st == "build1":
        a_walls("build1")
        site_ground(A_X0 - 1.6, A_X1 + 1.6, A_Y0 - 2.2, A_Y1 + 1.6)
        faces = four_faces(A_X0, A_X1, A_Y0, A_Y1)
        f, Ln = faces["front"]
        sill_wall(f, Ln, A_SILL, skip=[(6.45, 7.55), (9.85, 11.25)])
        f, Ln = faces["left"]
        sill_wall(f, Ln, A_SILL)
        f, Ln = faces["back"]
        sill_wall(f, 5.4, A_SILL * 0.6)
        # trench for the rest
        box(B("soil"), (A_X1 - 0.35, A_Y0 - 0.25, 0), (A_X1 + 0.35, A_Y1 + 0.25, 0.08), 0.03)
        box(B("soil"), (A_X0 - 0.2, A_Y1 - 0.15, 0), (0.4, A_Y1 + 0.55, 0.1), 0.03)
        rubble_heap(1.0, 4.2, 1.8, 0.6, 0.45, 18, "soil", (0.3, 0.6))
        stake_out([(A_X0 - 0.6, A_Y0 - 0.6), (A_X1 + 0.6, A_Y0 - 0.6), (A_X1 + 0.6, A_Y1 + 0.6), (A_X0 - 0.6, A_Y1 + 0.6)])
        # cruck blades lying ready in pairs (fresh oak), padstones set
        for x in A_CRUCKS:
            for sgn in (-1, 1):
                box(B("sill"), (x - 0.25, sgn * 2.42 - 0.22, 0), (x + 0.25, sgn * 2.42 + 0.22, 0.3), 0.03)
        for k in range(3):
            y0 = -1.6 + k * 0.55
            path = [Vector((-4.5, y0, 0.14)), Vector((-2.2, y0 + 0.08, 0.14)), Vector((0.2, y0 + 0.3, 0.14)),
                    Vector((2.2, y0 + 0.75, 0.14))]
            for i in range(3):
                beam(B("timber_new"), path[i], path[i + 1], 0.28, 0.24, 0.015, side=(0, 0, 1), ext=0.04)
        straw_bundles((-3.0, -4.4, 0), 10)
        stone_pile(4.2, -4.3, 16, 1.1, 0.4, "sill")
        trestle_timbers((3.2, 1.0, 0), 3.4, 4)
        chopping_block((7.2, 1.5, 0), axe=True)
    else:  # ruin
        a_walls("ruin")
        for i, x in enumerate(A_CRUCKS):
            if i == 1:
                # fallen truss: one blade down across the floor, the other snapped low
                path = [Vector((-0.6, -2.0, 0.3)), Vector((1.4, -0.4, 0.55)), Vector((3.2, 1.0, 0.95))]
                for k in range(2):
                    beam(B("char"), path[k], path[k + 1], 0.28, 0.22, 0.0)
                a_blade(x, 1, full=True, mat="char", cut=1.6)
                a_blade(x, -1, full=True, mat="char", cut=0.8)
                continue
            for sgn in (-1, 1):
                a_blade(x, sgn, full=True, mat="char", cut=R.uniform(2.6, 6.5))
            if i == 0:
                beam(B("char"), (x, -2.42, A_PLATE - 0.12), (x, 2.42, A_PLATE - 0.12), 0.22, 0.2, 0.0)
        ash_mound(A_X0 + 0.4, A_X1 - 0.4, A_Y0 + 0.4, A_Y1 - 0.4, 0.5)
        roof = HipRoof(A_X1 - A_X0, A_Y1 - A_Y0, 0.5, A_ZE, A_PITCH, seed=1.3)
        I = len(roof.grid[0])
        i0 = 2 * roof.nx + 2 * roof.nc + roof.ny + 2      # the west hip end, burnt and fallen in

        def slump(p, j):
            q = p.copy()
            q.z = max(0.25, q.z - 1.5 - 0.35 * j + 0.3 * math.sin(q.y * 1.3))
            q.x += 0.4
            return q
        roof.build_part(i0, i0 + roof.ny + 2 * roof.nc - 4, 6, key="burnt", slump=slump)
        charred_beams(-5.0, 5.0, -1.8, 1.8, 12)
        rubble_heap(-4.0, 3.6, 1.4, 0.7, 0.4, 14, "daub", (0.2, 0.45))
        rubble_heap(2.5, -3.5, 1.6, 0.7, 0.35, 14, "daub", (0.2, 0.45))
        a_props(ruin=True)


def a_props(ruin=False):
    barrel((-6.35, -2.75, 0), 0.3, 0.88, water=not ruin, lying=ruin)
    woodpile((-6.9, -1.7), (-6.9, 1.6), 1.15, 0.65, char=ruin)
    chopping_block((-8.0, 1.2, 0), axe=not ruin)
    dung_heap((7.1, -2.2, 0), 1.05, 0.85, 0.6, fork=not ruin)
    hurdle((6.35, 0.55, 0), (8.1, 0.55, 0), char=ruin)
    hurdle((8.1, 0.55, 0), (8.1, 2.4, 0), char=ruin)


# =====================================================================  HOUSE B: timber-framed cottage
B_X0, B_X1, B_Y0, B_Y1 = -4.0, 4.0, -2.5, 2.5
B_SILL, B_PLATE, B_ZE, B_PITCH = 0.36, 2.65, 2.6, math.radians(52)


def b_openings():
    return {
        "front": [(2.1, 3.05, 0.04, 1.95, "door"), (5.1, 6.1, 1.3, 1.95, "win"), (0.65, 1.15, 1.45, 1.92, "win")],
        "back": [(0.6, 1.15, 1.45, 1.9, "win")],
        "left": [(2.2, 2.75, 1.4, 1.9, "win")],
        "right": [],
    }


def b_gable(f, Ln, roof, stage):
    """framed gable triangle above the plate, following the thatch underside."""
    z0 = B_PLATE
    ys = [B_Y0 + Ln * k / 10 for k in range(11)]
    top = lambda u: roof.under_z(f.p(u, 0, 0).y) if roof else z0 + (Ln / 2 - abs(u - Ln / 2)) * math.tan(B_PITCH) - 0.2
    prof = [(u, top(u)) for u in [Ln * k / 10 for k in range(11)]]
    mat = "timber_new" if stage == "build2" else ("char" if stage == "ruin" else "oak")
    if stage == "complete":
        s = Batch("gable_%d" % len(BATCHES), "lime")
        pts = []
        for (u, v) in [(0.0, z0)] + prof[1:-1] + [(Ln, z0)]:
            for d in (0.05, 0.19):
                pts.append(f.p(u, d, max(z0, v)))
        prism_hull(s, pts)
        BATCHES["_g%d" % len(BATCHES)] = (s, None)
    ob = B(mat)
    apex = Ln / 2
    ztop = top(apex)
    f.timber(ob, 0.1, z0 + 0.05, apex, ztop - 0.05, 0.19, 0.18, 0.0)
    f.timber(ob, Ln - 0.1, z0 + 0.05, apex, ztop - 0.05, 0.19, 0.18, 0.0)
    f.timber(ob, apex, z0, apex, ztop - 0.12, 0.2, 0.18)
    zc = z0 + (ztop - z0) * 0.5
    half = apex * 0.5
    f.timber(ob, apex - half * 0.98, zc, apex + half * 0.98, zc, 0.17, 0.17)
    for sg in (-1, 1):
        f.timber(ob, apex + sg * half * 0.55, z0, apex + sg * half * 0.55, zc, 0.16, 0.17)


def b_hood(x, z0, z1):
    """wattle-and-daub smoke hood rising through the ridge: soot-stained, slightly tapered,
    with a boarded cap."""
    w, d = 0.74, 0.62
    s = Batch("hood_%d" % len(BATCHES), "hood")
    tp = 0.07
    pts = []
    for (zz, sh) in ((z0, 0.0), (z1, tp)):
        for sx in (-1, 1):
            for sy in (-1, 1):
                pts.append((x + sx * (w / 2 - sh), sy * (d / 2 - sh), zz))
    prism_hull(s, pts)
    BATCHES["_h%d" % len(BATCHES)] = (s, None)
    for sx in (-1, 1):
        for sy in (-1, 1):
            beam(B("oak"), (x + sx * (w / 2 - 0.02), sy * (d / 2 - 0.02), z0),
                 (x + sx * (w / 2 - tp - 0.0), sy * (d / 2 - tp - 0.0), z1 + 0.03), 0.09, 0.09, 0.01)
    box(B("dark"), (x - w / 2 + tp + 0.08, -d / 2 + tp + 0.08, z1 - 0.3), (x + w / 2 - tp - 0.08, d / 2 - tp - 0.08, z1 + 0.01))
    box(B("char"), (x - w / 2 + tp - 0.05, -d / 2 + tp - 0.05, z1 - 0.02),
        (x + w / 2 - tp + 0.05, d / 2 - tp + 0.05, z1 + 0.05), 0.01)


def b_outshut(stage):
    x0, x1, y0, y1 = -3.4, 2.4, B_Y1, 4.35
    zl, zt = 1.55, 2.42
    mat = {"complete": "oak", "build2": "timber_new", "ruin": "char"}[stage]
    for (x, y) in ((x0, y1), (x1, y1), ((x0 + x1) / 2, y1)):
        box(B("sill"), (x - 0.18, y - 0.18, 0), (x + 0.18, y + 0.18, 0.18), 0.02)
        top = zl if stage != "ruin" else R.uniform(0.5, 1.3)
        beam(B(mat), (x, y, 0.18), (x + jit(0.02), y, top), 0.16, 0.16, 0.012)
    if stage == "ruin":
        return
    beam(B(mat), (x0 - 0.1, y1, zl + 0.08), (x1 + 0.1, y1, zl + 0.08), 0.16, 0.18, 0.012)
    beam(B(mat), (x0 - 0.1, y0 + 0.1, zt - 0.1), (x1 + 0.1, y0 + 0.1, zt - 0.1), 0.14, 0.14, 0.01)
    for x in grid(x0, x1, 0.8):
        beam(B("pole" if stage == "build2" else "oak"), (x, y0 + 0.05, zt - 0.1), (x, y1 + 0.3, zl - 0.02), 0.09, 0.1, 0.0,
             side=(0, 0, 1))
    if stage == "build2":
        return
    roof_rows(B("shingle"), Matrix.Identity(4), x0 - 0.25, x1 + 0.25, (y1 + 0.42, zl + 0.05), (y0 + 0.02, zt + 0.1),
              row_w=0.3, thick=0.03, lift=0.03, sag=0.05, seg=6)
    # vertical boards: back wall and both ends
    for x in grid(x0, x1, 0.27, 0.0)[:-1]:
        beam(B("plank"), (x + 0.135, y1 + 0.09, 0.05), (x + 0.135 + jit(0.01), y1 + 0.09, zl + 0.05 + jit(0.02)),
             0.26 * R.uniform(0.9, 1.04), 0.035, 0.005, side=(0, 1, 0))
    for xe, sgn in ((x0, -1), (x1, 1)):
        for y in grid(y0 + 0.02, y1, 0.27, 0.0)[:-1]:
            h = zt - (zt - zl) * (y + 0.135 - y0) / (y1 - y0)
            if xe == x1 and 0.25 < y - y0 < 1.2:
                continue     # doorway at the east end
            beam(B("plank"), (xe + sgn * 0.09, y + 0.135, 0.05), (xe + sgn * 0.09, y + 0.135, h + jit(0.02)),
                 0.26 * R.uniform(0.9, 1.04), 0.035, 0.005, side=(1, 0, 0))
    f = Face((x1, y0, 0), (1, 0, 0))
    f.box(B("dark"), 0.25, 1.2, 0.4, 0.44, 0.0, 1.5)
    door_leaf2(f, 0.27, 1.18, 0.0, 1.5, depth=0.06)


def house_b():
    st = STATE
    faces = four_faces(B_X0, B_X1, B_Y0, B_Y1)
    ops = b_openings()
    roof = None
    if st in ("complete",):
        roof = GableRoof(B_X0 - 0.42, B_X1 + 0.42, B_Y1 - B_Y0, 0.45, B_ZE, B_PITCH, seed=4.2, step=0.33)
    for key, (f, Ln) in faces.items():
        op = ops[key]
        doors = [(a, b) for (a, b, v0, v1, k) in op if k == "door"]
        if st == "build1":
            continue
        sill_wall(f, Ln, B_SILL, skip=[(a - 0.02, b + 0.02) for (a, b) in doors], seglen=(1.4, 2.2))
        for (a, b) in doors:
            f.box(B("sill"), a - 0.02, b + 0.02, -0.12, 0.38, 0.0, 0.06, 0.02)
            for u in (a - 0.1, b + 0.1):
                f.timber(B("oak" if st != "build2" else "timber_new"), u, 0.06, u, B_SILL + 0.05, 0.2, 0.18, 0.0)
        close = key == "front"
        bay = [Ln / 2] if key in ("front", "back") else []
        fixed = [0.0, Ln] + bay + [u for (a, b) in doors for u in (a - 0.1, b + 0.1)]
        posts = studs(Ln, 0.45 if close else 0.95, fixed=fixed, clear=0.28 if close else 0.34)
        braces = [] if close else [(0.12, 1.45, 0.95, B_PLATE - 0.12), (Ln - 0.12, 1.45, Ln - 0.95, B_PLATE - 0.12)]
        rails = [B_SILL + 0.09, 1.45, B_PLATE - 0.09]
        if st == "complete":
            frame_wall(f, Ln, B_SILL, B_PLATE, posts, rails, op, braces, stud=0.19 if close else 0.2,
                       infill="lime", slab_z=(B_SILL + 0.05, B_PLATE - 0.04))
        elif st == "build2":
            frame_wall(f, Ln, B_SILL, B_PLATE, posts, rails, [o for o in op if o[4] == "door"] if key != "left" else op,
                       braces, infill="wattle", slab=(key == "left"), oak="timber_new",
                       slab_z=(B_SILL + 0.05, B_PLATE - 0.04))
        else:
            frame_wall(f, Ln, B_SILL, B_PLATE, posts, rails[:1], op, braces[:1], keep=0.55, char=True,
                       slab=False, oak="char")
            ruin_panels(f, Ln, B_SILL + 0.05, B_PLATE - 0.05, op, mat="lime")
        if key in ("left", "right") and st in ("complete", "build2"):
            b_gable(f, Ln, roof, st)
        if key == "left" and st == "ruin":
            b_gable(f, Ln, None, st)
    s = math.tan(B_PITCH)
    if st == "complete":
        roof.build()
        roof.ridge_cap(k=4, off=0.1)
        zc = crest_z(0.0, B_ZE, roof.ay, s)
        b_hood(1.25, zc - 1.2, zc + 0.7)
        b_outshut("complete")
        b_props()
    elif st == "build2":
        zr = B_ZE + s * 2.95 - 0.62
        for x in (B_X0, 0.0, B_X1):
            beam(B("timber_new"), (x, -2.42, B_PLATE - 0.1), (x, 2.42, B_PLATE - 0.1), 0.22, 0.22, 0.015, ext=0.12)
        beam(B("timber_new"), (B_X0 - 0.3, 0, zr), (B_X1 + 0.3, 0, zr), 0.18, 0.2, 0.012)
        for i, x in enumerate(grid(B_X0 + 0.05, B_X1 - 0.05, 0.5)):
            for sgn in (-1, 1):
                beam(B("pole"), (x, sgn * 2.7, B_PLATE - 0.05), (x, 0.0, zr + 0.12), 0.1, 0.12, 0.0)
        for k in range(6):
            yy = -2.4 + k * 0.32
            zz = B_PLATE + s * (yy + 2.5) + 0.04
            cyl(B("pole"), (B_X0 - 0.2, yy, zz), (B_X1 + 0.2, yy, zz), 0.025, n=4)
        b_outshut("build2")
        ladder((-1.0, -3.9, 0), (-1.0, -2.6, B_PLATE + 0.7))
        roof = GableRoof(B_X0 - 0.42, B_X1 + 0.42, B_Y1 - B_Y0, 0.45, B_ZE, B_PITCH, seed=4.2, step=0.33)
        c = roof.J // 2
        nX = len(roof.xs)
        roof.build_part(0, c - 1, 0, int(nX * 0.38))                  # a finished lane, eave to ridge
        roof.build_part(0, c - 6, int(nX * 0.38), int(nX * 0.56))     # the next lane half laid
        scaffold_run(B_X0 + 0.2, B_X1 - 0.2, B_Y0, 1.9)
        site_ground(B_X0 - 1.5, B_X1 + 1.5, B_Y0 - 2.1, B_Y1 + 2.2)
        straw_bundles((0.5, -4.2, 0), 12)
        trestle_timbers((-5.9, 0.0, 0), 3.0, 3, along_x=False)
        chopping_block((5.4, 1.4, 0))
    elif st == "build1":
        site_ground(B_X0 - 1.5, B_X1 + 1.5, B_Y0 - 2.1, B_Y1 + 2.2)
        stake_out([(B_X0 - 0.6, B_Y0 - 0.6), (B_X1 + 0.6, B_Y0 - 0.6), (B_X1 + 0.6, B_Y1 + 0.6), (B_X0 - 0.6, B_Y1 + 0.6)])
        f, Ln = faces["front"]
        sill_wall(f, Ln, B_SILL, skip=[(2.08, 3.07)], seglen=(1.4, 2.2))
        f, Ln = faces["right"]
        sill_wall(f, Ln, B_SILL, seglen=(1.4, 2.2))
        f, Ln = faces["back"]
        sill_wall(f, 3.4, B_SILL * 0.6, seglen=(1.2, 1.8))
        box(B("soil"), (B_X0 - 0.3, B_Y0 + 0.2, 0), (B_X0 + 0.3, B_Y1 + 0.2, 0.08), 0.03)
        box(B("soil"), (B_X0 - 0.1, B_Y1 - 0.2, 0), (0.6, B_Y1 + 0.3, 0.08), 0.03)
        # sill beams laid out ready
        beam(B("timber_new"), (B_X0, B_Y0 + 0.08, B_SILL + 0.11), (B_X1, B_Y0 + 0.08, B_SILL + 0.11), 0.2, 0.2, 0.012)
        trestle_timbers((0.0, 0.2, 0), 3.8, 4)
        trestle_timbers((0.0, 1.6, 0), 3.2, 3)
        stone_pile(-5.4, -2.2, 12, 0.9, 0.36, "sill")
        straw_bundles((5.6, -1.0, 0), 8, along_x=False)
        rubble_heap(-2.0, 3.9, 1.4, 0.5, 0.4, 14, "soil", (0.3, 0.6))
    else:
        b_outshut("ruin")
        roof = GableRoof(B_X0 - 0.42, B_X1 + 0.42, B_Y1 - B_Y0, 0.45, B_ZE, B_PITCH, seed=4.2, step=0.33)

        def slump(p, j):
            q = p.copy()
            q.z = max(0.25, q.z * 0.42 - 0.1 + 0.25 * math.sin(q.x * 1.1))
            return q
        roof.build_part(0, roof.J // 2 - 1, len(roof.xs) - 9, len(roof.xs) - 2, key="burnt", slump=slump)
        ash_mound(B_X0 + 0.35, B_X1 - 0.35, B_Y0 + 0.35, B_Y1 - 0.35, 0.55)
        for x in (B_X0,):
            beam(B("char"), (x, -2.42, B_PLATE - 0.1), (x, 2.42, B_PLATE - 0.1), 0.22, 0.2, 0.0)
        charred_beams(-3.2, 3.2, -1.8, 1.8, 9)
        # the hood slumped: daub blocks and charred corner posts
        rubble_heap(1.3, 0.2, 0.9, 0.7, 0.9, 12, "lime", (0.25, 0.45))
        # the outshut roof fell as one piece, lying tilted against the burnt wall
        roof_rows(B("shingle"), Matrix.Identity(4), -3.0, 1.0, (4.6, 0.12), (2.8, 1.05), row_w=0.3, thick=0.03,
                  lift=0.03, sag=0.08, seg=5)
        b_props(ruin=True)


def b_props(ruin=False):
    barrel((4.35, -2.85, 0), 0.29, 0.86, water=not ruin, lying=ruin)
    woodpile((4.8, -1.6), (4.8, 1.3), 1.1, 0.62, char=ruin)
    chopping_block((5.6, 1.9, 0), axe=not ruin)
    hurdle((-4.3, -4.45, 0), (-6.0, -4.45, 0), char=ruin)
    hurdle((-6.0, -4.45, 0), (-6.0, -2.7, 0), char=ruin)
    dung_heap((-5.1, -3.3, 0), 0.8, 0.65, 0.5, fork=not ruin)


# =====================================================================  HOUSE C: upland stone cottage
C_X0, C_X1, C_Y0, C_Y1 = -4.5, 4.5, -2.5, 2.5
C_T, C_EAVE, C_PITCH = 0.6, 2.45, math.radians(38)
C_OV, C_VERGE = 0.24, 0.14


def c_ridge_z():
    return C_EAVE + (C_Y1 + C_OV) * math.tan(C_PITCH) - 0.05


def c_openings():
    return {
        "front": [(3.2, 4.15, 0.0, 1.9, "door"), (1.3, 1.95, 1.05, 1.75, "win"), (5.8, 6.5, 1.05, 1.75, "win")],
        "back": [(3.6, 4.1, 1.15, 1.7, "win")],
        "left": [(2.25, 2.75, 2.75, 3.2, "win")],
        "right": [],
    }


def c_walls(stage, cap=None):
    faces = four_faces(C_X0, C_X1, C_Y0, C_Y1)
    ops = c_openings()
    wb = Batch("cwall", "rubble")
    cut = Batch("ccut", "dark")
    s = math.tan(C_PITCH)
    ruin = stage == "ruin"
    zr_under = c_ridge_z() - 0.2
    for key, (f, Ln) in faces.items():
        op = ops[key]
        gable = key in ("left", "right")
        top = cap if cap is not None else C_EAVE
        # wall body in vertical slices (ragged tops for ruin/build states)
        u = 0.0
        hprev = None
        while u < Ln - 0.01:
            l = min(R.uniform(0.7, 1.3), Ln - u) if (ruin or cap is not None) else Ln
            if Ln - (u + l) < 0.3:
                l = Ln - u
            if gable and not ruin and cap is None:
                # full gable: profile follows the roof underside
                prof = []
                for k in range(9):
                    uu = Ln * k / 8
                    yy = f.p(uu, 0, 0).y
                    zz = max(C_EAVE, C_EAVE + (C_Y1 - abs(yy)) * s - 0.02)
                    prof.append((uu, zz))
                pts = [f.p(0, d, 0) for d in (0, C_T)] + [f.p(Ln, d, 0) for d in (0, C_T)]
                pts += [f.p(uu, d, zz) for (uu, zz) in prof for d in (0, C_T)]
                prism_hull(wb, pts)
                break

            def hgt(uu):
                if ruin:
                    base = (hprev if hprev is not None else top * R.uniform(0.7, 1.0))
                    hh = min(top, max(0.85, base + R.uniform(-0.55, 0.45)))
                    for (oa, ob, ov0, ov1, ok_) in op:    # keep lintels carried
                        if oa - 0.45 < uu < ob + 0.45:
                            hh = max(hh, ov1 + 0.4)
                    if gable and key == "left":     # one gable still half standing
                        hh = max(hh, C_EAVE + max(0.0, (Ln / 2 - abs(uu - Ln / 2)) * s * R.uniform(0.45, 0.9)))
                    return hh
                if cap is not None:
                    return cap + R.uniform(-0.12, 0.08)
                return top
            if hprev is None:
                hprev = hgt(u)
            hend = hgt(u + l)
            uu0, uu1 = u, u + l
            if gable:
                uu0 = max(uu0, C_T - 0.01) if u == 0 else uu0
                uu1 = min(uu1, Ln - C_T + 0.01) if u + l >= Ln - 0.01 else uu1
            pts = []
            for d in (0.0, C_T):
                pts += [f.p(uu0, d, 0.0), f.p(uu1, d, 0.0), f.p(uu0, d, hprev), f.p(uu1, d, hend)]
            prism_hull(wb, pts)
            if ruin:     # loose stones left on the broken wall head
                for k in range(2):
                    t = R.random()
                    f.box(B("rubble"), uu0 + (uu1 - uu0) * t - 0.15, uu0 + (uu1 - uu0) * t + 0.15, R.uniform(0.0, 0.3),
                          R.uniform(0.3, 0.6), hprev + (hend - hprev) * t - 0.05, hprev + (hend - hprev) * t + 0.12, 0.0,
                          )
            hprev = hend
            u += l
        for (a, b, v0, v1, kind) in op:
            if cap is not None and v0 > cap:
                continue
            f.box(cut, a, b, -0.2, C_T + 0.2, v0, v1)
            # stone dressings: lintel, sill, jambs
            if cap is None or v1 < cap:
                f.box(B("ashlar"), a - 0.22 + jit(0.03), b + 0.22 + jit(0.03), -0.03, C_T * 0.7, v1, v1 + 0.3, 0.02)
            if kind == "win":
                f.box(B("ashlar"), a - 0.08, b + 0.08, -0.07, C_T * 0.6, v0 - 0.12, v0 + 0.005, 0.02)
            for sgn, uu in ((-1, a), (1, b)):
                zz = v0 if kind == "win" else 0.0
                k = 0
                while zz < min(v1, cap if cap is not None else 99) - 0.05:
                    hh = min(R.uniform(0.3, 0.42), v1 - zz)
                    wid = 0.3 if k % 2 == 0 else 0.18
                    if sgn < 0:
                        f.box(B("ashlar"), uu - wid, uu + 0.005, -0.025, 0.22, zz + 0.006, zz + hh - 0.006)
                    else:
                        f.box(B("ashlar"), uu - 0.005, uu + wid, -0.025, 0.22, zz + 0.006, zz + hh - 0.006)
                    zz += hh; k += 1
            if stage == "complete":
                dress_opening(f, a, b, v0, v1, kind, depth=0.3, stone=True)
            elif stage == "ruin":
                f.box(B("dark"), a - 0.04, b + 0.04, C_T - 0.05, C_T - 0.01, v0, v1)
            if kind == "door" and stage == "complete":
                f.box(B("sill"), a - 0.05, b + 0.05, -0.2, 0.35, 0.0, 0.08, 0.02)
        # projecting through-stones / irregular faces for real relief
        for k in range(int(Ln * (2 if not ruin else 1.5))):
            uu = R.uniform(0.3, Ln - 0.3)
            vv = R.uniform(0.15, (cap or C_EAVE) - 0.25)
            if any(a - 0.3 < uu < b + 0.3 and v0 - 0.3 < vv < v1 + 0.4 for (a, b, v0, v1, kk) in op):
                continue
            w_ = R.uniform(0.25, 0.5); h_ = R.uniform(0.12, 0.24)
            f.box(B("rubble"), uu, uu + w_, -R.uniform(0.02, 0.05), 0.1, vv, vv + h_, 0.02)
        # footing course
        f.box(B("rubble"), -0.06, Ln + 0.06, -0.07, 0.2, 0.0, 0.28 + jit(0.02), 0.02)
    BATCHES["_cwall"] = (wb, cut)
    # quoins
    if not ruin:
        zq = cap if cap is not None else C_EAVE
        corners = [((C_X0, C_Y0), (0, -1, 0), (-1, 0, 0)), ((C_X1, C_Y0), (0, -1, 0), (1, 0, 0)),
                   ((C_X1, C_Y1), (0, 1, 0), (1, 0, 0)), ((C_X0, C_Y1), (0, 1, 0), (-1, 0, 0))]
        for (c, nA, nB) in corners:
            quoins(c, nA, nB, 0.0, zq)


def quoins(corner, nA, nB, z0, z1, course=0.36, la=0.55, lb=0.3, proud=0.03):
    C = Vector(corner + (0,))
    nA, nB = Vector(nA), Vector(nB)
    z = z0
    k = 0
    while z < z1 - 0.1:
        hgt = min(course * R.uniform(0.88, 1.12), z1 - z)
        a_len, b_len = (la, lb) if k % 2 == 0 else (lb, la)
        a_len *= R.uniform(0.9, 1.12); b_len *= R.uniform(0.9, 1.12)
        p0 = C + nA * proud + nB * proud
        p1 = C - nB * a_len - nA * b_len
        lo = Vector((min(p0.x, p1.x), min(p0.y, p1.y), z + 0.008))
        hi = Vector((max(p0.x, p1.x), max(p0.y, p1.y), z + hgt - 0.008))
        box(B("ashlar"), lo, hi, 0.02, rot=(0, 0, jit(0.01)))
        z += hgt
        k += 1


def c_roof(stage):
    s = math.tan(C_PITCH)
    ay = C_Y1 + C_OV
    ze = C_EAVE - C_OV * s + 0.02
    zr = ze + ay * s
    x0, x1 = C_X0 - C_VERGE, C_X1 + C_VERGE
    for side in (1, -1):
        M = Matrix.Identity(4) if side == 1 else Matrix.Rotation(math.pi, 4, "Z")
        flag_rows(B("flag"), M, x0, x1, (-ay, ze), (0.0, zr))
    Mi = Matrix.Identity(4)
    ridge_tiles(B("flag"), Mi, x0, x1, 0.0, zr + 0.04, r=0.19, piece=0.75, n=2)
    # wooden structure seen under the verges: purlin ends
    for yy in (-1.35, 1.35):
        zz = ze + (ay - abs(yy)) * s - 0.18
        for xe in (C_X0 - 0.1, C_X1 + 0.1):
            box(B("oak"), (xe - 0.1, yy - 0.1, zz - 0.1), (xe + 0.1, yy + 0.1, zz + 0.1), 0.01)
    return zr


def flag_rows(bt, M, x0, x1, eave, ridge, w0=0.72, w1=0.36, lap=0.45, thick=0.06):
    """graded stone-slate courses: big heavy flags at the eaves diminishing to the ridge.
    Each course is split into individual flags of random width, each with its own tilt and
    thickness, so the roof reads as laid stone rather than a strip."""
    ey, ez = eave
    ry, rz = ridge
    d = Vector((0, ry - ey, rz - ez))
    Ls = d.length
    dn = d / Ls
    n = Vector((1, 0, 0)).cross(dn)
    if n.z < 0:
        n = -n
    base = Vector((0, ey, ez))
    s0 = 0.0
    k = 0
    while s0 < Ls - 0.12:
        t = s0 / Ls
        rw = (w0 + (w1 - w0) * t) * R.uniform(0.93, 1.07)
        rw = min(rw, Ls - s0 + 0.05)
        lift = 0.0 if k == 0 else thick * 0.9
        x = x0 - R.uniform(0.0, 0.25)
        while x < x1 - 0.05:
            fw = min(rw * R.uniform(1.2, 2.2), x1 - x)
            if x1 - (x + fw) < 0.15:
                fw = x1 - x
            th = thick * R.uniform(0.75, 1.2) * (1.15 - 0.3 * t)
            tilt = jit(0.035)
            ds = jit(0.03)
            pts, loc = [], []
            for (xx, ss, oo) in ((x + 0.008, s0 + ds, 0), (x + fw - 0.008, s0 + ds + jit(0.02), 0),
                                 (x + 0.008, s0 + rw, 1), (x + fw - 0.008, s0 + rw + jit(0.02), 1)):
                up = (lift + tilt * (xx - x)) if oo == 0 else lift * 0.1
                for dd in (0.0, th):
                    q = base + dn * max(0.0, ss) + n * (up + dd + jit(0.006))
                    q = Vector((xx, q.y, q.z))
                    pts.append(tuple(M @ q))
                    loc.append((0.25 + 0.5 * (xx - x) / fw, ss - s0, dd))
            P_, F_ = hull([Vector(p) for p in pts])
            lk = {tuple(round(c, 5) for c in p): l for p, l in zip(pts, loc)}
            bt.add(P_, F_, None, None, [lk.get(tuple(round(c, 5) for c in p), (0.5, 0.1, 0.0)) for p in P_])
            x += fw
        s0 += rw * (1 - lap)
        k += 1


def c_chimney(stage, zr):
    x0, x1 = C_X1 - 0.8, C_X1 + 0.05
    y0, y1 = -0.5, 0.5
    top = zr + 1.0 if stage != "ruin" else zr + 0.4
    box(B("chimney"), (x0, y0, C_EAVE), (x1, y1, top), 0.02)
    if stage == "ruin":
        return
    box(B("ashlar"), (x0 - 0.07, y0 - 0.07, zr + 0.25), (x1 + 0.07, y1 + 0.07, zr + 0.37), 0.02)
    box(B("ashlar"), (x0 - 0.08, y0 - 0.08, top), (x1 + 0.08, y1 + 0.08, top + 0.12), 0.02)
    box(B("dark"), (x0 + 0.18, y0 + 0.2, top + 0.1), (x1 - 0.18, y1 - 0.2, top + 0.125))
    for yy in (y0 + 0.1, y1 - 0.25):
        box(B("chimney"), (x0 + 0.1, yy, top + 0.12), (x1 - 0.1, yy + 0.15, top + 0.4), 0.02)
    box(B("ashlar"), (x0 + 0.02, y0 + 0.05, top + 0.4), (x1 - 0.02, y1 - 0.05, top + 0.5), 0.02)


def house_c():
    st = STATE
    if st == "complete":
        c_walls("complete")
        zr = c_roof("complete")
        c_chimney("complete", zr)
        c_props()
    elif st == "build2":
        c_walls("build2", cap=1.65)
        site_ground(C_X0 - 1.6, C_X1 + 1.6, C_Y0 - 2.4, C_Y1 + 1.8)
        # putlog scaffold along the front
        for x in grid(C_X0 - 0.3, C_X1 + 0.3, 2.3, 0.0):
            cyl(B("pole"), (x, C_Y0 - 1.2, 0), (x + jit(0.05), C_Y0 - 1.2 + jit(0.05), 3.2), 0.06, 0.05, n=6)
        for z in (1.5,):
            cyl(B("pole"), (C_X0 - 0.6, C_Y0 - 1.25, z), (C_X1 + 0.6, C_Y0 - 1.25, z + jit(0.05)), 0.045, n=5)
            for x in grid(C_X0, C_X1, 1.1, 0.0):
                beam(B("pole"), (x, C_Y0 + 0.25, z + 0.06), (x, C_Y0 - 1.4, z + 0.06), 0.08, 0.08, 0.0)
            for k in range(3):
                beam(B("plank"), (C_X0 - 0.4, C_Y0 - 0.2 - k * 0.32, z + 0.13), (C_X1 + 0.4, C_Y0 - 0.2 - k * 0.32, z + 0.13),
                     0.3, 0.04, 0.0, side=(0, 0, 1))
        ladder((C_X1 + 0.9, C_Y0 - 1.6, 0), (C_X1 + 0.5, C_Y0 - 1.2, 2.3))
        stone_pile(-2.0, -4.6, 22, 1.3, 0.42)
        stone_pile(6.4, 1.0, 18, 1.1, 0.4)
        stone_pile(-6.3, -0.5, 10, 0.9, 0.5, "flag")
        trestle_timbers((0.5, 4.2, 0), 4.5, 4)
        barrel((5.8, -2.8, 0), 0.4, 0.42)
    elif st == "build1":
        c_walls("build1", cap=0.55)
        site_ground(C_X0 - 1.6, C_X1 + 1.6, C_Y0 - 2.4, C_Y1 + 1.8)
        stake_out([(C_X0 - 0.7, C_Y0 - 0.7), (C_X1 + 0.7, C_Y0 - 0.7), (C_X1 + 0.7, C_Y1 + 0.7), (C_X0 - 0.7, C_Y1 + 0.7)])
        stone_pile(-1.5, -4.2, 26, 1.4, 0.45)
        stone_pile(6.5, 0.5, 20, 1.2, 0.42)
        stone_pile(-6.6, 0.5, 12, 1.0, 0.4)
        rubble_heap(1.0, 3.9, 2.4, 0.7, 0.5, 22, "soil", (0.3, 0.6))
        barrel((3.8, -3.9, 0), 0.42, 0.42)
    else:
        c_walls("ruin")
        zr = c_ridge_z()
        c_chimney("ruin", zr)
        rubble_heap(0.0, 0.0, 3.2, 1.5, 0.7, 45, "flag", (0.3, 0.6))
        rubble_heap(-2.0, 0.6, 1.5, 1.0, 0.5, 18, "rubble", (0.25, 0.5))
        rubble_heap(3.3, -3.4, 1.1, 0.5, 0.3, 12, "rubble", (0.2, 0.4))
        rubble_heap(-5.2, 1.0, 0.6, 1.2, 0.35, 12, "rubble", (0.2, 0.4))
        charred_beams(-3.2, 3.2, -1.2, 1.2, 5, 2.0, 4.0, 0.2)
        # a purlin still spanning, leaning from the standing gable
        beam(B("char"), (C_X0 + 0.3, 1.3, 2.9), (0.8, 1.0, 0.3), 0.2, 0.2, 0.0)
        c_props(ruin=True)


def c_props(ruin=False):
    barrel((-4.95, -2.9, 0), 0.3, 0.88, water=not ruin, lying=ruin)
    # stone trough by the door
    box(B("ashlar"), (-1.2, -3.55, 0), (0.2, -2.95, 0.45), 0.04)
    if not ruin:
        box(B("water"), (-1.1, -3.47, 0.4), (0.1, -3.03, 0.455))
    woodpile((5.15, -1.5), (5.15, 1.5), 1.05, 0.62, char=ruin)
    chopping_block((6.1, 1.9, 0), axe=not ruin)
    hurdle((-4.7, 2.7, 0), (-6.4, 2.7, 0), char=ruin)
    hurdle((-6.4, 2.7, 0), (-6.4, 1.0, 0), char=ruin)
    dung_heap((-5.8, -1.2, 0), 0.8, 0.65, 0.6, fork=not ruin)


# =====================================================================  MAIN
def grid(a, b, step, jitter=0.04):
    n = max(1, round((b - a) / step))
    return [a + (b - a) * i / n + (jit(jitter) if 0 < i < n else 0) for i in range(n + 1)]


def cleanup():
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        bm = bmesh.new(); bm.from_mesh(o.data)
        kill = [f for f in bm.faces if f.normal.z < -0.95 and all(v.co.z < 0.005 for v in f.verts)]
        if kill:
            bmesh.ops.delete(bm, geom=kill, context="FACES_ONLY")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(o.data); bm.free()


def balance():
    """finish() centres the combined bbox: keep the HOUSE on the origin by adding a small
    stone at the opposite extreme when the props make the bbox lopsided."""
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for bt in BATCHES.values():
        for b_ in (bt if isinstance(bt, tuple) else (bt,)):
            if b_ is None or not isinstance(b_, Batch) or b_.name.startswith(("scut", "ccut")):
                continue
            for p in b_.V:
                lo = Vector(map(min, lo, p)); hi = Vector(map(max, hi, p))
    print("HG_BBOX", tuple(round(c, 2) for c in lo), tuple(round(c, 2) for c in hi))
    for ax in (0, 1):
        off = lo[ax] + hi[ax]
        if abs(off) > 0.03:
            c = [0.0, 0.0]
            c[ax] = -hi[ax] + 0.22 if off > 0 else -lo[ax] - 0.22
            c[1 - ax] = R.uniform(-0.5, 0.5)
            icoblob(B("sill"), (c[0], c[1]), 0.24, 0.2, 0.16, 2, seed=c[0] + c[1], rough=0.3)


SOOT = {"a": (-2.0, 0.0, 5.7), "b": (1.25, 0.0, 6.9), "c": None}[VARIANT]
CHIM_TOP = c_ridge_z() + 1.5 if VARIANT == "c" else 99.0


def main():
    build_materials()
    {"a": house_a, "b": house_b, "c": house_c}[VARIANT]()
    balance()
    for k, v in list(BATCHES.items()):
        if isinstance(v, tuple):
            s, c = v
            ob = s.build()
            if ob is not None and c is not None and c.F:
                apply_boolean(ob, cutter_obj(c))
        elif not k.startswith("_"):
            v.build()
    cleanup()
    stats = {}
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and not o.hide_render:
            k = o.data.materials[0].name if o.data.materials else "?"
            t = sum(len(p.vertices) - 2 for p in o.data.polygons)
            stats[k] = stats.get(k, 0) + t
    print("HG_TRIS_PRE", sum(stats.values()))
    for k, t in sorted(stats.items(), key=lambda x: -x[1]):
        print("HG_STAT %-10s tris %6d" % (k, t))
    for o in [o for o in bpy.context.scene.objects if o.hide_render]:
        bpy.data.objects.remove(o, do_unlink=True)
    if os.environ.get("HG_DRY"):
        return
    name = "house_" + VARIANT + ("" if FULL else "_" + STATE)
    path = L.finish(name, tex=int(os.environ.get("HG_TEX", 2048)), lods=(1.0, 0.4, 0.12))
    if VARIANT == "a":     # the settlement file references plain `house`
        alias = os.path.join(L.GLB_DIR, "house" + ("" if FULL else "_" + STATE) + ".glb")
        shutil.copyfile(path, alias)
        print("HG_EXPORT_ALIAS", alias)


main()
