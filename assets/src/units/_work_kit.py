"""HIGHGROUND units — the villagers' working kit (job loadouts, see docs/units-pipeline.md §3 "Villager loadouts").

Same conventions as _human.py: rest pose, the man faces -Y, a held thing lies along Y through H.fist(side)
with its business end toward -Y and is weighted 1.0 to that hand bone, so it follows every frame of every clip.
The "head side" of a tool (hoe blade, axe edge, pick point, mallet face) is rest -Z: _work_anims.py poses
tools by the world direction of the haft and of that side.

    pick     miner's pick: 0.88 m haft, long point on -Z, short chisel on +Z
    mallet   builder's beetle (two hands), faces on +-Z
    stake    a post planted in front of him, weighted to the "ground" bone (the beetle's target)
    sickle   toothed reaping hook, blade curving to the left (+X) in the fist's horizontal plane
    sack     a filled sack over the right shoulder (weighted to the chest), the neck in front for the hand
    pail     wooden pail hanging from its bail, the bail through the right fist along Y
    rod      2.6 m fishing rod, butt 0.40 m behind the fist
Painters for the new materials register into _paint on import.
"""
import math
import numpy as np
from mathutils import Vector
import _human as H
import _paint as PT
from _paint import hexc, fbm, vnoise

fist = H.fist


def tube(P, pts, radii, mat, w, segs=6, cap0=True, cap1=True):
    rings, pats, L = [], [], 0.0
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]
        sv, bk = H.frame_for(b - a)
        r = radii[i]; rx, ry = (r, r) if not isinstance(r, tuple) else r
        if i: L += (pts[i] - pts[i - 1]).length
        rings.append((H.ring(p, sv, bk, rx, ry, segs), w)); pats.append([(L, 0, 1)] * segs)
    return H.loft(P, rings, mat, cap0=cap0, cap1=cap1, pats=pats)


def axe(P, part, mats, side="R", lod=0):
    """felling axe: 0.90 m haft (0.16 m of it behind the right fist, where the left hand holds), iron head at
    the far end with the edge on -Z (the side that bites)."""
    f = fist(side); w = {f"hand.{side}": 1}
    butt = f + Vector((0, 0.16, 0)); top = f + Vector((0, -0.74, 0))
    H.shaft(P, butt, top, 0.016, 0.014, mats["wood"], w, 4 if lod else 6)
    hc = top + Vector((0, 0.05, 0))
    eye = [(hc + Vector((sx * 0.015, sy * 0.030, 0.03))) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    mid = [(hc + Vector((sx * 0.010, sy * 0.032, -0.05))) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    blade = [(hc + Vector((sx * 0.003, sy * 0.060, -0.14))) for sx, sy in ((1, 1.1), (-1, 1.1), (-1, -1.25), (1, -1.25))]
    H.loft(P, [(eye, w), (mid, w), (blade, w)], mats["iron"], cap0=True, cap1=True)


def pick(P, part, mats, side="R", lod=0):
    f = fist(side); w = {f"hand.{side}": 1}
    H.shaft(P, f + Vector((0, 0.18, 0)), f + Vector((0, -0.68, 0)), 0.017, 0.015, mats["wood"], w, 4 if lod else 6)
    c = f + Vector((0, -0.70, 0))
    segs = 4 if lod else 5
    tube(P, [c + Vector((0, 0.0, 0.17)), c + Vector((0, 0, 0.05)), c, c + Vector((0, 0.01, -0.12)), c + Vector((0, 0.035, -0.29))],
         [0.010, 0.020, 0.024, 0.016, 0.003], mats["iron"], w, segs)


def mallet(P, part, mats, side="R", lod=0):
    """builder's beetle: a 0.80 m haft (0.14 m of it behind the right fist, for the left hand) and a heavy round
    wooden head across it, iron-hooped, faces on +-Z."""
    f = fist(side); w = {f"hand.{side}": 1}
    H.shaft(P, f + Vector((0, 0.14, 0)), f + Vector((0, -0.62, 0)), 0.015, 0.016, mats["wood"], w, 4 if lod else 6)
    hc = f + Vector((0, -0.66, 0))
    H.shaft(P, hc + Vector((0, 0, -MALLET_FACE)), hc + Vector((0, 0, MALLET_FACE)), 0.068, 0.068, mats["wood_dark"], w, 5 if lod else 9)


MALLET_FACE = 0.11
STAKE = Vector((0.03, -0.80, 0.0)); STAKE_TOP = 0.80
def stake(P, part, mats, lod=0):
    """a squared oak post planted in the ground in front of him (weighted to the parentless "ground" bone,
    _arms_kit.ground_rig, so it never moves with the man); only drawn while he works on it."""
    w = {"ground": 1}
    tube(P, [STAKE + Vector((0, 0, -0.05)), STAKE + Vector((0, 0, STAKE_TOP - 0.02)), STAKE + Vector((0, 0, STAKE_TOP))],
         [0.05, 0.05, 0.042], mats["wood_dark"], w, 4 if lod else 6, cap0=False)


def sickle(P, part, mats, side="R", lod=0):
    """a short wooden handle and an iron hook curving round to the left, flat in the fist's X-Y plane."""
    f = fist(side); w = {f"hand.{side}": 1}
    H.shaft(P, f + Vector((0, 0.065, 0)), f + Vector((0, -0.07, 0)), 0.016, 0.015, mats["wood"], w, 4 if lod else 5)
    b0 = f + Vector((0, -0.07, 0)); R = 0.16; cen = b0 + Vector((R, 0, 0))
    n = 4 if lod else 8
    rings = []
    for k in range(n + 1):
        th = math.radians(205) * k / n
        u = Vector((-math.cos(th), -math.sin(th), 0))          # from the centre to the blade's inner (cutting) edge
        wd = 0.034 * (1 - 0.8 * (k / n) ** 1.5) + 0.003
        inner, outer = cen + u * R, cen + u * (R + wd)
        tz = Vector((0, 0, 0.0025))
        rings.append(([outer + tz, inner + tz, inner - tz, outer - tz], w))
    H.loft(P, rings, mats["iron"], cap0=True, cap1=True)


def sack(P, part, mats, lod=0):
    """a filled hessian sack lying over the right shoulder, the tied neck forward for the right hand."""
    w = {"chest": 1}
    segs = 5 if lod else 9
    pts = [Vector((-0.185, -0.205, 1.425)), Vector((-0.195, -0.12, 1.51)), Vector((-0.205, 0.02, 1.575)),
           Vector((-0.20, 0.16, 1.535)), Vector((-0.175, 0.27, 1.40)), Vector((-0.16, 0.30, 1.30))]
    rad = [(0.045, 0.045), (0.095, 0.085), (0.125, 0.105), (0.13, 0.115), (0.12, 0.105), (0.07, 0.06)]
    if lod: pts, rad = [pts[i] for i in (0, 2, 4, 5)], [rad[i] for i in (0, 2, 4, 5)]
    tube(P, pts, rad, mats["bag"], w, segs)
    if not lod:
        tube(P, [Vector((-0.185, -0.215, 1.415)), Vector((-0.185, -0.27, 1.39))], [0.03, 0.04], mats["bag"], w, 6)


def pail(P, part, mats, side="R", lod=0):
    """wooden pail: iron bail arcing through the fist (lugs on +-Y), a coopered bucket hanging below."""
    f = fist(side); w = {f"hand.{side}": 1}
    arc = [f + Vector((0, 0.125 * math.sin(p), -0.15 + 0.15 * math.cos(p))) for p in np.linspace(-1.5708, 1.5708, 3 if lod else 7)]
    tube(P, arc, [0.006] * len(arc), mats["iron"], w, 4, cap0=False, cap1=False)
    segs = 6 if lod else 12
    prof = [(0.130, -0.14), (0.126, -0.20), (0.112, -0.36), (0.108, -0.38)]
    if lod: prof = [prof[0], prof[2]]
    rings = [([f + Vector((math.cos(2 * math.pi * k / segs) * r, math.sin(2 * math.pi * k / segs) * r, z)) for k in range(segs)], w)
             for r, z in prof]
    H.loft(P, rings, mats["pail"], cap1=True)


def rod(P, part, mats, side="R", lod=0):
    f = fist(side); w = {f"hand.{side}": 1}
    tube(P, [f + Vector((0, 0.40, 0)), f + Vector((0, -0.6, 0)), f + Vector((0, -2.2, 0))], [0.017, 0.012, 0.004], mats["wood"], w, 3 if lod else 5)


# ------------------------------------------------------------------------------------------ painters
def paint_wood_dark(P, N, pat, patd):
    n = len(P); c = np.tile(hexc("6a4f35"), (n, 1)) * (0.82 + 0.3 * vnoise(P * np.array([160.0, 160.0, 20.0]), 301))[:, None]
    return np.clip(c, 0, 1), np.full(n, 0.75), np.zeros((n, 3))

def paint_pail(P, N, pat, patd):
    """coopered staves (vertical) with two dark iron hoops."""
    n = len(P); ang = np.arctan2(P[:, 1] - np.median(P[:, 1]), P[:, 0] - np.median(P[:, 0]))
    stave = 0.85 + 0.25 * vnoise(np.stack([ang * 5, np.zeros(n), P[:, 2] * 4], -1), 311)
    c = hexc("8a6a45")[None] * stave[:, None]
    z = P[:, 2] - P[:, 2].min(); hz = (z > 0.035) & (z < 0.06) | (z > 0.19) & (z < 0.215)
    c[hz] = hexc("3a3935")
    return np.clip(c, 0, 1), np.full(n, 0.7), np.zeros((n, 3))

def paint_string(P, N, pat, patd):
    n = len(P); return np.tile(hexc("cfc6a8"), (n, 1)), np.full(n, 0.8), np.zeros((n, 3))

def paint_bag(P, N, pat, patd):
    rgb, mud = PT.cloth(P, hexc("b3a27f"), 0.10, 0.04, 231, 0.6); return rgb, np.full(len(P), 0.93), np.zeros((len(P), 3))

for k, (fn, flat) in {"wood_dark": (paint_wood_dark, "6a4f35"), "pail": (paint_pail, "8a6a45"),
                      "string": (paint_string, "cfc6a8"), "bag": (paint_bag, "b3a27f")}.items():
    PT.PAINTERS.setdefault(k, fn); PT.FLAT.setdefault(k, flat)
