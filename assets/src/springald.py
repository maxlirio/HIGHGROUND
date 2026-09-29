"""HIGHGROUND - springald (espringal): a torsion bolt-thrower on a four-wheeled trolley.

Reference: the springald of the Milemete treatise (1326), Kyeser's Bellifortis, the Tower of London accounts of
"springaldi" and the reconstructions at Caerphilly / Middelaldercentret: a square frame with two vertical skeins of
twisted sinew-rope held by iron levers (washers) top and bottom, an arm in each skein, a bowstring across the
back, a grooved stock running back through the frame with a claw, and a small windlass to span it; carried on a
low trolley. Contract: 2 x 3 m, 1.6 m tall.

Moving parts (assets/glb/springald_parts.json):
  bolt           pivot = its tail (nocked on the string), point toward -Y; hidden 1.5 s after a shot
  bow_l, bow_r   pivots = the skeins (arm roots), rest = drawn back; flick about +Z at the loose
                 (bow_l is on +X, the engine's left when it faces -Y; bow_l flicks +deg, bow_r -deg)
  wheel_fl/fr/rl/rr   axle centres, roll about +X   (l = +X side, f = -Y end)

  blender -b -P assets/src/springald.py -- [complete|burnt]
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _siege_kit as S
import _kit_yards as K
from _kit_yards import beam, box, cyl, tube

STATE = S.state_from_argv()
S.init(STATE, seed=61)
R = K.R
jit = S.jit
FULL = STATE == "complete"
BURNT = STATE == "burnt"
assert STATE in ("complete", "burnt"), STATE

WR = 0.3                          # wheel radius
BED = 0.62                        # trolley bed top
WX, WY = 0.78, 0.95               # wheel centres
FZ0, FZ1 = BED + 0.05, 1.6        # frame bottom/top
SKX = 0.46                        # skein x
SKY = -0.6                       # frame plane y
STOCK_Z = 1.08
ARM_L = 1.0
ARM_DRAWN = math.radians(62)      # drawn back: arm swung from pointing inward-forward to outward-back

wheels = {"wheel_fl": (1, -1), "wheel_fr": (-1, -1), "wheel_rl": (1, 1), "wheel_rr": (-1, 1)}
if FULL:
    for nm, (sx, sy) in wheels.items():
        S.part(nm, (sx * WX, sy * WY, WR), axis="X", rest="any (rolls)")
    S.part("bow_l", (SKX, SKY, STOCK_Z), axis="Z", rest="drawn back", range_deg=[0, 55],
           notes="+deg about Z swings the arm forward/inward at the loose")
    S.part("bow_r", (-SKX, SKY, STOCK_Z), axis="Z", rest="drawn back", range_deg=[-55, 0],
           notes="-deg about Z swings the arm forward/inward at the loose")
    S.part("bolt", (0.0, 0.62, STOCK_Z + 0.07), axis="X", rest="nocked in the groove, point -Y",
           notes="hide for 1.5 s after a shot; its point is 0.9 m ahead of the pivot")

C = K.B("char") if BURNT else None
oak = C or K.B("oak")
oak2 = C or K.B("oak2")
plank = C or K.B("plank")
iron, rope, tar = K.B("iron"), K.B("rope"), K.B("tar")


def trolley(Mt=None):
    for sx in (-1, 1):
        beam(oak, (sx * 0.55, -1.35, BED - 0.1), (sx * 0.55, 1.35, BED - 0.1), 0.16, 0.2, 0.012)
    for y in (-1.25, -WY, 0.0, WY, 1.25):
        beam(oak, (-0.72, y, BED - 0.1), (0.72, y, BED - 0.1), 0.14, 0.14 if abs(y) != WY else 0.18, 0.0, side=(0, 0, 1))
    for i in range(7):
        x0 = -0.62 + i * 1.24 / 7
        box(plank, (x0 + 0.008, -1.3, BED - 0.01), (x0 + 1.24 / 7 - 0.008, 1.3, BED + 0.035), 0.0, rot=(0, 0, jit(0.008)))
    for sy in (-1, 1):                    # axle trees + iron axle arms
        beam(oak2, (-WX + 0.08, sy * WY, WR), (WX - 0.08, sy * WY, WR), 0.14, 0.16, 0.0)
        for sx in (-1, 1):
            box(oak2, (sx * 0.55 - 0.08, sy * WY - 0.08, WR + 0.08), (sx * 0.55 + 0.08, sy * WY + 0.08, BED - 0.2), 0.0)
    # drag loop at the front, trail handles at the back
    tube(rope, [Vector((-0.5, -1.35, BED - 0.1)), Vector((0.0, -1.75, BED - 0.25)), Vector((0.5, -1.35, BED - 0.1))], 0.02, 4)
    for sx in (-1, 1):
        beam(oak2, (sx * 0.45, 1.3, BED - 0.05), (sx * 0.5, 1.75, BED + 0.08), 0.07, 0.07, 0.0)


def frame():
    y0, y1 = SKY - 0.16, SKY + 0.16
    # sill + head beams, corner posts, the two inner posts beside the stock
    for z in (FZ0 + 0.1, FZ1 - 0.1):
        box(oak, (-0.84, y0 - 0.02, z - 0.08), (0.84, y1 + 0.02, z + 0.08), 0.015)
        for x in (-0.72, 0.0, 0.72):                    # iron straps over the joints
            box(iron, (x - 0.05, y0 - 0.035, z - 0.09), (x + 0.05, y1 + 0.035, z + 0.09), 0.0)
    for x in (-0.72, 0.72):
        box(oak, (x - 0.08, y0 + 0.015, FZ0 + 0.2), (x + 0.08, y1 - 0.015, FZ1 - 0.2), 0.01)
    for x in (-0.16, 0.16):
        box(oak2, (x - 0.06, y0 + 0.02, FZ0 + 0.2), (x + 0.06, y1 - 0.02, FZ1 - 0.2), 0.01)
    # skeins: twisted rope bundles through the beams, held by iron washer-levers
    for sx in (-1, 1):
        x = sx * SKX
        cyl(K.B("rope"), (x, SKY, FZ0 + 0.18), (x, SKY, FZ1 - 0.18), 0.1, n=9, bulge=0.015)
        for z in (FZ0 - 0.02, FZ1 + 0.02):
            cyl(iron, (x, SKY, z - 0.03), (x, SKY, z + 0.03), 0.13, n=10)
            ang = sx * 0.5
            d = Vector((math.cos(ang), math.sin(ang), 0))
            beam(iron, Vector((x, SKY, z)) - d * 0.22, Vector((x, SKY, z)) + d * 0.22, 0.05, 0.05, 0.0)
        for zz in (FZ0 + 0.25, FZ1 - 0.25):
            ring = [Vector((x + math.cos(2 * math.pi * k / 6) * 0.1, SKY + math.sin(2 * math.pi * k / 6) * 0.1, zz)) for k in range(6)]
            tube(rope, ring + [ring[0]], 0.018, 4, caps=False)
    # braces from the frame back to the bed
    for sx in (-1, 1):
        beam(oak2, (sx * 0.72, SKY + 0.1, FZ1 - 0.25), (sx * 0.62, 0.95, BED + 0.04), 0.1, 0.1, 0.0)
        beam(oak2, (sx * 0.72, SKY - 0.1, FZ1 - 0.35), (sx * 0.62, -1.2, BED + 0.04), 0.1, 0.1, 0.0)
    # sill resting on a pivot block on the bed
    box(oak2, (-0.4, SKY - 0.3, BED), (0.4, SKY + 0.3, FZ0), 0.01)


def stock():
    y0, y1 = -0.95, 1.55
    box(oak, (-0.1, y0, STOCK_Z - 0.09), (0.1, y1, STOCK_Z + 0.03), 0.01)
    for sx in (-1, 1):                       # groove cheeks
        box(oak2, (sx * 0.1 - 0.025, y0, STOCK_Z + 0.03), (sx * 0.1 + 0.025, y1, STOCK_Z + 0.07), 0.0)
    for y in (-0.6, 0.4, 1.3):
        box(iron, (-0.125, y - 0.03, STOCK_Z - 0.11), (0.125, y + 0.03, STOCK_Z + 0.09), 0.0)
    # stock supports down to the bed
    for y in (0.4, 1.3):
        box(oak2, (-0.07, y - 0.07, BED), (0.07, y + 0.07, STOCK_Z - 0.09), 0.0)
    # claw + trigger lever holding the string
    tube(iron, [Vector((0, 0.66, STOCK_Z + 0.03)), Vector((0, 0.7, STOCK_Z + 0.14)), Vector((0, 0.6, STOCK_Z + 0.16))],
         [0.028, 0.024, 0.014], 5)
    beam(oak2, (0.0, 0.75, STOCK_Z - 0.08), (0.0, 1.05, STOCK_Z - 0.3), 0.04, 0.04, 0.0)
    # windlass at the back: drum across the stock with cranks
    yw, zw = 1.45, STOCK_Z - 0.02
    S.lathe_x(oak2, (0, yw, zw), [(0.0, -0.3), (0.06, -0.3), (0.06, -0.22), (0.1, -0.2), (0.07, -0.16), (0.07, 0.16),
                                  (0.1, 0.2), (0.06, 0.22), (0.06, 0.3), (0.0, 0.3)], 8)
    for sx in (-1, 1):
        box(oak2, (sx * 0.14 - 0.03, yw - 0.1, BED), (sx * 0.14 + 0.03, yw + 0.1, zw + 0.1), 0.0)
        tube(iron, [Vector((sx * 0.3, yw, zw)), Vector((sx * 0.36, yw, zw)), Vector((sx * 0.36, yw, zw - 0.22)),
                    Vector((sx * 0.46, yw, zw - 0.22))], 0.016, 5)
    S.lathe_x(rope, (0, yw, zw), [(0.0, -0.14), (0.085, -0.14), (0.085, 0.14), (0.0, 0.14)], 8)
    S.rope(rope, [Vector((0, yw - 0.07, zw + 0.06)), Vector((0, 0.9, STOCK_Z + 0.11))], 0.012)


def bows():
    tips = {}
    for nm, sx in (("bow_l", 1), ("bow_r", -1)):
        bt = S.P(nm, "oak") if FULL else oak
        bi = S.P(nm, "iron") if FULL else iron
        root = Vector((sx * SKX, SKY, STOCK_Z))
        # drawn arm: from the skein back and slightly outward
        d = Vector((sx * 0.62, 0.78, 0.0)).normalized()
        tip = root + d * ARM_L
        tips[nm] = tip
        cyl(bt, root - d * 0.06, tip, 0.068, 0.042, n=7)
        for t in (0.35, 0.7):
            q = root.lerp(tip, t)
            cyl(bi, q - d * 0.02, q + d * 0.02, 0.06 - t * 0.02, n=7)
        cyl(bi, tip - d * 0.08, tip + d * 0.03, 0.04, 0.03, n=6)
    return tips


def string_and_bolt(tips):
    nock = Vector((0.0, 0.62, STOCK_Z + 0.07))
    for nm, sx in (("bow_l", 1), ("bow_r", -1)):
        bt = S.P(nm, "rope") if FULL else rope
        S.rope(bt, [tips[nm] + Vector((0, 0.02, 0)), nock + Vector((sx * 0.03, 0.02, 0))], 0.015, 4)
    bb = S.P("bolt", "oak2") if FULL else oak2
    bi = S.P("bolt", "iron") if FULL else iron
    tail, point = nock, nock + Vector((0, -0.9, 0))
    cyl(bb, tail, point + Vector((0, 0.1, 0)), 0.022, 0.026, n=6)
    tube(bi, [point + Vector((0, 0.12, 0)), point + Vector((0, 0.02, 0)), point + Vector((0, -0.08, 0))], [0.03, 0.03, 0.002], 6)
    # wooden vanes (springald bolts were fletched with wood or leather)
    bv = S.P("bolt", "plank") if FULL else plank
    for k in range(3):
        a = k * 2 * math.pi / 3 + math.pi / 2
        o = Vector((math.cos(a), 0, math.sin(a)))
        pts = [tail + Vector((0, -0.02, 0)) + o * 0.02, tail + Vector((0, -0.2, 0)) + o * 0.02,
               tail + Vector((0, -0.04, 0)) + o * 0.07, tail + Vector((0, -0.12, 0)) + o * 0.06]
        pts = [p + Vector((0.004, 0, 0)) for p in pts] + [p - Vector((0.004, 0, 0)) for p in pts]
        P, F = K.hull(pts); bv.add(P, F, None, None)


def spare_bolts(cx, cy):
    for i in range(5):
        y0 = cy + jit(0.05)
        x = cx + i * 0.06
        cyl(oak2, (x, y0 - 0.45, BED + 0.06 + (i % 2) * 0.04), (x, y0 + 0.45, BED + 0.06 + (i % 2) * 0.04), 0.022, n=5)
        cyl(iron, (x, y0 - 0.45, BED + 0.06 + (i % 2) * 0.04), (x, y0 - 0.58, BED + 0.06 + (i % 2) * 0.04), 0.026, 0.004, n=5)


if FULL:
    trolley()
    for nm, (sx, sy) in wheels.items():
        S.wheel(nm, (sx * WX, sy * WY, WR), WR, 0.12, kind="disc", side=sx)
    frame(); stock()
    tips = bows()
    string_and_bolt(tips)
    spare_bolts(0.3, 0.6)
    box(K.B("tar"), (-0.55, 0.85, BED + 0.04), (-0.3, 1.1, BED + 0.24), 0.01)        # grease pot for the skeins
else:
    # burnt: bed on the ground on its axles, two wheels burnt away, frame collapsed backward
    trolley()
    for nm, (sx, sy) in wheels.items():
        if sx > 0 and sy < 0:
            continue
        S.wheel("body", (sx * (WX + 0.05), sy * WY, WR), WR, 0.12, kind="disc", side=sx)
    frame(); stock()
    tips = bows()
    # topple: the whole wreck tilts onto the missing front-left wheel, then sits back on the ground
    Mt = Matrix.Rotation(math.radians(8), 4, "Y") @ Matrix.Rotation(math.radians(4), 4, "X")
    for v in K.BATCHES.values():
        v.V = [tuple(Mt @ Vector(p)) for p in v.V]
    mz = min(p[2] for v in K.BATCHES.values() for p in v.V)
    for v in K.BATCHES.values():
        v.V = [(p[0], p[1], p[2] - mz - 0.03) for p in v.V]
    K.mound(K.B("ash"), 0.2, 0.0, 0.9, 1.3, 0.05, rings=3, seg=16, rough=0.45)

if __name__ == "__main__":
    name = "springald" if FULL else "springald_" + STATE
    path, tris = S.finish_parts(name, tex=1024)
    if FULL:
        S.write_parts_json("springald", ["complete", "burnt"], tris,
                           extra=dict(wheel_naming="f = -Y end, r = +Y end, l = +X side, r = -X side (the engine's own left/right facing -Y)"))
