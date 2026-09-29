"""Castle mural towers — round (and square) flanking towers you go inside.

    tools/heavy.sh /opt/homebrew/bin/blender -t 2 -b -P assets/src/castle/tower.py -- [piece ...]

pieces: tower_round tower_round_inner tower_round_outer tower_square (+ _pocked _cracked _collapsed)

LOCAL FRAME: origin = the tower's centre (the sim's part x, y), +Y points INTO the castle (rotate the piece so +Y
runs from the tower centre toward the bailey centre / the inward bisector of its two curtains), outer = -Y.
STOREYS (sim: floors [0, walk/2, walk, walk+5.5]): a vaulted-dark ground-floor store with a door from the bailey at
+Y, a first-floor fighting room with loops, the WALK-LEVEL room (its floor at the curtain's wall-walk height) and
the open battlemented top with a stair turret. A newel stair on the outward side climbs through all of them.
WALK-LEVEL DOORS: the walk-level wall is 24 separate 15-degree sectors. Sector k (centre bearing 7.5 + 15k deg,
measured CCW from +X) is node upper_2_wKK (plain wall) and, on the inward half, also upper_2_dKK (the same sector
with a doorway). Show the door sector nearest to where each curtain's wall-walk meets the tower and the plain
sector everywhere else (the manifest lists every socket with its bearing and door points).
Mid-curtain towers (sim r = 4.95): scale x,y by r / 5.5 (heights stay).
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import _castle as L
import _damage as D
from _dims import *

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

R = TWR_R
RI = R - min(2.2, 0.38 * R)          # 3.41: sim's room radius
PARA = 0.6
NSEC = 24
SEC = 2 * math.pi / NSEC


def floors_for(cls):
    w = WALLS[cls]["walk"]
    return [0.0, round(w / 2, 1), w, w + TWR_ABOVE]


def pol(r, a, z=None):
    return (r * math.cos(a), r * math.sin(a)) if z is None else (r * math.cos(a), r * math.sin(a), z)


def timber_floor(sol, z, r, hole, beams=True, key="planks"):
    """A boarded floor on joists: boards on top, a boarded underside, beams below."""
    sol.disc(0, 0, r, z, key, segs=32, rings=4, up=True, hole=hole)
    sol.disc(0, 0, r, z - 0.12, "planks", segs=32, rings=4, up=False, hole=hole)
    if beams:
        for x in (-2.0, -0.7, 0.6, 1.9):
            half = math.sqrt(max(0.0, (r + 0.25) ** 2 - x * x))
            y0, y1 = -half, half
            if hole and abs(x - hole[0]) < hole[2] + 0.2:
                # stop the joist at the stair well
                y1 = min(y1, hole[1] - math.sqrt(max(0.0, (hole[2] + 0.1) ** 2 - (x - hole[0]) ** 2)))
                if hole[1] > 0:
                    y0, y1 = -half, y1
                else:
                    y0 = max(y0, hole[1] + math.sqrt(max(0.0, (hole[2] + 0.1) ** 2 - (x - hole[0]) ** 2)))
            if y1 - y0 > 0.5:
                sol.box(x - 0.13, x + 0.13, y0, y1, z - 0.42, z - 0.12, "timber", res=1.5)


def barrels(sol, pts, rng):
    for (x, y) in pts:
        h = rng.uniform(0.85, 1.0); r = rng.uniform(0.32, 0.38)
        prof = [(0.0, 0.0), (r * 0.9, 0.0), (r, h * 0.5), (r * 0.9, h), (0.0, h)]
        L.lathe(sol, x, y, prof, "timber", segs=12, res=2)


def build_round(name, state):
    cls = "inner" if "_inner" in name else "outer" if "_outer" in name else "main"
    F = floors_for(cls)
    seed = {"main": 41, "inner": 43, "outer": 47}[cls] + {"intact": 0, "pocked": 100, "cracked": 200, "collapsed": 300}[state]
    L.reset(seed); rng = random.Random(seed)
    PL = 3.0 if cls != "outer" else 2.0            # batter height
    R0 = R + 0.7                                    # at the foot
    top = F[3]
    stair_c = (0.0, -2.05); stair_r = 1.25
    hole = (stair_c[0], stair_c[1], stair_r + 0.08)
    parts = {"base": [], "upper_1": [], "upper_2": [], "roof": []}
    cut_all = []                                     # cutters applied to every masonry object (damage)
    soot, fresh = [], []

    # ---- storey 0 (ground) shell: foundation, battered plinth with a roll moulding, wall to F1
    s0 = L.Solid("shell0", uv="cyl", uvc=(0, 0, R))
    prof0 = [(RI, FOUND), (R0, FOUND), (R0, 0.0), (R + 0.05, PL - 0.05), (R + 0.12, PL), (R + 0.12, PL + 0.14), (R, PL + 0.3), (R, F[1]), (RI, F[1])]
    L.lathe(s0, 0, 0, prof0, "ashlar", segs=56, inner_key="rubble", cap_key="ashlar")
    sh0 = s0.to_object()
    c0 = []
    # ground door at +Y (from the bailey), and two loops on the field side
    c0.append(L.opening_cutter((0, 0), (1, 0), (0, 1), 1.1, 1.85, RI - 0.6, R0 + 0.6, kind="pointed"))
    for b in (210, 330):
        a = math.radians(b); pos = pol(R + 0.02, a)
        c0 += L.slit_cutter(pos, (-math.cos(a), -math.sin(a)), (0, 0, 1), max(1.1, PL + 0.35), max(1.1, PL + 0.35) + 1.2, 0, R - RI,
                            w_slit=0.07, w_in=0.8, oillet=0.14)
    L.cut(sh0, c0)
    parts["base"].append(sh0)
    # ground floor: flags; a few barrels in the store
    g = L.Solid("floor0")
    g.disc(0, 0, RI + 0.05, 0.03, "paving", segs=32, rings=4)
    barrels(g, [(1.9, -0.9), (2.2, 0.15), (1.5, 0.95), (-2.3, 0.6)], rng)
    parts["base"].append(g.to_object())

    # ---- storey 1 shell (F1..F2) with three loops
    s1 = L.Solid("shell1", uv="cyl", uvc=(0, 0, R))
    L.lathe(s1, 0, 0, [(RI, F[1]), (R, F[1]), (R, F[2]), (RI, F[2])], "ashlar", segs=56, inner_key="rubble", cap_key="ashlar")
    sh1 = s1.to_object()
    c1 = []
    for b in (200, 270, 340):
        a = math.radians(b); pos = pol(R + 0.02, a)
        c1 += L.slit_cutter(pos, (-math.cos(a), -math.sin(a)), (0, 0, 1), F[1] + 1.0, F[1] + 2.5, 0, R - RI, w_slit=0.07, w_in=0.85, oillet=0.14,
                            cross=(b == 270))
    L.cut(sh1, c1)
    parts["upper_1"].append(sh1)
    f1 = L.Solid("floor1"); timber_floor(f1, F[1], RI + 0.05, hole)
    parts["upper_1"].append(f1.to_object())

    # ---- stair (newel), split by storey
    stair_solids = {}

    def band(z):
        k = 0 if z < F[1] else 1 if z < F[2] else 2
        if k not in stair_solids:
            stair_solids[k] = L.Solid(f"stair{k}")
        return stair_solids[k]
    a_start = math.radians(90)
    steps = L.spiral_stair(band, stair_c[0], stair_c[1], 0.2, stair_r, 0.0, top, a_start, ccw=True, rise=0.2, step_deg=24.0, key="ashlar")
    for k, (z0, z1) in enumerate(((0, F[1]), (F[1], F[2]), (F[2], top))):
        band(z0 + 0.1).prism([pol(0.2, a * 2 * math.pi / 10) for a in range(10)] and [(stair_c[0] + 0.2 * math.cos(a * 2 * math.pi / 10), stair_c[1] + 0.2 * math.sin(a * 2 * math.pi / 10)) for a in range(10)], z0, z1, "ashlar")
    for k, part in ((0, "base"), (1, "upper_1"), (2, "upper_2")):
        if k in stair_solids:
            parts[part].append(stair_solids[k].to_object())

    # ---- storey 2 (walk level): 24 sectors, door variants on the inward half
    sectors = []
    w_nodes = {}
    for k in range(NSEC):
        bc = 7.5 + 15 * k
        a0, a1 = math.radians(bc - 7.5), math.radians(bc + 7.5)
        inward = 0 < bc < 180
        for variant in (("w", "d") if inward else ("w",)):
            s = L.Solid(f"sec{k}{variant}", uv="cyl", uvc=(0, 0, R))
            L.lathe(s, 0, 0, [(RI, F[2]), (R, F[2]), (R, top), (RI, top)], "ashlar", segs=NSEC * 3, a0=a0, a1=a1, inner_key="rubble", cap_key="paving")
            o = s.to_object()
            ac = math.radians(bc)
            cc = []
            if variant == "d":
                cc.append(L.opening_cutter(pol(0, ac), (-math.sin(ac), math.cos(ac)), (math.cos(ac), math.sin(ac)), 0.95, 1.95, RI - 0.5, R + 0.5, kind="pointed", z0=F[2]))
            elif not inward and k % 2 == 0:
                pos = pol(R + 0.02, ac)
                cc += L.slit_cutter(pos, (-math.cos(ac), -math.sin(ac)), (0, 0, 1), F[2] + 1.0, F[2] + 2.6, 0, R - RI, w_slit=0.07, w_in=0.75, oillet=0.14)
            L.cut(o, cc)
            w_nodes[f"upper_2_{variant}{k:02d}"] = o
        sectors.append({"k": k, "bearing_deg": bc, "plain": f"upper_2_w{k:02d}", "door": f"upper_2_d{k:02d}" if inward else None,
                        "door_in": L.V3(pol(RI - 0.4, math.radians(bc), F[2])), "door_out": L.V3(pol(R + 0.6, math.radians(bc), F[2]))})
    f2 = L.Solid("floor2"); timber_floor(f2, F[2], RI + 0.05, hole)
    parts["upper_2"].append(f2.to_object())

    # ---- roof: lead platform over joists, parapet, stair turret with a conical slate roof
    rf = L.Solid("roof")
    rf.disc(0, 0, RI + 0.05, top, "lead", segs=32, rings=4, hole=hole)
    rf.disc(0, 0, RI + 0.05, top - 0.12, "planks", segs=32, rings=4, up=False, hole=hole)
    for x in (-2.0, -0.7, 0.6, 1.9):
        half = math.sqrt(max(0.0, (RI + 0.25) ** 2 - x * x))
        rf.box(x - 0.13, x + 0.13, -half if abs(x) > 1.4 else -0.7, half, top - 0.42, top - 0.12, "timber", res=1.5)
    OV = 0.28                                     # the parapet oversails the wall face on a corbel table
    RP = R + OV - PARA / 2
    circ = [pol(RP, -math.pi / 2 + i * 2 * math.pi / 64) for i in range(64)]   # CCW: the outside is on the right
    C = 2 * math.pi * RP; n = int(round(C / PITCH)); p = C / n
    ncb = int(2 * math.pi * R / 0.95)
    for i in range(ncb):
        a = 2 * math.pi * (i + 0.5) / ncb; ca, sa = math.cos(a), math.sin(a); t = (-sa, ca)
        for (r0, r1, z0, z1, hw) in ((R - 0.3, R + 0.14, top - 0.62, top - 0.36, 0.2), (R - 0.3, R + OV, top - 0.36, top + 0.01, 0.22)):
            q = [(r0 * ca - hw * t[0], r0 * sa - hw * t[1]), (r1 * ca - hw * t[0], r1 * sa - hw * t[1]), (r1 * ca + hw * t[0], r1 * sa + hw * t[1]), (r0 * ca + hw * t[0], r0 * sa + hw * t[1])]
            rf.prism(q, z0, z1, "ashlar", res=9)
    iv = [(i * p + CRENEL_W / 2, i * p + p - CRENEL_W / 2) for i in range(n)]
    cren = L.battlements(rf, circ, top, thick=PARA, breast=SILL, merlon_h=MERLON_H, merlon_w=p - CRENEL_W, crenel_w=CRENEL_W,
                         closed=True, intervals=iv, res=0.7)
    roof_obj = rf.to_object()
    # stair turret (caphouse)
    tu = L.Solid("turret", uv="cyl", uvc=(stair_c[0], stair_c[1], 1.55))
    L.lathe(tu, stair_c[0], stair_c[1], [(1.3, top), (1.62, top), (1.62, top + 2.7), (1.3, top + 2.7)], "ashlar", segs=24, inner_key="rubble", cap_key="ashlar")
    tuo = tu.to_object()
    L.cut(tuo, [L.opening_cutter(stair_c, (1, 0), (0, 1), 0.85, 1.75, 0.5, 2.2, kind="pointed", z0=top)])
    cone = L.Solid("cone")
    L.lathe(cone, stair_c[0], stair_c[1], [(0.0, top + 2.6), (1.95, top + 2.6), (0.0, top + 5.2)], "slate", segs=24)
    L.lathe(cone, stair_c[0], stair_c[1], [(0.0, top + 5.1), (0.06, top + 5.1), (0.04, top + 6.0), (0.0, top + 6.0)], "iron", segs=6)
    parts["roof"] += [roof_obj, tuo, cone.to_object()]

    # ---- the door leaf (hinged on its west jamb, inside the doorway)
    leaf = L.Solid("door")
    prof = [(u, z) for u, z in L.arch_profile(1.05, 1.82, "pointed")]
    leaf.extrude(prof, (0, RI + 0.35, 0.0), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.0, 0.09, "planks")
    for z in (0.3, 1.0, 1.7):
        leaf.box(-0.5, 0.5, RI + 0.3, RI + 0.35, z, z + 0.07, "iron", res=9)
    moving = {"door": ([leaf.to_object(recalc=True)], (-0.53, RI + 0.39, 0.0))}

    # ---- damage
    masonry = [sh0, sh1, roof_obj, tuo] + list(w_nodes.values())
    if state in ("pocked", "cracked"):
        n_imp = 7 if state == "pocked" else 11
        for i in range(n_imp):
            b = math.radians(rng.uniform(190, 350)); z = rng.uniform(2.0, top + 1.5)
            Rr = rng.uniform(0.5, 0.9)
            pos = pol(R - 0.02, b, z)
            fresh.append((pos[0], pos[1], z, Rr * 1.5))
            cut_all.append(("pock", pos, (-math.cos(b), -math.sin(b), 0), Rr, rng.uniform(0.25, 0.4)))
        for i in range(12 if state == "pocked" else 20):
            b = math.radians(rng.uniform(190, 350)); s = rng.uniform(0.2, 0.55)
            L.chunk(parts_extra(parts), (*pol(R0 + rng.uniform(0.3, 3.0), b), s * 0.25), (s * 1.5, s, s * 0.7), rng)
    if state == "cracked":
        path = D.jagged_path((0.2, top + SILL), (-0.4, 2.0), rng, steps=18, amp=0.25)
        for o in masonry:
            L.cut(o, [D.crack_cutter(path, 0.13, 0.04, -R - 0.02, 0.7, key="dark", seed=seed)])
    for o in masonry:
        cs = [D.pock_cutter(c[1], c[2], c[3], c[4], rng) for c in cut_all if c[0] == "pock"]
        if cs:
            L.cut(o, cs)

    # faint smoke stains above the loops of the fighting room (braziers, fire-arrows)
    for bdeg in (200, 270, 340):
        a = math.radians(bdeg)
        soot.append((R * math.cos(a), R * math.sin(a), F[1] + 2.4, 0.45, 2.2, 0.45))
    if state == "collapsed":
        return collapse_round(name, parts, w_nodes, moving, F, top, R0, rng, seed)

    parts_final = dict(parts)
    if "extra" in parts:
        parts_final["base"] = parts["base"] + [parts.pop("extra").to_object()]
        parts_final.pop("extra", None)
    for k, o in w_nodes.items():
        parts_final[k] = [o]
    walk_r = R + 0.28 - PARA - 0.15
    meta = {
        "kind": "tower", "shape": "round", "wall_class": cls, "state": state, "mods": 2,
        "r": R, "r_in": RI, "r_foot": R0, "floors": F, "top": top, "parapet_top": top + SILL + MERLON_H + COPING,
        "frame": "origin = tower centre; +y points into the castle (the bailey / inward bisector of its curtains); outer -y",
        "scale": "sim mid-curtain towers have r = 0.9 x 5.5: scale x,y by r / 5.5, leave z",
        "bbox": [[-R0, -R0, FOUND], [R0, R0, top + 6.0]],
        "walks": [
            {"id": "room0", "lvl": 0, "z": 0.0, "kind": "circle", "c": [0, 0], "r": RI - 0.3, "stair_well": L.V3((*stair_c, stair_r))},
            {"id": "room1", "lvl": 3, "z": F[1], "kind": "circle", "c": [0, 0], "r": RI - 0.3, "stair_well": L.V3((*stair_c, stair_r))},
            {"id": "room2", "lvl": 1, "z": F[2], "kind": "circle", "c": [0, 0], "r": RI - 0.3, "stair_well": L.V3((*stair_c, stair_r))},
            {"id": "top", "lvl": 2, "z": top, "kind": "circle", "c": [0, 0], "r": walk_r, "blocked": [{"c": list(stair_c), "r": 1.65, "what": "stair turret"}]},
        ],
        "sockets": sectors,
        "doors": [{"id": "ground", "p_out": L.V3((0, R0 + 1.2, 0)), "p_in": L.V3((0, RI - 0.5, 0)), "width": 1.0, "height": 2.4, "leaf": "door",
                   "surf_out": "ground", "surf_in": "room0"},
                  {"id": "turret", "p_out": L.V3((stair_c[0], stair_c[1] + 1.9, top)), "p_in": L.V3((stair_c[0], stair_c[1] + 0.9, top)), "width": 0.85, "surf_out": "top", "surf_in": "stair"}],
        "links": _stair_links(steps, stair_c, stair_r, F, top),
        "parapet": {"sill_z": top + SILL, "top_z": top + SILL + MERLON_H + COPING, "crenels": [{"p": L.V3(c[:3])} for c in cren], "r": R + 0.28 - PARA / 2},
        "loops": [{"storey": 0, "bearing_deg": b} for b in (210, 330)] + [{"storey": 1, "bearing_deg": b} for b in (200, 270, 340)] +
                 [{"storey": 2, "bearing_deg": 7.5 + 15 * k} for k in range(NSEC) if not (0 < 7.5 + 15 * k < 180) and k % 2 == 0],
        "cutaway": "to look into storey n: hide 'roof' and every upper_m (and upper_m_*) with m > n; storey 0 = base",
        "moving": None,
    }
    if state == "intact":
        meta["states"] = {s: f"{name}_{s}" for s in ("pocked", "cracked", "collapsed")}
    nm = name if state == "intact" else f"{name}_{state}"
    L.finish_piece(nm, parts_final, moving, meta=meta, lods=(1.0, 0.45), fresh=fresh, soot=soot, smooth=None, grime_h=2.2)


def parts_extra(parts):
    if "extra" not in parts:
        parts["extra"] = L.Solid("extra")
    return parts["extra"]


def _stair_links(steps, c, r, F, top):
    """Stair links between consecutive storeys, with the foot/head points where the steps meet each floor."""
    out = []
    names = ["room0", "room1", "room2", "top"]
    levels = F[:3] + [top]
    def point_at(z):
        best = min(steps, key=lambda s: abs(s[1] - z))
        a = best[0]
        return (c[0] + (r * 0.6) * math.cos(a), c[1] + (r * 0.6) * math.sin(a), z)
    for k in range(3):
        a = point_at(levels[k] + 0.2) if k == 0 else point_at(levels[k])
        b = point_at(levels[k + 1])
        out.append({"kind": "stair", "spiral": True, "a": {"surf": names[k], "p": L.V3((a[0], a[1], levels[k]))},
                    "b": {"surf": names[k + 1], "p": L.V3(b)}, "width": 1, "rise": round(levels[k + 1] - levels[k], 2),
                    "len": round((levels[k + 1] - levels[k]) * 2.4, 1)})
    return out


def collapse_round(name, parts, w_nodes, moving, F, top, R0, rng, seed, shape="round"):
    """Mined: the field half fell outward; a jagged stump stands on the gorge side; a great heap spreads out."""
    objs = []
    for k in ("base", "upper_1", "upper_2", "roof"):
        objs += parts[k]
    # plain sectors only (no doors: the wall-walks end in the air)
    objs += [o for k, o in w_nodes.items() if "_w" in k]
    for k, o in w_nodes.items():
        if "_d" in k:
            bpy.data.objects.remove(o, do_unlink=True)
    from mathutils import noise as N

    def f(x, y):
        base = 2.2 + 6.8 * L._sstep(-3.5, 4.5, y)
        base -= 3.0 * math.exp(-(x * x) / 6.0) * L._sstep(0.0, 4.0, y)        # a notch through the gorge: the breach
        return base + N.noise(Vector((x * 0.45, y * 0.45, seed))) * 1.4 + N.noise(Vector((x * 1.3, y * 1.3, 2))) * 0.5
    keep = []
    for o in objs:
        L.cut(o, [D.lid_cutter(f, -R0 - 1, R0 + 1, -R0 - 1, R0 + 1, res=0.55)])
        if len(o.data.polygons):
            keep.append(o)
        else:
            bpy.data.objects.remove(o, do_unlink=True)
    mf = D.mound_height([(-3.0, 3.0, -1.5, 4.8, 4.4)], 0.42, 0.55,
                        extra=[(0.0, -6.0, 3.2, 0.42), (-4.0, -2.0, 3.6, 0.6), (4.2, 0.0, 3.4, 0.6), (0, 3.5, 2.6, 0.5)], seed=seed, lump=0.4)
    mound = L.Solid("mound")
    L.rubble_mound(mound, mf, -12, 12, -19, 10, res=0.5, key="debris")
    D.scatter_chunks(mound, mf, -10, 10, -17, 8, 150, rng, key="ashlar", smin=0.3, smax=0.95)
    D.scatter_chunks(mound, mf, -5, 5, -6, 5, 30, rng, key="rubble", smin=0.4, smax=0.8)
    # broken floor joists sticking out of the heap
    for i in range(7):
        x = rng.uniform(-3, 3); y = rng.uniform(-6, 2); z = max(0.5, mf(x, y) - 0.2)
        a = rng.uniform(0, math.pi); Lb = rng.uniform(2.0, 4.0)
        s = L.Solid("j")
        s.box(-Lb / 2, Lb / 2, -0.12, 0.12, -0.14, 0.14, "timber", res=2)
        o = s.to_object()
        o.rotation_euler = (rng.uniform(-0.5, 0.5), rng.uniform(-0.3, 0.3), a); o.location = (x, y, z)
        L.apply_xf(o)
        keep.append(o)
    keep.append(mound.to_object())
    if "extra" in parts:
        keep.append(parts["extra"].to_object())
    meta = {
        "kind": "tower", "shape": shape, "state": "collapsed", "r": R, "floors": F, "top": top,
        "frame": "as the intact tower (+y into the castle)",
        "bbox": [[-12, -19, FOUND], [12, 10, top]],
        "walks": [],
        "links": [
            {"kind": "breach", "a": {"surf": "ground_out", "p": L.V3((0, -18.0, 0))}, "b": {"surf": "crest", "p": L.V3((0, -1.5, mf(0, -1.5)))}, "width": 5, "slope_deg": 24},
            {"kind": "breach", "a": {"surf": "crest", "p": L.V3((0, -1.5, mf(0, -1.5)))}, "b": {"surf": "ground_in", "p": L.V3((0, 9.0, 0))}, "width": 4, "slope_deg": 29},
        ],
        "note": "the curtains' wall-walks that ran into this tower now end in the air at its old wall; the heap is the way in",
        "sockets": [],
    }
    for o in keep:
        bpy.context.view_layer.objects.active = o
    L.finish_piece(f"{name}_collapsed", {"base": keep}, {}, meta=meta, lods=(1.0, 0.4), fresh=[(0, -3, 3, 6)], grime_h=2.2)


def sq_floor(sol, z, h, hole, key="planks", beams=True):
    """Square boarded floor (half-size h) on joists, leaving a round stair well."""
    n = 8
    for i in range(n):
        for j in range(n):
            x0 = -h + 2 * h * i / n; x1 = x0 + 2 * h / n; y0 = -h + 2 * h * j / n; y1 = y0 + 2 * h / n
            cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            if math.hypot(cx - hole[0], cy - hole[1]) < hole[2]:
                continue
            sol.face([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], key)
            sol.face([(x0, y1, z - 0.12), (x1, y1, z - 0.12), (x1, y0, z - 0.12), (x0, y0, z - 0.12)], "planks")
    if beams:
        for x in (-2.0, -0.7, 0.6, 1.9):
            y0 = -h
            if abs(x - hole[0]) < hole[2] + 0.2:
                y0 = hole[1] + hole[2] + 0.1
            sol.box(x - 0.13, x + 0.13, y0, h, z - 0.42, z - 0.12, "timber", res=1.5)


def build_square(name, state):
    """Square flanking tower, 10 x 10 m, walls 2 m: same storeys, frame and node scheme as the round tower.
    Walk-level wall panels: 3 per face, upper_2_wKK / door variants upper_2_dKK on the +x, +y and -x faces."""
    cls = "main"
    F = floors_for(cls)
    seed = 61 + {"intact": 0, "pocked": 100, "cracked": 200, "collapsed": 300}[state]
    L.reset(seed); rng = random.Random(seed)
    H = TWR_SQ; T = 2.0; I = H - T
    top = F[3]
    stair_c = (-1.75, -1.75); stair_r = 1.2
    hole = (stair_c[0], stair_c[1], stair_r + 0.08)
    parts = {"base": [], "upper_1": [], "upper_2": [], "roof": []}
    fresh, soot = [], []

    def walls(sol, z0, z1, key="ashlar"):
        sol.box(-H, H, -H, -I, z0, z1, key, res=0.9, keys={"+y": "rubble", "+z": "paving"})
        sol.box(-H, H, I, H, z0, z1, key, res=0.9, keys={"-y": "rubble", "+z": "paving"})
        sol.box(-H, -I, -I, I, z0, z1, key, res=0.9, keys={"+x": "rubble", "+z": "paving", "-y": "rubble", "+y": "rubble"})
        sol.box(I, H, -I, I, z0, z1, key, res=0.9, keys={"-x": "rubble", "+z": "paving", "-y": "rubble", "+y": "rubble"})
    s0 = L.Solid("shell0"); walls(s0, FOUND, F[1]); sh0 = s0.to_object()
    pl = L.Solid("plinth")
    L.sweep(pl, [Vector(p) for p in ((-H, -H), (H, -H), (H, H), (-H, H))], [(-0.1, FOUND), (0.7, FOUND), (0.7, 0.0), (0.05, 3.0), (-0.1, 3.0)], "ashlar", closed=True, step=0.9)
    plo = pl.to_object()
    c0 = [L.opening_cutter((0, 0), (1, 0), (0, 1), 1.1, 1.85, I - 0.6, H + 1.0, kind="pointed")]
    L.cut(plo, [L.opening_cutter((0, 0), (1, 0), (0, 1), 1.1, 1.85, I - 0.6, H + 1.0, kind="pointed")])
    for x in (-2.5, 2.5):
        c0 += L.slit_cutter((x, -H - 0.72), (0, 1), (0, 0, 1), 3.4, 4.6 if F[1] > 4.7 else F[1] - 0.3, 0, T + 0.72, w_slit=0.07, w_in=0.8, oillet=0.14) if False else []
    L.cut(sh0, c0)
    g = L.Solid("floor0"); g.box(-I, I, -I, I, -0.3, 0.03, "paving", res=1.2, skip=("-z",))
    barrels(g, [(2.0, -1.0), (2.2, 0.2), (1.2, 2.1)], rng)
    parts["base"] += [sh0, plo, g.to_object()]
    s1 = L.Solid("shell1"); walls(s1, F[1], F[2]); sh1 = s1.to_object()
    c1 = []
    for (pos, iw) in (((0, -H), (0, 1)), ((-H, 0.5), (1, 0)), ((H, 0.5), (-1, 0)), ((2.3, -H), (0, 1))):
        c1 += L.slit_cutter(pos, iw, (0, 0, 1), F[1] + 1.0, F[1] + 2.5, 0, T, w_slit=0.07, w_in=0.85, oillet=0.14, cross=(pos[0] == 0))
    L.cut(sh1, c1)
    f1 = L.Solid("floor1"); sq_floor(f1, F[1], I + 0.05, hole)
    parts["upper_1"] += [sh1, f1.to_object()]
    stair_solids = {}

    def band(z):
        k = 0 if z < F[1] else 1 if z < F[2] else 2
        if k not in stair_solids:
            stair_solids[k] = L.Solid(f"stair{k}")
        return stair_solids[k]
    steps = L.spiral_stair(band, stair_c[0], stair_c[1], 0.2, stair_r, 0.0, top, math.radians(45), ccw=True, rise=0.2, step_deg=24.0)
    for (z0, z1) in ((0, F[1]), (F[1], F[2]), (F[2], top)):
        band(z0 + 0.1).prism([(stair_c[0] + 0.2 * math.cos(a * 2 * math.pi / 10), stair_c[1] + 0.2 * math.sin(a * 2 * math.pi / 10)) for a in range(10)], z0, z1, "ashlar")
    for k, part in ((0, "base"), (1, "upper_1"), (2, "upper_2")):
        if k in stair_solids:
            parts[part].append(stair_solids[k].to_object())
    # walk-level panels
    panels = []
    for face, (ax0, ax1, fixed, horiz, outward) in {
            "s": ((-H, H), None, -H, True, (0, -1)), "n": ((-H, H), None, H, True, (0, 1)),
            "w": ((-I, I), None, -H, False, (-1, 0)), "e": ((-I, I), None, H, False, (1, 0))}.items():
        a0, a1 = ax0
        for j in range(3):
            u0 = a0 + (a1 - a0) * j / 3; u1 = a0 + (a1 - a0) * (j + 1) / 3
            panels.append((face, j, u0, u1, horiz, outward))
    sockets = []; w_nodes = {}
    for k, (face, j, u0, u1, horiz, outward) in enumerate(panels):
        doorable = face != "s"
        uc = (u0 + u1) / 2
        for variant in (("w", "d") if doorable else ("w",)):
            s = L.Solid(f"p{k}{variant}")
            if horiz:
                y0, y1 = (-H, -I) if face == "s" else (I, H)
                s.box(u0, u1, y0, y1, F[2], top, "ashlar", res=0.9, keys={("+y" if face == "s" else "-y"): "rubble", "+z": "paving"})
                pc = (uc, (y0 + y1) / 2)
            else:
                x0, x1 = (-H, -I) if face == "w" else (I, H)
                s.box(x0, x1, u0, u1, F[2], top, "ashlar", res=0.9, keys={("+x" if face == "w" else "-x"): "rubble", "+z": "paving"})
                pc = ((x0 + x1) / 2, uc)
            o = s.to_object()
            cc = []
            if variant == "d":
                along = (1, 0) if horiz else (0, 1)
                cc.append(L.opening_cutter((pc[0] - outward[0] * 1.0, pc[1] - outward[1] * 1.0), along, outward, 0.95, 1.95, -0.6, 2.2, kind="pointed", z0=F[2]))
            elif face == "s" and j == 1:
                cc += L.slit_cutter((uc, -H - 0.02), (0, 1), (0, 0, 1), F[2] + 1.0, F[2] + 2.6, 0, T, w_slit=0.07, w_in=0.75, oillet=0.14)
            L.cut(o, cc)
            w_nodes[f"upper_2_{variant}{k:02d}"] = o
        bearing = math.degrees(math.atan2(pc[1], pc[0])) % 360
        sockets.append({"k": k, "face": face, "bearing_deg": round(bearing, 1), "plain": f"upper_2_w{k:02d}", "door": f"upper_2_d{k:02d}" if doorable else None,
                        "door_in": L.V3((pc[0] - outward[0] * 1.4, pc[1] - outward[1] * 1.4, F[2])), "door_out": L.V3((pc[0] + outward[0] * 1.6, pc[1] + outward[1] * 1.6, F[2]))})
    f2 = L.Solid("floor2"); sq_floor(f2, F[2], I + 0.05, hole)
    parts["upper_2"].append(f2.to_object())
    rf = L.Solid("roof")
    sq_floor(rf, top, I + 0.05, hole, key="lead")
    OV = 0.28
    ncb = 10
    for sx, sy, ax, ay in ((0, -1, 1, 0), (0, 1, 1, 0), (-1, 0, 0, 1), (1, 0, 0, 1)):
        for i in range(ncb):
            u = -H + 2 * H * (i + 0.5) / ncb
            cx, cy = sx * H + ax * u, sy * H + ay * u
            nx, ny = sx, sy
            for (d0, d1, z0, z1, hw) in ((-0.3, 0.14, top - 0.62, top - 0.36, 0.2), (-0.3, OV, top - 0.36, top + 0.01, 0.22)):
                q = [(cx + nx * d0 - ax * hw, cy + ny * d0 - ay * hw), (cx + nx * d1 - ax * hw, cy + ny * d1 - ay * hw),
                     (cx + nx * d1 + ax * hw, cy + ny * d1 + ay * hw), (cx + nx * d0 + ax * hw, cy + ny * d0 + ay * hw)]
                rf.prism(q, z0, z1, "ashlar", res=9)
    hp = H + OV - PARA / 2
    sqp = [(-hp, -hp), (hp, -hp), (hp, hp), (-hp, hp)]          # CCW: outside on the right
    side = 2 * hp; tot = 4 * side
    iv = []
    for c in range(4):
        base = c * side
        mids = max(1, int(round((side - 2.1) / PITCH)))
        pch = (side - 2.1) / mids
        for m in range(1, mids):
            iv.append((base + 1.05 + m * pch - (pch - CRENEL_W) / 2, base + 1.05 + m * pch + (pch - CRENEL_W) / 2))
        iv.append((base + side - 1.05, base + side + (1.05 if c < 3 else 0.0)))
    iv = [(0.0, 1.05)] + iv
    cren = L.battlements(rf, sqp, top, thick=PARA, breast=SILL, merlon_h=MERLON_H, closed=True, intervals=iv, res=0.7)
    roof_obj = rf.to_object()
    tu = L.Solid("turret", uv="cyl", uvc=(stair_c[0], stair_c[1], 1.55))
    L.lathe(tu, stair_c[0], stair_c[1], [(1.3, top), (1.62, top), (1.62, top + 2.7), (1.3, top + 2.7)], "ashlar", segs=24, inner_key="rubble", cap_key="ashlar")
    tuo = tu.to_object()
    L.cut(tuo, [L.opening_cutter(stair_c, (-0.7071, 0.7071), (0.7071, 0.7071), 0.85, 1.75, 0.5, 2.2, kind="pointed", z0=top)])
    cone = L.Solid("cone")
    L.lathe(cone, stair_c[0], stair_c[1], [(0.0, top + 2.6), (1.95, top + 2.6), (0.0, top + 5.2)], "slate", segs=24)
    parts["roof"] += [roof_obj, tuo, cone.to_object()]
    leaf = L.Solid("door")
    leaf.extrude(L.arch_profile(1.05, 1.82, "pointed"), (0, I + 0.35, 0.0), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.0, 0.09, "planks")
    moving = {"door": ([leaf.to_object(recalc=True)], (-0.53, I + 0.39, 0.0))}
    masonry = [sh0, sh1, roof_obj, tuo] + list(w_nodes.values())
    if state in ("pocked", "cracked"):
        per = {id(o): [] for o in masonry}
        for i in range(7 if state == "pocked" else 11):
            x = rng.uniform(-4.2, 4.2); z = rng.uniform(2.0, top + 1.0)
            tgt = sh0 if z < F[1] else sh1 if z < F[2] else None
            if tgt is None:
                continue
            per[id(tgt)].append(D.pock_cutter((x, -H, z), (0, 1, 0), rng.uniform(0.5, 0.9), rng.uniform(0.25, 0.4), rng))
            fresh.append((x, -H, z, 1.3))
        for o in masonry:
            L.cut(o, per[id(o)])
    if state == "cracked":
        path = D.jagged_path((0.6, top + SILL), (-0.2, 2.0), rng, steps=18, amp=0.25)
        for o in masonry:
            L.cut(o, [D.crack_cutter(path, 0.13, 0.04, -H - 0.02, 0.7, key="dark", seed=seed)])
    if state == "collapsed":
        global R0_OVERRIDE
        return collapse_round(name, parts, w_nodes, moving, F, top, H + 0.9, rng, seed, shape="square")
    parts_final = dict(parts)
    for k, o in w_nodes.items():
        parts_final[k] = [o]
    meta = {
        "kind": "tower", "shape": "square", "wall_class": cls, "state": state, "mods": 2, "half": H, "walls": T, "floors": F, "top": top,
        "parapet_top": top + SILL + MERLON_H + COPING,
        "frame": "origin = tower centre; +y points into the castle; outer -y", "bbox": [[-H - 0.7, -H - 0.7, FOUND], [H + 0.7, H + 0.7, top + 5.2]],
        "walks": [{"id": "room0", "lvl": 0, "z": 0.0, "kind": "poly", "poly": [[-I, -I], [I, -I], [I, I], [-I, I]], "stair_well": L.V3((*stair_c, stair_r))},
                  {"id": "room1", "lvl": 3, "z": F[1], "kind": "poly", "poly": [[-I, -I], [I, -I], [I, I], [-I, I]], "stair_well": L.V3((*stair_c, stair_r))},
                  {"id": "room2", "lvl": 1, "z": F[2], "kind": "poly", "poly": [[-I, -I], [I, -I], [I, I], [-I, I]], "stair_well": L.V3((*stair_c, stair_r))},
                  {"id": "top", "lvl": 2, "z": top, "kind": "poly", "poly": [[-hp + 0.45, -hp + 0.45], [hp - 0.45, -hp + 0.45], [hp - 0.45, hp - 0.45], [-hp + 0.45, hp - 0.45]],
                   "blocked": [{"c": list(stair_c), "r": 1.65, "what": "stair turret"}]}],
        "sockets": sockets,
        "doors": [{"id": "ground", "p_out": L.V3((0, H + 1.2, 0)), "p_in": L.V3((0, I - 0.5, 0)), "width": 1.0, "leaf": "door"}],
        "links": _stair_links(steps, stair_c, stair_r, F, top),
        "parapet": {"sill_z": top + SILL, "top_z": top + SILL + MERLON_H + COPING, "crenels": [{"p": L.V3(c[:3])} for c in cren]},
        "cutaway": "as the round tower",
    }
    if state == "intact":
        meta["states"] = {s: f"{name}_{s}" for s in ("pocked", "cracked", "collapsed")}
    nm = name if state == "intact" else f"{name}_{state}"
    L.finish_piece(nm, parts_final, moving, meta=meta, lods=(1.0, 0.45), fresh=fresh, grime_h=2.2)


ALL = [(n, s) for n in ("tower_round", "tower_round_inner", "tower_round_outer", "tower_square") for s in ("intact", "pocked", "cracked", "collapsed")]

if __name__ == "__main__":
    want = argv or [n if s == "intact" else f"{n}_{s}" for n, s in ALL]
    for n, s in ALL:
        nm = n if s == "intact" else f"{n}_{s}"
        if nm in want:
            (build_square if n == "tower_square" else build_round)(n, s)
