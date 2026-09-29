"""HIGHGROUND - one stone of the Hanger Knoll ring: a weathered gritstone megalith ~2.3 m,
slab-shaped, leaning a few degrees, rounded by four thousand winters, crusted with lichen,
packing stones at its foot and a faint pecked spiral on its face. Placed 11x at scales
0.72-1.2 round the ley_stone. Front faces -Y (the carved face).

    blender -b -t 2 -P assets/src/standing_stone.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _landkit import *

begin(61)
H = 2.35
mat_megalith(carve=carving(spirals=[(0.02, 1.35, 0.26, 3.2, 1.0)], depth=0.55, wear=0.75))
mat_turf("turf", dry=0.3)
g = B("stone", "megalith")
rock(g, (0, 0, 0), (1.15, 0.62, H), 611, yaw=0.0, sink=0.08, blocky=3.3, amp=0.11, freq=1.3, cuts=1, sub=4,
     cut_up=(0.75, 0.95), cut_depth=(0.06, 0.1),
     taper=0.28, facets=5, facet_depth=(0.03, 0.1), ridged=0.05, dents=1, lean=(0.05, 0.06))
packing_stones(0, 0, 0.6, 0.36, 7, 3, g)
base_tufts(0, 0, 0.62, 0.4, 9, 4, s=(0.7, 1.2))
done("standing_stone", tex=1024, lods=(1.0, 0.35, 0.1))
