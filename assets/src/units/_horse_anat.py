"""HIGHGROUND horse anatomy: skeleton (joints/bones) + signed-distance body built from
anatomical primitives (round cones / ellipsoids) blended with smooth unions.

Pure numpy (no bpy) so the same code drives meshing, skin weights and the pose solver.

Coordinates: side-view landmarks are written as (f, z, x): f = forward (m), z = up, x = lateral
(+x = the horse's LEFT side). World = (x, -f, z): the horse faces -Y (art bible).
Landmarks are for a 15 hand (1.52 m) horse, then scaled per variant.
"""
import math
import numpy as np

# ------------------------------------------------------------------ variants
VARIANTS = {
    # hobby / courser: ~14 hands, lean, rough-coated, slightly big head, light bone
    "light":    dict(height=1.42, width=0.86, bone=0.86, neck=0.86, head=1.04, crest=0.7, rump=0.9,
                     head_pitch=50.0, shaggy=1.0),
    # destrier: ~15.2 hands, deep chest, heavy crest, powerful quarters, good bone
    "destrier": dict(height=1.57, width=1.12, bone=1.10, neck=1.12, head=1.0, crest=1.35, rump=1.12,
                     head_pitch=54.0, shaggy=0.35),
}

BASE_H = 1.52

# joint table: name -> (f, z, x)   (x listed for the LEFT side; right side mirrored)
J_CENTRE = {
    "root":   (0.00, 1.12, 0.0),
    "chest":  (0.30, 1.15, 0.0),
    "pelvis": (-0.35, 1.30, 0.0),
    "neck1":  (0.55, 1.28, 0.0),
    "neck2":  (0.86, 1.52, 0.0),
    "head":   (1.05, 1.72, 0.0),
    "tail1":  (-0.80, 1.38, 0.0),
    "tail2":  (-0.90, 1.20, 0.0),
    "tail3":  (-0.94, 0.90, 0.0),
    "seat":   (0.10, 1.47, 0.0),   # saddle seat (rider attachment), refined after tack build
}
J_SIDE = {
    "scap":    (0.30, 1.42, 0.10),
    "humerus": (0.66, 1.10, 0.165),
    "forearm": (0.50, 0.87, 0.172),
    "fcannon": (0.525, 0.47, 0.148),
    "fpast":   (0.535, 0.175, 0.14),
    "fhoof":   (0.585, 0.075, 0.14),
    "femur":   (-0.55, 1.12, 0.17),
    "tibia":   (-0.38, 0.82, 0.19),
    "hcannon": (-0.67, 0.52, 0.14),
    "hpast":   (-0.635, 0.175, 0.132),
    "hhoof":   (-0.585, 0.075, 0.132),
}
PARENT_C = {"root": None, "chest": "root", "pelvis": "root", "neck1": "chest", "neck2": "neck1",
            "head": "neck2", "tail1": "pelvis", "tail2": "tail1", "tail3": "tail2", "seat": "root"}
PARENT_S = {"scap": "chest", "humerus": "scap", "forearm": "humerus", "fcannon": "forearm",
            "fpast": "fcannon", "fhoof": "fpast",
            "femur": "pelvis", "tibia": "femur", "hcannon": "tibia", "hpast": "hcannon", "hhoof": "hpast"}


def bone_names():
    out = list(J_CENTRE.keys())
    for s in ("L", "R"):
        out += [f"{k}_{s}" for k in J_SIDE]
    return out


class Anatomy:
    """Variant-scaled skeleton + SDF primitive list."""

    def __init__(self, variant):
        self.v = VARIANTS[variant]
        self.name = variant
        v = self.v
        self.S = v["height"] / BASE_H
        self.W = v["width"]
        self.joints = {}     # name -> world np.array(3)
        self.parent = {}
        for k, (f, z, x) in J_CENTRE.items():
            self.joints[k] = self.P(f, z, x)
            self.parent[k] = PARENT_C[k]
        for s, sg in (("L", 1), ("R", -1)):
            for k, (f, z, x) in J_SIDE.items():
                self.joints[f"{k}_{s}"] = self.P(f, z, sg * x)
                p = PARENT_S[k]
                self.parent[f"{k}_{s}"] = p if p in J_CENTRE else f"{p}_{s}"
        # the head points down-forward from the poll
        a = math.radians(v["head_pitch"])
        self.head_axis = (math.cos(a), -math.sin(a))          # (f, z)
        self.head_front = (math.sin(a), math.cos(a))          # forehead/nasal side normal
        self.prims = []
        self._build()

    # side-view landmark -> world, variant-scaled (lateral scaled by width)
    def P(self, f, z, x=0.0, wscale=True):
        S = self.S
        return np.array([x * S * (self.W if wscale else 1.0), -f * S, z * S], dtype=np.float64)

    # --------------------------------------------------------------- primitive helpers
    def cone(self, a, b, ra, rb, bones, k, lat=1.0, sides=True, grp="body", sub=False, tag=None):
        """round cone between side-view points a,b=(f,z,x). bones: str or (boneA, boneB) blended
        along the segment. Mirrored for both sides when x != 0 and sides=True."""
        self._add("cone", a, b, ra, rb, bones, k, lat, sides, grp, sub, tag)

    def ell(self, c, r, bones, k, axis=None, sides=True, grp="body", sub=False, tag=None):
        """ellipsoid at c=(f,z,x) with radii r=(lat, along, perp). axis: (df, dz) direction of the
        'along' radius in the side plane (default = forward)."""
        self._add("ell", c, axis or (1.0, 0.0), r, None, bones, k, 1.0, sides, grp, sub, tag)

    def _add(self, kind, a, b, ra, rb, bones, k, lat, sides, grp, sub, tag):
        S, W = self.S, self.W
        mirror = sides and abs(a[2] if len(a) > 2 else 0) > 1e-6
        for sg, s in ((1, "L"), (-1, "R")) if mirror else ((1, None),):
            def bn(x):
                if x is None: return None
                if s and x in J_SIDE: return f"{x}_{s}"
                return x
            if isinstance(bones, str):
                bA = bB = bn(bones)
            else:
                bA, bB = bn(bones[0]), bn(bones[1])
            if kind == "cone":
                ax = a[2] if len(a) > 2 else 0.0
                bx = b[2] if len(b) > 2 else 0.0
                pa = self.P(a[0], a[1], sg * ax); pb = self.P(b[0], b[1], sg * bx)
                self.prims.append(dict(kind="cone", a=pa, b=pb, ra=ra * S, rb=rb * S, lat=lat,
                                       bA=bA, bB=bB, k=k * S, grp=grp, sub=sub, tag=tag))
            else:
                cx = a[2] if len(a) > 2 else 0.0
                c = self.P(a[0], a[1], sg * cx)
                df, dz = b
                n = math.hypot(df, dz); df, dz = df / n, dz / n
                ax_along = np.array([0.0, -df, dz])
                ax_lat = np.array([1.0, 0.0, 0.0])
                ax_perp = np.cross(ax_lat, ax_along)
                R = np.stack([ax_lat, ax_along, ax_perp])       # rows = local axes
                rad = np.array([ra[0] * S * W, ra[1] * S, ra[2] * S])
                self.prims.append(dict(kind="ell", c=c, R=R, r=rad, bA=bA, bB=bA, k=k * S,
                                       grp=grp, sub=sub, tag=tag))

    # --------------------------------------------------------------- the horse
    def _build(self):
        v = self.v
        W = self.W
        bone = v["bone"]; nk = v["neck"]; cr = v["crest"]; rp = v["rump"]
        C, E = self.cone, self.ell
        # ---- trunk
        E((-0.03, 1.10), (0.27, 0.57, 0.33), "root", 0.10)
        E((-0.06, 0.97), (0.25, 0.40, 0.21), "root", 0.12)                          # belly                         # barrel
        E((0.36, 1.13), (0.235, 0.36, 0.32), "chest", 0.10)                        # thorax
        E((-0.30, 1.27), (0.24, 0.32, 0.21), ("pelvis"), 0.10)                     # loins
        E((0.05, 1.30), (0.20, 0.40, 0.12), "root", 0.10)                          # back muscle
        C((0.02, 1.37), (0.32, 1.47), 0.05, 0.052, "chest", 0.08, lat=1.2)           # withers
        # hindquarters (each side) + croup ridge
        E((-0.57, 1.22, 0.115), (0.155 * rp, 0.27 * rp, 0.29 * rp), "pelvis", 0.10)
        C((-0.40, 1.42), (-0.78, 1.34), 0.10 * rp, 0.07, "pelvis", 0.10, lat=1.4)  # croup
        # point of buttock / hamstrings run down the back of the thigh into the gaskin
        C((-0.76, 1.19, 0.10), (-0.66, 0.74, 0.12), 0.11 * rp, 0.075 * bone, ("pelvis", "tibia"),
          0.07, lat=0.9)
        # thigh (quadriceps / stifle)
        C((-0.54, 1.10, 0.155), (-0.40, 0.83, 0.18), 0.15 * rp, 0.085, ("femur", "tibia"), 0.10)
        # breast (pectorals) and shoulder
        E((0.62, 1.02, 0.08), (0.095, 0.10, 0.14), "chest", 0.07)
        C((0.30, 1.40, 0.10), (0.63, 1.10, 0.15), 0.085, 0.10, ("scap", "humerus"), 0.08, lat=0.5)
        E((0.55, 0.98, 0.16), (0.08, 0.12, 0.12), "humerus", 0.07, axis=(0.6, -0.8))  # triceps
        # ---- neck
        C((0.42, 1.24), (0.88, 1.52), 0.22 * nk, 0.14 * nk, ("chest", "neck2"), 0.10, lat=0.60)
        C((0.86, 1.52), (1.02, 1.68), 0.15 * nk, 0.095, ("neck2", "head"), 0.06, lat=0.62)
        C((0.28, 1.47), (0.70, 1.64 + 0.02 * cr), 0.055, 0.055 * cr, ("chest", "neck2"), 0.08, lat=0.85)
        C((0.70, 1.64 + 0.02 * cr), (1.00, 1.77), 0.055 * cr, 0.05, ("neck2", "head"), 0.06, lat=0.85)
        # ---- head (built along the head axis from the poll)
        hs = v["head"]
        pf, pz = 1.06, 1.74
        af, az = self.head_axis
        nf, nz = self.head_front

        def hp(t, n=0.0, x=0.0):
            t *= hs; n *= hs
            return (pf + af * t + nf * n, pz + az * t + nz * n, x)
        E(hp(0.09, 0.0), (0.095 * hs, 0.12 * hs, 0.10 * hs), "head", 0.04, axis=(af, az))  # cranium
        E(hp(0.22, -0.075, 0.0), (0.095 * hs, 0.13 * hs, 0.10 * hs), "head", 0.035, axis=(af, az))  # jowls
        C(hp(0.14, 0.02), hp(0.47, 0.0), 0.08 * hs, 0.058 * hs, "head", 0.035, lat=0.82)   # face
        E(hp(0.50, -0.01), (0.060 * hs, 0.085 * hs, 0.07 * hs), "head", 0.035, axis=(af, az))  # muzzle
        E(hp(0.53, -0.055), (0.048 * hs, 0.06 * hs, 0.035 * hs), "head", 0.02, axis=(af, az))  # chin/lip
        E(hp(0.19, 0.03, 0.08), (0.02 * hs, 0.028 * hs, 0.022 * hs), "head", 0.02, axis=(af, az),
          tag="eye")
        E(hp(0.165, 0.06, 0.065), (0.025 * hs, 0.04 * hs, 0.02 * hs), "head", 0.025, axis=(af, az))  # brow
        # nostrils (carved)
        E(hp(0.545, 0.02, 0.045), (0.009 * hs, 0.022 * hs, 0.014 * hs), "head", 0.02, axis=(af, az),
          sub=True)
        # ears: leaf-shaped, pricked up and a little forward from the poll
        E((pf + 0.01 * hs, pz + 0.10 * hs, 0.06), (0.016 * hs, 0.085 * hs, 0.034 * hs), "head", 0.02,
          axis=(0.25, 1.0), tag="ear")
        # ---- forelegs
        b = bone
        C((0.505, 0.80, 0.168), (0.52, 0.50, 0.15), 0.08 * b, 0.048 * b, "forearm", 0.035, lat=0.9)  # forearm
        C((0.50, 0.98, 0.17), (0.505, 0.78, 0.168), 0.095 * b, 0.08 * b, ("humerus", "forearm"), 0.12, lat=0.9)  # arm root
        E((0.575, 0.90, 0.13), (0.07, 0.07, 0.11), ("humerus"), 0.08, axis=(0.3, -1))  # pectoral into forearm
        E((0.54, 0.77, 0.16), (0.06 * b, 0.07, 0.14), "forearm", 0.04, axis=(0.08, -1))    # extensors
        E((0.465, 0.89, 0.17), (0.04 * b, 0.06, 0.045), "forearm", 0.05)                       # olecranon
        E((0.53, 0.47, 0.148), (0.045 * b, 0.042 * b, 0.055), "fcannon", 0.03)                # knee
        C((0.525, 0.45, 0.148), (0.533, 0.20, 0.14), 0.038 * b, 0.036 * b, "fcannon", 0.015, lat=0.78)
        C((0.50, 0.42, 0.148), (0.508, 0.21, 0.14), 0.024 * b, 0.026 * b, "fcannon", 0.02, lat=0.8)  # tendons
        E((0.522, 0.18, 0.14), (0.042 * b, 0.052 * b, 0.048 * b), ("fpast"), 0.025)          # fetlock
        C((0.535, 0.165, 0.14), (0.572, 0.095, 0.14), 0.036 * b, 0.041 * b, ("fpast", "fhoof"), 0.015)
        C((0.575, 0.092, 0.14), (0.595, 0.006, 0.14), 0.049 * b, 0.061 * b, "fhoof", 0.012, lat=1.05,
          tag="hoof")
        # ---- hindlegs
        C((-0.44, 0.83, 0.18), (-0.665, 0.56, 0.145), 0.10 * rp, 0.05 * b, "tibia", 0.05, lat=0.8)  # gaskin
        C((-0.60, 0.80, 0.15), (-0.73, 0.60, 0.14), 0.05 * rp, 0.03 * b, "tibia", 0.04, lat=0.6)  # hamstring tendon
        E((-0.67, 0.53, 0.14), (0.045 * b, 0.065, 0.06), "hcannon", 0.025)                   # hock
        C((-0.66, 0.55, 0.14), (-0.735, 0.60, 0.14), 0.045 * b, 0.036 * b, ("tibia", "hcannon"), 0.03,
          lat=0.7)                                                                       # point of hock
        C((-0.67, 0.50, 0.14), (-0.638, 0.20, 0.132), 0.042 * b, 0.037 * b, "hcannon", 0.015, lat=0.8)
        C((-0.695, 0.46, 0.14), (-0.66, 0.21, 0.132), 0.024 * b, 0.026 * b, "hcannon", 0.02, lat=0.8)
        E((-0.648, 0.18, 0.132), (0.042 * b, 0.052 * b, 0.048 * b), "hpast", 0.025)
        C((-0.635, 0.165, 0.132), (-0.598, 0.095, 0.132), 0.035 * b, 0.04 * b, ("hpast", "hhoof"), 0.015)
        C((-0.595, 0.092, 0.132), (-0.577, 0.006, 0.132), 0.047 * b, 0.058 * b, "hhoof", 0.012, lat=1.05,
          tag="hoof")
        # ---- tail dock
        C((-0.78, 1.38), (-0.88, 1.20), 0.055, 0.035, ("tail1", "tail2"), 0.04)

    # --------------------------------------------------------------- SDF evaluation
    def prim_sdf(self, p, P):
        """signed distance of points P (N,3) to primitive p (approximate for scaled shapes)."""
        if p["kind"] == "ell":
            q = (P - p["c"]) @ p["R"].T
            r = p["r"]
            k0 = np.linalg.norm(q / r, axis=1)
            k1 = np.linalg.norm(q / (r * r), axis=1)
            return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
        a, b = p["a"], p["b"]
        lat = p["lat"]
        Q = P.copy(); Q[:, 0] = a[0] + (Q[:, 0] - a[0]) / lat
        bb = b.copy(); bb[0] = a[0] + (b[0] - a[0]) / lat
        d = _round_cone(Q, a, bb, p["ra"], p["rb"])
        return d * min(lat, 1.0)

    def prim_t(self, p, P):
        """0..1 position along a cone primitive (for bone blending)."""
        if p["kind"] == "ell":
            return np.zeros(len(P))
        ba = p["b"] - p["a"]
        return np.clip(((P - p["a"]) @ ba) / (ba @ ba), 0, 1)

    def sdf(self, P):
        d = np.full(len(P), 1e3)
        for p in self.prims:
            di = self.prim_sdf(p, P)
            d = smax(d, -di, p["k"]) if p["sub"] else smin(d, di, p["k"])
        return d

    def bbox(self):
        lo = np.full(3, 1e9); hi = np.full(3, -1e9)
        for p in self.prims:
            if p["kind"] == "ell":
                r = p["r"].max()
                lo = np.minimum(lo, p["c"] - r); hi = np.maximum(hi, p["c"] + r)
            else:
                r = max(p["ra"], p["rb"])
                for q in (p["a"], p["b"]):
                    lo = np.minimum(lo, q - r); hi = np.maximum(hi, q + r)
        return lo - 0.05, hi + 0.05

    def grid_sdf(self, h):
        """evaluate the SDF on a regular grid with spacing h; primitives are only evaluated in their
        own padded bounding box (smooth-min beyond k has no effect). Returns (grid, origin)."""
        lo, hi = self.bbox()
        lo[2] = -0.02
        n = np.ceil((hi - lo) / h).astype(int) + 1
        d = np.full(tuple(n), 1e3, dtype=np.float32)
        for p in self.prims:
            if p["kind"] == "ell":
                r = p["r"].max(); plo = p["c"] - r; phi = p["c"] + r
            else:
                r = max(p["ra"], p["rb"])
                plo = np.minimum(p["a"], p["b"]) - r; phi = np.maximum(p["a"], p["b"]) + r
            m = p["k"] * 1.5 + 2 * h
            i0 = np.clip(np.floor((plo - m - lo) / h).astype(int), 0, n - 1)
            i1 = np.clip(np.ceil((phi + m - lo) / h).astype(int) + 1, 1, n)
            ax = [lo[i] + h * np.arange(i0[i], i1[i]) for i in range(3)]
            X, Y, Z = np.meshgrid(*ax, indexing="ij")
            P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
            di = self.prim_sdf(p, P).reshape(X.shape).astype(np.float32)
            sl = tuple(slice(i0[i], i1[i]) for i in range(3))
            d[sl] = smax(d[sl], -di, p["k"]) if p["sub"] else smin(d[sl], di, p["k"])
        # flat ground contact: nothing below z=0 (hoof soles)
        zz = lo[2] + h * np.arange(n[2])
        d = np.maximum(d, (-zz)[None, None, :].astype(np.float32))
        return d, lo

    # --------------------------------------------------------------- skin weights
    def weights(self, P, sigma=0.018, prims=None):
        """per-vertex bone weight accumulators (N x bones) from primitive membership."""
        prims = self.prims if prims is None else prims
        names = bone_names(); bi = {n: i for i, n in enumerate(names)}
        N = len(P)
        ds = np.stack([self.prim_sdf(p, P) for p in prims], 1)       # N x M
        ds = np.where(np.array([p["sub"] for p in prims])[None, :], 1e3, ds)
        dmin = ds.min(1, keepdims=True)
        c = np.exp(-(ds - dmin) / (sigma * self.S))
        acc = np.zeros((N, len(names)))
        for j, p in enumerate(prims):
            if p["sub"]: continue
            if p["bA"] == p["bB"]:
                acc[:, bi[p["bA"]]] += c[:, j]
            else:
                t = self.prim_t(p, P)
                s = t * t * (3 - 2 * t)
                acc[:, bi[p["bA"]]] += c[:, j] * (1 - s)
                acc[:, bi[p["bB"]]] += c[:, j] * s
        return acc


def _round_cone(P, a, b, r1, r2):
    ba = b - a
    l2 = ba @ ba
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = P - a
    y = pa @ ba
    z = y - l2
    xv = pa * l2 - np.outer(y, ba)
    x2 = np.einsum("ij,ij->i", xv, xv)
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
    d1 = np.sqrt(x2 + z2) * il2 - r2
    d2 = np.sqrt(x2 + y2) * il2 - r1
    return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)
