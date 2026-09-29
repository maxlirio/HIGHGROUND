"""Damage helpers shared by curtain and tower pieces: impact pocks, cracks, breaches, rubble mounds."""
import math, random
import bpy, bmesh
from mathutils import Vector, noise
import _castle as L


def pock(objs, impacts, face_test, inward):
    """Dent the outer face: impacts = [(x, y, z, R, D)] (centre on the face, radius, depth).
    face_test(co, normal) -> True for vertices of the outer face. inward(co) -> unit vector into the wall."""
    for o in objs:
        me = o.data
        bm = bmesh.new(); bm.from_mesh(me)
        bm.normal_update()
        for v in bm.verts:
            if not face_test(v.co, v.normal):
                continue
            for (x, y, z, R, D) in impacts:
                d = (v.co - Vector((x, y, z))).length
                if d < R * 1.15:
                    rr = d / R
                    jag = 1 + 0.35 * noise.noise(v.co * 4.0 + Vector((x, y, z)))
                    dep = D * max(0.0, 1 - rr * rr) ** 1.3 * jag
                    if dep > 0:
                        v.co += inward(v.co) * dep
        bm.to_mesh(me); bm.free()


def crack_cutter(path, width0, width1, y_face, depth, inward_y=1, key="rubble", seed=1):
    """A thin jagged slot along a polyline path [(x,z)...] on a face at y=y_face (normal along -inward_y)."""
    rng = random.Random(seed)
    n = len(path)
    left, right = [], []
    for i, (x, z) in enumerate(path):
        t = i / max(1, n - 1)
        w = width0 + (width1 - width0) * t
        # direction
        a = Vector(path[max(0, i - 1)]); b = Vector(path[min(n - 1, i + 1)])
        d = (b - a).normalized(); nn = Vector((-d.y, d.x))
        j = rng.uniform(-0.3, 0.3) * w
        left.append(Vector((x, z)) + nn * (w / 2 + j)); right.append(Vector((x, z)) - nn * (w / 2 - j))
    poly = [(p.x, p.y) for p in left] + [(p.x, p.y) for p in reversed(right)]
    s = L.Solid("crack")
    s.extrude(poly, (0, y_face, 0), (1, 0, 0), (0, 0, 1), (0, inward_y, 0), -0.3, depth, key)
    return s.to_object(recalc=True, weld=True)


def jagged_path(p0, p1, rng, steps=10, amp=0.25):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = p0[0] + (p1[0] - p0[0]) * t + (rng.uniform(-amp, amp) if 0 < i < steps else 0)
        z = p0[1] + (p1[1] - p0[1]) * t
        pts.append((x, z))
    return pts


def breach_profile(x_top, z_top, x_bot, z_bot, rng, course=(0.3, 0.6)):
    """Stair-stepped V gap (masonry breaks along its courses). Returns CCW polygon (x,z) of the void,
    extended above z_top so it clears the parapet."""
    def side(sign):
        pts = []; z = z_top + 3.0; x = sign * x_top
        pts.append((x, z)); z = z_top
        pts.append((x, z))
        while z > z_bot:
            dz = rng.uniform(*course)
            znew = max(z_bot, z - dz)
            # step inward toward the gap axis
            frac = (z_top - znew) / (z_top - z_bot)
            xt = sign * (x_top + (x_bot - x_top) * frac)
            x_next = xt + sign * rng.uniform(-0.2, 0.25)
            if abs(x_next - x) < 0.04:
                x_next = x + sign * 0.06
            if sign * x_next < 0.3:
                x_next = sign * 0.3
            pts.append((x, znew)); pts.append((x_next, znew))
            x = x_next; z = znew
        return pts
    L_ = side(-1); R_ = side(1)
    # down the left side, across the bottom, up the right side: CCW in (x, z)
    poly = L_ + list(reversed(R_))
    clean = []
    for p in poly:
        if not clean or abs(p[0] - clean[-1][0]) + abs(p[1] - clean[-1][1]) > 1e-4:
            clean.append(p)
    return clean, L_, R_


def pock_cutter(c, inward, R, depth, rng, key="rubble"):
    """A shattered-facing hole: an irregular flattened hull pushed into the face at c."""
    iw = Vector(inward).normalized(); side = Vector((-iw.y, iw.x, 0)).normalized(); up = Vector((0, 0, 1))
    bm = bmesh.new()
    for i in range(22):
        a = rng.uniform(0, 2 * math.pi); r = R * rng.uniform(0.55, 1.0)
        d = rng.uniform(-0.4, 1.0) * depth
        p = Vector(c) + side * (math.cos(a) * r) + up * (math.sin(a) * r * rng.uniform(0.6, 0.9)) + iw * d
        bm.verts.new(p)
    for i in range(4):
        bm.verts.new(Vector(c) - iw * 0.4 + side * rng.uniform(-R, R) * 0.5 + up * rng.uniform(-R, R) * 0.4)
    res = bmesh.ops.convex_hull(bm, input=bm.verts)
    for g in res.get("geom_interior", []) + res.get("geom_unused", []):
        if isinstance(g, bmesh.types.BMVert) and g.is_valid:
            bm.verts.remove(g)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("pock"); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new("pock", me); bpy.context.scene.collection.objects.link(o)
    me.materials.append(L.material(key))
    return o


def mound_height(crest, slope_out, slope_in, extra=(), seed=1, lump=0.25):
    """Rubble heightfield: crest = [(x0, x1, y, h0, h1)] a ridge segment along x at y with heights h0..h1;
    extra = [(x, y, h, slope)] conical heaps. Returns f(x, y)."""
    off = Vector((seed * 3.3, seed * 1.7, 0.5))

    def f(x, y):
        best = -9.0
        for (x0, x1, yc, h0, h1) in crest:
            t = max(0.0, min(1.0, (x - x0) / (x1 - x0)))
            cx = x0 + (x1 - x0) * t
            h = h0 + (h1 - h0) * t
            dx = x - cx; dy = y - yc
            s = slope_out if dy < 0 else slope_in
            d = math.hypot(dx * 1.25, dy)
            best = max(best, h - d * s)
        for (ex, ey, eh, es) in extra:
            best = max(best, eh - math.hypot(x - ex, y - ey) * es)
        n = noise.noise(Vector((x * 0.9, y * 0.9, 0)) + off) * lump + noise.noise(Vector((x * 2.7, y * 2.7, 1)) + off) * lump * 0.4
        return best + n * min(1.0, max(0.0, best + 0.3))
    return f


def scatter_chunks(sol, f, x0, x1, y0, y1, n, rng, key="ashlar", smin=0.25, smax=0.75, zmin=0.05):
    placed = 0; tries = 0
    while placed < n and tries < n * 20:
        tries += 1
        x = rng.uniform(x0, x1); y = rng.uniform(y0, y1)
        h = f(x, y)
        if h < zmin and rng.random() < 0.8:
            continue
        s = rng.uniform(smin, smax)
        L.chunk(sol, (x, y, max(0.0, h) + s * 0.12), (s * rng.uniform(1.0, 1.8), s * rng.uniform(0.7, 1.1), s * rng.uniform(0.45, 0.8)), rng, key)
        placed += 1


def lid_cutter(f, x0, x1, y0, y1, res=0.5, ztop=40.0, key="rubble"):
    """A closed solid whose BOTTOM is the surface z = f(x, y) and whose top is flat at ztop: subtracting it
    removes everything above f (a collapse line). f must stay below ztop."""
    s = L.Solid("lid")
    nx = max(2, int((x1 - x0) / res)); ny = max(2, int((y1 - y0) / res))
    bm = s.bm
    B = [[bm.verts.new((x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny, f(x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny))) for j in range(ny + 1)] for i in range(nx + 1)]
    T = [[bm.verts.new((x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny, ztop)) for j in range(ny + 1)] for i in range(nx + 1)]
    mi = s._mi(key)
    def F(vs):
        f_ = bm.faces.new(vs); f_.material_index = mi
    for i in range(nx):
        for j in range(ny):
            F((B[i][j], B[i][j + 1], B[i + 1][j + 1], B[i + 1][j]))
            F((T[i][j], T[i + 1][j], T[i + 1][j + 1], T[i][j + 1]))
    for i in range(nx):
        F((B[i][0], B[i + 1][0], T[i + 1][0], T[i][0]))
        F((B[i + 1][ny], B[i][ny], T[i][ny], T[i + 1][ny]))
    for j in range(ny):
        F((B[0][j + 1], B[0][j], T[0][j], T[0][j + 1]))
        F((B[nx][j], B[nx][j + 1], T[nx][j + 1], T[nx][j]))
    return s.to_object(recalc=True)
