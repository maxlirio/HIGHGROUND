"""HIGHGROUND - siege workshop, footprint 22 x 14 m.

The engine-wright's yard (cf. the "ingeniator" works at the Tower and at Carlisle in the Pipe Rolls, and the
workshop scenes of the Maciejowski Bible): a long open-sided timber shed of six bays (posts on padstones, arcade
plates, tie-beam trusses with king posts, knee braces, a shingled roof, boarded back wall and gables), and a
fenced front yard with a lined sawpit and a log half-sawn, a half-built trebuchet frame under a pair of shear
legs lifting its next leg, stacked squared timber, rope coils, spare wheels, trestles with a beam being hewn,
and in the shed an arm on trestles, workbenches and a grindstone. Team flags are added in-engine.

    blender -b -P assets/src/siege_workshop.py -- [complete|build1|build2|ruin]

Front faces -Y. 1 unit = 1 m.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _siege_kit as S
import _kit_yards as K
from _kit_yards import beam, box, cyl, tube
import _craft as CR

STATE = S.state_from_argv()
S.init(STATE, seed=113, building=True)
R = K.R
jit = S.jit
FULL, B1, B2, RUIN = (STATE == s for s in ("complete", "build1", "build2", "ruin"))
CH = 1.0 if RUIN else 0.0

M = K.MAT
M["sawdust"] = CR.m_heap("sawdust", [(0.1, "#8a7152"), (0.5, "#a78a62"), (0.9, "#b99c70")], 40.0, rough=0.95)
M["yard"] = CR.m_heap("yard", [(0.1, "#4a3c2d"), (0.45, "#5a4936"), (0.8, "#6a5842")], 9.0, pebble=0.35, grass=0.45)
M["spoil"] = CR.m_heap("spoil", [(0.1, "#4d3d2c"), (0.5, "#5e4a35"), (0.9, "#6e5a41")], 11.0, pebble=0.45, grass=0.25)
M["bark"] = CR.m_bark("bark", [(0.0, "#4a3b2e"), (0.5, "#5a4838"), (1.0, "#6a5645")], lichen=0.5, charred=CH)

oak, oak2, plank, fresh = K.B("oak"), K.B("oak2"), K.B("plank"), K.B("fresh")
iron, rope, stone = K.B("iron"), K.B("rope"), K.B("stone")
char = K.B("char")

X0, X1 = -11.0, 11.0
YF, YB = 0.0, 7.0                     # shed front / back post lines
YR = (YF + YB) / 2
EZ, RZ = 3.4, 6.9                     # eave (plate top) / ridge
NB = 6
XS = [X0 + (X1 - X0) * k / NB for k in range(NB + 1)]
YARD0 = -6.9


def pad():
    """rectangular packed-earth pad over the whole footprint, soft edges sunk below grade."""
    nx, ny = 16, 11
    grid = []
    for i in range(ny + 1):
        row = []
        for j in range(nx + 1):
            x = X0 - 0.4 + (X1 - X0 + 0.8) * j / nx
            y = YARD0 - 0.3 + (YB + 0.5 - YARD0 + 0.3) * i / ny
            edge = i in (0, ny) or j in (0, nx)
            z = -0.04 if edge else 0.025 + jit(0.012)
            row.append(Vector((x + (jit(0.2) if edge else 0), y + (jit(0.2) if edge else 0), z)))
        grid.append(row)
    S.sheet(K.B("yard"), grid, 0.03)


# ================================================================== shed frame
def posts(keep=1.0, short=False):
    out = []
    for y in (YF, YB):
        for k, x in enumerate(XS):
            box(stone, (x - 0.3, y - 0.3, -0.05), (x + 0.3, y + 0.3, 0.14), 0.03, rot=(0, 0, jit(0.1)))
            if R.random() > keep:
                continue
            top = EZ if not short else R.uniform(1.2, EZ)
            beam(char if RUIN else oak, (x, y, 0.14), (x + jit(0.02), y + jit(0.02), top), 0.3, 0.3, 0.02)
            out.append((x, y, top))
    return out


def plates_and_trusses(trusses=range(NB + 1), braces=True, king=True, ridge=True):
    for y in (YF, YB):
        beam(oak, (X0 - 0.35, y, EZ + 0.13), (X1 + 0.35, y, EZ + 0.13), 0.28, 0.26, 0.02)
    for k in trusses:
        x = XS[k]
        beam(oak, (x, YF - 0.35, EZ + 0.4), (x, YB + 0.35, EZ + 0.4), 0.28, 0.3, 0.02, side=(0, 0, 1))
        if braces:
            for y, s in ((YF, 1), (YB, -1)):
                beam(oak2, (x, y, EZ - 1.05), (x, y + s * 1.05, EZ + 0.3), 0.18, 0.18, 0.0, side=(1, 0, 0))
            if 0 < k < NB:
                for y in (YF, YB):
                    for s in (-1, 1):
                        beam(oak2, (x, y, EZ - 0.95), (x + s * 0.95, y, EZ + 0.05), 0.16, 0.16, 0.0, side=(0, 1, 0))
        if king:
            beam(oak, (x, YR, EZ + 0.55), (x, YR, RZ - 0.1), 0.26, 0.26, 0.015)
            for y in (YF, YB):
                beam(oak, (x, y - (0.35 if y == YF else -0.35), EZ + 0.45), (x, YR, RZ + 0.05), 0.24, 0.22, 0.015, side=(1, 0, 0))
            for s in (-1, 1):
                beam(oak2, (x, YR, EZ + 1.3), (x, YR + s * 1.6, EZ + 0.55 + 1.6 * (RZ - EZ) / (YR - YF) * 0.55), 0.14, 0.14, 0.0,
                     side=(1, 0, 0))
    if ridge:
        beam(oak, (X0 - 0.5, YR, RZ), (X1 + 0.5, YR, RZ), 0.26, 0.24, 0.015)


def slope_z(y, off=0.0):
    t = abs(y - YR) / (YR - YF + 0.35)
    return RZ + off - (RZ - EZ - 0.45) * t


def purlins_rafters(frac=1.0, xr=(X0, X1)):
    for s in (-1, 1):
        for t in (0.33, 0.66):
            y = YR - s * (YR - YF + 0.35) * t
            beam(oak2, (xr[0] - 0.45, y, slope_z(y, -0.05)), (xr[1] + 0.45, y, slope_z(y, -0.05)), 0.16, 0.16, 0.0)
        x = xr[0] - 0.4
        while x <= xr[1] + 0.41:
            if R.random() < frac:
                ye = YR - s * (YR - YF + 0.7)
                beam(oak2, (x, ye, slope_z(ye, -0.1)), (x, YR, RZ - 0.02), 0.1, 0.12, 0.0, side=(1, 0, 0))
            x += 0.92


def shingles(stop=None, xr=(X0 - 0.5, X1 + 0.5)):
    eave = (YF - 0.8, slope_z(YF - 0.8, 0.14))
    ridge = (YR + 0.05, RZ + 0.3)
    bt = K.B("shingle")
    Mid = Matrix.Identity(4)
    mir = Matrix.Translation((0, 2 * YR, 0)) @ Matrix.Scale(-1, 4, (0, 1, 0))
    for MM in (Mid, mir):
        K.roof_rows(bt, MM, xr[0], xr[1], eave, ridge, row_w=0.42, lap=0.7, thick=0.03, sag=0.1, seg=10, stop=stop)
    if stop is None:
        # ridge boards
        for s in (-1, 1):
            beam(plank, (X0 - 0.55, YR + s * 0.14, RZ + 0.42), (X1 + 0.55, YR + s * 0.14, RZ + 0.42), 0.3, 0.035, 0.0,
                 side=(0, s * 0.8, 1), twist=0.0)
        # bargeboards
        for x in (X0 - 0.52, X1 + 0.52):
            for s in (-1, 1):
                ye = YR - s * (YR - YF + 0.8)
                beam(oak2, (x, ye, slope_z(ye, 0.2)), (x, YR, RZ + 0.5), 0.05, 0.28, 0.0, side=(0, s * 0.7, 1))


def back_wall(keep=1.0):
    y = YB + 0.2
    x = X0 - 0.14
    while x < X1 + 0.14:
        w = R.uniform(0.24, 0.32)
        if R.random() < keep:
            (plank if R.random() < 0.7 else oak2).add(*K.box_geo(w - 0.012, 0.04, EZ + 0.1 + jit(0.02)),
                                                      K.TRS((x + w / 2, y, (EZ + 0.1) / 2 + 0.02)), None)
        x += w
    for z in (0.5, 1.7, 2.9):
        beam(oak2, (X0, YB + 0.12, z), (X1, YB + 0.12, z), 0.12, 0.08, 0.0) if keep >= 1 else None
    # boarded gables (above the tie-beams) at both ends
    for xg in (X0 - 0.16, X1 + 0.16):
        yy = YF - 0.3
        while yy < YB + 0.3:
            w = 0.3
            ym = yy + w / 2
            top = slope_z(ym, -0.2)
            if top > EZ + 0.6 and R.random() < keep:
                box(plank, (xg - 0.02, yy + 0.005, EZ + 0.55), (xg + 0.02, yy + w - 0.005, top), 0.0)
            yy += w


# ================================================================== yard pieces
def sawpit(stage="complete"):
    px0, px1, py0, py1 = -8.6, -4.2, -4.2, -3.0
    cx, cy = (px0 + px1) / 2, (py0 + py1) / 2
    for (mx, my, rx, ry) in ((cx, py0 - 0.55, (px1 - px0) / 2 + 0.8, 0.7), (cx, py1 + 0.55, (px1 - px0) / 2 + 0.8, 0.7),
                             (px0 - 0.55, cy, 0.75, 1.1), (px1 + 0.55, cy, 0.75, 1.1)):
        K.mound(K.B("spoil"), mx, my, rx, ry, 0.38, rings=4, seg=16, rough=0.1, power=2.0)
    box(K.B("dark"), (px0 - 0.05, py0 - 0.05, 0.0), (px1 + 0.05, py1 + 0.05, 0.02))
    for (x0, y0, x1, y1) in ((px0, py0 - 0.1, px1, py0), (px0, py1, px1, py1 + 0.1), (px0 - 0.1, py0, px0, py1), (px1, py0, px1 + 0.1, py1)):
        box(K.B("spoil"), (x0 - 0.2 if x1 - x0 < 0.2 and x0 < cx else x0, y0 - 0.2 if y1 - y0 < 0.2 and y0 < cy else y0, 0.0),
            (x1 + 0.2 if x1 - x0 < 0.2 and x0 > cx else x1, y1 + 0.2 if y1 - y0 < 0.2 and y0 > cy else y1, 0.36))
        if stage == "dug":
            continue
        if (x1 - x0) > (y1 - y0):
            yy = y1 + 0.01 if y0 < cy else y0 - 0.01
            for z in (0.1, 0.26):
                beam(plank, (x0, yy, z), (x1, yy, z + jit(0.01)), 0.16, 0.035, 0.0, side=(0, 1, 0))
    if stage == "dug":
        return
    tr = (px0 + 0.8, px1 - 0.9)
    for x in tr:
        beam(char if RUIN else oak, (x, py0 - 0.6, 0.5), (x + jit(0.03), py1 + 0.6, 0.5), 0.22, 0.2, 0.0)
    lz = 0.9
    xs = cx + 0.4
    cyl(K.B("bark"), (px0 - 0.5, cy, lz), (xs, cy, lz), 0.3, 0.28, n=10)
    for i in range(4):
        yy = cy - 0.2 + i * 0.13
        sp = (i - 1.5) * 0.03
        beam(char if RUIN else fresh, (xs - 0.02, yy, lz), (px1 + 0.4, yy + sp, lz - abs(sp) * 0.5), 0.09, 0.5, 0.0, side=(0, 0, 1))
    if not RUIN:
        beam(iron, (xs + 0.02, cy, 0.3), (xs + 0.02, cy, lz + 1.5), 0.22, 0.01, 0.0, side=(1, 0, 0))
        beam(oak, (xs + 0.02, cy - 0.25, lz + 1.55), (xs + 0.02, cy + 0.25, lz + 1.55), 0.06, 0.06, 0.0)
    K.mound(K.B("sawdust"), xs, cy, 1.0, 0.6, 0.06, rings=3, seg=12, rough=0.3)


def timber_stack(x0, y0, length, rows=3, n0=4, mat=None, along_x=True):
    bt = mat or oak
    for r in range(rows):
        for i in range(n0 - r):
            off = i * 0.3 + r * 0.15
            z = 0.2 + r * 0.26
            ln = length + jit(0.3)
            if along_x:
                beam(bt, (x0 + jit(0.1), y0 + off, z), (x0 + ln, y0 + off + jit(0.02), z), 0.26, 0.26, 0.012)
            else:
                beam(bt, (x0 + off, y0 + jit(0.1), z), (x0 + off + jit(0.02), y0 + ln, z), 0.26, 0.26, 0.012)
    for d in (0.5, length - 0.5):
        if along_x:
            beam(oak2, (x0 + d, y0 - 0.15, 0.04), (x0 + d, y0 + n0 * 0.3 + 0.1, 0.04), 0.14, 0.12, 0.0)
        else:
            beam(oak2, (x0 - 0.15, y0 + d, 0.04), (x0 + n0 * 0.3 + 0.1, y0 + d, 0.04), 0.14, 0.12, 0.0)


def half_engine(stage="complete"):
    """a trebuchet frame going up in the yard: soles + sills laid, one A-frame raised, shear legs over it."""
    y1, y2 = -4.6, -2.4
    xa, xb = 1.4, 8.0
    bt = char if RUIN else oak
    for y in (y1, y2):
        beam(bt, (xa, y, 0.22), (xb, y, 0.22), 0.36, 0.4, 0.02)
    for x in (xa + 0.4, (xa + xb) / 2, xb - 0.4):
        beam(bt, (x, y1 - 0.6, 0.2), (x, y2 + 0.6, 0.2), 0.34, 0.36, 0.0, side=(0, 0, 1))
    if stage == "sills":
        return
    xm = (xa + xb) / 2
    if not RUIN:
        for y in (y1,):
            beam(oak, (xm, y, 0.42), (xm, y, 4.6), 0.38, 0.38, 0.02)
            for s in (-1, 1):
                beam(oak, (xm + s * 2.5, y, 0.42), (xm + s * 0.25, y, 4.3), 0.32, 0.3, 0.02, side=(0, 1, 0))
            beam(oak2, (xm - 1.7, y, 1.8), (xm + 1.7, y, 1.8), 0.26, 0.26, 0.0, side=(0, 1, 0))
        # shear legs lifting the far leg into place
        top = Vector((xm + 0.4, y2 + 0.2, 7.4))
        for s in (-1, 1):
            cyl(oak2, (xm + 0.4 + s * 1.6, y2 + 1.4, 0.0), top + Vector((s * 0.1, 0, 0.2)), 0.1, 0.08, n=7)
        S.rope(rope, [top + Vector((0, 0, 0.1)), Vector((xm + 0.4, y2 + 3.4, 0.25))], 0.025, sag=0.15)
        blk = top + Vector((0, 0, -0.6))
        box(oak2, blk - Vector((0.12, 0.1, 0.18)), blk + Vector((0.12, 0.1, 0.18)), 0.0)
        S.rope(rope, [top, blk], 0.03)
        # the hoisted leg hanging at an angle in its sling
        a = Vector((xm + 1.8, y2, 0.5)); b = Vector((xm + 0.5, y2, 4.1))
        beam(oak, a, b, 0.32, 0.3, 0.02)
        hp = a.lerp(b, 0.6)
        S.rope(rope, [blk - Vector((0, 0, 0.2)), hp + Vector((0, 0, 0.2))], 0.022)
        ring = [hp + Vector((math.cos(t) * 0.24, math.sin(t) * 0.24, 0)) for t in [2 * math.pi * i / 6 for i in range(7)]]
        tube(rope, ring, 0.02, 4, caps=False)
        # guy ropes to stakes
        for p in (Vector((xm - 3.5, y2 + 3.2, 0.0)), Vector((xm + 4.0, y1 - 1.5, 0.0))):
            S.rope(rope, [top, p + Vector((0, 0, 0.3))], 0.015, sag=0.1)
            cyl(oak2, p, p + Vector((0.1, 0.0, 0.45)), 0.04, n=5)
    else:
        for i in range(4):
            a = Vector((xm + jit(2.0), (y1 + y2) / 2 + jit(1.0), 0.2))
            beam(char, a, a + Vector((jit(3.0), jit(2.0), R.uniform(0.0, 0.6))), 0.34, 0.32, 0.0)


def hewing_trestles(cx, cy):
    for dx in (-1.3, 1.3):
        for s in (-1, 1):
            beam(oak2, (cx + dx, cy + s * 0.35, 0.0), (cx + dx, cy - s * 0.1, 0.8), 0.08, 0.08, 0.0, side=(1, 0, 0))
        beam(oak2, (cx + dx, cy - 0.3, 0.75), (cx + dx, cy + 0.3, 0.75), 0.1, 0.1, 0.0)
    cyl(K.B("bark"), (cx - 2.2, cy, 1.02), (cx + 0.2, cy, 1.02), 0.24, 0.23, n=9)
    beam(fresh, (cx + 0.1, cy, 1.02), (cx + 2.3, cy, 1.02), 0.44, 0.42, 0.01)
    # broad-axe resting on it, chips below
    beam(iron, (cx + 0.2, cy - 0.1, 1.28), (cx + 0.2, cy - 0.3, 1.3), 0.02, 0.2, 0.0, side=(0, 0, 1))
    cyl(oak2, (cx + 0.2, cy - 0.2, 1.28), (cx + 0.9, cy - 0.3, 1.3), 0.02, n=5)
    for i in range(26):
        x, y = cx + R.uniform(-1.2, 2.2), cy + R.uniform(-1.0, 1.0)
        s = R.uniform(0.04, 0.09)
        box(fresh, (x - s, y - s * 0.5, 0.03), (x + s, y + s * 0.5, 0.05), 0.0, rot=(jit(0.3), jit(0.3), R.uniform(0, 3)))
    K.mound(K.B("sawdust"), cx + 0.6, cy, 1.4, 0.9, 0.04, rings=3, seg=12, rough=0.35)


def spare_wheels(x, y, n=3, lean_axis="x"):
    for i in range(n):
        c = Vector((x + i * 0.3, y, 0.62))
        S.wheel("body", c, 0.6, 0.2, kind="plain", side=1)
    # (they stand in a rack: two posts + a rail)
    for dx in (-0.3, n * 0.3):
        cyl(oak2, (x + dx, y - 0.4, 0.0), (x + dx, y - 0.4, 1.1), 0.05, n=5)
    beam(oak2, (x - 0.35, y - 0.4, 1.0), (x + n * 0.3 + 0.05, y - 0.4, 1.0), 0.07, 0.07, 0.0)


def shed_contents():
    # an arm on trestles along the back of the shed, rope-bound, half banded
    for x in (-8.0, -3.5, 1.0):
        for s in (-1, 1):
            beam(oak2, (x + s * 0.4, 5.2, 0.0), (x + s * 0.05, 5.2, 0.85), 0.1, 0.1, 0.0, side=(0, 1, 0))
        beam(oak2, (x - 0.5, 5.2, 0.85), (x + 0.5, 5.2, 0.85), 0.14, 0.14, 0.0, side=(0, 0, 1))
    pts = [Vector((-9.4, 5.2, 1.22)), Vector((2.2, 5.2, 1.1))]
    beam(oak, pts[0], pts[1], 0.62, 0.52, 0.02)
    for x in (-8.6, -7.6, -6.6, -5.6):
        beam(iron, (x - 0.03, 5.2, 1.2), (x + 0.03, 5.2, 1.2), 0.66, 0.56, 0.0)
    # workbenches with tools, a grindstone, a chest of iron fittings
    for (bx, by) in ((4.2, 5.8), (8.0, 5.8)):
        box(plank, (bx - 1.2, by - 0.35, 0.82), (bx + 1.2, by + 0.35, 0.9), 0.01)
        for dx in (-1.05, 1.05):
            for dy in (-0.28, 0.28):
                box(oak2, (bx + dx - 0.05, by + dy - 0.05, 0.0), (bx + dx + 0.05, by + dy + 0.05, 0.82), 0.0)
        for i in range(3):
            box(iron, (bx - 0.8 + i * 0.5, by - 0.1, 0.9), (bx - 0.6 + i * 0.5, by + 0.12, 0.93), 0.0, rot=(0, 0, jit(0.5)))
        box(fresh, (bx + 0.3, by - 0.2, 0.9), (bx + 1.1, by - 0.05, 0.96), 0.0)
    gx, gy = 9.6, 3.2
    S.lathe_x(stone, (gx, gy, 0.75), [(0.0, -0.1), (0.55, -0.1), (0.55, 0.1), (0.0, 0.1)], 14)
    for s in (-1, 1):
        box(oak2, (gx + s * 0.25 - 0.05, gy - 0.5, 0.0), (gx + s * 0.25 + 0.05, gy + 0.5, 0.35), 0.0)
        beam(oak2, (gx + s * 0.25, gy, 0.3), (gx + s * 0.25, gy, 0.8), 0.08, 0.08, 0.0)
    beam(oak2, (gx - 0.35, gy - 0.5, 0.33), (gx + 0.35, gy - 0.5, 0.33), 0.08, 0.08, 0.0)
    box(K.B("plank"), (gx - 0.25, gy - 0.25, 0.0), (gx + 0.25, gy + 0.25, 0.3), 0.0)
    box(oak2, (6.0, 4.4, 0.0), (6.9, 4.9, 0.55), 0.02)
    box(iron, (5.96, 4.36, 0.5), (6.94, 4.94, 0.56), 0.0)
    spare_wheels(-10.4, 6.5)
    # rope coils hung on post pegs + on the floor
    for x in (XS[2], XS[4]):
        cyl(oak2, (x, YB - 0.1, 1.9), (x, YB - 0.45, 1.9), 0.03, n=5)
        ring = [Vector((x + math.cos(t) * 0.28, YB - 0.35, 1.62 + math.sin(t) * 0.3)) for t in [2 * math.pi * i / 9 for i in range(10)]]
        tube(rope, ring, 0.05, 5, caps=False)
    S.coil(rope, (-1.2, 2.2, 0.0), 0.45, 0.028, 5)


def fence(keep=1.0, broken=0.0):
    K.fence((X0 - 0.2, YARD0), (-1.8, YARD0), step=2.4, keep=keep, broken=broken, bt_post=char if RUIN else None)
    K.fence((1.8, YARD0), (X1 + 0.2, YARD0), step=2.4, keep=keep, broken=broken, bt_post=char if RUIN else None)
    for x in (X0 - 0.2, X1 + 0.2):
        K.fence((x, YARD0), (x, YF - 0.2), step=2.4, keep=keep, broken=broken, first_post=False, bt_post=char if RUIN else None)
    if not RUIN:
        # gate posts
        for x in (-1.8, 1.8):
            cyl(oak, (x, YARD0, 0.0), (x, YARD0, 1.9), 0.12, 0.1, n=7)


def stakes_and_lines():
    corners = [(X0, YF), (X1, YF), (X1, YB), (X0, YB)]
    for (x, y) in corners:
        for (dx, dy) in ((-0.9, 0), (0, -0.9) if y == YF else (0, 0.9)):
            cyl(fresh, (x + dx * (1 if x < 0 else -1) * -1, y + dy, 0.0), (x + dx * (1 if x < 0 else -1) * -1, y + dy, 0.55), 0.03, n=5)
    for (a, b) in zip(corners, corners[1:] + corners[:1]):
        S.rope(rope, [Vector((a[0], a[1], 0.45)), Vector((b[0], b[1], 0.45))], 0.008, 3)
    for x in XS:
        for y in (YF, YB):
            cyl(fresh, (x, y, 0.0), (x, y, 0.5), 0.028, n=4)


# ================================================================== states
pad()
if FULL:
    posts()
    plates_and_trusses()
    purlins_rafters()
    shingles()
    # a recent repair: a patch of new riven shingles laid over the old on the front slope
    eave = (YF - 0.8, slope_z(YF - 0.8, 0.14))
    ridge = (YR + 0.05, RZ + 0.3)
    for (xa, xb, ta, tb) in ((XS[3] + 0.4, XS[3] + 1.9, 0.36, 0.56), (XS[3] + 0.9, XS[3] + 1.5, 0.3, 0.37)):
        K.roof_rows(fresh, Matrix.Translation((0, 0, 0.0)), xa, xb, eave, ridge, row_w=0.42, lap=0.7,
                    thick=0.025, sag=0.0, seg=3, lift=0.045, wob=0.01, stop=lambda t, ta=ta, tb=tb: ta < t < tb)
    back_wall()
    # hoist beam projecting from the east gable with block and fall
    beam(oak, (X1 - 1.0, YR, EZ + 1.2), (X1 + 1.6, YR, EZ + 1.2), 0.24, 0.26, 0.015)
    beam(oak2, (X1 + 0.1, YR, EZ + 0.4), (X1 + 1.0, YR, EZ + 1.1), 0.14, 0.14, 0.0, side=(0, 1, 0))
    box(oak2, (X1 + 1.25, YR - 0.12, EZ + 0.7), (X1 + 1.45, YR + 0.12, EZ + 1.05), 0.0)
    S.rope(rope, [Vector((X1 + 1.3, YR - 0.05, EZ + 0.75)), Vector((X1 + 1.3, YR - 0.05, 1.0))], 0.02)
    S.rope(rope, [Vector((X1 + 1.4, YR + 0.05, EZ + 0.75)), Vector((X1 + 0.8, YR + 1.2, 0.9))], 0.02, sag=0.1)
    tube(iron, [Vector((X1 + 1.3, YR - 0.05, 1.02)), Vector((X1 + 1.3, YR - 0.05, 0.86)), Vector((X1 + 1.2, YR - 0.05, 0.82))], 0.02, 5)
    shed_contents()
    sawpit()
    half_engine()
    timber_stack(-10.6, -6.4, 4.5, rows=3)
    timber_stack(-3.2, -6.4, 3.5, rows=2, n0=3, mat=fresh)
    hewing_trestles(-1.6, -1.6)
    spare_wheels(9.4, -6.2)
    for p in ((-9.6, -1.5), (9.8, -1.2), (0.4, 1.4)):
        S.coil(rope, (p[0], p[1], 0.0), R.uniform(0.3, 0.45), 0.026, 4)
    K.barrel((10.2, -3.2, 0.0), r=0.34, h=0.86)
    K.barrel((9.6, -3.9, 0.0), r=0.3, h=0.8)
    fence()
    # a wain just in at the gate with squared timber on its bolsters
    zb = S.wagon(-3.6, -3.3, length=3.4, width=1.5, wheel_r=0.5, stakes=False)
    for i, dx in enumerate((-0.45, 0.0, 0.45, -0.22, 0.22)):
        z = zb + 0.13 + (0.26 if i > 2 else 0.0)
        beam(oak, (-3.6 + dx, -5.4, z), (-3.6 + dx + jit(0.03), -0.9, z), 0.26, 0.26, 0.012)
    # a finished counterweight box waiting to be filled, and a stack of shot beside it
    cx, cy = 8.6, 1.6
    for sxx in (-1, 1):
        for syy in (-1, 1):
            box(oak, (cx + sxx * 0.9 - 0.1, cy + syy * 0.9 - 0.1, 0.0), (cx + sxx * 0.9 + 0.1, cy + syy * 0.9 + 0.1, 1.9), 0.01)
    for i in range(6):
        z0 = 0.05 + i * 0.3
        for syy in (-1, 1):
            box(oak2, (cx - 0.85, cy + syy * 0.95 - 0.03, z0), (cx + 0.85, cy + syy * 0.95 + 0.03, z0 + 0.28), 0.0)
        for sxx in (-1, 1):
            box(oak2, (cx + sxx * 0.95 - 0.03, cy - 0.85, z0), (cx + sxx * 0.95 + 0.03, cy + 0.85, z0 + 0.28), 0.0)
    for z in (0.3, 1.6):
        for syy in (-1, 1):
            box(iron, (cx - 1.02, cy + syy * 0.99 - 0.01, z), (cx + 1.02, cy + syy * 0.99 + 0.01, z + 0.08), 0.0)
    for (px, py) in ((6.9, 2.4), (7.3, 2.6), (7.0, 2.85), (7.15, 2.55)):
        S.stone_ball(stone, (px, py, 0.2 if px != 7.15 else 0.52), 0.2, 0.08)
elif B1:
    posts(keep=0.0)
    stakes_and_lines()
    sawpit(stage="dug")
    timber_stack(-10.6, -6.4, 4.5, rows=3)
    timber_stack(-3.2, -6.4, 3.5, rows=3, n0=4)
    timber_stack(3.0, 3.0, 5.5, rows=3, n0=5)
    timber_stack(-8.0, 2.0, 5.5, rows=2, n0=4, mat=fresh)
    half_engine(stage="sills")
    for p in ((-9.6, -1.5), (0.4, -1.4)):
        S.coil(rope, (p[0], p[1], 0.0), 0.4, 0.026, 4)
elif B2:
    posts()
    plates_and_trusses(trusses=range(0, NB + 1, 1), king=True)
    purlins_rafters(frac=0.5, xr=(X0, 1.0))
    back_wall(keep=0.45)
    K.scaffold_face((X1 + 0.4, YF, 0.0), (X1 + 0.4, YB, 0.0), (1, 0, 0), EZ + 2.2, standoff=0.9)
    K.ladder((XS[3], YF - 1.2, 0.0), (XS[3], YF - 0.25, EZ + 0.6), bt=oak2)
    sawpit()
    timber_stack(-10.6, -6.4, 4.5, rows=3)
    timber_stack(-3.2, -6.4, 3.5, rows=3, n0=4)
    timber_stack(3.0, -6.4, 5.5, rows=2, n0=5, mat=fresh)
    hewing_trestles(-1.6, -1.6)
    fence(keep=0.5)
else:
    # burnt out: most posts charred, roof fallen in at the east end, the rest sagging
    posts(keep=0.8, short=False)
    plates_and_trusses(trusses=(0, 1, 2), braces=False, king=True, ridge=False)
    beam(char, (X0 - 0.5, YR, RZ), (XS[2] + 0.3, YR, RZ - 0.1), 0.26, 0.24, 0.0)
    purlins_rafters(frac=0.45, xr=(X0, XS[2]))
    shingles(stop=lambda t: t < 0.55, xr=(X0 - 0.5, XS[2] - 0.6))
    back_wall(keep=0.35)
    for i in range(26):
        a = Vector((R.uniform(XS[2], X1), R.uniform(YF - 0.5, YB + 0.5), R.uniform(0.1, 1.6)))
        beam(char, a, a + Vector((jit(3.5), jit(2.0), R.uniform(-1.2, 1.2))), R.uniform(0.12, 0.3), R.uniform(0.12, 0.28), 0.0)
    for i in range(8):
        K.mound(K.B("ash"), R.uniform(-6, 10), R.uniform(0, 7), R.uniform(0.8, 1.8), R.uniform(0.6, 1.4), 0.12,
                rings=3, seg=12, rough=0.35)
    sawpit()
    half_engine()
    timber_stack(-10.6, -6.4, 4.5, rows=2, mat=char)
    fence(keep=0.5, broken=0.4)

if __name__ == "__main__":
    name = "siege_workshop" if FULL else "siege_workshop_" + STATE
    K.finalize(name, tex=2048)
