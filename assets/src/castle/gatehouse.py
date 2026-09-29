"""Castle gatehouse — twin D-towers flanking a vaulted passage with two portcullises, gate leaves, murder
holes, guardrooms, a chamber over the passage at wall-walk height with the portcullis windlasses, rear stair
turrets and a battlemented roof.

    tools/heavy.sh /opt/homebrew/bin/blender -t 2 -b -P assets/src/castle/gatehouse.py -- [gatehouse gatehouse_pocked gatehouse_cracked gatehouse_ruin]

LOCAL FRAME (sim DIMS.gate w 17, d 15, passage 3.4): x along the curtain (the sim's a), OUTSIDE toward -Y
(the sim's +b = Blender -y). Front of the D-towers y = -8.7 (b1 = 0.58 d), rear face y = +6.3 (b0 = -0.42 d).
The curtain centreline is y = 0; its wall-walks enter the chamber through doors at x = +-8.5.
Moving nodes (origin = pivot, rest pose = CLOSED): portcullis_outer, portcullis_inner (translate +z to raise,
up to 'lift' m), gate_l (hinge at x=-1.7, open = +90 deg about z), gate_r (hinge at x=+1.7, open = -90 deg).
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import _castle as L
import _damage as D
from _dims import *

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

HW = GATE_W / 2            # 8.5
PW = GATE_PASS / 2         # 1.7
RR = (HW - PW) / 2         # 3.4  D-tower radius
TX = PW + RR               # 5.1  tower centre x
YF = -(GATE_D * 0.58 - RR)  # -5.3 centre of the D fronts (and the portal face)
YB = GATE_D * 0.42         # 6.3  rear face
F = [0.0, WALK_Z, WALK_Z + 5.5]
TOP = F[2]
Y_PO = YF + 0.9            # outer portcullis groove (just behind the 0.6 m front wall over the portal)
Y_PI = 4.6                 # inner portcullis groove
Y_GATE = YF + 1.55         # gate leaves (behind the outer portcullis)
MH_Y = [-2.9, -0.9, 1.1, 3.1]   # murder-hole slots across the vault
SPRING, VAULT_R = 3.4, None


def outline(n_arc=14):
    """Plan outline of the whole gatehouse, CCW."""
    pts = [(-HW, YB), (-HW, YF)]
    for i in range(1, n_arc):
        a = math.pi + math.pi * i / n_arc
        pts.append((-TX + RR * math.cos(a), YF + RR * math.sin(a)))
    pts += [(-PW, YF), (PW, YF)]
    for i in range(1, n_arc):
        a = math.pi + math.pi * i / n_arc
        pts.append((TX + RR * math.cos(a), YF + RR * math.sin(a)))
    pts += [(HW, YF), (HW, YB)]
    return pts


def dshape(cx, r, y_back, n=14):
    pts = [(cx - r, y_back), (cx - r, YF)]
    for i in range(1, n):
        a = math.pi + math.pi * i / n
        pts.append((cx + r * math.cos(a), YF + r * math.sin(a)))
    pts += [(cx + r, YF), (cx + r, y_back)]
    return pts


def prism_cutter(poly, z0, z1, key="rubble"):
    s = L.Solid("pc"); s.prism(poly, z0, z1, key, res=99)
    return s.to_object(recalc=True)


def cyl_cutter(cx, cy, r, z0, z1, key="rubble", n=20):
    return prism_cutter([(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)], z0, z1, key)


def portcullis(y, name):
    """Oak lattice shod with iron: 3.9 m wide (runs in the grooves), 5.0 m tall, spikes at the foot."""
    s = L.Solid(name)
    w, h = PW + 0.22, 5.0
    for i in range(9):
        x = -w + (2 * w) * i / 8
        s.box(x - 0.07, x + 0.07, y - 0.08, y + 0.08, 0.25, h, "timber", res=9)
        # iron spike shoe
        s.face([(x - 0.07, y - 0.08, 0.25), (x + 0.07, y - 0.08, 0.25), (x, y, 0.0)], "iron")
        s.face([(x + 0.07, y - 0.08, 0.25), (x + 0.07, y + 0.08, 0.25), (x, y, 0.0)], "iron")
        s.face([(x + 0.07, y + 0.08, 0.25), (x - 0.07, y + 0.08, 0.25), (x, y, 0.0)], "iron")
        s.face([(x - 0.07, y + 0.08, 0.25), (x - 0.07, y - 0.08, 0.25), (x, y, 0.0)], "iron")
    for j in range(7):
        z = 0.55 + j * (h - 0.8) / 6
        s.box(-w, w, y - 0.1, y + 0.1, z - 0.07, z + 0.07, "timber", res=9)
        s.box(-w, w, y - 0.115, y - 0.1, z - 0.03, z + 0.03, "iron", res=9)
    return s.to_object()


def gate_leaf(sign):
    """Half of the pointed portal filled with oak boards on ledges, iron straps and studs."""
    prof = L.arch_profile(2 * PW - 0.04, SPRING - 0.1, "pointed", segs=12)
    half = [p for p in prof if sign * p[0] >= -1e-6]
    half = sorted(set((round(u, 4), round(z, 4)) for u, z in half), key=lambda p: math.atan2(p[1] - 2.0, sign * p[0]))
    # build the leaf polygon: from the centre-bottom, out to the jamb, up, along the arch to the apex, down the centre
    poly = [(0.0, 0.0), (sign * (PW - 0.02), 0.0), (sign * (PW - 0.02), SPRING - 0.1)]
    arc = [p for p in prof if sign * p[0] > 0.01 and p[1] > SPRING - 0.1 + 1e-4]
    arc.sort(key=lambda p: -sign * p[0])
    poly += arc
    apex = max(prof, key=lambda p: p[1])
    poly.append((0.0, apex[1] - 0.02))
    s = L.Solid("gate")
    if sign > 0:
        poly = [(u, z) for u, z in poly]
    s.extrude(poly, (0, Y_GATE, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), -0.09, 0.09, "planks")
    for z in (0.5, 1.6, 2.7, 3.7):
        x0, x1 = sorted((0.05 * sign, sign * (PW - 0.1)))
        s.box(x0, x1, Y_GATE - 0.13, Y_GATE - 0.09, z - 0.05, z + 0.05, "iron", res=9)
    return s.to_object(recalc=True)


def windlass(sol, y):
    """A portcullis windlass: two A-frame trestles and a drum with capstan bars, over the slot."""
    for x in (-2.3, 2.3):
        for dy in (-0.55, 0.55):
            sol.box(x - 0.1, x + 0.1, y + dy - 0.1, y + dy + 0.1, F[1], F[1] + 1.4, "timber", res=9)
        sol.box(x - 0.12, x + 0.12, y - 0.7, y + 0.7, F[1] + 1.25, F[1] + 1.45, "timber", res=9)
    L.lathe(sol, 0, 0, [(0, -2.2), (0.28, -2.2), (0.28, 2.2), (0, 2.2)], "timber", segs=10) if False else None
    # the drum along x
    s = L.Solid("drum")
    n = 10
    ring = [(0.3 * math.cos(2 * math.pi * i / n), 0.3 * math.sin(2 * math.pi * i / n)) for i in range(n)]
    s.extrude(ring, (-2.2, y, F[1] + 1.35), (0, 1, 0), (0, 0, 1), (1, 0, 0), 0, 4.4, "timber")
    sol.merge(L._welded(s))
    for a in (0, math.pi / 2):
        sol.box(-1.9 - 0.05, -1.9 + 0.05, y - 0.9 * math.cos(a) - 0.05, y + 0.9 * math.cos(a) + 0.05, F[1] + 1.35 - 0.9 * math.sin(a), F[1] + 1.35 + 0.9 * math.sin(a) + 0.05, "timber", res=9)


def build(name, state):
    seed = 71 + {"intact": 0, "pocked": 100, "cracked": 200, "ruin": 300}[state]
    L.reset(seed); rng = random.Random(seed)
    OUT = outline()
    parts = {"base": [], "upper_1": [], "roof": []}
    fresh, soot = [], []

    # ---- masses: ground storey and chamber storey
    m0 = L.Solid("mass0"); m0.prism(OUT, FOUND, F[1], "ashlar", res=0.9, capkey="paving")
    mass0 = m0.to_object(recalc=True)
    m1 = L.Solid("mass1"); m1.prism(OUT, F[1], TOP, "ashlar", res=0.9, capkey="paving")
    mass1 = m1.to_object(recalc=True)
    # battered plinth swept round the outline (outer side = right of travel for a CCW outline? CCW -> outside is RIGHT)
    pl = L.Solid("plinth")
    OUTc = [Vector(p) for p in OUT]
    L.sweep(pl, OUTc[::-1] + [OUTc[-1]] if False else OUTc, [(-0.05, FOUND), (0.7, FOUND), (0.7, 0.0), (0.05, 2.6), (-0.05, 2.6)], "ashlar", closed=True, step=0.9)
    plinth = pl.to_object()

    c0, c1 = [], []
    # the passage: pointed barrel vault right through
    c0.append(L.opening_cutter((0, 0), (1, 0), (0, 1), 2 * PW, SPRING, -12.0, 12.0, kind="pointed", key="ashlar"))
    # guardrooms (D-shaped, inset by the wall) with doors from the passage
    for sg in (-1, 1):
        g = dshape(sg * TX, RR - 2.1, YB - 2.0)
        c0.append(prism_cutter([(p[0], p[1]) for p in g], 0.0, F[1] + 0.5, key="rubble"))
        c0.append(L.opening_cutter((sg * (PW + 0.7), 1.2), (0, 1), (sg, 0), 1.05, 1.95, -1.2, 1.8, kind="pointed", key="ashlar"))
        # loops in the D fronts, two heights
        for b, z in ((250 if sg < 0 else 290, 1.4), (215 if sg < 0 else 325, 1.6), (270, 4.8), (235 if sg < 0 else 305, 4.9)):
            a = math.radians(b)
            pos = (sg * TX + (RR + 0.02) * math.cos(a), YF + (RR + 0.02) * math.sin(a))
            c0 += L.slit_cutter(pos, (-math.cos(a), -math.sin(a)), (0, 0, 1), z, z + 1.5, 0, 2.1, w_slit=0.07, w_in=0.8, oillet=0.14)
    # portcullis grooves in the passage walls, rising into the chamber through slots
    for y in (Y_PO, Y_PI):
        for sg in (-1, 1):
            c0.append(L.box_cutter(sg * PW - 0.24 if sg > 0 else -PW - 0.24 + 0.0, sg * PW + 0.24 if sg > 0 else -PW + 0.24, y - 0.14, y + 0.14, -0.1, F[1] + 0.2, key="dark"))
        c0.append(L.box_cutter(-PW - 0.24, PW + 0.24, y - 0.14, y + 0.14, SPRING, F[1] + 0.2, key="dark"))
    # murder holes: slots through the vault crown into the chamber floor
    for y in MH_Y:
        c0.append(L.box_cutter(-0.9, 0.9, y - 0.2, y + 0.2, SPRING, F[1] + 0.2, key="dark"))
    # rear stair turrets' wells through the masses
    TUR = [(-6.3, YB + 0.5), (6.3, YB + 0.5)]
    for (tx, ty) in TUR:
        c0.append(cyl_cutter(tx, ty, 1.25, 0.0, F[1] + 0.3, key="rubble"))
        c1.append(cyl_cutter(tx, ty, 1.25, F[1] - 0.3, TOP + 0.3, key="rubble"))
    L.cut(mass0, c0)
    L.cut(plinth, [L.opening_cutter((0, 0), (1, 0), (0, 1), 2 * PW, SPRING, -12.0, 12.0, kind="pointed", key="ashlar")])
    # chamber over the passage: the whole storey, walls ~2 m
    c1 += [prism_cutter([(-HW + 2.0, YF + 2.0), (HW - 2.0, YF + 2.0), (HW - 2.0, YB - 2.0), (-HW + 2.0, YB - 2.0)], F[1] - 0.5, TOP + 0.5, "plaster"),
           prism_cutter([(-2.6, YB - 2.2), (2.6, YB - 2.2), (2.6, YB - 1.0), (-2.6, YB - 1.0)], F[1] - 0.5, TOP + 0.5, "plaster"),
           cyl_cutter(-TX, YF, RR - 2.0, F[1] - 0.5, TOP + 0.5, "plaster"), cyl_cutter(TX, YF, RR - 2.0, F[1] - 0.5, TOP + 0.5, "plaster"),
           prism_cutter([(-3.8, YF + 0.6), (3.8, YF + 0.6), (3.8, YF + 2.1), (-3.8, YF + 2.1)], F[1] - 0.5, TOP + 0.5, "plaster"),
           prism_cutter([(3.7, YF), (6.5, YF), (6.5, YF + 2.1), (3.7, YF + 2.1)], F[1] - 0.5, TOP + 0.5, "plaster"),
           prism_cutter([(-6.5, YF), (-3.7, YF), (-3.7, YF + 2.1), (-6.5, YF + 2.1)], F[1] - 0.5, TOP + 0.5, "plaster")]
    for (tx, ty) in TUR:
        c1.append(L.opening_cutter((tx, ty), (1, 0), (0, -1), 0.9, 1.9, 0.6, 3.2, kind="pointed", z0=F[1]))
    # doors to the wall-walks (curtain walk centre y = +0.3)
    for sg in (-1, 1):
        c1.append(L.opening_cutter((sg * HW, WALK_YC), (0, 1), (-sg, 0), 1.2, 2.0, -0.6, 2.6, kind="pointed", key="ashlar", z0=F[1]))
    # two-light windows to the bailey, loops to the field
    for x in (-3.2, 3.2):
        for dx in (-0.35, 0.35):
            c1.append(L.opening_cutter((x + dx, YB), (1, 0), (0, -1), 0.5, 1.6, -0.3, 2.3, kind="pointed", key="ashlar", z0=F[1] + 1.4))
    for sg in (-1, 1):
        for b in (240, 270, 300):
            a = math.radians(b)
            pos = (sg * TX + (RR + 0.02) * math.cos(a), YF + (RR + 0.02) * math.sin(a))
            c1 += L.slit_cutter(pos, (-math.cos(a), -math.sin(a)), (0, 0, 1), F[1] + 1.0, F[1] + 2.6, 0, 2.0, w_slit=0.07, w_in=0.8, oillet=0.14, cross=(b == 270))
    # the portcullis slots continue up the chamber's floor
    L.cut(mass1, c1)

    # floors: passage cobbles/flags, guardroom flags, timber floors over the guardrooms, chamber floor boards
    fl = L.Solid("floors0")
    fl.box(-PW, PW, -9.5, YB + 0.5, -0.3, 0.02, "paving", res=0.9, skip=("-z",))
    for sg in (-1, 1):
        fl.prism(dshape(sg * TX, RR - 2.1, YB - 2.0), -0.3, 0.02, "paving", res=0.9)
    parts["base"] += [mass0, plinth, fl.to_object()]
    f1 = L.Solid("floor1")
    for sg in (-1, 1):
        g = dshape(sg * TX, RR - 2.1, YB - 2.0)
        f1.prism(g, F[1] - 0.45, F[1] - 0.02, "timber", res=0.9, capkey="planks")
        for yy in (YF + 0.5, -1.5, 1.5, 3.5):
            f1.box(sg * TX - 1.3, sg * TX + 1.3, yy - 0.13, yy + 0.13, F[1] - 0.75, F[1] - 0.45, "timber", res=9)
    windlass(f1, Y_PO + 0.35)
    windlass(f1, Y_PI)
    parts["upper_1"] += [mass1, f1.to_object()]

    # ---- rear stair turrets with newel stairs, caps above the roof
    tur_objs = {"base": [], "upper_1": [], "roof": []}
    for i, (tx, ty) in enumerate(TUR):
        for (z0, z1, part) in ((FOUND, F[1], "base"), (F[1], TOP, "upper_1"), (TOP, TOP + 3.2, "roof")):
            s = L.Solid(f"tur{i}{part}", uv="cyl", uvc=(tx, ty, 1.9))
            L.lathe(s, tx, ty, [(1.25, z0), (1.9, z0), (1.9, z1), (1.25, z1)], "ashlar", segs=24, inner_key="rubble", cap_key="ashlar")
            o = s.to_object()
            cc = []
            if part == "base":
                cc.append(L.opening_cutter((tx, ty), (1, 0), (0, 1), 0.95, 1.9, 0.6, 2.6, kind="pointed"))
            if part == "upper_1":
                cc.append(L.opening_cutter((tx, ty), (1, 0), (0, -1), 0.9, 1.9, 0.6, 3.2, kind="pointed", z0=F[1]))
            if part == "roof":
                cc.append(L.opening_cutter((tx, ty), (1, 0), (0, -1), 0.85, 1.8, 0.6, 2.6, kind="pointed", z0=TOP))
            L.cut(o, cc)
            tur_objs[part].append(o)
        steps_s = {}

        def band(z, i=i):
            k = "base" if z < F[1] else "upper_1" if z < TOP else "roof"
            if k not in steps_s:
                steps_s[k] = L.Solid(f"st{i}{k}")
            return steps_s[k]
        L.spiral_stair(band, tx, ty, 0.18, 1.22, 0.0, TOP, math.radians(-90 if i else -90), ccw=(i == 0), rise=0.21, step_deg=25.0)
        for k, s in steps_s.items():
            tur_objs[k].append(s.to_object())
        cap = L.Solid("cap")
        L.lathe(cap, tx, ty, [(0.0, TOP + 3.1), (2.25, TOP + 3.1), (0.0, TOP + 6.0)], "slate", segs=24)
        L.lathe(cap, tx, ty, [(0.0, TOP + 5.9), (0.06, TOP + 5.9), (0.04, TOP + 6.8), (0.0, TOP + 6.8)], "iron", segs=6)
        tur_objs["roof"].append(cap.to_object())
    for k, v in tur_objs.items():
        parts[k] += v

    # ---- roof: leads, parapet all round, box machicolation over the portal
    rf = L.Solid("roof")
    rf.prism([(-HW + 0.6, YF + 0.0), (HW - 0.6, YF + 0.0), (HW - 0.6, YB - 0.6), (-HW + 0.6, YB - 0.6)], TOP - 0.45, TOP, "timber", res=1.2, capkey="lead")
    for sg in (-1, 1):
        rf.prism([(sg * TX + (RR - 0.6) * math.cos(math.pi + math.pi * i / 12), YF + (RR - 0.6) * math.sin(math.pi + math.pi * i / 12)) for i in range(13)],
                 TOP - 0.45, TOP, "timber", res=1.2, capkey="lead")
    path = [Vector(p) for p in OUT]
    # parapet centreline 0.3 inside the outline: offset to the LEFT of travel on a CCW outline = inward
    cl = L.offset_pts(path, -0.3, closed=True)
    Ltot = sum((cl[(i + 1) % len(cl)] - cl[i]).length for i in range(len(cl)))
    n = int(round(Ltot / PITCH)); p = Ltot / n
    iv = [(i * p + CRENEL_W / 2, i * p + p - CRENEL_W / 2) for i in range(n)]
    # the outside must be on the right of travel: a CCW outline has the outside on the right
    cren = L.battlements(rf, [(q.x, q.y) for q in cl], TOP, thick=0.6, breast=SILL, merlon_h=MERLON_H, merlon_w=p - CRENEL_W,
                         crenel_w=CRENEL_W, closed=True, intervals=iv, res=0.8)
    # box machicolation between the towers over the portal: a projecting parapet on three corbels, open below
    mz = TOP - 2.4
    for x in (-1.5, 0.0, 1.5):
        for (y0, z0, z1) in ((YF - 0.55, mz - 0.5, mz - 0.2), (YF - 0.95, mz - 0.2, mz + 0.05)):
            rf.box(x - 0.2, x + 0.2, y0, YF + 0.1, z0, z1, "ashlar", res=9)
    rf.box(-1.95, 1.95, YF - 1.05, YF - 0.45, mz + 0.05, TOP + SILL, "ashlar", res=0.9)
    for x0, x1 in ((-1.95, -1.55), (1.55, 1.95)):
        rf.box(x0, x1, YF - 1.05, YF + 0.05, mz + 0.05, TOP + SILL, "ashlar", res=0.9)
    roof_obj = rf.to_object()
    parts["roof"].append(roof_obj)

    # ---- moving parts
    moving = {
        "portcullis_outer": ([portcullis(Y_PO, "pc_o")], (0.0, Y_PO, 0.0)),
        "portcullis_inner": ([portcullis(Y_PI, "pc_i")], (0.0, Y_PI, 0.0)),
        "gate_l": ([gate_leaf(-1)], (-PW, Y_GATE, 0.0)),
        "gate_r": ([gate_leaf(1)], (PW, Y_GATE, 0.0)),
    }
    # ---- damage
    masonry = [mass0, mass1, plinth, roof_obj]
    extra = L.Solid("extra")
    if state in ("pocked", "cracked", "ruin"):
        cuts = {id(o): [] for o in masonry}
        for i in range(8 if state == "pocked" else 12):
            sg = rng.choice((-1, 1)); b = math.radians(rng.uniform(200, 340)); z = rng.uniform(2.5, TOP + 1.0)
            pos = (sg * TX + RR * math.cos(b), YF + RR * math.sin(b), z)
            tgt = mass0 if z < F[1] - 0.3 else mass1 if z < TOP - 0.2 else roof_obj
            cuts[id(tgt)].append(D.pock_cutter(pos, (-math.cos(b), -math.sin(b), 0), rng.uniform(0.5, 0.9), rng.uniform(0.3, 0.45), rng))
            fresh.append((pos[0], pos[1], z, 1.3))
        for o in masonry:
            L.cut(o, cuts[id(o)])
        for i in range(18):
            sg = rng.choice((-1, 1)); b = math.radians(rng.uniform(200, 340)); s = rng.uniform(0.2, 0.55); r = RR + rng.uniform(1.0, 3.5)
            L.chunk(extra, (sg * TX + r * math.cos(b), YF + r * math.sin(b), s * 0.25), (s * 1.5, s, s * 0.7), rng)
    if state in ("cracked", "ruin"):
        path = D.jagged_path((TX + 0.4, TOP + SILL), (TX - 0.3, 2.0), rng, steps=16, amp=0.25)
        for o in (mass0, mass1, roof_obj):
            L.cut(o, [D.crack_cutter(path, 0.13, 0.04, YF - RR - 0.02, 1.0, key="dark", seed=seed)])
        # scorched gate passage: soot from the fire set against the gates
        soot.append((0.0, YF - 0.2, 0.5, 2.2, 8.0))
    if state == "ruin":
        # burnt gates hang broken, one portcullis jammed half down (a separate static state; moving parts as-is)
        soot += [(0, Y_GATE, 0.2, 2.5, 7.0)]
    ex = extra.to_object() if len(extra.bm.faces) else None
    if ex:
        parts["base"].append(ex)

    Tn = lambda sg: sg * TX
    meta = {
        "kind": "gatehouse", "state": state, "mods": 3, "w": GATE_W, "d": GATE_D, "passage": GATE_PASS,
        "frame": "x along the curtain (sim a); OUTSIDE toward -y (sim +b = -y); curtain centreline y=0",
        "floors": F, "top": TOP, "parapet_top": TOP + SILL + MERLON_H + COPING,
        "bbox": [[-HW - 0.7, -(RR - YF) - 0.7 if False else YF - RR - 0.7, FOUND], [HW + 0.7, YB + 2.5, TOP + 6.8]],
        "ports": [{"p": [-HW, 0, 0], "dir": [-1, 0]}, {"p": [HW, 0, 0], "dir": [1, 0]}],
        "walks": [
            {"id": "passage", "lvl": 0, "z": 0.0, "kind": "poly", "poly": [[-PW, YF - RR], [PW, YF - RR], [PW, YB], [-PW, YB]]},
            {"id": "guard_l", "lvl": 0, "z": 0.0, "kind": "poly", "poly": [L.V2(p) for p in dshape(-TX, RR - 2.1, YB - 2.0)]},
            {"id": "guard_r", "lvl": 0, "z": 0.0, "kind": "poly", "poly": [L.V2(p) for p in dshape(TX, RR - 2.1, YB - 2.0)]},
            {"id": "chamber", "lvl": 1, "z": F[1], "kind": "poly", "poly": [[-HW + 2.0, YF + 2.0], [HW - 2.0, YF + 2.0], [HW - 2.0, YB - 2.0], [-HW + 2.0, YB - 2.0]],
             "blocked": [{"box": [-2.5, 2.5, Y_PO - 0.8, Y_PO + 0.8], "what": "outer windlass"}, {"box": [-2.5, 2.5, Y_PI - 0.8, Y_PI + 0.8], "what": "inner windlass"}]},
            {"id": "roof", "lvl": 2, "z": TOP, "kind": "poly", "poly": [[-HW + 0.7, YF], [HW - 0.7, YF], [HW - 0.7, YB - 0.7], [-HW + 0.7, YB - 0.7]]},
        ],
        "doors": [
            {"id": "walk_w", "p_out": L.V3((-HW - 0.6, WALK_YC, F[1])), "p_in": L.V3((-HW + 2.3, WALK_YC, F[1])), "width": 1.2, "surf_out": "walk", "surf_in": "chamber"},
            {"id": "walk_e", "p_out": L.V3((HW + 0.6, WALK_YC, F[1])), "p_in": L.V3((HW - 2.3, WALK_YC, F[1])), "width": 1.2, "surf_out": "walk", "surf_in": "chamber"},
            {"id": "guard_l", "p_out": L.V3((-PW + 0.2, 1.2, 0)), "p_in": L.V3((-PW - 1.5, 1.2, 0)), "width": 1.0, "surf_out": "passage", "surf_in": "guard_l"},
            {"id": "guard_r", "p_out": L.V3((PW - 0.2, 1.2, 0)), "p_in": L.V3((PW + 1.5, 1.2, 0)), "width": 1.0, "surf_out": "passage", "surf_in": "guard_r"},
        ],
        "links": [],
        "gate": {"portcullis_outer": {"y": Y_PO, "width": 2 * PW + 0.44, "height": 5.0, "lift": 5.2},
                 "portcullis_inner": {"y": Y_PI, "width": 2 * PW + 0.44, "height": 5.0, "lift": 5.2},
                 "leaves": {"y": Y_GATE, "gate_l": {"hinge": [-PW, Y_GATE], "open_deg_z": 90}, "gate_r": {"hinge": [PW, Y_GATE], "open_deg_z": -90}},
                 "murder_holes": [L.V3((0, y, SPRING + 2.3)) for y in MH_Y], "machicolation": {"x": [-1.55, 1.55], "y": YF - 0.75, "z": mz},
                 "arch": {"width": 2 * PW, "spring": SPRING}},
        "parapet": {"sill_z": TOP + SILL, "top_z": TOP + SILL + MERLON_H + COPING, "crenels": [{"p": L.V3(c[:3])} for c in cren]},
        "cutaway": "look into the chamber: hide 'roof'; into the guardrooms/passage: hide 'roof' and 'upper_1'",
    }
    for i, (tx, ty) in enumerate(TUR):
        meta["links"] += [
            {"kind": "stair", "spiral": True, "a": {"surf": "ground", "p": L.V3((tx, ty + 2.4, 0))}, "b": {"surf": "chamber", "p": L.V3((tx, ty - 2.3, F[1]))}, "width": 1, "len": round(F[1] * 2.4, 1)},
            {"kind": "stair", "spiral": True, "a": {"surf": "chamber", "p": L.V3((tx, ty - 2.3, F[1]))}, "b": {"surf": "roof", "p": L.V3((tx, ty - 2.2, TOP))}, "width": 1, "len": round((TOP - F[1]) * 2.4, 1)},
        ]
    if state == "intact":
        meta["states"] = {s: f"{name}_{s}" for s in ("pocked", "cracked", "ruin")}
    nm = name if state == "intact" else f"{name}_{state}"
    L.finish_piece(nm, parts, moving, meta=meta, lods=(1.0, 0.45), fresh=fresh, soot=soot, grime_h=2.2)


ALL = [("gatehouse", s) for s in ("intact", "pocked", "cracked", "ruin")]
if __name__ == "__main__":
    want = argv or [n if s == "intact" else f"{n}_{s}" for n, s in ALL]
    for n, s in ALL:
        if (n if s == "intact" else f"{n}_{s}") in want:
            build(n, s)
