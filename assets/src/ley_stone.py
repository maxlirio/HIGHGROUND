"""HIGHGROUND - the centre stone of the Hanger Knoll ring (mana site, low fantasy: ancient and
subtly wrong, never glowing).

A tall gritstone megalith ~3.4 m, broader and older than the ring stones, bored through near
its head by a smooth natural hole; cup-and-ring marks and a double spiral pecked into its face,
and the carving alone carries no lichen. A low recumbent slab lies before it (-Y). Round its foot
a fairy ring of dark lush sward with pale mushrooms, the grass inside it thin and yellowed.

    blender -b -t 2 -P assets/src/ley_stone.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _landkit import *

begin(71)
H = 3.45
carve = carving(spirals=[(-0.2, 1.55, 0.24, 3.0, 1.0), (0.26, 1.55, 0.24, 3.0, -1.0)],
                cups=[(0.05, 2.1, 0.05, 2), (-0.28, 0.95, 0.045, 1), (0.3, 0.85, 0.04, 2), (0.05, 0.62, 0.035, 0)],
                depth=0.8, wear=0.35, clean=True)
mat_megalith(carve=carve, lichen_d=0.65)
MAT["slab"] = MAT["megalith"]
mat_turf("turf", dry=0.3)
MAT["ring"] = m_turf("ring", dry=0.2, ring=(2.6, 0.45))
PCOL["ring"] = "#4d5c2a"
MAT["cap"] = m_simple2("cap", "#cfc5a6", "#b3a684", 0.7, 30.0)

stone = Batch("stone", "megalith")
cut = Batch("_cut", "megalith")
BATCHES["stone"] = (stone, cut)
rock(stone, (0, 0, 0), (1.55, 0.82, H), 711, yaw=0.0, sink=0.07, blocky=3.0, amp=0.08, freq=1.15, cuts=0, sub=4,
     taper=0.36, facets=6, facet_depth=(0.03, 0.1), ridged=0.05, dents=1, lean=(0.03, -0.04))
# the hole: bored front-to-back through the head, lightly flared at both mouths
cyl(cut, (0.12, -0.8, 2.72), (0.12, 0.8, 2.72), 0.13, n=12)
cyl(cut, (0.12, -0.8, 2.72), (0.12, -0.25, 2.72), 0.2, 0.12, n=12)
cyl(cut, (0.12, 0.8, 2.72), (0.12, 0.25, 2.72), 0.2, 0.12, n=12)
g = B("rocks", "megalith")
packing_stones(0, 0, 0.8, 0.46, 9, 7, g)
# recumbent slab before the stone
rock(g, (0.1, -1.55, 0), (1.7, 0.95, 0.5), 712, yaw=0.08, sink=0.25, blocky=3.4, amp=0.06, cuts=0, sub=3,
     facets=3, squash_top=0.3, dents=2)
# turf pad carrying the fairy ring
ground_patch(B("pad", "ring"), 0, 0, 3.6, 3.6, h=0.06, n=36, rings=6, bump=0.02, seed=3.0)
rng = random.Random(9)
for i in range(46):
    a = rng.uniform(0, 2 * math.pi)
    r = 2.6 + rng.gauss(0, 0.13)
    x, y = math.cos(a) * r, math.sin(a) * r
    s = rng.uniform(0.6, 1.2)
    cyl(B("cap"), (x, y, 0.02), (x, y, 0.07 * s), 0.009 * s, 0.007 * s, n=5)
    blob(B("cap"), (x, y, 0.07 * s), 0.03 * s, 0.03 * s, 0.017 * s, sub=1, amp=0.1, seed=i)
base_tufts(0, 0, 0.85, 0.5, 11, 8, s=(0.7, 1.2))
done("ley_stone", tex=1024, lods=(1.0, 0.35, 0.1))
