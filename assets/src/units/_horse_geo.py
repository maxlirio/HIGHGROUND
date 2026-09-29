"""HIGHGROUND horse: mesh building (body from SDF, tack, caparison, hair cards). bpy + numpy.

Each part is created as a Blender mesh object carrying an integer face/vertex attribute `part`
(see PART) so later stages (skinning, UV, masks) know what it is.
"""
import bpy, bmesh, math, random
import numpy as np
import openvdb as vdb
from mathutils import Vector

PART = dict(body=0, tack=1, rein=2, mane=3, tail=4, forelock=5, cloth=6, feather=7, iron=8)
R = random.Random(7)


# ------------------------------------------------------------------ small helpers
def mesh_obj(name, verts, faces, part, mat=None, uvs=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], [tuple(int(i) for i in f) for f in faces])
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    a = me.attributes.new("part", "INT", "POINT")
    a.data.foreach_set("value", [PART[part]] * len(me.vertices))
    if mat is not None:
        me.materials.append(mat)
    if uvs is not None:
        uv = me.uv_layers.new(name="bake")
        k = 0
        for poly in me.polygons:
            for li in poly.loop_indices:
                uv.data[li].uv = uvs[me.loops[li].vertex_index]
    return ob


def normalize(v):
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-9)


def grad(an, P, e=0.003):
    g = np.zeros_like(P)
    for i in range(3):
        d = np.zeros(3); d[i] = e
        g[:, i] = an.sdf(P + d) - an.sdf(P - d)
    return normalize(g)


def project(an, P, off=0.0, it=6):
    """move points onto the iso-surface sdf = off"""
    P = np.array(P, dtype=np.float64)
    for _ in range(it):
        d = an.sdf(P) - off
        P = P - d[:, None] * grad(an, P)
    return P, grad(an, P)


def march(an, O, D, off=0.0, tmax=2.0):
    """sphere-trace rays O + tD (D unit) from outside until sdf <= off. Returns hit points."""
    O = np.array(O, float); D = normalize(np.array(D, float))
    t = np.zeros(len(O))
    for _ in range(120):
        d = an.sdf(O + D * t[:, None]) - off
        t = t + np.maximum(d, 0.002) * 0.9
        if np.all((d < 0.002) | (t > tmax)): break
    return O + D * t[:, None]


def ribbon(P, N, w, name, part, mat, closed=False, lift=0.0):
    """flat strap lying on a surface: P (n,3) centre-line, N (n,3) surface normals."""
    P = np.asarray(P); N = normalize(np.asarray(N))
    T = np.gradient(P, axis=0) if not closed else (np.roll(P, -1, 0) - np.roll(P, 1, 0))
    S = normalize(np.cross(T, N))
    P = P + N * lift
    V = np.concatenate([P - S * w / 2, P + S * w / 2])
    n = len(P); F = []
    for i in range(n if closed else n - 1):
        j = (i + 1) % n
        F.append((i, j, n + j, n + i))
    return mesh_obj(name, V, F, part, mat)


def tube(P, r, name, part, mat, sides=4, closed=False, up=(0, 0, 1)):
    P = np.asarray(P, float); n = len(P)
    T = normalize(np.gradient(P, axis=0))
    upv = np.array(up, float)
    Bn = normalize(np.cross(T, upv)); Nn = np.cross(Bn, T)
    rr = np.broadcast_to(np.asarray(r, float), (n,))
    V = []
    for i in range(n):
        for k in range(sides):
            a = 2 * math.pi * k / sides + math.pi / sides
            V.append(P[i] + (Bn[i] * math.cos(a) + Nn[i] * math.sin(a)) * rr[i])
    F = []
    for i in range(n if closed else n - 1):
        j = (i + 1) % n
        for k in range(sides):
            k2 = (k + 1) % sides
            F.append((i * sides + k, i * sides + k2, j * sides + k2, j * sides + k))
    return mesh_obj(name, V, F, part, mat)


def torus(c, axis, R_, r, name, part, mat, seg=10, sides=4):
    axis = normalize(np.array(axis, float))
    a1 = normalize(np.cross(axis, [0.0, 0.0, 1.0] if abs(axis[2]) < 0.9 else [1.0, 0, 0]))
    a2 = np.cross(axis, a1)
    P = [np.array(c) + (a1 * math.cos(t) + a2 * math.sin(t)) * R_ for t in np.linspace(0, 2 * math.pi, seg, endpoint=False)]
    return tube(np.array(P), r, name, part, mat, sides=sides, closed=True, up=axis)


# ------------------------------------------------------------------ body
def body_mesh(an, h, tris, mat):
    d, lo = an.grid_sdf(h)
    g = vdb.FloatGrid(background=1.0); g.copyFromArray(d)
    pts, tri, quad = g.convertToPolygons(isovalue=0.0, adaptivity=0.0)
    pts = pts * h + lo
    faces = [tuple(q) for q in quad] + [tuple(t) for t in tri]
    ob = mesh_obj("body", pts, faces, "body", mat)
    me = ob.data
    # keep detail where it reads: head, lower legs (decimate weights)
    P = np.array([v.co[:] for v in me.vertices])
    vg = ob.vertex_groups.new(name="keep")
    S = an.S
    head = an.joints["head"]
    wk = np.zeros(len(P))
    wk = np.maximum(wk, 0.8 * np.clip(1.6 - 1.6 * np.linalg.norm(P - head - np.array([0, -0.2 * S, -0.15 * S]), axis=1) / (0.42 * S), 0, 1))
    wk = np.maximum(wk, 0.55 * np.clip((0.62 * S - P[:, 2]) / (0.3 * S), 0, 1))
    for i, w in enumerate(wk):
        vg.add([i], float(w), "REPLACE")
    m = ob.modifiers.new("dec", "DECIMATE")
    m.ratio = tris / (2.0 * len(quad) + len(tri))
    m.use_symmetry = True; m.symmetry_axis = "X"
    m.vertex_group = "keep"; m.invert_vertex_group = True; m.vertex_group_factor = 1.0
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action="DESELECT"); ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier="dec")
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.vertex_groups.clear()
    return ob


# ------------------------------------------------------------------ tack
# where the stirrup tread sits (the ball of the rider's foot), metres from the saddle seat point: (lateral, forward
# is -Y, down). Must match the rider clips' _anims.RIDE_FITS (ankle target + the foot) for that horse.
STIRRUP = {"destrier": (0.43, -0.155, -0.69), "light": (0.31, -0.16, -0.715)}


class Tack:
    def __init__(self, an, mats, variant, cloth=None):
        self.an = Surface(an, cloth); self.M = mats; self.var = variant; self.S = an.S
        self.cloth = cloth
        self.objs = []

    def P(self, f, z, x=0.0):
        return self.an.P(f, z, x)

    def axis_pt(self, f):
        """point on the torso's long axis at landmark f (for casting rays onto the barrel)"""
        return self.P(f, 1.12)

    def ring(self, f, th0, th1, n, off, tilt=0.0, zc=1.12):
        """points on the torso surface (offset) around the long axis at f, angle from top (0) to
        th (rad, + = left side). tilt leans the ring plane forward (rad)."""
        S = self.S
        th = np.linspace(th0, th1, n)
        O = []; D = []
        c = self.P(f, zc)
        for t in th:
            dv = np.array([math.sin(t), -math.cos(t) * math.sin(tilt), math.cos(t) * math.cos(tilt)])
            O.append(c + dv * 1.2 * S); D.append(-dv)
        H = march(self.an, O, D, off)
        return project(self.an, H, off, it=3)

    def add(self, ob):
        self.objs.append(ob); return ob

    def saddle(self):
        an, S, M = self.an, self.S, self.M
        # seat + skirts: a conforming patch over the back (f from cantle to pommel)
        fs = np.linspace(-0.14, 0.36, 11)
        ths = np.linspace(-1.35, 1.35, 13)
        V = []; F = []
        rows = []
        for f in fs:
            P, N = self.ring(f, -1.35, 1.35, 13, 0.018)
            rows.append((P, N))
        # skirts extend lower in the middle (sweat flaps)
        for i, (P, N) in enumerate(rows):
            V.extend(P)
        nf, nt = len(fs), len(ths)
        for i in range(nf - 1):
            for j in range(nt - 1):
                F.append((i * nt + j, i * nt + j + 1, (i + 1) * nt + j + 1, (i + 1) * nt + j))
        # thickness: add an outer shell offset 1.5 cm (only edges visible; keep single sheet + rim)
        self.add(mesh_obj("saddle_seat", V, F, "tack", M["saddle"]))
        # saddle cloth underneath, larger, cloth material (the trapper replaces it)
        rows = []
        if self.cloth is not None: fs2 = []
        V = []; F = []
        fs2 = np.linspace(-0.22, 0.42, 9); nt2 = 11
        for f in fs2:
            P, N = self.ring(f, -1.55, 1.55, nt2, 0.008)
            V.extend(P)
        for i in range(len(fs2) - 1):
            for j in range(nt2 - 1):
                F.append((i * nt2 + j, i * nt2 + j + 1, (i + 1) * nt2 + j + 1, (i + 1) * nt2 + j))
        if V: self.add(mesh_obj("saddle_cloth", V, F, "tack", M["saddlecloth"]))
        # pommel (front arch) and cantle (high back) as curved boards
        seat_c = self.ring(0.10, 0.0, 0.0, 1, 0.03)[0][0]
        self.seat = seat_c + np.array([0, 0, 0.02])
        # the war saddle: a high cantle close behind the rider's seat that wraps his hips, a pommel before his thighs
        for (f0, hgt, lean, wid, nm) in ((0.31, 0.11, 0.40, 0.36, "pommel"), (-0.05, 0.19, -0.38, 0.46, "cantle")):
            base, N = self.ring(f0, -wid * 2.2, wid * 2.2, 9, 0.03)
            top = []
            for k, p in enumerate(base):
                u = (k / 8.0) * 2 - 1
                h = hgt * S * (1 - 0.55 * u * u)
                q = p + np.array([0.0, -math.sin(lean) * h, math.cos(lean) * h])
                q[0] *= 1.0 + 0.25 * (1 - u * u) * (1 if nm == "cantle" else 0.3)
                top.append(q)
            # board with thickness t
            t = 0.035 * S
            nrm = np.array([0, -math.cos(lean), -math.sin(lean)]) * (1 if nm == "pommel" else -1)
            A = np.array(list(base) + top)
            V = np.concatenate([A, A + nrm * t])
            n = 9; F = []
            for k in range(n - 1):
                F.append((k, k + 1, n + k + 1, n + k))                        # inner face
                F.append((2 * n + k, 2 * n + n + k, 2 * n + n + k + 1, 2 * n + k + 1))  # outer
                F.append((n + k, n + k + 1, 3 * n + k + 1, 3 * n + k))        # top edge
            F.append((0, n, 3 * n, 2 * n)); F.append((n - 1, 2 * n + n - 1, 3 * n + n - 1, n + n - 1))
            self.add(mesh_obj(nm, V, F, "tack", M["saddle"]))
        # girth: strap around the barrel behind the elbows
        if self.cloth is None:
            P, N = self.ring(0.24, -math.pi * 0.98, math.pi * 0.98, 40, 0.012, tilt=0.08)
            self.add(ribbon(P, N, 0.07 * S, "girth", "tack", M["strap"]))
        # stirrup leathers + irons from the stirrup bars at the front of the tree, the irons hung where the rider's
        # feet are (STIRRUP, the ball of his foot in the seat frame; _anims.RIDE_FITS puts his feet there)
        tread_at = STIRRUP["light" if self.var == "light" else "destrier"]
        for sg in (1, -1):
            top, N = self.ring(0.16, sg * 1.1, sg * 1.1, 1, 0.03)
            top = top[0]
            bot = self.seat + np.array([sg * tread_at[0], tread_at[1], tread_at[2] + 0.105 * S])
            # clear the skirt: find the outer surface at the stirrup height and hang outside it
            hit = march(self.an, [bot + np.array([sg * 0.8, 0, 0])], [[-sg, 0, 0]], 0.0)[0]
            if abs(hit[0]) + 0.03 * S > abs(bot[0]):
                bot[0] = hit[0] + sg * 0.03 * S
            L = np.linspace(top, bot, 5)
            for q in L[1:-1]:          # lie on the flank (or the trapper), never through it
                hq = march(self.an, [q + np.array([sg * 0.8, 0, 0])], [[-sg, 0, 0]], 0.0)[0]
                if abs(hq[0]) + 0.012 * S > abs(q[0]): q[0] = hq[0] + sg * 0.012 * S
            self.add(ribbon(L, np.tile([sg, 0, 0], (5, 1)), 0.035 * S, "leather", "tack", M["strap"]))
            c = bot + np.array([0, 0, -0.06 * S])
            self.add(torus(c, (0, 1, 0), 0.06 * S, 0.008 * S, "stirrup", "iron", M["iron"], seg=10, sides=4))
            tread = [c + np.array([-0.06 * S, 0, -0.045 * S]), c + np.array([0.06 * S, 0, -0.045 * S])]
            self.add(tube(np.array(tread), 0.012 * S, "tread", "iron", M["iron"], sides=4, up=(0, 1, 0)))

    def breastplate(self):
        S = self.S
        # a strap from the saddle front, round the chest above the points of the shoulders
        f = np.linspace(-1.0, 1.0, 23)
        pts = []; nrm = []
        for u in f:
            # param across the chest front: angle around the vertical from side to side
            a = u * 1.45
            # aim rays at the chest from the front-sides at a height that drops towards the middle
            z = 1.26 - 0.16 * (1 - abs(u)) ** 1.2
            c = self.P(0.40, z)
            dv = np.array([math.sin(a), -math.cos(a), 0.0])
            pts.append(c + dv * 1.0 * S); nrm.append(-dv)
        H = march(self.an, np.array(pts), np.array(nrm), 0.012)
        H, N = project(self.an, H, 0.012, 3)
        self.add(ribbon(H, N, 0.05 * S, "breastplate", "tack", self.M["strap"]))
        # pendants hanging from it (heraldic enamel -> team colour)
        for u in (-0.5, -0.25, 0.0, 0.25, 0.5):
            i = int(round((u + 1) / 2 * 22))
            p = H[i] + N[i] * 0.01
            n = N[i]
            side = normalize(np.cross(n, [0, 0, 1]))
            w = 0.028 * S; hh = 0.07 * S
            V = [p + side * w, p - side * w, p - side * w * 0.7 + np.array([0, 0, -hh]),
                 p + np.array([0, 0, -hh * 1.4]), p + side * w * 0.7 + np.array([0, 0, -hh])]
            self.add(mesh_obj("pendant", V, [(0, 1, 2, 3, 4)], "tack", self.M["pendant"]))

    def head_ring(self, t, n, off, span=math.pi, n_off=0.0, ang0=0.0):
        """points around the head cross-section at distance t (m, scaled) along the head axis"""
        an = self.an; S = self.S
        hs = an.v["head"]
        af, az = an.head_axis; nf, nz = an.head_front
        pf, pz = 1.06, 1.74
        c = self.P(pf + af * t * hs + nf * n_off * hs, pz + az * t * hs + nz * n_off * hs)
        A = np.array([0.0, -af, az]); Nf = np.array([0.0, -nf, nz]); X = np.array([1.0, 0, 0])
        th = np.linspace(ang0 - span, ang0 + span, n)
        O = []; D = []
        for a in th:
            dv = Nf * math.cos(a) + X * math.sin(a)
            O.append(c + dv * 0.5 * S); D.append(-dv)
        H = march(self.an, O, D, off)
        return project(self.an, H, off, 3)

    def bridle(self):
        S = self.S; M = self.M
        an = self.an
        # noseband (full ring) and browband (front half), crownpiece behind the ears
        P, N = self.head_ring(0.40, 24, 0.008, span=math.pi * 0.999)
        self.add(ribbon(P, N, 0.03 * S, "noseband", "tack", M["strap"], closed=False))
        P, N = self.head_ring(0.10, 13, 0.008, span=1.5, n_off=0.02)
        self.add(ribbon(P, N, 0.025 * S, "browband", "tack", M["strap"]))
        P, N = self.head_ring(-0.02, 17, 0.01, span=1.9, n_off=-0.02)
        self.add(ribbon(P, N, 0.03 * S, "crown", "tack", M["strap"]))
        # throatlatch: from behind the ears down round the throat
        P, N = self.head_ring(0.06, 17, 0.01, span=1.35, ang0=math.pi, n_off=-0.06)
        self.add(ribbon(P, N, 0.018 * S, "throatlatch", "tack", M["strap"]))
        # cheekpieces: side of head from crown down to the bit
        hs = an.v["head"]; af, az = an.head_axis; nf, nz = an.head_front
        self.bits = []
        for sg in (1, -1):
            pts = []
            for k in range(8):
                u = k / 7.0
                t = -0.01 + u * 0.48
                n_off = -0.02 + 0.00 * u - 0.035 * math.sin(u * math.pi) - 0.02 * u
                c = self.P(1.06 + af * t * hs + nf * n_off * hs, 1.74 + az * t * hs + nz * n_off * hs, sg * 0.5)
                pts.append(c)
            O = np.array(pts); D = np.tile([-sg, 0.0, 0.0], (8, 1))
            H = march(an, O, D, 0.01)
            H, N = project(an, H, 0.01, 3)
            self.add(ribbon(H, N, 0.025 * S, "cheek", "tack", M["strap"]))
            bit = H[-1] + N[-1] * 0.01
            self.bits.append(bit)
            self.add(torus(bit, (1, 0, 0), 0.03 * S, 0.006 * S, "bitring", "iron", M["iron"], seg=8, sides=3))
        # reins: bit rings -> over the neck to the saddle pommel, a gentle loop
        pom = self.P(0.36, 1.50)
        for sg, bit in zip((1, -1), self.bits):
            end = pom + np.array([sg * 0.07 * S, 0, 0])
            n = 12
            pts = []
            for k in range(n):
                u = k / (n - 1)
                p = bit * (1 - u) + end * u
                p = p + np.array([sg * 0.05 * S * math.sin(u * math.pi), 0, -0.10 * S * math.sin(u * math.pi)])
                pts.append(p)
            pts = np.array(pts)
            # keep the rein outside the neck
            d = an.sdf(pts)
            gN = normalize(np.stack([np.full(n, sg * 1.0), np.zeros(n), np.full(n, 0.6)], 1))
            for _ in range(4):
                d = an.sdf(pts)
                pts = pts + gN * np.maximum(0.02 - d, 0)[:, None]
            ob = self.add(tube(pts, 0.007 * S, "rein", "rein", M["strap"], sides=3, up=(0, 0, 1)))
            a = ob.data.attributes.new("tpar", "FLOAT", "POINT")
            a.data.foreach_set("value", [(i // 3) / (n - 1) for i in range(len(ob.data.vertices))])

    def crupper(self):
        S = self.S
        pts = []
        for u in np.linspace(0, 1, 12):
            f = -0.16 + (-0.80 + 0.16) * u
            pts.append(f)
        P = []; N = []
        for f in pts:
            p, n = self.ring(f, 0.0, 0.0, 1, 0.01)
            P.append(p[0]); N.append(n[0])
        self.add(ribbon(np.array(P), np.array(N), 0.035 * S, "crupper", "tack", self.M["strap"]))


# ------------------------------------------------------------------ caparison / barding
class Cloth:
    """Trapper = outer surface of (torso offset  U  hanging skirt), clipped at a (scalloped) hem.
    kind: 'caparison' (thin linen, long, dagged hem) | 'barding' (quilted, padded, shorter)"""

    def __init__(self, an, kind):
        self.an = an; self.kind = kind
        S = self.S = an.S
        self.off = (0.025 if kind == "caparison" else 0.05) * S
        self.hem = (0.50 if kind == "caparison" else 0.72) * S
        self.f_front = 1.0 if kind == "caparison" else 0.97
        self.torso = [p for p in an.prims if (p["bA"] in ("root", "chest", "pelvis", "neck1", "neck2") or
                      (p["bA"] or "").startswith(("scap", "humerus", "femur")) or p["bB"] in ("neck2",))
                      and not p["sub"]]

    def hem_z(self, P):
        if self.kind != "caparison":
            return np.full(len(P), self.hem)
        # dagged hem: shallow scallops every ~16 cm around the skirt
        u = (-P[:, 1] + np.abs(P[:, 0]) * 1.3) / (0.19 * self.S)
        return self.hem + 0.05 * self.S * np.abs(np.sin(u * math.pi)) ** 0.7

    def sdf(self, P):
        an, S = self.an, self.S
        d = np.full(len(P), 1e3)
        for p in self.torso:
            d = smin_np(d, an.prim_sdf(p, P), p["k"])
        d = d - self.off
        f = -P[:, 1] / S
        W = an.W
        xw = np.interp(f, [-0.93, -0.84, -0.62, -0.2, 0.3, 0.58, 0.72, 0.79],
                       [0.00, 0.17, 0.27, 0.285, 0.28, 0.23, 0.13, 0.0]) * S * W + self.off
        sk = np.abs(P[:, 0]) - xw
        sk = np.maximum(sk, np.maximum(f - 0.79, -0.93 - f) * S)
        sk = np.where(P[:, 2] < 1.08 * S, sk, 1e3)
        d = smin_np(d, sk, 0.10 * S)
        d = np.maximum(d, (f - self.f_front) * S)
        d = np.maximum(d, self.hem_z(P) - P[:, 2])
        return d

    def mesh(self, mats, h):
        an, S = self.an, self.S
        lo, hi = an.bbox(); lo[2] = self.hem - 0.1
        n = np.ceil((hi - lo) / h).astype(int) + 1
        ax = [lo[i] + h * np.arange(n[i]) for i in range(3)]
        X, Y, Z = np.meshgrid(*ax, indexing="ij")
        P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
        d = self.sdf(P).reshape(X.shape).astype(np.float32)
        g = vdb.FloatGrid(background=1.0); g.copyFromArray(d)
        pts, tri, quad = g.convertToPolygons(isovalue=0.0, adaptivity=0.0)
        pts = pts * h + lo
        faces = [tuple(q) for q in quad] + [tuple(t) for t in tri]
        ob = mesh_obj(self.kind, pts, faces, "cloth", mats[self.kind])
        bm = bmesh.new(); bm.from_mesh(ob.data)
        bm.normal_update()
        hz = lambda c: self.hem_z(np.array([[c.x, c.y, c.z]]))[0]
        kill = [fc for fc in bm.faces if fc.normal.z < -0.5 and fc.calc_center_median().z < hz(fc.calc_center_median()) + 0.04]
        kill += [fc for fc in bm.faces if fc.normal.y < -0.85 and -fc.calc_center_median().y / S > self.f_front - 0.04]
        bmesh.ops.delete(bm, geom=kill, context="FACES")
        cap = self.kind == "caparison"
        for v in bm.verts:
            z = v.co.z
            if z < 1.06 * S:
                k = min(1.0, (1.06 * S - z) / (1.06 * S - self.hem))
                ph = -v.co.y / S * (19.0 if cap else 12.0) + (0.0 if v.co.x > 0 else 1.3)
                # deep, uneven folds that open toward the hem: the linen hangs in pleats from the barrel
                amp = (0.034 if cap else 0.008) * S * k ** 0.8 * (0.75 + 0.25 * math.sin(ph * 0.37 + 1.1))
                nx = 1.0 if v.co.x >= 0 else -1.0
                v.co.x += nx * (amp * math.sin(ph) + amp * 0.45 * math.sin(ph * 2.3 + 0.7))
                if cap:
                    v.co.x += nx * 0.06 * S * k * k             # an A-line: the skirt swings out from the barrel
                    fy = -v.co.y / S
                    if fy > 0.55: v.co.y -= 0.03 * S * k * k       # front flares forward
                    if fy < -0.75: v.co.y += 0.03 * S * k * k      # back flares backward
        bm.to_mesh(ob.data); bm.free()
        return ob


class Surface:
    """body SDF optionally unioned with the trapper: tack is conformed to whatever is outermost."""

    def __init__(self, an, cloth=None):
        self._an = an; self.cloth = cloth

    def __getattr__(self, k):
        return getattr(self._an, k)

    def sdf(self, P):
        d = self._an.sdf(P)
        if self.cloth is not None:
            d = np.minimum(d, self.cloth.sdf(P))
        return d


def smin_np(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


# ------------------------------------------------------------------ hair locks
def hair_locks(an, variant, uvbox, rng_seed=11):
    """Mane, forelock, tail (and fetlock feather on the rough-coated hobby) as tapering ribbons cut
    to the lock's silhouette: no alpha needed. Strand shading comes from the atlas hair strip.
    uvbox(style, s, t): s across the lock 0..1, t root->tip 0..1  ->  atlas uv."""
    rng = random.Random(rng_seed)
    S = an.S
    v = an.v
    shag = v["shaggy"]
    V = []; F = []; UV = []; PT = []; TP = []

    def lock(path, widths, normals, style, part, sub=0.0):
        """path (n,3) root->tip, widths (n,), normals (n,3) facing out. Tip = single vertex."""
        n = len(path)
        T = np.gradient(path, axis=0)
        Sd = normalize(np.cross(T, normals))
        base = len(V)
        u0 = rng.uniform(0, 0.55); du = rng.uniform(0.3, 0.45)
        for i in range(n):
            t = i / (n - 1)
            for k, sgn in enumerate((-1, 1)):
                V.append(path[i] + Sd[i] * sgn * widths[i] / 2)
                UV.append(uvbox(style, u0 + du * (0.5 + 0.5 * sgn * (1 - t * 0.5)), t))
                PT.append(part); TP.append(t)
        for i in range(n - 1):
            a = base + 2 * i
            F.append((a, a + 1, a + 3, a + 2))

    def hug(P, off):
        """push points that are inside the body out to the offset surface"""
        d = an.sdf(P)
        m = d < off
        if m.any():
            Q, N = project(an, P[m], off, 4)
            P = P.copy(); P[m] = Q
        return P

    # ---- mane: locks along the crest, falling to the right (-x) of the neck, a few to the left
    n_locks = 22
    fs = np.linspace(1.00, 0.36, n_locks)
    crest = []
    for f in fs:
        o = an.P(f, 2.3)
        crest.append(march(an, [o], [[0, 0, -1.0]], 0.0)[0])
    crest = np.array(crest)
    for i, root in enumerate(crest if variant == "light" else []):
        u = i / (n_locks - 1)
        for side, lscale in ((-1, 1.0), (1, 0.45)) if i % 2 == 0 else ((-1, 0.9),):
            L = (0.20 + 0.06 * math.sin(u * math.pi)) * S * (1 + 0.45 * shag) * lscale * rng.uniform(0.85, 1.15)
            m = 5
            pts = []
            for k in range(m):
                t = k / (m - 1)
                # over the crest sideways, then down the neck
                p = root + np.array([side * (0.06 * S * min(1, t * 2.2) + 0.02 * S * t), 0.0,
                                     0.03 * S * (1 - t) - L * max(0.0, t - 0.25) * 1.2])
                p[1] += -0.02 * S * t * rng.uniform(-1, 1)
                pts.append(p)
            pts = hug(np.array(pts), 0.009 * S)
            pts[0] = root + np.array([0, 0, 0.012 * S])
            N = normalize(np.tile([side * 1.0, 0.0, 0.35], (m, 1)))
            w = np.linspace(1.0, 0.55, m) * 0.10 * S * rng.uniform(0.85, 1.15)
            lock(pts, w, N, 0 if side < 0 else 1, PART["mane"])
    # ---- forelock: from between the ears down the forehead
    hs = v["head"]; af, az = an.head_axis; nf, nz = an.head_front
    for dx in (-0.025, 0.0, 0.025):
        root = an.P(1.06 + nf * 0.07 * hs, 1.74 + nz * 0.07 * hs, dx)
        m = 4
        L = 0.19 * S * (1 + 0.4 * shag) * rng.uniform(0.85, 1.1)
        dirv = normalize(np.array([0.0, -af, az]) + np.array([0, -nf, nz]) * 0.15)
        pts = np.array([root + dirv * L * k / (m - 1) for k in range(m)])
        pts = hug(pts, 0.012 * S)
        N = np.tile(np.array([0, -nf, nz]), (m, 1))
        lock(pts, np.linspace(1, 0.45, m) * 0.06 * S, N, 0, PART["forelock"])
    # ---- tail: locks round the dock, hanging to the hocks, swinging out a little behind
    dock0 = an.P(-0.80, 1.37); dock1 = an.P(-0.90, 1.18)
    tl = (0.98 if variant != "light" else 0.92) * S
    n_t = 10
    for i in range(n_t):
        a = 2 * math.pi * i / n_t
        rad = np.array([math.cos(a), math.sin(a) * 0.6, 0.0])
        root = dock0 * 0.35 + dock1 * 0.65 + rad * 0.035 * S
        m = 6
        L = tl * rng.uniform(0.82, 1.05)
        pts = []
        for k in range(m):
            t = k / (m - 1)
            p = root + np.array([0, 0.10 * S * math.sin(t * 1.8), -L * t]) + rad * (0.045 * S * math.sin(t * 2.2) - 0.02 * S * t)
            pts.append(p)
        pts = np.array(pts)
        pts = hug(pts, 0.02 * S)
        N = np.tile(rad, (m, 1))
        lock(pts, np.linspace(1, 0.5, m) * 0.095 * S * rng.uniform(0.85, 1.15), N, 3, PART["tail"])
    # ---- fetlock feather: off. One card behind each fetlock read in game as a claw or spur sticking out of the
    # leg (edge-on from the side); the hobby's rough coat is carried by the painted shag and the long mane.
    if shag > 0.5 and False:
        for leg, (f, x) in (("F", (0.505, 0.14)), ("H", (-0.665, 0.132))):
            for sg in (1, -1):
                root = an.P(f, 0.20, sg * x)
                pts = np.array([root, root + np.array([0, 0.035 * S, -0.06 * S]), root + np.array([0, 0.05 * S, -0.13 * S])])
                lock(pts, np.array([0.05, 0.035, 0.015]) * S, np.tile([0, 1.0, 0.2], (3, 1)), 1, PART["feather"])
    ob = mesh_obj("hair", np.array(V), F, "mane", None, uvs=np.array(UV))
    ob.data.attributes["part"].data.foreach_set("value", PT)
    a = ob.data.attributes.new("tpar", "FLOAT", "POINT")
    a.data.foreach_set("value", TP)
    return ob
