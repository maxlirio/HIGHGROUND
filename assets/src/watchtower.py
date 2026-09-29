"""HIGHGROUND - watchtower.

5 x 5 m battered rubble base (3 m) carrying a braced oak tower: four raking corner posts,
two tiers of X-bracing, a mid floor, and at ~10.6 m a fighting platform cantilevered on
knee-braced joists to ~5.9 m square, walled with plank hoarding pierced by loops, under a
shingled pyramid roof. A cresset (iron fire-basket) on a bracket at the front corner,
ladders, an iron finial (team flag is added in-engine), firewood and a water barrel at the foot.

    blender -b -P assets/src/watchtower.py -- [complete|build1|build2|ruin]

Front faces -Y. 1 unit = 1 m.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector, Matrix
import _milkit as K
from _milkit import (B, Batch, box, beam, cyl, prism_hull, Face, window, grid, plinth, quoins, barrel,
                     stone_pile, rubble_heap, timber_stack, scaffold_face, cutter_obj, apply_boolean, jit, SOLIDS,
                     BATCHES, hull, ladder, log_pile)
import _lib as L

STATE = K.STATE
FULL, RUIN, B1, B2 = K.FULL, K.RUIN, K.B1, K.B2
R = K.R
R.seed(5)

S = 2.5            # half base
BASE_H = 3.0
P0 = 2.05          # post half-spacing at the base top
P1 = 1.6           # ... at the platform
MID = 6.9
FLOOR = 10.6
PH = 2.95          # platform half width
HOARD = 1.35       # hoarding height
EAVE_H = 3.3       # roof eave half width
ROOF_Z = FLOOR + HOARD + 0.55
APEX = ROOF_Z + EAVE_H * math.tan(math.radians(46))


def build_materials():
    ch = 0.9 if RUIN else 0.0
    K.MAT["rubble"] = K.m_stone("rubble", [(0.0, "#968b76"), (0.25, "#ab9f86"), (0.5, "#bcaf94"),
                                            (0.75, "#a69a82"), (1.0, "#8a8171")], "#6f675b",
                                rowh=0.34, bw=0.7, charred=ch * 0.5)
    K.MAT["ashlar"] = K.m_stone("ashlar", [(0.0, "#a89c83"), (0.4, "#b9ac91"), (0.7, "#b0a48b"),
                                            (1.0, "#9d917b")], "#9a9280", joints=False, bump=0.6, charred=ch * 0.4)
    K.MAT["oak"] = K.m_wood("oak", [(0.0, "#4e3b27"), (0.5, "#5f4830"), (1.0, "#6b5236")],
                            weather_hex="#7d7466", weathered=0.6, fresh=0.06, charred=ch)
    K.MAT["plank"] = K.m_wood("plank", [(0.0, "#7b6f5e"), (0.5, "#8c8374"), (1.0, "#978a73")],
                              weather_hex="#8f887c", weathered=0.45, fresh=0.12, charred=ch, grain_k=1.2)
    K.MAT["fresh"] = K.m_wood("fresh", [(0.0, "#b8976a"), (0.5, "#c9a877"), (1.0, "#d2b386")],
                              weather_hex="#c0a27a", weathered=0.1, grain_k=1.6)
    K.MAT["shingle"] = K.m_tiles("shingle", [(0.0, "#675b4b"), (0.5, "#7b7164"), (1.0, "#8b8071")],
                                 cell=0.16, curve=0.15, wood=True, lichen=0.6, moss=0.8, charred=ch)
    K.MAT["iron"] = K.m_simple("iron", "#35332f", "#45403a", 0.72, rust=True)
    K.MAT["dark"] = K.m_simple("dark", "#2c2621", "#3a3129", 0.9)
    K.MAT["soil"] = K.m_simple("soil", "#4a3a2a", "#5f4a35", 0.95, 1.2)
    K.MAT["rope"] = K.m_simple("rope", "#7a6746", "#8e7a55", 0.9, 12.0)
    K.MAT["ember"] = m_ember("ember")
    K.MAT["ash"] = K.m_stone("ashrubble", [(0.0, "#6e675d"), (0.5, "#8d8577"), (1.0, "#5e5850")],
                             "#4a4540", joints=False, charred=0.4)


def m_ember(name):
    """glowing coals in the cresset: dark char with hot orange cracks (albedo only, no emission)."""
    g = K.G(name)
    P = g.P
    v = g.vor(P, 14.0, "DISTANCE_TO_EDGE")
    hot = g.mx(g.inv(g.mr(v, 0.0, 0.16)), g.mr(g.noise(P, 4.0, 3), 0.55, 0.7))
    x, y, z = g.sep(P)
    col = g.ramp(g.noise(P, 6.0, 4), [(0.3, "#2e2622"), (0.7, "#4a3a30")])
    col = g.mix(hot, col, g.ramp(g.noise(P, 3.0, 3), [(0.2, "#b8461c"), (0.8, "#e0912e")]))
    return g.out(col, 0.85, g.sub(0.0, hot), 1.0, 0.02)


def post_xy(sx, sy, z):
    t = (z - BASE_H) / (FLOOR - BASE_H)
    p = P0 + (P1 - P0) * t
    return sx * p, sy * p


# =====================================================================  stone base
def stone_base(top=BASE_H, ruin=False):
    wall = Batch("basewall", "rubble")
    # slightly battered: hull of a wider foot and the top square
    pts = []
    for (h, zz) in ((S + 0.12, 0.0), (S, 1.0), (S - 0.04, top)):
        pts += [(sx * h, sy * h, zz) for sx in (-1, 1) for sy in (-1, 1)]
    wall.add(*hull(pts))
    SOLIDS.append(((-S + 0.1, -S + 0.1, 0), (S - 0.1, S - 0.1, top)))
    cut = Batch("basecut", "dark")
    ff = Face((-S, -S, 0), (0, -1, 0))
    fe = Face((S, -S, 0), (1, 0, 0))
    if top > 2.4:
        K.slit(ff, cut, S + 0.9, 1.2, h=0.9)
        K.slit(fe, cut, S - 0.4, 1.1, h=0.9)
        K.putlogs(ff, cut, [0.6, 2.4, 4.3], 2.45)
        K.putlogs(fe, cut, [0.8, 3.6], 2.45)
    if cut.F:
        apply_boolean(wall.build(), cutter_obj(cut))
    else:
        wall.build()
    ol = [(-S, -S), (S, -S), (S, S), (-S, S)]
    plinth(ol, h=0.6, proud=0.3)
    for c, a, b in (((-S, -S), (-1, 0, 0), (0, -1, 0)), ((S, -S), (0, -1, 0), (1, 0, 0)),
                    ((S, S), (1, 0, 0), (0, 1, 0)), ((-S, S), (0, 1, 0), (-1, 0, 0))):
        zt = top - (R.uniform(0.3, 1.1) if ruin else 0.0)
        quoins(c, a, b, 0.6, zt, course=0.4, la=0.6, lb=0.34)
    if top < BASE_H - 0.01:
        return
    # coping course around the head
    if not ruin:
        for f in (Face((-S, -S, 0), (0, -1, 0)), Face((S, -S, 0), (1, 0, 0)), Face((S, S, 0), (0, 1, 0)),
                  Face((-S, S, 0), (-1, 0, 0))):
            u = -0.14
            while u < 2 * S + 0.1:
                l = min(R.uniform(0.5, 0.85), 2 * S + 0.14 - u)
                f.prism_dv(B("ashlar"), [(-0.14, top - 0.04), (0.35, top - 0.04), (0.35, top + 0.14),
                                         (-0.06, top + 0.14), (-0.14, top + 0.04)], u + 0.005, u + l - 0.005)
                u += l
    else:
        for i in range(16):
            a = R.uniform(-S, S)
            side = R.choice((0, 1, 2, 3))
            x, y = [(a, -S + 0.3), (S - 0.3, a), (a, S - 0.3), (-S + 0.3, a)][side]
            box(B("rubble"), (x - 0.3, y - 0.25, top - 0.05), (x + 0.3, y + 0.25, top + R.uniform(0.1, 0.35)), 0.03,
                rot=(jit(0.1), jit(0.1), R.uniform(0, 3)))


# =====================================================================  timber tower
def tower_frame(stage="complete"):
    """stage: complete | half (build2) | burnt"""
    oak = B("oak")
    burnt = stage == "burnt"
    half = stage == "half"
    zb = BASE_H + 0.14
    # sole plates on the wall head
    for (a, b) in (((-P0 - 0.25, -P0), (P0 + 0.25, -P0)), ((-P0 - 0.25, P0), (P0 + 0.25, P0)),
                   ((-P0, -P0 - 0.25), (-P0, P0 + 0.25)), ((P0, -P0 - 0.25), (P0, P0 + 0.25))):
        beam(oak, (a[0], a[1], zb + 0.11), (b[0], b[1], zb + 0.11), 0.26, 0.22, 0.015)
    top_z = {(-1, -1): FLOOR + HOARD + 0.55, (1, -1): FLOOR + HOARD + 0.55, (1, 1): FLOOR + HOARD + 0.55,
             (-1, 1): FLOOR + HOARD + 0.55}
    if half:
        top_z = {(-1, -1): MID + 0.3, (1, -1): FLOOR - 0.1, (1, 1): FLOOR - 0.1, (-1, 1): MID + 0.3}
    if burnt:
        top_z = {(-1, -1): 6.1, (1, -1): 8.9, (1, 1): 4.6, (-1, 1): 7.4}
    for (sx, sy), zt in top_z.items():
        x0, y0 = post_xy(sx, sy, zb)
        zt2 = min(zt, FLOOR)
        x1, y1 = post_xy(sx, sy, zt2)
        tip = Vector((x1, y1, zt2)) + (Vector((x1 - x0, y1 - y0, zt2 - zb)).normalized() * (zt - zt2))
        if burnt:
            # charred posts end in a split point
            beam(oak, (x0, y0, zb), tip, 0.3, 0.3, 0.02)
            prism_hull(oak, [tuple(tip + Vector((sx * 0.14, sy * 0.14, 0))), tuple(tip + Vector((-sx * 0.14, sy * 0.14, 0))),
                             tuple(tip + Vector((sx * 0.14, -sy * 0.14, 0))),
                             tuple(tip + Vector((jit(0.1), jit(0.1), R.uniform(0.3, 0.7))))])
        else:
            beam(oak, (x0, y0, zb), tip, 0.3, 0.3, 0.02)
    # girts at MID and under the floor; X-braces per face per tier
    levels = [zb + 0.2, MID, FLOOR - 0.35]
    faces = [((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))]
    for fi, ((ax, ay), (bx, by)) in enumerate(faces):
        for li, z in enumerate(levels):
            if half and li == 2 and fi != 1:
                continue
            if burnt and (z > min(top_z[(ax, ay)], top_z[(bx, by)]) - 0.3 or (z > 5.0 and R.random() < 0.3)):
                continue
            pa = post_xy(ax, ay, z); pb = post_xy(bx, by, z)
            beam(oak, (pa[0], pa[1], z), (pb[0], pb[1], z), 0.22, 0.24, 0.015, ext=0.12)
        for ti in range(2):
            za, zc = levels[ti] + 0.12, levels[ti + 1] - 0.12
            if half and ti == 1 and fi != 1:
                continue
            for (s0, s1) in ((0, 1), (1, 0)):
                ha, hb = (top_z[(ax, ay)], top_z[(bx, by)]) if s0 == 0 else (top_z[(bx, by)], top_z[(ax, ay)])
                if burnt and (min(za, zc) > min(ha, hb) - 0.2 or (zc > 5.0 and R.random() < 0.3)):
                    continue
                pa = post_xy(ax, ay, za if s0 == 0 else zc)
                pb = post_xy(bx, by, zc if s0 == 0 else za)
                za_ = za if s0 == 0 else zc
                zb_ = zc if s0 == 0 else za
                off = Vector((ax + bx, ay + by, 0)).normalized() * (0.14 if s0 == 0 else 0.25)
                p = Vector((pa[0], pa[1], za_)) + off
                q = Vector((pb[0], pb[1], zb_)) + off
                if burnt:
                    # a brace stays whole only where both of its posts still stand; otherwise it
                    # survives as a charred stub on whichever end is still carried
                    tp, tq = top_z[(ax, ay)], top_z[(bx, by)]
                    ok_p, ok_q = p.z < tp - 0.2, q.z < tq - 0.2
                    if not (ok_p or ok_q):
                        continue
                    if not ok_p:
                        p, q = q, p
                    if not (ok_p and ok_q) or R.random() < 0.3:
                        q = p.lerp(q, R.uniform(0.3, 0.6))
                beam(oak, p, q, 0.17, 0.15, 0.012, ext=0.05)
    # mid floor: joists + planks with a ladder hatch
    if not burnt:
        pm = post_xy(1, 1, MID)[0]
        for x in grid(-pm + 0.1, pm - 0.1, 0.9):
            beam(oak, (x, -pm, MID + 0.18), (x, pm, MID + 0.18), 0.14, 0.16, 0.01)
        for y in grid(-pm, pm, 0.27, 0.0)[:-1]:
            if -0.3 < y < 0.55:
                x0 = -pm; x1 = 0.2
                beam(B("plank"), (x0, y + 0.135, MID + 0.28), (x1, y + 0.135, MID + 0.28), 0.26, 0.04, 0.006,
                     side=(0, 0, 1))
                continue
            beam(B("plank"), (-pm, y + 0.135, MID + 0.28), (pm, y + 0.135, MID + 0.28), 0.26, 0.04, 0.006,
                 side=(0, 0, 1))
    # ladders: stone base (outside, front) and inside the frame
    if stage != "burnt":
        ladder((0.9, -S - 1.05, 0.0), (0.9, -S - 0.1, BASE_H + 0.25))
        ladder((0.6, -1.0, zb + 0.2), (0.6, 0.15, MID + 0.3))
        if not half:
            ladder((0.6, 0.2, MID + 0.32), (0.6, 1.15, FLOOR + 0.1))
    else:
        ladder((0.9, -S - 1.05, 0.0), (0.9, -S - 0.1, BASE_H + 0.25))


def platform(stage="complete"):
    oak, pl = B("oak"), B("plank")
    z = FLOOR
    # cantilevered joists both ways with knee braces
    for x in grid(-PH + 0.15, PH - 0.15, 0.75):
        beam(oak, (x, -PH - 0.05, z - 0.1), (x, PH + 0.05, z - 0.1), 0.16, 0.2, 0.012)
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        px, py = post_xy(sx, sy, z - 1.4)
        for ax in ((1, 0), (0, 1)):
            end = Vector((sx * PH if ax[0] else px, sy * PH if ax[1] else py, z - 0.2))
            beam(oak, (px, py, z - 1.45), end * Vector((0.93, 0.93, 1)), 0.15, 0.15, 0.012, ext=0.05)
    for sgn in (-1, 1):
        beam(oak, (-PH - 0.05, sgn * PH, z - 0.1), (PH + 0.05, sgn * PH, z - 0.1), 0.18, 0.2, 0.012)
    # floor planks
    for y in grid(-PH, PH, 0.28, 0.0)[:-1]:
        x1 = 0.15 if 0.3 < y + 0.14 < 1.45 else PH + 0.02          # ladder hatch
        beam(pl, (-PH - 0.02, y + 0.14, z + 0.02), (x1, y + 0.14, z + 0.02), 0.27, 0.045, 0.006,
             side=(0, 0, 1))
    # hoarding: corner + intermediate posts, planked walls with loops, a lookout opening on the front
    zt = z + HOARD
    posts = []
    for t in (-1, -0.33, 0.33, 1):
        posts += [(t * PH, -PH), (t * PH, PH), (-PH, t * PH), (PH, t * PH)]
    posts = list(dict.fromkeys(posts))
    for (x, y) in posts:
        beam(oak, (x, y, z + 0.05), (x, y, ROOF_Z + 0.05), 0.18, 0.18, 0.012)
    walls = [(Vector((-PH, -PH)), Vector((PH, -PH)), Vector((0, -1))), (Vector((PH, -PH)), Vector((PH, PH)), Vector((1, 0))),
             (Vector((PH, PH)), Vector((-PH, PH)), Vector((0, 1))), (Vector((-PH, PH)), Vector((-PH, -PH)), Vector((-1, 0)))]
    for wi, (a, b, n) in enumerate(walls):
        d = (b - a).normalized()
        Ln = (b - a).length
        u = 0.0
        k = 0
        n3 = Vector((n.x, n.y, 0))
        while u < Ln - 0.02:
            w = min(R.uniform(0.22, 0.32), Ln - u)
            c = a + d * (u + w / 2)
            c3 = Vector((c.x, c.y, 0)) + n3 * 0.1
            lookout = (wi == 0 and 1.6 < u < 3.6)
            loop = (k % 6 == 3)
            side = n3
            if lookout:
                beam(pl, c3 + Vector((0, 0, z + 0.05)), c3 + Vector((0, 0, z + 0.62)), w - 0.012, 0.04, 0.0, side=side)
            elif loop:
                beam(pl, c3 + Vector((0, 0, z + 0.05)), c3 + Vector((0, 0, z + 0.55)), w - 0.012, 0.04, 0.0, side=side)
                beam(pl, c3 + Vector((0, 0, z + 1.05)), c3 + Vector((0, 0, zt + jit(0.04))), w - 0.012, 0.04, 0.0,
                     side=side)
            else:
                beam(pl, c3 + Vector((0, 0, z + 0.05)), c3 + Vector((0, 0, zt + jit(0.05))), w - 0.012, 0.04, 0.0,
                     side=side)
            u += w
            k += 1
        for zz in (z + 0.3, zt - 0.1):
            p0 = Vector((a.x, a.y, zz)) + n3 * 0.16
            p1 = Vector((b.x, b.y, zz)) + n3 * 0.16
            beam(oak, p0 - Vector((d.x, d.y, 0)) * 0.1, p1 + Vector((d.x, d.y, 0)) * 0.1, 0.12, 0.08, 0.008, side=n3)
    # propped lookout shutter over the front opening
    sx0, sx1 = -PH + 1.6, -PH + 3.6
    hz = zt + 0.02
    ang = math.radians(58)
    dd = Vector((0, -math.sin(ang), -math.cos(ang)))
    for x in grid(sx0, sx1, 0.28, 0.0)[:-1]:
        p0 = Vector((x + 0.14, -PH - 0.08, hz))
        beam(pl, p0, p0 + dd * 0.75, 0.27, 0.035, 0.006, side=Vector((0, math.cos(ang), -math.sin(ang))))
    for x in (sx0 + 0.2, sx1 - 0.2):
        beam(oak, (x, -PH - 0.1, z + 0.62), (x, -PH - 0.08 + dd.y * 0.72, hz + dd.z * 0.72), 0.05, 0.05, 0.005)
    # wall plate for the roof
    for sgn in (-1, 1):
        beam(oak, (-PH - 0.2, sgn * PH, ROOF_Z + 0.1), (PH + 0.2, sgn * PH, ROOF_Z + 0.1), 0.2, 0.2, 0.012)
        beam(oak, (sgn * PH, -PH - 0.2, ROOF_Z + 0.1), (sgn * PH, PH + 0.2, ROOF_Z + 0.1), 0.2, 0.2, 0.012)


def hip_roof(stage="complete"):
    """pyramid of shingle courses; each course is trimmed to the hip lines, hips capped with boards."""
    bt = B("shingle")
    e = EAVE_H
    ez = ROOF_Z + 0.2
    rise = APEX - ez
    Ls = math.hypot(e, rise)
    row_w, lap, thick = 0.3, 0.7, 0.03
    step = row_w * lap
    rows = int((Ls - 0.15) / step)
    for face in range(4):
        M = Matrix.Rotation(face * math.pi / 2, 4, "Z")
        dn = Vector((0, e, rise)).normalized()           # up-slope direction (from eave at y=-e)
        n = Vector((1, 0, 0)).cross(dn)
        if n.z < 0:
            n = -n
        for r in range(rows):
            s0 = r * step
            s1 = s0 + row_w
            if stage == "burnt" and (s0 > Ls * 0.3 or R.random() < 0.4):
                continue
            hw0 = e * (1 - s0 / Ls) + 0.03
            hw1 = e * (1 - min(s1, Ls) / Ls) + 0.03
            seg = max(2, int(hw0 * 2 / 0.8))
            pts, loc = [], []
            for kk in range(seg + 1):
                t = kk / seg
                wz = jit(0.01)
                sg = -0.05 * math.sin(math.pi * t) * (s0 / Ls)
                for (ss, hw, off, lyv, lift) in ((s0, hw0, 0.0, 0.0, 0.03), (s0, hw0, thick, 0.0, 0.03),
                                                 (min(s1, Ls), hw1, thick * 0.4, row_w, 0.0),
                                                 (min(s1, Ls), hw1, -thick * 0.6, row_w, 0.0)):
                    x = -hw + 2 * hw * t
                    q = Vector((0, -e, ez)) + dn * ss + Vector((x, 0, 0)) + n * (off + lift + sg + wz)
                    pts.append(tuple(M @ q))
                    loc.append((x, lyv, off))
            F = []
            for kk in range(seg):
                a = kk * 4
                b2 = a + 4
                for i in range(3):
                    j = (i + 1) % 4
                    F.append((a + i, a + j, b2 + j, b2 + i))
            F.append((0, 1, 2, 3))
            F.append((seg * 4 + 3, seg * 4 + 2, seg * 4 + 1, seg * 4))
            bt.add(pts, F, None, R.random(), loc)
    # hip boards + rafters at the eaves
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        p0 = Vector((sx * (e + 0.05), sy * (e + 0.05), ez + 0.06))
        p1 = Vector((0, 0, APEX + 0.05))
        if stage == "burnt":
            p1 = p0.lerp(p1, R.uniform(0.2, 0.5))
        for rot in (-1, 1):
            side = Vector((sx, -sy, 0)).normalized() * rot * 0.07
            beam(B("plank"), p0 + side, p1 + side, 0.16, 0.04, 0.006,
                 side=(Vector((0, 0, 1)) + Vector((sx, sy, 0)) * 0.3 + side.normalized() * 0.8).normalized())
    if stage != "burnt":
        # finial (team flag is attached in-engine)
        cyl(B("oak"), (0, 0, APEX - 0.4), (0, 0, APEX + 0.7), 0.08, 0.05, n=8)
        cyl(B("iron"), (0, 0, APEX + 0.7), (0, 0, APEX + 0.95), 0.045, 0.004, n=6)


def cresset(stage="complete"):
    """iron fire-basket on a bracket out from the front-east corner of the platform."""
    ir = B("iron")
    if stage == "burnt":
        c = Vector((3.4, -3.2, 0.25))
        for i in range(8):
            a = i / 8 * 2 * math.pi
            beam(ir, c + Vector((math.cos(a) * 0.18, math.sin(a) * 0.18, 0.0)),
                 c + Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, 0.42)) + Vector((0.3, 0, -0.1)), 0.02, 0.02, 0.0)
        beam(ir, c, c + Vector((-1.0, 0.4, 0.05)), 0.04, 0.04, 0.0)
        return
    corner = Vector((PH, -PH, 0))
    out = Vector((1, -1, 0)).normalized()
    base = corner + out * 0.12
    arm_end = corner + out * 1.35
    zc = FLOOR + HOARD + 0.05
    beam(ir, base + Vector((0, 0, zc - 0.05)), arm_end + Vector((0, 0, zc - 0.05)), 0.05, 0.05, 0.0, side=(0, 0, 1))
    beam(ir, base + Vector((0, 0, zc - 0.75)), arm_end * 0.55 + base * 0.45 + Vector((0, 0, zc - 0.07)), 0.04, 0.04, 0.0)
    c = arm_end + Vector((0, 0, zc))
    # basket: ring + staves flaring outward
    for i in range(10):
        a = i / 10 * 2 * math.pi
        p0 = c + Vector((math.cos(a) * 0.12, math.sin(a) * 0.12, -0.02))
        p1 = c + Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, 0.5))
        beam(ir, p0, p1, 0.022, 0.022, 0.0)
    for zz, rr in ((0.18, 0.2), (0.48, 0.3)):
        cyl(ir, c + Vector((0, 0, zz - 0.015)), c + Vector((0, 0, zz + 0.015)), rr + 0.012, n=12)
    cyl(ir, c + Vector((0, 0, -0.1)), c + Vector((0, 0, 0.02)), 0.02, 0.14, n=8)
    # coals + a few split logs
    pts = []
    for i in range(14):
        a = R.uniform(0, 2 * math.pi); rr = R.uniform(0.05, 0.25)
        pts.append(tuple(c + Vector((math.cos(a) * rr, math.sin(a) * rr, 0.15 + (0.3 - rr) * 1.1 + jit(0.04)))))
    pts += [tuple(c + Vector((0, 0, 0.05)))]
    prism_hull(B("ember"), pts)
    for i in range(3):
        a = i * 2.1 + jit(0.3)
        p = c + Vector((0, 0, 0.42))
        beam(B("oak"), p + Vector((math.cos(a) * 0.22, math.sin(a) * 0.22, -0.05)),
             p + Vector((-math.cos(a) * 0.12, -math.sin(a) * 0.12, 0.2)), 0.07, 0.07, 0.006)


def hoist():
    """jib out of the west hoarding with a pulley: firewood is hauled up for the cresset."""
    oak = B("oak")
    y = -1.2
    z = FLOOR + HOARD - 0.05
    beam(oak, (-PH + 0.6, y, z), (-PH - 1.25, y, z), 0.16, 0.18, 0.012)
    beam(oak, (-PH - 0.05, y, z - 1.0), (-PH - 0.8, y, z - 0.08), 0.1, 0.1, 0.01)
    c = Vector((-PH - 1.1, y, z - 0.22))
    cyl(B("oak"), c - Vector((0, 0.05, 0)), c + Vector((0, 0.05, 0)), 0.13, n=10)
    beam(B("iron"), c + Vector((0, 0.07, 0.2)), c + Vector((0, 0.07, -0.05)), 0.03, 0.02, 0.0)
    beam(B("iron"), c + Vector((0, -0.07, 0.2)), c + Vector((0, -0.07, -0.05)), 0.03, 0.02, 0.0)
    cyl(B("rope"), c + Vector((-0.13, 0, 0)), Vector((-PH - 1.23, y, 2.2)), 0.012, n=4)
    cyl(B("rope"), c + Vector((0.13, 0, 0)), Vector((-PH - 0.2, y + 0.1, FLOOR + 0.9)), 0.012, n=4)
    # a bundle of split logs on the hook, halfway up
    b = Vector((-PH - 1.23, y, 2.0))
    for i in range(5):
        a = i * 1.25
        off = Vector((math.cos(a) * 0.1, 0, math.sin(a) * 0.08))
        cyl(B("plank"), b + off + Vector((0, -0.4, -0.05)), b + off + Vector((0, 0.4, -0.05)), 0.07, n=6)
    cyl(B("rope"), b + Vector((0, -0.2, -0.2)), b + Vector((0, -0.2, 0.15)), 0.1, n=6)


def lookout_spears():
    """a few spears stood in the corner of the fighting platform, heads showing above the hoarding."""
    for i in range(4):
        b = Vector((-PH + 0.25 + i * 0.13, -PH + 0.3 + jit(0.05), FLOOR + 0.06))
        t = b + Vector((0.08 + jit(0.05), 0.12 + jit(0.04), 2.3))
        d = (t - b).normalized()
        cyl(B("plank"), b, t, 0.018, 0.016, n=5)
        side = d.cross(Vector((0, 0, 1))).normalized()
        prism_hull(B("iron"), [tuple(t), tuple(t + d * 0.34), tuple(t + d * 0.12 + side * 0.045),
                               tuple(t + d * 0.12 - side * 0.045), tuple(t + d * 0.12 + d.cross(side) * 0.012)])


def foot_props(stage="complete"):
    # firewood stack against the base (fuel for the cresset), water barrel, a bucket
    if stage != "build1":
        log_pile(-2.2, -S - 1.4, -0.2, rows=4, r=0.1, length=0.9)
        barrel((2.05, -S - 0.7, 0), 0.32, 0.9)
        cyl(B("plank"), (1.5, -S - 1.0, 0), (1.5, -S - 1.0, 0.3), 0.15, 0.17, n=10)


# =====================================================================  states
def build_complete():
    SOLIDS.append(((-PH + 0.1, -PH + 0.1, FLOOR - 0.05), (PH - 0.1, PH - 0.1, FLOOR + 0.02)))
    stone_base()
    tower_frame()
    platform()
    hip_roof()
    cresset()
    hoist()
    lookout_spears()
    foot_props()


def build1():
    rb = B("rubble")
    t = 0.9
    # runs abut rather than overlap, so no exposed faces are coplanar (they bake black)
    for (a, b, c, d) in ((-S, -S, S, -S + t), (-S, S - t, S, S), (-S, -S + t, -S + t, S - t), (S - t, -S + t, S, S - t)):
        box(rb, (a, b, 0), (c, d, R.uniform(0.6, 0.9)))
    for i in range(10):
        x = R.uniform(-S + 0.3, S - 0.3)
        y = R.choice((-S + 0.45, S - 0.45))
        box(B("ashlar"), (x - 0.28, y - 0.18, 0.85), (x + 0.28, y + 0.18, 1.08), 0.02, rot=(0, 0, R.uniform(0, 3)))
    # trench spoil: low irregular mounds along two sides
    for (p0, d, nn, L_) in (((-S - 0.5, -S - 0.7), (1, 0), (0, 1), 2 * S + 1.0), ((-S - 0.7, -S), (0, 1), (1, 0), 2 * S)):
        u = 0.0
        while u < L_ - 0.2:
            l = min(R.uniform(0.9, 1.6), L_ - u)
            pts = []
            for uu in (u, u + l):
                c = Vector((p0[0] + d[0] * uu, p0[1] + d[1] * uu, 0))
                w = R.uniform(0.28, 0.42)
                n3 = Vector((nn[0], nn[1], 0))
                pts += [tuple(c + n3 * w), tuple(c - n3 * w), tuple(c + n3 * jit(0.06) + Vector((0, 0, R.uniform(0.16, 0.28))))]
            prism_hull(B("soil"), pts)
            u += l * 0.85
    stakes = [(-S - 0.6, -S - 0.6), (S + 0.6, -S - 0.6), (S + 0.6, S + 0.6), (-S - 0.6, S + 0.6)]
    for (x, y) in stakes:
        cyl(B("plank"), (x, y, 0), (x + jit(0.04), y + jit(0.04), 0.8), 0.035, 0.02, n=5)
    for i in range(4):
        pa, pb = stakes[i], stakes[(i + 1) % 4]
        beam(B("iron"), (pa[0], pa[1], 0.66), (pb[0], pb[1], 0.66), 0.01, 0.01, 0.0)
    # the four long corner posts waiting on bearers
    for i in range(4):
        beam(B("fresh" if i % 2 else "oak"), (S + 1.3 + i * 0.34, S + 0.2, 0.34), (S + 1.3 + i * 0.34 + jit(0.1), S - 7.0, 0.34),
             0.3, 0.3, 0.015)
    for yb in (S - 0.5, S - 5.5):
        beam(B("oak"), (S + 1.0, yb, 0.09), (S + 2.8, yb, 0.09), 0.18, 0.18, 0.01)
    stone_pile(-S - 1.3, 0.8, 20, 1.2)
    barrel((-S - 0.6, -S - 1.0, 0), 0.4, 0.4)


def build2():
    stone_base()
    tower_frame("half")
    oak = B("oak")
    # shear legs lifting the next post
    for s in (-1, 1):
        beam(oak, (s * 1.0, -S - 1.6, 0), (0.0, -P0, MID + 3.2), 0.13, 0.13, 0.01)
    cyl(B("rope"), (0.0, -P0 - 0.05, MID + 3.1), (0.0, -P0 - 0.35, 3.8), 0.015, n=5)
    beam(oak, (-0.1, -P0 - 0.4, 3.4), (0.6, -P0 - 0.9, 8.6), 0.28, 0.28, 0.015)
    cyl(B("rope"), (0.0, -S - 1.6, 0.4), (0.0, -P0 - 0.05, MID + 3.1), 0.012, n=5)
    timber_stack(S + 0.7, -S + 0.3, 4.0, 2, along_x=False)
    foot_props("build2")


def build_ruin():
    stone_base(ruin=True)
    tower_frame("burnt")
    cresset("burnt")
    # the platform came down: charred joists and planks heaped around the base
    oak = B("oak")
    for i in range(14):
        a = R.uniform(0, 2 * math.pi)
        r = R.uniform(2.6, 4.2)
        x, y = math.cos(a) * r, math.sin(a) * r
        b = a + R.uniform(-1.2, 1.2)
        l = R.uniform(1.5, 3.6)
        beam(oak, (x, y, 0.15), (x + math.cos(b) * l, y + math.sin(b) * l, R.uniform(0.05, 0.9)),
             0.2 if i % 2 else 0.27, 0.2, 0.012)
    for i in range(22):
        a = R.uniform(0, 2 * math.pi)
        r = R.uniform(2.7, 4.3)
        x, y = math.cos(a) * r, math.sin(a) * r
        beam(B("plank"), (x, y, 0.05), (x + jit(1.2), y + jit(1.2), R.uniform(0.02, 0.3)), 0.27, 0.045, 0.006,
             side=(0, 0, 1))
    # a section of platform still hanging on the tall post
    beam(oak, (1.8, -1.8, 8.4), (3.2, -0.5, 6.1), 0.18, 0.2, 0.012)
    beam(oak, (1.6, -1.9, 8.2), (-0.6, -2.6, 5.4), 0.18, 0.2, 0.012)
    # burnt floor planks and ash fallen onto the wall-head
    for i in range(10):
        x, y = R.uniform(-S + 0.4, S - 0.4), R.uniform(-S + 0.4, S - 0.4)
        a = R.uniform(0, math.pi)
        beam(B("plank"), (x, y, BASE_H + 0.06), (x + math.cos(a) * 1.4, y + math.sin(a) * 1.4, BASE_H + R.uniform(0.05, 0.3)),
             0.27, 0.045, 0.006, side=(0, 0, 1))
    for i in range(9):
        x, y = R.uniform(-S + 0.5, S - 0.5), R.uniform(-S + 0.5, S - 0.5)
        r_ = R.uniform(0.25, 0.55)
        box(B("ash"), (x - r_, y - r_ * 0.7, BASE_H - 0.1), (x + r_, y + r_ * 0.7, BASE_H + R.uniform(0.08, 0.25)), 0.04,
            rot=(jit(0.1), jit(0.1), R.uniform(0, 3)))
    rubble_heap(-3.4, 1.4, 1.2, 1.4, 0.6, 14, "ash")
    rubble_heap(3.2, 2.4, 1.5, 1.0, 0.5, 12, "ash")
    rubble_heap(-0.8, -3.6, 1.2, 0.7, 0.5, 10, "rubble")
    barrel((-2.9, -3.3, 0), 0.32, 0.9, lying=True)


def main():
    build_materials()
    K.NO_CULL = ("basewall",)
    if FULL:
        build_complete()
    elif B1:
        build1()
    elif B2:
        build2()
    else:
        build_ruin()
    name = "watchtower" if FULL else "watchtower_" + STATE
    K.finalize(name, tex=1024 if not FULL else 2048, lods=(1.0, 0.4, 0.12))


main()
