"""HIGHGROUND - silver vein: galena-bearing lead/silver rake in a limestone outcrop (resource node).

A bedded grey limestone scar, clint-and-grike jointed, with a near-vertical vein ("rake") cutting
through it: dark lead-grey galena with glinting cube faces in white calcite/baryte gangue, the
lode worked out as a narrow slot between the walls. Old spoil heaps of grey-white rubble, half
grassed, along its line and a newer tip of dark galena-speckled spoil. Footprint ~11 x 8 m.
Front faces -Y.

    blender -b -t 2 -P assets/src/silver_vein.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _landkit import *

begin(121)
LIME = [(0.0, "#9a9384"), (0.3, "#aca393"), (0.6, "#b8ad99"), (0.85, "#c2b8a4"), (1.0, "#a39b8b")]


def galena(g, col, h):
    P = g.P
    x, y, z = g.sep(P)
    # the lode is the slot (x' ~ 0 in the rake frame): galena on the inner faces, gangue round it
    xs = g.add(g.mul(x, math.cos(0.25)), g.mul(y, math.sin(0.25)))
    d = g.math("ABSOLUTE", g.add(xs, g.mul(g.sub(g.noise(P, 1.2, 3), 0.5), 0.2)))
    band = g.inv(g.mr(d, 0.62, 0.78))
    gang = g.inv(g.mr(d, 0.78, 1.1))
    col = g.mix(gang, col, g.ramp(g.noise(P, 8.0, 3), [(0.3, "#c9c2b2"), (0.8, "#ddd6c6")]))
    vn = g.node("ShaderNodeTexVoronoi", [("Vector", g.vmul(P, (1.0, 1.0, 1.0))), ("Scale", 28.0)], feature="F1",
                distance="CHEBYCHEV")
    cube = g.mr(vn.outputs["Distance"], 0.1, 0.35)
    gal = g.ramp(g.add(g.mul(cube, 0.6), g.mul(g.sep(vn.outputs["Color"])[0], 0.4)), [(0.2, "#3a3c40"), (0.6, "#56595e"), (0.9, "#7a7e84")])
    col = g.mix(band, col, gal)
    g._band = band
    return col, g.sub(h, g.mul(band, 0.3))


MAT["lime"] = m_rock("lime", LIME, speck=0.1, strata=0.55, strata_scale=1.8,
                     strata_tones=[(0.2, "#8e8778"), (0.8, "#bdb3a0")], lichen_d=0.5, lichen_amt=0.9, moss=0.7, extra=galena,
                     cracks=0.45, streaks=1.0, pits=0.6, lichen_tones=("#a9ad95", "#c9c6b6", "#b99a48"))
MAT["vein"] = m_rock("vein", LIME, speck=0.1, lichen_d=0.3, lichen_amt=0.5, moss=0.3, cracks=0.8, streaks=0.8,
                     pits=0.4, extra=galena, rough=0.7, preview="#6a6c70")
MAT["spoil"] = m_loose("spoil", [(0.0, "#7a756a"), (0.35, "#948e80"), (0.7, "#aaa392"), (1.0, "#86806f")], lump=10.0,
                       grass=0.55, pebble=0.6, peb_tones=("#9a9384", "#d6cfbf"))
MAT["tip"] = m_loose("tip", [(0.0, "#4a4b4c"), (0.4, "#5e5d58"), (0.8, "#7a766b"), (1.0, "#56544f")], lump=13.0,
                     grass=0.1, pebble=0.6, peb_tones=("#3a3c40", "#cfc8b8"))
mat_turf("turf", dry=0.35)

L_ = B("lime")
# the scar: two limestone masses either side of the worked slot (vein runs along local y)
YAW = 0.25
M = Matrix.Rotation(YAW, 4, "Z")
def W(x, y): v = M @ Vector((x, y, 0)); return (v.x, v.y, 0.0)
for side, s in ((-1, 1150), (1, 1160)):
    rock(L_, W(side * 2.1, 1.2), (3.6, 7.0, 2.8), s, yaw=YAW, sink=0.2, blocky=4.2, amp=0.1, cuts=1, sub=4,
         facets=8, ridged=0.04, dents=2, planes=[((-side * 1.55, 0, 0), (-side, 0, 0))], cut_up=(0.6, 0.9))
    rock(L_, W(side * 3.9, -1.4), (2.2, 2.4, 1.4), s + 1, yaw=YAW + 0.3, sink=0.25, blocky=3.8, amp=0.12, cuts=1, sub=3,
         facets=6)
# floor of the slot: rubble
lumps(B("vein"), *W(0, 0.5)[:2], 1.3, 16, 0.12, 0.3, 17)
for k in range(5):
    lumps(B("vein"), *W(0, -2.0 + k * 1.3)[:2], 0.35, 4, 0.15, 0.3, 170 + k)
# old spoil heaps (grassed) along the rake, and a newer dark tip in front
spoil_heap(B("spoil"), *W(-3.2, -3.4)[:2], 1.8, 1.2, 0.7, seed=1.0, rot=YAW)
spoil_heap(B("spoil"), *W(3.0, -3.8)[:2], 1.5, 1.1, 0.55, seed=2.0)
spoil_heap(B("tip"), *W(0.2, -3.6)[:2], 1.6, 1.3, 0.8, seed=3.0)
lumps(B("vein"), *W(0.2, -3.6)[:2], 1.3, 10, 0.12, 0.26, 18, zfn=lambda x, y: 0.4)
lumps(B("lime"), *W(-3.2, -3.4)[:2], 1.4, 8, 0.15, 0.3, 19, zfn=lambda x, y: 0.3)
scatter_stones(B("lime"), 0.0, -2.2, 4.8, 1.8, 16, 0.12, 0.35, 20)
base_tufts(0, 0.5, 5.2, 4.0, 24, 21)
done("silver_vein", tex=2048, lods=(1.0, 0.4, 0.12))
