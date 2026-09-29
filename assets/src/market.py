"""HIGHGROUND - market place, footprint 16 x 16 m.

A flagged market square round a stepped octagonal market cross (four weathered steps of
individual blocks, a socket stone, a tapered octagonal shaft and a plain cross head).
Trestle stalls under muted, sagging canvas awnings (undyed, weld-ochre, madder, faded green,
striped) on poles with guy ropes, each stall laden with its own trade: apples and cabbages
in baskets, bolts of cloth, crocks and jugs, bread and cheeses, fleeces and hides. Barrels,
crates, a handcart, and a public weighing beam (tron) on its oak frame with a pan, a wool
sack on the hook and a stack of stone weights.

    blender -b -P assets/src/market.py -- [complete|build1|build2|ruin]

Front faces -Y. 1 unit = 1 m.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _craft import *

seed(71)

CX, CY = 0.0, 0.7             # market cross centre
STEP_R = [2.35, 1.9, 1.45, 1.0]   # octagon circumradius of each step
STEP_H = 0.28
SHAFT_H = 4.3
SOLIDS.clear()

# stall layout: (cx, cy, rot, awning material, trade)
STALLS = [
    (-3.4, 5.0, 0.12, "canvas_a", "produce"),
    (0.4, 5.6, 0.0, "canvas_c", "cloth"),
    (4.1, 5.0, -0.1, "canvas_b", "pots"),
    (-5.6, 0.9, -math.pi / 2 + 0.06, "canvas_d", "bread"),
    (5.7, 1.1, math.pi / 2 + 0.04, "canvas_e", "wool"),
    (-4.2, -4.6, 0.25, "canvas_b", "produce2"),
    (-5.9, -1.9, -math.pi / 2 - 0.1, "canvas_c", "pots"),
]
TRON = (4.2, -4.3)


def extra(M, ch):
    M["canvas_a"] = m_cloth("canvas_a", "#a09580", "#b1a68e", weave=140.0, dirt=0.25)
    M["canvas_b"] = m_cloth("canvas_b", "#8a7646", "#9a8552", weave=140.0, dirt=0.25)
    M["canvas_c"] = m_cloth("canvas_c", "#a39a84", "#b3a990", weave=140.0, dirt=0.25, stripes=(3.2, "#74463a"))
    M["canvas_d"] = m_cloth("canvas_d", "#5e6448", "#6c7253", weave=140.0, dirt=0.25)
    M["canvas_e"] = m_cloth("canvas_e", "#7a4c3c", "#8a5a47", weave=140.0, dirt=0.25)
    M["burnt_cloth"] = m_cloth("burnt_cloth", "#3a332d", "#5a4d40", weave=140.0, dirt=0.5)
    M["cross"] = m_stone("cross", [(0.0, "#8f8578"), (0.35, "#a09585"), (0.7, "#aa9e8a"), (1.0, "#877e72")],
                         "#7f776a", joints=False, bump=0.8, moss=1.4, charred=ch * 0.4)
    M["flags"] = m_stone("flags", [(0.0, "#6f685c"), (0.35, "#7d7567"), (0.7, "#8a8172"), (1.0, "#686156")],
                         "#4f493f", joints=False, bump=0.6, moss=0.35, charred=ch * 0.3)
    M["yard"] = m_heap("yard", [(0.1, "#4a3c2d"), (0.5, "#5b4a37"), (0.9, "#6a5840")], 9.0, pebble=0.35, grass=0.45)
    M["straw"] = m_heap("straw", [(0.1, "#8e7a4c"), (0.5, "#a28c58"), (0.9, "#b29c65")], 40.0, rough=0.95)
    M["apples"] = m_heap("apples", [(0.0, "#6d2e22"), (0.35, "#8a3a26"), (0.6, "#96562e"), (0.8, "#7c7a36"),
                                    (1.0, "#8f8a45")], 28.0, rough=0.5, sheen=0.2)
    M["cabbage"] = m_heap("cabbage", [(0.1, "#4d5f33"), (0.5, "#63774a"), (0.9, "#7d8f5c")], 9.0, rough=0.7)
    M["onions"] = m_heap("onions", [(0.1, "#7d5a36"), (0.5, "#936d42"), (0.9, "#a88352")], 30.0, rough=0.6)
    M["bread"] = m_heap("bread", [(0.1, "#6e4a2c"), (0.5, "#86603a"), (0.9, "#9c7547")], 6.0, rough=0.8)
    M["cheese"] = m_simple("cheese", "#a38a4e", "#b29a5c", 0.7, 3.0)
    M["pottery"] = m_simple("pottery", "#80523a", "#946347", 0.7, 2.5)
    M["glaze"] = m_simple("glaze", "#5d6038", "#6f7042", 0.45, 3.0)
    M["cloth_r"] = m_cloth("cloth_r", "#6f3e30", "#80493a", weave=220.0, dirt=0.1)
    M["cloth_b"] = m_cloth("cloth_b", "#4a5566", "#566174", weave=220.0, dirt=0.1)
    M["cloth_u"] = m_cloth("cloth_u", "#a69b82", "#b5ab93", weave=220.0, dirt=0.1)
    M["cloth_y"] = m_cloth("cloth_y", "#877a45", "#968852", weave=220.0, dirt=0.1)
    M["wool"] = m_wool("wool", [(0.2, "#9a907c"), (0.55, "#b1a78f"), (0.9, "#bfb59c")])
    M["hide"] = m_simple("hide", "#6a4a32", "#7e5a3e", 0.75, 2.0)
    M["sacking"] = m_cloth("sacking", "#7d6e55", "#8f7f62", weave=160.0)
    M["wicker"] = m_wicker("wicker")


# ------------------------------------------------------------------ helpers
def T(c, rot):
    ca, sa = math.cos(rot), math.sin(rot)
    cz = c[2] if len(c) > 2 else 0.0

    def f(x, y, z=0.0):
        return Vector((c[0] + x * ca - y * sa, c[1] + x * sa + y * ca, z + cz))
    return f


def lathe_pts(c, prof, n=10, jr=0.0):
    pts = []
    for (r, z) in prof:
        for i in range(n):
            a = 2 * math.pi * i / n
            rr = r * (1 + jit(jr))
            pts.append((c[0] + math.cos(a) * rr, c[1] + math.sin(a) * rr, c[2] + z))
    return pts


def lathe(bt, c, prof, n=10, jr=0.0):
    """closed body of revolution (convex profiles only)."""
    prism_hull(bt, lathe_pts(c, prof, n, jr))


def sheet(bt, corners, nu=8, nv=5, sag=0.1, th=0.012, drape=None, loc_scale=(1.0, 1.0)):
    """cloth sheet between 4 corners (A,B,C,D in order), sagging in the middle, two-sided with
    a thin edge. drape(u,v)->dz adds extra shaping."""
    A, Bc, C, D = [Vector(p) for p in corners]
    top, bot, loc = [], [], []
    Lu = (Bc - A).length
    Lv = (D - A).length
    for j in range(nv + 1):
        v = j / nv
        for i in range(nu + 1):
            u = i / nu
            p = A.lerp(Bc, u).lerp(D.lerp(C, u), v)
            p.z -= sag * math.sin(math.pi * u) * (0.3 + 0.9 * math.sin(math.pi * v))
            if drape:
                p.z += drape(u, v)
            p.z += jit(0.006)
            top.append(tuple(p + Vector((0, 0, th / 2))))
            bot.append(tuple(p - Vector((0, 0, th / 2))))
            loc.append((v * Lv * loc_scale[1], 0.0, u * Lu * loc_scale[0]))
    W = nu + 1
    off = len(top)
    F = []
    for j in range(nv):
        for i in range(nu):
            a = j * W + i
            F.append((a, a + 1, a + W + 1, a + W))
            F.append((off + a, off + a + W, off + a + W + 1, off + a + 1))
    # edges
    for i in range(nu):
        F.append((i, off + i, off + i + 1, i + 1))
        a = nv * W + i
        F.append((a + 1, off + a + 1, off + a, a))
    for j in range(nv):
        a = j * W
        F.append((a + W, off + a + W, off + a, a))
        a = j * W + nu
        F.append((a, off + a, off + a + W, a + W))
    bt.add(top + bot, F, None, None, loc + loc)


def crate(p, sx=0.6, sy=0.45, sz=0.4, rot=0.0, fill=None, lid=False):
    """slatted crate: corner posts, side slats, a floor; optional fill heap."""
    f = T(p, rot)
    pl, oak = B("plank"), B("oak")
    for (x, y) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        q = f(x * (sx / 2 - 0.025), y * (sy / 2 - 0.025), 0)
        box(oak, q - Vector((0.025, 0.025, 0)), q + Vector((0.025, 0.025, sz)), 0.004, rot=(0, 0, rot))
    for k in range(3):
        z = 0.03 + k * (sz - 0.06) / 2.5
        for (a, b, w) in (((-sx / 2, -sy / 2), (sx / 2, -sy / 2), 0.1), ((-sx / 2, sy / 2), (sx / 2, sy / 2), 0.1),
                          ((-sx / 2, -sy / 2), (-sx / 2, sy / 2), 0.1), ((sx / 2, -sy / 2), (sx / 2, sy / 2), 0.1)):
            beam(pl, f(a[0], a[1], z + 0.05), f(b[0], b[1], z + 0.05), 0.02, w, 0.003, side=(0, 0, 1))
    box(pl, f(0, 0, 0.0) - Vector((sx / 2 - 0.02, sy / 2 - 0.02, 0)), f(0, 0, 0.0) + Vector((sx / 2 - 0.02, sy / 2 - 0.02, 0.03)),
        0.0, rot=(0, 0, rot))
    if fill:
        mound(B(fill), p[0], p[1], sx / 2 - 0.04, sy / 2 - 0.04, 0.12, rings=3, segs=12, noise=0.12, power=1.3,
              z0=p[2] + sz - 0.1, rot=rot)
    if lid:
        box(pl, f(0, 0, sz) - Vector((sx / 2, sy / 2, 0)), f(0, 0, sz) + Vector((sx / 2, sy / 2, 0.03)), 0.004, rot=(0, 0, rot))


def basket(p, r=0.22, h=0.26, fill=None):
    p = Vector(p)
    lathe(B("wicker"), p, [(r * 0.8, 0.0), (r, h * 0.55), (r * 1.05, h)], n=12)
    if fill:
        mound(B(fill), p.x, p.y, r * 0.95, r * 0.95, 0.12, rings=2, segs=10, noise=0.1, power=1.4, z0=p.z + h - 0.04)


def jug(p, s=1.0, mat="pottery"):
    p = Vector(p)
    lathe(B(mat), p, [(0.07 * s, 0.0), (0.11 * s, 0.1 * s), (0.1 * s, 0.2 * s), (0.05 * s, 0.28 * s),
                      (0.055 * s, 0.33 * s)], n=10)


def crock(p, s=1.0, mat="pottery"):
    p = Vector(p)
    lathe(B(mat), p, [(0.1 * s, 0.0), (0.15 * s, 0.1 * s), (0.14 * s, 0.2 * s), (0.12 * s, 0.24 * s)], n=12)


def bolt(p, d, r=0.08, l=0.7, mat="cloth_r"):
    p, d = Vector(p), Vector(d).normalized()
    cyl(B(mat), p - d * l / 2, p + d * l / 2, r, n=10)


def cheese(p, r=0.16, h=0.1):
    p = Vector(p)
    cyl(B("cheese"), p, p + Vector((0, 0, h)), r, n=12, bulge=0.01)


def loaf(p, r=0.12):
    p = Vector(p)
    lathe(B("bread"), p, [(r, 0.0), (r * 1.05, 0.03), (r * 0.8, 0.08), (0.02, 0.1)], n=9, jr=0.05)


# ------------------------------------------------------------------ market cross
def octa(r, a0=math.pi / 8):
    return [(math.cos(a0 + i * math.pi / 4) * r, math.sin(a0 + i * math.pi / 4) * r) for i in range(8)]


def cross_steps(levels=4, broken=False):
    """stepped octagonal base: each step an outer ring of individual blocks on a rubble core."""
    for k in range(levels):
        r = STEP_R[k]
        z0, z1 = k * STEP_H, (k + 1) * STEP_H
        inner = STEP_R[k + 1] - 0.1 if k + 1 < len(STEP_R) else 0.0
        # hidden core
        core = [(CX + x, CY + y, zz) for (x, y) in octa(max(inner, 0.4) + 0.05) for zz in (z0, z1 - 0.01)]
        prism_hull(B("rubble"), core)
        pts = octa(r)
        for i in range(8):
            a, b = Vector(pts[i] + (0,)), Vector(pts[(i + 1) % 8] + (0,))
            nb = 2 if r > 1.2 else 1
            for s in range(nb):
                t0, t1 = s / nb, (s + 1) / nb
                pa, pb = a.lerp(b, t0 + 0.004), a.lerp(b, t1 - 0.004)
                ci = (pa + pb) / 2
                inw = -ci.normalized() * (r - inner + 0.02) * 0.55 if inner > 0 else -ci
                if broken and k == levels - 1 and R.random() < 0.25:
                    continue
                dz = jit(0.012)
                zt = z1 + dz
                q = [Vector((CX, CY, 0)) + v for v in (pa, pb)]
                qi = [Vector((CX, CY, 0)) + v + inw for v in (pa, pb)]
                P = []
                for qq in q + qi:
                    P += [(qq.x, qq.y, z0), (qq.x, qq.y, zt)]
                # worn arris on the tread nosing
                for qq in q:
                    P.append((qq.x - ci.normalized().x * -0.0, qq.y, zt))
                prism_hull(B("cross"), P)


def cross_shaft(h=SHAFT_H, head=True, broken_at=None):
    top = STEP_R.__len__() * STEP_H
    c = Vector((CX, CY, top))
    # socket stone: a chamfered cube
    s = 0.52
    P = []
    for (x, y) in ((-s, -s), (s, -s), (s, s), (-s, s)):
        P += [(c.x + x, c.y + y, c.z), (c.x + x * 0.98, c.y + y * 0.98, c.z + 0.42)]
    for (x, y) in octa(s * 0.95, 0.0):
        P.append((c.x + x * 0.8, c.y + y * 0.8, c.z + 0.6))
    prism_hull(B("cross"), P)
    zb = c.z + 0.6
    if h <= 0:
        return zb
    zt = zb + (h if broken_at is None else broken_at)
    # tapered octagonal shaft with stop-chamfers, in two stones
    for (z0, z1, r0, r1) in ((zb, zb + h * 0.55, 0.21, 0.185), (zb + h * 0.55, zb + h, 0.185, 0.16)):
        if z0 >= zt:
            break
        z1 = min(z1, zt)
        rr1 = r0 + (r1 - r0) * (z1 - z0) / max(1e-3, (zb + h * 0.55 if z0 == zb else zb + h) - z0)
        P = [(c.x + x, c.y + y, z0) for (x, y) in octa(r0)] + [(c.x + x + jit(0.004), c.y + y, z1 + (jit(0.06) if broken_at else 0))
                                                               for (x, y) in octa(rr1)]
        prism_hull(B("cross"), P)
    if broken_at is not None:
        return zt
    # knop / capital, then the cross head
    zc = zb + h
    lathe(B("cross"), (c.x, c.y, zc - 0.02), [(0.17, 0.0), (0.24, 0.08), (0.24, 0.16), (0.15, 0.2)], n=8)
    if not head:
        return zc
    zc += 0.2
    w = 0.1
    box(B("cross"), (c.x - w, c.y - w, zc), (c.x + w, c.y + w, zc + 0.95), 0.02)
    box(B("cross"), (c.x - 0.42, c.y - w * 0.85, zc + 0.52), (c.x + 0.42, c.y + w * 0.85, zc + 0.72), 0.02)
    for sx in (-1, 1):   # small flared arm ends
        box(B("cross"), (c.x + sx * 0.42 - 0.04, c.y - w - 0.015, zc + 0.49), (c.x + sx * 0.42 + 0.04, c.y + w + 0.015, zc + 0.75),
            0.015)
    box(B("cross"), (c.x - w - 0.015, c.y - w - 0.015, zc + 0.9), (c.x + w + 0.015, c.y + w + 0.015, zc + 0.98), 0.015)
    return zc + 1.0


# ------------------------------------------------------------------ stalls
def trestle(f, x, depth=0.95, h=0.82):
    """A-frame trestle across the stall depth at local x."""
    oak = B("oak")
    beam(oak, f(x, -depth / 2 - 0.05, h - 0.05), f(x, depth / 2 + 0.05, h - 0.05), 0.09, 0.09, 0.008)
    for y in (-depth / 2 + 0.08, depth / 2 - 0.08):
        for sx in (-1, 1):
            beam(oak, f(x + sx * 0.02, y, h - 0.07), f(x + sx * 0.22, y + (0.06 if y > 0 else -0.06), 0.0), 0.05, 0.05, 0.004)
    beam(oak, f(x, -depth / 2 + 0.08, 0.3), f(x, depth / 2 - 0.08, 0.3), 0.04, 0.04, 0.004)


def stall(cx, cy, rot, canvas, trade, stage="complete"):
    f = T((cx, cy), rot)
    Lh, dep, h = 2.5, 0.95, 0.84
    oak, pl = B("oak"), B("plank")
    burnt = stage == "burnt"
    frame_only = stage == "frame"
    # trestles + board top
    for x in (-Lh / 2 + 0.3, Lh / 2 - 0.3):
        if burnt and R.random() < 0.5:
            # a trestle knocked flat
            beam(oak, f(x, -0.4, 0.06), f(x + 0.3, 0.45, 0.06), 0.09, 0.09, 0.008)
            continue
        trestle(f, x, dep, h)
    if not frame_only or R.random() < 0.5:
        for k in range(3):
            y = -dep / 2 + (k + 0.5) * dep / 3
            if burnt:
                if R.random() < 0.6:
                    a = f(-Lh / 2 + R.uniform(0, 0.8), y + jit(0.2), R.uniform(0.02, 0.5))
                    b = f(Lh / 2 - R.uniform(0, 0.8), y + jit(0.3), 0.03)
                    beam(pl, a, b, dep / 3 - 0.02, 0.04, 0.004, side=(0, 0, 1))
                continue
            beam(pl, f(-Lh / 2, y + jit(0.01), h + 0.02), f(Lh / 2, y + jit(0.01), h + 0.02), dep / 3 - 0.012, 0.04, 0.004,
                 side=(0, 0, 1))
        # front apron board
        if not burnt:
            beam(pl, f(-Lh / 2, -dep / 2 - 0.02, h - 0.1), f(Lh / 2, -dep / 2 - 0.02, h - 0.1), 0.02, 0.2, 0.004,
                 side=(0, 1, 0))
    # awning poles: taller at the front
    yf, yb = -dep / 2 - 0.55, dep / 2 + 0.05
    zf, zb = 2.3, 2.0
    poles = [(-Lh / 2 - 0.05, yf, zf), (Lh / 2 + 0.05, yf, zf), (Lh / 2 + 0.05, yb, zb), (-Lh / 2 - 0.05, yb, zb)]
    tops = []
    for (x, y, z) in poles:
        if burnt:
            if R.random() < 0.5:
                a = f(x, y, 0.0)
                lean = f(x + R.uniform(-1.2, 1.2), y + R.uniform(-1.2, 1.2), 0.0) - a
                d = (lean.normalized() * math.sin(0.7) + Vector((0, 0, math.cos(0.7)))) * z * R.uniform(0.6, 1.0)
                cyl(B("pole"), a, a + d, 0.035, 0.028, n=6)
            else:
                p0 = f(x + jit(0.8), y + jit(0.8), 0.04)
                cyl(B("pole"), p0, p0 + (f(R.uniform(-1, 1), R.uniform(-1, 1), 0) - f(0, 0, 0)).normalized() * z * 0.8 +
                    Vector((0, 0, 0.05)), 0.035, n=6)
            continue
        top = f(x + jit(0.02), y + jit(0.02), z + jit(0.03))
        cyl(B("pole"), f(x, y, 0.0), top, 0.035, 0.028, n=6)
        tops.append(top)
    if burnt:
        # scorched rags of canvas on the ground and hanging from a pole
        for k in range(3):
            p = f(R.uniform(-1.2, 1.2), R.uniform(-0.8, 0.6), 0.02)
            s_ = R.uniform(0.3, 0.7)
            sheet(B("burnt_cloth"), [p + Vector((-s_, -s_ * 0.6, 0)), p + Vector((s_, -s_ * 0.5, 0.0)),
                                     p + Vector((s_ * 0.8, s_ * 0.7, 0)), p + Vector((-s_ * 0.7, s_ * 0.6, 0))], 3, 2,
                  sag=-0.03, th=0.01)
        return
    if frame_only:
        # a rolled canvas waiting under the board
        cyl(B(canvas), f(-1.0, 0.1, 0.12), f(1.0, 0.1, 0.12), 0.12, n=10)
        return
    # the awning: sagging canvas plus a scalloped front valance, tied at the corners
    over = 0.08
    A, Bc, C, D = [Vector(t) for t in tops]
    sheet(B(canvas), [A + (A - C).normalized() * over, Bc + (Bc - D).normalized() * over,
                      C + (C - A).normalized() * over, D + (D - Bc).normalized() * over],
          nu=9, nv=5, sag=0.17, th=0.014)
    nval = 7
    for i in range(nval):
        u0, u1 = i / nval, (i + 1) / nval
        p0, p1 = A.lerp(Bc, u0), A.lerp(Bc, u1)
        pm = (p0 + p1) / 2
        dn = f(0, -1, 0) - f(0, 0, 0)
        pts = [p0 + dn * 0.1 - Vector((0, 0, 0.02)), p1 + dn * 0.1 - Vector((0, 0, 0.02)),
               p0 + dn * 0.1 - Vector((0, 0, 0.2)), p1 + dn * 0.1 - Vector((0, 0, 0.2)),
               pm + dn * 0.1 - Vector((0, 0, 0.3))]
        pts = pts + [p + dn * 0.012 for p in pts]
        prism_hull(B(canvas), pts)
    # guy ropes from the front poles out to pegs
    for sx, t in ((-1, A), (1, Bc)):
        peg = f(sx * (Lh / 2 + 0.75), yf - 0.35, 0.0)
        cyl(B("rope"), t - Vector((0, 0, 0.05)), peg + Vector((0, 0, 0.1)), 0.008, n=4)
        cyl(B("plank"), peg - Vector((0, 0, 0.0)), peg + Vector((0, 0, 0.22)), 0.02, 0.015, n=5)
    goods(f, trade, h + 0.06)


def goods(f, trade, z):
    if trade in ("produce", "produce2"):
        fills = ["apples", "cabbage", "onions", "apples", "onions"]
        for i, x in enumerate((-0.9, -0.4, 0.1, 0.6, 1.0)):
            basket(f(x, -0.12 + jit(0.08), z), 0.2, 0.22, fills[(i + (trade == "produce2")) % len(fills)])
        for i in range(3):
            lathe(B("cabbage"), f(-0.7 + i * 0.25, 0.3, z), [(0.08, 0.0), (0.12, 0.06), (0.09, 0.14), (0.02, 0.16)], n=8,
                  jr=0.08)
        crate(f(1.7, 0.2, 0.0), 0.6, 0.45, 0.42, rot=0.2, fill="apples")
        crate(f(1.75, -0.4, 0.0), 0.6, 0.45, 0.42, rot=-0.1, fill="cabbage")
        basket(f(-1.7, -0.3, 0.0), 0.25, 0.3, "onions")
    elif trade == "cloth":
        mats = ["cloth_r", "cloth_b", "cloth_u", "cloth_y", "cloth_u", "cloth_r"]
        for i in range(6):
            bolt(f(-1.0 + i * 0.2, 0.05, z + 0.08), f(0, 1, 0) - f(0, 0, 0), 0.075, 0.75, mats[i])
        for i in range(3):
            bolt(f(-0.9 + i * 0.2, 0.05, z + 0.22), f(0, 1, 0) - f(0, 0, 0), 0.07, 0.72, mats[(i + 2) % 6])
        for i in range(3):   # folded lengths
            c = f(0.55 + (i % 2) * 0.1, -0.1 + i * 0.03, z + i * 0.06)
            box(B(mats[i + 1]), c - Vector((0.25, 0.2, 0)), c + Vector((0.25, 0.2, 0.055)), 0.02, rot=(0, 0, jit(0.1)))
        # a length draped over the front
        c0 = f(0.9, -0.52, z - 0.02)
        box(B("cloth_r"), c0 - Vector((0.18, 0.02, 0.55)), c0 + Vector((0.18, 0.02, 0.0)), 0.01)
        crate(f(1.7, 0.1, 0.0), 0.6, 0.45, 0.42, rot=0.1, lid=True)
    elif trade == "pots":
        for i in range(5):
            jug(f(-1.0 + i * 0.22, -0.2 + jit(0.04), z), R.uniform(0.9, 1.15), "pottery" if i % 2 else "glaze")
        for i in range(4):
            crock(f(0.2 + i * 0.26, 0.15 + jit(0.04), z), R.uniform(0.9, 1.2), "pottery" if i % 3 else "glaze")
        for i in range(3):
            jug(f(0.35 + i * 0.25, -0.25, z), 0.8, "glaze")
        box(B("straw"), f(1.75, 0, 0) - Vector((0.3, 0.3, 0)), f(1.75, 0, 0) + Vector((0.3, 0.3, 0.25)), 0.05)
        crock(f(1.7, -0.6, 0.0), 1.5)
        jug(f(-1.75, -0.3, 0.0), 1.6)
    elif trade == "bread":
        for i in range(8):
            loaf(f(-1.0 + (i % 4) * 0.22, -0.25 + (i // 4) * 0.24, z), R.uniform(0.1, 0.13))
        for i in range(3):
            cheese(f(0.35 + i * 0.3, 0.05, z), 0.15, 0.1)
        cheese(f(0.5, 0.05, z + 0.1), 0.14, 0.09)
        basket(f(0.9, -0.3, z), 0.18, 0.18, "bread")
        barrel(f(1.75, 0.1, 0.0), 0.3, 0.75)
    elif trade == "wool":
        for i in range(3):
            c = f(-0.8 + i * 0.6, 0.0, z)
            mound(B("wool"), c.x, c.y, 0.3, 0.25, 0.2, rings=3, segs=12, noise=0.2, power=1.2, lumpy=0.02, z0=c.z)
        # hides hung over a rail at the back
        oak = B("oak")
        beam(oak, f(-1.25, 0.55, 1.6), f(1.25, 0.55, 1.6), 0.06, 0.06, 0.005)
        for x in (-0.7, 0.3):
            c = f(x, 0.55, 1.6)
            box(B("hide"), c - Vector((0.35, 0.02, 0.9)), c + Vector((0.35, 0.02, 0.02)), 0.01,
                rot=(0, 0, 0))
        sack(f(1.75, 0.0, 0.0), 0.55, 0.5, 0.8)
        sack(f(1.8, -0.55, 0.0), 0.5, 0.45, 0.7)


# ------------------------------------------------------------------ weighing beam (tron)
def tron(stage="complete"):
    x, y = TRON
    oak = B("oak")
    hgt = 2.7
    if stage == "burnt":
        cyl(oak, (x - 0.9, y, 0), (x - 0.75, y + 0.2, 1.6), 0.1, 0.09, n=8)
        beam(oak, (x - 0.4, y - 0.8, 0.1), (x + 1.3, y + 0.3, 0.25), 0.18, 0.18, 0.012)
        beam(B("iron"), (x + 0.4, y - 0.4, 0.05), (x + 1.6, y - 0.6, 0.1), 0.06, 0.06, 0.004)
        for i in range(5):
            box(B("cross"), (x + 0.5 + jit(0.4), y + 0.6 + jit(0.3), 0), (x + 0.75 + jit(0.4), y + 0.85 + jit(0.3), 0.16), 0.02,
                rot=(jit(0.3), 0, R.uniform(0, 3)))
        return
    for sx in (-1, 1):
        box(B("cross"), (x + sx * 0.95 - 0.28, y - 0.28, 0), (x + sx * 0.95 + 0.28, y + 0.28, 0.25), 0.02)
        cyl(oak, (x + sx * 0.95, y, 0.2), (x + sx * 0.95 + jit(0.02), y, hgt), 0.11, 0.1, n=8)
        for sy in (-1, 1):
            beam(oak, (x + sx * 0.95, y + sy * 0.05, 0.25), (x + sx * 0.95, y + sy * 0.6, 0.02), 0.08, 0.08, 0.006)
        beam(oak, (x + sx * 0.95, y, hgt - 0.5), (x + sx * 0.5, y, hgt - 0.08), 0.08, 0.08, 0.006)
    beam(oak, (x - 1.15, y, hgt + 0.02), (x + 1.15, y, hgt + 0.02), 0.2, 0.22, 0.012)
    if stage == "frame":
        return
    # iron hook and the great balance beam, tilted by the load
    cyl(B("iron"), (x, y, hgt - 0.1), (x, y, hgt - 0.38), 0.025, n=6)
    ang = 0.06
    L_ = 1.05
    pl = Vector((x - L_ * math.cos(ang), y, hgt - 0.42 + L_ * math.sin(ang)))
    pr = Vector((x + L_ * math.cos(ang), y, hgt - 0.42 - L_ * math.sin(ang)))
    beam(oak, pl, pr, 0.1, 0.12, 0.01)
    cyl(B("iron"), (x - 0.06, y, hgt - 0.42), (x + 0.06, y, hgt - 0.42), 0.05, n=8)
    # left: pan on three chains with stone weights; right: hook with a wool pack
    pan_c = Vector((pl.x, y, 0.95))
    for k in range(3):
        a = 2 * math.pi * k / 3
        cyl(B("iron"), pl - Vector((0, 0, 0.03)), pan_c + Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, 0.02)), 0.008, n=4)
    lathe(B("iron"), pan_c, [(0.18, -0.06), (0.34, 0.0), (0.35, 0.03)], n=12)
    for i in range(3):
        box(B("cross"), pan_c + Vector((-0.12 + i * 0.1, -0.08, 0.02)), pan_c + Vector((-0.04 + i * 0.1, 0.08, 0.12 - i * 0.02)),
            0.015)
    cyl(B("iron"), pr - Vector((0, 0, 0.03)), pr - Vector((0, 0, 0.7)), 0.012, n=4)
    sack(pr - Vector((0, 0, 1.6)), 0.6, 0.5, 0.9, rot=0.2)
    # weights stacked on the ground, a scale-keeper's bench
    for i in range(4):
        s_ = 0.2 - i * 0.03
        box(B("cross"), (x + 0.1 - s_, y + 0.6 - s_, i * 0.13), (x + 0.1 + s_, y + 0.6 + s_, i * 0.13 + 0.12), 0.02,
            rot=(0, 0, jit(0.2)))
    beam(B("plank"), (x - 0.7, y + 0.75, 0.45), (x + 0.1, y + 0.95, 0.45), 0.3, 0.05, 0.004, side=(0, 0, 1))
    for xx in (x - 0.55, x - 0.05):
        beam(oak, (xx, y + 0.8, 0.0), (xx, y + 0.86, 0.43), 0.08, 0.08, 0.005)


# ------------------------------------------------------------------ ground
def paving(r_in=0.0, r_out=4.4, frac=1.0, disturb=0.0):
    """irregular flagstones round the cross, laid in rings, with gaps where the earth shows."""
    r = max(r_in, STEP_R[0] + 0.05)
    while r < r_out:
        w = R.uniform(0.45, 0.62)
        circ = 2 * math.pi * (r + w / 2)
        n = max(6, int(circ / R.uniform(0.55, 0.75)))
        a0 = R.uniform(0, 1)
        for i in range(n):
            if R.random() > frac:
                continue
            a1, a2 = a0 + 2 * math.pi * i / n + 0.012, a0 + 2 * math.pi * (i + 1) / n - 0.012
            if r + w > r_out - 0.2 and R.random() < 0.3:
                continue
            r1, r2 = r + 0.012, r + w - 0.012 + jit(0.04)
            zt = 0.05 + jit(0.012)
            P = []
            for a in (a1, a2):
                for rr in (r1, r2):
                    x, y = CX + math.cos(a) * rr, CY + math.sin(a) * rr
                    P += [(x, y, 0.0), (x, y, zt + (jit(disturb) if disturb else 0))]
            prism_hull(B("flags"), P)
        r += w


# ------------------------------------------------------------------ states
def complete():
    ground_pad(0, 0, 7.3, 7.3, "yard", h=0.03)
    paving()
    cross_steps()
    cross_shaft()
    for (cx, cy, rot, cv, tr) in STALLS:
        stall(cx, cy, rot, cv, tr)
    tron()
    # barrels, crates, a handcart and straw litter about the square
    barrel((-1.55, 3.55, 0), 0.32, 0.85)
    barrel((-1.0, 3.85, 0), 0.3, 0.8)
    barrel((-1.45, 4.15, 0), 0.3, 0.8)
    barrel((2.1, 3.35, 0), 0.3, 0.8, lying=True)
    hurdle_pen(6.35, 6.1, 1.9, 2.3)
    crate((2.4, -2.6, 0), 0.6, 0.45, 0.42, rot=0.3, fill="apples")
    crate((2.9, -2.95, 0), 0.6, 0.45, 0.42, rot=-0.2, lid=True)
    crate((2.65, -2.75, 0.42), 0.6, 0.45, 0.42, rot=0.1, lid=True)
    crate((-6.3, 3.4, 0), 0.6, 0.45, 0.42, rot=1.2, fill="onions")
    crate((6.2, -2.4, 0), 0.6, 0.45, 0.42, rot=1.6, lid=True)
    handcart((-1.9, -5.9, 0), rot=0.5)
    for i in range(10):
        mound(B("straw"), R.uniform(-6, 6), R.uniform(-6.5, 6.5), R.uniform(0.2, 0.5), R.uniform(0.15, 0.35), 0.02,
              rings=1, segs=8, noise=0.4)


def hurdle(p0, p1, h=0.95, fallen=False):
    """woven hazel hurdle between two stakes."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    if fallen:
        c = (p0 + p1) / 2
        n = d.cross(Vector((0, 0, 1))).normalized()
        P = [p0 + Vector((0, 0, 0.02)), p1 + Vector((0, 0, 0.02)), p0 + n * h + Vector((0, 0, 0.1)), p1 + n * h + Vector((0, 0, 0.1))]
        P += [q + Vector((0, 0, 0.06)) for q in P]
        prism_hull(B("wicker"), P)
        return
    for q in (p0, p1):
        cyl(B("pole"), q, q + Vector((jit(0.03), jit(0.03), h + 0.12)), 0.035, 0.03, n=6)
    nrm = d.cross(Vector((0, 0, 1))).normalized() * 0.03
    P = []
    for q in (p0 + d * 0.02, p1 - d * 0.02):
        for z in (0.08, h):
            for sg in (-1, 1):
                P.append(tuple(q + Vector((0, 0, z)) + nrm * sg))
    prism_hull(B("wicker"), P)


def hurdle_pen(cx, cy, sx, sy, broken=False):
    c = [(cx - sx / 2, cy - sy / 2), (cx + sx / 2, cy - sy / 2), (cx + sx / 2, cy + sy / 2), (cx - sx / 2, cy + sy / 2)]
    for i in range(4):
        a, b = c[i], c[(i + 1) % 4]
        hurdle((a[0], a[1], 0), (b[0], b[1], 0), fallen=broken and i % 2 == 0)
    mound(B("straw"), cx, cy, sx / 2 - 0.1, sy / 2 - 0.1, 0.08, rings=3, segs=14, noise=0.2, power=2.0)


def handcart(p, rot=0.0, load=True, broken=False):
    f = T(p, rot)
    oak, pl = B("oak"), B("plank")
    for sx in (-0.45, 0.45):
        beam(oak, f(sx, -1.4, 0.5), f(sx, 0.7, 0.62), 0.07, 0.08, 0.006)
    for k in range(6):
        y = -0.5 + k * 0.2
        beam(pl, f(-0.5, y, 0.6), f(0.5, y, 0.6), 0.18, 0.03, 0.003, side=(0, 0, 1))
    for sx in (-1, 1):
        beam(pl, f(sx * 0.5, -0.55, 0.78), f(sx * 0.5, 0.65, 0.78), 0.03, 0.22, 0.003, side=(1, 0, 0))
        wc = f(sx * 0.6, 0.05, 0.42)
        disc(B("plank"), wc, f(1, 0, 0) - f(0, 0, 0), 0.4, n=14, th=0.06)
        cyl(B("iron"), wc - (f(1, 0, 0) - f(0, 0, 0)) * 0.035, wc + (f(1, 0, 0) - f(0, 0, 0)) * 0.035, 0.41, n=14)
    cyl(oak, f(-0.65, 0.05, 0.42), f(0.65, 0.05, 0.42), 0.035, n=6)
    beam(oak, f(0, -1.3, 0.48), f(0, -1.45, 0.0), 0.06, 0.06, 0.005)
    if load:
        sack(f(-0.15, 0.1, 0.62), 0.45, 0.62, 0.34, rot=rot + 1.4, tie=False)
        sack(f(0.2, -0.2, 0.62), 0.45, 0.62, 0.32, rot=rot + 1.7, tie=False)
        basket(f(0.1, 0.45, 0.62), 0.2, 0.22, "apples")


def build1():
    ground_pad(0, 0, 7.3, 7.3, "yard", h=0.03)
    ground_pad(CX, CY, 3.2, 3.2, "soil", h=0.035)
    # footing ring and the first step going down
    cross_steps(levels=1, broken=True)
    # setting-out: pegs at the stall and cross positions with lines
    pegs = [(-7.3, -7.3), (7.3, -7.3), (7.3, 7.3), (-7.3, 7.3)]
    for (x, y) in pegs:
        cyl(B("plank"), (x, y, 0), (x + jit(0.03), y + jit(0.03), 0.8), 0.035, 0.02, n=5)
    for i in range(4):
        a, b = pegs[i], pegs[(i + 1) % 4]
        beam(B("rope"), (a[0], a[1], 0.65), (b[0], b[1], 0.65), 0.012, 0.012, 0.0)
    for (cx, cy, rot, cv, tr) in STALLS:
        f = T((cx, cy), rot)
        for (x, y) in ((-1.3, -1.0), (1.3, -1.0), (1.3, 0.5), (-1.3, 0.5)):
            q = f(x, y, 0)
            cyl(B("plank"), q, q + Vector((jit(0.02), jit(0.02), 0.45)), 0.03, 0.018, n=5)
    # the shaft stone lying on rollers, the socket stone, step blocks waiting
    c0, c1 = Vector((-3.2, -2.6, 0.3)), Vector((1.4, -3.6, 0.3))
    d = (c1 - c0).normalized()
    P = []
    for (t, r) in ((0.0, 0.21), (1.0, 0.17)):
        q = c0.lerp(c1, t)
        side = d.cross(Vector((0, 0, 1))).normalized()
        for (x, y) in octa(r):
            P.append(tuple(q + side * x + Vector((0, 0, y))))
    prism_hull(B("cross"), P)
    for t in (0.2, 0.75):
        q = c0.lerp(c1, t)
        side = d.cross(Vector((0, 0, 1))).normalized()
        cyl(B("pole"), q - side * 0.5 - Vector((0, 0, 0.2)), q + side * 0.5 - Vector((0, 0, 0.2)), 0.09, n=8)
    box(B("cross"), (3.3, -1.0, 0), (4.3, 0.0, 0.42), 0.03, rot=(0, 0, 0.2))
    for i in range(10):
        x, y = R.uniform(2.8, 5.0), R.uniform(1.5, 3.5)
        box(B("cross"), (x - 0.3, y - 0.22, 0), (x + 0.3, y + 0.22, 0.26), 0.02, rot=(0, 0, R.uniform(0, 3)))
    stone_pile(-4.2, 2.6, 18, 1.0)
    # timber for the trestles and poles
    for k in range(6):
        cyl(B("pole"), (-5.8 + k * 0.08, -4.5 + k * 0.1, 0.05 + (k % 2) * 0.06), (-2.8 + k * 0.08, -5.3 + k * 0.1, 0.05), 0.04,
            n=6)
    plank_stack(3.0, 4.2, 3.0, 0.9, 3, along_x=True, mat="fresh")
    tool((1.8, 3.2, 0), (1.6, 3.5, 1.3), "shovel")
    tool((-1.9, -1.8, 0), (-2.2, -1.5, 1.2), "pick")


def build2():
    ground_pad(0, 0, 7.3, 7.3, "yard", h=0.03)
    paving(frac=0.55)
    cross_steps()
    cross_shaft(h=0)
    # the shaft being swung up with shear-legs and a windlass
    base = Vector((CX, CY, len(STEP_R) * STEP_H + 0.6))
    ang = math.radians(38)
    d = Vector((0, -math.cos(ang), math.sin(ang)))
    q0 = base + Vector((0, 0.0, 0.0))
    P = []
    side = Vector((1, 0, 0))
    for (t, r) in ((0.0, 0.21), (1.0, 0.16)):
        q = q0 + d * (SHAFT_H * t)
        up = side.cross(d)
        for (x, y) in octa(r):
            P.append(tuple(q + side * x + up * y))
    prism_hull(B("cross"), P)
    apex = Vector((CX, CY - 1.2, 6.2))
    for sx in (-1, 1):
        cyl(B("pole"), Vector((CX + sx * 2.1, CY - 2.9, 0)), apex + Vector((sx * 0.12, 0, 0.3)), 0.09, 0.07, n=7)
    cyl(B("rope"), apex, base + d * (SHAFT_H * 0.72), 0.018, n=5)
    cyl(B("rope"), apex, Vector((CX, CY - 5.0, 0.7)), 0.015, n=5)
    for sx in (-1, 1):
        beam(B("oak"), (CX + sx * 0.6, CY - 5.0, 0), (CX + sx * 0.6, CY - 5.0, 0.9), 0.14, 0.14, 0.01)
        for sy in (-1, 1):
            beam(B("oak"), (CX + sx * 0.6, CY - 5.0 + sy * 0.4, 0), (CX + sx * 0.6, CY - 5.0, 0.6), 0.08, 0.08, 0.006)
    cyl(B("oak"), (CX - 0.75, CY - 5.0, 0.75), (CX + 0.75, CY - 5.0, 0.75), 0.12, n=8)
    for a in (0.0, 2.1, 4.2):
        h_ = Vector((CX + 0.78, CY - 5.0, 0.75))
        beam(B("oak"), h_, h_ + Vector((0, math.cos(a) * 0.6, math.sin(a) * 0.6)), 0.05, 0.05, 0.004)
    # stalls going up: trestles and poles, canvases still rolled
    for (cx, cy, rot, cv, tr) in STALLS[:5]:
        stall(cx, cy, rot, cv, tr, stage="frame")
    tron(stage="frame")
    crate((2.4, -2.6, 0), 0.6, 0.45, 0.42, rot=0.3)
    crate((2.9, -2.95, 0), 0.6, 0.45, 0.42, rot=-0.2)
    barrel((-1.55, 3.55, 0), 0.32, 0.85)
    stone_pile(-4.0, -4.8, 14, 0.9)
    tub((1.8, 3.4, 0), 0.34, 0.42, liquid="soil")
    for i in range(6):
        x, y = R.uniform(3.0, 5.0), R.uniform(1.5, 3.3)
        box(B("flags"), (x - 0.3, y - 0.25, i * 0.0), (x + 0.3, y + 0.25, 0.07), 0.01, rot=(0, 0, R.uniform(0, 3)))


def ruin():
    ground_pad(0, 0, 7.3, 7.3, "yard", h=0.03)
    ground_pad(-1.0, 3.5, 5.5, 3.0, "ash", h=0.04, rot=0.2)
    ground_pad(2.0, -3.5, 3.5, 2.2, "ash", h=0.04, rot=-0.3)
    paving(frac=0.8, disturb=0.03)
    cross_steps(broken=True)
    zt = cross_shaft(broken_at=1.5)
    # the upper shaft and head thrown down across the steps
    c0 = Vector((CX + 0.35, CY - 0.8, 0.9))
    d = Vector((0.55, -0.83, -0.12)).normalized()
    P = []
    side = d.cross(Vector((0, 0, 1))).normalized()
    up = side.cross(d)
    for (t, r) in ((0.0, 0.185), (2.5, 0.16)):
        q = c0 + d * t
        for (x, y) in octa(r):
            P.append(tuple(q + side * x + up * y))
    prism_hull(B("cross"), P)
    hc = c0 + d * 2.9 + Vector((0, 0, -0.3))
    box(B("cross"), hc - Vector((0.1, 0.45, 0.1)), hc + Vector((0.1, 0.45, 0.1)), 0.02, rot=(0, 0.2, 0.6))
    box(B("cross"), hc - Vector((0.1, 0.1, 0.1)) + Vector((0.3, 0.2, 0)), hc + Vector((0.1, 0.1, 0.1)) + Vector((0.3, 0.2, 0.0)),
        0.02, rot=(0.3, 0.2, 0.6))
    for i in range(8):
        a = R.uniform(0, 6.28)
        rr = R.uniform(2.4, 3.3)
        x, y = CX + math.cos(a) * rr, CY + math.sin(a) * rr
        box(B("cross"), (x - 0.3, y - 0.2, 0), (x + 0.3, y + 0.2, 0.25), 0.02, rot=(jit(0.3), jit(0.3), R.uniform(0, 3)))
    for (cx, cy, rot, cv, tr) in STALLS:
        stall(cx, cy, rot, cv, tr, stage="burnt")
    tron(stage="burnt")
    handcart((-1.9, -5.9, 0), rot=0.5, load=False)
    barrel((-1.55, 3.55, 0), 0.32, 0.85, lying=True)
    barrel((2.1, 3.35, 0), 0.3, 0.8, lying=True)
    hurdle_pen(6.35, 6.1, 1.9, 2.3, broken=True)
    for i in range(6):
        x, y = R.uniform(-6, 6), R.uniform(-6, 6)
        for k in range(3):
            a = R.uniform(0, 3)
            beam(B("plank"), (x + jit(0.3), y + jit(0.3), 0.03), (x + math.cos(a) * 0.6, y + math.sin(a) * 0.6, 0.05), 0.1, 0.02,
                 0.003, side=(0, 0, 1))
    for i in range(12):
        c = Vector((R.uniform(-6, 6), R.uniform(-6, 6), 0.0))
        mound(B(R.choice(("apples", "cabbage", "straw", "ash"))), c.x, c.y, R.uniform(0.2, 0.5), R.uniform(0.15, 0.4), 0.05,
              rings=2, segs=9, noise=0.35)
    for i in range(4):
        jug((R.uniform(3.5, 5.5), R.uniform(4.3, 6.3), 0), 1.0, "pottery")


build_materials(extra)
{"complete": complete, "build1": build1, "build2": build2, "ruin": ruin}[STATE]()
run("market", tex=2048)
