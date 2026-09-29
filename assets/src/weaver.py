"""HIGHGROUND - weaver's workshop, footprint 8 x 7 m.

A box-framed cottage workshop (oak frame, wattle-and-daub panels, rubble sill wall) under a
thick long-straw thatch with a block-cut scalloped ridge. On the east gable an open-fronted
board-roofed lean-to shelters a warp-weighted loom (leaning uprights, cloth beam with the web
rolled on it, heddle rod on its brackets, rows of clay loom weights). In the yard: dye vats
in muted madder red, woad blue and weld yellow, a dye cauldron over a fire ring, a drying
pole hung with dyed cloth and hanks, and wool bales / packs.

    blender -b -P assets/src/weaver.py -- [complete|build1|build2|ruin]

Front faces -Y. 1 unit = 1 m.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _craft import *

seed(47)

CX0, CX1 = -3.55, 0.95        # cottage frame (outer sill line)
CY0, CY1 = -1.2, 3.0
SILL = 0.45                   # rubble sill wall height
PLATE = 2.75                  # wall plate
PITCH = math.radians(52)
LX1 = 3.85                    # lean-to outer post line
LY0, LY1 = -1.35, 3.0


def extra(M, ch):
    M["thatch"] = m_thatch("thatch", moss=0.55, tones=[(0.0, "#66573f"), (0.35, "#7a6849"), (0.7, "#8f7a54"), (1.0, "#a18b5e")],
                           charred=ch)
    M["thatch_ridge"] = m_thatch("thatch_ridge", [(0.0, "#80704a"), (0.5, "#957f52"), (1.0, "#a48d5a")], charred=ch,
                                 moss=0.4)
    M["wool"] = m_wool("wool", [(0.2, "#9a907c"), (0.55, "#b1a78f"), (0.9, "#bfb59c")])
    M["sacking"] = m_cloth("sacking", "#7d6e55", "#8f7f62", weave=160.0)
    M["madder"] = m_cloth("madder", "#74402f", "#86503b", weave=220.0, dirt=0.15)
    M["woad"] = m_cloth("woad", "#3f5068", "#51637a", weave=220.0, dirt=0.15)
    M["undyed"] = m_cloth("undyed", "#a79c83", "#b7ad94", weave=220.0, dirt=0.2)
    M["weld"] = m_cloth("weld", "#8f7f45", "#9c8c52", weave=220.0, dirt=0.15)
    M["dye_red"] = m_liquid("dye_red", "#4e2620", "#63332a", 0.1)
    M["dye_blue"] = m_liquid("dye_blue", "#26303f", "#34435a", 0.1)
    M["dye_yel"] = m_liquid("dye_yel", "#5a4f2a", "#6d6035", 0.12)
    M["clay"] = m_heap("clay", [(0.1, "#7a5b42"), (0.5, "#8c6a4d"), (0.9, "#9a7a5a")], 30.0)
    M["web"] = m_warp("web", "#7c4636", "#4b5b73", "#b3a88f", 0.18)
    M["yard"] = m_heap("yard", [(0.1, "#4a3c2d"), (0.5, "#5b4a37"), (0.9, "#6a5840")], 9.0, pebble=0.3, grass=0.6)


# ------------------------------------------------------------------ cottage
def cottage(stage="complete"):
    char = stage == "burnt"
    frame_only = stage == "frame"
    keep = 0.6 if char else 1.0
    # rubble sill wall
    box(B("rubble"), (CX0 - 0.12, CY0 - 0.12, 0), (CX1 + 0.12, CY1 + 0.12, SILL), 0.03)
    oak = B("oak")
    for (p0, p1) in (((CX0, CY0 + 0.1, SILL + 0.1), (CX1, CY0 + 0.1, SILL + 0.1)),
                     ((CX0, CY1 - 0.1, SILL + 0.1), (CX1, CY1 - 0.1, SILL + 0.1)),
                     ((CX0 + 0.1, CY0, SILL + 0.1), (CX0 + 0.1, CY1, SILL + 0.1)),
                     ((CX1 - 0.1, CY0, SILL + 0.1), (CX1 - 0.1, CY1, SILL + 0.1))):
        beam(oak, p0, p1, 0.22, 0.2, 0.015, ext=0.1)
    ff = Face((CX0, CY0, 0), (0, -1, 0))
    fb = Face((CX1, CY1, 0), (0, 1, 0))
    fw = Face((CX0, CY1, 0), (-1, 0, 0))
    fe = Face((CX1, CY0, 0), (1, 0, 0))
    Lf = CX1 - CX0
    Ld = CY1 - CY0
    z0, z1 = SILL + 0.2, PLATE
    mid = 1.65
    if frame_only:
        for f, L_ in ((ff, Lf), (fb, Lf), (fw, Ld), (fe, Ld)):
            for u in grid(0.1, L_ - 0.1, 1.5):
                f.timber(oak, u, z0, u, z1, 0.2, 0.18)
            f.timber(oak, 0.0, mid, L_, mid, 0.18, 0.18)
            f.timber(oak, 0.0, z1 + 0.1, L_, z1 + 0.1, 0.2, 0.2)
            f.timber(oak, 0.15, z0 + 0.1, 1.1, mid - 0.1, 0.15, 0.14)
            f.timber(oak, L_ - 0.15, z0 + 0.1, L_ - 1.1, mid - 0.1, 0.15, 0.14)
        return
    ops_f = [(1.1, 2.05, z0, 2.4, "door"), (3.0, 3.85, 1.35, 2.2, "win")]
    posts_f = [0.1, 1.0, 2.15, 2.9, 3.95, Lf - 0.1]
    br_f = [(2.2, mid + 0.05, 2.85, z1 - 0.05), (0.15, z0 + 0.05, 0.95, mid - 0.05)]
    frame_face(ff, Lf, z0, z1, posts_f, [mid, z1 + 0.1], ops_f, br_f, char=char, keep_frac=keep, slab=not char)
    frame_face(fb, Lf, z0, z1, [0.1, 1.5, 3.0, Lf - 0.1], [mid, z1 + 0.1], [(1.8, 1.35, 2.6, 2.2, "win")],
               [(0.15, z0 + 0.05, 1.45, mid - 0.05)], char=char, keep_frac=keep, slab=not char)
    frame_face(fw, Ld, z0, z1, [0.1, 1.4, 2.8, Ld - 0.1], [mid, z1 + 0.1], [(1.65, 1.35, 2.5, 2.2, "win")],
               [(0.15, mid + 0.05, 1.35, z1 - 0.05), (Ld - 0.15, z0 + 0.05, 2.85, mid - 0.05)], char=char,
               keep_frac=keep, slab=not char)
    frame_face(fe, Ld, z0, z1, [0.1, 1.4, 2.8, Ld - 0.1], [mid, z1 + 0.1], [(1.3, 2.3, z0, 2.3, "door")],
               [(0.15, z0 + 0.05, 1.3, mid - 0.05), (Ld - 0.15, mid + 0.05, 2.9, z1 - 0.05)], char=char,
               keep_frac=keep, slab=not char)
    if char:
        # daub panels burnt out: only ragged lower remnants survive between the charred studs
        for f, L_ in ((ff, Lf), (fb, Lf), (fw, Ld), (fe, Ld)):
            u = 0.0
            while u < L_ - 0.1:
                w = min(R.uniform(0.35, 0.9), L_ - u)
                if R.random() < 0.7:
                    top = z0 + R.uniform(0.2, 1.3)
                    f.box(B("daub"), u, u + w, 0.05, 0.2, z0, top, 0.02, tilt=jit(0.04))
                u += w + R.uniform(0.0, 0.25)
    if not char:
        half = Ld / 2
        rz = PLATE + 0.2 + half * math.tan(PITCH)
        gable_face(fw, 0.0, Ld, PLATE + 0.2, rz - 0.5, Ld / 2)
        gable_face(Face((CX1, CY0, 0), (1, 0, 0)), 0.0, Ld, PLATE + 0.2, rz - 0.5, Ld / 2)


def cottage_roof(stage="complete"):
    ry = (CY0 + CY1) / 2
    half = (CY1 - CY0) / 2
    base = PLATE + 0.22
    rz = base + half * math.tan(PITCH)
    oak = B("oak")
    # tie beams + rafters (seen under the eaves and in build/ruin states)
    for x in grid(CX0 + 0.05, CX1 - 0.05, 0.9 if stage != "frame" else 0.9):
        if stage == "burnt" and R.random() < 0.5:
            continue
        beam(oak, (x, CY0 - 0.15, PLATE + 0.12), (x + (jit(0.2) if stage == "burnt" else 0), CY1 + 0.15,
             PLATE + 0.12 - (R.uniform(0, 0.6) if stage == "burnt" else 0)), 0.18, 0.2, 0.012, side=(0, 0, 1))
        for sgn in (-1, 1):
            ye = ry + sgn * (half + 0.5)
            p0 = Vector((x, ye, base - 0.5 * math.tan(PITCH) - 0.06))
            p1 = Vector((x, ry, rz - 0.06))
            if stage == "burnt":
                if R.random() < 0.45:
                    continue
                p1 = p0.lerp(p1, R.uniform(0.35, 1.0))
            beam(oak, p0, p1, 0.1, 0.12, 0.008, side=(1, 0, 0))
    if stage == "frame":
        beam(oak, (CX0 - 0.1, ry, rz - 0.08), (CX1 + 0.1, ry, rz - 0.08), 0.12, 0.16, 0.01)
        for sgn in (-1, 1):
            for t in (0.2, 0.45, 0.7, 0.9):
                y = ry + sgn * half * (1 - t)
                z = base + half * t * math.tan(PITCH)
                cyl(B("pole"), (CX0 - 0.35, y, z + 0.04), (CX1 + 0.35, y + jit(0.03), z + 0.04), 0.03, n=5)
        return
    if stage == "burnt":
        # the thatch fell in and burnt: charred heaps of straw inside and slumped over the sill
        mound(B("thatch"), (CX0 + CX1) / 2 - 0.6, ry - 0.2, 1.6, 1.5, 0.55, rings=5, segs=18, noise=0.25, lumpy=0.06)
        mound(B("thatch"), CX0 + 0.5, CY1 + 0.5, 1.0, 0.6, 0.35, rings=4, segs=14, noise=0.3, lumpy=0.05)
        return
    gable_roof_thatch(CX0, CX1, CY0, CY1, base, PITCH, over=0.5, overx=0.42, thick=0.4)


def leanto(stage="complete"):
    oak = B("oak")
    zlo, zhi = 2.15, 3.05
    posts = [LY0 + 0.1, 0.85, LY1 - 0.1]
    burnt = stage == "burnt"
    for y in posts:
        box(B("ashlar"), (LX1 - 0.2, y - 0.2, 0), (LX1 + 0.2, y + 0.2, 0.16), 0.02, rot=(0, 0, jit(0.1)))
        top = zlo if not burnt else R.uniform(0.7, 1.9)
        beam(oak, (LX1, y, 0.16), (LX1 + jit(0.03), y, top), 0.18, 0.18, 0.012)
        if not burnt and stage != "b1":
            beam(oak, (LX1, y, zlo - 0.6), (LX1, y + (0.55 if y < 2 else -0.55), zlo - 0.02), 0.1, 0.12, 0.008,
                 side=(1, 0, 0), ext=0.03)
    if burnt:
        return
    beam(oak, (LX1, LY0 - 0.15, zlo + 0.09), (LX1, LY1 + 0.1, zlo + 0.09), 0.18, 0.2, 0.012)
    beam(oak, (CX1 + 0.12, LY0 - 0.15, zhi - 0.1), (CX1 + 0.12, LY1 + 0.1, zhi - 0.1), 0.16, 0.16, 0.012)
    for y in grid(LY0 - 0.1, LY1, 0.75):
        beam(oak, (CX1 + 0.1, y, zhi), (LX1 + 0.3, y, zlo + 0.02), 0.09, 0.12, 0.008, side=(0, 0, 1))
    if stage == "frame":
        return
    Mr = Matrix(((0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))
    roof_rows(B("shingle"), Mr, -(LY1 + 0.25), -(LY0 - 0.3), (LX1 + 0.38, zlo + 0.02),
              (CX1 + 0.48, zhi + 0.1 - 0.38 * (zhi - zlo) / (LX1 - CX1)),
              row_w=0.3, thick=0.03, lift=0.03, sag=0.05, seg=6)
    # boarded back (north) wall
    for x in grid(CX1 + 0.1, LX1, 0.27, 0.0)[:-1]:
        h = zhi - (zhi - zlo) * (x - CX1) / (LX1 - CX1)
        beam(B("plank"), (x + 0.13, LY1 + 0.02, 0.05), (x + 0.13 + jit(0.01), LY1 + 0.02, h + jit(0.03)),
             0.26 * R.uniform(0.9, 1.05), 0.035, 0.006, side=(0, 1, 0))


def loom(stage="complete"):
    """warp-weighted loom leaning back against the lean-to rafters, facing the front (-Y)."""
    oak = B("oak")
    x0, x1 = 1.45, 3.35
    yf, yt = LY0 + 0.35, LY0 + 0.95
    H = 2.25
    collapsed = stage == "burnt"
    if collapsed:
        # uprights fallen forward, weights scattered
        beam(oak, (x0, yf, 0.1), (x0 + 0.3, yf - 1.8, 0.12), 0.1, 0.12, 0.008)
        beam(oak, (x1, yf, 0.1), (x1 - 0.2, yf - 1.7, 0.4), 0.1, 0.12, 0.008)
        cyl(B("pole"), (x0 - 0.1, yf - 1.2, 0.18), (x1 + 0.2, yf - 1.4, 0.25), 0.06, n=7)
        for i in range(18):
            x, y = R.uniform(x0, x1), R.uniform(yf - 1.4, yf + 0.2)
            cyl(B("clay"), (x, y, 0.0), (x, y, 0.06), 0.055, n=7)
        return
    for x in (x0, x1):
        beam(oak, (x, yf, 0), (x, yt, H), 0.11, 0.13, 0.008)
    d = Vector((0, yt - yf, H)).normalized()
    top = Vector((0, yt, H)) - d * 0.12
    # cloth beam with the woven web rolled on it
    cyl(B("pole"), (x0 - 0.18, top.y, top.z), (x1 + 0.18, top.y, top.z), 0.055, n=8)
    cyl(B("madder"), (x0 + 0.08, top.y, top.z), (x1 - 0.08, top.y, top.z), 0.1, n=10)
    # heddle rod on forked brackets, shed rod lower down
    for x in (x0, x1):
        p = Vector((x, yf, 0)).lerp(Vector((x, yt, H)), 0.58)
        beam(oak, p, p + Vector((0, -0.28, 0.02)), 0.05, 0.05, 0.0)
    ph = Vector((0, yf, 0)).lerp(Vector((0, yt, H)), 0.58) + Vector((0, -0.26, 0.05))
    cyl(B("pole"), (x0 - 0.08, ph.y, ph.z), (x1 + 0.08, ph.y, ph.z), 0.025, n=6)
    ps = Vector((0, yf, 0)).lerp(Vector((0, yt, H)), 0.4)
    cyl(B("pole"), (x0, ps.y - 0.05, ps.z), (x1, ps.y - 0.05, ps.z), 0.035, n=6)
    # the web: woven cloth above, bare warp below down to the weights
    wb = Vector((0, yf, 0)).lerp(Vector((0, yt, H)), 0.14)
    wt = top - d * 0.08
    xm = (x0 + x1) / 2
    beam(B("web"), (xm, wb.y - 0.03, wb.z), (xm, wt.y - 0.03, wt.z), x1 - x0 - 0.2, 0.012, 0.0,
         side=Vector((0, 1, -(yt - yf) / H)).normalized())
    # loom weights hanging in bunches
    n = 16
    for i in range(n):
        x = x0 + 0.14 + (x1 - x0 - 0.28) * i / (n - 1)
        zz = wb.z - 0.06 + jit(0.03)
        cyl(B("clay"), (x, wb.y - 0.03, zz - 0.08), (x, wb.y - 0.03, zz + 0.08), 0.07, 0.055, n=7)
        cyl(B("clay"), (x + 0.05, wb.y - 0.05, zz - 0.12), (x + 0.05, wb.y - 0.05, zz + 0.0), 0.05, 0.04, n=6) if i % 3 == 1 else None
    # a stool and a basket of spun yarn in front of the loom
    for (dx, dy) in ((-0.15, -0.12), (0.15, -0.12), (0.0, 0.14)):
        beam(oak, (2.4 + dx, yf - 0.85 + dy, 0), (2.4 + dx * 0.6, yf - 0.85 + dy * 0.6, 0.42), 0.04, 0.04, 0.0)
    cyl(B("plank"), (2.4, yf - 0.85, 0.42), (2.4, yf - 0.85, 0.47), 0.2, n=10)
    wool_basket((1.25, yf - 0.95, 0))


def yealm(x, y, z0):
    """a bundle of straw for thatching: tapered, tied with a band in the middle."""
    cyl(B("thatch_ridge"), (x, y - 0.5, z0 + 0.13), (x + jit(0.05), y + 0.5, z0 + 0.13), 0.1, 0.15, n=8)
    cyl(B("rope"), (x, y - 0.04, z0 + 0.13), (x, y + 0.04, z0 + 0.13), 0.14, n=8)


def wool_basket(p):
    p = Vector(p)
    cyl(B("wicker"), p, p + Vector((0, 0, 0.32)), 0.2, 0.26, n=12)
    for i in range(5):
        a = 2 * math.pi * i / 5
        q = p + Vector((math.cos(a) * 0.1, math.sin(a) * 0.1, 0.33))
        cyl(B("undyed" if i % 2 else "madder"), q - Vector((0.05, 0, 0)), q + Vector((0.05, 0, 0)), 0.06, n=7)


def dye_yard(stage="complete"):
    # three dye vats + a cauldron on a fire ring
    over = stage == "burnt"
    vats = [((-2.9, -2.35), "dye_red", 0.42), ((-1.85, -2.75), "dye_blue", 0.4), ((-0.85, -2.3), "dye_yel", 0.36)]
    for (x, y), liq, r in vats:
        if over and liq == "dye_blue":
            # knocked over, staves sprung
            for i in range(9):
                a = R.uniform(0, 6.28)
                beam(B("plank"), (x + math.cos(a) * 0.3, y + math.sin(a) * 0.3, 0.02),
                     (x + math.cos(a) * 0.3 + R.uniform(-0.3, 0.3), y + math.sin(a) * 0.3 + 0.6, 0.03), 0.09, 0.03, 0.0,
                     side=(0, 0, 1))
            continue
        tub((x, y, 0), r, 0.62, liquid=liq if not over else None, level=0.86)
        # stirring stick
        beam(B("pole"), (x + 0.05, y, 0.4), (x + 0.3, y - 0.35, 1.25), 0.03, 0.03, 0.0)
    # fire ring + cauldron on a tripod
    fx, fy = 0.35, -2.9
    for i in range(9):
        a = 2 * math.pi * i / 9
        s = R.uniform(0.12, 0.17)
        x, y = fx + math.cos(a) * 0.45, fy + math.sin(a) * 0.45
        box(B("rubble"), (x - s, y - s, 0), (x + s, y + s, s * 1.2), 0.03, rot=(jit(0.2), jit(0.2), a))
    mound(B("ash"), fx, fy, 0.35, 0.35, 0.06, rings=2, segs=10)
    if not over:
        for i in range(3):
            a = 2 * math.pi * i / 3 + 0.3
            beam(B("pole"), (fx + math.cos(a) * 0.7, fy + math.sin(a) * 0.7, 0), (fx, fy, 1.45), 0.05, 0.05, 0.0)
        beam(B("iron"), (fx, fy, 1.43), (fx, fy, 0.95), 0.012, 0.012, 0.0)
        cyl(B("iron"), (fx, fy, 0.45), (fx, fy, 0.9), 0.3, 0.33, n=12, bulge=0.04)
        disc(B("dye_red"), (fx, fy, 0.86), (0, 0, 1), 0.3, n=12)
    # drying pole: two forked posts and a pole hung with dyed cloth lengths and hanks
    px0, px1, py = -3.4, -0.2, -3.45
    if not over:
        for x in (px0, px1):
            beam(B("pole"), (x, py, 0), (x + jit(0.04), py, 1.95), 0.08, 0.08, 0.006)
            for s in (-1, 1):
                beam(B("pole"), (x, py, 1.72), (x + s * 0.12, py, 2.02), 0.05, 0.05, 0.0)
        cyl(B("pole"), (px0 - 0.25, py, 1.98), (px1 + 0.25, py, 1.98), 0.035, n=6)
        x = px0 + 0.25
        for k, m in enumerate(("madder", "undyed", "woad", "weld", "madder", "woad")):
            w = R.uniform(0.32, 0.5)
            dz = R.uniform(0.9, 1.3)
            if k % 3 == 1:     # hanks of yarn: bundles
                for j in range(3):
                    cyl(B(m), (x + j * 0.1, py, 1.98), (x + j * 0.1 + jit(0.02), py + jit(0.03), 1.98 - 0.55), 0.035, n=6)
                x += 0.36
                continue
            # cloth folded over the pole: two hanging panels
            for s in (-1, 1):
                beam(B(m), (x + w / 2, py + s * 0.03, 1.98), (x + w / 2 + jit(0.02), py + s * (0.05 + dz * 0.05), 1.98 - dz),
                     w, 0.012, 0.0, side=(0, 1, 0))
            x += w + 0.08
    else:
        beam(B("pole"), (px0, py, 0), (px0, py, 1.1), 0.08, 0.08, 0.006)


def bales(stage="complete"):
    # wool packs and bales against the cottage and inside the lean-to
    spots = [((-3.95, 0.3, 0), 0.0), ((-3.95, 1.25, 0), 0.1), ((-4.0, 0.75, 0.62), 0.3), ((3.25, 2.3, 0), 0.0),
             ((2.35, 2.35, 0), 0.2), ((2.85, 2.35, 0.6), -0.1), ((1.4, -2.55, 0), 0.6)]
    for (p, rot) in spots:
        if stage == "burnt" and R.random() < 0.5:
            continue
        sack(p, 0.62 if abs(p[0]) > 3.5 else 0.85, 0.85 if abs(p[0]) > 3.5 else 0.62, 0.62, "sacking", rot=rot, tie=True)
    # a loose heap of fleece on a hurdle by the lean-to
    if stage != "burnt":
        beam(B("wicker"), (1.35, 1.5, 0.12), (1.35, 2.5, 0.12), 0.95, 0.06, 0.01, side=(0, 0, 1))
        mound(B("wool"), 1.35, 2.0, 0.42, 0.5, 0.3, rings=4, segs=14, noise=0.25, z0=0.13, lumpy=0.04)


# ------------------------------------------------------------------ states
def complete():
    ground_pad(0.1, -0.1, 4.3, 3.8, "yard", h=0.03)
    cottage()
    cottage_roof()
    leanto()
    loom()
    dye_yard()
    bales()


def build1():
    ground_pad(0.1, -0.1, 4.3, 3.8, "yard", h=0.03)
    # sill wall half laid, trench for the rest
    box(B("rubble"), (CX0 - 0.12, CY0 - 0.12, 0), (CX1 + 0.12, CY0 + 0.3, SILL), 0.03)
    box(B("rubble"), (CX0 - 0.12, CY0 - 0.12, 0), (CX0 + 0.3, CY1 + 0.12, SILL * 0.8), 0.03)
    box(B("rubble"), (CX0 - 0.12, CY1 - 0.3, 0), (-1.0, CY1 + 0.12, SILL * 0.6), 0.03)
    box(B("dark"), (-1.0, CY1 - 0.3, 0), (CX1 + 0.12, CY1 + 0.12, 0.03))
    box(B("dark"), (CX1 - 0.3, CY0 + 0.3, 0), (CX1 + 0.12, CY1 + 0.12, 0.03))
    spoil_bank((CX0 + 0.3, CY1 + 0.6), (CX1 - 0.3, CY1 + 0.6), 0.4, 0.22)
    spoil_bank((CX1 + 0.55, CY0 + 0.6), (CX1 + 0.55, CY1 - 0.3), 0.3, 0.2)
    for (x, y) in ((CX0 - 0.5, CY0 - 0.5), (LX1 + 0.3, CY0 - 0.5), (LX1 + 0.3, CY1 + 0.3), (CX0 - 0.5, CY1 + 0.3),
                   (LX1, LY0 + 0.1), (LX1, 0.85)):
        cyl(B("plank"), (x, y, 0), (x + jit(0.03), y + jit(0.03), 0.7), 0.035, 0.02, n=5)
    for (a, b) in (((CX0 - 0.5, CY0 - 0.5), (LX1 + 0.3, CY0 - 0.5)), ((LX1 + 0.3, CY0 - 0.5), (LX1 + 0.3, CY1 + 0.3))):
        beam(B("rope"), (a[0], a[1], 0.6), (b[0], b[1], 0.6), 0.012, 0.012, 0.0)
    for (x, y) in ((LX1, LY0 + 0.1), (LX1, 0.85), (LX1, LY1 - 0.1)):
        box(B("ashlar"), (x - 0.2, y - 0.2, 0), (x + 0.2, y + 0.2, 0.16), 0.02)
    # squared oak for the frame + bundles of straw (yealms) for the thatch
    for r in range(2):
        for i in range(4 - r):
            beam(B("oak"), (-3.3, -2.6 + i * 0.26 + r * 0.13, 0.11 + r * 0.22), (0.9, -2.6 + i * 0.26 + r * 0.13, 0.11 + r * 0.22),
                 0.22, 0.22, 0.012)
    for i in range(10):
        x, y = 1.6 + (i % 5) * 0.42, 1.3 + (i // 5) * 0.9 + jit(0.05)
        yealm(x, y, 0.0)
    stone_pile(2.4, -2.6, 14, 0.8)
    sack((-3.9, 1.5, 0), 0.6, 0.8, 0.55, "sacking", rot=0.1)


def build2():
    ground_pad(0.1, -0.1, 4.3, 3.8, "yard", h=0.03)
    cottage(stage="frame")
    cottage_roof(stage="frame")
    leanto(stage="frame")
    # ladder against the front + bundles of straw waiting
    q = Vector((-1.2, CY0 - 1.0, 0))
    for s in (-0.22, 0.22):
        beam(B("pole"), q + Vector((s, 0, 0)), q + Vector((s, 0.9, 3.4)), 0.06, 0.06, 0.0)
    for k in range(1, 11):
        t = k / 11
        beam(B("pole"), q + Vector((-0.22, 0.9 * t, 3.4 * t)), q + Vector((0.22, 0.9 * t, 3.4 * t)), 0.035, 0.035, 0.0)
    for i in range(12):
        x, y = -3.3 + (i % 6) * 0.45, -2.7 + (i // 6) * 0.95
        yealm(x, y, 0.28 if i % 5 == 0 else 0.0)
    # daubing: tubs of daub and a heap of clay
    tub((1.8, -2.4, 0), 0.34, 0.45, liquid=None)
    mound(B("clay"), 2.7, -2.5, 0.6, 0.5, 0.35, noise=0.2)
    for k in range(3):
        beam(B("fresh"), (1.4, 1.2 + k * 0.25, 0.1), (3.6, 1.2 + k * 0.25, 0.1), 0.2, 0.2, 0.01)


def ruin():
    ground_pad(0.1, -0.1, 4.3, 3.8, "yard", h=0.03)
    ground_pad(-1.3, 0.9, 2.8, 2.5, "ash", h=0.06, rot=0.2)
    cottage(stage="burnt")
    cottage_roof(stage="burnt")
    leanto(stage="burnt")
    loom(stage="burnt")
    dye_yard(stage="burnt")
    bales(stage="burnt")
    rubble_heap(-1.3, 0.9, 2.0, 1.6, 0.45, 30, "ash")
    for i in range(10):
        x, y = R.uniform(-3.4, 3.4), R.uniform(-1.2, 3.0)
        a = R.uniform(0, math.pi)
        l = R.uniform(1.2, 3.0)
        beam(B("oak"), (x, y, 0.1), (x + math.cos(a) * l, y + math.sin(a) * l, R.uniform(0.05, 0.8)), 0.14, 0.16, 0.01)
    # collapsed lean-to roof boards lying on the ground
    for i in range(12):
        y = LY0 + i * 0.35
        beam(B("plank"), (1.2 + jit(0.2), y, 0.05 + jit(0.03)), (3.9 + jit(0.2), y + jit(0.2), 0.3 + jit(0.1)),
             0.28, 0.03, 0.004, side=(0, 0, 1))


build_materials(extra)
MAT["wicker"] = m_wicker("wicker")
{"complete": complete, "build1": build1, "build2": build2, "ruin": ruin}[STATE]()
run("weaver", tex=2048)
