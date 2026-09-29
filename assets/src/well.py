"""HIGHGROUND - village well (prop).

Round drystone-and-lime well-head of individual coursed stones with a coping ring, two oak
posts carrying a windlass with a crank, rope and a coopered bucket, a small clay-tiled hood,
a spare bucket and flagstones sunk in puddled, trodden mud.

    blender -b -P assets/src/well.py            (complete only)

Front faces -Y (the crank side). 1 unit = 1 m.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _parish_kit as K
from _parish_kit import B, box, beam, cyl, prism_hull, jit, R, TRS

K.begin(seed=31)
M = K.MAT
M["stone"] = K.m_stone("wstone", [(0.0, "#8a806e"), (0.25, "#a59a83"), (0.5, "#b8ac92"), (0.75, "#9c917c"), (1.0, "#80796b")],
                       "#6f675b", joints=False, bump=1.7, moss=0.45)
M["flag"] = K.m_stone("flag", [(0.0, "#6c665b"), (0.5, "#7d766a"), (1.0, "#8a8274")], "#5a544a", joints=False,
                      bump=1.5, moss=0.6)
M["oak"] = K.m_wood("oak", [(0.0, "#4e3b27"), (0.5, "#5f4830"), (1.0, "#6b5236")], weather_hex="#7d7466",
                    weathered=0.6)
M["plank"] = K.m_wood("plank", [(0.0, "#6f5f4b"), (0.5, "#80705a"), (1.0, "#8f8069")], weather_hex="#8f887c",
                      weathered=0.45, grain_k=1.3)
M["tile"] = K.m_tiles("tile", [(0.0, "#6e3f2b"), (0.2, "#8c5037"), (0.5, "#9a5a3c"), (0.8, "#a8694a"),
                               (1.0, "#7f4a36")], cell=0.2, lichen=1.3, moss=1.2)
M["iron"] = K.m_simple("iron", "#35332f", "#45403a", 0.72, rust=True)
M["rope"] = K.m_rope("rope")
M["mud"] = K.m_ground("mud", wet=0.7, grass=0.7, trod=(0.0, -0.3, 1.2, 2.1))
M["water"] = K.m_water("water")
M["dark"] = K.m_simple("dark", "#262320", "#332d27", 0.9)
M["mortar"] = K.m_simple("mortar", "#6e675c", "#8a8272", 0.95, 6.0)

RO, RI, HP = 0.86, 0.56, 0.78      # parapet outer/inner radius, height

# ------------------------------------------------------------------ ground
K.ground_patch(B("mud"), 0.1, -0.25, 2.3, 2.0, h=0.03, n=26, rings=3, bump=0.025, seed=2.0)
# flagstones on the draw side
for (x, y, s) in ((-0.55, -1.25, 0.55), (0.2, -1.35, 0.6), (0.9, -1.05, 0.45), (-1.2, -0.7, 0.4), (1.25, -0.35, 0.42)):
    top = 0.04 + jit(0.012)
    pts = []
    nk = R.choice((5, 6, 7))
    for k in range(nk):
        a = 2 * math.pi * k / nk + jit(0.45)
        rr = s * 0.5 * R.uniform(0.6, 1.05)
        px, py = x + math.cos(a) * rr, y + math.sin(a) * rr * 0.8
        pts += [(px, py, 0.0), (x + (px - x) * 0.93, y + (py - y) * 0.93, top + jit(0.008))]
    prism_hull(B("flag"), pts)

# ------------------------------------------------------------------ parapet: coursed ring
# 5 irregular courses of roughly-squared stones, lengths vary, joints broken course to course,
# each stone slightly proud/sunk and bulged so the ring reads as hand-laid.
courses = 5
z = 0.0
a0 = R.uniform(0, 1)
for c in range(courses):
    ch = (HP - 0.14) / courses * R.uniform(0.85, 1.15)
    if c == courses - 1:
        ch = HP - 0.14 - z
    t = 0.0
    a0 += R.uniform(0.18, 0.3)
    while t < 2 * math.pi - 0.05:
        L_ = R.uniform(0.38, 0.62) if R.random() < 0.75 else R.uniform(0.2, 0.3)
        da = min(L_ / RO, 2 * math.pi - t)
        if 2 * math.pi - (t + da) < 0.12:
            da = 2 * math.pi - t
        a, b = a0 + t + 0.012, a0 + t + da - 0.012
        ro = RO * (1 - 0.018 * c) + jit(0.018)
        hh = ch * R.uniform(0.86, 0.98)
        pts = []
        for tt in (a, (a + b) / 2, b):
            mid = tt != a and tt != b
            for r in ((ro + 0.02,) if mid else (RI + 0.06, ro)):
                for zz in (z + 0.012, z + hh):
                    pts.append((r * math.cos(tt), r * math.sin(tt), zz + jit(0.008)))
        prism_hull(B("stone"), pts)
        t += da
    z += ch
# mortar/core ring behind the stones so no gaps show through
cyl(B("mortar"), (0, 0, 0.0), (0, 0, HP - 0.1), RO - 0.05, n=14)
# coping stones: thick, irregular lengths, each rocked a little
ang = [0.0]
while ang[-1] < 2 * math.pi - 0.3:
    ang.append(ang[-1] + R.uniform(0.5, 0.85))
ang[-1] = 2 * math.pi
for i in range(len(ang) - 1):
    a = ang[i] + 0.3 + R.uniform(0.012, 0.03)
    b = ang[i + 1] + 0.3 - R.uniform(0.012, 0.03)
    dz = jit(0.018)
    ro = RO + 0.05 + jit(0.02)
    pts = []
    for t in (a, (a + b) / 2, b):
        for (r, zz) in ((RI - 0.05, HP - 0.15), (ro, HP - 0.15), (RI - 0.05, HP - 0.02 + dz),
                        (ro - 0.02, HP - 0.05 + dz), ((RI + RO) / 2, HP + 0.015 + dz)):
            pts.append((r * math.cos(t), r * math.sin(t), zz))
    prism_hull(B("stone"), pts)
# shaft: dark inner lining + water surface
cyl(B("dark"), (0, 0, 0.02), (0, 0, HP - 0.18), RI + 0.02, n=12)
cyl(B("water"), (0, 0, 0.1), (0, 0, 0.14), RI + 0.01, n=12)

# ------------------------------------------------------------------ posts, windlass, hood
PX = RO - 0.02
POST_TOP = 2.05
for sx in (-1, 1):
    x = sx * (PX + 0.06)
    beam(B("oak"), (x, 0.0, 0.0), (x + jit(0.01), jit(0.01), POST_TOP), 0.17, 0.17, 0.015)
    # raking strut down to the ground outside
    beam(B("oak"), (x + sx * 0.05, 0.0, 1.05), (x + sx * 0.62, 0.0, 0.0), 0.11, 0.11, 0.0, ext=0.04)
    # bearing block
    box(B("oak"), (x - 0.12, -0.12, 1.12), (x + 0.12, 0.12, 1.3), 0.0)
# tie beams / wall plates
for y in (-0.5, 0.5):
    beam(B("oak"), (-PX - 0.35, y, POST_TOP - 0.1), (PX + 0.35, y, POST_TOP - 0.1), 0.13, 0.13, 0.012)
beam(B("oak"), (-PX - 0.06, -0.7, POST_TOP - 0.14), (-PX - 0.06, 0.7, POST_TOP - 0.14), 0.15, 0.15, 0.012)
beam(B("oak"), (PX + 0.06, -0.7, POST_TOP - 0.14), (PX + 0.06, 0.7, POST_TOP - 0.14), 0.15, 0.15, 0.012)
# windlass drum (along x) + iron crank on the east
ZW = 1.21
cyl(B("oak"), (-PX + 0.02, 0, ZW), (PX - 0.02, 0, ZW), 0.1, n=10)
cyl(B("rope"), (-0.3, 0, ZW), (0.28, 0, ZW), 0.125, n=10)
cyl(B("iron"), (PX - 0.05, 0, ZW), (PX + 0.32, 0, ZW), 0.022, n=6)
beam(B("iron"), (PX + 0.3, 0, ZW), (PX + 0.3, -0.2, ZW - 0.26), 0.03, 0.03, 0.004)
cyl(B("oak"), (PX + 0.3, -0.2, ZW - 0.26), (PX + 0.48, -0.2, ZW - 0.26), 0.028, n=6)
# rope down to the hanging bucket
cyl(B("rope"), (0.05, -0.12, ZW - 0.02), (0.05, -0.1, 0.98), 0.012, n=5)


def bucket(p, r=0.17, h=0.3, tilt=0.0, handle_up=True):
    p = Vector(p)
    Mt = TRS(p, (tilt, 0, 0))
    a, b = Mt @ Vector((0, 0, 0)), Mt @ Vector((0, 0, h))
    cyl(B("plank"), a, b, r * 0.86, r, n=9)
    cyl(B("dark"), b - (b - a) * 0.08, b + (b - a) * 0.005, r * 0.9, n=9)
    for t in (0.2, 0.8):
        rr = r * 0.86 + (r - r * 0.86) * t + 0.01
        cyl(B("iron"), a.lerp(b, t - 0.05), a.lerp(b, t + 0.05), rr, n=7)
    if handle_up:
        pts = []
        for i in range(5):
            ang = math.pi * i / 4
            pts.append(Mt @ Vector((math.cos(ang) * r, 0, h + math.sin(ang) * r * 0.9)))
        for i in range(4):
            beam(B("iron"), pts[i], pts[i + 1], 0.018, 0.018, 0.0)


bucket((0.05, -0.1, 0.66))
bucket((-1.15, -1.2, 0.0), 0.18, 0.32)
bucket((1.35, -0.95, 0.075), 0.16, 0.28, tilt=1.45, handle_up=False)

# hood: small gable roof, ridge along x
PL = POST_TOP + 0.05
I = Matrix.Identity(4)
rz = K.gable_roof(B("tile"), I, -PX - 0.55, PX + 0.55, 0.0, 0.62, PL, math.radians(47), over=0.28, row_w=0.31,
                  thick=0.03, lift=0.025, sag=0.03, seg=4, ridge_bt=B("tile"), ridge_r=0.1)
# rafters / bargeboards visible at the gable ends
for x in (-PX - 0.5, PX + 0.5):
    for sg in (-1, 1):
        beam(B("plank"), (x, sg * 0.95, PL - 0.3), (x, 0.0, rz + 0.02), 0.2, 0.04, 0.0, side=(1, 0, 0))
    beam(B("oak"), (x * 0.96, 0, PL), (x * 0.96, 0, rz - 0.05), 0.1, 0.1, 0.01)
# collar/king post under the ridge
beam(B("oak"), (-PX - 0.1, 0, rz - 0.1), (PX + 0.1, 0, rz - 0.1), 0.12, 0.12, 0.01)

K.finalize("well", tex=1024, lods=(1.0, 0.4, 0.15))
