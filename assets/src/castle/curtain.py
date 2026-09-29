"""Castle curtain wall — one 6 m siege module (b.mods) per piece.

    tools/heavy.sh /opt/homebrew/bin/blender -t 2 -b -P assets/src/castle/curtain.py -- [piece ...]

pieces (main wall class, walk 8 m, 2.6 m thick):
        curtain curtain_b (+ _pocked _cracked _breach) curtain_stair (2 modules) postern
        curtain_corner curtain_corner_in (+ _pocked _cracked)
  concentric classes: curtain_inner (walk 10, 3.0 thick) and curtain_outer (walk 5.5, 2.2 thick), each with
        _pocked _cracked _breach and a convex _corner.
Local frame: wall centreline along X from x=-3 to x=+3 (ports), outer (field) face toward -Y at y=-HT,
bailey face at y=+HT, ground z=0, wall-walk on top behind a 0.6 m parapet, crenel sills SILL above the walk.
Joints between modules fall inside merlons, so modules abut seamlessly.
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import _castle as L
import _damage as D
from _dims import *

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
CLS = "main"


def set_class(cls):
    """Rebind the wall-class numbers used by every builder below."""
    global CLS, HT, WALK_Z, PARA_T, SILL, MERLON_H, PLINTH_H, PLINTH_OUT, WALK_Y0, WALK_Y1, WALK_W, WALK_YC
    W = WALLS[cls]; CLS = cls
    HT, WALK_Z, PARA_T, SILL, MERLON_H = W["ht"], W["walk"], W["para"], W["sill"], W["merlon"]
    PLINTH_H, PLINTH_OUT = W["plinth"], W["plinth_out"]
    WALK_Y0 = -HT + PARA_T; WALK_Y1 = HT; WALK_W = WALK_Y1 - WALK_Y0; WALK_YC = (WALK_Y0 + WALK_Y1) / 2


def split_name(name):
    cls = "inner" if "_inner" in name else "outer" if "_outer" in name else "main"
    return cls, name.replace("_inner", "").replace("_outer", "")


def ladder_points(xs, y_face=None, z_top=None):
    y_face = -HT if y_face is None else y_face; z_top = WALK_Z + SILL if z_top is None else z_top
    run = z_top / math.tan(math.radians(LADDER_ANGLE))
    return [{"top": L.V3((x, y_face, z_top)), "foot": L.V3((x, y_face - PLINTH_OUT - run + PLINTH_OUT * 0.3, 0.0)),
             "len": round(math.hypot(z_top, run), 2)} for x in xs]


def wall_body(res, dense=False, length=MOD):
    """The wall mass: foundation to walk, with the walk surface on top."""
    w = L.Solid("body")
    r = {"*": res, "-y": 0.33 if dense else res}
    w.box(-length / 2, length / 2, -HT, HT, FOUND, WALK_Z, "ashlar", res=r, keys={"+z": "paving", "-x": "rubble", "+x": "rubble", "-z": "rubble"})
    return w


def plinth(res, length=MOD):
    p = L.Solid("plinth")
    prof = [(-HT + 0.01, FOUND), (-HT - PLINTH_OUT, FOUND), (-HT - PLINTH_OUT, 0.0), (-HT - PLINTH_OUT * 0.92, 0.35), (-HT + 0.01, PLINTH_H)]
    p.extrude(prof, (-length / 2, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), 0, length, "ashlar")
    # chamfered string course on top of the batter
    sc = [(-HT + 0.01, PLINTH_H - 0.05), (-HT - 0.1, PLINTH_H - 0.05), (-HT - 0.1, PLINTH_H + 0.1), (-HT + 0.01, PLINTH_H + 0.22)]
    p.extrude(sc, (-length / 2, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), 0, length, "ashlar")
    return p


def parapet(res, phase=-1.05, length=MOD):
    s = L.Solid("para")
    cren = L.battlements(s, [(-length / 2, -HT + PARA_T / 2), (length / 2, -HT + PARA_T / 2)], WALK_Z, thick=PARA_T,
                         breast=SILL, merlon_h=MERLON_H, merlon_w=MERLON_W, crenel_w=CRENEL_W, phase=phase, res=res)
    return s, cren


def build(name, state):
    cls, piece = split_name(name)
    set_class(cls)
    seed = {"curtain": 3, "curtain_b": 7, "curtain_stair": 11, "postern": 13}.get(piece, 5) + {"intact": 0, "pocked": 100, "cracked": 200, "breach": 300}[state] + {"main": 0, "inner": 30, "outer": 60}[cls]
    L.reset(seed)
    rng = random.Random(seed)
    dense = state in ("pocked", "cracked")
    res = 0.8
    LEN = 2 * MOD if piece == "curtain_stair" else MOD
    body = wall_body(res, dense, LEN).to_object()
    pl = plinth(res, LEN).to_object(recalc=True)
    ps, cren = parapet(res, -1.05 if LEN == MOD else -1.05, LEN)
    para = ps.to_object(recalc=True)
    extra = L.Solid("extra")
    cuts_body, cuts_para = [], []
    soot, fresh = [], []
    meta_links = []
    doors = []
    # arrow loop through the central merlon
    cuts_para += L.slit_cutter((0.0, -HT), (0, 1), (1, 0), WALK_Z + 0.45, WALK_Z + SILL + 0.85, 0, PARA_T,
                               w_slit=0.075, w_in=0.55, cross=(piece == "curtain_b"), oillet=0.15)
    # hoarding putlog holes just under the wall-walk, every 1.5 m (the hoarding piece's beams go in these)
    for x in (-2.25, -0.75, 0.75, 2.25):
        cuts_body.append(L.box_cutter(x - 0.13, x + 0.13, -HT - 0.2, -HT + 0.9, WALK_Z - 0.62, WALK_Z - 0.36))
    zs = WALK_Z / 8.0
    # scaffold putlogs on the bailey face
    for x, z in ((-1.6, 2.7), (1.4, 2.8), (-0.2, 5.3), (2.4, 5.4)):
        if piece == "curtain_stair":
            continue
        z *= zs
        cuts_body.append(L.box_cutter(x - 0.08, x + 0.08, HT - 0.5, HT + 0.2, z, z + 0.16))
    if piece == "curtain_b":
        # a stone drain spout from the wall-walk through the parapet
        extra.box(0.6, 0.86, -HT - 0.55, -HT + 0.02, WALK_Z - 0.05, WALK_Z + 0.2, "ashlar", res=9)
        cuts_para.append(L.box_cutter(0.64, 0.82, -HT - 0.6, -HT + PARA_T + 0.1, WALK_Z + 0.02, WALK_Z + 0.16))
    if piece == "curtain_stair":
        # one straight flight against the bailey face, rising along -X from the ground at x=+5.7 to the
        # wall-walk at x=-3.0, carried on a solid sloping mass; a landing at the top joins the walk.
        st = L.Solid("stair")
        W = 1.3; y0 = HT; yc = HT + W / 2
        n = 32; going = 8.64 / n; rise = WALK_Z / n
        for i in range(n):
            xa = 5.7 - going * i; xb = xa - going
            st.box(xb, xa, y0 - 0.02, y0 + W, 0.0, rise * (i + 1), "ashlar", res=9, keys={"+z": "paving"}, skip=("-z", "-y"))
        st.box(-5.9, -2.94, y0 - 0.02, y0 + W, 0.0, WALK_Z, "ashlar", keys={"+z": "paving"})
        extra.merge(st)
        meta_links.append({"kind": "stair", "a": {"surf": "ground_in", "p": L.V3((6.0, yc, 0.0))},
                           "b": {"surf": "walk", "p": L.V3((-3.3, WALK_YC, WALK_Z))}, "width": 1, "len": 11.8,
                           "via": [L.V3((5.5, yc, 0.25)), L.V3((-3.0, yc, WALK_Z))]})
    if piece == "postern":
        # a small door through the wall at ground level with a passage through the thickness
        cuts_body.append(L.opening_cutter((0.4, 0.0), (1, 0), (0, 1), 1.15, 1.75, -HT - 0.8, HT + 0.2, kind="pointed", key="ashlar"))
        pl_cuts = [L.opening_cutter((0.4, 0.0), (1, 0), (0, 1), 1.15, 1.75, -HT - 1.0, 0.0, kind="pointed", key="ashlar")]
        L.cut(pl, pl_cuts)
        # a stone threshold step outside
        extra.box(-0.35, 1.15, -HT - PLINTH_OUT - 0.5, -HT + 0.05, -0.2, 0.12, "ashlar", res=9, keys={"+z": "paving"})
        doors.append({"id": "postern", "p": L.V3((0.4, -HT, 0.0)), "q": L.V3((0.4, HT, 0.0)), "width": 1.1, "height": 2.3,
                      "leaf": "door", "surf_a": "ground_out", "surf_b": "ground_in"})
    if piece == "curtain_b":
        soot.append((0.0, -HT, WALK_Z + SILL + 0.6, 0.35, 1.3, 0.4))   # smoke-stained loop
    # damage ------------------------------------------------------------------
    walk_segments = [(-LEN / 2, LEN / 2)]
    if state in ("pocked", "cracked"):
        nimp = 5 if state == "pocked" else 8
        imps = []
        for i in range(nimp):
            x = rng.uniform(-2.6, 2.6); z = (rng.uniform(2.6, 9.6) if i else rng.uniform(5.5, 7.5)) * zs
            R = rng.uniform(0.45, 0.85); Dd = rng.uniform(0.12, 0.3)
            imps.append((x, -HT, z, R, Dd)); fresh.append((x, -HT - 0.1, z, R * 1.5))
        for (x, y, z, R, Dd) in imps:
            c = D.pock_cutter((x, -HT, z), (0, 1, 0), R, Dd + 0.1, rng)
            (cuts_para if z > WALK_Z + 0.2 else cuts_body).append(c)
        # a chipped merlon
        cuts_para.append(D.pock_cutter((2.35, -HT + 0.1, WALK_Z + SILL + MERLON_H), (0, 1, 0), 0.75, 0.9, rng))
        fresh.append((2.4, -1.1, WALK_Z + SILL + 0.8, 0.8))
        for i in range(10 if state == "pocked" else 16):
            s = rng.uniform(0.2, 0.55)
            L.chunk(extra, (rng.uniform(-3, 3), rng.uniform(-HT - 3.0, -HT - PLINTH_OUT - 0.1), s * 0.25), (s * 1.5, s, s * 0.7), rng, "ashlar")
    if state == "cracked":
        # a shear crack from the crenel down through the facing: slot + the right side pushed out and tilted
        x0 = rng.uniform(-0.9, -0.2)
        path = D.jagged_path((x0 + 1.5 - 1.5, WALK_Z + SILL), (x0 + rng.uniform(0.5, 1.2), 2.6 * zs), rng, steps=14, amp=0.22)
        path = [(-1.5 + (p[0] - path[0][0]) * 1.0 + 0.0, p[1]) for p in path]   # starts in the left crenel
        cut = D.crack_cutter(path, 0.11, 0.035, -HT, 0.45, key="dark", seed=seed)
        cut2 = D.crack_cutter(path, 0.11, 0.035, -HT, 0.45, key="dark", seed=seed)
        cuts_body.append(cut); cuts_para.append(cut2)
        # bulge: everything right of the crack leans out a few cm at the top
        for o in (body, para):
            for v in o.data.vertices:
                if v.co.y < -HT + 0.05 and v.co.z > 2.6 * zs:
                    # right of crack at this height?
                    zz = v.co.z; xc = None
                    for a, b in zip(path[:-1], path[1:]):
                        if min(a[1], b[1]) <= zz <= max(a[1], b[1]):
                            t = (zz - a[1]) / (b[1] - a[1] + 1e-9); xc = a[0] + (b[0] - a[0]) * t
                    if xc is not None and v.co.x > xc + 0.03:
                        v.co.y -= 0.02 + 0.05 * (zz - 2.6 * zs) / (WALK_Z + SILL - 2.6 * zs)
        # fallen parapet stones on the walk
        for i in range(6):
            s = rng.uniform(0.2, 0.45)
            L.chunk(extra, (rng.uniform(-2.5, 0.5), rng.uniform(-0.6, 0.9), WALK_Z + s * 0.2), (s * 1.4, s, s * 0.6), rng, "ashlar")
        # soot of a fire-arrow blaze on the walk? no: keep clean
    if state == "breach":
        poly, Ls, Rs = D.breach_profile(2.75, WALK_Z + SILL + MERLON_H, 1.3, 1.1 * zs, rng)
        s = L.Solid("gap")
        s.extrude(poly, (0, -HT - 1.0, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0, 2 * HT + 2.0, "rubble")
        gap1 = s.to_object(recalc=True, weld=True)
        s = L.Solid("gap2")
        s.extrude(poly, (0, -HT - 1.0, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0, 2 * HT + 2.0, "rubble")
        gap2 = s.to_object(recalc=True, weld=True)
        s = L.Solid("gap3")
        s.extrude(poly, (0, -HT - 1.0, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0, 2 * HT + 2.0, "rubble")
        gap3 = s.to_object(recalc=True, weld=True)
        cuts_body.append(gap1); cuts_para.append(gap2)
        L.cut(pl, [gap3])
        crest_h = 2.6 * zs
        f = D.mound_height([(-1.9, 1.9, 0.0, crest_h + 0.35, crest_h)], 0.6, 0.66,
                           extra=[(-2.8, -0.2, 5.2 * zs, 1.05), (2.8, 0.3, 4.6 * zs, 1.05), (-1.0, -3.0, 1.2, 0.5), (1.5, 3.4, 1.0, 0.5)],
                           seed=seed)
        mound = L.Solid("mound")
        L.rubble_mound(mound, f, -6.5, 6.5, -9.5, 9.0, res=0.4, key="debris")
        D.scatter_chunks(mound, f, -5.5, 5.5, -8.5, 8.0, 70, rng, key="ashlar", smin=0.25, smax=0.8)
        D.scatter_chunks(mound, f, -3, 3, -4, 4, 20, rng, key="rubble", smin=0.3, smax=0.6)
        extra.merge(mound)
        xl = min(p[0] for p in Ls if p[1] >= WALK_Z - 0.01); xr = max(p[0] for p in Rs if p[1] >= WALK_Z - 0.01)
        walk_segments = [(-MOD / 2, xl), (xr, MOD / 2)]
        fresh += [(0, -0.5, 5.0, 2.0)]
        meta_links += [
            {"kind": "breach", "a": {"surf": "ground_out", "p": L.V3((0.0, -9.0, 0.0))},
             "b": {"surf": "crest", "p": L.V3((0.0, 0.0, f(0, 0)))}, "width": 4, "slope_deg": 31},
            {"kind": "breach", "a": {"surf": "crest", "p": L.V3((0.0, 0.0, f(0, 0)))},
             "b": {"surf": "ground_in", "p": L.V3((0.0, 8.5, 0.0))}, "width": 4, "slope_deg": 33},
            {"kind": "scramble", "a": {"surf": "crest", "p": L.V3((-1.6, 0.0, f(-1.6, 0)))},
             "b": {"surf": "walk", "p": L.V3((xl, WALK_YC, WALK_Z))}, "width": 1, "note": "rubble heaped against the broken wall end; slow"},
            {"kind": "scramble", "a": {"surf": "crest", "p": L.V3((1.6, 0.0, f(1.6, 0)))},
             "b": {"surf": "walk", "p": L.V3((xr, WALK_YC, WALK_Z))}, "width": 1, "note": "rubble heaped against the broken wall end; slow"},
        ]
    L.cut(body, cuts_body)
    L.cut(para, cuts_para)
    ex = extra.to_object(recalc=False) if len(extra.bm.faces) else None
    parts = {"base": [body, pl, para] + ([ex] if ex else [])}
    moving = {}
    if piece == "postern":
        leaf = L.Solid("door")
        prof = [(u, z) for u, z in L.arch_profile(1.08, 1.72, "pointed")]
        leaf.extrude(prof, (0.4, HT - 0.55, 0.0), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.0, 0.1, "planks")
        # iron straps
        for z in (0.35, 1.1, 1.7):
            leaf.box(-0.1 + 0.4 - 0.46, 0.4 + 0.46, HT - 0.58, HT - 0.54, z, z + 0.07, "iron", res=9)
        moving["door"] = ([leaf.to_object(recalc=True)], (0.4 - 0.54, HT - 0.5, 0.0))
    crenels = [{"p": L.V3((c[0], c[1], c[2]))} for c in cren]
    meta = {
        "kind": "curtain", "variant": piece, "state": state, "mods": int(LEN / MOD),
        "size": [LEN, 2 * HT, WALK_Z + SILL + MERLON_H + COPING],
        "bbox": [[-LEN / 2, -HT - PLINTH_OUT, FOUND], [LEN / 2, HT + (1.3 if piece == "curtain_stair" else 0), WALK_Z + SILL + MERLON_H + 0.17]],
        "ports": [{"p": [-LEN / 2, 0, 0], "dir": [-1, 0]}, {"p": [LEN / 2, 0, 0], "dir": [1, 0]}],
        "outer": [0, -1],
        "walks": [{"id": "walk" if len(walk_segments) == 1 else f"walk_{i}", "lvl": 1, "z": WALK_Z, "kind": "strip",
                   "line": [[a, WALK_YC], [b, WALK_YC]], "width": WALK_W} for i, (a, b) in enumerate(walk_segments)] +
                 ([{"id": "stair_landing", "lvl": 1, "z": WALK_Z, "kind": "poly", "poly": [[-5.9, HT], [-2.94, HT], [-2.94, HT + 1.3], [-5.9, HT + 1.3]]}] if piece == "curtain_stair" else []),
        "parapet": {"face_y": -HT, "inner_y": WALK_Y0, "sill_z": WALK_Z + SILL, "top_z": WALK_Z + SILL + MERLON_H + COPING, "crenels": crenels,
                    "loops": [{"p": L.V3((0.0, -HT, WALK_Z + 0.45)), "h": SILL + 0.4, "dir": [0, -1]}]},
        "ladders": ladder_points([c[0] for c in cren]) if state != "breach" else [],
        "hoarding_sockets": [L.V3((x, -HT, WALK_Z - 0.49)) for x in (-2.25, -0.75, 0.75, 2.25)],
        "doors": doors, "links": meta_links,
        "states": None,
    }
    if state == "breach":
        meta["gap"] = {"x": [xl, xr], "floor_z": 1.1 * zs, "crest": L.V3((0, 0, f(0, 0)))}
    meta["wall_class"] = CLS
    name = name if state == "intact" else f"{name}_{state}"
    if state == "intact" and piece in ("curtain", "curtain_b"):
        meta["states"] = {s: f"{name}_{s}" for s in ("pocked", "cracked", "breach")}
    else:
        meta.pop("states")
    L.finish_piece(name, parts, moving, meta=meta, lods=(1.0, 0.45), fresh=fresh, soot=soot, grime_h=1.8 * zs)


def build_corner(name, state):
    """90-degree corner on the curtain line. convex (curtain_corner): arms along -X and +Y from the corner
    point at the origin, outer faces -Y and -X... see the manifest ports. concave: the mirror (outer inside)."""
    cls, piece = split_name(name)
    set_class(cls)
    seed = (21 if piece == "curtain_corner" else 23) + {"intact": 0, "pocked": 100, "cracked": 200}[state] + {"main": 0, "inner": 30, "outer": 60}[cls]
    L.reset(seed); rng = random.Random(seed)
    convex = piece == "curtain_corner"
    # corner at the origin, arm A from (-3,0) to the corner, arm B from the corner to (0,3). Outer faces
    # are on the RIGHT of travel (-Y for arm A, -X... for arm B travelling +Y the right is +X). For the
    # convex corner the outside is the -Y/+X side: the enceinte turns LEFT here.
    s_out = 1 if convex else -1
    # wall body as a prism of the L-shaped footprint
    o = s_out * HT
    # outline: centreline (-3,0)->(0,0)->(0,3); offsets: outer side = right
    pa = [Vector((-3, 0)), Vector((0, 0)), Vector((0, 3))]
    def offs(d):
        # d>0 = right side
        return [Vector((-3, -d)), Vector((d, -d)), Vector((d, 3))]
    R_ = offs(HT); Lf = offs(-HT)
    foot = [(p.x, p.y) for p in R_] + [(p.x, p.y) for p in reversed(Lf)]
    b = L.Solid("body")
    keys = None
    b.prism(foot, FOUND, WALK_Z, "ashlar", res=0.8, capkey="paving")
    body = b.to_object(recalc=True)
    # plinth: on the outer side only
    pls = L.Solid("plinth")
    side = 1 if convex else -1
    outer = offs(side * HT); outer2 = offs(side * (HT + PLINTH_OUT))
    # batter as a prism between outer polyline and the offset one, with sloped top via extrude per segment
    for i in range(2):
        a0, a1 = outer[i], outer[i + 1]; b0, b1 = outer2[i], outer2[i + 1]
        poly = [a0, a1, b1, b0]
        pls.prism([(p.x, p.y) for p in poly], FOUND, 0.0, "ashlar", res=0.8)
        # sloped face
        pls.face([(b0.x, b0.y, 0), (b1.x, b1.y, 0), (a1.x, a1.y, PLINTH_H), (a0.x, a0.y, PLINTH_H)], "ashlar")
        pls.face([(a0.x, a0.y, 0), (a0.x, a0.y, PLINTH_H), (b0.x, b0.y, 0)] if i == 0 else [(a1.x, a1.y, 0), (b1.x, b1.y, 0), (a1.x, a1.y, PLINTH_H)], "ashlar")
    pl = pls.to_object(recalc=False)
    ps = L.Solid("para")
    pc = offs(side * (HT - PARA_T / 2))
    if not convex:
        pc = pc[::-1]          # keep the outer side on the right of travel
    tot = sum((b_ - a_).length for a_, b_ in zip(pc, pc[1:]))
    iv = [(0, 1.05), (1.95, tot - 1.95), (tot - 1.05, tot)] if convex else [(0, tot)]
    cren = L.battlements(ps, [(p.x, p.y) for p in pc], WALK_Z, thick=PARA_T, breast=SILL, merlon_h=MERLON_H,
                         merlon_w=MERLON_W, crenel_w=CRENEL_W, intervals=iv, res=0.8)
    para = ps.to_object(recalc=True)
    fresh = []; extra = L.Solid("extra")
    if state != "intact":
        imps = []
        for i in range(4 if state == "pocked" else 7):
            if rng.random() < 0.5:
                x = rng.uniform(-2.6, -0.4); y = -side * HT
            else:
                x = side * HT; y = rng.uniform(0.4, 2.6)
            z = rng.uniform(2.8, 9.5) * WALK_Z / 8.0
            imps.append((x, y, z, rng.uniform(0.45, 0.8), rng.uniform(0.12, 0.28))); fresh.append((x, y, z, 1.0))
        cb, cp_ = [], []
        for (x, y, z, R, Dd) in imps:
            inw = (0, side, 0) if abs(y + side * HT) < 0.03 else (-side, 0, 0)
            (cp_ if z > WALK_Z + 0.2 else cb).append(D.pock_cutter((x, y, z), inw, R, Dd + 0.1, rng))
        L.cut(body, cb); L.cut(para, cp_)
        for i in range(10):
            s = rng.uniform(0.2, 0.5)
            L.chunk(extra, (rng.uniform(-3, 0) if convex else rng.uniform(-3, -1.8), -side * (HT + rng.uniform(0.8, 2.5)), s * 0.25), (s * 1.5, s, s * 0.7), rng)
    ex = extra.to_object() if len(extra.bm.faces) else None
    walk_line = [[-3, WALK_YC * (1)], [0, 0], [0, 3]]
    wc = offs(-WALK_YC * side)
    meta = {"kind": "curtain_corner", "variant": piece, "state": state, "mods": 1, "convex": convex,
            "size": [3 + HT, 3 + HT, WALK_Z + SILL + MERLON_H + COPING],
            "ports": [{"p": [-3, 0, 0], "dir": [-1, 0]}, {"p": [0, 3, 0], "dir": [0, 1]}],
            "outer_side": "right of travel from port 0 to port 1" if convex else "left of travel from port 0 to port 1",
            "walks": [{"id": "walk", "lvl": 1, "z": WALK_Z, "kind": "strip", "line": [L.V2(p) for p in wc], "width": WALK_W}],
            "parapet": {"sill_z": WALK_Z + SILL, "top_z": WALK_Z + SILL + MERLON_H + COPING, "crenels": [{"p": L.V3(c[:3])} for c in cren]},
            "ladders": [], "doors": [], "links": []}
    meta["wall_class"] = CLS
    if state == "intact":
        meta["states"] = {s: f"{name}_{s}" for s in ("pocked", "cracked")}
    name = name if state == "intact" else f"{name}_{state}"
    L.finish_piece(name, {"base": [body, pl, para] + ([ex] if ex else [])}, meta=meta, lods=(1.0, 0.45), fresh=fresh)


ALL = []
for p in ("curtain", "curtain_b", "curtain_inner", "curtain_outer"):
    for st in ("intact", "pocked", "cracked", "breach"):
        ALL.append((p, st))
ALL += [("curtain_stair", "intact"), ("postern", "intact")]
ALL += [("curtain_corner", st) for st in ("intact", "pocked", "cracked")] + [("curtain_corner_in", st) for st in ("intact", "pocked", "cracked")]
ALL += [("curtain_inner_corner", "intact"), ("curtain_outer_corner", "intact")]

if __name__ == "__main__":
    want = argv or [f"{p}" if st == "intact" else f"{p}_{st}" for p, st in ALL]
    for p, st in ALL:
        nm = p if st == "intact" else f"{p}_{st}"
        if nm in want:
            if "corner" in p:
                build_corner(p, st)
            else:
                build(p, st)
