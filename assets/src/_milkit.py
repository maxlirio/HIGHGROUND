"""Shared construction kit for barracks.py / watchtower.py.

Helpers copied verbatim from town_hall.py (the approved proof asset) so that file stays untouched.
STATE is read from argv/env exactly as town_hall.py does."""
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

L.reset(seed=7)
R = random.Random(11)


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


def build_materials():
    ch = 0.9 if RUIN else 0.0
    MAT["rubble"] = m_stone("rubble", [(0.0, "#9a8f7a"), (0.25, "#b3a68b"), (0.5, "#c0b398"),
                                        (0.75, "#a99d86"), (1.0, "#8d8474")], "#6f675b",
                            rowh=0.36, bw=0.72, charred=ch * 0.8)
    MAT["ashlar"] = m_stone("ashlar", [(0.0, "#a89c83"), (0.4, "#b9ac91"), (0.7, "#b0a48b"),
                                        (1.0, "#9d917b")], "#9a9280", joints=False, bump=0.6,
                            charred=ch * 0.6)
    MAT["chimney"] = m_stone("chimney", [(0.0, "#9a8f7a"), (0.5, "#b3a68b"), (1.0, "#a39884")],
                             "#6f675b", rowh=0.3, bw=0.55, soot_top=12.9)
    MAT["oak"] = m_wood("oak", [(0.0, "#4e3b27"), (0.5, "#5f4830"), (1.0, "#6b5236")],
                        weather_hex="#7d7466", weathered=0.55, fresh=0.06, charred=ch)
    MAT["plank"] = m_wood("plank", [(0.0, "#7b6f5e"), (0.5, "#8c8374"), (1.0, "#978a73")],
                          weather_hex="#8f887c", weathered=0.4, fresh=0.1, charred=ch, grain_k=1.2)
    MAT["daub"] = m_daub("daub", charred=ch * 0.7)
    MAT["tile"] = m_tiles("tile", [(0.0, "#6e3f2b"), (0.2, "#8c5037"), (0.5, "#9a5a3c"),
                                    (0.8, "#a8694a"), (1.0, "#7f4a36")], cell=0.24, charred=ch)
    MAT["slate"] = m_tiles("slate", [(0.0, "#43474d"), (0.4, "#4b4f55"), (0.8, "#565a5e"),
                                      (1.0, "#3f4245")], cell=0.21, curve=0.1, lichen=0.8, moss=0.5)
    MAT["shingle"] = m_tiles("shingle", [(0.0, "#6c604f"), (0.5, "#80766a"), (1.0, "#8f8474")],
                             cell=0.17, curve=0.15, wood=True, lichen=0.5, charred=ch)
    MAT["iron"] = m_simple("iron", "#35332f", "#45403a", 0.72, rust=True)
    MAT["dark"] = m_simple("dark", "#2c2621", "#3a3129", 0.9)
    MAT["banner"] = m_banner("banner", 2.8, 1.7)
    MAT["soil"] = m_simple("soil", "#4a3a2a", "#5f4a35", 0.95, 1.2)
    MAT["ash"] = m_stone("ashrubble", [(0.0, "#6e675d"), (0.5, "#8d8577"), (1.0, "#5e5850")],
                         "#4a4540", joints=False, charred=0.4)


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
        f.prism_dv(bt, prof, -proud * 0.95 + 0.004, Lh + proud * 0.95 - 0.004)


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


# =====================================================================  roofs
def roof_rows(bt, M, x0, x1, eave, ridge, row_w=0.34, lap=0.72, thick=0.035, lift=0.03, sag=0.07,
              seg=8, wob=0.012, stop=None, grade=1.0):
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
    # graded courses (grade < 1: courses diminish toward the ridge, as stone slates are laid)
    ws, ss = [], []
    sp = 0.0
    while True:
        t = min(1.0, sp / max(Ls - row_w, 1e-3))
        w = row_w * (1.0 + (grade - 1.0) * t)
        ws.append(w); ss.append(sp)
        if sp + w >= Ls - 1e-3:
            break
        sp += w * lap
    rows = max(2, len(ss))
    k = (Ls - ws[-1]) / ss[-1] if ss[-1] > 0 else 1.0
    ss = [x * k for x in ss]
    base = Vector((0, ey, ez))
    for r in range(len(ss)):
        if stop is not None and not stop(r / (rows - 1)):
            continue
        s0 = ss[r]
        rr = R.random()
        pts, loc = [], []
        rl = ws[r] * R.uniform(0.97, 1.03)
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


NO_CULL = ("keepwall", "tower", "fbwall")


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



# =====================================================================  extra materials (military kit)
def m_yard(name, charred=0.0):
    """trampled drill-yard earth: sandy grit, boot/hoof scuffs, puddle stains, trodden-in straw."""
    g = G(name)
    P = g.P
    x, y, z = g.sep(P)
    col = g.ramp(g.noise(P, 0.25, 3), [(0.25, "#85735a"), (0.5, "#978567"), (0.8, "#a59473")])
    mid = g.noise(P, 2.2, 4, 0.6)
    col = g.mix(0.45, col, mid, "OVERLAY")
    fine = g.noise(P, 38.0, 6, 0.65)
    col = g.mix(0.5, col, fine, "OVERLAY")
    # grit / pebbles
    peb = g.inv(g.mr(g.vor(P, 30.0), 0.0, 0.22))
    peb = g.mul(peb, g.mr(g.white(g.math("FLOOR", g.mul(x, 30.0))), 0.4, 1.0))
    col = g.mix(g.mul(peb, 0.6), col, g.ramp(g.white(P), [(0.0, "#8f8a7c"), (1.0, "#a39880")]))
    # scuffs: stretched noise in random directions (boot drag marks)
    sc = g.noise(g.comb(g.mul(g.add(x, y), 5.0), g.mul(g.sub(x, y), 0.8), 0.0), 1.0, 3)
    col = g.mix(g.mul(g.mr(sc, 0.55, 0.72), 0.45), col, "#5c4b37")
    # damp patches (darker, smoother)
    wet = g.mr(g.noise(P, 0.45, 4), 0.6, 0.7)
    col = g.mix(g.mul(wet, 0.7), col, g.mix(1.0, col, (0.55, 0.52, 0.5, 1), "MULTIPLY"))
    # trodden straw flecks
    st = g.mul(g.gt(g.noise(g.comb(g.mul(x, 9.0), g.mul(y, 60.0), 0.0), 1.0, 2), 0.7),
               g.mr(g.noise(P, 1.0, 2), 0.5, 0.65))
    col = g.mix(g.mul(st, 0.6), col, "#a88d55")
    # grass creeping in at the edges handled by moss in ground_grime (off here)
    if charred > 0:
        col = g.mix(g.mul(g.mr(g.noise(P, 0.4, 3), 0.4, 0.62), charred), col, "#3a342d")
    rough = g.sub(0.95, g.mul(wet, 0.3))
    height = g.add(g.add(g.mul(mid, 0.6), g.mul(fine, 0.4)), g.mul(peb, 0.5))
    return g.out(col, rough, height, 1.0, 0.03)


def m_straw(name, charred=0.0):
    """bound straw (butts, bales, thatch-like): long fibres along local z (hg_loc)."""
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    fib = g.noise(g.comb(g.mul(lx, 90.0), g.mul(ly, 90.0), g.mul(lz, 3.0)), 1.0, 6, 0.65, 0.4)
    col = g.ramp(g.add(g.mul(g.noise(P, 1.2, 3), 0.7), g.mul(rnd, 0.3)),
                 [(0.2, "#8a7446"), (0.5, "#a88d55"), (0.8, "#b89d62")])
    col = g.mix(0.8, col, fib, "OVERLAY")
    dark = g.gt(fib, 0.64)
    col = g.mix(g.mul(dark, 0.5), col, "#5f5134")
    aged = g.mr(g.noise(P, 0.8, 4), 0.45, 0.7)
    col = g.mix(g.mul(aged, 0.55), col, "#7c6a45")
    x, y, z = g.sep(P)
    col, md, mb = g.ground_grime(col, z, 1.0, 0.4, 0.25)
    if charred > 0:
        col = g.mix(charred, col, "#2c2723")
    return g.out(col, 0.92, g.add(fib, g.mul(dark, 0.4)), 1.0, 0.012)


def m_pennon(name, hexa="#2f5fa8", hexb="#d6c79d"):
    """team pennon: hg_loc u along the fly, v up; a pale cross band near the hoist."""
    g = G(name)
    loc = g.attr("hg_loc")[0]
    u, _, v = g.sep(loc)
    band = g.mul(g.mr(u, 0.34, 0.36, 0.0, 1.0, False), g.inv(g.mr(u, 0.52, 0.54, 0.0, 1.0, False)))
    weave = g.noise(g.comb(g.mul(u, 1.0), g.mul(v, 1.0), 0.0), 70.0, 3)
    col = g.mix(band, hexa, hexb)
    col = g.mix(0.35, col, weave, "OVERLAY")
    folds = g.noise(g.comb(g.mul(u, 2.5), g.mul(v, 0.3), 0.0), 1.0, 3)
    col = g.mix(0.45, col, folds, "OVERLAY")
    fade = g.mr(u, 1.0, 3.5)
    col = g.mix(g.mul(fade, 0.25), col, "#6d6a60")
    return g.out(col, 0.9, g.add(g.mul(weave, 0.3), folds), 1.0, 0.01)


def pennon(pole_top, length=3.0, h0=0.8, tail=0.55, NU=14, NV=4, mat="pennon", yaw=0.0, wave=0.22):
    """swallow-tailed pennon hanging from a pole top, flying along +x (rotated by yaw)."""
    px, py, pz = pole_top
    ca, sa = math.cos(yaw), math.sin(yaw)
    pts, loc = [], []
    for side in (0, 1):
        for j in range(NV + 1):
            for i in range(NU + 1):
                t = i / NU
                u = length * t
                hh = h0 * (1 - 0.55 * t)                 # taper
                vv = (j / NV - 0.5)
                v = vv * hh
                # swallow tail: pull the centre back at the fly end
                cut = tail * max(0.0, 1 - abs(vv) * 2) * max(0.0, (t - 0.6) / 0.4)
                uu = u - cut
                wy = wave * math.sin(2 * math.pi * u / 1.6 + 0.5) * t ** 0.8 + 0.04 * math.sin(v * 4 + u * 2) * t
                droop = -0.35 * t * t
                lx, ly = 0.06 + uu, wy + (0.01 if side else -0.01)
                pts.append((px + lx * ca - ly * sa, py + lx * sa + ly * ca, pz - h0 / 2 + v + droop))
                loc.append((uu, 0.0, v + h0 / 2))
    F = []
    W = NU + 1
    off = (NV + 1) * W
    for j in range(NV):
        for i in range(NU):
            a = j * W + i
            F.append((a, a + 1, a + W + 1, a + W))
            F.append((off + a, off + a + W, off + a + W + 1, off + a + 1))
    for i in range(NU):
        F.append((i, off + i, off + i + 1, i + 1))
        a = NV * W + i
        F.append((a, a + 1, off + a + 1, off + a))
    for j in range(NV):
        for i in (0, NU):
            a = j * W + i
            F.append((a, a + W, off + a + W, off + a))
    B(mat).add(pts, F, None, 0.5, loc)


def ladder(p0, p1, w=0.46, rung=0.3, mat="oak", r=0.035):
    """ladder from foot p0 to top p1 (world)."""
    p0, p1 = Vector(p0), Vector(p1)
    a = (p1 - p0)
    Lh = a.length
    an = a.normalized()
    side = an.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    for s in (-w / 2, w / 2):
        beam(B(mat), p0 + side * s, p1 + side * s + an * 0.25, 0.065, 0.075, 0.008, side=an.cross(side))
    n = int(Lh / rung)
    for k in range(1, n + 1):
        q = p0 + an * (k * Lh / (n + 0.6))
        cyl(B(mat), q - side * (w / 2 + 0.03), q + side * (w / 2 + 0.03), r * R.uniform(0.9, 1.1), n=6)


def finalize(name, tex=2048, lods=(1.0, 0.4, 0.12)):
    tex = int(os.environ.get("HG_TEX", tex))
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
            n = sum(len(p.vertices) - 2 for p in o.data.polygons)
            tris += n
            a = sum(p.area for p in o.data.polygons)
            t, aa = stats.get(k, (0, 0))
            stats[k] = (t + n, aa + a)
    print("HG_TRIS_PRE", tris)
    for k, (t, a) in sorted(stats.items(), key=lambda x: -x[1][0]):
        print("HG_STAT %-10s tris %6d area %7.1f" % (k, t, a))
    for o in [o for o in bpy.context.scene.objects if o.hide_render]:
        bpy.data.objects.remove(o, do_unlink=True)
    if os.environ.get("HG_DRY"):
        return
    if os.environ.get("HG_PREVIEW"):
        # geometry-only preview (no bake): untextured GLB into the scratch path given
        L.ground_origin([o for o in bpy.context.scene.objects if o.parent is None])
        for o in bpy.context.scene.objects:
            o.select_set(o.type == "MESH")
            if o.type == "MESH":
                o.data.materials.clear()
        bpy.ops.export_scene.gltf(filepath=os.environ["HG_PREVIEW"], use_selection=True)
        print("HG_PREVIEW", os.environ["HG_PREVIEW"])
        return
    L.finish(name, tex=tex, lods=lods)
