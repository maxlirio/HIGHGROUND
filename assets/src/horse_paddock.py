"""HIGHGROUND - horse paddock (30 x 30 m footprint).

A post-and-rail enclosure of riven oak posts and cleft rails with a hung field gate on the front,
a three-bay field shelter (open to the south, shingled pent roof, hay rack inside) in the back
corner and a plank trough on bearers by the gate. No animals.

    blender -b -P assets/src/horse_paddock.py -- [complete|build1]

Front faces -Y. 1 unit = 1 m.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _kit_yards as K
from _kit_yards import B, beam, box, cyl, Face, jit, grid, R

STATE = K.state_from_argv()
assert STATE in ("complete", "build1"), "the paddock has complete + build1 only"
K.init(STATE, seed=53)
FULL, B1 = K.FULL, K.B1

H = 14.8                     # half size of the fence square
GATE = (-1.6, 1.6)           # gate opening on the front run (x)
SH = (4.2, 13.0, 9.6, 14.1)  # field shelter x0, x1, y0, y1


def materials():
    K.std_materials(0.0)
    K.MAT["hay"] = K.m_hay("hay")
    K.MAT["water"] = K.m_water("water")
    K.MAT["muck"] = K.m_muck("muck")


def fence_all(keep=1.0, posts_only_frac=None):
    rails = (0.5, 0.88, 1.25)
    c = [(-H, -H), (H, -H), (H, H), (-H, H)]
    # front run in two halves around the gateway
    K.fence(c[0], (GATE[0], -H), step=2.7, rails=rails, h=1.4, keep=keep, rail_r=0.068)
    K.fence((GATE[1], -H), c[1], step=2.7, rails=rails, h=1.4, keep=keep, rail_r=0.068)
    K.fence(c[1], c[2], step=2.7, rails=rails, h=1.4, keep=keep, first_post=False, rail_r=0.068)
    K.fence(c[2], c[3], step=2.7, rails=rails, h=1.4, keep=keep, first_post=False, rail_r=0.068)
    K.fence(c[3], c[0], step=2.7, rails=rails, h=1.4, keep=keep, first_post=False, last_post=False, rail_r=0.068)
    # heavier gate posts
    for x in GATE:
        K.post(B("oak"), x, -H, 1.6, 0.24, 0.22, lean=0.01, cap="round")


def shelter():
    x0, x1, y0, y1 = SH
    hf, hb = 2.7, 2.15
    xs = grid(x0 + 0.1, x1 - 0.1, 2.9, 0.0)
    oak = B("oak")
    for x in xs:
        for (y, h) in ((y0 + 0.1, hf), (y1 - 0.1, hb)):
            box(B("rubble"), (x - 0.22, y - 0.22, 0), (x + 0.22, y + 0.22, 0.22), 0.02, rot=(0, 0, jit(0.2)))
            beam(oak, (x, y, 0.22), (x + jit(0.02), y + jit(0.02), h), 0.2, 0.2, 0.012)
    beam(oak, (x0 - 0.25, y0 + 0.1, hf + 0.1), (x1 + 0.25, y0 + 0.1, hf + 0.1), 0.22, 0.22, 0.012)
    beam(oak, (x0 - 0.25, y1 - 0.1, hb + 0.1), (x1 + 0.25, y1 - 0.1, hb + 0.1), 0.22, 0.22, 0.012)
    for x in xs:
        beam(oak, (x, y0 - 0.05, hf + 0.05), (x, y1 + 0.05, hb + 0.05), 0.16, 0.2, 0.01)
        for s in (-1, 1):
            if (x == xs[0] and s < 0) or (x == xs[-1] and s > 0):
                continue
            beam(oak, (x + s * 0.09, y0 + 0.1, hf - 0.6), (x + s * 0.6, y0 + 0.1, hf), 0.12, 0.13, 0.01)
    slope = (hf - hb) / (y1 - y0)
    Mr = Matrix(((1, 0, 0, 0), (0, -1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))
    K.roof_rows(B("shingle"), Mr, x0 - 0.4, x1 + 0.4, (-(y1 + 0.55), hb + 0.28 - 0.55 * slope),
                (-(y0 - 0.55), hf + 0.32 + 0.55 * slope), row_w=0.3, thick=0.03, lift=0.03, sag=0.07, seg=9)
    for x in (x0 - 0.42, x1 + 0.42):
        beam(B("plank"), (x, y0 - 0.6, hf + 0.33 + 0.6 * slope), (x, y1 + 0.6, hb + 0.2 - 0.6 * slope), 0.22, 0.04, 0.006,
             side=(1, 0, 0))
    beam(B("plank"), (x0 - 0.42, y0 - 0.57, hf + 0.33), (x1 + 0.42, y0 - 0.57, hf + 0.33), 0.2, 0.04, 0.006,
         side=(0, 1, 0))
    # boarded back + ends
    fb = Face((x1, y1, 0), (0, 1, 0))
    K.plank_wall(fb, 0.0, x1 - x0, 0.15, hb + 0.1, d0=-0.05)
    for f, east in ((Face((x0, y1, 0), (-1, 0, 0)), False), (Face((x1, y0, 0), (1, 0, 0)), True)):
        u = 0.0
        L_ = y1 - y0
        while u < L_ - 0.02:
            w = min(0.27 * R.uniform(0.85, 1.15), L_ - u)
            t = (u + w / 2) / L_
            top = (hf + (hb - hf) * t if east else hb + (hf - hb) * t) + 0.12
            f.box(B("plank"), u + 0.004, u + w - 0.004, -0.05, -0.015, 0.15, top)
            u += w
    # hay rack (hay-heck) along the back wall + trampled bedding
    rx0, rx1 = x0 + 0.6, x1 - 0.6
    ry = y1 - 0.35
    beam(oak, (rx0, ry - 0.55, 1.75), (rx1, ry - 0.55, 1.75), 0.08, 0.08, 0.008)
    beam(oak, (rx0, ry, 0.95), (rx1, ry, 0.95), 0.08, 0.08, 0.008)
    x = rx0 + 0.1
    while x < rx1 - 0.05:
        beam(B("plank"), (x, ry, 0.95), (x + jit(0.01), ry - 0.55, 1.75), 0.035, 0.035, 0.004)
        x += 0.16
    K.mound(B("hay"), (rx0 + rx1) / 2, ry - 0.25, (rx1 - rx0) / 2 - 0.1, 0.28, 0.45, rings=3, seg=16, z0=1.05,
            rough=0.2)
    K.mound(B("hay"), (x0 + x1) / 2 - 1.0, (y0 + y1) / 2 + 0.3, 2.6, 1.3, 0.08, rings=3, seg=16, rough=0.4)
    K.mound(B("muck"), x0 + 1.2, y0 - 0.3, 0.9, 0.6, 0.06, rings=2, seg=10, rough=0.4)


def trough_and_bits():
    # poached ground where the horses stand: gateway, trough, shelter front
    for (x, y, rx, ry) in ((0.0, -13.6, 2.6, 1.3), (4.6, -12.9, 2.0, 1.0), (8.6, 8.6, 4.2, 1.2), (-6.5, -2.0, 1.8, 1.1)):
        K.mound(B("muck"), x, y, rx, ry, 0.035, rings=4, seg=18, rough=0.35, power=0.5, flat=0.6)
    K.trough(4.5, -H + 1.4, l=2.4, w=0.66, h=0.55, rot=0.0, stone=False, water=True)
    K.barrel((6.1, -H + 1.2, 0), 0.3, 0.85)
    # a salt-lick block on a stump and a hay feeder crib out in the field
    cyl(B("oak"), (-8.0, 6.0, 0), (-8.0, 6.0, 0.55), 0.3, 0.27, n=9)
    box(B("ashlar"), (-8.15, 5.85, 0.55), (-7.85, 6.15, 0.75), 0.02)
    cx, cy = -6.5, -2.0
    for (dx, dy) in ((-0.9, -0.5), (0.9, -0.5), (-0.9, 0.5), (0.9, 0.5)):
        beam(B("oak"), (cx + dx, cy + dy * 1.3, 0), (cx + dx * 0.95, cy + dy, 1.2), 0.09, 0.09, 0.008)
    for s in (-1, 1):
        beam(B("oak"), (cx - 1.0, cy + s * 0.5, 1.2), (cx + 1.0, cy + s * 0.5, 1.2), 0.08, 0.08, 0.008)
        beam(B("oak"), (cx - 1.0, cy + s * 0.25, 0.4), (cx + 1.0, cy + s * 0.25, 0.4), 0.08, 0.08, 0.008)
        x = cx - 0.9
        while x < cx + 0.9:
            beam(B("plank"), (x, cy + s * 0.25, 0.4), (x + jit(0.01), cy + s * 0.5, 1.2), 0.035, 0.035, 0.004)
            x += 0.18
    K.mound(B("hay"), cx, cy, 0.95, 0.4, 0.55, rings=3, seg=14, z0=0.45, rough=0.25)


def build1():
    # corner and gate posts set, a line of stakes + string for the rest, rails stacked
    for (x, y) in ((-H, -H), (H, -H), (H, H), (-H, H)):
        K.post(B("fresh"), x, y, 1.45, 0.18, 0.16)
    for x in GATE:
        K.post(B("fresh"), x, -H, 1.6, 0.24, 0.22, lean=0.01, cap="round")
    # the front and east runs have their posts in; rails going on along the front
    K.fence((-H, -H), (GATE[0], -H), step=2.7, rails=(0.5, 0.88, 1.25), h=1.4, keep=0.6, first_post=False,
            last_post=False, bt_post=B("fresh"), bt_rail=B("fresh"))
    K.fence((H, -H), (H, H), step=2.7, rails=(), h=1.4, first_post=False, last_post=False, bt_post=B("fresh"))
    for (a, b) in (((GATE[1], -H), (H, -H)), ((H, H), (-H, H)), ((-H, H), (-H, -H))):
        a3, b3 = Vector(a + (0,)), Vector(b + (0,))
        n = max(1, round((b3 - a3).length / 2.7))
        for i in range(1, n):
            p = a3.lerp(b3, i / n)
            cyl(B("fresh"), (p.x, p.y, 0), (p.x + jit(0.02), p.y + jit(0.02), 0.45), 0.025, 0.015, n=4)
        beam(B("rope"), (a[0], a[1], 0.35), (b[0], b[1], 0.35), 0.007, 0.007, 0.0)
    # stacks of cleft rails and posts, a post-hole spoil heap, the shelter padstones
    for k, (cx, cy) in enumerate(((0.0, -11.0), (10.5, 3.0))):
        for layer in range(4):
            for i in range(5 - layer):
                y = cy - 0.4 + i * 0.16 + layer * 0.08
                K.cleft(B("fresh"), (cx - 1.4 + jit(0.1), y, 0.07 + layer * 0.12), (cx + 1.4 + jit(0.1), y, 0.07 + layer * 0.12),
                        0.06)
    for i in range(10):
        beam(B("fresh"), (3.0 + (i % 5) * 0.2, -8.6 + (i // 5) * 0.2, 0.1 + (i // 5) * 0.18),
                 (5.4 + (i % 5) * 0.2, -8.6 + (i // 5) * 0.2, 0.1 + (i // 5) * 0.18), 0.17, 0.17, 0.012)
    for (x, y) in ((-H + 1.2, -H + 0.8), (H - 1.0, -H + 1.0), (H - 1.2, 0.0)):
        K.mound(B("soil"), x, y, 0.45, 0.4, 0.18, rings=3, seg=10, rough=0.3)
    x0, x1, y0, y1 = SH
    for x in grid(x0 + 0.1, x1 - 0.1, 2.9, 0.0):
        for y in (y0 + 0.1, y1 - 0.1):
            box(B("rubble"), (x - 0.22, y - 0.22, 0), (x + 0.22, y + 0.22, 0.22), 0.02, rot=(0, 0, jit(0.2)))
    K.barrow(1.5, -9.5, rot=0.4)
    # post-hole auger/spade + beetle (mallet) lying by the gate
    K.tube(B("oak"), [(-3.0, -13.2, 0.05), (-2.0, -13.4, 0.05)], 0.02, sides=5)
    cyl(B("oak"), (-3.1, -13.25, 0.12), (-3.1, -12.95, 0.12), 0.1, n=8)


def main():
    materials()
    if FULL:
        fence_all()
        K.gate((GATE[0] + 0.12, -H), (GATE[1] - 0.12, -H), h=1.3, open_ang=math.radians(40))
        shelter()
        trough_and_bits()
        name = "horse_paddock"
    else:
        build1()
        name = "horse_paddock_build1"
    K.finalize(name, tex=2048 if FULL else 1024)


main()
