"""HIGHGROUND - bedrock outcrops breaking through the upland turf (granite, jointed like a tor).

    HG_VAR=a|b blender -b -t 2 -P assets/src/rock_outcrop.py   -> assets/glb/rock_outcrop_<var>.glb

  a  low whaleback, ~7 x 4.5 x 2 m: two rows of sheet-jointed, pillow-weathered slabs, a
     frost-heaved block tilted off the end, grassy clefts
  b  crag knuckle, ~6 x 5 x 4 m: a stack of rounded pancake blocks on a broad plinth, one
     perched block overhanging, a scree apron of spalls at its foot
Front faces -Y. 1 unit = 1 m.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _landkit import *

V_ = VAR or "a"
begin({"a": 41, "b": 42}[V_])
mat_granite(lichen_d=0.55, moss=0.7)
mat_turf("turf", dry=0.35)
MAT["scree"] = m_loose("scree", [(0.0, "#5f5b55"), (0.4, "#716c65"), (0.8, "#858077"), (1.0, "#6a655e")], lump=9.0,
                       grass=0.35, pebble=0.5)
g = B("rock", "granite")
S = 0


def blk(x, y, z, sx, sy, sz, yaw, sink=0.06, **kw):
    global S
    S += 1
    a = dict(blocky=4.5, amp=0.13, freq=1.3, cuts=1, cut_depth=(0.05, 0.12), cut_up=(-0.2, 0.3), sub=3, facets=8,
             facet_depth=(0.03, 0.14), ridged=0.06, dents=1, chamfer=0.02)
    a.update(kw)
    return rock(g, (x, y, z), (sx, sy, sz), S * 17 + (0 if V_ == "a" else 500), yaw=yaw, sink=sink, **a)


if V_ == "a":
    # lower sheet: long slabs buried to half their thickness
    blk(-1.7, 0.1, 0, 3.4, 2.6, 1.3, 0.12, sink=0.35, sub=4)
    blk(1.3, -0.2, 0, 3.0, 2.8, 1.5, -0.08, sink=0.3, sub=4)
    blk(0.1, 1.2, 0, 2.6, 1.8, 1.0, 0.3, sink=0.35)
    # upper sheet, set back and narrower
    blk(-1.2, 0.35, 0.72, 2.2, 1.7, 0.85, 0.2)
    blk(1.05, 0.1, 0.85, 2.0, 1.9, 0.95, -0.15, dents=2)
    blk(0.2, 0.3, 1.45, 1.1, 0.9, 0.55, 0.5)
    # frost-heaved block tipped off the east end
    blk(3.35, -0.55, 0, 1.3, 1.1, 0.9, 0.7, sink=0.2, lean=(0.25, -0.3))
    blk(-3.6, -0.3, 0, 0.9, 0.8, 0.55, 1.1, sink=0.3)
    scatter_stones(g, 0.4, -1.8, 3.0, 0.5, 10, 0.15, 0.35, 11)
    for i in range(4):
        mound_x = -2.2 + i * 1.5
        ground_patch(B("scree_pad", "scree"), mound_x, -1.55, 0.9, 0.45, h=0.12, n=12, rings=3, seed=i * 1.3)
    base_tufts(0.0, 0.1, 3.6, 1.8, 18, 5)
    for x in (-0.25, 0.2):
        for k in range(3):
            tussock(B("tuft", "turf"), x + jit(0.08), -0.9 + k * 0.7, 0.9 + jit(0.1), 0.9, blades=9)
else:
    # broad plinth
    blk(0.0, 0.3, 0, 4.6, 3.8, 1.7, 0.1, sink=0.3, sub=4, blocky=3.2, facets=6)
    blk(-1.8, -0.9, 0, 2.2, 2.0, 1.2, -0.3, sink=0.3)
    # stack
    blk(0.25, 0.4, 0.95, 3.9, 3.2, 1.3, 0.25, sub=4, dents=2, sink=0.2)
    blk(-0.1, 0.35, 1.85, 3.1, 2.6, 1.1, -0.2, sink=0.2)
    blk(0.3, 0.6, 2.6, 2.2, 1.9, 0.9, 0.45, sink=0.2)
    # perched block overhanging the front
    blk(-0.6, -0.3, 3.15, 1.7, 1.4, 0.7, 0.9, lean=(0.08, 0.12), sink=0.15)
    # shoulder to the east
    blk(2.1, 0.8, 0, 2.3, 2.6, 2.4, 0.4, sink=0.25, facets=9)
    # scree apron: spalls + fine scree pad
    ground_patch(B("scree_pad", "scree"), 0.2, -2.05, 2.8, 1.0, h=0.28, n=18, rings=4, seed=2.0)
    scatter_stones(g, 0.2, -2.2, 2.6, 0.8, 16, 0.18, 0.5, 21, z=0.0)
    scatter_stones(g, 0.2, -2.0, 2.4, 0.7, 20, 0.08, 0.16, 22, z=0.0, sub=1)
    base_tufts(0.1, 0.3, 3.1, 2.6, 18, 6)

done("rock_outcrop_" + V_, tex=1024, lods=(1.0, 0.35, 0.1))
