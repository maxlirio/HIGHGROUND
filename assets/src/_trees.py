"""Reusable tree toolkit for HIGHGROUND. See docs/tree-recipe.md.

Pipeline:  scaffold (explicit trunk/limbs)  ->  colonize() (space colonization into
crown lobes)  ->  pipe_radii()  ->  build_tubes() (bark mesh, 'bk_a'/'bk_b' UVs)
->  bark_material()  ;  leaf_atlas() renders a procedural leaf-cluster RGBA PNG,
scatter_cards() places alpha cards at twig tips with crown-outward normals.
"""
import bpy, bmesh, math, random, os, sys
import numpy as np
from mathutils import Vector, noise
import _lib as L


# ---------------------------------------------------------------- args
def script_args():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def get_seed(default=1):
    for a in script_args():
        if a.lstrip("-").isdigit():
            return int(a)
    return int(os.environ.get("HG_SEED", default))


# ---------------------------------------------------------------- skeleton
class Skel:
    """Node list; parents always precede children (index order)."""
    def __init__(self):
        self.pos = []; self.par = []; self.growable = []

    def add(self, p, parent, growable=True):
        self.pos.append(Vector(p)); self.par.append(parent); self.growable.append(growable)
        return len(self.pos) - 1

    def children(self):
        ch = [[] for _ in self.pos]
        for i, p in enumerate(self.par):
            if p >= 0: ch[p].append(i)
        return ch


def polyline(sk, start_idx, direction, length, step, rng, wander=0.25, kink_every=2.0,
             kink_deg=22, up_bias=0.0, growable=True, droop=0.0, keep_heading=0.75):
    """Crooked limb: segment chain with random kinks (oak-like zigzag). Returns node ids.
    keep_heading: min cos between current and initial horizontal heading (limb never doubles back)."""
    d = Vector(direction).normalized(); idx = start_idx; out = []
    h0 = Vector((d.x, d.y, 0)); h0 = h0.normalized() if h0.length > 0.2 else None
    n = max(1, int(length / step)); since = 0.0
    for k in range(n):
        since += step
        if since >= kink_every * rng.uniform(0.6, 1.4):
            since = 0.0
            ax = d.orthogonal().normalized()
            ax.rotate(__import__("mathutils").Quaternion(d, rng.uniform(0, 6.283)))
            d.rotate(__import__("mathutils").Quaternion(ax, math.radians(rng.uniform(0.4, 1) * kink_deg)))
        t = k / n
        d = (d + Vector((rng.gauss(0, wander), rng.gauss(0, wander), rng.gauss(0, wander))) * 0.15
             + Vector((0, 0, up_bias * t - droop))).normalized()
        if h0 is not None:
            hh = Vector((d.x, d.y, 0))
            if hh.length > 1e-3 and hh.normalized().dot(h0) < keep_heading:
                hn = hh.normalized().lerp(h0, 0.6).normalized() * hh.length
                d = Vector((hn.x, hn.y, d.z)).normalized()
        idx = sk.add(sk.pos[idx] + d * step, idx, growable)
        out.append(idx)
    return out


def lobe_attractors(lobes, count, rng, shell=0.45, zmin=-1e9):
    """lobes: list of (centre Vector, (rx,ry,rz)). Points biased to the lobe shell."""
    vols = np.array([r[0] * r[1] * r[2] for _, r in lobes]); vols /= vols.sum()
    pts = []
    for (c, r), v in zip(lobes, vols):
        m = int(count * v) + 1
        for _ in range(m):
            u = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
            rad = shell + (1 - shell) * rng.random() ** 0.5
            p = c + Vector((u.x * r[0], u.y * r[1], u.z * r[2])) * rad
            if p.z > zmin: pts.append(tuple(p))
    return np.array(pts, dtype=np.float32)


def colonize(sk, attractors, infl=4.0, kill=1.0, step=0.5, iters=160, tropism=(0, 0, 0),
             jitter=0.12, rng=random):
    A = np.asarray(attractors, np.float32); alive = np.ones(len(A), bool)
    trop = np.array(tropism, np.float32)
    for it in range(iters):
        P = np.array([tuple(p) for p in sk.pos], np.float32)
        G = np.array(sk.growable)
        Pg = P.copy(); Pg[~G] = 1e6
        ai = np.nonzero(alive)[0]
        if len(ai) == 0: break
        Aa = A[ai]
        best_i = np.empty(len(ai), np.int64); best_d = np.empty(len(ai), np.float32)
        for s in range(0, len(ai), 800):
            d2 = ((Aa[s:s + 800, None, :] - Pg[None, :, :]) ** 2).sum(-1)
            j = d2.argmin(1); best_i[s:s + 800] = j; best_d[s:s + 800] = d2[np.arange(len(j)), j]
        ok = best_d < infl * infl
        if not ok.any(): break
        acc = {}
        for a, n in zip(Aa[ok], best_i[ok]):
            v = a - P[n]; v /= (np.linalg.norm(v) + 1e-6)
            acc.setdefault(int(n), np.zeros(3, np.float32)); acc[int(n)] += v
        new = []
        for n, v in acc.items():
            v = v / (np.linalg.norm(v) + 1e-6) + trop
            v += np.array([rng.gauss(0, jitter) for _ in range(3)], np.float32)
            nv = np.linalg.norm(v)
            if nv < 1e-3: continue
            q = P[n] + v / nv * step
            new.append(sk.add(tuple(q), n));
        if not new: break
        Nn = np.array([tuple(sk.pos[i]) for i in new], np.float32)
        for s in range(0, len(ai), 2000):
            idx = ai[s:s + 2000]
            d2 = ((A[idx, None, :] - Nn[None]) ** 2).sum(-1).min(1)
            alive[idx[d2 < kill * kill]] = False
    return sk


def pipe_radii(sk, r_tip=0.012, exp=2.4, base_radius=None):
    ch = sk.children(); r = [r_tip] * len(sk.pos)
    for i in range(len(sk.pos) - 1, -1, -1):
        if ch[i]:
            r[i] = max(r_tip, sum(r[c] ** exp for c in ch[i]) ** (1 / exp))
    if base_radius:
        k = base_radius / r[0]
        # compress so twigs stay thin while trunk reaches target
        r = [r_tip * (x / r_tip) ** (math.log(base_radius / r_tip) / math.log(r[0] / r_tip)) for x in r]
    return r


def chains(sk, radius):
    """Decompose into continuous chains (thickest child continues). list of index lists."""
    ch = sk.children(); out = []; stack = [(0, None)]
    while stack:
        i, parent = stack.pop()
        chain = [parent] if parent is not None else []
        cur = i
        while True:
            chain.append(cur)
            kids = sorted(ch[cur], key=lambda c: -radius[c])
            if not kids: break
            for k in kids[1:]: stack.append((k, cur))
            cur = kids[0]
        out.append(chain)
    return out


def sides_for(r):
    return 26 if r >= 0.5 else 14 if r >= 0.3 else 10 if r >= 0.16 else 7 if r >= 0.08 else 5 if r >= 0.045 else 4 if r >= 0.028 else 3


# ---------------------------------------------------------------- tube mesh
def build_tubes(sk, radius, min_r=0.03, name="bark", gnarl=0.12, flare=None, seed=0,
                spacing=lambda r: min(1.1, max(0.22, r * 2.2)), sides=sides_for, tip=True, caps=False,
                cap_z=None):
    """Skin the skeleton. flare(z, theta) -> radius multiplier (trunk chain only).
    tip: add a tapered point to each chain end.  caps: fan-cap both chain ends instead
    (cap faces get material_index 1 and planar bk_a coords -> end grain for stumps/logs);
    cap_z(x, y) optionally reshapes the END cap (e.g. an axe-notched stump top)."""
    bm = bmesh.new()
    uva = bm.loops.layers.uv.new("bk_a"); uvb = bm.loops.layers.uv.new("bk_b")
    noff = Vector((seed * 3.7, seed * 1.3, seed * 5.1))
    for ci, ch in enumerate(chains(sk, radius)):
        if radius[ch[1] if len(ch) > 1 else ch[0]] < min_r: continue
        pts = [sk.pos[i] for i in ch]; rs = [radius[i] for i in ch]
        if ch[0] != 0 and len(ch) > 1:
            rs[0] = rs[1]  # branch start sits inside parent with own radius
        # truncate where below min_r, then resample
        keep = [0]; acc = 0.0
        for k in range(1, len(pts)):
            if rs[k] < min_r: break
            acc += (pts[k] - pts[k - 1]).length
            sp = spacing(rs[k]) * (0.45 if ci == 0 and pts[k].z < 1.6 else 1.0)
            if acc >= sp or k == len(pts) - 1:
                keep.append(k); acc = 0.0
        if len(keep) < 2: continue
        P = [pts[k] for k in keep]; R = [rs[k] for k in keep]
        if tip:  # tapered tip extension
            P.append(P[-1] + (P[-1] - P[-2]).normalized() * max(0.15, R[-1] * 4)); R.append(R[-1] * 0.35)
        # split into segments with constant side count
        segs = []; start = 0
        for k in range(1, len(P)):
            if sides(R[k]) < sides(R[start]) and k - start >= 2 or k == len(P) - 1:
                segs.append((start, k)); start = k
        s_len = [0.0]
        for k in range(1, len(P)): s_len.append(s_len[-1] + (P[k] - P[k - 1]).length)
        ref = None
        for a, b in segs:
            ns = sides(R[a]); rings = []
            for k in range(a, b + 1):
                t = (P[min(k + 1, len(P) - 1)] - P[max(k - 1, 0)]).normalized()
                if ref is None: ref = t.orthogonal().normalized()
                ref = (ref - t * ref.dot(t)).normalized(); bi = t.cross(ref)
                ring = []
                for j in range(ns):
                    th = 2 * math.pi * j / ns
                    d = ref * math.cos(th) + bi * math.sin(th)
                    rr = R[k]
                    if flare and ci == 0: rr *= flare(P[k].z, math.atan2(d.y, d.x))
                    q = P[k] + d * rr
                    rr *= 1 + gnarl * noise.noise((q * 1.3) + noff) + gnarl * 0.5 * noise.noise(q * 4.1 + noff)
                    v = P[k] + d * rr
                    if v.z < 0: v.z = 0.0
                    ring.append((bm.verts.new(v), th, R[k], s_len[k]))
                rings.append(ring)
            if caps and a == 0: _fan_cap(bm, rings[0], P[0], uva, uvb, flip=True)
            if caps and b == len(P) - 1: _fan_cap(bm, rings[-1], P[-1], uva, uvb, zf=cap_z)
            for r0, r1 in zip(rings, rings[1:]):
                for j in range(ns):
                    j2 = (j + 1) % ns
                    f = bm.faces.new((r0[j][0], r0[j2][0], r1[j2][0], r1[j][0]))
                    for lp, (v, th, rr, s) in zip(f.loops, (r0[j], r0[j2], r1[j2], r1[j])):
                        th2 = th if not (j2 == 0 and lp.vert in (r0[j2][0], r1[j2][0])) else 2 * math.pi
                        lp[uva].uv = (rr * math.cos(th2), rr * math.sin(th2))
                        lp[uvb].uv = (s, rr)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    return ob


def _fan_cap(bm, ring, c, uva, uvb, flip=False, zf=None):
    vs = [r[0] for r in ring]
    if zf:
        for v in vs: v.co.z = zf(v.co.x, v.co.y)
    cz = zf(c.x, c.y) if zf else c.z
    cv = bm.verts.new((c.x, c.y, cz))
    n = (sum((v.co for v in vs), Vector()) / len(vs) - c)
    ax = (vs[0].co - c).cross(vs[1].co - c).normalized()
    for j in range(len(vs)):
        tri = (cv, vs[j], vs[(j + 1) % len(vs)])
        f = bm.faces.new(tri[::-1] if flip else tri)
        f.material_index = 1
        e1 = (vs[0].co - c).normalized(); e2 = ax.cross(e1)
        for lp in f.loops:
            q = lp.vert.co - c; lp[uva].uv = (q.dot(e1), q.dot(e2)); lp[uvb].uv = (0, 0)


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---------------------------------------------------------------- materials
def _n(nodes, t, **kw):
    x = nodes.new(t)
    for k, v in kw.items():
        if k.startswith("in_"): x.inputs[k[3:].replace("_", " ")].default_value = v
        else: setattr(x, k, v)
    return x


def _ramp(n, l, src, stops):
    r = n.new("ShaderNodeValToRGB"); cr = r.color_ramp
    for i, (p, c) in enumerate(stops):
        e = cr.elements[i] if i < 2 else cr.elements.new(p)
        e.position = p; e.color = (*srgb(c), 1)
    l.new(src, r.inputs[0]); return r


def srgb(h):
    h = h.lstrip("#"); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def _mix(n, l, a, b, fac, blend="MIX"):
    m = n.new("ShaderNodeMix"); m.data_type = "RGBA"; m.blend_type = blend
    l.new(fac, m.inputs[0]);
    for s, v in ((6, a), (7, b)):
        if isinstance(v, (tuple, list)): m.inputs[s].default_value = (*v, 1) if len(v) == 3 else v
        else: l.new(v, m.inputs[s])
    return m.outputs[2]


def _math(n, l, op, a, b=None, clamp=False):
    m = n.new("ShaderNodeMath"); m.operation = op; m.use_clamp = clamp
    for s, v in ((0, a), (1, b)):
        if v is None: continue
        if isinstance(v, (int, float)): m.inputs[s].default_value = v
        else: l.new(v, m.inputs[s])
    return m.outputs[0]


def bark_coords(n, l, along=0.33):
    """Seamless tube-space coordinate: (r cos, r sin, s*along) from bk_a/bk_b UVs."""
    ua = _n(n, "ShaderNodeUVMap", uv_map="bk_a"); ub = _n(n, "ShaderNodeUVMap", uv_map="bk_b")
    sa = n.new("ShaderNodeSeparateXYZ"); sb = n.new("ShaderNodeSeparateXYZ")
    l.new(ua.outputs[0], sa.inputs[0]); l.new(ub.outputs[0], sb.inputs[0])
    c = n.new("ShaderNodeCombineXYZ")
    l.new(sa.outputs[0], c.inputs[0]); l.new(sa.outputs[1], c.inputs[1])
    l.new(_math(n, l, "MULTIPLY", sb.outputs[0], along), c.inputs[2])
    return c.outputs[0], sb.outputs[1]  # coord, radius


def bark_material(name="bark", plate="#6f675b", plate2="#5d5144", crack="#2a241e",
                  lichen="#a9a98c", moss="#4e5a26", plate_scale=7.0, along=0.33,
                  crack_width=0.09, moss_amount=0.55, lichen_amount=0.35, smooth_below_r=0.07):
    """Fissured bark: stretched voronoi plates + wave-distorted cracks, lichen, north/low moss."""
    m, n, l, b = L.mat(name)
    co, rad = bark_coords(n, l, along)
    geo = n.new("ShaderNodeNewGeometry")
    # distortion
    dn = _n(n, "ShaderNodeTexNoise", in_Scale=2.5, in_Detail=4.0)
    l.new(co, dn.inputs["Vector"])
    dco = n.new("ShaderNodeVectorMath"); dco.operation = "MULTIPLY_ADD"
    l.new(dn.outputs["Color"], dco.inputs[0]); dco.inputs[1].default_value = (0.09, 0.09, 0.05)
    l.new(co, dco.inputs[2]); co2 = dco.outputs[0]
    dn2 = _n(n, "ShaderNodeTexNoise", in_Scale=14.0, in_Detail=3.0); l.new(co2, dn2.inputs["Vector"])
    dco2 = n.new("ShaderNodeVectorMath"); dco2.operation = "MULTIPLY_ADD"
    l.new(dn2.outputs["Color"], dco2.inputs[0]); dco2.inputs[1].default_value = (0.035, 0.035, 0.02)
    l.new(co2, dco2.inputs[2]); co2 = dco2.outputs[0]   # breaks the clean voronoi edges
    # plates (mid frequency)
    v1 = _n(n, "ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE", in_Scale=plate_scale)
    l.new(co2, v1.inputs["Vector"])
    v1c = _n(n, "ShaderNodeTexVoronoi", in_Scale=plate_scale); l.new(co2, v1c.inputs["Vector"])
    v2 = _n(n, "ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE", in_Scale=plate_scale * 2.7)
    l.new(co2, v2.inputs["Vector"])
    # smooth bark on thin branches
    thin = _math(n, l, "MULTIPLY", _math(n, l, "DIVIDE", rad, smooth_below_r), 1.0, clamp=True)
    cr1 = _math(n, l, "SUBTRACT", 1.0, _math(n, l, "DIVIDE", v1.outputs["Distance"], crack_width), clamp=True)
    cr2 = _math(n, l, "SUBTRACT", 1.0, _math(n, l, "DIVIDE", v2.outputs["Distance"], crack_width * 0.6), clamp=True)
    crackm = _math(n, l, "MULTIPLY", _math(n, l, "MAXIMUM", cr1, _math(n, l, "MULTIPLY", cr2, 0.3)), thin)
    # colour furrows only in the deep core of the (broad) crack profile -> rounded ridges, dark furrows
    crackc = _math(n, l, "MULTIPLY", _math(n, l, "SUBTRACT", crackm, 0.45), 2.2, clamp=True)
    # colours: large blotch (world pos), per-plate, fine grain
    big = _n(n, "ShaderNodeTexNoise", in_Scale=0.35, in_Detail=3.0); l.new(geo.outputs["Position"], big.inputs["Vector"])
    base = _mix(n, l, srgb(plate), srgb(plate2), big.outputs["Fac"])
    sc_ = n.new("ShaderNodeSeparateColor"); l.new(v1c.outputs["Color"], sc_.inputs[0])
    per = _math(n, l, "ADD", _math(n, l, "MULTIPLY", sc_.outputs[0], 0.35), 0.8)
    permul = n.new("ShaderNodeMix"); permul.data_type = "RGBA"; permul.blend_type = "MULTIPLY"
    permul.inputs[0].default_value = 1.0; l.new(base, permul.inputs[6])
    cc = n.new("ShaderNodeCombineColor"); l.new(per, cc.inputs[0]); l.new(per, cc.inputs[1]); l.new(per, cc.inputs[2])
    l.new(cc.outputs[0], permul.inputs[7]); base = permul.outputs[2]
    fine = _n(n, "ShaderNodeTexNoise", in_Scale=90.0, in_Detail=6.0); l.new(co2, fine.inputs["Vector"])
    mid = _n(n, "ShaderNodeTexNoise", in_Scale=22.0, in_Detail=6.0, in_Roughness=0.6); l.new(co2, mid.inputs["Vector"])
    fr = _math(n, l, "ADD", _math(n, l, "MULTIPLY", fine.outputs["Fac"], 0.55), 0.62)
    fr = _math(n, l, "MULTIPLY", fr, _math(n, l, "ADD", _math(n, l, "MULTIPLY", mid.outputs["Fac"], 0.5), 0.75))
    fcc = n.new("ShaderNodeCombineColor"); [l.new(fr, fcc.inputs[i]) for i in range(3)]
    base = _mix(n, l, base, fcc.outputs[0], _math(n, l, "ADD", 0.0, 1.0), "MULTIPLY")
    # lichen patches on plate tops
    ln = _n(n, "ShaderNodeTexNoise", in_Scale=1.6, in_Detail=5.0, in_Roughness=0.7)
    l.new(geo.outputs["Position"], ln.inputs["Vector"])
    lm = _math(n, l, "MULTIPLY", _math(n, l, "SUBTRACT", ln.outputs["Fac"], 0.62 - lichen_amount * 0.2), 9.0, clamp=True)
    lm = _math(n, l, "MULTIPLY", lm, _math(n, l, "SUBTRACT", 1.0, crackc, clamp=True))
    col = _mix(n, l, base, srgb(lichen), lm)
    # moss: north (+Y) facing, upward-facing limb tops, low on trunk; creeps into cracks
    sn = n.new("ShaderNodeSeparateXYZ"); l.new(geo.outputs["Normal"], sn.inputs[0])
    sp = n.new("ShaderNodeSeparateXYZ"); l.new(geo.outputs["Position"], sp.inputs[0])
    north = _math(n, l, "MULTIPLY", _math(n, l, "ADD", sn.outputs[1], 0.15), 1.4, clamp=True)
    upf = _math(n, l, "MULTIPLY", _math(n, l, "SUBTRACT", sn.outputs[2], 0.45), 2.0, clamp=True)
    low = _math(n, l, "SUBTRACT", 1.0, _math(n, l, "DIVIDE", sp.outputs[2], 3.5), clamp=True)
    mn = _n(n, "ShaderNodeTexNoise", in_Scale=2.2, in_Detail=6.0, in_Roughness=0.65)
    l.new(geo.outputs["Position"], mn.inputs["Vector"])
    region = _math(n, l, "ADD", _math(n, l, "MULTIPLY", north, _math(n, l, "ADD", low, 0.35)),
                   _math(n, l, "MULTIPLY", upf, 0.8))
    region = _math(n, l, "MULTIPLY", region, moss_amount)
    mm = _math(n, l, "MULTIPLY", _math(n, l, "SUBTRACT", _math(n, l, "ADD", mn.outputs["Fac"], region), 0.85), 5.0, clamp=True)
    mm = _math(n, l, "MAXIMUM", mm, _math(n, l, "MULTIPLY", _math(n, l, "MULTIPLY", crackm, region), 0.8))
    mcol = _mix(n, l, srgb(moss), srgb("#65712f"), fine.outputs["Fac"])
    col = _mix(n, l, col, mcol, _math(n, l, "MINIMUM", mm, 1.0))
    col = _mix(n, l, col, srgb(crack), _math(n, l, "MULTIPLY", crackc, _math(n, l, "SUBTRACT", 1.0, _math(n, l, "MULTIPLY", mm, 0.7))))
    # ridge tops catch light: slightly paler, weathered
    col = _mix(n, l, col, srgb("#8f877a"), _math(n, l, "MULTIPLY", _math(n, l, "SUBTRACT", 1.0, crackm, clamp=True), 0.25))
    l.new(col, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.9
    # bump: plates up, cracks down, fine pitting
    h = _math(n, l, "ADD", _math(n, l, "MULTIPLY", crackm, -1.0), _math(n, l, "MULTIPLY", fine.outputs["Fac"], 0.35))
    h = _math(n, l, "ADD", h, _math(n, l, "MULTIPLY", mid.outputs["Fac"], 0.3))
    h = _math(n, l, "ADD", h, _math(n, l, "MULTIPLY", mm, 0.3))
    bump = _n(n, "ShaderNodeBump", in_Strength=0.85, in_Distance=0.03)
    l.new(h, bump.inputs["Height"]); l.new(bump.outputs[0], b.inputs["Normal"])
    return m


def cutwood_material(name="cutwood", wood="#c9a877", ring="#9c7a4c", heart="#8a6238", ring_freq=55.0):
    """End grain for stumps/logs: uses bk_a = planar (x,y) from the axis."""
    m, n, l, b = L.mat(name)
    ua = _n(n, "ShaderNodeUVMap", uv_map="bk_a")
    dn = _n(n, "ShaderNodeTexNoise", in_Scale=4.0, in_Detail=3.0); l.new(ua.outputs[0], dn.inputs["Vector"])
    vm = n.new("ShaderNodeVectorMath"); vm.operation = "LENGTH"; l.new(ua.outputs[0], vm.inputs[0])
    rr = _math(n, l, "ADD", vm.outputs["Value"], _math(n, l, "MULTIPLY", dn.outputs["Fac"], 0.025))
    rings = _math(n, l, "SINE", _math(n, l, "MULTIPLY", rr, ring_freq * 6.283))
    rings = _math(n, l, "POWER", _math(n, l, "MULTIPLY", _math(n, l, "ADD", rings, 1.0), 0.5), 6.0)
    col = _mix(n, l, srgb(wood), srgb(ring), _math(n, l, "MULTIPLY", rings, 0.9))
    heartm = _math(n, l, "LESS_THAN", rr, 0.06)
    col = _mix(n, l, col, srgb(heart), _math(n, l, "MULTIPLY", heartm, 0.6))
    # axe facets / checks
    ck = _n(n, "ShaderNodeTexVoronoi", feature="DISTANCE_TO_EDGE", in_Scale=3.0); l.new(ua.outputs[0], ck.inputs["Vector"])
    ckm = _math(n, l, "SUBTRACT", 1.0, _math(n, l, "DIVIDE", ck.outputs["Distance"], 0.012), clamp=True)
    ckm = _math(n, l, "MULTIPLY", ckm, _math(n, l, "LESS_THAN", rr, 0.35))  # drying checks only in the heart
    big = _n(n, "ShaderNodeTexNoise", in_Scale=1.5, in_Detail=4.0)
    geo = n.new("ShaderNodeNewGeometry"); l.new(geo.outputs["Position"], big.inputs["Vector"])
    col = _mix(n, l, col, srgb("#7d6a52"), _math(n, l, "MULTIPLY", big.outputs["Fac"], 0.5))
    col = _mix(n, l, col, srgb("#4a3a2a"), _math(n, l, "MULTIPLY", ckm, 0.7))
    fine = _n(n, "ShaderNodeTexNoise", in_Scale=120.0, in_Detail=4.0); l.new(ua.outputs[0], fine.inputs["Vector"])
    l.new(col, b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.8
    h = _math(n, l, "ADD", _math(n, l, "MULTIPLY", rings, 0.3), _math(n, l, "MULTIPLY", ckm, -1.0))
    h = _math(n, l, "ADD", h, _math(n, l, "MULTIPLY", fine.outputs["Fac"], 0.3))
    bump = _n(n, "ShaderNodeBump", in_Strength=0.5, in_Distance=0.01)
    l.new(h, bump.inputs["Height"]); l.new(bump.outputs[0], b.inputs["Normal"])
    return m


# ---------------------------------------------------------------- leaf atlas
def oak_leaf_outline(rng, n=120):
    """Quercus robur: obovate, 4-5 ROUNDED lobes/side with narrow sinuses, auricled base.
    Returns [(half_width, t)] along the midrib, t in 0..1."""
    lobes = rng.choice((4, 4, 5)); ph = rng.uniform(0.15, 0.35)
    pts = []
    for i in range(n + 1):
        t = i / n
        env = math.sin(math.pi * min(1.0, t ** 0.75)) ** 0.7 * (0.5 + 0.7 * t) * (1 - t ** 8)
        c = math.cos(math.pi * (lobes * t + ph))
        lob = abs(c) ** 0.55                       # rounded bulge, pinched sinus
        w = env * (0.38 + 0.62 * lob) * 0.40
        if t < 0.1: w = max(w * 0.4, 0.07 * math.sin(math.pi * t / 0.1))  # ear-lobed base
        pts.append((w, t))
    pts[0] = (0.004, 0.0); pts[-1] = (0.0, 1.0)
    return pts


def _leaf_mesh(bm, outline, M, uv, col_layer, col):
    left = [(-w, t) for w, t in outline]; right = [(w, t) for w, t in reversed(outline)][1:-1]
    ring = left + right; vs = []
    for x, t in ring:
        z = -abs(x) * 0.25 + 0.08 * math.sin(math.pi * t)
        vs.append(bm.verts.new(M @ Vector((x, t, z))))
    f = bm.faces.new(vs)
    for lp, (x, t) in zip(f.loops, ring):
        lp[uv].uv = (x, t); lp[col_layer] = col
    return f


def leaf_atlas(path, outline_fn=oak_leaf_outline, res=1024, grid=2, leaves=42, seed=5,
               greens=("#557a2c", "#628a33", "#6f963a", "#4a6c26"), dry="#9a9440",
               twig="#5b4a36", leaf_len=0.105, spread=0.36, samples=48, cell_tints=None):
    """Render grid x grid leaf-cluster variants top-down to an RGBA PNG (albedo x AO)."""
    rng = random.Random(seed); sc = bpy.context.scene
    made = []
    bm = bmesh.new(); uv = bm.loops.layers.uv.new("leaf")
    cl = bm.loops.layers.color.new("col")
    tw = bmesh.new()
    cell = 1.0 / grid
    for gi in range(grid * grid):
        tint = (cell_tints or [(1, 1, 1)] * (grid * grid))[gi]
        cx = (gi % grid + 0.5) * cell; cy = (gi // grid + 0.5) * cell
        C = Vector((cx, cy, 0))
        # twig skeleton: main stem + side shoots, rosettes at shoot tips
        tips = []; a0 = rng.uniform(0, 6.283)
        stem_dir = Vector((math.cos(a0), math.sin(a0), 0))
        base = C - stem_dir * spread * cell * 0.9
        segs = [(base, base + stem_dir * spread * cell * 1.3)]
        tips.append(segs[0][1])
        for k in range(rng.randint(3, 5)):
            t = rng.uniform(0.2, 0.85); p = base + stem_dir * spread * cell * 1.3 * t
            side = stem_dir.copy(); side.rotate(__import__("mathutils").Euler((0, 0, rng.choice((-1, 1)) * rng.uniform(0.5, 1.1))))
            q = p + side * spread * cell * rng.uniform(0.35, 0.7)
            segs.append((p, q)); tips.append(q)
        for p, q in segs:
            d = q - p; r = 0.004  # flat twig strip (only ever seen from above)
            ortho = Vector((-d.y, d.x, 0)).normalized() * r
            v = [tw.verts.new(p - ortho), tw.verts.new(p + ortho), tw.verts.new(q + ortho * 0.5), tw.verts.new(q - ortho * 0.5)]
            tw.faces.new(v)
        # leaves: rosettes at tips + some along stems
        for li in range(leaves):
            if li < len(tips) * 8:
                anchor = tips[li % len(tips)]; ang = rng.uniform(0, 6.283); lift = rng.uniform(0.0, 0.03)
            else:
                p, q = rng.choice(segs); anchor = p.lerp(q, rng.uniform(0.2, 1.0)); ang = rng.uniform(0, 6.283); lift = rng.uniform(0, 0.02)
            ln = leaf_len * cell * rng.uniform(0.75, 1.15) * 2.2
            # keep the whole leaf inside its atlas cell
            lim = cell / 2 - ln * 1.02
            anchor = Vector((min(max(anchor.x, cx - lim), cx + lim), min(max(anchor.y, cy - lim), cy + lim), 0))
            ang = math.atan2(anchor.y - cy, anchor.x - cx) - math.pi / 2 + rng.gauss(0, 0.6) if li % 3 else ang
            ol = outline_fn(rng)
            from mathutils import Matrix
            M = (Matrix.Translation(anchor + Vector((0, 0, 0.01 + lift + rng.random() * 0.03)))
                 @ Matrix.Rotation(ang, 4, "Z") @ Matrix.Rotation(rng.uniform(-0.35, 0.35), 4, "X")
                 @ Matrix.Rotation(rng.uniform(-0.25, 0.25), 4, "Y") @ Matrix.Scale(ln, 4))
            g = srgb(rng.choice(greens))
            if rng.random() < 0.08: g = srgb(dry)
            jit = rng.uniform(0.85, 1.15)
            _leaf_mesh(bm, ol, M, uv, cl, (g[0] * jit * tint[0], g[1] * jit * tint[1], g[2] * jit * tint[2], 1.0))
    me = bpy.data.meshes.new("leafclust"); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new("leafclust", me); sc.collection.objects.link(ob); made.append(ob)
    tme = bpy.data.meshes.new("twigs"); tw.to_mesh(tme); tw.free()
    tob = bpy.data.objects.new("twigs", tme); sc.collection.objects.link(tob); made.append(tob)
    # leaf material: vertex colour + midrib/vein + fine mottling
    m, n, l, b = L.mat("leafrender")
    ca = _n(n, "ShaderNodeVertexColor", layer_name="col")
    u = _n(n, "ShaderNodeUVMap", uv_map="leaf"); su = n.new("ShaderNodeSeparateXYZ"); l.new(u.outputs[0], su.inputs[0])
    ax = _math(n, l, "ABSOLUTE", su.outputs[0])
    rib = _math(n, l, "SUBTRACT", 1.0, _math(n, l, "DIVIDE", ax, 0.012), clamp=True)
    vein = _math(n, l, "SINE", _math(n, l, "MULTIPLY", _math(n, l, "SUBTRACT", su.outputs[1], _math(n, l, "MULTIPLY", ax, 1.2)), 50.0))
    vein = _math(n, l, "MULTIPLY", _math(n, l, "SUBTRACT", vein, 0.96), 6.0, clamp=True)
    vein = _math(n, l, "MULTIPLY", vein, _math(n, l, "SUBTRACT", 1.0, _math(n, l, "DIVIDE", ax, 0.25), clamp=True))
    mot = _n(n, "ShaderNodeTexNoise", in_Scale=30.0, in_Detail=4.0)
    geo = n.new("ShaderNodeNewGeometry"); l.new(geo.outputs["Position"], mot.inputs["Vector"])
    c = _mix(n, l, ca.outputs["Color"], srgb("#a3b56a"), _math(n, l, "MULTIPLY", _math(n, l, "ADD", rib, vein), 0.4))
    c = _mix(n, l, c, srgb("#3c5220"), _math(n, l, "MULTIPLY", mot.outputs["Fac"], 0.3))
    l.new(c, b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.7
    ob.data.materials.append(m)
    tm, tn, tl, tb = L.mat("twigrender"); tb.inputs["Base Color"].default_value = (*srgb(twig), 1)
    tob.data.materials.append(tm)
    # camera + uniform white sky -> albedo x AO
    cd = bpy.data.cameras.new("lc"); cd.type = "ORTHO"; cd.ortho_scale = 1.0
    cam = bpy.data.objects.new("lc", cd); sc.collection.objects.link(cam); made.append(cam)
    cam.location = (0.5, 0.5, 5); sc.camera = cam
    w = bpy.data.worlds.new("lw"); w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
    old_w = sc.world; sc.world = w
    r = sc.render; r.resolution_x = r.resolution_y = res; r.film_transparent = True
    r.image_settings.file_format = "PNG"; r.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"; sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    r.filepath = path; bpy.ops.render.render(write_still=True)
    for o in made: bpy.data.objects.remove(o, do_unlink=True)
    sc.world = old_w
    img = bpy.data.images.load(path, check_existing=False)
    _dilate_alpha(img); img.save()
    return img


def _dilate_alpha(img, iters=24):
    """Bleed RGB into transparent texels so mipmaps don't get dark fringes; sharpen alpha."""
    w, h = img.size
    px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(h, w, 4)
    a = px[..., 3]; solid = a > 0.5
    rgb = np.where(solid[..., None], px[..., :3], 0); wt = solid.astype(np.float32)
    for _ in range(iters):
        acc = np.zeros_like(rgb); wa = np.zeros_like(wt)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            acc += np.roll(np.roll(rgb * wt[..., None], dy, 0), dx, 1); wa += np.roll(np.roll(wt, dy, 0), dx, 1)
        fill = (wt == 0) & (wa > 0)
        rgb[fill] = acc[fill] / wa[fill][:, None]; wt[fill] = 1.0
    px[..., :3] = np.where(solid[..., None], px[..., :3], rgb)  # PNG is straight alpha already
    px[..., :3] = np.clip(px[..., :3], 0, 1)
    img.pixels.foreach_set(px.ravel())


# ---------------------------------------------------------------- cards
def scatter_cards(points, image, centre, radii, rng, size=(1.2, 1.9), grid=2, name="leaves",
                  outward_mix=0.75, up_bias=0.3, spread=0.35, two_layer=True, per_point=1,
                  jitter=0.5, cell_pick=None, facing_random=1.4):
    """cell_pick(out_dir, rng) -> atlas cell index (e.g. sunlit cells on the crown top)."""
    """points: list of (pos Vector, dir Vector). One quad per point, front face outward."""
    from mathutils import Quaternion
    bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap"); normals = []
    cell = 1.0 / grid
    pts2 = []
    for p, d in points:
        for k in range(per_point):
            j = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))) * (jitter if k else 0)
            pts2.append((p + j, d))
    for p, d in pts2:
        rel = p - centre
        out = Vector((rel.x / radii[0], rel.y / radii[1], rel.z / radii[2])).normalized()
        c = p + d.normalized() * spread * rng.random()
        rnd = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
        # geometric facing is mostly random (no edge-on slivers on the silhouette); SHADING normal stays outward
        nrm = (out * 1.0 + rnd * facing_random + Vector((0, 0, 0.35))).normalized()
        if nrm.dot(out) < 0: nrm = -nrm
        t1 = nrm.orthogonal().normalized(); t1.rotate(Quaternion(nrm, rng.uniform(0, 6.283)))
        t2 = nrm.cross(t1); s = rng.uniform(*size) / 2
        gi = cell_pick(out, rng) if cell_pick else rng.randrange(grid * grid); u0 = (gi % grid) * cell; v0 = (gi // grid) * cell
        flip = rng.random() < 0.5
        sn = (out * outward_mix + nrm * (1 - outward_mix) + Vector((0, 0, up_bias))).normalized()
        corners = ((-1, -1, 0, 0), (1, -1, 1, 0), (1, 1, 1, 1), (-1, 1, 0, 1))
        for side in ((1, -1) if two_layer else (1,)):
            # front layer offset toward its own face so whichever side you view from you hit
            # a FRONT face -> engines never flip the (outward) normal -> no black back-lit cards
            off = nrm * 0.004 * side
            order = corners if side > 0 else corners[::-1]
            vs = [bm.verts.new(c + off + (t1 * sx + t2 * sy) * s) for sx, sy, _, _ in order]
            f = bm.faces.new(vs)
            for lp, (_, _, a, b) in zip(f.loops, order):
                if flip: a = 1 - a
                lp[uv].uv = (u0 + a * cell, v0 + b * cell)
            normals.extend([sn] * 4)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.normals_split_custom_set_from_vertices(normals)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    ob["hg_nobake"] = True
    m = L.make_image_material(name + "_mat", image)
    m.use_backface_culling = two_layer   # glTF doubleSided=false: engines draw one layer per side
    L.assign(ob, m)
    return ob


def tip_points(sk, radius, r_leaf=0.03, stride=1, rng=random):
    """Leaf anchor points: thin nodes (twigs implied by cards). Returns [(pos, dir)]."""
    out = []
    for i, p in enumerate(sk.pos):
        if radius[i] <= r_leaf and sk.par[i] >= 0 and rng.random() < 1.0 / stride:
            out.append((p.copy(), p - sk.pos[sk.par[i]]))
    return out
