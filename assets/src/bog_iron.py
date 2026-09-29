"""HIGHGROUND - bog iron: bog-ore beds at the lip of Harrow Moss (resource node).

A raised peat bank ~14 x 11 m cut into by turf pits: square-dug hollows with black spade-cut
faces, the pits flooded with tea-dark water whose margins carry an oily orange-ochre scum of
iron bacteria; the orange stains the peat and grass round every pool. Cut turves stacked to
dry in little stooks, a heap of dug bog-ore nodules and a peat spade left standing, rushes in
the wet. Everything above grade: the pools sit in the bank. Front faces -Y.

    blender -b -t 2 -P assets/src/bog_iron.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _landkit import *

begin(141)
MAT["bank"] = m_turf("bank", dry=0.25, wet=0.5, tones=[(0.15, "#3d4222"), (0.45, "#545a2c"), (0.7, "#6b6a36"),
                                                         (0.95, "#857a44")])
MAT["peat"] = m_peat("peat")
MAT["turves"] = m_loose("turves", [(0.0, "#3e2e20"), (0.4, "#4f3b28"), (0.8, "#624a32"), (1.0, "#4a3826")], lump=20.0,
                        rough=0.9, pebble=0.0, grass=0.2)
MAT["ochre"] = m_loose("ochre", [(0.0, "#6e3510"), (0.35, "#8e4716"), (0.7, "#a9591e"), (1.0, "#7a3e16")], lump=16.0,
                       rough=0.75, pebble=0.0, grass=0.15)
MAT["water"] = m_pool("water", deep="#1a140e", shallow="#33261a", scum=("#a4561f", "#cf8236"), scum_amt=1.0)
MAT["ore"] = m_rock("ore", [(0.0, "#4a2e1e"), (0.4, "#6a3c22"), (0.7, "#7e4a28"), (1.0, "#5a3a26")], speck=0.4,
                    speck_light="#b0743a", speck_dark="#2a1a12", lichen_amt=0.0, moss=0.0, streaks=0.0, cracks=0.3,
                    pits=0.8, grime=False, rough=0.8, preview="#6a3c22")
MAT["pole"] = m_wood2("pole", [(0.0, "#6a5a45"), (0.5, "#7a6a52"), (1.0, "#8a7a60")], weathered=0.5)
MAT["iron_t"] = m_simple2("iron_t", "#35332f", "#45403a", 0.72, rust=True)
MAT["rush"] = m_turf("rush", dry=0.5, tones=[(0.1, "#3f4a24"), (0.5, "#56602e"), (0.9, "#7a7440")])

HB = 0.55        # bank height
pits = [(-3.2, -1.2, 2.6, 1.9, 0.2), (0.4, -1.6, 2.2, 1.7, -0.1), (3.4, -0.6, 2.4, 2.0, 0.15), (-0.8, 1.9, 2.0, 1.5, 0.05)]


def in_pit(x, y, pad=0.0):
    for (px, py, w, d, a) in pits:
        ca, sa = math.cos(-a), math.sin(-a)
        lx, ly = (x - px) * ca - (y - py) * sa, (x - px) * sa + (y - py) * ca
        if abs(lx) < w / 2 + pad and abs(ly) < d / 2 + pad:
            return True
    return False


# the bank: a heightfield with square holes where the pits are cut (the pit walls are peat faces)
def bank_h(x, y):
    r = math.sqrt((x / 7.2) ** 2 + (y / 5.6) ** 2)
    r += 0.12 * MN.noise(Vector((x * 0.3, y * 0.3, 1.0)))
    if r >= 1.0:
        return 0.0
    f = (1 - r * r) ** 1.3
    return max(0.0, HB * f + 0.08 * f * MN.noise(Vector((x * 0.9, y * 0.9, 3.0))))


step = 0.33
xs = [(-8.9 + step * i) for i in range(55)]
ys = [(-7.1 + step * j) for j in range(44)]
P, F = [], []
idx = {}
for j, y in enumerate(ys):
    for i, x in enumerate(xs):
        idx[i, j] = len(P); P.append((x, y, max(0.0, bank_h(x, y))))
for j in range(len(ys) - 1):
    for i in range(len(xs) - 1):
        if in_pit(xs[i] + step / 2, ys[j] + step / 2, 0.0):
            continue
        q = (idx[i, j], idx[i + 1, j], idx[i + 1, j + 1], idx[i, j + 1])
        if max(P[k][2] for k in q) > 0.0:
            F.append(q)
used = sorted({k for f in F for k in f}); remap = {k: n for n, k in enumerate(used)}
B("bank").add([P[k] for k in used], [[remap[k] for k in f] for f in F], None, None)

# pits: peat walls (four spade-cut faces, slightly battered) + a floor of water with ochre scum
for k, (px, py, w, d, a) in enumerate(pits):
    M = TRS((px, py, 0), (0, 0, a))
    top = bank_h(px, py) + 0.02
    for (u0, v0, u1, v1) in ((-w / 2, -d / 2, w / 2, -d / 2), (w / 2, -d / 2, w / 2, d / 2),
                             (w / 2, d / 2, -w / 2, d / 2), (-w / 2, d / 2, -w / 2, -d / 2)):
        pts = []
        for (u, v) in ((u0, v0), (u1, v1)):
            p0 = M @ Vector((u, v, 0.0))
            inward = M.to_3x3() @ Vector((-u, -v, 0)).normalized() * 0.12
            h = max(0.08, bank_h(p0.x, p0.y))
            pts += [(p0.x, p0.y, h), (p0.x + inward.x, p0.y + inward.y, 0.04), (p0.x - inward.x * 2.5, p0.y - inward.y * 2.5, h - 0.03),
                    (p0.x - inward.x * 2.5, p0.y - inward.y * 2.5, 0.0)]
        prism_hull(B("peat"), pts)
    wpts = [tuple(M @ Vector((sx * (w / 2 - 0.05), sy * (d / 2 - 0.05), z))) for sx in (-1, 1) for sy in (-1, 1)
            for z in (0.0, 0.1)]
    prism_hull(B("water"), wpts)
    # ochre crust creeping up the margins and a few floating clots
    for s in range(5):
        u = R.uniform(-w / 2, w / 2); v = R.choice((-1, 1)) * (d / 2 - 0.12)
        c = M @ Vector((u, v, 0.1))
        ground_patch(B("ochre"), c.x, c.y, R.uniform(0.25, 0.5), R.uniform(0.12, 0.25), h=0.03, n=10, rings=2,
                     bump=0.01, seed=k * 7 + s)
    # a step of uncut peat left in one pit
    if k == 1:
        box(B("peat"), tuple(M @ Vector((-w / 2, -0.3, 0.0))), tuple(M @ Vector((-w / 2 + 0.55, 0.4, 0.3))), 0.03, rot=(0, 0, a))

def decal(bt, cx, cy, rx, ry, seed, lift=0.02):
    """flat irregular patch draped on the bank surface."""
    n, rings = 12, 3
    pts = [(cx, cy, bank_h(cx, cy) + lift)]
    F = []
    for k in range(1, rings + 1):
        t = k / rings
        for i in range(n):
            a = 2 * math.pi * i / n
            wob = 1 + 0.3 * MN.noise(Vector((math.cos(a) * 1.4 + seed, math.sin(a) * 1.4, 0.7)))
            x, y = cx + math.cos(a) * rx * t * wob, cy + math.sin(a) * ry * t * wob
            pts.append((x, y, bank_h(x, y) + lift * (1.0 if k < rings else 0.4)))
    for i in range(n):
        F.append((0, 1 + i, 1 + (i + 1) % n))
    for k in range(1, rings):
        b0, b1 = 1 + (k - 1) * n, 1 + k * n
        for i in range(n):
            j = (i + 1) % n
            F.append((b0 + i, b1 + i, b1 + j, b0 + j))
    bt.add(pts, F, None, None)


# ochre stain seeping out of the bank round the pools (thin patches on the bank surface)
for i in range(16):
    p = R.choice(pits)
    a = R.uniform(0, 6.28)
    x, y = p[0] + math.cos(a) * p[2] * 0.62, p[1] + math.sin(a) * p[3] * 0.62
    if in_pit(x, y, 0.1):
        continue
    decal(B("ochre"), x, y, R.uniform(0.3, 0.65), R.uniform(0.2, 0.45), 40 + i)

# turves stacked to dry: small open stooks of cut blocks
for (sx, sy) in ((-4.9, 2.4), (-3.6, 3.2), (2.2, 2.9), (5.2, 1.7)):
    z0 = bank_h(sx, sy)
    for lay in range(3):
        for k in range(4 - lay):
            ang = lay * 1.57 + R.uniform(-0.1, 0.1)
            o = (k - (3 - lay) / 2) * 0.24
            c = Vector((sx + math.cos(ang + 1.57) * o, sy + math.sin(ang + 1.57) * o, z0 + lay * 0.13))
            box(B("turves"), (c.x - 0.2, c.y - 0.07, c.z), (c.x + 0.2, c.y + 0.07, c.z + 0.12), 0.015,
                rot=(jit(0.1), jit(0.1), ang))
# heap of dug bog-ore nodules and a peat spade
ox, oy = 1.8, -4.3
spoil_heap(B("ochre"), ox, oy, 1.0, 0.8, 0.35, seed=9.0)
lumps(B("ore"), ox, oy, 0.75, 22, 0.06, 0.16, 41, zfn=lambda x, y: 0.2)
beam(B("pole"), (-1.2, -4.0, 0.0), (-1.1, -4.1, 1.1), 0.04, 0.04, 0.005)
beam(B("pole"), (-1.2, -4.0, 1.05), (-0.95, -4.18, 1.15), 0.03, 0.03, 0.004)
box(B("iron_t"), (-1.32, -4.02, -0.05), (-1.08, -3.99, 0.28), 0.0, rot=(0, 0.1, 0))
# rushes in the wet: dense tussocks at pit margins
for i in range(38):
    p = R.choice(pits)
    a = R.uniform(0, 6.28)
    x, y = p[0] + math.cos(a) * p[2] * R.uniform(0.6, 0.8), p[1] + math.sin(a) * p[3] * R.uniform(0.6, 0.8)
    if in_pit(x, y, 0.05):
        continue
    tussock(B("rush", "rush"), x, y, bank_h(x, y), R.uniform(1.2, 1.9), blades=12)
for i in range(16):
    a = R.uniform(0, 6.28)
    x, y = math.cos(a) * 6.8, math.sin(a) * 5.2
    tussock(B("rush", "rush"), x, y, 0.0, R.uniform(1.0, 1.5), blades=10)
done("bog_iron", tex=2048, lods=(1.0, 0.4, 0.12))
