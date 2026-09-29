"""HIGHGROUND - stone curtain-wall kit (procedural, Blender 5.1).

    blender -b -P assets/src/wall_stone.py -- <module|all>
    (or WALL_MODULE=<module>;  WALL_TEX=<px> overrides the bake size)

modules: straight straight_b straight_c corner end end_l breach build1   (default: all)

KIT CONVENTIONS (read before placing these in the game)
  * Module pivot = centre of its 6 m grid cell ON THE WALL CENTRELINE, z=0 = ground.
    (_lib.finish would re-centre the bounding box; for a snapping kit that is wrong,
    so this script replaces ground_origin with a no-op - geometry is authored in place.)
  * Straight-type modules (straight*, breach, build1) run x=-3..+3, outer face toward -Y.
    Their ports are (-3,0,0) and (+3,0,0). Place them at x = 6k.
  * corner: X arm from the port (-3,0) to the corner, Y arm to the port (0,+3); outer faces
    are -Y and +X. Next straight after it is rotated +90 deg about Z and centred at (0,6).
  * end: port at (-3,0); x=+3 is a finished, quoined end.  end_l: its mirror (port at +3).
  * Every port is a deterministic joint: boundary stones, courses, merlon halves and the
    weathering noise are identical from both sides, so any module abuts any other.
  * assets/glb/wall_stone_kit.json lists every module's ports.
"""
import bpy, bmesh, sys, os, math, random, json
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib as L

L.ground_origin = lambda objs: None   # kit pieces are authored on their snap pivot

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
MODULE = argv[0] if argv else os.environ.get("WALL_MODULE", "all")
TEX = int(os.environ.get("WALL_TEX", "2048"))

HT = 1.2            # half thickness
Z_WALK, Z_SILL, Z_MER = 7.0, 8.0, 9.1
PLINTH_H, PLINTH_OUT = 1.6, 0.55


def batter(v):
    return PLINTH_OUT * (1.0 - v / PLINTH_H) ** 1.15 if v < PLINTH_H else 0.0


def smooth(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ global course table
def make_courses():
    r = random.Random(4242)
    out = []
    bands = [(0.0, PLINTH_H, 4), (PLINTH_H, Z_WALK, 12), (Z_WALK, Z_SILL, 2), (Z_SILL, Z_MER, 2)]
    for z0, z1, n in bands:
        w = [r.uniform(0.75, 1.3) for _ in range(n)]
        if z0 == 0.0:
            w = sorted(w, reverse=True)   # biggest stones at the bottom
        s = sum(w); z = z0
        for x in w:
            h = (z1 - z0) * x / s
            out.append([z, z + h, False]); z += h
        out[-1][1] = z1
    for lvl in (2.3, 4.0, 5.7):     # putlog courses
        i = min(range(len(out)), key=lambda k: abs((out[k][0] + out[k][1]) / 2 - lvl))
        out[i][2] = True
    return [tuple(c) for c in out]


COURSES = make_courses()


def port_tab(kind, ci):
    """Deterministic boundary stone spanning a port: [-a, +b] around it."""
    r = random.Random(f"port:{kind}:{ci}")
    sm = kind == "m"
    lo, hi = (0.12, 0.24) if sm else (0.2, 0.5)
    return dict(a=r.uniform(lo, hi), b=r.uniform(lo, hi), sr=r.random(),
                d0=r.uniform(0.045, 0.085), gu=r.uniform(-0.03, 0.03), gv=r.uniform(-0.05, 0.05),
                ibp=r.uniform(0.015, 0.05), itp=r.uniform(0.015, 0.05),
                ifa=r.uniform(0.02, 0.05), ibfa=r.uniform(0.015, 0.05), itfa=r.uniform(0.015, 0.05),
                ifb=r.uniform(0.02, 0.05), ibfb=r.uniform(0.015, 0.05), itfb=r.uniform(0.015, 0.05))


# ------------------------------------------------------------------ polyline with mitred offsets
class Poly:
    def __init__(self, pts):
        self.p = [Vector((x, y)) for x, y in pts]
        self.n = len(self.p) - 1
        self.cum = [0.0]; self.d = []; self.r = []
        for i in range(self.n):
            d = self.p[i + 1] - self.p[i]; ln = d.length; d = d / ln
            self.d.append(d); self.r.append(Vector((d.y, -d.x)))
            self.cum.append(self.cum[-1] + ln)
        self.L = self.cum[-1]

    def off_pts(self, offs):
        if not isinstance(offs, (list, tuple)):
            offs = [offs] * self.n
        out = []
        for j in range(self.n + 1):
            if j == 0:
                out.append(self.p[0] + self.r[0] * offs[0])
            elif j == self.n:
                out.append(self.p[-1] + self.r[-1] * offs[-1])
            else:
                a = self.p[j] + self.r[j - 1] * offs[j - 1]; b = self.p[j] + self.r[j] * offs[j]
                d1, d2 = self.d[j - 1], self.d[j]
                den = d1.x * d2.y - d1.y * d2.x
                if abs(den) < 1e-9:
                    out.append(a)
                else:
                    t = ((b.x - a.x) * d2.y - (b.y - a.y) * d2.x) / den
                    out.append(a + d1 * t)
        return out

    def seg(self, u):
        u = min(max(u, 0.0), self.L)
        for i in range(self.n):
            if u <= self.cum[i + 1] + 1e-9:
                return i, (u - self.cum[i]) / (self.cum[i + 1] - self.cum[i])
        return self.n - 1, 1.0

    def at(self, u, offs):
        i, f = self.seg(u); op = self.off_pts(offs)
        return op[i].lerp(op[i + 1], f)

    def corners(self):
        out = []
        for j in range(1, self.n):
            d1, d2 = self.d[j - 1], self.d[j]
            out.append((self.cum[j], d1.x * d2.y - d1.y * d2.x > 0))
        return out

    def sub(self, u0, u1, l):
        """XY points along the offset line l from u0 to u1 (either direction), incl. corners."""
        op = self.off_pts(l)
        lo, hi = min(u0, u1), max(u0, u1)
        mid = [op[j] for j in range(1, self.n) if lo + 1e-6 < self.cum[j] < hi - 1e-6]
        pts = [self.at(lo, l)] + mid + [self.at(hi, l)]
        return pts if u0 <= u1 else pts[::-1]

    def project(self, pt):
        best = (1e9, 0.0)
        for i in range(self.n):
            a = self.p[i]; t = max(0.0, min(self.cum[i + 1] - self.cum[i], (pt - a).dot(self.d[i])))
            dist = (a + self.d[i] * t - pt).length
            if dist < best[0]:
                best = (dist, self.cum[i] + t)
        return best[1]


# ------------------------------------------------------------------ mesh builder
class MB:
    def __init__(self):
        self.v = []; self.f = []
        self.a = {"srand": [], "skind": [], "groove": []}; self.tq = []

    def V(self, p, sr, kind, gr=0.0, tq=(0, 0, 0)):
        self.v.append((p[0], p[1], p[2])); self.a["srand"].append(sr); self.a["skind"].append(kind)
        self.a["groove"].append(gr); self.tq.append(tuple(tq))
        return len(self.v) - 1

    def F(self, idx, hint):
        pts = [Vector(self.v[i]) for i in idx]
        nrm = Vector((0, 0, 0))
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            nrm += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        if nrm.length < 1e-9:
            return
        if nrm.dot(hint) < 0:
            idx = list(reversed(idx))
        self.f.append(list(idx))

    def obj(self, name, material):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        me.validate(clean_customdata=False)
        o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
        n = len(me.vertices)
        for k, vals in self.a.items():
            at = me.attributes.new(k, "FLOAT", "POINT"); at.data.foreach_set("value", vals[:n])
        at = me.attributes.new("tq", "FLOAT_VECTOR", "POINT")
        at.data.foreach_set("vector", [c for t in self.tq[:n] for c in t])
        L.assign(o, material)
        return o


def frame(F, u, v):
    p0 = F(u, v, 0.0)
    n = (F(u, v, 0.1) - p0).normalized()
    t = (F(u + 0.01, v, 0.0) - p0).normalized()
    b = (F(u, v + 0.01, 0.0) - p0).normalized()
    return n, t, b


def stone(mb, F, ua, ub, va, vb, ins, dfun, sr, kind, bps=(), cut_l=False, cut_r=False, pillow=0.35, sl=(0.0, 0.0)):
    """A single stone: groove ring at depth 0, raised plateau (depth dfun) inset by ins.
    ins = (il, ir, ibl, ibr, itl, itr) or (ilb, ilt, irb, irt, ibl, ibr, itl, itr) - the
    8-value form gives each plateau corner its own inset so outlines are not rectangles.
    bps = interior u breakpoints (corners it wraps). pillow = centre bulge (fraction of depth)."""
    if len(ins) == 6:
        il, ir, ibl, ibr, itl, itr = ins; ilb = ilt = il; irb = irt = ir
    else:
        ilb, ilt, irb, irt, ibl, ibr, itl, itr = ins
    mids = [b for b in bps if ua + max(ilb, ilt) + 1e-4 < b < ub - max(irb, irt) - 1e-4]
    if ub - ua - max(ilb, ilt) - max(irb, irt) < 0.02 or vb - va - max(ibl, ibr) - max(itl, itr) < 0.02:
        # too small to raise: flat chip so the face never shows a hole
        us = [ua] + [b for b in bps if ua < b < ub] + [ub]
        if len(us) == 2 and (sl[0] or sl[1]):
            q = [mb.V(F(ua - sl[0], va, 0.0), sr, kind, 0.6), mb.V(F(ub - sl[1], va, 0.0), sr, kind, 0.6),
                 mb.V(F(ub + sl[1], vb, 0.0), sr, kind, 0.6), mb.V(F(ua + sl[0], vb, 0.0), sr, kind, 0.6)]
            mb.F(q, frame(F, (ua + ub) / 2, (va + vb) / 2)[0])
            return
        for a, b in zip(us, us[1:]):
            q = [mb.V(F(a, va, 0.0), sr, kind, 0.6), mb.V(F(b, va, 0.0), sr, kind, 0.6),
                 mb.V(F(b, vb, 0.0), sr, kind, 0.6), mb.V(F(a, vb, 0.0), sr, kind, 0.6)]
            mb.F(q, frame(F, (a + b) / 2, (va + vb) / 2)[0])
        return
    dl, dr = sl
    usb = [ua - dl] + mids + [ub - dr]
    ust = [ua + dl] + mids + [ub + dr]
    us = usb
    pub = [ua - dl + ilb] + mids + [ub - dr - irb]
    put = [ua + dl + ilt] + mids + [ub + dr - irt]

    def vin(u, a, b):
        return a + (b - a) * min(1.0, max(0.0, (u - ua) / (ub - ua)))
    Gb = [mb.V(F(u, va, 0.0), sr, kind, 1.0) for u in usb]
    Gt = [mb.V(F(u, vb, 0.0), sr, kind, 1.0) for u in ust]
    Pb, Pt = [], []
    w, h = ub - ua, vb - va
    size = min(w, h)
    dmid = max(0.02, dfun((ua + ub) / 2, (va + vb) / 2))
    pillow = min(pillow, 0.05 * size / dmid)
    shrink = 1.0 - pillow * 1.6 if not mids else 1.0
    for u in pub:
        v1 = va + vin(u, ibl, ibr)
        Pb.append(mb.V(F(u, v1, dfun(u, v1) * shrink), sr, kind, 0.35))
    for u in put:
        v2 = vb - vin(u, itl, itr)
        Pt.append(mb.V(F(u, v2, dfun(u, v2) * shrink), sr, kind, 0.35))
    k = len(us)
    vm = (va + vb) / 2
    for i in range(k - 1):
        um = (pub[i] + pub[i + 1]) / 2
        n, t, b = frame(F, um, vm)
        mb.F([Gb[i], Gb[i + 1], Pb[i + 1], Pb[i]], n - b)
        mb.F([Gt[i], Gt[i + 1], Pt[i + 1], Pt[i]], n + b)
        if mids or pillow <= 0.01:
            mb.F([Pb[i], Pb[i + 1], Pt[i + 1], Pt[i]], n)
    if not mids and pillow > 0.01:
        vc = vm + (ibl + ibr - itl - itr) / 4
        lift = 1.0 + pillow * 0.9
        n = frame(F, (ua + ub) / 2, vc)[0]
        if w > 1.7 * h:
            # loaf: a ridge along the stone instead of a point, avoids creased fans
            r = h * 0.5
            c1u, c2u = ua + max(ilb, ilt) + r, ub - max(irb, irt) - r
            C1 = mb.V(F(c1u, vc, dfun(c1u, vc) * lift), sr, kind, 0.0)
            C2 = mb.V(F(c2u, vc, dfun(c2u, vc) * lift), sr, kind, 0.0)
            mb.F([Pb[0], Pb[1], C2, C1], n); mb.F([Pt[1], Pt[0], C1, C2], n)
            mb.F([Pb[0], C1, Pt[0]], n); mb.F([Pb[1], Pt[1], C2], n)
        else:
            uc = (ua + ub) / 2 + (ilb + ilt - irb - irt) / 4
            C = mb.V(F(uc, vc, dfun(uc, vc) * lift), sr, kind, 0.0)
            for q in ((Pb[0], Pb[1]), (Pb[1], Pt[1]), (Pt[1], Pt[0]), (Pt[0], Pb[0])):
                mb.F([q[0], q[1], C], n)
    if not cut_l:
        n, t, b = frame(F, ua + 0.005, vm)
        mb.F([Gb[0], Gt[0], Pt[0], Pb[0]], n - t)
    if not cut_r:
        n, t, b = frame(F, ub - 0.005, vm)
        mb.F([Gb[-1], Gt[-1], Pt[-1], Pb[-1]], n + t)


def hole(mb, F, ua, ub, va, vb, depth, sr=0.5):
    c = [(ua, va), (ub, va), (ub, vb), (ua, vb)]
    o = [mb.V(F(u, v, 0.0), sr, 3, 1.0) for u, v in c]
    i = [mb.V(F(u, v, -depth), sr, 3, 0.0) for u, v in c]
    n, t, b = frame(F, (ua + ub) / 2, (va + vb) / 2)
    mb.F([o[0], o[1], i[1], i[0]], b)
    mb.F([o[1], o[2], i[2], i[1]], -t)
    mb.F([o[2], o[3], i[3], i[2]], -b)
    mb.F([o[3], o[0], i[0], i[3]], t)
    mb.F(i, n)


def fill(a, b, h, rng, wmin=0.36, wmax=1.3, k=(1.4, 3.0)):
    cells = []; x = a
    while b - x > 1e-5:
        rem = b - x
        w = min(max(rng.uniform(h * k[0], h * k[1]), wmin), wmax)
        if rem <= w + 0.22:
            if rem > 1.35:
                w = rem / 2
            else:
                w = rem
        cells.append((x, x + w)); x += w
    return cells


def rubble_ins(rng, lo=0.008, hi=0.026):
    return tuple(rng.uniform(lo, hi) for _ in range(8))


def rubble_d(rng, ua, ub, va, vb, dlo=0.065, dhi=0.12, g=0.04):
    d0 = rng.uniform(dlo, dhi); gu = rng.uniform(-g, g); gv = rng.uniform(-g * 1.4, g * 1.4)
    uc, vc = (ua + ub) / 2, (va + vb) / 2
    return lambda u, v: max(0.02, d0 + gu * (u - uc) + gv * (v - vc))


# ------------------------------------------------------------------ face builder
def build_face(mb, pts, z0, z1, rng, sk=None, ek=None, bw=None, putlogs=(), slots=(),
               keep=None, breaks=(), dressed=False):
    pl = Poly(pts); Lp = pl.L
    w = bw or [0.0] * pl.n

    def F(u, v, d):
        xy = pl.at(u, [batter(v) * wi + d for wi in w])
        return Vector((xy.x, xy.y, v))
    corners = pl.corners()
    convex = [u for u, c in corners if c]
    barriers = sorted([u for u, c in corners if not c] + list(breaks))
    allc = [u for u, _ in corners]

    for ci, (ca, cb, put) in enumerate(COURSES):
        va, vb = max(ca, z0), min(cb, z1)
        if vb - va < 0.05:
            continue
        h = vb - va
        acc = []    # accepted forced intervals: [a, b, type, data]

        def overl(a, b):
            return [x for x in acc if x[0] < b - 1e-6 and x[1] > a + 1e-6]
        if sk:
            T = port_tab(sk, ci); acc.append([0.0, T["b"], "ps", T])
        if ek:
            T = port_tab(ek, ci); acc.append([Lp - T["a"], Lp, "pe", T])
        for s in slots:
            sc, vs0, vs1, hw, cw, dep = s
            if va < vs1 and vb > vs0 and not overl(sc - cw, sc + cw):
                acc.append([sc - cw, sc + cw, "slot", s])
        if put:
            for p in putlogs:
                if 0.2 < p < Lp - 0.2 and not overl(p - 0.13, p + 0.13) and \
                        not any(abs(p - b) < 0.2 for b in barriers + allc):
                    acc.append([p - 0.11, p + 0.11, "hole", None])
        longq = min(max(h * 1.9, 0.5), 0.8); shortq = longq * 0.55
        if dressed:
            longq, shortq = 0.36, 0.26
        for c in convex:
            s1, s2 = (longq, shortq) if ci % 2 else (shortq, longq)
            a, b = max(0.0, c - s1), min(Lp, c + s2)
            for bar in barriers:
                if a < bar < c: a = bar
                if c < bar < b: b = bar
            hit = overl(a, b)
            merged = False
            for x in hit:
                if x[2] == "quoin":
                    x[0] = min(x[0], a); x[1] = max(x[1], b); merged = True
            if merged:
                continue
            for x in hit:
                if x[1] <= c: a = max(a, x[1])
                elif x[0] >= c: b = min(b, x[0])
                else: a = b = c
            if b - a > 0.12:
                acc.append([a, b, "quoin", None])
        # merge quoins that now overlap after growth
        acc.sort(key=lambda x: x[0])
        m2 = []
        for x in acc:
            if m2 and x[2] == "quoin" and m2[-1][2] == "quoin" and x[0] < m2[-1][1] - 1e-6:
                m2[-1][1] = max(m2[-1][1], x[1])
            else:
                m2.append(x)
        acc = m2
        # free gaps
        cells = []
        cur = 0.0
        for x in acc + [[Lp, Lp, "end", None]]:
            if x[0] > cur + 1e-5:
                cuts = [cur] + [bb for bb in barriers if cur + 1e-5 < bb < x[0] - 1e-5] + [x[0]]
                for g0, g1 in zip(cuts, cuts[1:]):
                    for c0, c1 in fill(g0, g1, h, rng):
                        cells.append([c0, c1, "free", None])
            if x[2] != "end":
                cells.append(x)
            cur = max(cur, x[1])
        kept = []
        cells = [c for c in cells if c[1] - c[0] >= 0.03]
        slant = [0.0] * (len(cells) + 1)
        for i in range(1, len(cells)):
            if cells[i - 1][2] == "free" and cells[i][2] == "free" and abs(cells[i - 1][1] - cells[i][0]) < 1e-6 \
                    and not dressed:
                slant[i] = rng.uniform(-0.065, 0.065) * min(1.0, h / 0.45)
        for ci_, (c0, c1, typ, data) in enumerate(cells):
            sl = (slant[ci_], slant[ci_ + 1])
            bps = [u for u in allc if c0 < u < c1]
            if keep and not keep(F, c0, c1, va, vb):
                continue
            kept.append((c0, c1))
            if typ == "free":
                kind = 1 if dressed else 0
                if not dressed and h > 0.3 and c1 - c0 > 0.45 and rng.random() < 0.13:
                    vm = va + h * rng.uniform(0.42, 0.58); f = (vm - va) / h
                    ml, mr = sl[0] * (2 * f - 1), sl[1] * (2 * f - 1)    # slant offsets at the split line
                    for a, b, s0, s1 in ((va, vm, (sl[0], sl[1]), None), (vm, vb, None, None)):
                        # express each half's corners through nominal u + half-slant
                        if a == va:
                            lb, lt, rb, rt = c0 - sl[0], c0 + ml, c1 - sl[1], c1 + mr
                        else:
                            lb, lt, rb, rt = c0 + ml, c0 + sl[0], c1 + mr, c1 + sl[1]
                        uA, uB = (lb + lt) / 2, (rb + rt) / 2
                        stone(mb, F, uA, uB, a, b, rubble_ins(rng), rubble_d(rng, uA, uB, a, b),
                              rng.random(), kind, bps, sl=((lt - lb) / 2, (rt - rb) / 2))
                else:
                    ins = rubble_ins(rng, 0.014, 0.035) if dressed else rubble_ins(rng)
                    dd = rubble_d(rng, c0, c1, va, vb, 0.03, 0.05, 0.015) if dressed else rubble_d(rng, c0, c1, va, vb)
                    stone(mb, F, c0, c1, va, vb, ins, dd, rng.random(), kind, bps, sl=sl)
            elif typ == "quoin":
                ins = tuple(rng.uniform(0.01, 0.02) for _ in range(6))
                stone(mb, F, c0, c1, va, vb, ins, rubble_d(rng, c0, c1, va, vb, 0.035, 0.05, 0.01),
                      rng.random(), 1, bps, pillow=0.12)
            elif typ in ("ps", "pe"):
                T = data; vc = (va + vb) / 2
                if typ == "ps":
                    ins = (0.0, T["ifb"], T["ibp"], T["ibfb"], T["itp"], T["itfb"])
                    dfun = (lambda T: lambda u, v: T["d0"] + T["gu"] * u + T["gv"] * (v - vc))(T)
                    stone(mb, F, c0, c1, va, vb, ins, dfun, T["sr"], 0, bps, cut_l=True)
                else:
                    ins = (T["ifa"], 0.0, T["ibfa"], T["ibp"], T["itfa"], T["itp"])
                    dfun = (lambda T: lambda u, v: T["d0"] + T["gu"] * (u - Lp) + T["gv"] * (v - vc))(T)
                    stone(mb, F, c0, c1, va, vb, ins, dfun, T["sr"], 0, bps, cut_r=True)
            elif typ == "hole":
                hh = min(h - 0.05, 0.2) / 2; vc = (va + vb) / 2
                hole(mb, F, c0, c1, vc - hh, vc + hh, 0.3)
                # lintel / sill slivers + jamb frame
                for a, b in ((va, vc - hh), (vc + hh, vb)):
                    if b - a > 0.035:
                        stone(mb, F, c0, c1, a, b, (0.012,) * 6, lambda u, v: 0.04, rng.random(), 0, pillow=0)
            elif typ == "slot":
                sc, vs0, vs1, hw, cw, dep = data
                a0, a1 = max(va, vs0), min(vb, vs1)
                dz = lambda u, v: 0.035
                sr = rng.random()
                if a1 - a0 < 0.05:
                    stone(mb, F, c0, c1, va, vb, (0.015,) * 6, dz, sr, 1, bps, pillow=0.1)
                    continue
                stone(mb, F, c0, sc - hw, va, vb, (0.015, 0.0, 0.015, 0.015, 0.015, 0.015), dz, sr, 1, pillow=0)
                stone(mb, F, sc + hw, c1, va, vb, (0.0, 0.015, 0.015, 0.015, 0.015, 0.015), dz, sr, 1, pillow=0)
                if a0 - va > 0.03:
                    stone(mb, F, sc - hw, sc + hw, va, a0, (0.0, 0.0, 0.015, 0.015, 0.0, 0.0), dz, sr, 1,
                          cut_l=True, cut_r=True, pillow=0)
                if vb - a1 > 0.03:
                    stone(mb, F, sc - hw, sc + hw, a1, vb, (0.0, 0.0, 0.0, 0.0, 0.015, 0.015), dz, sr, 1,
                          cut_l=True, cut_r=True, pillow=0)
                hole(mb, F, sc - hw, sc + hw, a0, a1, dep)
    return pl


# ------------------------------------------------------------------ horizontal slabs (walk, sills, caps)
def build_slabs(mb, cpoly, u0, u1, l0, l1, z, rng, rows=(0.45, 0.85), pieces=(2, 3),
                relief=(0.015, 0.03), slope=None, keep=None, breaks=(), kind=1, ins=(0.008, 0.02),
                cut_ends=False, pillow=0.1):
    def F(u, l, d):
        xy = cpoly.at(u, l)
        return Vector((xy.x, xy.y, z + d + (slope(l) if slope else 0.0)))
    cuts = [u0] + sorted(set([c for c, _ in cpoly.corners() if u0 + 1e-4 < c < u1 - 1e-4] +
                             [b for b in breaks if u0 + 1e-4 < b < u1 - 1e-4])) + [u1]
    for g0, g1 in zip(cuts, cuts[1:]):
        for r0, r1 in fill(g0, g1, 0.3, rng, rows[0], rows[1], (rows[0] / 0.3, rows[1] / 0.3)):
            if keep and not keep(F, r0, r1):
                continue
            n = rng.randint(pieces[0], pieces[1])
            ls = [l0] + sorted(l0 + (l1 - l0) * (i + rng.uniform(-0.25, 0.25)) / n for i in range(1, n)) + [l1]
            for a, b in zip(ls, ls[1:]):
                d0 = rng.uniform(*relief); gu = rng.uniform(-0.02, 0.02); gv = rng.uniform(-0.02, 0.02)
                uc, lc = (r0 + r1) / 2, (a + b) / 2
                dfun = (lambda d0, gu, gv, uc, lc: lambda u, l: max(0.008, d0 + gu * (u - uc) + gv * (l - lc)))(
                    d0, gu, gv, uc, lc)
                ii = tuple(rng.uniform(*ins) for _ in range(6))
                stone(mb, F, r0, r1, a, b, ii, dfun, rng.random(), kind, pillow=pillow)


# ------------------------------------------------------------------ parapet with merlons
def build_parapet(mb, cpar, embr, rng, sp=True, ep=True, arrow_prob=0.55, keep_top=None, breaks=()):
    """cpar: parapet centre Poly (outer at l=+0.3). embr: embrasure centre u list (0.7 wide)."""
    Lp = cpar.L; ew = 0.35
    ivals = [(c - ew, c + ew) for c in embr]
    mer = []; cur = 0.0
    for a, b in ivals:
        mer.append((cur, a)); cur = b
    mer.append((cur, Lp))
    # sills in the embrasures
    for a, b in ivals:
        build_slabs(mb, cpar, a, b, -0.3, 0.3, Z_SILL, rng, rows=(0.3, 0.45), pieces=(1, 1),
                    relief=(0.025, 0.04), slope=lambda l: 0.045 * (0.3 - l) / 0.6, keep=keep_top,
                    breaks=breaks, pillow=0)
    corner_us = [c for c, _ in cpar.corners()]
    arrows = 0
    for i, (u0, u1) in enumerate(mer):
        s_port, e_port = (sp and u0 < 1e-6), (ep and u1 > Lp - 1e-6)
        if keep_top and not keep_top(None, u0, u1):
            continue
        O = lambda a, b: cpar.sub(a, b, 0.3)
        I = lambda a, b: cpar.sub(a, b, -0.3)
        if s_port:
            pts = O(u0, u1) + I(u1, u0); sk, ek = "m", "m"
        elif e_port:
            pts = I(u1, u0) + O(u0, u1); sk, ek = "m", "m"
        else:
            mid = (cpar.at(u0, 0.3) + cpar.at(u0, -0.3)) / 2
            pts = [mid] + O(u0, u1) + I(u1, u0) + [mid]; sk = ek = None
        pts = [(p.x, p.y) for p in pts]
        loop = Poly(pts)
        slots = []
        has_corner = any(u0 < c < u1 for c in corner_us)
        if not s_port and not e_port and not has_corner and u1 - u0 > 1.1 and \
                (rng.random() < arrow_prob or (arrows == 0 and i >= len(mer) - 2)):
            c = (u0 + u1) / 2 + rng.uniform(-0.08, 0.08)
            uo = loop.project(cpar.at(c, 0.3)); ui = loop.project(cpar.at(c, -0.3))
            slots = [(uo, 8.18, 9.0, 0.04, 0.2, 0.36), (ui, 8.12, 9.0, 0.15, 0.3, 0.2)]
            arrows += 1
        build_face(mb, pts, Z_SILL, Z_MER, rng, sk, ek, slots=slots, dressed=False)
        # coping: two sloped slab strips forming a shallow ridge + soffit plate beneath
        a0 = u0 if s_port else max(0.0, u0 - 0.035)
        a1 = u1 if e_port else min(Lp, u1 + 0.035)
        ext0 = 0.0 if s_port else 0.035
        ext1 = 0.0 if e_port else 0.035
        cap_poly = cpar
        if not s_port or not e_port:
            # extend the centre line slightly past free merlon ends for the cap overhang
            P0 = cpar.at(u0, 0.0) - cpar.d[cpar.seg(u0)[0]] * ext0
            P1 = cpar.at(u1, 0.0) + cpar.d[cpar.seg(u1)[0]] * ext1
            mids = [cpar.p[j] for j in range(1, cpar.n) if u0 < cpar.cum[j] < u1]
            cap_poly = Poly([(p.x, p.y) for p in [P0] + mids + [P1]])
        cl = cap_poly.L
        for l0, l1, sl in ((-0.335, 0.0, lambda l: 0.08 * (1 - abs(l) / 0.335)),
                           (0.0, 0.335, lambda l: 0.08 * (1 - abs(l) / 0.335))):
            build_slabs(mb, cap_poly, 0.0, cl, l0, l1, Z_MER, rng, rows=(0.4, 0.7), pieces=(1, 1),
                        relief=(0.035, 0.05), slope=sl, ins=(0.006, 0.014), pillow=0)
        # soffit (faces down) so the overhang never shows the hollow merlon
        us = [0.0] + [c for c, _ in cap_poly.corners()] + [cl]
        for a, b in zip(us, us[1:]):
            q = []
            for u, l in ((a, -0.335), (b, -0.335), (b, 0.335), (a, 0.335)):
                xy = cap_poly.at(u, l); q.append(mb.V((xy.x, xy.y, Z_MER - 0.002), 0.5, 1, 1.0))
            mb.F(q, Vector((0, 0, -1)))
    return mer


def end_cap(mb, pos, outward, axis, ztop=Z_MER, profile=None):
    """Rubble-core cross-section plugging an open port (hidden once modules abut)."""
    pos = Vector((pos[0], pos[1], 0)) - Vector((axis[0], axis[1], 0)) * 0.004
    ow = Vector((outward[0], outward[1], 0))
    prof = profile or [(HT + PLINTH_OUT, 0.0), (HT, PLINTH_H), (HT, Z_SILL if ztop < Z_MER else Z_MER),
                       (HT - 0.6, Z_SILL if ztop < Z_MER else Z_MER), (HT - 0.6, Z_WALK), (-HT, Z_WALK), (-HT, 0.0)]
    idx = [mb.V(pos + ow * l + Vector((0, 0, z)), 0.3, 2, 0.0) for l, z in prof]
    mb.F(idx, Vector((axis[0], axis[1], 0)))


# ------------------------------------------------------------------ rubble, rocks, ground
def rock(mb, c, size, rng, kind=2, squash=0.7, box=None):
    bm = bmesh.new()
    if box:
        sx, sy, sz = box; ch = 0.025
        for x in (-1, 1):
            for y in (-1, 1):
                for z in (-1, 1):
                    for dx, dy, dz in ((ch, 0, 0), (0, ch, 0), (0, 0, ch)):
                        bm.verts.new((x * (sx / 2 - dx), y * (sy / 2 - dy), z * (sz / 2 - dz)))
    else:
        for _ in range(12):
            v = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
            v *= size * rng.uniform(0.72, 1.0)
            v.z *= squash
            bm.verts.new(v)
    bmesh.ops.convex_hull(bm, input=bm.verts)
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    R = (Matrix.Rotation(rng.uniform(0, 6.283), 4, "Z") @ Matrix.Rotation(rng.uniform(-0.5, 0.5), 4, "X") @
         Matrix.Rotation(rng.uniform(-0.5, 0.5), 4, "Y"))
    sr = rng.random(); ids = {}
    for v in bm.verts:
        ids[v.index] = mb.V(Vector(c) + (R @ v.co), sr, kind, 0.0)
    for f in bm.faces:
        mb.F([ids[v.index] for v in f.verts], R @ f.normal)
    bm.free()


def heightfield(mb, x0, x1, y0, y1, step, hf, kind, sr_fn=None, cull=None):
    nx = max(2, int(round((x1 - x0) / step)) + 1); ny = max(2, int(round((y1 - y0) / step)) + 1)
    grid = {}
    for i in range(nx):
        for j in range(ny):
            x = x0 + (x1 - x0) * i / (nx - 1); y = y0 + (y1 - y0) * j / (ny - 1)
            grid[i, j] = (x, y, hf(x, y))
    ids = {}

    def gid(i, j):
        if (i, j) not in ids:
            ids[i, j] = mb.V(grid[i, j], sr_fn(*grid[i, j]) if sr_fn else 0.5, kind, 0.0)
        return ids[i, j]
    for i in range(nx - 1):
        for j in range(ny - 1):
            q = [grid[i, j], grid[i + 1, j], grid[i + 1, j + 1], grid[i, j + 1]]
            if cull and cull(q):
                continue
            mb.F([gid(i, j), gid(i + 1, j), gid(i + 1, j + 1), gid(i, j + 1)], Vector((0, 0, 1)))
    return grid


def core_top(mb, x0, x1, zfn, rng, y0=-HT + 0.02, y1=HT - 0.02, step=0.22, skirt=0.9, lumps=0.06):
    """Exposed rubble core: lumpy top surface between the faces plus skirts down each face."""
    lump = {}

    def hf(x, y):
        k = (round(x, 3), round(y, 3))
        if k not in lump:
            lump[k] = rng.uniform(-lumps, lumps * 1.3)
        edge = 0.0 if (abs(y - y0) < 1e-4 or abs(y - y1) < 1e-4) else lump[k]
        return zfn(x) + edge
    ny = 6
    grid = heightfield(mb, x0, x1, y0, y1, (y1 - y0) / (ny - 1), hf, 2, sr_fn=lambda x, y, z: rng.random())
    grid = {k: v for k, v in grid.items()}
    xs = sorted(set(round(k[0], 5) for k in grid.values()))
    for yy, hint in ((y0, Vector((0, -1, 0))), (y1, Vector((0, 1, 0)))):
        for a, b in zip(xs, xs[1:]):
            za, zb = zfn(a), zfn(b)
            q = [mb.V((a, yy, za), 0.4, 2, 0.0), mb.V((b, yy, zb), 0.4, 2, 0.0),
                 mb.V((b, yy, max(0.0, zb - skirt)), 0.4, 2, 0.0), mb.V((a, yy, max(0.0, za - skirt)), 0.4, 2, 0.0)]
            mb.F(q, hint)


# ------------------------------------------------------------------ timber
def pole(tb, p0, p1, r, rng, sides=6, cap=True, kind=0, sr=None):
    p0, p1 = Vector(p0), Vector(p1); ax = p1 - p0; ln = ax.length; ax.normalize()
    up = Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((1, 0, 0))
    e1 = ax.cross(up).normalized(); e2 = ax.cross(e1)
    sr = rng.random() if sr is None else sr
    ph = rng.uniform(0, 6.28)
    rings = []
    for t, rr in ((0.0, r), (1.0, r * 0.88)):
        ring = []
        for k in range(sides):
            a = ph + 6.2832 * k / sides; rj = rr * rng.uniform(0.9, 1.08)
            off = e1 * math.cos(a) * rj + e2 * math.sin(a) * rj
            ring.append(tb.V(p0 + ax * ln * t + off, sr, kind, 0.0, (ln * t, off.dot(e1), off.dot(e2))))
        rings.append(ring)
    for k in range(sides):
        a = ph + 6.2832 * (k + 0.5) / sides
        tb.F([rings[0][k], rings[0][(k + 1) % sides], rings[1][(k + 1) % sides], rings[1][k]],
             e1 * math.cos(a) + e2 * math.sin(a))
    if cap:
        tb.F(rings[1], ax)
        tb.F(rings[0], -ax)


def plank(tb, c, along, across, dims, rng, kind=0):
    c = Vector(c); a = Vector(along).normalized(); b = Vector(across).normalized(); n = a.cross(b)
    lx, wy, tz = dims; sr = rng.random(); ids = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                p = c + a * sx * lx / 2 + b * sy * wy / 2 + n * sz * tz / 2
                ids.append(tb.V(p, sr, kind, 0.0, (sx * lx / 2 + c.x * 0.37, sy * wy / 2, sz * tz / 2)))
    I = lambda sx, sy, sz: ids[((sx > 0) * 4) + ((sy > 0) * 2) + (sz > 0)]
    faces = [((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), -n), ((-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1), n),
             ((-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1), -b), ((-1, 1, -1), (1, 1, -1), (1, 1, 1), (-1, 1, 1), b),
             ((-1, -1, -1), (-1, 1, -1), (-1, 1, 1), (-1, -1, 1), -a), ((1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1), a)]
    for f in faces:
        tb.F([I(*f[0]), I(*f[1]), I(*f[2]), I(*f[3])], f[4])


# ------------------------------------------------------------------ materials
def hexlin(h, a=1.0):
    h = h.lstrip("#"); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (a,)


class NB:
    def __init__(self, m, seed):
        self.nt = m.node_tree; self.n = self.nt.nodes; self.l = self.nt.links
        self.geo = self.n.new("ShaderNodeNewGeometry")
        sep = self.n.new("ShaderNodeSeparateXYZ"); self.l.new(self.geo.outputs["Position"], sep.inputs[0])
        self.z = sep.outputs["Z"]
        sn = self.n.new("ShaderNodeSeparateXYZ"); self.l.new(self.geo.outputs["Normal"], sn.inputs[0])
        self.nx, self.ny, self.nz = sn.outputs["X"], sn.outputs["Y"], sn.outputs["Z"]
        self.qp = self.attr("qp").outputs["Vector"]; self.qw = self.attr("qw").outputs["Fac"]
        r = random.Random(seed)
        self.pfree = self.vm("ADD", self.geo.outputs["Position"], (r.uniform(10, 90), r.uniform(10, 90), r.uniform(10, 90)))

    def S(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.l.new(v, sock)
        elif v is not None:
            if isinstance(v, tuple) and hasattr(sock.default_value, "__len__") and len(sock.default_value) != len(v):
                v = v[:len(sock.default_value)]
            sock.default_value = v

    def I(self, node, ident):
        for s in node.inputs:
            if s.identifier == ident:
                return s

    def O(self, node, ident):
        for s in node.outputs:
            if s.identifier == ident:
                return s

    def attr(self, name):
        x = self.n.new("ShaderNodeAttribute"); x.attribute_type = "GEOMETRY"; x.attribute_name = name
        return x

    def math(self, op, a, b=0.0, clamp=False):
        x = self.n.new("ShaderNodeMath"); x.operation = op; x.use_clamp = clamp
        self.S(x.inputs[0], a); self.S(x.inputs[1], b)
        return x.outputs[0]

    def cmp(self, a, b, eps=0.5):
        x = self.n.new("ShaderNodeMath"); x.operation = "COMPARE"
        self.S(x.inputs[0], a); self.S(x.inputs[1], b); self.S(x.inputs[2], eps)
        return x.outputs[0]

    def vm(self, op, a, b=None, scale=None):
        x = self.n.new("ShaderNodeVectorMath"); x.operation = op
        self.S(x.inputs[0], a)
        if b is not None: self.S(x.inputs[1], b)
        if scale is not None: self.S(x.inputs[3], scale)
        return x.outputs[0]

    def mixf(self, f, a, b):
        x = self.n.new("ShaderNodeMix"); x.data_type = "FLOAT"; x.clamp_factor = True
        self.S(self.I(x, "Factor_Float"), f); self.S(self.I(x, "A_Float"), a); self.S(self.I(x, "B_Float"), b)
        return self.O(x, "Result_Float")

    def mixc(self, f, a, b, blend="MIX"):
        x = self.n.new("ShaderNodeMix"); x.data_type = "RGBA"; x.blend_type = blend; x.clamp_factor = True
        self.S(self.I(x, "Factor_Float"), f); self.S(self.I(x, "A_Color"), a); self.S(self.I(x, "B_Color"), b)
        return self.O(x, "Result_Color")

    def scalec(self, c, s):
        return self.vm("SCALE", c, scale=s)

    def noise(self, vec, scale, detail=4.0, rough=0.55, dist=0.0):
        x = self.n.new("ShaderNodeTexNoise"); x.noise_dimensions = "3D"
        self.S(x.inputs["Vector"], vec); self.S(x.inputs["Scale"], scale); self.S(x.inputs["Detail"], detail)
        self.S(x.inputs["Roughness"], rough); self.S(x.inputs["Distortion"], dist)
        return x.outputs["Fac"]

    def snoise(self, scale, detail=4.0, rough=0.55, aniso=(1, 1, 1), dist=0.0):
        """Port-safe noise: mirrored port-local coords blend into free coords away from ports."""
        sv = (aniso[0] * scale, aniso[1] * scale, aniso[2] * scale)
        a = self.noise(self.vm("MULTIPLY", self.qp, sv), 1.0, detail, rough, dist)
        b = self.noise(self.vm("MULTIPLY", self.pfree, sv), 1.0, detail, rough, dist)
        return self.mixf(self.qw, a, b)

    def voronoi(self, vec, scale, feature="F1", rnd=1.0):
        x = self.n.new("ShaderNodeTexVoronoi"); x.feature = feature
        self.S(x.inputs["Vector"], vec); self.S(x.inputs["Scale"], scale); self.S(x.inputs["Randomness"], rnd)
        return x

    def ramp(self, fac, stops, interp="LINEAR"):
        x = self.n.new("ShaderNodeValToRGB"); cr = x.color_ramp; cr.interpolation = interp
        el = cr.elements
        while len(el) < len(stops):
            el.new(0.5)
        for e, (p, c) in zip(el, stops):
            e.position = p; e.color = hexlin(c) if isinstance(c, str) else c
        self.S(x.inputs[0], fac)
        return x.outputs["Color"]

    def sm(self, e0, e1, v):
        x = self.n.new("ShaderNodeMapRange"); x.interpolation_type = "SMOOTHSTEP"; x.clamp = True
        self.S(x.inputs["Value"], v); x.inputs["From Min"].default_value = e0; x.inputs["From Max"].default_value = e1
        return x.outputs["Result"]


def stone_material(seed):
    m, n, l, bsdf = L.mat("wall_stone")
    B = NB(m, seed)
    sr = B.attr("srand").outputs["Fac"]; kind = B.attr("skind").outputs["Fac"]; gr = B.attr("groove").outputs["Fac"]
    isd = B.cmp(kind, 1); iscore = B.cmp(kind, 2); ishole = B.cmp(kind, 3)
    pos = B.geo.outputs["Position"]
    # per-stone tone (limestone family with grey + warm sandstone interlopers)
    base = B.ramp(sr, [(0.0, "#bcab8e"), (0.16, "#ab9f8a"), (0.32, "#c4b499"), (0.48, "#9f9483"),
                       (0.6, "#bb9f79"), (0.72, "#b2a58c"), (0.84, "#928a7c"), (0.93, "#cbbfa3")], "CONSTANT")
    bright = B.math("ADD", 0.8, B.math("MULTIPLY", B.math("FRACT", B.math("MULTIPLY", sr, 13.71)), 0.4))
    col = B.scalec(base, bright)
    col = B.mixc(B.math("MULTIPLY", isd, 0.75), col, B.scalec(hexlin("#bdb29a"), B.math("ADD", 0.9, B.math("MULTIPLY", sr, 0.18))))
    # rubble core: small voronoi stones in mortar
    vor = B.voronoi(pos, 4.0)
    core_st = B.ramp(vor.outputs["Distance"], [(0.0, "#8f8676"), (1.0, "#7a7264")])
    vcol = B.ramp(vor.outputs["Color"], [(0.0, "#9c9280"), (0.35, "#7f796d"), (0.7, "#a49a85"), (1.0, "#6f6a60")], "CONSTANT")
    ved = B.voronoi(pos, 4.0, "DISTANCE_TO_EDGE")
    core = B.mixc(B.sm(0.02, 0.07, ved.outputs["Distance"]), hexlin("#a79d88"), vcol)
    core = B.mixc(0.25, core, core_st)
    col = B.mixc(iscore, col, core)
    col = B.mixc(ishole, col, hexlin("#3e372e"))
    # mid (within-stone) and fine (pitting) layers
    mid = B.snoise(2.2, 6.0, 0.6)
    col = B.scalec(col, B.math("ADD", 0.76, B.math("MULTIPLY", mid, 0.48)))
    m2 = B.noise(pos, 9.0, 6.0, 0.62)
    col = B.scalec(col, B.math("ADD", 0.82, B.math("MULTIPLY", m2, 0.34)))
    pits = B.voronoi(pos, 22.0).outputs["Distance"]
    col = B.scalec(col, B.math("ADD", 0.8, B.math("MULTIPLY", B.sm(0.0, 0.25, pits), 0.2)))
    fine = B.noise(pos, 34.0, 3.0, 0.6)
    col = B.scalec(col, B.math("ADD", 0.9, B.math("MULTIPLY", fine, 0.18)))
    # per-stone rim grime (groove attr: 0 centre -> 0.35 plateau rim -> 1 joint)
    rim = B.sm(0.02, 0.36, gr)
    col = B.scalec(col, B.math("SUBTRACT", 1.06, B.math("MULTIPLY", rim, 0.14)))
    # large blotch drift
    blot = B.snoise(0.28, 3.0, 0.5)
    col = B.mixc(B.math("MULTIPLY", B.sm(0.45, 0.75, blot), 0.45), col, hexlin("#8a857a"))
    col = B.mixc(B.math("MULTIPLY", B.sm(0.45, 0.2, blot), 0.3), col, hexlin("#b99f78"))
    # mortar in the joints
    mort = B.math("MULTIPLY", B.sm(0.38, 0.7, gr), B.math("SUBTRACT", 1.0, B.math("MAXIMUM", iscore, ishole)))
    col = B.mixc(B.math("MULTIPLY", mort, 0.95), col, B.scalec(hexlin("#b3aa94"), B.math("ADD", 0.85, B.math("MULTIPLY", fine, 0.3))))
    # --- weathering
    zn = B.math("ADD", B.z, B.math("MULTIPLY", B.math("SUBTRACT", B.snoise(1.6, 4.0), 0.5), 0.7))
    # damp streaks running down from the parapet
    streak = B.snoise(1.0, 4.0, 0.55, aniso=(2.4, 2.4, 0.13))
    dmask = B.math("MULTIPLY", B.sm(2.6, 8.2, B.z), B.math("SUBTRACT", 1.0, B.sm(0.55, 0.85, B.math("ABSOLUTE", B.nz))))
    damp = B.math("MULTIPLY", B.sm(0.47, 0.66, streak), dmask)
    damp = B.math("MAXIMUM", damp, B.math("MULTIPLY", B.sm(0.62, 0.75, streak), B.math("SUBTRACT", 1.0, B.sm(0.0, 3.0, B.z))))
    col = B.mixc(B.math("MULTIPLY", damp, 0.85), col, B.mixc(0.75, col, hexlin("#5c554b"), "MULTIPLY"))
    # lichen spots on the upper wall
    lv = B.voronoi(pos, 11.0)
    spots = B.math("SUBTRACT", 1.0, B.sm(0.05, 0.2, lv.outputs["Distance"]))
    lmask = B.math("MULTIPLY", B.sm(0.52, 0.68, B.snoise(0.8, 3.0)), B.sm(1.5, 3.5, B.z))
    lich = B.math("MULTIPLY", B.math("MULTIPLY", spots, lmask), B.math("SUBTRACT", 1.0, iscore))
    lcol = B.mixc(B.sm(0.8, 0.85, B.math("FRACT", B.math("MULTIPLY", sr, 7.0))), hexlin("#a8aa8e"), hexlin("#b7934f"))
    col = B.mixc(B.math("MULTIPLY", lich, 0.7), col, lcol)
    # moss: at the foot, on the north (+Y) face, in joints and on ledges
    patch = B.snoise(1.1, 5.0, 0.6)
    moss_low = B.math("MULTIPLY", B.math("SUBTRACT", 1.0, B.sm(0.2, 1.9, zn)), B.sm(0.34, 0.54, patch))
    north = B.math("MULTIPLY", B.math("MULTIPLY", B.sm(0.2, 0.8, B.ny), B.sm(0.45, 0.62, B.snoise(0.65, 5.0))),
                   B.math("SUBTRACT", 1.0, B.math("MULTIPLY", B.sm(1.0, 7.0, B.z), 0.65)))
    joint = B.math("MULTIPLY", B.math("MULTIPLY", gr, B.sm(0.35, 0.6, patch)),
                   B.math("SUBTRACT", 1.0, B.sm(0.5, 3.0, B.z)))
    ledge = B.math("MULTIPLY", B.sm(0.55, 0.9, B.nz), B.sm(0.5, 0.64, B.snoise(1.7, 4.0)))
    moss = B.math("MAXIMUM", B.math("MAXIMUM", moss_low, north), B.math("MAXIMUM", joint, B.math("MULTIPLY", ledge, 0.85)))
    moss = B.math("MULTIPLY", moss, B.math("SUBTRACT", 1.0, ishole))
    mcol = B.ramp(B.noise(pos, 9.0, 4.0), [(0.3, "#48532a"), (0.55, "#5d6b35"), (0.75, "#727640")])
    col = B.mixc(B.math("MULTIPLY", moss, 0.92), col, mcol)
    # mud splash on the lowest ~40 cm
    mud = B.math("SUBTRACT", 1.0, B.sm(0.15, 0.6, B.math("ADD", B.z, B.math("MULTIPLY", B.math("SUBTRACT", B.snoise(4.5, 3.0), 0.5), 0.35))))
    speck = B.math("MULTIPLY", B.sm(0.62, 0.7, B.noise(pos, 38.0, 2.0)), B.math("SUBTRACT", 1.0, B.sm(0.3, 0.85, B.z)))
    mudf = B.math("MAXIMUM", B.math("MULTIPLY", mud, 0.95), B.math("MULTIPLY", speck, 0.8))
    col = B.mixc(mudf, col, B.mixc(B.noise(pos, 6.0), hexlin("#4d3c2b"), hexlin("#5f4b36")))
    l.new(col, bsdf.inputs["Base Color"])
    rough = B.math("ADD", 0.9, B.math("MULTIPLY", isd, -0.07))
    rough = B.math("ADD", rough, B.math("MULTIPLY", damp, -0.14))
    rough = B.math("ADD", rough, B.math("MULTIPLY", mudf, -0.1))
    l.new(B.math("MINIMUM", rough, 0.97), bsdf.inputs["Roughness"])
    # bump: fine grain + chips + core stones
    chips = B.voronoi(pos, 5.0).outputs["Distance"]
    hgt = B.math("ADD", B.math("MULTIPLY", B.noise(pos, 26.0, 8.0, 0.65), 0.45), B.math("MULTIPLY", B.sm(0.0, 0.5, chips), 0.25))
    hgt = B.math("ADD", hgt, B.math("MULTIPLY", mid, 0.3))
    hgt = B.math("ADD", hgt, B.math("MULTIPLY", B.math("MULTIPLY", B.sm(0.0, 0.08, ved.outputs["Distance"]), iscore), 0.8))
    hgt = B.math("ADD", hgt, B.math("MULTIPLY", B.math("MULTIPLY", B.noise(pos, 14.0, 3.0), moss), 0.4))
    bump = n.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.5; bump.inputs["Distance"].default_value = 0.025
    l.new(hgt, bump.inputs["Height"]); l.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def soil_material(seed):
    m, n, l, bsdf = L.mat("wall_soil")
    B = NB(m, seed + 7)
    kind = B.attr("skind").outputs["Fac"]; pos = B.geo.outputs["Position"]
    isrub = B.cmp(kind, 4)
    base = B.ramp(B.snoise(0.7, 4.0), [(0.3, "#4f3e2c"), (0.55, "#5a4632"), (0.75, "#6a5641")])
    dust = B.ramp(B.snoise(0.9, 4.0), [(0.3, "#6f6555"), (0.6, "#877c69"), (0.8, "#9a8f7a")])
    col = B.mixc(B.math("MULTIPLY", isrub, 0.85), base, dust)
    v = B.voronoi(pos, 16.0)
    rchip = B.sm(0.7, 0.75, B.noise(v.outputs["Color"], 1.0, 0.0))
    col = B.mixc(B.math("MULTIPLY", rchip, B.math("ADD", 0.35, B.math("MULTIPLY", isrub, 0.5))), col, hexlin("#aca28b"))
    col = B.scalec(col, B.math("ADD", 0.86, B.math("MULTIPLY", B.noise(pos, 30.0, 3.0), 0.28)))
    wet = B.sm(0.55, 0.7, B.snoise(0.5, 3.0))
    col = B.mixc(B.math("MULTIPLY", wet, 0.4), col, B.mixc(1.0, col, hexlin("#8a7a68"), "MULTIPLY"))
    grass = B.math("MULTIPLY", B.math("SUBTRACT", 1.0, B.sm(0.03, 0.25, B.z)), B.sm(0.45, 0.6, B.snoise(1.3, 5.0)))
    col = B.mixc(B.math("MULTIPLY", grass, 0.85), col, B.ramp(B.noise(pos, 20.0), [(0.3, "#4e5a2c"), (0.7, "#65703a")]))
    l.new(col, bsdf.inputs["Base Color"])
    l.new(B.math("SUBTRACT", 0.96, B.math("MULTIPLY", wet, 0.15)), bsdf.inputs["Roughness"])
    hgt = B.math("ADD", B.math("MULTIPLY", B.noise(pos, 18.0, 6.0), 0.5), B.math("MULTIPLY", rchip, 0.5))
    bump = n.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.6; bump.inputs["Distance"].default_value = 0.03
    l.new(hgt, bump.inputs["Height"]); l.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def timber_material(seed):
    m, n, l, bsdf = L.mat("wall_timber")
    B = NB(m, seed + 3)
    sr = B.attr("srand").outputs["Fac"]; kind = B.attr("skind").outputs["Fac"]
    tq = B.attr("tq").outputs["Vector"]
    base = B.ramp(sr, [(0.0, "#6b5236"), (0.3, "#8c8374"), (0.55, "#7a6a55"), (0.8, "#a08a68"), (0.92, "#c2a377")], "LINEAR")
    grain = B.noise(B.vm("MULTIPLY", tq, (1.3, 26.0, 26.0)), 1.0, 6.0, 0.6, 0.4)
    col = B.scalec(base, B.math("ADD", 0.72, B.math("MULTIPLY", grain, 0.5)))
    knots = B.sm(0.72, 0.78, B.noise(B.vm("MULTIPLY", tq, (3.0, 3.0, 3.0)), 1.0, 2.0))
    col = B.mixc(B.math("MULTIPLY", knots, 0.5), col, hexlin("#4a3a28"))
    isrope = B.cmp(kind, 1)
    col = B.mixc(isrope, col, B.scalec(hexlin("#7a6a4c"), B.math("ADD", 0.8, B.math("MULTIPLY", grain, 0.3))))
    mud = B.math("SUBTRACT", 1.0, B.sm(0.1, 0.5, B.z))
    col = B.mixc(B.math("MULTIPLY", mud, 0.7), col, hexlin("#4f3f2e"))
    l.new(col, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    bump = n.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.6; bump.inputs["Distance"].default_value = 0.01
    l.new(grain, bump.inputs["Height"]); l.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


# ------------------------------------------------------------------ seam-safe noise coordinates
def port_coords(mb, ports):
    qp, qw = [], []
    for v in mb.v:
        P = Vector(v); best = None
        for pos, axis, outw in ports:
            d = abs((P - Vector((pos[0], pos[1], 0))).dot(Vector((axis[0], axis[1], 0))))
            if best is None or d < best[0]:
                lat = (P - Vector((pos[0], pos[1], 0))).dot(Vector((outw[0], outw[1], 0)))
                best = (d, lat)
        if best is None:
            qp.append((50.0, P.y, P.z)); qw.append(1.0)
        else:
            qp.append((best[0], best[1], P.z)); qw.append(smooth(0.0, 1.5, best[0]))
    return qp, qw


def attach_qp(o, qp, qw):
    me = o.data
    a = me.attributes.new("qp", "FLOAT_VECTOR", "POINT"); a.data.foreach_set("vector", [c for t in qp for c in t])
    b = me.attributes.new("qw", "FLOAT", "POINT"); b.data.foreach_set("value", qw)


# ------------------------------------------------------------------ modules
STRAIGHT_PORTS = [((-3.0, 0.0), (-1, 0), (0, -1)), ((3.0, 0.0), (1, 0), (0, -1))]


def putlog_us(Lp, rng, corners=()):
    out = []; u = rng.uniform(0.7, 1.2)
    while u < Lp - 0.5:
        if all(abs(u - c) > 0.7 for c in corners) and rng.random() > 0.3:
            out.append(u + rng.uniform(-0.08, 0.08))
        u += rng.uniform(1.8, 2.2)
    return out


def straight_body(mb, rng, face_keep=None, top_x=None, breaks=(), walk=True, parapet=True):
    """top_x(xa, xb) -> keep? for everything above the wall-walk (x in module coords)."""
    outer = [(-3.0, -HT), (3.0, -HT)]; inner = [(3.0, HT), (-3.0, HT)]
    pu_o = putlog_us(6.0, rng); pu_i = putlog_us(6.0, rng)
    build_face(mb, outer, 0.0, Z_WALK, rng, "o", "o", [1.0], putlogs=pu_o, keep=face_keep)
    build_face(mb, inner, 0.0, Z_WALK, rng, "i", "i", [0.0], putlogs=pu_i, keep=face_keep)
    fk = tk = None
    if top_x:
        fk = lambda F, c0, c1, va, vb: top_x(F(c0, va, 0).x, F(c1, va, 0).x)
        tk = lambda F, u0, u1: top_x(u0 - 3.0, u1 - 3.0)
    if parapet:
        build_face(mb, outer, Z_WALK, Z_SILL, rng, "o", "o", keep=fk, breaks=[b + 3.0 for b in breaks])
        build_face(mb, [(3.0, -0.6), (-3.0, -0.6)], Z_WALK, Z_SILL, rng, "pi", "pi", keep=fk,
                   breaks=[3.0 - b for b in breaks])
        cpar = Poly([(-3.0, -0.9), (3.0, -0.9)])
        build_parapet(mb, cpar, [1.0, 3.0, 5.0], rng, keep_top=tk, breaks=[b + 3.0 for b in breaks])
    if walk:
        cw = Poly([(-3.0, 0.3), (3.0, 0.3)])
        build_slabs(mb, cw, 0.0, 6.0, -0.9, 0.9, Z_WALK, rng, keep=tk, breaks=[b + 3.0 for b in breaks])


def mod_straight(seed):
    rng = random.Random(seed); mb = MB()
    straight_body(mb, rng)
    for pos, axis, outw in STRAIGHT_PORTS:
        end_cap(mb, pos, outw, axis)
    return dict(stone=mb, ports=STRAIGHT_PORTS)


def mod_corner(seed):
    rng = random.Random(seed); mb = MB()
    outer = [(-3.0, -HT), (HT, -HT), (HT, 3.0)]; inner = [(-HT, 3.0), (-HT, HT), (-3.0, HT)]
    po = Poly(outer); pi = Poly(inner)
    build_face(mb, outer, 0.0, Z_WALK, rng, "o", "o", [1.0, 1.0], putlogs=putlog_us(po.L, rng, [4.2]))
    build_face(mb, inner, 0.0, Z_WALK, rng, "i", "i", [0.0, 0.0], putlogs=putlog_us(pi.L, rng, [1.8]))
    build_face(mb, outer, Z_WALK, Z_SILL, rng, "o", "o")
    build_face(mb, [(0.6, 3.0), (0.6, -0.6), (-3.0, -0.6)], Z_WALK, Z_SILL, rng, "pi", "pi")
    cpar = Poly([(-3.0, -0.9), (0.9, -0.9), (0.9, 3.0)])
    build_parapet(mb, cpar, [1.0, 2.6, 5.2, 6.8], rng)
    cw = Poly([(-3.0, 0.3), (-0.3, 0.3), (-0.3, 3.0)])
    build_slabs(mb, cw, 0.0, cw.L, -0.9, 0.9, Z_WALK, rng)
    ports = [((-3.0, 0.0), (-1, 0), (0, -1)), ((0.0, 3.0), (0, 1), (1, 0))]
    for pos, axis, outw in ports:
        end_cap(mb, pos, outw, axis)
    return dict(stone=mb, ports=ports)


def mod_end(seed):
    rng = random.Random(seed); mb = MB()
    path = [(-3.0, -HT), (3.0, -HT), (3.0, HT), (-3.0, HT)]
    pl = Poly(path)
    pu = [u for u in putlog_us(pl.L, rng, [6.0, 8.4])]
    build_face(mb, path, 0.0, Z_WALK, rng, "o", "i", [1.0, 1.0, 0.0], putlogs=pu)
    build_face(mb, [(-3.0, -HT), (3.0, -HT), (3.0, HT), (2.4, HT), (2.4, -0.6), (-3.0, -0.6)],
               Z_WALK, Z_SILL, rng, "o", "pi")
    cpar = Poly([(-3.0, -0.9), (2.7, -0.9), (2.7, HT)])
    build_parapet(mb, cpar, [1.0, 3.0, 4.8, 6.65], rng, sp=True, ep=False)
    cw = Poly([(-3.0, 0.3), (2.4, 0.3)])
    build_slabs(mb, cw, 0.0, cw.L, -0.9, 0.9, Z_WALK, rng)
    ports = [((-3.0, 0.0), (-1, 0), (0, -1))]
    end_cap(mb, ports[0][0], ports[0][2], ports[0][1])
    return dict(stone=mb, ports=ports)


def mod_end_l(seed):
    """Mirror-image end: finished end at x=-3, port at x=+3 (for the west end of a run)."""
    rng = random.Random(seed); mb = MB()
    path = [(3.0, HT), (-3.0, HT), (-3.0, -HT), (3.0, -HT)]
    pl = Poly(path)
    build_face(mb, path, 0.0, Z_WALK, rng, "i", "o", [0.0, 1.0, 1.0], putlogs=putlog_us(pl.L, rng, [6.0, 8.4]))
    build_face(mb, [(3.0, -0.6), (-2.4, -0.6), (-2.4, HT), (-3.0, HT), (-3.0, -HT), (3.0, -HT)],
               Z_WALK, Z_SILL, rng, "pi", "o")
    cpar = Poly([(-2.7, HT), (-2.7, -0.9), (3.0, -0.9)])
    build_parapet(mb, cpar, [1.15, 3.0, 4.8, 6.8], rng, sp=False, ep=True)
    cw = Poly([(-2.4, 0.3), (3.0, 0.3)])
    build_slabs(mb, cw, 0.0, cw.L, -0.9, 0.9, Z_WALK, rng)
    ports = [((3.0, 0.0), (1, 0), (0, -1))]
    end_cap(mb, ports[0][0], ports[0][2], ports[0][1])
    return dict(stone=mb, ports=ports)


def mod_breach(seed):
    rng = random.Random(seed); mb = MB(); soil = MB()
    xl = -2.0 + rng.uniform(-0.25, 0.2); xr = 2.0 + rng.uniform(-0.2, 0.25)
    xc = (xl + xr) / 2 + rng.uniform(-0.3, 0.3)
    zmin = rng.uniform(2.7, 3.2)
    jag = [rng.uniform(-0.7, 0.5) for _ in range(40)]

    def zb(x):
        if x <= xl or x >= xr:
            return Z_WALK
        t = (x - xl) / (xc - xl) if x < xc else (xr - x) / (xr - xc)
        t = max(0.0, min(1.0, t))
        k = int((x + 3.0) / 6.0 * 19)
        z = Z_WALK - (Z_WALK - zmin) * smooth(0.0, 0.85, t)
        return min(Z_WALK, z + jag[k] * smooth(0.0, 0.3, t))

    def face_keep(F, c0, c1, va, vb):
        a = F(c0, va, 0).x; b = F(c1, va, 0).x
        xm = (a + b) / 2
        if not (xl < xm < xr):
            return True
        return vb <= min(zb(a), zb(xm), zb(b)) + rng.uniform(-0.1, 0.25)

    def top_x(xa, xb):
        a, b = min(xa, xb), max(xa, xb)
        return b <= xl + 1e-4 or a >= xr - 1e-4

    straight_body(mb, rng, face_keep=face_keep, top_x=top_x, breaks=[xl, xr])
    for pos, axis, outw in STRAIGHT_PORTS:
        end_cap(mb, pos, outw, axis)
    # parapet stubs broken at the breach
    for x, ax in ((xl, 1), (xr, -1)):
        prof = [(HT, Z_WALK - 0.05), (HT, Z_SILL), (HT - 0.6, Z_SILL), (HT - 0.6, Z_WALK - 0.05)]
        end_cap(mb, (x + 0.004 * ax, 0.0), (0, -1), (ax, 0), profile=prof)
    # exposed rubble core + the V of the break
    core_top(mb, xl - 0.55, xr + 0.55, lambda x: min(Z_WALK - 0.03, zb(x) - 0.05), rng, step=0.2, skirt=3.2, lumps=0.16)
    # spill mound: most debris fell outward (the siege side, -Y)
    def mound(x, y):
        dx = x - xc
        h = 2.5 * math.exp(-(dx / 1.35) ** 2 - ((y + 1.9) / 1.35) ** 2)
        h += 1.1 * math.exp(-(dx / 1.2) ** 2 - ((y - 1.9) / 0.9) ** 2)
        h += 2.4 * math.exp(-(dx / 1.2) ** 2 - (y / 1.0) ** 2)
        h += 0.35 * math.exp(-((dx + 1.3) / 0.6) ** 2 - ((y + 3.2) / 0.7) ** 2)
        h += 0.07 * math.sin(x * 3.1 + y * 2.3) + 0.05 * math.sin(x * 5.3 - y * 4.1)
        edge = smooth(0.0, 0.5, 2.95 - abs(x))
        return max(0.0, h * edge - 0.12)
    heightfield(soil, -2.95, 2.95, -4.8, 3.3, 0.3, mound, 4,
                cull=lambda q: max(p[2] for p in q) < 0.01 or all(-1.6 < p[1] < 1.1 and p[2] < zb(p[0]) - 0.2 for p in q))
    n = 0; tries = 0
    while n < 34 and tries < 4000:
        tries += 1
        x = rng.uniform(-2.8, 2.8); y = rng.uniform(-5.3, 3.3)
        h = mound(x, y)
        if h < 0.05 or rng.random() > h / 1.6 + 0.15:
            continue
        if -HT - 0.2 < y < HT + 0.1 and h < zb(x) - 0.3:
            continue
        s = rng.uniform(0.12, 0.38) * (1.3 if rng.random() < 0.2 else 1.0)
        rock(mb, (x, y, h - s * 0.3), s, rng, kind=0 if rng.random() < 0.6 else 2)
        n += 1
    # dressed blocks that fell: merlon coping, quoins
    for _ in range(7):
        x = xc + rng.uniform(-1.8, 1.8); y = rng.uniform(-4.2, -1.9)
        rock(mb, (x, y, max(0.1, mound(x, y) - 0.05)), 0, rng, kind=1,
             box=(rng.uniform(0.45, 0.8), rng.uniform(0.3, 0.45), rng.uniform(0.25, 0.35)))
    x = xc + rng.uniform(-0.8, 0.8); y = -3.6
    rock(mb, (x, y, max(0.3, mound(x, y) + 0.1)), 0, rng, kind=1, box=(1.1, 0.6, 0.85))   # merlon chunk
    x = xl + 0.1
    while x < xr - 0.1:      # broken masonry lumps crowning the whole V
        for y in (-0.75, 0.0, 0.75):
            s = rng.uniform(0.2, 0.42)
            yy = y + rng.uniform(-0.2, 0.2)
            rock(mb, (x + rng.uniform(-0.1, 0.1), yy, zb(x) - 0.05 + s * 0.15), s, rng,
                 kind=0 if rng.random() < 0.5 else 2, squash=0.8)
        x += rng.uniform(0.35, 0.55)
    return dict(stone=mb, soil=soil, ports=STRAIGHT_PORTS, breach=(xl, xr))


def mod_build1(seed):
    rng = random.Random(seed); mb = MB(); soil = MB(); tb = MB()
    tops = [c[1] for c in COURSES if 1.8 < c[1] < 3.3]
    xs = [-3.0]; x = -3.0
    while x < 3.0:
        x += rng.uniform(1.3, 2.3); xs.append(min(x, 3.0))
    lv = []
    for i in range(len(xs) - 1):
        lv.append(tops[min(len(tops) - 1, max(0, len(tops) - 1 - i - rng.randint(0, 1)))])

    def zb(x):
        for i in range(len(xs) - 1):
            if xs[i] <= x <= xs[i + 1]:
                return lv[i]
        return lv[-1]

    def face_keep(F, c0, c1, va, vb):
        a = F(c0, va, 0).x; b = F(c1, va, 0).x
        return vb <= min(zb(a), zb((a + b) / 2), zb(b)) + 1e-4

    straight_body(mb, rng, face_keep=face_keep, walk=False, parapet=False)
    for pos, axis, outw in STRAIGHT_PORTS:
        z = zb(pos[0] * 0.999)
        prof = [(HT + PLINTH_OUT, 0.0), (HT, PLINTH_H), (HT, z), (-HT, z), (-HT, 0.0)]
        end_cap(mb, pos, outw, axis, profile=prof)
    core_top(mb, -3.0, 3.0, lambda x: zb(x) - 0.04, rng, step=0.25, skirt=0.8)
    # courses being laid: loose blocks on the top
    for _ in range(9):
        x = rng.uniform(-2.7, 2.7); y = rng.uniform(-0.8, 0.8)
        rock(mb, (x, y, zb(x) + 0.12), 0, rng, kind=1,
             box=(rng.uniform(0.35, 0.6), rng.uniform(0.25, 0.4), rng.uniform(0.2, 0.3)))
    # stone stock pile on the inner side
    for k in range(10):
        x = 1.2 + rng.uniform(-0.7, 0.9); y = 2.3 + rng.uniform(-0.3, 0.5)
        rock(mb, (x, y, 0.15 + 0.28 * (k // 5)), 0, rng, kind=1,
             box=(rng.uniform(0.45, 0.7), rng.uniform(0.3, 0.42), rng.uniform(0.25, 0.3)))
    for _ in range(14):
        x = rng.uniform(-2.6, 0.2); y = rng.uniform(1.9, 3.0)
        s = rng.uniform(0.12, 0.3)
        rock(mb, (x, y, s * 0.35), s, rng, kind=0)
    # foundation trench: dark worked earth + spoil banks either side
    def ground(x, y):
        h = 0.5 * math.exp(-((y + 3.5) / 0.5) ** 2) * (0.85 + 0.15 * math.sin(x * 2.1))
        h += 0.42 * math.exp(-((y - 3.3) / 0.45) ** 2) * (0.85 + 0.15 * math.cos(x * 1.7))
        h += 0.03 * math.sin(x * 7.1 + y * 3.3)
        edge = smooth(0.0, 0.4, 2.98 - abs(x)) * smooth(0.0, 0.4, y + 4.3) * smooth(0.0, 0.4, 4.0 - y)
        return h * edge + 0.012 * edge - 0.02
    heightfield(soil, -2.98, 2.98, -4.3, 4.0, 0.4, ground, 5,
                cull=lambda q: all(-1.7 < p[1] < 1.15 for p in q))
    # timber putlog scaffold (single row of standards, putlogs bear on the wall)
    ys = -2.35; deck = 2.0
    std = [-2.55, -0.85, 0.85, 2.55]
    for x in std:
        x += rng.uniform(-0.08, 0.08)
        top = rng.uniform(4.3, 4.9)
        pole(tb, (x, ys, -0.05), (x + rng.uniform(-0.06, 0.06), ys + rng.uniform(-0.05, 0.05), top), 0.07, rng)
        pole(tb, (x, ys - 0.1, deck - 0.06), (x, -HT + 0.02, deck - 0.06), 0.05, rng)      # putlog
        for zz in (deck - 0.14, 3.75):
            pole(tb, (x - 0.09, ys - 0.08, zz), (x + 0.09, ys - 0.08, zz), 0.085, rng, sides=6, kind=1, sr=0.5)
    for zz in (deck - 0.14, 3.75):
        pole(tb, (-2.95, ys - 0.1, zz), (2.95, ys - 0.1, zz + rng.uniform(-0.04, 0.04)), 0.055, rng)
    for i in range(3):
        for seg in ((-2.9, -0.05), (-0.05, 2.9)):
            c = ((seg[0] + seg[1]) / 2 + rng.uniform(-0.1, 0.1), -1.5 - i * 0.29 - 0.03, deck + 0.0)
            plank(tb, c, (1, rng.uniform(-0.02, 0.02), 0), (0, 1, 0), (seg[1] - seg[0] - 0.05, 0.27, 0.045), rng)
    for a, b in ((-2.55, -0.85), (0.85, 2.55)):
        pole(tb, (a, ys - 0.14, 0.05), (b, ys - 0.14, 3.7), 0.045, rng)
    # ladder
    lx = 0.0; l0 = Vector((lx, -3.45, 0.0)); l1 = Vector((lx, -2.5, deck + 0.9))
    for s in (-0.22, 0.22):
        pole(tb, l0 + Vector((s, 0, 0)), l1 + Vector((s, 0, 0)), 0.035, rng, sr=0.85)
    for k in range(1, 9):
        p = l0.lerp(l1, k / 9.2)
        pole(tb, p + Vector((-0.22, 0, 0)), p + Vector((0.22, 0, 0)), 0.02, rng, sides=5, sr=0.8)
    # mortar trough
    plank(tb, (-1.6, 2.6, 0.18), (1, 0.1, 0), (0, 1, 0), (1.2, 0.55, 0.05), rng)
    for s in (-1, 1):
        plank(tb, (-1.6, 2.6 + s * 0.27, 0.3), (1, 0.1, 0), (0, 0, 1), (1.2, 0.25, 0.04), rng)
    return dict(stone=mb, soil=soil, timber=tb, ports=STRAIGHT_PORTS)


BUILDERS = {
    "straight": lambda: mod_straight(101),
    "straight_b": lambda: mod_straight(202),
    "straight_c": lambda: mod_straight(303),
    "corner": lambda: mod_corner(404),
    "end": lambda: mod_end(505),
    "end_l": lambda: mod_end_l(515),
    "breach": lambda: mod_breach(606),
    "build1": lambda: mod_build1(707),
}


def export(module):
    L.reset(seed=hash(module) & 0xffff)
    spec = BUILDERS[module]()
    seed = sum(map(ord, module))
    mats = {"stone": stone_material(seed), "soil": soil_material(seed), "timber": timber_material(seed)}
    ports = spec["ports"]
    tris = {}
    for key in ("stone", "soil", "timber"):
        mb = spec.get(key)
        if not mb or not mb.f:
            continue
        o = mb.obj(f"wall_{key}", mats[key])
        qp, qw = port_coords(mb, ports)
        attach_qp(o, qp, qw)
        tris[key] = sum(len(f) - 2 for f in mb.f)
    print("WALL_TRIS", module, tris)
    name = "wall_stone_" + module
    path = L.finish(name, tex=TEX, lods=(1.0, 0.4, 0.12))
    return name, [dict(pos=[p[0], p[1], 0.0], axis=[a[0], a[1], 0.0], outer=[o[0], o[1], 0.0]) for p, a, o in ports]


if __name__ == "__main__":
    mods = list(BUILDERS) if MODULE == "all" else MODULE.split(",")
    kit_path = os.path.join(L.GLB_DIR, "wall_stone_kit.json")
    kit = {}
    if os.path.exists(kit_path):
        try:
            kit = json.load(open(kit_path))
        except Exception:
            kit = {}
    kit.setdefault("module_length", 6.0); kit.setdefault("modules", {})
    kit["note"] = ("Pivot = centre of the module's 6 m cell on the wall centreline, z=0 ground. "
                   "outer = direction the outer (siege) face looks at that port. Snap port to port.")
    for m in mods:
        name, ports = export(m)
        kit["modules"][name] = {"ports": ports}
        os.makedirs(L.GLB_DIR, exist_ok=True)
        json.dump(kit, open(kit_path, "w"), indent=1)
