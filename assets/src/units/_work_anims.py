"""HIGHGROUND units — the villagers' clip family "tool": job work clips, each with its own tool in hand.

Importing this module REPLACES _anims.FAMILIES["tool"]. Same contract as _anims.py (pose functions of t).

Every hand on a tool is put there EXACTLY (analytic two-bone IK, _arms_anims.place_hand), never by the old
wrist-onto-a-point IK constraint (P.ik), which left the off hand floating beside the haft:
    tool_pose(P, fist, rot)            the right fist (the tool is weighted to hand.R) at a world point, the tool
                                       at world rotation rot = (pitch, roll, yaw) degrees, Euler XYZ, armature axes:
                                       (0,0,0) = haft forward (-Y), head side down (-Z); pitch > 0 tips the head
                                       down, yaw > 0 swings it to his left (+X), roll tilts the swing plane.
    grip(P, fist, rot, along)          ... and the left fist `along` metres up the haft (negative: toward the butt),
                                       its grip axis on the haft and its wrist rolled toward his left shoulder.
    fist_at_tip(tip, rot, L, h)        the fist position that puts the tool's working point (L along the haft,
                                       h to the head side) on a world point: tools strike the ground exactly.
P.err collects the fists' misses (metres) per frame; `tools/vat_bake.py <arm> gripcheck nobake` prints them.
"""
import math
import _anims as A
from _anims import s, c, seg, keys, lerp, ease, breathe, walk_legs, run_legs, swing_arm
from _arms_anims import place_hand, world, set_world_rot, blend_hand_world, stand, left_hang, _HEAD
import _human as H
from mathutils import Euler, Quaternion, Vector

def Q(rot): return Euler([math.radians(v) for v in rot], "XYZ").to_quaternion()
def deg(q): return tuple(math.degrees(v) for v in q.to_euler("XYZ"))
FIST_OFF = {sd: H.fist(sd) - _HEAD[f"hand.{sd}"] for sd in ("L", "R")}

def fist_world(P, side):
    p, r = world(P, f"hand.{side}"); return p + r @ FIST_OFF[side]

def _miss(P, side, target):
    e = (fist_world(P, side) - Vector(target)).length
    if not hasattr(P, "err"): P.err = []
    P.err.append(round(e, 3))

def tool_pose(P, fist, rot, pole=(-1, 0.35, -0.5)):
    place_hand(P, "R", fist, rot, pole); _miss(P, "R", fist)

def hand_on(P, side, pos, q_axis, pole=None):
    """a fist at pos gripping along the world axis of quaternion q_axis (its rest Y), the wrist rolled toward
    the shoulder (so the forearm comes into the fist naturally, no candy-wrapper twist)."""
    d = q_axis @ Vector((0, -1, 0))
    sh = world(P, f"upperarm.{side}")[0]
    want = sh - Vector(pos); want -= d * want.dot(d)
    cur = q_axis @ Vector((0, 0, 1)); cur -= d * cur.dot(d)
    q = q_axis
    if want.length > 1e-6 and cur.length > 1e-6:
        want.normalize(); cur.normalize()
        ang = math.atan2(cur.cross(want).dot(d), cur.dot(want))
        q = Quaternion(d, ang) @ q_axis
    place_hand(P, side, pos, deg(q), pole or ((1, 0.35, -0.5) if side == "L" else (-1, 0.35, -0.5)))
    _miss(P, side, pos)

def resolve_offhand(P):
    """the old two-handed grip (P.ik > 0, P.grip metres up the right-hand weapon) solved EXACTLY: the left fist on
    the haft with its grip axis along it, instead of Blender's IK constraint, which only put the WRIST on that point
    (the fist floated 6-20 cm off the haft). tools/vat_bake.py calls this for every pose of every unit; P.ik < 1
    blends the arm toward its FK pose (a hand letting go)."""
    k = P.ik
    if k <= 0: return
    pr, qr = world(P, "hand.R")
    bones = ("upperarm.L", "forearm.L", "hand.L")
    old = {b: Q(P.r.get(b, [0.0, 0.0, 0.0])) for b in bones}
    n0 = len(getattr(P, "err", []))
    best = None
    # out of reach at the authored grip? the hand slides along the haft to the nearest point it can hold
    for d in [0.0] + [sg * 0.02 * i for i in range(1, 16) for sg in (1, -1)]:
        hand_on(P, "L", pr + qr @ FIST_OFF["R"] + qr @ Vector((0, -(P.grip + d), 0)), qr)
        e = P.err.pop()
        if best is None or e < best[0] - 1e-4: best = (e, d)
        if e < 0.005: break
    hand_on(P, "L", pr + qr @ FIST_OFF["R"] + qr @ Vector((0, -(P.grip + best[1]), 0)), qr)
    del P.err[n0:-1]
    if k < 1:
        for b in bones: P.r[b] = list(deg(old[b].slerp(Q(P.r[b]), k)))
    P.ik = 0.0

def grip(P, fist, rot, along, pole_r=(-1, 0.35, -0.5), pole_l=(1, 0.35, -0.5)):
    tool_pose(P, fist, rot, pole_r)
    q = Q(rot); d = q @ Vector((0, -1, 0))
    hand_on(P, "L", Vector(fist) + d * along, q, pole_l)

def fist_at_tip(tip, rot, L, h):
    q = Q(rot); return Vector(tip) - q @ Vector((0, -L, 0)) - q @ Vector((0, 0, -h))

def chest_pt(P, rest_pt):
    """a point riding on the chest (rest armature coords) -> world under pose P."""
    p, r = world(P, "chest"); return p + r @ (Vector(rest_pt) - _HEAD["chest"])

ANKLE_Z = H.J["ankle"][2]

def body(P, bend=0.0, chest=0.0, neck=None, knee=0.0, hinge=0.0, twist=0.0, lead=1.0, drop=0.0):
    """working stance: left foot forward (lead), knees flexed by `knee`, a hip hinge (the pelvis pitched forward,
    the thighs held where they were), spine/chest bent forward, head up. Feet flat, and the root dropped so the
    lower ankle stays at its rest height: no foot sinks into the ground however deep the crouch."""
    P.rot("pelvis", hinge, 0, twist * 0.35)
    for sd, th, kn, ab in (("L", -16 * lead - knee * 0.55, 12 + knee, 6), ("R", 12 * lead - knee * 0.35, 10 + knee * 0.9, 8)):
        P.leg(sd, th - hinge, kn, -(th + kn), ab)
    P.rot("spine", bend, 0, twist * 0.35)
    P.rot("chest", chest, 0, twist * 0.3)
    P.rot("neck", -(bend + chest + hinge) * 0.4 if neck is None else neck)
    low = min(world(P, "foot.L")[0].z, world(P, "foot.R")[0].z)
    P.move(z=ANKLE_Z - low - drop)


# ============================================================================== carrying (idle / walk / run)
def tool_shoulder(P):
    """tool shouldered: right fist at the shoulder, haft over it, head behind."""
    P.arm("R", "upperarm", -24, 20, -4); P.arm("R", "forearm", -118, 0, 0); P.rot("hand.R", -12)

def tool_idle(t, P):
    breathe(P, t); tool_shoulder(P)
    P.arm("L", "upperarm", 2, 5, 0); P.arm("L", "forearm", -12)
    P.move(x=0.01 * s(t)); P.rot("pelvis", 0, 1.8 * s(t)); P.rot("spine", 2, -1.5 * s(t))
    P.leg("L", -1, 3, -2, 2); P.leg("R", 3, 6, -4, 3)
    P.rot("neck", 2, 0, 8 * s(t + 0.15))

def tool_walk(t, P):
    walk_legs(P, t, A=20, knee=50, lean=4); tool_shoulder(P); swing_arm(P, "L", t, 17, 16)
    P.arm("R", "upperarm", 2 * c(t))

def tool_run(t, P):
    run_legs(P, t, A=34, knee=90, lean=12); swing_arm(P, "L", t, 34, 70)
    P.arm("R", "upperarm", -26 + 8 * c(t), 10, 8); P.arm("R", "forearm", -110)

def hand_carry(P, t=0.0, amp=0.0):
    """a small tool (mallet, sickle) or nothing in the hanging right hand, head forward-down."""
    P.arm("R", "upperarm", 2 + amp * c(t), 9, 0); P.arm("R", "forearm", -22 - 0.5 * amp * max(0, -c(t)))
    P.rot("hand.R", 48)

def idle_hand(t, P):
    stand(P, t); hand_carry(P); left_hang(P)

def walk_hand(t, P):
    walk_legs(P, t, A=20, knee=50, lean=3); hand_carry(P, t, 15); swing_arm(P, "L", t, 16, 15)

def pail_hang(P, t=0.0, sw=0.0):
    """the pail hanging from the right fist, held out from the leg, kept upright."""
    P.arm("R", "upperarm", 1 + sw * c(t), 21, 0); P.arm("R", "forearm", -6)
    set_world_rot(P, "hand.R", Q((sw * 0.4 * c(t), 0, 0)))

def idle_pail(t, P):
    stand(P, t, 0.8); P.rot("spine", 0, 3); pail_hang(P)
    P.arm("L", "upperarm", 3, 14, 0); P.arm("L", "forearm", -16)

def walk_pail(t, P):
    walk_legs(P, t, A=19, knee=48, lean=3); P.rot("spine", 0, 4); P.rot("chest", 0, 2)
    pail_hang(P, t, 5); P.arm("L", "upperarm", 18 * c(t + 0.5), 16, 0); P.arm("L", "forearm", -22)

def walk_carry(t, P):
    """a sack over the right shoulder (weighted to the chest), the right hand holding its neck."""
    walk_legs(P, t, A=19, knee=50, lean=7); P.rot("chest", 3, -3); P.rot("neck", 2, 0, -5)
    swing_arm(P, "L", t, 18, 16)
    hand_on(P, "R", chest_pt(P, (-0.185, -0.265, 1.40)), world(P, "chest")[1] @ Q((-10, 0, 80)), (-0.6, 0.2, -0.9))

def idle_talk(t, P):
    """talking: the right hand gesturing, left fist on the hip, head nodding along."""
    stand(P, t, 1.2)
    g = s(2 * t) * 0.6 + s(3 * t + 0.2) * 0.4
    P.arm("R", "upperarm", -22 - 8 * g, 18, 12); P.arm("R", "forearm", -78 - 16 * g, 0, 0)
    P.rot("hand.R", -20 + 25 * s(2 * t + 0.3), 0, 20 * s(4 * t))
    P.arm("L", "upperarm", 4, 38, -24); P.arm("L", "forearm", -104, 0, 0); P.rot("hand.L", 30)
    P.rot("neck", 4 + 5 * s(2 * t + 0.1), 0, 10 * s(t))
    P.rot("chest", 0, 0, 4 * s(t))

def tool_strike(t, P):
    """one-handed overarm blow with the tool, left arm up to fend."""
    k = keys(t, [(0.0, 0.0), (0.35, 1.0), (0.5, -0.3), (0.62, -0.3), (1.0, 0.0)])
    up = max(0.0, k); dn = max(0.0, -k) / 0.3
    P.arm("R", "upperarm", lerp(-50, -160, up) + 60 * dn, 20, 10)
    P.arm("R", "forearm", lerp(-50, -80, up) + 40 * dn, 0, 0)
    P.rot("hand.R", lerp(20, -30, up) + 50 * dn)
    P.rot("spine", 6 * dn - 4 * up, 0, lerp(-5, 12, up) - 18 * dn)
    P.arm("L", "upperarm", -40, 25, 30); P.arm("L", "forearm", -70)
    P.leg("L", -18, 18, 0, 5); P.leg("R", 14, 10, -6, 7)
    P.move(z=-0.03)

def tool_fall(t, P):
    k = seg(t, 0.0, 0.3)
    P.arm("R", "upperarm", -24 * (1 - k), 20 * (1 - k), -4 * (1 - k)); P.arm("R", "forearm", -118 * (1 - k) - 20 * k)
    A.fall(t, P)
    blend_hand_world(P, "R", (0, 0, 150), seg(t, 0.35, 0.95))


# ============================================================================== work clips
def _k(t, ks): return keys(t, ks)
# Key times are multiples of 1/frames: the engine only lerps between baked frames, so a blow keyed between two
# frames would never be seen landing.

# ---- hoe (field work, growing): raise, chop the blade into the soil ahead, draw it back, lift
HOE_L, HOE_H = 1.38, 0.18                  # fist -> blade root along the haft; blade root -> edge (head side)
def work_hoe(t, P):
    stroke = _k(t, [(0.0, 0.0), (5 / 16, 1.0), (9 / 16, 1.0), (12 / 16, 0.3), (1.0, 0.0)])
    body(P, bend=6 + 8 * stroke, chest=4 + 4 * stroke, hinge=10 + 16 * stroke, knee=10 + 8 * stroke, twist=-6)
    # (fist x, y, z, pitch, yaw, left hand up the haft)
    up = (-0.13, -0.16, 1.16, -38.0, 8.0, 0.42)
    hit_rot = (34.0, 0.0, 8.0); hit = fist_at_tip((0.04, -1.20, 0.0), hit_rot, HOE_L, HOE_H)
    drag_rot = (40.0, 0.0, 8.0); drag = fist_at_tip((0.04, -0.98, 0.0), drag_rot, HOE_L, HOE_H)
    k = _k(t, [(0.0, up), (5 / 16, (hit.x, hit.y, hit.z, 34.0, 8.0, 0.36)), (9 / 16, (drag.x, drag.y, drag.z, 40.0, 8.0, 0.34)),
               (12 / 16, (-0.12, -0.10, 1.02, 12.0, 8.0, 0.38)), (1.0, up)])
    grip(P, k[:3], (k[3], 0.0, k[4]), k[5])

# ---- felling axe (gather timber / firewood): wind up over the right shoulder, diagonal chop down to the left
def work_axe(t, P):
    k = _k(t, [(0.0, 0.2), (5 / 14, -1.0), (7 / 14, 1.0), (8 / 14, 0.9), (1.0, 0.2)])   # -1 wound up .. 1 struck
    wind, hit = max(0.0, -k), max(0.0, k)
    body(P, bend=4 - 4 * wind + 10 * hit, chest=2 + 6 * hit, hinge=2 - 2 * wind + 18 * hit, knee=8 + 14 * hit, twist=-22 * wind + 18 * hit)
    top = (-0.26, 0.02, 1.62, -118.0, -34.0, -8.0)       # over the right shoulder
    bite = (0.0, -0.40, 0.90, 40.0, -38.0, 30.0)         # the bite: forward-left, low on the trunk, edge leading
    free = (-0.04, -0.34, 0.96, 26.0, -36.0, 24.0)       # worked free
    v = _k(t, [(0.0, free), (5 / 14, top), (7 / 14, bite), (8 / 14, bite), (1.0, free)])
    grip(P, v[:3], (v[3], v[4], v[5]), -0.11)

# ---- pick (stone / ore / silver / gold / clay): overhead, the point driven into the ground ahead
PICK_L, PICK_H = 0.70, 0.29
def work_pick(t, P):
    k = _k(t, [(0.0, 0.0), (5 / 14, -1.0), (7 / 14, 1.0), (9 / 14, 1.0), (1.0, 0.0)])
    wind, hit = max(0.0, -k), max(0.0, k)
    body(P, bend=6 - 6 * wind + 12 * hit, chest=2 - 4 * wind + 6 * hit, hinge=2 - 4 * wind + 22 * hit, knee=10 + 18 * hit)
    hr = (44.0, 0.0, 4.0); hf = fist_at_tip((0.0, -0.84, 0.03), hr, PICK_L, PICK_H)
    rest_ = (-0.10, -0.30, 1.06, 10.0, 4.0)
    top = (-0.08, 0.02, 1.80, -112.0, 4.0)
    v = _k(t, [(0.0, rest_), (5 / 14, top), (7 / 14, (hf.x, hf.y, hf.z, 44.0, 4.0)), (9 / 14, (hf.x, hf.y + 0.02, hf.z + 0.03, 40.0, 4.0)), (1.0, rest_)])
    grip(P, v[:3], (v[3], 0.0, v[4]), -0.13)

# ---- builder: driving a post in with the two-handed beetle, overhead and down onto its top
from _work_kit import MALLET_FACE, STAKE, STAKE_TOP
MALLET_L = 0.66
def work_mallet(t, P):
    k = _k(t, [(0.0, 0.1), (5 / 12, -1.0), (6 / 12, 1.0), (7 / 12, 0.9), (1.0, 0.1)])   # -1 raised .. 1 struck
    wind, hit = max(0.0, -k), max(0.0, k)
    body(P, bend=4 - 6 * wind + 10 * hit, chest=2 - 4 * wind + 6 * hit, hinge=4 - 4 * wind + 16 * hit, knee=10 + 14 * hit, twist=-4)
    top = STAKE + Vector((0, 0, STAKE_TOP + 0.0))
    hr = (18.0, 0.0, 0.0); hf = fist_at_tip(top, hr, MALLET_L, MALLET_FACE)
    up = (-0.06, 0.02, 1.74, -128.0)
    ready = (hf.x - 0.02, hf.y + 0.10, hf.z + 0.14, -6.0)
    v = _k(t, [(0.0, ready), (5 / 12, up), (6 / 12, (hf.x, hf.y, hf.z, 18.0)), (7 / 12, (hf.x, hf.y + 0.01, hf.z + 0.02, 15.0)), (1.0, ready)])
    grip(P, v[:3], (v[3], 0.0, 0.0), -0.11)

# ---- reaper (field ripe) / forager: stooped, the left hand gathers a handful, the sickle cuts under it
def work_sickle(t, P):
    k = _k(t, [(0.0, 0.0), (4 / 16, 0.0), (8 / 16, 1.0), (10 / 16, 1.0), (13 / 16, 0.4), (1.0, 0.0)])   # the sweep
    lift = seg(t, 0.62, 0.82) * (1 - seg(t, 0.88, 1.0))
    body(P, bend=16, chest=10, hinge=54, knee=24, twist=-6 + 10 * k)
    lf = Vector((lerp(0.14, 0.10, k) + 0.06 * lift, -0.46 + 0.14 * lift, 0.50 + 0.40 * lift))
    hand_on(P, "L", lf, Q((80, 0, -70)), (1, 0.4, -0.2))
    v = _k(t, [(0.0, (-0.32, -0.40, 0.50, 20.0, -48.0)), (4 / 16, (-0.34, -0.36, 0.52, 20.0, -52.0)),
               (8 / 16, (-0.02, -0.44, 0.45, 12.0, 36.0)), (10 / 16, (0.02, -0.42, 0.46, 12.0, 40.0)),
               (13 / 16, (-0.20, -0.40, 0.50, 22.0, -10.0)), (1.0, (-0.32, -0.40, 0.50, 20.0, -48.0))])
    tool_pose(P, v[:3], (v[3], 0.0, v[4]), (-1, 0.4, -0.3))

# ---- fisher (fresh from a fishery): cast from over the shoulder, then wait, the tip nodding
def work_fish(t, P):
    stand(P, t, 0.6)
    P.leg("L", -10, 8, 0, 5); P.leg("R", 8, 6, -4, 6)
    cast = _k(t, [(0.0, 0.0), (2 / 16, -1.0), (4 / 16, 1.0), (6 / 16, 0.85), (1.0, 0.0)])
    back, fwd = max(0.0, -cast), max(0.0, cast)
    P.rot("spine", 2 - 4 * back + 6 * fwd, 0, -8 * back + 6 * fwd)
    wait = (-0.10, -0.30, 1.14, -22.0 + 3 * s(3 * t), 6.0)
    v = _k(t, [(0.0, wait), (2 / 16, (-0.14, -0.02, 1.40, -118.0, 0.0)), (4 / 16, (-0.08, -0.40, 1.26, -12.0, 6.0)),
               (6 / 16, (-0.09, -0.34, 1.18, -18.0, 6.0)), (1.0, wait)])
    grip(P, v[:3], (v[3], 0.0, v[4]), -0.30)

# ---- adept (mana at a ley site): kneeling, hands raised, a slow swell and ebb
def work_adept(t, P):
    sw = s(t); P.move(z=-0.44)
    P.leg("L", -88, 90, 0, 8)                      # left foot planted in front
    P.leg("R", -2, 96, 40, 6)                      # right knee on the ground, toes behind
    P.rot("pelvis", 2); P.rot("spine", -4 + 2 * sw); P.rot("chest", -4 + 3 * sw); P.rot("neck", -12 - 6 * sw)
    for sd, sg in (("L", 1), ("R", -1)):
        pos = Vector((sg * (0.20 + 0.03 * sw), -0.36, 1.22 + 0.07 * sw))
        hand_on(P, sd, pos, Q((-80, 0, 0)), (sg * 1, 0.3, -0.8))

# ---- firefighter: swing the pail back, heave it forward and up, the water goes over the fire
def work_bucket(t, P):
    k = _k(t, [(0.0, 0.0), (4 / 14, -1.0), (7 / 14, 1.0), (9 / 14, 1.0), (1.0, 0.0)])
    back, fwd = max(0.0, -k), max(0.0, k)
    body(P, bend=8 + 6 * back - 4 * fwd, chest=4 - 4 * fwd, hinge=8 + 14 * back - 6 * fwd, knee=14 + 14 * back, twist=-20 * back + 10 * fwd)
    low = (-0.10, -0.26, 1.02, 5.0, 0.0)
    v = _k(t, [(0.0, low), (4 / 14, (-0.16, 0.0, 0.90, -38.0, -8.0)), (7 / 14, (-0.06, -0.50, 1.36, 104.0, 6.0)),
               (9 / 14, (-0.06, -0.48, 1.32, 110.0, 6.0)), (1.0, low)])
    rot = (v[3], 0.0, v[4])
    tool_pose(P, v[:3], rot)
    q = Q(rot); on = seg(t, 4 / 14, 6 / 14) * (1 - seg(t, 10 / 14, 13 / 14))    # left hand: beside the right on the bail, then under the bottom
    hand_on(P, "L", Vector(v[:3]) + q @ Vector((0, lerp(0.065, 0.0, on), lerp(-0.02, -0.42, on))), q)


TOOL = {
    "idle": (16, 6.0, True, tool_idle, None),
    "walk": (16, 14.5, True, tool_walk, 1.30),
    "run": (12, 17.0, True, tool_run, 3.00),
    "strike": (12, 12.0, True, tool_strike, None),
    "fall": (12, 12.0, False, tool_fall, None),
    "idle_hand": (12, 6.0, True, idle_hand, None),
    "walk_hand": (16, 14.5, True, walk_hand, 1.30),
    "idle_talk": (16, 5.0, True, idle_talk, None),
    "idle_pail": (12, 5.0, True, idle_pail, None),
    "walk_pail": (16, 14.0, True, walk_pail, 1.20),
    "walk_carry": (16, 13.5, True, walk_carry, 1.15),
    "work_hoe": (16, 11.0, True, work_hoe, None),
    "work_axe": (14, 11.0, True, work_axe, None),
    "work_pick": (14, 10.0, True, work_pick, None),
    "work_mallet": (12, 10.0, True, work_mallet, None),
    "work_sickle": (16, 10.0, True, work_sickle, None),
    "work_fish": (16, 6.0, True, work_fish, None),
    "work_adept": (16, 4.0, True, work_adept, None),
    "work_bucket": (14, 10.0, True, work_bucket, None),
}
A.FAMILIES["tool"] = TOOL
