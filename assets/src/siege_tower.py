"""HIGHGROUND - siege tower (belfry / "berfrey").

Reference: the belfries of the Maciejowski Bible and the Chronicles of Froissart, the Kenilworth (1266) and
Bristol accounts, Viollet-le-Duc's beffroi: a tapering timber frame of four storeys on a wheeled sill-frame,
boarded on three sides and faced with raw hides against fire, a drawbridge hinged at the floor of the third
storey (7.5 m, tops a 6 m wall) standing up to close the front, a crenellated fighting top, ladders inside the
open back. Contract: 5 x 5 m, 11 m.

Moving parts (assets/glb/siege_tower_parts.json):
  bridge         pivot = its hinge (front edge, z = 7.5), rest = closed (vertical); lower = +90 deg about +X
                 (its top swings forward to -Y and lies level)
  wheel_fl/fr/rl/rr   axle centres, roll about +X  (l = +X side, f = -Y end)

  blender -b -P assets/src/siege_tower.py -- [complete|burnt]
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, Matrix
import _siege_kit as S
import _kit_yards as K
from _kit_yards import beam, box, cyl, tube

STATE = S.state_from_argv()
S.init(STATE, seed=83)
R = K.R
jit = S.jit
FULL = STATE == "complete"
BURNT = STATE == "burnt"
assert STATE in ("complete", "burnt"), STATE

H0 = 1.0                  # floor of the ground storey (top of the sill frame)
HT = 9.6                  # fighting-top floor
B0, B1 = 2.45, 2.15       # half width at H0 / at HT
FLOORS = (H0, 3.2, 5.35, 7.5, HT)
HINGE = Vector((0.0, -(B1 + (B0 - B1) * (HT - 7.5) / (HT - H0)) - 0.1, 7.5))
BR_W, BR_L = 2.4, 3.2
WR = 0.62
WX, WY = 1.9, 1.75

wheels = {"wheel_fl": (1, -1), "wheel_fr": (-1, -1), "wheel_rl": (1, 1), "wheel_rr": (-1, 1)}
if FULL:
    for nm, (sx, sy) in wheels.items():
        S.part(nm, (sx * WX, sy * WY, WR), axis="X", rest="any (rolls)")
    S.part("bridge", HINGE, axis="X", rest="closed: standing vertical against the front", range_deg=[0, 90],
           notes="+90 about X lowers it forward (-Y) to lie level on the wall-walk; hinge at z = 7.5")

C = K.B("char") if BURNT else None
oak = C or K.B("oak")
oak2 = C or K.B("oak2")
plank = C or K.B("plank")
hide = K.B("hide")
iron, rope = K.B("iron"), K.B("rope")


def half(z):
    return B0 + (B1 - B0) * (z - H0) / (HT - H0)


def fpt(face, u, z, off=0.0):
    """point on a face. face: 'f' (-Y), 'b' (+Y), 'l' (+X), 'r' (-X); u in -1..1 across it."""
    h = half(z) + off
    if face == "f":
        return Vector((u * h, -h, z))
    if face == "b":
        return Vector((-u * h, h, z))
    if face == "l":
        return Vector((h, u * h, z))
    return Vector((-h, -u * h, z))


def sill_frame():
    for sx in (-1, 1):
        beam(oak, (sx * 2.2, -2.75, 0.85), (sx * 2.2, 2.75, 0.85), 0.32, 0.34, 0.02)
    for sy in (-1, 1):
        beam(oak, (-2.7, sy * 2.2, 0.85), (2.7, sy * 2.2, 0.85), 0.32, 0.34, 0.02, side=(0, 0, 1))
    beam(oak, (-2.5, 0.0, 0.85), (2.5, 0.0, 0.85), 0.26, 0.3, 0.0, side=(0, 0, 1))
    for sy in (-1, 1):                        # axle trees + bearing blocks
        beam(oak2, (-WX - 0.1, sy * WY, WR), (WX + 0.1, sy * WY, WR), 0.2, 0.22, 0.0)
        for sx in (-1, 1):
            box(oak2, (sx * 2.2 - 0.16, sy * WY - 0.14, WR + 0.1), (sx * 2.2 + 0.16, sy * WY + 0.14, 0.7), 0.0)
    # rear handspike sockets / pushing bars
    for sx in (-1, 1):
        beam(oak2, (sx * 1.2, 2.3, 0.9), (sx * 1.3, 3.1, 1.15), 0.12, 0.12, 0.0)


def frame(broken=False):
    # corner posts (tapering) + mid posts on the sides
    for sx in (-1, 1):
        for sy in (-1, 1):
            top = HT + 1.8 if not broken else R.uniform(5.8, 9.8)
            beam(oak, (sx * B0, sy * B0, H0 - 0.15), (sx * (B0 + (B1 - B0) * (top - H0) / (HT - H0)), sy * (B0 + (B1 - B0) * (top - H0) / (HT - H0)), top),
                 0.3, 0.3, 0.02)
    for fl in FLOORS[1:]:
        if broken and fl == HT:
            continue
        h = half(fl)
        for sy in (-1, 1):
            beam(oak, (-h - 0.1, sy * h, fl - 0.15), (h + 0.1, sy * h, fl - 0.15), 0.24, 0.26, 0.0, side=(0, 0, 1))
        for sx in (-1, 1):
            beam(oak, (sx * h, -h - 0.1, fl - 0.15), (sx * h, h + 0.1, fl - 0.15), 0.24, 0.26, 0.0, side=(0, 0, 1))
        # floor boards
        n = 9
        for i in range(n):
            y0 = -h + 2 * h * i / n + 0.01
            y1 = -h + 2 * h * (i + 1) / n - 0.01
            if (fl != HT and i == n - 2) or (broken and R.random() < 0.4):
                continue                      # ladder hatch
            box(plank, (-h + 0.05, y0, fl - 0.02), (h - 0.05, y1, fl + 0.03), 0.0, rot=(0, jit(0.01), 0))
    # ladders between floors at the back
    for a, b in zip(FLOORS[:-1], FLOORS[1:]):
        if broken and a > 5:
            continue
        h0, h1 = half(a), half(b)
        yl = 2 * h1 / 9 * 3.5
        K.ladder((0.6, yl + 0.9, a + 0.03), (0.6, yl + 0.1, b + 0.02), w=0.5, bt=oak2)


def cladding(broken=False):
    """vertical boards on the front and both sides in two lifts, hides over the front and upper sides."""
    for face in ("f", "l", "r"):
        nb = 14
        um = 1 - 0.15 / B1
        for i in range(nb):
            u0 = -um + 2 * um * i / nb + 0.005
            u1 = -um + 2 * um * (i + 1) / nb - 0.005
            for (z0, z1) in ((H0 - 0.2, 5.35), (5.35, HT + 1.35)):
                if face == "f" and z0 > 5 and abs((u0 + u1) / 2) < 0.62:
                    z1b = 7.4                 # the bridge port above
                    if z1b <= z0:
                        continue
                    z1 = z1b
                if face != "f" and z0 > 5 and i in (3, 11):
                    continue                  # loopholes / light
                if broken and (z0 > 5 and R.random() < 0.8 or R.random() < 0.3):
                    continue
                if broken and z0 > 5:
                    z1 = min(z1, R.uniform(6.0, 8.5))
                zz1 = z1 + jit(0.03)
                pts = [fpt(face, u0, z0, -0.02), fpt(face, u1, z0, -0.02), fpt(face, u0, zz1, -0.02), fpt(face, u1, zz1, -0.02),
                       fpt(face, u0, z0, 0.02), fpt(face, u1, z0, 0.02), fpt(face, u0, zz1, 0.02), fpt(face, u1, zz1, 0.02)]
                P, F = K.hull(pts)
                (oak2 if R.random() < 0.6 else plank).add(P, F, None, None, [(p[0] + p[1], 0.0, p[2]) for p in P])
        if face != "f" and not broken:
            # side arrow-slit framing + a battened loophole shutter
            for i, zz in ((3, 6.4), (11, 6.4)):
                u = -1 + 2 * (i + 0.5) / nb
                box(oak, fpt(face, u, zz - 0.8, 0.04) - Vector((0.12, 0.12, 0)), fpt(face, u, zz - 0.72, 0.04) + Vector((0.12, 0.12, 0)), 0.0)
    # battens (horizontal rails outside the boards)
    for face in ("f", "l", "r"):
        for z in (2.0, 4.3, 6.4, 8.6, 10.6):
            if broken and z > 6:
                continue
            if face == "f" and 7.0 < z < 10.0:
                for s_ in (-1, 1):
                    a = fpt(face, s_ * 0.93, z, 0.07); b = fpt(face, s_ * 0.63, z, 0.07)
                    beam(oak2, a, b, 0.12, 0.08, 0.0, side=(0, 0, 1))
                continue
            beam(oak, fpt(face, -0.93, z, 0.07), fpt(face, 0.93, z, 0.07), 0.12, 0.08, 0.0, side=(0, 0, 1))
    if broken:
        return
    # hides: the whole front below the port and the upper sides (fire comes from the wall)
    for (face, rows, ulim) in (("f", ((H0, 3.1), (2.9, 5.2), (5.0, 7.45)), 1.0), ("l", ((5.2, 7.6), (7.4, 9.9)), 1.0),
                               ("r", ((5.2, 7.6), (7.4, 9.9)), 1.0)):
        for ri, (z0, z1) in enumerate(rows):
            nb = 3
            for j in range(nb):
                u0 = -ulim + 2 * ulim * j / nb - 0.06 + jit(0.03)
                u1 = u0 + 2 * ulim / nb + 0.12
                if face == "f" and z0 > 4.9 and abs((u0 + u1) / 2) < 0.4:
                    continue
                if face == "f" and z0 > 4.9:
                    u0, u1 = (max(u0, 0.64), u1) if u0 > 0 else (u0, min(u1, -0.64))
                off = 0.19 + ri * 0.03 + (j % 2) * 0.015
                o = fpt(face, u0, z0 + jit(0.05), off)
                uu = fpt(face, u1, z0 + jit(0.05), off) - o
                vv = fpt(face, u0, z1, off) - o
                S.hide_panel(hide, o, uu, vv, nu=4, nv=4, bulge=0.02, ragged=0.12, pegs=2)


def fighting_top(broken=False):
    """boarded breastwork to 1.1 m over the top floor with three merlons a side (crenels between)."""
    z0, z1, zm = HT + 0.05, HT + 1.1, HT + 1.75
    um = 1 - 0.15 / B1
    for face in ("f", "l", "r", "b"):
        nb = 12
        for i in range(nb):
            if broken and R.random() < 0.65:
                continue
            u0 = -um + 2 * um * i / nb + 0.005
            u1 = -um + 2 * um * (i + 1) / nb - 0.005
            um_ = (u0 + u1) / 2
            top = zm if int((um_ + um) / (2 * um) * 5) % 2 == 0 else z1
            top += jit(0.03)
            pts = [fpt(face, u, z, o) for u in (u0, u1) for z in (z0, top) for o in (-0.02, 0.02)]
            P, F = K.hull(pts)
            (oak2 if R.random() < 0.6 else plank).add(P, F, None, None, [(p[0] + p[1], 0, p[2]) for p in P])
        if not broken:
            beam(oak, fpt(face, -0.93, z1 - 0.1, 0.07), fpt(face, 0.93, z1 - 0.1, 0.07), 0.12, 0.08, 0.0, side=(0, 0, 1))


def team_shields():
    """painted pavises hung on the parapet (team colour)."""
    for u in (-0.75, 0.75):
        c = fpt("f", u, HT + 0.55, 0.16)
        grid = []
        for i in range(4):
            row = []
            for j in range(3):
                x = (j / 2 - 0.5) * 0.62
                z = (i / 3 - 0.5) * 1.0
                row.append(c + Vector((x, -0.03 * math.cos(x * 4), z)))
            grid.append(row)
        S.sheet(K.B("team"), grid, 0.03)


def bridge_geo(bp, bo, bi, M=None):
    """closed (vertical) drawbridge: planks from the hinge up, ledges behind, iron hooks at the top."""
    def T(p):
        return (M @ Vector(p)) if M else Vector(p)
    y = HINGE.y
    nb = 8
    for i in range(nb):
        x0 = -BR_W / 2 + BR_W * i / nb + 0.006
        x1 = -BR_W / 2 + BR_W * (i + 1) / nb - 0.006
        pts = [T((x, y + yy, z)) for x in (x0, x1) for yy in (-0.06, 0.0) for z in (HINGE.z + 0.02, HINGE.z + BR_L + jit(0.03))]
        P, F = K.hull(pts); bp.add(P, F, None, None, [(p[0], 0, p[2]) for p in pts])
    for sx in (-1, 1):
        a, b = T((sx * (BR_W / 2 - 0.1), y + 0.08, HINGE.z)), T((sx * (BR_W / 2 - 0.1), y + 0.08, HINGE.z + BR_L))
        beam(bo, a, b, 0.14, 0.14, 0.0)
    for z in (0.6, 1.7, 2.8):
        beam(bo, T((-BR_W / 2 + 0.05, y + 0.07, HINGE.z + z)), T((BR_W / 2 - 0.05, y + 0.07, HINGE.z + z)), 0.12, 0.1, 0.0,
             side=(0, 0, 1))
    # hides on the outside of the bridge (it takes the fire arrows while closed)
    S.hide_panel(S.P("bridge", "hide") if FULL else hide, T((-BR_W / 2 + 0.2, y - 0.08, HINGE.z + 0.35)),
                 (T((BR_W / 2 - 0.35, y - 0.08, HINGE.z + 0.35)) - T((-BR_W / 2 + 0.2, y - 0.08, HINGE.z + 0.35))),
                 (T((-BR_W / 2 + 0.2, y - 0.08, HINGE.z + 1.9)) - T((-BR_W / 2 + 0.2, y - 0.08, HINGE.z + 0.35))),
                 nu=4, nv=3, bulge=-0.02, ragged=0.1, pegs=0)
    # iron-bound front edge and studs on the bare upper boards
    beam(bi, T((-BR_W / 2, y - 0.07, HINGE.z + BR_L - 0.08)), T((BR_W / 2, y - 0.07, HINGE.z + BR_L - 0.08)), 0.1, 0.02, 0.0,
         side=(0, 1, 0))
    for k in range(6):
        x = -BR_W / 2 + 0.2 + k * (BR_W - 0.4) / 5
        for z in (2.3, 2.75):
            box(bi, T((x - 0.025, y - 0.075, HINGE.z + z - 0.025)), T((x + 0.025, y - 0.06, HINGE.z + z + 0.025)), 0.0)
    # hinge straps + the iron hooks that bite the wall-walk
    for sx in (-1, 1):
        box(bi, T((sx * 0.8 - 0.04, y - 0.09, HINGE.z)), T((sx * 0.8 + 0.04, y + 0.02, HINGE.z + 0.9)), 0.0)
        tube(bi, [T((sx * 0.9, y - 0.02, HINGE.z + BR_L - 0.1)), T((sx * 0.9, y - 0.02, HINGE.z + BR_L + 0.2)),
                  T((sx * 0.9, y - 0.22, HINGE.z + BR_L + 0.3)), T((sx * 0.9, y - 0.3, HINGE.z + BR_L + 0.18))],
             [0.03, 0.03, 0.022, 0.012], 5)
    cyl(bi, T((-BR_W / 2 - 0.1, y + 0.02, HINGE.z)), T((BR_W / 2 + 0.1, y + 0.02, HINGE.z)), 0.05, n=6)


if FULL:
    sill_frame()
    for nm, (sx, sy) in wheels.items():
        S.wheel(nm, (sx * WX, sy * WY, WR), WR, 0.24, kind="disc", side=sx)
    frame(); cladding(); fighting_top(); team_shields()
    # hinge brackets on the tower
    for sx in (-1, 1):
        box(iron, (sx * 1.3 - 0.06, HINGE.y + 0.02, HINGE.z - 0.25), (sx * 1.3 + 0.06, HINGE.y + 0.22, HINGE.z + 0.08), 0.0)
    bridge_geo(S.P("bridge", "plank"), S.P("bridge", "oak2"), S.P("bridge", "iron"))
else:
    sill_frame()
    for nm, (sx, sy) in wheels.items():
        if (sx, sy) == (1, -1):
            continue
        S.wheel("body", (sx * WX, sy * WY, WR), WR, 0.24, kind="disc", side=sx)
    frame(broken=True); cladding(broken=True)
    # the bridge fell forward, charred, onto the ground in front
    M = Matrix.Translation((0.3, -1.2, -7.35)) @ Matrix.Translation(HINGE) @ Matrix.Rotation(math.radians(96), 4, "X") @ \
        Matrix.Translation(-HINGE)
    bridge_geo(plank, oak, iron, M=M)
    for i in range(14):
        a = Vector((R.uniform(-2.6, 2.6), R.uniform(-3.0, 2.6), R.uniform(0.9, 1.3)))
        b = a + Vector((jit(2.0), jit(2.0), R.uniform(-0.8, 0.8)))
        beam(oak, a, b, 0.2, 0.2, 0.0)
    K.mound(K.B("ash"), 0.0, 0.0, 3.0, 3.2, 0.15, rings=4, seg=16, rough=0.35)

if __name__ == "__main__":
    name = "siege_tower" if FULL else "siege_tower_" + STATE
    if BURNT:
        # the whole wreck leans on its burnt-out front-left wheel
        Mt = Matrix.Rotation(math.radians(3.5), 4, "Y") @ Matrix.Rotation(math.radians(2.5), 4, "X")
        for k, v in K.BATCHES.items():
            if k != "ash":
                v.V = [tuple(Mt @ Vector(p)) for p in v.V]
    path, tris = S.finish_parts(name, tex=1024)
    if FULL:
        S.write_parts_json("siege_tower", ["complete", "burnt"], tris,
                           extra=dict(bridge_hinge_z=7.5, bridge_length=BR_L,
                                      wheel_naming="f = -Y end, l = +X side"))
