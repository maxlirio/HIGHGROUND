"""HIGHGROUND - mangonel (traction trebuchet, the "petraria" of the 12th-13th c.).

Reference: the traction engines of the Maciejowski Bible (c.1250) and the Morgan/Crusader bibles, Chevedden's
reconstructions: a pyramidal trestle of four raking legs on a sledge frame, a pole-bundle arm (spars lashed
together with rope woolding) pivoting on an axle at the apex, a rope hub at the short end from which the crew's
pulling ropes hang (each with a hand toggle), a sling at the long end, the arm resting cocked on a padded
crutch at the back. Contract: 3 x 4 m, axle 3.5 m, arm 7 m (5:1).

Moving parts (assets/glb/mangonel_parts.json):
  arm    pivot = axle, rotates about +X: 0 = cocked (long end down at the rear on its crutch), ~+110 = release
  ropes  child of arm at the rope hub (optional for the renderer): keep plumb with local rotation.x = -(arm angle)
  sling  child of arm at the tip: hide during the throw like the trebuchet's

  blender -b -P assets/src/mangonel.py -- [complete|burnt]
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _siege_kit as S
import _kit_yards as K
from _kit_yards import beam, box, cyl, tube

STATE = S.state_from_argv()
S.init(STATE, seed=53)
R = K.R
jit = S.jit
FULL = STATE == "complete"
BURNT = STATE == "burnt"
assert STATE in ("complete", "burnt"), STATE

AX = Vector((0.0, -0.15, 3.5))
L_LONG, L_SHORT = 5.83, 1.17
PHI = math.asin((AX.z - 0.28) / L_LONG)          # long end down, sling end at the ground behind
U = Vector((0.0, math.cos(PHI), -math.sin(PHI)))
W = Vector((1, 0, 0)).cross(U).normalized()
TIP = AX + U * L_LONG
HUB = AX - U * L_SHORT
HX, Y0, Y1 = 1.3, -1.95, 1.95

if FULL:
    S.part("arm", AX, axis="X", rest="cocked: long end down to the rear (+Y) on its crutch", range_deg=[0, 115],
           notes="positive = crew haul the short end down, long end whips up and over to -Y; release ~ +100..+115")
    S.part("ropes", HUB, parent="arm", axis="X", rest="hanging plumb from the rope hub",
           notes="optional: keep plumb with local rotation.x = -(arm angle); ignored = they swing with the arm")
    S.part("sling", TIP, parent="arm", axis="X", rest="lying on the ground behind the engine")

C = K.B("char") if BURNT else None
oak = C or K.B("oak")
oak2 = C or K.B("oak2")
plank = C or K.B("plank")
iron, rope, tar = K.B("iron"), K.B("rope"), K.B("tar")


def sledge():
    for sx in (-1, 1):
        x = sx * HX
        # runner with an upturned, iron-shod nose so it can be dragged
        tube(oak, [Vector((x, Y1, 0.15)), Vector((x, Y0 + 0.5, 0.15)), Vector((x, Y0 - 0.05, 0.3)), Vector((x, Y0 - 0.3, 0.55))],
             [0.17, 0.17, 0.15, 0.12], 4)
        box(iron, (x - 0.14, Y0 - 0.1, 0.18), (x + 0.14, Y0 + 0.4, 0.2), 0.0, rot=(-0.4, 0, 0))
    for y in (Y0 + 0.35, -0.15, Y1 - 0.25):
        beam(oak, (-HX - 0.3, y, 0.36), (HX + 0.3, y + jit(0.02), 0.36), 0.24, 0.24, 0.015, side=(0, 0, 1))
        for sx in (-1, 1):
            cyl(oak2, (sx * (HX + 0.18), y, 0.4), (sx * (HX + 0.18), y, 0.6), 0.03, n=5)
    # a plank deck under the crew between the front legs
    for i in range(6):
        x0 = -1.05 + i * 0.35
        box(plank, (x0 + 0.01, Y0 + 0.2, 0.48), (x0 + 0.34, -0.6, 0.53), 0.0, rot=(0, 0, jit(0.01)))
    # tow ring on the front sill
    tube(iron, [Vector((0.0, Y0 + 0.2, 0.3)), Vector((0.0, Y0 - 0.02, 0.2)), Vector((0.0, Y0 + 0.2, 0.1))], 0.025, 5)


def tower(collapse=False):
    apex = []
    for sx in (-1, 1):
        head = Vector((sx * 0.46, AX.y, AX.z - 0.3))
        apex.append(head)
        for sy in (-1, 1):
            foot = Vector((sx * (HX - 0.05), (Y0 + 0.35) if sy < 0 else (Y1 - 0.25), 0.48))
            if collapse and sx > 0:
                d = (head - foot)
                head2 = foot + Vector((0.9 * sx + 0.3, 0.2, -0.3)) + d.normalized() * 0.2
                beam(oak, foot, foot + (Vector((2.4, jit(0.5), 0.35)) if sy < 0 else Vector((2.3, 0.6, 0.1))), 0.22, 0.22, 0.0)
                continue
            beam(oak, foot, head + Vector((0, sy * 0.12, 0)), 0.24, 0.22, 0.015)
        # head block (bearing) + iron cap
        if not (collapse and sx > 0):
            box(oak2, head - Vector((0.18, 0.32, 0.12)), head + Vector((0.18, 0.32, 0.26)), 0.015)
            box(iron, head + Vector((-0.2, -0.2, 0.24)), head + Vector((0.2, 0.2, 0.27)), 0.0)
            for sy in (-1, 1):
                box(iron, head + Vector((-0.2, sy * 0.2 - 0.012, -0.2)), head + Vector((0.2, sy * 0.2 + 0.012, 0.27)), 0.0)
    # side ties + cross ties between the legs
    for sx in (-1, 1):
        if collapse and sx > 0:
            continue
        for (z, k) in ((1.35, 0.7), (2.4, 0.38)):
            xa = sx * (HX - 0.05 - (HX - 0.51) * (z - 0.48) / (AX.z - 0.78))
            ya = (Y0 + 0.35) + ((AX.y - 0.12) - (Y0 + 0.35)) * (z - 0.48) / (AX.z - 0.78)
            yb = (Y1 - 0.25) + ((AX.y + 0.12) - (Y1 - 0.25)) * (z - 0.48) / (AX.z - 0.78)
            beam(oak2, (xa, ya, z), (xa, yb, z), 0.16, 0.18, 0.0)
            for yy in (ya, yb):
                box(iron, (xa - 0.13, yy - 0.13, z - 0.03), (xa + 0.13, yy + 0.13, z + 0.03), 0.0)
    if not collapse:
        for sy, yy in ((1, Y1 - 0.25),):          # no front tie: the pulling ropes hang there
            z = 1.35
            t = (z - 0.48) / (AX.z - 0.78)
            y = yy + ((AX.y + sy * 0.12) - yy) * t
            xa = HX - 0.05 - (HX - 0.51) * t
            beam(oak2, (-xa, y, z + 0.18), (xa, y, z + 0.18), 0.16, 0.18, 0.0, side=(0, 0, 1))
    # the crutch the cocked arm rests on (padded with a sack of straw)
    yc = Y1 - 0.25
    zc = AX.z - (yc - AX.y) * math.tan(PHI) - 0.2
    for sx in (-1, 1):
        beam(oak2, (sx * 0.34, yc, 0.48), (sx * 0.3, yc, zc + 0.1), 0.14, 0.14, 0.0)
    beam(oak2, (-0.45, yc, zc), (0.45, yc, zc), 0.14, 0.14, 0.0, side=(0, 0, 1))
    if not collapse:
        tube(K.B("hide"), [Vector((-0.28, yc, zc + 0.08)), Vector((0.0, yc + 0.02, zc + 0.12)), Vector((0.28, yc, zc + 0.08))],
             0.09, 6)


def arm_geo(bo, bi, br, M=None):
    def T(p):
        return (M @ Vector(p)) if M else Vector(p)
    # pole bundle: a main spar and two lighter spars lashed along it (composite traction arm)
    for (dx, dz, r0, r1, t0, t1) in ((0.0, 0.0, 0.17, 0.09, -L_SHORT - 0.1, L_LONG + 0.05),
                                    (0.14, 0.1, 0.1, 0.06, -L_SHORT + 0.1, L_LONG * 0.62),
                                    (-0.14, 0.1, 0.1, 0.06, -L_SHORT + 0.1, L_LONG * 0.55)):
        a = AX + U * t0 + Vector((dx, 0, 0)) + W * dz
        b = AX + U * t1 + Vector((dx, 0, 0)) + W * dz
        cyl(bo, T(a), T(b), r0, r1, n=7)
    for t in (-0.8, -0.3, 0.4, 1.1, 1.8, 2.5, 3.1):
        c = AX + U * t + W * 0.04
        rr = 0.26 - max(0, t) * 0.02
        ring = [T(c + Vector((math.cos(2 * math.pi * k / 7) * rr, 0, 0)) + W * (math.sin(2 * math.pi * k / 7) * rr * 0.8))
                for k in range(7)]
        tube(br, ring + [ring[0]], 0.03, 4, caps=False)
    cyl(bo, T(AX + Vector((-0.72, 0, 0))), T(AX + Vector((0.72, 0, 0))), 0.1, n=8)
    for sx in (-1, 1):
        cyl(bi, T(AX + Vector((sx * 0.64, 0, 0))), T(AX + Vector((sx * 0.7, 0, 0))), 0.115, n=8)
    # rope hub: a cross-bar through the short end
    cyl(bo, T(HUB + Vector((-0.75, 0, 0))), T(HUB + Vector((0.75, 0, 0))), 0.07, n=6)
    for sx in (-1, 1):
        cyl(bi, T(HUB + Vector((sx * 0.72, 0, 0))), T(HUB + Vector((sx * 0.76, 0, 0))), 0.085, n=6)
    # iron tip with the sling prong
    cyl(bi, T(TIP - U * 0.35), T(TIP + U * 0.06), 0.095, 0.08, n=7)
    tube(bi, [T(TIP + U * 0.05), T(TIP + U * 0.22 + W * 0.05), T(TIP + U * 0.3 + W * 0.16)], [0.03, 0.022, 0.014], 5)


def ropes_geo(br, bw):
    """16 pulling ropes hanging from the hub bar, toggles at the ends, some slack on the ground."""
    n = 16
    for i in range(n):
        x = -0.66 + 1.32 * i / (n - 1)
        top = HUB + Vector((x, 0, -0.05))
        lz = R.uniform(0.62, 1.4) if R.random() < 0.7 else 0.58
        mid = Vector((top.x + jit(0.05), top.y + jit(0.08), (top.z + lz) / 2))
        end = Vector((top.x * 1.25 + jit(0.12), top.y - 0.25 + jit(0.3), lz))
        pts = [top, mid, end]
        if lz < 0.6:
            pts.append(Vector((end.x + jit(0.3), end.y - R.uniform(0.2, 0.5), 0.56)))
        S.rope(br, pts, 0.016, 4)
        e = pts[-1]
        cyl(bw, e + Vector((-0.1, 0, 0)), e + Vector((0.1, 0, 0)), 0.02, n=4)


def sling_geo(br, bh, bs):
    pouch = TIP + Vector((0.0, 1.35, 0.0))
    pouch.z = 0.12
    for sx in (-1, 1):
        a = TIP + (U * 0.25 + W * 0.12 if sx > 0 else -U * 0.1 - W * 0.1)
        S.rope(br, [a, Vector((sx * 0.14, (a.y + pouch.y) / 2, 0.08)), pouch + Vector((sx * 0.2, -0.1, 0.03))], 0.014, 4)
    grid = []
    for i in range(3):
        row = []
        for j in range(5):
            a = math.pi * j / 4
            row.append(Vector((pouch.x + math.cos(a) * 0.2, pouch.y - 0.18 + 0.36 * i / 2, 0.03 + (1 - math.sin(a)) * 0.08)))
        grid.append(row)
    S.sheet(bh, grid, 0.015)
    S.stone_ball(bs, pouch + Vector((0, 0, 0.1)), 0.1, 0.1)


def stones(cx, cy):
    st = K.B("stone")
    for i in range(14):
        a = R.uniform(0, 6.28); rr = 0.45 * math.sqrt(R.random())
        S.stone_ball(st, (cx + math.cos(a) * rr, cy + math.sin(a) * rr, 0.1 + (0.45 - rr) * 0.3), R.uniform(0.08, 0.12), 0.15)


if FULL:
    sledge(); tower()
    arm_geo(S.P("arm", "oak"), S.P("arm", "iron"), S.P("arm", "rope"))
    ropes_geo(S.P("ropes", "rope"), S.P("ropes", "oak2"))
    sling_geo(S.P("sling", "rope"), S.P("sling", "hide"), S.P("sling", "stone"))
    stones(1.9, 0.6)
    # wicker baskets of shot for the loader, and a spare coil
    for (bx_, by_) in ((-1.9, 1.2), (-2.05, 0.55)):
        K.basket(bx_, by_, r=0.26, h=0.38)
        for i in range(5):
            S.stone_ball(K.B("stone"), (bx_ + jit(0.12), by_ + jit(0.12), 0.38 + R.uniform(0.0, 0.06)), 0.09, 0.15)
    S.coil(rope, (1.95, -1.3, 0.0), 0.3, 0.02, 4)
    # rope lashings where the legs cross the ties
    for sx in (-1, 1):
        for (y, z) in ((-1.05, 1.35), (0.72, 1.35)):
            xa = sx * (HX - 0.05 - (HX - 0.51) * (z - 0.48) / (AX.z - 0.78))
            ring = [Vector((xa + math.cos(2 * math.pi * k / 6) * 0.17, y, z + math.sin(2 * math.pi * k / 6) * 0.17)) for k in range(6)]
            tube(rope, ring + [ring[0]], 0.025, 4, caps=False)
else:
    sledge(); tower(collapse=True)
    Mfall = Matrix.Translation((1.2, 0.2, -AX.z + 0.3)) @ Matrix.Rotation(-0.35, 4, "Z") @ \
        Matrix.Translation(AX) @ Matrix.Rotation(PHI, 4, "X") @ Matrix.Translation(-AX)
    arm_geo(oak, iron, rope, M=Mfall)
    K.mound(K.B("ash"), 0.3, 0.0, 1.8, 2.3, 0.1, rings=4, seg=14, rough=0.3)
    stones(1.9, 0.6)

if __name__ == "__main__":
    name = "mangonel" if FULL else "mangonel_" + STATE
    path, tris = S.finish_parts(name, tex=1024)
    if FULL:
        S.write_parts_json("mangonel", ["complete", "burnt"], tris, extra=dict(pose_cocked_deg=0, pose_release_deg=110))
