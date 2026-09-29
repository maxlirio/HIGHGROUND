"""HIGHGROUND - lumber camp, footprint 10 x 8 m.

An open sawpit (spoil banks, plank-lined sides, two transoms carrying a dogged oak log half
sawn into boards, the long pit saw standing in the kerf), a stickered stack of sawn planks,
a pyramid log pile with sawn end grain, a trestle (sawbuck) with a log for cross-cutting,
an axe block in a litter of chips, cordwood, and a rough pole shelter roofed with bark slabs.

    blender -b -P assets/src/lumber_camp.py -- [complete|build1|build2|ruin]

Front faces -Y. 1 unit = 1 m.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _craft import *

seed(59)

PX0, PX1 = -3.3, 1.5          # sawpit inner x
PY0, PY1 = -0.45, 0.8         # sawpit inner y
RIM = 0.4                     # spoil bank height at the pit edge
SX0, SX1, SY0, SY1 = 1.9, 4.7, 1.5, 3.8   # shelter


def extra(M, ch):
    M["sawdust"] = m_heap("sawdust", [(0.1, "#8a7152"), (0.5, "#a78a62"), (0.9, "#b99c70")], 40.0, rough=0.95)
    M["forest"] = m_heap("forest", [(0.1, "#43372a"), (0.45, "#554532"), (0.8, "#62513b")], 8.0, pebble=0.2,
                         grass=0.7, moss=0.3)
    M["spoil"] = m_heap("spoil", [(0.1, "#4d3d2c"), (0.5, "#5e4a35"), (0.9, "#6e5a41")], 11.0, pebble=0.45, grass=0.35)
    M["barkroof"] = m_bark("barkroof", [(0.0, "#4c3f33"), (0.5, "#5b4b3d"), (1.0, "#6a5847")], lichen=0.8, charred=ch,
                           fis_amt=0.45, stretch=0.35)
    M["pinebark"] = m_bark("pinebark", [(0.0, "#5a4230"), (0.5, "#6b4f38"), (1.0, "#7a5c42")], lichen=0.3, charred=ch)


# ------------------------------------------------------------------ sawpit
def sawpit(stage="complete"):
    cx, cy = (PX0 + PX1) / 2, (PY0 + PY1) / 2
    # spoil banked around the pit: four long mounds
    for (mx, my, rx, ry) in ((cx, PY0 - 0.55, (PX1 - PX0) / 2 + 0.9, 0.75), (cx, PY1 + 0.55, (PX1 - PX0) / 2 + 0.9, 0.75),
                             (PX0 - 0.55, cy, 0.8, (PY1 - PY0) / 2 + 0.6), (PX1 + 0.55, cy, 0.8, (PY1 - PY0) / 2 + 0.6)):
        mound(B("spoil"), mx, my, rx, ry, RIM + 0.05, rings=4, segs=18, noise=0.1, power=2.2)
    # plank-lined pit walls (inner faces) from the rim down to a dark floor
    fz = 0.02
    box(B("dark"), (PX0 - 0.05, PY0 - 0.05, 0), (PX1 + 0.05, PY1 + 0.05, fz))
    lined = stage != "b1"
    walls = ((PX0, PY0 - 0.08, PX1, PY0), (PX0, PY1, PX1, PY1 + 0.08), (PX0 - 0.08, PY0, PX0, PY1), (PX1, PY0, PX1 + 0.08, PY1))
    for (x0, y0, x1, y1) in walls:
        # earth behind the lining so the bank has a hard inner edge
        box(B("spoil"), (x0 - (0.3 if x1 - x0 < 0.2 and x0 < cx else 0), y0 - (0.3 if y1 - y0 < 0.2 and y0 < cy else 0), 0),
            (x1 + (0.3 if x1 - x0 < 0.2 and x0 > cx else 0), y1 + (0.3 if y1 - y0 < 0.2 and y0 > cy else 0), RIM - 0.02))
        if not lined:
            continue
        along_x = (x1 - x0) > (y1 - y0)
        for z in (0.03, 0.2):
            if along_x:
                yy = y1 + 0.01 if y0 < cy else y0 - 0.01
                beam(B("plank"), (x0, yy, z + 0.08), (x1, yy + jit(0.01), z + 0.08 + jit(0.01)), 0.17, 0.035, 0.004,
                     side=(0, 1, 0))
            else:
                xx = x1 + 0.01 if x0 < cx else x0 - 0.01
                beam(B("plank"), (xx, y0, z + 0.08), (xx + jit(0.01), y1, z + 0.08), 0.17, 0.035, 0.004, side=(1, 0, 0))
    # corner stakes holding the lining
    for (x, y) in ((PX0, PY0), (PX1, PY0), (PX0, PY1), (PX1, PY1)):
        cyl(B("pole"), (x, y, 0), (x + jit(0.02), y + jit(0.02), RIM + 0.12), 0.05, 0.04, n=6)
    if stage == "b1":
        return
    # transoms across the pit carrying the log
    tr = (PX0 + 0.8, PX1 - 1.0)
    for x in tr:
        beam(B("oak"), (x, PY0 - 0.6, RIM + 0.1), (x + jit(0.03), PY1 + 0.6, RIM + 0.1), 0.22, 0.2, 0.012)
    if stage == "frame":
        return
    burnt = stage == "burnt"
    # the log: bark on, one end squared and sawn into boards up to the saw
    lz = RIM + 0.2 + 0.3
    ly = cy
    xa, xb = PX0 - 0.6, PX1 + 0.4
    xs = -0.35                               # saw position; boards sawn from xb back to xs
    log((xa, ly, lz), (xs, ly, lz), 0.3, 0.28, n=12, ends=(True, False), bulge=0.01)
    # squared cant + boards separating at the sawn end
    nb = 5
    for i in range(nb):
        yy = ly - 0.26 + i * 0.13
        spread = (i - (nb - 1) / 2) * 0.03
        beam(B("fresh"), (xs - 0.02, yy, lz), (xb, yy + spread, lz - abs(spread) * 0.5), 0.09, 0.5, 0.004,
             side=(0, 0, 1))
    # dog irons pinning the log to the transoms
    for x in tr:
        for s in (-1, 1):
            beam(B("iron"), (x, ly + s * 0.45, RIM + 0.22), (x, ly + s * 0.25, lz + 0.05), 0.03, 0.03, 0.0)
    # the pit saw standing in the kerf: tiller handle on top, box handle in the pit
    if not burnt:
        bx = xs + 0.02
        beam(B("iron"), (bx, ly, 0.35), (bx, ly, lz + 1.55), 0.22, 0.01, 0.0, side=(1, 0, 0))
        beam(B("oak"), (bx, ly - 0.25, lz + 1.6), (bx, ly + 0.25, lz + 1.6), 0.06, 0.06, 0.004)
        beam(B("oak"), (bx, ly, lz + 1.5), (bx, ly, lz + 1.66), 0.05, 0.05, 0.0)
        beam(B("oak"), (bx, ly - 0.22, 0.3), (bx, ly + 0.22, 0.3), 0.05, 0.05, 0.004)
        beam(B("oak"), (bx, ly - 0.2, 0.3), (bx, ly - 0.2, 0.62), 0.04, 0.04, 0.0)
        beam(B("oak"), (bx, ly + 0.2, 0.3), (bx, ly + 0.2, 0.62), 0.04, 0.04, 0.0)
    # sawdust spilled in the pit and on the banks
    mound(B("sawdust"), xs - 0.1, ly, 0.9, 0.5, 0.06, rings=3, segs=12, noise=0.3, z0=0.0)


def trestle(cx, cy, rot=0.0, with_log=True):
    M = TRS((cx, cy, 0), (0, 0, rot))
    for dx in (-0.55, 0.55):
        for s in (-1, 1):
            beam(B("pole"), M @ Vector((dx, s * 0.35, 0)), M @ Vector((dx + 0.02, -s * 0.12, 0.95)), 0.08, 0.08, 0.006)
    beam(B("pole"), M @ Vector((-0.7, 0, 0.72)), M @ Vector((0.7, 0, 0.72)), 0.07, 0.07, 0.006)
    if with_log:
        log(M @ Vector((0.0, -1.3, 0.93)), M @ Vector((0.05, 1.1, 0.95)), 0.2, 0.18, n=10)


def plank_pile():
    plank_stack(-3.1, -3.4, 3.4, 1.25, 6, pw=0.27, pt=0.045, along_x=True, mat="fresh")
    # a second, older weathered stack
    plank_stack(1.2, -3.5, 2.6, 1.0, 4, pw=0.3, pt=0.05, along_x=True, mat="plank")


def log_pile_big(x0, y0, length=4.2):
    """pyramid of logs on skids, ends toward +/-x so the end grain shows."""
    for yy in (y0 - 0.2, y0 + 1.25):
        beam(B("pole"), (x0 - 0.1, yy, 0.07), (x0 + length * 0.9, yy + jit(0.1), 0.07), 0.13, 0.13, 0.008)
    rows = [(5, 0.25), (4, 0.24), (3, 0.22)]
    z = 0.14
    for ri, (n, r) in enumerate(rows):
        for i in range(n):
            yy = y0 - 0.25 + ri * 0.26 + i * 0.52 + jit(0.02)
            ln = length * R.uniform(0.86, 1.0)
            xs = x0 + jit(0.25)
            rr = r * R.uniform(0.85, 1.1)
            log((xs, yy, z + rr), (xs + ln, yy + jit(0.05), z + rr * 0.95), rr, rr * 0.88, n=10,
                bark=R.choice(("bark", "pinebark")))
        z += rows[ri][1] * 1.7


def axe_block(cx, cy):
    stump((cx, cy, 0), 0.34, 0.55)
    # felling axe buried in the block
    p = Vector((cx + 0.05, cy - 0.05, 0.57))
    beam(B("iron"), p, p + Vector((0.12, 0.0, 0.08)), 0.03, 0.14, 0.004, side=(0, 1, 0))
    cyl(B("pole"), p + Vector((0.1, 0, 0.06)), p + Vector((0.65, -0.3, 0.55)), 0.02, n=6)
    # a split billet on top
    beam(B("fresh"), (cx - 0.15, cy + 0.1, 0.56), (cx - 0.15, cy + 0.1, 0.9), 0.12, 0.1, 0.006)
    # chips everywhere
    for i in range(40):
        a = R.uniform(0, 6.28)
        rr = R.uniform(0.3, 1.2) ** 1.2
        x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
        s = R.uniform(0.04, 0.09)
        box(B("fresh"), (x - s, y - s * 0.5, 0.0), (x + s, y + s * 0.5, 0.025), 0.0, rot=(jit(0.3), jit(0.3), R.uniform(0, 3)))
    mound(B("sawdust"), cx, cy, 1.1, 0.9, 0.035, rings=3, segs=14, noise=0.35)


def cordwood(x0, y0, length=1.8):
    """split firewood stacked between end stakes."""
    for x in (x0, x0 + length):
        cyl(B("pole"), (x, y0, 0), (x + jit(0.03), y0 + jit(0.03), 1.1), 0.045, n=6)
        cyl(B("pole"), (x, y0 + 0.55, 0), (x + jit(0.03), y0 + 0.55, 1.1), 0.045, n=6)
    z = 0.06
    for row in range(6):
        x = x0 + 0.06
        while x < x0 + length - 0.1:
            r = R.uniform(0.055, 0.08)
            beam(B("fresh"), (x + r, y0 - 0.02, z + r), (x + r + jit(0.02), y0 + 0.58, z + r + jit(0.02)), r * 2,
                 r * 1.6, 0.006, side=(1, 0, 1) if R.random() < 0.5 else (0, 0, 1))
            x += r * 2 + 0.01
        z += 0.15


def shelter(stage="complete"):
    """rough pole lean-to roofed with bark slabs, open to the front."""
    zf, zb = 2.2, 1.45
    posts = [(SX0, SY0), (SX1, SY0), (SX0, SY1), (SX1, SY1), ((SX0 + SX1) / 2, SY0)]
    burnt = stage == "burnt"
    for (x, y) in posts:
        top = zf if y == SY0 else zb
        if burnt:
            top = top * R.uniform(0.3, 0.9)
        cyl(B("pole"), (x, y, 0), (x + jit(0.04), y + jit(0.04), top), 0.075, 0.06, n=7)
    if burnt:
        # roof collapsed: bark slabs and poles in a charred heap
        for i in range(14):
            x = R.uniform(SX0, SX1)
            y = R.uniform(SY0, SY1)
            a = R.uniform(-0.4, 0.4)
            beam(B("barkroof"), (x, y, 0.05 + R.uniform(0, 0.25)), (x + math.sin(a) * 1.2, y + math.cos(a) * 1.2, 0.05),
                 0.3, 0.03, 0.004, side=(0, 0, 1))
        return
    # plates
    cyl(B("pole"), (SX0 - 0.25, SY0, zf), (SX1 + 0.25, SY0, zf + jit(0.03)), 0.07, n=7)
    cyl(B("pole"), (SX0 - 0.25, SY1, zb), (SX1 + 0.25, SY1, zb), 0.065, n=7)
    slope = (zf - zb) / (SY1 - SY0)
    rz_ = lambda y, off: zf + off - slope * (y - SY0)
    for x in grid(SX0 - 0.1, SX1 + 0.1, 0.55):
        cyl(B("pole"), (x, SY0 - 0.45, rz_(SY0 - 0.45, 0.1)), (x + jit(0.05), SY1 + 0.35, rz_(SY1 + 0.35, 0.1)),
            0.04, n=5)
    if stage == "frame":
        return
    # bark slabs, lapped, running down the slope
    x = SX0 - 0.3
    d = Vector((0, (SY1 + 0.45) - (SY0 - 0.55), rz_(SY1 + 0.45, 0.17) - rz_(SY0 - 0.55, 0.17)))
    x = SX0 - 0.35
    k = 0
    while x < SX1 + 0.35:
        w = R.uniform(0.3, 0.42)
        lift = 0.035 if k % 2 else 0.0
        y0_ = SY0 - 0.55 + jit(0.08)
        p0 = Vector((x + w / 2, y0_, rz_(y0_, 0.17) + lift))
        p1 = p0 + d + Vector((jit(0.06), jit(0.1), 0))
        beam(B("barkroof"), p0, p1, w, 0.03, 0.006, side=Vector((0, -d.z, d.y)).normalized(), twist=jit(0.04))
        x += w * 0.8
        k += 1
    # weight poles on the roof
    for t in (0.3, 0.75):
        p = Vector((0, SY0 - 0.55, rz_(SY0 - 0.55, 0.28))) + d * t
        cyl(B("pole"), (SX0 - 0.3, p.y, p.z), (SX1 + 0.3, p.y + jit(0.05), p.z), 0.05, n=6)
    # inside: a bench, a grindstone-less whetting block, spare tools leaning
    beam(B("plank"), (SX0 + 0.3, SY1 - 0.4, 0.45), (SX1 - 0.3, SY1 - 0.4, 0.45), 0.3, 0.06, 0.006, side=(0, 0, 1))
    for x in (SX0 + 0.45, SX1 - 0.45):
        beam(B("pole"), (x, SY1 - 0.4, 0), (x, SY1 - 0.4, 0.42), 0.08, 0.08, 0.006)
    tool((SX1 - 0.25, SY1 - 0.2, 0), (SX1 - 0.3, SY1 - 0.05, 1.3), "axe")
    tool((SX1 - 0.55, SY1 - 0.2, 0), (SX1 - 0.6, SY1 - 0.05, 1.3), "axe")
    # a spare pit saw hung on the back plate
    beam(B("iron"), (SX0 + 0.3, SY1 - 0.02, 1.3), (SX1 - 0.3, SY1 - 0.02, 1.25), 0.14, 0.006, 0.0, side=(0, 1, 0))
    # cant hook / lever pole
    cyl(B("pole"), (SX0 + 0.1, SY0 + 0.2, 0), (SX0 + 0.05, SY0 + 0.6, 1.5), 0.03, n=6)


# ------------------------------------------------------------------ states
def complete():
    ground_pad(0.0, 0.1, 5.2, 4.2, "forest", h=0.03)
    ground_pad(-1.0, 0.1, 3.8, 1.9, "sawdust", h=0.02, rot=0.05)
    sawpit()
    log_pile_big(-4.6, 2.35, 4.4)
    plank_pile()
    trestle(4.0, -0.9, rot=0.2)
    axe_block(3.0, 0.65)
    cordwood(SX0 + 0.1, SY1 + 0.05, 2.4)
    shelter()


def build1():
    ground_pad(0.0, 0.1, 5.2, 4.2, "forest", h=0.03)
    # pit being dug: spoil in one heap, stakes and line around the rest
    mound(B("spoil"), -1.0, PY0 - 0.7, 2.2, 0.7, 0.45, noise=0.15)
    box(B("dark"), (PX0, PY0, 0), (-0.8, PY1, 0.02))
    for (x, y) in ((PX0, PY0), (PX1, PY0), (PX0, PY1), (PX1, PY1), (SX0, SY0), (SX1, SY0), (SX0, SY1), (SX1, SY1)):
        cyl(B("pole"), (x, y, 0), (x + jit(0.02), y + jit(0.02), 0.7), 0.035, 0.02, n=5)
    for (a, b) in (((PX0, PY0), (PX1, PY0)), ((PX1, PY0), (PX1, PY1)), ((PX1, PY1), (PX0, PY1)), ((PX0, PY1), (PX0, PY0))):
        beam(B("rope"), (a[0], a[1], 0.6), (b[0], b[1], 0.6), 0.012, 0.012, 0.0)
    tool((-0.4, 0.2, 0), (-0.3, 0.9, 1.3), "shovel")
    tool((0.8, -0.2, 0.0), (1.6, -0.1, 0.12), "mattock")
    # bundles of bark slabs peeled for the shelter roof
    for i in range(6):
        beam(B("barkroof"), (2.2 + jit(0.1), -2.2 + i * 0.05, 0.03 + i * 0.03), (4.2 + jit(0.1), -2.3 + i * 0.05, 0.03 + i * 0.03),
             0.38, 0.03, 0.004, side=(0, 0, 1))
    # first logs hauled in
    for i in range(3):
        rr = R.uniform(0.2, 0.26)
        log((-4.4 + jit(0.2), 2.4 + i * 0.55, rr), (-0.4 + jit(0.2), 2.4 + i * 0.55, rr), rr, rr * 0.9, n=10)
    for k in range(5):
        cyl(B("pole"), (1.9, -3.2 + k * 0.18, 0.05), (4.8, -3.2 + k * 0.18 + jit(0.1), 0.05), 0.05, n=6)
    axe_block(3.0, 0.65)


def build2():
    ground_pad(0.0, 0.1, 5.2, 4.2, "forest", h=0.03)
    sawpit(stage="frame")
    shelter(stage="frame")
    log_pile_big(-4.6, 2.35, 4.4)
    trestle(4.0, -0.9, rot=0.2, with_log=False)
    axe_block(3.0, 0.65)
    # ladder up to the shelter plate
    q = Vector((SX0 + 0.8, SY0 - 0.9, 0))
    for sx in (-0.2, 0.2):
        beam(B("pole"), q + Vector((sx, 0, 0)), q + Vector((sx, 0.75, 2.3)), 0.05, 0.05, 0.0)
    for k2 in range(1, 8):
        t = k2 / 8
        beam(B("pole"), q + Vector((-0.2, 0.75 * t, 2.3 * t)), q + Vector((0.2, 0.75 * t, 2.3 * t)), 0.03, 0.03, 0.0)
    # lining boards waiting
    plank_stack(-3.0, -3.4, 3.0, 1.0, 3, pw=0.25, pt=0.04, along_x=True, mat="fresh")
    for i in range(8):
        x = SX0 + (i % 4) * 0.7
        beam(B("barkroof"), (x, -2.2 + (i // 4) * 0.4, 0.04 + (i // 4) * 0.03), (x + 0.4, -3.4 + (i // 4) * 0.4, 0.04),
             0.33, 0.03, 0.004, side=(0, 0, 1))


def ruin():
    ground_pad(0.0, 0.1, 5.2, 4.2, "forest", h=0.03)
    ground_pad(2.8, 1.8, 2.4, 2.2, "ash", h=0.05)
    ground_pad(-2.2, 2.9, 2.8, 1.3, "ash", h=0.04)
    sawpit(stage="burnt")
    shelter(stage="burnt")
    # the log pile burnt down to a few charred logs scattered
    for i in range(5):
        rr = R.uniform(0.18, 0.25)
        x0 = -4.5 + jit(0.4)
        y0 = 2.2 + i * 0.35 + jit(0.2)
        a = jit(0.5)
        log((x0, y0, rr), (x0 + math.cos(a) * 3.2, y0 + math.sin(a) * 3.2, rr), rr, rr * 0.85, n=9, bark="pinebark")
    rubble_heap(-2.2, 2.8, 1.8, 0.9, 0.3, 18, "ash")
    # plank stack collapsed, charred
    for i in range(16):
        x, y = R.uniform(-3.2, 0.2), R.uniform(-3.6, -2.1)
        a = jit(0.5)
        beam(B("oak"), (x, y, 0.03 + R.uniform(0, 0.15)), (x + math.cos(a) * 2.4, y + math.sin(a) * 2.4, 0.03 + R.uniform(0, 0.2)),
             0.26, 0.045, 0.004, side=(0, 0, 1))
    stump((3.0, 0.65, 0), 0.34, 0.55)
    trestle(4.0, -0.9, rot=0.9, with_log=False)


build_materials(extra)
{"complete": complete, "build1": build1, "build2": build2, "ruin": ruin}[STATE]()
run("lumber_camp", tex=2048)
