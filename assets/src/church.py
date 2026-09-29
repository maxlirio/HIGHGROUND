"""HIGHGROUND - village parish church (13th-14th c., northern England).

West tower (battlemented, angle buttresses, louvred belfry lights, low lead pyramid + weathervane),
aisleless nave ~14 x 9 m with a stone-tile roof and stepped buttresses, lower chancel with a
triple-lancet east window, gabled south porch, lancet windows set deep in dressed surrounds,
churchyard wall with gate piers, leaning headstones and crosses, an old yew.

    blender -b -P assets/src/church.py -- <state>     state = complete | build1 | build2 | ruin
    (or HG_STATE=ruin blender -b -P assets/src/church.py)

Front (porch side, south) faces -Y. West = -X. 1 unit = 1 m.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _parish_kit as K
from _parish_kit import (B, Batch, Face, box, beam, cyl, prism_hull, jit, R, TRS, window, slit, door_leaf,
                         slab_poly, broken_top, wall, top_prof, string_course, quoins, plinth, merlons, corbels, buttress,
                         apply_boolean, cutter_obj, SOLIDS, BATCHES)

STATE, FULL, RUIN, B1, B2 = K.STATE, K.FULL, K.RUIN, K.B1, K.B2
K.begin(seed=23)
K.NO_CULL += ["wall_", "tower"]

# ------------------------------------------------------------------ materials
ch = 0.85 if RUIN else 0.0
M = K.MAT
M["rubble"] = K.m_stone("rubble", [(0.0, "#978c76"), (0.25, "#b0a489"), (0.5, "#bfb194"), (0.75, "#a89b81"),
                                    (1.0, "#8f8572")], "#756e5e", rowh=0.25, bw=0.5, charred=ch * 0.8,
                        moss=0.08 if (B1 or B2) else 1.0)
M["ashlar"] = K.m_stone("ashlar", [(0.0, "#a1967e"), (0.4, "#b4a98f"), (0.7, "#aca087"), (1.0, "#978c77")],
                        "#9a9280", joints=False, bump=0.6, charred=ch * 0.6,
                        moss=0.08 if (B1 or B2) else 1.0)
M["stile"] = K.m_tiles("stile", [(0.0, "#5e574c"), (0.3, "#716858"), (0.6, "#7f7562"), (0.85, "#8a7f6a"),
                                  (1.0, "#5b554b")], cell=0.3, curve=0.18, lichen=1.6, moss=1.1, charred=ch)
M["lead"] = K.m_simple("lead", "#57595a", "#6b6c6a", 0.7, 1.5)
M["oak"] = K.m_wood("oak", [(0.0, "#4e3b27"), (0.5, "#5f4830"), (1.0, "#6b5236")], weather_hex="#7d7466",
                    weathered=0.55, fresh=0.05 if not (B1 or B2) else 0.5, charred=ch)
M["plank"] = K.m_wood("plank", [(0.0, "#6f6353"), (0.5, "#80766a"), (1.0, "#8d8272")], weather_hex="#8f887c",
                      weathered=0.5, fresh=0.0 if not (B1 or B2) else 0.6, charred=ch, grain_k=1.2)
M["char"] = K.m_wood("char", [(0.0, "#2b2622"), (1.0, "#3d352e")], weather_hex="#4a443d", weathered=0.3,
                     charred=1.0)
M["iron"] = K.m_simple("iron", "#35332f", "#45403a", 0.72, rust=True)
M["dark"] = K.m_glass("glass") if FULL else K.m_simple("dark", "#231f1b", "#2f2923", 0.92)
M["turf"] = K.m_ground("turf", wet=0.0, grass=0.95)
M["path"] = K.m_ground("path", wet=0.3, grass=0.05, gravel=0.45)
M["mud"] = K.m_ground("mud", wet=0.6, grass=0.25 if not (B1 or B2) else 0.12)
M["soilm"] = K.m_ground("soilm", wet=0.1, grass=0.0)
M["yew"] = K.m_foliage("yew", dark="#18221a", light="#2c3a1e", berries=True)
M["bark"] = K.m_bark("bark", charred=0.0)
M["rope"] = K.m_rope("rope")
M["floor"] = K.m_stone("floor", [(0.0, "#8a8170"), (0.5, "#9c927f"), (1.0, "#7f7766")], "#5f594e",
                       rowh=0.6, bw=0.75, charred=ch * 0.5, moss=0.2)

# ------------------------------------------------------------------ plan
TX0, TX1, TY0, TY1 = -12.6, -7.6, -2.5, 2.5           # west tower
TOP = 14.9                                            # tower wall-walk
NX0, NX1, NY0, NY1 = -7.6, 6.2, -4.5, 4.5             # nave
NH, TH = 5.4, 0.85
CX0, CX1, CY0, CY1 = 6.2, 13.0, -3.3, 3.3             # chancel
CHH = 4.5
PX0, PX1, PY0, PY1 = -5.8, -2.6, -7.9, NY0            # south porch
PH, PTH = 2.9, 0.6
PN, PC, PP = math.radians(50), math.radians(50), math.radians(48)
DOOR_X = (PX0 + PX1) / 2

# construction caps
if B2:
    CAP_T, CAP_N, CAP_C, CAP_P = 7.6, 3.3, 2.6, 1.3
elif B1:
    CAP_T = CAP_N = CAP_C = CAP_P = 0.0
else:
    CAP_T, CAP_N, CAP_C, CAP_P = 99, 99, 99, 99


def fits(v_top, cap):
    return v_top + 0.35 < cap


# ------------------------------------------------------------------ wall shells
def win(f, cut, u, v0, w, h, kind="lancet", twin=False, depth=0.6, cap=99, through=False):
    if not fits(v0 + h, cap):
        return
    window(f, cut, u, v0, w, h, kind, depth=(TH + 0.5 if (RUIN or through) else depth), twin=twin,
           backdark=not (RUIN or through))


fS = Face((NX0, NY0, 0), (0, -1, 0))     # u = x - NX0
fN = Face((NX1, NY1, 0), (0, 1, 0))      # u = NX1 - x
fE = Face((NX1, NY0, 0), (1, 0, 0))      # u = y - NY0
fW = Face((NX0, NY1, 0), (-1, 0, 0))     # u = NY1 - y
LN, WN = NX1 - NX0, NY1 - NY0

cS = Face((CX0, CY0, 0), (0, -1, 0))
cN = Face((CX1, CY1, 0), (0, 1, 0))
cE = Face((CX1, CY0, 0), (1, 0, 0))
LC, WC = CX1 - CX0, CY1 - CY0

tS = Face((TX0, TY0, 0), (0, -1, 0))
tE = Face((TX1, TY0, 0), (1, 0, 0))
tN = Face((TX1, TY1, 0), (0, 1, 0))
tW = Face((TX0, TY1, 0), (-1, 0, 0))
LT = TX1 - TX0

pS = Face((PX0, PY0, 0), (0, -1, 0))
pE = Face((PX1, PY0, 0), (1, 0, 0))
pW = Face((PX0, PY1, 0), (-1, 0, 0))
LPX, LPY = PX1 - PX0, PY1 - PY0


def nave_south(f, cut):
    cap = CAP_N
    # south door inside the porch
    if fits(2.5, cap) or B2:
        window(f, cut, DOOR_X - NX0, 0.0, 1.25, 2.45, "lancet", depth=TH + 0.5 if RUIN else 0.55,
               backdark=not RUIN)
        if FULL:
            door_leaf(f, DOOR_X - NX0, 0.0, 1.2, 2.2, 0.5, arch=True)
    if not RUIN:
        win(f, cut, 0.2 - NX0, 2.0, 0.52, 2.35, twin=True, cap=cap)
    win(f, cut, 4.2 - NX0, 2.0, 0.62, 2.7, cap=cap)


def nave_north(f, cut):
    cap = CAP_N
    win(f, cut, NX1 - 4.2, 2.0, 0.6, 2.6, cap=cap)
    win(f, cut, NX1 - 0.2, 2.0, 0.52, 2.35, twin=True, cap=cap)
    win(f, cut, NX1 + 4.2, 2.1, 0.55, 2.3, cap=cap)
    # blocked north door: a dressed arch with rubble fill (cut shallow)
    if fits(2.4, cap) and not RUIN:
        window(f, cut, NX1 + 4.2 - 1.9, 0.0, 1.1, 2.3, "lancet", depth=0.08, backdark=False)


def chancel_south(f, cut):
    cap = CAP_C
    win(f, cut, 1.5, 1.7, 0.5, 2.2, cap=cap)
    win(f, cut, 5.3, 1.7, 0.5, 2.2, cap=cap)
    # priest's door
    if fits(2.0, cap):
        window(f, cut, 3.4, 0.0, 0.85, 2.0, "lancet", depth=TH + 0.5 if RUIN else 0.5, backdark=not RUIN)
        if not RUIN:
            door_leaf(f, 3.4, 0.0, 0.8, 1.8, 0.45, arch=True)


def chancel_north(f, cut):
    win(f, cut, LC - 1.8, 1.7, 0.5, 2.2, cap=CAP_C)
    win(f, cut, LC - 4.8, 1.7, 0.5, 2.2, cap=CAP_C)


def chancel_east(f, cut):
    c = WC / 2
    win(f, cut, c, 1.5, 0.56, 3.3, cap=CAP_C)
    win(f, cut, c - 0.95, 1.5, 0.5, 2.7, cap=CAP_C)
    win(f, cut, c + 0.95, 1.5, 0.5, 2.7, cap=CAP_C)


def porch_south(f, cut):
    if B1:
        return
    # open entrance arch, cut right through
    window(f, cut, LPX / 2, 0.0, 1.55, 2.55 if fits(2.55, CAP_P) else 3.0, "lancet", depth=PTH + 0.6,
           backdark=False, surround=fits(2.55, CAP_P))


def porch_side(f, cut):
    if fits(1.6, CAP_P):
        window(f, cut, LPY / 2 + 0.2, 0.9, 0.22, 0.7, "lancet", depth=PTH + 0.5, backdark=False)


# ---------------------------------------------------------------------------- NAVE + CHANCEL
def nave():
    capn = CAP_N
    gE = (WN / 2, PN)
    # long walls
    wall("nS", fS, top_prof(0.0, LN, NH, capn, 1.0, ruin=(3.2, 10.2, [(6.3, 9.3, 3.4), (3.4, 5.2, 0.8)])), TH, nave_south)
    wall("nN", fN, top_prof(0.0, LN, NH, capn, 2.0, ruin=(3.6, 10.6, [(7.2, 9.4, 1.6)]),
                              protect=((5.0, 7.0, 4.7), (9.6, 11.0, 4.5))), TH, nave_north)
    # east wall + gable
    if FULL or RUIN:
        prof = top_prof(TH, WN - TH, NH, capn, 3.0, gable=gE)
        if RUIN:   # gable apex fallen
            prof = [(TH, 0.0), (WN - TH, 0.0), (WN - TH, NH + 0.4), (WN / 2 + 1.1, NH + 2.6), (WN / 2 + 0.3, NH + 1.9),
                    (WN / 2 - 0.6, NH + 3.2), (WN / 2 - 1.4, NH + 2.8), (TH, NH + 0.6)]
        wall("nE", fE, prof, TH)
        wall("nW", fW, top_prof(TH, WN - TH, NH, capn, 4.0, gable=gE), TH)
    else:
        wall("nE", fE, top_prof(TH, WN - TH, NH, capn, 3.0), TH)
        wall("nW", fW, top_prof(TH, WN - TH, NH, capn, 4.0), TH)
    plinth_run([(NX0, NY0), (PX0, NY0)], 0.75, closed=False)
    plinth_run([(PX1, NY0), (NX1, NY0), (NX1, NY1), (NX0, NY1)], 0.75, closed=False)
    # buttresses (stepped, two set-offs)
    hb = min(4.1, capn - 0.2)
    if hb > 0.8:
        for f, us in ((fS, (-1.8 - NX0, 2.2 - NX0, LN - 0.45)), (fN, (NX1 - 2.2, NX1 + 1.8, 0.45, LN - 0.45)),
                      (fE, (0.45, WN - 0.45)), (fW, (0.45, WN - 0.45))):
            for u in us:
                if f is fW:
                    continue
                buttress(f, B("ashlar_b", "rubble"), u, depth=0.8, w=0.66, h=hb, offsets=2)
    if FULL or RUIN:
        for c, a, b in (((NX1, NY0), (0, -1, 0), (1, 0, 0)), ((NX1, NY1), (1, 0, 0), (0, 1, 0))):
            quoins(c, a, b, 0.75, NH - (1.2 if RUIN else 0.0))
        # eaves course under the roof
        if FULL:
            for f, L_ in ((fS, LN), (fN, LN)):
                f.prism_dv(B("ashlar"), [(-0.16, NH - 0.28), (0.3, NH - 0.28), (0.3, NH + 0.02), (-0.16, NH + 0.02)],
                           -0.1, L_ + 0.1)


def chancel():
    cap = CAP_C
    wall("cS", cS, top_prof(-0.3, LC, CHH, cap, 5.0), TH, chancel_south)
    wall("cN", cN, top_prof(0.0, LC + 0.3, CHH, cap, 6.0), TH, chancel_north)
    g = (WC / 2, PC) if (FULL or RUIN) else None
    prof = top_prof(TH, WC - TH, CHH, cap, 7.0, gable=g)
    wall("cE", cE, prof, TH, chancel_east)
    plinth_run([(CX0 - 0.1, CY0), (CX1, CY0), (CX1, CY1), (CX0 - 0.1, CY1)], 0.7, closed=False, start=0)
    hb = min(3.4, cap - 0.2)
    if hb > 0.8:
        for f, us in ((cS, (LC - 0.42,)), (cN, (0.42,)), (cE, (0.42, WC - 0.42))):
            for u in us:
                buttress(f, B("ashlar_b", "rubble"), u, depth=0.75, w=0.6, h=hb, offsets=2)
    if FULL or RUIN:
        for c, a, b in (((CX1, CY0), (0, -1, 0), (1, 0, 0)), ((CX1, CY1), (1, 0, 0), (0, 1, 0))):
            quoins(c, a, b, 0.7, CHH - (0.9 if RUIN else 0.0))
        if FULL:
            for f in (cS, cN):
                f.prism_dv(B("ashlar"), [(-0.15, CHH - 0.26), (0.3, CHH - 0.26), (0.3, CHH + 0.02), (-0.15, CHH + 0.02)],
                           -0.3, LC + 0.1)


def plinth_run(ol, h, closed=True, start=None):
    if B1:
        return
    plinth(ol, closed=closed, h=h, proud=0.22, bt=B("plinth", "ashlar"))


# ---------------------------------------------------------------------------- TOWER
def tower():
    top = min(TOP, CAP_T)
    if RUIN:
        top = 12.6
    if B1:
        return
    bt = Batch("tower", "rubble")
    if RUIN:
        # broken crown: west side stands higher than east
        box(bt, (TX0, TY0, 0), (TX1, TY1, top - 1.0))
    elif B2:
        box(bt, (TX0, TY0, 0), (TX1, TY1, top - 1.6))
        for i, f in enumerate((tS, tE, tN, tW)):
            pr = top_prof(0.0, LT - 0.9, top, top, 20.0 + i)
            pr = [(u, top - 1.7) if v == 0.0 else (u, v) for (u, v) in pr]
            wall("tr%d" % i, f, pr, 0.9)
    else:
        box(bt, (TX0, TY0, 0), (TX1, TY1, top))
    SOLIDS.append(((TX0 + 0.05, TY0 + 0.05, 0.0), (TX1 - 0.05, TY1 - 0.05, top - (1.0 if RUIN else (1.6 if B2 else 0.0)))))
    cut = Batch("tcut", "dark")
    # west door + window over
    if top > 3.2:
        window(tW, cut, LT / 2, 0.0, 1.2, 2.5, "lancet", depth=0.6, backdark=True)
        door_leaf(tW, LT / 2, 0.0, 1.15, 2.25, 0.55, arch=True) if not RUIN else None
    if top > 7.4:
        window(tW, cut, LT / 2, 4.6, 0.7, 2.3, "lancet", depth=0.7)
    for f in (tS, tN):
        if top > 5.0:
            slit(f, cut, LT / 2 + jit(0.1), 3.4)
        if top > 8.6:
            slit(f, cut, LT / 2 + jit(0.1), 7.0)
    # belfry: twin louvred lancets on all four faces
    if top > 13.4 and not RUIN:
        for f in (tS, tE, tN, tW):
            window(f, cut, LT / 2, 11.3, 0.46, 1.9, "lancet", twin=True, depth=0.55)
            for uc in (LT / 2 - 0.35, LT / 2 + 0.35):
                for k in range(6):
                    v = 11.45 + k * 0.25
                    beam(B("plank"), f.p(uc - 0.24, 0.27, v + 0.12), f.p(uc + 0.24, 0.27, v + 0.12), 0.2, 0.025,
                         0.0, side=tuple(f.up * 0.5 + f.inw * 0.8))
    elif RUIN:
        for f in (tS, tE):
            window(f, cut, LT / 2, 8.0, 0.46, 1.9, "lancet", twin=True, depth=0.7, backdark=True)
    if cut.F:
        ob = bt.build(); bt._built = True
        apply_boolean(ob, cutter_obj(cut))
    else:
        bt.build(); bt._built = True

    ol = [(TX0, TY0), (TX1, TY0), (TX1, TY1), (TX0, TY1)]
    plinth([(TX0, -0.9), (TX0, TY0), (TX1, TY0), (TX1, TY1), (TX0, TY1), (TX0, 0.9)], closed=False, h=1.0,
           proud=0.3, bt=B("plinth", "ashlar"))
    for z in (6.1, 10.7):
        if z < top - 0.4:
            string_course(ol, z, proud=0.12, bt=B("ashlar"))
    # angle buttresses at each corner, three set-offs
    hb = min(9.6, top - 0.3)
    for f in (tS, tE, tN, tW):
        for u in (0.42, LT - 0.42):
            if f is tE and top > 6:
                continue
            buttress(f, B("ashlar_b", "rubble"), u, depth=0.85 if hb > 6 else 0.8, w=0.8, h=hb, offsets=3)
    zq = hb + 0.2
    if top > zq + 0.6:
        for c, a, b in (((TX0, TY0), (-1, 0, 0), (0, -1, 0)), ((TX1, TY0), (0, -1, 0), (1, 0, 0)),
                        ((TX0, TY1), (0, 1, 0), (-1, 0, 0)), ((TX1, TY1), (1, 0, 0), (0, 1, 0))):
            quoins(c, a, b, zq, top - (0.0 if not RUIN else 1.4))
    if RUIN:
        K.NO_CULL.append("crown")
        crown_ruin(top)
        return
    if top < TOP - 0.01:
        return
    # parapet on a corbel table, merlons, corner pinnacles, lead pyramid + weathervane
    th = 0.36
    pb = B("rubble")
    box(pb, (TX0, TY0, top), (TX1, TY0 + th, top + 0.72))
    box(pb, (TX0, TY1 - th, top), (TX1, TY1, top + 0.72))
    box(pb, (TX0, TY0 + th, top), (TX0 + th, TY1 - th, top + 0.72))
    box(pb, (TX1 - th, TY0 + th, top), (TX1, TY1 - th, top + 0.72))
    for f in (tS, tE, tN, tW):
        f.prism_dv(B("ashlar"), [(-0.2, top - 0.05), (0.15, top - 0.05), (0.15, top + 0.16), (-0.2, top + 0.16)],
                   -0.2, LT + 0.2)
        corbels(f, 0.3, LT - 0.3, top - 0.05, proud=0.18, step=0.55)
        merlons(f, 0.55, LT - 0.55, top + 0.72, -0.2, th, mw=0.62, gap=0.5, mh=0.82, bt=B("rubble"))
        # coping on the parapet
        f.prism_dv(B("ashlar"), [(-0.23, top + 0.7), (th + 0.03, top + 0.7), (th + 0.03, top + 0.8),
                                 (th / 2 - 0.1, top + 0.86), (-0.23, top + 0.8)], -0.2, LT + 0.2)
    for (x, y) in ((TX0, TY0), (TX1, TY0), (TX1, TY1), (TX0, TY1)):
        x0, x1 = (x - 0.2, x + 0.45) if x == TX0 else (x - 0.45, x + 0.2)
        y0, y1 = (y - 0.2, y + 0.45) if y == TY0 else (y - 0.45, y + 0.2)
        box(B("rubble"), (x0, y0, top + 0.72), (x1, y1, top + 1.9))
        box(B("ashlar"), (x0 - 0.05, y0 - 0.05, top + 1.85), (x1 + 0.05, y1 + 0.05, top + 2.0), 0.02)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        prism_hull(B("ashlar"), [(x0, y0, top + 2.0), (x1, y0, top + 2.0), (x0, y1, top + 2.0), (x1, y1, top + 2.0),
                                 (cx, cy, top + 3.05)])
        cyl(B("ashlar"), (cx, cy, top + 3.0), (cx, cy, top + 3.2), 0.07, 0.03, n=6)
    # lead pyramid
    cx, cy = (TX0 + TX1) / 2, (TY0 + TY1) / 2
    e = 0.45
    ap = top + 2.6
    for (a, b) in (((TX0 + e, TY0 + e), (TX1 - e, TY0 + e)), ((TX1 - e, TY0 + e), (TX1 - e, TY1 - e)),
                   ((TX1 - e, TY1 - e), (TX0 + e, TY1 - e)), ((TX0 + e, TY1 - e), (TX0 + e, TY0 + e))):
        prism_hull(B("lead"), [(a[0], a[1], top + 0.35), (b[0], b[1], top + 0.35), (cx, cy, ap),
                               (a[0], a[1], top + 0.25), (b[0], b[1], top + 0.25)])
        # lead roll seams
        for t in (0.33, 0.66):
            p = Vector(a).lerp(Vector(b), t)
            cyl(B("lead"), (p.x, p.y, top + 0.37), (cx + (p.x - cx) * 0.08, cy + (p.y - cy) * 0.08, ap - 0.2), 0.03, n=4)
    # weathervane: rod, arms, cockerel plate
    cyl(B("iron"), (cx, cy, ap - 0.1), (cx, cy, ap + 2.3), 0.035, 0.025, n=6)
    cyl(B("iron"), (cx - 0.5, cy, ap + 1.2), (cx + 0.5, cy, ap + 1.2), 0.015, n=4)
    cyl(B("iron"), (cx, cy - 0.5, ap + 1.2), (cx, cy + 0.5, ap + 1.2), 0.015, n=4)
    ck = [(-0.45, 0.0), (0.35, 0.0), (0.38, 0.22), (0.2, 0.42), (0.05, 0.3), (-0.12, 0.34), (-0.45, 0.5)]
    prism_hull(B("iron"), [(cx + u, cy + d, ap + 1.55 + v) for (u, v) in ck for d in (-0.015, 0.015)])
    cyl(B("iron"), (cx, cy, ap + 0.35), (cx, cy, ap + 0.55), 0.09, 0.05, n=8)


def crown_ruin(top):
    """broken belfry stage: ragged masonry courses, a gap to the east, a hanging bell-frame timber."""
    bt = B("crown", "rubble")
    for (ax, ay, bx, by) in ((TX0, TY0, TX1, TY0 + 0.9), (TX0, TY1 - 0.9, TX1, TY1), (TX0, TY0, TX0 + 0.9, TY1),
                             (TX1 - 0.9, TY0, TX1, TY1)):
        lx, ly = bx - ax, by - ay
        along = lx > ly
        n = int((lx if along else ly) / 0.5)
        for i in range(n):
            a = (ax if along else ay) + i * (lx if along else ly) / n
            west = (ax + i * lx / n) if along else ax
            hmax = 2.2 * max(0.2, 1.0 - (west - TX0) / 6.5)
            pos = a * 0.9 + (ay if along else ax) * 0.37
            hh = hmax * (0.6 + 0.55 * K.MN.noise(Vector((pos * 0.45, 2.3, 0.7)))) + R.uniform(-0.12, 0.12)
            hh = max(0.15, hh)
            l = (lx if along else ly) / n * R.uniform(0.85, 1.0)
            if along:
                box(bt, (a, ay + R.uniform(0, 0.15), top - 1.1), (a + l, by - R.uniform(0, 0.15), top - 1.0 + hh),
                    0.03, rot=(jit(0.03), jit(0.03), jit(0.05)))
            else:
                box(bt, (ax + R.uniform(0, 0.15), a, top - 1.1), (bx - R.uniform(0, 0.15), a + l, top - 1.0 + hh),
                    0.03, rot=(jit(0.03), jit(0.03), jit(0.05)))
    for i in range(12):
        x, y = R.uniform(TX0 + 0.9, TX1 - 0.9), R.uniform(TY0 + 0.9, TY1 - 0.9)
        sz = R.uniform(0.25, 0.55)
        box(bt, (x - sz / 2, y - sz / 2, top - 1.05), (x + sz / 2, y + sz * 0.3, top - 1.0 + sz * 0.6), 0.03,
            rot=(jit(0.4), jit(0.4), R.uniform(0, 3)))
    # charred bell-frame beams jutting
    beam(B("char"), (TX0 + 0.6, TY0 + 1.0, top - 0.6), (TX1 + 0.5, TY0 + 1.6, top - 1.9), 0.25, 0.25, 0.01)
    beam(B("char"), (TX0 + 0.6, TY1 - 1.0, top - 0.8), (TX1 - 1.2, TY1 - 1.3, top + 0.1), 0.22, 0.22, 0.01)


# ---------------------------------------------------------------------------- PORCH
def porch():
    if B1:
        return
    cap = CAP_P
    g = (LPX / 2, PP) if (FULL or RUIN) else None
    wall("pS", pS, top_prof(0.0, LPX, PH, cap, 11.0, gable=g), PTH, porch_south)
    wall("pE", pE, top_prof(PTH, LPY, PH, cap, 12.0), PTH, porch_side)
    wall("pW", pW, top_prof(0.0, LPY - PTH, PH, cap, 13.0), PTH, porch_side)
    plinth([(PX0, PY1), (PX0, PY0), (DOOR_X - 0.95, PY0)], closed=False, h=0.5, proud=0.16, bt=B("plinth", "ashlar"))
    plinth([(DOOR_X + 0.95, PY0), (PX1, PY0), (PX1, PY1)], closed=False, h=0.5, proud=0.16, bt=B("plinth", "ashlar"))
    # stone benches along the inside + flagged floor
    if FULL or RUIN:
        for x0, x1 in ((PX0 + PTH, PX0 + PTH + 0.42), (PX1 - PTH - 0.42, PX1 - PTH)):
            box(B("ashlar"), (x0, PY0 + PTH + 0.05, 0.0), (x1, PY1 - 0.05, 0.45), 0.02)
        box(B("floor"), (PX0 + PTH - 0.02, PY0 + 0.1, 0.0), (PX1 - PTH + 0.02, PY1, 0.06))
    if FULL:
        I = Matrix.Translation(((PX0 + PX1) / 2, 0, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Z")
        half = LPX / 2
        K.gable_roof(B("stile"), I, PY0 - 0.3, PY1 + 0.25, 0.0, half, PH, PP, over=0.3, row_w=0.3, thick=0.03,
                     lift=0.028, sag=0.03, seg=5, ridge_bt=B("ashlar"), ridge_r=0.12)
        K.coping(B("ashlar"), I, PY0 + 0.25, 0.0, half, PH, PP, w=0.55, t=0.16, out=0.14, kneeler=True, cross=True)


# ---------------------------------------------------------------------------- ROOFS
def roofs():
    I = Matrix.Identity(4)
    half_n, half_c = WN / 2, WC / 2
    if FULL:
        K.gable_roof(B("stile"), I, NX0 + 0.1, NX1 - 0.05, 0.0, half_n, NH, PN, over=0.38, row_w=0.32,
                     thick=0.035, lift=0.03, sag=0.07, seg=8, ridge_bt=B("ashlar"), ridge_r=0.14)
        K.gable_roof(B("stile"), I, NX1 - 0.3, CX1 - 0.05, 0.0, half_c, CHH, PC, over=0.34, row_w=0.32,
                     thick=0.035, lift=0.03, sag=0.05, seg=6, ridge_bt=B("ashlar"), ridge_r=0.13)
        K.coping(B("ashlar"), I, NX1 - 0.32, 0.0, half_n, NH, PN, w=0.7, t=0.18, out=0.3, kneeler=True, cross=True)
        K.coping(B("ashlar"), I, CX1 - 0.3, 0.0, half_c, CHH, PC, w=0.64, t=0.17, out=0.27, kneeler=True, cross=True)
        # west gable coping (the parts clear of the tower)
        K.coping(B("ashlar"), I, NX0 + 0.3, 0.0, half_n, NH, PN, w=0.64, t=0.17, out=0.3, kneeler=True)
    elif RUIN:
        # nave: the east bay holds, the middle has fallen in, burnt rafters stand over the gap
        s = lambda t: t < 0.55
        K.gable_roof(B("stile"), I, 2.6, NX1 - 0.05, 0.0, half_n, NH, PN, over=0.38, row_w=0.32, thick=0.035,
                     lift=0.03, sag=0.22, seg=6, stop_a=lambda t: t < 0.62, stop_b=lambda t: t < 0.85)
        K.gable_roof(B("stile"), I, NX0 + 0.1, -4.4, 0.0, half_n, NH, PN, over=0.38, row_w=0.32, thick=0.035,
                     lift=0.03, sag=0.1, seg=4, stop_a=lambda t: t < 0.3, stop_b=lambda t: t < 0.75)

        def keep(x, sg):
            if x > 2.6:
                return 1.0 if R.random() < 0.8 else R.uniform(0.3, 0.8)
            if x < -4.6:
                return R.uniform(0.6, 1.0)
            return 0.0
        K.rafters(B("char"), I, NX0 + 0.5, NX1 - 0.6, 0.0, half_n, NH, PN, spacing=0.7, keep=keep)
        # chancel roof sagging but mostly on, a burnt hole on the south slope
        K.gable_roof(B("stile"), I, NX1 - 0.3, CX1 - 0.05, 0.0, half_c, CHH, PC, over=0.34, row_w=0.32,
                     thick=0.035, lift=0.03, sag=0.3, seg=6, stop_a=lambda t: t < 0.35 or t > 0.8)
        K.rafters(B("char"), I, NX1, CX1 - 0.4, 0.0, half_c, CHH, PC, spacing=0.8,
                  keep=lambda x, sg: 1.0 if sg > 0 else R.uniform(0.4, 1.0))
        K.coping(B("ashlar"), I, CX1 - 0.3, 0.0, half_c, CHH, PC, w=0.64, t=0.17, out=0.27, kneeler=True)
    elif B2:
        pass


# ---------------------------------------------------------------------------- CHURCHYARD
YX0, YX1, YY0, YY1 = -16.2, 16.8, -12.4, 7.6
GATE = (DOOR_X - 1.1, DOOR_X + 1.1)


def churchyard():
    # turf inside the wall, gravel path gate -> porch
    nx, ny = 12, 8
    P, F = [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = YX0 + 0.2 + (YX1 - YX0 - 0.4) * i / nx
            y = YY0 + 0.2 + (YY1 - YY0 - 0.4) * j / ny
            edge = i in (0, nx) or j in (0, ny)
            P.append((x, y, 0.02 if edge else 0.06 + K.MN.noise(Vector((x * 0.2, y * 0.2, 0.5))) * 0.05))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            F.append((a, a + 1, a + nx + 2, a + nx + 1))
    B("turf").add(P, F)
    # path: a strip of irregular gravel from the gate up to the porch (slightly proud of the turf)
    P, F = [], []
    ys = [YY0 + 0.1 + (PY0 - YY0 - 0.1) * k / 6 for k in range(7)]
    for k, y in enumerate(ys):
        c = DOOR_X + math.sin(k * 0.9) * 0.15
        w = 0.85 + jit(0.12)
        P += [(c - w, y, 0.075), (c + w, y, 0.075)]
    for k in range(6):
        F.append((2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2))
    B("path").add(P, F)
    # bare trodden apron at the porch mouth
    K.ground_patch(B("path"), DOOR_X, PY0 - 0.5, 1.5, 0.8, h=0.085, n=14, rings=2, bump=0.01, seed=4.0)

    pts = [(GATE[1], YY0), (YX1, YY0), (YX1, YY1), (YX0, YY1), (YX0, YY0), (GATE[0], YY0)]
    broken = None
    if RUIN:
        broken = lambda u: 0.35 if 30 < u < 34.5 or 70 < u < 73 else 1.0
    K.dry_wall(B("ywall", "rubble"), pts, h=1.15, th=0.62, closed=False, piece=1.6, broken=broken,
               cope_bt=B("ycope", "ashlar"))
    # gate piers with capstones, a half-open timber gate
    for x in GATE:
        box(B("ashlar"), (x - 0.3, YY0 - 0.32, 0.0), (x + 0.3, YY0 + 0.32, 1.55), 0.02)
        box(B("ashlar"), (x - 0.36, YY0 - 0.38, 1.55), (x + 0.36, YY0 + 0.38, 1.7), 0.03)
        prism_hull(B("ashlar"), [(x + a, YY0 + b, 1.7) for a in (-0.3, 0.3) for b in (-0.32, 0.32)] + [(x, YY0, 1.95)])
    if not RUIN:
        hx = GATE[0] + 0.3
        ang = math.radians(62)
        d = Vector((math.cos(ang), math.sin(ang), 0))
        for z in (0.25, 0.75, 1.15):
            beam(B("plank"), (hx, YY0, z), tuple(Vector((hx, YY0, z)) + d * 1.5), 0.1, 0.06, 0.006)
        for t in (0.05, 0.5, 0.95):
            p = Vector((hx, YY0, 0)) + d * (1.5 * t)
            beam(B("plank"), (p.x, p.y, 0.15), (p.x, p.y, 1.25), 0.09, 0.05, 0.006)
        beam(B("plank"), (hx, YY0, 0.25), tuple(Vector((hx, YY0, 1.15)) + d * 1.45), 0.08, 0.045, 0.006)
    else:
        beam(B("char"), (GATE[0] + 0.4, YY0 - 0.6, 0.05), (GATE[0] + 1.8, YY0 - 1.2, 0.12), 0.9, 0.06, 0.006,
             side=(0, 0, 1))
    # graves: headstones (some leaning hard), crosses, low mounds
    graves = [(-0.6, -9.6, 0), (0.6, -9.9, 1), (1.9, -9.5, 0), (3.3, -10.2, 2), (4.6, -9.7, 0), (6.2, -9.9, 0),
              (7.5, -10.4, 1), (9.0, -9.6, 0), (10.6, -10.0, 2), (12.2, -9.7, 0), (8.2, -7.2, 0), (10.0, -7.0, 1),
              (12.0, -6.8, 0), (14.4, -6.2, 0), (14.8, -2.0, 1), (14.9, 1.5, 0), (-0.8, -7.2, 0), (0.9, -6.8, 1),
              (-9.4, -10.9, 0), (-8.0, -10.6, 1), (-8.4, -6.9, 0)]
    for (x, y, kind) in graves:
        lean = R.choice((0.0, 0.05, jit(0.12), jit(0.3), -0.35 if R.random() < 0.3 else 0.08))
        s = R.uniform(0.85, 1.15)
        K.headstone(B("hstone", "ashlar"), x + jit(0.1), y + jit(0.1), kind, lean, jit(0.12), s)
        K.ground_patch(B("turf"), x, y + 0.9, 0.45, 0.95, h=0.11, n=10, rings=2, bump=0.0, seed=x)
    # table tomb
    tx, ty = 3.5, -7.1
    box(B("ashlar"), (tx - 1.0, ty - 0.45, 0.0), (tx + 1.0, ty + 0.45, 0.72), 0.02)
    box(B("ashlar"), (tx - 1.12, ty - 0.56, 0.72), (tx + 1.12, ty + 0.56, 0.86), 0.03, rot=(0.0, 0.015 if not RUIN else 0.12, 0.01))
    # the yew, SW corner, on a slight mound
    K.ground_patch(B("turf"), -12.2, -8.2, 2.6, 2.4, h=0.3, n=16, rings=3, bump=0.04, seed=7.0)
    K.yew(-12.2, -8.2, s=1.0, seed=3.0, crown=True, cards=0.75, atlas_name="church_yew_leaves")


# ---------------------------------------------------------------------------- CONSTRUCTION / RUIN extras
def site_ground():
    K.ground_patch(B("mud"), 0.0, -1.0, 17.5, 9.5, h=0.04, n=28, rings=4, bump=0.05, seed=1.0)


def build1():
    site_ground()
    # footing trenches: a low course of rubble along every wall line, wider than the wall
    fb = B("footing", "rubble")
    for (x0, y0, x1, y1, h) in ((NX0, NY0, NX1, NY0 + TH, 0.5), (NX0, NY1 - TH, NX1, NY1, 0.45),
                                (NX1 - TH, NY0, NX1, NY1, 0.35), (CX0, CY0, CX1, CY0 + TH, 0.4),
                                (CX0, CY1 - TH, CX1, CY1, 0.3), (CX1 - TH, CY0, CX1, CY1, 0.25),
                                (TX0, TY0, TX1, TY1, 0.9)):
        L_ = max(x1 - x0, y1 - y0)
        along = (x1 - x0) > (y1 - y0)
        u = 0.0
        while u < L_ - 0.05:
            l = min(R.uniform(0.9, 1.6), L_ - u)
            hh = h * R.uniform(0.6, 1.0) if R.random() < 0.8 else h * 0.3
            if along:
                box(fb, (x0 + u - 0.1, y0 - 0.15, -0.1), (x0 + u + l + 0.1, y1 + 0.15, hh), 0.03, rot=(0, 0, jit(0.01)))
            else:
                box(fb, (x0 - 0.15, y0 + u - 0.1, -0.1), (x1 + 0.15, y0 + u + l + 0.1, hh), 0.03, rot=(0, 0, jit(0.01)))
            u += l
    # open trench (dark earth) where the west nave wall and porch will go
    # spoil heaps thrown up beside the trenches
    for (x, y, rx, ry) in ((NX0 + 1.4, 0.0, 0.8, 3.2), (DOOR_X, PY0 - 1.2, 1.6, 0.7), (4.0, NY1 + 1.4, 3.0, 0.8),
                           (CX1 + 1.5, 0.0, 0.8, 2.4), (-10.0, TY1 + 1.5, 2.0, 0.8)):
        K.ground_patch(B("spoil", "soilm"), x, y, rx, ry, h=0.32, n=14, rings=3, bump=0.06, seed=x + y)
    # setting-out: stakes at corners, strung lines
    corners = [(NX0, NY0), (NX1, NY0), (NX1, NY1), (NX0, NY1), (CX1, CY0), (CX1, CY1), (PX0, PY0), (PX1, PY0),
               (TX0, TY0), (TX0, TY1)]
    for (x, y) in corners:
        for dx, dy in ((-0.7, 0), (0, -0.7)):
            cyl(B("plank"), (x + dx, y + dy, -0.05), (x + dx + jit(0.02), y + dy + jit(0.02), 0.75), 0.035, 0.03, n=5)
    for (a, b) in (((NX0 - 0.7, NY0), (CX1 + 0.7, NY0)), ((NX0, NY0 - 0.7), (NX0, NY1 + 0.7)),
                   ((CX1, CY0 - 0.7), (CX1, CY1 + 0.7)), ((PX0, PY0 - 0.7), (PX0, NY0)),
                   ((PX1, PY0 - 0.7), (PX1, NY0)), ((TX0 - 0.7, TY0), (TX1, TY0))):
        cyl(B("rope"), (a[0], a[1], 0.68), (b[0], b[1], 0.68), 0.008, n=3)
    K.MAT["rope"] = K.m_rope("rope")
    K.stone_pile(2.0, -8.0, 26, 1.6)
    K.stone_pile(-2.0, 7.5, 22, 1.4)
    K.stone_pile(-15.0, -4.0, 18, 1.2)
    K.timber_stack(5.5, -7.8, 4.0, 3)
    K.log_pile(9.5, 6.0, 12.0, rows=3)
    mortar_bed(-10.5, -6.5)


def mortar_bed(x, y):
    """lime-mixing board with a tub, shovel handle and a barrel."""
    box(B("plank"), (x - 1.1, y - 0.8, 0.0), (x + 1.1, y + 0.8, 0.06), 0.01)
    K.ground_patch(B("lime", "ashlar"), x, y, 0.8, 0.55, h=0.16, n=10, rings=2, bump=0.02, seed=2.0)
    K.barrel((x + 1.6, y + 0.2, 0.0), 0.3, 0.8)
    beam(B("oak"), (x + 0.4, y - 0.2, 0.18), (x + 1.5, y - 0.9, 0.7), 0.05, 0.05, 0.005)


def build2():
    site_ground()
    # scaffold on the tower (south + west faces) and along the nave south wall
    K.scaffold_face((TX0, TY0, 0), (TX1, TY0, 0), Vector((0, -1, 0)), CAP_T, standoff=1.4)
    K.scaffold_face((TX0, TY1, 0), (TX0, TY0, 0), Vector((-1, 0, 0)), CAP_T, standoff=1.4)
    K.scaffold_face((-1.0, NY0, 0), (NX1, NY0, 0), Vector((0, -1, 0)), CAP_N + 0.2, standoff=1.3)
    # shear-legs hoist over the tower top: three poles, pulley, rope, a stone on the hook
    apex = Vector((TX0 - 1.0, (TY0 + TY1) / 2, CAP_T + 3.2))
    for p in ((TX0 - 3.0, TY0 - 1.0, 0.0), (TX0 - 3.0, TY1 + 1.0, 0.0), (TX0 + 1.8, (TY0 + TY1) / 2, CAP_T)):
        cyl(B("oak"), p, apex, 0.09, 0.07, n=6)
    cyl(B("oak"), apex + Vector((0, -0.12, -0.1)), apex + Vector((0, 0.12, -0.1)), 0.14, n=8)
    cyl(B("rope"), apex + Vector((0.14, 0, -0.1)), (apex.x + 0.14, apex.y, 1.6), 0.015, n=4)
    cyl(B("rope"), apex + Vector((-0.14, 0, -0.1)), (TX0 - 2.2, TY1 + 0.4, 0.9), 0.015, n=4)
    box(B("ashlar"), (apex.x - 0.2, apex.y - 0.3, 1.1), (apex.x + 0.45, apex.y + 0.3, 1.55), 0.02)
    # treadwheel windlass on the ground (drum + frame) at the rope's end
    wx, wy = TX0 - 2.2, TY1 + 1.2
    for sy in (-0.7, 0.7):
        beam(B("oak"), (wx - 0.9, wy + sy, 0.0), (wx, wy + sy, 1.2), 0.14, 0.14, 0.01)
        beam(B("oak"), (wx + 0.9, wy + sy, 0.0), (wx, wy + sy, 1.2), 0.14, 0.14, 0.01)
    cyl(B("oak"), (wx, wy - 0.8, 1.2), (wx, wy + 0.8, 1.2), 0.18, n=8)
    # scaffold also inside nave - a rough centring for the chancel arch
    K.stone_pile(2.5, -8.8, 24, 1.5)
    K.stone_pile(-3.5, 7.3, 20, 1.3)
    K.stone_pile(10.0, 5.8, 18, 1.2)
    K.timber_stack(6.5, -8.2, 5.5, 3)
    mortar_bed(-4.0, -7.9)
    # roof timbers laid out ready: a pair of trusses on trestles
    for y in (7.3, 10.6):
        box(B("oak"), (8.4, y - 0.15, 0.0), (12.0, y + 0.15, 0.22), 0.01)
    for x in (8.8, 9.3, 9.8, 10.4, 11.0, 11.5):
        beam(B("oak"), (x, 6.9, 0.3), (x + jit(0.1), 11.1, 0.3), 0.16, 0.16, 0.01)
    K.MAT["rope"] = K.m_rope("rope")
    # nave floor bed (rammed earth) inside
    box(B("soil", "mud"), (NX0 + TH, NY0 + TH, 0.0), (NX1 - TH, NY1 - TH, 0.05))


def ruin_extras():
    # rubble spilled from the broken south wall and the fallen gable; charred roof timbers in heaps
    K.rubble_heap(-0.5, NY0 - 1.2, 2.6, 1.1, 0.6, 26, "rubble")
    K.rubble_heap(1.5, 0.0, 3.5, 3.0, 0.9, 30, "rubble")
    K.rubble_heap(-11.5, TY0 - 1.3, 1.6, 1.0, 0.5, 14, "rubble")
    K.rubble_heap(NX1 + 0.6, NY0 - 1.0, 1.3, 1.0, 0.4, 10, "rubble")
    for i in range(14):
        x, y = R.uniform(-4.0, 3.0), R.uniform(-3.0, 3.2)
        a = R.uniform(0, math.pi)
        l = R.uniform(1.5, 4.2)
        z = R.uniform(0.1, 0.9)
        beam(B("char"), (x, y, z), (x + math.cos(a) * l, y + math.sin(a) * l, z + R.uniform(-0.6, 1.4)),
             0.16, 0.18, 0.01)
    # fallen roof tiles in drifts
    for i in range(60):
        x, y = R.uniform(-4.5, 3.0), R.uniform(-3.8, 3.8)
        box(B("stile"), (x, y, 0.1), (x + 0.3, y + 0.24, 0.13), 0.0, rot=(jit(0.4), jit(0.4), R.uniform(0, 3)))
    # nave floor
    box(B("floor"), (NX0 + TH, NY0 + TH, 0.0), (CX1 - TH, NY1 - TH, 0.08))


# ---------------------------------------------------------------------------- go
if B1:
    build1()
else:
    tower()
    nave()
    chancel()
    porch()
    roofs()
    if FULL or RUIN:
        churchyard()
    if B2:
        build2()
    if RUIN:
        ruin_extras()
    if FULL:
        # floor inside (glimpsed through the porch door)
        box(B("floor"), (NX0 + TH, NY0 + TH, 0.0), (CX1 - TH, NY1 - TH, 0.06))

name = "church" if FULL else "church_" + STATE
K.finalize(name, tex=2048, lods=(1.0, 0.4, 0.12))
