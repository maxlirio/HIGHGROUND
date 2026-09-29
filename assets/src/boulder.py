"""HIGHGROUND - lichen-spotted granite boulders (glacial erratics / corestones), 1-3 m.

    HG_VAR=a|b|c blender -b -t 2 -P assets/src/boulder.py   -> assets/glb/boulder_<var>.glb

  a  ~1.2 m rounded corestone half-sunk in the turf, a small companion stone
  b  ~2.0 m boulder split clean in two by frost along a joint, the halves a hand apart
  c  ~3.0 m blocky erratic with a flat weathered top (solution pans), lichen crusts,
     two fallen spalls at its foot
Front faces -Y. 1 unit = 1 m.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _landkit import *

V_ = VAR or "a"
begin({"a": 21, "b": 22, "c": 23}[V_])
mat_granite()
mat_turf("turf", dry=0.35)
g = B("rock", "granite")

if V_ == "a":
    rock(g, (0, 0, 0), (1.55, 1.25, 1.3), 101, yaw=0.4, sink=0.2, blocky=2.4, amp=0.14, freq=1.3, cuts=0,
         sub=3, dents=1, facets=5, facet_depth=(0.03, 0.12), ridged=0.05)
    rock(g, (0.95, -0.55, 0), (0.45, 0.38, 0.3), 102, sink=0.25, blocky=2.4, amp=0.12, cuts=1, sub=2)
    base_tufts(0, 0, 0.72, 0.6, 7, 1)
elif V_ == "b":
    # one boulder, frost-split: build the whole, then two halves from mirrored cut planes
    import bmesh as _bm
    for side, off in ((1, 0.07), (-1, -0.07)):
        bm = rock_geo((2.3, 1.8, 1.8), 202, blocky=2.6, amp=0.13, freq=1.3, cuts=0, sub=4, dents=1, facets=7,
                      ridged=0.05)
        n = Vector((1.0, 0.18, 0.05)).normalized() * side
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0), plane_no=-n, clear_outer=True, dist=1e-4)
        bnd = [e for e in bm.edges if e.is_boundary]
        fr = bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
        bmesh.ops.triangulate(bm, faces=fr["faces"])
        # the halves have rocked apart a little
        bmesh.ops.transform(bm, matrix=Matrix.Rotation(0.05 * side, 4, "Y"), verts=bm.verts)
        bmesh.ops.translate(bm, vec=Vector((off, 0, 0)) + n * 0.02, verts=bm.verts)
        zmin = min(v.co.z for v in bm.verts)
        bmesh.ops.translate(bm, vec=(0, 0, -zmin - 0.3), verts=bm.verts)
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0),
                               plane_no=(0, 0, -1), clear_outer=True, dist=1e-4)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        P = [tuple(v.co) for v in bm.verts]; idx = {v: i for i, v in enumerate(bm.verts)}
        g.add(P, [[idx[v] for v in f.verts] for f in bm.faces], None, None, P)
        bm.free()
    # frost-wedged chips in the gap and a fern of grass in the split
    scatter_stones(g, 0.0, -0.1, 0.12, 0.5, 5, 0.12, 0.22, 7)
    rock(g, (-1.35, -0.7, 0), (0.55, 0.45, 0.35), 203, sink=0.25, blocky=2.6, amp=0.1, cuts=1, sub=2)
    base_tufts(0, 0, 1.2, 0.95, 10, 2)
    for i in range(3):
        tussock(B("tuft", "turf"), jit(0.04), -0.4 + i * 0.4, 0.0, 0.8, blades=9)
else:
    rock(g, (0, 0, 0), (3.3, 2.5, 2.4), 301, yaw=0.3, sink=0.12, blocky=3.0, amp=0.12, freq=1.2, cuts=1,
         cut_depth=(0.05, 0.09), cut_up=(-0.1, 0.2), sub=4, squash_top=0.2, dents=3, chamfer=0.04, facets=9,
         facet_depth=(0.03, 0.14), ridged=0.06)
    rock(g, (1.9, -1.05, 0), (0.95, 0.7, 0.5), 302, sink=0.2, blocky=3.0, amp=0.08, cuts=2, sub=2)
    rock(g, (-1.75, -0.95, 0), (0.6, 0.5, 0.36), 303, sink=0.25, blocky=2.8, amp=0.1, cuts=1, sub=2)
    scatter_stones(g, 0.3, -1.1, 1.6, 0.5, 6, 0.12, 0.25, 9)
    base_tufts(0, 0, 1.65, 1.25, 13, 3)

done("boulder_" + V_, tex=1024, lods=(1.0, 0.35, 0.1))
