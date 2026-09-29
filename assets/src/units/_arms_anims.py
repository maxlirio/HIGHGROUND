"""HIGHGROUND units — clip families for the foot arms: levy, pike, maa (men-at-arms), bow (longbow),
xbow (crossbow). Same contract as _anims.py (pose functions of t, FK in armature axes); importing this
module registers the families into _anims.FAMILIES.

Clip-name conventions the engine (js/render/figures.js) understands on top of _anims.py's:
    <clip>_<weapon>   a variant for men carrying that weapon (js/sim/kit.js key): strike_pollaxe, idle_club ...
    <clip>_bare       a variant for men without a shield (levy spearmen use both hands on the spear)
    shoot             non-looping, "loose" = the release point (0..1) in the json
    reload            non-looping, played after shoot (crossbow spanning)
    brace             pikemen standing to receive horse (held, looping)
Helper constraints / bones (see _arms_kit.py): P.cons["x_draw"|"x_arrow"|"x_drawik"|"x_cock"] and
P.locs["draw_tgt"] (how far the drawing hand's IK target has slid back from the string).
"""
import math
import _anims as A
from _anims import s, c, seg, keys, lerp, ease, breathe, walk_legs, run_legs, swing_arm, fall_body, shield_guard, spear_carry

# ============================================================================== analytic FK / hand placement
# World rotation of a bone = the product of the clip's per-bone rotations (armature axes) down its chain
# (tools/vat_bake.apply_pose converts each into the bone's local frame); head positions follow the rest
# offsets. That lets a clip put a fist at a world point with a world orientation (arm IK in closed form).
import _human as H
from mathutils import Euler, Quaternion, Vector
_PARENT = {b[0]: b[3] for b in H.BONES}
_HEAD = {b[0]: H.jp(b[1], b[4]) for b in H.BONES}
_TAIL = {b[0]: (H.jp(b[2], b[4]) if b[2] else None) for b in H.BONES}

def _q(P, b):
    a = P.r.get(b, [0.0, 0.0, 0.0]); return Euler([math.radians(v) for v in a], "XYZ").to_quaternion()

def world(P, b):
    """(head position, world rotation) of bone b under pose P."""
    chain = []; x = b
    while x: chain.append(x); x = _PARENT[x]
    pos, rot, prev = None, Quaternion(), None
    for x in reversed(chain):
        if pos is None: pos = _HEAD[x] + P.loc; rot = _q(P, x)
        else: pos = pos + rot @ (_HEAD[x] - _HEAD[prev]); rot = rot @ _q(P, x)
        prev = x
    return pos, rot

def set_world_rot(P, b, Qw):
    Rp = world(P, _PARENT[b])[1]
    e = (Rp.inverted() @ Qw).to_euler("XYZ"); P.r[b] = [math.degrees(v) for v in e]

def place_hand(P, side, fist_pos, rot=(0, 0, 0), pole=(-1, 0.3, -0.6)):
    """put the fist of `side` at world fist_pos with the hand's world rotation rot (Euler degrees, armature
    axes; (0,0,0) = the rest orientation: the held thing lies along Y, business end -Y). Two-bone analytic
    IK, elbow toward `pole`. Call it after the torso is posed."""
    Qh = Euler([math.radians(v) for v in rot], "XYZ").to_quaternion()
    wr_rest, fist_rest = _HEAD[f"hand.{side}"], H.fist(side)
    T = Vector(fist_pos) - Qh @ (fist_rest - wr_rest)                    # where the wrist must be
    ub, fb = f"upperarm.{side}", f"forearm.{side}"
    P.r[ub] = [0.0, 0.0, 0.0]; P.r[fb] = [0.0, 0.0, 0.0]
    S, Rc = world(P, ub)                                                  # shoulder, chest rotation
    L1 = (_HEAD[fb] - _HEAD[ub]).length; L2 = (wr_rest - _HEAD[fb]).length
    d = T - S; D = min(d.length, L1 + L2 - 1e-4); dn = d.normalized()
    ca = max(-1.0, min(1.0, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D)))
    pv = Vector(pole); pv = (pv - dn * pv.dot(dn)).normalized()
    E = S + (dn * ca + pv * math.sqrt(max(0.0, 1 - ca * ca))) * L1
    W = S + dn * D
    d1r = (_HEAD[fb] - _HEAD[ub]).normalized(); d2r = (wr_rest - _HEAD[fb]).normalized()
    Ru = d1r.rotation_difference((E - S).normalized())                  # world rotations (twist-free)
    Rf = (Ru @ d2r).rotation_difference((W - E).normalized()) @ Ru
    set_world_rot(P, ub, Ru); set_world_rot(P, fb, Rf); set_world_rot(P, f"hand.{side}", Qh)


def place_foot(P, side, ankle_pos, pole=(0.4, -1.0, 0.0), foot_rot=(0, 0, 0)):
    """put the ankle of `side` at world ankle_pos (two-bone analytic IK, knee toward `pole`), the knee a true
    hinge (the shin turns about the thigh's own X, so the hose never twists), the foot at world rotation
    foot_rot (Euler degrees, (0,0,0) = the rest foot, flat and toes forward). Call after the pelvis is posed."""
    tb, sb, fb = f"thigh.{side}", f"shin.{side}", f"foot.{side}"
    P.r[tb] = [0.0, 0.0, 0.0]; P.r[sb] = [0.0, 0.0, 0.0]
    Hh, Rp = world(P, tb)
    L1 = (_HEAD[sb] - _HEAD[tb]).length; L2 = (_HEAD[fb] - _HEAD[sb]).length
    d = Vector(ankle_pos) - Hh; D = min(d.length, L1 + L2 - 1e-4); dn = d.normalized()
    ca = max(-1.0, min(1.0, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D)))
    pv = Vector(pole); pv = (pv - dn * pv.dot(dn)).normalized()
    K = Hh + (dn * ca + pv * math.sqrt(max(0.0, 1 - ca * ca))) * L1
    Aw = Hh + dn * D
    d1 = (K - Hh).normalized(); d2 = (Aw - K).normalized()
    hinge = d1.cross(d2)
    if hinge.length < 1e-6: hinge = d1.cross(pv)
    hinge.normalize()
    from mathutils import Matrix
    r1 = (_HEAD[sb] - _HEAD[tb]).normalized(); hx = Vector((1, 0, 0)); hx = (hx - r1 * hx.dot(r1)).normalized()
    Mr = Matrix((hx, r1, hx.cross(r1))).transposed(); Mw = Matrix((hinge, d1, hinge.cross(d1))).transposed()
    Rt = (Mw @ Mr.transposed()).to_quaternion()
    # the shin: the thigh's rotation, then the knee's flexion about the hinge (rest shin carries a small bend)
    r2 = (_HEAD[fb] - _HEAD[sb]).normalized()
    Rs = (Rt @ r2).rotation_difference(d2) @ Rt
    set_world_rot(P, tb, Rt); set_world_rot(P, sb, Rs); set_world_rot(P, fb, _wq(foot_rot))


# ============================================================================== shields (on the forearm)
def _wq(rot):
    return Euler([math.radians(v) for v in rot], "XYZ").to_quaternion()

def place_shield(P, side, face, up, elbow, hand_bend=0.0):
    """pose the shield arm so the shield (built in H.shield_frame: flat along the forearm) faces world direction
    `face` with its top toward `up`, the elbow as near to world point `elbow` as the upper arm reaches. The
    forearm's world rotation is exact (so is the shield's); the upper arm's twist is chosen so the elbow bends
    on its hinge (no candy-wrapper sleeve). Call after the torso is posed; later torso rotations carry it."""
    el_r, ac_r, dn_r, out_r = H.shield_frame(side)
    out_w = Vector(face).normalized(); up_w = Vector(up); up_w = (up_w - out_w * up_w.dot(out_w)).normalized()
    dn_w = -up_w; ac_w = dn_w.cross(out_w).normalized()
    ac_r2 = dn_r.cross(out_r).normalized()           # same handedness as the world frame
    from mathutils import Matrix
    Mr = Matrix((ac_r2, dn_r, out_r)).transposed(); Mw = Matrix((ac_w, dn_w, out_w)).transposed()
    Rf = (Mw @ Mr.transposed()).to_quaternion()
    if ac_r2.dot(ac_r) < 0: pass                      # (the forearm then points along -across: fine, it is a line)
    ub, fb = f"upperarm.{side}", f"forearm.{side}"
    P.r[ub] = [0.0, 0.0, 0.0]; P.r[fb] = [0.0, 0.0, 0.0]
    S, Rc = world(P, ub)
    L1 = (_HEAD[fb] - _HEAD[ub]).length
    E = S + (Vector(elbow) - S).normalized() * L1
    ua_r = (_HEAD[fb] - _HEAD[ub]).normalized(); ua_w = (E - S).normalized()
    base = ua_r.rotation_difference(ua_w)
    hinge_r = Vector((1, 0, 0))                        # the elbow bends about the arm's rest X
    best = None
    for k in range(48):                                # twist about the upper arm: keep the elbow a hinge
        Ru = Quaternion(ua_w, 2 * math.pi * k / 48) @ base
        rel = Ru.inverted() @ Rf
        e = 1 - abs((rel @ hinge_r).dot(hinge_r))
        if best is None or e < best[0]: best = (e, Ru)
    set_world_rot(P, ub, best[1]); set_world_rot(P, fb, Rf)
    set_world_rot(P, f"hand.{side}", Rf @ _wq((hand_bend, 0, 0)))

def shield_frame_world(P, side="L"):
    """(centre, face normal, up) of the shield under pose P (for checks and for the weapon arm to avoid it)."""
    el_r, ac_r, dn_r, out_r = H.shield_frame(side)
    p, R = world(P, f"forearm.{side}")
    c = p + R @ (ac_r * H.SHIELD_ALONG + out_r * H.SHIELD_OFF)
    return c, R @ out_r, -(R @ dn_r)

def _nrm(x, y, z): return Vector((x, y, z)).normalized()

# shield carriages, in the man's own frame (he faces -Y, his left is +X), as (face, up, elbow):
SH_CARRY = (_nrm(0.93, -0.36, 0.0), _nrm(0.0, 0.10, 1.0), (0.27, -0.05, 1.12))    # at the left side, face out-forward
SH_GUARD = (_nrm(0.50, -0.86, 0.22), _nrm(0.0, 0.25, 1.0), (0.31, -0.17, 1.17))    # the guard: face front-left, covering chin to thigh
SH_HIGH = (_nrm(0.30, -0.92, 0.25), _nrm(0.0, 0.35, 0.94), (0.28, -0.22, 1.30))   # raised to take a blow from above
SH_BASH = (_nrm(0.22, -0.95, 0.25), _nrm(0.0, 0.2, 1.0), (0.24, -0.34, 1.26))     # punched forward with the body behind it
SH_RIDE = (_nrm(0.93, -0.24, 0.30), _nrm(0.05, 0.12, 1.0), (0.34, -0.06, 1.10))    # mounted: on the left side, clear of the neck

def shield_pose(P, a, b=None, k=0.0, side="L"):
    """pose the shield at carriage a (or blended a -> b by k): face, up and elbow interpolated."""
    if b is None: b = a
    f = a[0].lerp(b[0], k).normalized(); u = a[1].lerp(b[1], k).normalized()
    e = Vector(a[2]).lerp(Vector(b[2]), k)
    if side == "R": f = Vector((-f.x, f.y, f.z)); u = Vector((-u.x, u.y, u.z)); e = Vector((-e.x, e.y, e.z))
    # carriages are written for an upright man; they ride with his chest (a rider sits 0.84 m lower, a man
    # lunging leans): elbow offset from the shoulder, face and up, all turned by the chest's world rotation
    ub = f"upperarm.{side}"
    P.r[ub] = [0.0, 0.0, 0.0]
    S, Rc = world(P, ub)
    Rc = world(P, "chest")[1]
    place_shield(P, side, Rc @ f, Rc @ u, S + Rc @ (e - _HEAD[ub]))


def cons(P, **kw):
    if not hasattr(P, "cons"): P.cons = {}
    for k, v in kw.items(): P.cons["x_" + k] = v

def locs(P, **kw):
    if not hasattr(P, "locs"): P.locs = {}
    for k, v in kw.items(): P.locs[k] = v


# ============================================================================== shared stances
def stand(P, t, amp=1.0):
    breathe(P, t, amp)
    P.move(x=0.008 * s(t)); P.rot("pelvis", 0, 1.3 * s(t)); P.rot("spine", 0, -1.3 * s(t))
    P.leg("L", -2, 4, -2, 2); P.leg("R", 2, 3, -3, 3)
    P.rot("neck", 0, 0, 6 * s(t + 0.2) * seg(abs(s(t)), 0.2, 0.9))

def left_hang(P, t=0.0, amp=0.0):
    P.arm("L", "upperarm", 3 + amp * c(t + 0.5), 7, 0); P.arm("L", "forearm", -14 - 0.5 * amp * max(0, -c(t + 0.5)))

def upright_carry(P):
    """a long weapon upright in the right fist (the spear carry), the other hand free."""
    P.arm("R", "upperarm", -6, 10, 4); P.arm("R", "forearm", -84, 0, 0); P.rot("hand.R", -2)


# ============================================================================== levy (spear / club, 30 % shields)
def levy_bare_carry(P):
    """no shield: the spear upright in the right fist, the left arm easy."""
    upright_carry(P)

def levy_level2(P, k=0.0):
    """two-handed spear levelled at the hip, point forward at a man's chest (k: 0 guard .. 1 thrust out)."""
    place_hand(P, "R", (lerp(-0.19, -0.13, k), lerp(0.14, -0.26, k), lerp(1.00, 1.10, k)), rot=(lerp(-9, -4, k), 0, 9), pole=(-1, 0.5, -0.5))
    P.ik = 1.0; P.grip = lerp(0.46, 0.34, max(0.0, k))

def levy_idle_bare(t, P): stand(P, t); levy_bare_carry(P); left_hang(P)
def levy_walk_bare(t, P):
    walk_legs(P, t); levy_bare_carry(P); P.arm("R", "upperarm", 3 * c(t)); swing_arm(P, "L", t, 15, 14)
def levy_run_bare(t, P):
    run_legs(P, t, A=33, knee=88, lean=10); levy_level2(P, 0.1)
def levy_strike_bare(t, P):
    """two-handed thrust from the hip: draw back, drive forward with the body, recover."""
    P.leg("L", -18, 16, 2, 4); P.leg("R", 16, 8, -8, 6); P.move(z=-0.035)
    k = keys(t, [(0, 0.15), (0.28, -0.2), (0.45, 1.0), (0.58, 1.0), (1.0, 0.15)])
    P.rot("pelvis", 0, 0, 12 - 20 * max(0, k)); P.rot("chest", 4 + 8 * max(0, k), 0, 8 - 14 * max(0, k))
    P.move(y=-0.08 * max(0, k)); P.rot("neck", -4, 0, -6 + 10 * max(0, k))
    levy_level2(P, k)

def club_strike(t, P, shield=True):
    """overarm cudgel blow, the shield (or the empty left hand) up to fend."""
    k = keys(t, [(0.0, 0.0), (0.35, 1.0), (0.5, -0.3), (0.62, -0.3), (1.0, 0.0)])
    up = max(0.0, k); dn = max(0.0, -k) / 0.3
    P.arm("R", "upperarm", lerp(-40, -160, up) + 70 * dn, 18, 8)
    P.arm("R", "forearm", lerp(-60, -70, up) + 30 * dn, 0, 0)
    P.rot("hand.R", lerp(10, -40, up) + 70 * dn)
    P.rot("spine", 8 * dn - 4 * up, 0, lerp(-5, 14, up) - 20 * dn); P.rot("chest", 6 * dn)
    shield_guard(P, 0.8)
    P.leg("L", -18, 18, 0, 5); P.leg("R", 14, 10, -6, 7); P.move(z=-0.03)

def club_carry(P):
    P.arm("R", "upperarm", -10, 12, 4); P.arm("R", "forearm", -70, 0, 0); P.rot("hand.R", 20)

LEVY = dict(A.FAMILIES["spear"])
LEVY.update({
    "idle_bare": (16, 6.0, True, levy_idle_bare, None),
    "walk_bare": (16, 14.5, True, levy_walk_bare, 1.30),
    "run_bare": (12, 17.0, True, levy_run_bare, 3.40),
    "strike_bare": (12, 12.0, True, levy_strike_bare, None),
    "idle_club": (16, 6.0, True, lambda t, P: (stand(P, t), club_carry(P), shield_guard(P, 0.2)), None),
    "walk_club": (16, 14.5, True, lambda t, P: (walk_legs(P, t), club_carry(P), shield_guard(P, 0.2)), 1.30),
    "strike_club": (12, 12.0, True, club_strike, None),
    "fall": (12, 12.0, False, lambda t, P: (spear_carry(P), A.fall(t, P), lay_down_kit(P, t)), None),
})


# ============================================================================== pikemen
def pike_order(P):
    """pike at the order: upright in the right hand beside the right foot."""
    P.arm("R", "upperarm", -4, 9, 4); P.arm("R", "forearm", -86, 0, 0); P.rot("hand.R", -3)

def pike_level(P, k=0.0, lunge=1.0):
    """pike levelled at the shoulder for the push (k: 0 drawn back .. 1 thrust home): the rear (right) fist
    at the right breast, the left hand well forward on the staff, the point at a man's face."""
    P.leg("L", -22 * lunge, 20 * lunge, 2, 5); P.leg("R", 18 * lunge, 10 * lunge, -8, 7); P.move(z=-0.045 * lunge)
    P.rot("pelvis", 0, 0, lerp(16, 6, k)); P.rot("spine", lerp(4, 10, k), 0, lerp(6, 0, k)); P.rot("chest", lerp(2, 6, k), 0, lerp(6, 0, k))
    P.rot("neck", lerp(-6, -12, k), 0, lerp(-18, -6, k))
    P.move(y=-0.10 * k)
    place_hand(P, "R", (-0.17, lerp(0.10, -0.22, k), lerp(1.27, 1.25, k)), rot=(-10, 0, 7), pole=(-1, 0.6, -0.4))
    P.ik = 1.0; P.grip = lerp(0.55, 0.40, k)

def pike_idle(t, P): stand(P, t); pike_order(P); left_hang(P)
def pike_walk(t, P):
    walk_legs(P, t, A=19, knee=48); pike_order(P); P.arm("R", "upperarm", 2 * c(t)); swing_arm(P, "L", t, 14, 14)
def pike_run(t, P):
    run_legs(P, t, A=30, knee=84, lean=12)
    place_hand(P, "R", (-0.20, 0.02, 1.10), rot=(-6, 0, 6), pole=(-1, 0.6, -0.4))
    P.ik = 1.0; P.grip = 0.50
def pike_strike(t, P):
    """the push of pike: levelled at the shoulder, drawn back, driven forward with the whole body, recovered."""
    k = keys(t, [(0.0, 0.35), (0.3, 0.0), (0.5, 1.0), (0.62, 1.0), (1.0, 0.35)])
    pike_level(P, k)
def pike_brace(t, P):
    """to receive horse: down on the right knee, the butt grounded behind the right foot, the point raised
    to a horse's chest, both hands on the staff, leaning into it."""
    P.move(z=-0.43 + 0.004 * s(t))
    P.leg("L", -84, 92, -4, 10)       # left foot forward, knee up
    P.leg("R", 6, 104, 30, 8)         # right knee on the ground, the foot behind
    P.rot("pelvis", 4, 0, 14); P.rot("spine", 12, 0, 4); P.rot("chest", 8 + 1.2 * s(t), 0, 4)
    P.rot("neck", -26, 0, -16)
    d = Vector((0.02, -0.883, 0.469)).normalized()
    butt = Vector((-0.20, 0.72, 0.03))
    place_hand(P, "R", butt + d * 1.10, rot=(-28, 0, 1.3), pole=(-1, 0.3, -0.5))
    P.ik = 1.0; P.grip = 0.17

def blend_hand_world(P, side, rot, k):
    if k <= 0: return
    b = f"hand.{side}"; Q0 = world(P, b)[1]
    Q1 = Euler([math.radians(v) for v in rot], "XYZ").to_quaternion()
    set_world_rot(P, b, Q0.slerp(Q1, k))

def _guard_forearm():
    Pg = A.Pose(); shield_guard(Pg, 0.2); return world(Pg, "forearm.L")[1]

def lay_down_kit(P, t, right=True, shield=True, yaw=150.0):
    """at the end of a fall: the weapon in the right fist comes to lie flat along the ground beside him and
    the shield on the left forearm flat, face up (not a spear or a shield standing up out of a corpse)."""
    k = seg(t, 0.35, 0.95)
    if right: blend_hand_world(P, "R", (0, 0, yaw), k)
    if shield and k > 0:
        Q0 = world(P, "forearm.L")[1]
        Q1 = Euler((math.radians(-90), 0, 0), "XYZ").to_quaternion() @ _guard_forearm()
        set_world_rot(P, "forearm.L", Q0.slerp(Q1, k))

def pike_fall(t, P):
    """topples backward; the pike, let go of, comes down along the ground beside him."""
    f = seg(t, 0.15, 0.9)
    P.arm("R", "upperarm", -4 * (1 - f), 9 * (1 - f), 4 * (1 - f)); P.arm("R", "forearm", -86 * (1 - f) - 10 * f)
    A.fall(t, P)
    blend_hand_world(P, "R", (1.5, 0, 172), seg(t, 0.35, 0.95))

PIKE = {
    "idle": (16, 6.0, True, pike_idle, None),
    "walk": (16, 14.5, True, pike_walk, 1.20),
    "run": (12, 17.0, True, pike_run, 2.80),
    "strike": (14, 11.0, True, pike_strike, None),
    "brace": (8, 3.0, True, pike_brace, None),
    "level": (8, 3.0, True, lambda t, P: (breathe(P, t, 0.6), pike_level(P, 0.2 + 0.03 * s(t), lunge=0.6)), None),
    "fall": (12, 12.0, False, pike_fall, None),
}


# ============================================================================== men-at-arms (sword + heater, or pollaxe)
def sword_ready(P):
    """sword held up at the ready before the right shoulder, point up and a little forward."""
    P.arm("R", "upperarm", -14, 14, 6); P.arm("R", "forearm", -70, 0, 0); P.rot("hand.R", -16)

def pollaxe_order(P):
    P.arm("R", "upperarm", -4, 9, 4); P.arm("R", "forearm", -86, 0, 0); P.rot("hand.R", -3)

def pollaxe_guard(P, k=0.0):
    """two-handed, the head high over the left shoulder (k=0) .. levelled forward (k=1)."""
    P.arm("R", "upperarm", lerp(-10, 14, k), 22, 20)
    P.arm("R", "forearm", lerp(-110, -60, k), 0, 0)
    P.rot("hand.R", lerp(-40, 10, k))
    P.ik = 1.0; P.grip = 0.52

def maa_idle(t, P): stand(P, t, 0.8); sword_ready(P); shield_guard(P, 0.3)
def maa_walk(t, P): walk_legs(P, t, A=19, knee=48); sword_ready(P); shield_guard(P, 0.3)
def maa_run(t, P):
    run_legs(P, t, A=30, knee=84, lean=10)
    P.arm("R", "upperarm", 14 + 6 * c(t), 16, 0); P.arm("R", "forearm", -48); P.rot("hand.R", 10)
    shield_guard(P, 0.7)
def one_hand_cut(P, t):
    """a one-handed cut from above (sword, falchion, axe, mallet): from the guard (point up before the right
    shoulder) the blade is swung up and back over the head, cut down and across, the point ending low in
    front; recovered to the guard. Stations are (upperarm x, abd, internal, forearm, hand)."""
    G = (-14, 14, 6, -70, -16); U = (-150, 26, 10, -62, 88); D = (-48, 8, -12, -12, 76)
    q = keys(t, [(0.0, G), (0.32, U), (0.48, D), (0.60, D), (1.0, G)])
    P.arm("R", "upperarm", q[0], q[1], q[2]); P.arm("R", "forearm", q[3], 0, 0); P.rot("hand.R", q[4])
    up = keys(t, [(0.0, 0.0), (0.32, 1.0), (0.48, 0.0)]); dn = keys(t, [(0.32, 0.0), (0.48, 1.0), (0.6, 1.0), (1.0, 0.0)])
    P.leg("L", -18, 18, 2, 5); P.leg("R", 16, 10, -8, 7); P.move(z=-0.035)
    P.rot("pelvis", 0, 0, -8 * up + 10 * dn); P.rot("spine", 4 * dn, 0, -12 * up + 14 * dn); P.rot("chest", 6 * dn, 0, -10 * up + 12 * dn)
    P.rot("neck", -6, 0, 8 * up - 10 * dn)
    P.move(y=-0.05 * dn)
    return up, dn

def maa_strike(t, P):
    """sword and shield: a cut from above, the shield held up and forward."""
    one_hand_cut(P, t); shield_guard(P, 0.9)

def maa_idle_pollaxe(t, P): stand(P, t, 0.8); pollaxe_order(P); left_hang(P)
def maa_walk_pollaxe(t, P): walk_legs(P, t, A=19, knee=48); pollaxe_order(P); swing_arm(P, "L", t, 12, 14)
def maa_run_pollaxe(t, P):
    run_legs(P, t, A=30, knee=84, lean=10); pollaxe_guard(P, 0.6); P.arm("R", "upperarm", 4 * c(t))
def maa_strike_pollaxe(t, P):
    """pollaxe: from the high guard over the right shoulder a heavy downward blow with the axe, a jab with the
    top spike, recovered. Right fist near the butt end, left hand forward on the haft."""
    P.leg("L", -20, 20, 2, 5); P.leg("R", 18, 10, -8, 7); P.move(z=-0.04)
    # stations: (fist x, y, z, pitch)   pitch: -90 = head straight up, 0 = level forward, + = head down
    G = (-0.20, -0.10, 1.12, -70); U = (-0.12, 0.06, 1.60, -118); D = (-0.08, -0.26, 1.04, 22); J = (-0.12, -0.20, 1.18, -4)
    q = keys(t, [(0.0, G), (0.28, U), (0.46, D), (0.56, D), (0.70, G), (0.80, J), (0.88, J), (1.0, G)])
    up = keys(t, [(0.0, 0.0), (0.28, 1.0), (0.46, 0.0)]); dn = keys(t, [(0.28, 0.0), (0.46, 1.0), (0.56, 1.0), (0.70, 0.0)])
    jab = keys(t, [(0.70, 0.0), (0.80, 1.0), (0.88, 1.0), (1.0, 0.0)])
    P.rot("pelvis", 0, 0, -10 * up + 12 * dn); P.rot("spine", 10 * dn, 0, -10 * up + 12 * dn); P.rot("chest", 8 * dn, 0, -8 * up + 10 * dn)
    P.rot("neck", -10 * dn, 0, 6 * up - 10 * dn)
    P.move(y=-0.06 * dn - 0.05 * jab)
    place_hand(P, "R", q[:3], rot=(q[3], 0, 6), pole=(-1, 0.4, -0.6))
    P.ik = 1.0; P.grip = 0.30

MAA = {
    "idle": (16, 6.0, True, maa_idle, None),
    "walk": (16, 14.5, True, maa_walk, 1.25),
    "run": (12, 17.0, True, maa_run, 3.00),
    "strike": (12, 12.0, True, maa_strike, None),
    "fall": (12, 12.0, False, lambda t, P: (sword_ready(P), shield_guard(P, 0.3), A.fall(t, P), lay_down_kit(P, t)), None),
    "fall_pollaxe": (12, 12.0, False, lambda t, P: (pollaxe_order(P), A.fall(t, P), lay_down_kit(P, t, shield=False, yaw=170)), None),
    "idle_pollaxe": (16, 6.0, True, maa_idle_pollaxe, None),
    "walk_pollaxe": (16, 14.5, True, maa_walk_pollaxe, 1.25),
    "run_pollaxe": (12, 17.0, True, maa_run_pollaxe, 3.00),
    "strike_pollaxe": (14, 11.0, True, maa_strike_pollaxe, None),
}


# ============================================================================== longbow
AIM_LOOSE = 0.64
BOW_CANT = -26.0
DRAW = 0.58   # m the drawing hand travels back from the string at full draw (brace 0.145 + 0.58 ≈ a 29" draw)

def bow_carry(P):
    """the strung bow held like a staff in the left fist, lower tip near the ground."""
    P.arm("L", "upperarm", -4, 8, -4); P.arm("L", "forearm", -84, 0, 0); P.rot("hand.L", -2)

def bow_idle(t, P):
    stand(P, t); bow_carry(P)
    P.arm("R", "upperarm", 4, 8, 0); P.arm("R", "forearm", -16)

def bow_walk(t, P):
    walk_legs(P, t, A=21, knee=52); bow_carry(P); swing_arm(P, "R", t, 16, 14)
    P.arm("L", "upperarm", -3 * c(t))

def bow_run(t, P):
    run_legs(P, t, A=35, knee=92, lean=11)
    P.arm("L", "upperarm", -18 - 10 * c(t), 10, 0); P.arm("L", "forearm", -66, 0, 0); P.rot("hand.L", 30)
    swing_arm(P, "R", t, 30, 60)

def draw_stance(P, k):
    """sideways to the mark, left shoulder toward it (k: 0 square .. 1 fully turned), head to the target."""
    P.leg("L", -6 * k, 6 * k, 0, 8 * k); P.leg("R", 6 * k, 8 * k, -4 * k, 10 * k)
    P.rot("pelvis", 0, 0, -36 * k); P.rot("spine", 0, 0, -20 * k); P.rot("chest", 2 * k, 0, -18 * k)
    P.rot("neck", 0, 0, 46 * k); P.rot("head", 6 * k, 0, 22 * k)

def bow_arm_up(P, k, lift=0.0):
    """bow arm from the carry (k=0) to straight toward the mark with the bow upright (k=1).
    lift: extra elevation of the arm (degrees) to aim a high, long shot."""
    x = lerp(-4, -90 - lift, k); fz = lerp(0, 53, k)
    P.rot("upperarm.L", x, lerp(-8, 0, k), fz)
    P.arm("L", "forearm", lerp(-84, -4, k), 0, 0)
    P.rot("hand.L", lerp(-2, 0, k), lerp(0, BOW_CANT, k), 0)

def bow_shoot(t, P):
    """nock - draw - loose (loose at 0.64): the right hand fetches an arrow from the bag, sets it on the
    string, the bow comes up as the string is drawn to the jaw, a short hold, the loose (the string and
    arrow go at once, the hand flies back past the ear), then back to the ready."""
    LOOSE = AIM_LOOSE
    turn = keys(t, [(0.0, 0.55), (0.25, 0.8), (0.45, 1.0), (0.85, 1.0), (1.0, 0.55)])
    draw_stance(P, turn)
    P.move(z=-0.012 * turn)
    up = keys(t, [(0.0, 0.25), (0.22, 0.35), (0.48, 1.0), (0.78, 1.0), (1.0, 0.25)])
    bow_arm_up(P, up, lift=8.0)
    # drawing hand, FK between its stations (bag -> release follow-through -> back to the bag);
    # from the nock to the loose an IK on the string target (sliding back along the draw) takes over
    bag = (14, 16, -34, 0)            # upperarm x, abd, forearm, hand: fingers at the arrow bag's mouth
    rel = (-60, 70, -120, 0)          # after the loose: the hand flown back past the ear
    k = keys(t, [(0.0, 0.0), (LOOSE, 0.0), (LOOSE + 0.07, 1.0), (0.84, 1.0), (1.0, 0.0)])
    ua, ab, fa, hd = (lerp(a, b, k) for a, b in zip(bag, rel))
    P.arm("R", "upperarm", ua, ab, 0); P.arm("R", "forearm", fa, 0, 0); P.rot("hand.R", hd)
    ik = keys(t, [(0.0, 0.0), (0.10, 0.0), (0.24, 1.0), (LOOSE, 1.0)]) if t <= LOOSE else 0.0
    d = keys(t, [(0.0, 0.0), (0.27, 0.0), (0.52, 1.0), (LOOSE, 1.03)]) if t <= LOOSE else 0.0
    locs(P, draw_tgt=(0.0, 0.0, DRAW * d))
    cons(P, drawik=ik, draw=(1.0 if 0.24 <= t <= LOOSE else 0.0), arrow=(seg(t, 0.10, 0.24) if t <= LOOSE else 0.0))

def buckler_fend(P, k=1.0):
    """the buckler fist punched out to the front-left, the boss toward the enemy (knuckles forward)."""
    P.arm("L", "upperarm", lerp(-20, -58, k), 16, lerp(10, 40, k)); P.arm("L", "forearm", lerp(-40, -22, k), 0, 0)
    P.rot("hand.L", 0, 0, 0)

def bow_strike(t, P):
    """sidearm and buckler (the bow put down): a cut from above, the buckler punched out to cover the hand."""
    up, dn = one_hand_cut(P, t)
    buckler_fend(P, 0.6 + 0.4 * dn)

BOW = {
    "idle": (16, 6.0, True, bow_idle, None),
    "walk": (16, 14.5, True, bow_walk, 1.35),
    "run": (12, 17.0, True, bow_run, 3.60),
    "strike": (12, 12.0, True, bow_strike, None),
    "shoot": (16, 9.0, False, bow_shoot, None),
    "fall": (12, 12.0, False, lambda t, P: (bow_carry(P), A.fall(t, P), blend_hand_world(P, "L", (0, 90, 160), seg(t, 0.4, 0.95))), None),
}


# ============================================================================== crossbow
def xbow_port(P):
    """spanned crossbow carried at the port: stock in the right fist at the hip, prod up and forward,
    the left hand steadying the fore-end."""
    P.arm("R", "upperarm", 6, 12, 10); P.arm("R", "forearm", -58, 0, 0); P.rot("hand.R", -18)
    P.ik = 1.0; P.grip = 0.26
    cons(P, cock=1.0)

AIM_FIST = (-0.105, -0.36, 1.47)      # the trigger fist before the right cheek; the butt lies against it
def xbow_aim(P, k):
    """from the port (k=0) to the aim (k=1): the stock level, butt at the right cheek, left hand under the
    fore-end, the head bowed a little to the sight line."""
    P.rot("neck", 8 * k, 0, 4 * k); P.rot("head", 10 * k, 0, 6 * k); P.rot("chest", 0, 0, -6 * k)
    xbow_port(P)
    if k > 0:
        port = P.r.copy()
        place_hand(P, "R", AIM_FIST, rot=(-2, 0, 0), pole=(-1, 0.2, -0.7))
        aim = {b: list(v) for b, v in P.r.items()}
        for b in ("upperarm.R", "forearm.R", "hand.R"):
            a0 = port.get(b, [0, 0, 0]); P.r[b] = [lerp(x0, x1, k) for x0, x1 in zip(a0, aim[b])]
    P.ik = 1.0; P.grip = lerp(0.26, 0.20, k)

def xbow_idle(t, P): stand(P, t); xbow_port(P)
def xbow_walk(t, P): walk_legs(P, t); xbow_port(P); P.arm("R", "upperarm", 2 * c(t))
def xbow_run(t, P): run_legs(P, t, A=33, knee=88, lean=10); xbow_port(P); P.arm("R", "upperarm", 5 * c(t))

def xbow_shoot(t, P):
    """raise to the cheek, settle the aim, loose (0.55): the string snaps forward, the bow kicks, lowered."""
    LOOSE = 0.55
    stand(P, 0.0, 0.3)
    P.leg("L", -12, 10, 0, 6); P.leg("R", 8, 6, -4, 8); P.rot("pelvis", 0, 0, -10); P.rot("spine", 0, 0, -6)
    k = keys(t, [(0.0, 0.0), (0.30, 1.0), (0.80, 1.0), (1.0, 0.0)])
    xbow_aim(P, k)
    kick = keys(t, [(LOOSE, 0.0), (LOOSE + 0.06, 1.0), (LOOSE + 0.25, 0.0)]) if t > LOOSE else 0.0
    P.rot("hand.R", -8 * kick); P.rot("chest", -3 * kick)
    cons(P, cock=1.0 if t <= LOOSE else 0.0)

def body_point(P, bone, rest_pt):
    """where a point fixed to `bone` (given in rest space) is under pose P."""
    h, R = world(P, bone); return h + R @ (Vector(rest_pt) - _HEAD[bone])

def xbow_reload(t, P):
    """spanning with the belt claw: the bow's nose goes down into the stirrup under the right foot, he stoops
    and hooks the claw on the string, straightens his back to draw it up onto the nut, lifts the spanned bow
    to his waist, the left hand fetches a bolt from the quiver at the right hip and lays it in the groove,
    and he comes back to the port."""
    dn = keys(t, [(0.0, 0.0), (0.16, 1.0), (0.30, 1.0), (0.56, 0.45), (0.66, 0.0), (1.0, 0.0)])     # stoop
    sp = keys(t, [(0.0, 0.0), (0.12, 1.0), (0.58, 1.0), (0.70, 0.0), (1.0, 0.0)])                   # bow held on the stirrup
    fe = keys(t, [(0.0, 0.0), (0.68, 0.0), (0.76, 1.0), (0.82, 1.0), (0.92, 0.0), (1.0, 0.0)])       # left hand to the quiver
    # legs: right foot forward into the stirrup, knees give
    P.leg("L", lerp(2, 16, dn), lerp(4, 48, dn), lerp(-2, -18, dn), 5)
    P.leg("R", lerp(-2, -34, sp) + 8 * dn, lerp(4, 30, sp) + 30 * dn, lerp(-2, 4, sp) - 20 * dn, 6)
    P.move(z=-0.16 * dn - 0.03 * sp)
    P.rot("pelvis", 14 * dn, 0, -8 * sp); P.rot("spine", 30 * dn + 6 * sp, 0, 0); P.rot("chest", 20 * dn + 4 * sp); P.rot("neck", -30 * dn - 4 * sp)
    xbow_port(P)
    port = {b: list(P.r.get(b, [0, 0, 0])) for b in ("upperarm.R", "forearm.R", "hand.R")}
    if sp > 0:
        place_hand(P, "R", (-0.13, -0.40, 0.60), rot=(90, 0, 0), pole=(-1, 0.4, 0.2))
        for b, a0 in port.items(): P.r[b] = [lerp(x0, x1, sp) for x0, x1 in zip(a0, P.r[b])]
    # the left hand: on the butt while spanning, then under the fore-end; off to the quiver for a bolt
    P.ik = 1.0; P.grip = lerp(0.26, -0.24, sp)
    if fe > 0:
        P.ik = 1.0 - fe
        q = body_point(P, "pelvis", (-0.16, -0.02, 1.06))
        g = body_point(P, "hand.R", H.fist("R") + Vector((0, -0.16, 0.06)))
        place_hand(P, "L", q.lerp(g, keys(t, [(0.68, 0.0), (0.76, 0.0), (0.84, 1.0), (1.0, 1.0)])), rot=(-40, 0, -20), pole=(1, 0.3, -0.6))
    cons(P, cock=keys(t, [(0.0, 0.0), (0.30, 0.0), (0.56, 1.0), (1.0, 1.0)]))

def xbow_strike(t, P):
    """sword drawn (the crossbow slung / dropped): a cut from above, the left arm up to fend."""
    one_hand_cut(P, t)
    P.arm("L", "upperarm", -40, 25, 30); P.arm("L", "forearm", -70)

XBOW = {
    "idle": (16, 6.0, True, xbow_idle, None),
    "walk": (16, 14.5, True, xbow_walk, 1.30),
    "run": (12, 17.0, True, xbow_run, 3.20),
    "strike": (12, 12.0, True, xbow_strike, None),
    "shoot": (12, 10.0, False, xbow_shoot, None),
    "reload": (24, 7.0, False, xbow_reload, None),
    "fall": (12, 12.0, False, lambda t, P: (xbow_port(P), setattr(P, "ik", 1.0 - seg(t, 0.0, 0.3)), A.fall(t, P)), None),
}

LOOSE = {"bow": AIM_LOOSE, "xbow": 0.55}   # written into the vat json's shoot entry by the recipe (SPEC["clip_meta"])

A.FAMILIES.update({"levy": LEVY, "pike": PIKE, "maa": MAA, "bow": BOW, "xbow": XBOW})
