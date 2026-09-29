"""Felled oak trunk section, ~5 m, lying on the ground: sawn ends showing rings and
checks, two sawn-off branch stubs, moss on the upper side, slightly sunk into the soil.

  blender -b -P assets/src/log.py            -> assets/glb/log.glb
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from mathutils import Vector
import _lib as L
import _trees as T
import _veg as V

SEED = 12


def tube(name, a, b, r0, r1, rng, seed, n=10, sides=16, gnarl=0.07):
    sk = T.Skel(); d = b - a; prev = sk.add(a, -1); rad = [r0]
    for k in range(1, n + 1):
        t = k / n
        q = a + d * t + Vector((0, 0, 0.02 * math.sin(t * 3.1) + rng.gauss(0, 0.008)))
        prev = sk.add(q, prev); rad.append(r0 + (r1 - r0) * t)
    return T.build_tubes(sk, rad, min_r=0.005, name=name, gnarl=gnarl, seed=seed, spacing=lambda r: d.length / n * 0.99,
                         sides=lambda r: sides, tip=False, caps=True)


def build(seed):
    rng = random.Random(seed)
    bark = T.bark_material("log_bark", along=0.22, plate_scale=9.0, crack_width=0.32, moss_amount=1.0,
                           plate="#766d60", plate2="#62574a", lichen_amount=0.45)
    cut = T.cutwood_material("log_cut", wood="#b89a70", ring="#8f7250", heart="#7a5a3a", ring_freq=38.0)
    Ln = 5.0; r0, r1 = 0.36, 0.3
    sink = 0.05
    a = Vector((-Ln / 2, 0, r0 - sink)); b = Vector((Ln / 2, 0.12, r1 - sink))
    main = tube("log", a, b, r0, r1, rng, seed, n=16, sides=20, gnarl=0.1)
    objs = [main]
    # sawn-off branch stubs
    for t, ang, rr in ((0.62, 1.1, 0.11), (0.3, 2.3, 0.085)):
        p = a.lerp(b, t)
        d = Vector((0.25, math.cos(ang), math.sin(ang))).normalized()
        base = p + d * (r0 * 0.6)
        objs.append(tube("stub", base, base + d * (r0 * 0.4 + 0.1), rr * 1.5, rr, rng, seed + 3, n=3, sides=10, gnarl=0.1))
    for o in objs:
        o.data.materials.append(bark); o.data.materials.append(cut)
    # sawn ends: flatten the fan caps to true planes perpendicular to the axis (with a
    # slight saw step) - build_tubes caps follow the ring, which is already planar.
    V.pin_centre(bark, zc=0.3)


def main():
    L.reset(SEED)
    build(SEED)
    V.finish("log", tex=1024, lods=(1.0, 0.35, 0.12))


main()
