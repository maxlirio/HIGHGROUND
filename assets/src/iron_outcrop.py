"""HIGHGROUND - iron outcrop: a red-brown ironstone crag on Harrow Ridge (resource node).

Thick-bedded ironstone, purple-red to rust-brown in its layers, weathering ochre and shaly
between the beds, breaking into a small crag ~4 m high. At its front a worked face: the beds
cut back square with pick marks, a ledge of broken ore at its foot and a heap of sorted lumps,
a tip of red-brown spoil, a pick and a wicker basket. Footprint ~11 x 8 m. Front faces -Y.

    blender -b -t 2 -P assets/src/iron_outcrop.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _landkit import *

begin(131)
IRON = [(0.0, "#4e2e22"), (0.3, "#643a29"), (0.55, "#7a4a32"), (0.8, "#8a5a3c"), (1.0, "#5a3a2c")]


def pickmarks(g, col, h):
    x, y, z = g.sep(g.P)
    nx, ny, nz = g.sep(g.N)
    face = g.mr(ny, -0.6, -0.85)
    wv = g.node("ShaderNodeTexWave", [("Vector", g.comb(g.add(x, z), g.mul(y, 0.2), g.sub(z, x))), ("Scale", 7.0),
                                      ("Distortion", 4.0), ("Detail", 2.0)], bands_direction="X").outputs[1]
    marks = g.mul(g.mr(wv, 0.75, 0.95), face)
    fresh = g.mul(face, g.mr(z, 2.6, 1.8))
    col = g.mix(g.mul(fresh, 0.5), col, g.mix(1.0, col, (1.18, 1.05, 0.95, 1), "MULTIPLY"))
    col = g.mix(g.mul(marks, 0.5), col, g.mix(1.0, col, (0.6, 0.55, 0.5, 1), "MULTIPLY"))
    return col, g.sub(h, g.mul(marks, 0.8))


MAT["iron"] = m_rock("iron", IRON, speck=0.15, speck_light="#a8743e", speck_dark="#2e1e18", strata=0.8,
                     strata_scale=2.2, strata_tones=[(0.15, "#4a2a22"), (0.5, "#7a4630"), (0.85, "#9a6a3e")],
                     lichen_d=0.35, lichen_amt=0.7, moss=0.55, cracks=0.9, streaks=0.9,
                     stain=("#8a5a28", "#b07a38", 0.55, 0.6), extra=pickmarks)
MAT["ore"] = m_rock("ore", IRON, speck=0.3, speck_light="#b07a3a", strata=0.0, lichen_amt=0.0, moss=0.0, cracks=0.4,
                    streaks=0.0, rough=0.78, grime=False, preview="#6a3e2c")
MAT["spoil"] = m_loose("spoil", [(0.0, "#4a2c20"), (0.35, "#6a3e28"), (0.7, "#7e5034"), (1.0, "#5a4032")], lump=12.0,
                       grass=0.3, pebble=0.5, peb_tones=("#5a3526", "#9a6a44"))
MAT["pole"] = m_wood2("pole", [(0.0, "#6a5a45"), (0.5, "#7a6a52"), (1.0, "#8a7a60")], weathered=0.5)
MAT["iron_t"] = m_simple2("iron_t", "#35332f", "#45403a", 0.72, rust=True)
MAT["wicker"] = m_simple2("wicker", "#7d6a4a", "#9c8660", 0.9, 30.0)
mat_turf("turf", dry=0.35)

R_ = B("iron")
FACE = -0.9    # y of the worked face (local of the main block)
# main crag: bedded blocks stacked with a worked face on the front
rock(R_, (0.0, 1.6, 0), (7.5, 5.0, 3.2), 1301, yaw=0.0, sink=0.12, blocky=4.0, amp=0.1, cuts=1, sub=4, facets=8,
     planes=[((0, -1.5, 0), (0, -1, 0))], ridged=0.05)
rock(R_, (0.3, 2.2, 1.7), (6.8, 4.4, 2.3), 1302, yaw=0.1, sink=0.0, blocky=4.2, amp=0.1, cuts=1, sub=3, facets=6,
     planes=[((0, -1.0, 0), (0, -1, 0.1))])
rock(R_, (-4.3, 1.4, 0), (2.8, 3.4, 2.2), 1303, yaw=-0.3, sink=0.2, blocky=3.6, amp=0.12, cuts=1, sub=3, facets=6)
rock(R_, (4.2, 2.0, 0), (2.6, 3.0, 1.8), 1304, yaw=0.4, sink=0.2, blocky=3.6, amp=0.12, cuts=1, sub=3, facets=6)
# broken-ore ledge at the foot of the face, sorted heap, spoil tip
lumps(B("ore"), 0.0, -0.55, 1.5, 22, 0.1, 0.28, 31)
spoil_heap(B("spoil"), -2.6, -2.6, 1.5, 1.0, 0.55, seed=1.0)
lumps(B("ore"), -2.6, -2.6, 1.1, 10, 0.1, 0.24, 32, zfn=lambda x, y: 0.35)
spoil_heap(B("spoil"), 3.1, -2.8, 2.0, 1.3, 0.6, seed=2.0)
lumps(B("ore"), 1.6, -2.4, 0.5, 14, 0.07, 0.15, 33)
# basket of ore and a pick left against the heap
cyl(B("wicker"), (1.0, -3.1, 0.0), (1.0, -3.1, 0.42), 0.26, 0.32, n=12)
lumps(B("ore"), 1.0, -3.1, 0.2, 5, 0.07, 0.12, 34, zfn=lambda x, y: 0.4)
beam(B("pole"), (-0.9, -2.9, 0.0), (-0.6, -2.3, 0.75), 0.04, 0.04, 0.005)
beam(B("iron_t"), (-0.85, -2.5, 0.72), (-0.35, -2.2, 0.85), 0.05, 0.035, 0.005)
beam(B("iron_t"), (-0.85, -2.5, 0.72), (-1.1, -2.2, 0.62), 0.05, 0.03, 0.005)
scatter_stones(R_, 0, -2.0, 5.0, 1.2, 14, 0.12, 0.3, 35)
base_tufts(0, 1.2, 5.6, 3.0, 26, 36)
done("iron_outcrop", tex=2048, lods=(1.0, 0.4, 0.12))
