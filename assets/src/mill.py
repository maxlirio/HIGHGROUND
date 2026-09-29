"""HIGHGROUND - watermill, footprint 10 x 10 m.

A two-storey rubble-stone corn mill with a stone-slate roof between coped gables. An undershot
waterwheel (two oak felloe rims, compass arms, 20 floats, octagonal oak shaft on a stone pier)
turns in a stone-walled, plank-lined leat that runs past the east gable: an arched culvert
feeds a head-race, a timber sluice (posts, head beam, rack-and-pinion paddle gate) holds it back,
and the tail-race spills over a stone apron into a shallow outfall. Front: arched door, the
upper-floor sack-hoist door under a timber lucam with hoist beam, pulley and a sack on the rope;
old millstones leant against the wall, grain sacks, a barrow.

    blender -b -P assets/src/mill.py -- [complete|build1|build2|ruin]

Front faces -Y. 1 unit = 1 m.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _craft import *

seed(47)

# ------------------------------------------------------------------ layout
XW0, XW1 = -4.55, 1.7         # outer faces of the gable walls (west, east)
YF, YB = -3.1, 3.1            # outer faces of front / back walls
TW = 0.62                     # wall thickness
FLOOR1 = 2.85                 # upper floor level
PLATE = 5.3                   # wall-head height
RY = (YF + YB) / 2
PL0 = PLATE + 0.12            # roof plane height over the outer wall face
RZ = PL0 + (RY - YF)          # 45 deg pitch
PITCH = math.radians(45)
OVER = 0.34
# leat / wheel
CX0, CX1 = 1.84, 3.42         # channel inner faces
EW1 = 4.02                    # east channel wall outer face
WW0 = 1.16                    # west channel wall outer face (outside the house)
WL = 0.44                     # tail-race water level
HL = 0.8                      # head-race water level
SLY = 3.95                    # sluice line
HWY = 4.7                     # culvert headwall inner face
APY = -4.7                    # channel ends at the tail culvert headwall
WX, WY, WZ = 2.63, 0.3, 2.55  # wheel centre
WR = 2.28                     # wheel outer radius (float tips)
WHW = 0.53                    # half width of the wheel between the rims
DOORX = -1.55                 # front door / hoist column
SOLIDS.clear()


def plane_z(y):
    return RZ - abs(y - RY)


def extra(M, ch):
    M["stoneslate"] = m_tiles("stoneslate", [(0.0, "#5e5549"), (0.2, "#6f6452"), (0.45, "#80735e"),
                                              (0.7, "#8e7d66"), (0.85, "#998870"), (1.0, "#665a4b")], cell=0.42,
                              curve=0.1, lichen=1.6, moss=1.2, charred=ch)
    M["grit"] = m_stone("grit", [(0.0, "#948672"), (0.5, "#a6977d"), (1.0, "#978a74")], "#766a57", joints=False,
                        bump=0.5, charred=ch * 0.5)
    M["millstone"] = m_millstone("millstone")
    M["water"] = m_liquid("water", "#3d4841", "#4e5a4c", 0.07)
    M["foam"] = m_heap("foam", [(0.1, "#5f6861"), (0.5, "#80897f"), (0.9, "#a2a99c")], 22.0, rough=0.3)
    M["wetstone"] = m_stone("wetstone", [(0.0, "#56574b"), (0.4, "#666656"), (0.7, "#72705d"), (1.0, "#5b5a4d")],
                            "#454538", rowh=0.28, bw=0.5, moss=1.8, charred=0.0)
    M["yard"] = m_heap("yard", [(0.1, "#4a3c2d"), (0.5, "#5b4a37"), (0.9, "#6a5840")], 9.0, pebble=0.35, grass=0.55)
    M["mud"] = m_heap("mud", [(0.1, "#3a3024"), (0.5, "#4a3d2d"), (0.9, "#57493a")], 7.0, rough=0.55, sheen=0.3,
                      pebble=0.2, grass=0.3)
    M["sacking"] = m_cloth("sacking", "#7d6e55", "#8f7f62", weave=160.0)
    M["flour"] = m_heap("flour", [(0.1, "#b3aa98"), (0.5, "#c4bca9"), (0.9, "#cfc7b4")], 20.0, rough=0.95)
    M["grain"] = m_heap("grain", [(0.1, "#8a6f45"), (0.5, "#a0834f"), (0.9, "#b39459")], 60.0, rough=0.8)


def m_millstone(name):
    """French-burr / Peak gritstone: sectored harps of furrows on the grinding face, eye, iron-grey grit."""
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    r = g.node("ShaderNodeVectorMath", [(0, g.comb(lx, ly, 0.0))], operation="LENGTH").outputs["Value"]
    ang = g.math("ARCTAN2", ly, lx)
    # 10 harps, each with 4 furrows parallel to the harp's leading edge
    hp = g.math("FRACT", g.mul(ang, 10 / (2 * math.pi)))
    fur = g.math("FRACT", g.add(g.mul(hp, 4.0), g.mul(r, 3.0)))
    furrow = g.mul(g.mr(fur, 0.62, 0.8), g.mr(r, 0.16, 0.24))
    face = g.gt(g.math("ABSOLUTE", lz), 0.001)
    col = g.ramp(g.add(g.mul(g.noise(P, 2.0, 3), 0.7), g.mul(rnd, 0.3)),
                 [(0.2, "#8a8378"), (0.55, "#9d968a"), (0.85, "#aca395")])
    grit = g.noise(P, 60.0, 5, 0.7)
    col = g.mix(0.5, col, grit, "OVERLAY")
    col = g.mix(g.mul(g.mul(furrow, face), 0.7), col, "#5c574f")
    # weathering: lichen and moss on old leaning stones
    li = g.mul(g.inv(g.mr(g.vor(P, 6.0), 0.05, 0.16)), g.mr(g.noise(P, 1.3, 3), 0.5, 0.62))
    col = g.mix(g.mul(li, 0.6), col, "#a6a27f")
    x, y, z = g.sep(P)
    col, md, mb = g.ground_grime(col, z, 1.0, 1.2, 0.35)
    h = g.sub(g.mul(grit, 0.5), g.mul(g.mul(furrow, face), 1.0))
    return g.out(col, 0.9, h, 1.0, 0.012)


# ------------------------------------------------------------------ small geometry helpers
def annulus(bt, c, axis, r_out, r_in, th, n=20, rnd=None, jr=0.0):
    """thick ring (millstone / hub). loc = disc-local (x, y, +-th) so the face shader can find furrows."""
    c, ax = Vector(c), Vector(axis).normalized()
    side = Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((0, 1, 0))
    xa = side.cross(ax).normalized()
    ya = ax.cross(xa)
    pts, loc = [], []
    for zz in (-th / 2, th / 2):
        for rr in (r_out, r_in):
            for i in range(n):
                a = 2 * math.pi * i / n
                k = rr * (1 + (jit(jr) if rr == r_out else 0))
                lx, ly = math.cos(a) * k, math.sin(a) * k
                pts.append(tuple(c + xa * lx + ya * ly + ax * zz))
                loc.append((lx, ly, zz))
    F = []
    o_b, i_b, o_t, i_t = 0, n, 2 * n, 3 * n
    for i in range(n):
        j = (i + 1) % n
        F.append((o_b + i, o_b + j, o_t + j, o_t + i))      # outer wall
        F.append((i_b + j, i_b + i, i_t + i, i_t + j))      # eye wall
        F.append((o_t + i, o_t + j, i_t + j, i_t + i))      # top face
        F.append((o_b + j, o_b + i, i_b + i, i_b + j))      # bottom face
    bt.add(pts, F, None, rnd, loc)


def rope(p0, p1, r=0.016):
    cyl(B("rope"), p0, p1, r, n=5)


def slab(bt, x0, y0, x1, y1, z0, z1, rnd=None):
    box(bt, (x0, y0, z0), (x1, y1, z1), 0.0, rnd=rnd)


# ------------------------------------------------------------------ walls
RUIN_SEGS = {"front": [(XW0, -2.7, PLATE), (-2.7, 0.2, 3.3), (0.2, XW1, 2.1)],
             "back": [(XW0, -2.9, PLATE), (-2.9, XW1, 1.9)]}


def walls(cap=PLATE, gables=True, ruin=False, openings=True):
    """rubble walls with dressed openings. cap: wall-head (build states). ruin: broken heads."""
    tops = {"front": cap, "back": cap, "west": cap, "east": cap}
    segs = {"front": [(XW0, XW1, cap)], "back": [(XW0, XW1, cap)]}
    if ruin:
        tops = {"front": 3.3, "back": 1.9, "west": PLATE, "east": 3.6}
        segs = RUIN_SEGS
    cut = {k: Batch("cut_" + k, "dark") for k in tops}
    wb = {}
    wb["front"] = Batch("wall_front", "rubble")
    for (x0, x1, t) in segs["front"]:
        box(wb["front"], (x0, YF, 0), (x1, YF + TW, t))
    wb["back"] = Batch("wall_back", "rubble")
    for (x0, x1, t) in segs["back"]:
        box(wb["back"], (x0, YB - TW, 0), (x1, YB, t))
    wb["west"] = Batch("wall_west", "rubble")
    box(wb["west"], (XW0, YF + TW, 0), (XW0 + TW, YB - TW, tops["west"]))
    wb["east"] = Batch("wall_east", "rubble")
    box(wb["east"], (XW1 - TW, YF + TW, 0), (XW1, YB - TW, tops["east"]))
    ff = Face((XW0, YF, 0), (0, -1, 0))
    fb = Face((XW1, YB, 0), (0, 1, 0))
    fw = Face((XW0, YB, 0), (-1, 0, 0))
    fe = Face((XW1, YF, 0), (1, 0, 0))
    dep = TW + 0.1
    if openings:
        du = DOORX - XW0
        if tops["front"] > 2.4:
            window(ff, cut["front"], du, 0.0, 1.25, 2.3, "round", depth=dep, backdark=False)
            door_leaf(ff, du, 0.0, 1.25, 2.3, TW * 0.55, arch=True)
        else:
            ff.box(cut["front"], du - 0.62, du + 0.62, -0.3, dep, 0.0, 3.0)
        # loading door on the upper floor, directly under the lucam
        if tops["front"] > FLOOR1 + 2.0:
            window(ff, cut["front"], du, FLOOR1 + 0.2, 1.1, 1.45, "flat", depth=dep, backdark=True)
            for sgn in (-1, 1):       # two ledged leaves folded back against the wall
                for k in range(3):
                    u0 = du + sgn * (0.6 + 0.02 + k * 0.18)
                    ff.box(B("plank"), min(u0, u0 + sgn * 0.17), max(u0, u0 + sgn * 0.17), -0.08, -0.03,
                           FLOOR1 + 0.24, FLOOR1 + 1.62, 0.004)
                ff.box(B("iron"), min(du + sgn * 0.62, du + sgn * 1.15), max(du + sgn * 0.62, du + sgn * 1.15), -0.1,
                       -0.075, FLOOR1 + 0.5, FLOOR1 + 0.56)
        if tops["front"] > 1.9:
            window(ff, cut["front"], 1.1 - XW0 - 0.3, 1.0, 0.62, 0.8, "flat", depth=dep)
        if tops["front"] > FLOOR1 + 1.6:
            window(ff, cut["front"], 0.6 - XW0 + 0.35, FLOOR1 + 0.7, 0.62, 0.85, "flat", depth=dep)
        if tops["back"] > 1.9:
            window(fb, cut["back"], 2.1, 1.1, 0.6, 0.8, "flat", depth=dep)
        if tops["back"] > FLOOR1 + 1.5:
            window(fb, cut["back"], 4.3, FLOOR1 + 0.6, 0.6, 0.85, "flat", depth=dep)
        if tops["west"] > FLOOR1 + 1.5:
            window(fw, cut["west"], 3.1, FLOOR1 + 0.7, 0.55, 0.8, "flat", depth=dep)
        if tops["west"] > 1.9:
            slit(fw, cut["west"], 1.6, 0.9, 1.0)
        if tops["east"] > FLOOR1 + 1.5:
            window(fe, cut["east"], (WY - YF) + 2.35, FLOOR1 + 0.75, 0.55, 0.8, "flat", depth=dep)
        # shaft hole through the east wall (the wheel shaft goes in to the pit wheel)
        if tops["east"] > WZ + 0.5:
            fe.box(cut["east"], WY - YF - 0.34, WY - YF + 0.34, -0.3, dep, WZ - 0.34, WZ + 0.34)
        # putlog holes left from the scaffold
        if not ruin:
            putlogs(ff, cut["front"], [0.9, 2.3, 4.4, 5.7], min(tops["front"] - 0.4, FLOOR1 + 1.9))
            putlogs(fw, cut["west"], [1.1, 4.8], min(tops["west"] - 0.4, FLOOR1 + 1.9))
    for k in wb:
        ob = wb[k].build()
        if cut[k].F:
            apply_boolean(ob, cutter_obj(cut[k]))
    if gables and not ruin:
        gable(XW0, XW0 + TW, B("rubble"))
        gable(XW1 - TW, XW1, B("rubble"))
    zq = {k: min(v, PLATE) for k, v in tops.items()}
    fW, fE = segs["front"][0][2], segs["front"][-1][2]
    bW, bE = segs["back"][0][2], segs["back"][-1][2]
    quoins((XW0, YF), (-1, 0, 0), (0, -1, 0), 0.32, min(zq["west"], fW), course=0.4, la=0.6, lb=0.34)
    quoins((XW1, YF), (0, -1, 0), (1, 0, 0), 0.32, min(fE, zq["east"]), course=0.4, la=0.6, lb=0.34)
    quoins((XW1, YB), (1, 0, 0), (0, 1, 0), 0.32, min(zq["east"], bE), course=0.4, la=0.6, lb=0.34)
    quoins((XW0, YB), (0, 1, 0), (-1, 0, 0), 0.32, min(bW, zq["west"]), course=0.4, la=0.6, lb=0.34)
    # battered plinth course all round
    ol = [(XW0, YF), (XW1, YF), (XW1, YB), (XW0, YB)]
    for a, b, nrm in edges_of(ol):
        f = Face(a, nrm)
        Lh = (b - a).length
        segs = [(-0.14, Lh + 0.14)]
        if nrm.y < -0.5:
            du = DOORX - XW0
            segs = [(-0.14, du - 0.66), (du + 0.66, Lh + 0.14)]
        for (u0, u1) in segs:
            f.prism_dv(B("rubble"), [(-0.14, 0), (0.2, 0), (0.2, 0.38), (-0.02, 0.38), (-0.14, 0.22)], u0, u1)
    return tops


def gable(xa, xb, bt):
    pts = []
    for x in (xa, xb):
        pts += [(x, YF, PLATE - 0.02), (x, YB, PLATE - 0.02), (x, YF, plane_z(YF) + 0.14),
                (x, YB, plane_z(YB) + 0.14), (x, RY, RZ + 0.14)]
    prism_hull(bt, pts)
    xm = (xa + xb) / 2
    for y0 in (YF - 0.12, YB + 0.12):
        n = 8
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            ya, yb = y0 + (RY - y0) * t0, y0 + (RY - y0) * t1
            beam(B("ashlar"), (xm, ya, plane_z(ya) + 0.2), (xm, yb, plane_z(yb) + 0.2), 0.74, 0.15, 0.02,
                 side=(0, -1 if y0 < RY else 1, 1))
        sg = -1 if y0 < RY else 1
        box(B("ashlar"), (xa - 0.08, y0 - sg * 0.05 - 0.26, PLATE - 0.1), (xb + 0.08, y0 + 0.26 - sg * 0.05, PLATE + 0.34),
            0.02)
    box(B("ashlar"), (xa - 0.06, RY - 0.23, RZ + 0.15), (xb + 0.06, RY + 0.23, RZ + 0.6), 0.03)
    # small owl-hole / vent high in the gable
    f = Face((xa, YB, 0), (-1, 0, 0)) if xa < 0 else Face((xb, YF, 0), (1, 0, 0))
    u = (RY - YF) if xa > 0 else (YB - RY)
    f.box(B("dark"), u - 0.12, u + 0.12, -0.01, 0.02, RZ - 1.6, RZ - 1.25)
    f.box(B("ashlar"), u - 0.26, u + 0.26, -0.03, 0.05, RZ - 1.25, RZ - 1.1, 0.01)


# ------------------------------------------------------------------ roof
def roof(stage="complete"):
    x0, x1 = XW0 + TW - 0.02, XW1 - TW + 0.02
    eave = (YF - OVER, plane_z(YF - OVER))
    ridge = (RY, RZ)
    I = Matrix.Identity(4)
    mir = Matrix.Translation((0, 2 * RY, 0)) @ Matrix.Scale(-1, 4, (0, 1, 0))
    oak = B("oak")
    if stage != "burnt":
        beam(oak, (XW0 + 0.2, YF + 0.24, PLATE + 0.08), (XW1 - 0.2, YF + 0.24, PLATE + 0.08), 0.26, 0.16, 0.015,
             side=(0, 0, 1))
        beam(oak, (XW0 + 0.2, YB - 0.24, PLATE + 0.08), (XW1 - 0.2, YB - 0.24, PLATE + 0.08), 0.26, 0.16, 0.015,
             side=(0, 0, 1))
    keep = 1.0 if stage != "burnt" else 0.45
    if stage != "complete":
        for x in grid(XW0 + TW + 0.15, XW1 - TW - 0.15, 0.55, 0.02):
            for sgn in (-1, 1):
                if R.random() > keep:
                    continue
                ye = RY + sgn * (RY - YF + OVER)
                p0 = Vector((x, ye, plane_z(ye) - 0.08))
                p1 = Vector((x, RY - sgn * 0.05, RZ - 0.08))
                if stage == "burnt":
                    if x > -2.9:
                        continue
                    p1 = p0.lerp(p1, R.uniform(0.35, 1.0))
                beam(oak, p0, p1, 0.1, 0.13, 0.008, side=(1, 0, 0))
    if stage == "frame":
        beam(oak, (x0, RY, RZ - 0.1), (x1, RY, RZ - 0.1), 0.14, 0.2, 0.01)
        for sgn in (-1, 1):
            for t in (0.35, 0.7):
                y = RY + sgn * (RY - YF) * t
                beam(B("plank"), (x0, y, plane_z(y) + 0.02), (x1, y, plane_z(y) + 0.02), 0.08, 0.03, 0.0)
        return
    if stage == "burnt":
        # one principal truss still standing at the west end, blackened
        xt = XW0 + TW + 0.3
        beam(oak, (xt, YF + 0.3, PLATE + 0.1), (xt, RY, RZ - 0.2), 0.2, 0.2, 0.01, side=(1, 0, 0))
        beam(oak, (xt, YB - 0.3, PLATE + 0.1), (xt, RY + 0.4, RZ - 0.6), 0.2, 0.2, 0.01, side=(1, 0, 0))
        beam(oak, (XW0 + 0.2, YF + 0.24, PLATE + 0.08), (-2.8, YF + 0.24, PLATE + 0.08), 0.26, 0.16, 0.015,
             side=(0, 0, 1))
        beam(oak, (XW0 + 0.2, YB - 0.24, PLATE + 0.08), (-3.0, YB - 0.24, PLATE + 0.08), 0.26, 0.16, 0.015,
             side=(0, 0, 1))
        roof_rows(B("stoneslate"), mir, x0, -3.05, eave, ridge, row_w=0.4, lap=0.68, thick=0.05, sag=0.14, seg=4,
                  stop=lambda t: t < 0.7)
        roof_rows(B("stoneslate"), I, x0, -3.3, eave, ridge, row_w=0.4, lap=0.68, thick=0.05, sag=0.18, seg=4,
                  stop=lambda t: t < 0.4)
        return
    for M in (I, mir):
        roof_rows(B("stoneslate"), M, x0, x1, eave, ridge, row_w=0.52, row_w_ridge=0.27, lap=0.66, thick=0.055,
                  lift=0.035, sag=0.1, seg=8, wob=0.02, jitx=0.06)
    saddle_ridge(B("grit"), I, x0 - 0.02, x1 + 0.02, RY, RZ + 0.06, PITCH, w=0.24, piece=0.62)


# ------------------------------------------------------------------ lucam (sack-hoist hood) over the loading door
def lucam(stage="complete"):
    """closed, weatherboarded hoist hood straddling the eave over the loading door."""
    oak, pl = B("oak"), B("plank")
    xc = DOORX
    hw = 0.8
    y0 = YF - 0.95                        # front face of the hood
    zb, zp = 4.86, 6.1                    # hood floor / its wall plate
    rz = zp + 0.85                        # its own ridge
    yback = -1.45                         # where its ridge dies into the main roof
    if stage == "burnt":
        beam(oak, (xc, YF + 0.5, PLATE + 0.25), (xc + 0.2, y0 + 0.4, PLATE - 0.9), 0.24, 0.24, 0.015)
        return
    # hoist beam out of the hood's apex
    beam(oak, (xc, YF + 0.6, zp + 0.22), (xc, y0 - 0.5, zp + 0.22), 0.22, 0.24, 0.015)
    if stage == "frame":
        return
    # corner posts, floor bearers, plates, knee braces down to the wall
    for x in (xc - hw, xc + hw):
        beam(oak, (x, y0 + 0.07, zb - 0.1), (x, y0 + 0.07, zp + 0.05), 0.15, 0.15, 0.012)
        beam(oak, (x, y0, zb), (x, YF + 0.1, zb), 0.15, 0.18, 0.012)
        beam(oak, (x, y0 + 0.2, zb - 0.02), (x, YF + 0.02, zb - 0.85), 0.12, 0.12, 0.01)
        beam(oak, (x, y0, zp), (x, YF + 0.6, zp), 0.15, 0.15, 0.012)
    beam(oak, (xc - hw - 0.06, y0 + 0.07, zb), (xc + hw + 0.06, y0 + 0.07, zb), 0.15, 0.17, 0.012, side=(0, 0, 1))
    beam(oak, (xc - hw - 0.06, y0 + 0.07, zp), (xc + hw + 0.06, y0 + 0.07, zp), 0.15, 0.15, 0.012, side=(0, 0, 1))
    # boarded floor underneath
    for i in range(6):
        y = y0 + 0.1 + i * (YF - y0 - 0.1) / 6
        box(pl, (xc - hw, y + 0.005, zb - 0.1), (xc + hw, y + (YF - y0 - 0.1) / 6 - 0.005, zb - 0.06), 0.004)
    # horizontal weatherboards on the cheeks
    for sgn in (-1, 1):
        x = xc + sgn * (hw + 0.03)
        z = zb - 0.05
        while z < zp - 0.02:
            beam(pl, (x, y0 + 0.02, z + 0.11), (x, YF + 0.7, z + 0.11), 0.23, 0.028, 0.004, side=(1, 0, 0),
                 twist=0.0)
            z += 0.195
    # vertical boards on the front + gable, with the small hoist door left open
    n = 8
    bw = 2 * hw / n
    for i in range(n):
        u0 = -hw + i * bw
        uc = u0 + bw / 2
        top = zp + (rz - zp) * max(0.0, 1 - abs(uc) / hw) - 0.04
        segs = [(zb - 0.08, top)]
        if abs(uc) < 0.38:
            segs = [(zb - 0.08, zb + 0.08), (zb + 1.02, top)]
        for (za, zt) in segs:
            box(pl, (xc + u0 + 0.006, y0 - 0.02, za), (xc + u0 + bw - 0.006, y0 + 0.02, zt), 0.004,
                rot=(0, jit(0.015), 0))
    box(B("dark"), (xc - 0.4, y0 + 0.2, zb + 0.06), (xc + 0.4, y0 + 0.25, zb + 1.04))
    ha = math.radians(115)
    hinge = Vector((xc - 0.38, y0 - 0.03, 0))
    d = Vector((math.cos(ha), -math.sin(ha), 0))
    for k in range(3):
        p0 = hinge + d * (0.02 + k * 0.25)
        box(pl, (0, 0, 0), (0, 0, 0)) if False else None
        beam(pl, Vector((p0.x, p0.y, zb + 0.1)), Vector((p0.x, p0.y, zb + 1.0)), 0.24, 0.035, 0.004,
             side=Vector((0, 0, 1)).cross(d))
    # its little roof in stone slates, ridge running back into the main slope
    for sgn in (-1, 1):
        Ms = Matrix.Translation((xc, 0, 0)) @ Matrix.Rotation(-math.pi / 2, 4, "Z")
        if sgn > 0:
            Ms = Ms @ Matrix.Scale(-1, 4, (0, 1, 0))
        roof_rows(B("stoneslate"), Ms, -yback, -(y0 - 0.2), (-(hw + 0.26), zp - 0.08), (0.0, rz + 0.06),
                  row_w=0.36, row_w_ridge=0.24, lap=0.68, thick=0.045, lift=0.03, sag=0.03, seg=4, wob=0.012,
                  jitx=0.03)
    beam(B("grit"), (xc, y0 - 0.22, rz + 0.12), (xc, yback - 0.1, rz + 0.12), 0.2, 0.14, 0.02)
    # pulley block, rope, and a sack half-way up
    pb = Vector((xc, y0 - 0.38, zp + 0.0))
    box(oak, pb - Vector((0.07, 0.11, 0.12)), pb + Vector((0.07, 0.11, 0.1)), 0.02)
    cyl(B("iron"), pb + Vector((-0.085, 0, -0.02)), pb + Vector((0.085, 0, -0.02)), 0.1, n=10)
    if stage == "complete":
        sk = Vector((xc + 0.02, pb.y - 0.08, 3.25))
        rope(pb + Vector((0, -0.08, -0.12)), sk + Vector((0, 0, 0.74)))
        rope(pb + Vector((0, 0.09, -0.12)), (xc + 0.3, YF - 0.12, FLOOR1 + 0.9), 0.014)
        sack(sk, 0.46, 0.4, 0.72, rot=0.3)


# ------------------------------------------------------------------ leat, wheel pit, sluice, culvert
def leat(stage="complete"):
    wet = B("wetstone")
    dry = stage in ("build1", "build2")
    ch_top = 1.0
    full = stage != "build1"
    # east channel wall with coping, full length
    ytop = HWY if full else 1.2
    box(wet, (CX1, APY, 0), (EW1, ytop, ch_top if full else 0.45))
    if full:
        y = APY
        while y < HWY - 0.05:
            l = min(R.uniform(0.6, 1.0), HWY - y)
            box(B("grit"), (CX1 - 0.06, y + 0.01, ch_top), (EW1 + 0.06, y + l - 0.01, ch_top + 0.16 + jit(0.015)), 0.02,
                rot=(0, 0, jit(0.01)))
            y += l
    # west channel wall outside the house (front and back of the building)
    for (ya, yb) in ((APY, YF), (YB, HWY)):
        box(wet, (WW0, ya, 0), (CX0, yb, ch_top if full else 0.4))
        if full:
            y = ya
            while y < yb - 0.05:
                l = min(R.uniform(0.6, 1.0), yb - y)
                box(B("grit"), (WW0 - 0.06, y + 0.01, ch_top), (CX0 + 0.06, y + l - 0.01, ch_top + 0.16 + jit(0.015)),
                    0.02, rot=(0, 0, jit(0.01)))
                y += l
    # along the house the mill wall is the west side: a wet stone face-course at its foot
    box(wet, (XW1, YF, 0), (CX0, YB, ch_top - 0.05))
    if not full:
        return
    # culvert headwall at the back: water comes in through an arched opening
    hw = Batch("wall_head", "wetstone")
    box(hw, (WW0 - 0.25, HWY, 0), (EW1 + 0.25, 5.0, 1.85))
    cut = Batch("cut_head", "dark")
    fh = Face((EW1 + 0.25, HWY, 0), (0, -1, 0))
    fh = Face((WW0 - 0.25, HWY, 0), (0, -1, 0))
    uc = (CX0 + CX1) / 2 - (WW0 - 0.25)
    window(fh, cut, uc, 0.0, 1.3, 1.25, "round", depth=0.22, backdark=True, surround=True)
    apply_boolean(hw.build(), cutter_obj(cut))
    for x0, x1 in ((WW0 - 0.3, WW0 + 0.6), (EW1 - 0.6, EW1 + 0.3)):
        box(B("grit"), (x0, HWY - 0.05, 1.85), (x1, 5.03, 2.02), 0.02)
    box(B("grit"), (WW0 + 0.6, HWY - 0.05, 1.85), (EW1 - 0.6, 5.03, 2.0), 0.02)
    # tail-race dives into a second culvert under the lane at the front
    hw = Batch("wall_tail", "wetstone")
    box(hw, (WW0 - 0.25, -5.0, 0), (EW1 + 0.25, APY, 1.6))
    cut = Batch("cut_tail", "dark")
    ft = Face((EW1 + 0.25, APY, 0), (0, 1, 0))
    uc = (EW1 + 0.25) - (CX0 + CX1) / 2
    window(ft, cut, uc, 0.0, 1.3, 1.15, "round", depth=0.45, backdark=False, surround=True)
    apply_boolean(hw.build(), cutter_obj(cut))
    for x0, x1 in ((WW0 - 0.3, WW0 + 0.6), (WW0 + 0.6, EW1 - 0.6), (EW1 - 0.6, EW1 + 0.3)):
        box(B("grit"), (x0, -5.03, 1.6), (x1, APY + 0.05, 1.76 + jit(0.02)), 0.02)
    # weir sill at the culvert mouth: the race spills over it off the plot
    box(B("wetstone"), (CX0 - 0.15, -5.0, 0), (CX1 + 0.15, -4.88, WL + 0.035), 0.02)
    # plank lining of the wheel pit with oak posts
    for xs, sgn in ((CX0, 1), (CX1, -1)):
        for yy in grid(-2.6, 3.4, 0.95, 0.03):
            beam(B("oak"), (xs + sgn * 0.08, yy, 0), (xs + sgn * 0.08, yy, ch_top + 0.12), 0.14, 0.14, 0.012)
        z = 0.08
        while z < ch_top:
            beam(B("plank"), (xs + sgn * 0.02, -2.7, z + 0.1), (xs + sgn * 0.02, 3.5, z + 0.1), 0.22, 0.035, 0.004,
                 side=(1, 0, 0))
            z += 0.23
    # stone pier + oak bearing block carrying the outer end of the shaft
    box(B("grit"), (CX1 + 0.05, WY - 0.5, ch_top), (EW1 + 0.02, WY + 0.5, WZ - 0.32), 0.03)
    for k in range(3):
        z = ch_top + 0.05 + k * 0.33
        box(B("grit"), (CX1 + 0.03, WY - 0.52 + jit(0.02), z), (EW1 + 0.04, WY + 0.52, z + 0.3), 0.02)
    box(B("oak"), (CX1 + 0.08, WY - 0.36, WZ - 0.32), (EW1 - 0.04, WY + 0.36, WZ - 0.14), 0.02)
    box(B("iron"), (CX1 + 0.1, WY - 0.3, WZ + 0.12), (EW1 - 0.06, WY + 0.3, WZ + 0.2), 0.01)
    # sluice: two grooved oak posts, cill, head beam, the paddle gate and its rack post + windlass
    oak = B("oak")
    for x in (CX0 + 0.02, CX1 - 0.02):
        beam(oak, (x, SLY, 0), (x, SLY, 2.55), 0.26, 0.26, 0.015)
    beam(oak, (CX0 - 0.3, SLY, 2.55), (CX1 + 0.3, SLY, 2.55), 0.28, 0.3, 0.015)
    beam(oak, (CX0 - 0.2, SLY, 0.12), (CX1 + 0.2, SLY, 0.12), 0.26, 0.26, 0.015)
    gate_z = 0.7 if stage == "complete" else (0.25 if stage == "ruin" else 0.25)
    if stage != "build2":
        for i in range(5):
            x0 = CX0 + 0.14 + i * (CX1 - CX0 - 0.28) / 5
            box(B("plank"), (x0 + 0.005, SLY - 0.03, gate_z), (x0 + (CX1 - CX0 - 0.28) / 5 - 0.005, SLY + 0.03,
                                                             gate_z + 1.05), 0.006)
        for z in (gate_z + 0.18, gate_z + 0.85):
            box(oak, (CX0 + 0.14, SLY - 0.08, z), (CX1 - 0.14, SLY - 0.03, z + 0.1), 0.01)
        # rack bar up through the head beam, windlass on top
        xm = (CX0 + CX1) / 2
        beam(B("iron"), (xm, SLY - 0.06, gate_z + 1.0), (xm, SLY - 0.06, 3.3), 0.08, 0.05, 0.004)
        for x in (xm - 0.45, xm + 0.45):
            beam(oak, (x, SLY, 2.7), (x, SLY, 3.2), 0.12, 0.2, 0.01)
        cyl(oak, (xm - 0.6, SLY - 0.02, 3.05), (xm + 0.6, SLY - 0.02, 3.05), 0.09, n=8)
        for a in (0.3, 1.87):
            h = Vector((xm + 0.62, SLY - 0.02, 3.05))
            beam(oak, h, h + Vector((0.05, math.cos(a) * 0.55, math.sin(a) * 0.55)), 0.05, 0.05, 0.004)
    # plank footbridge + rail across the tail-race, in front of the house
    if stage in ("complete", "ruin"):
        yb = -3.55
        for k in range(4):
            y = yb + (k - 1.5) * 0.22
            if stage == "ruin" and k == 1:
                continue
            beam(B("plank"), (WW0 + 0.3, y, ch_top + 0.2), (EW1 - 0.25, y + jit(0.02), ch_top + 0.2 + jit(0.03)), 0.2, 0.05,
                 0.004, side=(0, 0, 1))
        if stage == "complete":
            for x in (WW0 + 0.45, EW1 - 0.4):
                beam(oak, (x, yb - 0.38, ch_top + 0.16), (x, yb - 0.38, ch_top + 1.12), 0.1, 0.1, 0.008)
            beam(oak, (WW0 + 0.35, yb - 0.38, ch_top + 1.08), (EW1 - 0.3, yb - 0.38, ch_top + 1.08), 0.09, 0.09, 0.008)


def water(stage="complete"):
    wt = B("water")
    lvl = WL if stage != "ruin" else WL - 0.12
    slab(wt, CX0 - 0.02, -4.9, CX1 + 0.02, SLY - 0.06, 0.0, lvl)
    slab(wt, CX0 - 0.02, SLY + 0.08, CX1 + 0.02, HWY + 0.05, 0.0, HL)
    if stage in ("complete",):
        # water tumbling under the raised gate
        pts = [(CX0 + 0.12, SLY - 0.06, 0.66), (CX1 - 0.12, SLY - 0.06, 0.66), (CX0 + 0.12, SLY - 0.5, lvl + 0.01),
               (CX1 - 0.12, SLY - 0.5, lvl + 0.01), (CX0 + 0.12, SLY - 0.06, lvl - 0.1), (CX1 - 0.12, SLY - 0.06, lvl - 0.1)]
        prism_hull(B("foam"), pts)
        # broken white water where the floats bite, below the gate and at the foot of the apron
        spots = [(WY - 1.05, 0.55, 12), (WY - 0.1, 0.35, 5), (SLY - 0.8, 0.35, 7), (APY + 0.35, 0.25, 5)]
        for (cy, ry, n) in spots:
            for k in range(n):
                mound(B("foam"), R.uniform(CX0 + 0.12, CX1 - 0.12), cy + jit(ry), R.uniform(0.08, 0.2),
                      R.uniform(0.06, 0.16), R.uniform(0.01, 0.03), rings=1, segs=7, noise=0.4,
                      z0=lvl - 0.008)


# ------------------------------------------------------------------ the wheel
def wheel(stage="complete"):
    """undershot wheel: shaft, two sets of 8 compass arms, two felloe rims, 20 radial floats."""
    oak = B("oak")
    C = Vector((WX, WY, WZ))

    def P(x, r, a):
        return Vector((x, WY + r * math.cos(a), WZ + r * math.sin(a)))
    burnt = stage == "burnt"
    # shaft: octagonal oak with iron hoops, from inside the mill wall out to the pier
    x_in = XW1 - 0.45 if stage != "build1" else WX - 0.9
    cyl(oak, (x_in, WY, WZ), (EW1 - 0.05, WY, WZ), 0.21, n=8)
    for x in (XW1 + 0.08, WX - WHW - 0.18, WX + WHW + 0.18, CX1 + 0.02):
        cyl(B("iron"), (x - 0.035, WY, WZ), (x + 0.035, WY, WZ), 0.225, n=8)
    if stage == "shaft":
        return
    a0 = math.radians(9)
    nrim, narm, nfl = 16, 8, 20
    rim_r0, rim_r1 = 1.72, 1.99
    for side in (-1, 1):
        x = WX + side * WHW
        # hub: square clasp of four timbers round the shaft
        for k in range(4):
            a = a0 + k * math.pi / 2
            p0 = P(x, 0.27, a - math.pi / 4) ; p1 = P(x, 0.27, a + math.pi / 4)
            beam(oak, p0, p1, 0.16, 0.18, 0.01, side=(1, 0, 0))
        for k in range(narm):
            if burnt and R.random() < 0.4:
                continue
            a = a0 + k * 2 * math.pi / narm
            p1 = P(x, rim_r0 + 0.05, a)
            if burnt and R.random() < 0.4:
                p1 = P(x, R.uniform(0.7, 1.3), a)
            beam(oak, P(x, 0.2, a), p1, 0.14, 0.12, 0.012, side=(1, 0, 0))
        if stage == "arms" and side > 0:
            continue
        # felloes: segment ring with slight joints
        for k in range(nrim):
            if burnt and (side > 0 and 3 <= k <= 9 or R.random() < 0.15):
                continue
            aa = a0 + k * 2 * math.pi / nrim + 0.006
            ab = a0 + (k + 1) * 2 * math.pi / nrim - 0.006
            rm = (rim_r0 + rim_r1) / 2
            beam(oak, P(x, rm, aa), P(x, rm, ab), rim_r1 - rim_r0, 0.11, 0.01, side=(1, 0, 0), ext=0.04)
    if stage == "arms":
        return
    # floats: boards spanning between the rims, radial, fixed to short starts
    for k in range(nfl):
        a = a0 + (k + 0.5) * 2 * math.pi / nfl
        if burnt and (R.random() < 0.55 or 0.8 < (a % (2 * math.pi)) < 2.2):
            continue
        w = 2 * WHW + 0.12 if not burnt else 2 * WHW * R.uniform(0.4, 1.0)
        p0, p1 = P(WX, rim_r0 - 0.05, a), P(WX, WR + jit(0.02), a)
        beam(B("plank"), p0, p1, 0.05, w, 0.006, side=(1, 0, 0), twist=jit(0.03))
        for side in (-1, 1):   # starts
            x = WX + side * (WHW - 0.08)
            beam(oak, P(x, rim_r0 - 0.06, a + 0.035), P(x, WR - 0.18, a + 0.035), 0.07, 0.07, 0.006, side=(1, 0, 0))
    if burnt:
        # a chunk of the rim and floats fallen into the channel
        for k in range(4):
            beam(oak, (WX - 0.5 + k * 0.28, WY - 1.6 + jit(0.3), 0.3 + jit(0.08)),
                 (WX - 0.2 + k * 0.2, WY - 0.2 + jit(0.3), 0.55 + jit(0.15)), 0.12, 0.2, 0.01)


# ------------------------------------------------------------------ props
def millstone_lean(base, facing, tilt=0.26, r=0.64, th=0.27):
    """millstone standing on edge, leant back against the wall. base = ground contact point."""
    base, fa = Vector(base), Vector(facing).normalized()
    up = Vector((0, 0, 1))
    ax = (fa * math.cos(tilt) + up * math.sin(tilt)).normalized()   # disc normal, leaning back
    cen = base + (up * math.cos(tilt) - fa * math.sin(tilt)) * r
    annulus(B("millstone"), cen, ax, r, 0.13, th, n=22, jr=0.01)
    # iron band round the rim of the newer stone
    return cen


def millstone_flat(c, r=0.64, th=0.27, z=0.0, tilt=(0.0, 0.0)):
    ax = Vector((tilt[0], tilt[1], 1)).normalized()
    annulus(B("millstone"), Vector((c[0], c[1], z + th / 2)), ax, r, 0.13, th, n=22, jr=0.01)


def barrow(p, rot=0.0, load=None):
    p = Vector(p)
    ca, sa = math.cos(rot), math.sin(rot)

    def T(x, y, z):
        return p + Vector((x * ca - y * sa, x * sa + y * ca, z))
    oak = B("oak")
    for sx in (-0.27, 0.27):
        beam(oak, T(sx, -0.7, 0.62), T(sx * 0.7, 0.75, 0.28), 0.06, 0.06, 0.006)
        beam(oak, T(sx * 0.9, 0.0, 0.45), T(sx * 0.9, 0.02, 0.0), 0.05, 0.05, 0.004)
    for i in range(5):
        yy = -0.15 + i * 0.16
        beam(B("plank"), T(-0.3, yy, 0.43 - i * 0.03), T(0.3, yy, 0.43 - i * 0.03), 0.15, 0.03, 0.003, side=(0, 0, 1))
    wc = T(0, 0.8, 0.22)
    disc(B("plank"), wc, (ca, sa, 0), 0.22, n=12, th=0.05)
    cyl(B("iron"), wc - Vector((ca, sa, 0)) * 0.03, wc + Vector((ca, sa, 0)) * 0.03, 0.225, n=12)
    if load:
        sack(T(0.0, 0.15, 0.44), 0.44, 0.38, 0.5, rot=rot + 0.2)


def sack_pile(cx, cy, n=6, rot=0.0):
    k = 0
    ca, sa = math.cos(rot), math.sin(rot)
    for row, cnt in enumerate((3, 2, 1)[: max(1, (n + 2) // 3)]):
        for i in range(cnt):
            if k >= n:
                return
            x = (i - (cnt - 1) / 2) * 0.46 + jit(0.03)
            y = jit(0.05)
            q = (cx + x * ca - y * sa, cy + x * sa + y * ca, row * 0.3)
            sack(q, 0.44, 0.62, 0.32, rot=rot + math.pi / 2 + jit(0.25), tie=False)
            k += 1


def yard(stage):
    ground_pad(-0.3, -0.1, 4.55, 4.85, "yard", h=0.03)
    if stage in ("complete", "ruin"):
        # worn cobbled apron in front of the door
        for i in range(70):
            x = DOORX + R.gauss(0, 0.9)
            y = YF - 0.25 - abs(R.gauss(0, 0.8))
            s = R.uniform(0.12, 0.2)
            if y < -4.85:
                continue
            box(B("grit"), (x - s, y - s * 0.8, 0.0), (x + s, y + s * 0.8, 0.045 + jit(0.01)), 0.02,
                rot=(0, 0, R.uniform(0, 3)))


# ------------------------------------------------------------------ states
def complete():
    SOLIDS.append(((XW0 + 0.1, YF + 0.1, 0.0), (XW1 - 0.1, YB - 0.1, PLATE)))
    yard("complete")
    walls()
    roof()
    lucam()
    leat()
    water()
    wheel()
    # floor beam-ends of the upper floor showing through the east wall above the shaft? no: joist ends at the front
    # props
    millstone_lean((-3.55, YF - 0.42, 0), (0, -1, 0), tilt=0.24)
    millstone_lean((-2.95, YF - 0.55, 0), (0.25, -1, 0), tilt=0.3, r=0.6)
    sack_pile(-0.35, YF - 0.55, 6, rot=0.05)
    barrow((0.35, -4.35, 0), rot=-0.5, load=True)
    sack((-0.95, YF - 0.45, 0), 0.42, 0.38, 0.62, rot=0.4)
    mound(B("flour"), -0.9, YF - 0.95, 0.35, 0.22, 0.03, rings=2, segs=10, noise=0.3)
    mound(B("grain"), 0.3, YF - 1.05, 0.3, 0.25, 0.035, rings=2, segs=10, noise=0.3)
    barrel((-4.2, -3.7, 0), 0.3, 0.8)
    # a mounting-block / step by the door
    box(B("grit"), (DOORX - 0.72, YF - 0.42, 0), (DOORX + 0.72, YF + 0.02, 0.16), 0.02)


def build1():
    yard("build1")
    ground_pad(-1.2, -0.2, 3.9, 3.6, "soil", h=0.035)
    # footings and the first course of the walls
    for (a, b) in (((XW0, YF), (XW1, YF + TW)), ((XW0, YB - TW), (XW1, YB)), ((XW0, YF), (XW0 + TW, YB)),
                   ((XW1 - TW, YF), (XW1, YB))):
        box(B("rubble"), (a[0], a[1], 0), (b[0], b[1], R.uniform(0.42, 0.6)))
    # stones being set on the courses
    for i in range(12):
        x = R.uniform(XW0 + 0.3, XW1 - 0.3)
        y = R.choice((YF + 0.3, YB - 0.3))
        box(B("ashlar"), (x - 0.25, y - 0.18, 0.55), (x + 0.25, y + 0.18, 0.78), 0.02, rot=(0, 0, jit(0.2)))
    # the leat trench being dug and lined
    ground_pad((CX0 + CX1) / 2, 0.0, 1.3, 4.9, "mud", h=0.02)
    leat("build1")
    spoil_bank((EW1 + 0.5, -3.8), (EW1 + 0.5, 3.8), 0.45, 0.35)
    # setting-out pegs and lines
    pegs = [(XW0 - 0.5, YF - 0.5), (XW1 + 0.25, YF - 0.5), (XW1 + 0.25, YB + 0.4), (XW0 - 0.5, YB + 0.4),
            (CX0, -4.6), (EW1 + 0.2, -4.6), (EW1 + 0.2, 4.8), (CX0, 4.8)]
    for (x, y) in pegs:
        cyl(B("plank"), (x, y, 0), (x + jit(0.03), y + jit(0.03), 0.75), 0.035, 0.02, n=5)
    for i in range(4):
        a, b = pegs[i], pegs[(i + 1) % 4]
        beam(B("rope"), (a[0], a[1], 0.62), (b[0], b[1], 0.62), 0.012, 0.012, 0.0)
    for (a, b) in ((pegs[4], pegs[7]), (pegs[5], pegs[6])):
        beam(B("rope"), (a[0], a[1], 0.62), (b[0], b[1], 0.62), 0.012, 0.012, 0.0)
    # materials on site
    stone_pile(-2.6, -4.1, 22, 1.1)
    stone_pile(-4.2, 0.3, 14, 0.8)
    plank_stack(-3.6, 3.7, 3.4, 0.9, 5, along_x=True)
    # the great oak for the wheel shaft, on trestles, half hewn to an octagon
    cyl(B("oak"), (-3.6, -0.1 + 0.2, 0.62), (0.9, 0.2, 0.62), 0.24, n=8)
    disc(B("endgrain"), (-3.61, 0.2, 0.62), (-1, 0, 0), 0.22, n=8)
    disc(B("endgrain"), (0.91, 0.2, 0.62), (1, 0, 0), 0.22, n=8)
    for x in (-2.8, 0.1):
        for s in (-1, 1):
            beam(B("oak"), (x + s * 0.3, 0.2 - 0.3, 0), (x, 0.2, 0.4), 0.07, 0.07, 0.005)
            beam(B("oak"), (x + s * 0.3, 0.2 + 0.3, 0), (x, 0.2, 0.4), 0.07, 0.07, 0.005)
        beam(B("oak"), (x - 0.35, 0.2, 0.4), (x + 0.35, 0.2, 0.4), 0.12, 0.12, 0.008)
    mound(B("fresh"), -1.5, -0.8, 0.9, 0.5, 0.05, rings=2, segs=12, noise=0.4)     # chips
    # the new millstones delivered, lying flat
    millstone_flat((-0.3, -4.05), z=0.0)
    millstone_flat((-0.35, -4.03), z=0.27, tilt=(0.03, 0.02))
    barrow((1.0, -4.1, 0), rot=-0.4)
    tool((EW1 + 0.2, 1.0, 0), (EW1 + 0.25, 1.1, 1.3), "shovel")
    tool((EW1 + 0.9, -1.0, 0), (EW1 + 0.6, -0.6, 1.2), "pick")


def build2():
    yard("build2")
    ground_pad(-1.2, -0.2, 3.9, 3.6, "soil", h=0.035)
    cap = 3.55
    walls(cap=cap, gables=False)
    # ragged top course: stones being bedded
    for i in range(16):
        x = R.uniform(XW0 + 0.3, XW1 - 0.3)
        y = R.choice((YF + 0.3, YB - 0.3))
        box(B("rubble"), (x - 0.3, y - 0.26, cap - 0.02), (x + 0.3, y + 0.26, cap + R.uniform(0.15, 0.4)), 0.02,
            rot=(0, 0, jit(0.1)))
    # upper-floor joists spanning the walls
    for x in grid(XW0 + TW + 0.2, XW1 - TW - 0.2, 0.6, 0.02):
        beam(B("oak"), (x, YF + 0.3, FLOOR1 + 0.1), (x, YB - 0.3, FLOOR1 + 0.1), 0.16, 0.2, 0.01)
    leat("build2")
    wheel("arms")
    # scaffold along the front and the west gable, ladders up
    scaffold_face((XW0 - 0.05, YF - 0.05, 0), (XW1 + 0.05, YF - 0.05, 0), (0, -1, 0), cap + 0.9, 0.95)
    scaffold_face((XW0 - 0.05, YB + 0.05, 0), (XW0 - 0.05, YF - 0.05, 0), (-1, 0, 0), cap + 0.9, 0.9)
    stone_pile(-3.0, -4.3, 16, 0.8)
    stone_pile(-4.25, 3.9, 12, 0.7)
    plank_stack(-2.6, 3.65, 3.2, 0.9, 3, along_x=True)
    tub((0.3, -4.35, 0), 0.34, 0.42, liquid="mud")      # mortar tub
    millstone_flat((-0.8, -4.3), z=0.0)
    for k in range(3):
        beam(B("fresh"), (-1.2 + k * 0.1, 4.4 + k * 0.22, 0.1), (1.0, 4.4 + k * 0.22, 0.1), 0.18, 0.18, 0.01)
    # a puddle in the dry channel bed
    mound(B("water"), 2.6, -1.0, 0.5, 1.4, 0.03, rings=2, segs=14, noise=0.3, power=4.0)


def ruin():
    yard("ruin")
    ground_pad(-1.4, 0.0, 3.6, 3.2, "ash", h=0.05, rot=0.2)
    tops = walls(ruin=True, gables=False)
    # west gable survives as a broken triangle, east wall a jagged stump
    pts = []
    for x in (XW0, XW0 + TW):
        pts += [(x, YF + TW, PLATE - 0.02), (x, YB - TW, PLATE - 0.02), (x, -0.9, 7.2), (x, 0.6, 7.6), (x, 2.0, 6.1)]
    prism_hull(B("rubble"), pts)
    for (x0, x1, t) in RUIN_SEGS["front"]:
        if t < PLATE - 0.1:
            crown_rubble(x0, YF, x1, YF + TW, t)
    for (x0, x1, t) in RUIN_SEGS["back"]:
        if t < PLATE - 0.1:
            crown_rubble(x0, YB - TW, x1, YB, t)
    crown_rubble(XW1 - TW, YF + TW, XW1, YB - TW, tops["east"])
    roof(stage="burnt")
    lucam(stage="burnt")
    leat("ruin")
    water("ruin")
    wheel("burnt")
    rubble_heap(-0.8, 0.3, 2.2, 1.9, 1.0, 44, "rubble")
    rubble_heap(-2.0, YB + 0.7, 1.6, 0.5, 0.45, 18, "rubble")
    rubble_heap(-0.6, YF - 0.7, 1.4, 0.45, 0.35, 14, "rubble")
    for i in range(26):
        x, y = R.uniform(-3.8, 1.0), R.uniform(-2.3, 2.4)
        s = R.uniform(0.22, 0.4)
        box(B("stoneslate"), (x - s, y - s * 0.6, 0.02), (x + s, y + s * 0.6, 0.06), 0.005,
            rot=(jit(0.3), jit(0.3), R.uniform(0, 3)))
    for i in range(10):
        x, y = R.uniform(-3.6, 0.8), R.uniform(-2.0, 2.2)
        a = R.uniform(0, math.pi)
        l = R.uniform(1.4, 3.4)
        beam(B("oak"), (x, y, 0.14), (x + math.cos(a) * l, y + math.sin(a) * l, R.uniform(0.1, 1.2)), 0.16, 0.18, 0.01)
    millstone_lean((-3.55, YF - 0.42, 0), (0, -1, 0), tilt=0.24)
    millstone_flat((-2.7, YF - 0.9), z=0.0, tilt=(0.1, -0.05))
    for i in range(4):
        sack((R.uniform(-1.2, 0.5), R.uniform(-4.3, -3.6), 0), 0.44, 0.4, 0.28, rot=R.uniform(0, 3), tie=False)


def crown_rubble(x0, y0, x1, y1, top):
    """broken wall-head: ragged runs of rubble at random heights."""
    lx, ly = x1 - x0, y1 - y0
    along = lx > ly
    Lh = max(lx, ly)
    u = 0.0
    while u < Lh - 0.1:
        w = min(R.uniform(0.25, 0.9), Lh - u)
        if R.random() > 0.35:
            hh = R.uniform(0.05, 0.8) * (1.0 if R.random() < 0.6 else 0.35)
            for k in range(1 + int(hh / 0.28)):
                zb = top - 0.03 + k * 0.28
                zt = min(top + hh, zb + 0.3)
                if zt - zb < 0.06:
                    break
                ww = w * R.uniform(0.55, 1.0)
                ua = u + R.uniform(0, w - ww)
                if along:
                    lo, hi = (x0 + ua, y0 + R.uniform(0.02, 0.12), zb), (x0 + ua + ww, y1 - R.uniform(0.02, 0.12), zt)
                else:
                    lo, hi = (x0 + R.uniform(0.02, 0.12), y0 + ua, zb), (x1 - R.uniform(0.02, 0.12), y0 + ua + ww, zt)
                box(B("rubble"), lo, hi, 0.03, rot=(jit(0.06), jit(0.06), jit(0.12)))
        u += w


build_materials(extra)
{"complete": complete, "build1": build1, "build2": build2, "ruin": ruin}[STATE]()
run("mill", tex=2048)
