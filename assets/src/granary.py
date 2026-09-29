"""HIGHGROUND - granary & barn, footprint 10 x 22 m.

A long timber-framed granary-barn raised clear of rats on 27 staddle stones (tapered stone
pillars under mushroom caps), oak bearers and joists, a boarded floor. Walls are feather-edged
weatherboards between exposed oak posts; a deep long-straw thatch roof, gabled over the front
(with a pitching door, hoist beam and rope) and hipped at the back. Stone steps run up along
the wall to landings that stop short of the sill - a plank bridges the rat gap - at the side
door and the front door. Sacks, a ladder to the loft, a grain shovel and spilled corn.

    blender -b -P assets/src/granary.py -- [complete|build1|build2|ruin]

Front faces -Y. 1 unit = 1 m.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _craft import *

seed(59)

# ------------------------------------------------------------------ layout
X0, X1 = -3.7, 3.7            # outer faces of the long walls (west / east)
Y0, Y1 = -10.2, 10.2          # front gable / back wall
BAY = 2.55
STAD_X = (-3.35, 0.0, 3.35)
STAD_Y = [Y0 + 0.2 + i * (Y1 - Y0 - 0.4) / 8 for i in range(9)]
ST_H = 0.68                   # staddle pillar height
CAP_T = 0.2                   # cap thickness
BEAR = ST_H + CAP_T           # underside of the bearers
FLOOR = BEAR + 0.3 + 0.18 + 0.05   # top of floor boards
SILL = FLOOR + 0.18           # top of sole plate
PLATE = SILL + 2.75           # top of wall plate
PITCH = math.radians(50)
OVER = 0.5                    # eave overhang (horizontal)
OVERX = 0.38                  # front verge overhang
HALF = (X1 - X0) / 2 + OVER   # horizontal run eave -> ridge
RZ = PLATE + ((X1 - X0) / 2) * math.tan(PITCH)       # ridge height of the thatch underside
EZ = RZ - HALF * math.tan(PITCH)
YV = Y0 - OVERX               # front verge
YH = Y1 + OVER                # back hip eave line
YR = YH - HALF                # where the ridge meets the hip
TH = 0.4                      # thatch thickness
DOOR_E = (-2.55, 0.0)         # east side door bay (y range)
POSTS_Y = [Y0 + i * BAY for i in range(9)]
SOLIDS.clear()


def extra(M, ch):
    M["thatch"] = m_thatch("thatch", moss=0.6, tones=[(0.0, "#6d5d42"), (0.35, "#837050"), (0.7, "#95805a"),
                                                      (1.0, "#9b865c")], charred=ch)
    M["thatch_ridge"] = m_thatch("thatch_ridge", [(0.0, "#7c6d4a"), (0.5, "#927e52"), (1.0, "#a28c5a")], charred=ch,
                                 moss=0.4)
    M["straw"] = m_thatch("straw", [(0.0, "#9a8456"), (0.5, "#ad9761"), (1.0, "#bba66d")], moss=0.0)
    M["board"] = m_wood("board", [(0.0, "#5a4c3c"), (0.4, "#665645"), (0.75, "#74624e"), (1.0, "#5f5141")],
                        weather_hex="#7d7466", weathered=0.5, fresh=0.0, charred=ch, grain_k=1.3)
    M["boardnew"] = m_wood("boardnew", [(0.0, "#8a6d4a"), (0.5, "#9c7d55"), (1.0, "#a98a5f")],
                           weather_hex="#9a8b72", weathered=0.25, charred=ch, grain_k=1.3)
    M["staddle"] = m_stone("staddle", [(0.0, "#9d9180"), (0.3, "#aea08a"), (0.6, "#b9ab93"), (1.0, "#958a79")],
                           "#777062", joints=False, bump=0.7, moss=1.4, charred=ch * 0.3)
    M["steps"] = m_stone("steps", [(0.0, "#8f8573"), (0.4, "#a39784"), (0.8, "#ada18c"), (1.0, "#8a806f")],
                         "#6f675b", joints=False, bump=0.8, moss=1.2, charred=ch * 0.4)
    M["sacking"] = m_cloth("sacking", "#7d6e55", "#8f7f62", weave=160.0)
    M["grain"] = m_heap("grain", [(0.1, "#8a6f45"), (0.5, "#a0834f"), (0.9, "#b39459")], 60.0, rough=0.8)
    M["chaff"] = m_heap("chaff", [(0.1, "#7a6a48"), (0.5, "#94814f"), (0.9, "#a8925b")], 30.0, rough=0.95, grass=0.3)
    M["yard"] = m_heap("yard", [(0.1, "#4a3c2d"), (0.5, "#5b4a37"), (0.9, "#6a5840")], 9.0, pebble=0.3, grass=0.6)


# ------------------------------------------------------------------ thatch with hips
def thatch_trap(bt, M, x0, x1, eave, ridge, k0=0.0, k1=0.0, thick=0.4, nx=16, ns=8, sag=0.08, lump=0.03,
                roll0=True, roll1=True, keep=None):
    """a thick thatch slope whose ends may slant in (hips): at slope distance s the slope runs
    x0 + k0*s .. x1 - k1*s in local x. roll0/roll1 = bullnosed gable verge at that end.
    keep(t_x, t_s) -> bool drops cells (burnt holes)."""
    ey, ez = eave
    ry, rz = ridge
    d = Vector((0, ry - ey, rz - ez))
    Ls = d.length
    dn = d / Ls
    nrm = Vector((1, 0, 0)).cross(dn)
    if nrm.z < 0:
        nrm = -nrm
    base = Vector((0, ey, ez))
    svals = [0.0, 0.1, 0.28] + [0.28 + (Ls - 0.28) * k / (ns - 2) for k in range(1, ns - 1)]
    ph = [R.uniform(0, 6.3) for _ in range(4)]
    NI = nx - 4
    top, bot, ltop, lbot = [], [], [], []
    for j, s_ in enumerate(svals):
        xa, xb = x0 + k0 * s_, x1 - k1 * s_
        if xb - xa < 0.06:
            m = (xa + xb) / 2
            xa, xb = m - 0.03, m + 0.03
        w = xb - xa
        o1, o2 = min(0.1, w * 0.04), min(0.26, w * 0.1)
        xs = [xa, xa + o1, xa + o2] + [xa + o2 + (w - 2 * o2) * k / NI for k in range(1, NI)] + [xb - o2, xb - o1, xb]
        for i, x in enumerate(xs):
            t = (x - xa) / w
            sg = -sag * math.sin(math.pi * t) * (0.4 + 0.6 * s_ / Ls)
            und = 0.035 * math.sin(1.7 * x + ph[0]) * math.sin(2.1 * s_ + ph[1]) + \
                0.02 * math.sin(4.3 * x + ph[2] + 1.3 * s_) + 0.015 * math.sin(3.1 * s_ + ph[3])
            th = thick * (1.0 - 0.2 * s_ / Ls) + und * lump / 0.025
            push = Vector((0, 0, 0))
            if j == 0:
                th *= 0.38; push += dn * -0.1
            elif j == 1:
                th *= 0.8; push += dn * -0.02
            if roll0 and i <= 1:
                th *= (0.45, 0.85)[i]; push += Vector((-(0.08, 0.02)[i], 0, 0))
            if roll1 and i >= len(xs) - 2:
                ii = len(xs) - 1 - i
                th *= (0.45, 0.85)[ii]; push += Vector(((0.08, 0.02)[ii], 0, 0))
            q = base + dn * s_ + Vector((x, 0, 0)) + nrm * sg
            top.append(tuple(M @ (q + push + nrm * th)))
            bot.append(tuple(M @ (q + push * 0.5)))
            ltop.append((x, s_, th))
            lbot.append((x, s_, 0.0))
    NXc = len(xs) - 1
    NS = len(svals) - 1
    W = NXc + 1
    pts = top + bot
    loc = ltop + lbot
    off = len(top)
    main, special = [], []
    for j in range(NS):
        for i in range(NXc):
            if keep and not keep((i + 0.5) / NXc, (j + 0.5) / NS):
                continue
            a = j * W + i
            main.append((a, a + 1, a + W + 1, a + W))
            main.append((off + a, off + a + W, off + a + W + 1, off + a + 1))
    for i in range(NXc):
        if keep and not keep((i + 0.5) / NXc, 0.5 / NS):
            continue
        special.append(((off + i, off + i + 1, i + 1, i), "butt"))
    for j in range(NS):
        a = j * W
        special.append(((a, a + W, off + a + W, off + a), "verge"))
        a = j * W + NXc
        special.append(((off + a, off + a + W, a + W, a), "verge"))
    if keep:
        special = [sp for sp in special if sp[1] == "butt"]
    for f, kind in special:
        nf = []
        for v in f:
            lx_, ly_, lz_ = loc[v]
            pts.append(pts[v])
            loc.append((lx_ if kind == "butt" else ly_, -0.05 - lz_, lz_ * 3.0 + (0 if kind == "butt" else lx_)))
            nf.append(len(pts) - 1)
        main.append(tuple(nf))
    bt.add(pts, main, None, None, loc)
    return Ls


def roof_thatch(keep=None):
    # long slopes: local x = world y, local y = -world x (east) / +world x (west)
    Rz = Matrix.Rotation(math.pi / 2, 4, "Z")
    Ls = HALF / math.cos(PITCH)
    kh = HALF / Ls
    for M, side in ((Rz, "east"), (Rz @ Matrix.Scale(-1, 4, (0, 1, 0)), "west")):
        kp = (lambda tx, ts, sd=side: keep(sd, tx, ts)) if keep else None
        thatch_trap(B("thatch"), M, YV, YH, (-HALF, EZ), (0.0, RZ), k0=0.0, k1=kh, thick=TH, nx=22, ns=9,
                    sag=0.09, roll0=True, roll1=False, keep=kp)
    # the hip at the back: local x = world x, local y = -world y
    Mh = Matrix.Scale(-1, 4, (0, 1, 0))
    kp = (lambda tx, ts: keep("hip", tx, ts)) if keep else None
    thatch_trap(B("thatch"), Mh, -HALF, HALF, (-YH, EZ), (-YR, RZ), k0=kh, k1=kh, thick=TH, nx=12, ns=9, sag=0.05,
                roll0=False, roll1=False, keep=kp)
    if keep:
        return
    # ridge + hip rolls
    scalloped_ridge(B("thatch_ridge"), Rz, YV + 0.14, YR + 0.1, 0.0, RZ, HALF, PITCH, thick=TH * 0.8)
    cp = math.cos(PITCH)
    for sx in (-1, 1):
        a = Vector((sx * (HALF - 0.1), YH - 0.1, EZ + TH * 0.35 / cp))
        b = Vector((0, YR + 0.15, RZ + TH * 0.95 / cp))
        cyl(B("thatch_ridge"), a, b, 0.2, 0.26, n=8)


def porch(stage="complete"):
    """gabled, thatched porch over the side door and its landing, its ridge dying into the main slope."""
    yc, hw = (DOOR_E[0] + DOOR_E[1]) / 2, 1.3
    xo = X1 + 1.25
    zt = SILL + 2.45                     # tie beam / plate
    pz = zt + hw * math.tan(math.radians(47))
    oak = B("oak")
    for sy in (-1, 1):
        y = yc + sy * hw
        box(B("steps"), (xo - 0.17, y - 0.17, 0), (xo + 0.17, y + 0.17, 0.3), 0.02)
        beam(oak, (xo, y, 0.3), (xo, y, zt), 0.18, 0.18, 0.012)
        beam(oak, (xo, y, zt - 0.05), (X1 - 0.1, y, zt - 0.05), 0.18, 0.2, 0.012)
        beam(oak, (xo, y - sy * 0.05, zt - 0.7), (xo, y - sy * 0.6, zt - 0.08), 0.12, 0.12, 0.01)
    beam(oak, (xo, yc - hw - 0.15, zt + 0.08), (xo, yc + hw + 0.15, zt + 0.08), 0.2, 0.22, 0.012)
    if stage == "frame":
        beam(oak, (xo + 0.1, yc, zt), (xo + 0.1, yc, pz), 0.14, 0.14, 0.01)
        for sy in (-1, 1):
            beam(oak, (xo + 0.1, yc + sy * hw, zt + 0.1), (xo + 0.1, yc, pz), 0.14, 0.16, 0.01)
        return
    # boarded gable triangle
    n = 10
    for i in range(n):
        y0 = yc - hw + i * 2 * hw / n
        uc = y0 + hw / n - yc
        top = zt + (pz - zt) * (1 - abs(uc) / hw) - 0.02
        if top > zt + 0.2:
            box(B("board"), (xo - 0.02, y0 + 0.005, zt + 0.18), (xo + 0.02, y0 + 2 * hw / n - 0.005, top), 0.004)
    pitch = math.radians(47)
    half = hw + 0.4
    ez = pz - half * math.tan(pitch)
    for sgn in (-1, 1):
        M = Matrix.Translation((0, yc, 0))
        if sgn > 0:
            M = M @ Matrix.Scale(-1, 4, (0, 1, 0))
        thatch_trap(B("thatch"), M, X1 - 1.4, xo + 0.35, (-half, ez), (0.0, pz), thick=0.3, nx=10, ns=6, sag=0.04,
                    roll0=False, roll1=True)
    scalloped_ridge(B("thatch_ridge"), Matrix.Identity(4), X1 - 1.45, xo + 0.25, yc, pz, half, pitch, depth=0.45, thick=0.24)


# ------------------------------------------------------------------ staddles, bearers, floor
def staddle(x, y, cap=True, lying=False):
    if lying:
        # a cap waiting on the ground, dome up, or a pillar lying on its side
        prof = [(0.44, 0.0), (0.44, 0.07), (0.38, 0.14), (0.24, 0.2), (0.0, 0.22)]
        pts = []
        for (r, z) in prof:
            for i in range(10):
                a = 2 * math.pi * i / 10
                pts.append((x + math.cos(a) * r * R.uniform(0.97, 1.03), y + math.sin(a) * r, z))
        prism_hull(B("staddle"), pts)
        return
    j = (jit(0.02), jit(0.02))
    pts = []
    for (r, z) in ((0.27, 0.0), (0.25, 0.1), (0.18, ST_H)):
        for i in range(8):
            a = 2 * math.pi * (i + 0.5) / 8 + jit(0.05)
            pts.append((x + math.cos(a) * r * R.uniform(0.95, 1.05) + (j[0] if z > 0 else 0),
                        y + math.sin(a) * r * R.uniform(0.95, 1.05) + (j[1] if z > 0 else 0), z))
    prism_hull(B("staddle"), pts)
    if not cap:
        return
    pts = []
    for (r, z) in ((0.2, ST_H - 0.02), (0.42, ST_H + 0.02), (0.45, ST_H + 0.08), (0.4, ST_H + 0.15),
                   (0.26, ST_H + CAP_T - 0.01), (0.1, ST_H + CAP_T)):
        for i in range(12):
            a = 2 * math.pi * i / 12
            pts.append((x + j[0] + math.cos(a) * r * R.uniform(0.97, 1.03), y + j[1] + math.sin(a) * r * R.uniform(0.97, 1.03),
                        z + jit(0.008)))
    prism_hull(B("staddle"), pts)


def staddles(frac=1.0, caps=1.0):
    for x in STAD_X:
        for y in STAD_Y:
            if R.random() <= frac:
                staddle(x + jit(0.03), y + jit(0.03), cap=R.random() <= caps)


def undercarriage(joists=True, floor=True, keep=1.0, char=False):
    oak = B("oak")
    for x in STAD_X:
        if R.random() <= keep or not char:
            beam(oak, (x, Y0 + 0.02, BEAR + 0.15), (x, Y1 - 0.02, BEAR + 0.15), 0.3, 0.3, 0.02, ext=0.08)
    if joists:
        for y in grid(Y0 + 0.12, Y1 - 0.12, 0.62, 0.03):
            if char and R.random() > keep:
                continue
            beam(oak, (X0 + 0.05, y, BEAR + 0.39), (X1 - 0.05, y, BEAR + 0.39), 0.14, 0.18, 0.01, ext=0.06)
    if floor:
        if not char:
            box(B("plank"), (X0 + 0.02, Y0 + 0.02, FLOOR - 0.05), (X1 - 0.02, Y1 - 0.02, FLOOR), 0.0)
        else:
            y = Y0 + 0.02
            while y < Y1 - 0.1:
                w = R.uniform(0.8, 2.4)
                if R.random() < keep:
                    box(B("plank"), (X0 + 0.02, y, FLOOR - 0.05), (X1 - R.uniform(0.02, 3.5), min(y + w, Y1), FLOOR), 0.0)
                y += w + R.uniform(0.4, 1.8)


# ------------------------------------------------------------------ walls
def faces():
    Lx, Ly = X1 - X0, Y1 - Y0
    return {"front": (Face((X0, Y0, 0), (0, -1, 0)), Lx),
            "back": (Face((X1, Y1, 0), (0, 1, 0)), Lx),
            "west": (Face((X0, Y1, 0), (-1, 0, 0)), Ly),
            "east": (Face((X1, Y0, 0), (1, 0, 0)), Ly)}


def wall_posts(name):
    f, Lh = faces()[name]
    if name in ("east", "west"):
        return f, Lh, grid(0.11, Lh - 0.11, BAY, 0.0)
    return f, Lh, [0.11, Lh * 0.36, Lh * 0.64, Lh - 0.11]


def openings(name):
    """(u0, u1, v0, v1) holes in the boarding per face."""
    f, Lh, posts = wall_posts(name)
    if name == "east":
        u0 = DOOR_E[0] - Y0 + 0.2
        return [(u0, u0 + BAY - 0.4, SILL, SILL + 2.25)] + \
            [(u - 0.25, u + 0.25, PLATE - 0.75, PLATE - 0.35) for u in (BAY * 2.5, BAY * 5.5, BAY * 7.5)]
    if name == "west":
        return [(u - 0.25, u + 0.25, PLATE - 0.75, PLATE - 0.35) for u in (BAY * 1.5, BAY * 4.5, BAY * 6.5)]
    if name == "front":
        return [(Lh / 2 - 0.62, Lh / 2 + 0.62, SILL, SILL + 2.1)]
    return []


def frame(name, top=PLATE, keep=1.0, char=False, braces=True):
    f, Lh, posts = wall_posts(name)
    oak = B("oak")
    # sole plate and wall plate
    if not char or R.random() < 0.6:
        f.timber(oak, -0.04, FLOOR + 0.09, Lh + 0.04, FLOOR + 0.09, 0.2, 0.22, -0.07)
    for u in posts:
        if R.random() > keep:
            continue
        t = top if not char else SILL + (top - SILL) * R.uniform(0.25, 1.0)
        f.timber(oak, u, SILL - 0.02, u, t, 0.22, 0.2, -0.08)
    if top >= PLATE - 0.01 and not char:
        f.timber(oak, -0.08, PLATE - 0.1, Lh + 0.08, PLATE - 0.1, 0.22, 0.24, -0.08)
    if braces:
        # tension braces in the end bays (inside the boarding: only seen in the build/ruin states)
        for (ua, ub) in ((posts[0], posts[1]), (posts[-1], posts[-2])):
            if R.random() <= keep:
                f.timber(oak, ua, SILL + 0.1, ub, PLATE - 0.3 if not char else SILL + 1.2, 0.15, 0.14, 0.1)
        f.timber(oak, 0.0, SILL + 1.35, Lh, SILL + 1.35, 0.16, 0.16, 0.1)


def boarding(name, z1=PLATE - 0.22, keep=None, ragged=False):
    """feather-edged weatherboards between the posts, lapped, each laid a little differently."""
    f, Lh, posts = wall_posts(name)
    ops = openings(name)
    exp = 0.19
    for a, b in zip(posts[:-1], posts[1:]):
        u0, u1 = a + 0.1, b - 0.1
        z = SILL + 0.01
        while z < z1 - 0.02:
            v0, v1 = z, min(z + exp + 0.05, z1)
            zc = (v0 + v1) / 2
            if keep and not keep(u0 / Lh, (zc - SILL) / (PLATE - SILL)):
                z += exp
                continue
            segs = [(u0, u1)]
            for (oa, ob, ova, ovb) in ops:
                if ova - 0.02 < zc < ovb + 0.02:
                    new = []
                    for (s0, s1) in segs:
                        if s1 <= oa or s0 >= ob:
                            new.append((s0, s1)); continue
                        if s0 < oa: new.append((s0, oa))
                        if s1 > ob: new.append((ob, s1))
                    segs = new
            for (s0, s1) in segs:
                if s1 - s0 < 0.05:
                    continue
                e0 = s0
                if ragged:
                    s1 = s0 + (s1 - s0) * R.uniform(0.3, 1.0)
                bt = B("boardnew") if R.random() < 0.06 else B("board")
                dz = jit(0.008)
                prof = [(-0.045, v0 + dz), (-0.012, v0 + dz), (0.0, v1 + dz), (-0.014, v1 + dz)]
                f.prism_dv(bt, prof, e0 + 0.004, s1 - 0.004)
            z += exp
    # dark backing behind the openings, frames round them (only once the wall is fully boarded)
    for (oa, ob, ova, ovb) in (ops if keep is None and z1 > PLATE - 0.5 else []):
        f.box(B("dark"), oa - 0.02, ob + 0.02, 0.12, 0.16, ova, ovb)
        f.timber(B("oak"), oa - 0.05, ovb + 0.05, ob + 0.05, ovb + 0.05, 0.12, 0.12, -0.06)
        if ovb - ova < 0.6:
            f.timber(B("oak"), oa - 0.05, ova - 0.05, ob + 0.05, ova - 0.05, 0.1, 0.1, -0.06)
            # little top-hung shutter propped open
            beam(B("plank"), f.p((oa + ob) / 2, -0.06, ovb + 0.02), f.p((oa + ob) / 2, -0.38, ova + 0.08),
                 ob - oa + 0.06, 0.03, 0.004, side=f.n)


def gable_front(z0=PLATE - 0.22, keep=None, loft=True):
    """boarded front gable triangle (vertical boards) with the loft pitching door and hoist beam."""
    f = Face((X0, Y0, 0), (0, -1, 0))
    Lh = X1 - X0
    tn = math.tan(PITCH)
    n = 26
    bw = Lh / n
    dz0, dz1 = z0, None
    for i in range(n):
        u = i * bw
        uc = u + bw / 2 - Lh / 2
        top = RZ - abs(uc) * tn - 0.02
        if top < z0 + 0.05:
            continue
        segs = [(z0, top)]
        if loft and abs(uc) < 0.6:
            segs = [(z0, PLATE + 0.12), (PLATE + 1.5, top)]
        for (a, b) in segs:
            if b - a < 0.05:
                continue
            if keep and not keep((u + bw / 2) / Lh, (b - PLATE) / (RZ - PLATE)):
                continue
            f.box(B("board"), u + 0.006, u + bw - 0.006, -0.03, 0.0, a, b, 0.004, tilt=jit(0.01))
    # cover fillet over the boards' butt joints + tie beam
    f.timber(B("oak"), -0.1, PLATE - 0.1, Lh + 0.1, PLATE - 0.1, 0.24, 0.24, -0.08)
    if not loft:
        return
    f.box(B("dark"), Lh / 2 - 0.62, Lh / 2 + 0.62, 0.1, 0.14, PLATE + 0.1, PLATE + 1.52)
    f.timber(B("oak"), Lh / 2 - 0.66, PLATE + 1.54, Lh / 2 + 0.66, PLATE + 1.54, 0.12, 0.14, -0.07)
    for sg in (-1, 1):
        f.timber(B("oak"), Lh / 2 + sg * 0.66, PLATE + 0.02, Lh / 2 + sg * 0.66, PLATE + 1.6, 0.12, 0.14, -0.07)
    # one leaf open against the gable
    for k in range(4):
        u = Lh / 2 + 0.7 + k * 0.155
        f.box(B("plank"), u, u + 0.15, -0.09, -0.05, PLATE + 0.14, PLATE + 1.48, 0.004)
    # hoist beam through the apex with pulley and rope
    hz = RZ - 0.55
    beam(B("oak"), f.p(Lh / 2, 1.2, hz), f.p(Lh / 2, -1.05, hz), 0.2, 0.22, 0.015)
    pb = f.p(Lh / 2, -0.92, hz - 0.3)
    box(B("oak"), pb - Vector((0.06, 0.1, 0.1)), pb + Vector((0.06, 0.1, 0.1)), 0.02)
    cyl(B("iron"), pb - Vector((0.08, 0, 0.02)), pb + Vector((0.08, 0, -0.02)), 0.09, n=10)
    return f, Lh, pb


# ------------------------------------------------------------------ steps
def steps_east():
    """stone stair running along the east wall up to a landing that stops short of the sill."""
    st = B("steps")
    xa, xb = X1 + 0.28, X1 + 1.1
    ya, yb = DOOR_E[0] + 0.1, DOOR_E[1] - 0.1
    top = FLOOR - 0.08
    # landing: a big slab on a rubble plinth
    box(B("rubble"), (xa + 0.04, ya + 0.05, 0), (xb - 0.04, yb - 0.05, top - 0.14))
    box(st, (xa, ya, top - 0.15), (xb, yb, top), 0.02)
    n = 5
    rise = top / (n + 1)
    for k in range(n):
        z = rise * (k + 1)
        y1 = ya - (n - 1 - k) * 0.34
        box(B("rubble"), (xa + 0.05, y1 - 0.34, 0), (xb - 0.05, y1, z - 0.1))
        box(st, (xa + jit(0.02), y1 - 0.36, z - 0.12), (xb + jit(0.02), y1 + 0.02, z), 0.02, rot=(0, 0, jit(0.01)))
    # plank across the rat gap
    beam(B("plank"), (X1 - 0.05, (ya + yb) / 2 - 0.3, FLOOR - 0.02), (xa + 0.35, (ya + yb) / 2 - 0.3, top + 0.02),
         0.35, 0.05, 0.004, side=(0, 0, 1))
    beam(B("plank"), (X1 - 0.05, (ya + yb) / 2 + 0.2, FLOOR - 0.02), (xa + 0.35, (ya + yb) / 2 + 0.2, top + 0.02),
         0.35, 0.05, 0.004, side=(0, 0, 1))


def steps_front():
    st = B("steps")
    ya, yb = Y0 - 0.95, Y0 - 0.28
    xa, xb = -0.85, 0.85
    top = FLOOR - 0.08
    box(B("rubble"), (xa + 0.05, ya + 0.04, 0), (xb - 0.05, yb - 0.04, top - 0.14))
    box(st, (xa, ya, top - 0.15), (xb, yb, top), 0.02)
    n = 5
    rise = top / (n + 1)
    for k in range(n):
        z = rise * (k + 1)
        x1 = xa - (n - 1 - k) * 0.33
        box(B("rubble"), (x1 - 0.33, ya + 0.05, 0), (x1, yb - 0.05, z - 0.1))
        box(st, (x1 - 0.35, ya + jit(0.02), z - 0.12), (x1 + 0.02, yb + jit(0.02), z), 0.02, rot=(0, 0, jit(0.01)))
    beam(B("plank"), (-0.25, Y0 + 0.05, FLOOR - 0.02), (-0.25, yb - 0.3, top + 0.02), 0.34, 0.05, 0.004, side=(0, 0, 1))
    beam(B("plank"), (0.2, Y0 + 0.05, FLOOR - 0.02), (0.2, yb - 0.3, top + 0.02), 0.34, 0.05, 0.004, side=(0, 0, 1))


def doors():
    # east: two ledged leaves, the right one swung out
    f, Lh, _ = wall_posts("east")
    u0 = DOOR_E[0] - Y0 + 0.2
    u1 = u0 + BAY - 0.4
    um = (u0 + u1) / 2
    for i in range(5):
        a = u0 + i * (um - u0) / 5
        f.box(B("plank"), a + 0.004, a + (um - u0) / 5 - 0.004, 0.04, 0.08, SILL, SILL + 2.22, 0.004)
    for vv in (SILL + 0.3, SILL + 1.8):
        f.box(B("oak"), u0 + 0.05, um - 0.05, 0.08, 0.12, vv, vv + 0.14, 0.01)
    hinge = f.p(u1, -0.04, 0)
    ang = math.radians(118)
    dd = -f.al * math.cos(ang) + f.n * math.sin(ang)
    for i in range(5):
        p = hinge + dd * (0.03 + i * (um - u0) / 5 + 0.08)
        beam(B("plank"), Vector((p.x, p.y, SILL)), Vector((p.x, p.y, SILL + 2.22)), (um - u0) / 5 - 0.008, 0.04, 0.004,
             side=Vector((0, 0, 1)).cross(dd))
    # front: a single boarded door, shut, with strap hinges
    ff, Lf, _ = wall_posts("front")
    for i in range(6):
        a = Lf / 2 - 0.62 + i * 1.24 / 6
        ff.box(B("plank"), a + 0.004, a + 1.24 / 6 - 0.004, 0.02, 0.06, SILL, SILL + 2.1, 0.004)
    for vv in (SILL + 0.35, SILL + 1.65):
        ff.box(B("iron"), Lf / 2 - 0.58, Lf / 2 + 0.3, -0.005, 0.02, vv, vv + 0.06)


# ------------------------------------------------------------------ props
def ladder(p0, p1, w=0.42, rung=0.3, mat="pole"):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    side = d.cross(Vector((0, 0, 1))).normalized() * (w / 2)
    for s in (-1, 1):
        cyl(B(mat), p0 + side * s, p1 + side * s, 0.03, n=6)
    n = int(d.length / rung)
    for k in range(1, n):
        q = p0 + d * (k / n)
        cyl(B(mat), q - side * 1.08, q + side * 1.08, 0.018, n=5)


def sack_pile(cx, cy, n=6, rot=0.0, z=0.0):
    k = 0
    ca, sa = math.cos(rot), math.sin(rot)
    for row, cnt in enumerate((3, 2, 1)):
        for i in range(cnt):
            if k >= n:
                return
            x = (i - (cnt - 1) / 2) * 0.46 + jit(0.03)
            y = jit(0.05)
            sack((cx + x * ca - y * sa, cy + x * sa + y * ca, z + row * 0.3), 0.44, 0.62, 0.32,
                 rot=rot + math.pi / 2 + jit(0.25), tie=False)
            k += 1


def sheaf(p, lean=0.0, rot=0.0, h=1.0):
    """a bound sheaf of corn standing on its butts."""
    p = Vector(p)
    a = Vector((math.cos(rot) * lean, math.sin(rot) * lean, 1)).normalized()
    cyl(B("straw"), p, p + a * h * 0.55, 0.13, 0.1, n=8)
    cyl(B("straw"), p + a * h * 0.55, p + a * h, 0.1, 0.17, n=8)
    cyl(B("rope"), p + a * h * 0.5, p + a * h * 0.58, 0.105, n=8)


def stook(cx, cy):
    for k in range(8):
        a = 2 * math.pi * k / 8
        sheaf((cx + math.cos(a) * 0.28, cy + math.sin(a) * 0.28, 0), lean=0.28, rot=a + math.pi, h=1.05)


def yealms(cx, cy, n=10, rot=0.0):
    """bundles of combed straw for the thatcher."""
    ca, sa = math.cos(rot), math.sin(rot)
    for k in range(n):
        row = k // 4
        i = k % 4
        x, y = (i - 1.5) * 0.36 + row * 0.18, 0.0
        z = 0.16 + row * 0.26
        c = Vector((cx + x * ca - y * sa, cy + x * sa + y * ca, z))
        d = Vector((-sa, ca, 0)) * 0.7
        cyl(B("straw"), c - d, c + d, 0.15, 0.17, n=8)
        cyl(B("rope"), c - d * 0.3, c - d * 0.22, 0.155, n=8)


def props_complete():
    # sacks by the side door and on the landing
    sack_pile(X1 + 0.75, -3.9, 5, rot=math.pi / 2)
    sack((X1 + 0.6, -1.9, FLOOR - 0.08), 0.42, 0.38, 0.62, rot=0.3)
    sack((X1 + 0.95, -1.35, FLOOR - 0.08), 0.42, 0.38, 0.58, rot=1.1)
    mound(B("grain"), X1 + 0.8, -2.9, 0.4, 0.3, 0.035, rings=2, segs=10, noise=0.3)
    # ladder up to the loft door; sack on the rope
    ladder((1.65, Y0 - 0.78, 0.0), (1.0, Y0 - 0.08, PLATE + 0.9), w=0.44)
    # sheaves stooked along the west side, spilt chaff under the floor
    stook(X0 - 0.6, 5.5)
    stook(X0 - 0.55, 7.3)
    for i in range(6):
        mound(B("chaff"), R.uniform(X0 + 0.5, X1 - 0.5), R.uniform(Y0 + 1, Y1 - 1), R.uniform(0.4, 0.9),
              R.uniform(0.3, 0.7), 0.03, rings=2, segs=10, noise=0.35)
    barrel((X0 - 0.5, -7.5, 0), 0.3, 0.78)
    barrel((X0 - 0.45, -6.8, 0), 0.28, 0.72)
    tool((X1 + 0.35, 1.2, 0.0), (X1 + 0.05, 1.45, 1.35), "shovel")


# ------------------------------------------------------------------ states
def complete():
    ground_pad(0, 0, 4.45, 10.3, "yard", h=0.03)
    staddles()
    undercarriage()
    for n in ("front", "back", "west", "east"):
        frame(n, braces=False)
        boarding(n)
    gable_front()
    doors()
    roof_thatch()
    steps_east()
    steps_front()
    porch()
    props_complete()
    # rope + sack hanging from the loft hoist
    f = Face((X0, Y0, 0), (0, -1, 0))
    pb = f.p((X1 - X0) / 2, -0.92, RZ - 0.85)
    cyl(B("rope"), pb, pb - Vector((0, 0, 1.4)), 0.015, n=5)
    sack(pb - Vector((0, 0, 2.05)), 0.44, 0.4, 0.66, rot=0.4)


def build1():
    ground_pad(0, 0, 4.45, 10.3, "yard", h=0.03)
    ground_pad(0, 0, 4.4, 10.6, "soil", h=0.035)
    # the staddles are set out: bases in, about half capped, the rest of the caps on the ground
    staddles(frac=0.85, caps=0.45)
    for (x, y) in ((X0 - 0.6, -8.0), (X0 - 0.7, -6.9), (X0 - 0.5, -5.8), (X1 + 0.6, 6.0), (X1 + 0.7, 7.1)):
        staddle(x, y, lying=True)
    # first bearer laid along the middle row
    beam(B("oak"), (0.0, Y0 + 0.02, BEAR + 0.15), (0.0, -1.0, BEAR + 0.15), 0.3, 0.3, 0.02, ext=0.08)
    # pegs and lines for the wall lines
    pegs = [(X0 - 0.4, Y0 - 0.4), (X1 + 0.4, Y0 - 0.4), (X1 + 0.4, Y1 + 0.4), (X0 - 0.4, Y1 + 0.4)]
    for (x, y) in pegs + [(0.0, Y0 - 0.45), (0.0, Y1 + 0.45)]:
        cyl(B("plank"), (x, y, 0), (x + jit(0.03), y + jit(0.03), 0.75), 0.035, 0.02, n=5)
    for i in range(4):
        a, b = pegs[i], pegs[(i + 1) % 4]
        beam(B("rope"), (a[0], a[1], 0.6), (b[0], b[1], 0.6), 0.012, 0.012, 0.0)
    # squared oak for the frame, a sawn stack of boards and the staddle stones still to set
    for k in range(3):
        for r in range(2 if k < 2 else 1):
            beam(B("oak"), (X1 + 0.45 + k * 0.3, -9.2 + r * 0.0, 0.14 + r * 0.26),
                 (X1 + 0.45 + k * 0.3 + jit(0.05), 3.5 + jit(0.3), 0.14 + r * 0.26), 0.26, 0.26, 0.015)
    plank_stack(X0 - 1.15, 1.0, 5.5, 0.9, 4, along_x=False, mat="fresh")
    stone_pile(X0 - 0.4, 8.7, 10, 0.7)
    tool((X1 + 0.3, -9.8, 0.0), (X1 + 0.1, -9.5, 1.3), "shovel")


def build2():
    ground_pad(0, 0, 4.45, 10.3, "yard", h=0.03)
    staddles()
    undercarriage()
    top_frac = 1.0
    for n in ("front", "back", "west", "east"):
        frame(n, braces=True)
    # boarding going on from the bottom up: lower courses only, ragged top
    for n in ("west", "front"):
        boarding(n, z1=SILL + 1.2, keep=lambda tu, tv: R.random() < 0.95)
    boarding("east", z1=SILL + 0.8, keep=lambda tu, tv: tu < 0.55 and R.random() < 0.9)
    # tie beams and rafters on the southern two-thirds; the hip end still open
    oak = B("oak")
    tn = math.tan(PITCH)
    for y in POSTS_Y:
        beam(oak, (X0 - 0.05, y + 0.11, PLATE + 0.1), (X1 + 0.05, y + 0.11, PLATE + 0.1), 0.22, 0.24, 0.015)
    for y in grid(Y0 + 0.2, 3.5, 0.6, 0.02):
        for sx in (-1, 1):
            beam(oak, (sx * (X1 + OVER * 0.6), y, PLATE + 0.05 - OVER * 0.6 * tn),
                 (0.0, y, RZ - 0.06), 0.1, 0.14, 0.01, side=(0, 1, 0))
    beam(oak, (0, Y0 + 0.1, RZ - 0.02), (0, 3.6, RZ - 0.02), 0.16, 0.22, 0.012)
    for sx in (-1, 1):
        for t in (0.3, 0.62):
            x = sx * (X1 - 0.2) * (1 - t)
            z = PLATE + (X1 - abs(x)) * tn + 0.08
            beam(B("plank"), (x, Y0 - 0.1, z), (x, 3.4, z), 0.06, 0.03, 0.0)
    # scaffold poles and ladders at the front gable, ladder on the east
    for (x, y) in ((-2.6, Y0 - 1.0), (2.6, Y0 - 1.0), (-2.6, Y0 - 0.2), (2.6, Y0 - 0.2)):
        cyl(B("pole"), (x, y, 0), (x + jit(0.1), y + jit(0.1), PLATE + 2.1), 0.07, 0.055, n=6)
    for z in (SILL + 1.6, PLATE + 0.4):
        for x in (-2.6, 2.6):
            cyl(B("pole"), (x, Y0 - 1.1, z), (x, Y0 - 0.1, z), 0.05, n=6)
        beam(B("plank"), (-2.9, Y0 - 0.62, z + 0.06), (2.9, Y0 - 0.62, z + 0.06), 0.3, 0.04, 0.0, side=(0, 0, 1))
        beam(B("plank"), (-2.9, Y0 - 0.3, z + 0.06), (2.9, Y0 - 0.3, z + 0.06), 0.3, 0.04, 0.0, side=(0, 0, 1))
        cyl(B("pole"), (-2.9, Y0 - 1.05, z), (2.9, Y0 - 1.05, z), 0.05, n=6)
    ladder((3.1, Y0 - 1.5, 0), (2.9, Y0 - 1.0, PLATE + 1.2), w=0.44)
    ladder((X1 + 1.1, 5.0, 0), (X1 + 0.2, 5.3, PLATE - 0.2), w=0.44)
    steps_east()
    porch(stage="frame")
    # yealms of straw waiting for the thatcher, and more boards
    yealms(X0 - 0.55, -6.0, 12, rot=math.pi / 2)
    yealms(X0 - 0.5, 5.5, 8, rot=math.pi / 2)
    plank_stack(X1 + 0.35, 4.5, 4.2, 0.8, 3, along_x=False, mat="fresh")
    sack_pile(X1 + 0.75, -5.0, 3, rot=math.pi / 2)


def ruin():
    ground_pad(0, 0, 4.45, 10.3, "yard", h=0.03)
    ground_pad(0.3, 1.0, 4.5, 9.5, "ash", h=0.05, rot=0.05)
    staddles(frac=1.0, caps=0.93)
    undercarriage(keep=0.55, char=True)
    for n in ("front", "back", "west", "east"):
        frame(n, keep=0.7, char=True, braces=True)
    # scraps of boarding still nailed on low down
    for n in ("west", "east", "front"):
        boarding(n, z1=SILL + 1.4, keep=lambda tu, tv: R.random() < 0.35, ragged=True)
    # the front gable frame and one truss still stand, blackened
    oak = B("oak")
    tn = math.tan(PITCH)
    for y in (Y0 + 0.11, Y0 + BAY + 0.11):
        beam(oak, (X0 - 0.05, y, PLATE + 0.1), (X1 + 0.05, y, PLATE + 0.1), 0.22, 0.24, 0.015)
        beam(oak, (X0 + 0.1, y, PLATE + 0.1), (0.0, y, RZ - 0.3), 0.18, 0.2, 0.012, side=(0, 1, 0))
        if y < Y0 + 1:
            beam(oak, (X1 - 0.1, y, PLATE + 0.1), (0.25, y, RZ - 0.6), 0.18, 0.2, 0.012, side=(0, 1, 0))
    for i in range(7):
        y = Y0 + 0.4 + i * 0.6
        sx = R.choice((-1, 1))
        a = Vector((sx * X1, y, PLATE + 0.05))
        b = a.lerp(Vector((0, y + jit(0.2), RZ)), R.uniform(0.25, 0.7))
        beam(oak, a, b, 0.1, 0.14, 0.01)
    # the burnt thatch fell in: sodden black heaps on what is left of the floor and along the walls
    for i in range(9):
        y = R.uniform(Y0 + 1.5, Y1 - 1.5)
        on_floor = R.random() < 0.5
        mound(B("thatch"), R.uniform(-2.2, 2.2) if on_floor else R.choice((X0 - 0.6, X1 + 0.6)), y,
              R.uniform(0.9, 1.6), R.uniform(0.8, 1.5), R.uniform(0.25, 0.5), rings=3, segs=14, noise=0.3, lumpy=0.05,
              z0=0.0)
    # collapsed timbers, heaps of burnt thatch and spilled, blackened grain
    for i in range(14):
        x, y = R.uniform(-3.0, 3.0), R.uniform(-6.0, 9.0)
        a = R.uniform(0, math.pi)
        l = R.uniform(2.0, 4.5)
        beam(oak, (x, y, R.uniform(0.2, FLOOR)), (x + math.cos(a) * l, y + math.sin(a) * l, R.uniform(0.1, 1.6)), 0.18,
             0.2, 0.012)
    for i in range(7):
        mound(B("ash"), R.uniform(-2.8, 2.8), R.uniform(-5.0, 9.0), R.uniform(0.8, 1.6), R.uniform(0.6, 1.3),
              R.uniform(0.15, 0.4), rings=3, segs=14, noise=0.25, lumpy=0.03)
    for i in range(4):
        mound(B("grain"), R.uniform(-2.5, 2.5), R.uniform(-8.0, 8.0), R.uniform(0.5, 0.9), R.uniform(0.4, 0.8), 0.08,
              rings=2, segs=12, noise=0.3)
    steps_east()
    steps_front()
    for i in range(5):
        sack((X1 + R.uniform(0.3, 1.1), R.uniform(-5.0, -3.3), 0), 0.44, 0.4, 0.26, rot=R.uniform(0, 3), tie=False)


build_materials(extra)
{"complete": complete, "build1": build1, "build2": build2, "ruin": ruin}[STATE]()
run("granary", tex=2048)
