"""HIGHGROUND - archery butts (40 x 12 m footprint, as js/sim/econ-data.js BUILDINGS.archery_range).

Three turf butts (earth banks built of stacked turves, grassed on top) at the east end with coiled
straw target bosses pinned to their faces, a shooting line with a low post-and-rail at the west
end (arrows stuck in the ground before each archer's place, sheaves leaning on the rail), and a
bowyer's shed with a pent roof: stave rack, trestle of arrow bundles, arrow chest.

    blender -b -P assets/src/archery_range.py -- [complete|build1|build2|ruin]

Front (the long side) faces -Y; archers shoot toward +X. 1 unit = 1 m.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _kit_yards as K
from _kit_yards import B, beam, box, cyl, Face, jit, grid, R

STATE = K.state_from_argv()
K.init(STATE, seed=41)
FULL, RUIN, B1, B2 = K.FULL, K.RUIN, K.B1, K.B2

BUTT_X = 17.6               # butt centre line (x)
BUTTS_Y = (-3.9, 0.0, 3.9)
BW, BD, BH = 3.4, 1.9, 2.2   # butt width (y), depth (x) at base, height
LINE_X = -9.5               # shooting line (26 m to the butts)
SHED = (-19.7, -14.9, 1.9, 5.7)   # x0, x1, y0, y1
TGT_R = 0.62


def materials():
    ch = 0.9 if RUIN else 0.0
    K.std_materials(ch)
    K.MAT["turf"] = K.m_turf("turf", charred=0.85 if RUIN else 0.0, dry=0.5 if RUIN else 0.0)
    K.MAT["target"] = K.m_straw("target", [(0.0, "#8c7a4b"), (0.5, "#a89060"), (1.0, "#b8a06b")], rings=True,
                                halfth=0.09, rr=TGT_R, charred=ch)
    K.MAT["straw"] = K.m_straw("straw", [(0.0, "#8c7a4b"), (0.5, "#a89060"), (1.0, "#b59d69")])
    K.MAT["feather"] = K.m_feather("feather")


# ---------------------------------------------------------------- butts
def turf_butt(cx, cy, frac=1.0, slump=0.0):
    """a butt built of stacked turves in stepped courses (battered on all sides), grassed top.
    frac: fraction of the height built. slump: ruin - courses sag and scatter."""
    t_h = 0.15
    courses = int(BH / t_h)
    built = max(1, int(courses * frac))
    # hidden earth core (keeps the outer shell honest; culled where buried)
    for c in range(built):
        z = c * t_h
        k = c / courses
        hw = BW / 2 * (1 - 0.3 * k)               # half width (y)
        hd = BD / 2 * (1 - 0.62 * k)              # half depth (x): steep face toward the archers
        xs = 0.2 * k                              # the target face leans back (+x)
        sl = slump * (c / max(1, built)) ** 1.5
        # perimeter of turves: front (-x) face, back (+x) face, the two ends
        xb = cx + BD / 2 * (1.25 - 0.95 * k)      # the back is battered more gently
        runs = [((cx - hd + xs, cy - hw), (cx - hd + xs, cy + hw), (-1, 0)),
                ((xb, cy + hw), (xb, cy - hw), (1, 0)),
                ((cx - hd + xs, cy + hw), (xb, cy + hw), (0, 1)),
                ((xb, cy - hw), (cx - hd + xs, cy - hw), (0, -1))]
        for (a, b, nrm) in runs:
            a, b = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
            d = (b - a)
            Ln = d.length
            d.normalize()
            u = (c % 2) * 0.22
            first = True
            while u < Ln - 0.02:
                w = min(0.46 * R.uniform(0.85, 1.15), Ln - u)
                if first and u > 0:
                    w = u; u = 0.0
                first = False
                if w > 0.08:
                    ctr = a + d * (u + w / 2) - Vector(nrm + (0,)) * 0.15
                    ctr += Vector((jit(0.02), jit(0.02), 0))
                    zz = z + t_h / 2 - sl * 0.6 + jit(0.012)
                    ang = math.atan2(d.y, d.x) + jit(0.09)
                    if slump and R.random() < slump * 0.35:
                        continue
                    P, F = K.box_geo(w - 0.015, 0.34 * R.uniform(0.9, 1.1), t_h * R.uniform(0.85, 1.1))
                    P = [(p[0] + jit(0.03), p[1] + jit(0.03) - (0.03 if p[1] > 0 and p[2] > 0 else 0),
                          p[2] + (jit(0.025) if p[2] > 0 else 0)) for p in P]
                    M = Matrix.Translation((ctr.x, ctr.y, zz)) @ Matrix.Rotation(ang, 4, "Z") @ \
                        Matrix.Rotation(jit(0.04), 4, "X") @ Matrix.Rotation(jit(0.04) - sl * 0.3 * nrm[0], 4, "Y")
                    B("turf").add(P, F, M, None, P)
                u += w
    ztop = built * t_h
    k = built / courses
    hw = BW / 2 * (1 - 0.3 * k)
    hd = BD / 2 * (1 - 0.62 * k)
    # earth core so nothing reads hollow from above
    K.SOLIDS.append(((cx - hd + 0.4, cy - hw + 0.4, 0.0), (cx + 0.5, cy + hw - 0.4, ztop - 0.3)))
    xb = cx + BD / 2 * (1.25 - 0.95 * k)
    xf = cx - hd + 0.2 * k
    if frac < 1.0 and not slump:
        box(B("soil"), (xf + 0.25, cy - hw + 0.25, 0), (xb - 0.25, cy + hw - 0.25, ztop - 0.04))
    if not slump:
        K.mound(B("turf"), (xf + xb) / 2, cy, (xb - xf) / 2 + 0.02, hw + 0.02, 0.2 if frac >= 1 else 0.06, rings=3,
                seg=16, rough=0.08, z0=ztop - 0.12, flat=0.35, power=0.8)
    else:
        K.mound(B("turf"), (xf + xb) / 2, cy, (xb - xf) / 2 + 0.5, hw + 0.4, ztop * 0.55, rings=4, seg=18, rough=0.25,
                z0=0.0, flat=0.2, power=0.8)
    return ztop


def target(cx, cy, z, lean=0.3, burnt=False):
    """coiled straw boss pinned to the butt face, leaning back with the face."""
    n = Vector((-math.cos(lean), 0, math.sin(lean)))      # normal toward the archers
    c = Vector((cx, cy, z))
    th = 0.18
    K.lathe(B("target"), (0, 0, 0), [(TGT_R * 0.97, -th / 2), (TGT_R, -th / 2 + 0.03), (TGT_R, th / 2 - 0.03),
                                      (TGT_R * 0.96, th / 2), (0.0, th / 2)], seg=20, rough=0.015)
    # move the last lathe from origin to place: rebuild its verts in the batch
    bt = B("target")
    rot = Vector((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4()
    M = Matrix.Translation(c) @ rot
    nverts = 20 * 4 + 1
    for i in range(len(bt.V) - nverts, len(bt.V)):
        bt.V[i] = tuple(M @ Vector(bt.V[i]))
    # binding cords round the rim + pins
    for k in range(4):
        a = k * math.pi / 2 + 0.4
        q = M @ Vector((math.cos(a) * TGT_R * 0.98, math.sin(a) * TGT_R * 0.98, 0))
        K.tube(B("rope"), [q - (M.to_3x3() @ Vector((0, 0, 0.1))), q + (M.to_3x3() @ Vector((0, 0, 0.1)))], 0.012, sides=4)
    if burnt:
        return
    # arrows in the target and the butt around it
    for k in range(R.randint(4, 7)):
        rr = TGT_R * math.sqrt(R.random()) * 0.9
        a = R.uniform(0, 6.28)
        hit = M @ Vector((math.cos(a) * rr, math.sin(a) * rr, th / 2 - 0.12))
        d = Vector((1.0, jit(0.08), -0.08 + jit(0.06))).normalized()
        K.arrow(hit + d * 0.12, d)
    for k in range(R.randint(2, 4)):
        hit = Vector((cx - 0.05 + R.uniform(0, 0.3), cy + R.choice((-1, 1)) * R.uniform(0.75, 1.3),
                      R.uniform(0.3, 1.6)))
        d = Vector((1.0, jit(0.1), -0.1 + jit(0.08))).normalized()
        K.arrow(hit + d * 0.2, d)


def butts(stage):
    burnt = stage == "ruin"
    for i, y in enumerate(BUTTS_Y):
        if stage == "complete":
            zt = turf_butt(BUTT_X, y)
            target(BUTT_X - BD / 2 * 0.62 - 0.02 + 0.08, y + jit(0.1), 1.25 + jit(0.05))
            # short arrows in the grass before the butt
            for k in range(R.randint(1, 3)):
                p = Vector((BUTT_X - R.uniform(1.6, 5.0), y + R.uniform(-1.5, 1.5), 0.0))
                d = Vector((1.0, jit(0.1), -R.uniform(0.25, 0.5))).normalized()
                K.arrow(p + d * 0.2, d)
        elif stage == "build2":
            turf_butt(BUTT_X, y, frac=(0.55, 1.0, 0.3)[i])
        elif stage == "build1":
            if i == 0:
                turf_butt(BUTT_X, y, frac=0.18)
            # setting-out pegs at the corners of each butt
            for (dx, dy) in ((-BD / 2, -BW / 2), (BD / 2, -BW / 2), (BD / 2, BW / 2), (-BD / 2, BW / 2)):
                cyl(B("fresh"), (BUTT_X + dx, y + dy, 0), (BUTT_X + dx + jit(0.03), y + dy + jit(0.03), 0.6), 0.03, 0.02, n=5)
        else:
            turf_butt(BUTT_X, y, frac=(0.7, 0.85, 0.5)[i], slump=0.7)
            if i != 1:
                # fallen, scorched target at the foot of the butt
                target(BUTT_X - 1.6, y + jit(0.4), 0.1, lean=math.pi / 2 - 0.1, burnt=True)


def turf_stack(cx, cy, n=24, rot=0.0):
    """cut turves stacked grass-to-grass, ready to build the butts."""
    for i in range(n):
        layer = i // 6; k = i % 6
        x = (k % 3) * 0.48 - 0.48; y = (k // 3) * 0.36 - 0.18
        P, F = K.box_geo(0.44, 0.33, 0.13)
        P = [(p[0] + jit(0.012), p[1] + jit(0.012), p[2]) for p in P]
        flip = layer % 2
        M = Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(rot, 4, "Z") @ \
            Matrix.Translation((x + jit(0.03), y + jit(0.03), 0.07 + layer * 0.135)) @ \
            Matrix.Rotation(math.pi * flip, 4, "X") @ Matrix.Rotation(jit(0.06), 4, "Z")
        B("turf").add(P, F, M, None, P)


# ---------------------------------------------------------------- shooting line
def shooting_line(stage):
    burnt = stage == "ruin"
    y0, y1 = -5.6, 5.6
    if stage == "build1":
        for y in (y0, y1):
            cyl(B("fresh"), (LINE_X, y, 0), (LINE_X, y, 0.7), 0.03, 0.02, n=5)
        beam(B("rope"), (LINE_X, y0, 0.55), (LINE_X, y1, 0.55), 0.008, 0.008, 0.0)
        return
    keep = 0.6 if burnt else (0.5 if stage == "build2" else 1.0)
    K.fence((LINE_X, y0), (LINE_X, y1), step=2.25, rails=(0.78,), h=0.9, keep=keep,
            broken=0.4 if burnt else 0.0, rail_r=0.06)
    if stage != "complete":
        return
    # archers' places: arrows stuck point-down in the turf in front of the line, sheaves on the rail
    for k, y in enumerate(grid(y0 + 0.9, y1 - 0.9, 1.4, 0.1)):
        for j in range(R.randint(3, 5)):
            p = Vector((LINE_X + R.uniform(0.6, 1.0), y + jit(0.25), -0.12))
            d = Vector((jit(0.25), jit(0.25), -1.0)).normalized()
            K.arrow(p, d, fletch=True, head=False)
        if k % 3 == 1:
            K.arrow_sheaf((LINE_X - 0.25, y + 0.3, 0.02), (0.25, 0.05, 1.0))
        if k % 4 == 2:
            K.bow_stave((LINE_X - 0.12, y - 0.3, 0.0), (LINE_X - 0.02, y - 0.25, 1.85), bend=0.06, strung=True)
    # bench behind the line
    for (a, b) in (((LINE_X - 2.2, -2.5), (LINE_X - 2.2, 0.5)),):
        for t in (0.1, 0.9):
            p = Vector((a[0], a[1] + (b[1] - a[1]) * t, 0))
            for s in (-1, 1):
                beam(B("oak"), (p.x + s * 0.12, p.y, 0), (p.x + s * 0.05, p.y, 0.44), 0.05, 0.05, 0.005)
        beam(B("plank"), (a[0], a[1], 0.46), (b[0], b[1], 0.46), 0.3, 0.06, 0.008, side=(0, 0, 1))


# ---------------------------------------------------------------- bowyer's shed
def shed(stage):
    x0, x1, y0, y1 = SHED
    char = stage == "ruin"
    frame_only = stage == "build2"
    oak = B("oak") if not frame_only else B("fresh")
    hf, hb = 2.55, 2.05          # pent roof: high at the open front (-y), low at the back
    xs = [x0 + 0.1, (x0 + x1) / 2, x1 - 0.1]
    if stage == "build1":
        for x in xs:
            for y in (y0 + 0.1, y1 - 0.1):
                box(B("rubble"), (x - 0.2, y - 0.2, 0), (x + 0.2, y + 0.2, 0.2), 0.02, rot=(0, 0, jit(0.2)))
        K.timber_stack(x0, y0 - 1.6, 4.0, 3)
        return
    keep = 0.55 if char else 1.0
    for x in xs:
        for (y, h) in ((y0 + 0.1, hf), (y1 - 0.1, hb)):
            box(B("rubble"), (x - 0.2, y - 0.2, 0), (x + 0.2, y + 0.2, 0.2), 0.02, rot=(0, 0, jit(0.2)))
            if R.random() < keep:
                top = h if not char else R.uniform(0.6, h)
                beam(oak, (x, y, 0.2), (x + jit(0.02), y + jit(0.02), top), 0.18, 0.18, 0.012)
    if not char or R.random() < 0.5:
        beam(oak, (x0 - 0.25, y0 + 0.1, hf + 0.09), (x1 + 0.25, y0 + 0.1, hf + 0.09), 0.2, 0.2, 0.012)
    if not char:
        beam(oak, (x0 - 0.25, y1 - 0.1, hb + 0.09), (x1 + 0.25, y1 - 0.1, hb + 0.09), 0.2, 0.2, 0.012)
        for x in xs:
            for s in (-1, 1):
                if (x == xs[0] and s < 0) or (x == xs[-1] and s > 0):
                    continue
                beam(oak, (x + s * 0.08, y0 + 0.1, hf - 0.55), (x + s * 0.55, y0 + 0.1, hf), 0.11, 0.12, 0.01)
    # rafters + roof
    slope = (hf - hb) / (y1 - y0)
    for x in grid(x0 - 0.2, x1 + 0.2, 0.6, 0.02):
        if char and R.random() < 0.5:
            continue
        p0 = Vector((x, y0 - 0.45, hf + 0.2 + 0.45 * slope))
        p1 = Vector((x, y1 + 0.45, hb + 0.2 - 0.45 * slope))
        if char:
            p1 = p0.lerp(p1, R.uniform(0.3, 0.9)) + Vector((0, 0, -R.uniform(0.2, 0.9)))
        beam(oak, p0, p1, 0.08, 0.11, 0.008, side=(1, 0, 0))
    if stage == "complete":
        Mr = Matrix(((1, 0, 0, 0), (0, -1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))   # eave at the back (+y)
        K.roof_rows(B("shingle"), Mr, x0 - 0.35, x1 + 0.35, (-(y1 + 0.5), hb + 0.25 - 0.5 * slope),
                    (-(y0 - 0.5), hf + 0.3 + 0.5 * slope), row_w=0.3, thick=0.03, lift=0.03, sag=0.05, seg=6)
        # barge boards + a fascia on the front
        for x in (x0 - 0.37, x1 + 0.37):
            beam(B("plank"), (x, y0 - 0.55, hf + 0.3 + 0.55 * slope), (x, y1 + 0.55, hb + 0.2 - 0.55 * slope), 0.22, 0.04,
                 0.006, side=(1, 0, 0))
        beam(B("plank"), (x0 - 0.37, y0 - 0.52, hf + 0.3), (x1 + 0.37, y0 - 0.52, hf + 0.3), 0.2, 0.04, 0.006,
             side=(0, 1, 0))
    if frame_only:
        return
    # boarded back and ends
    fb = Face((x1, y1, 0), (0, 1, 0))
    K.plank_wall(fb, 0.0, x1 - x0, 0.18, hb + 0.05, d0=-0.05, keep=0.5 if char else 1.0, ragged=0.6 if char else 0)
    for (f, h0, h1) in ((Face((x0, y1, 0), (-1, 0, 0)), hb, hf), (Face((x1, y0, 0), (1, 0, 0)), hf, hb)):
        u = 0.0
        L_ = y1 - y0
        while u < L_ - 0.02:
            w = min(0.27 * R.uniform(0.85, 1.15), L_ - u)
            t = (u + w / 2) / L_
            top = (h0 + (h1 - h0) * t) + 0.12
            if f.n.x > 0:
                top = hf + (hb - hf) * t + 0.12
            else:
                top = hb + (hf - hb) * t + 0.12
            if not char or R.random() < 0.5:
                f.box(B("plank"), u + 0.004, u + w - 0.004, -0.05, -0.015, 0.18, top if not char else top * R.uniform(0.3, 0.9))
            u += w


def shed_contents(stage):
    x0, x1, y0, y1 = SHED
    if stage != "complete":
        return
    # stave rack against the back wall: two rails, staves leaning
    beam(B("oak"), (x0 + 0.3, y1 - 0.25, 1.6), (x0 + 2.4, y1 - 0.25, 1.6), 0.08, 0.08, 0.008)
    beam(B("oak"), (x0 + 0.3, y1 - 0.45, 0.25), (x0 + 2.4, y1 - 0.45, 0.25), 0.08, 0.08, 0.008)
    for k in range(9):
        x = x0 + 0.4 + k * 0.24 + jit(0.03)
        K.bow_stave((x, y1 - 0.6, 0.02), (x + jit(0.05), y1 - 0.2, 1.92), bend=0.015, strung=(k % 3 == 0))
    # trestle table of arrow sheaves + an arrow chest
    tx, ty = x0 + 3.4, y0 + 1.1
    for x in (tx - 0.6, tx + 0.6):
        for s in (-1, 1):
            beam(B("oak"), (x + s * 0.1, ty - 0.25, 0), (x, ty - 0.25, 0.78), 0.05, 0.05, 0.005)
            beam(B("oak"), (x + s * 0.1, ty + 0.25, 0), (x, ty + 0.25, 0.78), 0.05, 0.05, 0.005)
    for k in range(3):
        yy = ty - 0.27 + k * 0.18
        beam(B("plank"), (tx - 0.85, yy, 0.8), (tx + 0.85, yy, 0.8), 0.17, 0.04, 0.005, side=(0, 0, 1))
    for k in range(5):
        a = Vector((tx - 0.7 + k * 0.3 + jit(0.03), ty + jit(0.1), 0.86))
        K.arrow_sheaf(a, (1.0, jit(0.1), 0.02))
    # arrow chest
    cx, cy = x1 - 0.9, y1 - 0.8
    box(B("plank"), (cx - 0.5, cy - 0.3, 0.05), (cx + 0.5, cy + 0.3, 0.55), 0.01)
    box(B("iron"), (cx - 0.52, cy - 0.32, 0.4), (cx + 0.52, cy + 0.32, 0.45))
    box(B("plank"), (cx - 0.52, cy - 0.32, 0.55), (cx + 0.52, cy + 0.32, 0.6), 0.01, rot=(0.0, 0, 0))
    K.barrel((x1 - 0.5, y0 + 0.5, 0), 0.28, 0.75)
    for k in range(12):
        a = Vector((x1 - 0.5 + jit(0.13), y0 + 0.5 + jit(0.13), 0.35))
        tip = a + Vector((jit(0.14), jit(0.14), 0.76))
        K.arrow(tip, tip - a, head=False, fletch=(k % 2 == 0))


# ---------------------------------------------------------------- states
def main():
    materials()
    butts(STATE)
    shooting_line(STATE)
    shed(STATE)
    shed_contents(STATE)
    if B1:
        turf_stack(12.5, -4.2, 24, rot=0.2)
        turf_stack(13.2, 2.5, 18, rot=-0.3)
        K.barrow(14.0, -1.5, rot=0.5, load="turf")
        # a flat-bladed turf spade stuck in the ground
        K.tube(B("oak"), [(14.8, -2.6, 0.2), (14.9, -2.5, 1.1)], 0.02, sides=5)
        box(B("iron"), (14.7, -2.66, -0.1), (14.95, -2.62, 0.22))
    if B2:
        turf_stack(13.0, -1.2, 12, rot=0.1)
        K.barrow(14.2, 2.0, rot=-0.4, load="turf")
        K.ladder((SHED[0] + 2.0, SHED[2] - 1.0, 0), (SHED[0] + 2.0, SHED[2] - 0.2, 2.7))
    if RUIN:
        K.rubble_heap((SHED[0] + SHED[1]) / 2, (SHED[2] + SHED[3]) / 2, 1.8, 1.3, 0.3, 18, "ash")
        for i in range(5):
            x = R.uniform(SHED[0], SHED[1]); y = R.uniform(SHED[2], SHED[3])
            a = R.uniform(0, 3.14)
            beam(B("char"), (x, y, 0.1), (x + math.cos(a) * 2, y + math.sin(a) * 2, R.uniform(0.1, 0.7)), 0.14, 0.16, 0.01)
        K.mound(B("ash"), LINE_X + 1.5, 1.0, 1.2, 0.8, 0.12, rings=3, seg=12)
    name = "archery_range" if FULL else "archery_range_" + STATE
    K.finalize(name, tex=2048 if FULL else 1024)


main()
