"""HIGHGROUND units — kit for the foot arms (levy, pikemen, men-at-arms, archers, crossbowmen).

Builders follow _human.py's conventions (rest pose, man faces -Y, held things lie along Y through
H.fist(side) with the business end toward -Y). Painters register themselves into _paint.PAINTERS / FLAT
on import, so a recipe only has to `import _arms_kit as K`.

Helper bones (added by the recipe's SPEC["rig"] hook, driven by P.cons in _arms_anims.py):
    draw_pt   child of hand.R at the right fist (non-deform): where drawing fingers hold the string
    nock      child of hand.L at the longbow string's rest midpoint; COPY_LOCATION draw_pt, "x_draw"
    arrow     child of hand.L at the left fist; COPY_LOCATION draw_pt, "x_arrow" (the nocked arrow's tail:
              at rest it sits in the bow hand and the arrow collapses to a stub hidden in the fist)
    xstring   child of hand.R at the crossbow string's rest (uncocked) midpoint; COPY_LOCATION xnut, "x_cock"
    xnut      child of hand.R at the crossbow's nut (non-deform)
    ground    parentless, at the origin: things planted in the ground (the pavise) never move with the root
"""
import bpy, math
import numpy as np
from mathutils import Vector, Matrix
import _human as H
import _paint as PT
from _human import Vector as V

fist = H.fist


# ------------------------------------------------------------------------------------------ rig hooks
def _edit(rig):
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    return rig.data.edit_bones

def _bone(eb, name, head, parent, deform=True):
    b = eb.new(name); b.head = head; b.tail = head + Vector((0, 0, 0.05)); b.roll = 0
    if parent: b.parent = eb[parent]; b.use_connect = False
    b.use_deform = deform
    return b

def _copyloc(rig, bone, target, name):
    pb = rig.pose.bones[bone]; pb.rotation_mode = "QUATERNION"
    c = pb.constraints.new("COPY_LOCATION"); c.target = rig; c.subtarget = target; c.name = name; c.influence = 0.0

BOW_BRACE = 0.145          # longbow: string to grip (rest +Z side of the left fist = toward the archer when drawn)
def bow_rig(rig):
    eb = _edit(rig)
    _bone(eb, "draw_pt", fist("R"), "hand.R", deform=False)
    _bone(eb, "nock", fist("L") + Vector((0, 0, BOW_BRACE)), "hand.L")
    _bone(eb, "arrow", fist("L") + Vector((0.0, 0, 0.0)), "hand.L")
    _bone(eb, "ground", Vector((0, 0, 0)), None)
    # the drawing hand's IK target rides the bow hand, starting at the string (P.locs slides it back)
    _bone(eb, "draw_tgt", fist("L") + Vector((0, 0, BOW_BRACE)), "hand.L", deform=False)
    _bone(eb, "draw_pole", Vector((-0.55, 0.55, 1.75)), "chest", deform=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    for b in ("draw_pt", "nock", "arrow", "ground", "draw_tgt", "draw_pole"): rig.pose.bones[b].rotation_mode = "QUATERNION"
    _copyloc(rig, "nock", "draw_pt", "x_draw")
    _copyloc(rig, "arrow", "draw_pt", "x_arrow")
    c = rig.pose.bones["forearm.R"].constraints.new("IK")
    c.target = rig; c.subtarget = "draw_tgt"; c.pole_target = rig; c.pole_subtarget = "draw_pole"
    c.pole_angle = math.radians(180); c.chain_count = 2; c.influence = 0.0; c.name = "x_drawik"
    # the off-hand IK (left hand onto the right-hand tool) would close a dependency loop with the draw IK;
    # the bow family never uses it: leave the constraint (apply_pose sets it) but without a target
    rig.pose.bones["forearm.L"].constraints["offhand"].target = None

XB = {"butt": 0.30, "nut": -0.06, "prod": -0.40, "span": 0.36}   # crossbow stations along -Y from the right fist
def xbow_rig(rig):
    eb = _edit(rig)
    f = fist("R")
    _bone(eb, "xstring", f + Vector((0, XB["prod"] + 0.07, 0.035)), "hand.R")
    _bone(eb, "xnut", f + Vector((0, XB["nut"], 0.035)), "hand.R", deform=False)
    _bone(eb, "ground", Vector((0, 0, 0)), None)
    bpy.ops.object.mode_set(mode="OBJECT")
    for b in ("xstring", "xnut", "ground"): rig.pose.bones[b].rotation_mode = "QUATERNION"
    _copyloc(rig, "xstring", "xnut", "x_cock")

def ground_rig(rig):
    eb = _edit(rig); _bone(eb, "ground", Vector((0, 0, 0)), None)
    bpy.ops.object.mode_set(mode="OBJECT"); rig.pose.bones["ground"].rotation_mode = "QUATERNION"


# ------------------------------------------------------------------------------------------ small helpers
def tube(P, pts, radii, mat, w, segs=6, cap0=True, cap1=True, pat_len=True, n=2.0):
    """a tube through pts (list of Vectors), radius per point (float or (rx, ry)); w = weights or list per point."""
    rings = []; L = 0.0; pats = []
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]
        sv, bk = H.frame_for(b - a)
        r = radii[i]; rx, ry = (r, r) if not isinstance(r, tuple) else r
        if i: L += (pts[i] - pts[i - 1]).length
        ww = w[i] if isinstance(w, list) else w
        rings.append((H.ring(p, sv, bk, rx, ry, segs, n), ww)); pats.append([(L, 0, 1)] * segs)
    return H.loft(P, rings, mat, cap0=cap0, cap1=cap1, pats=pats if pat_len else None)


def gauntlet_hand(P, side, mat, segs=8, lod=0):
    """mitten gauntlet: the fist a little fatter, a flared cuff over the wrist."""
    H.hand(P, side, mat, segs=segs, lod=lod)
    wr, el = H.jp("wrist", side), H.jp("elbow", side)
    d = (wr - el).normalized(); sv, bk = H.frame_for(d)
    w = {f"forearm.{side}": 0.6, f"hand.{side}": 0.4}
    if lod: return
    rings = [(H.ring(wr - d * 0.07, sv, bk, 0.036, 0.034, segs), {f"forearm.{side}": 1}),
             (H.ring(wr + d * 0.01, sv, bk, 0.046, 0.044, segs), w)]
    H.loft(P, rings, mat)


# ------------------------------------------------------------------------------------------ helmets / heads
def bascinet(P, mat, segs=16, lod=0):
    """open-faced bascinet c.1330-60: a head-hugging skull drawn up to a point behind the crown, the sides
    coming down over the ears to the jaw; the face stays open (an aventail of mail hangs from the rim)."""
    if lod: segs = 10
    rings = []
    phs = [0.0, 0.30, 0.62, 0.95, 1.28, 1.60, 1.92] if not lod else [0.0, 0.62, 1.28, 1.92]
    for i, ph in enumerate(phs):
        pts = []
        for k in range(segs):
            th = 2 * math.pi * k / segs
            p = H.head_point(th, max(ph, 0.02), 0.030)
            # pointed crown: lift the top rings, the apex slightly to the back
            lift = 0.075 * max(0.0, 1 - ph / 1.0) ** 1.6
            p = p + Vector((0, 0.012 * lift / 0.075, lift))
            pts.append(p)
        rings.append((pts, {"head": 1}))
    nh = len(phs)
    def skip(i, k):  # the face opening: brow down to the chin, wide
        th = 2 * math.pi * (k + 0.5) / segs
        da = abs((th - 1.5 * math.pi + math.pi) % (2 * math.pi) - math.pi)
        return phs[i] >= 1.2 and da < 0.95
    ids = H.loft(P, rings, mat, cap0=0.02, skip=skip)
    return ids


def aventail(P, mat, segs=14, lod=0):
    """mail aventail: from the bascinet's rim round the face, over the throat and out over the shoulders."""
    if lod: segs = 10
    rings = []
    # hood part round the face (open front like a coif) then the tippet over the shoulders
    for ph in ((1.55, 1.85, 2.15) if not lod else (1.6, 2.15)):
        rings.append(([H.head_point(2 * math.pi * k / segs, ph, 0.024 + 0.006 * ph) for k in range(segs)], {"head": 1}))
    cape = [(1.50, 0.092, 0.098, 0.012, {"neck": 0.6, "head": 0.4}), (1.455, 0.160, 0.126, 0.012, {"neck": 0.3, "chest": 0.7}),
            (1.405, 0.215, 0.150, 0.010, {"chest": 1}), (1.35, 0.232, 0.160, 0.004, {"chest": 1})]
    if lod: cape = [cape[0], cape[3]]
    for z, rx, ry, yc, w in cape:
        pts = H.ring(Vector((0, yc, z)), Vector((1, 0, 0)), Vector((0, 1, 0)), rx, ry, segs, 2.3)
        def wf(k, pts=pts, w=w, z=z):
            x = pts[k].x; a = H.sstep(0.10, 0.22, abs(x)) * (0.5 if z < 1.42 else 0.2)
            return H.wmix(w, {("upperarm.L" if x > 0 else "upperarm.R"): 1}, a) if a > 0 else w
        rings.append((pts, wf))
    nfront = 3 if not lod else 2
    def skip(i, k):
        if i >= nfront - 1: return False
        th = 2 * math.pi * (k + 0.5) / segs
        da = abs((th - 1.5 * math.pi + math.pi) % (2 * math.pi) - math.pi)
        return da < 0.62
    H.loft(P, rings, mat, skip=skip)


def visor(P, part_mat, lod=0):
    """a pig-faced (houndskull) visor, closed: a snouted cone over the face with eye slits and breaths (painted)."""
    c = H.HEAD_C + Vector((0, -0.070, -0.010))
    segs = 8 if lod else 12
    prof = [(0.0, 0.135), (0.018, 0.128), (0.045, 0.100), (0.072, 0.062), (0.090, 0.030), (0.095, 0.0)]
    H.lathe_axis(P, c + Vector((0, 0.035, 0)), Vector((0, -1, 0)), [(r, h) for r, h in prof], segs, part_mat, {"head": 1})


def brimmed_hat(P, mat, segs=12, lod=0):
    """a felt hat with a rolled brim turned up at the back, worn over a coif by archers without a helmet."""
    if lod: segs = 10
    c = Vector((0, 0.010, 1.615))
    prof = [(0.0, 0.140), (0.050, 0.135), (0.082, 0.112), (0.100, 0.075), (0.106, 0.042), (0.112, 0.030),
            (0.150, 0.018), (0.168, 0.016), (0.164, 0.024), (0.118, 0.036)]
    if lod: prof = [prof[0], prof[2], prof[4], prof[6], prof[7], prof[9]]
    ids = H.lathe(P, c, prof, segs, mat, {"head": 1})
    # turn the brim up at the back and droop it at the front
    for row in ids[-5:] if not lod else ids[-3:]:
        for vi in row:
            p = P.v[vi]; dy = p.y - c.y; r = math.hypot(p.x, dy)
            if r > 0.12: P.v[vi] = p + Vector((0, 0, 0.35 * (r - 0.12) * (dy / (r + 1e-6)) + 0.012 * (dy > 0) * (r - 0.12) / 0.05))


def felt_cap(P, mat, segs=12, lod=0):
    """a close woollen cap (levy without a helmet), rolled at the edge."""
    if lod: segs = 9
    rings = []
    phs = [0.10, 0.45, 0.85, 1.20, 1.38] if not lod else [0.15, 0.85, 1.38]
    for ph in phs:
        rings.append(([H.head_point(2 * math.pi * k / segs, ph, 0.018 + 0.012 * (ph > 1.3)) for k in range(segs)], {"head": 1}))
    H.loft(P, rings, mat, cap0=0.015)


# ------------------------------------------------------------------------------------------ garments
def coat_of_plates(P, mat, segs=16, lod=0, z0=1.00, z1=1.44, grow=0.052):
    """cloth-covered coat of plates over the hauberk: a stiff shell from the hips to under the arms, riveted."""
    rows = [r for r in H.TORSO if z0 - 1e-6 <= r[0] <= z1 + 1e-6]
    if lod: rows = rows[::2] + ([rows[-1]] if len(rows) % 2 == 0 else [])
    rings = []
    for z, rx, ry, yc in rows:
        # stiff: no waist pinch — the plates stand off the belly
        rx2 = max(rx, 0.160) + grow; ry2 = max(ry, 0.108) + grow
        if z > 1.40: rx2 = rx + grow * 0.7
        pts = H.ring(Vector((0, yc - 0.004, z)), Vector((1, 0, 0)), Vector((0, 1, 0)), rx2, ry2, segs, 2.6)
        rings.append((pts, lambda k, pts=pts, z=z: H.torso_w(z, pts[k].x)))
    # a flared hip lame
    zb = z0 - 0.07
    pts = H.ring(Vector((0, 0.004, zb)), Vector((1, 0, 0)), Vector((0, 1, 0)), 0.185 + grow, 0.128 + grow, segs, 2.4)
    rings.insert(0, (pts, {"pelvis": 1}))
    H.loft(P, rings, mat)


def shoulder_pad(P, side, mat, lod=0):
    """a small round iron couter/spaudler cap over the point of the shoulder."""
    sh = H.jp("shoulder", side) + Vector((0.035 if side == "L" else -0.035, 0, 0.02))
    ax = Vector((1 if side == "L" else -1, 0, 0.55)).normalized()
    H.lathe_axis(P, sh, ax, [(0.0, 0.05), (0.04, 0.035), (0.068, 0.0), (0.072, -0.02)], 6 if lod else 8, mat,
                 {f"upperarm.{side}": 0.8, "chest": 0.2})


def arrow_bag(P, mats, side="R", z=1.02, lod=0):
    """linen arrow bag hung at the right hip, the fletchings of two dozen arrows standing out of its mouth."""
    sg = 1 if side == "L" else -1; w = {"pelvis": 1}
    top = Vector((sg * 0.20, 0.03, z + 0.05)); bot = top + Vector((sg * 0.03, 0.06, -0.50))
    tube(P, [bot, bot.lerp(top, 0.5), top], [0.045, 0.052, 0.050], mats["bag"], w, 6 if lod else 8, cap0=0.01, cap1=False, pat_len=False)
    # arrow shafts + fletchings fanning out of the mouth
    n = 3 if lod else 5
    for k in range(n):
        a = 2 * math.pi * k / n
        base = top + Vector((math.cos(a) * 0.025, math.sin(a) * 0.025, -0.02))
        tip = base + Vector((math.cos(a) * 0.03 + sg * 0.01, math.sin(a) * 0.03 + 0.02, 0.17))
        H.shaft(P, base, tip, 0.005, 0.005, mats["wood"], w, 3)
        if not lod:
            m = base.lerp(tip, 0.55)
            d = (tip - m).normalized(); side_v = d.cross(Vector((0, 0, 1))).normalized() if abs(d.z) < 0.95 else Vector((1, 0, 0))
            for vv in (side_v, d.cross(side_v)):
                q = [P.vert(m + vv * 0.002, w), P.vert(m + vv * 0.014 + d * 0.02, w), P.vert(tip + vv * 0.012, w), P.vert(tip + vv * 0.002, w)]
                P.face(q, mats["fletch"])


def bolt_quiver(P, mats, side="R", z=1.03, lod=0):
    """a leather bolt quiver (a tapering box) at the right hip, the bolts' vanes at its mouth."""
    sg = 1 if side == "L" else -1; w = {"pelvis": 1}
    top = Vector((sg * 0.205, 0.02, z + 0.02)); bot = top + Vector((sg * 0.02, 0.04, -0.34))
    tube(P, [bot, top], [(0.034, 0.05), (0.045, 0.07)], mats["leather"], w, 6 if lod else 8, cap0=0.005, cap1=False, pat_len=False, n=3.0)
    n = 3 if lod else 6
    for k in range(n):
        u = (k / max(1, n - 1) - 0.5)
        base = top + Vector((u * 0.03, u * 0.05, -0.03)); tip = base + Vector((sg * 0.01, 0.01, 0.10))
        H.shaft(P, base, tip, 0.0055, 0.0055, mats["wood"], w, 3)
        if not lod:
            q = [P.vert(tip + Vector((0, -0.012, -0.05)), w), P.vert(tip + Vector((0, 0.012, -0.05)), w), P.vert(tip + Vector((0, 0.010, 0.0)), w), P.vert(tip + Vector((0, -0.010, 0.0)), w)]
            P.face(q, mats["fletch"])


def pavise(P, part, mats, where="back", lod=0, w_=0.56, h_=1.12):
    """Genoese pavise: a tall rectangular board with a raised central spine, painted in the team's field with
    the accent charge. where="back": strapped between the shoulders (weighted to chest);
    where="ground": planted in front-left of the man on its spikes, leaning back (weighted to the parentless
    ground bone, so it never bobs with the man). pat = (u across -1..1, v down 0..1, 1 face / 2 back)."""
    if where == "back":
        w = {"chest": 1}
        top_c = Vector((0.0, 0.225, 1.72)); down = Vector((0, 0.24, -1)).normalized(); out = Vector((0, 1, 0.24)).normalized()
        across = Vector((1, 0, 0))
    else:
        w = {"ground": 1}
        base = Vector((0.30, -0.80, 0.0)); lean = math.radians(11)
        down = Vector((0, -math.sin(lean), -math.cos(lean)))
        top_c = base - down * h_ + Vector((0, 0, 0.06))
        out = Vector((0, -math.cos(lean), math.sin(lean)))
        across = Vector((1, 0, 0))
    nu, nv = (2, 2) if lod else (4, 4)
    th = 0.022
    gf, gb = [], []
    for j in range(nv + 1):
        v = j / nv; rf, rb = [], []
        for i in range(nu + 1):
            u = (i / nu) * 2 - 1
            # rounded top corners; the central spine stands proud of the face
            x = u * w_ / 2
            vv = v
            if v == 0: vv = -0.02 * (1 - u * u)
            ridge = 0.035 * max(0.0, 1 - abs(u) * 4.0)
            curve = -0.025 * (u * u)
            p = top_c + down * (vv * h_) + across * x + out * (ridge + curve)
            rf.append(P.vert(p + out * th / 2, w, (u, v, 1.0))); rb.append(P.vert(p - out * th / 2, w, (u, v, 2.0)))
        gf.append(rf); gb.append(rb)
    for j in range(nv):
        for i in range(nu):
            P.face([gf[j][i], gf[j][i + 1], gf[j + 1][i + 1], gf[j + 1][i]], mats["pav"])
            P.face([gb[j + 1][i], gb[j + 1][i + 1], gb[j][i + 1], gb[j][i]], mats["pav_back"])
    outline = [(0, i) for i in range(nu + 1)] + [(j, nu) for j in range(1, nv + 1)] + [(nv, i) for i in range(nu - 1, -1, -1)] + [(j, 0) for j in range(nv - 1, 0, -1)]
    for k in range(len(outline)):
        (j0, i0), (j1, i1) = outline[k], outline[(k + 1) % len(outline)]
        P.face([gf[j0][i0], gb[j0][i0], gb[j1][i1], gf[j1][i1]], mats["rim"])
    if where == "ground" and not lod:
        # the prop at the back and two iron foot-spikes
        bot = top_c + down * h_
        H.shaft(P, top_c + down * (h_ * 0.35) - out * 0.02, bot - out * 0.42 + Vector((0, 0, -0.01)), 0.012, 0.012, mats["wood"], w, 4)


# ------------------------------------------------------------------------------------------ weapons
def pike(P, part, mats, side="R", length=5.0, grip=1.10, lod=0):
    """ash pike, 5 m, tapering from the butt to a small socketed head with long langets. grip = m from the butt."""
    f = fist(side); w = {f"hand.{side}": 1}
    butt = f + Vector((0, grip, 0)); head0 = f + Vector((0, -(length - grip - 0.24), 0))
    segs = 5 if lod else 6
    mid = butt.lerp(head0, 0.45)
    tube(P, [butt, mid, head0], [0.019, 0.017, 0.0125], mats["wood"], w, segs)
    # langets + socket
    sock = head0 + Vector((0, -0.06, 0))
    H.shaft(P, head0 + Vector((0, 0.34, 0)), head0, 0.0138, 0.0135, mats["iron"], w, 4)
    H.shaft(P, head0 + Vector((0, 0.01, 0)), sock, 0.015, 0.011, mats["iron"], w, segs)
    rings = []
    for d, hw, ht in ((0.0, 0.011, 0.007), (0.05, 0.017, 0.008), (0.13, 0.009, 0.006), (0.18, 0.001, 0.001)):
        c = sock + Vector((0, -d, 0))
        rings.append(([c + Vector((ht, 0, 0)), c + Vector((0, 0, hw)), c + Vector((-ht, 0, 0)), c + Vector((0, 0, -hw))], w))
    H.loft(P, rings, mats["iron"], cap1=True)


def pollaxe(P, part, mats, side="R", length=1.65, grip=1.0, lod=0):
    """pollaxe: ash haft with iron langets, a rondel guard, an axe blade (edge -Z in rest, the swing plane),
    a hammer face behind it and a top spike."""
    f = fist(side); w = {f"hand.{side}": 1}
    butt = f + Vector((0, grip, 0)); top = f + Vector((0, -(length - grip), 0))
    segs = 5 if lod else 6
    H.shaft(P, butt, top, 0.0165, 0.0155, mats["wood"], w, segs)
    if not lod: H.shaft(P, butt + Vector((0, 0.005, 0)), butt + Vector((0, -0.05, 0)), 0.019, 0.018, mats["iron"], w, segs)   # butt shoe
    H.shaft(P, top + Vector((0, 0.40, 0)), top, 0.0172, 0.0172, mats["iron"], w, 4)                               # langets
    hc = top + Vector((0, 0.09, 0))                                                                                    # head centre
    # rondel below the head
    if not lod: H.lathe_axis(P, hc + Vector((0, 0.13, 0)), Vector((0, -1, 0)), [(0.0, 0.006), (0.04, 0.004), (0.04, -0.004), (0.0, -0.006)], 6 if lod else 8, mats["iron"], w)
    # axe blade toward -Z: a flared, slightly curved edge
    eye = [hc + Vector((sx * 0.014, sy * 0.045, 0.012)) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    mid = [hc + Vector((sx * 0.006, sy * 0.050, -0.07)) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    edge = [hc + Vector((sx * 0.0015, sy * 0.095 + 0.012, -0.145)) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    H.loft(P, [(eye, w), (mid, w), (edge, w)], mats["iron"], cap0=True, cap1=True)
    # hammer toward +Z (a square face)
    if not lod: H.shaft(P, hc + Vector((0, 0, 0.005)), hc + Vector((0, 0, 0.085)), 0.017, 0.021, mats["iron"], w, 4)
    # top spike
    H.shaft(P, hc + Vector((0, -0.03, 0)), hc + Vector((0, -0.24, 0)), 0.013, 0.002, mats["iron"], w, 4)


def club(P, part, mats, side="R", lod=0):
    """a knotty ash cudgel, 0.80 m, the heavy end toward -Y, bound with an iron ring."""
    f = fist(side); w = {f"hand.{side}": 1}
    butt = f + Vector((0, 0.08, 0))
    pts = [butt, f + Vector((0, -0.20, 0)), f + Vector((0, -0.46, 0.004)), f + Vector((0, -0.66, -0.006)), f + Vector((0, -0.72, 0))]
    tube(P, pts, [0.017, 0.019, 0.027, 0.036, 0.024], mats["wood"], w, 5 if lod else 7)
    if not lod: H.shaft(P, f + Vector((0, -0.50, 0)), f + Vector((0, -0.54, 0)), 0.032, 0.033, mats["iron"], w, 7)


def falchion(P, part, mats, side="R", lod=0):
    """falchion: a single-edged cleaver of a blade widening to a clipped point, short cross and a disc pommel."""
    f = fist(side); w = {f"hand.{side}": 1}
    segs = 4 if lod else 6
    H.shaft(P, f + Vector((0, 0.065, 0)), f + Vector((0, -0.04, 0)), 0.014, 0.014, mats["leather"], w, segs)
    H.shaft(P, f + Vector((0, 0.085, 0)), f + Vector((0, 0.06, 0)), 0.022, 0.022, mats["iron"], w, segs)
    g = f + Vector((0, -0.05, 0))
    H.box(P, g, (0.026, 0.02, 0.15), mats["iron"], w)
    rings = []
    # edge toward -Z (down in rest = the swing plane); back straight; widens toward the tip
    for d, top, bot, ht in ((0.0, 0.012, -0.020, 0.004), (0.30, 0.012, -0.036, 0.0035), (0.52, 0.010, -0.050, 0.003), (0.62, 0.004, -0.030, 0.002), (0.66, -0.006, -0.010, 0.001)):
        c = g + Vector((0, -0.012 - d, 0))
        rings.append(([c + Vector((ht, 0, (top + bot) / 2)), c + Vector((0, 0, top)), c + Vector((-ht, 0, (top + bot) / 2)), c + Vector((0, 0, bot))], w))
    H.loft(P, rings, mats["iron"], cap0=True, cap1=True)


def mallet(P, part, mats, side="R", lod=0):
    """an archer's leaden maul: a 0.8 m haft and a heavy cylindrical head bound with iron."""
    f = fist(side); w = {f"hand.{side}": 1}
    H.shaft(P, f + Vector((0, 0.08, 0)), f + Vector((0, -0.70, 0)), 0.016, 0.017, mats["wood"], w, 5 if lod else 6)
    hc = f + Vector((0, -0.72, 0))
    H.shaft(P, hc + Vector((0, 0, -0.10)), hc + Vector((0, 0, 0.10)), 0.050, 0.050, mats["lead"], w, 5 if lod else 7)


def buckler(P, part, mats, side="L", where="hand", lod=0, r=0.165):
    """a steel-bossed buckler. where="hand": gripped in the left fist, the grip bar along the fist's axis, the
    face toward the back of the hand (+X for the left hand); where="belt": hung face-out at the left hip."""
    if where == "hand":
        f = fist(side); w = {f"hand.{side}": 1}; sg = 1 if side == "L" else -1
        c = f + Vector((sg * 0.075, 0, 0)); nrm = Vector((sg, 0, 0)); a = Vector((0, 1, 0)); b = Vector((0, 0, 1))
    else:
        w = {"pelvis": 1}; sg = 1 if side == "L" else -1
        c = Vector((sg * 0.17, 0.20, 0.99)); nrm = Vector((sg * 0.5, 1.0, 0.1)).normalized()   # on the back of the left hip
        a = Vector((0, 1, 0)); a = (a - nrm * a.dot(nrm)).normalized(); b = nrm.cross(a)
    na = 8 if lod else 11
    prof = [(0.0, 0.035), (0.05, 0.026), (0.075, 0.014), (r, 0.0), (r * 0.95, -0.006)]
    if lod: prof = [prof[0], prof[2], prof[3]]
    H.lathe_axis(P, c, nrm, prof, na, mats["iron"], w)


# ------------------------------------------------------------------------------------------ missile weapons
def longbow(P, part, mats, lod=0, length=1.80):
    """English longbow, 1.8 m, held in the LEFT fist: the stave lies along Y through H.fist("L") (upper limb
    toward -Y, so raising the bow arm stands it upright), limbs bent toward the string on the +Z side (the
    archer's side once the bow arm is up). The string's midpoint rides the `nock` bone (drawn to the right
    fist by "x_draw"); the tips follow it a little so the limbs flex on the draw. The nocked arrow's tail
    rides the `arrow` bone (at rest inside the fist: the arrow collapses to a stub there)."""
    f = fist("L"); segs = 4 if lod else 6
    half = length / 2
    nst = 5 if lod else 9
    def st(u):  # u in [-1, 1] along the stave (-1 = upper tip at -Y)
        y = u * half + 0.04     # the grip sits a little below centre: the arrow passes above the hand
        z = 0.115 * abs(u) ** 2.1 + 0.012 * (1 - abs(u))   # the limbs sweep toward the string
        return f + Vector((0.0, y, z))
    def wst(u):
        k = 0.13 * abs(u) ** 2
        return H.wmix({"hand.L": 1}, {"nock": 1}, k) if k > 1e-3 else {"hand.L": 1}
    us = [-1 + 2 * i / (nst - 1) for i in range(nst)]
    pts = [st(u) for u in us]
    radii = [(0.009 + 0.010 * (1 - abs(u)) ** 1.3, 0.011 + 0.012 * (1 - abs(u)) ** 1.3) for u in us]
    rings = []; pats = []
    for i, (p, u) in enumerate(zip(pts, us)):
        a = pts[max(0, i - 1)]; b = pts[min(nst - 1, i + 1)]
        sv, bk = H.frame_for(b - a)
        rings.append((H.ring(p, sv, bk, radii[i][0], radii[i][1], segs, 2.2), wst(u)))
        pats.append([(u, 0, 1)] * segs)
    H.loft(P, rings, mats["yew"], cap0=0.01, cap1=0.01, pats=pats)
    # horn nocks
    if not lod:
        for u in (-1, 1):
            p = st(u); d = Vector((0, u * 0.05, 0.01))
            H.shaft(P, p - d * 0.3, p + d, 0.009, 0.004, mats["horn"], wst(u), 5)
    # string: tip -> mid -> tip (the mid vertex ring on the nock bone)
    t0, t1 = st(-1) + Vector((0, 0.02, 0.004)), st(1) + Vector((0, -0.02, 0.004))
    m = f + Vector((0, 0.0, BOW_BRACE))
    sw = [wst(-1), {"nock": 1}, wst(1)]
    tube(P, [t0, m, t1], [0.0028, 0.0028, 0.0028], mats["string"], sw, 3, cap0=False, cap1=False, pat_len=False)
    # the nocked arrow: tail on the `arrow` bone (rest: in the fist), head just past the stave
    tip = f + Vector((0.012, -0.0, -0.075)); tail = f + Vector((0.012, 0, 0.0))
    aw = [{"arrow": 1}, {"hand.L": 1}]
    tube(P, [tail, tip], [0.0045, 0.0045], mats["wood"], aw, 4 if not lod else 3, pat_len=False)
    # bodkin head (on the bow hand)
    H.shaft(P, tip, tip + Vector((0, 0, -0.055)), 0.0065, 0.0008, mats["iron"], {"hand.L": 1}, 4)
    if not lod:  # fletching near the tail: two vanes, on the arrow bone (hidden in the fist at rest)
        for vv in (Vector((1, 0, 0)), Vector((0, 1, 0))):
            q = [P.vert(tail + vv * 0.002 + Vector((0, 0, -0.005)), {"arrow": 1}), P.vert(tail + vv * 0.016 + Vector((0, 0, -0.012)), {"arrow": 1}),
                 P.vert(tail + vv * 0.014 + Vector((0, 0, -0.022)), {"arrow": 1}), P.vert(tail + vv * 0.002 + Vector((0, 0, -0.024)), {"arrow": 1})]
            P.face(q, mats["fletch"])


def crossbow(P, part, mats, lod=0):
    """Genoese crossbow c.1340: a 0.8 m tiller along Y through the right fist (prod forward at -Y, butt behind
    the fist to lie against the cheek), a composite prod across X, an iron stirrup, a rolling nut. The string's
    midpoint rides the `xstring` bone: forward at rest, drawn back to the nut by "x_cock". The bolt's tail rides
    the string too, so an unspanned bow shows no bolt."""
    f = fist("R"); w = {"hand.R": 1}; segs = 4 if lod else 6
    butt = f + Vector((0, XB["butt"], -0.02)); prod_y = XB["prod"]
    # tiller: deep at the butt, slimmer forward; slightly dropped behind the fist
    pts = [butt, f + Vector((0, 0.10, 0.0)), f + Vector((0, -0.10, 0.012)), f + Vector((0, prod_y - 0.02, 0.012))]
    tube(P, pts, [(0.020, 0.040), (0.018, 0.028), (0.018, 0.022), (0.017, 0.020)], mats["wood"], w, segs, n=3.0)
    # nut
    if not lod: H.shaft(P, f + Vector((-0.02, XB["nut"], 0.03)), f + Vector((0.02, XB["nut"], 0.03)), 0.014, 0.014, mats["horn"], w, 6)
    # trigger lever under the tiller
    if not lod: H.shaft(P, f + Vector((0, -0.02, -0.02)), f + Vector((0, 0.16, -0.05)), 0.006, 0.005, mats["iron"], w, 4)
    # prod: across X, tips swept back (+Y) toward the string
    half = XB["span"]
    npd = 5 if lod else 7
    pp = []
    for i in range(npd):
        u = -1 + 2 * i / (npd - 1)
        pp.append(f + Vector((u * half, prod_y + 0.055 * abs(u) ** 1.8, 0.03)))
    tube(P, pp, [(0.010 + 0.008 * (1 - abs(-1 + 2 * i / (npd - 1))), 0.014) for i in range(npd)], mats["prod"], w, segs, pat_len=False)
    # stirrup in front of the prod
    st0 = f + Vector((0, prod_y - 0.02, 0.012))
    spts = [st0 + Vector((0.045, 0, 0)), st0 + Vector((0.06, -0.08, 0)), st0 + Vector((0.0, -0.13, 0)), st0 + Vector((-0.06, -0.08, 0)), st0 + Vector((-0.045, 0, 0))]
    if lod: spts = spts[::2]
    tube(P, spts, [0.006] * len(spts), mats["iron"], w, 3 if lod else 4, cap0=not lod, cap1=not lod, pat_len=False)
    # string: tips -> xstring -> tip
    tl, tr = pp[0] + Vector((0, 0.005, 0.0)), pp[-1] + Vector((0, 0.005, 0.0))
    mid = f + Vector((0, prod_y + 0.07, 0.035))
    tube(P, [tl, mid, tr], [0.0028] * 3, mats["string"], [w, {"xstring": 1}, w], 3, cap0=False, cap1=False, pat_len=False)
    # the bolt: head at the prod (on the stock), tail on the string
    head = f + Vector((0, prod_y - 0.03, 0.035)); tail = mid + Vector((0, -0.005, 0.0))
    tube(P, [tail, head], [0.0065, 0.0065], mats["wood"], [{"xstring": 1}, w], 4 if not lod else 3, pat_len=False)
    if not lod: H.shaft(P, head, head + Vector((0, -0.04, 0)), 0.009, 0.001, mats["iron"], w, 4)
    if not lod:
        q = [P.vert(tail + Vector((0, -0.005, 0.004)), {"xstring": 1}), P.vert(tail + Vector((0, -0.05, 0.004)), {"xstring": 1}),
             P.vert(tail + Vector((0, -0.045, 0.022)), {"xstring": 1}), P.vert(tail + Vector((0, -0.01, 0.022)), {"xstring": 1})]
        P.face(q, mats["fletch"])


def belt_claw(P, mats, z=1.04):
    """the spanning belt's double iron claw hanging at the front of the belt."""
    w = {"pelvis": 1}
    c = Vector((0.0, -0.165, z - 0.05))
    H.shaft(P, c + Vector((0, 0, 0.05)), c, 0.012, 0.010, mats["leather"], w, 4)
    for sx in (-1, 1):
        H.shaft(P, c + Vector((sx * 0.01, 0, 0)), c + Vector((sx * 0.018, -0.03, -0.035)), 0.005, 0.004, mats["iron"], w, 4)


# ------------------------------------------------------------------------------------------ painters
hexc, sst, fbm, vnoise = PT.hexc, PT.sst, PT.fbm, PT.vnoise

def paint_quilt(P, N, pat, patd, seed=61, cross=True, patches=0.0, dirt=0.8, diamond=False):
    """quilted jack/gambeson in dye 1 (neutral grey), channels, a team field-sign cross; optional patches."""
    n = len(P)
    rgb, mud = PT.neutral_cloth(P, seed, dirt=dirt, var=0.09)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    sleeve = np.abs(x) > 0.205
    ang = np.arctan2(y, x)
    if diamond:   # lozenge quilting (jacks)
        u1 = (ang * 0.17 + z) / 0.06; u2 = (ang * 0.17 - z) / 0.06
        ph = np.minimum(np.abs((u1 % 1) - 0.5), np.abs((u2 % 1) - 0.5)) * 2
    else:
        u = np.where(sleeve, z / 0.045, ang * 0.17 / 0.042)
        ph = np.abs((u % 1.0) - 0.5) * 2
    k = 0.80 + 0.22 * sst(0.0, 0.5, ph)
    k *= 1 + 0.05 * (vnoise(P * 60, seed + 2) - 0.5)
    rgb *= k[:, None]
    mask = np.zeros((n, 3)); mask[:, 2] = 1.0
    if patches > 0:
        # sewn-on patches of other cloth: squarish, brighter or darker, with a stitched dark outline
        cell = np.floor(P * np.array([9.0, 9.0, 7.0]))
        r = PT._h(cell[:, 0].astype(np.int64), cell[:, 1].astype(np.int64), cell[:, 2].astype(np.int64), seed + 7)
        fr = np.abs(((P * np.array([9.0, 9.0, 7.0])) % 1.0) - 0.5).max(1)
        patch = (r < patches) & (fr < 0.40)
        edge = patch & (fr > 0.36)
        tone = 0.72 + 0.5 * PT._h(cell[:, 0].astype(np.int64) + 3, cell[:, 1].astype(np.int64), cell[:, 2].astype(np.int64), seed + 9)
        rgb[patch] = PT.neutral_cloth(P[patch], seed + 11, dirt=dirt, var=0.12)[0] * tone[patch, None]
        rgb[edge] *= 0.55
    if cross:
        torso = ~sleeve & (z > 1.05) & (z < 1.46)
        cx = np.abs(x) < 0.028; cz = np.abs(z - 1.315) < 0.026
        cr = torso & (((cx & (z > 1.10) & (z < 1.44)) | (cz & (np.abs(x) < 0.115)))) & (np.abs(y) > 0.03)
        rgb[cr] = PT.neutral_cloth(P[cr], seed + 6, dirt=0.3, var=0.06)[0] * 1.02
        mask[cr] = (0.95, 0, 0)
    return rgb, np.full(n, 0.9), mask

def paint_levy_quilt(P, N, pat, patd): return paint_quilt(P, N, pat, patd, seed=151, patches=0.16, dirt=1.3)
def paint_jack(P, N, pat, patd): return paint_quilt(P, N, pat, patd, seed=161, diamond=True)
def paint_pike_quilt(P, N, pat, patd): return paint_quilt(P, N, pat, patd, seed=171)

def paint_levy_wool(P, N, pat, patd):
    """a patched, faded wool tunic (sleeves, skirt): dye 1 with darned patches."""
    rgb, r, mask = paint_quilt(P, N, pat, patd, seed=181, cross=False, patches=0.22, dirt=1.4)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    # no quilting on plain wool: undo the channels by repainting the non-patch texels
    base, _ = PT.neutral_cloth(P, 183, dirt=1.4, var=0.12)
    cell = np.floor(P * np.array([9.0, 9.0, 7.0]))
    rr = PT._h(cell[:, 0].astype(np.int64), cell[:, 1].astype(np.int64), cell[:, 2].astype(np.int64), 181 + 7)
    fr = np.abs(((P * np.array([9.0, 9.0, 7.0])) % 1.0) - 0.5).max(1)
    plain = ~((rr < 0.22) & (fr < 0.40))
    rgb[plain] = base[plain]
    return rgb, np.full(len(P), 0.93), mask

def paint_felt(P, N, pat, patd):
    rgb, mud = PT.neutral_cloth(P, 191, dirt=0.2, var=0.14)
    n = len(P); mask = np.zeros((n, 3)); mask[:, 2] = 0.5
    return rgb * 0.95, np.full(n, 0.95), mask

def paint_coat_plates(P, N, pat, patd):
    """coat of plates: team-coloured cloth (fustian) over riveted plates — horizontal rows of iron rivet
    heads (no mask there), the cloth bulging a little between the plate edges."""
    n = len(P)
    rgb, mud = PT.neutral_cloth(P, 201, dirt=0.5, var=0.07)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    mask = np.zeros((n, 3)); mask[:, 0] = 1.0
    band = ((z - 1.0) / 0.075) % 1.0
    rgb *= (0.86 + 0.18 * sst(0.0, 0.25, band) * sst(1.0, 0.75, band))[:, None]
    ang = np.arctan2(y, x)
    u = (ang * 0.21 / 0.045) % 1.0
    riv = (np.abs(band - 0.15) < 0.10) & (np.abs(u - 0.5) < 0.16)
    riv |= (np.abs(z - 1.435) < 0.006) & (np.abs(u - 0.5) < 0.2)
    rgb[riv] = hexc("6a675d") * (0.9 + 0.2 * vnoise(P[riv] * 200, 203))[:, None]
    mask[riv] = 0
    # a vertical accent guard stripe down the front (the heraldic bend of the livery)
    stripe = (y < -0.05) & (np.abs(x + (z - 1.22) * 0.55) < 0.028) & ~riv
    mask[stripe] = (0, 1, 0)
    rough = np.where(riv, 0.45, 0.85)
    return rgb, rough, mask

def paint_yew(P, N, pat, patd):
    """yew stave: pale sapwood on the back (away from the string, -Z in rest), orange heartwood belly,
    a dark leather grip at the middle (pat.x = position along the stave -1..1)."""
    n = len(P); u = pat[:, 0]
    from _human import fist
    f = np.array(fist("L"))
    back = (P[:, 2] - (f[2] + 0.115 * np.abs(u) ** 2.1 + 0.012 * (1 - np.abs(u)))) < 0
    heart = hexc("8e5028"); sap = hexc("b98a52")
    g = vnoise(np.stack([u * 30, P[:, 0] * 200, P[:, 2] * 200], -1), 211)
    col = np.where(back[:, None], sap[None], heart[None]) * (0.88 + 0.2 * g)[:, None]
    grip = np.abs(u + 0.04 / 0.9) < 0.07
    col[grip] = hexc("3b2a1d") * (0.9 + 0.2 * g[grip])[:, None]
    return np.clip(col, 0, 1), np.where(grip, 0.8, 0.5), np.zeros((n, 3))

def paint_string(P, N, pat, patd):
    n = len(P); return np.tile(hexc("d9d0b4"), (n, 1)), np.full(n, 0.8), np.zeros((n, 3))
def paint_horn(P, N, pat, patd):
    n = len(P); return np.tile(hexc("e2d7bd"), (n, 1)) * (0.85 + 0.2 * vnoise(P * 120, 221))[:, None], np.full(n, 0.4), np.zeros((n, 3))
def paint_fletch(P, N, pat, patd):
    n = len(P); c = np.tile(hexc("dcd8cf"), (n, 1)); c *= (0.8 + 0.25 * vnoise(P * 300, 223))[:, None]
    return c, np.full(n, 0.9), np.zeros((n, 3))
def paint_bag(P, N, pat, patd):
    rgb, mud = PT.cloth(P, hexc("b3a27f"), 0.10, 0.04, 231, 0.6); return rgb, np.full(len(P), 0.93), np.zeros((len(P), 3))
def paint_lead(P, N, pat, patd):
    n = len(P); c = np.tile(hexc("5f6166"), (n, 1)) * (0.85 + 0.2 * fbm(P, 40, 2, 241))[:, None]
    return c, np.full(n, 0.55), np.zeros((n, 3))
def paint_prod(P, N, pat, patd):
    """composite prod: horn and sinew under a painted birch-bark/leather covering, dark red-brown."""
    n = len(P); c = np.tile(hexc("5b2c1f"), (n, 1)) * (0.85 + 0.25 * fbm(P, 30, 3, 251))[:, None]
    return c, np.full(n, 0.55), np.zeros((n, 3))

def paint_pavise(P, N, pat, patd):
    """pavise face: team field, a broad accent saltire; gesso cracked and chipped at the edges; wood behind."""
    n = len(P); u, v = pat[:, 0], pat[:, 1]
    rgb, _ = PT.neutral_cloth(P, 261, dirt=0.0, var=0.05)
    rgb *= (1 + 0.06 * (vnoise(np.stack([u * 4, v * 30, u * 0], -1), 263) - 0.5))[:, None]
    mask = np.zeros((n, 3)); mask[:, 0] = 1.0
    # saltire of the accent colour, over the whole board (board is ~2:1 so v is scaled)
    vv = (v - 0.5) * 2.0
    sal = (np.abs(u - vv) < 0.22) | (np.abs(u + vv) < 0.22)
    mask[sal] = (0, 1, 0)
    # a dark bordure line and the spine
    border = (np.abs(u) > 0.90) | (v < 0.04) | (v > 0.96)
    spine = np.abs(u) < 0.035
    rgb[border | spine] *= 0.55; mask[border | spine] = 0
    rgb[border | spine] = rgb[border | spine] * 0 + hexc("2d2419")
    edge = np.clip(np.maximum(np.abs(u) - 0.84, 0) * 8, 0, 1) + np.clip((0.06 - v) * 12, 0, 1) + np.clip((v - 0.9) * 8, 0, 1)
    chips = ((fbm(P, 26, 3, 265) - 0.63) * 6).clip(0, 1)
    hack = ((vnoise(P * np.array([80, 80, 8]), 267) - 0.94) * 22).clip(0, 1)   # bolt strikes: small punctures
    wear = np.clip(edge * (0.4 + fbm(P, 50, 2, 269)) + chips + hack, 0, 1)
    wood = PT.paint_wood(P, N, np.stack([v * 3, u, v], -1), patd)[0] * 0.85
    rgb = rgb * (1 - wear[:, None]) + wood * wear[:, None]; mask *= (1 - wear)[:, None]
    back = patd[:, 2] > 1.5
    if back.any():
        wb = PT.paint_wood(P[back], N[back], np.stack([v[back] * 3, u[back], v[back]], -1), patd[back])[0] * 0.78
        wb[(np.abs(((u[back] * 3) % 1) - 0.5) > 0.47)] *= 0.6
        strap = (np.abs(v[back] - 0.25) < 0.025) | (np.abs(v[back] - 0.62) < 0.025)
        wb[strap] = hexc("3d2a1c")
        rgb[back] = wb; mask[back] = 0
    return np.clip(rgb, 0, 1), np.where(wear > 0.5, 0.8, 0.72), mask

def paint_gauntlet(P, N, pat, patd):
    rgb, rough, mask = PT.paint_iron(P, N, pat, patd)
    return rgb * 1.05, rough, mask

def paint_bascinet(P, N, pat, patd):
    """a polished-ish bascinet: brighter iron than a kettle hat, rivets along the lower edge for the aventail."""
    rgb, rough, mask = PT.paint_iron(P, N, pat, patd)
    rgb = np.clip(rgb * 1.35, 0, 1); rough = rough - 0.12
    return rgb, rough, mask

def paint_visor(P, N, pat, patd):
    rgb, rough, mask = paint_bascinet(P, N, pat, patd)
    from _human import HEAD_C
    d = P - np.array(HEAD_C)
    slit = (np.abs(d[:, 2] - 0.004) < 0.007) & (np.abs(d[:, 0]) > 0.012) & (np.abs(d[:, 0]) < 0.07)
    br = (d[:, 2] < -0.03) & (d[:, 2] > -0.10) & (np.abs(((d[:, 0] / 0.016) % 1) - 0.5) < 0.2) & (np.abs(((d[:, 2] / 0.02) % 1) - 0.5) < 0.2)
    rgb[slit | br] = hexc("121110")
    return rgb, rough, mask

NEW = {
    "levy_quilt": (paint_levy_quilt, "a39478"), "levy_wool": (paint_levy_wool, "8a7a5e"), "jack": (paint_jack, "b5a47d"),
    "pike_quilt": (paint_pike_quilt, "b5a47d"), "felt": (paint_felt, "5b4634"), "coat_plates": (paint_coat_plates, "2a55a5"),
    "yew": (paint_yew, "b27a45"), "string": (paint_string, "d9d0b4"), "horn": (paint_horn, "e2d7bd"), "fletch": (paint_fletch, "dcd8cf"),
    "bag": (paint_bag, "b3a27f"), "lead": (paint_lead, "5f6166"), "prod": (paint_prod, "5b2c1f"),
    "pavise_paint": (paint_pavise, "b0282a"), "pavise_back": (paint_pavise, "7a6040"),
    "gauntlet": (paint_gauntlet, "4a4944"), "bascinet": (paint_bascinet, "6a6964"), "visor": (paint_visor, "6a6964"),
}
for k, (fn, flat) in NEW.items():
    PT.PAINTERS[k] = fn; PT.FLAT[k] = flat
