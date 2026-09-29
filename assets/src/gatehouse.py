"""HIGHGROUND - stone gatehouse for the stone curtain wall (procedural, Blender 5.1).

    blender -b -P assets/src/gatehouse.py -- [complete|build1|build2|ruin]
    -> assets/glb/gatehouse.glb / gatehouse_build1.glb / gatehouse_build2.glb / gatehouse_ruin.glb
    (GH_TEX=<px> overrides the bake size)

Twin D-shaped (half-round) towers flanking a pointed, two-centred arch; the passage is vaulted,
with a portcullis in its groove just inside the arch (hung raised, its spiked foot showing) and a
ledged double gate further in. The whole block is crenellated at a 10.5 m roof-walk over a lead
flat; a walk-level door in each flank opens onto the curtain wall's wall-walk.

Masonry comes from assets/src/wall_stone.py itself (same stone builder, material, merlons,
coping, putlogs, rubble core), so the gatehouse is the same stone as the wall.

KIT (same conventions as wall_stone_kit.json):
  * a TWO-CELL (12 m) module. Pivot = centre of the span ON THE WALL CENTRELINE, z = 0 ground,
    outer face -Y, ports at (-6,0,0) and (+6,0,0) -> wall_stone modules centred at x = +-9.
  * the flanks (x = +-6) cover the whole wall section (y -1.8..4.0, to 11.6 m); the curtain's
    wall-walk (z = 7.0, y -0.6..1.2) arrives at a door in the flank at exactly z = 7.0.
"""
import sys, os, math, random
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("HG_STATE", "complete")
import palisade as P            # _milkit timber kit + palisade timber materials
import bpy
from mathutils import Vector, Matrix

K, W, L = P.K, P.W, P.L
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
STATE = argv[0] if argv else "complete"
assert STATE in ("complete", "build1", "build2", "ruin"), STATE
TEX = int(os.environ.get("GH_TEX", "2048"))
PORTS12 = [((-6.0, 0.0), (-1, 0), (0, -1)), ((6.0, 0.0), (1, 0), (0, -1))]

GW = 10.5                   # roof-walk level
DZ = GW - W.Z_WALK          # the parapet is built at the wall's native heights, then lifted by DZ
TOPF = GW + (W.Z_SILL - W.Z_WALK)   # outer faces run up to the embrasure sills
YF, YR = -1.8, 4.0          # front (tower chord) and rear face lines
XS = 6.0                    # flanks
TC, TR = 4.0, 2.0           # tower centres (+-TC, YF), radius
A = 1.6                     # passage half width
ZS = 3.4                    # arch springing
RA = 2.24                   # arch radius (two-centred drop arch)
RING = 0.55                 # voussoir depth
CXA = RA - A
TH_APEX = math.acos(-CXA / RA)
LH = RA * (math.pi - TH_APEX)             # intrados arc length of one half
Z_APEX = ZS + math.sqrt(RA ** 2 - CXA ** 2)
Z_EXT = ZS + math.sqrt((RA + RING) ** 2 - CXA ** 2)
PG_Y = -1.2                 # portcullis groove
GATE_Y = 1.1                # gate leaves

ORIG_COURSES = W.COURSES
_Poly, _fill = W.Poly, W.fill


def gh_courses():
    r = random.Random(7777)
    out = []
    for z0, z1, n in [(0.0, W.PLINTH_H, 4), (W.PLINTH_H, W.Z_WALK, 12), (W.Z_WALK, GW, 8), (GW, TOPF, 2)]:
        w = [r.uniform(0.75, 1.3) for _ in range(n)]
        if z0 == 0.0:
            w = sorted(w, reverse=True)
        s = sum(w); z = z0
        for x in w:
            h = (z1 - z0) * x / s
            out.append([z, z + h, False]); z += h
        out[-1][1] = z1
    for lvl in (2.3, 4.0, 5.7, 8.3, 9.8):
        i = min(range(len(out)), key=lambda k: abs((out[k][0] + out[k][1]) / 2 - lvl))
        out[i][2] = True
    return [tuple(c) for c in out]


GH_COURSES = gh_courses()
BOUNDS = sorted(set([c[0] for c in GH_COURSES] + [GH_COURSES[-1][1]]))


def snapz(z):
    return min(BOUNDS, key=lambda b: abs(b - z))


# ------------------------------------------------------------------ arcs through the wall kit
class ArcPoly:
    """Stands in for wall_stone.Poly on a circular arc (CCW => outward = radial).  Built with
    bw = [0, 1, 0] so the batter can be ramped along the arc by wfun(u)."""

    def __init__(s, c, R, a0, a1, wfun=None):
        s.c = Vector(c); s.R = R; s.a0 = a0; s.a1 = a1
        s.L = R * abs(a1 - a0); s.n = 3; s.wfun = wfun

    def corners(s):
        return []

    def at(s, u, offs):
        d = offs[0]; bat = offs[1] - offs[0]
        w = s.wfun(u) if s.wfun else 1.0
        a = s.a0 + (s.a1 - s.a0) * u / s.L
        r = s.R + d + bat * w
        return Vector((s.c.x + r * math.cos(a), s.c.y + r * math.sin(a)))


W.Poly = lambda pts: pts if isinstance(pts, ArcPoly) else _Poly(pts)


def capped_fill(cap):
    def f(a, b, h, rng, wmin=0.36, wmax=1.3, k=(1.4, 3.0)):
        return _fill(a, b, h, rng, wmin, min(wmax, cap), k)
    return f


def face_F(pts, bw):
    pl = W.Poly(pts)

    def F(u, v, d):
        xy = pl.at(u, [W.batter(v) * wi + d for wi in bw])
        return Vector((xy.x, xy.y, v))
    return F


# ------------------------------------------------------------------ outline helpers
def outline(inset, n_arc=14):
    """CCW footprint outline offset inward by `inset`, starting mid-rear."""
    R = TR - inset
    phi = math.asin(min(0.999, inset / R)) if inset > 0 else 0.0
    xs = XS - inset
    pts = [(0.0, YR - inset), (-xs, YR - inset), (-xs, YF)]
    for i in range(1, n_arc + 1):
        a = math.pi + (math.pi + phi) * i / n_arc
        pts.append((-TC + R * math.cos(a), YF + R * math.sin(a)))
    for i in range(0, n_arc + 1):
        a = (math.pi - phi) + (math.pi + phi) * i / n_arc
        pts.append((TC + R * math.cos(a), YF + R * math.sin(a)))
    pts += [(xs, YR - inset), (0.0, YR - inset)]
    # drop duplicate consecutive points
    out = [pts[0]]
    for p in pts[1:]:
        if (Vector(p) - Vector(out[-1])).length > 1e-4:
            out.append(p)
    return out


def inside(pt, poly):
    x, y = pt; c = False
    n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1:
            c = not c
    return c


def intrados_z(x):
    ax = abs(x)
    if ax >= A:
        return ZS
    return ZS + math.sqrt(max(0.0, RA ** 2 - (ax + CXA) ** 2))


def xe(z):
    """half width of the voussoir ring's extrados at height z."""
    if z <= ZS:
        return A + RING
    q = (RA + RING) ** 2 - (z - ZS) ** 2
    return max(0.0, math.sqrt(q) - CXA) if q > 0 else 0.0


def arch_pt(u, rho):
    if u <= LH:
        th = math.pi - u / RA
        return CXA + rho * math.cos(th), ZS + rho * math.sin(th)
    x, z = arch_pt(2 * LH - u, rho)
    return -x, z


# ------------------------------------------------------------------ face builders
def poly_face(mb, pts, bw, z0, z1, rng, sk=None, ek=None, openings=(), putlogs=(), slots=(), keep=None):
    """build_face in horizontal bands so window/door openings get clean straight jambs."""
    zs_ = sorted(set([z0, z1] + [o[2] for o in openings if z0 < o[2] < z1] + [o[3] for o in openings if z0 < o[3] < z1]))
    for a, b in zip(zs_, zs_[1:]):
        act = [o for o in openings if o[2] <= a + 1e-6 and o[3] >= b - 1e-6]
        brk = sorted(set([o[0] for o in act] + [o[1] for o in act]))

        def kp(F, c0, c1, va, vb, act=act):
            for o in act:
                if c0 < o[1] - 1e-4 and c1 > o[0] + 1e-4:
                    return False
            return keep(F, c0, c1, va, vb) if keep else True
        W.build_face(mb, pts, a, b, rng, sk, ek, bw, putlogs=putlogs, slots=slots, keep=kp, breaks=brk)
    F = face_F(pts, bw)
    for (u0, u1, zlo, zhi, dep) in [(o[0], o[1], o[2], o[3], o[4]) for o in openings]:
        if keep and not keep(F, u0, u1, zlo, zhi):
            continue
        W.hole(mb, F, u0, u1, zlo, zhi, dep)


def tower_faces(mb, rng, keep=None):
    W.fill = capped_fill(0.78)
    for sx in (-1, 1):
        if sx > 0:
            ap = ArcPoly((TC, YF), TR, math.pi, 2 * math.pi, wfun=lambda u: W.smooth(0.0, 1.3, u))
            sk, ek = None, "gr"
        else:
            ap = ArcPoly((-TC, YF), TR, math.pi, 2 * math.pi, wfun=lambda u, L_=math.pi * TR: W.smooth(0.0, 1.3, L_ - u))
            sk, ek = "gl", None
        Lp = ap.L
        f = (lambda t: t) if sx > 0 else (lambda t: 1 - t)
        slots = [(Lp * f(0.52), 4.1, 5.5, 0.045, 0.22, 0.4), (Lp * f(0.8), 7.5, 8.9, 0.045, 0.22, 0.4),
                 (Lp * f(0.27), 7.5, 8.9, 0.045, 0.22, 0.4)]
        W.build_face(mb, ap, 0.0, TOPF, rng, sk, ek, [0.0, 1.0, 0.0], putlogs=W.putlog_us(Lp, rng), slots=slots, keep=keep)
    W.fill = _fill


def body_faces(mb, rng, keep=None):
    DT = snapz(9.1)
    # right flank + right half of the rear
    pts_r = [(XS, YF), (XS, YR), (2.0, YR)]
    op_r = [(1.65, 2.55, W.Z_WALK, DT, 1.3), (5.8 + (XS - 3.9), 5.8 + (XS - 3.2), snapz(8.0), snapz(9.2), 0.4)]
    poly_face(mb, pts_r, [1.0, 0.0], 0.0, TOPF, rng, "gr", None, op_r, putlogs=W.putlog_us(9.8, rng, [5.8]), keep=keep)
    pts_l = [(-2.0, YR), (-XS, YR), (-XS, YF)]
    op_l = [(1.2, 1.9, snapz(8.0), snapz(9.2), 0.4),
            (4.0 + (YR - 0.75), 4.0 + (YR + 0.15), W.Z_WALK, DT, 1.3)]
    poly_face(mb, pts_l, [0.0, 1.0], 0.0, TOPF, rng, None, "gl", op_l, putlogs=W.putlog_us(9.8, rng, [4.0]), keep=keep)
    # jambs + passage walls (to the springing), with the portcullis groove
    PL = [(-2.0, YF), (-A, YF), (-A, YR), (-2.0, YR)]
    PR = [(2.0, YR), (A, YR), (A, YF), (2.0, YF)]
    gl = 0.4 + (PG_Y - YF)
    gr = 0.4 + (YR - PG_Y)
    W.build_face(mb, PL, 0.0, ZS, rng, None, None, [0.0, 0.0, 0.0], slots=[(gl, 0.0, ZS, 0.09, 0.3, 0.2)], keep=keep)
    W.build_face(mb, PR, 0.0, ZS, rng, None, None, [0.0, 0.0, 0.0], slots=[(gr, 0.0, ZS, 0.09, 0.3, 0.2)], keep=keep)


def arch_zone(mb, rng, yface, s, keep=None, zmax=TOPF):
    """voussoir ring + spandrel courses + mortar backing over |x| <= 2 above the springing."""
    def Fa(u, v, d):
        x, z = arch_pt(u, RA + v)
        return Vector((x, yface + s * d, z))

    def Ff(u, v, d):
        return Vector((u, yface + s * d, v))
    n = max(4, int(round(LH / 0.42)))
    bnd = [LH * k / (n + 0.5) for k in range(n + 1)]
    pieces = list(zip(bnd, bnd[1:])) + [(bnd[-1], 2 * LH - bnd[-1])] + [(2 * LH - b, 2 * LH - a) for a, b in zip(bnd, bnd[1:])][::-1]
    for ua, ub in pieces:
        xa, za = arch_pt((ua + ub) / 2, RA + RING)
        if za > zmax or (keep and not keep(Ff, xa - 0.1, xa + 0.1, za - 0.3, za)):
            continue
        ins = tuple(rng.uniform(0.012, 0.022) for _ in range(6))
        dfun = (lambda d0: lambda u, v: d0)(rng.uniform(0.035, 0.05))
        W.stone(mb, Fa, ua, ub, 0.0, RING, ins, dfun, rng.random(), 1, [LH] if ua < LH < ub else [], pillow=0.1)
    # spandrel courses
    for ca, cb, _ in GH_COURSES:
        if cb <= ZS + 0.03 or ca >= zmax:
            continue
        va, vb = max(ca, ZS), min(cb, zmax)
        h = vb - va
        if h < 0.05:
            continue
        if va >= Z_EXT - 0.02:
            spans = [(-2.0, 2.0, 0.0, 0.0)]
        else:
            e0, e1 = xe(va), xe(min(vb, Z_EXT))
            if vb > Z_EXT:
                e1 = 0.0
            # push the slanted joint off the (convex) extrados so the stones never overlap the ring
            dev = 0.0
            for k in range(1, 6):
                z = va + (min(vb, Z_EXT) - va) * k / 6
                lin = e0 + (e1 - e0) * (z - va) / max(1e-6, (vb - va))
                dev = max(dev, xe(z) - lin)
            e0 += dev + 0.012; e1 += dev + 0.012
            spans = [(-2.0, -(e0 + e1) / 2, 0.0, (e0 - e1) / 2), ((e0 + e1) / 2, 2.0, -(e0 - e1) / 2, 0.0)]
        for a, b, sl_l, sl_r in spans:
            if b - a < 0.12:
                continue
            cells = W.fill(a, b, h, rng)
            for i, (c0, c1) in enumerate(cells):
                if keep and not keep(Ff, c0, c1, va, vb):
                    continue
                sl = (sl_l if i == 0 else 0.0, sl_r if i == len(cells) - 1 else 0.0)
                W.stone(mb, Ff, c0, c1, va, vb, W.rubble_ins(rng), W.rubble_d(rng, c0, c1, va, vb), rng.random(), 0, [], sl=sl)
    # mortar backing behind everything (fills the small joints next to the ring)
    xs = [-2.0 + 4.0 * i / 24 for i in range(25)]
    for x0, x1 in zip(xs, xs[1:]):
        z0a, z0b = intrados_z(x0), intrados_z(x1)
        q = [mb.V((x0, yface - s * 0.004, z0a), 0.5, 0, 1.0), mb.V((x1, yface - s * 0.004, z0b), 0.5, 0, 1.0),
             mb.V((x1, yface - s * 0.004, zmax), 0.5, 0, 1.0), mb.V((x0, yface - s * 0.004, zmax), 0.5, 0, 1.0)]
        mb.F(q, Vector((0, s, 0)))


def vault(mb, rng, keep=None):
    def Fv(u, v, d):
        x, z = arch_pt(u, RA - d)
        return Vector((x, v, z))
    y0, y1 = PG_Y - 0.1, PG_Y + 0.1
    rows = W.fill(YF, y0, 0.5, rng, 0.45, 0.75) + W.fill(y1, YR, 0.5, rng, 0.45, 0.75)
    for ra, rb in rows:
        cells = W.fill(0.0, 2 * LH, 0.3, rng, 0.35, 0.8)
        for c0, c1 in cells:
            ins = tuple(rng.uniform(0.01, 0.02) for _ in range(6))
            W.stone(mb, Fv, c0, c1, ra, rb, ins, (lambda d0: lambda u, v: d0)(rng.uniform(0.02, 0.04)), rng.random(), 1,
                    [LH] if c0 < LH < c1 else [], pillow=0.08)
    # the portcullis slot through the vault: dark recess following the arch
    us = [2 * LH * i / 16 for i in range(17)]
    for a, b in zip(us, us[1:]):
        pa, pb = arch_pt(a, RA + 0.55), arch_pt(b, RA + 0.55)
        q = [mb.V((pa[0], y0, pa[1]), 0.5, 3, 0.0), mb.V((pb[0], y0, pb[1]), 0.5, 3, 0.0),
             mb.V((pb[0], y1, pb[1]), 0.5, 3, 0.0), mb.V((pa[0], y1, pa[1]), 0.5, 3, 0.0)]
        mb.F(q, Vector((-(pa[0] + pb[0]) / 2, 0, -((pa[1] + pb[1]) / 2 - ZS))))
        for yy, sg in ((y0, 1), (y1, -1)):
            qa, qb = arch_pt(a, RA), arch_pt(b, RA)
            q = [mb.V((qa[0], yy, qa[1]), 0.5, 3, 1.0), mb.V((qb[0], yy, qb[1]), 0.5, 3, 1.0),
                 mb.V((pb[0], yy, pb[1]), 0.5, 3, 0.0), mb.V((pa[0], yy, pa[1]), 0.5, 3, 0.0)]
            mb.F(q, Vector((0, sg, 0)))


def paving(mb, rng):
    cw = W.Poly([(0.0, YF - 1.3), (0.0, YR + 1.1)])
    W.build_slabs(mb, cw, 0.0, cw.L, -A + 0.02, A - 0.02, 0.0, rng, rows=(0.28, 0.42), pieces=(5, 7),
                  relief=(0.02, 0.04), kind=0, ins=(0.01, 0.025), pillow=0.2)


def parapet(mb, rng, keep_top=None, shift=DZ):
    """merlons, embrasure sills, coping, inner parapet face - at the wall's native heights, lifted."""
    W.COURSES = ORIG_COURSES
    tmp = W.MB()
    cpar = W.Poly(outline(0.3))
    Lp = cpar.L
    embr = []
    u = 1.25
    while u < Lp - 1.2:
        embr.append(u); u += rng.uniform(1.85, 2.1)
    kt = None
    if keep_top:
        kt = lambda F, u0, u1: keep_top(cpar.at((u0 + u1) / 2, 0.0))
    W.build_parapet(tmp, cpar, embr, rng, sp=True, ep=True, arrow_prob=0.45, keep_top=kt)
    inner = outline(0.6)[::-1]
    fk = None
    if keep_top:
        fk = lambda F, c0, c1, va, vb: keep_top(F((c0 + c1) / 2, va, 0))
    W.build_face(tmp, inner, W.Z_WALK, W.Z_SILL, rng, "pi", "pi", keep=fk)
    W.COURSES = GH_COURSES
    base = len(mb.v)
    for i, p in enumerate(tmp.v):
        mb.v.append((p[0], p[1], p[2] + shift))
    for k in mb.a:
        mb.a[k] += tmp.a[k]
    mb.tq += tmp.tq
    mb.f += [[base + i for i in f] for f in tmp.f]


def lead_roof(z):
    pts = outline(0.6)
    bt = P.SB("lead")
    bt.add([(x, y, z) for x, y in pts], [tuple(range(len(pts)))], None, 0.5, [(x, y, 0.0) for x, y in pts])
    # a timber hatch over the stair and a lead roll ridge
    K.box(K.B("plank"), (-4.6, 1.6, z), (-3.5, 2.8, z + 0.42), 0.02)
    K.box(K.B("hewn"), (-4.65, 1.55, z + 0.38), (-3.45, 2.85, z + 0.48), 0.02, rot=(0.05, 0, 0))


def m_lead(name):
    g = K.G(name)
    x, y, z = g.sep(g.P)
    col = g.ramp(g.noise(g.P, 0.8, 3), [(0.3, "#5e6264"), (0.55, "#6a6e70"), (0.8, "#7a7d7c")])
    roll = g.math("ABSOLUTE", g.math("SINE", g.mul(x, math.pi / 0.62)))
    seam = g.inv(g.mr(roll, 0.0, 0.08))
    col = g.mix(g.mul(seam, 0.4), col, "#4a4d4f")
    ox = g.mr(g.noise(g.P, 2.5, 4), 0.55, 0.72)
    col = g.mix(g.mul(ox, 0.55), col, "#a3a49e")                 # white lead oxide bloom
    fine = g.noise(g.P, 30.0, 4)
    col = g.mix(0.25, col, fine, "OVERLAY")
    grime = g.mr(g.noise(g.P, 0.6, 3), 0.5, 0.7)
    col = g.mix(g.mul(grime, 0.35), col, "#4c4a44")
    return g.out(col, g.add(0.62, g.mul(ox, 0.2)), g.add(g.mul(seam, -1.0), g.mul(fine, 0.2)), 1.0, 0.02)


# ------------------------------------------------------------------ timber: gates and portcullis
def gate_leaves(rng, mats=("oak", "hewn", "iron"), M=None, which=(-1, 1)):
    pm, lm, im = mats

    def Bm(mat, p0, p1, w, d, bev, side=None):
        p0, p1 = Vector(p0), Vector(p1)
        if M is not None:
            p0, p1 = M @ p0, M @ p1
            side = (M.to_3x3() @ Vector(side)) if side is not None else None
        K.beam(K.B(mat), p0, p1, w, d, bev, side=side)
    for sx in which:
        x = 0.012
        while x < A - 0.03:
            w = min(rng.uniform(0.25, 0.3), A - 0.03 - x)
            if A - 0.03 - x - w < 0.12:
                w = A - 0.03 - x
            xc = sx * (x + w / 2)
            top = min(intrados_z(xc - w / 2 * sx), intrados_z(xc + w / 2 * sx)) - 0.04
            Bm(pm, (xc, GATE_Y, 0.04), (xc, GATE_Y, top), w - 0.01, 0.08, 0.008, side=(0, -1, 0))
            x += w
        for z in (0.6, 2.2, 3.8):
            zt = z + 0.15
            xi_ = (math.sqrt(max(0.0, RA ** 2 - (zt - ZS) ** 2)) - CXA) if zt > ZS else A
            x1 = min(A - 0.1, xi_ - 0.1)
            Bm(lm, (sx * 0.05, GATE_Y + 0.09, z), (sx * max(0.3, x1), GATE_Y + 0.09, z), 0.24, 0.09, 0.012, side=(0, 1, 0))
            Bm(im, (sx * (A - 0.02), GATE_Y - 0.055, z + 0.05), (sx * (A - 1.1), GATE_Y - 0.055, z + 0.05), 0.08, 0.014, 0.003,
               side=(0, -1, 0))
        Bm(lm, (sx * 0.2, GATE_Y + 0.09, 0.75), (sx * (A - 0.25), GATE_Y + 0.09, 2.05), 0.18, 0.08, 0.012, side=(0, 1, 0))
        Bm(im, (sx * 0.14, GATE_Y - 0.07, 1.5), (sx * 0.14, GATE_Y - 0.07, 1.62), 0.05, 0.05, 0.01)


def portcullis(rng, bottom=4.35, mats=("hewn", "iron"), tilt=None):
    wm, im = mats
    xs = [-A + 0.14 + (2 * A - 0.28) * i / 10 for i in range(11)]
    for x in xs:
        top = intrados_z(x) + 0.4
        if top - bottom < 0.05:
            continue
        K.beam(K.B(wm), (x, PG_Y, bottom), (x, PG_Y, top), 0.11, 0.1, 0.01)
        K.cyl(K.B(im), (x, PG_Y, bottom + 0.02), (x, PG_Y, bottom - 0.26), 0.05, 0.006, n=4)
    for z in (bottom + 0.18, bottom + 0.62, bottom + 1.06):
        xm = math.sqrt(max(0.0, RA ** 2 - (z - ZS) ** 2)) - CXA + 0.3 if z > ZS else A + 0.3
        if xm > 0.2:
            K.beam(K.B(wm), (-xm, PG_Y + 0.08, z), (xm, PG_Y + 0.08, z), 0.1, 0.09, 0.01)


# ------------------------------------------------------------------ states
def footprint_top(mb, z, rng, cull_passage=False, lumps=0.05, zfun=None, inset=0.15, bbox=None, poly=None):
    """rubble-core top over the footprint (building states / broken ruin top)."""
    poly = poly or outline(inset, 18)
    x0, x1, y0, y1 = bbox or (-XS, XS, YF - TR, YR)

    def hf(x, y):
        zz = zfun(x, y) if zfun else z
        return zz + rng.uniform(-lumps, lumps)

    def cull(q):
        cx = sum(p[0] for p in q) / 4; cy = sum(p[1] for p in q) / 4
        if not inside((cx, cy), poly):
            return True
        return cull_passage and abs(cx) < A + 0.05
    W.heightfield(mb, x0, x1, y0, y1, 0.25, hf, 2, sr_fn=lambda x, y, zz: rng.random(), cull=cull)


def build(state, seed=9091):
    rng = random.Random(seed); K.R.seed(seed)
    W.COURSES = GH_COURSES
    mb = W.MB()
    if state == "complete":
        tower_faces(mb, rng)
        body_faces(mb, rng)
        for yf, s in ((YF, -1), (YR, 1)):
            arch_zone(mb, rng, yf, s)
        vault(mb, rng)
        paving(mb, rng)
        parapet(mb, rng)
        lead_roof(GW + 0.012)
        gate_leaves(rng)
        portcullis(rng)
    elif state == "build1":
        zb = W.PLINTH_H
        extra = {}

        def keep(F, c0, c1, va, vb):
            p = F((c0 + c1) / 2, va, 0)
            k = (round(p.x * 0.7), round(p.y * 0.7))
            if k not in extra:
                extra[k] = rng.random() < 0.35
            lim = zb + (0.45 if extra[k] else 0.0)
            return vb <= lim + 1e-4
        tower_faces(mb, rng, keep)
        body_faces(mb, rng, keep)
        footprint_top(mb, zb - 0.04, rng, cull_passage=True, lumps=0.04)
        for k in range(14):
            x = rng.uniform(-5.4, 5.4); y = rng.uniform(-3.0, 3.6)
            if not inside((x, y), outline(0.3)) or abs(x) < A + 0.1:
                continue
            W.rock(mb, (x, y, zb + 0.12), 0, rng, kind=1,
                   box=(rng.uniform(0.35, 0.6), rng.uniform(0.25, 0.4), rng.uniform(0.2, 0.3)))
        site_props(mb, rng, 0.0)
    elif state == "build2":
        zb = snapz(6.35)

        def keep(F, c0, c1, va, vb):
            return vb <= zb + 1e-4
        tower_faces(mb, rng, keep)
        body_faces(mb, rng, keep)
        for yf, s in ((YF, -1), (YR, 1)):
            arch_zone(mb, rng, yf, s, keep=keep, zmax=zb)
        vault(mb, rng)
        paving(mb, rng)
        footprint_top(mb, zb - 0.04, rng, lumps=0.04, inset=0.12)
        for k in range(16):
            x = rng.uniform(-5.4, 5.4); y = rng.uniform(-3.0, 3.6)
            if not inside((x, y), outline(0.3)):
                continue
            W.rock(mb, (x, y, zb + 0.12), 0, rng, kind=1,
                   box=(rng.uniform(0.35, 0.6), rng.uniform(0.25, 0.4), rng.uniform(0.2, 0.3)))
        centring(rng)
        scaffold(rng, zb)
        site_props(mb, rng, 1.0)
    else:
        ruin(mb, rng)
    W.COURSES = ORIG_COURSES
    return mb


def zr_fn(seed):
    r = random.Random(seed)
    jag = [r.uniform(-0.55, 0.45) for _ in range(64)]

    def zr(x, y):
        """ruin top height: the west tower and the west end of the block are thrown down."""
        t = W.smooth(-0.6, -2.8, x)                        # 0 east ... 1 west
        tw = W.smooth(-2.6, -4.4, x) * W.smooth(0.8, -1.2, y)
        base = TOPF + 2.0
        low = 7.2 - 2.3 * tw - 0.8 * W.smooth(-3.5, -5.8, x)
        k = int(((x + 7) * 3.1 + (y + 5) * 1.7)) % 64
        return base * (1 - t) + (low + jag[k] * min(1.0, t * 1.5)) * t
    return zr


def ruin(mb, rng):
    zr = zr_fn(515)

    def keep(F, c0, c1, va, vb):
        p = F((c0 + c1) / 2, va, 0)
        return vb <= zr(p.x, p.y) + rng.uniform(-0.15, 0.3)
    tower_faces(mb, rng, keep)
    body_faces(mb, rng, keep)
    for yf, s in ((YF, -1), (YR, 1)):
        arch_zone(mb, rng, yf, s, keep=keep)
    vault(mb, rng)
    paving(mb, rng)
    # parapet: gone over the broken west end, merlons knocked off elsewhere
    gone = {}

    def keep_top(p):
        k = round(p.x * 0.8 + p.y * 0.37, 0)
        if k not in gone:
            gone[k] = rng.random() < 0.22
        return p.x > -0.4 and not gone[k]
    parapet(mb, rng, keep_top)
    # roof burnt out: rubble-core top at the walk over the intact part, the broken rubble slope west
    poly_in = outline(0.45, 18)
    poly_out = outline(0.12, 18)

    def zf(x, y):
        return min(GW - 0.02, zr(x, y) - 0.12)

    def cull(q):
        cx = sum(p[0] for p in q) / 4; cy = sum(p[1] for p in q) / 4
        return not inside((cx, cy), poly_in if zr(cx, cy) > GW + 0.5 else poly_out)
    W.heightfield(mb, -XS, XS, YF - TR, YR, 0.25, lambda x, y: zf(x, y) + rng.uniform(-0.08, 0.1), 2,
                  sr_fn=lambda x, y, z: rng.random(), cull=cull)
    # masonry lumps crowning the break
    for k in range(60):
        x = rng.uniform(-6.2, -0.6); y = rng.uniform(-3.9, 4.1)
        if not inside((x, y), outline(0.0, 18)) or zr(x, y) > GW:
            continue
        s = rng.uniform(0.2, 0.45)
        W.rock(mb, (x, y, zf(x, y) + s * 0.1), s, rng, kind=0 if rng.random() < 0.5 else 2, squash=0.8)
    # spill mound in front of the west tower and down the flank
    soil = W.MB()

    def mound(x, y):
        h = 2.6 * math.exp(-((x + 4.2) / 1.9) ** 2 - ((y + 4.9) / 1.5) ** 2)
        h += 1.5 * math.exp(-((x + 7.0) / 1.0) ** 2 - ((y + 1.0) / 2.2) ** 2)
        h += 0.08 * math.sin(x * 3.1 + y * 2.3)
        return max(0.0, h - 0.1)
    W.heightfield(soil, -8.4, -0.6, -8.4, 3.5, 0.3, mound, 4,
                  cull=lambda q: max(p[2] for p in q) < 0.01 or all(inside((p[0], p[1]), outline(-0.05, 18)) for p in q))
    n = 0
    while n < 40:
        x = rng.uniform(-8.2, -0.8); y = rng.uniform(-8.2, 3.3)
        h = mound(x, y)
        if h < 0.05 or inside((x, y), outline(-0.1, 18)):
            continue
        s = rng.uniform(0.14, 0.42)
        W.rock(mb, (x, y, h - s * 0.3), s, rng, kind=0 if rng.random() < 0.6 else 2)
        n += 1
    for _ in range(8):
        x = -4.2 + rng.uniform(-2.0, 2.0); y = -4.8 + rng.uniform(-1.2, 1.2)
        W.rock(mb, (x, y, max(0.1, mound(x, y) - 0.05)), 0, rng, kind=1,
               box=(rng.uniform(0.45, 0.8), rng.uniform(0.3, 0.45), rng.uniform(0.25, 0.35)))
    W.rock(mb, (-3.3, -6.0, 0.55), 0, rng, kind=1, box=(1.1, 0.6, 0.85))
    RUIN_EXTRA["soil"] = soil
    # burnt gates: one leaf fallen outward into the passage, the other half-burnt in place;
    # the portcullis dropped askew and jammed
    gate_leaves(rng, mats=("char", "char", "iron"), which=(1,))
    M = Matrix.Translation((-A + 0.1, GATE_Y - 0.1, 0.3)) @ Matrix.Rotation(math.radians(-80), 4, "X") @ \
        Matrix.Translation((0, -GATE_Y, 0))
    gate_leaves(rng, mats=("char", "char", "iron"), M=M, which=(-1,))
    portcullis(rng, bottom=1.6, mats=("char", "iron"))
    # charred roof timbers across the top
    for k in range(9):
        x = rng.uniform(-0.5, 4.8); y = rng.uniform(-1.5, 3.2)
        a = rng.uniform(0, 3.1); ln = rng.uniform(1.5, 3.5)
        d = Vector((math.cos(a), math.sin(a), 0)) * ln / 2
        K.beam(K.B("char"), (x - d.x, y - d.y, GW + 0.15), (x + d.x, y + d.y, GW + 0.1 + rng.uniform(0, 0.4)), 0.2, 0.22, 0.015)


RUIN_EXTRA = {}


def centring(rng):
    """timber centring still under the front and rear arches, on props."""
    for yy in (YF + 0.25, YR - 0.25):
        us = [2 * LH * i / 10 for i in range(11)]
        for a, b in zip(us, us[1:]):
            pa, pb = arch_pt(a, RA - 0.12), arch_pt(b, RA - 0.12)
            K.beam(K.B("fresh"), (pa[0], yy, pa[1]), (pb[0], yy, pb[1]), 0.14, 0.18, 0.01)
        for x in (-A + 0.15, -0.6, 0.6, A - 0.15):
            K.beam(K.B("hewn"), (x, yy, 0.0), (x, yy, intrados_z(x) - 0.2), 0.14, 0.14, 0.012)
        K.beam(K.B("hewn"), (-A + 0.05, yy, ZS - 0.1), (A - 0.05, yy, ZS - 0.1), 0.18, 0.2, 0.012)
        for x in (-1.0, 0.0, 1.0):
            K.beam(K.B("fresh"), (x, yy, ZS - 0.02), (x * 0.6, yy, intrados_z(x) - 0.15), 0.1, 0.12, 0.01)
    # lagging boards between the two ribs
    us = [2 * LH * i / 14 for i in range(15)]
    for u in us[1:-1]:
        x, z = arch_pt(u, RA - 0.05)
        K.beam(K.B("plank"), (x, YF + 0.1, z), (x, YR - 0.1, z), 0.2, 0.04, 0.005, side=(-x, 0, z - ZS))


def scaffold(rng, top):
    for y0, x0, x1, n in ((YF - TR - 1.2, -5.5, 5.5, 7), (YR + 1.2, -5.5, 5.5, 6)):
        for i in range(n):
            x = x0 + (x1 - x0) * i / (n - 1) + rng.uniform(-0.1, 0.1)
            if abs(x) < A + 0.3 and y0 < 0:
                continue
            K.cyl(K.B("oak"), (x, y0, 0.0), (x + rng.uniform(-0.08, 0.08), y0 + rng.uniform(-0.08, 0.08), top + 1.4), 0.075, 0.055, n=6)
        for z in (1.9, 3.8, 5.7):
            if z > top:
                continue
            for a, b in ((x0 - 0.3, -A - 0.4), (A + 0.4, x1 + 0.3)) if y0 < 0 else ((x0 - 0.3, x1 + 0.3),):
                K.cyl(K.B("oak"), (a, y0, z), (b, y0, z + rng.uniform(-0.05, 0.05)), 0.05, n=6)
                k = a + 0.6
                while k < b - 0.3:
                    ystop = (YF - math.sqrt(max(0.0, TR ** 2 - (abs(k) - TC) ** 2)) if abs(abs(k) - TC) < TR else YF) \
                        if y0 < 0 else YR
                    K.beam(K.B("oak"), (k, y0 - 0.25 * (1 if y0 < 0 else -1), z + 0.06), (k, ystop + (0.25 if y0 < 0 else -0.25), z + 0.06),
                           0.08, 0.08, 0.0)
                    k += 1.3
                for j in range(3):
                    off = (j * 0.3 + 0.2) * (1 if y0 < 0 else -1)
                    P.plank((a, y0 + off, z + 0.13), (b, y0 + off, z + 0.13 + rng.uniform(-0.02, 0.02)), 0.28, 0.04, rng)
    K.ladder((-2.4, YF - TR - 2.6, 0.0), (-2.5, YF - TR - 1.3, 3.8), mat="oak")
    # a shear-legs hoist on the top
    for s in (-1, 1):
        K.cyl(K.B("oak"), (2.5 + s * 0.9, 0.5, top), (2.5, -0.5, top + 3.4), 0.08, 0.06, n=6)
    K.cyl(K.B("oak"), (2.5, 2.0, top), (2.5, -0.5, top + 3.4), 0.08, 0.06, n=6)
    K.cyl(K.B("rope"), (2.5, -0.5, top + 3.35), (2.5, -1.2, 1.2), 0.012, n=4)


def site_props(mb, rng, level):
    # stone stock piles, a mortar trough, timber, a setting-out line
    for cx, cy in ((-7.6, 5.8), (7.4, 6.2), (5.5, -6.3)):
        for k in range(12):
            x = cx + rng.uniform(-0.9, 0.9); y = cy + rng.uniform(-0.5, 0.5)
            W.rock(mb, (x, y, 0.15 + 0.28 * (k // 6)), 0, rng, kind=1,
                   box=(rng.uniform(0.45, 0.7), rng.uniform(0.3, 0.42), rng.uniform(0.25, 0.3)))
    P.plank((-2.6, 6.2, 0.18), (-1.4, 6.3, 0.18), 0.55, 0.05, rng)
    for s in (-1, 1):
        K.beam(K.B("plank"), (-2.6, 6.25 + s * 0.27, 0.3), (-1.4, 6.35 + s * 0.27, 0.3), 0.04, 0.25, 0.005, side=(0, 1, 0))
    K.timber_stack(1.2, 5.6, 4.2, 3, True)
    if level < 0.5:
        # setting-out: pegs and lines round the tower fronts
        for sx in (-1, 1):
            for i in range(7):
                a = math.pi + math.pi * i / 6
                x, y = sx * TC + (TR + 0.9) * math.cos(a), YF + (TR + 0.9) * math.sin(a)
                K.cyl(K.B("hewn"), (x, y, 0.0), (x, y, 0.6), 0.03, n=5)
        for sx in (-1, 1):
            for i in range(6):
                a0 = math.pi + math.pi * i / 6; a1 = math.pi + math.pi * (i + 1) / 6
                p0 = (sx * TC + (TR + 0.9) * math.cos(a0), YF + (TR + 0.9) * math.sin(a0))
                p1 = (sx * TC + (TR + 0.9) * math.cos(a1), YF + (TR + 0.9) * math.sin(a1))
                K.cyl(K.B("rope"), (p0[0], p0[1], 0.5), (p1[0], p1[1], 0.5), 0.008, n=4)


def materials(state):
    P.build_materials(state)
    K.MAT["lead"] = m_lead("gh_lead")
    K.MAT["rope"] = K.m_simple("gh_rope", "#8a7a58", "#a08e68", 0.9, 30.0)
    if state == "ruin":
        K.MAT["char"] = P.m_char("gh_char")


if __name__ == "__main__":
    name = "gatehouse" if STATE == "complete" else "gatehouse_" + STATE
    seed = 9091
    mb = build(STATE, seed)
    materials(STATE)
    sm = sum(map(ord, name))
    o = mb.obj("gh_stone", W.stone_material(sm))
    qp, qw = W.port_coords(mb, PORTS12)
    W.attach_qp(o, qp, qw)
    print("GH_STONE_TRIS", sum(len(f) - 2 for f in mb.f))
    soil = RUIN_EXTRA.get("soil")
    if soil and soil.f:
        so = soil.obj("gh_soil", W.soil_material(sm))
        qp, qw = W.port_coords(soil, PORTS12)
        W.attach_qp(so, qp, qw)
    K.finalize(name, tex=TEX, lods=(1.0, 0.4, 0.12))
    if not os.environ.get("HG_DRY"):
        import json
        kit_path = os.path.join(L.GLB_DIR, "wall_stone_kit.json")
        kit = json.load(open(kit_path))
        kit["modules"][name] = {"ports": [dict(pos=[p[0], p[1], 0.0], axis=[a[0], a[1], 0.0], outer=[q[0], q[1], 0.0])
                                          for p, a, q in PORTS12]}
        json.dump(kit, open(kit_path, "w"), indent=1)
