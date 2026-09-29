"""HIGHGROUND - timber gate for the palisade (procedural, Blender 5.1).

    blender -b -P assets/src/gate.py -- [complete|build1|build2|ruin]
    -> assets/glb/gate.glb / gate_build1.glb / gate_build2.glb / gate_ruin.glb   (GATE_TEX=<px>)

Two plank-clad timber gate towers on the ends of the bank, a 6.8 m passage between them closed
by a ledged-and-braced double gate on stout hanging posts, and a fighting platform (plank
bridge with a loopholed breastwork) carried over the gate on lintels. Each tower has a jettied
hoarding storey under a hipped shingle roof. The road crosses the ditch on a causeway.

KIT: a TWO-CELL module of the palisade kit (see palisade.py / wall_stone.py conventions):
pivot = centre of the 12 m span on the stake line, z = 0 ground, outer face -Y, ports at
(-6,0,0) and (+6,0,0). The earthwork at x = +-6 has exactly the palisade profile, so a
palisade module centred at x = +-9 abuts it seamlessly; its walk meets a door in the tower side.
"""
import sys, os, math, random
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault("HG_STATE", "complete")
import palisade as P
import bpy
from mathutils import Vector, Matrix

K, W, L = P.K, P.W, P.L
TEX = int(os.environ.get("GATE_TEX", "2048"))
HALF = 6.0
PORTS12 = [((-6.0, 0.0), (-1, 0), (0, -1)), ((6.0, 0.0), (1, 0), (0, -1))]

XI, XO = 3.55, 5.78         # tower post centres (inner / outer), mirrored in x
YF, YB = -1.25, 1.55        # tower post centres (front / back)
PS = 0.32                   # post size
FLOOR = 5.4                 # platform deck top
TOP = 7.0                   # wall-plate top
ROAD_Z = 0.1
CL = PS / 2 + 0.03          # cladding centre offset from post centre line
JET_F, JET_S = 0.38, 0.22   # hoarding jetty: front, passage side


def gate_h(x, y, seed, state):
    base = P.earth_h(x, y, seed, HALF)
    m = W.smooth(4.75, 3.55, abs(x))
    edge = W.smooth(0.0, 0.6, y - P.Y0) * W.smooth(0.0, 0.6, P.Y1 - y)
    rut = -0.05 * math.exp(-((abs(x) - 0.8) / 0.16) ** 2) + 0.012 * math.sin(x * 5.1 + y * 1.3)
    road = (ROAD_Z + (rut if state != "build1" else 0.0)) * edge
    return max(0.0, base * (1 - m) + road * m)


# ------------------------------------------------------------------ pieces
def post(x, y, z0, z1, rng, s=PS, mat="hewn"):
    K.beam(K.B(mat), (x + rng.uniform(-0.01, 0.01), y, z0), (x + rng.uniform(-0.015, 0.015), y + rng.uniform(-0.01, 0.01), z1),
           s * rng.uniform(0.95, 1.04), s * rng.uniform(0.95, 1.04), 0.025)


def clad(p0, p1, z0, z1, nrm, rng, mat="plank", doors=(), loops=(), stop=None, ragged=0.0):
    """vertical boards from p0 to p1 (xy), boards 5 cm thick, face normal `nrm` (xy).
    doors: (u0, u1, zlo, zhi) openings; loops: u of loophole slits; stop: keep board if fn(u) true.
    ragged: burnt tops - each board ends at a random height."""
    p0, p1 = Vector((p0[0], p0[1], 0)), Vector((p1[0], p1[1], 0))
    d = p1 - p0; Ln = d.length; d.normalize()
    n = Vector((nrm[0], nrm[1], 0))
    u = 0.0
    while u < Ln - 0.05:
        w = min(rng.uniform(0.22, 0.31), Ln - u)
        if Ln - u - w < 0.12:
            w = Ln - u
        uc = u + w / 2
        if stop and not stop(uc):
            u += w; continue
        c = p0 + d * uc + n * rng.uniform(-0.006, 0.006)
        top = z1 + rng.uniform(-0.03, 0.02)
        if ragged:
            top = z0 + (z1 - z0) * rng.uniform(0.05, 1.0) ** ragged
        spans = [(z0, top)]
        for (a, b, zlo, zhi) in doors:
            if a < uc < b:
                spans = [(s0, min(s1, zlo)) for s0, s1 in spans if s0 < zlo] + [(max(s0, zhi), s1) for s0, s1 in spans if s1 > zhi]
        if any(abs(uc - lu) < w / 2 for lu in loops):
            zlo, zhi = z0 + (z1 - z0) * 0.42, z0 + (z1 - z0) * 0.78
            spans = [(s0, min(s1, zlo)) for s0, s1 in spans if s0 < zlo] + [(max(s0, zhi), s1) for s0, s1 in spans if s1 > zhi]
            ww = w * 0.3
            for sgn in (-1, 1):   # the slit: two narrow strips either side, board cut back in the middle
                cc = c + d * sgn * (w / 2 - ww / 2)
                K.beam(K.B(mat), (cc.x, cc.y, zlo), (cc.x, cc.y, zhi), ww - 0.008, 0.05, 0.006, side=(n.x, n.y, 0))
        for s0, s1 in spans:
            if s1 - s0 > 0.08:
                K.beam(K.B(mat), (c.x, c.y, s0), (c.x, c.y, s1), w - 0.012, 0.05 * rng.uniform(0.9, 1.1), 0.007,
                       side=(n.x, n.y, 0))
        u += w


def log_wall(p0, p1, z0, z1, nrm, rng, doors=(), mats=None, ragged=0.0):
    """vertical split logs (round side out) standing on the line p0->p1, flat faces on the line."""
    p0, p1 = Vector((p0[0], p0[1], 0)), Vector((p1[0], p1[1], 0))
    d = p1 - p0; Ln = d.length; d.normalize()
    rot = math.atan2(nrm[1], nrm[0]) + math.pi / 2
    n = int(round(Ln / P.PITCH))
    for i in range(n):
        u = (i + 0.5) * Ln / n
        c = p0 + d * u
        kind = P.stake_kind(rng)
        w = Ln / n * rng.uniform(1.1, 1.2)
        top = z1 + rng.uniform(-0.04, 0.02)
        if ragged:
            top = z0 + (z1 - z0) * rng.uniform(0.08, 1.0) ** ragged
        spans = [(z0, top)]
        for (a, b, zlo, zhi) in doors:
            if a - 0.1 < u < b + 0.1:
                spans = [(s0, min(s1, zlo)) for s0, s1 in spans if s0 < zlo] + [(max(s0, zhi), s1) for s0, s1 in spans if s1 > zhi]
        bark = kind != "slab" and rng.random() < 0.4
        for s0, s1 in spans:
            if s1 - s0 > 0.15:
                P.stake(c.x, c.y, s1, w, kind, rng, bark=bark, tip=False, z0=s0, rot=rot, mats=mats,
                        broken=s1 if ragged else None, lean=(rng.uniform(-0.006, 0.006), rng.uniform(-0.006, 0.006)))


def hip_roof(x0, x1, y0, y1, z, rng, pitch=math.radians(50), row=0.3, thick=0.06, mat="shingle"):
    """hipped roof over [x0,x1]x[y0,y1] with eaves at z: courses of shingles (thin stepped slabs)."""
    t = math.tan(pitch)
    hw = min(x1 - x0, y1 - y0) / 2
    slope = hw / math.cos(pitch)
    nrow = max(3, int(round(slope / row)))
    ds = [hw * i / nrow for i in range(nrow + 1)]
    bt = K.B(mat)
    # four faces: (edge start corner, edge dir, inward dir, length)
    faces = [((x0, y0), (1, 0), (0, 1), x1 - x0), ((x1, y0), (0, 1), (-1, 0), y1 - y0),
             ((x1, y1), (-1, 0), (0, -1), x1 - x0), ((x0, y1), (0, -1), (1, 0), y1 - y0)]
    for (cx, cy), (ex, ey), (ix, iy), ln in faces:
        for i in range(nrow):
            a, b = ds[i], ds[i + 1]
            la0, la1 = a, ln - a            # lateral extent along the edge at inset a
            lb0, lb1 = b, ln - b
            if la1 - la0 < 0.02:
                continue
            lb0, lb1 = min(lb0, (la0 + la1) / 2), max(lb1, (la0 + la1) / 2)
            lift = thick * rng.uniform(0.8, 1.2)

            def pt(l, d, dz):
                return (cx + ex * l + ix * d, cy + ey * l + iy * d, z + d * t + dz)
            ov = 0.1 * (b - a)          # lower edge of each course laps over the one below
            A = pt(la0 - ov, a - ov, lift); Bq = pt(la1 + ov, a - ov, lift)
            C = pt(lb1, b, 0.012); D = pt(lb0, b, 0.012)
            A2 = pt(la0 - ov, a - ov, 0.0); B2 = pt(la1 + ov, a - ov, 0.0)
            sl = (b - a) / math.cos(pitch)
            loc = [(la0, 0, 0), (la1, 0, 0), (lb1, sl, 0), (lb0, sl, 0), (la0, -0.04, 0), (la1, -0.04, 0)]
            bt.add([A, Bq, C, D, A2, B2], [(0, 1, 2, 3), (4, 5, 1, 0)], None, rng.random(), loc)
    # hip and ridge caps
    xm0, xm1 = x0 + hw, x1 - hw
    ym0, ym1 = y0 + hw, y1 - hw
    zt = z + hw * t
    for (px, py), (qx, qy) in (((x0, y0), (xm0, ym0)), ((x1, y0), (xm1, ym0)), ((x1, y1), (xm1, ym1)), ((x0, y1), (xm0, ym1))):
        K.beam(K.B("hewn"), (px, py, z + thick + 0.02), (qx, qy, zt + thick + 0.02), 0.16, 0.08, 0.02)
    if abs(xm1 - xm0) > 0.05 or abs(ym1 - ym0) > 0.05:
        K.beam(K.B("hewn"), (xm0, ym0, zt + thick + 0.04), (xm1, ym1, zt + thick + 0.04), 0.18, 0.1, 0.02)
    return zt


def tower(sx, rng, state):
    """one gate tower on the +x (sx=1) or -x (sx=-1) side."""
    fresh = state in ("build1", "build2")
    pm = "fresh" if fresh else "hewn"
    X = lambda v: sx * v
    xi, xo = X(XI), X(XO)
    # four corner posts
    for x in (xi, xo):
        for y in (YF, YB):
            post(x, y, 0.0, TOP if state != "build1" else TOP, rng, mat=pm)
    # girts / wall plates / floor bearers
    for z in (1.9, P.DECK - 0.2, FLOOR - 0.35):
        for (a, b) in (((xi, YF), (xo, YF)), ((xi, YB), (xo, YB)), ((xi, YF), (xi, YB)), ((xo, YF), (xo, YB))):
            K.beam(K.B(pm), (a[0], a[1], z), (b[0], b[1], z + rng.uniform(-0.01, 0.01)), 0.2, 0.22, 0.015)
    # X-braces in the lower storey (inside the cladding, seen through the door and in build2)
    for (a, b) in (((xi, YF), (xo, YF)), ((xi, YB), (xo, YB)), ((xo, YF), (xo, YB))):
        K.beam(K.B(pm), (a[0], a[1], 2.0), (b[0], b[1], P.DECK - 0.3), 0.14, 0.14, 0.012)
    # hoarding floor joists, projecting forward as the jetty
    for k in range(6):
        x = xi + (xo - xi) * (k + 0.5) / 6
        K.beam(K.B(pm), (x, YF - CL - JET_F + 0.02, FLOOR - 0.2), (x, YB + 0.18, FLOOR - 0.2), 0.16, 0.2, 0.015, side=(0, 0, 1))
    for k in range(4):
        y = YF + (YB - YF) * (k + 0.5) / 4
        K.beam(K.B(pm), (xi - sx * (CL + JET_S - 0.02), y, FLOOR - 0.43), (xi + sx * 0.4, y, FLOOR - 0.43), 0.14, 0.18, 0.015,
               side=(0, 0, 1))
    if state == "build2":
        return
    # ---- lower storey cladding (outside the posts)
    lo_x0, lo_x1 = xi - sx * CL, xo + sx * CL
    wd = abs(lo_x1 - lo_x0)
    xs0 = min(lo_x0, lo_x1)
    back_door = [(wd / 2 - 0.5, wd / 2 + 0.45, 0.0, 2.05)]
    side_door = [(YB - 0.3 - (YF - CL) - 1.15, YB - 0.3 - (YF - CL), P.DECK - 0.05, P.DECK + 2.0)]
    z_lo = FLOOR - 0.3
    LO = PS / 2 + 0.01
    fx0, fx1 = min(xi - sx * LO, xo + sx * LO), max(xi - sx * LO, xo + sx * LO)
    log_wall((fx0, YF - LO), (fx1, YF - LO), 0.0, z_lo, (0, -1), rng)
    bd = [(fx1 - fx0 - b, fx1 - fx0 - a, zl, zh) for a, b, zl, zh in back_door] if sx > 0 else back_door
    log_wall((fx1, YB + LO), (fx0, YB + LO), 0.0, z_lo, (0, 1), rng, doors=bd)
    # passage side and outer side (door at walk level on the outer side for the palisade walk)
    log_wall((xi - sx * LO, YB + LO), (xi - sx * LO, YF - LO), 0.0, z_lo, (-sx, 0), rng)
    sd = side_door[0]
    sdl = (sd[0] - (CL - LO), sd[1] - (CL - LO), sd[2], sd[3])
    if sx > 0:
        log_wall((xo + LO, YF - LO), (xo + LO, YB + LO), 0.0, z_lo, (1, 0), rng, doors=[sdl])
    else:
        Ls = (YB + LO) - (YF - LO)
        log_wall((xo - LO, YB + LO), (xo - LO, YF - LO), 0.0, z_lo, (-1, 0), rng, doors=[(Ls - sdl[1], Ls - sdl[0], sdl[2], sdl[3])])
    # a wale (external girt) pegged round the log walls, under the jetty
    for (a, b) in (((fx0 - 0.1, YF - LO - 0.24), (fx1 + 0.1, YF - LO - 0.24)),):
        K.beam(K.B("hewn"), (a[0], a[1], z_lo - 0.1), (b[0], b[1], z_lo - 0.1), 0.18, 0.2, 0.015)
    # door frame at the walk
    y_a, y_b = YF - CL + sd[0], YF - CL + sd[1]
    for y in (y_a - 0.05, y_b + 0.05):
        K.beam(K.B("hewn"), (lo_x1 - sx * 0.02, y, P.DECK - 0.1), (lo_x1 - sx * 0.02, y, P.DECK + 2.08), 0.12, 0.14, 0.012)
    K.beam(K.B("hewn"), (lo_x1 - sx * 0.02, y_a - 0.12, P.DECK + 2.05), (lo_x1 - sx * 0.02, y_b + 0.12, P.DECK + 2.05), 0.14, 0.16, 0.012)
    # ---- hoarding storey
    hx_in = xi - sx * (CL + JET_S)
    hx_out = lo_x1
    hy_f = YF - CL - JET_F
    hy_b = YB + CL
    z0h, z1h = FLOOR - 0.34, TOP
    hxa, hxb = min(hx_in, hx_out), max(hx_in, hx_out)
    clad((hxa, hy_f), (hxb, hy_f), z0h, z1h, (0, -1), rng, loops=[0.7, (hxb - hxa) - 0.7])
    clad((hxb, hy_b), (hxa, hy_b), z0h, z1h, (0, 1), rng, loops=[(hxb - hxa) / 2])
    clad((hx_in, hy_b), (hx_in, hy_f), z0h, z1h, (-sx, 0), rng, loops=[1.1, (hy_b - hy_f) - 0.9])
    clad((hx_out, hy_f), (hx_out, hy_b), z0h, z1h, (sx, 0), rng, loops=[(hy_b - hy_f) / 2])
    # sill + plate beams round the hoarding
    for z, s in ((z0h - 0.06, 0.16), (z1h + 0.08, 0.18)):
        pts = [(hxa, hy_f), (hxb, hy_f), (hxb, hy_b), (hxa, hy_b)]
        for i in range(4):
            a, b = pts[i], pts[(i + 1) % 4]
            K.beam(K.B("hewn"), (a[0], a[1], z), (b[0], b[1], z), s, s, 0.015, ext=0.1)
    # corner posts of the jettied front
    for x in (hxa + 0.08, hxb - 0.08):
        K.beam(K.B("hewn"), (x, hy_f + 0.09, z0h), (x, hy_f + 0.09, z1h), 0.16, 0.16, 0.015)
    # hipped shingle roof
    ov = 0.42
    hip_roof(hxa - ov, hxb + ov, hy_f - ov, hy_b + ov, z1h + 0.17, rng)


def bridge(rng, state):
    pm = "fresh" if state in ("build1", "build2") else "hewn"
    zl = FLOOR - 0.045 - 0.22 - 0.2
    for y in (YF, YB):
        K.beam(K.B(pm), (-XI - 0.1, y, zl), (XI + 0.1, y + rng.uniform(-0.01, 0.01), zl + rng.uniform(-0.01, 0.01)), 0.3, 0.38, 0.025)
        for sx in (-1, 1):   # knee braces under the lintels: the gate opening reads as a framed arch
            K.beam(K.B(pm), (sx * XI, y, zl - 1.25), (sx * (XI - 1.05), y, zl - 0.12), 0.18, 0.2, 0.015)
    # gate head beam over the leaves and the hanging posts
    for sx in (-1, 1):
        post(sx * XI, 0.0, 0.0, zl + 0.19, rng, s=0.38, mat=pm)
    K.beam(K.B(pm), (-XI - 0.12, 0.0, 4.52), (XI + 0.12, 0.0, 4.52), 0.28, 0.3, 0.02)
    # joists along y, deck planks along x
    for k in range(12):
        x = -XI + 2 * XI * (k + 0.5) / 12
        K.beam(K.B(pm), (x, YF - 0.2, FLOOR - 0.045 - 0.11), (x, YB + 0.22, FLOOR - 0.045 - 0.11), 0.14, 0.22, 0.012,
               side=(0, 0, 1))
    if state == "build2":
        return
    y = YF - 0.2
    while y < YB + 0.2:
        w = rng.uniform(0.25, 0.3)
        split = rng.uniform(-1.5, 1.5)
        for a, b in ((-XI + 0.02, split), (split, XI - 0.02)):
            P.plank((a, y + w / 2, FLOOR - 0.022), (b, y + w / 2 + rng.uniform(-0.01, 0.01), FLOOR - 0.022 + rng.uniform(-0.006, 0.006)),
                    w - 0.012, 0.045, rng)
        y += w
    # loopholed breastwork on the front, a rail on the back
    xb = XI - CL - JET_S
    yb = YF - 0.36
    for x in [-xb + 0.1 + (2 * xb - 0.2) * k / 4 for k in range(5)]:
        K.beam(K.B("hewn"), (x, yb + 0.1, FLOOR - 0.25), (x, yb + 0.1, FLOOR + 1.3), 0.14, 0.14, 0.012)
    clad((-xb, yb), (xb, yb), FLOOR - 0.4, FLOOR + 1.28, (0, -1), rng, loops=[1.2, 3.2, 2 * xb - 3.2, 2 * xb - 1.2])
    K.beam(K.B("hewn"), (-xb, yb + 0.06, FLOOR + 1.32), (xb, yb + 0.06, FLOOR + 1.32), 0.2, 0.1, 0.012, side=(0, 0, 1))
    for x in (-2.4, 0.0, 2.4):
        K.beam(K.B("hewn"), (x, YB + 0.12, FLOOR - 0.1), (x, YB + 0.12, FLOOR + 1.05), 0.12, 0.12, 0.012)
    K.beam(K.B("hewn"), (-xb, YB + 0.12, FLOOR + 1.02), (xb, YB + 0.12, FLOOR + 1.02), 0.12, 0.12, 0.012)
    K.beam(K.B("hewn"), (-xb, YB + 0.12, FLOOR + 0.5), (xb, YB + 0.12, FLOOR + 0.5), 0.09, 0.09, 0.01)
    # a ladder up to the platform from inside the gate
    K.ladder((-2.2, YB + 2.3, ROAD_Z), (-2.1, YB + 0.18, FLOOR), mat="hewn")


def leaf(x_hinge, x_meet, rng, state, M=None, mats=("oak", "hewn", "iron")):
    """ledged, braced and strapped gate leaf between x_hinge and x_meet at y ~ 0 (outer face -y).
    M: optional world transform (fallen / lying leaves), applied about the hinge foot."""
    pm, lm, im = mats
    z0, z1 = ROAD_Z + 0.04, 4.3
    sgn = 1 if x_meet > x_hinge else -1
    Ln = abs(x_meet - x_hinge)
    bats = []

    def B_(mat, p0, p1, w, d, bev, side=None):
        p0, p1 = Vector(p0), Vector(p1)
        if M is not None:
            p0, p1 = M @ p0, M @ p1
            side = (M.to_3x3() @ Vector(side)) if side is not None else None
        K.beam(K.B(mat), p0, p1, w, d, bev, side=side)
    u = 0.0
    while u < Ln - 0.02:
        w = min(rng.uniform(0.26, 0.32), Ln - u)
        if Ln - u - w < 0.15:
            w = Ln - u
        x = x_hinge + sgn * (u + w / 2)
        top = z1 + rng.uniform(-0.02, 0.02)
        B_(pm, (x, -0.1, z0), (x, -0.1, top), w - 0.01, 0.075, 0.008, side=(0, -1, 0))
        u += w
    for z in (0.55, 2.2, 3.85):
        B_(lm, (x_hinge + sgn * 0.05, 0.0, z), (x_meet - sgn * 0.05, 0.0, z), 0.26, 0.09, 0.012, side=(0, 1, 0))
        B_(im, (x_hinge - sgn * 0.02, -0.145, z + 0.05), (x_hinge + sgn * Ln * 0.72, -0.145, z + 0.05), 0.085, 0.014, 0.003,
           side=(0, -1, 0))
    for za, zb in ((0.7, 2.05), (2.35, 3.7)):
        B_(lm, (x_meet - sgn * 0.25, 0.0, za), (x_hinge + sgn * 0.3, 0.0, zb), 0.2, 0.08, 0.012, side=(0, 1, 0))
    # hinge pintles / ring handle
    for z in (0.6, 2.25, 3.9):
        B_(im, (x_hinge - sgn * 0.06, -0.08, z - 0.08), (x_hinge - sgn * 0.06, -0.08, z + 0.14), 0.06, 0.06, 0.01)


def leaves(rng, state):
    leaf(-XI + 0.2, -0.012, rng, state)
    leaf(XI - 0.2, 0.012, rng, state)


# ------------------------------------------------------------------ states
def build_complete(seed):
    rng = random.Random(seed); K.R.seed(seed)
    for sx in (-1, 1):
        tower(sx, rng, "complete")
    bridge(rng, "complete")
    leaves(rng, "complete")
    return None


def build_b2(seed):
    rng = random.Random(seed); K.R.seed(seed)
    for sx in (-1, 1):
        tower(sx, rng, "build2")
    bridge(rng, "build2")
    # a few deck planks laid, lower cladding begun on the front of each tower
    for k in range(4):
        y = YF - 0.1 + k * 0.29
        P.plank((-XI + 0.05, y, FLOOR - 0.022), (-0.4, y, FLOOR - 0.022), 0.27, 0.045, rng, mat="fresh")
    for sx in (-1, 1):
        x0 = sx * (XI - CL); x1 = sx * (XO + CL)
        clad((min(x0, x1), YF - CL), (max(x0, x1), YF - CL), 0.0, FLOOR - 0.3, (0, -1), rng, mat="fresh",
             stop=lambda u: u < 1.3 + 0.4 * rng.random())
    # scaffold poles lashed round the front, ladders
    for sx in (-1, 1):
        for x in (sx * (XI - 0.6), sx * ((XI + XO) / 2), sx * (XO + 0.2)):
            K.cyl(K.B("oak"), (x, YF - 1.45, 0.0), (x + rng.uniform(-0.05, 0.05), YF - 1.45 + rng.uniform(-0.05, 0.05), 7.6),
                  0.07, 0.055, n=6)
        for z in (2.1, 4.0, 5.9):
            K.cyl(K.B("oak"), (sx * (XI - 0.8), YF - 1.5, z), (sx * (XO + 0.4), YF - 1.5, z + rng.uniform(-0.05, 0.05)), 0.05, n=6)
            for x in (sx * (XI - 0.3), sx * (XO - 0.2)):
                K.beam(K.B("oak"), (x, YF - 1.6, z + 0.06), (x, YF - 0.1, z + 0.06), 0.08, 0.08, 0.0)
            for k in range(3):
                P.plank((sx * (XI - 0.7), YF - 1.35 + k * 0.3, z + 0.13), (sx * (XO + 0.3), YF - 1.35 + k * 0.3, z + 0.13),
                        0.28, 0.04, rng)
    K.ladder((1.2, YF - 2.6, 0.12), (1.25, YF - 0.3, FLOOR), mat="oak")
    K.ladder((XO + 0.9, YF - 3.2, 0.1), (XO + 0.4, YF - 1.6, 4.0), mat="oak")
    # the gate leaves being made on trestles inside
    for x in (-1.8, 1.8):
        for s in (-1, 1):
            K.beam(K.B("hewn"), (x - 1.2 * s + s * 0.0, 3.2, 0.1), (x - 1.2 * s, 3.2, 0.75), 0.1, 0.1, 0.01)
    M = Matrix.Translation((0, 3.2 + 0.9, 0.85)) @ Matrix.Rotation(math.radians(90), 4, "X") @ Matrix.Translation((0, 0, -ROAD_Z))
    leaf(-3.2, -0.02, rng, "build2", M=M, mats=("fresh", "fresh", "iron"))
    # squared timbers stacked on the inner side
    K.timber_stack(1.0, 3.6, 3.6, 3, True)
    for k in range(6):
        K.beam(K.B("fresh"), (-5.4 + k * 0.33, 2.4, 0.13 + (k % 2) * 0.0), (-5.4 + k * 0.33 + rng.uniform(-0.1, 0.1), 2.4 + 4.8, 0.13),
               0.24, 0.24, 0.015)
    return None


def build_b1(seed):
    rng = random.Random(seed); K.R.seed(seed)
    # the four hanging/lintel posts of the gate up, braced by raking shores; the rest marked out
    for sx in (-1, 1):
        post(sx * XI, 0.0, 0.0, FLOOR - 0.47 + 0.19, rng, s=0.38, mat="fresh")
        post(sx * XI, YF, 0.0, TOP, rng, mat="fresh")
        for y0, y1 in ((-2.9, -0.1), (2.5, 0.1)):
            K.cyl(K.B("oak"), (sx * (XI + 0.6), y0, 0.05), (sx * XI, y1, 3.0), 0.07, n=6)
        for x, y in ((sx * XO, YF), (sx * XO, YB), (sx * XI, YB)):
            K.cyl(K.B("fresh"), (x, y, 0.0), (x, y, 0.55), 0.035, n=5)            # setting-out pegs
            K.cyl(K.B("dirt"), (x, y, 0.0), (x, y, 0.06), 0.3, n=8)                # dug post hole rim
    # lines between the pegs
    for sx in (-1, 1):
        pts = [(sx * XI, YF), (sx * XO, YF), (sx * XO, YB), (sx * XI, YB)]
        for i in range(3):
            a, b = pts[i], pts[i + 1]
            K.cyl(K.B("rope"), (a[0], a[1], 0.45), (b[0], b[1], 0.45), 0.008, n=4)
    # timber stacks and the palisade stakes waiting
    K.timber_stack(-5.2, 2.2, 4.6, 3, True)
    K.timber_stack(1.5, 2.5, 4.2, 2, True)
    for row in range(3):
        for k in range(6 - row):
            M = (Matrix.Translation((-5.6, 3.6 + k * 0.3 + row * 0.15, 0.14 + row * 0.25)) @
                 Matrix.Rotation(math.radians(90), 4, "Y") @ Matrix.Rotation(rng.uniform(-0.4, 0.4), 4, "Z"))
            P.stake(0, 0, rng.uniform(4.9, 5.3), 0.29, rng.choice(("half", "round")), rng, bark=rng.random() < 0.6,
                    mats=dict(wood="fresh", bark="bark", tipm="fresh"), lying=M)
    # a hand-cart
    cx, cy = -1.8, 3.4
    for s in (-1, 1):
        K.cyl(K.B("hewn"), (cx + s * 0.62, cy, 0.42), (cx + s * 0.7, cy, 0.42), 0.4, n=12)
    K.beam(K.B("plank"), (cx - 0.55, cy - 0.7, 0.72), (cx + 0.55, cy - 0.7, 0.72), 0.06, 0.4, 0.01, side=(0, 1, 0))
    for s in (-1, 1):
        K.beam(K.B("hewn"), (cx + s * 0.5, cy - 0.8, 0.62), (cx + s * 0.5, cy + 1.9, 0.62 + 0.3), 0.08, 0.08, 0.01)
    for k in range(5):
        P.plank((cx - 0.5, cy - 0.75 + k * 0.3, 0.66), (cx + 0.5, cy - 0.75 + k * 0.3, 0.66), 0.28, 0.04, rng)
    return None


def build_ruin(seed):
    rng = random.Random(seed); K.R.seed(seed)
    ch = "char"
    # west tower: burnt down to stumps, its roof fallen in a heap; east tower: blackened frame standing
    for x, y in ((-XI, YF), (-XO, YF), (-XO, YB), (-XI, YB)):
        post(x, y, 0.0, rng.uniform(0.8, 2.6), rng, mat=ch)
    for x, y in ((XI, YF), (XO, YF), (XO, YB), (XI, YB)):
        post(x, y, 0.0, rng.uniform(3.9, 6.2), rng, mat=ch)
    for z in (1.9,):
        for (a, b) in (((XI, YF), (XO, YF)), ((XO, YF), (XO, YB))):
            K.beam(K.B(ch), (a[0], a[1], z), (b[0], b[1], z - 0.1), 0.2, 0.22, 0.015)
    K.beam(K.B(ch), (XI, YF, P.DECK - 0.2), (XO - 0.6, YF, P.DECK - 1.2), 0.2, 0.22, 0.015)
    # east tower cladding: charred stumps of boards, ragged
    clad((XI - CL, YF - CL), (XO + CL, YF - CL), 0.0, 3.4, (0, -1), rng, mat=ch, ragged=0.6)
    clad((XO + CL, YF - CL), (XO + CL, YB + CL), 0.0, 3.0, (1, 0), rng, mat=ch, ragged=0.8)
    clad((XI - CL, YB + CL), (XI - CL, YF - CL), 0.0, 2.6, (-1, 0), rng, mat=ch, ragged=0.9)
    clad((-XO - CL, YF - CL), (-XI + CL, YF - CL), 0.0, 1.2, (0, -1), rng, mat=ch, ragged=1.2)
    # hanging posts stand; the west leaf lies flat in the road, the east leaf hangs askew
    for sx in (-1, 1):
        post(sx * XI, 0.0, 0.0, 3.4 if sx < 0 else 4.3, rng, s=0.38, mat=ch)
    M = Matrix.Translation((-XI + 0.2, -0.4, ROAD_Z + 0.22)) @ Matrix.Rotation(math.radians(-88), 4, "X") @ \
        Matrix.Rotation(math.radians(8), 4, "Z") @ Matrix.Translation((XI - 0.2, 0, -ROAD_Z))
    leaf(-XI + 0.2, -0.3, rng, "ruin", M=M, mats=(ch, ch, "iron"))
    M2 = Matrix.Translation((XI - 0.2, 0, 0)) @ Matrix.Rotation(math.radians(-38), 4, "Z") @ Matrix.Rotation(math.radians(6), 4, "Y") @ \
        Matrix.Translation((-(XI - 0.2), 0, 0))
    leaf(XI - 0.2, 0.9, rng, "ruin", M=M2, mats=(ch, ch, "iron"))
    # the fallen lintel and bridge joists across the passage, roof shingles and timbers in a heap
    K.beam(K.B(ch), (-XI - 0.3, YF + 0.3, 0.3), (1.2, YF - 0.9, 0.2), 0.3, 0.36, 0.02)
    for k in range(7):
        a = rng.uniform(-0.9, 0.9) + (0.2 if k % 2 else -0.3)
        x = rng.uniform(-5.5, -1.0); y = rng.uniform(-2.2, 2.6)
        ln = rng.uniform(1.8, 3.2)
        d = Vector((math.cos(a), math.sin(a), 0)) * ln / 2
        z = 0.2 + rng.uniform(0, 0.5)
        K.beam(K.B(ch), (x - d.x, y - d.y, z + rng.uniform(-0.2, 0.2)), (x + d.x, y + d.y, z), 0.16, 0.2, 0.015)
    for k in range(18):
        x = rng.uniform(-6.0, -2.6); y = rng.uniform(-1.8, 2.2)
        P.plank((x, y, 0.25 + rng.uniform(0, 0.4)), (x + rng.uniform(-1.4, 1.4), y + rng.uniform(-0.8, 0.8), 0.2 + rng.uniform(0, 0.3)),
                0.26, 0.045, rng, mat=ch)
    for k in range(60):
        x = rng.uniform(-6.0, 5.8); y = rng.uniform(-2.0, 2.4)
        s = rng.uniform(0.05, 0.18)
        z = gate_h(x, y, seed, "ruin")
        K.box(K.B(ch), (x - s, y - s * 0.6, z - 0.02), (x + s, y + s * 0.6, z + s * 0.5), 0.01,
              rot=(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(0, 3)))
    # east tower roof collapsed to one side
    return None


BUILDERS = {"complete": build_complete, "build1": build_b1, "build2": build_b2, "ruin": build_ruin}


def materials(state):
    P.build_materials(state)
    K.MAT["shingle"] = K.m_tiles("gate_shingle", [(0.0, "#5f5445"), (0.35, "#72675a"), (0.7, "#81776a"), (1.0, "#8f8474")],
                                 cell=0.17, curve=0.15, wood=True, lichen=0.6, moss=0.7)
    K.MAT["dirt"] = K.m_simple("gate_dirt", "#4a3a2a", "#5f4a35", 0.95, 1.2)
    K.MAT["rope"] = K.m_simple("gate_rope", "#8a7a58", "#a08e68", 0.9, 30.0)
    if state == "ruin":
        K.MAT["char"] = P.m_char("gate_char")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    state = argv[0] if argv else "complete"
    name = "gate" if state == "complete" else "gate_" + state
    seed = 3031
    BUILDERS[state](seed)
    materials(state)
    emb = P.earth(seed, state, half=HALF, hf=lambda x, y: gate_h(x, y, seed, state), step=0.24)
    P.finish_earth(emb, PORTS12, seed, state, road=3.0)
    K.finalize(name, tex=TEX, lods=(1.0, 0.4, 0.12))
    P.update_kit(name, PORTS12)
