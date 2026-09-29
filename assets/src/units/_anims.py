"""HIGHGROUND units — animation clips as pose FUNCTIONS of normalised time t in [0, 1).

Every clip is sampled at `frames` evenly spaced times and baked into the vertex-animation texture
(tools/vat_bake.py); the engine lerps between baked frames. Keep them short and simple.

Rotation convention (armature axes; the man faces -Y, his left is +X):
    x  > 0  swings a limb BACKWARD / flexes knee / bends the spine FORWARD
    x  < 0  swings a limb FORWARD / flexes the elbow
    P.arm(side, bone, x, abd, internal): abd > 0 lifts the arm out sideways, internal > 0 turns it in
    hand x > 0 tips whatever the fist holds DOWN at its business end (-Y end in rest)
Each bone's rotation is relative to its parent (FK). P.move() shifts the root (metres, armature axes).
P.ik = 0..1 pulls the LEFT hand onto the ik_grip point on the right-hand tool (two-handed grips);
P.grip = distance (m) from the right fist along the tool to where the left hand holds.
"""
import math
from mathutils import Vector, Euler

TAU = 2 * math.pi
def s(t): return math.sin(TAU * t)
def c(t): return math.cos(TAU * t)
def ease(x): x = max(0.0, min(1.0, x)); return x * x * (3 - 2 * x)
def seg(t, a, b): return ease((t - a) / (b - a)) if b > a else float(t >= a)
def lerp(a, b, t): return a + (b - a) * t
def keys(t, ks):
    """piecewise-eased keyframes: ks = [(t, value), ...] (value may be a tuple)."""
    if t <= ks[0][0]: return ks[0][1]
    for (t0, v0), (t1, v1) in zip(ks, ks[1:]):
        if t <= t1:
            k = ease((t - t0) / (t1 - t0))
            if isinstance(v0, tuple): return tuple(lerp(a, b, k) for a, b in zip(v0, v1))
            return lerp(v0, v1, k)
    return ks[-1][1]


class Pose:
    def __init__(self):
        self.r = {}; self.loc = Vector((0, 0, 0)); self.ik = 0.0; self.grip = 0.40
    def rot(self, bone, x=0.0, y=0.0, z=0.0):
        a = self.r.get(bone, [0.0, 0.0, 0.0]); a[0] += x; a[1] += y; a[2] += z; self.r[bone] = a
    def arm(self, side, bone, x=0.0, abd=0.0, internal=0.0):
        sg = 1 if side == "L" else -1
        self.rot(f"{bone}.{side}", x, -abd * sg, -internal * sg)
    def leg(self, side, thigh=0.0, knee=0.0, foot=0.0, abd=0.0):
        sg = 1 if side == "L" else -1
        self.rot(f"thigh.{side}", thigh, -abd * sg, 0)
        self.rot(f"shin.{side}", knee)
        self.rot(f"foot.{side}", foot)
    def move(self, x=0.0, y=0.0, z=0.0): self.loc += Vector((x, y, z))
    def quats(self):
        return {b: Euler([math.radians(v) for v in a], "XYZ").to_quaternion() for b, a in self.r.items()}


# ----------------------------------------------------------------------------- shared body motions
def breathe(P, t, amp=1.0):
    P.rot("chest", 2.5 - 1.2 * amp * s(t)); P.rot("neck", 4 + 0.8 * amp * s(t))  # a working man's slight stoop

def walk_legs(P, t, A=21.0, knee=52.0, bob=0.020, lean=3.0):
    """t=0: left heel strike. Knees flex through swing; pelvis bobs and rolls."""
    for side, ph in (("L", t), ("R", t + 0.5)):
        th = -A * c(ph)
        sw = max(0.0, s(ph - 0.5)) ** 1.4                  # swing phase (ph in 0.5..1)
        ld = max(0.0, s(ph * 2)) * (ph % 1 < 0.5) * 0.35   # loading response
        kn = 6 + knee * sw + 14 * ld
        ft = -th * 0.55 - kn * 0.62 + 12 * seg(ph % 1, 0.35, 0.5) * (1 - seg(ph % 1, 0.5, 0.62))
        P.leg(side, th, kn, ft)
    P.move(z=-bob * c(2 * t) - 0.012)
    P.rot("pelvis", 0, 2.5 * c(t), 4.0 * s(t))
    P.rot("spine", lean * 0.5, -1.2 * c(t), -3.0 * s(t))
    P.rot("chest", lean * 0.5, 0, -2.5 * s(t))

def run_legs(P, t, A=36.0, knee=95.0, lean=11.0):
    for side, ph in (("L", t), ("R", t + 0.5)):
        th = -A * c(ph) - 6
        sw = max(0.0, s(ph - 0.5)) ** 1.1
        kn = 18 + knee * sw
        ft = -th * 0.5 - kn * 0.45
        P.leg(side, th, kn, ft)
    P.move(z=0.035 * -c(2 * t) - 0.05)
    P.rot("pelvis", lean * 0.6, 3 * c(t), 7 * s(t))
    P.rot("spine", lean * 0.4, 0, -5 * s(t))
    P.rot("chest", lean * 0.2, 0, -5 * s(t))
    P.rot("neck", -lean * 0.8)

def swing_arm(P, side, t, amp=16.0, bend=14.0):
    ph = t if side == "R" else t + 0.5          # arms swing against the legs
    P.arm(side, "upperarm", amp * c(ph) + 2, 6, 0)
    P.arm(side, "forearm", -bend - 0.6 * amp * max(0, -c(ph)), 0, 0)

def fall_body(P, t, back=True):
    """buckle at the knees, then topple onto the back (or face) and lie still."""
    k = seg(t, 0.0, 0.35); f = seg(t, 0.2, 0.92); land = seg(t, 0.85, 1.0)
    sg = -1 if back else 1
    P.move(z=-0.26 * k * (1 - f))
    P.rot("root", sg * 86 * f)
    P.move(z=0.115 * f if back else 0.10 * f)
    for side in ("L", "R"):
        P.leg(side, lerp(-34 * k, -8, f), lerp(66 * k, 14, f), lerp(-20 * k, 30, f), abd=4 + 6 * f)
    P.rot("spine", lerp(10 * k, -4, f) * (1 if back else -1))
    P.rot("neck", lerp(-8, 12 * sg * -1, f))
    for side in ("L", "R"):
        P.arm(side, "upperarm", lerp(-20 * k, -10 if back else -150, f), lerp(12, 55, f), 0)
        P.arm(side, "forearm", lerp(-40 * k, -20, f), 0, 0)
    P.rot("head", 0, 0, 25 * land)


# ----------------------------------------------------------------------------- spear family (spear + shield)
def spear_carry(P, t=0.0):
    """spear upright in the right fist at elbow height; heater shield on the left forearm, carried at the front."""
    P.arm("R", "upperarm", -6, 10, 4)
    P.arm("R", "forearm", -84, 0, 0)
    P.rot("hand.R", -2)
    shield_guard(P, 0.2)

def shield_guard(P, raise_=0.0):
    """the shield on the left forearm, from the carry at his left side (0) to the guard before him (1).
    Solved by _arms_anims.place_shield from world carriages (the shield never crosses his body)."""
    import _arms_anims as AA
    AA.shield_pose(P, AA.SH_CARRY, AA.SH_GUARD, max(0.0, min(1.0, raise_)))

def shield_ride(P, k=0.0):
    """mounted: shield on the left side over the thigh, clear of the horse's neck (k -> 1: brought forward)."""
    import _arms_anims as AA
    AA.shield_pose(P, AA.SH_RIDE, AA.SH_GUARD, k)

def spear_level(P):
    """spear couched at the hip, point forward (underhand), shield up."""
    P.arm("R", "upperarm", 18, 14, 0)
    P.arm("R", "forearm", -36, 0, 0)
    P.rot("hand.R", 14)
    shield_guard(P, 0.7)

def spear_idle(t, P):
    breathe(P, t); spear_carry(P)
    P.move(x=0.008 * s(t)); P.rot("pelvis", 0, 1.3 * s(t)); P.rot("spine", 0, -1.3 * s(t))
    P.leg("L", -2, 4, -2, 2); P.leg("R", 2, 3, -3, 3)
    P.rot("neck", 0, 0, 6 * s(t * 1.0 + 0.2) * seg(abs(s(t)), 0.2, 0.9))

def spear_walk(t, P):
    walk_legs(P, t); spear_carry(P)
    P.arm("R", "upperarm", 3 * c(t)); P.arm("L", "upperarm", -3 * c(t))

def spear_run(t, P):
    run_legs(P, t, A=33, knee=88, lean=10); spear_level(P)
    P.arm("R", "upperarm", 6 * c(t)); P.arm("L", "upperarm", -5 * c(t))

def spear_strike(t, P):
    """guard -> draw back -> thrust -> recover, in a braced stance, left foot forward."""
    P.leg("L", -18, 16, 2, 4); P.leg("R", 16, 8, -8, 6)
    P.move(z=-0.035)
    k = keys(t, [(0, 0.0), (0.25, -0.35), (0.42, 1.0), (0.55, 1.0), (1.0, 0.0)])
    P.arm("R", "upperarm", lerp(22, -38, (k + 0.35) / 1.35) if k >= 0 else lerp(22, 34, -k / 0.35), 14, 0)
    P.arm("R", "forearm", lerp(-44, -6, max(0, k)), 0, 0)
    P.rot("hand.R", lerp(18, 34, max(0, k)))
    P.rot("pelvis", 0, 0, 10 - 18 * max(0, k) + 6 * min(0, k))
    P.rot("chest", 4 + 8 * max(0, k), 0, 8 - 16 * max(0, k))
    P.move(y=-0.06 * max(0, k))
    shield_guard(P, 0.85)
    P.rot("neck", -4, 0, -6 + 10 * max(0, k))


# ----------------------------------------------------------------------------- tool family (villagers)
def tool_shoulder(P):
    """tool shouldered: right fist at the shoulder, haft over it, head behind."""
    P.arm("R", "upperarm", -24, 20, -4)
    P.arm("R", "forearm", -118, 0, 0)
    P.rot("hand.R", -12)

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

def _chop(P, t, low=0.0, twist=1.0):
    """two-handed overhead chop: raise, strike down to the front, recover. low=1 ends at the ground."""
    k = keys(t, [(0.0, 0.0), (0.38, 1.0), (0.55, 1.0), (0.66, -0.25), (0.78, -0.2), (1.0, 0.0)])
    up = max(0.0, k); dn = max(0.0, -k) * 4
    P.ik = 1.0; P.grip = lerp(0.32, 0.36, up) - 0.16 * dn  # the front hand slides down the haft on the blow
    P.arm("R", "upperarm", lerp(-45, -150, up) + lerp(0, -6 + 10 * low, dn), 10, lerp(35, 10, up))
    P.arm("R", "forearm", lerp(-35, -85, up) + lerp(0, 25, dn), 0, 0)
    P.rot("hand.R", lerp(30, -10, up) + lerp(0, 2 + 6 * low, dn))
    P.rot("spine", lerp(12, -6, up) + lerp(0, 20 + 14 * low, dn), 0, twist * lerp(-10, 6, up) - 6 * dn)
    P.rot("chest", lerp(6, -4, up) + lerp(0, 10 + 6 * low, dn), 0, twist * lerp(-8, 5, up) - 6 * dn)
    P.rot("neck", lerp(-10, 4, up) + lerp(0, -16, dn))
    P.leg("L", -16 - 6 * dn * low, 16 + 10 * dn * low, 0, 5); P.leg("R", 14, 10 + 8 * dn * low, -6, 7)
    P.move(z=-0.03 - 0.04 * dn * low)

def tool_work_hoe(t, P): _chop(P, t, low=1.0, twist=0.4)
def tool_work_axe(t, P): _chop(P, t, low=0.2, twist=1.2)

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

def fall(t, P):
    fall_body(P, t, back=True)


# ----------------------------------------------------------------------------- riders (seat at the origin)
# Mounted clips are authored with the SADDLE SEAT POINT at the model origin: the pelvis joint sits
# 0.10 m above it (docs/units-horse.md). The horse's per-frame seat track supplies all the bounce,
# pitch and roll, so these stay nearly still. The engine puts the rider's origin on that seat point.
SEAT_DROP = -(0.94 - 0.10)

# The seat of the 13th-14th c. man-at-arms: long leathers, the legs nearly straight and braced a little forward,
# the thighs splayed round the barrel and the lower legs hanging down its flanks, the ball of the foot in the iron.
# The ankle target is in the seat frame (the rider faces -Y, his left is +X, z up from the seat point), fitted to
# the horse each arm rides: the horse's stirrup irons are hung where these feet land (assets/src/units/_horse_geo.py
# Tack.saddle, STIRRUP), so rider and horse agree. A recipe sets RIDE_FIT for its horse (knights: the destrier).
RIDE_FITS = {
    "destrier": {"ankle": (0.405, -0.06, -0.625), "pole": (0.65, -1.0, 0.0), "toe_out": 10.0},
    "light": {"ankle": (0.285, -0.06, -0.655), "pole": (0.35, -1.0, 0.0), "toe_out": 8.0},
}
RIDE_FIT = RIDE_FITS["light"]

def ride_legs(P, lean=0.0):
    import _arms_anims as AA
    f = RIDE_FIT
    for side, sg in (("L", 1), ("R", -1)):
        ax, ay, az = f["ankle"]; px, py, pz = f["pole"]
        AA.place_foot(P, side, Vector((sg * ax, ay - 0.0015 * lean, az)), (sg * px, py, pz), (-8.0, 0.0, sg * f["toe_out"]))

def ride_base(P, lean=0.0):
    P.move(z=SEAT_DROP)
    P.rot("pelvis", -6 + lean * 0.3); P.rot("spine", 4 + lean * 0.4); P.rot("chest", 2 + lean * 0.3); P.rot("neck", -lean * 0.6)
    ride_legs(P, lean)
    shield_ride(P, 0.0)                                   # left arm: shield on the left side, reins in the fist

def rider_idle(t, P):
    ride_base(P); breathe(P, t); spear_carry_r(P)
    P.rot("neck", 0, 0, 7 * s(t + 0.1))

def spear_carry_r(P):
    P.arm("R", "upperarm", -4, 12, 4); P.arm("R", "forearm", -86, 0, 0)

def rider_charge(t, P):
    """weapon levelled / lance couched under the right arm, crouched forward over the neck."""
    ride_base(P, lean=16)
    P.arm("R", "upperarm", 20, 16, 0); P.arm("R", "forearm", -44, 0, 0); P.rot("hand.R", 22 + 2 * s(t))
    P.rot("spine", 1.5 * s(t * 2))

def rider_strike(t, P):
    """stabbing down at men on foot: draw up, drive the point forward-down, recover."""
    ride_base(P, lean=6)
    k = keys(t, [(0.0, 0.0), (0.3, -0.4), (0.5, 1.0), (0.62, 1.0), (1.0, 0.0)])
    up = max(0.0, -k) / 0.4; dn = max(0.0, k)
    P.arm("R", "upperarm", lerp(0, -70, up) + lerp(0, -40, dn), 20, 0)
    P.arm("R", "forearm", lerp(-50, -80, up) + lerp(0, 30, dn), 0, 0)
    P.rot("hand.R", lerp(30, 20, up) + lerp(0, 55, dn))
    P.rot("chest", 6 * dn, 0, 10 * up - 14 * dn); P.rot("spine", 8 * dn)

RIDER = {
    "idle": (16, 6.0, True, spear_idle, None),
    "walk": (16, 14.5, True, spear_walk, 1.30),
    "run": (12, 17.0, True, spear_run, 3.40),
    "strike": (12, 12.0, True, spear_strike, None),
    "fall": (12, 12.0, False, lambda t, P: (spear_carry(P), fall(t, P)), None),
    "ride": (16, 6.0, True, rider_idle, None),
    "ride_charge": (8, 10.0, True, rider_charge, None),
    "ride_strike": (12, 12.0, True, rider_strike, None),
}


# ----------------------------------------------------------------------------- registry
# name: (frames, fps, loop, fn, nominal ground speed m/s or None)
FAMILIES = {
    "spear": {
        "idle": (16, 6.0, True, spear_idle, None),
        "walk": (16, 14.5, True, spear_walk, 1.30),
        "run": (12, 17.0, True, spear_run, 3.40),
        "strike": (12, 12.0, True, spear_strike, None),
        # from the upright carry the spear topples with him and ends lying along the body, not sticking up
        "fall": (12, 12.0, False, lambda t, P: (spear_carry(P), fall(t, P)), None),
    },
    "rider": RIDER,
    "tool": {
        "idle": (16, 6.0, True, tool_idle, None),
        "walk": (16, 14.5, True, tool_walk, 1.30),
        "run": (12, 17.0, True, tool_run, 3.00),
        "strike": (12, 12.0, True, tool_strike, None),
        "work_hoe": (16, 12.0, True, tool_work_hoe, None),
        "work_axe": (16, 13.0, True, tool_work_axe, None),
        "fall": (12, 12.0, False, lambda t, P: (tool_shoulder(P), fall(t, P)), None),
    },
}
