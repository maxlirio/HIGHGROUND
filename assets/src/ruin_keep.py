"""HIGHGROUND - Tor Knap: the ruined shell of a small stone keep (landmark, structure).

An 11 x 11 m tower keep of coursed limestone rubble with dressed quoins, 2.2 m walls on a
battered plinth. Two walls still stand in an L: the south (front, -Y) to 13 m at the corner,
stepping down ragged to the west; the east to 13.5 m, broken off low at its north end. Each
carries its openings: ground-floor loops with deep inner splays, the first-floor doorway (the
stair that reached it is gone) and a twin-light window, upper windows, putlog holes outside
and joist sockets and a fireplace with its flue inside. The north and west walls are grassy
stumps; their masonry lies in turfed rubble banks inside and out, with a toppled slab of walling
still bonded together. Ivy climbs the standing walls. Front faces -Y.

    blender -b -t 2 -P assets/src/ruin_keep.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _landkit import *
from _parish_kit import plinth

begin(161)
LIME = [(0.0, "#8f8776"), (0.25, "#a0978a"), (0.5, "#ada391"), (0.75, "#9d9482"), (1.0, "#877f70")]
MAT["rubble"] = m_stone2("rubble", LIME, "#6f675b", rowh=0.28, bw=0.55, moss=1.3)
MAT["ashlar"] = m_stone2("ashlar", [(0.0, "#a39a86"), (0.4, "#b2a891"), (0.7, "#aca38d"), (1.0, "#9a917e")], "#8a8272",
                         joints=False, bump=0.6, moss=1.0)
MAT["core"] = m_loose("core", [(0.0, "#6f685c"), (0.35, "#8a8272"), (0.7, "#9e9584"), (1.0, "#7a7264")], lump=6.0,
                      grass=0.85, moss=0.4, pebble=0.5, peb_tones=("#8f8776", "#b5ab96"))
MAT["block"] = m_rock("block", LIME, speck=0.1, lichen_d=0.4, lichen_amt=0.8, moss=0.9, cracks=0.4, streaks=0.4)
MAT["dark"] = m_simple2("dark", "#221e1a", "#2c2723", 0.95)
mat_turf("turf", dry=0.35)

S, T = 11.0, 2.2
X0, Y0, X1, Y1 = -S / 2, -S / 2, S / 2, S / 2
fS = Face((X0, Y0, 0), (0, -1, 0))
fE = Face((X1, Y0, 0), (1, 0, 0))
fN = Face((X1, Y1, 0), (0, 1, 0))
fW = Face((X0, Y1, 0), (-1, 0, 0))
rs = random.Random(5)


def wall(name, f, prof, d1, cuts=None, mat="rubble"):
    """like K.wall but booleans each opening separately (one self-overlapping cutter breaks EXACT)."""
    bt = Batch("wall_" + name, mat)
    slab_poly(f, bt, prof, 0.0, d1)
    cut = Batch("cut_" + name, "dark")
    if cuts:
        cuts(f, cut)
    ob = bt.build(); bt._built = True
    if cut.F:
        co = cutter_obj(cut)
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = co; co.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.separate(type="LOOSE"); bpy.ops.object.mode_set(mode="OBJECT")
        parts = [o for o in bpy.context.selected_objects]
        for pc in parts:
            pc.hide_render = True
            n0 = len(ob.data.polygons)
            apply_boolean(ob, pc)
        print("WALL", name, len(ob.data.polygons), "cuts", len(parts))
    return ob


def ragged(u0, u1, hfn, step=0.42):
    """broken wall-head, from u1 back to u0: course-stepped jags following hfn(u)."""
    pts = []
    n = max(2, int((u1 - u0) / step))
    for i in range(n + 1):
        u = u1 - (u1 - u0) * i / n
        v = hfn(u) - rs.uniform(0.0, 0.35) + 0.25 * MN.noise(Vector((u * 0.6, 3.3, 0.2)))
        v = max(0.4, round(v / 0.28) * 0.28 + rs.uniform(-0.04, 0.04))
        if pts and abs(pts[-1][1] - v) > 0.05:
            pts.append((u + 0.03, v))       # vertical step between courses
        pts.append((u, v))
    return pts


def lerpf(pts):
    def f(u):
        for (a, ha), (b, hb) in zip(pts[:-1], pts[1:]):
            if a <= u <= b:
                t = (u - a) / (b - a)
                return ha + (hb - ha) * t
        return pts[-1][1] if u > pts[-1][0] else pts[0][1]
    return f


def splay(f, cut, u, v0, w, h):
    """inner embrasure: a wider, taller rear-arch cut from inside, stopping short of the face."""
    f.prism(cut, [(u + a, v0 - 0.15 + b) for (a, b) in arch_profile(w + 0.9, h + 0.55, "round")], 0.75, T + 0.4)


def sockets(f, cut, us, v):
    for u in us:
        f.box(cut, u - 0.13, u + 0.13, T - 0.35, T + 0.3, v - 0.16, v + 0.14)


# ---- south wall (front): high at the SE corner, stepping down west
hS = lerpf([(0.0, 1.6), (1.4, 3.2), (3.2, 5.8), (5.2, 9.6), (7.4, 11.8), (9.6, 12.9), (11.0, 13.2)])


def south_cuts(f, cut):
    slit(f, cut, 3.6, 1.1, 1.3); splay(f, cut, 3.6, 1.1, 0.13, 1.3)
    slit(f, cut, 8.0, 1.2, 1.3); splay(f, cut, 8.0, 1.2, 0.13, 1.3)
    # first-floor doorway (its stair long gone)
    window(f, cut, 8.6, 4.4, 1.15, 2.3, "round", depth=T + 0.6, backdark=False)
    window(f, cut, 6.0, 7.9, 0.6, 1.45, "round", depth=T + 0.6, backdark=False); splay(f, cut, 6.0, 7.9, 0.6, 1.45)
    window(f, cut, 9.2, 9.6, 0.45, 1.2, "round", depth=T + 0.6, backdark=False); splay(f, cut, 9.2, 9.6, 0.45, 1.2)
    putlogs(f, cut, [1.8, 4.6, 7.2, 10.1], 3.2)
    putlogs(f, cut, [5.0, 7.6, 10.2], 6.6)
    putlogs(f, cut, [7.2, 10.0], 10.9)
    sockets(f, cut, [4.4, 5.9, 7.4], 4.05)
    sockets(f, cut, [6.2, 7.7, 9.2], 7.75)


wall("S", fS, [(0.0, 0.0), (S, 0.0), (S, hS(S))] + ragged(0.0, S - 0.3, hS) + [(0.0, 1.3)], T, south_cuts)

# ---- east wall: from the SE corner (u=0) north; broken low at the north end
hE = lerpf([(0.0, 13.5), (2.0, 13.0), (4.5, 12.2), (6.2, 10.8), (7.6, 6.2), (9.0, 3.2), (11.0, 1.4)])


def east_cuts(f, cut):
    slit(f, cut, 5.2, 1.3, 1.3); splay(f, cut, 5.2, 1.3, 0.13, 1.3)
    window(f, cut, 4.6, 5.1, 0.5, 1.35, "round", depth=T + 0.6, twin=True, backdark=False)
    splay(f, cut, 4.6, 5.1, 1.3, 1.35)
    window(f, cut, 3.0, 9.1, 0.55, 1.3, "round", depth=T + 0.6, backdark=False); splay(f, cut, 3.0, 9.1, 0.55, 1.3)
    putlogs(f, cut, [3.0, 6.0, 8.6], 3.3)
    putlogs(f, cut, [2.2, 5.6], 7.0)
    putlogs(f, cut, [1.4, 4.4], 11.2)
    sockets(f, cut, [3.6, 5.1, 6.6, 8.1], 4.05)
    sockets(f, cut, [3.4, 4.9], 7.75)
    # fireplace on the first floor (inner face) and its flue slot rising in the wall
    f.box(cut, 6.2, 7.9, T - 0.65, T + 0.3, 4.3, 5.7)
    f.box(cut, 6.75, 7.35, T - 0.55, T - 0.1, 5.6, 8.9)


wall("E", fE, [(T, 0.0), (S, 0.0)] + ragged(T, S, hE)[:-1] + [(T, hE(T))], T, east_cuts)
# ---- north and west: grassy stumps with a breach
hN = lerpf([(0.0, 1.5), (2.0, 2.4), (4.5, 1.2), (6.0, 0.5), (7.5, 1.8), (11.0, 2.2)])
wall("N", fN, [(0.0, 0.0), (S, 0.0)] + ragged(0.0, S, hN), T)
hW = lerpf([(0.0, 2.0), (3.0, 1.4), (5.5, 2.6), (8.0, 1.2), (11.0, 1.8)])
wall("W", fW, [(T, 0.0), (S - T, 0.0)] + ragged(T, S - T, hW), T)

# plinth (battered base) on the standing walls, quoins at the standing corner
plinth([(X0, Y0), (X1, Y0), (X1, Y1)], closed=False, h=1.0, proud=0.4, bt=B("plinth", "rubble"))
quoins((X1, Y0), (0, -1, 0), (1, 0, 0), 1.0, 12.6, course=0.42, la=0.66, lb=0.36)

# ---- rubble: turfed banks inside and spilled out north/west, loose blocks, a toppled wall slab
spoil_heap(B("heap", "turf"), -0.6, 1.2, 4.4, 3.6, 1.3, seed=1.0)
spoil_heap(B("heap", "turf"), -6.8, 1.0, 2.8, 5.8, 1.5, seed=2.0)
spoil_heap(B("heap", "turf"), 0.5, 7.2, 5.8, 2.6, 1.4, seed=3.0)
spoil_heap(B("heap", "turf"), 7.4, 4.8, 2.2, 3.6, 1.1, seed=4.0)
spoil_heap(B("heap", "turf"), 1.2, -7.0, 3.6, 1.4, 0.5, seed=5.0)
lumps(B("block"), -0.6, 1.2, 3.6, 22, 0.25, 0.6, 71, zfn=lambda x, y: 0.7)
lumps(B("block"), -6.8, 1.0, 2.6, 18, 0.25, 0.55, 72, zfn=lambda x, y: 0.5)
lumps(B("block"), 0.5, 7.2, 3.8, 20, 0.25, 0.6, 73, zfn=lambda x, y: 0.5)
lumps(B("block"), 2.0, -7.2, 3.0, 14, 0.2, 0.45, 74)
# toppled slab of walling (still bonded) lying across the west bank
M = TRS((-7.0, 3.6, 1.0), (0.5, -0.15, 1.35))
pts = [tuple(M @ Vector((x, y, z))) for x in (-2.2, 2.2) for y in (-0.9, 0.9) for z in (-0.3, 0.8)]
prism_hull(B("slab", "rubble"), pts)
# wall-top grass
for u in (3.2, 6.5, 8.8):
    tussock(B("tuft", "turf"), X0 + u, Y0 + 1.1, hS(u) - 0.45, 1.4, blades=12)
for u in (3.0, 5.5):
    tussock(B("tuft", "turf"), X1 - 1.1, Y0 + u, hE(u) - 0.45, 1.4, blades=12)
base_tufts(0.0, 0.0, 6.6, 6.6, 30, 75)

# ---- ivy: leaf cards climbing the outer faces of the standing walls from the ground
import _veg as V
ivy_cells = [dict(kind="spray", outline=ivy_outline, greens=g, leaf_len=0.075, leaves=70, per_tip=10, spread=0.44,
                  twig="#4a3c30", twig_w=0.004, dry="#6a5a2a", dry_p=0.04)
             for g in (("#2c4020", "#34492a", "#3d5530", "#2a3a1e"), ("#34482a", "#3f5530", "#4a6035", "#30421f"),
                       ("#2a3a1e", "#31442a", "#2c3d24", "#263620"), ("#3f5530", "#4b6135", "#56693a", "#445a30"))]
ivy_img = leaf_atlas("ivy_leaves.png", ivy_cells, force=bool(os.environ.get("HG_LEAVES")), seed=41)
patches = [(fS, 0.3, 3.4, 5.2), (fS, 9.8, 11.1, 9.5), (fE, 0.2, 2.2, 11.8), (fE, 6.6, 9.6, 5.4)]
quads0, quads1 = [], []
for (f, u0, u1, top) in patches:
    n_out = -f.inw
    for i in range(int((u1 - u0) * top * 7)):
        v = top * (rs.random() ** 1.7)
        # the patch narrows as it climbs (a stem fan)
        cu = (u0 + u1) / 2
        half = (u1 - u0) / 2 * (1.0 - 0.55 * v / top)
        u = cu + rs.uniform(-half, half)
        c = f.p(u, -rs.uniform(0.04, 0.16), v + 0.05)
        nrm = (n_out + Vector((rs.gauss(0, 0.35), rs.gauss(0, 0.35), rs.gauss(0, 0.35) + 0.2))).normalized()
        s = rs.uniform(0.45, 0.7)
        cell = rs.choice((0, 1, 1, 2, 3)) if v < top * 0.6 else rs.choice((1, 3, 3))
        quads0.append((c, nrm, Vector((0, 0, 1)), s, s, cell, 2))
        if rs.random() < 0.3:
            quads1.append((c, nrm, Vector((0, 0, 1)), s * 1.7, s * 1.7, cell, 2))
iv0 = cards_obj("ivy_c0", quads0, ivy_img, 0); iv0["hg_tag"] = "ivy"
iv1 = cards_obj("ivy_c1", quads1, ivy_img, 1); iv1["hg_tag"] = "ivy"
iv1.data.materials[0] = iv0.data.materials[0]

done("ruin_keep", tex=2048, lods=(1.0, 0.4, 0.12))
