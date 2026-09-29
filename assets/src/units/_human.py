"""HIGHGROUND units — the base human, his kit, and the bake helpers every soldier shares.

A unit recipe (assets/src/units/<arm>.py) calls the builders here to assemble ONE rigged man out of
parts (body, garments, kit), each part a separate mesh with explicit skin weights and a PART id:
    part 0      = always drawn
    part 1..15  = optional kit the engine can switch on/off per man (shield, axe vs hoe, ...)
tools/vat_bake.py then joins the parts, unwraps, paints the textures (numpy, see _paint.py), bakes
AO in Cycles, decimates LOD1 and bakes every clip of _anims.py into a vertex-animation texture.

Conventions (docs/units-pipeline.md has the full contract):
  * 1 Blender unit = 1 m, Z up, the man faces -Y, stands on z = 0, reference height 1.72 m.
    Height variants (1.62-1.78 m) are a uniform instance scale in the engine.
  * His LEFT is +X (Blender .L).  Bones: root pelvis spine chest neck head, upperarm/forearm/hand .L/.R,
    thigh/shin/foot .L/.R  (18 deform bones)  +  ik_grip (child of hand.R) and ik_pole (non-deform).
  * Rest pose: standing, arms hanging, fists closed. A fist's GRIP AXIS runs front-back (-Y = the
    thumb end): anything held in a hand is modelled lying along Y through the fist centre, its
    business end toward -Y. Raising the forearm 90 deg therefore stands a spear upright.
"""
import bpy, bmesh, math, random, os
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
UNIT_DIR = os.path.join(ROOT, "assets", "units")

# ------------------------------------------------------------------------------------------ skeleton
# left-side joints (right side mirrors x). Anthropometry of a 1.72 m man (shoulder 1.42, elbow 1.11,
# wrist 0.855, fingertip 0.665, hip joint 0.92, knee 0.49, ankle 0.085).
J = {
    "root": (0, 0, 0), "pelvis": (0, 0.0, 0.94), "spine": (0, 0.0, 1.08), "chest": (0, 0.005, 1.25),
    "neck": (0, 0.012, 1.455), "head": (0, 0.0, 1.555), "crown": (0, 0.0, 1.735),
    "shoulder": (0.178, 0.022, 1.415), "elbow": (0.205, 0.04, 1.108), "wrist": (0.222, 0.0, 0.857),
    "handend": (0.228, -0.012, 0.70),
    "hip": (0.093, 0.0, 0.925), "knee": (0.102, -0.012, 0.495), "ankle": (0.106, 0.035, 0.085),
    "toe": (0.114, -0.125, 0.02),
}
def jp(name, side=""):
    x, y, z = J[name]
    return Vector((-x if side == "R" else x, y, z))

# name, head joint, tail joint, parent, side
BONES = [
    ("root", "root", None, None, ""),
    ("pelvis", "pelvis", "spine", "root", ""),
    ("spine", "spine", "chest", "pelvis", ""),
    ("chest", "chest", "neck", "spine", ""),
    ("neck", "neck", "head", "chest", ""),
    ("head", "head", "crown", "neck", ""),
]
for s in ("L", "R"):
    BONES += [
        (f"upperarm.{s}", "shoulder", "elbow", "chest", s),
        (f"forearm.{s}", "elbow", "wrist", f"upperarm.{s}", s),
        (f"hand.{s}", "wrist", "handend", f"forearm.{s}", s),
        (f"thigh.{s}", "hip", "knee", "pelvis", s),
        (f"shin.{s}", "knee", "ankle", f"thigh.{s}", s),
        (f"foot.{s}", "ankle", "toe", f"shin.{s}", s),
    ]
DEFORM = [b[0] for b in BONES]

# the centre of the closed fist, where held things pass through (grip axis = Y)
def fist(side="R"):
    return jp("wrist", side).lerp(jp("handend", side), 0.42) + Vector((0, 0.0, 0))


def build_armature():
    arm = bpy.data.armatures.new("rig"); ob = bpy.data.objects.new("rig", arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones
    for name, h, t, parent, side in BONES:
        b = eb.new(name)
        b.head = jp(h, side)
        b.tail = jp(t, side) if t else Vector((0, 0, 0.25))
        b.roll = 0
        if parent: b.parent = eb[parent]; b.use_connect = False
    # IK helpers (not deforming): the off-hand target rides on the right hand; the pole sits behind-left
    g = eb.new("ik_grip"); g.head = fist("R") + Vector((0, -0.40, 0)); g.tail = g.head + Vector((0, 0, 0.06))
    g.parent = eb["hand.R"]; g.use_deform = False
    p = eb.new("ik_pole"); p.head = Vector((0.55, 0.45, 0.95)); p.tail = p.head + Vector((0, 0, 0.06))
    p.parent = eb["chest"]; p.use_deform = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ob.pose.bones: pb.rotation_mode = "QUATERNION"
    c = ob.pose.bones["forearm.L"].constraints.new("IK")
    c.target = ob; c.subtarget = "ik_grip"; c.pole_target = ob; c.pole_subtarget = "ik_pole"
    c.pole_angle = math.radians(-90); c.chain_count = 2; c.influence = 0.0; c.name = "offhand"
    return ob


# ------------------------------------------------------------------------------------------ geometry
def sstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)

def W(**kw):
    """weights dict from keyword args; dots in bone names are written as _ (upperarm_L)."""
    out = {}
    for k, v in kw.items():
        if v > 1e-4: out[k.replace("_L", ".L").replace("_R", ".R")] = v
    return out

def wmix(a, b, t):
    out = {}
    for k, v in a.items(): out[k] = out.get(k, 0) + v * (1 - t)
    for k, v in b.items(): out[k] = out.get(k, 0) + v * t
    return {k: v for k, v in out.items() if v > 1e-4}


class Part:
    """Geometry accumulator: verts + weights + faces (+ material per face) + per-vertex pattern coords."""
    def __init__(self, name, part=0):
        self.name, self.part = name, part
        self.v, self.w, self.pat, self.f, self.fm = [], [], [], [], []
    def vert(self, co, w, pat=(0, 0, 0)):
        self.v.append(Vector(co)); self.w.append(dict(w)); self.pat.append(tuple(pat)); return len(self.v) - 1
    def face(self, idx, mat):
        self.f.append(list(idx)); self.fm.append(mat)


def frame_for(t):
    """orthonormal (side, back) for a ring perpendicular to direction t. side ~ +X, back ~ +Y."""
    t = t.normalized()
    ref = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((0, 0, 1))
    side = ref.cross(t).normalized()  # for t pointing down (0,0,-1): (0,1,0)x(0,0,-1) = (-1,0,0)
    if side.x < 0 or (abs(side.x) < 1e-6 and side.z < 0): side = -side
    back = t.cross(side).normalized()
    if back.y < 0 and abs(t.y) < 0.9: back = -back
    return side, back


def ring(c, side, back, rx, ry, segs, n=2.0, mod=None, rot=0.0):
    """superellipse ring; angle 0 = +side, 90 = +back, 180 = -side, 270 = front."""
    pts = []
    for k in range(segs):
        th = 2 * math.pi * k / segs + rot
        cx, sy = math.cos(th), math.sin(th)
        ex = math.copysign(abs(cx) ** (2 / n), cx); ey = math.copysign(abs(sy) ** (2 / n), sy)
        r = 1.0 + (mod(th) if mod else 0.0)
        pts.append(c + side * (ex * rx * r) + back * (ey * ry * r))
    return pts


def loft(P, rings, mat, cap0=False, cap1=False, skip=None, pats=None, closed=True):
    """rings: [(points, weights)] all with the same count. skip(i_ring, k) -> True drops a quad."""
    ids = []
    for ri, (pts, w) in enumerate(rings):
        row = []
        for k, p in enumerate(pts):
            ww = w(k) if callable(w) else w
            row.append(P.vert(p, ww, pats[ri][k] if pats else (0, 0, 0)))
        ids.append(row)
    n = len(ids[0]); kn = n if closed else n - 1
    for i in range(len(ids) - 1):
        a, b = ids[i], ids[i + 1]
        for k in range(kn):
            if skip and skip(i, k): continue
            P.face([a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]], mat)
    for cap, row, rev in ((cap0, ids[0], True), (cap1, ids[-1], False)):
        if not cap: continue
        pts = [P.v[i] for i in row]; c = sum(pts, Vector()) / len(pts)
        if isinstance(cap, (int, float)) and not isinstance(cap, bool):
            c = c + (c - (sum((P.v[i] for i in (ids[1] if rev else ids[-2])), Vector()) / n)).normalized() * cap
        wc = P.w[row[0]]
        ci = P.vert(c, wc)
        for k in range(n):
            tri = [row[k], row[(k + 1) % n], ci]
            P.face(tri[::-1] if not rev else tri, mat)
    return ids


def path_rings(pts_w, segs, radius, n=2.0, mod=None, shape=None):
    """rings along a polyline. pts_w: [(point, weights, rx, ry)] ; tangents from neighbours."""
    out = []
    for i, (p, w, rx, ry) in enumerate(pts_w):
        a = pts_w[max(0, i - 1)][0]; b = pts_w[min(len(pts_w) - 1, i + 1)][0]
        side, back = frame_for(b - a)
        out.append((ring(p, side, back, rx, ry, segs, n, mod(i) if mod else None), w))
    return out


# ---------------------------------------------------------------- body parts
def limb_weights(bone_a, bone_b, t, blend=0.18):
    """weights along a two-bone chain, t in [0,2]: 0..1 on bone a, 1..2 on bone b; blended at the joint."""
    k = sstep(1 - blend, 1 + blend, t)
    return wmix({bone_a: 1}, {bone_b: 1}, k)


def leg(P, side, mat, segs=10, thick=0.0, top=0.97, lod=0):
    """hose-clad leg from inside the pelvis to the ankle (thick = extra cloth radius)."""
    s = side; sg = 1 if s == "L" else -1
    hip, knee, ank = jp("hip", s), jp("knee", s), jp("ankle", s)
    hip_top = hip + Vector((0, 0.0, top - hip.z))
    # (fraction along the chain 0..2, rx, ry, extra forward offset) — thigh then shin
    prof = [(-0.12, 0.070, 0.080, 0), (0.0, 0.082, 0.088, 0), (0.25, 0.076, 0.080, -0.004), (0.55, 0.066, 0.068, -0.004),
            (0.82, 0.055, 0.056, -0.004), (1.0, 0.050, 0.052, -0.004), (1.12, 0.050, 0.054, 0.004), (1.3, 0.052, 0.058, 0.010),
            (1.55, 0.045, 0.048, 0.006), (1.8, 0.036, 0.037, 0.0), (1.97, 0.033, 0.034, 0.0)]
    if lod: prof = prof[::2] + [prof[-1]]
    rings = []
    for f, rx, ry, dy in prof:
        if f < 0: c = hip.lerp(hip_top, -f / 0.12)
        elif f <= 1: c = hip.lerp(knee, f)
        else: c = knee.lerp(ank, f - 1)
        tdir = (knee - hip) if f <= 1 else (ank - knee)
        side_v, back = frame_for(tdir)
        w = limb_weights(f"thigh.{s}", f"shin.{s}", max(0, f), 0.12)
        if f < 0.05: w = wmix(w, {"pelvis": 1}, 0.35 * sstep(0.05, -0.12, f))
        # calf bulges at the back, shin bone flatter at the front
        mod = (lambda th, f=f: (0.10 * max(0, math.sin(th)) ** 2 if 1.15 < f < 1.6 else 0.0))
        rings.append((ring(c + back * dy, side_v, back, rx + thick, ry + thick, segs, 2.2, mod), w))
    loft(P, rings, mat, cap0=True)


def shoe(P, side, mat, segs=8, lod=0, boot=0.0):
    """turnshoe / ankle boot: loft from above the ankle along the foot to a rounded toe."""
    s = side; ank, toe = jp("ankle", s), jp("toe", s)
    x = ank.x
    # (y, z-centre, half-width, half-height, weights)
    wf = {f"foot.{s}": 1}; wa = {f"shin.{s}": 0.6, f"foot.{s}": 0.4}
    prof = [(0.062, 0.075, 0.034, 0.050, wa), (0.070, 0.050, 0.036, 0.048, wa), (0.030, 0.045, 0.043, 0.045, wf),
            (-0.030, 0.040, 0.047, 0.040, wf), (-0.085, 0.030, 0.049, 0.030, wf), (-0.125, 0.026, 0.042, 0.025, wf),
            (-0.160, 0.024, 0.026, 0.020, wf)]
    if boot: prof = [(0.050, 0.075 + boot, 0.040, 0.046, {f"shin.{s}": 1})] + prof
    if lod: prof = [prof[0], prof[2], prof[4], prof[6]]
    rings = []
    for y, zc, hw, hh, w in prof:
        c = Vector((x + (0.004 if s == "L" else -0.004) * (y < 0), y, zc))
        # ring in the X-Z plane (the shoe runs along -Y); flattened sole
        pts = []
        for k in range(segs):
            th = 2 * math.pi * k / segs
            cx, cz = math.cos(th), math.sin(th)
            z = c.z + hh * (cz if cz > 0 else max(cz, -0.55) * 1.0)
            pts.append(Vector((c.x + hw * math.copysign(abs(cx) ** 0.8, cx), y, max(0.0, z - hh * 0.2 * (cz < 0)))))
        rings.append((pts, w))
    # the ankle rings run vertical: turn them to follow the leg (top ring above ankle)
    loft(P, rings, mat, cap0=False, cap1=0.012)


def arm(P, side, mat, segs=10, thick=0.0, cuff=0.0, lod=0, bare_from=None, skin=None):
    """sleeved arm from a shoulder cap (a dome around the joint, so raising the arm never opens a
    hole) down to the wrist. bare_from: chain fraction where the sleeve ends and skin starts."""
    s = side; sh, el, wr = jp("shoulder", s), jp("elbow", s), jp("wrist", s)
    up = (sh - el).normalized()
    # (chain fraction 0..2, rx, ry)   rx = across the arm (side), ry = front-back
    prof = [(-0.22, 0.024, 0.024), (-0.14, 0.044, 0.044), (-0.05, 0.054, 0.055), (0.05, 0.055, 0.055), (0.3, 0.049, 0.050),
            (0.6, 0.044, 0.047), (0.9, 0.040, 0.043), (1.0, 0.039, 0.041), (1.12, 0.041, 0.041), (1.35, 0.040, 0.036),
            (1.7, 0.033, 0.028), (1.93, 0.029 + cuff, 0.024 + cuff)]
    if lod: prof = [prof[0], prof[2], prof[4], prof[6], prof[8], prof[10], prof[11]]
    rings = []
    for f, rx, ry in prof:
        if f < 0: c = sh + up * (-f * 0.19)
        elif f <= 1: c = sh.lerp(el, f)
        else: c = el.lerp(wr, f - 1)
        d = (el - sh) if f <= 1 else (wr - el)
        side_v, back = frame_for(d)
        w = limb_weights(f"upperarm.{s}", f"forearm.{s}", max(0.0, f), 0.14)
        if f < 0: w = wmix(w, {"chest": 1}, 0.35 * sstep(-0.1, -0.3, f))
        th = thick if (bare_from is None or f < bare_from) else 0.0
        if f < -0.1: th *= 0.5
        rings.append((ring(c, side_v, back, rx + th, ry + th, segs, 2.0), w))
    loft(P, rings, mat, cap0=True, cap1=True)


def hand(P, side, mat, segs=8, lod=0):
    """closed fist (grip axis front-back through fist()) with a thumb over the front."""
    s = side; wr = jp("wrist", s); he = jp("handend", s)
    d = (he - wr)
    side_v, back = frame_for(d)
    wh = {f"hand.{s}": 1}; ww = {f"forearm.{s}": 0.5, f"hand.{s}": 0.5}
    # a fist is ~9 cm deep front-back, 4.5 cm thick, knuckles facing out
    prof = [(0.0, 0.024, 0.026, ww), (0.18, 0.026, 0.038, wh), (0.45, 0.027, 0.046, wh), (0.72, 0.026, 0.045, wh), (0.9, 0.020, 0.036, wh)]
    if lod: prof = [prof[0], prof[2], prof[4]]
    rings = [(ring(wr + d * f, side_v, back, rx, ry, segs, 2.6), w) for f, rx, ry, w in prof]
    loft(P, rings, mat, cap0=False, cap1=0.01)
    if not lod:  # thumb: short tube wrapping the front of the grip
        base = wr + d * 0.25 + back * -0.030 + side_v * (-0.012 if s == "L" else 0.012)
        tip = wr + d * 0.52 + back * -0.046 + side_v * (-0.016 if s == "L" else 0.016)
        sv, bk = frame_for(tip - base)
        rings = [(ring(base.lerp(tip, f), sv, bk, r, r * 0.85, 6), wh) for f, r in ((0, 0.014), (0.6, 0.012), (1.0, 0.009))]
        loft(P, rings, mat, cap1=0.006)


# ---------------------------------------------------------------- torso & garments
# body torso table (z, half-width, half-depth, y-centre)
TORSO = [(0.86, 0.160, 0.105, 0.005), (0.93, 0.172, 0.114, 0.008), (1.00, 0.163, 0.106, 0.004), (1.07, 0.150, 0.100, -0.002),
         (1.15, 0.154, 0.104, -0.008), (1.24, 0.163, 0.112, -0.012), (1.32, 0.172, 0.116, -0.012), (1.39, 0.178, 0.108, -0.004),
         (1.435, 0.160, 0.090, 0.006), (1.47, 0.090, 0.068, 0.012)]

# the same torso clothed in a belted tunic: pinched at the belt, the cloth bloused over it
TUNIC = [(0.86, 0.160, 0.105, 0.005), (0.93, 0.172, 0.114, 0.008), (0.995, 0.166, 0.108, 0.004), (1.035, 0.150, 0.100, 0.0),
         (1.075, 0.164, 0.112, -0.004), (1.15, 0.158, 0.108, -0.008), (1.24, 0.163, 0.112, -0.012), (1.32, 0.172, 0.116, -0.012),
         (1.39, 0.178, 0.108, -0.004), (1.435, 0.160, 0.090, 0.006), (1.47, 0.090, 0.068, 0.012)]

def torso_w(z, x):
    if z < 0.98: w = {"pelvis": 1}
    elif z < 1.14: w = wmix({"pelvis": 1}, {"spine": 1}, sstep(0.98, 1.14, z))
    elif z < 1.32: w = wmix({"spine": 1}, {"chest": 1}, sstep(1.14, 1.32, z))
    else: w = {"chest": 1}
    if z > 1.45: w = wmix(w, {"neck": 1}, sstep(1.45, 1.52, z))
    a = sstep(0.11, 0.19, abs(x)) * sstep(1.26, 1.40, z) * 0.55  # shoulder flesh follows the arm
    if a > 0: w = wmix(w, {("upperarm.L" if x > 0 else "upperarm.R"): 1}, a)
    return w


def torso(P, mat, segs=16, thick=0.0, z0=0.86, z1=1.47, table=None, lod=0, puff=0.0, skirt=None, n=2.4):
    """torso shell from z0 up to the neck; thick = garment offset; skirt = (hem_z, hem_rx, hem_ry, rings)
    continues downward from the hips as a flared skirt weighted toward the thighs."""
    table = table or TORSO
    rows = [r for r in table if z0 - 1e-6 <= r[0] <= z1 + 1e-6]
    if lod: rows = rows[::2] + ([rows[-1]] if len(rows) % 2 == 0 else [])
    rings = []
    if skirt:
        hz, hrx, hry, nr = skirt
        top = rows[0]
        for i in range(nr, 0, -1):
            t = i / nr
            z = top[0] + (hz - top[0]) * t
            rx = top[1] + thick + (hrx - top[1] - thick) * t ** 0.8
            ry = top[2] + thick + (hry - top[2] - thick) * t ** 0.8
            def wsk(k, t=t):
                th = 2 * math.pi * k / segs; x = math.cos(th)
                sL = sstep(-0.35, 0.35, x)
                g = 0.78 * t ** 1.1
                return W(pelvis=1 - g, thigh_L=g * sL, thigh_R=g * (1 - sL))
            # hem is uneven and the skirt hangs in folds (cloth, not a lampshade)
            mod = (lambda th, t=t: t * (0.03 * math.sin(3 * th + 0.7) + 0.045 * math.sin(6 * th + 0.3) + 0.02 * math.sin(10 * th)))
            rings.append((ring(Vector((0, top[3] + 0.01 * t, z)), Vector((1, 0, 0)), Vector((0, 1, 0)), rx, ry, segs, 2.0, mod), wsk))
    for z, rx, ry, yc in rows:
        c = Vector((0, yc, z))
        def mod(th, z=z):
            m = 0.0
            if 1.2 < z < 1.40: m += 0.05 * max(0, -math.sin(th)) ** 2  # chest forward
            if 0.9 < z < 1.02: m += 0.07 * max(0, math.sin(th)) ** 3  # seat
            if 1.28 < z < 1.42: m += 0.04 * max(0, math.sin(th)) ** 2 * abs(math.cos(th))  # shoulder blades
            return m + puff * 0.5 * (math.cos(th * 8) * 0.5 + 0.5) * 0.0
        pts = ring(c, Vector((1, 0, 0)), Vector((0, 1, 0)), rx + thick, ry + thick, segs, n, mod)
        rings.append((pts, lambda k, pts=pts, z=z: torso_w(z, pts[k].x)))
    return loft(P, rings, mat, cap0=not skirt, cap1=False)


def neck(P, mat, segs=10, r=0.056, z0=1.40, z1=1.575):
    rings = []
    for z in (z0, (z0 + z1) / 2, z1):
        w = wmix({"chest": 1}, {"neck": 1}, sstep(z0, z0 + 0.08, z))
        if z > 1.55: w = wmix(w, {"head": 1}, 0.5)
        rings.append((ring(Vector((0, 0.012, z)), Vector((1, 0, 0)), Vector((0, 1, 0)), r, r * 1.02, segs), w))
    loft(P, rings, mat)


HEAD_C = Vector((0, 0.008, 1.628))

def head_point(th, ph, grow=0.0):
    """th around (0=+X, 90=back, 270=front), ph from the crown (0) to under the chin (pi)."""
    dx, dy, dz = math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), math.cos(ph)
    rx, ry, rz = 0.076, 0.097, 0.118
    front = max(0.0, -dy)
    # jaw: narrows below the cheekbones, the chin stays forward
    low = sstep(-0.15, -0.85, dz)
    rx *= 1 - 0.30 * low
    if dy > 0: ry *= 1 - 0.38 * low        # back of the lower head tucks into the neck
    else: ry *= 1 - 0.12 * low
    if dy < 0: ry *= 0.93                   # flatter face
    p = Vector((dx * rx, dy * ry, dz * rz))
    # features (only in front)
    def bump(a0, z0, sa, sz, amt):
        da = (th - a0 + math.pi) % (2 * math.pi) - math.pi
        return amt * math.exp(-(da / sa) ** 2 - ((p.z - z0) / sz) ** 2)
    fwd = 0.0
    fwd += bump(1.5 * math.pi, -0.028, 0.16, 0.022, 0.022)          # nose
    fwd += bump(1.5 * math.pi, 0.010, 0.55, 0.010, 0.007)           # brow ridge
    fwd -= bump(1.5 * math.pi + 0.40, -0.002, 0.14, 0.014, 0.008)   # eye sockets
    fwd -= bump(1.5 * math.pi - 0.40, -0.002, 0.14, 0.014, 0.008)
    fwd += bump(1.5 * math.pi, -0.100, 0.30, 0.020, 0.010)          # chin
    fwd += bump(1.5 * math.pi, -0.058, 0.20, 0.010, 0.004)          # lips
    n = Vector((dx, dy, dz)).normalized()
    if fwd: p += Vector((0, -1, 0)) * fwd * front ** 0.5
    p += n * grow
    return HEAD_C + p


def head(P, mat, segs=16, rings_n=12, lod=0):
    if lod: segs, rings_n = 10, 7
    rings = []
    for i in range(1, rings_n):
        ph = math.pi * i / rings_n * 0.94
        pts = [head_point(2 * math.pi * k / segs, ph) for k in range(segs)]
        z = HEAD_C.z + math.cos(ph) * 0.118
        w = {"head": 1} if z > 1.54 else wmix({"neck": 1}, {"head": 1}, 0.6)
        rings.append((pts, w))
    loft(P, rings, mat, cap0=0.004, cap1=False)


def hood(P, mat, segs=14, lod=0, cape_hem=1.285, open_face=True):
    """chaperon: a hood over the head (open at the face) running into a short shoulder cape."""
    if lod: segs = 10
    rings = []
    # over the head: rings of the head surface grown by the cloth thickness
    phs = [0.10, 0.35, 0.62, 0.90, 1.18, 1.46, 1.74, 2.02, 2.30] if not lod else [0.15, 0.62, 1.18, 1.74, 2.30]
    for ph in phs:
        pts = [head_point(2 * math.pi * k / segs, ph, 0.020 + 0.006 * math.sin(ph)) for k in range(segs)]
        rings.append((pts, {"head": 1}))
    # throat and cape
    cape = [(1.49, 0.082, 0.088, 0.004, {"neck": 0.5, "head": 0.5}), (1.455, 0.150, 0.118, 0.01, {"neck": 0.4, "chest": 0.6}),
            (1.41, 0.228, 0.152, 0.010, {"chest": 1}), (1.35, 0.258, 0.170, 0.004, {"chest": 1}), (cape_hem, 0.272, 0.180, 0.0, {"chest": 1})]
    if lod: cape = [cape[0], cape[2], cape[4]]
    for z, rx, ry, yc, w in cape:
        pts = ring(Vector((0, yc, z)), Vector((1, 0, 0)), Vector((0, 1, 0)), rx, ry, segs, 2.3,
                   (lambda th, z=z: 0.04 * math.sin(4 * th) * (z < 1.4)))
        def wf(k, pts=pts, w=w, z=z):
            x = pts[k].x; a = sstep(0.10, 0.24, abs(x)) * (0.55 if z < 1.42 else 0.2)
            return wmix(w, {("upperarm.L" if x > 0 else "upperarm.R"): 1}, a) if a > 0 else w
        rings.append((pts, wf))
    nh = len(phs)
    def skip(i, k):  # oval face opening from the brow to under the chin
        if not open_face or i >= nh or phs[i] < 1.1: return False
        th = 2 * math.pi * (k + 0.5) / segs
        da = abs((th - 1.5 * math.pi + math.pi) % (2 * math.pi) - math.pi)
        return da < (0.78 if i < nh - 1 else 0.55)
    loft(P, rings, mat, cap0=0.02, skip=skip)
    if not lod:  # liripipe: the hood's tail hanging down the back
        base = head_point(math.pi / 2, 0.55, 0.02)
        pts = [base, base + Vector((0, 0.07, -0.10)), base + Vector((0, 0.10, -0.26)), base + Vector((0, 0.11, -0.36))]
        rings = []
        for i, p in enumerate(pts):
            d = (pts[min(i + 1, 3)] - pts[max(i - 1, 0)]); sv, bk = frame_for(d)
            r = 0.030 * (1 - i / 4) + 0.008
            rings.append((ring(p, sv, bk, r, r * 0.8, 6), {"head": 1} if i == 0 else wmix({"head": 1}, {"chest": 1}, i / 3)))
        loft(P, rings, mat, cap1=0.01)


def belt(P, mat, z=1.03, grow=0.012, h=0.035, segs=16, table=None):
    """a belt band hugging the torso table (interpolated at z)."""
    table = table or TORSO
    def at(zz):
        for a, b in zip(table, table[1:]):
            if a[0] <= zz <= b[0]:
                t = (zz - a[0]) / (b[0] - a[0]); return [a[i] + (b[i] - a[i]) * t for i in range(4)]
        return list(table[0])
    rings = []
    for zz in (z - h / 2, z + h / 2):
        _, rx, ry, yc = at(zz)
        rings.append((ring(Vector((0, yc, zz)), Vector((1, 0, 0)), Vector((0, 1, 0)), rx + grow, ry + grow, segs, 2.4), torso_w(zz, 0)))
    # thickness: an outer and inner shell joined at the edges
    ids = loft(P, rings, mat)
    return ids


def box(P, c, size, mat, w, rot=None, pat=(0, 0, 0)):
    """small bevel-less box (pouches, buckles)."""
    sx, sy, sz = (s / 2 for s in size)
    R = rot or Matrix.Identity(3)
    corners = [c + R @ Vector((x * sx, y * sy, z * sz)) for z in (-1, 1) for y in (-1, 1) for x in (-1, 1)]
    ids = [P.vert(p, w, pat) for p in corners]
    for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        P.face([ids[i] for i in f], mat)


# ---------------------------------------------------------------- kit: helmets
def lathe(P, c, prof, segs, mat, w, pat_fn=None, closed_top=True):
    """surface of revolution around the vertical through c. prof = [(r, z)] from top down."""
    rings = []
    for r, z in prof:
        pts = [c + Vector((math.cos(2 * math.pi * k / segs) * r, math.sin(2 * math.pi * k / segs) * r, z)) for k in range(segs)]
        rings.append((pts, w))
    if prof[0][0] < 1e-4:  # apex
        rings = rings[1:]
        ids = loft(P, rings, mat)
        apex = P.vert(c + Vector((0, 0, prof[0][1])), w)
        row = ids[0]
        for k in range(segs): P.face([row[(k + 1) % segs], row[k], apex], mat)
        return ids
    return loft(P, rings, mat)


def kettle_hat(P, mat, segs=16, lod=0):
    """iron chapel-de-fer: a riveted dome with a broad, slightly drooping brim (sits on an arming cap)."""
    if lod: segs = 10
    c = Vector((0, 0.008, 1.60))
    prof = [(0.0, 0.205), (0.055, 0.196), (0.092, 0.170), (0.112, 0.128), (0.119, 0.080), (0.121, 0.052),
            (0.126, 0.046), (0.170, 0.030), (0.192, 0.017), (0.196, 0.011), (0.186, 0.014), (0.128, 0.036), (0.114, 0.044)]
    if lod: prof = [prof[0], prof[2], prof[4], prof[6], prof[8], prof[9], prof[11]]
    lathe(P, c, prof, segs, mat, {"head": 1})


def coif(P, mat, segs=14, lod=0):
    """padded linen arming cap: covers crown, ears and nape, ties under the chin; face open."""
    if lod: segs = 10
    rings = []
    phs = [0.12, 0.45, 0.80, 1.15, 1.50, 1.85, 2.15, 2.40] if not lod else [0.2, 0.8, 1.5, 2.15, 2.40]
    for ph in phs:
        rings.append(([head_point(2 * math.pi * k / segs, ph, 0.010 + 0.004 * ph) for k in range(segs)], {"head": 1}))
    z = 1.505
    rings.append((ring(Vector((0, 0.02, z)), Vector((1, 0, 0)), Vector((0, 1, 0)), 0.070, 0.074, segs), {"neck": 0.6, "head": 0.4}))
    nh = len(phs)
    def skip(i, k):
        th = 2 * math.pi * (k + 0.5) / segs
        da = abs((th - 1.5 * math.pi + math.pi) % (2 * math.pi) - math.pi)
        return 2 <= i <= nh - 1 and da < (0.85 if i < nh - 1 else 0.55)
    loft(P, rings, mat, cap0=0.01, skip=skip)


# ---------------------------------------------------------------- kit: weapons & tools (in the fist, along Y)
def shaft(P, a, b, r0, r1, mat, w, segs=6, pat=None):
    d = b - a; sv, bk = frame_for(d)
    rings = [(ring(a.lerp(b, t), sv, bk, r0 + (r1 - r0) * t, r0 + (r1 - r0) * t, segs), w) for t in (0.0, 0.5, 1.0)]
    L = d.length
    pats = [[(t * L, 0, 1)] * segs for t in (0.0, 0.5, 1.0)]
    return loft(P, rings, mat, cap0=True, cap1=True, pats=pats)


def spear(P, part, mats, side="R", length=2.65, grip=0.95, lod=0):
    """ash-shafted spear, iron leaf blade + socket, butt ferrule. grip = metres from the butt."""
    f = fist(side); w = {f"hand.{side}": 1}
    butt = f + Vector((0, grip, 0)); tipb = f + Vector((0, -(length - grip - 0.30), 0))
    segs = 5 if lod else 6
    shaft(P, butt, tipb, 0.0145, 0.0135, mats["wood"], w, segs)
    # socket + blade: a flattened diamond, the blade plane vertical (edges up/down in rest = in the swing plane)
    sock = tipb + Vector((0, -0.09, 0))
    shaft(P, tipb + Vector((0, 0.01, 0)), sock, 0.017, 0.013, mats["iron"], w, segs)
    blade = [(0.00, 0.012, 0.006), (0.06, 0.026, 0.008), (0.14, 0.022, 0.007), (0.21, 0.001, 0.001)]
    rings = []
    for d, hw, ht in blade:
        c = sock + Vector((0, -d, 0))
        pts = [c + Vector((ht, 0, 0)), c + Vector((0, 0, hw)), c + Vector((-ht, 0, 0)), c + Vector((0, 0, -hw))]
        rings.append((pts, w))
    loft(P, rings, mats["iron"], cap1=True)
    if not lod:
        shaft(P, butt + Vector((0, 0.005, 0)), butt + Vector((0, -0.06, 0)), 0.0165, 0.0155, mats["iron"], w, segs)


def axe(P, part, mats, side="R", lod=0):
    """felling axe: 0.78 m haft held near its end, iron head at the far end, edge down (-Z)."""
    f = fist(side); w = {f"hand.{side}": 1}
    butt = f + Vector((0, 0.07, 0)); top = f + Vector((0, -0.71, 0))
    shaft(P, butt, top, 0.016, 0.014, mats["wood"], w, 5 if lod else 6)
    # head: an eye around the haft top and a flaring blade toward -Z
    hc = top + Vector((0, 0.05, 0))
    eye = [(hc + Vector((sx * 0.013, sy * 0.028, 0.02))) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    blade = [(hc + Vector((sx * 0.003, sy * 0.050, -0.13))) for sx, sy in ((1, 1.2), (-1, 1.2), (-1, -1.2), (1, -1.2))]
    mid = [(hc + Vector((sx * 0.009, sy * 0.030, -0.05))) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    loft(P, [(eye, w), (mid, w), (blade, w)], mats["iron"], cap0=True, cap1=True)


def hoe(P, part, mats, side="R", lod=0):
    """field hoe: 1.45 m haft, iron blade at the far end bent down (-Z) at a right angle."""
    f = fist(side); w = {f"hand.{side}": 1}
    butt = f + Vector((0, 0.07, 0)); top = f + Vector((0, -1.36, 0))
    shaft(P, butt, top, 0.0155, 0.0145, mats["wood"], w, 5 if lod else 6)
    c = top + Vector((0, 0.02, 0))
    # socket down, then the blade: wide and thin
    shaft(P, c + Vector((0, 0, 0.02)), c + Vector((0, 0, -0.06)), 0.014, 0.012, mats["iron"], w, 5)
    b0, b1 = c + Vector((0, 0.005, -0.06)), c + Vector((0, 0.03, -0.19))
    pts0 = [b0 + Vector((sx * 0.055, sy * 0.004, 0)) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    pts1 = [b1 + Vector((sx * 0.075, sy * 0.002, 0)) for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
    loft(P, [(pts0, w), (pts1, w)], mats["iron"], cap0=True, cap1=True)


# ---- shields on the forearm (enarmes): one frame shared by the builders and the pose solver
# (_arms_anims.place_shield). The shield lies FLAT ALONG THE FOREARM: the forearm runs across the back of its
# upper part (elbow near the outer edge, the fist gripping the strap near the inner edge), the face SHIELD_OFF
# out from the forearm's axis on the back-of-the-hand side. In the rest frame (arm hanging): across = the
# forearm axis (elbow -> wrist), down = +Y (so with the elbow bent and the thumb up the point hangs down),
# out = lateral (+X on the left arm). Posing the shield = posing the forearm (place_shield).
SHIELD_OFF = 0.100      # m from the forearm's axis to the back face: clears a mailed forearm and the fist
SHIELD_ALONG = 0.21     # m from the elbow along the forearm to the shield's centre line

def shield_frame(side="L"):
    """(elbow, across, down, out) in the forearm's rest frame."""
    el, wr = jp("elbow", side), jp("wrist", side); sg = 1 if side == "L" else -1
    across = (wr - el).normalized()
    out = Vector((sg, 0, 0)); out = (out - across * out.dot(across)).normalized()
    down = out.cross(across).normalized()
    if down.y < 0: down = -down
    return el, across, down, out

def heater_shield(P, part, mats, side="L", lod=0, width=0.58, height=0.72, bend=0.9):
    """heater shield strapped on the forearm (shield_frame): curved plank shield, painted face, leather-faced
    rim. The forearm crosses the back of its straight upper third; posed with _arms_anims.place_shield.
    pat = (u across, v down, 1 face / 2 back)."""
    el, across, axis_down, out = shield_frame(side)
    w = {f"forearm.{side}": 1}
    th = 0.018
    VX = 0.24                                               # the forearm crosses at 24 % of the height
    top_c = el + across * SHIELD_ALONG - axis_down * (VX * height) + out * (SHIELD_OFF + th / 2)
    nu, nv = (6, 7) if lod else (9, 11)
    def half_w(v):  # heater outline: straight sides for the top third, then two arcs to the point
        if v < 0.36: return 1.0
        t = (v - 0.36) / 0.64
        return max(0.0, math.cos(t * math.pi / 2) ** 0.85)
    grid_f, grid_b = [], []
    for j in range(nv + 1):
        v = j / nv
        rf, rb = [], []
        for i in range(nu + 1):
            u = (i / nu) * 2 - 1
            x = u * half_w(v) * width / 2
            curve = (x * x) / (2 * bend)             # cylindrical bow: the edges curve back round the man
            p = top_c + axis_down * (v * height) + across * x - out * curve
            # the bow's centre line stays SHIELD_OFF out; only the edges wrap back (they are clear of the arm)
            pat = (u * half_w(v), v, 1.0)
            rf.append(P.vert(p + out * th / 2, w, pat))
            rb.append(P.vert(p - out * th / 2, w, (pat[0], pat[1], 2.0)))
        grid_f.append(rf); grid_b.append(rb)
    for j in range(nv):
        for i in range(nu):
            a, b, c, d = grid_f[j][i], grid_f[j][i + 1], grid_f[j + 1][i + 1], grid_f[j + 1][i]
            P.face([a, b, c, d], mats["paint"])
            a, b, c, d = grid_b[j][i], grid_b[j][i + 1], grid_b[j + 1][i + 1], grid_b[j + 1][i]
            P.face([d, c, b, a], mats["back"])
    # rim band (outline): top edge, right side down, left side up
    outline = [(0, i) for i in range(nu + 1)] + [(j, nu) for j in range(1, nv + 1)] + [(j, 0) for j in range(nv - 1, 0, -1)]
    for k in range(len(outline)):
        (j0, i0), (j1, i1) = outline[k], outline[(k + 1) % len(outline)]
        P.face([grid_f[j0][i0], grid_b[j0][i0], grid_b[j1][i1], grid_f[j1][i1]], mats["rim"])


def dagger(P, mats, side="R", z=1.0):
    """a ballock dagger hanging from the belt at the back hip."""
    sg = 1 if side == "L" else -1
    w = {"pelvis": 1}
    top = Vector((sg * 0.12, 0.13, z)); bot = top + Vector((sg * 0.015, 0.035, -0.24))
    shaft(P, top + Vector((0, 0, 0.08)), top, 0.011, 0.011, mats["wood"], w, 5)
    shaft(P, top, bot, 0.016, 0.008, mats["leather"], w, 5)


def pouch(P, mats, side="L", z=1.0):
    sg = 1 if side == "L" else -1
    box(P, Vector((sg * 0.155, -0.045, z - 0.075)), (0.05, 0.12, 0.12), mats["leather2"], {"pelvis": 1},
        rot=Matrix.Rotation(sg * -0.35, 3, "Z"))


# ------------------------------------------------------------------------------------------ assemble
def make_object(P, mats_by_name, part_ids):
    """Part -> Blender mesh object with vertex groups, material slots and a 'pat' + 'part' attribute."""
    me = bpy.data.meshes.new(P.name)
    me.from_pydata([tuple(v) for v in P.v], [], P.f)
    me.update()
    ob = bpy.data.objects.new(P.name, me)
    bpy.context.scene.collection.objects.link(ob)
    names = []
    for m in P.fm:
        if m not in names: names.append(m)
    for n in names: me.materials.append(mats_by_name[n])
    for poly, m in zip(me.polygons, P.fm): poly.material_index = names.index(m)
    groups = {}
    for i, w in enumerate(P.w):
        tot = sum(w.values()) or 1
        for b, v in w.items():
            if b not in groups: groups[b] = ob.vertex_groups.new(name=b)
            groups[b].add([i], v / tot, "REPLACE")
    at = me.attributes.new("pat", "FLOAT_VECTOR", "POINT")
    at.data.foreach_set("vector", [c for p in P.pat for c in p])
    pa = me.attributes.new("part", "FLOAT", "POINT")
    pa.data.foreach_set("value", [float(P.part)] * len(P.v))
    # outward normals, smooth shading
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    return ob


# ---------------------------------------------------------------- kit for riders and knights
def sword(P, part, mats, side="R", lod=0):
    """arming sword held point-forward (-Y) in the fist: 0.80 m blade, crossguard, grip, wheel pommel."""
    f = fist(side); w = {f"hand.{side}": 1}
    segs = 4 if lod else 6
    shaft(P, f + Vector((0, 0.07, 0)), f + Vector((0, -0.04, 0)), 0.014, 0.014, mats["leather"], w, segs)   # grip
    shaft(P, f + Vector((0, 0.09, 0)), f + Vector((0, 0.065, 0)), 0.024, 0.024, mats["iron"], w, segs)      # pommel
    g = f + Vector((0, -0.05, 0))
    box(P, g, (0.03, 0.022, 0.20), mats["iron"], w)                                                      # cross, in the edge plane
    rings = []
    for d, hw, ht in ((0.0, 0.026, 0.004), (0.35, 0.022, 0.0035), (0.70, 0.013, 0.003), (0.80, 0.001, 0.001)):
        c = g + Vector((0, -0.012 - d, 0))
        rings.append(([c + Vector((ht, 0, 0)), c + Vector((0, 0, hw)), c + Vector((-ht, 0, 0)), c + Vector((0, 0, -hw))], w))
    loft(P, rings, mats["iron"], cap0=True, cap1=True)


def scabbard(P, mats, side="L", z=1.02):
    """empty-looking sword scabbard slung at the hip on the belt."""
    sg = 1 if side == "L" else -1; w = {"pelvis": 1}
    top = Vector((sg * 0.19, -0.02, z)); bot = top + Vector((sg * 0.05, 0.30, -0.72))
    # the lower half swings with the thigh: a lying man's scabbard lies along his leg, not stuck into the ground
    shaft(P, top, top.lerp(bot, 0.35), 0.022, 0.020, mats["leather"], w, 5)
    shaft(P, top.lerp(bot, 0.35), bot, 0.020, 0.016, mats["leather"], {"pelvis": 0.45, f"thigh.{'L' if sg > 0 else 'R'}": 0.55}, 5)
    shaft(P, top + Vector((0, -0.02, 0.10)), top, 0.015, 0.015, mats["leather"], w, 5)


def lance(P, part, mats, side="R", lod=0):
    """war lance, 3.7 m, held 1.0 m from the butt: a thicker ash shaft with a small steel head."""
    spear(P, part, mats, side, length=3.7, grip=0.95, lod=lod)


def round_shield(P, part, mats, side="L", lod=0, r=0.30, dish=0.06):
    """round wooden shield with an iron boss, strapped like the heater (shield_frame): the forearm crosses its
    back just above the centre. pat = (u, v, 1 face / 2 back) with u,v in [-1,1] across the disc."""
    el, across, axis_down, out = shield_frame(side)
    w = {f"forearm.{side}": 1}
    c = el + across * (SHIELD_ALONG - 0.01) + axis_down * 0.04 + out * (SHIELD_OFF + 0.008)
    nr, na = (3, 10) if lod else (5, 16)
    front, back = [], []
    for i in range(nr + 1):
        pts_f, pts_b = [], []
        for k in range(na):
            a = 2 * math.pi * k / na
            u, v = math.cos(a) * i / nr, math.sin(a) * i / nr
            bulge = dish * (1 - (i / nr) ** 2) - dish * 0.35   # dished: the rim comes back, the middle stands out
            p = c + across * (u * r) + axis_down * (v * r) + out * max(bulge, -0.012 if i < nr else -0.02)
            pts_f.append(P.vert(p + out * 0.008, w, (u, v, 1.0)))
            pts_b.append(P.vert(p - out * 0.008, w, (u, v, 2.0)))
        front.append(pts_f); back.append(pts_b)
    for i in range(nr):
        for k in range(na):
            k2 = (k + 1) % na
            if i == 0:
                P.face([front[0][k], front[1][k], front[1][k2]], mats["paint"]); P.face([back[0][k], back[1][k2], back[1][k]], mats["back"])
            else:
                P.face([front[i][k], front[i + 1][k], front[i + 1][k2], front[i][k2]], mats["paint"])
                P.face([back[i][k], back[i][k2], back[i + 1][k2], back[i + 1][k]], mats["back"])
    for k in range(na):
        k2 = (k + 1) % na
        P.face([front[nr][k], back[nr][k], back[nr][k2], front[nr][k2]], mats["rim"])
    # boss
    bc = c + out * (dish * 0.65 + 0.01)
    lathe_axis(P, bc, out, [(0.0, 0.06), (0.04, 0.05), (0.065, 0.02), (0.075, 0.0)], 8 if lod else 10, mats["iron"], w)


def lathe_axis(P, c, axis, prof, segs, mat, w):
    """surface of revolution around an arbitrary axis; prof = [(r, h)] from the apex down."""
    axis = axis.normalized(); a = axis.orthogonal().normalized(); b = axis.cross(a)
    rings = [([c + axis * h + (a * math.cos(2 * math.pi * k / segs) + b * math.sin(2 * math.pi * k / segs)) * r for k in range(segs)], w)
             for r, h in prof[1:]]
    ids = loft(P, rings, mat, cap1=True)
    apex = P.vert(c + axis * prof[0][1], w)
    for k in range(segs): P.face([ids[0][(k + 1) % segs], ids[0][k], apex], mat)


def great_helm(P, mat, segs=14, lod=0):
    """flat-topped great helm c.1300: a riveted cylinder closed over the face, eye slits and breaths
    (painted), slightly tapered to the crown."""
    if lod: segs = 10
    c = Vector((0, 0.010, 1.40))
    prof = [(0.0, 0.365), (0.085, 0.362), (0.112, 0.352), (0.118, 0.33), (0.120, 0.24), (0.121, 0.13), (0.124, 0.05), (0.13, 0.0), (0.13, -0.012)]
    if lod: prof = [prof[0], prof[2], prof[4], prof[6], prof[8]]
    lathe(P, c, prof, segs, mat, {"head": 1})


def mail_hood(P, mat, segs=12, lod=0):
    """mail aventail flaring from under the helm over the shoulders."""
    rings = []
    for z, rx, ry in ((1.46, 0.10, 0.10), (1.42, 0.18, 0.14), (1.37, 0.23, 0.155)):
        rings.append((ring(Vector((0, 0.012, z)), Vector((1, 0, 0)), Vector((0, 1, 0)), rx, ry, segs, 2.3),
                      {"chest": 0.7, "neck": 0.3} if z > 1.44 else {"chest": 1}))
    loft(P, rings, mat)


def poleyn(P, mat, side, lod=0):
    """iron knee cop over the mail chausses."""
    k = jp("knee", side) + Vector((0, -0.05, 0.0))
    lathe_axis(P, k, Vector((0, -1, 0)), [(0.0, 0.03), (0.035, 0.02), (0.055, 0.0), (0.058, -0.012)], 6 if lod else 8, mat,
               {f"thigh.{side}": 0.5, f"shin.{side}": 0.5})
