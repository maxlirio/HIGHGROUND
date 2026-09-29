"""HIGHGROUND horse animation: a tiny rig + pose solver in numpy (no Blender armature).

Bones rotate about their rest joint (rest-relative transforms):  G_b = G_parent @ T(j_b) R_b T(-j_b).
Legs are solved in the sagittal plane of their parent (chest / pelvis): two-bone IK for the upper
limb, hoof kept flat on the ground through the fetlock while in stance, swing flexion from curves.
Gait timings are the real footfall sequences (walk 4-beat lateral, trot diagonal, canter 3-beat
left lead, transverse gallop 4-beat with suspension).
"""
import math
import numpy as np
import _horse_anat as A

LEGS = ("LF", "RF", "LH", "RH")


def Rx(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def Ry(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def Rz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def M4(R=None, t=None):
    m = np.eye(4)
    if R is not None: m[:3, :3] = R
    if t is not None: m[:3, 3] = t
    return m


def rot2(v, a):
    """rotate (y,z) by a (same sense as Rx)"""
    c, s = math.cos(a), math.sin(a)
    return np.array([v[0] * c - v[1] * s, v[0] * s + v[1] * c])


def ang2(v):
    return math.atan2(v[1], v[0])


def smooth(x):
    x = min(max(x, 0.0), 1.0); return x * x * (3 - 2 * x)


class Rig:
    def __init__(self, an):
        self.an = an
        self.S = an.S
        self.names = A.bone_names()
        self.j = an.joints
        self.parent = an.parent
        # order parents before children
        order = []
        def visit(b):
            if b in order: return
            p = self.parent[b]
            if p: visit(p)
            order.append(b)
        for b in self.names: visit(b)
        self.order = order
        S = self.S
        # hoof sole (ground contact centre) per leg, rest
        self.sole = {}
        for side, sg in (("L", 1), ("R", -1)):
            self.sole["%sF" % side] = an.P(0.598, 0.0, sg * 0.14)
            self.sole["%sH" % side] = an.P(-0.575, 0.0, sg * 0.132)

    # ------------------------------------------------------------ forward kinematics
    def globals(self, rot, root_t):
        G = {}
        for b in self.order:
            j = self.j[b]
            R = rot.get(b)
            L = M4() if R is None else M4(R, j - R @ j)
            if self.parent[b] is None:
                L = M4(t=root_t) @ L
                G[b] = L
            else:
                G[b] = G[self.parent[b]] @ L
        return G

    # ------------------------------------------------------------ leg IK
    def solve_leg(self, leg, G, target, wflat=1.0, phic=0.0, phif=0.0, gamma=None, hoofflex=0.0,
                  scap_k=0.5):
        """returns local rotations (about x) for the leg's bones so the hoof sole reaches `target`
        (world). Fore: phic = carpal flexion. Hind: gamma = cannon absolute rotation (None = auto)."""
        side = leg[0]; fore = leg[1] == "F"
        sfx = "_" + side
        par = "chest" if fore else "pelvis"
        Gp = G[par]
        tl = np.linalg.inv(Gp) @ np.append(target, 1.0)
        T = tl[1:3]                                   # (y, z) in parent's rest frame
        # world pitch of the parent: flat hoof needs absolute hoof angle = -pitch
        Rp = Gp[:3, :3]
        pitch = math.atan2(Rp[2, 1], Rp[1, 1])
        J = lambda b: self.j[b + sfx][1:3]
        sole = self.sole[leg][1:3]
        out = {}
        if fore:
            js, jh, je, jk, jf, jc = J("scap"), J("humerus"), J("forearm"), J("fcannon"), J("fpast"), J("fhoof")
            # scapula follows a share of the limb's sweep about its upper pivot
            sweep = ang2(T - js) - ang2(sole - js)
            ths = scap_k * sweep
            Sp = js + rot2(jh - js, ths)
            h0 = je - jh
            l1 = np.linalg.norm(h0)
            for _ in range(5):
                D0 = (jk - je) + rot2(jf - jk, phic) + rot2(jc - jf, phic + phif) + \
                    rot2(sole - jc, phic + phif + hoofflex)
                l2 = np.linalg.norm(D0)
                Eh = self._two_bone(Sp, T, l1, l2, bend=+1)
                Ah = ang2(Eh - Sp) - ang2(h0)
                Af = ang2(T - Eh) - ang2(D0)
                Ak = Af + phic + phif + hoofflex
                phif = phif + (-pitch - Ak) * wflat
            out["scap" + sfx] = ths
            out["humerus" + sfx] = Ah - ths
            out["forearm" + sfx] = Af - Ah
            out["fcannon" + sfx] = phic
            out["fpast" + sfx] = phif
            out["fhoof" + sfx] = hoofflex
        else:
            jfe, jt, jc, jp, jh = J("femur"), J("tibia"), J("hcannon"), J("hpast"), J("hhoof")
            if gamma is None:
                sweep = ang2(T - jfe) - ang2(sole - jfe)
                gamma = 0.55 * sweep
            for _ in range(5):
                dist = rot2(jp - jc, gamma) + rot2(jh - jp, gamma + phif) + rot2(sole - jh, gamma + phif + hoofflex)
                Hk = T - dist
                l1 = np.linalg.norm(jt - jfe); l2 = np.linalg.norm(jc - jt)
                St = self._two_bone(jfe, Hk, l1, l2, bend=-1)
                Afe = ang2(St - jfe) - ang2(jt - jfe)
                At = ang2(Hk - St) - ang2(jc - jt)
                Ak = gamma + phif + hoofflex
                phif = phif + (-pitch - Ak) * wflat
            out["femur" + sfx] = Afe
            out["tibia" + sfx] = At - Afe
            out["hcannon" + sfx] = gamma - At
            out["hpast" + sfx] = phif
            out["hhoof" + sfx] = hoofflex
        return out

    @staticmethod
    def _two_bone(B, T, l1, l2, bend):
        """middle joint of a 2-bone chain from B toward T. bend=+1: joint on the +y (rear) side."""
        d = T - B
        dl = np.linalg.norm(d)
        dl_c = min(max(dl, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4)
        a = math.acos(max(-1.0, min(1.0, (l1 * l1 + dl_c * dl_c - l2 * l2) / (2 * l1 * dl_c))))
        base = ang2(d)
        best = None
        for sgn in (1, -1):
            u = np.array([math.cos(base + sgn * a), math.sin(base + sgn * a)])
            M = B + u * l1
            # side of the line B->T the joint lies on: + y side = behind (the horse faces -y)
            cr = d[0] * (M - B)[1] - d[1] * (M - B)[0]
            side = -np.sign(cr) if d[1] < 0 else np.sign(cr)
            # simpler: compare the joint's y against the line's y at the same height
            t = (M - B) @ d / (dl * dl) if dl > 1e-9 else 0.0
            ly = B[0] + d[0] * t
            s = 1 if M[0] > ly else -1
            if s == bend:
                best = M
        return best if best is not None else B + np.array([math.cos(base), math.sin(base)]) * l1


# ====================================================================== clips
GAITS = {
    # name: frames, cycle seconds (15hh), duty factor, touchdown phase per leg, stance sweep (m, 15hh),
    #       swing height, body bob amp, bob per cycle, pitch amp (deg)
    "walk":   dict(frames=16, T=1.05, duty=0.63, td=dict(LH=0.0, LF=0.25, RH=0.5, RF=0.75), sweep=0.95,
                   lift=0.13, bob=0.018, bobn=2, pitch=1.0, speed=1.6),
    "trot":   dict(frames=12, T=0.72, duty=0.42, td=dict(LF=0.0, RH=0.0, RF=0.5, LH=0.5), sweep=1.05,
                   lift=0.22, bob=0.035, bobn=2, pitch=1.0, speed=3.6),
    "canter": dict(frames=12, T=0.62, duty=0.40, td=dict(RH=0.0, LH=0.22, RF=0.24, LF=0.46), sweep=1.15,
                   lift=0.26, bob=0.05, bobn=1, pitch=6.0, speed=5.8),
    "gallop": dict(frames=12, T=0.46, duty=0.28, td=dict(RH=0.0, LH=0.10, RF=0.36, LF=0.46), sweep=1.25,
                   lift=0.30, bob=0.06, bobn=1, pitch=6.5, speed=11.0),
}


class Animator:
    def __init__(self, rig):
        self.rig = rig; self.S = rig.S

    def base(self):
        return dict(root_t=np.zeros(3), rot={}, legs={})

    # -------------------------------------------------------------- gaits
    def gait(self, name, t):
        """t in [0,1) of the stride cycle"""
        g = GAITS[name]; S = self.S
        p = self.base()
        duty = g["duty"]; sweep = g["sweep"] * S
        # body
        n = g["bobn"]
        if name == "walk":
            bob = g["bob"] * S * math.cos(2 * math.pi * (n * t - 0.1))
        elif name == "trot":
            bob = g["bob"] * S * math.cos(2 * math.pi * n * (t - 0.30))
        else:
            bob = g["bob"] * S * math.cos(2 * math.pi * (t - 0.62))
        pitch = math.radians(g["pitch"]) * math.sin(2 * math.pi * (t - 0.30)) if n == 1 else \
            math.radians(g["pitch"]) * math.sin(2 * math.pi * 2 * t) * 0.5
        roll = math.radians(1.5) * math.sin(2 * math.pi * t) if name in ("walk", "trot") else 0.0
        drop = {"walk": 0.0, "trot": -0.02, "canter": -0.035, "gallop": -0.06}[name] * S
        p["root_t"] = np.array([0.0, 0.0, bob + drop])
        p["rot"]["root"] = Rx(pitch) @ Ry(roll)
        # neck/head: walk nods twice per stride, canter/gallop swing with the stride
        if name == "walk":
            nod = math.radians(4.0) * math.sin(2 * math.pi * (2 * t + 0.1))
            p["rot"]["neck1"] = Rx(nod * 0.5); p["rot"]["head"] = Rx(nod * 0.6)
        elif name == "trot":
            p["rot"]["neck1"] = Rx(math.radians(-4)); p["rot"]["head"] = Rx(math.radians(2) * math.sin(4 * math.pi * t))
        else:
            sw = math.sin(2 * math.pi * (t - 0.15))
            ext = math.radians(-12 if name == "gallop" else -6)
            p["rot"]["neck1"] = Rx(ext + math.radians(7 if name == "gallop" else 6) * sw)
            p["rot"]["neck2"] = Rx(math.radians(3) * sw)
            p["rot"]["head"] = Rx(math.radians(10 if name == "gallop" else 4) + math.radians(4) * sw)
        # tail: carried a little higher at speed, swings with the body
        lift_t = {"walk": 0.0, "trot": -0.15, "canter": -0.3, "gallop": -0.5}[name]
        p["rot"]["tail1"] = Rx(lift_t) @ Rz(math.radians(6) * math.sin(2 * math.pi * t))
        p["rot"]["tail2"] = Rx(lift_t * 0.6) @ Rz(math.radians(8) * math.sin(2 * math.pi * (t - 0.15)))
        p["rot"]["tail3"] = Rx(lift_t * 0.4) @ Rz(math.radians(10) * math.sin(2 * math.pi * (t - 0.3)))
        # legs
        for leg in LEGS:
            ph = (t - g["td"][leg]) % 1.0
            sole = self.rig.sole[leg].copy()
            fore = leg[1] == "F"
            # stance centre: fore hooves land a little ahead of the vertical, hind under the hip
            ctr = (-0.08 if fore else 0.02) * S
            if ph < duty:                           # stance: hoof planted, sweeping back
                s = ph / duty
                y = sole[1] + ctr - sweep / 2 + sweep * s
                z = 0.0
                p["legs"][leg] = dict(target=np.array([sole[0], y, z]), wflat=1.0, phic=0.0,
                                      hoofflex=0.0, phif0=0.0)
                # fetlock sinks under load (mid-stance)
                p["legs"][leg]["sink"] = math.sin(math.pi * s)
            else:                                    # swing
                s = (ph - duty) / (1 - duty)
                e = 0.5 - 0.5 * math.cos(math.pi * s)          # eased forward travel
                y = sole[1] + ctr + sweep / 2 - sweep * e
                # the hoof leaves by rolling over the toe, rises, then reaches forward & drops
                hgt = g["lift"] * S * (math.sin(math.pi * min(1.0, s * 1.15)) ** 1.2)
                z = hgt
                fold = math.sin(math.pi * min(1.0, s * 1.25)) if s < 0.8 else 0.0
                fold = max(fold, 0.0)
                if fore:
                    phic = math.radians({"walk": 70, "trot": 95, "canter": 100, "gallop": 110}[name]) * fold
                else:
                    phic = 0.0
                phif = math.radians(-35 if fore else -30) * fold + math.radians(10) * max(0.0, (s - 0.75) / 0.25)
                wflat = smooth((s - 0.85) / 0.15)
                p["legs"][leg] = dict(target=np.array([sole[0], y, z]), wflat=wflat, phic=phic,
                                      phif0=phif, hoofflex=math.radians(-15) * fold, sink=0.0,
                                      gamma_fold=fold)
        return p

    # -------------------------------------------------------------- idle / rear / fall
    def idle(self, t):
        S = self.S
        p = self.base()
        w = math.sin(2 * math.pi * t)
        p["root_t"] = np.array([0.012 * S * w, 0.0, -0.004 * S * (1 - math.cos(2 * math.pi * t)) * 0.5])
        p["rot"]["root"] = Ry(math.radians(0.8) * w)
        # head: grazing-alert idle: slowly lowers, then a toss (quick up/back) and settles
        if t < 0.55:
            k = smooth(t / 0.55)
            n1 = math.radians(8) * k; hd = math.radians(6) * k
        elif t < 0.72:
            k = smooth((t - 0.55) / 0.17)
            n1 = math.radians(8) * (1 - k) + math.radians(-10) * k
            hd = math.radians(6) * (1 - k) + math.radians(-18) * k
        else:
            k = smooth((t - 0.72) / 0.28)
            n1 = math.radians(-10) * (1 - k); hd = math.radians(-18) * (1 - k)
        yaw = math.radians(6) * math.sin(2 * math.pi * t + 0.5)
        p["rot"]["neck1"] = Rx(n1) @ Rz(yaw * 0.5)
        p["rot"]["neck2"] = Rz(yaw * 0.5)
        p["rot"]["head"] = Rx(hd)
        p["rot"]["tail2"] = Rz(math.radians(15) * math.sin(2 * math.pi * t * 2))
        p["rot"]["tail3"] = Rz(math.radians(20) * math.sin(2 * math.pi * t * 2 - 0.8))
        for leg in LEGS:
            sole = self.rig.sole[leg].copy()
            p["legs"][leg] = dict(target=sole, wflat=1.0, phic=0.0, phif0=0.0, hoofflex=0.0, sink=0.0)
        # weight comes off the right hind: it rests on the toe mid-loop
        k = math.sin(math.pi * t) ** 2
        sole = self.rig.sole["RH"].copy()
        p["legs"]["RH"] = dict(target=sole + np.array([0, -0.04 * S * k, 0.03 * S * k]), wflat=1.0 - k,
                               phic=0.0, phif0=math.radians(-25) * k, hoofflex=math.radians(-20) * k, sink=0.0)
        return p

    def rear(self, t):
        """refuse: rears up off the forehand, paws, comes down. 0..1 (non-looping)"""
        S = self.S
        p = self.base()
        if t < 0.4: k = smooth(t / 0.4)
        elif t < 0.62: k = 1.0
        else: k = 1.0 - smooth((t - 0.62) / 0.38)
        up = math.radians(-42) * k
        # pivot about the hind hooves: rotate the body about the hind sole line
        piv = (self.rig.sole["LH"] + self.rig.sole["RH"]) / 2
        R = Rx(-up)                                       # nose up = rotation about +x negative?
        R = Rx(up * -1.0)
        # choose the sign so the forehand rises: the front is at -y; rotating by +a about x moves
        # (y<0, z) points to lower z... we want them higher -> negative angle
        R = Rx(up)
        # root transform = rotation about the pivot: t = piv - R piv (expressed through root joint)
        j = self.rig.j["root"]
        # G_root = T(t) T(j) R T(-j) must equal T(piv) R T(-piv)  =>  t = piv - R piv - (j - R j)
        p["root_t"] = (piv - R @ piv) - (j - R @ j) + np.array([0, 0, -0.08 * S * k])
        p["rot"]["root"] = R
        # hindquarters sink, neck up and back, head flexed
        p["rot"]["pelvis"] = Rx(math.radians(10) * k)
        p["rot"]["neck1"] = Rx(math.radians(-8) * k)
        p["rot"]["head"] = Rx(math.radians(25) * k)
        paw = math.sin(2 * math.pi * 2.5 * t) * k
        for leg in LEGS:
            sole = self.rig.sole[leg].copy()
            if leg[1] == "H":
                tgt = sole + np.array([0, -0.06 * S * k, 0])
                p["legs"][leg] = dict(target=tgt, wflat=1.0, phic=0.0, phif0=0.0, hoofflex=0.0, sink=0.0)
            else:
                # forelegs fold and paw: FK angles blended with the IK stance when down
                off = 1 if leg[0] == "L" else -1
                p["legs"][leg] = dict(fk=dict(scap=math.radians(-18) * k,
                                               humerus=math.radians(-40 - 12 * paw * off) * k,
                                               forearm=math.radians(-40 + 25 * paw * off) * k,
                                               fcannon=math.radians(95 - 15 * paw * off) * k,
                                               fpast=math.radians(-20) * k, fhoof=math.radians(-20) * k),
                                      fk_w=smooth(k * 3), target=sole, wflat=1.0, phic=0.0, phif0=0.0,
                                      hoofflex=0.0, sink=0.0)
        p["rot"]["tail1"] = Rx(math.radians(20) * k)
        return p

    def fall(self, t, dead=False):
        """collapses: forelegs buckle, drops onto the chest, rolls onto its right side and lies."""
        S = self.S
        p = self.base()
        a = smooth(t / 0.45)                   # buckle + drop
        b = smooth((t - 0.35) / 0.55)          # roll onto the side
        c = smooth((t - 0.7) / 0.3)            # settle: neck down to the ground, legs relax out
        j = self.rig.j["root"]
        pitch = math.radians(14) * a * (1 - b)
        roll = math.radians(-86) * b
        R = Ry(roll) @ Rx(pitch)
        lie_z = 0.33 * S * an_w(self) - j[2]
        dz = (-0.45 * S) * a * (1 - b) + lie_z * b
        p["root_t"] = np.array([-0.20 * S * b, 0.0, dz])
        p["rot"]["root"] = R
        p["rot"]["neck1"] = Rx(math.radians(22) * a * (1 - c) + math.radians(-5) * c) @ Rz(math.radians(18) * c)
        p["rot"]["neck2"] = Rz(math.radians(10) * c)
        p["rot"]["head"] = Rx(math.radians(20) * a * (1 - c) + math.radians(-10) * c)
        p["rot"]["tail1"] = Rx(math.radians(12) * c)
        for leg in LEGS:
            fore = leg[1] == "F"
            upper = leg[0] == "L"
            relax = c
            if fore:
                fk = dict(scap=math.radians(10) * a * (1 - relax), humerus=math.radians(-30) * a * (1 - relax) + math.radians(-25 if upper else -10) * relax,
                          forearm=math.radians(-20) * a * (1 - relax) + math.radians(15) * relax,
                          fcannon=math.radians(120) * a * (1 - relax) + math.radians(25 if upper else 10) * relax,
                          fpast=math.radians(-20) * a, fhoof=math.radians(-10) * a)
            else:
                fk = dict(femur=math.radians(-35) * a * (1 - relax) + math.radians(-15 if upper else 5) * relax,
                          tibia=math.radians(40) * a * (1 - relax) + math.radians(10) * relax,
                          hcannon=math.radians(-45) * a * (1 - relax) + math.radians(-10) * relax,
                          hpast=math.radians(-15) * a, hhoof=math.radians(-10) * a)
            p["legs"][leg] = dict(fk=fk, fk_w=1.0)
        return p


def an_w(anim):
    return anim.rig.an.W


# ====================================================================== pose evaluation
def evaluate(rig, pose):
    """pose dict -> global 4x4 per bone (legs solved)"""
    rot = dict(pose["rot"])
    root_t = pose["root_t"]
    # first pass: body only, to know chest/pelvis frames
    G = rig.globals(rot, root_t)
    for leg, L in pose["legs"].items():
        side = leg[0]; sfx = "_" + side
        fore = leg[1] == "F"
        ang = {}
        if L.get("target") is not None and L.get("fk_w", 0.0) < 1.0:
            phif = L.get("phif0", 0.0) - math.radians(12) * L.get("sink", 0.0)
            if not fore and L.get("gamma_fold") is not None:
                gamma = None
            ang = rig.solve_leg(leg, G, L["target"], wflat=L.get("wflat", 1.0), phic=L.get("phic", 0.0),
                                phif=phif, hoofflex=L.get("hoofflex", 0.0),
                                gamma=_hind_gamma(rig, leg, G, L) if not fore else None)
        if L.get("fk") is not None:
            w = L.get("fk_w", 1.0)
            for k, v in L["fk"].items():
                b = k + sfx
                ang[b] = ang.get(b, 0.0) * (1 - w) + v * w
        for b, a in ang.items():
            rot[b] = Rx(a)
    return rig.globals(rot, root_t)


def _hind_gamma(rig, leg, G, L):
    """hind cannon angle: follows the limb sweep in stance; in swing the hock flexes and the cannon
    trails back, then swings forward to meet the ground"""
    side = leg[0]
    Gp = G["pelvis"]
    tl = (np.linalg.inv(Gp) @ np.append(L["target"], 1.0))[1:3]
    jfe = rig.j["femur_" + side][1:3]
    sole = rig.sole[leg][1:3]
    sweep = ang2(tl - jfe) - ang2(sole - jfe)
    g = 0.6 * sweep
    fold = L.get("gamma_fold", 0.0) or 0.0
    return g + math.radians(40) * fold


def clip_poses(anim, name):
    """list of pose dicts for a clip"""
    if name in GAITS:
        n = GAITS[name]["frames"]
        return [anim.gait(name, i / n) for i in range(n)]
    if name == "idle":
        return [anim.idle(i / 16) for i in range(16)]
    if name == "rear":
        return [anim.rear(i / 15) for i in range(16)]
    if name == "fall":
        return [anim.fall(i / 13) for i in range(14)]
    if name == "dead":
        return [anim.fall(1.0)]
    raise KeyError(name)


CLIPS = ("idle", "walk", "trot", "canter", "gallop", "rear", "fall", "dead")
LOOP = dict(idle=True, walk=True, trot=True, canter=True, gallop=True, rear=False, fall=False, dead=True)
