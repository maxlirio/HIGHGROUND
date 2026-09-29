"""HIGHGROUND - mantlet (wheeled siege screen) and scaling ladder.

Mantlet reference: the "mantelets" of Viollet-le-Duc and the wheeled pavise-screens of the Hussite and
Burgundian inventories (earlier ones of the 13th c. shown in the Maciejowski Bible): a screen of thick boards
battened behind, leaning back ~15 deg, a shuttered loophole at eye height, two small solid wheels and a pair of
hinged props; the upper band painted with the company's colours (team material). Contract: 2.4 x 0.8 m, 2.0 m.
  parts: wheel_l (+X) / wheel_r (-X) roll about +X.  states: complete | burnt

Ladder: a 7 m scaling ladder of two riven ash stiles and lashed rungs, iron shoes at the foot, iron hooks at the
head to catch the parapet. Modelled STANDING along +Z (foot at the origin, top at z = 7), as the contract asks.

  blender -b -P assets/src/mantlet.py -- [complete|burnt]
  HG_ASSET=ladder blender -b -P assets/src/mantlet.py
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _siege_kit as S
import _kit_yards as K
from _kit_yards import beam, box, cyl, tube

ASSET = os.environ.get("HG_ASSET", "mantlet")
STATE = S.state_from_argv()
S.init(STATE, seed=97 if ASSET == "mantlet" else 101)
R = K.R
jit = S.jit
FULL = STATE == "complete"
BURNT = STATE == "burnt"
assert STATE in ("complete", "burnt"), STATE

if ASSET == "mantlet":
    LEAN = math.radians(15)
    Y0, Z0, HGT, WID = -0.32, 0.12, 2.0, 2.4
    UP = Vector((0.0, math.sin(LEAN), math.cos(LEAN)))       # up the screen face
    NRM = Vector((0.0, -math.cos(LEAN), math.sin(LEAN)))      # screen front normal (toward -Y, a little up)
    WR = 0.24
    WHEELS = {"wheel_l": 1, "wheel_r": -1}
    if FULL:
        for nm, sx in WHEELS.items():
            S.part(nm, (sx * 1.02, -0.2, WR), axis="X", rest="any (rolls)")
    C = K.B("char") if BURNT else None
    oak, oak2, plank = C or K.B("oak"), C or K.B("oak2"), C or K.B("plank")
    iron, rope = K.B("iron"), K.B("rope")

    def sp(x, v, d=0.0):
        """point on the screen: x across, v up the face (0..HGT), d along the front normal."""
        return Vector((x, Y0, Z0)) + UP * v + NRM * d

    # boards (thick, slightly irregular heights), loophole cut in the middle two boards
    nb = 8
    for i in range(nb):
        x0 = -WID / 2 + WID * i / nb + 0.006
        x1 = -WID / 2 + WID * (i + 1) / nb - 0.006
        top = HGT + jit(0.04) - (0.03 if i in (0, nb - 1) else 0.0)
        segs = [(0.0, top)]
        if i in (3, 4):
            segs = [(0.0, 1.3), (1.46, top)]
        for (v0, v1) in segs:
            pts = [sp(x, v, d) for x in (x0, x1) for v in (v0, v1) for d in (0.0, 0.07)]
            P, F = K.hull(pts)
            (oak2 if i % 3 else plank).add(P, F, None, None, [(p[0], 0.0, (Vector(p) - sp(0, 0)).dot(UP)) for p in P])
    # team-painted upper band + a painted cross on it (both tinted by the renderer)
    band = [[sp(-WID / 2 + 0.03 + (WID - 0.06) * j / 4, v, 0.075 + 0.003 * math.sin(j * 1.7)) for j in range(5)]
            for v in (1.6, 1.9)]
    S.sheet(K.B("team"), band, 0.004)
    # battens behind + iron clench nails in front
    for v in (0.25, 1.0, 1.75):
        beam(oak, sp(-WID / 2 + 0.05, v, -0.05), sp(WID / 2 - 0.05, v, -0.05), 0.13, 0.08, 0.0, side=NRM)
        for i in range(nb):
            x = -WID / 2 + WID * (i + 0.5) / nb
            for dx in (-0.07, 0.07):
                box(iron, sp(x + dx, v, 0.07) - Vector((0.011, 0.011, 0.011)), sp(x + dx, v, 0.08) + Vector((0.011, 0.011, 0.011)), 0.0)
    # loophole shutter on a pivot pin, slid half open
    sh0 = sp(0.02, 1.28, 0.08)
    box(oak, sh0 + Vector((-0.02, -0.03, 0.0)), sh0 + Vector((0.34, 0.01, 0.2)), 0.0, rot=(-LEAN, 0, 0.08))
    # brace from the middle batten to the axle; hinged props behind (resting on the ground)
    for sx in ((-1, 1) if FULL else ()):
        a = sp(sx * 0.8, 1.72, -0.1)
        b = Vector((sx * 0.9, 0.42, 0.02))
        if BURNT:
            b = Vector((sx * 1.1, 0.35, 0.02))
        beam(oak2, a, b, 0.08, 0.08, 0.0)
        box(iron, a - Vector((0.05, 0.05, 0.05)), a + Vector((0.05, 0.05, 0.05)), 0.0)
    # axle bar under the screen
    beam(oak, (-1.15, -0.2, WR), (1.15, -0.2, WR), 0.1, 0.1, 0.0)
    for sx in ((-1, 1) if FULL else ()):
        beam(oak2, sp(sx * 0.9, 0.2, -0.06), (sx * 0.9, -0.2, WR + 0.02), 0.08, 0.08, 0.0)
    if FULL:
        for nm, sx in WHEELS.items():
            S.wheel(nm, (sx * 1.02, -0.2, WR), WR, 0.1, kind="plain", side=sx)
        # a rope to drag it back by
        S.rope(rope, [sp(-0.6, 1.0, -0.07), Vector((-0.2, 0.55, 0.05)), Vector((0.3, 0.7, 0.03))], 0.015, 4)
    else:
        S.wheel("body", (1.02, -0.2, WR), WR, 0.1, kind="plain", side=1)
        K.mound(K.B("ash"), 0.1, 0.9, 1.5, 1.1, 0.05, rings=3, seg=14, rough=0.4)

else:
    # ------------------------------------------------------------------ scaling ladder
    assert FULL, "ladder has no states"
    Ln = 7.0
    ash = K.B("fresh")
    iron, rope = K.B("iron"), K.B("rope")
    for sx in (-1, 1):
        x0, x1 = sx * 0.25, sx * 0.21                       # stiles converge a little toward the head
        pts = []
        for k in range(4):
            t = k / 3
            pts.append(Vector((x0 + (x1 - x0) * t + jit(0.01), jit(0.012), t * Ln)))
        tube(K.B("oak2"), pts, [0.045, 0.042, 0.038, 0.034], 6)
        # iron shoe spike at the foot, forked hook at the head
        tube(iron, [Vector((x0, 0, 0.12)), Vector((x0, 0, 0.0)), Vector((x0, 0, -0.0))], [0.05, 0.035, 0.01], 6)
        tube(iron, [Vector((x1, 0, Ln - 0.2)), Vector((x1, 0.0, Ln + 0.12)), Vector((x1, -0.14, Ln + 0.22)),
                    Vector((x1, -0.2, Ln + 0.1))], [0.03, 0.028, 0.02, 0.01], 5)
    nr = int((Ln - 0.35) / 0.3)
    for k in range(nr + 1):
        z = 0.3 + k * 0.3
        t = z / Ln
        w = 0.25 + (0.21 - 0.25) * t
        cyl(K.B("oak2") if k % 4 else ash, (-w - 0.03, jit(0.01), z), (w + 0.03, jit(0.01), z + jit(0.015)), 0.021, n=5)
        if k % 3 == 0:
            for sx in (-1, 1):
                ring = [Vector((sx * w + math.cos(a) * 0.055, math.sin(a) * 0.055, z + (a - 0.3) * 0.006)) for a in
                        [2 * math.pi * i / 6 for i in range(7)]]
                tube(rope, ring, 0.012, 4, caps=False)
    oak = K.B("oak2")

if __name__ == "__main__":
    name = ASSET if FULL else ASSET + "_" + STATE
    if ASSET == "mantlet" and BURNT:
        # the burnt screen has fallen onto its back
        Mt = Matrix.Translation((0, 0.25, 0.0)) @ Matrix.Rotation(math.radians(-80), 4, "X")
        for k, v in K.BATCHES.items():
            if k != "ash":
                v.V = [tuple(Mt @ Vector(p)) for p in v.V]
        mz = min(p[2] for k, v in K.BATCHES.items() if k != "ash" for p in v.V)
        for k, v in K.BATCHES.items():
            if k != "ash":
                v.V = [(p[0], p[1], p[2] - mz - 0.02) for p in v.V]
    path, tris = S.finish_parts(name, tex=1024 if ASSET == "mantlet" else 512, lod1_max=600)
    if FULL:
        S.write_parts_json(ASSET, ["complete", "burnt"] if ASSET == "mantlet" else ["complete"], tris,
                           extra=dict(orientation="standing along +Z: foot at the origin, top at z = 7") if ASSET == "ladder" else None)
