"""Timber hoardings (brattices): a covered gallery cantilevered out from the wall-head on beams pushed through
the putlog sockets under the wall-walk, so defenders can drop stones and shoot straight down at the foot of the
wall. One piece per 6 m curtain module, per wall class (hoarding, hoarding_inner, hoarding_outer), same frame as
the curtain (x -3..3, outside -y). Plus hoarding_burnt (charred, half fallen).

    tools/heavy.sh /opt/homebrew/bin/blender -t 2 -b -P assets/src/castle/hoarding.py
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import _castle as L
from _dims import *

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = 1.6          # gallery depth beyond the wall face
SLOT = 0.32        # the drop slot along the wall face


def build(cls, burnt=False):
    W = WALLS[cls]
    ht, walk, sill, merlon = W["ht"], W["walk"], W["sill"], W["merlon"]
    seed = {"main": 301, "inner": 303, "outer": 305}[cls] + (50 if burnt else 0)
    L.reset(seed); rng = random.Random(seed)
    s = L.Solid("hoarding")
    y_face = -ht
    z_beam_top = walk - 0.36
    z_floor = z_beam_top + 0.06
    xs = (-2.25, -0.75, 0.75, 2.25)
    fall = [False] * 4
    if burnt:
        fall = [False, True, True, False]
    # beams through the sockets
    for i, x in enumerate(xs):
        if burnt and fall[i]:
            continue
        s.box(x - 0.11, x + 0.11, y_face - OUT - 0.15, y_face + 0.8, z_beam_top - 0.24, z_beam_top, "timber", res=2)
        # a raking strut back to the wall
        prof = [(y_face - OUT + 0.25, z_beam_top - 0.24), (y_face - OUT + 0.45, z_beam_top - 0.24), (y_face, z_beam_top - 1.7), (y_face, z_beam_top - 1.45)]
        t = L.Solid("strut"); t.extrude(prof, (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), x - 0.08, x + 0.08, "timber")
        s.merge(L._welded(t))
    x0, x1 = (-3.0, 3.0) if not burnt else (-3.0, -1.3)
    # the floor, leaving the drop slot open along the wall face
    s.box(x0, x1, y_face - OUT, y_face - SLOT, z_floor - 0.06, z_floor, "planks", res=1.2)
    # front wall: posts, rails, boards with shooting slits
    zt = z_floor + 2.1
    for x in (-2.25, -0.75, 0.75, 2.25, -3.0, 3.0):
        if x0 - 0.01 <= x <= x1 + 0.01:
            s.box(max(x0, x - 0.08), min(x1, x + 0.08), y_face - OUT - 0.02, y_face - OUT + 0.14, z_floor, zt, "timber", res=9)
    s.box(x0, x1, y_face - OUT + 0.02, y_face - OUT + 0.14, zt - 0.14, zt, "timber", res=2)
    bw = L.Solid("boards")
    bw.box(x0, x1, y_face - OUT - 0.05, y_face - OUT + 0.02, z_floor - 0.35, zt, "planks", res=0.8)
    bo = bw.to_object()
    cuts = []
    for x in (-1.5, 1.5, -2.6, 0.0, 2.6):
        if x0 + 0.2 < x < x1 - 0.2:
            cuts.append(L.box_cutter(x - 0.06, x + 0.06, y_face - OUT - 0.2, y_face - OUT + 0.2, z_floor + 0.7, z_floor + 1.6, key="dark"))
    L.cut(bo, cuts)
    # pent roof from over the merlons out over the front wall
    z_hi = walk + sill + merlon + 0.55
    prof = [(y_face + 0.25, z_hi), (y_face - OUT - 0.35, zt - 0.1), (y_face - OUT - 0.35, zt - 0.24), (y_face + 0.25, z_hi - 0.14)]
    r = L.Solid("roof"); r.extrude(prof, (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), x0, x1, "shingle")
    if not burnt:
        s.merge(L._welded(r))
        # rafters under the roof, resting on the front wall head and a plate on the merlons
        s.box(x0, x1, y_face + 0.05, y_face + 0.25, z_hi - 0.4, z_hi - 0.14, "timber", res=2)
    else:
        # a few charred rafters left hanging
        for x in (-2.7, -1.8):
            t = L.Solid("raf"); t.extrude([(y_face + 0.2, z_hi - 0.2), (y_face - OUT * 0.7, zt - 0.8), (y_face - OUT * 0.7, zt - 0.95), (y_face + 0.2, z_hi - 0.35)],
                                         (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), x - 0.07, x + 0.07, "timber")
            s.merge(L._welded(t))
        for i in range(10):
            L.chunk(s, (rng.uniform(-2.5, 2.5), rng.uniform(y_face - 5, y_face - 1.5), 0.1), (rng.uniform(0.8, 2.2), 0.14, 0.12), rng, "timber", tilt=0.3)
    o = s.to_object()
    soot = [(x, y_face - OUT * 0.5, z_floor - 0.5, 2.0, 3.0) for x in (-2.0, 0.0, 2.0)] if burnt else []
    name = "hoarding" + ("" if cls == "main" else f"_{cls}") + ("_burnt" if burnt else "")
    meta = {"kind": "hoarding", "wall_class": cls, "burnt": burnt, "mods": 1,
            "frame": "curtain frame (x -3..3, outside -y); sits on the curtain module of the same class",
            "walks": [] if burnt else [{"id": "gallery", "lvl": 1, "z": z_floor, "kind": "strip", "line": [[-3, y_face - (OUT + SLOT) / 2], [3, y_face - (OUT + SLOT) / 2]], "width": OUT - SLOT - 0.2}],
            "links": [] if burnt else [{"kind": "door", "a": {"surf": "walk", "p": L.V3((x, WALK_YC if cls == 'main' else -ht + W['para'] + 0.5, walk))}, "b": {"surf": "gallery", "p": L.V3((x, y_face - 0.8, z_floor))},
                                        "width": 1, "note": "through the crenel (step over the sill)"} for x in (-1.5, 1.5)],
            "drop_slot": {"y": [y_face - SLOT, y_face], "z": z_floor, "x": [x0, x1]},
            "cover": "the gallery's board front stops arrows from below; the slot lets men drop stones on the wall foot",
            "bbox": [[-3, y_face - OUT - 0.4, z_beam_top - 1.8], [3, y_face + 0.8, z_hi + 0.05]]}
    L.finish_piece(name, {"base": [o, bo]}, {}, meta=meta, lods=(1.0, 0.5), soot=soot, grime_h=0.0, ao_dist=1.2)


if __name__ == "__main__":
    for cls in ("main", "inner", "outer"):
        build(cls)
    build("main", burnt=True)
