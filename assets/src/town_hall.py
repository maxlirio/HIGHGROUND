"""HIGHGROUND - town hall / keep (the town centre).

A 13th-14th c. stone hall-keep: rectangular keep with clasping corner towers, corbelled
parapet + merlons, slate roof inside the parapet, a forebuilding reached by an external
stair, a timber hoarding on the front, and an attached jettied timber-framed hall range
with a clay-tile roof, two chimney stacks and a lean-to store. No flag: the engine plants
the team banner (pole + cloth in team colours) beside every building itself.

    blender -b -P assets/src/town_hall.py -- [complete|build1|build2|ruin]
    (or HG_STATE=ruin blender -b -P assets/src/town_hall.py)

Front faces -Y. 1 unit = 1 m.
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
    bmesh.ops.delete(bm, geom=[g for g in r["geom_interior"] + r["geom_unused"] if isinstance(g, bmesh.types.BMVert)],
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


# =====================================================================  roofs
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


# =====================================================================  LAYOUT CONSTANTS
X0, X1, Y0, Y1 = -12.0, 0.0, -4.0, 6.0
T, PR = 2.6, 0.3            # corner tower size, protrusion
WALK = 14.0
TOWER_TOP = 17.0
HX0, HX1 = 0.3, 14.0         # hall range
HYF, HYB = -3.5, 3.5
JET = 0.45
FB = (-9.7, -5.4, -6.8, -4.0)  # forebuilding x0,x1,y0,y1
FB_TOP = 7.6
LAND = 4.2
PITCH = math.radians(52)
PLATE = 6.6
HALF = (HYB - (HYF - JET)) / 2          # 3.725
RIDGE_Y = (HYB + (HYF - JET)) / 2       # -0.225
RIDGE_Z = PLATE + HALF * math.tan(PITCH)


def keep_outline():
    a, b, c, d = X0 - PR, X0 - PR + T, X1 + PR - T, X1 + PR
    e, f_, g, h = Y0 - PR, Y0 - PR + T, Y1 + PR - T, Y1 + PR
    return [(a, e), (b, e), (b, Y0), (c, Y0), (c, e), (d, e), (d, f_), (X1, f_), (X1, g), (d, g), (d, h),
            (c, h), (c, Y1), (b, Y1), (b, h), (a, h), (a, g), (X0, g), (X0, f_), (a, f_)]


TOWERS = [((X0 - PR, Y0 - PR), "SW"), ((X1 + PR - T, Y0 - PR), "SE"),
          ((X1 + PR - T, Y1 + PR - T), "NE"), ((X0 - PR, Y1 + PR - T), "NW")]


# =====================================================================  KEEP
def build_keep(top_cap=None, ruin=False):
    """top_cap: limit wall height (build2). ruin: broken crowns."""
    cap = top_cap or 99
    walk = min(WALK, cap)
    wall = Batch("keepwall", "rubble")
    box(wall, (X0, Y0, 0), (X1, Y1, walk))
    tw = {}
    for (tx, ty), nm in TOWERS:
        top = min(TOWER_TOP, cap)
        if ruin and nm == "NE":
            top = 11.2
        if ruin and nm == "SW":
            top = 15.2
        bt = Batch("tower" + nm, "rubble")
        box(bt, (tx, ty, 0), (tx + T, ty + T, top))
        tw[nm] = (bt, top)
    SOLIDS.append(((X0 + 0.05, Y0 + 0.05, 0), (X1 - 0.05, Y1 - 0.05, walk)))
    for (tx, ty), nm in TOWERS:
        SOLIDS.append(((tx + 0.05, ty + 0.05, 0), (tx + T - 0.05, ty + T - 0.05, tw[nm][1])))
    if FULL or RUIN or B2:
        SOLIDS.append(((FB[0], FB[2], 0), (FB[1], FB[3] + 0.3, min(FB_TOP, cap))))

    cut = Batch("keepcut", "dark")
    fr = Face((X0, Y0, 0), (0, -1, 0))      # front, u = x - X0
    fe = Face((X1, Y0, 0), (1, 0, 0))       # east,  u = y - Y0
    fw = Face((X0, Y1, 0), (-1, 0, 0))      # west,  u = Y1 - y
    fb = Face((X1, Y1, 0), (0, 1, 0))       # back,  u = X1 - x
    ok = lambda v: v + 1.0 < cap
    # front (exposed x in [-9.7,-2.3] above forebuilding)
    if ok(11.6): window(fr, cut, -6.0 - X0, 9.7, 0.56, 1.75, "round", twin=True)
    if ok(6.9): window(fr, cut, -3.85 - X0, 5.7, 0.5, 1.2, "round")
    if ok(12.3): putlogs(fr, cut, [x - X0 for x in (-8.9, -7.4, -4.4, -3.1)], 12.3)
    if ok(7.3): putlogs(fr, cut, [x - X0 for x in (-4.6, -3.0)], 7.9)
    # east
    if ok(11.2): window(fe, cut, 2.4 - Y0, 9.6, 0.62, 1.55, "round")
    if ok(13.4): slit(fe, cut, 0.9 - Y0, 12.1)
    if ok(12.8): putlogs(fe, cut, [u - Y0 for u in (-1.2, 1.6, 3.2)], 12.9)
    # west
    if ok(11.6): window(fw, cut, Y1 - 1.0, 9.7, 0.56, 1.75, "round", twin=True)
    if ok(6.9): window(fw, cut, Y1 - 1.0, 5.7, 0.5, 1.2, "round")
    slit(fw, cut, Y1 - 1.0, 2.0)
    # back
    if ok(11.6): window(fb, cut, X1 + 6.0, 9.7, 0.56, 1.75, "round", twin=True)
    if ok(6.9): window(fb, cut, X1 + 3.8, 5.7, 0.5, 1.2, "round")
    slit(fb, cut, X1 + 8.0, 2.0)
    if len(cut.F):
        apply_boolean(wall.build(), cutter_obj(cut))
    else:
        wall.build()

    # towers: slits
    for (tx, ty), nm in TOWERS:
        bt, top = tw[nm]
        tcut = Batch("tcut" + nm, "dark")
        faces = []
        if nm == "SW":
            faces = [(Face((tx, ty, 0), (0, -1, 0)), [2.6, 7.2, 11.6, 15.3]),
                     (Face((tx, ty + T, 0), (-1, 0, 0)), [3.0, 7.6, 11.9, 15.3])]
        if nm == "SE":
            faces = [(Face((tx, ty, 0), (0, -1, 0)), [7.4, 11.7, 15.3]),
                     (Face((tx + T, ty, 0), (1, 0, 0)), [11.8, 15.3])]
        if nm == "NE":
            faces = [(Face((tx + T, ty, 0), (1, 0, 0)), [2.6, 7.0, 11.5, 15.3]),
                     (Face((tx + T, ty + T, 0), (0, 1, 0)), [3.0, 7.6, 11.9])]
        if nm == "NW":
            faces = [(Face((tx, ty + T, 0), (-1, 0, 0)), [2.6, 7.2, 11.6]),
                     (Face((tx + T, ty + T, 0), (0, 1, 0)), [3.0, 11.4])]
        for f, vs in faces:
            for v in vs:
                if v + 1.6 < top:
                    slit(f, tcut, T / 2 + jit(0.15), v)
        if len(tcut.F):
            apply_boolean(bt.build(), cutter_obj(tcut))
        else:
            bt.build()

    ol = keep_outline()
    plinth(ol, h=1.15 if not B1 else 0.8)
    string_course(ol, 4.8, skipfn=lambda p: p.x > -0.2 and -3.9 < p.y < 3.9 and False)
    if cap > 9.4:
        string_course(ol, 9.05)
    # quoins on convex corners (only faces seen from the south/east)
    for (tx, ty), nm in TOWERS:
        top = tw[nm][1]
        cs = []
        if nm == "SW":
            cs = [((tx, ty), (-1, 0, 0), (0, -1, 0)), ((tx + T, ty), (0, -1, 0), (1, 0, 0))]
        if nm == "SE":
            cs = [((tx, ty), (0, -1, 0), (-1, 0, 0)), ((tx + T, ty), (0, -1, 0), (1, 0, 0)),
                  ((tx + T, ty + T), (1, 0, 0), (0, 1, 0))]
        if nm == "NE":
            cs = [((tx + T, ty), (1, 0, 0), (0, -1, 0)), ((tx + T, ty + T), (1, 0, 0), (0, 1, 0))]
        if nm == "NW":
            cs = [((tx, ty), (-1, 0, 0), (0, -1, 0))]
        for c, a, b in cs:
            zt = top - (R.uniform(0.4, 2.8) if ruin else 0.0)
            quoins(c, a, b, 1.15, zt)
        if ruin or top < TOWER_TOP - 0.1:
            crown(tx, ty, tx + T, ty + T, top)
            continue
        # tower top: parapet ring + merlons
        pb = B("rubble")
        th = 0.36
        box(pb, (tx, ty, top), (tx + T, ty + th, top + 0.62))
        box(pb, (tx, ty + T - th, top), (tx + T, ty + T, top + 0.62))
        box(pb, (tx, ty + th, top), (tx + th, ty + T - th, top + 0.62))
        box(pb, (tx + T - th, ty + th, top), (tx + T, ty + T - th, top + 0.62))
        for f in (Face((tx, ty, 0), (0, -1, 0)), Face((tx + T, ty, 0), (1, 0, 0)),
                  Face((tx + T, ty + T, 0), (0, 1, 0)), Face((tx, ty + T, 0), (-1, 0, 0))):
            merlons(f, 0.0, T, top + 0.62, 0.0, th, mw=0.72, gap=0.52, mh=0.92)
        # coping band + corbels under the tower parapet
        for i, f in enumerate((Face((tx, ty, 0), (0, -1, 0)), Face((tx + T, ty, 0), (1, 0, 0)),
                               Face((tx + T, ty + T, 0), (0, 1, 0)), Face((tx, ty + T, 0), (-1, 0, 0)))):
            e = 0.1 if i % 2 == 0 else -0.2
            f.prism_dv(B("ashlar"), [(-0.1, top - 0.02), (0.2, top - 0.02), (0.2, top + 0.2), (-0.1, top + 0.2)],
                       -e, T + e)

    # main parapets between the towers, on a corbel table
    if walk >= WALK - 0.01 and not ruin:
        segs = [(Face((X0, Y0, 0), (0, -1, 0)), T - PR, (X1 - X0) - (T - PR)),
                (Face((X1, Y0, 0), (1, 0, 0)), T - PR, (Y1 - Y0) - (T - PR)),
                (Face((X1, Y1, 0), (0, 1, 0)), T - PR, (X1 - X0) - (T - PR)),
                (Face((X0, Y1, 0), (-1, 0, 0)), T - PR, (Y1 - Y0) - (T - PR))]
        for f, u0, u1 in segs:
            f.box(B("rubble"), u0, u1, -0.16, 0.44, WALK, WALK + 0.88)
            f.prism_dv(B("ashlar"), [(-0.2, WALK - 0.04), (0.1, WALK - 0.04), (0.1, WALK + 0.16), (-0.2, WALK + 0.16)],
                       u0, u1)
            corbels(f, u0 + 0.1, u1 - 0.1, WALK - 0.04)
            merlons(f, u0 + 0.35, u1 - 0.35, WALK + 0.88, -0.16, 0.44)
        keep_roof()
    elif ruin:
        crown(X0, Y0, X1, Y1, walk, main=True)


def crown(x0, y0, x1, y1, top, main=False):
    """broken wall-head: irregular stepped rubble courses + fallen gaps."""
    bt = B("rubble")
    th = 2.0 if main else T
    for (ax, ay, bx, by) in ((x0, y0, x1, y0 + 1.6), (x0, y1 - 1.6, x1, y1), (x0, y0, x0 + 1.6, y1), (x1 - 1.6, y0, x1, y1)):
        lx, ly = bx - ax, by - ay
        along_x = lx > ly
        n = int((lx if along_x else ly) / 0.7)
        for i in range(n):
            if R.random() < 0.25:
                continue
            hh = R.uniform(0.2, 1.4) * (1.0 if R.random() < 0.7 else 0.3)
            if along_x:
                a = ax + i * lx / n
                box(bt, (a + jit(0.05), ay + R.uniform(0, 0.4), top - 0.1), (a + lx / n * R.uniform(0.7, 1.0), by - R.uniform(0, 0.4), top + hh),
                    0.04, rot=(jit(0.05), jit(0.05), jit(0.1)))
            else:
                a = ay + i * ly / n
                box(bt, (ax + R.uniform(0, 0.4), a + jit(0.05), top - 0.1), (bx - R.uniform(0, 0.4), a + ly / n * R.uniform(0.7, 1.0), top + hh),
                    0.04, rot=(jit(0.05), jit(0.05), jit(0.1)))


def keep_roof():
    x0, x1 = -9.0, -3.0
    ey0, ey1 = -2.4, 4.4
    rz = WALK + 0.45
    ry = (ey0 + ey1) / 2
    rtop = rz + (ry - ey0) * math.tan(math.radians(43))
    box(B("rubble"), (x0 - 0.3, ey0 + 0.05, WALK), (x1 + 0.3, ey1 - 0.05, rz))
    I = Matrix.Identity(4)
    roof_rows(B("slate"), I, x0 + 0.05, x1 - 0.05, (ey0 - 0.12, rz - 0.05), (ry, rtop), row_w=0.3, thick=0.03,
              lift=0.022, sag=0.04, seg=6)
    M2 = Matrix.Rotation(math.pi, 4, "Z")
    roof_rows(B("slate"), Matrix.Translation((0, 2 * ry, 0)) @ Matrix.Scale(-1, 4, (0, 1, 0)), x0 + 0.05, x1 - 0.05,
              (ey0 - 0.12, rz - 0.05), (ry, rtop), row_w=0.3, thick=0.03, lift=0.022, sag=0.04, seg=6)
    ridge_tiles(B("ashlar"), I, x0, x1, ry, rtop + 0.02, r=0.1, piece=0.5)
    # parapet gables
    for gx in (x0 - 0.02, x1 + 0.02):
        s = -1 if gx < -6 else 1
        pts = []
        for xx in (gx - 0.18 * s, gx + 0.18 * s):
            pts += [(xx, ey0 - 0.15, WALK), (xx, ey1 + 0.15, WALK), (xx, ey0 - 0.15, rz), (xx, ey1 + 0.15, rz),
                    (xx, ry, rtop + 0.28)]
        prism_hull(B("rubble"), pts)
        for (ya, za) in ((ey0 - 0.2, rz - 0.02), (ey1 + 0.2, rz - 0.02)):
            beam(B("ashlar"), (gx, ya, za + 0.1), (gx, ry, rtop + 0.38), 0.44, 0.14, 0.015, side=(0, 0, 1))


# =====================================================================  FOREBUILDING + STAIR
def build_forebuilding(cap=None):
    x0, x1, y0, y1 = FB
    top = min(FB_TOP, cap or 99)
    wall = Batch("fbwall", "rubble")
    box(wall, (x0, y0, 0), (x1, y1 + 0.3, top))
    cut = Batch("fbcut", "dark")
    ff = Face((x0, y0, 0), (0, -1, 0))
    fe = Face((x1, y0, 0), (1, 0, 0))
    fw = Face((x0, y1, 0), (-1, 0, 0))
    slit(ff, cut, (x1 - x0) / 2, 1.8)
    if top > 6.4:
        window(ff, cut, (x1 - x0) / 2, 5.0, 0.5, 1.15, "round")
    slit(fw, cut, 1.4, 2.2)
    # the great door at the head of the stair
    if top > 6.9:
        window(fe, cut, 1.6, LAND, 1.15, 2.35, "round", depth=0.55, backdark=False)
        door_leaf(fe, 1.6, LAND, 1.15, 2.35, 0.5, arch=True)
    apply_boolean(wall.build(), cutter_obj(cut))
    ol = [(x0, y1 - 0.3), (x0, y0), (x1, y0), (x1, y1)]
    plinth(ol, closed=False)
    string_course(ol, 4.8 if top > 5 else 99, closed=False,
                  skipfn=lambda p: p.x > x1 - 0.3 and p.y > y0 + 0.4)
    quoins((x0, y0), (-1, 0, 0), (0, -1, 0), 1.15, top)
    quoins((x1, y0), (0, -1, 0), (1, 0, 0), 1.15, top)
    if top < FB_TOP - 0.01 or RUIN:
        if RUIN:
            crown(x0, y0, x1, y1, top)
        return
    pb = B("rubble")
    th = 0.45
    box(pb, (x0, y0, top), (x1, y0 + th, top + 0.7))
    box(pb, (x0, y0 + th, top), (x0 + th, y1, top + 0.7))
    box(pb, (x1 - th, y0 + th, top), (x1, y1, top + 0.7))
    merlons(ff, 0.2, x1 - x0 - 0.2, top + 0.7, 0.0, th, mw=0.9, gap=0.6, mh=0.95)
    merlons(fe, 0.2, y1 - y0 - 0.2, top + 0.7, 0.0, th, mw=0.9, gap=0.6, mh=0.95)
    merlons(fw, 0.2, y1 - y0 - 0.2, top + 0.7, 0.0, th, mw=0.9, gap=0.6, mh=0.95)
    for f, l, e0 in ((ff, x1 - x0, -0.1), (fe, y1 - y0, 0.2), (fw, y1 - y0, 0.2)):
        f.prism_dv(B("ashlar"), [(-0.1, top - 0.02), (0.2, top - 0.02), (0.2, top + 0.18), (-0.1, top + 0.18)],
                   e0, l + 0.1)


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


def build_stair(n_built=None):
    x0 = FB[1]              # landing starts at forebuilding east face
    xl = x0 + 1.6           # landing end
    ya, yb = -5.95, -4.0
    steps = 17
    rise = LAND / steps
    run = 0.3
    bt = B("ashlar")
    if n_built is None or n_built >= steps:
        box(B("rubble"), (x0, ya, 0), (xl, yb, LAND - 0.18))
        box(bt, (x0 - 0.02, ya - 0.02, LAND - 0.18), (xl + 0.02, yb, LAND), 0.02)
    for i in range(1, steps):
        if n_built is not None and i < steps - n_built:
            continue
        top = LAND - i * rise
        xa = xl + (i - 1) * run
        box(bt, (xa + jit(0.005), ya + jit(0.01), 0), (xa + run + 0.02, yb, top + jit(0.008)), 0.018,
            rot=(0, 0, jit(0.006)))
    xe = xl + (steps - 1) * run
    if n_built is None or n_built >= steps:
        # outer parapet following the flight
        prof = [(x0, 0), (xe + 0.3, 0), (xe + 0.3, 0.55), (xl, LAND + 0.7), (x0, LAND + 0.7)]
        pts = [(px, yy, pz) for (px, pz) in prof for yy in (ya - 0.36, ya)]
        prism_hull(B("rubble"), pts)
        beam(bt, (xl, ya - 0.18, LAND + 0.76), (xe + 0.3, ya - 0.18, 0.62), 0.46, 0.14, 0.015, side=(0, 0, 1))
        beam(bt, (x0 - 0.05, ya - 0.18, LAND + 0.76), (xl + 0.05, ya - 0.18, LAND + 0.76), 0.46, 0.14, 0.015,
             side=(0, 0, 1))
        plinth([(x0, ya - 0.36), (xe + 0.3, ya - 0.36)], closed=False, h=0.5, proud=0.18)


# =====================================================================  HALL RANGE
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


def build_hall(stage="complete"):
    """stage: complete | frame (build2) | burnt (ruin)"""
    char = stage == "burnt"
    frame_only = stage == "frame"
    PL = 0.5
    SILL = 0.72
    GIRT = 3.3
    UP0 = 3.9
    WP = 6.4
    # stone plinth + sills
    box(B("rubble"), (HX0 - 0.3, HYF - 0.1, 0), (HX1 + 0.1, HYB + 0.1, PL), 0.03)
    oak = B("oak")
    keep = 0.55 if char else 1.0
    for (p0, p1) in (((HX0, HYF + 0.1, PL + 0.11), (HX1 - 0.1, HYF + 0.1, PL + 0.11)),
                     ((0.0, HYB - 0.1, PL + 0.11), (HX1 - 0.1, HYB - 0.1, PL + 0.11)),
                     ((HX1 - 0.1, HYF, PL + 0.11), (HX1 - 0.1, HYB, PL + 0.11))):
        beam(oak, p0, p1, 0.22, 0.2, 0.015, ext=0.1)
    ffr = Face((HX0, HYF, 0), (0, -1, 0))                 # ground front, u = x - HX0
    ffu = Face((HX0, HYF - JET, 0), (0, -1, 0))           # upper front (jettied)
    fbk = Face((HX1, HYB, 0), (0, 1, 0))                  # back, u = HX1 - x
    fea = Face((HX1, HYF - JET, 0), (1, 0, 0))            # east gable, u = y - (HYF-JET)
    Lf = HX1 - HX0
    # ---------------- front ground: close studding
    ops_g = [(3.3, 4.4, SILL, 2.8, "door"), (6.3, 7.7, 1.55, 2.8, "win"), (9.9, 11.3, 1.55, 2.8, "win")]
    if frame_only:
        ops_g = [(3.3, 4.4, SILL, 2.8, "none")]
    posts = []
    for u in grid(0.1, Lf - 0.1, 0.6, 0.03):
        if any(a - 0.2 < u < b + 0.2 for (a, b, *_ ) in ops_g):
            continue
        posts.append(u)
    for (a, b, *_ ) in ops_g:
        posts += [a - 0.1, b + 0.1]
        posts += [u for u in grid(a + 0.1, b - 0.1, 0.6, 0.0)[1:-1]]
    frame_face(ffr, Lf, SILL, GIRT, sorted(posts), [1.55, 2.8, GIRT + 0.1], ops_g,
               slab=not frame_only, char=char, keep_frac=keep)
    # jetty: joists + bressumer
    for u in grid(0.1, Lf - 0.1, 0.45, 0.02):
        if R.random() < keep:
            beam(oak, (HX0 + u, HYF + 0.4, GIRT + 0.28), (HX0 + u, HYF - JET - 0.06, GIRT + 0.28 + jit(0.01)),
                 0.13, 0.16, 0.012, side=(0, 0, 1))
    beam(oak, (HX0 - 0.05, HYF - JET + 0.1, UP0 - 0.14), (HX1 + 0.05, HYF - JET + 0.1, UP0 - 0.14), 0.24, 0.22, 0.02,
         side=(0, 1, 0))
    if stage == "frame":
        # upper storey only as bare posts
        for u in grid(0.1, Lf - 0.1, 1.7, 0.02):
            ffu.timber(oak, u, UP0, u, WP, 0.22, 0.18)
        ffu.timber(oak, 0.0, WP + 0.1, Lf, WP + 0.1, 0.2, 0.2)
    else:
        # ---------------- front upper: square panels, X braces, mullioned windows
        ops_u = [(1.4, 3.0, 4.6, 5.75, "win"), (5.0, 6.6, 4.6, 5.75, "win"), (9.0, 10.6, 4.6, 5.75, "win")]
        posts_u = [0.1, 1.3, 3.1, 4.9, 6.7, 7.85, 9.0 - 0.1, 10.7, 12.1, Lf - 0.1]
        braces = []
        for (a, b) in ((7.85, 8.9), (10.7, 12.1), (12.1, Lf - 0.1), (3.1, 4.9)):
            braces += [(a + 0.05, 4.62, b - 0.05, 5.72), (a + 0.05, 5.72, b - 0.05, 4.62)]
        frame_face(ffu, Lf, UP0, WP, posts_u, [4.6, 5.75, WP + 0.1], ops_u, braces, char=char, keep_frac=keep)
        # ---------------- back wall (mostly hidden: simpler)
        ops_b = [(3.0, 4.2, 4.6, 5.6, "win"), (9.5, 10.7, 1.6, 2.6, "win")]
        frame_face(fbk, HX1, SILL, WP, grid(0.1, HX1 - 0.1, 1.6), [1.6, GIRT, 4.6, WP + 0.1], ops_b, char=char,
                   keep_frac=keep)
        # ---------------- east gable end
        Le = HYB - (HYF - JET)
        ops_e = [(2.6, 3.8, 4.6, 5.7, "win")]
        bre = [(0.2, SILL + 0.1, 1.3, GIRT - 0.1), (Le - 0.2, SILL + 0.1, Le - 1.3, GIRT - 0.1),
               (5.2, 4.62, 6.4, 5.7), (5.2, 5.7, 6.4, 4.62), (0.75, 4.62, 2.3, 5.7), (0.75, 5.7, 2.3, 4.62)]
        frame_face(fea, Le, SILL, WP, [0.12, JET + 0.1, 2.2, 3.9, 5.2, 6.45, Le - 0.12], [1.9, GIRT, 4.6, WP + 0.1],
                   ops_e, bre, char=char, keep_frac=keep)
        if not char:
            gable_face(fea, 0.0, Le, WP + 0.2, RIDGE_Z - 0.35, Le / 2)
    if stage == "frame":
        for f, L_, stepv in ((fbk, HX1, 1.7), (fea, HYB - (HYF - JET), 1.6)):
            for u in grid(0.1, L_ - 0.1, stepv):
                f.timber(oak, u, SILL, u, WP, 0.22, 0.18)
            f.timber(oak, 0.0, GIRT, L_, GIRT, 0.2, 0.2)
            f.timber(oak, 0.0, WP + 0.1, L_, WP + 0.1, 0.2, 0.2)
        return
    # interior darkness behind all openings is handled per opening.
    # ---------------- roof
    eave_front = (HYF - JET - 0.5, PLATE - 0.5 * math.tan(PITCH) + 0.05)
    ridge = (RIDGE_Y, RIDGE_Z + 0.05)
    I = Matrix.Identity(4)
    mir = Matrix.Translation((0, 2 * RIDGE_Y, 0)) @ Matrix.Scale(-1, 4, (0, 1, 0))
    if char:
        stopA = lambda t: t < 0.3
        # collapsed: only fragments of the tiled roof survive; charred rafters stand up
        roof_rows(B("tile"), I, HX0 + 0.3, 5.5, eave_front, ridge, row_w=0.34, sag=0.18, seg=5)
        roof_rows(B("tile"), mir, 0.0, 4.3, eave_front, ridge, row_w=0.34, sag=0.18, seg=5)
        roof_rows(B("tile"), I, 9.0, HX1 + 0.35, eave_front, ridge, row_w=0.34, sag=0.2, seg=5, stop=stopA)
        for x in grid(5.8, 13.6, 0.55, 0.05):
            if R.random() < 0.6:
                t = R.uniform(0.35, 1.0)
                for sgn in (1, -1):
                    ey = RIDGE_Y - sgn * (HALF + 0.3)
                    p0 = Vector((x, ey, PLATE))
                    p1 = p0.lerp(Vector((x + jit(0.2), RIDGE_Y, RIDGE_Z - R.uniform(0, 1.5))), t)
                    if R.random() < 0.8:
                        beam(oak, p0, p1, 0.12, 0.15, 0.01, side=(1, 0, 0))
        return
    roof_rows(B("tile"), I, 0.0, HX1 + 0.42, eave_front, ridge, row_w=0.34, sag=0.1, seg=9)
    roof_rows(B("tile"), mir, 0.0, HX1 + 0.42, eave_front, ridge, row_w=0.34, sag=0.1, seg=9)
    ridge_tiles(B("tile"), I, 0.0, HX1 + 0.45, RIDGE_Y, RIDGE_Z + 0.1, r=0.15)
    # bargeboards on the east verge + fascia
    xe = HX1 + 0.42
    for sgn in (1, -1):
        ey = RIDGE_Y - sgn * (HALF + 0.5)
        p0 = Vector((xe, ey, PLATE - 0.5 * math.tan(PITCH) - 0.1))
        p1 = Vector((xe, RIDGE_Y, RIDGE_Z - 0.1))
        beam(B("plank"), p0, p1, 0.3, 0.05, 0.008, side=(1, 0, 0))
    # weathering (drip) course on the keep face along the roof line
    for sgn in (1, -1):
        ey = RIDGE_Y - sgn * (HALF + 0.3)
        ez = PLATE - 0.3 * math.tan(PITCH)
        if sgn > 0:
            ey = max(ey, Y0 - PR + T - 0.02)
            ez = RIDGE_Z - (RIDGE_Y - ey) * math.tan(PITCH)
        beam(B("ashlar"), (X1 + 0.06, ey, ez + 0.2), (X1 + 0.06, RIDGE_Y, RIDGE_Z + 0.4), 0.18, 0.2, 0.015,
             side=(1, 0, 0))


def build_chimneys(ruin=False):
    c = B("chimney")
    # lateral stack on the back wall
    box(c, (5.2, HYB - 0.05, 0), (6.8, HYB + 1.05, 6.9), 0.03)
    pts = []
    for (x0, x1, y1, z) in ((5.2, 6.8, HYB + 1.05, 6.9), (5.5, 6.5, HYB + 0.75, 7.7)):
        pts += [(x0, HYB - 0.05, z), (x1, HYB - 0.05, z), (x0, y1, z), (x1, y1, z)]
    prism_hull(c, pts)
    top = 12.7 if not ruin else 9.4
    box(c, (5.5, HYB - 0.3, 7.7), (6.5, HYB + 0.75, top), 0.03)
    if not ruin:
        box(B("ashlar"), (5.38, HYB - 0.42, top), (6.62, HYB + 0.87, top + 0.22), 0.03)
        box(c, (5.62, HYB - 0.2, top + 0.22), (6.38, HYB + 0.62, top + 0.62), 0.02)
        box(B("dark"), (5.78, HYB - 0.06, top + 0.6), (6.22, HYB + 0.48, top + 0.63))
    # ridge stack
    if not ruin:
        box(c, (10.45, RIDGE_Y - 0.55, RIDGE_Z - 1.6), (11.45, RIDGE_Y + 0.5, 12.9), 0.03)
        box(B("ashlar"), (10.33, RIDGE_Y - 0.67, 12.9), (11.57, RIDGE_Y + 0.62, 13.12), 0.03)
        box(c, (10.58, RIDGE_Y - 0.42, 13.12), (11.32, RIDGE_Y + 0.37, 13.5), 0.02)
        box(B("dark"), (10.72, RIDGE_Y - 0.28, 13.48), (11.18, RIDGE_Y + 0.23, 13.51))


# =====================================================================  LEAN-TO + PROPS
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


def build_leanto(ruin=False):
    x0, x1 = HX1 + 0.08, HX1 + 3.0
    y0, y1 = HYF + 0.2, HYB - 0.6
    ztop, zlow = 3.25, 2.35
    oak = B("oak")
    for y in (y0 + 0.15, (y0 + y1) / 2, y1 - 0.1):
        box(B("ashlar"), (x1 - 0.2, y - 0.2, 0), (x1 + 0.2, y + 0.2, 0.18), 0.02)
        top = zlow if not ruin else R.uniform(0.8, 1.8)
        beam(oak, (x1, y, 0.18), (x1 + jit(0.03), y, top), 0.18, 0.18, 0.012)
    if not ruin:
        beam(oak, (x1, y0 - 0.2, zlow + 0.09), (x1, y1 + 0.2, zlow + 0.09), 0.18, 0.2, 0.012)
        beam(oak, (x0 + 0.05, y0 - 0.2, ztop - 0.1), (x0 + 0.05, y1 + 0.2, ztop - 0.1), 0.16, 0.16, 0.012)
        for y in grid(y0, y1, 0.9):
            beam(oak, (x0, y, ztop), (x1 + 0.35, y, zlow + 0.05), 0.1, 0.14, 0.01, side=(0, 0, 1))
        M = Matrix.Translation((0, 0, 0)) @ Matrix.Rotation(-math.pi / 2, 4, "Z")
        # local frame: rows along local x (=world -y ... ) build with rotated matrix
        Mr = Matrix(((0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))
        # local (lx, ly, lz) -> world (ly, -lx, lz): eave at local y = x1+0.4
        roof_rows(B("shingle"), Mr, -(y1 + 0.35), -(y0 - 0.35), (x1 + 0.42, zlow + 0.02), (x0 + 0.02, ztop + 0.12),
                  row_w=0.3, thick=0.03, lift=0.03, sag=0.06, seg=6)
        # plank back wall (north)
        for x in grid(x0, x1, 0.26, 0.0)[:-1]:
            h = ztop - (ztop - zlow) * (x - x0) / (x1 - x0)
            beam(B("plank"), (x + 0.13, y1 + 0.1, 0.08), (x + 0.13 + jit(0.01), y1 + 0.1, h + jit(0.03)),
                 0.25 * R.uniform(0.9, 1.05), 0.035, 0.006, side=(0, 1, 0))
    # contents
    barrel((x0 + 0.5, y1 - 0.5, 0))
    barrel((x0 + 1.15, y1 - 0.45, 0), 0.28, 0.8)
    barrel((x1 + 0.6, y0 + 0.1, 0), 0.3, 0.85, lying=False)
    barrel((x0 + 0.7, y0 + 1.0, 0), 0.3, 0.85, lying=True)
    log_pile(x0 + 0.3, y0 + 1.8, x1 - 0.3, rows=4, length=1.1)
    for (cx, cy, s) in ((x1 - 0.5, y0 + 0.5, 0.55), (x1 - 0.55, y0 + 0.5, 0.42)):
        z0 = 0 if s > 0.5 else 0.55
        box(B("plank"), (cx - s / 2, cy - s / 2, z0), (cx + s / 2, cy + s / 2, z0 + s), 0.02, rot=(0, 0, jit(0.3)))


# =====================================================================  HOARDING
def build_hoarding():
    xa, xb = -9.2, -3.6
    yw = Y0 - 0.16       # parapet outer face
    yo = yw - 1.35       # hoarding outer face
    zf = WALK + 0.02
    oak = B("oak")
    pl = B("plank")
    for x in grid(xa + 0.1, xb - 0.1, 0.95, 0.03):
        beam(oak, (x, Y0 + 0.4, zf - 0.13), (x, yo - 0.12, zf - 0.13 + jit(0.01)), 0.18, 0.22, 0.012,
             side=(0, 0, 1))
        beam(oak, (x, Y0 + 0.02, zf - 1.55), (x, yo + 0.25, zf - 0.22), 0.14, 0.14, 0.01, side=(1, 0, 0), ext=0.06)
    # floor
    for y in grid(yo, yw, 0.26, 0.0)[:-1]:
        beam(pl, (xa - 0.05, y + 0.13, zf + 0.02), (xb + 0.05, y + 0.13, zf + 0.02), 0.25, 0.04, 0.006,
             side=(0, 0, 1))
    # front boarding with loops
    ztop = WALK + 1.9
    x = xa
    k = 0
    while x < xb - 0.05:
        w = R.uniform(0.22, 0.32)
        w = min(w, xb - x)
        gap = (k % 5 == 2)
        if not gap:
            beam(pl, (x + w / 2, yo + 0.02, zf), (x + w / 2 + jit(0.01), yo + 0.02, ztop + jit(0.05)), w - 0.012, 0.04,
                 0.006, side=(0, 1, 0))
        else:
            beam(pl, (x + w / 2, yo + 0.02, zf), (x + w / 2, yo + 0.02, zf + 0.8), w - 0.012, 0.04, 0.006,
                 side=(0, 1, 0))
            beam(pl, (x + w / 2, yo + 0.02, zf + 1.35), (x + w / 2, yo + 0.02, ztop), w - 0.012, 0.04, 0.006,
                 side=(0, 1, 0))
        x += w
        k += 1
    for zz in (zf + 0.35, ztop - 0.2):
        beam(oak, (xa - 0.05, yo + 0.1, zz), (xb + 0.05, yo + 0.1, zz), 0.14, 0.1, 0.01, side=(0, 1, 0))
    for xx in (xa, xb):
        for y in grid(yo, yw, 0.28, 0.0)[:-1]:
            beam(pl, (xx, y + 0.14, zf), (xx, y + 0.14, ztop + 0.3), 0.27, 0.04, 0.006, side=(1, 0, 0))
    # pent roof over the gallery (planks/shingles)
    I = Matrix.Identity(4)
    roof_rows(B("shingle"), I, xa - 0.25, xb + 0.25, (yo - 0.35, ztop - 0.12), (Y0 + 0.3, WALK + 2.75),
              row_w=0.3, thick=0.03, sag=0.05, seg=6)


# =====================================================================  BUILD-STATE EXTRAS
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
        s = big * R.uniform(0.5, 1.0)
        z0 = max(0.0, (r - rr) / r * big * 1.1 - s * 0.35) - 0.03
        box(B("ashlar"), (x - s / 2, y - s * 0.35, z0), (x + s / 2, y + s * 0.35, z0 + s * 0.55), 0.03,
            rot=(jit(0.12), jit(0.12), R.uniform(0, 3)))


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


def build1():
    """foundations: first courses of the keep + plinth, trenches, stakes and lines for the hall."""
    # keep: wall bases 0.9 m with a rough top
    ol = keep_outline()
    plinth(ol, h=0.8)
    # soil apron / trench spoil
    for (a, b, nrm) in edges_of(ol):
        f = Face(a, nrm)
        f.box(B("soil"), -0.9, (b - a).length + 0.9, -1.4, -0.42, 0.0, 0.12 + R.uniform(0, 0.08), 0.05)
    # keep interior: walls 2.2 m thick laid to ~1.4 m, rubble core visible
    for (x0, y0, x1, y1) in ((X0, Y0, X1, Y0 + 2.2), (X0, Y1 - 2.2, X1, Y1), (X0, Y0, X0 + 2.2, Y1), (X1 - 2.2, Y0, X1, Y1)):
        box(B("rubble"), (x0, y0, 0), (x1, y1, 1.35 + R.uniform(-0.1, 0.1)))
    for (tx, ty), nm in TOWERS:
        box(B("rubble"), (tx, ty, 0), (tx + T, ty + T, R.uniform(1.4, 2.1)))
    # a few stones being laid on the wall head
    for i in range(14):
        x = R.uniform(X0 + 0.5, X1 - 0.5)
        y = R.choice((Y0 + R.uniform(0.3, 1.9), Y1 - R.uniform(0.3, 1.9)))
        box(B("ashlar"), (x - 0.3, y - 0.2, 1.35), (x + 0.3, y + 0.2, 1.62), 0.02, rot=(0, 0, R.uniform(0, 3)))
    # forebuilding footing + trench
    box(B("rubble"), (FB[0], FB[2], 0), (FB[1], FB[3], 0.9))
    # hall: plinth partly laid, trench for the rest, setting-out stakes and lines
    for (lo, hi) in (((HX0 - 0.3, HYF - 0.1), (7.5, HYF + 0.55)), ((0.0, HYB - 0.55), (7.5, HYB + 0.1)),
                     ((HX0 - 0.3, HYF - 0.1), (HX0 + 0.35, HYB + 0.1))):
        box(B("rubble"), lo + (0,), hi + (R.uniform(0.35, 0.5),), 0.03)
    rubble_heap(4.0, 0.0, 2.2, 2.2, 0.25, 12, "soil")
    for (p0, p1) in (((7.5, HYF - 0.1), (HX1 + 0.1, HYF - 0.1)), ((7.5, HYB + 0.1), (HX1 + 0.1, HYB + 0.1)),
                     ((HX1 + 0.1, HYF - 0.1), (HX1 + 0.1, HYB + 0.1))):
        a, b = Vector(p0 + (0.0,)), Vector(p1 + (0.0,))
        d = (b - a)
        n = Vector((-d.y, d.x, 0)).normalized() * 0.35
        lo = Vector((min(a.x, b.x), min(a.y, b.y), 0)) - Vector((abs(n.x), abs(n.y), 0))
        hi = Vector((max(a.x, b.x), max(a.y, b.y), 0.06)) + Vector((abs(n.x), abs(n.y), 0))
        box(B("dark"), lo, hi)
        box(B("soil"), lo + Vector((0.7 * abs(n.y) / 0.35, 0.7 * abs(n.x) / 0.35, 0)) * 0 + Vector((0, 0, 0)),
            hi + Vector((0, 0, 0.12)), 0.05) if False else None
    for (x, y) in ((7.5, HYF - 0.6), (HX1 + 0.6, HYF - 0.6), (HX1 + 0.6, HYB + 0.6), (7.5, HYB + 0.6),
                   (X0 - 1.4, Y0 - 1.4), (FB[0] - 1.0, FB[2] - 1.2), (FB[1] + 5.0, FB[2] - 1.2)):
        cyl(B("plank"), (x, y, 0), (x + jit(0.04), y + jit(0.04), 0.75), 0.035, 0.02, n=5)
    for (a, b) in (((7.5, HYF - 0.6), (HX1 + 0.6, HYF - 0.6)), ((HX1 + 0.6, HYF - 0.6), (HX1 + 0.6, HYB + 0.6)),
                   ((HX1 + 0.6, HYB + 0.6), (7.5, HYB + 0.6)), ((FB[0] - 1.0, FB[2] - 1.2), (FB[1] + 5.0, FB[2] - 1.2))):
        beam(B("iron"), (a[0], a[1], 0.62), (b[0], b[1], 0.62), 0.012, 0.012, 0.0)
    stone_pile(5.0, -7.5, 26, 1.5)
    stone_pile(-15.0, -1.0, 20, 1.3)
    stone_pile(9.0, 7.0, 18, 1.2)
    timber_stack(3.5, 5.5, 5.0, 3)
    timber_stack(15.5, -5.0, 3.5, 2, along_x=False)
    rubble_heap(-6.0, 1.0, 2.5, 2.0, 0.6, 30, "soil")
    # mortar tub + ladder lying
    barrel((2.0, -6.5, 0), 0.4, 0.4)
    barrel((12.0, -7.0, 0), 0.3, 0.85)


def build2():
    cap = 7.4
    build_keep(top_cap=cap)
    # ragged top courses
    for (x0, y0, x1, y1) in ((X0, Y0, X1, Y0 + 2.0), (X0, Y1 - 2.0, X1, Y1), (X0, Y0, X0 + 2.0, Y1), (X1 - 2.0, Y0, X1, Y1)):
        lx, ly = x1 - x0, y1 - y0
        n = int(max(lx, ly) / 0.65)
        for i in range(n):
            if R.random() < 0.35:
                continue
            t0, t1 = i / n, (i + R.uniform(0.6, 0.95)) / n
            if lx > ly:
                box(B("rubble"), (x0 + lx * t0, y0 + 0.2, cap), (x0 + lx * t1, y1 - 0.2, cap + R.uniform(0.2, 0.34)), 0.02)
            else:
                box(B("rubble"), (x0 + 0.2, y0 + ly * t0, cap), (x1 - 0.2, y0 + ly * t1, cap + R.uniform(0.2, 0.34)), 0.02)
    build_forebuilding(cap=5.3)
    build_stair(n_built=11)
    build_hall("frame")
    build_chimneys(ruin=True)
    scaffold_face((X0 - PR - 0.1, Y0 - PR, 0), (X1 + PR + 0.1, Y0 - PR, 0), (0, -1, 0), cap, 1.1)
    scaffold_face((X1 + PR, Y1 + PR, 0), (X1 + PR, Y0 + 2.3, 0), (1, 0, 0), cap, 1.1)
    stone_pile(4.0, -8.5, 24, 1.4)
    stone_pile(-15.0, 2.0, 18, 1.2)
    timber_stack(15.5, -6.0, 3.6, 3, along_x=False)
    barrel((1.8, -7.4, 0), 0.4, 0.4)


def build_ruin():
    build_keep(ruin=True)
    build_forebuilding()
    build_stair()
    build_hall("burnt")
    build_chimneys(ruin=True)
    build_leanto(ruin=True)
    rubble_heap(3.5, -1.0, 3.0, 2.6, 1.1, 45, "ash")
    rubble_heap(10.0, 0.5, 3.2, 2.8, 0.9, 40, "ash")
    rubble_heap(1.5, 6.5, 1.8, 1.4, 0.9, 25, "rubble")
    rubble_heap(-11.0, 8.2, 2.2, 1.6, 1.1, 28, "rubble")
    rubble_heap(X0 - 1.2, -1.0, 1.2, 2.4, 0.8, 20, "rubble")
    # fallen charred beams
    for i in range(10):
        x = R.uniform(1.5, 13.0)
        y = R.uniform(-2.5, 2.5)
        a = R.uniform(0, math.pi)
        l = R.uniform(1.5, 3.5)
        beam(B("oak"), (x, y, 0.2), (x + math.cos(a) * l, y + math.sin(a) * l, R.uniform(0.1, 1.2)), 0.2, 0.2, 0.01)


# =====================================================================  MAIN
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
                     all(depth_in_solid(v.co + f.normal * 0.3) >= 0.3 for v in f.verts)]
        if kill:
            bmesh.ops.delete(bm, geom=kill, context="FACES_ONLY")
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(o.data); bm.free()


def main():
    build_materials()
    if FULL or RUIN:
        SOLIDS.append(((-0.6, HYF + 0.05, 0.0), (HX1 - 0.05, HYB - 0.05, 6.3)))
    if FULL:
        build_keep()
        build_forebuilding()
        build_stair()
        build_hall()
        build_chimneys()
        build_leanto()
        build_hoarding()
    elif B2:
        build2()
    elif B1:
        build1()
    else:
        build_ruin()
    # materialise batches (slabs with openings get their booleans)
    for k, v in list(BATCHES.items()):
        if isinstance(v, tuple):
            s, c = v
            ob = s.build()
            if c is not None and c.F:
                apply_boolean(ob, cutter_obj(c))
        elif not k.startswith("_"):
            v.build()
    cleanup_bottoms()
    tris = 0
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and not o.hide_render:
            n = sum(len(p.vertices) - 2 for p in o.data.polygons)
            tris += n
    print("HG_TRIS_PRE", tris)
    stats = {}
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and not o.hide_render:
            k = o.data.materials[0].name if o.data.materials else "?"
            a = sum(p.area for p in o.data.polygons)
            t, aa = stats.get(k, (0, 0))
            stats[k] = (t + sum(len(p.vertices) - 2 for p in o.data.polygons), aa + a)
    for k, (t, a) in sorted(stats.items(), key=lambda x: -x[1][1]):
        print("HG_STAT %-10s tris %6d area %7.1f" % (k, t, a))
    for o in [o for o in bpy.context.scene.objects if o.hide_render]:
        bpy.data.objects.remove(o, do_unlink=True)
    if os.environ.get("HG_DRY"):
        return
    name = "town_hall" if FULL else "town_hall_" + STATE
    L.finish(name, tex=2048, lods=(1.0, 0.4, 0.12))


main()
