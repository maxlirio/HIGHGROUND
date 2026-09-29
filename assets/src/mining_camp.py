"""HIGHGROUND - mining camp, footprint 10 x 8 m.

A bell-pit / shallow shaft head: log-cribbed collar round a dark shaft, windlass on two
braced posts with a rope-wound drum and iron cranks, a kibble on the rope and another on
the collar. A plank ore-store shed with bins of sorted ore, a big spoil heap with a plank
barrow run and a wheelbarrow, ore baskets, a sledge loaded with a basket of ore, and a
pick / shovel rack.

    blender -b -P assets/src/mining_camp.py -- [complete|build1|build2|ruin]

Front faces -Y. 1 unit = 1 m.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _craft import *

seed(73)

HX0, HX1, HY0, HY1 = -4.7, -1.2, 0.3, 3.7     # ore shed
SHX, SHY = 1.35, 0.9                          # shaft centre
SW = 0.75                                     # half inner width of the shaft


def extra(M, ch):
    M["spoil"] = m_heap("spoil", [(0.0, "#4f4a42"), (0.35, "#5f584d"), (0.7, "#6f675a"), (1.0, "#7e7466")], 13.0,
                        pebble=0.6, moss=0.15)
    M["ore"] = m_heap("ore", [(0.0, "#46302a"), (0.3, "#57382c"), (0.6, "#66402f"), (0.85, "#4b3834"), (1.0, "#3e3a38")],
                      18.0, rough=0.7, sheen=0.3)
    M["shale"] = m_stone("shale", [(0.0, "#56524b"), (0.4, "#67625a"), (0.8, "#78716a"), (1.0, "#5a5249")], "#3f3a35",
                         joints=False, bump=0.8, moss=0.2)
    M["orestone"] = m_stone("orestone", [(0.0, "#4f3d35"), (0.4, "#654538"), (0.8, "#72533f"), (1.0, "#4f4a47")],
                            "#3a322c", joints=False, bump=0.8, moss=0.0)
    M["mud"] = m_heap("mud", [(0.1, "#463a2e"), (0.5, "#584837"), (0.9, "#66553f")], 8.0, pebble=0.45, grass=0.45)
    M["wicker"] = m_wicker("wicker")


# ------------------------------------------------------------------ shaft + windlass
def shaft(stage="complete"):
    cx, cy = SHX, SHY
    # spoil banked round the collar (not over the shaft mouth)
    for (mx, my, rx, ry) in ((cx, cy - SW - 0.75, 1.6, 0.55), (cx, cy + SW + 0.75, 1.6, 0.55),
                             (cx - SW - 0.75, cy, 0.55, 1.2), (cx + SW + 0.75, cy, 0.55, 1.2)):
        mound(B("spoil"), mx, my, rx, ry, 0.3, rings=3, segs=16, noise=0.12, power=2.0)
    box(B("dark"), (cx - SW, cy - SW, 0), (cx + SW, cy + SW, 0.02))
    courses = 3 if stage not in ("b1",) else 1
    r = 0.13
    for k in range(courses):
        z = r + k * 2 * r * 0.88
        for sgn in (-1, 1):
            if k % 2 == 0:
                log((cx - SW - 0.45, cy + sgn * (SW + r), z), (cx + SW + 0.45, cy + sgn * (SW + r) + jit(0.03), z), r, r * 0.9,
                    n=8, bark="bark")
            else:
                log((cx + sgn * (SW + r), cy - SW - 0.45, z), (cx + sgn * (SW + r) + jit(0.03), cy + SW + 0.45, z), r, r * 0.9,
                    n=8, bark="bark")
    # inner lining boards visible down the shaft
    if stage != "b1":
        for sgn in (-1, 1):
            beam(B("plank"), (cx - SW, cy + sgn * (SW - 0.02), 0.25), (cx + SW, cy + sgn * (SW - 0.02), 0.25), 0.45, 0.03,
                 0.004, side=(0, 1, 0))
            beam(B("plank"), (cx + sgn * (SW - 0.02), cy - SW, 0.25), (cx + sgn * (SW - 0.02), cy + SW, 0.25), 0.45, 0.03,
                 0.004, side=(1, 0, 0))


def windlass(stage="complete"):
    cx, cy = SHX, SHY
    zd = 1.2
    oak = B("oak")
    if stage == "burnt":
        # one post snapped, drum fallen across the collar
        beam(oak, (cx - SW - 0.55, cy, 0.3), (cx - SW - 0.55, cy, 0.95), 0.18, 0.18, 0.012)
        beam(oak, (cx + SW + 0.3, cy - 0.4, 0.1), (cx + SW + 1.4, cy - 1.2, 0.25), 0.18, 0.18, 0.012)
        cyl(B("oak"), (cx - 0.9, cy - 0.3, 0.72), (cx + 0.9, cy + 0.25, 0.55), 0.14, n=10)
        return
    for sgn in (-1, 1):
        x = cx + sgn * (SW + 0.55)
        # sill beam + post + two raking braces
        beam(oak, (x, cy - 0.85, 0.3), (x, cy + 0.85, 0.3), 0.18, 0.16, 0.012)
        beam(oak, (x, cy, 0.36), (x, cy, zd + 0.22), 0.18, 0.18, 0.012)
        for s in (-1, 1):
            beam(oak, (x, cy + s * 0.75, 0.38), (x, cy + s * 0.08, zd - 0.12), 0.1, 0.12, 0.008, side=(1, 0, 0), ext=0.03)
    if stage == "frame":
        return
    xa, xb = cx - SW - 0.72, cx + SW + 0.72
    cyl(B("oak"), (xa + 0.1, cy, zd), (xb - 0.1, cy, zd), 0.13, n=10)
    cyl(B("rope"), (cx - 0.35, cy, zd), (cx + 0.3, cy, zd), 0.165, n=12)
    for (x, s) in ((xa, -1), (xb, 1)):
        cyl(B("iron"), (x + 0.1 * -s, cy, zd), (x, cy, zd), 0.03, n=6)
        beam(B("iron"), (x, cy, zd), (x, cy - 0.12, zd - 0.32), 0.04, 0.03, 0.0)
        beam(B("oak"), (x, cy - 0.12, zd - 0.32), (x + s * 0.24, cy - 0.12, zd - 0.32), 0.05, 0.05, 0.004)
    # rope down to a kibble hanging part-way up the shaft
    cyl(B("rope"), (cx + 0.1, cy - 0.16, zd - 0.05), (cx + 0.1, cy - 0.12, 0.62), 0.016, n=5)
    kib = Vector((cx + 0.1, cy - 0.12, 0.08))
    tub(kib, 0.24, 0.42, liquid=None, n=10)
    mound(B("ore"), kib.x, kib.y, 0.22, 0.22, 0.1, rings=2, segs=10, noise=0.25, z0=0.4)
    beam(B("iron"), kib + Vector((-0.24, 0, 0.42)), kib + Vector((0, 0, 0.6)), 0.02, 0.02, 0.0)
    beam(B("iron"), kib + Vector((0.24, 0, 0.42)), kib + Vector((0, 0, 0.6)), 0.02, 0.02, 0.0)
    # a second kibble on the collar
    k2 = Vector((cx - SW - 0.2, cy - SW - 0.55, 0.12))
    tub(k2, 0.22, 0.4, liquid=None, n=10)
    mound(B("ore"), k2.x, k2.y, 0.2, 0.2, 0.12, rings=2, segs=10, noise=0.25, z0=k2.z + 0.38)


# ------------------------------------------------------------------ ore shed
def ore_shed(stage="complete"):
    oak = B("oak")
    burnt = stage == "burnt"
    zf, zb = 2.3, 2.3
    rz = 3.35
    ry = (HY0 + HY1) / 2
    posts = [(x, y) for x in (HX0, (HX0 + HX1) / 2, HX1) for y in (HY0, HY1)]
    for (x, y) in posts:
        box(B("rubble"), (x - 0.2, y - 0.2, 0), (x + 0.2, y + 0.2, 0.2), 0.02, rot=(0, 0, jit(0.1)))
        top = zf if not burnt else R.uniform(0.6, 1.9)
        beam(oak, (x, y, 0.2), (x + jit(0.02), y, top), 0.17, 0.17, 0.012)
    if burnt:
        # fallen charred timbers + roof boards
        for i in range(8):
            x, y = R.uniform(HX0, HX1), R.uniform(HY0, HY1)
            a = R.uniform(0, 3.14)
            beam(oak, (x, y, 0.15), (x + math.cos(a) * 2.0, y + math.sin(a) * 2.0, R.uniform(0.1, 0.9)), 0.14, 0.15, 0.01)
        for i in range(10):
            x, y = R.uniform(HX0, HX1), R.uniform(HY0 - 0.5, HY1)
            beam(B("shingle"), (x, y, 0.05), (x + 1.0, y + jit(0.4), 0.1 + R.uniform(0, 0.3)), 0.3, 0.03, 0.004,
                 side=(0, 0, 1))
        return
    # plates + tie beams
    for y in (HY0, HY1):
        beam(oak, (HX0 - 0.2, y, zf + 0.08), (HX1 + 0.2, y, zf + 0.08), 0.18, 0.18, 0.012)
    for x in (HX0, HX1):
        beam(oak, (x, HY0 - 0.15, zf + 0.26), (x, HY1 + 0.15, zf + 0.26), 0.16, 0.18, 0.012)
    for x in grid(HX0, HX1, 0.6):
        for sgn in (-1, 1):
            ye = ry + sgn * ((HY1 - HY0) / 2 + 0.4)
            beam(oak, (x, ye, zf + 0.16 - 0.4 * (rz - zf) / ((HY1 - HY0) / 2)), (x, ry, rz), 0.08, 0.11, 0.006,
                 side=(1, 0, 0))
    # braces
    for (x, y) in posts:
        for s in (-1, 1):
            if (HX0 <= x + s * 0.6 <= HX1):
                beam(oak, (x, y, zf - 0.6), (x + s * 0.55, y, zf), 0.09, 0.1, 0.006, side=(0, 1, 0), ext=0.03)
    # plank walls: back (north) and west ends full height; east end half
    for x in grid(HX0, HX1, 0.28, 0.0)[:-1]:
        beam(B("plank"), (x + 0.14, HY1 + 0.1, 0.05), (x + 0.14 + jit(0.01), HY1 + 0.1, zf + jit(0.03)),
             0.27 * R.uniform(0.92, 1.03), 0.035, 0.005, side=(0, 1, 0))
    for y in grid(HY0, HY1, 0.28, 0.0)[:-1]:
        beam(B("plank"), (HX0 - 0.1, y + 0.14, 0.05), (HX0 - 0.1, y + 0.14, zf + jit(0.03)), 0.27, 0.035, 0.005,
             side=(1, 0, 0))
        h = (y - HY0) / (HY1 - HY0)
        top = ry - abs(y + 0.14 - ry)
        beam(B("plank"), (HX1 + 0.1, y + 0.14, 0.05), (HX1 + 0.1, y + 0.14, 1.2 + jit(0.03)), 0.27, 0.035, 0.005,
             side=(1, 0, 0))
    # gable boards on the west end
    for y in grid(HY0 - 0.1, HY1 + 0.1, 0.27, 0.0)[:-1]:
        top = rz - abs(y + 0.135 - ry) * (rz - zf) / ((HY1 - HY0) / 2) - 0.08
        if top > zf + 0.25:
            beam(B("plank"), (HX0 - 0.12, y + 0.135, zf + 0.2), (HX0 - 0.12, y + 0.135, top), 0.26, 0.03, 0.004,
                 side=(1, 0, 0))
    if stage == "frame":
        return
    I = Matrix.Identity(4)
    mir = Matrix.Translation((0, 2 * ry, 0)) @ Matrix.Scale(-1, 4, (0, 1, 0))
    half = (HY1 - HY0) / 2
    eave = (HY0 - 0.45, zf + 0.2 - 0.45 * (rz - zf) / half)
    for M in (I, mir):
        roof_rows(B("shingle"), M, HX0 - 0.35, HX1 + 0.35, eave, (ry, rz + 0.12), row_w=0.3, thick=0.03, lift=0.03,
                  sag=0.06, seg=7)
    ridge_tiles(B("plank"), I, HX0 - 0.35, HX1 + 0.35, ry, rz + 0.2, r=0.12, piece=0.9, n=3)
    # ore bins: plank partitions with sorted ore heaps
    for x in (HX0 + 1.15, HX0 + 2.3):
        beam(B("plank"), (x, HY0 + 0.4, 0.4), (x, HY1 - 0.1, 0.4), 0.8, 0.04, 0.005, side=(1, 0, 0))
    beam(B("plank"), (HX0, HY0 + 0.25, 0.15), (HX1, HY0 + 0.25, 0.15), 0.3, 0.05, 0.005, side=(0, 1, 0))
    for (x, s) in ((HX0 + 0.58, 0.55), (HX0 + 1.72, 0.7), (HX0 + 2.9, 0.45)):
        mound(B("ore"), x, (HY0 + HY1) / 2 - 0.1, 0.52, 1.55, s, rings=4, segs=16, noise=0.15, power=1.3, lumpy=0.03)
        # spill over the low front board onto the floor
        mound(B("ore"), x + jit(0.1), HY0 - 0.05, 0.45, 0.4, 0.2, rings=3, segs=12, noise=0.2, power=1.4)
        ore_lumps(x, HY0 - 0.2, 0.45, 8)


def ore_lumps(cx, cy, r, n, z0=0.0):
    for i in range(n):
        a = R.uniform(0, 6.28)
        rr = r * math.sqrt(R.random())
        x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
        s = R.uniform(0.035, 0.075)
        box(B("orestone"), (x - s, y - s * 0.8, z0), (x + s, y + s * 0.8, z0 + s * 1.3), 0.0,
            rot=(jit(0.4), jit(0.4), R.uniform(0, 3)))


def spoil_heap(cx, cy):
    mound(B("spoil"), cx, cy, 1.9, 1.45, 1.25, rings=8, segs=24, noise=0.16, power=1.15, lumpy=0.09)
    for i in range(26):
        a = R.uniform(0, 6.28)
        rr = math.sqrt(R.random())
        x, y = cx + math.cos(a) * rr * 1.9, cy + math.sin(a) * rr * 1.45
        z = 1.25 * (1 - rr ** 1.15) * 0.9
        s = R.uniform(0.08, 0.2)
        box(B("shale" if R.random() < 0.7 else "orestone"), (x - s, y - s * 0.7, max(0, z - s * 0.4)), (x + s, y + s * 0.7, max(0, z - s * 0.4) + s * 1.1),
            0.0, rot=(jit(0.5), jit(0.5), R.uniform(0, 3)))
    # plank barrow run up the heap
    p0 = Vector((cx - 2.2, cy + 0.2, 0.03))
    p1 = Vector((cx - 0.2, cy + 0.05, 1.2))
    for off in (-0.14, 0.14):
        beam(B("plank"), p0 + Vector((0, off, 0.02)), p1 + Vector((0, off, 0.02)), 0.26, 0.05, 0.005, side=(0, 0, 1))
    for t in (0.35, 0.7):
        q = p0.lerp(p1, t)
        beam(B("pole"), q + Vector((0, -0.4, -0.02)), q + Vector((0, 0.4, -0.02)), 0.08, 0.08, 0.004, side=(0, 0, 1))


def barrow(p, rot=0.0):
    M = TRS(p, (0, 0, rot))
    # wheel at the front, box body, two handles
    cyl(B("plank"), M @ Vector((0.62, -0.05, 0.22)), M @ Vector((0.62, 0.05, 0.22)), 0.22, n=12)
    for s in (-1, 1):
        beam(B("oak"), M @ Vector((0.7, s * 0.2, 0.22)), M @ Vector((-0.75, s * 0.28, 0.55)), 0.05, 0.05, 0.004)
        beam(B("oak"), M @ Vector((-0.4, s * 0.25, 0.0)), M @ Vector((-0.4, s * 0.25, 0.45)), 0.04, 0.04, 0.0)
    pts = [M @ Vector(v) for v in ((-0.4, -0.3, 0.45), (-0.4, 0.3, 0.45), (0.35, -0.22, 0.34), (0.35, 0.22, 0.34),
                                  (-0.4, -0.35, 0.78), (-0.4, 0.35, 0.78), (0.42, -0.3, 0.72), (0.42, 0.3, 0.72))]
    prism_hull(B("plank"), [tuple(q) for q in pts])
    c = M @ Vector((0.0, 0.0, 0.78))
    mound(B("spoil"), c.x, c.y, 0.36, 0.26, 0.12, rings=2, segs=10, noise=0.2, z0=c.z - 0.02, rot=rot)


def sledge(p, rot=0.0):
    M = TRS(p, (0, 0, rot))
    for s in (-1, 1):
        beam(B("oak"), M @ Vector((-0.8, s * 0.32, 0.06)), M @ Vector((0.55, s * 0.32, 0.06)), 0.08, 0.12, 0.008)
        beam(B("oak"), M @ Vector((0.55, s * 0.32, 0.06)), M @ Vector((0.85, s * 0.32, 0.3)), 0.08, 0.12, 0.008, ext=0.03)
    for x in (-0.65, -0.2, 0.25):
        beam(B("oak"), M @ Vector((x, -0.42, 0.17)), M @ Vector((x, 0.42, 0.17)), 0.07, 0.07, 0.006, side=(0, 0, 1))
    for x in grid(-0.78, 0.5, 0.2, 0.0):
        beam(B("plank"), M @ Vector((x, -0.4, 0.23)), M @ Vector((x, 0.4, 0.23)), 0.18, 0.03, 0.004, side=(0, 0, 1))
    # drag rope from the upturned nose
    beam(B("rope"), M @ Vector((0.85, -0.25, 0.28)), M @ Vector((1.35, 0.1, 0.01)), 0.02, 0.02, 0.0)
    basket(M @ Vector((-0.15, 0.0, 0.25)), 0.3, 0.42)


def basket(p, r, h, fill="ore"):
    p = Vector(p)
    cyl(B("wicker"), p, p + Vector((0, 0, h)), r * 0.82, r, n=12)
    mound(B(fill), p.x, p.y, r * 0.95, r * 0.95, 0.12, rings=2, segs=10, noise=0.25, z0=p.z + h - 0.03)
    if fill == "ore":
        ore_lumps(p.x, p.y, r * 0.6, 5, p.z + h + 0.02)


def tool_rack(x0, y0, length=1.8):
    for x in (x0, x0 + length):
        beam(B("oak"), (x, y0, 0), (x, y0, 1.25), 0.1, 0.1, 0.008)
        beam(B("oak"), (x, y0 - 0.3, 0), (x, y0, 0.7), 0.07, 0.07, 0.006)
    beam(B("oak"), (x0 - 0.1, y0, 1.15), (x0 + length + 0.1, y0, 1.15), 0.08, 0.1, 0.008, side=(0, 1, 0))
    kinds = ["pick", "shovel", "pick", "mattock", "shovel", "pick", "shovel"]
    for i, k in enumerate(kinds):
        x = x0 + 0.15 + i * (length - 0.3) / (len(kinds) - 1)
        tool((x + jit(0.05), y0 - 0.42, 0.0), (x + jit(0.05), y0 + 0.05, 1.3), k)


# ------------------------------------------------------------------ states
def complete():
    ground_pad(0.0, 0.0, 5.2, 4.2, "mud", h=0.03)
    shaft()
    windlass()
    ore_shed()
    spoil_heap(3.35, -2.1)
    barrow(Vector((0.5, -1.55, 0)), rot=-0.15)
    sledge(Vector((-2.0, -2.6, 0)), rot=0.25)
    for (x, y) in ((-3.9, -0.55), (-3.3, -0.35), (-3.6, -1.1)):
        basket((x, y, 0), 0.26, 0.4)
    basket((-2.7, -0.7, 0), 0.26, 0.38, fill="spoil")
    ore_lumps(-0.6, -0.3, 0.6, 12)
    mound(B("ore"), -0.6, -0.3, 0.55, 0.45, 0.2, rings=3, segs=14, noise=0.2)
    tool_rack(2.7, 2.95, 1.8)
    # pit props / spare lining timber
    for k in range(4):
        log((-0.2 + k * 0.2, 2.4, 0.09), (-0.2 + k * 0.2 + jit(0.1), 3.9, 0.09), 0.09, 0.08, n=7)


def build1():
    ground_pad(0.0, 0.0, 5.2, 4.2, "mud", h=0.03)
    shaft(stage="b1")
    mound(B("spoil"), 3.2, -2.0, 1.2, 0.9, 0.5, noise=0.18)
    for (x, y) in ((HX0, HY0), (HX1, HY0), (HX0, HY1), (HX1, HY1)):
        cyl(B("plank"), (x, y, 0), (x + jit(0.02), y + jit(0.02), 0.7), 0.035, 0.02, n=5)
    for (a, b) in (((HX0, HY0), (HX1, HY0)), ((HX1, HY0), (HX1, HY1)), ((HX1, HY1), (HX0, HY1)), ((HX0, HY1), (HX0, HY0))):
        beam(B("rope"), (a[0], a[1], 0.6), (b[0], b[1], 0.6), 0.012, 0.012, 0.0)
    for k in range(6):
        rr = 0.12
        log((-4.2, -1.8 + k * 0.26, rr + (0.22 if k > 3 else 0)), (-0.6, -1.8 + k * 0.26 + jit(0.05), rr), rr, rr * 0.9, n=8)
    tool((0.2, -0.4, 0), (0.3, 0.2, 1.3), "shovel")
    tool((2.8, 2.6, 0.0), (3.9, 2.8, 0.1), "pick")
    basket((-2.2, -2.8, 0), 0.26, 0.4, fill="spoil")


def build2():
    ground_pad(0.0, 0.0, 5.2, 4.2, "mud", h=0.03)
    shaft()
    windlass(stage="frame")
    ore_shed(stage="frame")
    spoil_heap(3.35, -2.1)
    # ladder down the shaft, spare planks
    for s in (-0.18, 0.18):
        beam(B("pole"), (SHX + s, SHY + 0.2, 0.0), (SHX + s, SHY + 0.55, 1.6), 0.05, 0.05, 0.0)
    for k in range(1, 6):
        t = k / 6
        beam(B("pole"), (SHX - 0.18, SHY + 0.2 + 0.35 * t, 1.6 * t), (SHX + 0.18, SHY + 0.2 + 0.35 * t, 1.6 * t), 0.03, 0.03, 0.0)
    plank_stack(-3.9, -2.6, 3.0, 0.9, 3, pw=0.27, pt=0.035, along_x=True, mat="plank")
    tool_rack(2.7, 2.95, 1.8)


def ruin():
    ground_pad(0.0, 0.0, 5.2, 4.2, "mud", h=0.03)
    ground_pad(-2.9, 2.0, 2.4, 2.0, "ash", h=0.05)
    shaft()
    windlass(stage="burnt")
    ore_shed(stage="burnt")
    # ore bins spilled, now open to the sky
    for (x, s) in ((HX0 + 0.58, 0.45), (HX0 + 1.72, 0.55), (HX0 + 2.9, 0.35)):
        mound(B("ore"), x, (HY0 + HY1) / 2 + 0.2, 0.62, 1.4, s, rings=4, segs=16, noise=0.2, power=1.3, lumpy=0.03)
    spoil_heap(3.35, -2.1)
    sledge(Vector((-1.6, -2.4, 0)), rot=1.2)
    rubble_heap(-3.0, 1.9, 1.6, 1.4, 0.35, 18, "ash")
    for (x, y) in ((-3.7, -0.6), (-2.9, -1.1)):
        cyl(B("wicker"), (x, y, 0), (x, y, 0.15), 0.24, 0.26, n=10)
        ore_lumps(x, y, 0.5, 6)
    for i in range(4):
        tool((R.uniform(1.5, 4.0), R.uniform(2.3, 3.6), 0.02), (R.uniform(1.5, 4.0), R.uniform(2.3, 3.6), 0.05),
             R.choice(("pick", "shovel")))


build_materials(extra)
{"complete": complete, "build1": build1, "build2": build2, "ruin": ruin}[STATE]()
run("mining_camp", tex=2048)
