"""HIGHGROUND - holy spring at the mere's outfall (mana site; low fantasy, never glowing).

A stone-lined spring basin (~2.2 x 1.5 m of still, dark, clear water inside a kerb of worn
dressed blocks), fed from a small carved stone hood at its head (+Y): a gabled niche of three
slabs and a roof of two, a worn carved head-boss on the gable and a lip spout. A stone-lined
runnel leaves the basin toward the front (-Y) across a wet margin; flagstones where pilgrims
kneel. Beside it an old wind-bent hawthorn hung with rag offerings (clootie).

    blender -b -t 2 -P assets/src/holy_spring.py
Front faces -Y. 1 unit = 1 m.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _landkit import *

begin(81)
MAT["dressed"] = m_rock("dressed", [(0.0, "#8a8272"), (0.35, "#9a917f"), (0.65, "#a79d89"), (1.0, "#8d8573")],
                        speck=0.2, lichen_d=0.45, lichen_amt=0.8, moss=1.0, cracks=0.25, streaks=0.5, pits=0.4,
                        lichen_tones=("#9da386", "#c2bfae", "#b99a48"))
MAT["flag"] = MAT["dressed"]
mat_turf("turf", dry=0.2, wet=0.8)
MAT["wet"] = m_turf("wet", dry=0.05, wet=1.0, tones=[(0.15, "#34401f"), (0.5, "#48562a"), (0.8, "#5a6630"), (1.0, "#6a6c3a")])
MAT["water"] = m_pool("water", deep="#16191a", shallow="#2a302b", scum=("#5d6a36", "#7a8544"), scum_amt=0.0,
                      edge_r=(0.0, 0.25, 1.4))
MAT["rag"] = m_cloth2("rag", "#8e4b3c", "#c4b99c")
MAT["mud"] = m_loose("mud", [(0.0, "#3b3025"), (0.5, "#4a3c2d"), (1.0, "#5a4a36")], lump=10.0, grass=0.25, pebble=0.3)

st = B("stone", "dressed")
BX, BY = 0.0, 0.25          # basin centre
IW, ID = 2.1, 1.45          # inner size
KH = 0.46                   # kerb height


def block(x, y, z, sx, sy, sz, yaw=0.0, seed=0, bt=None, worn=0.04):
    # dressed but worn: a bevelled block, its top tilted a hair, corners knocked
    z0 = z - (0.0 if z > 0 else 0.05)
    box(bt or st, (x - sx / 2, y - sy / 2, z0), (x + sx / 2, y + sy / 2, z0 + sz), min(0.06, 0.25 * min(sx, sy, sz)) * (0.6 + worn * 5),
        rot=(jit(0.02), jit(0.02), yaw))


# ground: wet turf pad, muddy trodden front, the basin floor (water surface)
ground_patch(B("pad", "turf"), 0.3, -0.2, 4.2, 3.6, h=0.1, n=30, rings=5, bump=0.03, seed=1.0)
ground_patch(B("wetpad", "wet"), 0.0, -1.6, 1.4, 2.4, h=0.12, n=20, rings=4, bump=0.02, seed=2.0)
box(B("water"), (BX - IW / 2 - 0.05, BY - ID / 2 - 0.05, 0.0), (BX + IW / 2 + 0.05, BY + ID / 2 + 0.05, KH - 0.14))
# kerb: two courses of worn blocks, the upper one set back a little and with a rounded coping
seed = 0
for course, (z0, h) in enumerate(((0.0, 0.26), (0.24, 0.24))):
    inset = 0.02 * course
    for side in range(4):
        horiz = side % 2 == 0
        span = IW + 0.7 if horiz else ID
        u = -span / 2
        while u < span / 2 - 0.05:
            l = min(R.uniform(0.45, 0.8), span / 2 - u)
            if span / 2 - (u + l) < 0.2: l = span / 2 - u
            c = u + l / 2
            t = 0.34 + jit(0.03)
            if horiz:
                y = BY + (-1 if side == 0 else 1) * (ID / 2 + t / 2 - inset)
                block(BX + c, y, z0, l - 0.02, t, h + jit(0.02), jit(0.03), seed)
            else:
                x = BX + (-1 if side == 1 else 1) * (IW / 2 + t / 2 - inset)
                block(x, BY + c, z0, t, l - 0.02, h + jit(0.02), jit(0.03), seed)
            seed += 1
            u += l
# a low step down into the water at the front, worn hollow
block(BX - 0.2, BY - ID / 2 + 0.2, 0.0, 0.8, 0.36, KH - 0.2, 0.02, 400)
# flagstones where pilgrims kneel (front) and round the hood
rng = random.Random(4)
for i in range(16):
    x = BX + rng.uniform(-1.6, 1.8)
    y = BY - ID / 2 - 0.55 - rng.uniform(0.0, 1.1)
    if abs(x - BX - 0.05) < 0.35:
        continue
    s = rng.uniform(0.45, 0.8)
    block(x, y, 0.0, s, s * rng.uniform(0.6, 0.9), 0.2, rng.uniform(0, 3), 500 + i, bt=B("flags", "flag"), worn=0.06)

# ---- the hood over the spring head (+Y), sitting on the back kerb
HX, HY = BX + 0.0, BY + ID / 2 + 0.55
W, D, Hh = 1.25, 0.95, 1.25
sb = B("hood", "dressed")
for sgn in (-1, 1):       # side slabs
    box(sb, (HX + sgn * W / 2 - 0.1, HY - D / 2, 0.0), (HX + sgn * W / 2 + 0.1, HY + D / 2, Hh), 0.03,
        rot=(0, jit(0.01), jit(0.02)))
box(sb, (HX - W / 2, HY + D / 2 - 0.16, 0.0), (HX + W / 2, HY + D / 2 + 0.02, Hh), 0.03)
box(sb, (HX - W / 2 - 0.05, HY - D / 2 - 0.05, Hh), (HX + W / 2 + 0.05, HY + D / 2 + 0.05, Hh + 0.12), 0.025)
pitch = math.radians(38)
rise = (W / 2 + 0.2) * math.tan(pitch)
for sgn in (-1, 1):       # two roof slabs, lapped at the ridge
    a = Vector((HX + sgn * (W / 2 + 0.22), 0, Hh + 0.12 - 0.02))
    b = Vector((HX, 0, Hh + 0.12 + rise))
    pts = []
    for (p, dz) in ((a, 0.0), (b, 0.0)):
        for yy in (HY - D / 2 - 0.12, HY + D / 2 + 0.1):
            for th in (0.0, 0.17):
                pts.append((p.x, yy, p.z + th + dz))
    prism_hull(sb, pts)
box(sb, (HX - 0.1, HY - D / 2 - 0.14, Hh + 0.12 + rise - 0.02), (HX + 0.1, HY + D / 2 + 0.12, Hh + 0.12 + rise + 0.16), 0.03)
# gable front infill (triangular) and the worn head-boss carved on it
pts = []
for yy in (HY - D / 2, HY - D / 2 + 0.14):
    pts += [(HX - W / 2 - 0.02, yy, Hh + 0.12), (HX + W / 2 + 0.02, yy, Hh + 0.12), (HX, yy, Hh + 0.12 + rise * 0.9)]
prism_hull(sb, pts)
blob(sb, (HX, HY - D / 2 - 0.03, Hh + 0.12 + rise * 0.38), 0.12, 0.08, 0.14, sub=2, amp=0.12, seed=3.0)
for sgn in (-1, 1):      # eyes: two shallow pits read as sockets (little dark stones)
    blob(B("hole", "mud"), (HX + sgn * 0.045, HY - D / 2 - 0.1, Hh + 0.12 + rise * 0.42), 0.022, 0.012, 0.018, sub=1)
# floor of the niche + the lip spout over the basin
box(sb, (HX - W / 2 + 0.1, HY - D / 2, 0.0), (HX + W / 2 - 0.1, HY + D / 2 - 0.16, 0.34), 0.02)
box(sb, (HX - 0.14, HY - D / 2 - 0.34, 0.26), (HX + 0.14, HY - D / 2 + 0.2, 0.36), 0.02, rot=(0.12, 0, 0))
box(B("water"), (HX - W / 2 + 0.12, HY - D / 2 + 0.02, 0.34), (HX + W / 2 - 0.12, HY + D / 2 - 0.18, 0.37))
# a thin trickle off the spout lip
box(B("water"), (HX - 0.05, HY - D / 2 - 0.33, KH - 0.14), (HX + 0.05, HY - D / 2 - 0.3, 0.3))

# ---- runnel out of the front, lined with small stones, over the wet margin
for k in range(7):
    y = BY - ID / 2 - 0.45 - k * 0.42
    x = BX + 0.05 + math.sin(k * 0.7) * 0.12
    for sgn in (-1, 1):
        block(x + sgn * 0.26, y, 0.0, 0.22, 0.4, 0.2 + jit(0.03), jit(0.2), 600 + k * 2 + (sgn > 0), worn=0.08)
    box(B("water"), (x - 0.16, y - 0.22, 0.0), (x + 0.16, y + 0.22, 0.14 - k * 0.008))
# wet moss cushions and rushes
for i in range(9):
    a = R.uniform(0, 6.28)
    tussock(B("tuft", "wet"), BX + math.cos(a) * R.uniform(1.6, 2.4), BY + math.sin(a) * R.uniform(1.3, 2.0), 0.08,
            R.uniform(0.9, 1.4), blades=11)
for i in range(8):
    tussock(B("tuft", "wet"), BX + 0.05 + R.choice((-1, 1)) * R.uniform(0.45, 0.7), BY - 1.4 - R.uniform(0, 2.4), 0.1,
            R.uniform(0.9, 1.5), blades=11)

# ---- the rag-tree
thorn_tree(BX + 2.35, BY + 0.9, height=3.4, seed=17, rags=48, lean=(0.28, -0.12))
block(BX + 2.2, BY + 0.6, 0.0, 0.5, 0.4, 0.3, 0.4, 700)

done("holy_spring", tex=2048, lods=(1.0, 0.4, 0.12))
