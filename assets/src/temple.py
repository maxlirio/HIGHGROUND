"""HIGHGROUND - "Temple & Infirmary" (healing building): a small priory infirmary.

A tall stone infirmary hall (clay-tiled, chimney stack, smoke louvre) with its chapel attached at
the east end (lower roof, triple-lancet east window, twin bellcote on the hall's east gable), a
shingled cloister walk (pentice on a dwarf wall) along the hall's south side, and a walled-in
herb garden of plank-edged raised beds, a stone basin at the crossing of the paths and straw
bee-skeps. Overall about 22 x 14 m.

    blender -b -P assets/src/temple.py -- <state>     state = complete | build1 | build2 | ruin

Front (garden side, south) faces -Y. 1 unit = 1 m.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _parish_kit as K
from _parish_kit import (B, Batch, Face, box, beam, cyl, prism_hull, jit, R, TRS, window, door_leaf, wall,
                         top_prof, quoins, plinth, buttress, string_course)

STATE, FULL, RUIN, B1, B2 = K.STATE, K.FULL, K.RUIN, K.B1, K.B2
K.begin(seed=67)
K.NO_CULL += ["wall_"]

ch = 0.85 if RUIN else 0.0
M = K.MAT
M["rubble"] = K.m_stone("rubble", [(0.0, "#948b76"), (0.25, "#ab9f86"), (0.5, "#bbae93"), (0.75, "#a3977f"),
                                    (1.0, "#8b8270")], "#7a7262", rowh=0.27, bw=0.55, charred=ch * 0.8, moss=(0.08 if (B1 or B2) else 1.0))
M["ashlar"] = K.m_stone("ashlar", [(0.0, "#a89c83"), (0.4, "#b9ad92"), (0.7, "#b0a48a"), (1.0, "#9d917a")],
                        "#9a9280", joints=False, bump=0.6, charred=ch * 0.6, moss=(0.08 if (B1 or B2) else 1.0))
M["chimney"] = K.m_stone("chimney", [(0.0, "#948b76"), (0.5, "#ab9f86"), (1.0, "#8b8270")], "#6f675b",
                         rowh=0.27, bw=0.5, soot_top=10.4, charred=ch * 0.8)
M["tile"] = K.m_tiles("tile", [(0.0, "#6e3f2b"), (0.2, "#8c5037"), (0.5, "#9a5a3c"), (0.8, "#a8694a"),
                                (1.0, "#7f4a36")], cell=0.24, lichen=1.2, moss=1.0, charred=ch)
M["shingle"] = K.m_tiles("shingle", [(0.0, "#6c604f"), (0.5, "#80766a"), (1.0, "#8f8474")], cell=0.17,
                         curve=0.15, wood=True, lichen=0.7, moss=0.9, charred=ch)
M["oak"] = K.m_wood("oak", [(0.0, "#4e3b27"), (0.5, "#5f4830"), (1.0, "#6b5236")], weather_hex="#7d7466",
                    weathered=0.55, fresh=0.5 if (B1 or B2) else 0.05, charred=ch)
M["plank"] = K.m_wood("plank", [(0.0, "#6f6353"), (0.5, "#80766a"), (1.0, "#8d8272")], weather_hex="#8f887c",
                      weathered=0.5, fresh=0.6 if (B1 or B2) else 0.0, charred=ch, grain_k=1.2)
M["char"] = K.m_wood("char", [(0.0, "#2b2622"), (1.0, "#3d352e")], weather_hex="#4a443d", weathered=0.3, charred=1.0)
M["iron"] = K.m_simple("iron", "#35332f", "#45403a", 0.72, rust=True)
M["bronze"] = K.m_simple("bronze", "#4f4a36", "#5d6a4f", 0.55, 3.0)
M["dark"] = K.m_glass("glass") if FULL else K.m_simple("dark", "#231f1b", "#2f2923", 0.92)
M["turf"] = K.m_ground("turf", grass=0.9)
M["path"] = K.m_ground("path", wet=0.2, grass=0.08, gravel=0.5)
M["soil"] = K.m_ground("soil", wet=0.1, grass=0.0 if not RUIN else 0.45)
M["mud"] = K.m_ground("mud", wet=0.5, grass=0.3)
M["water"] = K.m_water("water")
M["rope"] = K.m_rope("rope")
HERBS = {"sage": ("#6a7358", "#9aa484"), "lavender": ("#5f6a55", "#8e997e"), "lavflower": ("#6a5680", "#8f7aa6"),
         "rue": ("#4f6656", "#81998a"), "thyme": ("#4f5c37", "#7a8a52"), "fennel": ("#627538", "#9aac5a"),
         "weed": ("#5a5a2e", "#8a8446")}
for k, (a, b) in HERBS.items():
    M["h_" + k] = K.m_foliage("h_" + k, dark=a, light=b)


def m_straw(name):
    g = K.G(name)
    P = g.P
    x, y, z = g.sep(P)
    band = g.node("ShaderNodeTexWave", [("Vector", P), ("Scale", 3.2), ("Distortion", 0.6)],
                  wave_type="BANDS", bands_direction="Z").outputs[1]
    fib = g.noise(g.comb(g.mul(x, 40), g.mul(y, 40), g.mul(z, 3.0)), 1.0, 4)
    col = g.ramp(g.add(g.mul(band, 0.5), g.mul(fib, 0.5)), [(0.2, "#6f5d3a"), (0.6, "#9a8452"), (0.9, "#ab9660")])
    col = g.mix(0.5, col, g.noise(P, 1.0, 3), "OVERLAY")
    return g.out(col, 0.9, g.add(band, g.mul(fib, 0.4)), 1.0, 0.02)


M["straw"] = m_straw("straw")

# ------------------------------------------------------------------ plan
HX0, HX1, HY0, HY1 = -11.0, 3.5, 0.2, 7.0          # infirmary hall
HH, TH = 5.6, 0.8
CX0, CX1, CY0, CY1 = 3.5, 10.5, 0.8, 6.4           # chapel
CH = 5.0
PH, PC = math.radians(50), math.radians(50)
WH, WC = HY1 - HY0, CY1 - CY0
LH, LC = HX1 - HX0, CX1 - CX0
RH = HH + WH / 2 * math.tan(PH)
RC = CH + WC / 2 * math.tan(PC)
PENT_Y = -2.75                                      # cloister walk outer line
GY0, GY1 = -7.3, -3.2                               # herb garden
GX0, GX1 = -11.0, 10.5
PATH_X = -4.0

if B2:
    CAP_H, CAP_C = 3.0, 2.5
elif B1:
    CAP_H = CAP_C = 0.0
else:
    CAP_H = CAP_C = 99

hS = Face((HX0, HY0, 0), (0, -1, 0))     # u = x - HX0
hN = Face((HX1, HY1, 0), (0, 1, 0))      # u = HX1 - x
hE = Face((HX1, HY0, 0), (1, 0, 0))      # u = y - HY0
hW = Face((HX0, HY1, 0), (-1, 0, 0))     # u = HY1 - y
cS = Face((CX0, CY0, 0), (0, -1, 0))
cN = Face((CX1, CY1, 0), (0, 1, 0))
cE = Face((CX1, CY0, 0), (1, 0, 0))


def fits(v, cap):
    return v + 0.35 < cap


def win(f, cut, u, v0, w, h, kind="lancet", twin=False, cap=99, depth=0.55):
    if not fits(v0 + h, cap):
        return
    window(f, cut, u, v0, w, h, kind, depth=(TH + 0.5 if RUIN else depth), twin=twin, backdark=not RUIN)


def door(f, cut, u, w, h, cap):
    if not (FULL or RUIN or fits(h, cap)):
        return
    window(f, cut, u, 0.0, w, h, "lancet", depth=TH + 0.5 if RUIN else 0.5, backdark=not RUIN)
    if FULL:
        door_leaf(f, u, 0.0, w - 0.05, h - 0.2, 0.45, arch=True)


# ---------------------------------------------------------------------------- HALL + CHAPEL
def hall_south(f, cut):
    for x in (-9.0, -6.0, -3.0, 0.0, 2.4):
        if RUIN and x == -3.0:
            continue
        win(f, cut, x - HX0, 3.68, 0.5, 1.28, cap=CAP_H)
    door(f, cut, PATH_X - HX0, 1.3, 2.45, CAP_H)
    door(f, cut, 1.3 - HX0, 0.9, 2.1, CAP_H)


def hall_north(f, cut):
    for x in (-9.0, -3.0, 0.2):
        if RUIN and x == -3.0:
            continue
        win(f, cut, HX1 - x, 2.1, 0.55, 2.3, cap=CAP_H)


def hall_west(f, cut):
    win(f, cut, WH / 2, 2.4, 0.55, 2.5, twin=True, cap=CAP_H)
    if FULL:
        win(f, cut, WH / 2, HH + 1.3, 0.5, 0.5, kind="round", cap=CAP_H)


def hall_east(f, cut):
    if FULL or RUIN:
        for du in (-0.42, 0.42):
            window(f, cut, WH / 2 + du, RH + 0.1, 0.46, 0.85, "round", depth=TH + 0.6, backdark=False, surround=False)


def chapel_south(f, cut):
    win(f, cut, 4.9 - CX0, 1.9, 0.5, 2.3, cap=CAP_C)
    win(f, cut, 8.9 - CX0, 1.9, 0.5, 2.3, cap=CAP_C)
    door(f, cut, 6.9 - CX0, 0.85, 2.0, CAP_C)


def chapel_north(f, cut):
    win(f, cut, CX1 - 4.9, 1.9, 0.5, 2.3, cap=CAP_C)
    win(f, cut, CX1 - 8.9, 1.9, 0.5, 2.3, cap=CAP_C)


def chapel_east(f, cut):
    c = WC / 2
    win(f, cut, c, 1.6, 0.56, 3.0, cap=CAP_C)
    win(f, cut, c - 0.95, 1.6, 0.5, 2.45, cap=CAP_C)
    win(f, cut, c + 0.95, 1.6, 0.5, 2.45, cap=CAP_C)


def buildings():
    tn = math.tan(PH)
    wall("hS", hS, top_prof(0.0, LH, HH, CAP_H, 1.0, ruin=(4.5, 12.0, [(6.2, 9.8, 3.2)]),
                              protect=((4.2, 5.8, 5.3), (6.2, 7.8, 2.95), (10.2, 11.8, 5.3))), TH, hall_south)
    wall("hN", hN, top_prof(0.0, LH, HH, CAP_H, 2.0, ruin=(4.5, 11.0, [(4.8, 8.2, 2.2)]),
                              protect=((2.6, 4.0, 4.75),)), TH, hall_north)
    g = (WH / 2, PH) if (FULL or RUIN) else None
    wall("hW", hW, top_prof(TH, WH - TH, HH, CAP_H, 3.0, gable=g), TH, hall_west)
    if FULL or RUIN:
        c = WH / 2
        z = lambda u: HH + (c - abs(c - u)) * tn
        bw = 1.05
        pE = [(TH, 0.0), (WH - TH, 0.0), (WH - TH, z(WH - TH)), (c + bw, z(c + bw)), (c + bw, RH + 1.3),
              (c, RH + 1.95), (c - bw, RH + 1.3), (c - bw, z(c - bw)), (TH, z(TH))]
        if RUIN:
            pE = [(TH, 0.0), (WH - TH, 0.0), (WH - TH, z(WH - TH)), (c + bw, z(c + bw)), (c + bw, RH + 1.0),
                  (c + 0.3, RH + 1.5), (c - 0.2, RH + 0.4), (c - bw, RH - 0.2), (c - bw, z(c - bw)), (TH, z(TH))]
        wall("hE", hE, pE, TH, hall_east)
        if FULL:
            for sg in (-1, 1):
                pts = []
                for x in (HX1 - TH - 0.08, HX1 + 0.08):
                    for (y, z) in ((HY0 + c + sg * (bw + 0.12), RH + 1.2), (HY0 + c, RH + 2.0)):
                        pts += [(x, y, z), (x, y, z + 0.14)]
                prism_hull(B("ashlar"), pts)
            cyl(B("ashlar"), (HX1 - TH / 2, HY0 + c, RH + 1.97), (HX1 - TH / 2, HY0 + c, RH + 2.25), 0.09, 0.05, n=6)
            box(B("ashlar"), (HX1 - TH - 0.06, HY0 + c - bw - 0.08, RH - 0.1), (HX1 + 0.06, HY0 + c + bw + 0.08, RH + 0.04), 0.02)
            cyl(B("iron"), (HX1 - TH + 0.02, HY0 + c - 0.42, RH + 0.82), (HX1 - 0.02, HY0 + c - 0.42, RH + 0.82), 0.022, n=5)
            cyl(B("iron"), (HX1 - TH + 0.02, HY0 + c + 0.42, RH + 0.82), (HX1 - 0.02, HY0 + c + 0.42, RH + 0.82), 0.022, n=5)
            for du in (-0.42, 0.42):
                bell(Vector((HX1 - TH / 2, HY0 + c + du, RH + 0.8)), 0.8 if du < 0 else 0.7)
    else:
        wall("hE", hE, top_prof(TH, WH - TH, HH, CAP_H, 4.0), TH)
    # chapel
    wall("cS", cS, top_prof(-0.3, LC, CH, CAP_C, 5.0), TH, chapel_south)
    wall("cN", cN, top_prof(0.0, LC + 0.3, CH, CAP_C, 6.0), TH, chapel_north)
    gc = (WC / 2, PC) if (FULL or RUIN) else None
    wall("cE", cE, top_prof(TH, WC - TH, CH, CAP_C, 7.0, gable=gc), TH, chapel_east)

    if not B1:
        pl = B("plinth", "ashlar")
        plinth([(HX1, HY0), (HX1, CY0)], closed=False, h=0.6, proud=0.18, bt=pl)
        plinth([(CX0, CY0), (6.9 - 0.6, CY0)], closed=False, h=0.6, proud=0.18, bt=pl)
        plinth([(6.9 + 0.6, CY0), (CX1, CY0), (CX1, CY1), (CX0, CY1)], closed=False, h=0.6, proud=0.18, bt=pl)
        plinth([(HX1, CY1), (HX1, HY1), (HX0, HY1), (HX0, HY0)], closed=False, h=0.6, proud=0.18, bt=pl)
    # buttresses
    hb = min(4.0, CAP_H - 0.2)
    if hb > 0.8:
        for f, us in ((hN, (0.45, HX1 + 1.5, HX1 + 7.5, LH - 0.45)), (hW, (0.45, WH - 0.45)),
                      (hS, (0.45,))):
            for u in us:
                buttress(f, B("butt", "rubble"), u, depth=0.8, w=0.66, h=hb, offsets=2)
    hc = min(3.6, CAP_C - 0.2)
    if hc > 0.8:
        for f, us in ((cS, (LC - 0.42,)), (cN, (0.42,)), (cE, (0.42, WC - 0.42))):
            for u in us:
                buttress(f, B("butt", "rubble"), u, depth=0.75, w=0.62, h=hc, offsets=2)
    if FULL or RUIN:
        dz = 1.0 if RUIN else 0.0
        for c, a, b in (((HX0, HY0), (-1, 0, 0), (0, -1, 0)), ((HX0, HY1), (0, 1, 0), (-1, 0, 0)),
                        ((HX1, HY0), (0, -1, 0), (1, 0, 0)), ((HX1, HY1), (1, 0, 0), (0, 1, 0))):
            quoins(c, a, b, 4.2, HH - dz)
        for c, a, b in (((CX1, CY0), (0, -1, 0), (1, 0, 0)), ((CX1, CY1), (1, 0, 0), (0, 1, 0))):
            quoins(c, a, b, 3.8, CH - dz * 0.5)
    if FULL:
        for f, L_, h in ((hS, LH, HH), (hN, LH, HH), (cS, LC, CH), (cN, LC, CH)):
            f.prism_dv(B("ashlar"), [(-0.16, h - 0.26), (0.3, h - 0.26), (0.3, h + 0.02), (-0.16, h + 0.02)],
                       -0.1 if f in (hS, hN) else -0.3, L_ + 0.1)
    # chimney stack on the north wall (warming room)
    ctop = {"complete": 10.6, "ruin": 7.8}.get(STATE, min(CAP_H, 10.6))
    if not B1:
        box(B("chim", "chimney"), (-6.8, HY1 - 0.1, 0.0), (-5.2, HY1 + 0.75, min(ctop, 6.2)))
        if ctop > 6.2:
            prism_hull(B("chim", "chimney"), [(x, y, z) for x in (-6.8, -5.2) for (y, z) in
                                              ((HY1 - 0.1, 6.2), (HY1 + 0.75, 6.2), (HY1 - 0.1, 6.9), (HY1 + 0.3, 6.9))])
            box(B("chim", "chimney"), (-6.5, HY1 - 0.35, 6.2), (-5.5, HY1 + 0.3, ctop))
            if FULL:
                box(B("ashlar"), (-6.62, HY1 - 0.47, ctop), (-5.38, HY1 + 0.42, ctop + 0.18), 0.02)
                for dx in (-0.22, 0.22):
                    cyl(B("chim", "chimney"), (-6.0 + dx, HY1 - 0.02, ctop + 0.18), (-6.0 + dx, HY1 - 0.02, ctop + 0.6),
                        0.13, 0.11, n=8)


def bell(p, s=0.8):
    prof = [(0.05, 0.0), (0.2, -0.04), (0.23, -0.2), (0.3, -0.42), (0.33, -0.47)]
    pts = [(p.x + r * s * math.cos(2 * math.pi * i / 10), p.y + r * s * math.sin(2 * math.pi * i / 10), p.z + z * s)
           for (r, z) in prof for i in range(10)]
    prism_hull(B("bronze"), pts)
    box(B("oak"), (p.x - 0.36, p.y - 0.07, p.z - 0.03), (p.x + 0.36, p.y + 0.07, p.z + 0.09), 0.01)


def roofs():
    I = Matrix.Identity(4)
    if FULL:
        K.gable_roof(B("tile"), I, HX0 + 0.1, HX1 - 0.05, HY0 + WH / 2, WH / 2, HH, PH, over=0.38, row_w=0.3,
                     thick=0.035, lift=0.03, sag=0.09, seg=8, ridge_bt=B("tile"), ridge_r=0.14)
        K.gable_roof(B("tile"), I, HX1 - 0.3, CX1 - 0.05, CY0 + WC / 2, WC / 2, CH, PC, over=0.34, row_w=0.3,
                     thick=0.035, lift=0.03, sag=0.06, seg=6, ridge_bt=B("tile"), ridge_r=0.13)
        K.coping(B("ashlar"), I, HX0 + 0.3, HY0 + WH / 2, WH / 2, HH, PH, w=0.62, t=0.17, out=0.3, kneeler=True, cross=False)
        K.coping(B("ashlar"), I, HX1 - 0.32, HY0 + WH / 2, WH / 2, HH, PH, w=0.66, t=0.17, out=0.3, kneeler=True)
        K.coping(B("ashlar"), I, CX1 - 0.3, CY0 + WC / 2, WC / 2, CH, PC, w=0.62, t=0.17, out=0.27, kneeler=True, cross=True)
        louvre(-1.0)
    elif RUIN:
        yc = HY0 + WH / 2
        K.gable_roof(B("tile"), I, HX0 + 0.1, -7.6, yc, WH / 2, HH, PH, over=0.38, row_w=0.3, thick=0.035, lift=0.03,
                     sag=0.25, seg=4, stop_a=lambda t: t < 0.45, stop_b=lambda t: t < 0.9)

        def keep(x, sg):
            if x < -7.6:
                return 1.0
            if x > 1.2:
                return R.uniform(0.3, 1.0) if R.random() < 0.7 else 0.0
            return 0.0
        K.rafters(B("char"), I, HX0 + 0.5, HX1 - 0.6, yc, WH / 2, HH, PH, spacing=0.75, keep=keep)
        K.gable_roof(B("tile"), I, HX1 - 0.3, CX1 - 0.05, CY0 + WC / 2, WC / 2, CH, PC, over=0.34, row_w=0.3,
                     thick=0.035, lift=0.03, sag=0.3, seg=6, stop_a=lambda t: t < 0.3 or t > 0.75,
                     stop_b=lambda t: t < 0.95)
        K.rafters(B("char"), I, HX1, CX1 - 0.4, CY0 + WC / 2, WC / 2, CH, PC, spacing=0.8,
                  keep=lambda x, sg: 1.0 if sg > 0 else R.uniform(0.35, 1.0))
        K.coping(B("ashlar"), I, CX1 - 0.3, CY0 + WC / 2, WC / 2, CH, PC, w=0.62, t=0.17, out=0.27, kneeler=True)


def louvre(x):
    """timber smoke louvre on the hall ridge: slatted sides, small tiled cap."""
    yc = HY0 + WH / 2
    z0 = RH - 0.25
    for sx in (-1, 1):
        for sy in (-1, 1):
            beam(B("oak"), (x + sx * 0.45, yc + sy * 0.4, z0), (x + sx * 0.45, yc + sy * 0.4, z0 + 0.95), 0.1, 0.1, 0.008)
    for k in range(4):
        z = z0 + 0.25 + k * 0.18
        for sy in (-1, 1):
            beam(B("plank"), (x - 0.42, yc + sy * 0.42, z), (x + 0.42, yc + sy * 0.42, z), 0.16, 0.025, 0.0,
                 side=(0, sy * 0.6, 0.8))
        for sx in (-1, 1):
            beam(B("plank"), (x + sx * 0.47, yc - 0.37, z), (x + sx * 0.47, yc + 0.37, z), 0.16, 0.025, 0.0,
                 side=(sx * 0.6, 0, 0.8))
    Ml = Matrix.Translation((0, 0, 0))
    K.gable_roof(B("tile"), Ml, x - 0.62, x + 0.62, yc, 0.5, z0 + 0.98, math.radians(45), over=0.14, row_w=0.24,
                 thick=0.03, lift=0.02, sag=0.0, seg=2, ridge_bt=B("tile"), ridge_r=0.08)


# ---------------------------------------------------------------------------- CLOISTER WALK (pentice)
def pentice():
    if B1:
        return
    dw = B("dwarf", "rubble")
    hdw = 0.78 if not B2 else 0.5
    gaps = [(PATH_X - 0.75, PATH_X + 0.75)]
    segs, x = [], HX0
    for (a, b) in gaps:
        segs.append((x, a)); x = b
    segs.append((x, HX1))
    for (a, b) in segs:
        box(dw, (a, PENT_Y - 0.23, 0.0), (b, PENT_Y + 0.23, hdw))
        if not B2:
            u = a
            while u < b - 0.05:
                l = min(R.uniform(0.7, 1.1), b - u)
                box(B("ashlar"), (u + 0.01, PENT_Y - 0.28, hdw), (u + l - 0.01, PENT_Y + 0.28, hdw + 0.13), 0.02,
                    rot=(0, 0, jit(0.01)))
                u += l
    if B2:
        return
    ptop = 2.3
    posts = [HX0 + 0.25] + [HX0 + 0.25 + k * 2.4 for k in range(1, 6)] + [HX1 - 0.25]
    posts = [p for p in posts if not (PATH_X - 0.9 < p < PATH_X + 0.9)] + [PATH_X - 0.85, PATH_X + 0.85]
    for x in posts:
        if RUIN:
            h = R.uniform(0.3, 1.2) if R.random() < 0.7 else 0.0
            if h > 0:
                beam(B("char"), (x, PENT_Y, hdw + 0.12), (x + jit(0.1), PENT_Y + jit(0.1), hdw + 0.12 + h), 0.2, 0.2, 0.012)
            continue
        beam(B("oak"), (x, PENT_Y, hdw + 0.12), (x + jit(0.015), PENT_Y, ptop), 0.2, 0.2, 0.014)
        for sx in (-1, 1):
            if HX0 + 0.5 < x + sx * 0.6 < HX1 - 0.5:
                beam(B("oak"), (x, PENT_Y, ptop - 0.55), (x + sx * 0.55, PENT_Y, ptop - 0.02), 0.12, 0.12, 0.01)
        # tie beam back to the hall wall
        beam(B("oak"), (x, PENT_Y, ptop + 0.06), (x, HY0 + 0.15, ptop + 0.06), 0.16, 0.16, 0.012)
    if RUIN:
        # the fallen plate and a burnt sheet of shingles on the walk
        beam(B("char"), (HX0 + 1.0, PENT_Y + 0.4, 0.15), (HX0 + 5.5, PENT_Y + 1.0, 0.6), 0.2, 0.2, 0.012)
        I = Matrix.Identity(4)
        # a burnt sheet of the lean-to slid down: foot on the walk, head still caught on the wall corbels
        K.roof_rows(B("shingle"), I, 0.2, HX1 + 0.1, (PENT_Y + 0.5, 0.12), (HY0 - 0.05, 2.6), row_w=0.26, thick=0.025,
                    lift=0.02, sag=0.2, seg=5, stop=lambda t: t > 0.25)
        return
    # wall plate
    beam(B("oak"), (HX0 - 0.1, PENT_Y, ptop + 0.02), (HX1 + 0.1, PENT_Y, ptop + 0.02), 0.2, 0.2, 0.014)
    # lean-to shingle roof from the plate up to the hall wall + a timber wall-plate/corbel line
    I = Matrix.Identity(4)
    K.roof_rows(B("shingle"), I, HX0 - 0.2, HX1 + 0.1, (PENT_Y - 0.3, ptop - 0.08), (HY0, 3.38), row_w=0.26,
                thick=0.025, lift=0.02, sag=0.04, seg=10)
    hS.prism_dv(B("ashlar"), [(-0.2, 3.27), (0.1, 3.27), (0.1, 3.5), (-0.2, 3.5)], -0.2, LH + 0.1)
    # benches along the walk
    for x0 in (-10.4, -2.8):
        box(B("plank"), (x0, HY0 - 0.55, 0.42), (x0 + 2.2, HY0 - 0.12, 0.48), 0.01)
        for dx in (0.2, 2.0):
            box(B("plank"), (x0 + dx - 0.05, HY0 - 0.5, 0.0), (x0 + dx + 0.05, HY0 - 0.17, 0.42), 0.0)
    # flagged floor of the walk
    box(B("walkfloor", "ashlar"), (HX0, PENT_Y + 0.23, 0.0), (HX1, HY0, 0.05))


# ---------------------------------------------------------------------------- HERB GARDEN
BEDS = [(-10.4, -7.9, -4.3, -3.4), (-7.4, -4.9, -4.3, -3.4), (-10.4, -7.9, -6.9, -5.9), (-7.4, -4.9, -6.9, -5.9),
        (-3.0, -0.5, -4.3, -3.4), (0.1, 2.6, -4.3, -3.4), (3.2, 5.7, -4.3, -3.4), (6.3, 8.8, -4.3, -3.4),
        (-3.0, -0.5, -6.9, -5.9), (0.1, 2.6, -6.9, -5.9), (3.2, 5.7, -6.9, -5.9), (6.3, 8.8, -6.9, -5.9)]


def garden():
    # turf over the whole plot, gravel paths on top, soil in beds
    P, F = [], []
    nx, ny = 10, 3
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = GX0 + (GX1 - GX0) * i / nx
            y = GY0 + (HY0 - GY0) * j / ny
            P.append((x, y, 0.02 + (0.0 if i in (0, nx) or j in (0, ny) else 0.02)))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            F.append((a, a + 1, a + nx + 2, a + nx + 1))
    B("turf").add(P, F)
    pz = 0.055
    for (x0, x1, y0, y1) in ((PATH_X - 0.6, PATH_X + 0.6, GY0, PENT_Y), (GX0 + 0.4, 9.4, -5.35, -4.75)):
        box(B("gravel", "path"), (x0, y0, 0.0), (x1, y1, pz), 0.0)
    if B1:
        return
    for k, (x0, x1, y0, y1) in enumerate(BEDS):
        if B2 and k % 3:
            continue
        bed(x0, x1, y0, y1, k)
    # stone basin at the crossing
    if not B2:
        cx, cy = PATH_X, -5.05
        for i in range(8):
            a0, a1 = 2 * math.pi * i / 8, 2 * math.pi * (i + 1) / 8
            pts = []
            for a in (a0 + 0.01, a1 - 0.01):
                for r in (0.52, 0.7):
                    for z in (0.0, 0.62):
                        pts.append((cx + r * math.cos(a), cy + r * math.sin(a), z))
            prism_hull(B("ashlar"), pts)
        cyl(B("ashlar"), (cx, cy, 0.0), (cx, cy, 0.3), 0.55, n=8)
        cyl(B("water") if not RUIN else B("soil"), (cx, cy, 0.3), (cx, cy, 0.5), 0.54, n=8)
        cyl(B("ashlar"), (cx, cy, 0.4), (cx, cy, 1.05), 0.1, 0.08, n=6)
        cyl(B("ashlar"), (cx, cy, 1.0), (cx, cy, 1.12), 0.2, 0.14, n=8)
    # bee skeps on a plank stand in the SE corner
    sx, sy = 9.7, -6.6
    if FULL:
        box(B("plank"), (sx - 0.9, sy - 0.25, 0.45), (sx + 0.9, sy + 0.25, 0.5), 0.01)
        for dx in (-0.75, 0.75):
            box(B("plank"), (sx + dx - 0.05, sy - 0.2, 0.0), (sx + dx + 0.05, sy + 0.2, 0.45), 0.0)
        for dx in (-0.55, 0.0, 0.55):
            skep(Vector((sx + dx, sy, 0.5)))
    elif RUIN:
        skep(Vector((sx - 0.3, sy + 0.2, 0.0)), tilt=1.4)
        skep(Vector((sx + 0.5, sy - 0.1, 0.0)))
    # wattle fence round the garden: south + east + west, gate gap at the path
    fence()


def bed(x0, x1, y0, y1, k):
    # plank edging, a mounded soil top, rows of herb clumps
    for (a, b) in (((x0, y0), (x1, y0)), ((x0, y1), (x1, y1)), ((x0, y0), (x0, y1)), ((x1, y0), (x1, y1))):
        beam(B("plank"), (a[0], a[1], 0.12), (b[0], b[1], 0.12 + jit(0.01)), 0.04, 0.24, 0.0, ext=0.03,
             side=(0, 0, 1))
    P = [(x0 + 0.03, y0 + 0.03, 0.18), (x1 - 0.03, y0 + 0.03, 0.18), (x1 - 0.03, y1 - 0.03, 0.18),
         (x0 + 0.03, y1 - 0.03, 0.18), ((x0 + x1) / 2, (y0 + y1) / 2, 0.26)]
    B("soil").add(P, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)])
    if B2:
        return
    kinds = ["sage", "lavender", "rue", "thyme", "fennel", "lavender", "sage", "thyme", "rue", "fennel", "sage",
             "lavender"]
    herb = kinds[k]
    if RUIN:      # overgrown: rank grass tussocks with the odd surviving herb
        for i in range(int((x1 - x0) / 0.35)):
            K.tussock(B("h_weed"), x0 + 0.15 + i * 0.35 + jit(0.08), R.uniform(y0 + 0.15, y1 - 0.15), 0.2,
                      R.uniform(1.0, 1.5), seed=k * 10 + i)
        if R.random() < 0.5:
            return
    n = int((x1 - x0) / 0.5)
    for i in range(n):
        for row in ((0.3, 0.7) if (y1 - y0) > 0.8 else (0.5,)):
            if R.random() < 0.12:
                continue
            x = x0 + (i + 0.5) * (x1 - x0) / n + jit(0.06)
            y = y0 + (y1 - y0) * row + jit(0.05)
            s = R.uniform(0.8, 1.15)
            tall = 0.5 if herb == "fennel" else (0.3 if herb in ("sage", "lavender") else 0.2)
            K.blob(B("h_" + herb), (x, y, 0.2 + tall * 0.4 * s), 0.22 * s, 0.2 * s, tall * s, sub=2, amp=0.3,
                   freq=2.8, seed=x * 3.1 + y)
            if herb == "lavender" and not RUIN:     # flower spikes: a haze of tiny purple tufts on top
                for q in range(3):
                    K.blob(B("h_lavflower"), (x + jit(0.1), y + jit(0.1), 0.2 + tall * 1.25 * s), 0.07, 0.07, 0.06,
                           sub=1, amp=0.3, seed=x + q)


def skep(p, tilt=0.0):
    Mx = TRS(p, (tilt, 0, 0))
    prof = [(0.26, 0.0), (0.28, 0.12), (0.27, 0.26), (0.22, 0.4), (0.13, 0.5), (0.0, 0.54)]
    pts = [tuple(Mx @ Vector((r * math.cos(2 * math.pi * i / 10), r * math.sin(2 * math.pi * i / 10), z)))
           for (r, z) in prof for i in range(10)]
    prism_hull(B("straw"), pts)
    # entrance notch
    box(B("dark"), tuple(Mx @ Vector((-0.06, -0.3, 0.0))), tuple(Mx @ Vector((0.06, -0.2, 0.05))), 0.0)
    # a clay-daubed cap
    cyl(B("straw"), tuple(Mx @ Vector((0, 0, 0.5))), tuple(Mx @ Vector((0, 0, 0.6))), 0.1, 0.04, n=6)


def fence():
    gate = (PATH_X - 0.7, PATH_X + 0.7)
    lines = [((GX0 + 0.1, GY0), (gate[0], GY0)), ((gate[1], GY0), (GX1 - 0.1, GY0)),
             ((GX1 - 0.1, GY0), (GX1 - 0.1, PENT_Y - 0.4)), ((GX0 + 0.1, GY0), (GX0 + 0.1, PENT_Y - 0.4))]
    for (a, b) in lines:
        a, b = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
        d = b - a
        L_ = d.length
        dn = d.normalized()
        nrm = Vector((dn.y, -dn.x, 0))
        n = int(L_ / 0.45)
        for i in range(n + 1):
            p = a + dn * (L_ * i / n)
            if RUIN and R.random() < 0.55:
                continue
            h = 1.05 + jit(0.08)
            lean = nrm * (R.uniform(0.0, 0.35) if RUIN else jit(0.03))
            cyl(B("plank"), tuple(p + Vector((0, 0, -0.05))), tuple(p + lean + Vector((0, 0, h))), 0.03, 0.025, n=4)
        # woven hurdle bands: short weaving rods, alternately in front/behind the stakes
        if RUIN:
            continue
        for z in (0.3, 0.55, 0.8):
            for i in range(n):
                p0 = a + dn * (L_ * i / n)
                p1 = a + dn * (L_ * (i + 1) / n)
                o = nrm * (0.035 if (i + int(z * 10)) % 2 else -0.035)
                beam(B("plank"), tuple(p0 + o + Vector((0, 0, z + jit(0.02)))),
                     tuple(p1 - o + Vector((0, 0, z + jit(0.02)))), 0.05, 0.13, 0.0, ext=0.03, side=(0, 0, 1))
    # gate posts
    for x in gate:
        beam(B("oak"), (x, GY0, -0.05), (x, GY0, 1.35), 0.16, 0.16, 0.012)


# ---------------------------------------------------------------------------- STATES
def site_ground():
    K.ground_patch(B("mud"), -0.3, -0.4, 14.5, 9.8, h=0.04, n=28, rings=4, bump=0.05, seed=1.0)


def build1():
    site_ground()
    fb = B("footing", "rubble")
    runs = [(HX0, HY0, HX1, HY0 + TH, 0.45), (HX0, HY1 - TH, HX1, HY1, 0.4), (HX0, HY0, HX0 + TH, HY1, 0.35),
            (HX1 - TH, HY0, HX1, HY1, 0.3), (CX0, CY0, CX1, CY0 + TH, 0.3), (CX0, CY1 - TH, CX1, CY1, 0.25),
            (CX1 - TH, CY0, CX1, CY1, 0.2)]
    for (x0, y0, x1, y1, h) in runs:
        along = (x1 - x0) > (y1 - y0)
        L_ = max(x1 - x0, y1 - y0)
        u = 0.0
        while u < L_ - 0.05:
            l = min(R.uniform(0.9, 1.6), L_ - u)
            if R.random() < 0.85:
                hh = h * R.uniform(0.5, 1.0)
                if along:
                    box(fb, (x0 + u - 0.08, y0 - 0.15, -0.1), (x0 + u + l + 0.08, y1 + 0.15, hh), 0.03,
                        rot=(0, 0, jit(0.01)))
                else:
                    box(fb, (x0 - 0.15, y0 + u - 0.08, -0.1), (x1 + 0.15, y0 + u + l + 0.08, hh), 0.03,
                        rot=(0, 0, jit(0.01)))
            u += l
    corners = [(HX0, HY0), (HX1, HY0), (HX1, HY1), (HX0, HY1), (CX1, CY0), (CX1, CY1), (HX0, PENT_Y), (HX1, PENT_Y)]
    for (x, y) in corners:
        for dx, dy in ((-0.7, 0), (0, -0.7)):
            cyl(B("plank"), (x + dx, y + dy, -0.05), (x + dx + jit(0.02), y + dy + jit(0.02), 0.75), 0.035, 0.03, n=5)
    for (a, b) in (((HX0 - 0.7, HY0), (CX1 + 0.7, HY0)), ((HX0, HY0 - 0.7), (HX0, HY1 + 0.7)),
                   ((CX1, CY0 - 0.7), (CX1, CY1 + 0.7)), ((HX0 - 0.7, PENT_Y), (HX1 + 0.7, PENT_Y))):
        cyl(B("rope"), (a[0], a[1], 0.68), (b[0], b[1], 0.68), 0.008, n=3)
    # garden plot dug over
    for j in range(5):
        y = GY0 + 0.9 + j * 0.85
        for cx in (-6.5, 2.5):
            K.ground_patch(B("dug", "soil"), cx + jit(0.4), y, 3.6, 0.32, h=0.12, n=12, rings=2, bump=0.03, seed=j + cx)
    K.stone_pile(-2.0, -5.0, 24, 1.5)
    K.stone_pile(6.0, -5.0, 20, 1.3)
    K.stone_pile(-13.0, 3.0, 18, 1.2)
    K.timber_stack(1.0, 8.0, 5.0, 3)
    K.log_pile(6.0, 7.8, 9.0, rows=3)


def build2():
    site_ground()
    K.scaffold_face((HX0, HY0, 0), (HX1, HY0, 0), Vector((0, -1, 0)), CAP_H + 0.2, standoff=1.2)
    K.scaffold_face((CX1, CY0, 0), (CX1, CY1, 0), Vector((1, 0, 0)), CAP_C + 0.2, standoff=1.2)
    K.stone_pile(-2.0, -5.5, 24, 1.5)
    K.stone_pile(6.0, -5.5, 20, 1.3)
    K.stone_pile(-13.2, 3.0, 18, 1.2)
    K.timber_stack(1.0, 8.2, 5.5, 3)
    K.timber_stack(-9.0, 8.2, 4.5, 2)
    box(B("plank"), (-8.6, -6.2, 0.0), (-6.6, -4.8, 0.05), 0.01)
    K.ground_patch(B("lime", "ashlar"), -7.6, -5.5, 0.8, 0.5, h=0.15, n=10, rings=2, bump=0.02, seed=2.0)
    K.barrel((-5.8, -5.0, 0.0), 0.3, 0.8)
    box(B("floorb", "mud"), (HX0 + TH, HY0 + TH, 0.0), (CX1 - TH, HY1 - TH, 0.05))


def ruin_extras():
    K.rubble_heap(-3.0, HY0 - 1.3, 2.2, 1.0, 0.55, 22, "rubble")
    K.rubble_heap(-4.0, 3.6, 3.5, 2.4, 0.9, 30, "rubble")
    K.rubble_heap(-3.4, HY1 + 1.2, 2.0, 0.9, 0.5, 16, "rubble")
    K.rubble_heap(HX1 - 0.4, HY0 + 3.4, 1.0, 1.2, 0.5, 10, "rubble")
    for i in range(16):
        x, y = R.uniform(-8.0, 2.5), R.uniform(1.3, 6.0)
        a = R.uniform(0, math.pi)
        l = R.uniform(1.5, 4.0)
        beam(B("char"), (x, y, 0.1), (x + math.cos(a) * l, y + math.sin(a) * l, R.uniform(0.1, 1.5)), 0.16, 0.18, 0.01)
    for i in range(60):
        x, y = R.uniform(-8.0, 2.5), R.uniform(1.0, 6.2)
        box(B("tile"), (x, y, 0.1), (x + 0.26, y + 0.18, 0.12), 0.0, rot=(jit(0.4), jit(0.4), R.uniform(0, 3)))
    box(B("floor", "ashlar"), (HX0 + TH, HY0 + TH, 0.0), (CX1 - TH, HY1 - TH, 0.07))


if B1:
    build1()
else:
    buildings()
    roofs()
    pentice()
    if B2:
        build2()
        garden()
    else:
        garden()
    if RUIN:
        ruin_extras()
    if FULL:
        box(B("floor", "ashlar"), (HX0 + TH, HY0 + TH, 0.0), (CX1 - TH, HY1 - TH, 0.06))

K.finalize("temple" if FULL else "temple_" + STATE, tex=2048, lods=(1.0, 0.4, 0.12))
