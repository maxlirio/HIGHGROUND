"""HIGHGROUND - counterweight trebuchet (13th c. "trebuchet a contrepoids").

Reference: Villard de Honnecourt's base-frame drawing (c.1230); the Warwick Castle and Middelaldercentret
reconstructions: two long soles with cross sills, an A-frame trestle each side (raking legs + king post, long
raking braces), the axle in capped bearings, a built-up arm bound with iron and woolded rope, a hinged box
counterweight filled with stones, a sling lying in a planked trough, a windlass and trigger on the rear sill,
a pile of dressed shot. Dimensions follow docs/siege-art-contract.md (7 x 10 m base, axle 6.5 m, arm 12 m 4:1,
box 2 x 2 x 2 m, cocked ~35 deg).

Authored COCKED: long arm down to the rear (+Y), sling laid in the trough, counterweight up.
Moving parts (assets/glb/trebuchet_parts.json):
  arm            pivot = axle centre, rotates about +X: 0 = cocked, ~+145 = release (long end up & over to -Y)
  counterweight  child of arm, pivot = hanger pin; keep plumb with local X rotation = -(arm angle)
  sling          child of arm, pivot = the release prong at the tip

  blender -b -P assets/src/trebuchet.py -- [complete|assembling_1|assembling_2|packed|burnt]
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _siege_kit as S
import _kit_yards as K
from _kit_yards import beam, box, cyl, tube

STATE = S.state_from_argv()
S.init(STATE, seed=41)
R = K.R
jit = S.jit
FULL = STATE == "complete"
A1, A2, PACKED, BURNT = (STATE == s for s in ("assembling_1", "assembling_2", "packed", "burnt"))

# ------------------------------------------------------------------ key dimensions (contract)
AX = Vector((0.0, 0.0, 6.5))            # axle centre
L_LONG, L_SHORT = 9.6, 2.4              # 12 m arm, 4 : 1
PHI = math.radians(35.0)                # cocked, long end down
U = Vector((0.0, math.cos(PHI), -math.sin(PHI)))      # along the arm toward the long end
W = Vector((1, 0, 0)).cross(U).normalized()             # arm "up" (top-face normal)
TIP = AX + U * L_LONG
PIN = AX - U * L_SHORT
SX = 1.5                                 # trestle centre-line half spacing
Y0, Y1 = -4.95, 4.95                     # base length 10 m

if FULL:
    S.part("arm", AX, axis="X", rest="cocked: long end down to the rear (+Y), 35 deg below level", range_deg=[0, 150],
           notes="positive = long end rises and throws forward (-Y); release ~ +140..+150; the axle turns with it")
    S.part("counterweight", PIN, parent="arm", axis="X", rest="hanging plumb",
           notes="child of arm; keep plumb: local rotation.x = -(arm angle) (a few deg of overswing looks right)")
    S.part("sling", TIP, parent="arm", axis="X", rest="laid forward along the trough, shot in the pouch",
           notes="child of arm; hide it during the throw (contract) or whip it ~+180 relative to the arm")

oak, plank, iron, tar, rope = K.B("oak"), K.B("plank"), K.B("iron"), K.B("tar"), K.B("rope")
oak2 = K.B("oak2")


# ================================================================== base frame
def base_frame(tail=True):
    for sx in (-1, 1):
        x = sx * SX
        beam(oak, (x, Y0, 0.24), (x, Y1, 0.24), 0.42, 0.44, 0.02)
        for y in (Y0 + 0.7, 0.0, Y1 - 0.7):
            box(plank, (x - 0.32, y - 0.25, -0.05), (x + 0.32, y + 0.25, 0.03), 0.0, rot=(0, 0, jit(0.08)))
    for y in (Y0 + 0.35, -3.1, 3.1, Y1 - 0.35):
        beam(oak, (-SX - 0.8, y, 0.22), (SX + 0.8, y + jit(0.03), 0.22), 0.38, 0.4, 0.02, side=(0, 0, 1))
        for sx in (-1, 1):
            cyl(oak2, (sx * (SX + 0.58), y, 0.3), (sx * (SX + 0.58), y, 0.5), 0.035, n=5)
    # iron dogs clenching every sole/sill crossing
    for y in (Y0 + 0.35, -3.1, 3.1, Y1 - 0.35):
        for sx in (-1, 1):
            for d in (-0.26, 0.26):
                box(iron, (sx * SX + d - 0.03, y - 0.28, 0.44), (sx * SX + d + 0.03, y + 0.28, 0.465), 0.0, rot=(0, 0, jit(0.1)))
    for sx in (-1, 1):
        for (ya, yb) in ((Y0 + 0.35, -3.1), (3.1, Y1 - 0.35)):
            beam(oak2, (sx * (SX + 0.72), ya, 0.2), (sx * (SX + 0.25), (ya + yb) / 2 + 0.3 * (1 if ya < 0 else -1), 0.2),
                 0.2, 0.24, 0.0)


def trestle(sx, legs=True, king=True, braces=True, bearing=True, king_h=None):
    x = sx * SX
    top = AX.z - 0.36
    if king:
        beam(oak, (x, 0.0, 0.44), (x, king_h or top, ), 0.44, 0.44, 0.02) if False else \
            beam(oak, (x, 0.0, 0.44), (x, 0.0, king_h or top), 0.44, 0.44, 0.02)
    if legs:
        for sy in (-1, 1):
            beam(oak, (x, sy * 3.1, 0.44), (x, sy * 0.28, top - 0.2), 0.38, 0.36, 0.02, side=(1, 0, 0))
            # oak wedges driven under the leg foot + a trenail through the tenon
            box(K.B("fresh"), (x - 0.2, sy * 3.3 - 0.1, 0.44), (x + 0.2, sy * 3.3 + 0.1, 0.56), 0.0, rot=(sy * 0.4, 0, 0))
            cyl(oak2, (x - 0.24, sy * 2.95, 0.75), (x + 0.24, sy * 2.95, 0.75), 0.03, n=5)
    if braces:
        for sy in (-1, 1):
            yb = Y0 + 0.55 if sy < 0 else Y1 - 0.55
            beam(oak2, (x, yb, 0.44), (x, sy * 1.2, 4.15), 0.3, 0.28, 0.0, side=(1, 0, 0))
        beam(oak, (x, -2.3, 2.05), (x, 2.3, 2.05), 0.3, 0.3, 0.0, side=(1, 0, 0))
        beam(oak, (x, -1.15, 4.4), (x, 1.15, 4.4), 0.28, 0.3, 0.0, side=(1, 0, 0))
        for (y, z, a) in ((0, 2.05, 0), (0, 4.4, 0), (-1.2, 4.15, -0.7), (1.2, 4.15, 0.7), (-2.3, 2.05, -0.9), (2.3, 2.05, 0.9)):
            box(iron, (x - 0.25, y - 0.2, z - 0.035), (x + 0.25, y + 0.2, z + 0.035), 0.0, rot=(a, 0, 0))
    if bearing:
        z0 = top
        box(oak, (x - 0.3, -0.45, z0), (x + 0.3, 0.45, z0 + 0.3), 0.02)
        box(oak2, (x - 0.3, -0.38, AX.z + 0.18), (x + 0.3, 0.38, AX.z + 0.42), 0.02)
        for sy in (-1, 1):
            beam(iron, (x, sy * 0.4, z0 - 0.4), (x, sy * 0.4, AX.z + 0.45), 0.34, 0.03, 0.0, side=(0, 1, 0))
        box(iron, (x - 0.34, -0.42, AX.z + 0.42), (x + 0.34, 0.42, AX.z + 0.45), 0.0)


def team_pennant(x, y, z0):
    """small team pennant on a staff lashed to the king post."""
    cyl(oak2, (x, y, z0), (x, y, z0 + 2.4), 0.03, n=5)
    grid = []
    for i in range(3):
        row = []
        for j in range(6):
            t = j / 5
            hgt = 0.5 * (1 - 0.7 * t)
            zz = z0 + 2.35 - 0.5 * 0.5 + (i / 2 - 0.5) * hgt
            row.append(Vector((x + 0.04 * math.sin(t * 5), y + 0.05 + t * 1.1, zz - t * 0.12)))
        grid.append(row)
    S.sheet(K.B("team"), grid, 0.01)


# ================================================================== arm
def arm_geo(bo, bi, br, bt, M=None):
    def T(p):
        return (M @ Vector(p)) if M else Vector(p)

    def seg(t0, t1, h0, h1, w0, w1, dx=0.0):
        pts = []
        for t, h, w in ((t0, h0, w0), (t1, h1, w1)):
            c = AX + U * t + Vector((dx, 0, 0))
            for a in (-w / 2, w / 2):
                for b in (-h / 2, h / 2):
                    pts.append(T(c + Vector((a, 0, 0)) + W * b))
        Pp, F = K.hull(pts)
        Mi = M.inverted() if M else None
        loc = []
        for p in Pp:
            v = ((Mi @ Vector(p)) if Mi else Vector(p)) - AX
            loc.append((v.x, v.dot(W), v.dot(U)))
        bo.add(Pp, F, None, None, loc)

    seg(-L_SHORT - 0.2, 0.0, 0.7, 0.74, 0.54, 0.56)
    seg(0.0, L_LONG * 0.5, 0.74, 0.52, 0.56, 0.4)
    seg(L_LONG * 0.5, L_LONG + 0.1, 0.52, 0.26, 0.4, 0.22)
    for sx in (-1, 1):                                  # fishes (cheek timbers) over the axle
        seg(-L_SHORT + 0.35, 2.8, 0.54, 0.42, 0.1, 0.09, dx=sx * 0.33)
    for t in (-1.9, 1.7, 3.3, 4.5, 5.7, 6.9, 8.1, 9.2):
        h = 0.74 - max(0, t) * (0.48 / L_LONG) + 0.03
        w = (0.8 if t < 2.8 else 0.56 - max(0, t) * (0.34 / L_LONG)) + 0.03
        c = AX + U * t
        pts = [T(c + Vector((a, 0, 0)) + W * b + U * e) for a in (-w / 2, w / 2) for b in (-h / 2, h / 2) for e in (-0.035, 0.035)]
        Pp, F = K.hull(pts); bi.add(Pp, F, None, None)
    for t in (-1.1, -0.8, 0.8, 1.1, 2.3):                # rope woolding
        c = AX + U * t
        ring = [T(c + Vector((math.cos(2 * math.pi * k / 8) * 0.46, 0, 0)) + W * (math.sin(2 * math.pi * k / 8) * 0.42))
                for k in range(8)]
        tube(br, ring + [ring[0]], 0.045, 4, caps=False)
    cyl(bo, T(AX + Vector((-SX - 0.44, 0, 0))), T(AX + Vector((SX + 0.44, 0, 0))), 0.2, n=10)
    for sx in (-1, 1):
        cyl(bi, T(AX + Vector((sx * (SX + 0.36), 0, 0))), T(AX + Vector((sx * (SX + 0.42), 0, 0))), 0.225, n=10)
        cyl(bt, T(AX + Vector((sx * (SX + 0.44), 0, 0))), T(AX + Vector((sx * (SX + 0.52), 0, 0))), 0.07, n=6)
        c = AX - U * (L_SHORT - 0.05)
        pts = [T(c + Vector((sx * 0.39 + a, 0, 0)) + W * b + U * e) for a in (-0.015, 0.015) for b in (-0.18, 0.18) for e in (-0.28, 0.2)]
        Pp, F = K.hull(pts); bi.add(Pp, F, None, None)
    cyl(bi, T(PIN + Vector((-0.66, 0, 0))), T(PIN + Vector((0.66, 0, 0))), 0.07, n=8)
    c = TIP
    pts = [T(c + Vector((a, 0, 0)) + W * b + U * e) for a in (-0.14, 0.14) for b in (-0.15, 0.15) for e in (-0.45, 0.12)]
    Pp, F = K.hull(pts); bi.add(Pp, F, None, None)
    p0 = c + U * 0.1
    tube(bi, [T(p0), T(p0 + U * 0.26 + W * 0.05), T(p0 + U * 0.4 + W * 0.2)], [0.04, 0.03, 0.018], 5)


# ================================================================== counterweight
CW_W, CW_D, CW_H = 2.0, 2.0, 2.0
CW_DROP = 0.62


def counterweight_geo(bo, bp, bi, bs, M=None, fill=1.0, burst=False, planks=1.0):
    def T(p):
        return (M @ Vector(p)) if M else Vector(p)

    c = PIN
    top = c.z - CW_DROP
    bot = top - CW_H
    hx, hy = CW_W / 2, CW_D / 2

    def bx(bt, lo, hi, bev=0.0, rr=0.0):
        pts = [T(Vector((a, b, cc))) for a in (lo[0], hi[0]) for b in (lo[1], hi[1]) for cc in (lo[2], hi[2])]
        if rr:
            cen = sum((Vector(p) for p in pts), Vector()) / 8
            Rm = Matrix.Rotation(rr, 3, Vector((R.random(), R.random(), R.random())).normalized())
            pts = [cen + Rm @ (Vector(p) - cen) for p in pts]
        Pp, F = K.hull(pts)
        o = Vector(lo)
        bt.add(Pp, F, None, None, [tuple(Vector(p) - T(o)) for p in Pp])

    for sx in (-1, 1):
        for sy in (-1, 1):
            bx(bo, (c.x + sx * hx - 0.11, c.y + sy * hy - 0.11, bot - 0.1), (c.x + sx * hx + 0.11, c.y + sy * hy + 0.11, top + 0.12))
    nb = 6
    for i in range(nb):
        z0 = bot + CW_H * i / nb + 0.01
        z1 = bot + CW_H * (i + 1) / nb - 0.01
        for sy in (-1, 1):
            if (burst and sy < 0 and i > 1) or R.random() > planks:
                continue
            bx(bp, (c.x - hx + 0.1, c.y + sy * (hy + 0.03) - 0.035, z0), (c.x + hx - 0.1, c.y + sy * (hy + 0.03) + 0.035, z1),
               rr=(0.25 if burst and i > 3 else jit(0.004)))
        for sx in (-1, 1):
            if (burst and sx > 0 and i > 2) or R.random() > planks:
                continue
            bx(bp, (c.x + sx * (hx + 0.03) - 0.035, c.y - hy + 0.1, z0), (c.x + sx * (hx + 0.03) + 0.035, c.y + hy - 0.1, z1),
               rr=jit(0.004))
    bx(bo, (c.x - hx - 0.08, c.y - hy - 0.08, bot - 0.18), (c.x + hx + 0.08, c.y + hy + 0.08, bot - 0.02))
    if planks >= 1.0:
        for z in (bot + 0.22, top - 0.2):
            for sy in (-1, 1):
                bx(bi, (c.x - hx - 0.12, c.y + sy * (hy + 0.07) - 0.012, z - 0.045), (c.x + hx + 0.12, c.y + sy * (hy + 0.07) + 0.012, z + 0.045))
            for sx in (-1, 1):
                bx(bi, (c.x + sx * (hx + 0.07) - 0.012, c.y - hy - 0.12, z - 0.045), (c.x + sx * (hx + 0.07) + 0.012, c.y + hy + 0.12, z + 0.045))
    if not burst:
        # hanger: a pair of iron-strapped oak stirrups from the pin to a cross-beam over the box
        for sx in (-1, 1):
            x = c.x + sx * 0.52
            bx(bo, (x - 0.07, c.y - 0.13, top + 0.1), (x + 0.07, c.y + 0.13, c.z + 0.16))
            for sy in (-1, 1):
                bx(bi, (x - 0.075, c.y + sy * 0.14 - 0.012, top - 0.05), (x + 0.075, c.y + sy * 0.14 + 0.012, c.z + 0.18))
        bx(bo, (c.x - hx - 0.1, c.y - 0.16, top - 0.06), (c.x + hx + 0.1, c.y + 0.16, top + 0.18))
        for sy in (-1, 1):                             # chains/straps from the cross-beam ends down the box sides
            for sx in (-1, 1):
                bx(bi, (c.x + sx * (hx + 0.06) - 0.012, c.y + sy * 0.1 - 0.03, top - 0.5), (c.x + sx * (hx + 0.06) + 0.012, c.y + sy * 0.1 + 0.03, top + 0.1))
    n = int(16 * fill)
    for i in range(n):
        p = Vector((c.x + R.uniform(-hx + 0.3, hx - 0.3), c.y + R.uniform(-hy + 0.3, hy - 0.3),
                    bot + CW_H * min(1.0, fill) - 0.12 + R.uniform(-0.04, 0.12)))
        S.stone_ball(bs, T(p), R.uniform(0.17, 0.26), 0.3)


# ================================================================== sling
POUCH = Vector((0.0, 3.1, 0.62))


def sling_geo(br, bh, bs):
    fixed = TIP - U * 0.2 - W * 0.2
    loop = TIP + U * 0.32 + W * 0.13
    for (a, sx) in ((fixed, -1), (loop, 1)):
        end = POUCH + Vector((sx * 0.3, 0.1, 0.05))
        mid = a.lerp(end, 0.55) + Vector((sx * 0.12, 0, -0.18))
        S.rope(br, [a, a.lerp(mid, 0.5) + Vector((0, 0, -0.05)), mid, end], 0.022, 4)
    tube(br, [loop + Vector((-0.07, 0, 0)), loop + Vector((0, 0.04, 0.09)), loop + Vector((0.07, 0, 0))], 0.024, 4)
    grid = []
    for i in range(4):
        row = []
        for j in range(6):
            a = math.pi * (j / 5)
            yy = POUCH.y - 0.32 + 0.64 * i / 3
            row.append(Vector((POUCH.x + math.cos(a) * 0.32, yy, POUCH.z + 0.02 - math.sin(a) * 0.18 - 0.04 * math.sin(math.pi * i / 3))))
        grid.append(row)
    S.sheet(bh, grid, 0.02)
    S.stone_ball(bs, POUCH + Vector((0, 0.0, 0.1)), 0.21, 0.07)


# ================================================================== trough, trigger, windlass
def trough():
    ya, yb = -1.6, Y1 - 0.2
    n = 11
    for i in range(n):
        y0 = ya + (yb - ya) * i / n + 0.005
        y1 = ya + (yb - ya) * (i + 1) / n - 0.005
        box(plank, (-0.6 + jit(0.02), y0, 0.38), (0.6 + jit(0.02), y1, 0.44), 0.0, rot=(0, jit(0.01), jit(0.012)))
    for sx in (-1, 1):
        beam(oak2, (sx * 0.7, ya, 0.54), (sx * 0.7, yb, 0.54), 0.1, 0.26, 0.0)
    for y in (-0.9, 1.6, 3.9):
        beam(oak, (-SX + 0.2, y, 0.22), (SX - 0.2, y, 0.22), 0.26, 0.32, 0.0)


def windlass_trigger():
    y = Y1 - 0.35
    zc = 1.0
    for sx in (-1, 1):
        x = sx * 1.12
        beam(oak, (x, y, 0.4), (x, y, 1.5), 0.24, 0.26, 0.015)
        beam(oak2, (x, y - 0.95, 0.42), (x, y - 0.1, 1.2), 0.15, 0.15, 0.0, side=(1, 0, 0))
    beam(oak, (-1.3, y, 1.55), (1.3, y, 1.55), 0.24, 0.22, 0.015, side=(0, 0, 1))
    S.lathe_x(oak2, (0, y, zc), [(0.0, -1.0), (0.1, -1.0), (0.1, -0.8), (0.28, -0.76), (0.28, -0.66), (0.22, -0.6),
                                 (0.22, 0.6), (0.28, 0.66), (0.28, 0.76), (0.1, 0.8), (0.1, 1.0), (0.0, 1.0)], 10)
    S.lathe_x(rope, (0, y, zc), [(0.0, -0.58), (0.25, -0.58), (0.27, -0.3), (0.26, 0.2), (0.25, 0.58), (0.0, 0.58)], 12)
    for sx in (-1, 1):
        for k in range(2):
            a = k * math.pi / 2 + (0.3 if sx > 0 else 1.0)
            d = Vector((0, math.cos(a), math.sin(a)))
            beam(plank, Vector((sx * 0.72, y, zc)) - d * 0.95, Vector((sx * 0.72, y, zc)) + d * 0.95, 0.07, 0.07, 0.0,
                 side=Vector((1, 0, 0)))
    # hauling rope from the drum over the rear sill to a block at the tip; the tip is held by the trigger
    blk = TIP + Vector((0, -0.25, -0.28))
    S.rope(rope, [Vector((0.0, y - 0.2, zc + 0.2)), blk], 0.024, sag=0.05, n=5)
    box(oak2, blk - Vector((0.1, 0.12, 0.14)), blk + Vector((0.1, 0.12, 0.14)), 0.0)
    # trigger: iron hook on a lever pinned to a short post on the rear sill, catching a ring under the tip
    yt = Y1 - 0.35
    for sx in (-1, 1):
        beam(oak, (sx * 0.24, yt - 0.9, 0.44), (sx * 0.24, yt - 0.9, 1.25), 0.16, 0.18, 0.0)
    tube(iron, [Vector((0, yt - 0.9, 1.15)), Vector((0, yt - 0.3, 1.2)), Vector((0, TIP.y - 0.35, TIP.z - 0.05)),
                Vector((0, TIP.y - 0.2, TIP.z - 0.2))], [0.035, 0.03, 0.028, 0.02], 5)
    beam(oak2, (0.0, yt - 1.0, 1.2), (0.0, yt - 2.3, 1.9), 0.08, 0.08, 0.0)


# ================================================================== yard props
def shot_pile(cx, cy):
    st = K.B("stone")
    r = 0.2
    for L, k in ((0, 3), (1, 2), (2, 1)):
        for i in range(k):
            for j in range(k):
                x = cx + (i - (k - 1) / 2) * 2 * r * 1.03 + jit(0.03)
                y = cy + (j - (k - 1) / 2) * 2 * r * 1.03 + jit(0.03)
                S.stone_ball(st, (x, y, r * 0.95 + L * r * 1.4), r * R.uniform(0.9, 1.06), 0.08)
    for (dx, dy) in ((0.95, 0.4), (-0.7, 0.9), (0.4, -0.95)):
        S.stone_ball(st, (cx + dx, cy + dy, 0.19), 0.2, 0.08)


def props():
    K.barrel((-2.9, 3.9, 0.0), r=0.34, h=0.86)
    beam(oak2, (2.6, -4.3, 0.06), (3.3, -4.1, 0.06), 0.06, 0.06, 0.0)
    box(oak2, (3.22, -4.25, 0.0), (3.46, -3.95, 0.16), 0.0)
    for i in range(3):
        box(K.B("fresh"), (-2.9 + i * 0.22, -4.6, 0.0), (-2.75 + i * 0.22, -4.25, 0.12 - i * 0.02), 0.0, rot=(0, 0, jit(0.4)))
    S.coil(rope, (-2.7, 2.6, 0.0), 0.38, 0.024, 4)


# ================================================================== states
if FULL:
    base_frame()
    for sx in (-1, 1):
        trestle(sx)
    trough(); windlass_trigger()
    arm_geo(S.P("arm", "oak"), S.P("arm", "iron"), S.P("arm", "rope"), S.P("arm", "tar"))
    counterweight_geo(S.P("counterweight", "oak"), S.P("counterweight", "oak2"), S.P("counterweight", "iron"),
                      S.P("counterweight", "stone"))
    sling_geo(S.P("sling", "rope"), S.P("sling", "hide"), S.P("sling", "stone"))
    team_pennant(-SX - 0.24, 0.0, 4.7)
    shot_pile(2.75, 2.2)
    props()

elif A1:
    # base frame laid and pinned, one trestle's king post up in shear legs, the rest lying about
    base_frame()
    trestle(-1, legs=False, braces=False, bearing=False)
    for sy in (-1, 1):
        beam(oak, (-2.9, sy * 1.4 - 0.3, 0.2), (-2.9 + 0.3, sy * 1.4 + 3.2, 0.2), 0.38, 0.36, 0.02)
    beam(oak, (1.5, -4.2, 0.66), (1.5 + jit(0.1), 1.9, 0.66), 0.44, 0.44, 0.02)      # the other king post on the sills
    # shear legs raising a leg
    for sx in (-1, 1):
        beam(oak2, (sx * 0.9 - 1.5, -2.2, 0.0), (-1.5 + sx * 0.08, -0.6, 6.4), 0.16, 0.16, 0.0)
    S.rope(rope, [Vector((-1.5, -0.6, 6.3)), Vector((-1.5, -0.1, 5.4))], 0.025)
    S.rope(rope, [Vector((-1.5, -0.6, 6.3)), Vector((-1.5, -4.6, 0.3))], 0.02, sag=0.1)
    # the arm lying on trestle horses along the frame, bands not yet on
    Mlie = Matrix.Translation(Vector((2.5, -0.2, 0.95)) - AX) @ Matrix.Translation(AX) @ \
        Matrix.Rotation(PHI, 4, "X") @ Matrix.Translation(-AX)
    arm_geo(oak, iron, rope, tar, M=Mlie)
    for y in (-2.0, 3.2):
        for sx in (-1, 1):
            beam(oak2, (2.5 + sx * 0.4, y, 0.0), (2.5 + sx * 0.1, y, 0.62), 0.1, 0.1, 0.0)
        beam(oak2, (2.1, y, 0.62), (2.9, y, 0.62), 0.14, 0.14, 0.0)
    counterweight_geo(oak, oak2, iron, K.B("stone"), M=Matrix.Translation(Vector((0.0, 1.5, 0.2)) - Vector((PIN.x, PIN.y, PIN.z - CW_DROP - CW_H))),
                      fill=0.0, planks=0.35)
    K.timber_stack(-3.3, -4.8, length=3.0, rows=2)
    S.coil(rope, (2.8, -4.3, 0.0), 0.36, 0.024, 4)

elif A2:
    base_frame()
    for sx in (-1, 1):
        trestle(sx)
    trough()
    # arm hoisted into its bearings, still lashed level; the box on the ground being filled
    Mlvl = Matrix.Translation(AX) @ Matrix.Rotation(PHI - math.radians(4), 4, "X") @ Matrix.Translation(-AX)
    arm_geo(oak, iron, rope, tar, M=Mlvl)
    S.rope(rope, [AX + Vector((0.0, -L_SHORT + 0.3, 0.2)), Vector((0.0, -L_SHORT + 0.3, 0.5))], 0.025)
    counterweight_geo(oak, oak2, iron, K.B("stone"),
                      M=Matrix.Translation(Vector((0.0, -1.95, 0.18)) - Vector((PIN.x, PIN.y, PIN.z - CW_DROP - CW_H))),
                      fill=0.45, planks=0.85)
    # ladder up the trestle, a hand-barrow of stones, the windlass drum waiting on blocks
    K.ladder((SX + 0.5, 1.9, 0.0), (SX + 0.28, 0.5, 6.0), bt=oak2)
    shot_pile(2.75, 2.2)
    K.barrow(-2.6, -2.2, rot=0.4)
    S.lathe_x(oak2, (-2.8, 3.8, 0.3), [(0.0, -0.8), (0.28, -0.8), (0.28, -0.6), (0.22, -0.5), (0.22, 0.5), (0.28, 0.6),
                                       (0.28, 0.8), (0.0, 0.8)], 10)

elif PACKED:
    # carted as timber: two wains in tandem carrying the arm, soles and king posts on their bolsters,
    # counterweight boards, axle, ropes and iron in the beds
    zA = S.wagon(0.0, -2.9, length=3.8, width=1.6)
    zB = S.wagon(0.0, 2.9, length=3.8, width=1.6)
    for sx, h in ((-0.5, 0.0), (0.0, 0.0), (0.5, 0.0), (-0.25, 0.44), (0.25, 0.44)):
        beam(oak, (sx, -4.9, zA + 0.24 + h), (sx + jit(0.03), 5.1, zA + 0.24 + h), 0.42, 0.42, 0.02)
    Mcart = Matrix.Translation(Vector((0.0, -0.4, zA + 0.66 + 0.44 + 0.37)) - AX) @ Matrix.Translation(AX) @ \
        Matrix.Rotation(PHI, 4, "X") @ Matrix.Translation(-AX)
    arm_geo(oak, iron, rope, tar, M=Mcart)
    for sx in (-1, 1):
        S.rope(rope, [Vector((sx * 0.85, -3.0, zA + 0.1)), Vector((0, -3.0, zA + 1.6)), Vector((-sx * 0.85, -3.0, zA + 0.1))], 0.02, 4)
        S.rope(rope, [Vector((sx * 0.85, 3.0, zA + 0.1)), Vector((0, 3.0, zA + 1.6)), Vector((-sx * 0.85, 3.0, zA + 0.1))], 0.02, 4)
    S.coil(rope, (0.55, -4.2, zA - 0.02), 0.3, 0.022, 3)
    K.barrel((-0.5, 4.3, zB - 0.02), r=0.26, h=0.6)
    team_pennant(0.8, -4.7, zA - 0.15)

elif BURNT:
    base_frame()
    trestle(-1, braces=True, bearing=False, king_h=4.2)
    for sy in (-1, 1):                        # right trestle collapsed outward
        beam(K.B("char"), (SX, sy * 3.1, 0.44), (SX + 3.1, sy * 1.2, 0.3), 0.36, 0.34, 0.02)
    beam(K.B("char"), (SX, 0.3, 0.44), (SX + 1.9, 0.9, 3.3), 0.42, 0.42, 0.02)
    beam(K.B("char"), (SX + 0.4, -2.3, 0.6), (SX + 2.4, 1.6, 0.35), 0.28, 0.28, 0.0)
    trough()
    # the arm dropped: short end on the ground at the front, long end charred through and snapped
    Mfall = Matrix.Translation((2.3, -0.6, -AX.z + 0.62)) @ Matrix.Rotation(0.14, 4, "Z") @ \
        Matrix.Translation(AX) @ Matrix.Rotation(PHI - math.radians(3), 4, "X") @ Matrix.Translation(-AX)
    arm_geo(K.B("char"), iron, rope, tar, M=Mfall)
    counterweight_geo(K.B("char"), K.B("char"), iron, K.B("stone"),
                      M=Matrix.Translation(Vector((-0.2, -3.2, 0.1)) - Vector((PIN.x, PIN.y, PIN.z - CW_DROP - CW_H))) @
                      Matrix.Translation(PIN) @ Matrix.Rotation(0.18, 4, "Y") @ Matrix.Translation(-PIN),
                      fill=0.2, burst=True, planks=0.7)
    for i in range(12):                        # the fill spilled out of the burst side
        S.stone_ball(K.B("stone"), (R.uniform(-1.4, 1.2), R.uniform(-5.0, -4.2), 0.18), R.uniform(0.16, 0.25), 0.3)
    for (cx, cy, rx, ry) in ((0.4, -0.5, 2.2, 3.4), (2.4, 0.0, 1.6, 2.2)):
        K.mound(K.B("ash"), cx, cy, rx, ry, 0.12, rings=4, seg=14, rough=0.3)
    shot_pile(-2.75, 2.2)

if __name__ == "__main__":
    name = "trebuchet" if FULL else "trebuchet_" + STATE
    path, tris = S.finish_parts(name, tex=1024)
    if FULL:
        S.write_parts_json("trebuchet", ["complete", "assembling_1", "assembling_2", "packed", "burnt"], tris,
                           extra=dict(pose_cocked_deg=0, pose_release_deg=145,
                                      counterweight_rule="counterweight.rotation.x = -arm.rotation.x (plumb)"))
