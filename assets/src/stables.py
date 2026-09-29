"""HIGHGROUND - stables (18 x 12 m footprint).

A long timber-framed stable range on rubble-stone footings: four stalls behind two-leaf stable
doors, a tack room at the east end, a thatched roof with a pitching-eye dormer and a gable loft
door with a hoist beam. In the yard: a hay rick, a muck heap in a plank bay, a stone water
trough and a small post-and-rail paddock.

    blender -b -P assets/src/stables.py -- [complete|build1|build2|ruin]

Front faces -Y. 1 unit = 1 m.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _kit_yards as K
from _kit_yards import B, beam, box, cyl, Face, jit, grid, R

STATE = K.state_from_argv()
K.init(STATE, seed=23)
FULL, RUIN, B1, B2 = K.FULL, K.RUIN, K.B1, K.B2

# ---------------------------------------------------------------- layout
X0, X1 = -8.6, 3.4          # range ends
Y0, Y1 = -0.2, 5.2          # front / back wall line
LEN, DEP = X1 - X0, Y1 - Y0
FOOT = 0.75                 # footing wall height
SILL = FOOT + 0.2
PLATE = 3.1
PITCH = math.radians(50)
OVER = 0.55                 # eave overhang
RY = (Y0 + Y1) / 2
RAF = PLATE + 0.1           # rafter seat
RZ = RAF + (DEP / 2) * math.tan(PITCH)
EAVE = (Y0 - OVER, RAF - OVER * math.tan(PITCH))
BAY = 2.4
DOORS = [BAY * i + BAY / 2 for i in range(4)]    # stall door centres (u)
DW = 1.15
TACK_U = 4 * BAY           # tack room from here to LEN
DORM_U = 2 * BAY           # dormer centre (u)
DORM_W = 1.8
DPLATE = 4.45
PAD = (4.3, 8.8, -2.6, 5.9)  # paddock x0, x1, y0, y1

ff = Face((X0, Y0, 0), (0, -1, 0))     # front, u = x - X0
fb = Face((X1, Y1, 0), (0, 1, 0))      # back, u = X1 - x
fe = Face((X1, Y0, 0), (1, 0, 0))      # east gable, u = y - Y0
fw = Face((X0, Y1, 0), (-1, 0, 0))     # west gable, u = Y1 - y


def materials():
    ch = 0.9 if RUIN else 0.0
    K.std_materials(ch)
    K.MAT["hay"] = K.m_hay("hay", charred=0.85 if RUIN else 0.0, rot_top=0.8)
    K.MAT["muck"] = K.m_muck("muck")
    K.MAT["water"] = K.m_water("water")
    K.MAT["straw"] = K.m_straw("straw", [(0.0, "#8c7a4b"), (0.5, "#a89060"), (1.0, "#b59d69")])
    K.MAT["wicker"] = K.m_wicker("wicker")


# ---------------------------------------------------------------- walls
def footing(f, length, gaps=(), top=FOOT, keep=1.0):
    """rubble dwarf wall under the frame, broken at door openings; stone thresholds in the gaps."""
    segs = [(-0.05, length + 0.05)]
    for (a, b) in gaps:
        new = []
        for (s0, s1) in segs:
            if s1 <= a or s0 >= b:
                new.append((s0, s1)); continue
            if s0 < a: new.append((s0, a))
            if s1 > b: new.append((b, s1))
        segs = new
    for (s0, s1) in segs:
        t = top if keep >= 1 else top * R.uniform(0.35, 1.0)
        f.box(B("rubble"), s0, s1, -0.06, 0.46, 0.0, t, 0.02)
        # rough coping stones
        u = s0
        while u < s1 - 0.1 and keep >= 1:
            w = min(R.uniform(0.35, 0.6), s1 - u)
            f.box(B("rubble"), u + 0.01, u + w - 0.01, -0.08 + jit(0.01), 0.44, t - 0.02, t + 0.05 + jit(0.015), 0.02,
                  tilt=jit(0.02))
            u += w
    for (a, b) in gaps:
        f.box(B("ashlar"), a - 0.02, b + 0.02, -0.18, 0.4, 0.0, 0.1, 0.02)


def gable_boards(f, length, z0, apex, keep=1.0):
    """vertical boarding filling the gable triangle above the tie beam."""
    u = 0.0
    while u < length - 0.02:
        w = min(0.27 * R.uniform(0.85, 1.15), length - u)
        uc = u + w / 2
        top = z0 + (apex - z0) * (1 - abs(uc - length / 2) / (length / 2)) + 0.25
        if R.random() < keep:
            f.box(B("plank"), u + 0.004, u + w - 0.004, 0.03 + jit(0.004), 0.065, z0 - 0.02, top + jit(0.03), 0.005)
        u += w
    # principal rafters, collar and king post on the gable face
    oak = B("oak")
    f.timber(oak, 0.05, z0, length / 2, apex - 0.05, 0.2, 0.18, -0.02)
    f.timber(oak, length - 0.05, z0, length / 2, apex - 0.05, 0.2, 0.18, -0.02)
    cz = z0 + (apex - z0) * 0.55
    hw = length / 2 * 0.45
    f.timber(oak, length / 2 - hw, cz, length / 2 + hw, cz, 0.18, 0.16, -0.015)


def front_wall(stage):
    oak = B("oak")
    gaps = [(c - DW / 2 - 0.1, c + DW / 2 + 0.1) for c in DOORS] + [(TACK_U + 0.3, TACK_U + 1.25)]
    footing(ff, LEN, gaps)
    char = stage == "burnt"
    keep = 0.55 if char else 1.0
    kept = lambda: R.random() < keep
    ctop = lambda a, b: (a + (b - a) * R.uniform(0.3, 1.0)) if char else b
    # sill beams between the openings
    for (a, b) in [(-0.1, gaps[0][0])] + [(gaps[i][1], gaps[i + 1][0]) for i in range(len(gaps) - 1)] + \
                  [(gaps[-1][1], LEN + 0.1)]:
        if b - a > 0.1 and kept():
            ff.timber(oak, a, FOOT + 0.1, b, FOOT + 0.1, 0.2, 0.22, -0.01)
    # principal posts at the bay lines + corner posts
    posts = [0.1] + [BAY * i for i in range(1, 5)] + [LEN - 0.1]
    for u in posts:
        if kept():
            ff.timber(oak, u, SILL - 0.02, u, ctop(SILL, PLATE), 0.24, 0.22, -0.02)
    # door jambs, head rail
    for c in DOORS:
        for s in (-1, 1):
            if kept():
                ff.timber(oak, c + s * (DW / 2 + 0.07), 0.1, c + s * (DW / 2 + 0.07), ctop(0.1, 2.3), 0.14, 0.2, -0.01)
    u = -0.1
    while u < TACK_U - 0.05:
        l = min(R.uniform(2.8, 4.0), TACK_U + 0.1 - u)
        if kept():
            ff.timber(oak, u, 2.28, u + l, 2.28, 0.18, 0.2, -0.015)
        u += l
    if stage != "frame":
        # plate
        u = -0.2
        while u < LEN + 0.15:
            l = min(R.uniform(3.6, 5.0), LEN + 0.2 - u)
            if kept():
                ff.timber(oak, u, PLATE, u + l, PLATE + jit(0.01), 0.22, 0.24, -0.03)
            u += l
    else:
        ff.timber(oak, -0.2, PLATE, LEN + 0.2, PLATE, 0.22, 0.24, -0.03)
    if stage == "frame":
        # bare frame: a couple of braces only
        for u in posts[1:-1]:
            ff.timber(oak, u + 0.12, 2.45, u + 0.75, PLATE - 0.12, 0.14, 0.14, 0.0)
        return
    # boards beside the doors (below the head rail) + daub panels above
    edges = [0.22] + sum([[c - DW / 2 - 0.14, c + DW / 2 + 0.14] for c in DOORS], []) + [TACK_U - 0.12]
    for i in range(0, len(edges), 2):
        a, b = edges[i], edges[i + 1]
        # skip the principal post in the middle of the panel
        for (pa, pb) in _split(a, b, posts):
            K.plank_wall(ff, pa, pb, SILL, 2.2, d0=0.05, keep=0.5 if char else 1.0, ragged=0.5 if char else 0.0)
    for bi in range(4):
        fu = Face(ff.p(bi * BAY, 0, 0), ff.n)
        if bi * BAY < DORM_U < (bi + 1) * BAY or abs(bi * BAY - DORM_U) < 0.01:
            pass
        studs = [0.12] + [x for x in grid(0.12, BAY - 0.12, 0.55)[1:-1]] + [BAY - 0.12]
        K.frame_face(fu, BAY, 2.37, PLATE - 0.1, studs, [], [], braces=[(0.2, 2.42, 0.8, PLATE - 0.14)],
                     stud=0.13, char=char, keep_frac=keep, slab=not char)
    # stall doors
    for k, c in enumerate(DOORS):
        if char:
            if R.random() < 0.5:
                K.stable_door(ff, c - DW / 2, c + DW / 2, 0.1, 2.2, 0.02, open_all=True)
            else:
                ff.box(B("dark"), c - DW / 2 - 0.02, c + DW / 2 + 0.02, 0.25, 0.3, 0.1, 2.2)
            continue
        K.stable_door(ff, c - DW / 2, c + DW / 2, 0.1, 2.2, 0.02, open_top=(k in (1, 3)), open_all=False)
    # tack room: framed + daubed, plank door, shuttered window
    ft = Face(ff.p(TACK_U, 0, 0), ff.n)
    tl = LEN - TACK_U
    ops = [(0.3, 1.25, 0.1, 2.1, "door"), (1.55, 2.15, 1.35, 2.05, "win")]
    if char:
        ops = [(0.3, 1.25, 0.1, 2.1, "none"), (1.55, 2.15, 1.35, 2.05, "none")]
    K.frame_face(ft, tl, SILL, PLATE - 0.1, [0.1, 0.2, 1.35, 1.45, 2.25, tl - 0.12], [1.3, 2.28], ops,
                 braces=[(1.5, SILL + 0.1, 2.2, 1.28)], char=char, keep_frac=keep, slab=not char)


def _split(a, b, posts):
    cur = [(a, b)]
    for p in posts:
        new = []
        for (s0, s1) in cur:
            if s0 < p < s1:
                new += [(s0, p - 0.13), (p + 0.13, s1)]
            else:
                new.append((s0, s1))
        cur = new
    return [(s0, s1) for (s0, s1) in cur if s1 - s0 > 0.08]


def back_wall(stage):
    char = stage == "burnt"
    keep = 0.5 if char else 1.0
    footing(fb, LEN)
    oak = B("oak")
    ff_ = fb
    ff_.timber(oak, -0.1, FOOT + 0.1, LEN + 0.1, FOOT + 0.1, 0.2, 0.22, -0.01)
    posts = [0.1] + [BAY * i for i in range(1, 5)] + [LEN - 0.1]
    for u in posts:
        if R.random() < keep:
            top = PLATE if not char else R.uniform(1.2, PLATE)
            ff_.timber(oak, u, SILL, u, top, 0.24, 0.22, -0.02)
    if not char:
        ff_.timber(oak, -0.2, PLATE, LEN + 0.2, PLATE, 0.22, 0.24, -0.03)
    if stage == "frame":
        ff_.timber(oak, -0.1, 2.0, LEN + 0.1, 2.0, 0.18, 0.18, -0.01)
        return
    for (pa, pb) in _split(0.22, LEN - 0.22, posts):
        K.plank_wall(ff_, pa, pb, SILL, PLATE - 0.1, d0=0.05, keep=keep, ragged=0.6 if char else 0.0)


def end_walls(stage):
    char = stage == "burnt"
    keep = 0.55 if char else 1.0
    oak = B("oak")
    apex = RZ - 0.05
    for f, east in ((fe, True), (fw, False)):
        footing(f, DEP)
        f.timber(oak, -0.1, FOOT + 0.1, DEP + 0.1, FOOT + 0.1, 0.2, 0.22, -0.01)
        if stage == "frame":
            for u in grid(0.1, DEP - 0.1, 1.8):
                f.timber(oak, u, SILL, u, PLATE, 0.22, 0.2, -0.02)
            f.timber(oak, -0.2, PLATE + 0.02, DEP + 0.2, PLATE + 0.02, 0.22, 0.24, -0.03)
            gable_boards(f, DEP, PLATE + 0.14, apex, keep=0.0)
            continue
        if east:
            ops = [(3.3, 4.1, 1.4, 2.1, "win")] if not char else []
            K.frame_face(f, DEP, SILL, PLATE, [0.12, 1.4, 2.8, 4.2, DEP - 0.12], [1.9, PLATE + 0.02], ops,
                         braces=[(0.2, SILL + 0.1, 1.3, 1.85), (DEP - 0.2, SILL + 0.1, DEP - 1.3, 1.85)],
                         char=char, keep_frac=keep, slab=not char)
        else:
            for u in (0.1, 1.8, 3.6, DEP - 0.1):
                if R.random() < keep:
                    f.timber(oak, u, SILL, u, PLATE if not char else R.uniform(1.0, PLATE), 0.22, 0.2, -0.02)
            if not char:
                f.timber(oak, -0.2, PLATE + 0.02, DEP + 0.2, PLATE + 0.02, 0.22, 0.24, -0.03)
            for (pa, pb) in _split(0.2, DEP - 0.2, [1.8, 3.6]):
                K.plank_wall(f, pa, pb, SILL, PLATE - 0.1, d0=0.05, keep=keep, ragged=0.6 if char else 0.0)
        if char:
            continue
        gable_boards(f, DEP, PLATE + 0.14, apex)
        if east:
            # loft door + hoist beam with pulley and rope
            u0, u1, v0, v1 = DEP / 2 - 0.55, DEP / 2 + 0.55, PLATE + 0.35, PLATE + 1.45
            f.box(B("dark"), u0 - 0.02, u1 + 0.02, 0.1, 0.14, v0, v1)
            f.timber(oak, u0 - 0.08, v0 - 0.08, u0 - 0.08, v1 + 0.1, 0.13, 0.14, -0.04)
            f.timber(oak, u1 + 0.08, v0 - 0.08, u1 + 0.08, v1 + 0.1, 0.13, 0.14, -0.04)
            f.timber(oak, u0 - 0.2, v1 + 0.1, u1 + 0.2, v1 + 0.1, 0.15, 0.16, -0.045)
            f.timber(oak, u0 - 0.2, v0 - 0.1, u1 + 0.2, v0 - 0.1, 0.14, 0.18, -0.06)
            # right leaf open against the boards, left leaf shut
            f.box(B("plank"), u0 + 0.01, (u0 + u1) / 2, 0.0, 0.05, v0 + 0.02, v1 - 0.02, 0.005)
            for vv in (v0 + 0.15, v1 - 0.2):
                f.box(B("iron"), u0 - 0.02, u0 + 0.4, -0.015, 0.0, vv, vv + 0.05)
            f.box(B("plank"), u1 + 0.18, u1 + 0.73, -0.1, -0.06, v0 + 0.02, v1 - 0.02, 0.005)
            hb0 = f.p(DEP / 2, 0.8, v1 + 0.55)
            hb1 = f.p(DEP / 2, -1.0, v1 + 0.55)
            beam(oak, hb0, hb1, 0.18, 0.2, 0.015)
            beam(oak, f.p(DEP / 2, -0.02, v1 + 0.2), f.p(DEP / 2, -0.55, v1 + 0.47), 0.1, 0.1, 0.01, side=(0, 0, 1))
            pc = f.p(DEP / 2, -0.85, v1 + 0.34)
            cyl(B("plank"), pc - f.al * 0.03, pc + f.al * 0.03, 0.12, n=10)
            rope_bot = f.p(DEP / 2 - 0.06, -0.97, 1.3)
            K.tube(B("rope"), [f.p(DEP / 2 - 0.06, -0.97, v1 + 0.34), rope_bot], 0.012, sides=4)
            K.tube(B("rope"), [f.p(DEP / 2 + 0.06, -0.73, v1 + 0.34), f.p(DEP / 2 + 0.3, -0.35, 0.95),
                               f.p(DEP / 2 + 0.5, -0.1, 0.9)], 0.012, sides=4)
            K.tube(B("iron"), [rope_bot, rope_bot + Vector((0, 0, -0.12)), rope_bot + Vector((0.04, 0, -0.17)),
                               rope_bot + Vector((0.07, 0, -0.1))], 0.01, sides=4)


# ---------------------------------------------------------------- roof
def dormer_bits(stage):
    """pitching-eye dormer on the front: framed front, two-leaf loft door, thatched gablet."""
    oak = B("oak")
    xd = X0 + DORM_U
    u0, u1 = DORM_U - DORM_W / 2, DORM_U + DORM_W / 2
    for u in (u0 + 0.08, u1 - 0.08):
        ff.timber(oak, u, PLATE + 0.1, u, DPLATE, 0.18, 0.2, -0.02)
    ff.timber(oak, u0 - 0.1, DPLATE, u1 + 0.1, DPLATE, 0.2, 0.22, -0.03)
    apex = DPLATE + (DORM_W / 2) * math.tan(PITCH)
    fd = Face(ff.p(u0, 0, 0), ff.n)
    gable_boards(fd, DORM_W, DPLATE + 0.12, apex, keep=0.0 if stage == "frame" else 1.0)
    # cheeks: boarding from the dormer plate down to the main rafters
    for s in (-1, 1):
        x = xd + s * (DORM_W / 2 - 0.02)
        y = Y0
        while y < Y0 + 1.6:
            zb = RAF + (y - Y0) * math.tan(PITCH)
            if zb < DPLATE and stage != "frame":
                box(B("plank"), (x - 0.02, y + 0.004, zb - 0.1), (x + 0.02, y + 0.26, DPLATE + 0.05), 0.004)
            y += 0.27
        beam(oak, (x, Y0 - 0.1, DPLATE + 0.02), (x, Y0 + 1.6, DPLATE + 0.02), 0.16, 0.16, 0.012)
    v0, v1 = PLATE + 0.22, DPLATE - 0.12
    if stage == "frame":
        return
    ff.box(B("dark"), u0 + 0.2, u1 - 0.2, 0.3, 0.34, v0, v1)
    lw = (u1 - u0 - 0.4) / 2
    # left leaf closed, right leaf swung out
    for k in range(3):
        a = u0 + 0.2 + k * lw / 3
        ff.box(B("plank"), a + 0.004, a + lw / 3 - 0.004, 0.04, 0.08, v0 + 0.02, v1 - 0.02, 0.005)
    ff.box(B("plank"), u0 + 0.24, u0 + 0.2 + lw - 0.04, 0.0, 0.04, v0 + 0.2, v0 + 0.32, 0.005)
    hinge = ff.p(u1 - 0.2, 0.02, 0)
    ang = math.radians(115)
    dd = -ff.al * math.cos(ang) - ff.inw * math.sin(ang)
    for k in range(3):
        q0 = hinge - dd * (k * lw / 3 + 0.004)
        q1 = hinge - dd * ((k + 1) * lw / 3 - 0.004)
        c = (q0 + q1) / 2
        beam(B("plank"), Vector((c.x, c.y, v0 + 0.02)), Vector((c.x, c.y, v1 - 0.02)), lw / 3 - 0.008, 0.035,
             0.005, side=Vector((0, 0, 1)).cross(dd))
    # hoist beam out of the dormer apex
    beam(oak, (xd, Y0 + 0.6, apex - 0.3), (xd, Y0 - 1.1, apex - 0.3), 0.17, 0.19, 0.015)
    pc = Vector((xd, Y0 - 0.95, apex - 0.48))
    cyl(B("plank"), pc - Vector((0.03, 0, 0)), pc + Vector((0.03, 0, 0)), 0.11, n=10)
    K.tube(B("rope"), [pc + Vector((0, -0.11, 0)), Vector((xd + 0.02, Y0 - 1.06, 1.6)),
                       Vector((xd + 0.03, Y0 - 1.04, 1.35))], 0.011, sides=4)
    K.tube(B("rope"), [pc + Vector((0, 0.11, 0)), Vector((xd + 0.1, Y0 - 0.55, 2.3)),
                       Vector((xd + 0.2, Y0 - 0.3, 1.2)), Vector((xd + 0.4, Y0 - 0.2, 1.1))], 0.011, sides=4)


def roof(stage):
    xd = X0 + DORM_U
    apex = DPLATE + (DORM_W / 2) * math.tan(PITCH)
    dn, n, Ls = K.slope_frame(EAVE, (RY, RZ), 0.32)
    row_w = 0.9
    zskip = apex + 0.05
    tm = max(0.0, ((zskip - EAVE[1]) / dn.z - row_w) / (Ls - row_w))
    if stage == "complete":
        K.thatch_roof(X0, X1, EAVE, (RY, RZ), thick=0.36, sag=0.14, seg=26,
                      gaps=[(xd - DORM_W / 2 - 0.02, xd + DORM_W / 2 + 0.02, tm)])
        # dormer gablet thatch: local x runs along world +y
        Md = Matrix.Translation((xd, 0, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Z")
        dover = 0.38
        d_eave = (-(DORM_W / 2 + dover), DPLATE + 0.1 - dover * math.tan(PITCH))
        d_ridge = (0.0, DPLATE + 0.1 + (DORM_W / 2) * math.tan(PITCH))
        # back end buried where the main thatch climbs past the dormer ridge
        yb = Y0 + (d_ridge[1] + 0.4 - RAF) / math.tan(PITCH)
        K.thatch_roof(Y0 - 0.3, yb, d_eave, d_ridge, M=Md, thick=0.28, sag=0.03, seg=5, verge=0.12,
                      apron=False, row_w=0.8)
    elif stage == "partial":
        # build2: the thatchers have laid the lower coats on the west half
        K.thatch_roof(X0, X0 + 5.2, EAVE, (RY, RZ), thick=0.34, sag=0.1, seg=6,
                      stop=lambda t: t < 0.38, ridge_cap=False, verges=False)


def rafters(stage):
    """exposed roof carcass: couples every 0.55 m, ridge piece, collars at the bays."""
    oak = B("oak") if stage != "frame" else B("fresh")
    xs = grid(X0 + 0.05, X1 - 0.05, 0.55, 0.02)
    tz = math.tan(PITCH)
    for x in xs:
        if stage == "burnt" and R.random() < 0.45:
            continue
        for sgn in (1, -1):
            if stage == "burnt" and R.random() < 0.3:
                continue
            ye = RY - sgn * (DEP / 2 + OVER * 0.5)
            p0 = Vector((x, ye, RAF - OVER * 0.5 * tz))
            p1 = Vector((x, RY, RZ - 0.05))
            if stage == "burnt":
                p1 = p0.lerp(p1 + Vector((jit(0.3), 0, -R.uniform(0, 1.2))), R.uniform(0.35, 0.95))
            beam(oak, p0, p1, 0.1, 0.13, 0.01, side=(1, 0, 0))
    if stage != "burnt":
        beam(oak, (X0 - 0.2, RY, RZ + 0.02), (X1 + 0.2, RY, RZ + 0.02), 0.2, 0.08, 0.01, side=(0, 1, 0))
        for yy in (Y0 + 1.1, Y1 - 1.1):
            zz = RAF + (min(yy - Y0, Y1 - yy)) * tz + 0.1
            beam(oak, (X0 - 0.1, yy, zz), (X1 + 0.1, yy, zz), 0.16, 0.16, 0.01, side=(0, 0, 1))
    for i in range(1, 5):
        x = X0 + BAY * i
        if stage == "burnt" and R.random() < 0.5:
            continue
        beam(oak, (x, Y0 - 0.1, PLATE + 0.08), (x, Y1 + 0.1, PLATE + 0.08), 0.22, 0.24, 0.015)
        cz = RAF + 1.9 * tz
        beam(oak, (x, RY - (RZ - cz) / tz, cz), (x, RY + (RZ - cz) / tz, cz), 0.16, 0.16, 0.012)
        if stage == "frame":
            beam(oak, (x, RY, PLATE + 0.2), (x, RY, cz), 0.16, 0.16, 0.012)


# ---------------------------------------------------------------- yard
def hay_rick(cx, cy, r=1.35, burnt=False):
    if burnt:
        K.mound(B("hay"), cx, cy, r * 1.35, r * 1.25, 0.4, rings=5, seg=18, rough=0.15, power=0.8)
        K.mound(B("ash"), cx + 0.3, cy - 0.2, r * 1.1, r * 0.9, 0.5, rings=4, seg=14, rough=0.2)
        for k in range(4):
            a = k * 1.57 + 0.3
            box(B("rubble"), (cx + math.cos(a) * r * 0.7 - 0.13, cy + math.sin(a) * r * 0.7 - 0.13, 0),
                (cx + math.cos(a) * r * 0.7 + 0.13, cy + math.sin(a) * r * 0.7 + 0.13, 0.28), 0.03)
        return
    # staddle of stones + timber bed
    for k in range(6):
        a = k * math.pi / 3 + 0.2
        box(B("rubble"), (cx + math.cos(a) * r * 0.7 - 0.13, cy + math.sin(a) * r * 0.7 - 0.13, 0),
            (cx + math.cos(a) * r * 0.7 + 0.13, cy + math.sin(a) * r * 0.7 + 0.13, 0.28), 0.03,
            rot=(0, 0, R.uniform(0, 1)))
    K.lathe(B("hay"), (cx, cy, 0.22), [(r * 0.92, 0.0), (r * 0.98, 0.3), (r * 1.03, 0.9), (r * 1.08, 1.5),
                                        (r * 1.12, 1.85), (r * 1.05, 2.0)], seg=22, rough=0.07)
    # thatched cap roped down with weighted ropes
    K.lathe(B("thatch"), (cx, cy, 0.22), [(r * 1.22, 1.85), (r * 1.2, 1.95), (r * 0.85, 2.5), (r * 0.45, 3.0),
                                           (r * 0.12, 3.35), (0.0, 3.42)], seg=18, rough=0.04)
    K.lathe(B("thatch"), (cx, cy, 0.22), [(0.14, 3.3), (0.1, 3.55), (0.03, 3.68), (0.0, 3.7)], seg=8)
    for k in range(6):
        a = k * math.pi / 3 + 0.5
        pts = []
        for t in (0.0, 0.3, 0.6, 0.85, 1.0):
            rr = r * (0.12 + (1.25 - 0.12) * t)
            zz = 0.22 + 3.35 - (3.35 - 1.85) * t + 0.05
            if t == 1.0:
                rr = r * 1.18; zz = 1.3
            pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr, zz))
        K.tube(B("rope"), pts, 0.012, sides=4)
        e = Vector(pts[-1])
        cyl(B("rubble"), e + Vector((0, 0, -0.18)), e + Vector((0, 0, -0.02)), 0.09, n=6)
    # a cut face where hay has been taken + ladder
    K.ladder((cx + r * 0.3, cy - r * 1.4, 0.0), (cx + r * 0.25, cy - r * 0.95, 2.35))


def muck_bay(cx, cy):
    w, d = 3.0, 2.2
    # three low plank walls on stakes
    for (a, b) in (((cx - w / 2, cy + d / 2), (cx + w / 2, cy + d / 2)), ((cx - w / 2, cy - d / 2), (cx - w / 2, cy + d / 2)),
                   ((cx + w / 2, cy - d / 2), (cx + w / 2, cy + d / 2))):
        a3, b3 = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
        dd = (b3 - a3).normalized()
        n = Vector((dd.y, -dd.x, 0))
        for p in (a3, b3, (a3 + b3) / 2):
            K.post(B("oak"), p.x, p.y, 1.05, 0.12, 0.11)
        for k in range(4):
            z = 0.12 + k * 0.23
            beam(B("plank"), a3 + Vector((0, 0, z)) + n * 0.08, b3 + Vector((0, 0, z + jit(0.02))) + n * 0.08,
                 0.22, 0.035, 0.005, side=n)
    K.mound(B("muck"), cx, cy + 0.2, w * 0.5, d * 0.5, 0.85, rings=6, seg=20, rough=0.06, power=0.6, flat=0.35)
    for k in range(14):
        a = R.uniform(0, 6.28); rr = math.sqrt(R.random()) * 0.85
        px, py = cx + 0.1 + math.cos(a) * rr * w * 0.42, cy + 0.15 + math.sin(a) * rr * d * 0.42
        zb = 0.7 * max(0.0, 1 - rr * rr) ** 0.9 - 0.12
        zb = 0.72 if rr < 0.6 else 0.72 * (1 - (rr - 0.6) / 0.4) ** 0.6 - 0.05
        K.mound(B("muck" if k % 3 else "straw"), px, py, R.uniform(0.25, 0.45), R.uniform(0.2, 0.35), R.uniform(0.06, 0.12),
                rings=2, seg=8, rough=0.3, z0=zb, rot=R.uniform(0, 3))
    K.mound(B("muck"), cx + 0.5, cy - 1.0, 0.8, 0.45, 0.18, rings=3, seg=12, rough=0.1)
    K.pitchfork((cx + 0.9, cy - 1.3, 0.2), (cx - 0.3, cy - 0.2, 1.0))
    K.barrow(cx - 1.9, cy - 1.0, rot=0.5, load="muck")


def yard(stage):
    burnt = stage == "burnt"
    # paddock
    x0, x1, y0, y1 = PAD
    keep = 0.7 if burnt else 1.0
    brk = 0.25 if burnt else 0.0
    K.fence((x0, y0), (x1, y0), step=2.25, gap=(0.1, 0.45), keep=keep, broken=brk)
    K.fence((x1, y0), (x1, y1), step=2.7, keep=keep, broken=brk, first_post=False)
    K.fence((x1, y1), (x0, y1), step=2.25, keep=keep, broken=brk, first_post=False)
    K.fence((x0, y1), (x0, y0), step=2.7, keep=keep, broken=brk, first_post=False, last_post=False)
    gp0 = (x0 + 0.02, y0); gp1 = (x0 + 0.02 + 2.25 * 0.9, y0)
    K.post(B("oak"), x0 + 2.25 * 0.9 + 0.1, y0, 1.4, 0.2, 0.2)
    K.gate(gp0, (x0 + 2.25 * 0.9, y0), open_ang=math.radians(-65 if not burnt else -20))
    # stone water trough straddling the paddock fence, buckets
    K.trough(x0 + 0.05, 0.9, l=2.0, w=0.72, h=0.62, rot=math.pi / 2, stone=True, water=True)
    if not burnt:
        K.barrel((x0 - 0.75, -0.3, 0), 0.17, 0.3)
        K.barrel((x0 - 1.1, 0.25, 0), 0.16, 0.28)
    # hay rick SW, muck bay SE
    hay_rick(-6.9, -3.9, burnt=burnt)
    muck_bay(6.9, -4.5)
    # mounting block by the tack door
    mb = (X0 + TACK_U + 0.1, Y0 - 1.25)
    for k, (h, dy) in enumerate(((0.62, 0.0), (0.38, -0.34), (0.2, -0.6))):
        box(B("ashlar"), (mb[0] - 0.4 + jit(0.02), mb[1] + dy - 0.2, 0), (mb[0] + 0.4, mb[1] + dy + 0.2 + (0.34 if k == 0 else 0), h),
            0.02, rot=(0, 0, jit(0.03)))
    # bundles of straw for bedding by the stall doors, a saddle-rack rail on the tack wall
    if not burnt:
        for (x, y) in ((X0 + 3.9, Y0 - 1.0),):
            K.mound(B("straw"), x, y, 0.75, 0.45, 0.28, rings=3, seg=12, rough=0.25)
        K.pitchfork((X0 + 4.35, Y0 - 0.12, 0.02), (X0 + 4.2, Y0 - 0.38, 1.7))


# ---------------------------------------------------------------- states
def complete():
    K.SOLIDS.append(((X0 + 0.35, Y0 + 0.35, 0.0), (X1 - 0.35, Y1 - 0.35, PLATE - 0.1)))
    front_wall("complete")
    back_wall("complete")
    end_walls("complete")
    dormer_bits("complete")
    roof("complete")
    yard("complete")


def build1():
    """footings laid part-height, trenches, setting-out stakes and lines, materials stacked."""
    gaps = [(c - DW / 2 - 0.1, c + DW / 2 + 0.1) for c in DOORS] + [(TACK_U + 0.3, TACK_U + 1.25)]
    for f, l, g, top in ((ff, LEN, gaps, 0.75), (fe, DEP, (), 0.55), (fb, LEN, (), 0.35), (fw, DEP, (), 0.2)):
        # laid courses at their final height on the east, stepping down westward (ragged racking back)
        f_len = l
        u = -0.05
        while u < f_len:
            w = min(R.uniform(0.9, 1.6), f_len + 0.05 - u)
            if not any(a < u + w / 2 < b for (a, b) in g):
                prog = (u + w / 2) / f_len
                if f is ff:
                    h = 0.75 * min(1.0, max(0.18, (prog - 0.1) * 1.6))
                else:
                    h = top * R.uniform(0.7, 1.0)
                f.box(B("rubble"), u, u + w, -0.06, 0.46, 0.0, h, 0.02)
            u += w
        # trench spoil along the outside
        uu = 0.3
        while uu < l - 0.3:
            q = f.p(uu, -0.9 + jit(0.1), 0)
            K.mound(B("soil"), q.x, q.y, R.uniform(0.5, 0.8), R.uniform(0.35, 0.5), R.uniform(0.15, 0.3), rings=3,
                    seg=10, rough=0.25, rot=math.atan2(f.al.y, f.al.x))
            uu += R.uniform(1.0, 1.6)
    # setting-out pegs + lines at the corners (profiles)
    for (x, y) in ((X0 - 0.7, Y0 - 0.7), (X1 + 0.7, Y0 - 0.7), (X1 + 0.7, Y1 + 0.7), (X0 - 0.7, Y1 + 0.7)):
        for (dx, dy) in ((0.4, 0), (0, 0.4)):
            cyl(B("fresh"), (x + dx, y + dy, 0), (x + dx + jit(0.03), y + dy + jit(0.03), 0.7), 0.035, 0.02, n=5)
    for (a, b) in (((X0 - 0.7, Y0 - 0.3), (X1 + 0.7, Y0 - 0.3)), ((X1 + 0.3, Y0 - 0.7), (X1 + 0.3, Y1 + 0.7)),
                   ((X1 + 0.7, Y1 + 0.3), (X0 - 0.7, Y1 + 0.3)), ((X0 - 0.3, Y1 + 0.7), (X0 - 0.3, Y0 - 0.7))):
        beam(B("rope"), (a[0], a[1], 0.6), (b[0], b[1], 0.6), 0.008, 0.008, 0.0)
    # materials
    K.stone_pile(-5.5, -3.8, 26, 1.4)
    K.stone_pile(0.5, -4.2, 18, 1.1)
    K.timber_stack(-8.2, -5.8, 5.2, 3)
    K.timber_stack(2.2, -5.9, 4.0, 2)
    K.log_pile(5.5, -4.6, 8.3, rows=3, r=0.12, length=2.2)
    K.barrel((3.4, -2.2, 0), 0.4, 0.4)           # mortar tub
    K.barrow(-2.0, -2.5, rot=0.3, load=None)
    # paddock fence begun: posts only on two sides
    x0, x1, y0, y1 = PAD
    K.fence((x1, y0), (x1, y1), step=2.7, keep=0.0)
    K.fence((x1, y1), (x0, y1), step=2.25, keep=0.35, first_post=False)


def build2():
    K.SOLIDS.append(((X0 + 0.35, Y0 + 0.35, 0.0), (X1 - 0.35, Y1 - 0.35, PLATE - 0.1)))
    front_wall("frame")
    back_wall("frame")
    end_walls("frame")
    dormer_bits("frame")
    rafters("frame")
    roof("partial")
    K.scaffold_face((X0 + 5.4, Y0 - 0.1, 0), (X1 + 0.1, Y0 - 0.1, 0), (0, -1, 0), PLATE + 0.6, 1.0)
    K.yealm_stack(-4.2, -3.6, 16, rot=0.1)
    K.yealm_stack(-6.8, -4.6, 12, rot=-0.2)
    K.timber_stack(0.2, -5.6, 4.0, 2)
    K.ladder((X0 + 2.0, Y0 - 1.6, 0.0), (X0 + 2.0, Y0 - 0.9, 3.4))
    K.barrow(-1.5, -4.5, rot=0.8, load=None)
    x0, x1, y0, y1 = PAD
    K.fence((x1, y0), (x1, y1), step=2.7, keep=0.7)
    K.fence((x1, y1), (x0, y1), step=2.25, keep=1.0, first_post=False)
    K.fence((x0, y1), (x0, y0), step=2.7, keep=0.2, first_post=False)
    K.trough(x0 + 0.05, 0.9, l=2.0, w=0.72, h=0.62, rot=math.pi / 2, stone=True, water=False)


def ruin():
    front_wall("burnt")
    back_wall("burnt")
    end_walls("burnt")
    rafters("burnt")
    roof("burnt")
    yard("burnt")
    # fallen charred plate + rafters, ash and burnt thatch in the stalls
    for i in range(9):
        x = R.uniform(X0 + 0.8, X1 - 0.8)
        y = R.uniform(Y0 + 0.6, Y1 - 0.6)
        a = R.uniform(0, math.pi)
        l = R.uniform(1.5, 3.8)
        beam(B("char"), (x, y, 0.15), (x + math.cos(a) * l, y + math.sin(a) * l, R.uniform(0.1, 1.4)), 0.18, 0.2, 0.01)
    beam(B("char"), (X0 + 1.0, Y0 - 0.6, 0.1), (X0 + 5.8, Y0 + 0.2, PLATE - 0.4), 0.22, 0.24, 0.015)
    K.rubble_heap(X0 + 3.2, RY, 2.6, 2.0, 0.55, 30, "ash")
    K.rubble_heap(X0 + 8.4, RY + 0.4, 2.2, 1.8, 0.5, 26, "ash")
    K.mound(B("thatch"), X0 + 5.8, RY - 0.5, 2.2, 1.8, 0.45, rings=4, seg=14, rough=0.3)
    K.mound(B("thatch"), X0 + 1.6, RY + 1.2, 1.4, 1.2, 0.35, rings=4, seg=12, rough=0.3)


def main():
    materials()
    {"complete": complete, "build1": build1, "build2": build2, "ruin": ruin}[STATE]()
    name = "stables" if FULL else "stables_" + STATE
    K.finalize(name, tex=2048 if FULL else 1024)


main()
