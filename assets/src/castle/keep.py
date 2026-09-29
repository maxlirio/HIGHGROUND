"""The great tower (keep): 20 x 20 m, walls 3 m, storeys [0, 6, 13.5, 21] — a vaulted-dark store, the hall
(entered on the first floor from a forebuilding stair), the great chamber, and a leaded roof walk behind a
battlemented parapet with four corner turrets. Clasping corner buttresses, pilasters, a battered plinth.

    tools/heavy.sh /opt/homebrew/bin/blender -t 2 -b -P assets/src/castle/keep.py -- [keep keep_pocked keep_cracked keep_ruin]

LOCAL FRAME = the sim's keep frame (js/sim/castle.js, render/castle.js buildKeep): x = a, y = b, origin at the
centre. The forebuilding stands on the -y face ("side 0"); rotate the piece by 90 deg steps so that face looks
toward the bailey centre (side 1 -> +90 deg, side 2 -> 180, side 3 -> 270). Internal stairs climb along the
x = +ihw wall, alternately toward +y and -y, through a well left open in each floor (as the sim's links).
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import _castle as L
import _damage as D
from _dims import *

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
HW, HD, TH = KEEP_W / 2, KEEP_D / 2, KEEP_TH
IHW, IHD = HW - TH, HD - TH
F = KEEP_FLOORS
TOP = F[3]
SW = 1.5
SA = IHW - SW / 2 - 0.1          # stair centre line x
FL0, FL1 = -IHD + 0.5, IHD - 0.5
WELL_X0 = IHW - SW - 0.3
# forebuilding (sim: run = max(3, (F1-0.2)/0.2*0.3), u0 = -half+1.2, doorU = min(half-2, u1+1.6))
RUN = max(3.0, (F[1] - 0.2) / 0.2 * 0.3)
U0 = -HW + 1.2; U1 = U0 + RUN; DOOR_U = min(HW - 2, U1 + 1.6)
STORE_U = HW - 2.5


def walls(sol, z0, z1, res=0.9, key="ashlar", inner="plaster"):
    """The four walls of a storey as boxes (outer faces ashlar, inner faces plaster/rubble)."""
    sol.box(-HW, HW, -HD, -IHD, z0, z1, key, res=res, keys={"+y": inner, "+z": "paving", "-z": "rubble"})
    sol.box(-HW, HW, IHD, HD, z0, z1, key, res=res, keys={"-y": inner, "+z": "paving", "-z": "rubble"})
    sol.box(-HW, -IHW, -IHD, IHD, z0, z1, key, res=res, keys={"+x": inner, "+z": "paving", "-z": "rubble", "-y": "rubble", "+y": "rubble"})
    sol.box(IHW, HW, -IHD, IHD, z0, z1, key, res=res, keys={"-x": inner, "+z": "paving", "-z": "rubble", "-y": "rubble", "+y": "rubble"})


def buttresses(sol, z0, z1):
    """Pilasters at mid-face and clasping buttresses at the corners (0.5 m projection)."""
    P = 0.5
    for s in (-1, 1):
        sol.box(-0.9, 0.9, s * HD if s > 0 else -HD - P, HD + P if s > 0 else -HD, z0, z1, "ashlar", res=0.9)
        sol.box(s * HW if s > 0 else -HW - P, HW + P if s > 0 else -HW, -0.9, 0.9, z0, z1, "ashlar", res=0.9)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x0, x1 = sorted((sx * (HW - 1.4), sx * (HW + P)))
            y0, y1 = sorted((sy * HD, sy * (HD + P)))
            sol.box(x0, x1, y0, y1, z0, z1, "ashlar", res=0.9)
            x0, x1 = sorted((sx * HW, sx * (HW + P)))
            y0, y1 = sorted((sy * (HD - 1.4), sy * (HD + P)))
            sol.box(x0, x1, y0, y1, z0, z1, "ashlar", res=0.9)


def window2(cuts, face, t, z, w=0.45, h=1.5, gap=0.3, depth=TH + 0.6, kind="round"):
    """A two-light window (two narrow arched lights) with a wide splayed rear arch."""
    ax, ay, ox, oy, nx, ny = face_frame(face)
    for d in (-gap / 2 - w / 2, gap / 2 + w / 2):
        px, py = ox + ax * (t + d), oy + ay * (t + d)
        cuts.append(L.opening_cutter((px, py), (ax, ay), (-nx, -ny), w, h, -0.3, 1.0, kind=kind, z0=z))
    px, py = ox + ax * t, oy + ay * t
    cuts.append(L.opening_cutter((px, py), (ax, ay), (-nx, -ny), 2 * w + gap + 0.7, h + 0.2, 0.8, depth, kind="round", z0=z - 0.3, key="plaster"))


def loop(cuts, face, t, z, h=1.4):
    ax, ay, ox, oy, nx, ny = face_frame(face)
    px, py = ox + ax * t, oy + ay * t
    cuts += L.slit_cutter((px + nx * 0.02, py + ny * 0.02), (-nx, -ny), (0, 0, 1), z, z + h, 0, TH, w_slit=0.08, w_in=0.9, oillet=0.15)


def face_frame(face):
    """face 0 = -y, 1 = +x, 2 = +y, 3 = -x (as the sim). Returns along (a), origin on the face centre, outward n."""
    return {0: (1, 0, 0, -HD, 0, -1), 1: (0, 1, HW, 0, 1, 0), 2: (-1, 0, 0, HD, 0, 1), 3: (0, -1, -HW, 0, -1, 0)}[face]


def floor(sol, z, key="planks", well=True):
    x1 = WELL_X0 if well else IHW
    sol.box(-IHW, x1, -IHD, IHD, z - 0.12, z, "timber", res=1.2, keys={"+z": key, "-z": "planks"})
    for x in [-IHW + 0.9 + i * 1.6 for i in range(9)]:
        if x < x1 - 0.2:
            sol.box(x - 0.15, x + 0.15, -IHD, IHD, z - 0.5, z - 0.12, "timber", res=2.0)
    # a main beam across on stone corbels
    sol.box(-IHW, x1, -0.25, 0.25, z - 0.85, z - 0.5, "timber", res=2.0)
    for x in (-IHW, x1):
        sol.box(x - 0.3 if x > 0 else x, x if x > 0 else x + 0.3, -0.3, 0.3, z - 1.2, z - 0.85, "ashlar", res=9)


def flight(sol, y0, y1, z0, z1, x=SA, w=SW):
    n = max(8, int(round((z1 - z0) / 0.23)))
    rise = (z1 - z0) / n; going = (y1 - y0) / n
    for i in range(n):
        ya = y0 + going * i; yb = ya + going
        zt = z0 + rise * (i + 1)
        lo, hi = sorted((ya, yb))
        sol.box(x - w / 2, x + w / 2, lo, hi, zt - rise - 0.3, zt, "ashlar", res=9, keys={"+z": "paving"})
    return n


def build(name, state):
    seed = 91 + {"intact": 0, "pocked": 100, "cracked": 200, "ruin": 300}[state]
    L.reset(seed); rng = random.Random(seed)
    parts = {"base": [], "upper_1": [], "upper_2": [], "roof": []}
    fresh, soot = [], []
    shells = []
    # ---- shells per storey
    cuts = {0: [], 1: [], 2: []}
    for k, (z0, z1) in enumerate(((FOUND, F[1]), (F[1], F[2]), (F[2], TOP))):
        s = L.Solid(f"shell{k}")
        walls(s, z0, z1)
        buttresses(s, max(z0, 0.0) if k else FOUND, z1)
        o = s.to_object()
        shells.append(o)
    # plinth batter round everything (outside the buttresses)
    pl = L.Solid("plinth")
    sq = [(-HW - 0.5, -HD - 0.5), (HW + 0.5, -HD - 0.5), (HW + 0.5, HD + 0.5), (-HW - 0.5, HD + 0.5)]
    L.sweep(pl, [Vector(p) for p in sq], [(-0.1, FOUND), (0.9, FOUND), (0.9, 0.0), (0.05, 3.2), (-0.1, 3.2)], "ashlar", closed=True, step=0.9)
    plinth = pl.to_object()

    # ---- openings
    # store: loops on every face, the store door on the forebuilding face near its end
    for f in range(4):
        for t in (-5.0, 5.0):
            if f == 0 and t > 0:
                continue
            loop(cuts[0], f, t, 2.2)
    ax, ay, ox, oy, nx, ny = face_frame(0)
    cuts[0].append(L.opening_cutter((STORE_U, -HD), (1, 0), (0, 1), 1.15, 2.0, -1.0, TH + 0.4, kind="pointed"))
    # hall: the entrance from the forebuilding, two-light windows on the other faces, loops beside
    cuts[1].append(L.opening_cutter((DOOR_U, -HD), (1, 0), (0, 1), 1.6, 2.8, -0.8, TH + 0.4, kind="round", z0=F[1]))
    for f in (1, 2, 3):
        for t in (-5.0, 5.0):
            window2(cuts[1], f, t, F[1] + 2.4, w=0.5, h=1.9)
    window2(cuts[1], 0, -5.0, F[1] + 2.6, w=0.45, h=1.6)
    # chamber: two-light windows all round
    for f in range(4):
        for t in (-5.0, 5.0):
            window2(cuts[2], f, t, F[2] + 2.2, w=0.45, h=1.6)
        soot_face = face_frame(f)
    for k in range(3):
        L.cut(shells[k], cuts[k])
    L.cut(plinth, [L.opening_cutter((STORE_U, -HD - 0.5), (1, 0), (0, 1), 1.15, 2.0, -1.5, 1.0, kind="pointed")])

    # ---- floors, stairs, furnishing
    f0 = L.Solid("floor0")
    f0.box(-IHW, IHW, -IHD, IHD, -0.3, 0.02, "paving", res=1.2, skip=("-z",))
    for q in range(8):
        x = -IHW + 1.0 + (q % 4) * 1.15; y = IHD - 1.0 - (q // 4) * 1.2
        L.lathe(f0, x, y, [(0.0, 0.02), (0.36, 0.02), (0.42, 0.5), (0.36, 1.0), (0.0, 1.0)], "timber", segs=12, res=2)
    for q in range(6):   # sacks of grain: squashed blobs
        L.chunk(f0, (-IHW + 1.2 + q * 0.8, -IHD + 1.0 + (q % 2) * 0.7, 0.35), (0.7, 0.55, 0.6), rng, "plaster", tilt=0.15)
    flight(f0, FL0, FL1, 0.0, F[1])
    parts["base"] += [shells[0], plinth, f0.to_object()]

    f1 = L.Solid("floor1")
    floor(f1, F[1])
    flight(f1, FL1, FL0, F[1], F[2])
    # hall: hearth + hooded fireplace on the -x wall, a long table and benches, a dais at the +y end
    f1.box(-IHW, -IHW + 0.5, -1.4, 1.4, F[1], F[1] + 1.6, "ashlar", res=9)
    f1.box(-IHW, -IHW + 1.2, -1.6, 1.6, F[1] + 1.6, F[1] + 2.0, "ashlar", res=9)
    f1.prism([(-IHW, -1.2), (-IHW + 1.15, -1.2), (-IHW + 1.15, 1.2), (-IHW, 1.2)], F[1] + 2.0, F[1] + 3.6, "ashlar",
             top=lambda x, y: F[1] + 3.6 - (x + IHW) * 0.9)
    f1.box(-IHW + 0.5, -IHW + 1.3, -1.3, 1.3, F[1], F[1] + 0.06, "dark", res=9)
    f1.box(-3.5, 2.5, -0.45, 0.45, F[1] + 0.72, F[1] + 0.8, "timber", res=2)
    for yy in (-0.9, 0.9):
        f1.box(-3.5, 2.5, yy - 0.17, yy + 0.17, F[1] + 0.42, F[1] + 0.48, "timber", res=2)
    for xx in (-3.2, -0.5, 2.2):
        f1.box(xx - 0.07, xx + 0.07, -0.35, 0.35, F[1], F[1] + 0.72, "timber", res=9)
    f1.box(-IHW, WELL_X0 - 0.2, IHD - 2.2, IHD, F[1], F[1] + 0.3, "planks", res=1.2)
    f1.box(-2.0, 2.0, IHD - 1.5, IHD - 0.8, F[1] + 1.02, F[1] + 1.1, "timber", res=2)
    parts["upper_1"] += [shells[1], f1.to_object()]
    soot.append((-HW - 0.1, 0.0, F[1] + 3.2, 1.2, 4.0))   # the flue's stain outside? keep it inside the hall
    soot = [(-IHW + 0.05, 0.0, F[1] + 2.0, 1.1, 3.5)]

    f2 = L.Solid("floor2")
    floor(f2, F[2])
    flight(f2, FL0, FL1, F[2], TOP)
    # the great chamber: a bed with a canopy frame, a chest
    f2.box(-IHW + 0.3, -IHW + 2.4, -IHD + 0.3, -IHD + 2.2, F[2], F[2] + 0.6, "timber", res=2)
    for (x, y) in ((-IHW + 0.35, -IHD + 0.35), (-IHW + 2.35, -IHD + 0.35), (-IHW + 0.35, -IHD + 2.15), (-IHW + 2.35, -IHD + 2.15)):
        f2.box(x - 0.06, x + 0.06, y - 0.06, y + 0.06, F[2], F[2] + 2.2, "timber", res=9)
    f2.box(-IHW + 0.3, -IHW + 2.4, -IHD + 0.3, -IHD + 2.2, F[2] + 2.2, F[2] + 2.28, "planks", res=2)
    f2.box(-2.0, -0.8, IHD - 0.8, IHD - 0.2, F[2], F[2] + 0.6, "planks", res=9)
    parts["upper_2"] += [shells[2], f2.to_object()]

    # ---- roof walk: leads, parapet between four corner turrets, a timber hood over the stair head
    rf = L.Solid("roof")
    rf.box(-IHW, WELL_X0, -IHD, IHD, TOP - 0.5, TOP, "timber", res=1.4, keys={"+z": "lead", "-z": "planks"})
    rf.box(WELL_X0, IHW, -IHD, FL1 - 3.0, TOP - 0.5, TOP, "timber", res=1.4, keys={"+z": "lead", "-z": "planks"})
    T4 = 4.0
    crens = []
    for f in range(4):
        ax, ay, ox, oy, nx, ny = face_frame(f)
        # parapet centreline 0.4 inside the face, running between the turrets, outside on the right
        a0, a1 = -(HW - T4), (HW - T4)
        p0 = (ox + ax * a0 - nx * 0.4, oy + ay * a0 - ny * 0.4); p1 = (ox + ax * a1 - nx * 0.4, oy + ay * a1 - ny * 0.4)
        Lp = a1 - a0; n = int(round(Lp / PITCH)); pch = Lp / n
        iv = [(i * pch + CRENEL_W / 2, i * pch + pch - CRENEL_W / 2) for i in range(n)]
        crens += L.battlements(rf, [p0, p1], TOP, thick=0.8, breast=SILL, merlon_h=MERLON_H, merlon_w=pch - CRENEL_W, crenel_w=CRENEL_W, intervals=iv, res=0.9)
    roof_obj = rf.to_object()
    tur = L.Solid("turrets")
    for sx in (-1, 1):
        for sy in (-1, 1):
            x0, x1 = sorted((sx * (HW - T4), sx * (HW + 0.5))); y0, y1 = sorted((sy * (HD - T4), sy * (HD + 0.5)))
            tur.box(x0, x1, y0, y1, TOP, TOP + 3.2, "ashlar", res=0.9, keys={"+z": "paving"})
            # turret battlements (a merlon at each corner of the turret)
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            for (mx, my) in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
                bx0, bx1 = sorted((mx, mx + (1.5 if mx == x0 else -1.5)))
                by0, by1 = sorted((my, my + (1.5 if my == y0 else -1.5)))
                tur.box(bx0, bx1, by0, by1, TOP + 3.2, TOP + 3.2 + SILL + MERLON_H, "ashlar", res=9)
    turrets = tur.to_object()
    # the turrets are hollow rooms reached from the roof walk: a doorway into each
    tcuts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * (HW - T4 / 2 + 0.25), sy * (HD - T4 / 2 + 0.25)
            tcuts.append(L.box_cutter(cx - 1.4, cx + 1.4, cy - 1.4, cy + 1.4, TOP + 0.01, TOP + 3.5, key="rubble"))
            tcuts.append(L.opening_cutter((cx, cy), (1, 0), (0, -sy), 0.9, 1.8, 0.8, 2.6, kind="pointed", z0=TOP))
            tcuts.append(L.opening_cutter((cx, cy), (0, 1), (-sx, 0), 0.9, 1.8, 0.8, 2.6, kind="pointed", z0=TOP))
    L.cut(turrets, tcuts)
    hood = L.Solid("hood")
    hy0, hy1 = FL1 - 3.0, IHD + 0.1
    hood.box(WELL_X0 - 0.15, WELL_X0, hy0, hy1, TOP, TOP + 2.2, "planks", res=1.2)
    hood.box(IHW - 0.05, IHW + 0.1, hy0, hy1, TOP, TOP + 2.6, "planks", res=1.2)
    hood.box(WELL_X0 - 0.15, IHW + 0.1, hy1 - 0.12, hy1, TOP, TOP + 2.2, "planks", res=1.2)
    hood.prism([(WELL_X0 - 0.4, hy0 - 0.2), (IHW + 0.3, hy0 - 0.2), (IHW + 0.3, hy1 + 0.2), (WELL_X0 - 0.4, hy1 + 0.2)], TOP + 2.1, TOP + 2.25, "shingle",
               top=lambda x, y: TOP + 2.1 + (x - WELL_X0) * 0.25)
    parts["roof"] += [roof_obj, turrets, hood.to_object()]

    # ---- the forebuilding: a straight stair along the -y face to a landing, a small tower over the door
    fb = L.Solid("fore")
    y_in, y_out = -HD - 0.5, -HD - 2.6       # stair between the buttress line and the fore wall
    n = max(8, int(round(F[1] / 0.2)))
    rise = F[1] / n; going = RUN / n
    for i in range(n):
        xa = U0 - 0.8 + going * i
        fb.box(xa, xa + going + 0.02, y_out, y_in, 0.0 if i < 2 else rise * (i + 1) - 1.2, rise * (i + 1), "ashlar", res=9, keys={"+z": "paving"})
    # the solid ramp under the flight
    fb.prism([(U0 - 0.8, y_out), (U0 - 0.8 + RUN, y_out), (U0 - 0.8 + RUN, y_in), (U0 - 0.8, y_in)], 0.0, F[1] - 0.2, "rubble",
             top=lambda x, y: max(0.05, (x - (U0 - 0.8)) / RUN * F[1] - 1.25))
    # outer wall of the stair with a stepped parapet
    fb.prism([(U0 - 1.3, y_out - 1.0), (U1 + 0.2, y_out - 1.0), (U1 + 0.2, y_out), (U0 - 1.3, y_out)], FOUND, 1.2, "ashlar")
    fb.prism([(U0 - 1.3, y_out - 1.0), (U1 + 0.2, y_out - 1.0), (U1 + 0.2, y_out), (U0 - 1.3, y_out)], 1.2, F[1] + 1.2, "ashlar",
             top=lambda x, y: 1.2 + max(0.0, (x - (U0 - 0.8)) / RUN) * F[1])
    # the forebuilding tower over the landing and the door
    fx0, fx1 = U1 - 0.3, DOOR_U + 2.6
    fbt = L.Solid("foret")
    fbt.box(fx0, fx1, y_out - 1.0, -HD - 0.02, FOUND, F[1] + 5.2, "ashlar", res=0.9, keys={"+z": "lead"})
    fbt_o = fbt.to_object()
    fcuts = [L.box_cutter(fx0 + 0.9, fx1 - 0.9, y_out + 0.0, -HD - 0.5, F[1] - 0.05, F[1] + 3.9, key="plaster"),
             L.opening_cutter(((fx0 + fx1) / 2 - 0.4, -HD), (1, 0), (0, 1), 1.6, 2.6, -3.9, 0.2, kind="round", z0=F[1]) if False else None,
             L.opening_cutter((fx0 - 0.1, (y_out + y_in) / 2), (0, 1), (1, 0), 1.6, 2.4, -0.5, 1.5, kind="pointed", z0=F[1] - 0.05),
             L.box_cutter(fx0 + 0.9, fx1 - 0.9, y_out - 1.3, y_out + 0.1, F[1] + 1.2, F[1] + 2.8, key="plaster")]
    fcuts = [c for c in fcuts if c is not None]
    # the landing floor inside the forebuilding (and on up to the keep door)
    fb.box(fx0 - 0.1, fx1 - 0.9, y_out, -HD - 0.02, F[1] - 0.3, F[1], "ashlar", res=1.2, keys={"+z": "paving"})
    L.cut(fbt_o, fcuts)
    frf = L.Solid("forebattl")
    crens += L.battlements(frf, [(fx0 + 0.3, y_out - 0.6), (fx1 - 0.3, y_out - 0.6)], F[1] + 5.2, thick=0.7, breast=SILL, merlon_h=MERLON_H,
                           intervals=[(0.0, 0.8), (1.7, (fx1 - fx0 - 0.6) - 1.7), ((fx1 - fx0 - 0.6) - 0.8, fx1 - fx0 - 0.6)], res=0.9)
    parts["base"] += [fb.to_object(), fbt_o, frf.to_object()]

    # ---- moving: the hall door (behind the forebuilding) and the store door
    leaf = L.Solid("hall_door")
    prof = L.arch_profile(1.55, 2.75, "round")
    leaf.extrude(prof, (DOOR_U, -HD + 0.8, F[1]), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.0, 0.1, "planks")
    for z in (0.4, 1.4, 2.4):
        leaf.box(DOOR_U - 0.72, DOOR_U + 0.72, -HD + 0.75, -HD + 0.8, F[1] + z, F[1] + z + 0.08, "iron", res=9)
    sleaf = L.Solid("store_door")
    sleaf.extrude(L.arch_profile(1.1, 1.95, "pointed"), (STORE_U, -HD + 0.6, 0.0), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.0, 0.09, "planks")
    moving = {"hall_door": ([leaf.to_object(recalc=True)], (DOOR_U - 0.78, -HD + 0.85, F[1])),
              "store_door": ([sleaf.to_object(recalc=True)], (STORE_U - 0.56, -HD + 0.64, 0.0))}

    # ---- damage
    masonry = shells + [roof_obj, turrets, fbt_o]
    extra = L.Solid("extra")
    if state in ("pocked", "cracked", "ruin"):
        per = {id(o): [] for o in masonry}
        for i in range(10 if state == "pocked" else 16):
            f = rng.choice((0, 1, 3)); t = rng.uniform(-8.5, 8.5); z = rng.uniform(3.0, TOP + 1.5)
            ax, ay, ox, oy, nx, ny = face_frame(f)
            pos = (ox + ax * t, oy + ay * t, z)
            tgt = shells[0] if z < F[1] else shells[1] if z < F[2] else shells[2] if z < TOP else turrets
            per[id(tgt)].append(D.pock_cutter(pos, (-nx, -ny, 0), rng.uniform(0.55, 1.0), rng.uniform(0.3, 0.5), rng))
            fresh.append((pos[0], pos[1], z, 1.4))
        for o in masonry:
            L.cut(o, per[id(o)])
        for i in range(24):
            f = rng.choice((0, 1, 3)); t = rng.uniform(-9, 9); s = rng.uniform(0.2, 0.6)
            ax, ay, ox, oy, nx, ny = face_frame(f)
            d = rng.uniform(1.2, 4.5)
            L.chunk(extra, (ox + ax * t + nx * d, oy + ay * t + ny * d, s * 0.25), (s * 1.5, s, s * 0.7), rng)
    if state in ("cracked", "ruin"):
        path = D.jagged_path((-3.0, TOP + SILL), (-2.2, 3.0), rng, steps=22, amp=0.3)
        for o in shells + [roof_obj]:
            L.cut(o, [D.crack_cutter(path, 0.16, 0.05, -HD - 0.02, 1.2, key="dark", seed=seed)])
    if state == "ruin":
        # fired and slighted: the +x/-y corner has come down; soot above every window
        from mathutils import noise as N

        def f(x, y):
            d = (x - HW) * 0.7 + (-y - HD) * 0.7   # distance from the corner diagonal (negative inside)
            return 6.0 + 14.0 * L._sstep(-4.0, -14.0, d) + N.noise(Vector((x * 0.4, y * 0.4, seed))) * 1.6
        objs = []
        for k in ("base", "upper_1", "upper_2", "roof"):
            objs += parts[k]
        keep = []
        for o in objs:
            L.cut(o, [D.lid_cutter(f, -HW - 3, HW + 3, -HD - 5, HD + 3, res=1.1)])
            if len(o.data.polygons):
                keep.append(o)
        mf = D.mound_height([(4.0, 10.0, -8.0, 7.0, 6.0)], 0.45, 0.6, extra=[(10.5, -11.0, 4.5, 0.45), (6, -4, 7.5, 0.6)], seed=seed, lump=0.45)
        mound = L.Solid("mound")
        L.rubble_mound(mound, mf, -2, 22, -24, 4, res=1.0, key="debris")
        D.scatter_chunks(mound, mf, 0, 20, -22, 2, 70, rng, key="ashlar", smin=0.4, smax=1.1)
        keep.append(mound.to_object())
        if len(extra.bm.faces):
            keep.append(extra.to_object())
        for f_ in range(4):
            for t in (-5.0, 5.0):
                ax, ay, ox, oy, nx, ny = face_frame(f_)
                for z in (F[1] + 4.0, F[2] + 3.6):
                    soot.append((ox + ax * t + nx * 0.05, oy + ay * t + ny * 0.05, z, 1.6, 4.5))
        meta = {"kind": "keep", "state": "ruin", "floors": F, "top": TOP, "w": KEEP_W, "d": KEEP_D,
                "frame": "as the intact keep", "bbox": [[-HW - 4, -HD - 14, FOUND], [HW + 12, HD + 1, TOP + 6]],
                "walks": [], "links": [{"kind": "breach", "a": {"surf": "ground_out", "p": L.V3((15, -20, 0))}, "b": {"surf": "crest", "p": L.V3((6, -5, mf(6, -5)))}, "width": 4}],
                "note": "slighted and burnt: the +x/-y corner is down, the floors are gone; the heap is climbable"}
        L.finish_piece(f"{name}_ruin", {"base": keep}, {}, meta=meta, lods=(1.0, 0.4), soot=soot, fresh=fresh, grime_h=2.5)
        return
    if len(extra.bm.faces):
        parts["base"].append(extra.to_object())

    rooms = [{"id": "store", "lvl": 0, "z": 0.0}, {"id": "hall", "lvl": 4, "z": F[1]}, {"id": "chamber", "lvl": 5, "z": F[2]}, {"id": "roof", "lvl": 6, "z": TOP}]
    for r in rooms:
        r.update({"kind": "poly", "poly": [[-IHW + 0.3, -IHD + 0.3], [IHW - 0.3, -IHD + 0.3], [IHW - 0.3, IHD - 0.3], [-IHW + 0.3, IHD - 0.3]]})
    rooms[3]["poly"] = [[-HW + 0.9, -HD + 0.9], [HW - 0.9, -HD + 0.9], [HW - 0.9, HD - 0.9], [-HW + 0.9, HD - 0.9]]
    rooms[3]["blocked"] = [{"box": [s * (HW - T4) if s < 0 else HW - T4, s * HW if s < 0 else HW, t * (HD - T4) if t < 0 else HD - T4, t * HD if t < 0 else HD], "what": "turret"} for s in (-1, 1) for t in (-1, 1)]
    meta = {
        "kind": "keep", "state": state, "w": KEEP_W, "d": KEEP_D, "walls": TH, "floors": F, "top": TOP,
        "parapet_top": TOP + SILL + MERLON_H + COPING, "turret_top": TOP + 3.2 + SILL + MERLON_H,
        "frame": "sim keep frame (x = a, y = b); the forebuilding is on the -y face (side 0): rotate by 90 deg x side",
        "levels_note": "sim levels: hall 3, chamber 4, roof 5 (L_HALL, L_CHAMBER, L_ROOF); the store is ground (0). 'lvl' below follows the manifest's own numbering; use the sim's.",
        "bbox": [[U0 - 1.4, -HD - 3.7, FOUND], [HW + 0.9, HD + 0.9, TOP + 3.2 + SILL + MERLON_H]],
        "walks": rooms + [{"id": "fore_landing", "lvl": 4, "z": F[1], "kind": "poly", "poly": [[fx0, y_out], [DOOR_U + 1.0, y_out], [DOOR_U + 1.0, -HD], [fx0, -HD]]}],
        "doors": [{"id": "hall", "p_out": L.V3((DOOR_U, -HD - 1.5, F[1])), "p_in": L.V3((DOOR_U, -HD + TH + 0.8, F[1])), "width": 1.5, "leaf": "hall_door"},
                  {"id": "store", "p_out": L.V3((STORE_U, -HD - 1.4, 0.0)), "p_in": L.V3((STORE_U, -HD + TH + 0.6, 0.0)), "width": 1.1, "leaf": "store_door"}],
        "links": [
            {"kind": "stair", "fore": True, "a": {"surf": "ground", "p": L.V3((U0 - 0.8, (y_out + y_in) / 2, 0.0))}, "b": {"surf": "fore_landing", "p": L.V3((U1, (y_out + y_in) / 2, F[1]))}, "width": 2, "len": round(RUN + F[1], 1)},
            {"kind": "stair", "a": {"surf": "store", "p": L.V3((SA, FL0, 0.0))}, "b": {"surf": "hall", "p": L.V3((SA, FL1, F[1]))}, "width": 1},
            {"kind": "stair", "a": {"surf": "hall", "p": L.V3((SA, FL1, F[1]))}, "b": {"surf": "chamber", "p": L.V3((SA, FL0, F[2]))}, "width": 1},
            {"kind": "stair", "a": {"surf": "chamber", "p": L.V3((SA, FL0, F[2]))}, "b": {"surf": "roof", "p": L.V3((SA, FL1, TOP))}, "width": 1},
        ],
        "stair_well": {"x": [WELL_X0, IHW], "y": [-IHD, IHD]},
        "parapet": {"sill_z": TOP + SILL, "top_z": TOP + SILL + MERLON_H + COPING, "crenels": [{"p": L.V3(c[:3])} for c in crens]},
        "cutaway": "to look into the hall hide roof + upper_2; into the store hide roof + upper_2 + upper_1",
    }
    if state == "intact":
        meta["states"] = {s: f"{name}_{s}" for s in ("pocked", "cracked", "ruin")}
    nm = name if state == "intact" else f"{name}_{state}"
    L.finish_piece(nm, parts, moving, meta=meta, lods=(1.0, 0.45), soot=soot, fresh=fresh, grime_h=2.5)


ALL = [("keep", s) for s in ("intact", "pocked", "cracked", "ruin")]
if __name__ == "__main__":
    want = argv or [n if s == "intact" else f"{n}_{s}" for n, s in ALL]
    for n, s in ALL:
        if (n if s == "intact" else f"{n}_{s}") in want:
            build(n, s)
