"""HIGHGROUND - wayside chapel (6 x 4 m), random-rubble walls with dressed quoins, a stone-tiled
roof, a gable bellcote carrying one bell on the west end, round-headed south door with a step,
small lancets, and a stepped wayside cross beside the track.

    blender -b -P assets/src/chapel.py -- <state>     state = complete | build1 | build2 | ruin

Front (door side, south) faces -Y. 1 unit = 1 m.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _parish_kit as K
from _parish_kit import (B, Batch, Face, box, beam, cyl, prism_hull, jit, R, TRS, window, door_leaf, wall,
                         top_prof, quoins, plinth)

STATE, FULL, RUIN, B1, B2 = K.STATE, K.FULL, K.RUIN, K.B1, K.B2
K.begin(seed=41)
K.NO_CULL += ["wall_"]

ch = 0.85 if RUIN else 0.0
M = K.MAT
M["rubble"] = K.m_stone("rubble", [(0.0, "#7f786a"), (0.2, "#958b77"), (0.45, "#a79c85"), (0.7, "#8b8474"),
                                    (0.85, "#a0947b"), (1.0, "#77705f")], "#6c6556", rowh=0.2, bw=0.34,
                        charred=ch * 0.8, moss=(0.08 if (B1 or B2) else 1.3))
M["ashlar"] = K.m_stone("ashlar", [(0.0, "#a1967e"), (0.4, "#b4a98f"), (0.7, "#aca087"), (1.0, "#978c77")],
                        "#9a9280", joints=False, bump=0.6, charred=ch * 0.6, moss=(0.08 if (B1 or B2) else 1.0))
M["stile"] = K.m_tiles("stile", [(0.0, "#5e574c"), (0.3, "#716858"), (0.6, "#7f7562"), (0.85, "#8a7f6a"),
                                  (1.0, "#5b554b")], cell=0.3, curve=0.18, lichen=1.8, moss=1.5, charred=ch)
M["oak"] = K.m_wood("oak", [(0.0, "#4e3b27"), (0.5, "#5f4830"), (1.0, "#6b5236")], weather_hex="#7d7466",
                    weathered=0.6, fresh=0.5 if (B1 or B2) else 0.0, charred=ch)
M["plank"] = K.m_wood("plank", [(0.0, "#6f6353"), (0.5, "#80766a"), (1.0, "#8d8272")], weather_hex="#8f887c",
                      weathered=0.55, fresh=0.6 if (B1 or B2) else 0.0, charred=ch, grain_k=1.2)
M["char"] = K.m_wood("char", [(0.0, "#2b2622"), (1.0, "#3d352e")], weather_hex="#4a443d", weathered=0.3, charred=1.0)
M["iron"] = K.m_simple("iron", "#35332f", "#45403a", 0.72, rust=True)
M["bronze"] = K.m_simple("bronze", "#4f4a36", "#5d6a4f", 0.55, 3.0)
M["dark"] = K.m_glass("glass") if FULL else K.m_simple("dark", "#231f1b", "#2f2923", 0.92)
M["mud"] = K.m_ground("mud", wet=0.5, grass=0.8, trod=(0.0, -2.8, 1.6, 3.4)) if not (B1 or B2) else \
    K.m_ground("mud", wet=0.5, grass=0.35, trod=(0.0, -0.5, 3.0, 5.0))
M["rope"] = K.m_rope("rope")
M["weed"] = K.m_foliage("weed", dark="#4a5228", light="#7d7f43")

X0, X1, Y0, Y1 = -3.0, 3.0, -2.0, 2.0
TH, H = 0.7, 3.0
PITCH = math.radians(50)
L, W = X1 - X0, Y1 - Y0
tn = math.tan(PITCH)
RZ = H + W / 2 * tn
CAP = {"build2": 2.3, "build1": 0.0}.get(STATE, 99)

fS = Face((X0, Y0, 0), (0, -1, 0))     # u = x - X0
fN = Face((X1, Y1, 0), (0, 1, 0))      # u = X1 - x
fE = Face((X1, Y0, 0), (1, 0, 0))      # u = y - Y0
fW = Face((X0, Y1, 0), (-1, 0, 0))     # u = Y1 - y
DOOR_U = -1.0 - X0


def fits(v, cap=CAP):
    return v + 0.35 < cap


def south(f, cut):
    if fits(2.1) or B2:
        window(f, cut, DOOR_U, 0.0, 1.0, 2.1, "round", depth=TH + 0.5 if RUIN else 0.5, backdark=not RUIN)
        if FULL:
            door_leaf(f, DOOR_U, 0.0, 0.98, 2.05, 0.45, arch=True)
    if fits(2.6):
        window(f, cut, 1.5 - X0, 1.35, 0.36, 1.25, "lancet", depth=TH + 0.5 if RUIN else 0.45, backdark=not RUIN)


def north(f, cut):
    if fits(2.6):
        window(f, cut, X1 - 0.8, 1.35, 0.34, 1.2, "lancet", depth=TH + 0.5 if RUIN else 0.45, backdark=not RUIN)


def east(f, cut):
    if fits(2.8):
        window(f, cut, W / 2, 1.3, 0.42, 1.55, "lancet", depth=TH + 0.5 if RUIN else 0.45, backdark=not RUIN)


def bellcote(f, cut):
    if FULL or RUIN:
        # bell opening through the bellcote
        window(f, cut, W / 2, RZ + 0.05, 0.56, 0.95, "round", depth=TH + 0.6, backdark=False, surround=False)


def walls():
    wall("S", fS, top_prof(0.0, L, H, CAP, 1.0, ruin=(0.3, 5.7, [(2.9, 4.1, 1.2)]),
                             protect=((1.0, 3.1, 2.55), (3.8, 5.2, 3.0))), TH, south)
    wall("N", fN, top_prof(0.0, L, H, CAP, 2.0, ruin=(0.8, 5.4, [(3.2, 5.3, 1.3)]), protect=((1.5, 2.9, 2.95),)),
         TH, north)
    g = (W / 2, PITCH) if (FULL or RUIN) else None
    pE = top_prof(TH, W - TH, H, CAP, 3.0, gable=g)
    if RUIN:
        pE = [(TH, 0.0), (W - TH, 0.0), (W - TH, H + 0.3), (W / 2 + 0.4, H + 1.1), (W / 2 - 0.2, H + 0.7),
              (TH, H + 0.2)]
    wall("E", fE, pE, TH, east)
    if FULL or RUIN:
        c = W / 2
        z = lambda u: H + (c - abs(c - u)) * tn
        bw = 0.58
        pW = [(TH, 0.0), (W - TH, 0.0), (W - TH, z(W - TH)), (c + bw, z(c + bw)), (c + bw, RZ + 1.35),
              (c, RZ + 1.75), (c - bw, RZ + 1.35), (c - bw, z(c - bw)), (TH, z(TH))]
        if RUIN:   # bellcote cracked: one pier and the cap gone
            pW = [(TH, 0.0), (W - TH, 0.0), (W - TH, z(W - TH)), (c + bw, z(c + bw)), (c + bw, RZ + 0.9),
                  (c + 0.25, RZ + 1.2), (c - 0.1, RZ + 0.55), (c - bw, RZ + 0.35), (c - bw, z(c - bw)),
                  (TH, z(TH))]
        wall("W", fW, pW, TH, bellcote)
        # bellcote dressings: coping cap, springer ledge, bell on its iron bar
        if FULL:
            # small saddle-back cap: two sloping stones meeting at a ridge, oversailing the pier
            for sg in (-1, 1):
                pts = []
                for x in (X0 - 0.08, X0 + TH + 0.08):
                    for (y, z) in ((sg * (bw + 0.12), RZ + 1.24), (0.0, RZ + 1.8)):
                        pts += [(x, y, z), (x, y, z + 0.13)]
                prism_hull(B("ashlar"), pts)
            cyl(B("ashlar"), (X0 + TH / 2, 0, RZ + 1.78), (X0 + TH / 2, 0, RZ + 1.98), 0.08, 0.05, n=6)
            box(B("ashlar"), (X0 - 0.06, -bw - 0.08, RZ - 0.12), (X0 + TH + 0.06, bw + 0.08, RZ + 0.02), 0.02)
            cyl(B("iron"), (X0 + 0.02, 0.0, RZ + 0.86), (X0 + TH - 0.02, 0.0, RZ + 0.86), 0.025, n=5)
            bell(Vector((X0 + TH / 2, 0.0, RZ + 0.82)))
    else:
        wall("W", fW, top_prof(TH, W - TH, H, CAP, 4.0), TH)
    if not B1:
        plinth([(X0, Y0), (DOOR_U + X0 - 0.75, Y0)], closed=False, h=0.45, proud=0.14, bt=B("plinth", "rubble"))
        plinth([(DOOR_U + X0 + 0.75, Y0), (X1, Y0), (X1, Y1), (X0, Y1), (X0, Y0)], closed=False, h=0.45, proud=0.14,
               bt=B("plinth", "rubble"))
    zq = min(H, CAP - 0.1) - (0.5 if RUIN else 0.0)
    if zq > 0.8:
        for c, a, b in (((X0, Y0), (-1, 0, 0), (0, -1, 0)), ((X1, Y0), (0, -1, 0), (1, 0, 0)),
                        ((X1, Y1), (1, 0, 0), (0, 1, 0)), ((X0, Y1), (0, 1, 0), (-1, 0, 0))):
            quoins(c, a, b, 0.45, zq, course=0.36, la=0.5, lb=0.28)


def bell(p):
    """bronze bell hanging from a headstock on the bar."""
    prof = [(0.05, 0.0), (0.2, -0.04), (0.23, -0.2), (0.3, -0.42), (0.33, -0.47)]
    pts = []
    for (r, z) in prof:
        for i in range(10):
            a = 2 * math.pi * i / 10
            pts.append((p.x + r * math.cos(a), p.y + r * math.sin(a), p.z + z))
    prism_hull(B("bronze"), pts)
    box(B("oak"), (p.x - 0.36, p.y - 0.08, p.z - 0.03), (p.x + 0.36, p.y + 0.08, p.z + 0.1), 0.01)
    cyl(B("rope"), (p.x + 0.25, p.y, p.z), (p.x + 0.26, p.y + 0.05, p.z - 0.9), 0.012, n=4)


def roof():
    I = Matrix.Identity(4)
    half = W / 2
    if FULL:
        K.gable_roof(B("stile"), I, X0 + 0.1, X1 - 0.05, 0.0, half, H, PITCH, over=0.32, row_w=0.3, thick=0.035,
                     lift=0.03, sag=0.06, seg=6, ridge_bt=B("ashlar"), ridge_r=0.12)
        K.coping(B("ashlar"), I, X1 - 0.3, 0.0, half, H, PITCH, w=0.5, t=0.14, out=0.2, kneeler=True, cross=True)
        K.coping(B("ashlar"), I, X0 + 0.3, 0.0, half, H, PITCH, w=0.5, t=0.14, out=0.2, kneeler=True)
    elif RUIN:
        K.gable_roof(B("stile"), I, X0 + 0.1, X0 + 1.6, 0.0, half, H, PITCH, over=0.32, row_w=0.3, thick=0.035,
                     lift=0.03, sag=0.15, seg=3, stop_a=lambda t: t < 0.4, stop_b=lambda t: t < 0.8)
        K.rafters(B("char"), I, X0 + 0.6, X1 - 0.7, 0.0, half, H, PITCH, spacing=0.6,
                  keep=lambda x, sg: (1.0 if x < X0 + 1.7 else (R.uniform(0.3, 0.8) if x < X0 + 2.4 else 0.0)))


def surroundings():
    K.ground_patch(B("mud"), 0.3, -0.8, 5.8, 4.4, h=0.04, n=24, rings=4, bump=0.04, seed=3.0)
    if FULL or RUIN:
        # worn door step + a stone mounting block
        prism_hull(B("ashlar"), [(DOOR_U + X0 + a, Y0 + b, c) for a in (-0.7, 0.7) for b in (-0.55, 0.02)
                                 for c in (0.0, 0.16)])
        box(B("ashlar"), (X1 + 0.6, Y0 - 1.6, 0.0), (X1 + 1.3, Y0 - 0.9, 0.55), 0.03, rot=(0, 0, 0.2))
        box(B("ashlar"), (X1 + 0.62, Y0 - 1.1, 0.0), (X1 + 1.28, Y0 - 0.6, 0.3), 0.03, rot=(0, 0, 0.2))
        # wayside cross on a stepped base (calvary), by the track
        cx, cy = X0 - 0.9, Y0 - 1.6
        for k, (s, h) in enumerate(((1.5, 0.3), (1.05, 0.28), (0.62, 0.34))):
            z0 = sum(hh for (_, hh) in ((1.5, 0.3), (1.05, 0.28), (0.62, 0.34))[:k])
            box(B("ashlar"), (cx - s / 2, cy - s / 2, z0), (cx + s / 2, cy + s / 2, z0 + h), 0.03,
                rot=(0, 0, jit(0.04)))
        zb = 0.92
        lean = 0.05 if not RUIN else 0.3
        Mx = TRS((cx, cy, zb), (lean, 0, 0.1))
        for (lo, hi) in (((-0.11, -0.09, 0.0), (0.11, 0.09, 2.3)), ((-0.48, -0.08, 1.55), (0.48, 0.08, 1.77))):
            if RUIN and hi[2] < 2.0:
                continue
            prism_hull(B("ashlar"), [tuple(Mx @ Vector((a, b, c))) for a in (lo[0], hi[0]) for b in (lo[1], hi[1])
                                     for c in (lo[2], hi[2] if not RUIN else min(hi[2], 1.1))])
        # nettles and rank grass along the wall foot and round the cross
        for i in range(14):
            side = R.random()
            if side < 0.45:
                x, y = R.uniform(X0 + 0.2, X1 - 0.2), Y1 + R.uniform(0.25, 0.6)
            elif side < 0.7:
                x, y = X1 + R.uniform(0.25, 0.6), R.uniform(Y0, Y1)
            else:
                x, y = X0 - R.uniform(0.25, 0.6), R.uniform(Y0 + 0.3, Y1)
            K.tussock(B("weed"), x, y, 0.0, R.uniform(0.8, 1.3), seed=i * 1.9)
        for i in range(4):
            K.tussock(B("weed"), cx + R.choice((-1, 1)) * 0.85, cy + jit(0.7), 0.0, 0.9, seed=40 + i)
        # a rough bench of a plank on two stones against the south wall
        if FULL:
            for x in (1.0, 2.4):
                box(B("ashlar"), (x - 0.18, Y0 - 0.55, 0.0), (x + 0.18, Y0 - 0.2, 0.42), 0.03)
            box(B("plank"), (0.7, Y0 - 0.58, 0.42), (2.7, Y0 - 0.18, 0.49), 0.01)


def build1():
    K.ground_patch(B("mud"), 0.0, -0.5, 5.8, 4.4, h=0.04, n=24, rings=4, bump=0.04, seed=3.0)
    fb = B("footing", "rubble")
    for (x0, y0, x1, y1) in ((X0, Y0, X1, Y0 + TH), (X0, Y1 - TH, X1, Y1), (X0, Y0, X0 + TH, Y1),
                             (X1 - TH, Y0, X1, Y1)):
        along = (x1 - x0) > (y1 - y0)
        L_ = max(x1 - x0, y1 - y0)
        u = 0.0
        while u < L_ - 0.05:
            l = min(R.uniform(0.7, 1.2), L_ - u)
            hh = R.uniform(0.15, 0.45)
            if along:
                box(fb, (x0 + u - 0.05, y0 - 0.12, -0.1), (x0 + u + l + 0.05, y1 + 0.12, hh), 0.03, rot=(0, 0, jit(0.02)))
            else:
                box(fb, (x0 - 0.12, y0 + u - 0.05, -0.1), (x1 + 0.12, y0 + u + l + 0.05, hh), 0.03,
                        rot=(0, 0, jit(0.02)))
            u += l
    for (x, y) in ((X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1)):
        for dx, dy in ((-0.6 if x < 0 else 0.6, 0), (0, -0.6 if y < 0 else 0.6)):
            cyl(B("plank"), (x + dx, y + dy, -0.05), (x + dx, y + dy, 0.7), 0.03, 0.025, n=5)
    for (a, b) in (((X0 - 0.6, Y0), (X1 + 0.6, Y0)), ((X0 - 0.6, Y1), (X1 + 0.6, Y1)),
                   ((X0, Y0 - 0.6), (X0, Y1 + 0.6)), ((X1, Y0 - 0.6), (X1, Y1 + 0.6))):
        cyl(B("rope"), (a[0], a[1], 0.64), (b[0], b[1], 0.64), 0.007, n=3)
    K.stone_pile(0.5, -3.6, 20, 1.2, 0.4)
    K.stone_pile(-4.6, 1.0, 14, 0.9, 0.4)
    K.timber_stack(0.2, 2.6, 2.8, 2)


def build2():
    K.scaffold_face((X0 + 0.5, Y0, 0), (X1 - 0.5, Y0, 0), Vector((0, -1, 0)), CAP + 0.1, standoff=1.1)
    K.stone_pile(-3.9, -2.2, 20, 1.0, 0.4)
    K.stone_pile(4.2, 1.0, 16, 0.9, 0.4)
    K.timber_stack(-2.0, 2.6, 3.0, 2)
    # mortar board
    box(B("plank"), (3.3, -3.0, 0.0), (4.9, -1.9, 0.05), 0.01)
    K.ground_patch(B("lime", "ashlar"), 4.1, -2.45, 0.6, 0.4, h=0.14, n=10, rings=2, bump=0.02, seed=2.0)
    K.barrel((5.1, -1.3, 0.0), 0.28, 0.75)
    # rammed floor
    box(B("floor", "mud"), (X0 + TH, Y0 + TH, 0.0), (X1 - TH, Y1 - TH, 0.05))


def ruin_extras():
    K.rubble_heap(0.4, Y0 - 0.9, 1.9, 0.9, 0.45, 18, "rubble")
    K.rubble_heap(0.0, 0.2, 1.8, 1.0, 0.5, 14, "rubble")
    K.rubble_heap(X0 - 0.8, 0.3, 0.8, 1.0, 0.35, 8, "rubble")
    for i in range(8):
        x, y = R.uniform(-1.5, 2.0), R.uniform(-1.0, 1.0)
        a = R.uniform(0, math.pi)
        l = R.uniform(1.2, 2.8)
        beam(B("char"), (x, y, 0.15), (x + math.cos(a) * l, y + math.sin(a) * l, R.uniform(0.1, 1.2)), 0.13, 0.15, 0.01)
    # the bell lies cracked in the grass below the bellcote
    p = Vector((X0 - 1.3, 0.8, 0.33))
    prof = [(0.05, 0.0), (0.2, -0.04), (0.23, -0.2), (0.3, -0.42), (0.33, -0.47)]
    Mx = TRS(p, (1.4, 0.3, 0.6))
    pts = [tuple(Mx @ Vector((r * math.cos(2 * math.pi * i / 10), r * math.sin(2 * math.pi * i / 10), z)))
           for (r, z) in prof for i in range(10)]
    prism_hull(B("bronze"), pts)
    for i in range(30):
        x, y = R.uniform(-2.2, 2.2), R.uniform(-1.2, 1.2)
        box(B("stile"), (x, y, 0.08), (x + 0.3, y + 0.24, 0.11), 0.0, rot=(jit(0.4), jit(0.4), R.uniform(0, 3)))


if B1:
    build1()
else:
    walls()
    roof()
    surroundings() if not B2 else K.ground_patch(B("mud"), 0.0, -0.5, 5.8, 4.4, h=0.04, n=24, rings=4, bump=0.04,
                                                 seed=3.0)
    if B2:
        build2()
    if RUIN:
        ruin_extras()
    box(B("floor", "ashlar"), (X0 + TH, Y0 + TH, 0.0), (X1 - TH, Y1 - TH, 0.07))

K.finalize("chapel" if FULL else "chapel_" + STATE, tex=1024, lods=(1.0, 0.4, 0.12))
