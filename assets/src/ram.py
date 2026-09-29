"""HIGHGROUND - covered battering ram (the "cat" / "sow" / testudo arietaria).

Reference: the rams of the Maciejowski Bible and Matthew Paris, the "sow" at Dunbar (1338), Viollet-le-Duc's
belier: a steep gabled shed of rafters on two long sills running on six solid wheels hidden inside, sheathed in
boards and covered with overlapping raw (wetted) hides against fire, the front gable boarded down to the ram's
port; inside, a 9 m oak trunk with an iron cap and bands slung on chains from two stringers under the collars,
rope handles for the crew. Contract: 3 x 8 m, 3.2 m tall.

Moving parts (assets/glb/ram_parts.json):
  ram             pivot = the log's centre of mass; TRANSLATES along Y (+-0.8 m swing) with a slight X rotation;
                  its suspension chains are part of it (their tops slide along the stringers)
  wheel_fl/fm/fr... six wheels  wheel_{l,r}{f,m,b}  (l = +X side), roll about +X

  blender -b -P assets/src/ram.py -- [complete|burnt]
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _siege_kit as S
import _kit_yards as K
from _kit_yards import beam, box, cyl, tube

STATE = S.state_from_argv()
S.init(STATE, seed=71)
R = K.R
jit = S.jit
FULL = STATE == "complete"
BURNT = STATE == "burnt"
assert STATE in ("complete", "burnt"), STATE

SY0, SY1 = -3.5, 3.7          # shed length
EX, EZ, RZ = 1.45, 0.8, 3.2   # eave half-width + height, ridge height
WR = 0.45
WXS = 0.95
WYS = (-2.6, 0.0, 2.6)
LOG_Z = 1.2
LOG_Y0, LOG_Y1 = -4.9, 4.1
COM = Vector((0.0, -0.75, LOG_Z))
STR_X, STR_Z = 0.36, 2.52     # chain stringers under the collars

wheel_names = {}
for sx, sn in ((1, "l"), (-1, "r")):
    for y, yn in zip(WYS, ("f", "m", "b")):
        wheel_names[f"wheel_{sn}{yn}"] = (sx, y)
if FULL:
    for nm, (sx, y) in wheel_names.items():
        S.part(nm, (sx * WXS, y, WR), axis="X", rest="any (rolls)")
    S.part("ram", COM, axis="X", rest="hanging level, iron head at -Y",
           notes="translate along Y within +-0.8 m (the swing) with a few deg of X rotation; chains included")

C = K.B("char") if BURNT else None
oak = C or K.B("oak")
oak2 = C or K.B("oak2")
plank = C or K.B("plank")
hide = K.B("hide")
iron, rope, tar = K.B("iron"), K.B("rope"), K.B("tar")


def slope_pt(sx, y, t, off=0.0):
    """point on roof side sx at length y, t = 0 eave .. 1 ridge, off = along outward normal."""
    e = Vector((sx * EX, y, EZ)); r = Vector((0.0, y, RZ))
    n = Vector((sx * (RZ - EZ), 0.0, EX)).normalized()
    return e.lerp(r, t) + n * off


def chassis():
    for sx in (-1, 1):
        beam(oak, (sx * (EX - 0.08), SY0 - 0.15, 0.68), (sx * (EX - 0.08), SY1 + 0.15, 0.68), 0.24, 0.26, 0.018)
    for y in WYS:
        beam(oak, (-EX + 0.05, y, WR), (EX - 0.05, y, WR), 0.18, 0.2, 0.0)
        for sx in (-1, 1):
            box(oak2, (sx * (EX - 0.08) - 0.1, y - 0.1, WR + 0.08), (sx * (EX - 0.08) + 0.1, y + 0.1, 0.56), 0.0)
    for y in (SY0 + 0.1, SY1 - 0.1):
        beam(oak, (-EX, y, 0.62), (EX, y, 0.62), 0.2, 0.22, 0.0, side=(0, 0, 1))
    # iron push-bars / handles for the crew at the rear
    for sx in (-1, 1):
        beam(oak2, (sx * 0.8, SY1 - 0.1, 0.62), (sx * 0.8, SY1 + 0.55, 0.95), 0.08, 0.08, 0.0)


def frame(collapse=False):
    n = 7
    ys = [SY0 + (SY1 - SY0) * i / (n - 1) for i in range(n)]
    for i, y in enumerate(ys):
        if collapse and 1 < i < 6:
            continue
        for sx in (-1, 1):
            beam(oak, slope_pt(sx, y, 0.0, -0.08) + Vector((0, 0, -0.1)), slope_pt(sx, y, 1.0, -0.08) + Vector((0, 0, 0.04)),
                 0.14, 0.16, 0.012, side=(0, 1, 0))
        z = STR_Z + 0.12
        xh = EX * (RZ - z) / (RZ - EZ) - 0.08
        beam(oak2, (-xh, y, z), (xh, y, z), 0.12, 0.14, 0.0, side=(0, 0, 1))
    if not collapse:
        beam(oak, (0, SY0 - 0.2, RZ - 0.05), (0, SY1 + 0.2, RZ - 0.05), 0.18, 0.2, 0.015)
    for sx in (-1, 1):
        beam(oak2, (sx * STR_X, SY0 + 0.3, STR_Z), (sx * STR_X, SY1 - 0.3, STR_Z), 0.1, 0.12, 0.0) if not collapse else None
    return ys


def roof(collapse=False):
    """boards under overlapping hides; hides lap down-slope and hang over the eaves."""
    for sx in (-1, 1):
        for k in range(6):
            t0, t1 = k / 6 + 0.005, (k + 1) / 6 - 0.005
            if collapse:
                # burnt through: a few charred lengths of boarding slumped onto the chassis
                if R.random() < 0.5:
                    continue
                ya = R.uniform(SY0, SY1 - 2.0); yb = ya + R.uniform(1.0, 2.2)
                za, zb = R.uniform(0.75, 1.5), R.uniform(0.2, 0.9)
                xa = sx * R.uniform(0.9, 1.4)
                beam(plank, (xa, ya, za), (xa * 0.4 + jit(0.3), yb, zb), R.uniform(0.3, 0.45), 0.04, 0.0,
                     side=(sx * 0.6, 0, 1), twist=jit(0.3))
                continue
            a0, a1 = slope_pt(sx, SY0 - 0.2, t0), slope_pt(sx, SY1 + 0.2, t1)
            c = (a0 + a1) / 2
            pts = []
            for (yy, tt) in ((SY0 - 0.2, t0), (SY0 - 0.2, t1), (SY1 + 0.2, t0), (SY1 + 0.2, t1)):
                for off in (0.0, 0.04):
                    pts.append(slope_pt(sx, yy, tt, off))
            P, F = K.hull(pts); plank.add(P, F, None, None, [(p[0], p[2], p[1]) for p in P])
    if collapse:
        return
    # hides: 3 rows per slope, 5 along; each hide ~1.6 x 1.1 m, lapped
    for sx in (-1, 1):
        # two courses of whole ox-hides (~2 x 1.5 m), the upper course lapping over the lower
        for ri, (t0, t1) in enumerate(((-0.1, 0.56), (0.47, 0.97))):
            nb = 4
            L = (SY1 - SY0 + 0.5) / nb
            for j in range(nb + ri):
                y0 = SY0 - 0.25 + (j - 0.5 * ri) * L - 0.12 + jit(0.1)
                y1 = y0 + L * R.uniform(1.08, 1.2)
                y0 = max(y0, SY0 - 0.35); y1 = min(y1, SY1 + 0.35)
                tt0, tt1 = t0 + jit(0.025), t1 - abs(jit(0.025))
                if sx < 0:
                    y0, y1 = y1, y0
                off = 0.05 + ri * 0.05 + (j % 2) * 0.022
                o = slope_pt(sx, y0, tt0, off)
                u = slope_pt(sx, y1, tt0 + jit(0.03), off) - o
                v = slope_pt(sx, y0 + jit(0.12), tt1, off) - o
                S.hide_panel(hide, o, u, v, nu=5, nv=4, bulge=0.018, ragged=0.13, thick=0.012, pegs=0)
    # ridge capping: one long run of hides laid over the ridge
    grid = []
    for i in range(4):
        t = (i / 3) * 2 - 1
        sx = -1 if t < 0 else 1
        row = []
        for k in range(7):
            yy = SY0 - 0.3 + (SY1 - SY0 + 0.6) * k / 6
            pt = slope_pt(sx, yy, 1.0 - abs(t) * 0.2, 0.17 + (0.03 if abs(t) < 0.5 else 0.0))
            row.append(Vector((pt.x + jit(0.02), yy + jit(0.05), pt.z + jit(0.015))))
        grid.append(row)
    S.sheet(hide, grid, 0.014)
    for sx in (-1, 1):
        # hides hanging over the eaves as a skirt
        for j in range(4):
            y = SY0 + 0.6 + j * (SY1 - SY0 - 1.2) / 3 + jit(0.2)
            top = slope_pt(sx, y, -0.02, 0.06)
            grid = []
            for i in range(3):
                row = []
                for k in range(4):
                    yy = y - 0.6 + 1.2 * k / 3
                    zz = top.z - 0.28 * i - 0.02 * math.sin(k * 2.1)
                    row.append(Vector((top.x + sx * (0.02 + 0.03 * i), yy + jit(0.03), zz + jit(0.02))))
                grid.append(row if sx > 0 else row[::-1])
            S.sheet(hide, grid, 0.012)


def gable():
    y = SY0 - 0.12
    # boarded front gable above the ram's port, clad in hides
    nb = 9
    for i in range(nb):
        x0 = -EX + 0.1 + (2 * EX - 0.2) * i / nb
        x1 = x0 + (2 * EX - 0.2) / nb - 0.012
        xm = (x0 + x1) / 2
        ztop = EZ + (RZ - EZ) * (1 - abs(xm) / EX) - 0.05
        zb = 1.65 if abs(xm) < 0.5 else 0.72
        if ztop - zb < 0.1:
            continue
        box(plank, (x0, y - 0.04, zb), (x1, y + 0.02, ztop), 0.0, rot=(0, jit(0.01), 0))
    beam(oak2, (-0.5, y - 0.06, 1.6), (0.5, y - 0.06, 1.6), 0.14, 0.12, 0.0, side=(0, 0, 1))
    for sx in (-1, 1):
        beam(oak2, (sx * 0.52, y - 0.06, 0.7), (sx * 0.52, y - 0.06, 1.7), 0.12, 0.12, 0.0)
        o = Vector((0.62 if sx > 0 else -1.3, y - 0.07, 0.74))
        S.hide_panel(hide, o, Vector((0.68, 0, 0)), Vector((0, 0, 0.62 + 0.25)), nu=3, nv=3, bulge=0.02, ragged=0.05)
    o = Vector((-0.55, y - 0.07, 1.72))
    S.hide_panel(hide, o, Vector((1.1, 0, 0)), Vector((0, 0, 1.1)), nu=3, nv=3, bulge=0.02, ragged=0.06)


def ram_geo(bo, bi, br, M=None):
    def T(p):
        return (M @ Vector(p)) if M else Vector(p)
    a, b = Vector((0, LOG_Y0 + 0.35, LOG_Z)), Vector((0, LOG_Y1, LOG_Z))
    # slightly tapering oak trunk, knots trimmed
    pts = []
    n = 8
    for (y, r) in ((a.y, 0.24), (a.y + 3.0, 0.25), (a.y + 6.0, 0.23), (b.y, 0.21)):
        for k in range(n):
            th = 2 * math.pi * k / n
            rr = r * (1 + jit(0.03))
            pts.append(T((math.cos(th) * rr, y, LOG_Z + math.sin(th) * rr)))
    F = []
    for s in range(3):
        for k in range(n):
            kn = (k + 1) % n
            F.append((s * n + k, s * n + kn, (s + 1) * n + kn, (s + 1) * n + k))
    F.append(tuple(range(n))[::-1]); F.append(tuple(range(3 * n, 4 * n)))
    loc = [((p - T((0, 0, LOG_Z))).x if False else 0, 0, 0) for p in []]
    bo.add(pts, F, None, None, [(math.cos(2 * math.pi * (i % n) / n) * 0.2, math.sin(2 * math.pi * (i % n) / n) * 0.2,
                                 [a.y, a.y + 3, a.y + 6, b.y][i // n]) for i in range(len(pts))])
    # iron head: a blunt cap with a ram's-head boss, strapped back along the log
    S_ = K.lathe
    cap = [(0.0, 0.0), (0.12, 0.02), (0.22, 0.1), (0.27, 0.3), (0.27, 0.55), (0.25, 0.6)]
    pts, F2 = [], []
    for j, (r, d) in enumerate(cap):
        for k in range(n):
            th = 2 * math.pi * k / n
            pts.append(T((math.cos(th) * r, LOG_Y0 + d, LOG_Z + math.sin(th) * r)))
    for j in range(len(cap) - 1):
        for k in range(n):
            kn = (k + 1) % n
            F2.append((j * n + k, (j + 1) * n + k, (j + 1) * n + kn, j * n + kn))
    bi.add(pts, F2, None, None)
    for sx in (-1, 1):                         # curled horns of the ram's head
        path = [Vector((sx * 0.2, LOG_Y0 + 0.3, LOG_Z + 0.2)), Vector((sx * 0.34, LOG_Y0 + 0.22, LOG_Z + 0.24)),
                Vector((sx * 0.4, LOG_Y0 + 0.12, LOG_Z + 0.08)), Vector((sx * 0.33, LOG_Y0 + 0.14, LOG_Z - 0.08)),
                Vector((sx * 0.26, LOG_Y0 + 0.22, LOG_Z - 0.02))]
        tube(bi, [T(p) for p in path], [0.07, 0.07, 0.06, 0.05, 0.035], 6)
    for k in range(4):                         # langets strapping the cap back along the log
        th = 2 * math.pi * k / 4 + 0.4
        o = Vector((math.cos(th), 0, math.sin(th)))
        beam(bi, T(Vector((0, LOG_Y0 + 0.5, LOG_Z)) + o * 0.255), T(Vector((0, LOG_Y0 + 1.5, LOG_Z)) + o * 0.25), 0.07, 0.014, 0.0,
             side=o)
    for y in (LOG_Y0 + 1.55, -1.9, 0.6, 2.6, LOG_Y1 - 0.2):
        cyl(bi, T((0, y - 0.04, LOG_Z)), T((0, y + 0.04, LOG_Z)), 0.26, n=n)
    # chains from the stringers (V pairs) + crew rope handles
    for yc in (COM.y - 1.8, COM.y + 1.8):
        cyl(bi, T((0, yc - 0.06, LOG_Z)), T((0, yc + 0.06, LOG_Z)), 0.265, n=n)
        for sx in (-1, 1):
            top = Vector((sx * STR_X, yc, STR_Z - 0.06))
            bot = Vector((sx * 0.12, yc, LOG_Z + 0.24))
            d = (bot - top); L = d.length; d.normalize()
            nl = int(L / 0.2)
            side = Vector((1, 0, 0)).cross(d).normalized()
            for i in range(nl):
                q0 = top + d * (i * L / nl); q1 = top + d * ((i + 1) * L / nl + 0.02)
                beam(bi, T(q0), T(q1), 0.07 if i % 2 else 0.018, 0.018 if i % 2 else 0.07, 0.0, side=side)
    for y in (-2.9, 0.9, 3.4):
        ring = [Vector((math.cos(2 * math.pi * k / 7) * 0.26, y, LOG_Z + math.sin(2 * math.pi * k / 7) * 0.26)) for k in range(7)]
        tube(br, [T(p) for p in ring + [ring[0]]], 0.022, 4, caps=False)
        loop = [Vector((0.2, y, LOG_Z - 0.2)), Vector((0.3, y, LOG_Z - 0.42)), Vector((0.0, y, LOG_Z - 0.5)),
                Vector((-0.3, y, LOG_Z - 0.42)), Vector((-0.2, y, LOG_Z - 0.2))]
        tube(br, [T(p) for p in loop], 0.022, 4)


if FULL:
    chassis()
    for nm, (sx, y) in wheel_names.items():
        S.wheel(nm, (sx * WXS, y, WR), WR, 0.16, kind="plain", side=-sx)
    frame(); roof(); gable()
    ram_geo(S.P("ram", "oak"), S.P("ram", "iron"), S.P("ram", "rope"))
    # a team pennant on the ridge at the front
    cyl(oak2, (0, SY0 + 0.2, RZ), (0, SY0 + 0.2, RZ + 1.4), 0.03, n=5)
    grid = [[Vector((0.0, SY0 + 0.22 + t * 0.9, RZ + 1.35 - 0.08 * t - (i / 2) * 0.4 * (1 - 0.6 * t))) for t in (0, 0.25, 0.5, 0.75, 1.0)]
            for i in range(3)]
    S.sheet(K.B("team"), grid, 0.01)
else:
    chassis()
    for nm, (sx, y) in wheel_names.items():
        S.wheel("body", (sx * WXS, y, WR), WR, 0.16, kind="plain", side=-sx)
    frame(collapse=True); roof(collapse=True)
    # the roof fell in: charred rafters strewn across, scorched hides in heaps, the log dropped to the floor
    for i in range(10):
        y = R.uniform(SY0, SY1)
        sx = R.choice((-1, 1))
        a = Vector((sx * R.uniform(0.6, 1.5), y, R.uniform(0.7, 0.9)))
        b = Vector((-sx * R.uniform(0.0, 1.0), y + jit(1.2), R.uniform(0.2, 1.6)))
        beam(oak, a, b, 0.13, 0.15, 0.0)
    for i in range(5):
        c = Vector((R.uniform(-1.3, 1.3), R.uniform(SY0, SY1), 0.02))
        K.mound(hide, c.x, c.y, R.uniform(0.4, 0.8), R.uniform(0.4, 0.7), 0.12, rings=2, seg=8, rough=0.4)
    M = Matrix.Translation((0.2, 0.2, -LOG_Z + 0.95)) @ Matrix.Rotation(0.06, 4, "Z")
    ram_geo(oak, iron, rope, M=M)
    K.mound(K.B("ash"), 0.0, 0.0, 1.9, 4.6, 0.08, rings=4, seg=16, rough=0.35)

if __name__ == "__main__":
    name = "ram" if FULL else "ram_" + STATE
    path, tris = S.finish_parts(name, tex=1024)
    if FULL:
        S.write_parts_json("ram", ["complete", "burnt"], tris,
                           extra=dict(swing="translate the 'ram' node along Y by up to +-0.8 m (head toward -Y strikes)",
                                      wheel_naming="wheel_{l,r}{f,m,b}: l = +X, f = -Y end"))
