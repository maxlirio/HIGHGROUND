"""HIGHGROUND - quarry face: an opened limestone quarry (stone resource node; also the old quarry
that built the Tor Knap keep).

A turf-capped rock knoll ~17 x 12 m whose front (-Y) has been worked back into two benches of
square-cut face, the cut stone paler and scored with pick and wedge marks, the upper lip ragged
with turf overhang. On the chippings floor: rough blocks split from the bed, one still in the
act with a row of iron wedges in its split line, a few dressed and squared, and a shear-legs
crane (two lashed poles, back-stay, pulley and a windlass) holding a block on a lewis.
Front faces -Y.

    blender -b -t 2 -P assets/src/quarry_face.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _landkit import *

begin(151)
LIME = [(0.0, "#968e7e"), (0.3, "#a79d8a"), (0.6, "#b3a892"), (0.85, "#bfb49e"), (1.0, "#9f9684")]


def worked(g, col, h):
    x, y, z = g.sep(g.P)
    nx, ny, nz = g.sep(g.N)
    face = g.mr(ny, -0.55, -0.85)
    top = g.mr(nz, 0.8, 0.95)
    wv = g.node("ShaderNodeTexWave", [("Vector", g.comb(g.add(x, g.mul(z, 0.8)), y, g.sub(z, g.mul(x, 0.6)))),
                                      ("Scale", 6.0), ("Distortion", 3.0), ("Detail", 2.0)], bands_direction="X").outputs[1]
    marks = g.mul(g.mr(wv, 0.78, 0.96), face)
    col = g.mix(g.mul(face, 0.55), col, g.mix(1.0, col, (1.1, 1.08, 1.04, 1), "MULTIPLY"))
    col = g.mix(g.mul(marks, 0.45), col, g.mix(1.0, col, (0.68, 0.66, 0.62, 1), "MULTIPLY"))
    # wedge-pit rows: small dark notches along the old bed lines on the face
    wp = g.mul(g.mul(g.inv(g.mr(g.math("ABSOLUTE", g.sub(g.math("FRACT", g.mul(z, 0.9)), 0.5)), 0.0, 0.03)),
                     g.gt(g.math("FRACT", g.mul(x, 4.0)), 0.8)), face)
    col = g.mix(g.mul(wp, 0.7), col, "#3a342c")
    # turf cap on the knoll and the bench: sward over the flat tops, ragged at the lip
    cap = g.mul(g.mr(nz, 0.72, 0.9), g.mr(g.add(g.noise(g.P, 0.9, 4), g.mul(g.mr(z, 2.0, 6.0), 0.3)), 0.38, 0.5))
    tc = g.ramp(g.add(g.noise(g.P, 0.6, 3), g.mul(g.noise(g.P, 9.0, 3), 0.3)),
                [(0.25, "#46532a"), (0.55, "#5d6b35"), (0.85, "#7a7a44")])
    tc = g.mix(0.5, tc, g.noise(g.comb(g.mul(x, 60.0), g.mul(y, 60.0), z), 1.0, 3), "OVERLAY")
    col = g.mix(cap, col, tc)
    return col, g.add(g.sub(h, g.add(g.mul(marks, 0.7), g.mul(wp, 1.0))), g.mul(cap, 0.4))


MAT["lime"] = m_rock("lime", LIME, speck=0.1, strata=0.45, strata_scale=1.3,
                     strata_tones=[(0.2, "#8e8676"), (0.8, "#c2b8a2")], lichen_d=0.45, lichen_amt=0.8, moss=0.6,
                     cracks=0.35, streaks=0.9, pits=0.5, extra=worked, lichen_tones=("#a9ad95", "#c9c6b6", "#b99a48"))
MAT["block"] = m_rock("block", LIME, speck=0.1, strata=0.3, strata_scale=1.3, lichen_d=0.2, lichen_amt=0.35, moss=0.2,
                      cracks=0.3, streaks=0.3, pits=0.4)
MAT["chip"] = m_loose("chip", [(0.0, "#8a8274"), (0.35, "#a49b88"), (0.7, "#b8ae9a"), (1.0, "#958d7d")], lump=18.0,
                      grass=0.3, pebble=0.7, peb_tones=("#a79d8a", "#cfc6b2"))
mat_turf("turf", dry=0.35)
MAT["pole"] = m_wood2("pole", [(0.0, "#5e5040"), (0.5, "#6f6050"), (1.0, "#7c6c58")], weathered=0.55)
MAT["plank"] = m_wood2("plank", [(0.0, "#7b6f5e"), (0.5, "#8c8374"), (1.0, "#978a73")], weathered=0.4)
MAT["rope"] = m_rope("rope"); PCOL["rope"] = "#7a6a50"
MAT["iron_t"] = m_simple2("iron_t", "#35332f", "#45403a", 0.72, rust=True)

Q = B("lime")
# lower tier: face cut back square at y=-1.2 with a flat bench top at z=2.6
rock(Q, (0.0, 2.6, 0), (16.5, 9.5, 5.2), 1501, yaw=0.0, sink=0.08, blocky=3.0, amp=0.1, cuts=0, sub=4, facets=7,
     facet_depth=(0.03, 0.1), ridged=0.04,
     planes=[((0, -2.2, 0), (0, -1, 0)), ((0, 0, 0.3), (0, 0, 1))])
# upper tier: set back to y=1.3, rising to the knoll crown
rock(Q, (0.4, 4.6, 1.4), (13.5, 7.5, 5.2), 1502, yaw=0.0, sink=0.0, blocky=2.8, amp=0.12, cuts=0, sub=4, facets=7,
     planes=[((0, -1.8, 0), (0, -1, 0))])
# shoulders where the knoll is uncut, turf pad at the lip
rock(Q, (-7.4, 1.8, 0), (4.0, 6.0, 3.2), 1503, yaw=0.3, sink=0.2, blocky=3.0, amp=0.12, cuts=1, sub=3, facets=6)
rock(Q, (7.2, 2.2, 0), (4.2, 6.0, 3.0), 1504, yaw=-0.3, sink=0.2, blocky=3.0, amp=0.12, cuts=1, sub=3, facets=6)
for (x, y, z) in ((-4.0, 2.9, 5.8), (1.5, 3.5, 6.1), (4.6, 3.0, 5.4)):
    tussock(B("tuft", "turf"), x, y, z, 1.5, blades=12)
# chippings floor + spoil of waste stone
ground_patch(B("chip"), 0.0, -3.4, 8.0, 3.2, h=0.08, n=30, rings=5, bump=0.04, seed=2.0)
spoil_heap(B("chip"), 6.0, -3.8, 2.0, 1.5, 0.8, seed=3.0)
lumps(B("block"), 6.0, -3.8, 1.6, 14, 0.15, 0.4, 51, zfn=lambda x, y: 0.4)
lumps(B("block"), 0.0, -2.2, 5.5, 26, 0.08, 0.2, 52)


def sblock(c, size, yaw, seed, rough=True):
    x, y, z = c
    sx, sy, sz = size
    if rough:   # split from the bed: hacked, a little out of square
        pts = []
        for ix in (-1, 1):
            for iy in (-1, 1):
                for iz in (0, 1):
                    pts.append((ix * sx / 2 * R.uniform(0.85, 1.0), iy * sy / 2 * R.uniform(0.85, 1.0), iz * sz * R.uniform(0.9, 1.0)))
        # knocked corners
        pts += [(ix * sx * 0.3, iy * sy * 0.3, sz * 1.02) for ix in (-1, 1) for iy in (-1, 1)]
        M = TRS((x, y, z), (jit(0.03), jit(0.03), yaw))
        prism_hull(B("block"), [tuple(M @ Vector(p)) for p in pts])
    else:
        box(B("block"), (x - sx / 2, y - sy / 2, z), (x + sx / 2, y + sy / 2, z + sz), 0.025, rot=(0, 0, yaw))


# split blocks: a big bed-block being split by a row of wedges
bx, by = -2.8, -3.6
sblock((bx - 0.62, by, 0), (1.15, 1.2, 0.9), 0.1, 1510)
sblock((bx + 0.62, by + 0.06, 0), (1.15, 1.2, 0.9), 0.14, 1511)
for k in range(5):
    y = by - 0.45 + k * 0.22
    prism_hull(B("iron_t"), [(bx - 0.035, y - 0.03, 0.8), (bx + 0.035, y - 0.03, 0.8), (bx - 0.035, y + 0.03, 0.8),
                             (bx + 0.035, y + 0.03, 0.8), (bx - 0.05, y - 0.04, 0.98), (bx + 0.05, y - 0.04, 0.98),
                             (bx - 0.05, y + 0.04, 0.98), (bx + 0.05, y + 0.04, 0.98)])
# rough and squared blocks lying about
for k, (x, y, sx, sy, sz, yaw, rough) in enumerate(((-5.4, -3.2, 1.4, 0.9, 0.7, 0.3, True), (-4.9, -5.0, 1.0, 0.8, 0.6, -0.2, True),
                                                  (1.2, -4.8, 0.9, 0.6, 0.45, 0.05, False), (2.1, -4.7, 0.9, 0.6, 0.45, 0.07, False),
                                                  (1.65, -4.75, 0.9, 0.6, 0.45, 0.02, False), (3.6, -3.0, 1.2, 1.0, 0.8, 0.5, True),
                                                  (-0.4, -5.3, 0.8, 0.55, 0.5, 0.9, False))):
    z = 0.45 if k == 4 else 0.0
    sblock((x, y, z), (sx, sy, sz), yaw, 1520 + k, rough)
# shear-legs crane over the floor in front of the lower face
apex = Vector((0.9, -2.2, 5.4))
for sx in (-1.5, 1.5):
    foot = Vector((0.9 + sx, -3.9, 0.0))
    cyl(B("pole"), foot, apex + Vector((sx * 0.08, 0, 0.25)), 0.11, 0.08, n=8)
    box(B("block"), foot + Vector((-0.25, -0.25, 0)), foot + Vector((0.25, 0.25, 0.18)), 0.02)
# lashing at the apex, back-stay to a stake on the bench, pulley block
cyl(B("rope"), apex + Vector((-0.25, 0, 0)), apex + Vector((0.25, 0, 0)), 0.1, n=8)
beam(B("rope"), apex, (0.6, 0.6, 2.62), 0.025, 0.025, 0.0)
beam(B("pole"), (0.6, 0.65, 2.3), (0.55, 0.6, 3.0), 0.08, 0.08, 0.01)
box(B("pole"), apex + Vector((-0.1, -0.12, -0.55)), apex + Vector((0.1, 0.12, -0.15)), 0.02)
cyl(B("iron_t"), apex + Vector((-0.12, 0, -0.32)), apex + Vector((0.12, 0, -0.32)), 0.03, n=6)
# fall rope down to a block on its lewis, and back to the windlass
hang = Vector((0.9, -2.3, 1.75))
beam(B("rope"), apex + Vector((0, -0.1, -0.5)), hang + Vector((0, 0, 0.55)), 0.022, 0.022, 0.0)
sblock((hang.x, hang.y, hang.z - 0.3), (0.95, 0.65, 0.6), 0.05, 1530, rough=False)
box(B("iron_t"), hang + Vector((-0.05, -0.05, 0.28)), hang + Vector((0.05, 0.05, 0.55)), 0.0)
beam(B("rope"), apex + Vector((0, 0.1, -0.5)), (0.9, -3.85, 1.0), 0.022, 0.022, 0.0)
# windlass between the legs: drum on two trestles, crank handles
for sx in (-0.9, 0.9):
    beam(B("pole"), (0.9 + sx, -4.0, 0.0), (0.9 + sx, -4.0, 1.05), 0.12, 0.12, 0.01)
    beam(B("pole"), (0.9 + sx, -4.45, 0.0), (0.9 + sx, -4.0, 0.7), 0.08, 0.08, 0.008)
cyl(B("pole"), (0.0, -4.0, 1.0), (1.8, -4.0, 1.0), 0.14, n=10)
cyl(B("rope"), (0.6, -4.0, 1.0), (1.2, -4.0, 1.0), 0.17, n=10)
for sx, s in ((-0.1, 1), (1.9, -1)):
    beam(B("iron_t"), (0.9 + (sx - 0.9), -4.0, 1.0), (0.9 + (sx - 0.9), -4.0 - 0.35 * s, 1.25), 0.035, 0.035, 0.0)
# tools: a stone mallet, crowbar, a plank laid as a skid
beam(B("plank"), (-1.6, -5.2, 0.08), (0.2, -4.5, 0.02), 0.3, 0.05, 0.005, side=(0, 0, 1))
beam(B("iron_t"), (-1.0, -2.4, 0.05), (-0.2, -2.9, 0.3), 0.035, 0.035, 0.0)
base_tufts(0.0, 2.6, 8.8, 5.2, 30, 53)
done("quarry_face", tex=2048, lods=(1.0, 0.4, 0.12))
