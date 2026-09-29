"""HIGHGROUND - barracks ("Muster Hall & Armoury"), the infantry recruitment building.

Footprint 16 x 10 m. A stone-and-timber muster hall along the back (rubble ground storey,
jettied close-studded upper storey, heavy Pennine stone-slate roof, lateral chimney), an
armoury wing down the east side (stone, shingled, stone-coped gables, two stable doors into
the yard) and a walled drill yard in front: gateway with piers and open gates, a pike rack
and spear racks with shields, pells hacked by practice, straw butts stuck with arrows,
barrels and a mounting block. No banners: team flags are attached in-engine;
shields are painted a neutral ochre for the same reason.

    blender -b -P assets/src/barracks.py -- [complete|build1|build2|ruin]

Front faces -Y. 1 unit = 1 m.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector, Matrix
import _milkit as K
from _milkit import (B, Batch, box, beam, cyl, prism_hull, Face, window, door_leaf, frame_face, gable_face,
                     grid, roof_rows, ridge_tiles, plinth, quoins, string_course, barrel, stone_pile, rubble_heap,
                     timber_stack, scaffold_face, cutter_obj, apply_boolean, jit, MAT, SOLIDS, BATCHES, hull)
import _lib as L

STATE = K.STATE
FULL, RUIN, B1, B2 = K.FULL, K.RUIN, K.B1, K.B2
R = K.R
R.seed(23)

# =====================================================================  layout
HX0, HX1, HYF, HYB = -8.0, 3.4, 0.4, 5.0      # hall stone ground storey
STONE_H = 3.0
JET = 0.35
UF = HYF - JET                                  # upper front face y
UP0 = 3.32                                      # upper storey sill top
PLATE = 5.5
PITCH = math.radians(44)
HALF = (HYB - UF) / 2
RIDGE_Y = (HYB + UF) / 2
RIDGE_Z = PLATE + HALF * math.tan(PITCH)

WX0, WX1, WY0, WY1 = 3.4, 8.0, -5.0, 5.0        # armoury wing
WALL_H = 2.9
WPITCH = math.radians(47)
WRX = (WX0 + WX1) / 2
WRZ = WALL_H + (WX1 - WX0) / 2 * math.tan(WPITCH)

YW0, YT, YH = -5.0, 0.55, 1.45                   # yard wall: outer face y, thickness, height
GX0, GX1 = -3.6, -1.3                           # gate opening


def build_materials():
    ch = 0.9 if RUIN else 0.0
    K.MAT["rubble"] = K.m_stone("rubble", [(0.0, "#968b76"), (0.25, "#ab9f86"), (0.5, "#bcaf94"),
                                            (0.75, "#a69a82"), (1.0, "#8a8171")], "#6f675b",
                                rowh=0.32, bw=0.66, charred=ch * 0.8)
    K.MAT["ashlar"] = K.m_stone("ashlar", [(0.0, "#a89c83"), (0.4, "#b9ac91"), (0.7, "#b0a48b"),
                                            (1.0, "#9d917b")], "#9a9280", joints=False, bump=0.6, charred=ch * 0.6)
    K.MAT["chimney"] = K.m_stone("chimney", [(0.0, "#9a8f7a"), (0.5, "#b3a68b"), (1.0, "#a39884")],
                                 "#6f675b", rowh=0.3, bw=0.55, soot_top=9.4)
    K.MAT["oak"] = K.m_wood("oak", [(0.0, "#4e3b27"), (0.5, "#5f4830"), (1.0, "#6b5236")],
                            weather_hex="#7d7466", weathered=0.55, fresh=0.06, charred=ch)
    K.MAT["plank"] = K.m_wood("plank", [(0.0, "#7b6f5e"), (0.5, "#8c8374"), (1.0, "#978a73")],
                              weather_hex="#8f887c", weathered=0.4, fresh=0.1, charred=ch, grain_k=1.2)
    K.MAT["ashwood"] = K.m_wood("ashwood", [(0.0, "#8a7556"), (0.5, "#9b8462"), (1.0, "#a88f6a")],
                                weather_hex="#8f8676", weathered=0.25, charred=ch, grain_k=2.0)
    K.MAT["fresh"] = K.m_wood("fresh", [(0.0, "#b8976a"), (0.5, "#c9a877"), (1.0, "#d2b386")],
                              weather_hex="#c0a27a", weathered=0.1, grain_k=1.6)
    K.MAT["daub"] = K.m_daub("daub", charred=ch * 0.7)
    K.MAT["slate"] = K.m_tiles("slate", [(0.0, "#5f584b"), (0.3, "#71695a"), (0.55, "#7f7462"),
                                          (0.8, "#655f55"), (1.0, "#57534b")], cell=0.42, curve=0.08,
                               lichen=1.3, moss=1.0, charred=ch)
    K.MAT["shingle"] = K.m_tiles("shingle", [(0.0, "#6a5842"), (0.5, "#7d6c56"), (1.0, "#8e7d64")],
                                 cell=0.17, curve=0.15, wood=True, lichen=0.5, charred=ch)
    K.MAT["iron"] = K.m_simple("iron", "#35332f", "#45403a", 0.72, rust=True)
    K.MAT["dark"] = K.m_simple("dark", "#2c2621", "#3a3129", 0.9)
    K.MAT["soil"] = K.m_simple("soil", "#4a3a2a", "#5f4a35", 0.95, 1.2)
    K.MAT["rope"] = K.m_simple("rope", "#7a6746", "#8e7a55", 0.9, 12.0)
    K.MAT["yard"] = K.m_yard("yard", charred=ch * 0.5)
    K.MAT["straw"] = K.m_straw("straw", charred=ch * 0.8)
    K.MAT["pennon"] = K.m_pennon("pennon")
    K.MAT["shield"] = m_shield("shield")
    K.MAT["ash"] = K.m_stone("ashrubble", [(0.0, "#6e675d"), (0.5, "#8d8577"), (1.0, "#5e5850")],
                             "#4a4540", joints=False, charred=0.4)


def m_shield(name):
    """ochre painted boards with a pale bend, chipped to wood, rim scuffed."""
    g = K.G(name)
    P = g.P
    loc = g.attr("hg_loc")[0]
    lx, ly, lz = g.sep(loc)
    bend = g.inv(g.mr(g.math("ABSOLUTE", g.sub(lx, g.mul(lz, 0.55))), 0.07, 0.09, 0.0, 1.0, False))
    # neutral livery (team colour is applied in-engine): ochre field, pale bend
    col = g.mix(bend, "#9a7a3c", "#cdbf98")
    col = g.mix(0.35, col, g.noise(P, 1.5, 3), "OVERLAY")
    chip = g.mr(g.noise(P, 6.0, 5, 0.65), 0.6, 0.64)
    col = g.mix(chip, col, "#6b5236")
    col = g.mix(0.3, col, g.noise(P, 40.0, 4), "OVERLAY")
    return g.out(col, g.add(0.7, g.mul(chip, 0.15)), g.sub(g.noise(P, 30.0, 3), g.mul(chip, 0.5)), 0.6, 0.004)


def bool_transfer(target, cutter):
    """boolean difference that gives the cut faces the CUTTER's material (hack marks show fresh wood)."""
    mod = target.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cutter
    if hasattr(mod, "material_mode"):
        mod.material_mode = "TRANSFER"
    bpy.context.view_layer.objects.active = target
    for o in bpy.context.selected_objects:
        o.select_set(False)
    target.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


# =====================================================================  HALL
def hall_stone(top=STONE_H, ragged=False):
    wall = Batch("hallwall", "rubble")
    box(wall, (HX0, HYF, 0), (HX1, HYB, top))
    SOLIDS.append(((HX0 + 0.05, HYF + 0.05, 0), (HX1 - 0.05, HYB - 0.05, top)))
    cut = Batch("hallcut", "dark")
    fr = Face((HX0, HYF, 0), (0, -1, 0))        # u = x - HX0
    fb = Face((HX1, HYB, 0), (0, 1, 0))         # u = HX1 - x
    fw = Face((HX0, HYB, 0), (-1, 0, 0))        # u = HYB - y
    ok = lambda v: v < top - 0.2
    # great door into the hall, facing the yard
    if top > 2.6:
        window(fr, cut, -2.45 - HX0, 0.0, 1.45, 2.45, "round", depth=0.6, backdark=False)
        door_leaf(fr, -2.45 - HX0, 0.0, 1.45, 2.45, 0.52, arch=True)
    for xu in (-6.3, -4.3, 0.4, 2.2):
        if ok(2.35):
            window(fr, cut, xu - HX0, 1.3, 0.5, 0.95, "flat", depth=0.6)
            for k in (-1, 1):
                cyl(B("iron"), fr.p(xu - HX0 + k * 0.1, 0.2, 1.3), fr.p(xu - HX0 + k * 0.1, 0.2, 2.25), 0.014, n=5)
            fr.box(B("iron"), xu - HX0 - 0.25, xu - HX0 + 0.25, 0.18, 0.21, 1.72, 1.76)
    if ok(2.4):
        for u in (2.5, 6.8, 9.6):
            window(fb, cut, u, 1.3, 0.45, 0.9, "flat", depth=0.6)
        window(fw, cut, 2.3, 1.2, 0.5, 1.0, "round", depth=0.6)
    if ragged:
        # walls still rising: hollow the shell so the interior (and its earth floor) shows
        box(cut, (HX0 + 0.7, HYF + 0.7, 0.25), (HX1 + 0.5, HYB - 0.7, top + 1.0))
        SOLIDS.pop()
        box(B("soil"), (HX0 + 0.68, HYF + 0.68, 0.0), (HX1 - 0.02, HYB - 0.68, 0.27), 0.0)
        # doorway left open in the front wall
        fr.box(cut, -2.45 - HX0 - 0.72, -2.45 - HX0 + 0.72, -0.3, 1.0, 0.0, 2.2)
    if len(cut.F):
        apply_boolean(wall.build(), cutter_obj(cut))
    else:
        wall.build()
    ol = [(HX1, HYF), (HX0, HYF), (HX0, HYB), (HX1, HYB)]
    plinth(ol, closed=False, h=0.55, proud=0.22)
    quoins((HX0, HYF), (-1, 0, 0), (0, -1, 0), 0.55, top - 0.02)
    quoins((HX0, HYB), (-1, 0, 0), (0, 1, 0), 0.55, top - 0.02)
    if ragged:
        return
    # wall-head: an ashlar cill course under the timber upper storey
    for f, u0, u1 in ((fr, -0.05, HX1 - HX0), (fw, -0.05, HYB - HYF + 0.05), (fb, 0.0, HX1 - HX0 + 0.05)):
        f.prism_dv(B("ashlar"), [(-0.1, top - 0.02), (0.25, top - 0.02), (0.25, top + 0.12), (-0.02, top + 0.12),
                                  (-0.1, top + 0.05)], u0, u1)


def hall_upper(stage="complete"):
    char = stage == "burnt"
    frame = stage == "frame"
    keep = 0.5 if char else 1.0
    oak = B("oak")
    z0 = STONE_H + 0.12
    Lf = HX1 - HX0
    # jetty joists on the front and the bressumer
    for u in grid(0.15, Lf - 0.15, 0.48, 0.02):
        if R.random() < keep:
            beam(oak, (HX0 + u, HYF + 0.35, z0 + 0.08), (HX0 + u, UF - 0.07, z0 + 0.08 + jit(0.01)), 0.13, 0.16, 0.012,
                 side=(0, 0, 1))
    beam(oak, (HX0 - 0.1, UF + 0.1, UP0 - 0.13), (HX1, UF + 0.1, UP0 - 0.13), 0.22, 0.22, 0.02, side=(0, 1, 0))
    fu = Face((HX0, UF, 0), (0, -1, 0))                  # upper front, u = x - HX0
    fb = Face((HX1, HYB, 0), (0, 1, 0))                  # back, u = HX1 - x
    fw = Face((HX0, HYB, 0), (-1, 0, 0))                 # west end, u = HYB - y
    fe = Face((HX1, UF, 0), (1, 0, 0))                   # east end (above the wing), u = y - UF
    Le = HYB - UF
    if frame:
        for f, L_, st in ((fu, Lf, 1.6), (fb, Lf, 1.9), (fw, Le, 1.6)):
            for u in grid(0.1, L_ - 0.1, st):
                f.timber(oak, u, UP0, u, PLATE, 0.22, 0.18)
            f.timber(oak, -0.1, UP0 - 0.1, L_ + 0.1, UP0 - 0.1, 0.22, 0.2)
        for f, L_ in ((fu, Lf), (fw, Le)):
            f.timber(oak, 0.0, PLATE + 0.1, L_ * 0.62, PLATE + 0.1, 0.2, 0.2)
        return
    # front: close studding, three mullioned windows, a loft door with a hoist beam
    ops = [(0.9, 2.1, 3.95, 4.85, "win"), (4.5, 5.6, UP0 + 0.02, 5.2, "door"), (7.4, 8.6, 3.95, 4.85, "win"),
           (9.8, 10.9, 3.95, 4.85, "win")]
    posts = []
    for u in grid(0.1, Lf - 0.1, 0.55, 0.03):
        if any(a - 0.2 < u < b + 0.2 for (a, b, *_) in ops):
            continue
        posts.append(u)
    for (a, b, *_) in ops:
        posts += [a - 0.1, b + 0.1]
    braces = [(2.3, UP0 + 0.1, 3.3, 3.9), (6.8, 3.9, 5.8, UP0 + 0.1)]
    frame_face(fu, Lf, UP0, PLATE, sorted(posts), [3.9, 4.9, PLATE + 0.1], ops, braces, char=char, keep_frac=keep,
               slab=not char)
    if not char:
        # hoist beam over the loft door, with rope and hook
        hb0, hb1 = fu.p(5.05, 0.6, 5.32), fu.p(5.05, -0.95, 5.32)
        beam(oak, hb0, hb1, 0.16, 0.18, 0.012, side=(0, 0, 1))
        beam(oak, fu.p(5.05, 0.05, 4.6), fu.p(5.05, -0.55, 5.24), 0.1, 0.1, 0.01, side=(1, 0, 0))
        cyl(B("rope"), fu.p(5.05, -0.82, 5.23), fu.p(5.05 + 0.03, -0.8, 3.6), 0.012, n=5)
        cyl(B("iron"), fu.p(5.05, -0.8, 3.62), fu.p(5.05, -0.8, 3.48), 0.02, 0.005, n=5)
    # back + west end, plainer square panels
    frame_face(fb, Lf, UP0, PLATE, grid(0.1, Lf - 0.1, 1.2), [4.4, PLATE + 0.1],
               [(3.0, 3.9, 3.95, 4.8, "win"), (8.2, 9.1, 3.95, 4.8, "win")],
               [(0.2, UP0 + 0.05, 1.2, 4.4), (Lf - 0.2, UP0 + 0.05, Lf - 1.2, 4.4)], char=char, keep_frac=keep)
    frame_face(fw, Le, UP0, PLATE, [0.12, 1.2, 2.4, 3.6, Le - 0.12], [4.4, PLATE + 0.1],
               [(1.9, 2.9, 3.95, 4.8, "win")],
               [(0.2, UP0 + 0.05, 1.1, 4.4), (Le - 0.2, UP0 + 0.05, Le - 1.1, 4.4)], char=char, keep_frac=keep,
               slab=not char)
    # east end: only above the wing roof is seen; frame it simply
    frame_face(fe, Le, UP0, PLATE, [0.12, 1.3, 2.5, 3.7, Le - 0.12], [4.4, PLATE + 0.1], [],
               [(0.2, UP0 + 0.05, 1.2, 4.4), (Le - 0.2, UP0 + 0.05, Le - 1.2, 4.4)], char=char, keep_frac=keep)
    if not char:
        gable_face(fw, 0.0, Le, PLATE + 0.2, RIDGE_Z - 0.3, Le / 2)
        gable_face(fe, 0.0, Le, PLATE + 0.2, RIDGE_Z - 0.3, Le / 2)


def hall_roof(burnt=False):
    oak = B("oak")
    I = Matrix.Identity(4)
    mir = Matrix.Translation((0, 2 * RIDGE_Y, 0)) @ Matrix.Scale(-1, 4, (0, 1, 0))
    ov = 0.5
    eave = (UF - ov, PLATE + 0.24 - ov * math.tan(PITCH))
    ridge = (RIDGE_Y, RIDGE_Z + 0.24)
    x0, x1 = HX0 - 0.4, HX1 + 0.4
    kw = dict(row_w=0.6, lap=0.68, thick=0.055, lift=0.045, sag=0.09, seg=9, wob=0.02, grade=0.5)
    if burnt:
        # two roof sections broke at the ridge and swung down on their eaves into the gutted hall:
        # each slope is rotated about its own eave line until its upper edge rests on the debris
        L_ = math.hypot(RIDGE_Y - eave[0], ridge[1] - eave[1])
        for (base, xa, xb, rest) in ((mir, x0, -3.4, STONE_H + 0.5), (I, 0.6, x1, STONE_H + 0.35)):
            hy = (base @ Vector((0, eave[0], eave[1]))).y
            hz = eave[1]
            ry = (base @ Vector((0, ridge[0], ridge[1]))).y
            sgn = 1 if ry < hy else -1                      # which way the slope runs from its eave
            phi = math.atan2(ridge[1] - hz, abs(ry - hy))
            tgt = math.asin(max(-0.95, (rest - hz) / L_))
            th = abs(phi - tgt)
            rp = base @ Vector((0, ridge[0], ridge[1]))
            best = None
            for t_ in (th, -th):             # pick the swing that drops the broken edge INTO the hall
                Mr = Matrix.Translation((0, hy, hz)) @ Matrix.Rotation(t_, 4, "X") @ Matrix.Translation((0, -hy, -hz))
                q = Mr @ rp
                if UF < q.y < HYB and (best is None or q.z < best[0]):
                    best = (q.z, Mr)
            Mr = best[1]
            roof_rows(B("slate"), Mr @ base, xa, xb, eave, ridge, stop=lambda t: t < 0.9 and R.random() > 0.08, **kw)
        for x in grid(-5.0, 2.8, 0.6, 0.05):
            if R.random() < 0.65:
                t = R.uniform(0.3, 1.0)
                for sgn in (1, -1):
                    if R.random() < 0.75:
                        ey = RIDGE_Y - sgn * (HALF + 0.2)
                        p0 = Vector((x, ey, PLATE))
                        p1 = p0.lerp(Vector((x + jit(0.3), RIDGE_Y, RIDGE_Z - R.uniform(0, 1.2))), t)
                        beam(oak, p0, p1, 0.12, 0.15, 0.01, side=(1, 0, 0))
        return
    roof_rows(B("slate"), I, x0, x1, eave, ridge, **kw)
    roof_rows(B("slate"), mir, x0, x1, eave, ridge, **kw)
    ridge_tiles(B("ashlar"), I, x0, x1, RIDGE_Y, RIDGE_Z + 0.32, r=0.16, piece=0.55)
    # bargeboards on both verges
    for xe in (x0 - 0.02, x1 + 0.02):
        for sgn in (1, -1):
            ey = RIDGE_Y - sgn * (HALF + ov + 0.05)
            p0 = Vector((xe, ey, PLATE + 0.16 - (ov + 0.05) * math.tan(PITCH)))
            p1 = Vector((xe, RIDGE_Y, RIDGE_Z + 0.2))
            beam(B("plank"), p0, p1, 0.3, 0.05, 0.008, side=(1, 0, 0))


def hall_chimney(ruin=False):
    c = B("chimney")
    x0, x1 = -5.4, -4.2
    box(c, (x0, HYB - 0.05, 0), (x1, HYB + 0.95, 5.0), 0.03)
    pts = []
    for (a, b, y1, z) in ((x0, x1, HYB + 0.95, 5.0), (x0 + 0.25, x1 - 0.25, HYB + 0.7, 5.6)):
        pts += [(a, HYB - 0.05, z), (b, HYB - 0.05, z), (a, y1, z), (b, y1, z)]
    prism_hull(c, pts)
    top = 9.3 if not ruin else 6.6
    box(c, (x0 + 0.25, HYB - 0.35, 5.6), (x1 - 0.25, HYB + 0.7, top), 0.03)
    if not ruin:
        box(B("ashlar"), (x0 + 0.13, HYB - 0.47, top), (x1 - 0.13, HYB + 0.82, top + 0.2), 0.03)
        box(c, (x0 + 0.35, HYB - 0.25, top + 0.2), (x1 - 0.35, HYB + 0.6, top + 0.55), 0.02)
        box(B("dark"), (x0 + 0.48, HYB - 0.12, top + 0.53), (x1 - 0.48, HYB + 0.47, top + 0.56))
    quoins((x1, HYB + 0.95), (1, 0, 0), (0, 1, 0), 0.2, 5.0, course=0.36, la=0.42, lb=0.26)


# =====================================================================  ARMOURY WING
def wing(stage="complete"):
    ruin = stage == "burnt"
    top = WALL_H if stage != "low" else 1.6
    wall = Batch("wingwall", "rubble")
    box(wall, (WX0, WY0, 0), (WX1, WY1, top))
    SOLIDS.append(((WX0 + 0.05, WY0 + 0.05, 0), (WX1 - 0.05, WY1 - 0.05, top)))
    cut = Batch("wingcut", "dark")
    fwst = Face((WX0, HYF, 0), (-1, 0, 0))     # yard face: u = HYF - y
    fea = Face((WX1, WY0, 0), (1, 0, 0))       # east: u = y - WY0
    fso = Face((WX0, WY0, 0), (0, -1, 0))      # south gable: u = x - WX0
    doors = [HYF - (-1.35), HYF - (-3.6)]      # u of the two stable doors
    if top > 2.3:
        for u in doors:
            window(fwst, cut, u, 0.0, 1.15, 2.05, "flat", depth=0.6, backdark=True, surround=True)
        for u in (2.2, 5.4, 8.2):
            window(fea, cut, u, 1.35, 0.42, 0.85, "flat", depth=0.6)
            for k in (-1, 0, 1):
                cyl(B("iron"), fea.p(u + k * 0.12, 0.2, 1.35), fea.p(u + k * 0.12, 0.2, 2.2), 0.014, n=5)
        window(fso, cut, (WX1 - WX0) / 2, 1.2, 0.45, 0.95, "round", depth=0.6)
    if len(cut.F):
        apply_boolean(wall.build(), cutter_obj(cut))
    else:
        wall.build()
    ol = [(WX0, WY0), (WX1, WY0), (WX1, WY1), (HX1 - 0.3, WY1)]
    plinth([(WX0, HYF + 0.3), (WX0, WY0)], closed=False, h=0.45, proud=0.18)
    plinth(ol, closed=False, h=0.5, proud=0.24)
    for c, a, b in (((WX0, WY0), (-1, 0, 0), (0, -1, 0)), ((WX1, WY0), (0, -1, 0), (1, 0, 0)),
                    ((WX1, WY1), (1, 0, 0), (0, 1, 0))):
        quoins(c, a, b, 0.5, top - (R.uniform(0.3, 1.2) if ruin else 0.0), course=0.38, la=0.55, lb=0.3)
    if top > 2.3:
        # buttress on the long east wall
        for yb in (-0.3,):
            pts = []
            for (d, z) in ((0.0, 0.0), (0.75, 0.0), (0.75, 0.6), (0.2, top - 0.3), (0.0, top - 0.3)):
                for yy in (yb - 0.35, yb + 0.35):
                    pts.append((WX1 + d, yy, z))
            prism_hull(B("rubble"), pts)
        if stage in ("complete", "burnt"):
            for u in doors:
                stable_door(fwst, u, 0.0, 1.15, 2.05, open_top=(stage == "complete"))
    if stage in ("complete", "burnt", "rafters"):
        wing_roof(stage)


def stable_door(f, u, v0, w, h, open_top=True):
    oak, pl, ir = B("oak"), B("plank"), B("iron")
    d = 0.14
    # oak frame in the reveal
    f.box(oak, u - w / 2 - 0.02, u - w / 2 + 0.1, 0.02, 0.2, v0, v0 + h, 0.01)
    f.box(oak, u + w / 2 - 0.1, u + w / 2 + 0.02, 0.02, 0.2, v0, v0 + h, 0.01)
    f.box(oak, u - w / 2 - 0.02, u + w / 2 + 0.02, 0.02, 0.22, v0 + h - 0.14, v0 + h + 0.02, 0.01)
    f.box(B("ashlar"), u - w / 2 - 0.2, u + w / 2 + 0.2, -0.05, 0.3, v0 + h, v0 + h + 0.3, 0.015)  # lintel
    ww = w - 0.2
    n = 5
    # lower leaf, closed
    for i in range(n):
        ua = u - ww / 2 + i * ww / n
        f.box(pl, ua + 0.004, ua + ww / n - 0.004, d, d + 0.05, v0 + 0.02, v0 + 1.08 + jit(0.01), 0.006)
    f.box(oak, u - ww / 2, u + ww / 2, d - 0.04, d, v0 + 0.95, v0 + 1.1, 0.008)   # top rail / ledge
    for vv in (v0 + 0.2, v0 + 0.8):
        f.box(ir, u - ww / 2 - 0.06, u + ww / 2 * 0.3, d - 0.055, d - 0.04, vv, vv + 0.055)
    # upper leaf
    if open_top:
        hinge = f.p(u - w / 2 - 0.03, -0.03, 0)
        ang = math.radians(R.uniform(150, 165))
        ddir = f.al * math.cos(ang) - f.inw * math.sin(ang)
        vv0, vv1 = v0 + 1.12, v0 + h - 0.16
        for i in range(n):
            a0 = i * ww / n
            p0 = hinge + ddir * (a0 + 0.004)
            p1 = hinge + ddir * (a0 + ww / n - 0.004)
            cz = (vv0 + vv1) / 2
            pp0 = Vector((p0.x, p0.y, cz)); pp1 = Vector((p1.x, p1.y, cz))
            beam(pl, pp0, pp1, vv1 - vv0, 0.045, 0.006, side=Vector((0, 0, 1)).cross(ddir))
        for vv in (vv0 + 0.15, vv1 - 0.18):
            p0 = hinge + ddir * 0.0
            p1 = hinge + ddir * (ww * 0.75)
            beam(ir, Vector((p0.x, p0.y, vv)) - f.inw * 0.03, Vector((p1.x, p1.y, vv)) - f.inw * 0.03, 0.05, 0.012,
                 0.0, side=Vector((0, 0, 1)).cross(ddir))
    else:
        for i in range(n):
            ua = u - ww / 2 + i * ww / n
            f.box(pl, ua + 0.004, ua + ww / n - 0.004, d, d + 0.05, v0 + 1.12, v0 + h - 0.16, 0.006)


def wing_roof(stage):
    ov = 0.38
    # local frame: local x -> world y, local y -> world -x   (rotation +90deg about z)
    M = Matrix.Rotation(math.pi / 2, 4, "Z")
    ez = WALL_H - ov * math.tan(WPITCH) + 0.05
    y0, y1 = WY0 - 0.08, WY1 + 0.05
    kw = dict(row_w=0.3, lap=0.7, thick=0.03, lift=0.03, sag=0.06, seg=9, wob=0.014)
    oak = B("oak")
    if stage == "rafters":
        for y in grid(y0 + 0.2, y1 - 0.2, 0.5, 0.0):
            for xe in (WX0 - 0.2, WX1 + 0.2):
                beam(oak, (xe, y, WALL_H - 0.2 * math.tan(WPITCH)), (WRX, y, WRZ), 0.1, 0.14, 0.01, side=(0, 1, 0))
        beam(oak, (WRX, y0, WRZ), (WRX, y1, WRZ), 0.14, 0.16, 0.012)
        # laths + a first stretch of shingles on the east slope
        roof_rows(B("shingle"), M, -y1, -y1 + 3.5, (-(WX1 + ov), ez), (-WRX, WRZ + 0.05), stop=lambda t: t < 0.6, **kw)
        return
    if stage == "burnt":
        roof_rows(B("shingle"), M, -y1, -1.0, (-(WX1 + ov), ez), (-WRX, WRZ + 0.05), stop=lambda t: t < 0.7, **kw)
        roof_rows(B("shingle"), M, -y1, 0.5, (-(WX0 - ov), ez), (-WRX, WRZ + 0.05), **kw)
        for y in grid(-0.8, y1 - 0.4, 0.55, 0.05):
            if R.random() < 0.6:
                for xe in (WX0 - 0.2, WX1 + 0.2):
                    if R.random() < 0.7:
                        t = R.uniform(0.35, 1.0)
                        p0 = Vector((xe, y, WALL_H - 0.1))
                        beam(oak, p0, p0.lerp(Vector((WRX, y + jit(0.3), WRZ - R.uniform(0, 1))), t), 0.1, 0.14, 0.01,
                             side=(0, 1, 0))
    else:
        roof_rows(B("shingle"), M, -y1, -y0, (-(WX1 + ov), ez), (-WRX, WRZ + 0.05), **kw)
        roof_rows(B("shingle"), M, -y1, -y0, (-(WX0 - ov), ez), (-WRX, WRZ + 0.05), **kw)
        # ridge: two boards
        for s in (-1, 1):
            beam(B("plank"), (WRX + s * 0.1, y0, WRZ + 0.1), (WRX + s * 0.1, y1, WRZ + 0.1), 0.24, 0.04, 0.006,
                 side=(s * math.sin(WPITCH), 0, math.cos(WPITCH)))
    # stone gable at the south end with coped skews
    for gy, s in ((WY0, -1),):
        pts = []
        for yy in (gy, gy + 0.6):
            pts += [(WX0 - 0.02, yy, WALL_H - 0.02), (WX1 + 0.02, yy, WALL_H - 0.02), (WRX, yy, WRZ + 0.3)]
        if stage != "burnt":
            prism_hull(B("rubble"), pts)
            for (xa, za) in ((WX0 - 0.15, WALL_H + 0.02), (WX1 + 0.15, WALL_H + 0.02)):
                beam(B("ashlar"), (xa, gy + 0.25, za), (WRX, gy + 0.25, WRZ + 0.42), 0.5, 0.14, 0.015, side=(0, 1, 0))
            for xa in (WX0 - 0.1, WX1 + 0.1):
                box(B("ashlar"), (xa - 0.3, gy - 0.08, WALL_H - 0.3), (xa + 0.3, gy + 0.6, WALL_H + 0.05), 0.02)
            box(B("ashlar"), (WRX - 0.18, gy - 0.02, WRZ + 0.3), (WRX + 0.18, gy + 0.5, WRZ + 0.7), 0.02)
        else:
            pts = []
            for yy in (gy, gy + 0.6):
                pts += [(WX0 - 0.02, yy, WALL_H - 0.02), (WX1 + 0.02, yy, WALL_H - 0.02), (WX1 - 1.3, yy, WRZ - 0.9),
                        (WX0 + 1.1, yy, WALL_H + 0.8)]
            prism_hull(B("rubble"), pts)


# =====================================================================  YARD
def yard_floor(ruin=False):
    box(B("yard"), (HX0 + YT, YW0 + YT, 0), (WX0, HYF, 0.045), 0.0)
    # flagged causeway from the gate to the hall door, worn and gappy
    y = YW0 + YT + 0.02
    while y < HYF - 0.1:
        rh = R.uniform(0.38, 0.6)
        x = -3.35 + jit(0.05)
        while x < -1.55:
            w = min(R.uniform(0.4, 0.75), -1.5 - x)
            if R.random() < (0.9 if not ruin else 0.6):
                box(B("ashlar"), (x + 0.02, y + 0.02, 0.0), (x + w - 0.02, y + rh - 0.02, 0.075 + jit(0.012)), 0.018,
                    rot=(jit(0.015), jit(0.015), jit(0.03)))
            x += w
        y += rh
    # gateway threshold: worn flags between the piers
    for i in range(5):
        xa = GX0 + i * (GX1 - GX0) / 5
        box(B("ashlar"), (xa + 0.01, YW0 - 0.05, 0), (xa + (GX1 - GX0) / 5 - 0.01, YW0 + YT + 0.05, 0.06 + jit(0.01)), 0.015)


def yard_wall(stage="complete"):
    """rubble wall with coping, front (with gateway) and west side."""
    h = YH if stage in ("complete", "burnt") else 0.9
    rb = B("rubble")
    segs = [((HX0, YW0), (GX0 - 0.6, YW0 + YT)), ((GX1 + 0.6, YW0), (WX0, YW0 + YT)),
            ((HX0, YW0 + YT), (HX0 + YT, HYF))]
    breach = (-6.8, -5.1) if stage == "burnt" else None
    if breach:
        segs = [((HX0, YW0), (breach[0], YW0 + YT)), ((breach[1], YW0), (GX0 - 0.6, YW0 + YT))] + segs[1:]
        # broken stub in the breach, stepped and ragged
        for i in range(6):
            xa = breach[0] + i * (breach[1] - breach[0]) / 6
            hh = 0.25 + 0.9 * abs(i - 2.5) / 2.5 * R.uniform(0.5, 1.0)
            box(rb, (xa, YW0 + R.uniform(0, 0.08), 0), (xa + (breach[1] - breach[0]) / 6 + 0.02, YW0 + YT - R.uniform(0, 0.08), hh),
                0.03, rot=(jit(0.03), jit(0.03), jit(0.04)))
    for (a, b) in segs:
        box(rb, (a[0], a[1], 0), (b[0], b[1], h))
        SOLIDS.append(((a[0] + 0.03, a[1] + 0.03, 0), (b[0] - 0.03, b[1] - 0.03, h)))
    if stage != "complete" and stage != "burnt":
        return
    # coping: pitched stones in short lengths
    def coping(p0, p1, along_x):
        Ln = (p1[0] - p0[0]) if along_x else (p1[1] - p0[1])
        u = 0.0
        while u < Ln - 0.02:
            l = min(R.uniform(0.45, 0.8), Ln - u)
            if breach and along_x and breach[0] < p0[0] + u < breach[1]:
                u += l
                continue
            if along_x:
                x0, x1 = p0[0] + u + 0.004, p0[0] + u + l - 0.004
                yc = (p0[1] + p1[1]) / 2
                pts = [(x, yc + s * (YT / 2 + 0.06), h - 0.02) for x in (x0, x1) for s in (-1, 1)]
                pts += [(x, yc + s * (YT / 2 + 0.06), h + 0.1) for x in (x0, x1) for s in (-1, 1)]
                pts += [(x, yc, h + 0.3 + jit(0.02)) for x in (x0, x1)]
            else:
                y0, y1 = p0[1] + u + 0.004, p0[1] + u + l - 0.004
                xc = (p0[0] + p1[0]) / 2
                pts = [(xc + s * (YT / 2 + 0.06), y, h - 0.02) for y in (y0, y1) for s in (-1, 1)]
                pts += [(xc + s * (YT / 2 + 0.06), y, h + 0.1) for y in (y0, y1) for s in (-1, 1)]
                pts += [(xc, y, h + 0.3 + jit(0.02)) for y in (y0, y1)]
            prism_hull(B("ashlar"), [(p[0], p[1], p[2]) for p in pts])
            u += l
    coping((HX0, YW0), (GX0 - 0.6, YW0 + YT), True)
    coping((GX1 + 0.6, YW0), (WX0, YW0 + YT), True)
    coping((HX0, YW0 + YT), (HX0 + YT, HYF), False)
    # gate piers
    for (xa, xb) in ((GX0 - 0.72, GX0), (GX1, GX1 + 0.72)):
        box(rb, (xa, YW0 - 0.1, 0), (xb, YW0 + YT + 0.1, 2.55))
        SOLIDS.append(((xa + 0.03, YW0 - 0.07, 0), (xb - 0.03, YW0 + YT + 0.07, 2.55)))
        quoins((xa, YW0 - 0.1), (-1, 0, 0), (0, -1, 0), 0.0, 2.55, course=0.36, la=0.4, lb=0.25)
        quoins((xb, YW0 - 0.1), (0, -1, 0), (1, 0, 0), 0.0, 2.55, course=0.36, la=0.4, lb=0.25)
        box(B("ashlar"), (xa - 0.08, YW0 - 0.18, 2.55), (xb + 0.08, YW0 + YT + 0.18, 2.72), 0.02)
        cx = (xa + xb) / 2
        prism_hull(B("ashlar"), [(cx + sx * 0.36, YW0 + YT / 2 + sy * 0.36, 2.72) for sx in (-1, 1) for sy in (-1, 1)] +
                   [(cx, YW0 + YT / 2, 3.08)])
    # the gates: two ledged-and-braced leaves swung into the yard
    if stage == "complete":
        for side, ang in ((-1, math.radians(R.uniform(70, 80))), (1, math.radians(R.uniform(95, 110)))):
            hx = GX0 + 0.05 if side < 0 else GX1 - 0.05
            hinge = Vector((hx, YW0 + YT - 0.05, 0.08))
            ww = (GX1 - GX0) / 2 - 0.06
            dirn = Vector((-side * math.cos(ang) * -1, math.sin(ang), 0)).normalized()
            dirn = Vector((side * -math.cos(ang), math.sin(ang), 0))
            nb = 6
            for i in range(nb):
                a0 = i * ww / nb
                p0 = hinge + dirn * (a0 + 0.004)
                p1 = hinge + dirn * (a0 + ww / nb - 0.004)
                c0 = (p0 + p1) / 2
                beam(B("plank"), c0, c0 + Vector((0, 0, 1.75 + jit(0.03))), ww / nb - 0.008, 0.04, 0.006,
                     side=Vector((0, 0, 1)).cross(dirn))
            nrm = Vector((0, 0, 1)).cross(dirn).normalized()
            for zz in (0.35, 1.45):
                beam(B("oak"), hinge + nrm * 0.045 + Vector((0, 0, zz)),
                     hinge + nrm * 0.045 + dirn * ww + Vector((0, 0, zz)), 0.12, 0.04, 0.006, side=nrm)
            beam(B("oak"), hinge + nrm * 0.045 + Vector((0, 0, 0.42)), hinge + nrm * 0.045 + dirn * ww + Vector((0, 0, 1.38)),
                 0.1, 0.04, 0.006, side=nrm)


def pike(base, top, head=0.28, r=0.021, mat="ashwood"):
    base, top = Vector(base), Vector(top)
    d = (top - base).normalized()
    cyl(B(mat), base, top, r * 1.05, r * 0.9, n=5)
    tip = top + d * head
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    up = d.cross(side).normalized()
    pts = [top - d * 0.02, tip]
    for s in (-1, 1):
        pts.append(top + d * head * 0.35 + side * s * 0.035)
        pts.append(top + d * head * 0.35 + up * s * 0.012)
    prism_hull(B("iron"), [tuple(p) for p in pts])
    cyl(B("iron"), top - d * 0.1, top + d * 0.02, r * 1.2, r * 1.1, n=5)   # socket


def spear(base, top, r=0.019):
    base, top = Vector(base), Vector(top)
    d = (top - base).normalized()
    cyl(B("ashwood"), base, top, r, r * 0.9, n=5)
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    up = d.cross(side).normalized()
    pts = [top, top + d * 0.36]
    for s in (-1, 1):
        pts.append(top + d * 0.13 + side * s * 0.05)
        pts.append(top + d * 0.13 + up * s * 0.014)
    prism_hull(B("iron"), [tuple(p) for p in pts])


def pike_rack(x0, x1, y, lean_ok=True, fallen=False):
    """long free-standing rack: posts, a notched top rail at 2.2 m; pikes stand on both sides."""
    oak = B("oak")
    for x in grid(x0, x1, 1.5, 0.03):
        beam(oak, (x, y, 0.0), (x + jit(0.01), y, 2.3), 0.13, 0.13, 0.012)
        for s in (-1, 1):
            beam(oak, (x, y + s * 0.55, 0.0), (x, y + s * 0.04, 0.9), 0.08, 0.08, 0.01, ext=0.03)
    if fallen:
        beam(oak, (x0 - 0.1, y + 0.3, 0.1), (x1 + 0.1, y + 1.2, 0.2), 0.12, 0.1, 0.01)
    else:
        beam(oak, (x0 - 0.12, y, 2.26), (x1 + 0.12, y, 2.26), 0.12, 0.1, 0.01)
        beam(oak, (x0 - 0.05, y, 0.55), (x1 + 0.05, y, 0.55), 0.09, 0.08, 0.01)
    x = x0 + 0.15
    k = 0
    while x < x1 - 0.1:
        s = 1                                  # all stand on the hall side and lean out over the yard
        if fallen:
            if R.random() < 0.55:
                a = R.uniform(-0.5, 0.5)
                b = Vector((x + jit(0.3), y + s * R.uniform(0.5, 2.5), 0.03))
                pike(b, b + Vector((math.sin(a) * 4.6, s * math.cos(a) * 4.6, 0.05)))
        else:
            ln = R.uniform(4.9, 5.4)
            base = Vector((x + jit(0.04), y + R.uniform(0.62, 0.8), 0.02))
            hit = Vector((x + jit(0.03), y + 0.07, 2.3))
            d = (hit - base).normalized()
            pike(base, base + d * ln)
        x += R.uniform(0.17, 0.26)
        k += 1


def spear_rack(cx, cy, n=9, yaw=0.0, fallen=False):
    """A-frame rack: spears lean on a rail; two shields hung at the end."""
    oak = B("oak")
    ca, sa = math.cos(yaw), math.sin(yaw)
    W = 1.9
    tr = lambda u, v, z: Vector((cx + u * ca - v * sa, cy + u * sa + v * ca, z))
    for u in (-W / 2, W / 2):
        beam(oak, tr(u, -0.45, 0), tr(u, 0, 1.45), 0.07, 0.07, 0.008)
        beam(oak, tr(u, 0.45, 0), tr(u, 0, 1.45), 0.07, 0.07, 0.008)
    if fallen:
        beam(oak, tr(-W / 2, 0.3, 0.1), tr(W / 2, 0.9, 0.08), 0.08, 0.08, 0.01)
        for i in range(n):
            if R.random() < 0.6:
                b = tr(jit(1.2), R.uniform(-1.5, 1.5), 0.03)
                a = R.uniform(0, 2 * math.pi)
                spear(b, b + Vector((math.cos(a) * 2.2, math.sin(a) * 2.2, 0.04)))
        return
    beam(oak, tr(-W / 2 - 0.1, 0, 1.4), tr(W / 2 + 0.1, 0, 1.4), 0.08, 0.08, 0.01)
    beam(oak, tr(-W / 2, -0.22, 0.7), tr(W / 2, -0.22, 0.7), 0.06, 0.05, 0.008)
    beam(oak, tr(-W / 2, 0.22, 0.7), tr(W / 2, 0.22, 0.7), 0.06, 0.05, 0.008)
    for i in range(n):
        u = -W / 2 + 0.15 + (W - 0.3) * i / (n - 1) + jit(0.02)
        s = 1 if i % 2 else -1
        base = tr(u, s * 0.36, 0.02)
        hit = tr(u + jit(0.02), s * 0.04, 1.44)
        d = (hit - base).normalized()
        spear(base, base + d * R.uniform(2.3, 2.6))


def shield(p, face_dir, lean=0.25, w=0.62, h=0.82):
    """heater shield standing on its point edge, leaning back against something (face_dir = outward)."""
    fd = Vector(face_dir).normalized()
    side = Vector((0, 0, 1)).cross(fd).normalized()
    up = (Vector((0, 0, 1)) * math.cos(lean) - fd * math.sin(lean)).normalized()
    nrm = side.cross(up).normalized()
    if nrm.dot(fd) < 0:
        nrm = -nrm
    prof = []
    for i in range(9):
        t = i / 8
        # curved sides from top corners to the point
        yv = h * (1 - t)
        xv = (w / 2) * math.cos(t * math.pi / 2) ** 0.7
        prof.append((xv, yv))
    outline = prof + [(-x, y) for (x, y) in reversed(prof[:-1])]
    base = Vector(p) + up * 0.02
    pts, loc = [], []
    for off in (0.0, 0.035):
        for (x, y) in outline:
            bow = 0.04 * (1 - (2 * x / w) ** 2)
            q = base + side * x + up * y + nrm * (off + bow)
            pts.append(tuple(q))
            loc.append((x, off, y))
    P, F = hull(pts)
    B("shield").add(P, F, None, None, [(q[0] - base.x, 0.0, q[2] - base.z) for q in P])
    # iron boss/rim hint: a rim band on top
    beam(B("iron"), base + up * (h - 0.02) - side * (w / 2) + nrm * 0.05, base + up * (h - 0.02) + side * (w / 2) + nrm * 0.05,
         0.035, 0.02, 0.0, side=nrm)


def pell(x, y, hacked=True, ruin=False):
    """practice post, 1.8 m, squared oak, hacked on its face with fresh-cut notches."""
    hgt = 1.85 if not ruin else 1.1
    bt = Batch("pell_%d" % len(BATCHES), "oak")
    box(bt, (x - 0.11, y - 0.11, 0), (x + 0.11, y + 0.11, hgt), 0.012, rot=(jit(0.02), jit(0.02), jit(0.3)))
    # stone packing collar at the foot
    for i in range(7):
        a = i / 7 * 2 * math.pi + jit(0.2)
        r = 0.2
        box(B("rubble"), (x + math.cos(a) * r - 0.09, y + math.sin(a) * r - 0.07, 0),
            (x + math.cos(a) * r + 0.09, y + math.sin(a) * r + 0.07, 0.1 + jit(0.03)), 0.02, rot=(jit(0.2), jit(0.2), a))
    cut = Batch("pcut_%d" % len(BATCHES), "fresh")
    if hacked:
        for i in range(14):
            z = R.uniform(0.7, min(1.75, hgt - 0.05))
            face = R.choice((0, 0, 1, 3))              # mostly the -Y face (faces the drill line)
            a = face * math.pi / 2 + math.pi * 1.5
            n = Vector((math.cos(a), math.sin(a), 0))
            tang = Vector((0, 0, 1)).cross(n)
            tilt = R.uniform(-0.6, 0.6)
            c = Vector((x, y, z)) + n * 0.115
            dvec = (tang * math.cos(tilt) + Vector((0, 0, 1)) * math.sin(tilt)).normalized()
            wv = n.cross(dvec).normalized()
            l = R.uniform(0.1, 0.2)
            dep = R.uniform(0.018, 0.04)
            pts = []
            for s in (-l / 2, l / 2):
                base = c + dvec * s
                pts += [tuple(base + n * 0.03 + wv * 0.012), tuple(base + n * 0.03 - wv * 0.012), tuple(base - n * dep)]
            prism_hull(cut, pts)
    ob = bt.build()
    if cut.F:
        bool_transfer(ob, cutter_obj(cut))
    BATCHES.pop(bt.name, None)
    # chips of fresh wood at the foot
    if hacked:
        for i in range(8):
            a = R.uniform(0, 2 * math.pi); r = R.uniform(0.25, 0.7)
            box(B("fresh"), (x + math.cos(a) * r - 0.03, y + math.sin(a) * r - 0.012, 0.0),
                (x + math.cos(a) * r + 0.03, y + math.sin(a) * r + 0.012, 0.012), 0.0, rot=(0, 0, R.uniform(0, 3)))


def straw_butt(x, y, face_yaw, burnt=False, arrows=4):
    """round straw target bound with rope bands, on an oak A-frame; face points along face_yaw."""
    fd = Vector((math.cos(face_yaw), math.sin(face_yaw), 0))
    side = Vector((0, 0, 1)).cross(fd)
    tilt = math.radians(12)
    axis = (fd * math.cos(tilt) + Vector((0, 0, 1)) * math.sin(tilt)).normalized()
    c = Vector((x, y, 0.92))
    r, t = 0.6, 0.42
    if not burnt:
        cyl(B("straw"), c - axis * t / 2, c + axis * t / 2, r, n=16, bulge=0.04)
        for off in (-0.13, 0.13):
            cyl(B("rope"), c + axis * (off - 0.025), c + axis * (off + 0.025), r + 0.045, n=16)
        # painted clout: a darker disc on the face
        cyl(B("rope"), c + axis * (t / 2 + 0.0), c + axis * (t / 2 + 0.012), 0.16, n=12)
        for i in range(arrows):
            a = R.uniform(0, 2 * math.pi); rr = R.uniform(0.0, 0.45)
            hit = c + axis * (t / 2) + side * math.cos(a) * rr + Vector((0, 0, math.sin(a) * rr))
            dvec = (axis + side * jit(0.15) + Vector((0, 0, jit(0.12) + 0.05))).normalized()
            tail = hit + dvec * 0.55
            cyl(B("ashwood"), hit - dvec * 0.08, tail, 0.006, n=4)
            for k in range(3):
                ang = k * 2 * math.pi / 3
                v = (side * math.cos(ang) + Vector((0, 0, 1)) * math.sin(ang)) * 0.022
                prism_hull(B("fresh" if k else "shield"), [tuple(tail - dvec * 0.02), tuple(tail - dvec * 0.14),
                                                          tuple(tail - dvec * 0.04 + v), tuple(tail - dvec * 0.12 + v)])
    else:
        cyl(B("straw"), c - axis * t / 2 - Vector((0, 0, 0.5)), c + axis * t / 2 - Vector((0, 0, 0.55)), r * 0.7,
            n=10)
    # A-frame stand
    oak = B("oak")
    for s in (-1, 1):
        foot = Vector((x, y, 0)) + side * s * 0.55 + fd * 0.25
        beam(oak, foot, c + side * s * 0.25 - fd * 0.25 + Vector((0, 0, 0.3)), 0.08, 0.08, 0.008)
    beam(oak, Vector((x, y, 0)) - fd * 0.75, c - fd * 0.28 + Vector((0, 0, 0.25)), 0.08, 0.08, 0.008)
    beam(oak, c - fd * 0.28 + side * 0.5 - Vector((0, 0, 0.45)), c - fd * 0.28 - side * 0.5 - Vector((0, 0, 0.45)),
         0.07, 0.07, 0.008)


def mounting_block(x, y, yaw=0.0):
    ca, sa = math.cos(yaw), math.sin(yaw)
    for i, (d0, d1, zt) in enumerate(((0.0, 1.05, 0.28), (0.35, 1.05, 0.56), (0.7, 1.05, 0.84))):
        pts = []
        for (u, v) in ((-0.42, d0), (0.42, d0), (0.42, d1), (-0.42, d1)):
            for z in (0.0 if i == 0 else zt - 0.3, zt + jit(0.01)):
                pts.append((x + u * ca - v * sa + jit(0.01), y + u * sa + v * ca + jit(0.01), z))
        prism_hull(B("ashlar"), pts)


def pennon_pole(x, y, h=8.6, burnt=False):
    oak = B("oak")
    if burnt:
        cyl(oak, (x, y, 0), (x + jit(0.05), y, 3.1), 0.1, 0.085, n=8)
        cyl(oak, (x + 0.2, y - 0.3, 0.1), (x + 4.5, y - 1.6, 0.25), 0.08, 0.06, n=7)
        return
    cyl(oak, (x, y, 0), (x, y, h), 0.1, 0.055, n=8)
    for i in range(6):
        a = i / 6 * 2 * math.pi
        box(B("rubble"), (x + math.cos(a) * 0.22 - 0.1, y + math.sin(a) * 0.22 - 0.08, 0),
            (x + math.cos(a) * 0.22 + 0.1, y + math.sin(a) * 0.22 + 0.08, 0.14), 0.02, rot=(0, 0, a))
    cyl(B("iron"), (x, y, h), (x, y, h + 0.3), 0.05, 0.005, n=6)
    cyl(B("iron"), (x, y, h - 0.05), (x, y, h + 0.02), 0.07, n=6)
    beam(oak, (x, y, h - 0.25), (x + 0.5, y, h - 0.25), 0.05, 0.05, 0.005)
    K.pennon((x + 0.02, y, h - 0.62), length=3.4, h0=0.95, tail=0.7, yaw=math.radians(-8), wave=0.24)
    cyl(B("rope"), (x + 0.06, y, h - 0.1), (x + 0.06, y, 1.2), 0.008, n=4)


def quintain(x, y, yaw, ruin=False):
    """pivoting quintain: post, iron pivot, swinging arm with a blue target board and a straw sandbag."""
    oak = B("oak")
    if ruin:
        beam(oak, (x, y, 0), (x + 0.1, y, 1.3), 0.2, 0.2, 0.012)
        beam(oak, (x + 0.4, y - 0.3, 0.1), (x + 2.5, y + 0.6, 0.15), 0.12, 0.14, 0.01)
        return
    beam(oak, (x, y, 0), (x, y, 2.15), 0.22, 0.22, 0.014)
    for a in (0, 2.1, 4.2):
        beam(oak, (x + math.cos(a) * 0.7, y + math.sin(a) * 0.7, 0), (x, y, 0.75), 0.1, 0.1, 0.01)
    cyl(B("iron"), (x, y, 2.15), (x, y, 2.28), 0.07, n=8)
    ca, sa = math.cos(yaw), math.sin(yaw)
    p0 = Vector((x - ca * 0.9, y - sa * 0.9, 2.33)); p1 = Vector((x + ca * 1.5, y + sa * 1.5, 2.33))
    beam(oak, p0, p1, 0.12, 0.14, 0.012)
    # target board (heater shield) hanging at the short end, facing the charge
    shield(p0 + Vector((0, 0, -0.95)) + Vector((-sa, ca, 0)) * 0.03, Vector((-sa, ca, 0)) * -1, 0.02, 0.62, 0.8)
    # sandbag on a rope at the long end
    tip = p1 + Vector((0, 0, -0.08))
    cyl(B("rope"), tip, tip + Vector((0, 0, -0.55)), 0.012, n=4)
    c = tip + Vector((0, 0, -0.85))
    cyl(B("straw"), c - Vector((0, 0, 0.28)), c + Vector((0, 0, 0.28)), 0.17, 0.12, n=9, bulge=0.06)


def hung_shields():
    """team shields hung on pegs on the sunlit hall front (reads from the eagle camera)."""
    for x in (-5.3, -3.75, -1.05, 1.3):
        base = Vector((x + jit(0.05), HYF - 0.08, 1.5 + jit(0.04)))
        shield(base, (0, -1, 0), 0.08, 0.6, 0.78)
        cyl(B("oak"), base + Vector((0, 0.07, 0.72)), base + Vector((0, -0.08, 0.72)), 0.018, n=5)


def yard_props(ruin=False):
    # pike rack across the back of the yard
    pike_rack(-6.9, -4.3, -0.85, fallen=ruin)
    # spear rack in front of the east half of the hall
    spear_rack(0.9, -0.75, 9, yaw=0.0, fallen=ruin)
    if not ruin:
        hung_shields()
        shield((2.55, -2.45, 0.0), (-1, 0, 0), 0.35)
    # quintain in the west drill ground
    quintain(-4.9, -2.55, math.radians(25), ruin=ruin)
    # pells in the east drill ground
    for i, (px, py) in enumerate(((0.2, -2.3), (1.5, -3.0), (-0.85, -2.75))):
        pell(px + jit(0.06), py + jit(0.06), ruin=ruin and i == 1)
    # straw butts at the west end, faced east (out of the wall's shadow)
    for py in (-3.35, -2.0):
        straw_butt(-6.45, py, 0.0 + jit(0.05), burnt=ruin)
    for (bx, by, r, h, ly) in ((2.8, -0.05, 0.3, 0.85, False), (2.3, -0.3, 0.28, 0.8, False),
                               (2.85, -3.95, 0.32, 0.9, False), (2.2, -3.9, 0.3, 0.85, True)):
        K.barrel((bx, by, 0), r, h, lying=ly or (ruin and R.random() < 0.5))
    mounting_block(-0.25, -3.35, yaw=math.pi)


# =====================================================================  STATES
def build_complete():
    SOLIDS.append(((HX0, UF + 0.05, STONE_H), (HX1, HYB - 0.05, PLATE - 0.05)))
    hall_stone()
    hall_upper()
    hall_roof()
    hall_chimney()
    wing()
    yard_floor()
    yard_wall()
    yard_props()


def build1():
    """footings: first courses of hall + wing, trench for the yard wall, stakes and lines, materials."""
    rb = B("rubble")
    t = 0.75
    # footing runs abut (never overlap) so no two outer faces are coplanar
    for (a, b, c, d) in ((HX0, HYF, HX1, HYF + t), (HX0, HYB - t, HX1, HYB), (HX0, HYF + t, HX0 + t, HYB - t),
                         (WX0, WY0, WX1, WY0 + t), (WX1 - t, WY0 + t, WX1, WY1 - t), (WX0, WY0 + t, WX0 + t, HYF),
                         (HX1, WY1 - t, WX1, WY1)):
        box(rb, (a, b, 0), (c, d, R.uniform(0.55, 0.85)))
    # trench spoil: low irregular mounds along the outside of the footings
    for (p0, p1, n) in (((HX0, HYF - 0.6), (HX1 - 0.4, HYF - 0.6), (0, -1)), ((WX0 - 0.6, HYF - 0.8), (WX0 - 0.6, WY0 + 1.2), (-1, 0)),
                        ((WX0, WY0 - 0.6), (WX1, WY0 - 0.6), (0, -1))):
        a, b = Vector(p0 + (0.0,)), Vector(p1 + (0.0,))
        L_ = (b - a).length
        d = (b - a).normalized()
        nn = Vector(n + (0.0,))
        u = 0.0
        while u < L_ - 0.2:
            l = min(R.uniform(1.0, 1.8), L_ - u)
            pts = []
            for uu in (u, u + l):
                c = a + d * uu
                w = R.uniform(0.3, 0.45)
                pts += [tuple(c + nn * w), tuple(c - nn * w), tuple(c + nn * jit(0.08) + Vector((0, 0, R.uniform(0.18, 0.32))))]
            prism_hull(B("soil"), pts)
            u += l * 0.85
    for i in range(18):
        x = R.uniform(HX0 + 0.4, WX1 - 0.4)
        y = R.choice((HYF + R.uniform(0.1, 0.6), HYB - R.uniform(0.1, 0.6)))
        box(B("ashlar"), (x - 0.28, y - 0.18, 0.75), (x + 0.28, y + 0.18, 0.98), 0.02, rot=(0, 0, R.uniform(0, 3)))
    # yard wall trench (dark strip) + setting-out
    for (a, b) in (((HX0, YW0), (WX0, YW0 + YT)), ((HX0, YW0 + YT), (HX0 + YT, HYF))):
        box(B("dark"), (a[0], a[1], 0), (b[0], b[1], 0.04))
        box(B("soil"), (a[0] - 0.1, a[1] - 0.55 if b[1] - a[1] < 1 else a[1], 0),
            (b[0] + 0.1 if b[0] - a[0] > 1 else a[0] - 0.05, a[1] - 0.05 if b[1] - a[1] < 1 else b[1], 0.14), 0.05)
    stakes = [(HX0 - 0.5, YW0 - 0.5), (WX0 + 0.3, YW0 - 0.5), (HX0 - 0.5, HYF + 0.2), (WX1 + 0.5, WY1 + 0.5),
              (WX1 + 0.5, WY0 - 0.5), (HX0 - 0.5, HYB + 0.5)]
    for (x, y) in stakes:
        cyl(B("plank"), (x, y, 0), (x + jit(0.04), y + jit(0.04), 0.8), 0.035, 0.02, n=5)
    for (a, b) in ((0, 1), (0, 2), (4, 3), (1, 4), (2, 5)):
        pa, pb = stakes[a], stakes[b]
        beam(B("iron"), (pa[0], pa[1], 0.66), (pb[0], pb[1], 0.66), 0.01, 0.01, 0.0)
    stone_pile(-3.0, -2.2, 26, 1.5)
    stone_pile(1.5, -3.3, 18, 1.1)
    timber_stack(-7.4, -4.2, 4.5, 3)
    timber_stack(5.0, -3.8, 3.2, 2, along_x=False)
    K.barrel((0.6, -1.0, 0), 0.4, 0.4)
    K.barrel((-5.0, -1.8, 0), 0.3, 0.85)
    K.log_pile(-1.4, 1.6, 0.6, rows=3, length=1.0)


def build2():
    """ground storey going up, wing walled and raftered, upper frame starting, scaffold on the front."""
    hall_stone(top=2.35, ragged=True)
    rb = B("rubble")
    for (x0, y0, x1, y1) in ((HX0, HYF, HX1, HYF + 0.7), (HX0, HYB - 0.7, HX1, HYB)):
        n = int((x1 - x0) / 0.6)
        for i in range(n):
            if R.random() < 0.4:
                continue
            t0, t1 = i / n, (i + R.uniform(0.6, 0.95)) / n
            box(rb, (x0 + (x1 - x0) * t0, y0 + 0.1, 2.35), (x0 + (x1 - x0) * t1, y1 - 0.1, 2.35 + R.uniform(0.15, 0.3)),
                0.02)
    wing("rafters")
    # upper-storey posts being reared on the east part
    oak = B("oak")
    for x in grid(-1.0, HX1 - 0.1, 1.6):
        beam(oak, (x, HYF + 0.2, 2.4), (x, HYF + 0.2, PLATE), 0.2, 0.2, 0.014)
        beam(oak, (x, HYB - 0.15, 2.4), (x, HYB - 0.15, PLATE), 0.2, 0.2, 0.014)
    beam(oak, (-1.1, HYF + 0.2, PLATE + 0.1), (HX1 + 0.1, HYF + 0.2, PLATE + 0.1), 0.2, 0.2, 0.014)
    # shear-legs lifting a beam
    for s in (-1, 1):
        beam(oak, (-3.0 + s * 0.9, -0.8, 0), (-3.0, UF + 0.1, 6.6), 0.14, 0.14, 0.01)
    K.cyl(B("rope"), (-3.0, UF + 0.1, 6.5), (-3.0, UF - 0.1, 3.2), 0.015, n=5)
    beam(oak, (-4.6, UF - 0.2, 3.1), (-1.4, UF - 0.2, 3.25), 0.2, 0.2, 0.012)
    scaffold_face((HX0 - 0.1, HYF, 0), (-1.3, HYF, 0), (0, -1, 0), 3.4, 1.0)
    yard_wall("low")
    for (a, b) in (((GX1 + 0.6, YW0), (WX0, YW0 + YT)),):
        box(B("dark"), (a[0], a[1], 0), (b[0], b[1], 0.03))
    stone_pile(-3.5, -2.6, 22, 1.3)
    timber_stack(-7.0, -3.9, 4.0, 3)
    K.barrel((0.5, -2.5, 0), 0.4, 0.4)
    K.log_pile(0.2, -4.2, 2.2, rows=3, length=1.0)


def build_ruin():
    hall_stone()
    hall_upper("burnt")
    hall_roof(burnt=True)
    hall_chimney(ruin=True)
    wing("burnt")
    yard_floor()
    yard_wall("burnt")
    rubble_heap(-6.0, -4.75, 1.1, 0.7, 0.8, 18, "rubble")
    yard_props(ruin=True)
    # the upper storey fell in: charred beams and ash lying on the wall-head of the hall
    for i in range(16):
        x = R.uniform(HX0 + 0.5, HX1 - 0.8)
        y = R.uniform(HYF + 0.4, HYB - 0.4)
        a = R.uniform(0, math.pi)
        l = R.uniform(1.2, 3.0)
        p0 = Vector((x, y, STONE_H + 0.1))
        p1 = p0 + Vector((math.cos(a) * l, math.sin(a) * l, R.uniform(-0.05, 0.6)))
        p1.x = max(HX0 + 0.1, min(HX1 - 0.1, p1.x)); p1.y = max(HYF, min(HYB, p1.y))
        beam(B("oak"), p0, p1, 0.2, 0.2, 0.012)
    for i in range(24):
        x = R.uniform(HX0 + 0.3, HX1 - 0.3); y = R.uniform(HYF + 0.3, HYB - 0.3)
        s_ = R.uniform(0.3, 0.7)
        box(B("ash"), (x - s_, y - s_ * 0.6, STONE_H - 0.1), (x + s_, y + s_ * 0.6, STONE_H + R.uniform(0.1, 0.35)), 0.04,
            rot=(jit(0.1), jit(0.1), R.uniform(0, 3)))
    for i in range(14):
        x = R.uniform(WX0 + 0.4, WX1 - 0.4); y = R.uniform(-0.5, WY1 - 0.4)
        s_ = R.uniform(0.3, 0.6)
        box(B("ash"), (x - s_, y - s_ * 0.6, WALL_H - 0.1), (x + s_, y + s_ * 0.6, WALL_H + R.uniform(0.1, 0.3)), 0.04,
            rot=(jit(0.1), jit(0.1), R.uniform(0, 3)))
    for i in range(10):
        x = R.uniform(-6.5, 2.5)
        y = R.uniform(-3.5, -0.8)
        a = R.uniform(0, math.pi)
        l = R.uniform(1.4, 3.2)
        beam(B("oak"), (x, y, 0.15), (x + math.cos(a) * l, y + math.sin(a) * l, R.uniform(0.1, 0.9)), 0.18, 0.18,
             0.01)
    for i in range(20):
        x = R.uniform(-7.0, 2.8); y = R.uniform(-3.8, 0.0)
        box(B("slate"), (x - 0.2, y - 0.15, 0.0), (x + 0.2, y + 0.15, 0.03), 0.0, rot=(jit(0.2), jit(0.2), R.uniform(0, 3)))


def main():
    build_materials()
    K.NO_CULL = ("hallwall", "wingwall", "pell")
    if FULL:
        build_complete()
    elif B1:
        build1()
    elif B2:
        build2()
    else:
        build_ruin()
    name = "barracks" if FULL else "barracks_" + STATE
    K.finalize(name, tex=2048, lods=(1.0, 0.4, 0.12))


main()
