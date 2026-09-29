"""Ditch and moat edge pieces, 6 m long along x, the ditch centreline at y=0 (castle side +y, field side -y).

    tools/heavy.sh /opt/homebrew/bin/blender -t 2 -b -P assets/src/castle/ditch.py

ditch        dry rock-cut ditch: 9 m wide at the lip, 3.5 m deep, flat 2.5 m bottom, earth and rock scarps
moat         the same with water 1.4 m below the lip (node 'water', flat, so the renderer can swap its own water)
revetment    a stone-faced scarp (retaining wall) to line a ditch side: 6 m long, 3.6 m from lip to bottom, battered,
             with a coping at ground level; faces -y (stand it on the castle side of the ditch)
The ground around the lip is at z=0: the terrain must be carved to the same profile (see 'profile').
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector, noise
import _castle as L
import _damage as D
from _dims import *

W, DEPTH, BOT = 9.0, 3.5, 2.5


def profile_z(y, seed=0.0, x=0.0):
    """Ditch cross-section: 0 beyond the lip, sloping scarps, flat bottom."""
    a = abs(y)
    if a >= W / 2:
        z = 0.0
    elif a <= BOT / 2:
        z = -DEPTH
    else:
        t = (a - BOT / 2) / (W / 2 - BOT / 2)
        z = -DEPTH * (1 - t) ** 1.15
    # rough edges (periodic along x so modules tile)
    z += 0.12 * noise.noise(Vector((math.cos(x / 6 * 2 * math.pi) * 2, math.sin(x / 6 * 2 * math.pi) * 2, y * 0.8 + seed))) * (1 if a < W / 2 + 0.2 else 0.3)
    return z


def ditch(name, water):
    L.reset(401 if not water else 403); rng = random.Random(7)
    s = L.Solid("ditch")
    nx, ny = 16, 36
    x0, x1, y0, y1 = -3.0, 3.0, -W / 2 - 1.5, W / 2 + 1.5
    V = [[s.bm.verts.new((x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny, profile_z(y0 + (y1 - y0) * j / ny, 1.7, x0 + (x1 - x0) * i / nx)))
          for j in range(ny + 1)] for i in range(nx + 1)]
    mi = s._mi("earth"); mr = s._mi("debris")
    for i in range(nx):
        for j in range(ny):
            f = s.bm.faces.new((V[i][j], V[i + 1][j], V[i + 1][j + 1], V[i][j + 1]))
            yc = y0 + (y1 - y0) * (j + 0.5) / ny
            steep = BOT / 2 + 0.3 < abs(yc) < W / 2 - 0.8
            f.material_index = mr if (steep and noise.noise(Vector((i * 0.7, j * 0.9, 3))) > 0.1) else mi
    for i in range(10):
        x = rng.uniform(-2.6, 2.6); y = rng.uniform(-BOT / 2, BOT / 2)
        sz = rng.uniform(0.25, 0.6)
        L.chunk(s, (x, y, -DEPTH + sz * 0.2), (sz * 1.4, sz, sz * 0.6), rng, "rubble")
    parts = {"base": [s.to_object()]}
    moving = {}
    if water:
        w = L.Solid("water")
        zw = -1.4
        ya = W / 2 * (1 - (1 - DEPTH ** -1 * (DEPTH - (-zw))) ) if False else None
        half = BOT / 2 + (W / 2 - BOT / 2) * (1 - ((zw + DEPTH) / DEPTH) ** (1 / 1.15) if False else 1)
        # the half-width where the scarp reaches the water level
        t = 1 - ((-zw) / DEPTH) ** (1 / 1.15)
        half = BOT / 2 + t * (W / 2 - BOT / 2) + 0.15
        w.grid((-3, -half, zw), (6, 0, 0), (0, 2 * half, 0), "water", res=1.5)
        parts["water"] = [w.to_object()]
    meta = {"kind": "moat" if water else "ditch", "mods": 1, "width": W, "depth": DEPTH, "bottom": BOT,
            "frame": "x along the ditch (-3..3), y across (castle side +y), lip at z=0",
            "profile": [[round(y, 2), round(profile_z(y), 2)] for y in [-W / 2 - 1, -W / 2, -3.5, -2.5, -BOT / 2, 0, BOT / 2, 2.5, 3.5, W / 2, W / 2 + 1]],
            "water_z": -1.4 if water else None, "walks": [{"id": "bottom", "lvl": 0, "z": -DEPTH, "kind": "strip", "line": [[-3, 0], [3, 0]], "width": BOT}],
            "ports": [{"p": [-3, 0, 0], "dir": [-1, 0]}, {"p": [3, 0, 0], "dir": [1, 0]}]}
    L.finish_piece(name, parts, moving, meta=meta, lods=(1.0, 0.5), grime_h=-5, ao_dist=1.5)


def revetment():
    L.reset(405); rng = random.Random(5)
    s = L.Solid("rev")
    H = DEPTH + 0.1
    # swept along +x so the outside (-y) is on the right; profile (offset toward -y, z), battered face subdivided
    face = [(0.9 - 0.45 * k / 5, -H + H * k / 5) for k in range(6)]
    prof = [(-0.4, -H - 0.6), (0.9, -H - 0.6)] + face + [(-0.4, 0.0)]
    L.sweep(s, [Vector((-3, 0)), Vector((3, 0))], prof, "ashlar", closed=False, step=0.8)
    L.sweep(s, [Vector((-3, 0)), Vector((3, 0))], [(-0.45, -0.05), (0.55, -0.05), (0.62, 0.08), (0.5, 0.2), (-0.45, 0.2)], "ashlar", closed=False, step=0.8)
    o = s.to_object()
    meta = {"kind": "revetment", "mods": 1, "frame": "x along (-3..3); the stone face looks -y into the ditch; top (coping) at z=0.2, foot at z=-3.6",
            "ports": [{"p": [-3, 0, 0], "dir": [-1, 0]}, {"p": [3, 0, 0], "dir": [1, 0]}]}
    L.finish_piece("revetment", {"base": [o]}, {}, meta=meta, lods=(1.0, 0.5), grime_h=-2.0, damp=0.6, ao_dist=1.2)


if __name__ == "__main__":
    ditch("ditch", False)
    ditch("moat", True)
    revetment()
