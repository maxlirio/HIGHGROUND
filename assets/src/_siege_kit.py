"""HIGHGROUND - shared kit for the siege engines + siege workshop.

Built on _kit_yards (same node materials / Batch / beam / tube techniques as the approved town_hall),
plus what engines need: MOVING PARTS. Every batch belongs to a part ("body" or a named moving part);
finish_parts() bakes the whole engine to ONE texture set, then splits it back into separate nodes:

    body_LOD0, body_LOD1             static body, origin at the asset origin (ground centre)
    <part>                           one mesh object per moving part, origin at its pivot,
                                     parented to its parent part (docs/siege-art-contract.md)

and writes assets/glb/<name>_parts.json with every pivot/axis/range (see docs/siege-art-contract.md).

    import _siege_kit as S
    S.init(state, seed)                 # engine states: complete | assembling1 | assembling2 | burnt
    S.part("arm", pivot=(0, 0, 6), axis="X", rest="cocked", range_deg=(0, 140), notes="...")
    bt = S.P("arm", "oak")              # batch for part "arm" with material "oak"
    ... K.beam(bt, ...) ...
    S.finish_parts("trebuchet", tex=2048)
"""
import sys, os, math, random, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector, Matrix
import _lib as L
import _kit_yards as K
from _kit_yards import G, srgb, beam, box, cyl, tube, lathe, mound, hull, cleft, TRS

ENGINE_STATES = ("complete", "assembling_1", "assembling_2", "packed", "burnt")
BUILDING_STATES = ("complete", "build1", "build2", "ruin")

STATE = "complete"
PARTS = {}          # name -> dict(pivot, parent, axis, ...)
POSE = {}           # name -> Matrix applied to that part's geometry about its pivot before bake
STATIC = False      # True: every part is merged into the body (assembling / burnt states)
R = K.R


def state_from_argv(default="complete"):
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return os.environ.get("HG_STATE") or (argv[0] if argv else default)


def init(state, seed=11, building=False):
    global STATE, STATIC
    ok = BUILDING_STATES if building else ENGINE_STATES
    assert state in ok, (state, ok)
    STATE = state
    kstate = {"burnt": "ruin", "assembling_1": "build1", "assembling_2": "build2", "packed": "build1"}.get(state, state)
    K.init(kstate, seed)
    L.ground_origin = lambda objs: None      # authored centred: all states share one pivot
    PARTS.clear(); POSE.clear()
    STATIC = building or state != "complete"
    materials(char=(1.0 if state in ("burnt", "ruin") else 0.0))


def jit(a):
    return R.uniform(-a, a)


# =====================================================================  materials
def m_hide(name, wet=0.5, charred=0.0):
    """rawhide / ox-hide cladding: each hide its own colour (rnd) from tan to near-black-brown, mottled with
    patches of hair, wrinkles, darker wet areas, pale dried edges."""
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    base = g.ramp(rnd, [(0.0, "#3e2f24"), (0.3, "#5a4432"), (0.55, "#6f5840"), (0.8, "#86705a"), (1.0, "#9a8a78")])
    mott = g.noise(g.add(P, g.comb(g.mul(rnd, 31.0), 0.0, 0.0)), 1.1, 4, 0.6)
    col = g.mix(0.55, base, mott, "OVERLAY")
    # piebald patches on some hides
    pie = g.mr(g.noise(g.add(P, g.comb(0.0, g.mul(rnd, 23.0), 0.0)), 1.4, 3, 0.5), 0.56, 0.6)
    col = g.mix(g.mul(pie, g.gt(g.white(g.comb(g.mul(rnd, 7.0), 1.0, 0.0)), 0.55)), col,
                g.ramp(g.white(g.comb(g.mul(rnd, 5.0), 2.0, 0.0)), [(0.45, "#2e241d"), (0.55, "#b4a38a")]))
    hair = g.noise(g.vmul(P, (1.0, 1.0, 3.0)), 45.0, 5, 0.7, 0.6)
    col = g.mix(0.4, col, hair, "OVERLAY")
    wr = g.noise(P, 6.0, 5, 0.65, 1.5)
    col = g.mix(0.3, col, wr, "OVERLAY")
    fine = g.noise(P, 25.0, 6, 0.6)
    col = g.mix(0.25, col, fine, "OVERLAY")
    wetm = g.mul(g.mr(g.noise(P, 0.6, 4), 0.42, 0.62), wet)
    col = g.mix(wetm, col, g.mix(1.0, col, (0.6, 0.57, 0.55, 1), "MULTIPLY"))
    x, y, z = g.sep(P)
    col, md, mb = g.ground_grime(col, z, 1.0, 0.2, 0.35)
    if charred > 0:
        ch = g.mul(g.mr(g.noise(P, 0.7, 3), 0.25, 0.5), charred)
        col = g.mix(ch, col, g.mix(0.5, "#241f1b", fine, "OVERLAY"))
    rough = g.sub(0.84, g.mul(wetm, 0.3))
    height = g.add(g.mul(wr, 0.7), g.add(g.mul(hair, 0.35), g.mul(fine, 0.3)))
    return g.out(col, rough, height, 1.0, 0.01)


def m_rope(name, charred=0.0):
    """laid hemp rope: strands spiral along the tube (tube loc = (ox, oy, arclength))."""
    g = G(name)
    P = g.P
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    lx, ly, lz = g.sep(loc)
    ang = g.math("ARCTAN2", ly, lx)
    tw = g.math("SINE", g.add(g.mul(ang, 3.0), g.mul(lz, 60.0)))
    strand = g.mr(tw, -0.6, 0.9)
    col = g.ramp(g.add(g.mul(g.noise(P, 1.5, 3), 0.7), g.mul(rnd, 0.3)),
                 [(0.2, "#6a5a40"), (0.55, "#80704f"), (0.85, "#978660")])
    col = g.mix(g.mul(g.inv(strand), 0.6), col, g.mix(1.0, col, (0.45, 0.42, 0.38, 1), "MULTIPLY"))
    fz = g.noise(P, 90.0, 3, 0.7)
    col = g.mix(0.3, col, fz, "OVERLAY")
    x, y, z = g.sep(P)
    col, md, mb = g.ground_grime(col, z, 1.0, 0.1, 0.12)
    if charred > 0:
        col = g.mix(g.mul(g.mr(g.noise(P, 1.0, 3), 0.25, 0.5), charred), col, "#26211d")
    return g.out(col, 0.92, g.add(strand, g.mul(fz, 0.3)), 1.0, 0.004)


def m_tar(name):
    """pitch-blackened / tallowed timber & iron fittings seen on engines: very dark, slightly greasy."""
    g = G(name)
    P = g.P
    col = g.ramp(g.noise(P, 2.0, 4), [(0.3, "#2c2723"), (0.7, "#3b342d")])
    fine = g.noise(P, 40.0, 5)
    col = g.mix(0.3, col, fine, "OVERLAY")
    return g.out(col, 0.6, fine, 0.4, 0.003)


def m_team(name, charred=0.0):
    """team-tinted cloth / paint: baked as a light, dirty neutral so the renderer's tint multiplies onto it.
    Faces using it are exported with a second material '<asset>_team' (same atlas)."""
    g = G(name)
    P = g.P
    weave = g.noise(P, 70.0, 3, 0.6)
    col = g.ramp(g.noise(P, 1.2, 3), [(0.3, "#cfc6b4"), (0.7, "#e2dbcb")])
    col = g.mix(0.3, col, weave, "OVERLAY")
    dirt = g.mr(g.noise(P, 2.5, 4), 0.55, 0.75)
    col = g.mix(g.mul(dirt, 0.45), col, "#8f8574")
    if charred > 0:
        col = g.mix(g.mul(g.mr(g.noise(P, 1.0, 3), 0.2, 0.5), charred), col, "#2a2521")
    return g.out(col, 0.9, weave, 0.5, 0.004)


def materials(char=0.0):
    K.std_materials(char)
    M = K.MAT
    M["hide"] = m_hide("hide", 0.55, charred=char)
    M["rope"] = m_rope("rope", charred=char)
    # engine timbers: oak frame, darker pitched/greasy oak at axle bearings
    M["oak2"] = K.m_wood("oak2", [(0.0, "#56422c"), (0.5, "#654d33"), (1.0, "#735a3d")],
                         weather_hex="#817868", weathered=0.35, fresh=0.12, charred=char)
    M["stone"] = K.m_stone("stone", [(0.0, "#a39880"), (0.4, "#b8ad96"), (0.7, "#aea38b"), (1.0, "#958b78")],
                           "#8d8574", joints=False, bump=0.9, charred=char * 0.4)
    M["tar"] = m_tar("tar")
    M["turf"] = K.m_turf("turf", charred=char * 0.6)
    M["team"] = m_team("team", charred=char)
    M["wicker"] = K.m_wicker("wicker")


# =====================================================================  parts
def part(name, pivot, parent=None, axis="X", **meta):
    PARTS[name] = dict(pivot=tuple(pivot), parent=parent, axis=axis, **meta)


def pose(name, M):
    """world-space transform applied to part `name` (and its children) before bake: used by the
    static states to show a part in some other attitude (e.g. a burnt arm dropped to the ground)."""
    POSE[name] = M


def rot_about(pivot, axis, deg):
    pv = Vector(pivot)
    return Matrix.Translation(pv) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-pv)


def P(partname, matname):
    """geometry batch for a part/material pair."""
    if partname in (None, "body"):
        return K.B(matname)
    return K.B(f"{partname}~{matname}", matname)


def _chain(p):
    out = []
    while p:
        out.append(p)
        p = PARTS[p]["parent"] if p in PARTS else None
    return out


# =====================================================================  engine geometry helpers
def disc_x(bt, c, r, t, n=16, rnd=None):
    """flat cylinder whose axis is X (wheel/drum), centred at c, thickness t."""
    pts = []
    for sx in (-t / 2, t / 2):
        for k in range(n):
            a = 2 * math.pi * k / n
            pts.append((c[0] + sx, c[1] + math.cos(a) * r, c[2] + math.sin(a) * r))
    Pp, F = hull(pts)
    loc = [(p[1] - c[1], p[2] - c[2], p[0] - c[0]) for p in Pp]
    bt.add(Pp, F, None, rnd, loc)


def ring_x(bt, c, r_in, r_out, t, n=20, rnd=None):
    """annulus about X (iron tyre / hub hoop)."""
    pts, F = [], []
    for k in range(n):
        a = 2 * math.pi * k / n
        ca, sa = math.cos(a), math.sin(a)
        for (rr, sx) in ((r_in, -t / 2), (r_out, -t / 2), (r_out, t / 2), (r_in, t / 2)):
            pts.append((c[0] + sx, c[1] + ca * rr, c[2] + sa * rr))
    for k in range(n):
        a, b = k * 4, ((k + 1) % n) * 4
        for i in range(4):
            j = (i + 1) % 4
            F.append((a + i, b + i, b + j, a + j))
    bt.add(pts, F, None, rnd)


def wheel(partname, c, r, width=0.22, kind="disc", side=1, spokes=8):
    """medieval engine wheel with axis along X at c (world). kind 'disc' = boarded, cleated solid wheel
    (sows, belfries); 'spoked' = hub, spokes, felloes. side = +1 right / -1 left (the outer face)."""
    c = Vector(c)
    wood = P(partname, "oak2"); iron = P(partname, "iron"); dark = P(partname, "tar")
    if kind == "plain":
        # cheap solid wheel for wheels hidden under a shed: one thick disc + a tyre band
        disc_x(wood, c, r * 0.97, width, 10)
        ring_x(iron, c, r * 0.95, r + 0.015, width * 1.04, 10)
        disc_x(dark, c + Vector((side * width * 0.6, 0, 0)), r * 0.18, width * 0.5, 8)
        return
    if kind == "disc":
        # 3-4 boards laid vertically, each clipped to the circle, with seams
        nb = 4
        for i in range(nb):
            y0 = -r + 2 * r * i / nb + 0.006
            y1 = -r + 2 * r * (i + 1) / nb - 0.006
            pts = []
            for k in range(6):
                yy = y0 + (y1 - y0) * k / 5
                zz = math.sqrt(max(r * r - yy * yy, 0.0)) * 0.995
                for sx in (-width / 2, width / 2):
                    pts.append((c.x + sx, c.y + yy, c.z + zz)); pts.append((c.x + sx, c.y + yy, c.z - zz))
            Pp, F = hull(pts)
            wood.add(Pp, F, None, None, [(p[1] - c.y, p[0] - c.x, p[2] - c.z) for p in Pp])
        # two battens (cleats) across the boards on the outer face
        for dz in (-r * 0.42, r * 0.42):
            hw = math.sqrt(r * r - dz * dz) * 0.9
            x0 = c.x + side * width / 2
            box(wood, (min(x0, x0 + side * 0.06), c.y - hw, c.z + dz - 0.06),
                (max(x0, x0 + side * 0.06), c.y + hw, c.z + dz + 0.06), 0.0)
        # iron strakes nailed round the rim (segments, not a hoop)
        ns = 6
        for k in range(ns):
            a0 = 2 * math.pi * k / ns + 0.04; a1 = 2 * math.pi * (k + 1) / ns - 0.04
            pts = []
            for a in (a0, (a0 + a1) / 2, a1):
                for rr in (r - 0.01, r + 0.022):
                    for sx in (-width * 0.52, width * 0.52):
                        pts.append((c.x + sx, c.y + math.cos(a) * rr, c.z + math.sin(a) * rr))
            iron.add(pts, [(0, 1, 3, 2), (4, 5, 7, 6), (8, 9, 11, 10), (0, 2, 6, 4), (2, 3, 7, 6), (1, 3, 7, 5),
                           (0, 1, 5, 4), (4, 6, 10, 8), (6, 7, 11, 10), (5, 7, 11, 9), (4, 5, 9, 8)])
    else:
        # felloes: segmented rim of curved blocks
        nf = spokes // 2
        for k in range(nf):
            a0 = 2 * math.pi * k / nf + 0.01; a1 = 2 * math.pi * (k + 1) / nf - 0.01
            pts = []
            for j in range(5):
                a = a0 + (a1 - a0) * j / 4
                if j in (1, 3):
                    a = a0 + (a1 - a0) * (0.25 if j == 1 else 0.75)
                for rr in (r - 0.11, r):
                    for sx in (-width / 2, width / 2):
                        pts.append((c.x + sx, c.y + math.cos(a) * rr, c.z + math.sin(a) * rr))
            F = []
            for j in range(4):
                b0, b1 = j * 4, (j + 1) * 4
                F += [(b0, b1, b1 + 1, b0 + 1), (b0 + 2, b0 + 3, b1 + 3, b1 + 2),
                      (b0, b0 + 2, b1 + 2, b1), (b0 + 1, b1 + 1, b1 + 3, b0 + 3)]
            F += [(0, 1, 3, 2), (16, 18, 19, 17)]
            wood.add(pts, F, None, None)
        for k in range(spokes):
            a = 2 * math.pi * k / spokes + 0.2
            d = Vector((0, math.cos(a), math.sin(a)))
            beam(wood, c + d * 0.12, c + d * (r - 0.08), 0.07, 0.05, 0.01, side=Vector((1, 0, 0)))
        ring_x(iron, c, r - 0.004, r + 0.02, width * 1.02, 14)
    # hub (nave) with iron hoops + linch-pin end
    lathe_x(wood, c, [(0.0, -width * 0.9), (r * 0.16, -width * 0.9), (r * 0.2, -width * 0.4),
                      (r * 0.2, width * 0.4), (r * 0.16, width * 0.9), (0.0, width * 0.9)], 8)
    for sx in (-width * 0.75, width * 0.75):
        ring_x(iron, c + Vector((sx, 0, 0)), r * 0.16, r * 0.185, 0.035, 8)
    disc_x(dark, c + Vector((side * width * 0.95, 0, 0)), r * 0.07, 0.06, 6)


def lathe_x(bt, c, prof, seg=12):
    """solid of revolution about the X axis (prof = [(r, x), ...])."""
    c = Vector(c)
    pts, F, rings = [], [], []
    for (rr, xx) in prof:
        if rr <= 1e-4:
            rings.append([len(pts)]); pts.append((c.x + xx, c.y, c.z)); continue
        idx = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            idx.append(len(pts)); pts.append((c.x + xx, c.y + math.cos(a) * rr, c.z + math.sin(a) * rr))
        rings.append(idx)
    for a, b in zip(rings[:-1], rings[1:]):
        if len(a) == 1:
            for j in range(seg): F.append((a[0], b[j], b[(j + 1) % seg]))
        elif len(b) == 1:
            for j in range(seg): F.append((a[(j + 1) % seg], a[j], b[0]))
        else:
            for j in range(seg):
                jn = (j + 1) % seg
                F.append((a[j], b[j], b[jn], a[jn]))
    bt.add(pts, F, None, None, [(p[1] - c.y, p[2] - c.z, p[0] - c.x) for p in pts])


def rope(bt, pts, r=0.018, sides=5, sag=0.0, n=0):
    """rope through pts; sag>0 with 2 points: catenary-ish droop subdivided into n pieces."""
    pts = [Vector(p) for p in pts]
    if sag and len(pts) == 2:
        a, b = pts
        n = n or max(4, int((b - a).length / 0.4))
        pts = [a.lerp(b, i / n) - Vector((0, 0, sag * 4 * (i / n) * (1 - i / n))) for i in range(n + 1)]
    tube(bt, pts, r, sides)


def coil(bt, c, r=0.35, rr=0.02, turns=6, h=0.12):
    """a coil of rope lying on the ground/beam."""
    c = Vector(c)
    pts = []
    n = turns * 12
    for i in range(n + 1):
        t = i / n
        a = t * turns * 2 * math.pi
        rad = r * (0.55 + 0.45 * ((i % 12) / 12 * 0 + (1 - t)))
        rad = r * (1.0 - 0.45 * t) + 0.01 * math.sin(a * 3)
        pts.append(c + Vector((math.cos(a) * rad, math.sin(a) * rad, rr + h * (0.5 + 0.5 * math.sin(t * 17)) * 0.3)))
    tube(bt, pts, rr, 5)


def stone_ball(bt, c, r, rough=0.08):
    """dressed stone shot: roughly spherical, tool-faceted."""
    c = Vector(c)
    pts = []
    n = 34
    ga = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        zz = 1 - 2 * (i + 0.5) / n
        rad = math.sqrt(1 - zz * zz)
        a = ga * i
        rr = r * (1 + R.uniform(-rough, rough * 0.4))
        pts.append(c + Vector((math.cos(a) * rad * rr, math.sin(a) * rad * rr, zz * rr * 0.94)))
    Pp, F = hull(pts)
    bt.add(Pp, F, None, None)


def iron_band(bt, p0, p1, w, d, at, width=0.06, t=0.012):
    """strap of iron wrapped around a beam p0->p1 (cross-section w x d) at fraction `at`."""
    p0, p1 = Vector(p0), Vector(p1)
    q = p0.lerp(p1, at)
    a = (p1 - p0).normalized()
    beam(bt, q - a * width / 2, q + a * width / 2, w + 2 * t, d + 2 * t, 0.004)


def sheet(bt, grid, thick=0.012, rnd=None):
    """solid thin sheet (hide, canvas) from a rows x cols grid of world points; normal from winding."""
    rows, cols = len(grid), len(grid[0])
    top = [Vector(p) for row in grid for p in row]
    nrm = []
    for i in range(rows):
        for j in range(cols):
            a = grid[min(i + 1, rows - 1)][j]; b = grid[max(i - 1, 0)][j]
            c = grid[i][min(j + 1, cols - 1)]; d = grid[i][max(j - 1, 0)]
            n = (Vector(c) - Vector(d)).cross(Vector(a) - Vector(b))
            nrm.append(n.normalized() if n.length > 1e-9 else Vector((0, 0, 1)))
    pts = [tuple(p) for p in top] + [tuple(p - n * thick) for p, n in zip(top, nrm)]
    off = rows * cols
    F = []
    for i in range(rows - 1):
        for j in range(cols - 1):
            a, b, c, d = i * cols + j, i * cols + j + 1, (i + 1) * cols + j + 1, (i + 1) * cols + j
            F.append((a, b, c, d)); F.append((d + off, c + off, b + off, a + off))
    # rim
    ring = [j for j in range(cols)] + [i * cols + cols - 1 for i in range(1, rows)] + \
           [(rows - 1) * cols + j for j in range(cols - 2, -1, -1)] + [i * cols for i in range(rows - 2, 0, -1)]
    for k in range(len(ring)):
        a, b = ring[k], ring[(k + 1) % len(ring)]
        F.append((b, a, a + off, b + off))
    loc = [(p[0], p[1], p[2]) for p in pts]
    bt.add(pts, F, None, rnd, loc)


def hide_panel(bt, o, u, v, nu=6, nv=5, bulge=0.04, ragged=0.08, thick=0.012, pegs=2):
    """one hide pegged over a surface: o = corner, u/v = edge vectors (world); normal = u x v.
    Irregular outline (legs/neck stubs), belly sag between the pegs."""
    o, u, v = Vector(o), Vector(u), Vector(v)
    n = u.cross(v).normalized()
    grid = []
    for i in range(nv + 1):
        row = []
        for j in range(nu + 1):
            s, t = j / nu, i / nv
            edge = (i in (0, nv)) or (j in (0, nu))
            e = Vector((0, 0, 0))
            if edge:
                e = (u.normalized() * jit(ragged) + v.normalized() * jit(ragged))
            b = bulge * math.sin(math.pi * s) * math.sin(math.pi * t) * R.uniform(0.3, 1.1)
            row.append(o + u * s + v * t + e + n * (b + jit(0.006) + (0.0 if edge else 0.01)))
        grid.append(row)
    sheet(bt, grid, thick)
    # wooden pegs / nails at the corners + mid-edges
    for (s, t) in ((0.05, 0.95), (0.95, 0.95), (0.5, 0.97), (0.05, 0.05), (0.95, 0.05), (0.5, 0.03))[:pegs]:
        q = o + u * s + v * t + n * 0.012
        box(K.B("iron") if bt.name.find("~") < 0 else P(bt.name.split("~")[0], "iron"),
            q - Vector((0.018, 0.018, 0.018)), q + Vector((0.018, 0.018, 0.018)))


# =====================================================================  finish (bake once, split parts)
def _build_all():
    objs = []
    for k, v in list(K.BATCHES.items()):
        if k.startswith("_"):
            continue
        ob = v.build()
        if ob is None:
            continue
        pn = k.split("~")[0] if "~" in k else "body"
        if pn != "body" and pn not in PARTS:
            raise KeyError("batch for undeclared part " + pn)
        # static poses: part + all its ancestors' poses (outermost last)
        M = Matrix.Identity(4)
        if pn != "body":
            for a in _chain(pn):
                if a in POSE:
                    M = POSE[a] @ M
        if M != Matrix.Identity(4):
            ob.data.transform(M)
        if STATIC:
            pn = "body"
        ob["hg_part"] = pn
        objs.append(ob)
    return objs


def finish_parts(name, tex=1024, lod1_max=1450, ao=0.85, smooth_angle=40, body_name="body"):
    """contract naming: static body = '<body>_LOD0' + '<body>_LOD1' (decimated to <= lod1_max tris);
    each moving part = ONE mesh object named exactly <part>, origin at its pivot, parented to its parent part.
    Faces made with material 'team' get a second material '<name>_team' on the same atlas."""
    os.makedirs(L.GLB_DIR, exist_ok=True); os.makedirs(L.TEX_DIR, exist_ok=True)
    sc = bpy.context.scene
    objs = _build_all()
    K.cleanup_bottoms()
    names = ["body"] + [p for p in PARTS if not STATIC]
    stats = {}
    for o in objs:
        pid = names.index(o["hg_part"])
        me = o.data
        a = me.attributes.new("hg_pid", "INT", "FACE")
        a.data.foreach_set("value", [pid] * len(me.polygons))
        is_team = 1 if (me.materials and me.materials[0].name.startswith("team")) else 0
        a = me.attributes.new("hg_team", "INT", "FACE")
        a.data.foreach_set("value", [is_team] * len(me.polygons))
        t = sum(len(p.vertices) - 2 for p in me.polygons)
        k = o["hg_part"] + ":" + (me.materials[0].name if me.materials else "?")
        stats[k] = stats.get(k, 0) + t
    tot = 0
    for k, t in sorted(stats.items(), key=lambda x: -x[1]):
        print("HG_STAT %-22s tris %6d" % (k, t)); tot += t
    print("HG_TRIS_PRE", tot)
    if os.environ.get("HG_DRY"):
        return

    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = name + "_ALL"

    uv = body.data.uv_layers.new(name="bake")
    body.data.uv_layers.active = uv
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=1.0)
    bpy.ops.uv.pack_islands(margin=3.0 / tex, margin_method="FRACTION", shape_method="CONVEX")
    bpy.ops.object.mode_set(mode="OBJECT")

    imgs = {k: bpy.data.images.new(f"{name}_{k}", tex, tex, alpha=False) for k in ("col", "rough", "nrm", "ao")}
    imgs["nrm"].colorspace_settings.name = "Non-Color"
    imgs["rough"].colorspace_settings.name = "Non-Color"
    bpy.ops.object.select_all(action="DESELECT"); body.select_set(True)
    bpy.context.view_layer.objects.active = body
    sc.cycles.samples = 16
    L._bake(body, imgs["col"], "DIFFUSE", pass_filter={"COLOR"})
    L._bake(body, imgs["rough"], "ROUGHNESS")
    L._bake(body, imgs["nrm"], "NORMAL")
    sc.cycles.samples = 64
    L._bake(body, imgs["ao"], "AO")
    import array
    c = array.array("f", [0.0]) * (tex * tex * 4); imgs["col"].pixels.foreach_get(c)
    a = array.array("f", [0.0]) * (tex * tex * 4); imgs["ao"].pixels.foreach_get(a)
    for i in range(0, len(c), 4):
        f = 1.0 - ao + ao * a[i]
        c[i] *= f; c[i + 1] *= f; c[i + 2] *= f
    imgs["col"].pixels.foreach_set(c)
    for k in ("col", "rough", "nrm"):
        p = os.path.join(L.TEX_DIR, f"{name}_{k}.png")
        imgs[k].filepath_raw = p; imgs[k].file_format = "PNG"; imgs[k].save()

    m, n, l, b = L.mat(name + "_baked")
    tc = n.new("ShaderNodeTexImage"); tc.image = imgs["col"]
    tr = n.new("ShaderNodeTexImage"); tr.image = imgs["rough"]
    tn = n.new("ShaderNodeTexImage"); tn.image = imgs["nrm"]
    nm = n.new("ShaderNodeNormalMap"); nm.uv_map = "bake"
    uvn = n.new("ShaderNodeUVMap"); uvn.uv_map = "bake"
    for t in (tc, tr, tn): l.new(uvn.outputs["UV"], t.inputs["Vector"])
    l.new(tc.outputs["Color"], b.inputs["Base Color"])
    l.new(tr.outputs["Color"], b.inputs["Roughness"])
    l.new(tn.outputs["Color"], nm.inputs["Color"])
    l.new(nm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Metallic"].default_value = 0.0
    body.data.materials.clear(); body.data.materials.append(m)
    for u in list(body.data.uv_layers):
        if u.name != "bake": body.data.uv_layers.remove(u)
    bpy.ops.object.select_all(action="DESELECT"); body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))

    # team material: same textures, separate material so the renderer can find + tint it
    tm = m.copy(); tm.name = name + "_team"
    body.data.materials.append(tm)
    tl = body.data.attributes.get("hg_team")
    tv = [0] * len(body.data.polygons)
    if tl:
        tl.data.foreach_get("value", tv)
    body.data.polygons.foreach_set("material_index", [1 if t else 0 for t in tv])

    # ---- split back into parts
    export, objs_by = [], {}
    total = {}
    for pid, pn in enumerate(names):
        me = body.data.copy()
        bm = bmesh.new(); bm.from_mesh(me)
        lay = bm.faces.layers.int.get("hg_pid")
        kill = [f for f in bm.faces if f[lay] != pid]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        if not bm.faces:
            bm.free(); bpy.data.meshes.remove(me); continue
        pv = Vector(PARTS[pn]["pivot"]) if pn != "body" else Vector((0, 0, 0))
        bmesh.ops.translate(bm, verts=bm.verts, vec=-pv)
        bm.to_mesh(me); bm.free()
        for an in ("hg_pid", "hg_team", "hg_loc", "hg_rnd"):
            if an in me.attributes:
                me.attributes.remove(me.attributes[an])
        if not any(p.material_index == 1 for p in me.polygons):
            me.materials.pop(index=1)
        total[pn] = sum(len(p.vertices) - 2 for p in me.polygons)
        if pn == "body":
            ob0 = bpy.data.objects.new(body_name + "_LOD0", me); sc.collection.objects.link(ob0)
            d = ob0.copy(); d.data = me.copy(); d.name = body_name + "_LOD1"
            sc.collection.objects.link(d)
            mod = d.modifiers.new("dec", "DECIMATE"); mod.ratio = min(1.0, lod1_max / max(1, total[pn]))
            L.apply_all(d)
            total["body_LOD1"] = sum(len(p.vertices) - 2 for p in d.data.polygons)
            export += [ob0, d]
        else:
            me.name = pn
            ob = bpy.data.objects.new(pn, me); sc.collection.objects.link(ob)
            objs_by[pn] = (ob, pv)
            export.append(ob)
    for pn, (ob, pv) in objs_by.items():
        par = PARTS[pn]["parent"]
        if par and par in objs_by:
            ob.parent = objs_by[par][0]
            ob.location = pv - objs_by[par][1]
        else:
            ob.location = pv
    bpy.data.objects.remove(body, do_unlink=True)

    bpy.ops.object.select_all(action="DESELECT")
    for o in export: o.select_set(True)
    path = os.path.join(L.GLB_DIR, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_apply=True,
                              export_image_format="JPEG", export_jpeg_quality=90)
    tris = sum(v for k, v in total.items() if k != "body_LOD1")
    print(f"HG_EXPORT {path} LOD0_tris={tris} parts={json.dumps(total)}")
    return path, total


def write_parts_json(name, states, tris, extra=None):
    """sidecar documenting every moving part. Blender Z-up; glTF/three is Y-up: (x, y, z) -> (x, z, -y)."""
    parts = {}
    for pn, d in PARTS.items():
        pv = d["pivot"]
        par = d["parent"]
        ppv = PARTS[par]["pivot"] if par else (0, 0, 0)
        rel = [round(pv[i] - ppv[i], 4) for i in range(3)]
        dd = {k: v for k, v in d.items() if k not in ("pivot",)}
        dd.update(node=pn,
                  pivot_blender=[round(x, 4) for x in pv],
                  pivot_gltf=[round(pv[0], 4), round(pv[2], 4), round(-pv[1], 4)],
                  local_offset_gltf=[rel[0], rel[2], -rel[1]])
        parts[pn] = dd
    doc = dict(asset=name, glb=f"assets/glb/{name}.glb", units="metres", ground="z=0 (blender) / y=0 (glTF)",
               front="-Y blender / +Z glTF", body_meshes=["body_LOD0", "body_LOD1"],
               states={s: f"assets/glb/{name}{'' if s == 'complete' else '_' + s}.glb" for s in states},
               static_states="every non-complete state is a single static body (no part nodes)",
               lod0_tris=tris, parts=parts)
    if extra:
        doc.update(extra)
    p = os.path.join(L.GLB_DIR, f"{name}_parts.json")
    with open(p, "w") as f:
        json.dump(doc, f, indent=2)
    print("HG_PARTS", p)


# =====================================================================  transport
def wagon(cx, cy, length=4.4, width=1.7, wheel_r=0.55, stakes=True):
    """four-wheeled timber wain (bed along Y, draught pole toward -Y): the 'packed' engine rides on these.
    Returns the bed top z."""
    oak, pl, ir = K.B("oak"), K.B("plank"), K.B("iron")
    zb = wheel_r + 0.12
    hy, hx = length / 2, width / 2
    for sx in (-1, 1):
        beam(oak, (cx + sx * hx, cy - hy, zb), (cx + sx * hx, cy + hy, zb), 0.16, 0.2, 0.012)
    nb = int(length / 0.34)
    for i in range(nb):
        y0 = cy - hy + length * i / nb + 0.006
        box(pl, (cx - hx - 0.05, y0, zb + 0.1), (cx + hx + 0.05, y0 + length / nb - 0.012, zb + 0.15), 0.0,
            rot=(0, 0, jit(0.01)))
    for yy in (cy - hy + 0.7, cy + hy - 0.7):
        beam(oak, (cx - hx - 0.12, yy, wheel_r), (cx + hx + 0.12, yy, wheel_r), 0.14, 0.14, 0.01)   # axle-tree
        box(oak, (cx - hx + 0.2, yy - 0.12, wheel_r + 0.06), (cx + hx - 0.2, yy + 0.12, zb - 0.08))   # bolster
        for sx in (-1, 1):
            wheel("body", (cx + sx * (hx + 0.2), yy, wheel_r), wheel_r, 0.12, kind="spoked", side=sx, spokes=6)
    if stakes:
        for sx in (-1, 1):
            for k in range(4):
                y = cy - hy + 0.35 + (length - 0.7) * k / 3
                beam(K.B("oak2"), (cx + sx * (hx + 0.02), y, zb + 0.05), (cx + sx * (hx + 0.1), y + jit(0.03), zb + 1.0), 0.08, 0.08, 0.008)
    # draught pole + swingletree
    beam(oak, (cx, cy - hy + 0.4, zb - 0.05), (cx, cy - hy - 2.1, 0.62), 0.14, 0.14, 0.012)
    beam(oak, (cx - 0.55, cy - hy - 1.95, 0.64), (cx + 0.55, cy - hy - 1.95, 0.64), 0.09, 0.09, 0.008)
    return zb + 0.15
