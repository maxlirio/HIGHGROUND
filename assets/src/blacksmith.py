"""HIGHGROUND - smithy (blacksmith), footprint 10 x 8 m.

A northern-English rubble-stone smithy: stone-slate gable roof between coped stone gables,
an open-fronted smithy bay (bressumer on two oak posts with knee braces) with the forge
hearth, stone hood and a big external chimney stack on the back wall; a closed store room
with door and window at the east end. Anvil on a stump, stone quench trough, great
leather bellows with rocker pole, charcoal heap + baskets, iron bar stock on a rack against
the east gable, a grindstone and a cartwheel in for tyring. Soot everywhere near the fire.

    blender -b -P assets/src/blacksmith.py -- [complete|build1|build2|ruin]

Front faces -Y. 1 unit = 1 m.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _craft import *

seed(31)

# ------------------------------------------------------------------ layout
XW0, XW1 = -4.6, 4.6          # outer faces of the gable walls
YF, YB = -1.5, 3.5            # outer faces of front / back walls
TW = 0.55                     # wall thickness
PLATE = 2.9                   # wall-head height
XC = 1.0                      # cross wall (bay | store), x of its west face
RY = (YF + YB) / 2
PL0 = 3.02                    # roof plane height over the outer wall face
RZ = PL0 + (RY - YF)          # 45 deg pitch
PITCH = math.radians(45)
OVER = 0.36
CH = (-3.25, -1.2)           # chimney x span
HEARTH = (-2.95, -1.45)
TOPZ = 7.7                    # chimney top


def plane_z(y):
    return RZ - abs(y - RY)


def extra(M, ch):
    M["stoneslate"] = m_tiles("stoneslate", [(0.0, "#62574a"), (0.2, "#726652"), (0.45, "#83755e"),
                                              (0.7, "#917f66"), (0.85, "#9c8a70"), (1.0, "#6a5d4d")], cell=0.42,
                              curve=0.1, lichen=1.5, moss=1.1, charred=ch)
    M["sooty"] = m_stone("sooty", [(0.0, "#857b6a"), (0.3, "#9b8f79"), (0.6, "#a79a82"), (1.0, "#80776a")],
                         "#5f574c", rowh=0.3, bw=0.55, soot_top=PLATE + 0.6, charred=ch * 0.8)
    M["chimney"] = m_stone("chimney", [(0.0, "#8a806e"), (0.5, "#a3977f"), (1.0, "#948a78")], "#665e52",
                           rowh=0.28, bw=0.5, soot_top=TOPZ + 1.4, charred=ch * 0.5)
    M["coals"] = m_heap("coals", [(0.0, "#2f2b28"), (0.6, "#3b3531"), (0.9, "#5a3a2a"), (1.0, "#8a4a26")],
                        26.0, rough=0.8, sheen=0.2)
    M["charcoal"] = m_heap("charcoal", [(0.1, "#2e2b29"), (0.5, "#3a3633"), (0.9, "#4a4541")], 22.0, rough=0.75,
                           sheen=0.25)
    M["cinder"] = m_heap("cinder", [(0.1, "#3d3630"), (0.45, "#4f4539"), (0.8, "#5e5244"), (1.0, "#6a5d4b")],
                         12.0, pebble=0.25, grass=0.0)
    M["yard"] = m_heap("yard", [(0.1, "#4a3c2d"), (0.5, "#5b4a37"), (0.9, "#6a5840")], 9.0, pebble=0.3, grass=0.55)
    M["water"] = m_liquid("water", "#2e3533", "#3b4442", 0.08)
    M["grit"] = m_stone("grit", [(0.0, "#9c8d73"), (0.5, "#ae9f83"), (1.0, "#a08f73")], "#7a6d58", joints=False,
                        bump=0.5)
    M["wicker"] = m_wicker("wicker")


# ------------------------------------------------------------------ walls
def walls(cap=PLATE, ragged=False, gables=True, ruin=False):
    """rubble walls. cap limits height (build states); ruin knocks sections down."""
    def h(x=None):
        return cap
    wb = B("wall_main", "rubble")
    sooty = B("wall_bay", "sooty")
    # back wall: bay part (sooty inside) and store part
    box(sooty, (XW0, YB - TW, 0), (XC + 0.45, YB, cap if not ruin else 2.4))
    box(wb, (XC + 0.45, YB - TW, 0), (XW1, YB, cap if not ruin else 1.7))
    # west gable wall (bay) and east gable (store)
    box(sooty, (XW0, YF, 0), (XW0 + TW, YB - TW, cap))
    box(wb, (XW1 - TW, YF, 0), (XW1, YB - TW, cap if not ruin else 2.2))
    # cross wall
    box(sooty, (XC, YF + TW, 0), (XC + 0.45, YB - TW, cap if not ruin else 2.6))
    # front wall of the store room, with a door and a window cut through
    fw = Batch("wall_front", "rubble")
    ftop = cap if not ruin else 2.0
    box(fw, (XC, YF, 0), (XW1 - TW, YF + TW, ftop))
    cut = Batch("fcut", "dark")
    ff = Face((XC, YF, 0), (0, -1, 0))
    if ftop > 2.1:
        ff.box(cut, 0.55, 1.6, -0.3, TW + 0.3, 0.0, 2.02)
    else:
        ff.box(cut, 0.55, 1.6, -0.3, TW + 0.3, 0.0, 3.0)
    if ftop > 1.9:
        ff.box(cut, 2.35, 2.95, -0.3, TW + 0.3, 1.05, 1.8)
    apply_boolean(fw.build(), cutter_obj(cut))
    if gables and not ruin:
        gable(XW0, XW0 + TW, B("sooty"))
        gable(XW1 - TW, XW1, B("rubble"))
    # quoins on the four outer corners
    zt = cap
    quoins((XW0, YF), (-1, 0, 0), (0, -1, 0), 0.3, min(zt, PLATE), course=0.36, la=0.5, lb=0.3)
    quoins((XW1, YF), (0, -1, 0), (1, 0, 0), 0.3, ftop if ruin else min(zt, PLATE), course=0.36, la=0.5, lb=0.3)
    quoins((XW1, YB), (1, 0, 0), (0, 1, 0), 0.3, (1.7 if ruin else min(zt, PLATE)), course=0.36, la=0.5, lb=0.3)
    quoins((XW0, YB), (0, 1, 0), (-1, 0, 0), 0.3, min(zt, PLATE), course=0.36, la=0.5, lb=0.3)
    # low plinth / footing course
    ol = [(XW0, YF), (XW1, YF), (XW1, YB), (XW0, YB)]
    for a, b, nrm in edges_of(ol):
        f = Face(a, nrm)
        Lh = (b - a).length
        u0 = -0.12
        u1 = Lh + 0.12
        if nrm.y < -0.5:        # front: only under the store wall (the bay is open)
            u0 = XC - XW0 - 0.05
        f.prism_dv(B("rubble"), [(-0.12, 0), (0.2, 0), (0.2, 0.34), (-0.02, 0.34), (-0.12, 0.2)], u0, u1)
    # bay: post pads + threshold kerb
    if ruin or cap >= PLATE - 0.01 or True:
        pass
    return ftop


def gable(xa, xb, bt):
    pts = []
    for x in (xa, xb):
        pts += [(x, YF, PLATE - 0.02), (x, YB, PLATE - 0.02), (x, YF, plane_z(YF) + 0.14),
                (x, YB, plane_z(YB) + 0.14), (x, RY, RZ + 0.14)]
    prism_hull(bt, pts)
    # coping stones along both rakes, kneelers and an apex stone
    xm = (xa + xb) / 2
    for y0 in (YF - 0.12, YB + 0.12):
        y = y0
        n = 7
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            ya, yb = y0 + (RY - y0) * t0, y0 + (RY - y0) * t1
            beam(B("ashlar"), (xm, ya, plane_z(ya) + 0.2), (xm, yb, plane_z(yb) + 0.2), 0.7, 0.14, 0.02,
                 side=(0, -1 if y0 < RY else 1, 1))
        box(B("ashlar"), (xa - 0.08, y0 - (0.05 if y0 < RY else -0.05) - 0.25, PLATE - 0.1),
            (xb + 0.08, y0 + 0.25 - (0.05 if y0 < RY else -0.05), PLATE + 0.32), 0.02)
    box(B("ashlar"), (xa - 0.05, RY - 0.22, RZ + 0.15), (xb + 0.05, RY + 0.22, RZ + 0.55), 0.03)


# ------------------------------------------------------------------ roof
def roof(stage="complete"):
    x0, x1 = XW0 + TW - 0.02, XW1 - TW + 0.02
    eave = (YF - OVER, plane_z(YF - OVER))
    ridge = (RY, RZ)
    I = Matrix.Identity(4)
    mir = Matrix.Translation((0, 2 * RY, 0)) @ Matrix.Scale(-1, 4, (0, 1, 0))
    oak = B("oak")
    # wall plates + bay bressumer
    beam(oak, (XW0 + 0.2, YF + 0.22, PLATE + 0.08), (XW1 - 0.2, YF + 0.22, PLATE + 0.08), 0.26, 0.16, 0.015,
         side=(0, 0, 1))
    beam(oak, (XW0 + 0.2, YB - 0.22, PLATE + 0.08), (XW1 - 0.2, YB - 0.22, PLATE + 0.08), 0.26, 0.16, 0.015,
         side=(0, 0, 1))
    # rafters (seen from inside the bay and in the ruin/build states)
    keep = 1.0 if stage != "burnt" else 0.5
    for x in grid(XW0 + TW + 0.15, XW1 - TW - 0.15, 0.55, 0.02):
        for sgn in (-1, 1):
            if R.random() > keep:
                continue
            ye = RY + sgn * (RY - YF + OVER)
            p0 = Vector((x, ye, plane_z(ye) - 0.08))
            p1 = Vector((x, RY - sgn * 0.05, RZ - 0.08))
            if stage == "burnt":
                p1 = p0.lerp(p1, R.uniform(0.3, 0.95))
            beam(oak, p0, p1, 0.1, 0.13, 0.008, side=(1, 0, 0))
    if stage == "frame":
        # ridge piece + purlins on the rafters, no slates yet
        beam(oak, (x0, RY, RZ - 0.1), (x1, RY, RZ - 0.1), 0.14, 0.2, 0.01)
        for sgn in (-1, 1):
            for t in (0.35, 0.7):
                y = RY + sgn * (RY - YF) * t
                beam(B("plank"), (x0, y, plane_z(y) + 0.02), (x1, y, plane_z(y) + 0.02), 0.08, 0.03, 0.0)
        return
    if stage == "burnt":
        roof_rows(B("stoneslate"), mir, x0, -1.0, eave, ridge, row_w=0.36, lap=0.7, thick=0.045, sag=0.15, seg=5,
                  stop=lambda t: t < 0.6)
        return
    for M in (I, mir):
        roof_rows(B("stoneslate"), M, x0, x1, eave, ridge, row_w=0.52, row_w_ridge=0.27, lap=0.66, thick=0.055,
                  lift=0.035, sag=0.09, seg=8, wob=0.02, jitx=0.06)
    saddle_ridge(B("grit"), I, x0 - 0.02, x1 + 0.02, RY, RZ + 0.06, PITCH, w=0.24, piece=0.62)


# ------------------------------------------------------------------ bay front + forge
def bay_front(stage="complete"):
    oak = B("oak")
    posts = (-2.9, -0.75)
    yb = YF + 0.2
    for i, x in enumerate(posts):
        box(B("ashlar"), (x - 0.24, yb - 0.24, 0), (x + 0.24, yb + 0.24, 0.24), 0.02, rot=(0, 0, jit(0.05)))
        top = PLATE - 0.28
        if stage == "burnt":
            top = R.uniform(0.9, 1.8) if i == 0 else PLATE - 0.28
        beam(oak, (x, yb, 0.24), (x + jit(0.02), yb, top), 0.24, 0.24, 0.018)
        if stage != "burnt" or i == 1:
            for s in (-1, 1):
                beam(oak, (x, yb, 1.95), (x + s * 0.72, yb, PLATE - 0.2), 0.13, 0.15, 0.01, side=(0, 1, 0), ext=0.03)
    if stage != "burnt":
        beam(oak, (XW0 + 0.1, yb, PLATE - 0.16), (XC + 0.2, yb, PLATE - 0.16), 0.28, 0.3, 0.02, side=(0, 1, 0))
    else:
        beam(oak, (-2.0, yb, PLATE - 0.16), (XC + 0.2, yb, PLATE - 0.16), 0.28, 0.3, 0.02, side=(0, 1, 0))
        beam(oak, (XW0 + 0.3, yb - 0.4, 0.15), (-2.3, yb + 0.3, 1.2), 0.26, 0.28, 0.02)


def forge(stage="complete"):
    ha, hb = HEARTH
    # hearth: raised stone block with an ash bed and glowing coals
    box(B("sooty"), (ha, YB - TW - 1.15, 0), (hb, YB - TW + 0.02, 0.78), 0.03)
    box(B("ashlar"), (ha - 0.04, YB - TW - 1.2, 0.72), (hb + 0.04, YB - TW - 1.08, 0.84), 0.015)
    mound(B("coals"), (ha + hb) / 2, YB - TW - 0.55, 0.5, 0.36, 0.12, rings=3, segs=12, noise=0.2, z0=0.78)
    # chimney breast + hood inside the bay
    box(B("sooty"), (CH[0], YB - TW - 0.45, 1.75), (CH[1], YB - TW + 0.02, PLATE + 0.3), 0.02)
    pts = []
    for x in (CH[0] - 0.08, CH[1] + 0.08):
        pts += [(x, YB - TW - 1.25, 1.62), (x, YB - TW - 1.25, 1.82), (x, YB - TW - 0.4, PLATE + 0.25),
                (x, YB - TW, 1.62), (x, YB - TW, PLATE + 0.25)]
    prism_hull(B("chimney"), pts)
    box(B("ashlar"), (CH[0] - 0.12, YB - TW - 1.32, 1.52), (CH[1] + 0.12, YB - TW - 1.16, 1.66), 0.015)
    # fireback: dark soot recess under the hood
    box(B("dark"), (ha + 0.12, YB - TW - 0.03, 0.8), (hb - 0.12, YB - TW + 0.01, 1.6))
    # tuyere + bellows (west of the hearth)
    cyl(B("iron"), (ha - 0.05, YB - TW - 0.55, 0.62), (ha - 0.6, YB - TW - 0.55, 0.66), 0.045, 0.06, n=6)
    bx0, by = ha - 0.55, YB - TW - 0.55
    board = [(0.0, 0.0), (0.25, -0.22), (0.95, -0.36), (1.25, -0.2), (1.28, 0.0), (1.25, 0.2), (0.95, 0.36),
             (0.25, 0.22)]
    for (zz, th) in ((0.55, 0.05), (0.92, 0.05)):
        pts = [(bx0 - u, by + v, z) for (u, v) in board for z in (zz, zz + th)]
        prism_hull(B("plank"), pts)
    lp = []
    for i, (u, v) in enumerate(board):
        k = 0.92 if i in (0,) else 0.97
        for z in (0.6, 0.76 + (0.05 if u > 0.5 else 0.0), 0.92):
            bul = 1.0 if z != 0.76 else 1.12
            lp.append((bx0 - u * k, by + v * k * bul, z))
    prism_hull(B("leather"), lp)
    # bellows stand + rocker pole with a chain down to the upper board
    for dy in (-0.32, 0.32):
        beam(B("oak"), (bx0 - 0.6, by + dy, 0), (bx0 - 0.6, by + dy, 0.55), 0.1, 0.1, 0.008)
    beam(B("oak"), (bx0 - 0.6, by - 0.4, 0.5), (bx0 - 0.6, by + 0.4, 0.5), 0.1, 0.1, 0.008)
    beam(B("oak"), (bx0 - 1.45, by + 0.62, 0), (bx0 - 1.45, by + 0.62, 2.05), 0.16, 0.16, 0.012)
    beam(B("pole"), (bx0 - 1.25, by + 0.62, 2.28), (bx0 - 1.75, by + 0.62, 1.82), 0.08, 0.08, 0.006)
    beam(B("pole"), (bx0 - 0.95, by + 0.1, 2.35), (bx0 - 1.95, by + 0.62, 1.75), 0.07, 0.07, 0.006)
    beam(B("iron"), (bx0 - 1.0, by + 0.12, 2.3), (bx0 - 1.0, by + 0.05, 0.97), 0.02, 0.02, 0.0)
    # tool rack on the cross wall: tongs + hammers hanging
    rx = XC - 0.03
    beam(B("oak"), (rx, 0.2, 1.62), (rx, 1.6, 1.62), 0.06, 0.08, 0.006, side=(1, 0, 0))
    for k in range(6):
        y = 0.3 + k * 0.24
        beam(B("iron"), (rx - 0.05, y, 1.6), (rx - 0.05, y + jit(0.03), 1.0 + R.uniform(0, 0.2)), 0.025, 0.02, 0.0)
        beam(B("iron"), (rx - 0.05, y + 0.04, 1.6), (rx - 0.05, y + 0.1, 1.05 + R.uniform(0, 0.2)), 0.02, 0.02, 0.0)


def anvil(p, rot=0.0):
    p = Vector(p)
    stump(p, 0.3, 0.52)
    z = 0.53
    M = TRS(p, (0, 0, rot))
    body = []
    for (hx, hy, zz) in ((0.2, 0.15, z), (0.13, 0.08, z + 0.1), (0.12, 0.075, z + 0.2), (0.24, 0.11, z + 0.25),
                         (0.24, 0.11, z + 0.34)):
        for sx in (-1, 1):
            for sy in (-1, 1):
                body.append(tuple(M @ Vector((sx * hx, sy * hy, zz))))
    prism_hull(B("iron"), body)
    horn = []
    for i in range(6):
        a = 2 * math.pi * i / 6
        horn.append(tuple(M @ Vector((0.24, math.cos(a) * 0.075, z + 0.28 + math.sin(a) * 0.055))))
    horn.append(tuple(M @ Vector((0.5, 0.0, z + 0.315))))
    prism_hull(B("iron"), horn)
    # hardy stub + a pair of tongs and a hammer lying on the face
    beam(B("iron"), M @ Vector((-0.1, 0.0, z + 0.345)), M @ Vector((0.15, 0.02, z + 0.35)), 0.03, 0.02, 0.0,
         side=(0, 0, 1))
    beam(B("pole"), M @ Vector((-0.05, -0.05, z + 0.36)), M @ Vector((-0.3, -0.28, z + 0.37)), 0.03, 0.03, 0.0)
    box(B("iron"), M @ Vector((-0.1, -0.02, z + 0.345)), M @ Vector((0.0, -0.1, z + 0.41)), 0.008)


def trough(x0, y0, x1, y1, h=0.52, wall=0.09, mat="grit"):
    box(B(mat), (x0, y0, 0), (x1, y1, 0.1), 0.02)
    box(B(mat), (x0, y0, 0), (x1, y0 + wall, h), 0.02)
    box(B(mat), (x0, y1 - wall, 0), (x1, y1, h), 0.02)
    box(B(mat), (x0, y0, 0), (x0 + wall, y1, h), 0.02)
    box(B(mat), (x1 - wall, y0, 0), (x1, y1, h), 0.02)
    box(B("water"), (x0 + wall - 0.01, y0 + wall - 0.01, 0.1), (x1 - wall + 0.01, y1 - wall + 0.01, h - 0.08))


def basket(p, r, h, fill="charcoal"):
    p = Vector(p)
    cyl(B("wicker"), p, p + Vector((0, 0, h)), r * 0.85, r, n=12)
    mound(B(fill), p.x, p.y, r * 0.95, r * 0.95, 0.1, rings=2, segs=10, noise=0.2, z0=h - 0.02)


def grindstone(p):
    p = Vector(p)
    for dx in (-0.35, 0.35):
        for dy in (-0.3, 0.3):
            beam(B("oak"), p + Vector((dx, dy, 0)), p + Vector((dx * 0.9, dy * 0.8, 0.62)), 0.08, 0.08, 0.006)
    for dy in (-0.26, 0.26):
        beam(B("oak"), p + Vector((-0.42, dy, 0.6)), p + Vector((0.42, dy, 0.6)), 0.09, 0.09, 0.006)
    cyl(B("grit"), p + Vector((-0.08, 0, 0.9)), p + Vector((0.08, 0, 0.9)), 0.44, n=18)
    cyl(B("iron"), p + Vector((-0.45, 0, 0.9)), p + Vector((0.45, 0, 0.9)), 0.025, n=6)
    beam(B("iron"), p + Vector((0.45, 0, 0.9)), p + Vector((0.45, -0.22, 0.75)), 0.03, 0.03, 0.0)
    beam(B("pole"), p + Vector((0.45, -0.22, 0.75)), p + Vector((0.6, -0.22, 0.75)), 0.04, 0.04, 0.0)
    # water trough under the stone
    box(B("plank"), (p.x - 0.25, p.y - 0.25, 0.3), (p.x + 0.25, p.y + 0.25, 0.5), 0.01)


def cartwheel(center, normal, r=0.62):
    c, n = Vector(center), Vector(normal).normalized()
    side = Vector((0, 0, 1)).cross(n).normalized() if abs(n.z) < 0.9 else Vector((1, 0, 0))
    up = n.cross(side).normalized()
    k = 10
    for i in range(k):
        a0, a1 = 2 * math.pi * i / k, 2 * math.pi * (i + 1) / k
        p0 = c + (side * math.cos(a0) + up * math.sin(a0)) * r
        p1 = c + (side * math.cos(a1) + up * math.sin(a1)) * r
        beam(B("plank"), p0, p1, 0.09, 0.07, 0.006, side=n, ext=0.02)
        am = (a0 + a1) / 2
        beam(B("oak"), c, c + (side * math.cos(am) + up * math.sin(am)) * (r - 0.03), 0.045, 0.035, 0.0, side=n)
    cyl(B("oak"), c - n * 0.14, c + n * 0.14, 0.1, 0.08, n=8)


def bar_rack(x, y0, y1):
    """iron bar stock leaning against a rail on the east gable."""
    for y in (y0, y1):
        beam(B("oak"), (x + 0.35, y, 0), (x + 0.35, y, 1.25), 0.1, 0.1, 0.008)
    beam(B("oak"), (x + 0.35, y0 - 0.05, 1.2), (x + 0.35, y1 + 0.05, 1.2), 0.08, 0.1, 0.008)
    y = y0 + 0.08
    while y < y1 - 0.05:
        w = R.choice((0.025, 0.03, 0.04))
        beam(B("iron"), (x + 0.12 + jit(0.03), y, 0.0), (x + 0.36, y + jit(0.03), 1.55 + jit(0.12)), w, w * 0.8, 0.0,
             side=(1, 0, 0))
        y += R.uniform(0.045, 0.09)
    # a few bars on the ground on bearers
    for k in range(5):
        beam(B("iron"), (x + 0.2 + k * 0.05, y1 + 0.25, 0.1), (x + 0.2 + k * 0.05 + jit(0.03), y1 + 1.6, 0.1),
             0.03, 0.03, 0.0)
    for yy in (y1 + 0.4, y1 + 1.4):
        beam(B("plank"), (x + 0.05, yy, 0.04), (x + 0.55, yy, 0.04), 0.08, 0.08, 0.0)


def door_and_window():
    ff = Face((XC, YF, 0), (0, -1, 0))
    door_leaf(ff, 1.075, 0.0, 1.05, 2.0, 0.34, arch=False)
    ff.box(B("oak"), 0.43, 1.72, -0.04, 0.3, 2.02, 2.24, 0.015)          # lintel
    ff.box(B("dark"), 2.33, 2.97, 0.46, 0.5, 1.03, 1.82)
    ff.box(B("oak"), 2.25, 3.05, -0.06, 0.2, 1.8, 1.96, 0.012)
    ff.box(B("ashlar"), 2.25, 3.05, -0.08, 0.3, 0.93, 1.05, 0.012)
    for u in (2.55, 2.75):
        beam(B("oak"), ff.p(u, 0.22, 1.05), ff.p(u, 0.22, 1.8), 0.05, 0.05, 0.006, side=ff.inw, twist=0.78)
    # a shutter hanging open
    beam(B("plank"), ff.p(2.3, -0.06, 1.42), ff.p(1.7, -0.3, 1.42), 0.72, 0.035, 0.006,
         side=Vector((0, 0, 1)).cross((ff.p(1.7, -0.3, 0) - ff.p(2.3, -0.06, 0)).normalized()))
    # east gable window (small, shuttered)
    fe = Face((XW1, YF, 0), (1, 0, 0))
    fe.box(B("dark"), 2.1, 2.7, -0.01, 0.02, 1.2, 1.85)
    fe.box(B("oak"), 2.0, 2.8, -0.06, 0.02, 1.85, 1.98, 0.01)
    fe.box(B("ashlar"), 2.0, 2.8, -0.08, 0.05, 1.08, 1.2, 0.01)
    fe.box(B("plank"), 2.08, 2.72, -0.05, -0.015, 1.22, 1.83, 0.006)


def chimney(top=TOPZ, stage="complete"):
    c = B("chimney")
    x0, x1 = CH
    # external breast on the back wall, rising into the stack
    box(c, (x0, YB - 0.02, 0), (x1, YB + 0.38, 3.2), 0.03)
    prism_hull(c, [(x, y, z) for x in (x0, x1) for (y, z) in ((YB - 0.02, 3.2), (YB + 0.38, 3.2),
                                                               (YB - 0.02, 3.7), (YB + 0.2, 3.7))])
    zmid = 5.1
    box(c, (x0 + 0.02, YB - 1.25, min(top, 3.2)), (x1 - 0.02, YB + 0.2, min(top, zmid)), 0.03)
    if top > zmid:
        box(B("ashlar"), (x0 - 0.04, YB - 1.29, zmid - 0.08), (x1 + 0.04, YB + 0.24, zmid + 0.06), 0.02)
        box(c, (x0 + 0.12, YB - 1.15, zmid), (x1 - 0.12, YB + 0.1, top), 0.03)
    if stage == "complete":
        box(B("ashlar"), (x0 + 0.02, YB - 1.27, top), (x1 - 0.02, YB + 0.22, top + 0.16), 0.02)
        box(B("dark"), (x0 + 0.3, YB - 0.95, top + 0.15), (x1 - 0.3, YB - 0.1, top + 0.17))
        # two short flues with dressed caps, soot-blackened mouths
        for (fa, fb, ht) in ((x0 + 0.22, x0 + 0.75, 0.55), (x1 - 0.75, x1 - 0.22, 0.45)):
            box(B("grit"), (fa, YB - 1.02, top + 0.16), (fb, YB - 0.03, top + ht), 0.02)
            box(B("ashlar"), (fa - 0.05, YB - 1.07, top + ht), (fb + 0.05, YB + 0.02, top + ht + 0.08), 0.015)
            box(B("dark"), (fa + 0.1, YB - 0.9, top + ht + 0.075), (fb - 0.1, YB - 0.15, top + ht + 0.09))


def charcoal_heap(cx, cy):
    mound(B("charcoal"), cx, cy, 0.85, 0.65, 0.55, rings=6, segs=20, noise=0.18, power=1.2, lumpy=0.04)
    for i in range(14):
        a = R.uniform(0, 6.28)
        rr = R.uniform(0.9, 1.2)
        x, y = cx + math.cos(a) * rr * 0.85, cy + math.sin(a) * rr * 0.65
        s = R.uniform(0.05, 0.1)
        box(B("charcoal"), (x - s, y - s * 0.6, 0), (x + s, y + s * 0.6, s * 0.9), 0.0, rot=(jit(0.4), jit(0.4), R.uniform(0, 3)))


# ------------------------------------------------------------------ states
def complete():
    ground_pad(-0.4, 0.2, 5.3, 4.1, "yard", h=0.03)
    ground_pad(-1.9, -0.4, 3.0, 2.3, "cinder", h=0.045, rot=0.1)
    walls()
    roof()
    bay_front()
    forge()
    chimney()
    door_and_window()
    anvil((-1.55, -1.95, 0.0), rot=0.3)
    trough(-3.0, -2.45, -2.05, -2.02)
    barrel((-0.35, 1.7, 0), 0.3, 0.8)
    basket((-0.55, 0.9, 0.0), 0.26, 0.42)
    charcoal_heap(-3.95, -3.05)
    basket((-2.75, -3.35, 0), 0.28, 0.45)
    basket((-3.2, -1.2, 0), 0.25, 0.4)
    bar_rack(XW1, 0.1, 1.6)
    grindstone(Vector((2.7, -2.75, 0)))
    cartwheel((3.95, -1.75, 0.63), (0.15, -1.0, 0.25))
    # scrap / blooms waiting by the door
    stone_like_blooms((1.35, -2.1))
    # firewood kindling stack against the west gable
    log_pile(XW0 - 0.5, 0.2, XW0 - 0.05, rows=2, r=0.08, length=1.8) if False else None
    for k in range(3):
        log((XW0 - 0.2 - k * 0.15, 0.3 + jit(0.05), 0.09 + (k % 2) * 0.0), (XW0 - 0.2 - k * 0.15, 2.0, 0.09), 0.085)
    for k in range(2):
        log((XW0 - 0.27 - k * 0.15, 0.35, 0.24), (XW0 - 0.27 - k * 0.15, 1.95, 0.24), 0.08)


def stone_like_blooms(p):
    x, y = p
    for i in range(5):
        s = R.uniform(0.12, 0.2)
        xx, yy = x + jit(0.3), y + jit(0.2)
        box(B("iron"), (xx - s, yy - s * 0.8, 0), (xx + s, yy + s * 0.8, s * 1.1), 0.03, rot=(jit(0.3), jit(0.3), R.uniform(0, 3)))


def build1():
    ground_pad(-0.4, 0.2, 5.4, 4.2, "yard", h=0.03)
    # footing trenches + the first courses
    for (a, b) in (((XW0, YF), (XW1, YF + TW)), ((XW0, YB - TW), (XW1, YB)), ((XW0, YF), (XW0 + TW, YB)),
                   ((XW1 - TW, YF), (XW1, YB)), ((XC, YF), (XC + 0.45, YB))):
        box(B("rubble"), (a[0], a[1], 0), (b[0], b[1], R.uniform(0.45, 0.62)))
    spoil_bank((XW0 + 0.3, YB + 0.55), (XW1 - 0.3, YB + 0.55), 0.55, 0.3)
    spoil_bank((XW1 + 0.5, YF + 0.5), (XW1 + 0.5, YB - 0.3), 0.3, 0.25)
    spoil_bank((XW0 - 0.3, YF + 0.8), (XW0 - 0.3, YB - 0.4), 0.3, 0.25)
    # hearth base + chimney footing already rising
    box(B("rubble"), (CH[0], YB - TW - 1.15, 0), (CH[1], YB + 0.38, 0.95))
    # stones being set on the wall heads
    for i in range(10):
        x = R.uniform(XW0 + 0.3, XW1 - 0.3)
        y = R.choice((YF + 0.27, YB - 0.27))
        box(B("ashlar"), (x - 0.25, y - 0.18, 0.55), (x + 0.25, y + 0.18, 0.78), 0.02, rot=(0, 0, jit(0.2)))
    # setting-out stakes and lines for the bay posts / walls
    for (x, y) in ((XW0 - 0.5, YF - 0.5), (XW1 + 0.4, YF - 0.5), (XW1 + 0.4, YB + 0.3), (XW0 - 0.5, YB + 0.3),
                   (-2.9, YF - 0.6), (-0.75, YF - 0.6)):
        cyl(B("plank"), (x, y, 0), (x + jit(0.03), y + jit(0.03), 0.7), 0.035, 0.02, n=5)
    for (a, b) in (((XW0 - 0.5, YF - 0.5), (XW1 + 0.4, YF - 0.5)), ((XW1 + 0.4, YF - 0.5), (XW1 + 0.4, YB + 0.3))):
        beam(B("rope"), (a[0], a[1], 0.6), (b[0], b[1], 0.6), 0.012, 0.012, 0.0)
    for (x, y) in ((-2.9, YF + 0.2), (-0.75, YF + 0.2)):
        box(B("ashlar"), (x - 0.24, y - 0.24, 0), (x + 0.24, y + 0.24, 0.24), 0.02)
    stone_pile(-2.6, -3.0, 22, 1.1)
    stone_pile(2.9, -2.8, 16, 0.9)
    timber_stack(1.2, 4.2, 3.2, 2) if False else None
    for k in range(3):
        beam(B("oak"), (-1.2 + k * 0.3, -3.6, 0.12), (2.4 + k * 0.3, -3.6 + jit(0.05), 0.12), 0.24, 0.24, 0.012)
    barrel((0.8, -3.1, 0), 0.38, 0.38)
    mound(B("soil"), 3.6, 1.2, 1.1, 0.9, 0.45, noise=0.2)


def build2():
    ground_pad(-0.4, 0.2, 5.4, 4.2, "yard", h=0.03)
    ground_pad(-1.9, -0.4, 2.6, 2.0, "cinder", h=0.04)
    walls(cap=PLATE, gables=False)
    # gables half-raised: ragged steps
    for (xa, xb) in ((XW0, XW0 + TW), (XW1 - TW, XW1)):
        for i in range(6):
            y0 = YF + i * (YB - YF) / 6
            hh = R.uniform(0.1, 0.9) * (1 - abs(i - 2.5) / 3.5)
            box(B("rubble"), (xa, y0, PLATE - 0.02), (xb, y0 + (YB - YF) / 6 - 0.02, PLATE + hh), 0.02)
    roof(stage="frame")
    bay_front()
    forge()
    chimney(top=4.4, stage="build")
    scaffold_face((XW1 + 0.05, YB + 0.05, 0), (XW1 + 0.05, YF - 0.05, 0), (1, 0, 0), 3.9, 0.55)
    scaffold_face((CH[0] - 0.4, YB + 0.4, 0), (CH[1] + 0.4, YB + 0.4, 0), (0, 1, 0), 4.2, 0.5)
    stone_pile(-3.0, -3.0, 20, 1.0)
    stone_pile(2.6, -3.1, 14, 0.8)
    barrel((0.5, -3.3, 0), 0.38, 0.38)
    anvil((-1.55, -1.95, 0.0), rot=0.3)
    for k in range(4):
        beam(B("fresh"), (-1.3 + k * 0.1, -3.7 + k * 0.28, 0.12 + (k // 3) * 0.24), (2.0, -3.7 + k * 0.28, 0.12), 0.2, 0.2, 0.01)


def ruin():
    ground_pad(-0.4, 0.2, 5.4, 4.2, "yard", h=0.03)
    ground_pad(-1.0, 0.8, 4.2, 3.0, "ash", h=0.05, rot=0.3)
    walls(ruin=True, gables=False)
    # west gable survives as a broken stump of a triangle
    pts = []
    for x in (XW0, XW0 + TW):
        pts += [(x, YF, PLATE - 0.02), (x, YB, PLATE - 0.02), (x, 0.1, 4.3), (x, 1.6, 4.6), (x, 2.9, 3.4)]
    prism_hull(B("sooty"), pts)
    crown_rubble(XC + 0.45, YB - TW, XW1, YB, 1.7)
    crown_rubble(XW1 - TW, YF, XW1, YB - TW, 2.2)
    crown_rubble(XC, YF, XW1 - TW, YF + TW, 2.0)
    roof(stage="burnt")
    bay_front(stage="burnt")
    forge()
    chimney(top=6.6, stage="ruin")
    anvil((-1.55, -1.95, 0.0), rot=0.3)
    trough(-3.0, -2.45, -2.05, -2.02)
    rubble_heap(2.7, 1.0, 1.4, 1.6, 0.8, 30, "rubble")
    rubble_heap(4.9, 0.5, 0.6, 1.8, 0.5, 14, "rubble")
    rubble_heap(2.4, -2.2, 1.1, 0.7, 0.4, 16, "rubble")
    for i in range(20):
        x, y = R.uniform(-3.8, 3.8), R.uniform(-1.0, 3.0)
        s = R.uniform(0.25, 0.42)
        box(B("stoneslate"), (x - s, y - s * 0.6, 0.02), (x + s, y + s * 0.6, 0.06), 0.005,
            rot=(jit(0.25), jit(0.25), R.uniform(0, 3)))
    for i in range(9):
        x, y = R.uniform(-3.5, 3.5), R.uniform(-1.0, 3.0)
        a = R.uniform(0, math.pi)
        l = R.uniform(1.4, 3.2)
        beam(B("oak"), (x, y, 0.12), (x + math.cos(a) * l, y + math.sin(a) * l, R.uniform(0.1, 1.0)), 0.14, 0.16, 0.01)
    charcoal_heap(-3.55, -2.85)
    cartwheel((3.9, -2.7, 0.07), (0.2, 0.1, 1.0), 0.6)


def crown_rubble(x0, y0, x1, y1, top):
    """broken wall-head: ragged runs of rubble at random heights, some blocks dislodged."""
    lx, ly = x1 - x0, y1 - y0
    along = lx > ly
    Lh = max(lx, ly)
    u = 0.0
    while u < Lh - 0.1:
        w = R.uniform(0.25, 0.9)
        w = min(w, Lh - u)
        if R.random() > 0.35:
            hh = R.uniform(0.05, 0.75) * (1.0 if R.random() < 0.6 else 0.35)
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
run("blacksmith", tex=2048)
