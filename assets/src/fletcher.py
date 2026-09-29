"""HIGHGROUND - fletcher & bowyer's workshop (8 x 8 m footprint).

A small timber-framed, thatched workshop with an open three-bay front on padstones: bench along
the back wall with shafts and a glue pot, goose-feather bundles hanging from the tie beams and in
baskets, a shaving horse, a rack of arrow shafts drying in the yard, and cleft stave billets
crib-stacked to season.

    blender -b -P assets/src/fletcher.py -- [complete|build1|build2|ruin]

Front faces -Y. 1 unit = 1 m.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _kit_yards as K
from _kit_yards import B, beam, box, cyl, Face, jit, grid, R

STATE = K.state_from_argv()
K.init(STATE, seed=31)
FULL, RUIN, B1, B2 = K.FULL, K.RUIN, K.B1, K.B2

X0, X1 = -3.2, 3.2
Y0, Y1 = -0.35, 3.25
LEN, DEP = X1 - X0, Y1 - Y0
FOOT = 0.35
PLATE = 2.75
PITCH = math.radians(52)
OVER = 0.42
RY = (Y0 + Y1) / 2
RAF = PLATE + 0.1
RZ = RAF + (DEP / 2) * math.tan(PITCH)
EAVE = (Y0 - OVER, RAF - OVER * math.tan(PITCH))
POSTS = [0.1, LEN / 3, 2 * LEN / 3, LEN - 0.1]

ff = Face((X0, Y0, 0), (0, -1, 0))
fb = Face((X1, Y1, 0), (0, 1, 0))
fe = Face((X1, Y0, 0), (1, 0, 0))
fw = Face((X0, Y1, 0), (-1, 0, 0))


def materials():
    ch = 0.9 if RUIN else 0.0
    K.std_materials(ch)
    K.MAT["feather"] = K.m_feather("feather")
    K.MAT["straw"] = K.m_straw("straw", [(0.0, "#8c7a4b"), (0.5, "#a89060"), (1.0, "#b59d69")])
    K.MAT["wicker"] = K.m_wicker("wicker")


def padstone(x, y, s=0.42, h=0.28):
    box(B("rubble"), (x - s / 2, y - s / 2, 0), (x + s / 2, y + s / 2, h), 0.03, rot=(0, 0, jit(0.1)))


def frame(stage):
    """posts, plates, tie beams; stage: complete | frame | burnt"""
    char = stage == "burnt"
    oak = B("oak") if stage != "frame" else B("fresh")
    keep = 0.6 if char else 1.0
    ctop = lambda a, b: (a + (b - a) * R.uniform(0.35, 1.0)) if char else b
    # open front: posts on padstones, plate, arch braces
    for u in POSTS:
        padstone(X0 + u, Y0 + 0.08)
        if R.random() < keep:
            ff.timber(oak, u, 0.26, u, ctop(0.26, PLATE), 0.2, 0.2, -0.02)
    if not char or R.random() < 0.5:
        ff.timber(oak, -0.25, PLATE + 0.02, LEN + 0.25, PLATE + 0.02, 0.22, 0.24, -0.03)
        for u in POSTS[1:-1]:
            for s in (-1, 1):
                ff.timber(oak, u + s * 0.1, PLATE - 0.62, u + s * 0.62, PLATE - 0.1, 0.13, 0.14, 0.02)
        for u in (POSTS[0], POSTS[-1]):
            s = 1 if u < 1 else -1
            ff.timber(oak, u + s * 0.1, PLATE - 0.62, u + s * 0.62, PLATE - 0.1, 0.13, 0.14, 0.02)
    # tie beams front-back at every post line
    for u in POSTS:
        if R.random() < keep:
            beam(oak, (X0 + u, Y0 - 0.1, PLATE + 0.14), (X0 + u, Y1 + 0.1, PLATE + 0.14), 0.2, 0.22, 0.015)
    # back + side walls: low stone sill wall, framed, daubed
    for f, L_ in ((fb, LEN), (fe, DEP), (fw, DEP)):
        f.box(B("rubble"), -0.05, L_ + 0.05, -0.06, 0.34, 0.0, FOOT, 0.02)
        f.timber(oak, -0.1, FOOT + 0.1, L_ + 0.1, FOOT + 0.1, 0.18, 0.2, -0.01)
    ops_e = [(1.2, 2.1, 1.1, 1.8, "win")] if stage == "complete" else []
    slab = stage == "complete"
    if stage == "frame":
        for f, L_ in ((fb, LEN), (fe, DEP), (fw, DEP)):
            for u in grid(0.1, L_ - 0.1, 1.1):
                f.timber(oak, u, FOOT + 0.2, u, PLATE, 0.18, 0.18, -0.01)
            f.timber(oak, -0.1, PLATE + 0.02, L_ + 0.1, PLATE + 0.02, 0.2, 0.22, -0.02)
            f.timber(oak, -0.05, 1.4, L_ + 0.05, 1.4, 0.16, 0.16, -0.005)
        return
    K.frame_face(fb, LEN, FOOT + 0.2, PLATE, grid(0.1, LEN - 0.1, 0.8), [1.4, PLATE + 0.02], [],
                 braces=[(0.2, FOOT + 0.3, 1.0, 1.35), (LEN - 0.2, FOOT + 0.3, LEN - 1.0, 1.35)],
                 char=char, keep_frac=keep, slab=slab)
    K.frame_face(fe, DEP, FOOT + 0.2, PLATE, [0.1, 1.1, 2.2, DEP - 0.1], [1.4 if not ops_e else 1.05, PLATE + 0.02],
                 ops_e, braces=[(0.2, 1.5, 1.0, PLATE - 0.1)], char=char, keep_frac=keep, slab=slab)
    K.frame_face(fw, DEP, FOOT + 0.2, PLATE, [0.1, 1.2, 2.4, DEP - 0.1], [1.4, PLATE + 0.02], [],
                 braces=[(DEP - 0.2, 1.5, DEP - 1.0, PLATE - 0.1)], char=char, keep_frac=keep, slab=slab)
    if char:
        return
    # gables: wattle-and-daub triangles with a smoke gablet (louvre) at the west apex
    for f, L_ in ((fe, DEP), (fw, DEP)):
        s = K.Batch("gd_%d" % len(K.BATCHES), "daub")
        apex = RZ - 0.1
        pts = [f.p(u, d, v) for (u, v) in ((0.0, PLATE + 0.12), (L_, PLATE + 0.12), (L_ / 2, apex)) for d in (0.05, 0.18)]
        K.prism_hull(s, pts)
        K.BATCHES["_g%d" % len(K.BATCHES)] = (s, None)
        f.timber(oak, 0.05, PLATE + 0.12, L_ / 2, apex - 0.05, 0.18, 0.18, -0.01)
        f.timber(oak, L_ - 0.05, PLATE + 0.12, L_ / 2, apex - 0.05, 0.18, 0.18, -0.01)
        f.timber(oak, L_ / 2, PLATE + 0.2, L_ / 2, apex - 0.15, 0.16, 0.16, -0.005)
    # smoke hole + small louvre in the west gable (glue pot hearth)
    fw.box(B("dark"), DEP / 2 - 0.22, DEP / 2 + 0.22, 0.2, 0.24, RZ - 1.35, RZ - 0.85)
    fw.box(B("oak"), DEP / 2 - 0.3, DEP / 2 + 0.3, -0.03, 0.16, RZ - 1.43, RZ - 1.33, 0.01)


def roof(stage):
    if stage == "complete":
        K.thatch_roof(X0, X1, EAVE, (RY, RZ), thick=0.3, sag=0.06, seg=18, verge=0.3)
    if stage in ("frame", "burnt"):
        oak = B("fresh") if stage == "frame" else B("oak")
        tz = math.tan(PITCH)
        for x in grid(X0 + 0.05, X1 - 0.05, 0.5, 0.02):
            for sgn in (1, -1):
                if stage == "burnt" and R.random() < 0.45:
                    continue
                ye = RY - sgn * (DEP / 2 + OVER * 0.6)
                p0 = Vector((x, ye, RAF - OVER * 0.6 * tz))
                p1 = Vector((x, RY, RZ - 0.05))
                if stage == "burnt":
                    p1 = p0.lerp(p1 + Vector((jit(0.3), 0, -R.uniform(0.2, 1.0))), R.uniform(0.3, 0.9))
                beam(oak, p0, p1, 0.09, 0.12, 0.01, side=(1, 0, 0))
        if stage == "frame":
            beam(oak, (X0 - 0.2, RY, RZ), (X1 + 0.2, RY, RZ), 0.18, 0.08, 0.01, side=(0, 1, 0))
            # battens on the front slope, ready for the thatch
            for k in range(1, 7):
                s = k * 0.42
                y = Y0 - OVER * 0.6 + s * math.cos(PITCH)
                z = RAF - OVER * 0.6 * tz + s * math.sin(PITCH) + 0.08
                beam(oak, (X0 - 0.2, y, z), (X1 + 0.2, y, z), 0.05, 0.03, 0.0, side=(0, -math.sin(PITCH), math.cos(PITCH)))


# ---------------------------------------------------------------- the trade
def feather_bunch(top, n=9, length=0.3):
    """a hanging bunch of goose flight feathers tied at the quills."""
    top = Vector(top)
    K.tube(B("rope"), [top + Vector((0, 0, 0.25)), top], 0.006, sides=3, caps=False)
    for k in range(n):
        a = 2 * math.pi * k / n + jit(0.3)
        tip = top + Vector((math.cos(a) * 0.07, math.sin(a) * 0.07, -length * R.uniform(0.85, 1.1)))
        side = Vector((-math.sin(a), math.cos(a), 0))
        mid = top.lerp(tip, 0.55) + Vector((math.cos(a), math.sin(a), 0)) * 0.03
        w = 0.035 * R.uniform(0.8, 1.2)
        pts = [tuple(top), tuple(mid + side * w), tuple(tip), tuple(mid - side * w * 0.4)]
        B("feather").add(pts, [(0, 1, 2, 3), (3, 2, 1, 0)], None, None,
                         [(0, 0, 0), (w, 0, 0.17), (0, 0, 0.3), (-w * 0.4, 0, 0.17)])


def feather_basket(cx, cy, r=0.26):
    K.basket(cx, cy, r, 0.36)
    # a heap of loose feathers as a soft white mound + a few quills sticking out
    K.mound(B("feather"), cx, cy, r * 0.95, r * 0.95, 0.14, rings=3, seg=12, z0=0.32, rough=0.3)
    for k in range(5):
        a = R.uniform(0, 6.28)
        p = Vector((cx + math.cos(a) * r * 0.5, cy + math.sin(a) * r * 0.5, 0.4))
        d = Vector((math.cos(a) * 0.5, math.sin(a) * 0.5, 1.0)).normalized()
        tip = p + d * 0.28
        side = Vector((-d.y, d.x, 0)).normalized() if abs(d.z) < 0.99 else Vector((1, 0, 0))
        B("feather").add([tuple(p), tuple(p.lerp(tip, 0.5) + side * 0.03), tuple(tip), tuple(p.lerp(tip, 0.5) - side * 0.01)],
                         [(0, 1, 2, 3), (3, 2, 1, 0)], None, None, [(0, 0, 0), (0.03, 0, 0.14), (0, 0, 0.28), (-0.01, 0, 0.14)])


def trestle_bench(x0, x1, y, h=0.82, d=0.55, top_mat="plank"):
    for x in (x0 + 0.2, x1 - 0.2):
        for s in (-1, 1):
            beam(B("oak"), (x + s * 0.12, y - d / 2 + 0.05, 0), (x, y - d / 2 + 0.05, h - 0.05), 0.06, 0.06, 0.006)
            beam(B("oak"), (x + s * 0.12, y + d / 2 - 0.05, 0), (x, y + d / 2 - 0.05, h - 0.05), 0.06, 0.06, 0.006)
        beam(B("oak"), (x, y - d / 2, h - 0.08), (x, y + d / 2, h - 0.08), 0.08, 0.06, 0.006)
    for k in range(3):
        yy = y - d / 2 + (k + 0.5) * d / 3
        beam(B(top_mat), (x0, yy, h - 0.02), (x1 + jit(0.02), yy, h - 0.02), d / 3 - 0.01, 0.045, 0.006, side=(0, 0, 1))


def shaft_bundle(p0, p1, r=0.045):
    p0, p1 = Vector(p0), Vector(p1)
    K.tube(B("fresh"), [p0, p1], r, sides=8, rough=0.06)
    for t in (0.25, 0.75):
        q = p0.lerp(p1, t)
        d = (p1 - p0).normalized() * 0.02
        K.tube(B("rope"), [q - d, q + d], r + 0.004, sides=8)


def shaving_horse(cx, cy, rot=0.0):
    M = Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(rot, 4, "Z")
    W = lambda x, y, z: M @ Vector((x, y, z))
    beam(B("oak"), W(-0.8, 0, 0.55), W(0.8, 0, 0.5), 0.26, 0.09, 0.01)
    for (x, s) in ((-0.65, -1), (-0.65, 1), (0.65, -1), (0.65, 1)):
        beam(B("oak"), W(x + 0.1 * (x > 0) - 0.1 * (x < 0), s * 0.2, 0.0), W(x, s * 0.06, 0.5), 0.05, 0.05, 0.006)
    # sloping work bed + swinging head with foot bar
    beam(B("plank"), W(0.05, 0, 0.6), W(0.75, 0, 0.82), 0.2, 0.05, 0.006)
    beam(B("oak"), W(0.2, 0, 0.35), W(0.25, 0, 0.98), 0.06, 0.12, 0.006)
    beam(B("oak"), W(0.1, -0.14, 0.95), W(0.4, 0.14, 0.95), 0.07, 0.07, 0.006, side=(0, 0, 1))
    beam(B("oak"), W(0.18, -0.25, 0.3), W(0.18, 0.25, 0.3), 0.05, 0.05, 0.006)
    # a stave blank clamped on it
    K.billet(B("fresh"), W(0.0, 0.0, 0.7), W(0.95, 0.0, 0.9), 0.05)


def drying_rack(cx, cy, w=1.8):
    """shafts stood upright to season, held between a perforated top rail and a slotted foot."""
    for x in (cx - w / 2, cx + w / 2):
        K.post(B("oak"), x, cy, 1.1, 0.1, 0.1, lean=0.01)
        beam(B("oak"), (x, cy - 0.35, 0.06), (x, cy + 0.35, 0.06), 0.1, 0.1, 0.006)
    for z in (0.12, 0.92):
        beam(B("plank"), (cx - w / 2, cy, z), (cx + w / 2, cy, z), 0.24 if z < 0.5 else 0.2, 0.05, 0.006,
             side=(0, 0, 1))
    for row in (-0.06, 0.06):
        x = cx - w / 2 + 0.1
        while x < cx + w / 2 - 0.08:
            if R.random() < 0.9:
                b = Vector((x + jit(0.01), cy + row + jit(0.01), 0.14))
                t = b + Vector((jit(0.03), jit(0.03), 0.79))
                K.tube(B("fresh"), [b, t], 0.0055, sides=4, caps=False)
            x += 0.045


def billet_crib(cx, cy, layers=7, n=9, length=1.9, mat="fresh"):
    """cleft yew/elm billets crib-stacked on bearers so the air gets through."""
    for s in (-1, 1):
        beam(B("oak"), (cx - length / 2, cy + s * 0.45, 0.06), (cx + length / 2, cy + s * 0.45, 0.06), 0.12, 0.12, 0.01)
    z = 0.14
    for L_ in range(layers):
        if L_ % 2 == 0:
            for k in range(n):
                x = cx - length / 2 + 0.12 + k * (length - 0.24) / (n - 1)
                K.billet(B(mat), (x + jit(0.02), cy - 0.85, z + 0.06), (x + jit(0.03), cy + 0.85, z + 0.06), 0.1)
            z += 0.12
        else:
            for s in (-1, 1):
                beam(B("plank"), (cx - length / 2, cy + s * 0.6, z + 0.03), (cx + length / 2, cy + s * 0.6, z + 0.03),
                     0.05, 0.05, 0.004)
            z += 0.06


def stave_rack(x0, x1, y, lean=0.35, n=10):
    """longbow staves leaning on a rail pegged to the wall."""
    beam(B("oak"), (x0, y + 0.08, 1.65), (x1, y + 0.08, 1.65), 0.08, 0.08, 0.008)
    for k in range(n):
        x = x0 + 0.1 + k * (x1 - x0 - 0.2) / (n - 1) + jit(0.02)
        K.bow_stave((x, y - lean, 0.02), (x + jit(0.04), y + 0.05, 1.9), bend=0.02)


def workshop_contents(burnt=False):
    # bench along the back wall with shafts, glue pot, tools
    by = Y1 - 0.55
    trestle_bench(X0 + 0.6, X1 - 1.3, by, 0.82, 0.6)
    if burnt:
        return
    for k in range(3):
        a = Vector((X0 + 0.8 + k * 0.62, by - 0.1 + jit(0.05), 0.87))
        shaft_bundle(a, a + Vector((0.76 * math.cos(0.1 * k), 0.1, 0.0)), 0.04)
    for k in range(10):
        a = Vector((X0 + 2.8 + jit(0.3), by + jit(0.2), 0.855))
        ang = R.uniform(-0.4, 0.4)
        K.arrow(a + Vector((math.cos(ang), math.sin(ang), 0)) * 0.76, (math.cos(ang), math.sin(ang), 0.0), fletch=k % 2 == 0,
                head=k % 3 == 0)
    # glue pot on a little stone hearth at the west end
    hx, hy = X0 + 0.55, Y1 - 1.5
    for k in range(6):
        a = k * math.pi / 3
        box(B("rubble"), (hx + math.cos(a) * 0.3 - 0.09, hy + math.sin(a) * 0.3 - 0.07, 0),
            (hx + math.cos(a) * 0.3 + 0.09, hy + math.sin(a) * 0.3 + 0.07, 0.14), 0.02, rot=(0, 0, a))
    K.mound(B("ash"), hx, hy, 0.26, 0.26, 0.05, rings=2, seg=10)
    K.lathe(B("iron"), (hx, hy, 0.12), [(0.1, 0.0), (0.14, 0.08), (0.13, 0.2), (0.14, 0.22)], seg=10, cap_top=False)
    K.lathe(B("dark"), (hx, hy, 0.12), [(0.125, 0.19), (0.0, 0.18)], seg=10)
    # feathers: bunches hanging from the tie beams, baskets on the floor
    for u in POSTS[1:3]:
        for yy in (Y0 + 0.9, Y0 + 1.5, Y0 + 2.1):
            feather_bunch((X0 + u + jit(0.05), yy + jit(0.05), PLATE + 0.03), n=8, length=0.3)
    for (x, y) in ((X1 - 0.8, Y1 - 0.6), (X1 - 1.35, Y1 - 0.5), (X1 - 0.6, Y0 + 1.2)):
        feather_basket(x, y)
    # staves on a wall rail at the east end, a stool
    stave_rack(X1 - 0.9, X1 - 0.2, Y1 - 0.25, lean=0.3, n=5)
    for (x, y) in ((X0 + 1.6, Y1 - 1.2),):
        cyl(B("plank"), (x, y, 0.4), (x, y, 0.46), 0.18, n=10)
        for k in range(3):
            a = k * 2.094
            beam(B("oak"), (x + math.cos(a) * 0.2, y + math.sin(a) * 0.2, 0), (x + math.cos(a) * 0.08, y + math.sin(a) * 0.08, 0.41),
                 0.04, 0.04, 0.004)


def yard(burnt=False):
    if burnt:
        # charred remains of the billet stack and rack
        billet_crib(2.2, -2.7, layers=3, mat="char")
        K.mound(B("char"), -2.0, -2.6, 1.0, 0.5, 0.1, rings=3, seg=12, rough=0.3)
        for k in range(12):
            a = Vector((R.uniform(-3.2, 3.2), R.uniform(-3.7, -1.2), 0.01))
            ang = R.uniform(0, 6.28)
            K.tube(B("char"), [a, a + Vector((math.cos(ang), math.sin(ang), 0)) * R.uniform(0.3, 0.76)], 0.006, sides=4)
        return
    billet_crib(2.2, -2.7)
    drying_rack(-2.0, -2.4, 2.0)
    shaving_horse(-0.1, -1.55, rot=0.25)
    # chopping block with a froe + mallet, spills of shavings
    cyl(B("oak"), (0.9, -3.35, 0), (0.9, -3.35, 0.5), 0.28, 0.26, n=10)
    beam(B("iron"), (0.8, -3.35, 0.5), (0.8, -3.35, 0.78), 0.04, 0.008, 0.0, side=(1, 0, 0))
    beam(B("oak"), (0.8, -3.35, 0.72), (1.05, -3.35, 0.9), 0.035, 0.035, 0.004)
    K.mound(B("fresh"), 0.2, -1.4, 0.6, 0.45, 0.05, rings=3, seg=12, rough=0.4)
    feather_basket(-0.9, -0.95, 0.24)
    # sheaves of finished arrows by the door post, a barrel of shafts
    K.arrow_sheaf((X1 - 0.35, Y0 - 0.35, 0.02), (0.05, 0.25, 1.0))
    K.arrow_sheaf((X1 - 0.6, Y0 - 0.3, 0.02), (-0.15, 0.3, 1.0))
    K.barrel((X0 + 0.45, Y0 - 0.5, 0), 0.28, 0.72)
    for k in range(9):
        a = Vector((X0 + 0.45 + jit(0.12), Y0 - 0.5 + jit(0.12), 0.3))
        K.tube(B("fresh"), [a, a + Vector((jit(0.12), jit(0.12), 0.72))], 0.0055, sides=4, caps=False)


def complete():
    frame("complete")
    roof("complete")
    workshop_contents()
    yard()


def build1():
    for u in POSTS:
        padstone(X0 + u, Y0 + 0.08)
    for f, L_, h in ((fb, LEN, FOOT), (fe, DEP, FOOT * 0.8), (fw, DEP, FOOT * 0.5)):
        f.box(B("rubble"), -0.05, L_ * R.uniform(0.6, 1.0) + 0.05, -0.06, 0.34, 0.0, h, 0.02)
        uu = 0.2
        while uu < L_ - 0.2:
            q = f.p(uu, -0.6 + jit(0.08), 0)
            K.mound(B("soil"), q.x, q.y, R.uniform(0.4, 0.6), R.uniform(0.3, 0.4), R.uniform(0.12, 0.22), rings=3,
                    seg=10, rough=0.25, rot=math.atan2(f.al.y, f.al.x))
            uu += R.uniform(0.9, 1.3)
    for (x, y) in ((X0 - 0.5, Y0 - 0.5), (X1 + 0.5, Y0 - 0.5), (X1 + 0.5, Y1 + 0.5), (X0 - 0.5, Y1 + 0.5)):
        cyl(B("fresh"), (x, y, 0), (x + jit(0.03), y + jit(0.03), 0.65), 0.03, 0.018, n=5)
    for (a, b) in (((X0 - 0.5, Y0 - 0.5), (X1 + 0.5, Y0 - 0.5)), ((X1 + 0.5, Y0 - 0.5), (X1 + 0.5, Y1 + 0.5)),
                   ((X1 + 0.5, Y1 + 0.5), (X0 - 0.5, Y1 + 0.5)), ((X0 - 0.5, Y1 + 0.5), (X0 - 0.5, Y0 - 0.5))):
        beam(B("rope"), (a[0], a[1], 0.55), (b[0], b[1], 0.55), 0.007, 0.007, 0.0)
    K.timber_stack(-3.0, -3.6, 3.2, 3)
    billet_crib(2.2, -2.7, layers=3)
    K.stone_pile(-0.8, -2.3, 12, 0.8, 0.35)


def build2():
    frame("frame")
    roof("frame")
    K.ladder((X0 + 1.2, Y0 - 1.3, 0.0), (X0 + 1.2, Y0 - 0.55, 2.9))
    K.scaffold_face((X1 + 0.05, Y0 - 0.2, 0), (X1 + 0.05, Y1 + 0.2, 0), (1, 0, 0), PLATE + 0.5, 0.9)
    K.yealm_stack(-1.6, -2.6, 12, rot=0.05)
    billet_crib(2.2, -2.7, layers=3)
    trestle_bench(-0.2, 1.4, -1.6, 0.75, 0.5)
    # wattle hurdles leaning ready for the panels
    for k in range(3):
        x = -3.0 + k * 0.25
        box(B("wicker"), (x, -3.8, 0.0), (x + 0.05, -2.9, 1.2), 0.0, rot=(0, -0.25, 0))


def ruin():
    frame("burnt")
    roof("burnt")
    workshop_contents(burnt=True)
    yard(burnt=True)
    for i in range(6):
        x = R.uniform(X0 + 0.5, X1 - 0.5)
        y = R.uniform(Y0 + 0.4, Y1 - 0.4)
        a = R.uniform(0, math.pi)
        l = R.uniform(1.2, 2.6)
        beam(B("char"), (x, y, 0.1), (x + math.cos(a) * l, y + math.sin(a) * l, R.uniform(0.1, 1.0)), 0.15, 0.17, 0.01)
    K.rubble_heap(0.0, RY, 2.2, 1.4, 0.35, 22, "ash")
    K.mound(B("thatch"), 0.8, RY + 0.2, 1.8, 1.2, 0.3, rings=4, seg=12, rough=0.3)


def main():
    materials()
    {"complete": complete, "build1": build1, "build2": build2, "ruin": ruin}[STATE]()
    name = "fletcher" if FULL else "fletcher_" + STATE
    K.finalize(name, tex=1024 if not FULL else 2048)


main()
