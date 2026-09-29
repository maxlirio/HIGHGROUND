"""HIGHGROUND units — the fighting: guard, blows that land, shield-work, reactions, deaths, the thrown.

Importing this module ADDS combat clips to every soldier family in _anims.FAMILIES (and defines the "knight"
family: sword-and-shield on foot, lance/sword/shield in the saddle). Same contract as _anims.py.

How a fight is built (docs/units-combat-anims.md has the engine side):
  * a GRIP is how the man holds his kit (sword+shield, spear+shield, two-handed spear, club, pollaxe, pike, sword
    and buckler, sword alone). Each grip gives a READY pose (arms only, placed exactly with place_hand /
    place_shield) and its blows.
  * every clip is stance (legs, torso) + the grip's arms + a body motion layered ON TOP (P.rot / P.move add), so
    a stagger carries the arms and the shield with it and nothing is re-solved in world space.
  * per grip suffix ("" / "_bare" / "_club" / "_pollaxe" ...) the engine picks <clip><suffix> for the man's weapon.
  * blows are one-shots whose CONTACT falls on a known fraction (CLIP_META[fam][clip]["hit"]); the engine starts
    them so that fraction lands on the sim's blow time (S.nextAtk). Reactions start AT the impact (frame 1).
  * deaths / knockdowns / writhing / thrown are shared by all grips of a family (the weapon falls from the hand).

Clip names (the engine knows them; any may be absent):
  guard strike strike2 strike_over strike_down bash shove press block parry hit hit_back
  fall fall_fwd fall_crumple fall_clutch writhe knock getup thrown idle_cover walk_cover
  riders: ride ride_charge ride_lower ride_strike ride_sword ride_bash ride_impact ride_hit ride_gallop
"""
import math
import _anims as A
import _arms_anims as AA
from _anims import s, c, seg, keys, lerp, ease, breathe, walk_legs, run_legs, swing_arm, fall_body
from _arms_anims import place_hand, place_shield, shield_pose, world, set_world_rot, blend_hand_world, stand, lay_down_kit
from _arms_anims import SH_CARRY, SH_GUARD, SH_HIGH, SH_BASH, SH_RIDE
SH_STOOP = (AA._nrm(0.95, -0.2, 0.25), AA._nrm(0.0, 0.3, 1.0), (0.31, -0.02, 1.22))   # stooping / kneeling: out at his side, up off the thigh
import _human as H
from mathutils import Vector, Euler, Quaternion

CLIP_META = {}          # fam -> clip -> {"hit": fraction}   (merged into <arm>_vat.json by tools/vat_bake.py)
POLE_R = (-1, 0.35, -0.55)
POLE_L = (1, 0.35, -0.55)

def V(x, y, z): return Vector((x, y, z))
def mixv(a, b, k): return Vector(a).lerp(Vector(b), k)
def mixr(a, b, k): return tuple(lerp(x, y, k) for x, y in zip(a, b))

def trak(t, ks):
    """keys() over (fist, rot) stations: ks = [(t, (fist, rot)), ...] -> (fist, rot)."""
    if t <= ks[0][0]: return ks[0][1]
    for (t0, v0), (t1, v1) in zip(ks, ks[1:]):
        if t <= t1:
            k = ease((t - t0) / (t1 - t0)); return (mixv(v0[0], v1[0], k), mixr(v0[1], v1[1], k))
    return ks[-1][1]


# ============================================================================== contact with the ground
ANKLE_Z = H.J["ankle"][2]
_JOINTS = [("pelvis", 0.13), ("spine", 0.12), ("chest", 0.13), ("neck", 0.07), ("upperarm.L", 0.08), ("upperarm.R", 0.08),
           ("forearm.L", 0.06), ("forearm.R", 0.06), ("hand.L", 0.05), ("hand.R", 0.05), ("shin.L", 0.065), ("shin.R", 0.065),
           ("foot.L", 0.06), ("foot.R", 0.06)]
_HEADC = H.HEAD_C

def plant(P):
    """standing: the lower ankle back at its rest height (no foot sinks, none floats)."""
    low = min(world(P, "foot.L")[0].z, world(P, "foot.R")[0].z)
    P.move(z=ANKLE_Z - low)

_TOE = {sd: H.jp("toe", sd) for sd in ("L", "R")}
def feet_on_floor(P):
    """after all the leg motion of a standing clip: no ankle below its rest height, no toe or heel in the ground
    (lift only)."""
    lo = 0.0
    for sd in ("L", "R"):
        a, r = world(P, f"foot.{sd}")
        toe = a + r @ (_TOE[sd] - AA._HEAD[f"foot.{sd}"])
        lo = min(lo, a.z - ANKLE_Z, toe.z - 0.02, a.z - 0.075)
    if lo < 0: P.move(z=-lo)

def ground_body(P, k=1.0, extra=None):
    """lying: the body brought to rest ON the ground (the lowest joint sphere touching z = 0), by k."""
    lo = 1e9
    for b, r in _JOINTS: lo = min(lo, world(P, b)[0].z - r)
    hp, hr = world(P, "head"); lo = min(lo, (hp + hr @ (_HEADC - AA._HEAD["head"])).z - 0.12)
    if extra: lo = min(lo, extra(P))
    P.move(z=-lo * k)

def settle_shield(P, k, face_down=False):
    """a dead or felled man's shield: the arm out to his side, the shield flat on the ground beside him (face up,
    or face down under the arm), blended in by k. Call after the body is posed."""
    if k <= 0: return
    bones = ("upperarm.L", "forearm.L", "hand.L")
    old = {b: list(P.r.get(b, [0.0, 0.0, 0.0])) for b in bones}
    S, Rc = world(P, "upperarm.L")
    lat = Rc @ Vector((1, 0, 0)); lat.z = 0
    if lat.length < 0.6:                       # lying on his side: the shield goes behind his back instead
        lat = Rc @ Vector((0, 1, 0)); lat.z = 0
    lat = lat.normalized() if lat.length > 1e-3 else Vector((1, 0, 0))
    out = Vector((0, 0, -1 if face_down else 1))
    dn = out.cross(lat)                       # (across, down, out) right-handed: the forearm points out from his side
    elbow = S + lat * 0.20 - dn * 0.22; elbow.z = min(elbow.z, S.z)   # upper arm down along his side, forearm out
    place_shield(P, "L", out, -dn, elbow)
    new = {b: P.r[b] for b in bones}
    for b in bones:
        qa = Euler([math.radians(v) for v in old[b]], "XYZ").to_quaternion(); qb = Euler([math.radians(v) for v in new[b]], "XYZ").to_quaternion()
        P.r[b] = [math.degrees(v) for v in qa.slerp(qb, k).to_euler("XYZ")]

def settle_weapon(P, k, yaw=150.0):
    """the weapon let go of: lying flat along the ground beside him."""
    blend_hand_world(P, "R", (0, 0, yaw), k)


# ============================================================================== stance and body motions
def fight_stance(P, t=0.0, amp=1.0, crouch=1.0):
    """the fighting stance: left foot forward, knees soft, weight on the balls of the feet, a slow shift."""
    sh = 0.012 * amp * s(t)
    P.leg("L", -17 * crouch, 20 * crouch, 3, 6); P.leg("R", 14 * crouch, 14 * crouch, -6, 8)
    P.move(y=sh, z=-0.045 * crouch + 0.006 * amp * c(2 * t))
    P.rot("pelvis", 0, 1.2 * amp * s(t), 8); P.rot("spine", 3, 0, -3); P.rot("chest", 3 + 1.2 * amp * s(t), 0, -3)
    P.rot("neck", -2, 0, -4 + 3 * amp * s(t + 0.3))
    plant(P)

def body_jolt(P, back=0.0, twist=0.0, side=0.0, drop=0.0, head=0.0):
    """a blow's effect on the torso, layered on top: back > 0 rocks him back from the front, twist turns the
    chest (+ to his left), side leans (+ to his left), drop sinks the hips, head snaps the head back."""
    P.rot("spine", -6 * back, side * 4, twist * 6); P.rot("chest", -8 * back, side * 5, twist * 8)
    P.rot("neck", -10 * head + 4 * back, 0, twist * 4); P.rot("head", -12 * head, 0, twist * 6)
    P.move(y=0.06 * back, z=-drop)

def step_back(P, k):
    """k: 0..1 of a step back with the right foot, the body following (a stagger)."""
    P.leg("R", 12 * k, 10 * k, -6 * k); P.leg("L", 6 * k, -4 * k, 2 * k)
    P.move(y=0.22 * k)

def step_in(P, k):
    """k: 0..1 of a step in on the left foot, the body following (a lunge, a shove)."""
    P.leg("L", -10 * k, 6 * k, 4 * k); P.leg("R", 10 * k, -4 * k, -6 * k)
    P.move(y=-0.16 * k, z=-0.02 * k)


# ============================================================================== grips: ready poses
# fists in the man's own frame at rest (he faces -Y, his left is +X), rot = (pitch, roll, yaw): (0,0,0) = the held
# thing forward, pitch < 0 raises its point, yaw > 0 turns it to his left.
SWORD_READY = (V(-0.20, -0.30, 1.22), (-52, 0, 10))      # blade up before the right breast, point toward the foe's face
SWORD_UP = (V(-0.24, 0.02, 1.76), (-125, 0, 18))         # wound up over the right shoulder
SWORD_CUT = (V(-0.02, -0.46, 1.24), (14, 0, 34))         # cut through, the blade down and across to his left
SWORD_LUNGE = (V(-0.21, -0.56, 1.30), (-4, 0, 2))        # the thrust at the face
SWORD_LOW = (V(0.02, -0.40, 0.80), (58, 0, 20))          # a stab down at a man on the ground
SWORD_PARRY = (V(-0.16, -0.36, 1.46), (-74, 0, 22))      # blade up and forward, beating the blow aside high

SPEAR_READY = (V(-0.20, 0.10, 1.02), (-11, 0, 5))         # couched under the right arm, point at the foe's chest
SPEAR_BACK = (V(-0.21, 0.24, 1.00), (-10, 0, 5))
SPEAR_OUT = (V(-0.13, -0.30, 1.10), (-7, 0, 3))
SPEAR_OVER = (V(-0.24, 0.12, 1.70), (12, 0, 4))          # overhand over the shield rim (or a front man's shoulder)
SPEAR_OVER_OUT = (V(-0.14, -0.42, 1.60), (14, 0, 3))
SPEAR_DOWN = (V(-0.12, -0.20, 1.50), (48, 0, 4))         # stabbing down at a man on the ground

def ready_sword(P, t=0.0, k=0.0):
    f, r = SWORD_READY; place_hand(P, "R", f + V(0, 0, 0.012 * s(t)), r, POLE_R)

def ready_spear(P, t=0.0):
    f, r = SPEAR_READY; place_hand(P, "R", f + V(0, 0.01 * s(t), 0), r, POLE_R)

def ready_shield(P, k=1.0): shield_pose(P, SH_CARRY, SH_GUARD, k)

def ready_bare_spear(P, t=0.0, k=0.0): AA.levy_level2(P, k)

def ready_club(P, t=0.0):
    place_hand(P, "R", V(-0.24, -0.08, 1.46), (-110, 0, 8), POLE_R)

def ready_pollaxe(P, t=0.0):
    place_hand(P, "R", V(-0.18, -0.08, 1.10), (-62, 0, 8), (-1, 0.4, -0.6)); P.ik = 1.0; P.grip = 0.34

def ready_pike(P, t=0.0): AA.pike_level(P, 0.2 + 0.03 * s(t), lunge=0.0)

def ready_buckler(P, k=0.6): AA.buckler_fend(P, k)

def left_fend(P, k=1.0):
    P.arm("L", "upperarm", -30 - 10 * k, 22, 25); P.arm("L", "forearm", -65 - 10 * k); P.rot("hand.L", 0)


# ============================================================================== blows (sword family)
def sword_cut(P, t):
    """from the guard the blade goes up over the right shoulder and cuts down and across into the foe's left side
    of head and shoulder (a right-hander's blow: Towton); contact at 0.45; recover to the guard."""
    f, r = trak(t, [(0.0, SWORD_READY), (0.3, SWORD_UP), (0.5, SWORD_CUT), (0.62, SWORD_CUT), (1.0, SWORD_READY)])
    up = keys(t, [(0.0, 0.0), (0.3, 1.0), (0.5, 0.0)]); dn = keys(t, [(0.3, 0.0), (0.5, 1.0), (0.62, 1.0), (1.0, 0.0)])
    P.rot("pelvis", 0, 0, -9 * up + 10 * dn); P.rot("spine", 5 * dn, 0, -10 * up + 12 * dn); P.rot("chest", 6 * dn, 0, -10 * up + 12 * dn)
    P.rot("neck", -4 * dn, 0, 8 * up - 10 * dn)
    step_in(P, 0.5 * dn)
    place_hand(P, "R", f, r, POLE_R)
    return up, dn

def sword_thrust(P, t):
    """a thrust at the face over the shield: drawn back, driven in with a step, recovered (contact 0.4)."""
    back = (V(-0.24, -0.10, 1.26), (-20, 0, 6))
    f, r = trak(t, [(0.0, SWORD_READY), (0.2, back), (0.4, SWORD_LUNGE), (0.55, SWORD_LUNGE), (1.0, SWORD_READY)])
    k = keys(t, [(0.0, 0.0), (0.2, -0.3), (0.4, 1.0), (0.55, 1.0), (1.0, 0.0)])
    step_in(P, max(0.0, k)); P.rot("chest", 4 * max(0, k), 0, -10 * max(0, k)); P.rot("pelvis", 0, 0, -8 * max(0, k))
    place_hand(P, "R", f, r, POLE_R)
    return max(0.0, k)

def sword_down(P, t):
    """cluster finish: stooped over a fallen man, short chopping stabs down (loop)."""
    P.leg("L", -30, 42, -8, 8); P.leg("R", 18, 30, -14, 9); P.move(z=-0.12)
    k = keys(t, [(0.0, 0.0), (0.35, 1.0), (0.5, -0.2), (0.62, -0.2), (1.0, 0.0)])
    up = max(0.0, k); dn = max(0.0, -k) / 0.2
    P.rot("pelvis", 14 + 6 * dn); P.rot("spine", 16 + 8 * dn - 6 * up, 0, 6); P.rot("chest", 8 + 6 * dn); P.rot("neck", -28)
    hi = (V(-0.16, -0.30, 1.45), (-40, 0, 12))
    f, r = trak(t, [(0.0, mixst(hi, SWORD_LOW, 0.4)), (0.35, hi), (0.5, SWORD_LOW), (0.62, SWORD_LOW), (1.0, mixst(hi, SWORD_LOW, 0.4))])
    place_hand(P, "R", f, r, POLE_R)

def mixst(a, b, k): return (mixv(a[0], b[0], k), mixr(a[1], b[1], k))

def sword_parry(t, P):
    """the blade beats a blow aside across his body (impact at frame 1), a half step back."""
    k = keys(t, [(0.0, 0.3), (0.15, 1.0), (0.35, 0.8), (1.0, 0.0)])
    f, r = mixst(SWORD_READY, SWORD_PARRY, k); place_hand(P, "R", f, r, POLE_R)
    step_back(P, 0.35 * k); body_jolt(P, back=0.5 * k, twist=0.6 * k)


# ============================================================================== blows (spear family)
def spear_thrust(P, t):
    """underarm thrust at the chest from behind the shield: drawn back, driven with the body (contact 0.4)."""
    f, r = trak(t, [(0.0, SPEAR_READY), (0.2, SPEAR_BACK), (0.4, SPEAR_OUT), (0.55, SPEAR_OUT), (1.0, SPEAR_READY)])
    k = keys(t, [(0.0, 0.0), (0.2, -0.3), (0.4, 1.0), (0.55, 1.0), (1.0, 0.0)])
    step_in(P, 0.7 * max(0, k)); P.rot("pelvis", 0, 0, 10 - 14 * max(0, k)); P.rot("chest", 4 * max(0, k), 0, 6 - 12 * max(0, k))
    place_hand(P, "R", f, r, POLE_R)

def spear_over(P, t, reach=1.0):
    """overhand thrust over the shield rim (or over a front-rank man's shoulder), down into the face (contact 0.45)."""
    out = (SPEAR_OVER_OUT[0] + V(0, -0.15 * (reach - 1), 0.02 * (reach - 1)), SPEAR_OVER_OUT[1])
    f, r = trak(t, [(0.0, SPEAR_READY), (0.25, SPEAR_OVER), (0.45, out), (0.58, out), (0.8, SPEAR_OVER), (1.0, SPEAR_READY)])
    k = keys(t, [(0.25, 0.0), (0.45, 1.0), (0.58, 1.0), (0.8, 0.0)])
    step_in(P, 0.6 * k); P.rot("chest", 6 * k, 0, -10 * k); P.rot("neck", -6 * k)
    place_hand(P, "R", f, r, POLE_R)

def spear_down(P, t):
    P.leg("L", -26, 34, -6, 8); P.leg("R", 16, 24, -12, 9); P.move(z=-0.08)
    k = keys(t, [(0.0, 0.0), (0.35, -0.3), (0.5, 1.0), (0.62, 1.0), (1.0, 0.0)])
    P.rot("pelvis", 10); P.rot("spine", 12 + 6 * max(0, k)); P.rot("chest", 6); P.rot("neck", -24)
    hi = (V(-0.20, 0.10, 1.66), (40, 0, 4))
    f, r = mixst(hi, SPEAR_DOWN, max(0.0, k)); place_hand(P, "R", f, r, POLE_R)

def spear_parry(t, P):
    k = keys(t, [(0.0, 0.3), (0.15, 1.0), (0.35, 0.8), (1.0, 0.0)])
    f, r = mixst(SPEAR_READY, (V(-0.12, -0.05, 1.20), (-30, 0, 30)), k); place_hand(P, "R", f, r, POLE_R)
    step_back(P, 0.35 * k); body_jolt(P, back=0.5 * k, twist=0.5 * k)


# ============================================================================== shield work
def shield_block(P, t):
    """a blow taken on the shield: up to meet it, the impact at frame 1 drives shield and man back a step."""
    k = keys(t, [(0.0, 0.55), (0.12, 1.0), (0.45, 0.8), (1.0, 0.0)])
    imp = keys(t, [(0.0, 0.0), (0.12, 1.0), (0.4, 0.3), (1.0, 0.0)])
    shield_pose(P, SH_GUARD, SH_HIGH, k)
    step_back(P, 0.45 * imp); body_jolt(P, back=0.9 * imp, twist=-0.4 * imp, drop=0.03 * imp, head=0.3 * imp)

def shield_bash(P, t):
    """the shield punched into the foe's face and chest with the left shoulder behind it, a step in (contact 0.4)."""
    k = keys(t, [(0.0, 0.0), (0.2, -0.35), (0.4, 1.0), (0.55, 1.0), (1.0, 0.0)])
    kk = max(0.0, k)
    if k < 0: shield_pose(P, SH_GUARD, SH_CARRY, -k)
    else: shield_pose(P, SH_GUARD, SH_BASH, kk)
    step_in(P, 1.1 * kk - 0.3 * max(0.0, -k))
    P.rot("pelvis", 0, 0, 14 * kk - 10 * max(0.0, -k)); P.rot("spine", 6 * kk, 0, 10 * kk); P.rot("chest", 6 * kk, 0, 12 * kk - 8 * max(0.0, -k))
    P.rot("neck", -6 * kk, 0, -14 * kk)

def shove(P, t, shield=True):
    """in the press: leaning into the man in front with shield and shoulder, legs driving, in pulses (loop)."""
    pulse = 0.5 + 0.5 * s(t)
    P.leg("L", -24, 26, -4, 7); P.leg("R", 26 + 6 * pulse, 10, -18, 8); P.move(y=-0.04 * pulse, z=-0.06)
    P.rot("pelvis", 8, 0, 12); P.rot("spine", 10 + 4 * pulse, 0, 8); P.rot("chest", 6, 0, 8); P.rot("neck", -14, 0, -18)
    if shield: shield_pose(P, SH_GUARD, SH_BASH, 0.55 + 0.35 * pulse)
    else: P.arm("L", "upperarm", -58 - 10 * pulse, 18, 30); P.arm("L", "forearm", -40)

def press(P, t, shield=True):
    """rank behind the fighters: pressed close, the left hand (or shield) on the back of the man in front,
    looking past him, weight forward (loop)."""
    P.leg("L", -12, 14, 0, 6); P.leg("R", 16 + 4 * s(t), 8, -10, 8); P.move(y=-0.02 * s(t), z=-0.03)
    P.rot("pelvis", 6, 0, 6); P.rot("spine", 8 + 2 * s(t), 0, 4); P.rot("chest", 4); P.rot("neck", -10, 0, 12 * s(0.5 * t + 0.1))
    if shield: shield_pose(P, SH_GUARD, SH_BASH, 0.3 + 0.1 * s(t))
    else: place_hand(P, "L", V(0.12, -0.52, 1.20), (80, 0, -20), POLE_L)


# ============================================================================== reactions (layered on the ready pose)
def react_hit(P, t, sever=1.0):
    """struck from the front (impact at frame 1): the head and chest snap back and twist, a stagger back a step,
    the guard sagging, then recovering it."""
    imp = keys(t, [(0.0, 0.2), (0.1, 1.0), (0.35, 0.75), (1.0, 0.0)]) * sever
    st = keys(t, [(0.0, 0.0), (0.3, 1.0), (0.65, 0.8), (1.0, 0.0)]) * sever
    step_back(P, 0.9 * st); body_jolt(P, back=1.2 * imp, twist=-0.9 * imp, side=-0.4 * imp, drop=0.05 * imp, head=1.0 * imp)
    P.rot("upperarm.R", 18 * imp); P.rot("forearm.R", 10 * imp)

def react_hit_back(P, t):
    """struck from behind: pitched forward, stumbling a step, catching himself."""
    imp = keys(t, [(0.0, 0.2), (0.1, 1.0), (0.4, 0.7), (1.0, 0.0)])
    P.rot("spine", 14 * imp); P.rot("chest", 10 * imp); P.rot("neck", 10 * imp); P.rot("head", 8 * imp)
    step_in(P, 1.2 * keys(t, [(0.0, 0.0), (0.35, 1.0), (0.7, 0.8), (1.0, 0.0)]))


# ============================================================================== falls (shared by every grip)
def _drop_weapons(P, t, t0=0.1, t1=0.5):
    """hands open: the arms fly loose from their grips (the ready pose's arm rotations fade out)."""
    k = seg(t, t0, t1)
    for sd in ("L", "R"):
        for b in (f"upperarm.{sd}", f"forearm.{sd}", f"hand.{sd}"):
            a = P.r.get(b, [0.0, 0.0, 0.0]); P.r[b] = [v * (1 - k) for v in a]
    if P.ik: P.ik = P.ik * (1 - k)

def _finish(P, t, face_down=False, yaw=150.0, t0=0.4):
    """end of every fall: kit settled flat beside the body, the body resting on the ground."""
    k = seg(t, t0, 0.95)
    settle_shield(P, k, face_down); settle_weapon(P, k, yaw)
    g = seg(t, 0.45, 0.8)
    if g < 1:                                  # still on his feet / knees: nothing through the floor
        P0 = P.loc.z; feet_on_floor(P); P.loc.z = P0 + (P.loc.z - P0) * (1 - g)
    ground_body(P, g)

def fall_back(t, P, ready):
    """shot or cut down: the knees go, he topples on his back and lies still (the classic)."""
    ready(P, 0.0); _drop_weapons(P, t, 0.05, 0.4)
    fall_body(P, t, back=True)
    _finish(P, t)

def fall_fwd(t, P, ready):
    """struck from behind or run through: pitched forward onto his face, arms flung out ahead."""
    ready(P, 0.0); _drop_weapons(P, t, 0.05, 0.35)
    k = seg(t, 0.0, 0.3); f = seg(t, 0.15, 0.85)
    P.move(z=-0.22 * k * (1 - f))
    P.rot("root", 88 * f); P.move(z=0.10 * f, y=-0.15 * f)
    for sd in ("L", "R"):
        P.leg(sd, lerp(-30 * k, 6, f), lerp(60 * k, 22 if sd == "L" else 8, f), lerp(-20 * k, -40, f), abd=5 + 5 * f)
        P.arm(sd, "upperarm", lerp(-30 * k, -150, f), lerp(12, 40 if sd == "L" else 30, f), 0)
        P.arm(sd, "forearm", lerp(-50 * k, -30, f), 0, 0)
    P.rot("spine", -6 * f); P.rot("neck", lerp(10, -30, f), 0, 30 * seg(t, 0.8, 1.0))
    _finish(P, t, face_down=True, yaw=120.0)

def fall_crumple(t, P, ready):
    """the legs simply go (a blow to the head): he drops to his knees, sags, and folds over onto his side."""
    ready(P, 0.0); _drop_weapons(P, t, 0.1, 0.5)
    kn = seg(t, 0.0, 0.35); f = seg(t, 0.35, 0.95)
    for sd in ("L", "R"):
        P.leg(sd, lerp(-10 * kn, -70, f), lerp(120 * kn, 100, f), lerp(20 * kn, 0, f), abd=6)
    P.rot("root", 20 * f, lerp(0, 82, f), 0)
    P.rot("spine", 20 * kn + 10 * f); P.rot("chest", 10 * kn + 10 * f); P.rot("neck", 30 * kn - 10 * f)
    for sd in ("L", "R"):
        P.arm(sd, "upperarm", lerp(-10, -40, f), lerp(8, 30, f), 0); P.arm(sd, "forearm", -30 - 40 * f)
    ground_body(P, 1.0)          # kneeling, then folding: the lowest joint always on the ground
    _finish(P, t, yaw=160.0)

def fall_clutch(t, P, ready):
    """gut-struck: the right hand to the wound, doubled over, down on one knee, then over onto his side, curled."""
    ready(P, 0.0); _drop_weapons(P, t, 0.0, 0.2)
    cl = seg(t, 0.0, 0.25); kn = seg(t, 0.2, 0.5); f = seg(t, 0.5, 0.95)
    P.rot("spine", 26 * cl + 10 * f); P.rot("chest", 16 * cl); P.rot("neck", -10 * cl + 20 * f)
    P.arm("R", "upperarm", -40 * cl, 10, 55 * cl); P.arm("R", "forearm", -95 * cl)
    P.arm("L", "upperarm", -20 * cl, 25 * cl, 0); P.arm("L", "forearm", -40 * cl)
    P.leg("L", lerp(-40 * kn, -80, f), lerp(80 * kn, 110, f), 0, 6); P.leg("R", lerp(10 * kn, -40, f), lerp(100 * kn, 90, f), 20 * kn, 6)
    P.rot("root", 10 * f, lerp(0, -84, f), 20 * f)
    ground_body(P, 1.0) if kn > 0 else plant(P)
    k = seg(t, 0.45, 0.95); settle_shield(P, k, face_down=True); ground_body(P, seg(t, 0.55, 1.0))

def writhe(t, P):
    """lying on his back, badly hurt: a knee drawn up and let down, an arm reaching, the head lifting (loop)."""
    fall_body(P, 1.0, back=True)
    P.leg("L", -20 * (0.5 + 0.5 * s(t)), 40 * (0.5 + 0.5 * s(t)), 0, 0)
    P.arm("R", "upperarm", -40 - 30 * (0.5 + 0.5 * s(t + 0.3)), -10, 0); P.arm("R", "forearm", -40)
    P.arm("L", "upperarm", -20, 0, 30 * s(t + 0.6)); P.rot("neck", -12 * (0.5 + 0.5 * s(t + 0.15)))
    P.rot("spine", 0, 0, 6 * s(t))
    settle_shield(P, 1.0); settle_weapon(P, 1.0); ground_body(P)

def blend_poses(P, fa, fb, k):
    """P := pose fa blended toward pose fb by k (rotations slerped bone by bone, root offset lerped)."""
    Pa, Pb = A.Pose(), A.Pose(); fa(Pa); fb(Pb)
    for b in set(Pa.r) | set(Pb.r):
        qa = Euler([math.radians(v) for v in Pa.r.get(b, [0, 0, 0])], "XYZ").to_quaternion()
        qb = Euler([math.radians(v) for v in Pb.r.get(b, [0, 0, 0])], "XYZ").to_quaternion()
        P.r[b] = [math.degrees(v) for v in qa.slerp(qb, k).to_euler("XYZ")]
    P.loc = Pa.loc.lerp(Pb.loc, k)

def _lie(P): fall_body(P, 1.0, back=True)
def _kneel(P):
    P.move(z=-0.42); P.leg("L", -84, 92, -4, 10); P.leg("R", 6, 104, 30, 8)
    P.rot("pelvis", 4); P.rot("spine", 14); P.rot("chest", 6); P.rot("neck", -18)
    P.arm("L", "upperarm", -30, 20, 0); P.arm("L", "forearm", -30)
def _side(P):
    _lie(P); P.rot("root", 0, 55, 0); P.leg("L", -40, 70, 0, 4); P.leg("R", -20, 60, 0, 4); P.rot("spine", 10)

def knock(t, P, ready):
    """knocked off his feet (a shove, a horse, a stone's spray): over backwards fast, onto his back."""
    k = ease(seg(t, 0.0, 0.85))
    blend_poses(P, lambda Q: (fight_stance(Q, 0, 0), ready(Q, 0.0)), lambda Q: (_lie(Q), settle_shield(Q, 1.0), settle_weapon(Q, 1.0)), k)
    P.move(y=0.30 * k); P.ik = 0.0
    ground_body(P, k)

def getup(t, P, ready):
    """from his back: rolls onto his side, gets a knee under him, rises into his guard, weapon back up."""
    lie = lambda Q: (_lie(Q), settle_shield(Q, 1.0), settle_weapon(Q, 1.0))
    side = lambda Q: (_side(Q), settle_shield(Q, 1.0), settle_weapon(Q, 1.0))
    kneel = lambda Q: (_kneel(Q), shield_pose(Q, SH_STOOP), settle_weapon(Q, 0.5))
    stand_ = lambda Q: (fight_stance(Q, 0, 0), ready(Q, 0.0))
    if t < 0.3: blend_poses(P, lie, side, ease(t / 0.3)); ground_body(P)
    elif t < 0.6: blend_poses(P, side, kneel, ease((t - 0.3) / 0.3)); ground_body(P)
    else:
        blend_poses(P, kneel, stand_, ease((t - 0.6) / 0.4))
        if t > 0.99: stand_(P)
    P.ik = 1.0 if t > 0.99 and P.ik else 0.0

def thrown(t, P):
    """flung through the air by a stone's blast: limbs splayed and flailing (loop; the engine flies and spins
    him and lands him in a lying pose)."""
    for sd in ("L", "R"):
        sg = 1 if sd == "L" else -1
        P.arm(sd, "upperarm", -60 + 40 * s(t + (0.25 if sd == "L" else 0)), 70, 0); P.arm(sd, "forearm", -30 - 20 * s(t))
        P.leg(sd, -30 + 25 * s(t + (0.5 if sd == "L" else 0)), 40 + 20 * c(t), 10, 14)
    P.rot("spine", -10 + 8 * s(t)); P.rot("neck", 20)


def cover(P, t, shield=True):
    """under arrows: shield up and angled over head and face, head bowed, shoulders hunched."""
    P.rot("neck", 22); P.rot("head", 10); P.rot("chest", 8); P.rot("spine", 4)
    if shield: shield_pose(P, SH_GUARD, SH_HIGH, 1.0)
    else: P.arm("L", "upperarm", -110, 30, 40); P.arm("L", "forearm", -110)


# ============================================================================== building a family's combat set
class Grip:
    """ready(P, t): arms of the guard. strike(t, P) / strike2 / strike_over / strike_down / parry: optional blows.
    shield: carries a shield on the left arm (block, bash, cover, shove with it)."""
    def __init__(self, ready, strike=None, strike2=None, over=None, down=None, parry=None, shield=False, hits=None, stance=1.0):
        self.ready, self.strike, self.strike2, self.over, self.down, self.parry = ready, strike, strike2, over, down, parry
        self.shield, self.hits, self.stance = shield, hits or {}, stance

def combat_clips(g, sfx=""):
    """{clip: (frames, fps, loop, fn, None)} and {clip: meta} for grip g under suffix sfx."""
    R = g.ready
    def base(t, P, amp=1.0): fight_stance(P, t, amp, g.stance); R(P, t)
    out, meta = {}, {}
    def add(name, nf, fps, loop, fn, hit=None):
        f0 = fn; fn = lambda t, P, f0=f0: (f0(t, P), feet_on_floor(P))
        out[name + sfx] = (nf, fps, loop, fn, None)
        if hit is not None: meta[name + sfx] = {"hit": hit}
    add("guard", 12, 6.0, True, lambda t, P: (base(t, P), breathe(P, t, 0.8)))
    if g.strike: add("strike", 10, 11.0, False, lambda t, P: (fight_stance(P, 0, 0, g.stance), g.strike(t, P)), g.hits.get("strike", 0.45))
    if g.strike2: add("strike2", 10, 11.0, False, lambda t, P: (fight_stance(P, 0, 0, g.stance), g.strike2(t, P)), g.hits.get("strike2", 0.4))
    if g.over: add("strike_over", 10, 10.0, False, lambda t, P: (fight_stance(P, 0, 0, g.stance), g.over(t, P)), g.hits.get("strike_over", 0.45))
    if g.down: add("strike_down", 10, 9.0, True, lambda t, P: g.down(t, P))
    if g.parry: add("parry", 8, 12.0, False, lambda t, P: (fight_stance(P, 0, 0, g.stance), R(P, 0), g.parry(t, P)))
    add("hit", 8, 11.0, False, lambda t, P: (base(t, P, 0), react_hit(P, t), g.shield and ready_shield(P, 0.8)))
    add("hit_back", 8, 10.0, False, lambda t, P: (base(t, P, 0), react_hit_back(P, t), g.shield and shield_pose(P, SH_STOOP)))
    add("press", 8, 4.0, True, lambda t, P: (press(P, t, g.shield), R(P, t) if not g.shield else AA.upright_carry(P)))
    add("shove", 10, 6.0, True, lambda t, P: (shove(P, t, g.shield), R(P, t)))
    if g.shield:
        add("block", 8, 12.0, False, lambda t, P: (fight_stance(P, 0, 0, g.stance), R(P, 0), shield_block(P, t)))
        add("bash", 8, 10.0, False, lambda t, P: (fight_stance(P, 0, 0, g.stance), R(P, 0), shield_bash(P, t),
                                                  P.rot("upperarm.R", 28 * keys(t, [(0, 0), (0.3, 1), (0.6, 1), (1, 0)]), 0, 0)), 0.4)
    return out, meta

def shared_clips(ready, shield=True, walk_speed=1.25, cover_arms=None):
    """deaths, knockdown, getting up, writhing, thrown, covering from arrows: one set per family."""
    rd = lambda P, t: ready(P, t)
    ca = cover_arms or (lambda P: None)
    return {
        "fall": (10, 11.0, False, lambda t, P: fall_back(t, P, rd), None),
        "fall_fwd": (10, 11.0, False, lambda t, P: fall_fwd(t, P, rd), None),
        "fall_crumple": (10, 9.0, False, lambda t, P: fall_crumple(t, P, rd), None),
        "fall_clutch": (12, 8.0, False, lambda t, P: fall_clutch(t, P, rd), None),
        "writhe": (8, 2.5, True, writhe, None),
        "knock": (7, 10.0, False, lambda t, P: knock(t, P, rd), None),
        "getup": (12, 7.0, False, lambda t, P: getup(t, P, rd), None),
        "thrown": (4, 8.0, True, thrown, None),
        "idle_cover": (8, 4.0, True, lambda t, P: (stand(P, t, 0.5), ca(P), cover(P, t, shield)), None),
        "walk_cover": (12, 12.0, True, lambda t, P: (walk_legs(P, t, A=17, knee=48, lean=8), ca(P), cover(P, t, shield)), walk_speed * 0.85),
    }


# ============================================================================== the families
def _ready_sword_shield(P, t=0.0): ready_sword(P, t); ready_shield(P, 1.0)
def _ready_spear_shield(P, t=0.0): ready_spear(P, t); ready_shield(P, 1.0)
def _ready_club_shield(P, t=0.0): ready_club(P, t); ready_shield(P, 1.0)
def _ready_sword_buckler(P, t=0.0): ready_sword(P, t); ready_buckler(P, 0.6)
def _ready_sword_alone(P, t=0.0): ready_sword(P, t); left_fend(P, 0.6)

G_SWORD_SHIELD = Grip(_ready_sword_shield, strike=lambda t, P: (sword_cut(P, t), ready_shield(P, 1.0)),
                      strike2=lambda t, P: (sword_thrust(P, t), ready_shield(P, 0.55)), down=lambda t, P: (sword_down(P, t), shield_pose(P, SH_STOOP)),
                      parry=sword_parry, shield=True, hits={"strike": 0.45, "strike2": 0.4})
G_SPEAR_SHIELD = Grip(_ready_spear_shield, strike=lambda t, P: (spear_thrust(P, t), ready_shield(P, 1.0)),
                      strike2=lambda t, P: (spear_over(P, t), ready_shield(P, 1.0)), over=lambda t, P: (spear_over(P, t, 1.6), ready_shield(P, 0.6)),
                      down=lambda t, P: (spear_down(P, t), shield_pose(P, SH_STOOP)), parry=spear_parry, shield=True, hits={"strike": 0.4, "strike2": 0.45})
G_SPEAR_BARE = Grip(lambda P, t=0.0: ready_bare_spear(P, t), strike=lambda t, P: AA.levy_strike_bare(t, P),
                    over=lambda t, P: (AA.levy_strike_bare(t, P)), down=lambda t, P: (spear_down(P, t), setattr(P, "ik", 1.0), setattr(P, "grip", 0.40)),
                    parry=lambda t, P: (body_jolt(P, back=0.5 * keys(t, [(0, 0.3), (0.15, 1), (1, 0)]))), hits={"strike": 0.45, "strike_over": 0.45})
G_CLUB_SHIELD = Grip(_ready_club_shield, strike=lambda t, P: AA.club_strike(t, P), down=lambda t, P: (sword_down(P, t), shield_pose(P, SH_STOOP)),
                     shield=True, hits={"strike": 0.5})
G_POLLAXE = Grip(lambda P, t=0.0: ready_pollaxe(P, t), strike=lambda t, P: AA.maa_strike_pollaxe(t, P), strike2=lambda t, P: pollaxe_hook(t, P),
                 down=lambda t, P: pollaxe_down(t, P), parry=lambda t, P: body_jolt(P, back=0.6 * keys(t, [(0, 0.3), (0.15, 1), (1, 0)])),
                 hits={"strike": 0.46, "strike2": 0.5})
G_PIKE = Grip(lambda P, t=0.0: ready_pike(P, t), strike=lambda t, P: AA.pike_strike(t, P), hits={"strike": 0.5}, stance=0.8)
G_SWORD_BUCKLER = Grip(_ready_sword_buckler, strike=lambda t, P: (sword_cut(P, t), ready_buckler(P, 0.9)),
                       strike2=lambda t, P: (sword_thrust(P, t), ready_buckler(P, 0.9)), down=lambda t, P: sword_down(P, t),
                       parry=lambda t, P: ready_buckler(P, 1.0), hits={"strike": 0.45, "strike2": 0.4})
G_SWORD_ALONE = Grip(_ready_sword_alone, strike=lambda t, P: (sword_cut(P, t), left_fend(P, 1.0)),
                     strike2=lambda t, P: (sword_thrust(P, t), left_fend(P, 0.8)), down=lambda t, P: sword_down(P, t),
                     parry=sword_parry, hits={"strike": 0.45, "strike2": 0.4})

def pollaxe_hook(t, P):
    """the hook: the axe/beak swung low round behind the foe's leading leg and hauled back (contact 0.5)."""
    P.leg("L", -24, 26, 2, 5); P.leg("R", 18, 16, -8, 7); P.move(z=-0.06)
    G = (V(-0.18, -0.08, 1.10), (-62, 0, 8)); OUT = (V(-0.02, -0.46, 0.82), (38, 0, 40)); HAUL = (V(-0.16, -0.16, 0.92), (30, 0, 20))
    f, r = trak(t, [(0.0, G), (0.3, OUT), (0.5, OUT), (0.7, HAUL), (1.0, G)])
    k = keys(t, [(0.0, 0.0), (0.3, 1.0), (0.5, 1.0), (0.7, 0.3), (1.0, 0.0)])
    P.rot("spine", 16 * k, 0, 8 * k); P.rot("chest", 8 * k); P.rot("neck", -14 * k); step_in(P, 0.6 * k)
    place_hand(P, "R", f, r, (-1, 0.4, -0.6)); P.ik = 1.0; P.grip = 0.36

def pollaxe_down(t, P):
    P.leg("L", -28, 38, -6, 8); P.leg("R", 16, 26, -12, 9); P.move(z=-0.1)
    k = keys(t, [(0.0, 0.0), (0.35, 1.0), (0.5, -0.2), (0.62, -0.2), (1.0, 0.0)])
    up = max(0.0, k); dn = max(0.0, -k) / 0.2
    P.rot("pelvis", 10); P.rot("spine", 14 + 8 * dn - 4 * up); P.rot("neck", -26)
    hi = (V(-0.14, 0.02, 1.62), (-80, 0, 6)); lo = (V(-0.06, -0.30, 1.02), (46, 0, 6))
    f, r = trak(t, [(0.0, mixst(hi, lo, 0.4)), (0.35, hi), (0.5, lo), (0.62, lo), (1.0, mixst(hi, lo, 0.4))])
    place_hand(P, "R", f, r, (-1, 0.4, -0.6)); P.ik = 1.0; P.grip = 0.34


def register(fam, grips, shared_ready, shield=True, walk_speed=1.25):
    """add the combat set to family `fam`: grips = {suffix: Grip}. The plain `strike` of the family is REPLACED by
    the grip's one-shot blow (the engine times it to the sim's blow)."""
    F = A.FAMILIES[fam]; meta = CLIP_META.setdefault(fam, {})
    for sfx, g in grips.items():
        clips, m = combat_clips(g, sfx); F.update(clips); meta.update(m)
    F.update(shared_clips(shared_ready, shield, walk_speed))


# the stance each shared clip starts from (a man with nothing special in his hands falls the same way)
register("spear", {"": G_SPEAR_SHIELD}, _ready_spear_shield)
register("levy", {"": G_SPEAR_SHIELD, "_bare": G_SPEAR_BARE, "_club": G_CLUB_SHIELD}, _ready_spear_shield)
register("maa", {"": G_SWORD_SHIELD, "_pollaxe": G_POLLAXE}, _ready_sword_shield)
register("pike", {"": G_PIKE}, lambda P, t=0.0: ready_pike(P, t), shield=False, walk_speed=1.2)
register("bow", {"": G_SWORD_BUCKLER}, _ready_sword_buckler, shield=False, walk_speed=1.35)
register("xbow", {"": G_SWORD_ALONE}, _ready_sword_alone, shield=False)


# ============================================================================== riders (seat at the origin)
LANCE_UP = (V(-0.21, -0.10, 0.34), (-86, 0, 2))          # lance upright on the thigh (relative to the seat: z up from it)
LANCE_COUCH = (V(-0.19, 0.02, 0.38), (-1, 0, 13))        # couched under the right arm, across the neck to the left

def _seat(P, v): return V(v.x, v.y, v.z)   # rider clips: the seat point IS the armature origin

def ride_lance(P, k, t=0.0):
    """the lance from upright (k=0) to couched (k=1), the rider leaning into it."""
    f = mixv(LANCE_UP[0], LANCE_COUCH[0], k); r = mixr(LANCE_UP[1], LANCE_COUCH[1], k)
    place_hand(P, "R", _seat(P, f) + V(0, 0, 0.01 * s(t)), r, (-1, 0.5, -0.4))

def rider_idle(t, P):
    A.ride_base(P); breathe(P, t); ride_lance(P, 0.0, t); P.rot("neck", 0, 0, 7 * s(t + 0.1))

def rider_gallop(t, P):
    """at the gallop before the charge: the lance still upright, the rider forward and rising with the stride."""
    A.ride_base(P, lean=12); ride_lance(P, 0.12, t); P.rot("spine", 2 * s(2 * t))

def rider_charge(t, P):
    """the couched lance: tucked under the right arm, levelled across the horse's neck, the rider leaning in
    behind the shield (the last 30-50 m)."""
    A.ride_base(P, lean=18); A.shield_ride(P, 0.12); ride_lance(P, 1.0, t); P.rot("spine", 1.5 * s(t * 2))

def rider_lower(t, P):
    """lowering the lance from upright to the couch in the last seconds (one-shot)."""
    k = ease(t); A.ride_base(P, lean=6 + 12 * k); A.shield_ride(P, 0.12 * k); ride_lance(P, k)

def rider_impact(t, P):
    """the lance strikes home: the arm and body driven back by the shock, the shaft shatters (the engine swaps the
    lance for its stump at contact, frame 1), then the rider rights himself."""
    imp = keys(t, [(0.0, 0.2), (0.12, 1.0), (0.45, 0.5), (1.0, 0.0)])
    A.ride_base(P, lean=18 - 22 * imp); A.shield_ride(P, 0.12)
    f = LANCE_COUCH[0] + V(0, 0.18 * imp, 0.05 * imp); r = mixr(LANCE_COUCH[1], (-20, 0, 30), imp)
    place_hand(P, "R", _seat(P, f), r, (-1, 0.5, -0.4))
    P.rot("chest", -8 * imp, 0, -12 * imp); P.rot("neck", -12 * imp)

def rider_sword(t, P):
    """sword drawn, cutting down at a man on foot on his right front (contact 0.45)."""
    A.ride_base(P, lean=4)
    up = (V(-0.30, 0.00, 1.90), (-130, 0, -10)); cut = (V(-0.52, -0.36, 1.06), (32, 0, -18)); rd = (V(-0.26, -0.22, 1.40), (-40, 0, -6))
    f, r = trak(t, [(0.0, rd), (0.3, up), (0.47, cut), (0.6, cut), (1.0, rd)])
    k = keys(t, [(0.3, 0.0), (0.47, 1.0), (0.6, 1.0), (1.0, 0.0)])
    P.rot("spine", 6 * k, -8 * k, -10 * k); P.rot("chest", 6 * k, -10 * k, -12 * k); P.rot("neck", 10 * k, 0, -20 * k)
    place_hand(P, "R", f + V(0, 0, A.SEAT_DROP), r, POLE_R)

def rider_sword_ready(t, P):
    A.ride_base(P, lean=4); breathe(P, t)
    place_hand(P, "R", V(-0.26, -0.22, 1.40 + A.SEAT_DROP + 0.012 * s(t)), (-40, 0, -6), POLE_R)

def rider_bash(t, P):
    """shield swung into a man on his left, the body behind it (contact 0.4)."""
    k = keys(t, [(0.0, 0.0), (0.22, -0.4), (0.4, 1.0), (0.55, 1.0), (1.0, 0.0)])
    A.ride_base(P, lean=6)
    if k < 0: shield_pose(P, SH_RIDE, SH_CARRY, -k)
    else: shield_pose(P, SH_RIDE, (AA._nrm(0.75, -0.62, 0.35), AA._nrm(0.0, 0.1, 1.0), (0.42, -0.24, 1.26)), k)
    P.rot("spine", 0, 10 * max(0, k), 14 * max(0, k)); P.rot("chest", 0, 8 * max(0, k), 14 * max(0, k))
    ride_lance(P, 0.0)

def rider_hit(t, P):
    imp = keys(t, [(0.0, 0.2), (0.1, 1.0), (0.4, 0.6), (1.0, 0.0)])
    A.ride_base(P); ride_lance(P, 0.0)
    P.rot("spine", -10 * imp, 6 * imp, -8 * imp); P.rot("chest", -8 * imp, 0, -10 * imp); P.rot("neck", -14 * imp); P.rot("head", -10 * imp)

def rider_strike_spear(t, P):
    """(hobelars) the spear driven down overhand at a man on foot (contact 0.5)."""
    A.ride_strike(t, P)

KNIGHT_FOOT, _m = combat_clips(G_SWORD_SHIELD)
KNIGHT = {
    "idle": (16, 6.0, True, lambda t, P: (stand(P, t, 0.8), AA.sword_ready(P), A.shield_guard(P, 0.3)), None),
    "walk": (16, 14.5, True, lambda t, P: (walk_legs(P, t, A=19, knee=48), AA.sword_ready(P), A.shield_guard(P, 0.3)), 1.25),
    "run": (12, 17.0, True, AA.maa_run, 3.00),
    **KNIGHT_FOOT,
    **shared_clips(_ready_sword_shield),
    "ride": (16, 6.0, True, rider_idle, None),
    "ride_gallop": (8, 10.0, True, rider_gallop, None),
    "ride_charge": (8, 10.0, True, rider_charge, None),
    "ride_lower": (8, 5.0, False, rider_lower, None),
    "ride_impact": (8, 10.0, False, rider_impact, None),
    "ride_strike": (10, 10.0, False, rider_sword, None),
    "ride_sword": (10, 10.0, False, rider_sword, None),
    "ride_ready": (12, 6.0, True, rider_sword_ready, None),
    "ride_bash": (8, 10.0, False, rider_bash, None),
    "ride_hit": (8, 11.0, False, rider_hit, None),
}
CLIP_META["knight"] = dict(_m, ride_strike={"hit": 0.47}, ride_sword={"hit": 0.47}, ride_bash={"hit": 0.4}, ride_impact={"hit": 0.12})
A.FAMILIES["knight"] = KNIGHT

# hobelars (family "rider"): spear and round shield on foot, spear in the saddle
R = A.FAMILIES["rider"]
register("rider", {"": G_SPEAR_SHIELD}, _ready_spear_shield)
R.update({
    "ride_gallop": (8, 10.0, True, lambda t, P: (A.ride_base(P, lean=12), A.spear_carry_r(P)), None),
    "ride_lower": (8, 5.0, False, lambda t, P: (A.ride_base(P, lean=6 + 10 * ease(t)), A.rider_charge(1.0, P) if t > 0.99 else None), None),
    "ride_strike": (12, 12.0, False, A.rider_strike, None),
    "ride_bash": (8, 10.0, False, rider_bash, None),
    "ride_hit": (8, 11.0, False, rider_hit, None),
})
CLIP_META["rider"]["ride_strike"] = {"hit": 0.5}; CLIP_META["rider"]["ride_bash"] = {"hit": 0.4}
