"""HIGHGROUND - shared kit for landscape features: rocks, boulders, outcrops, ore veins,
megaliths, springs, barrows, bog, quarry, ruined keep.

Built on _parish_kit (node-material builder G, Batch geometry, Face frames, walls, windows,
ground patches). Adds:
  * rock_geo / rock()   noise-displaced superellipsoid rock masses with crisp planar
                        fracture faces (bisected + chamfered), sunk into the ground.
  * m_rock()            natural rock material: 3-frequency colour, crystal speckle, strata,
                        cracks, rain streaks, crustose lichen rosettes, moss on up-faces.
  * m_turf, m_peat, m_pool, m_heap2, m_cloth2, m_ivy_* helpers.
  * done(name)          build batches, cleanup, stats; HG_PREVIEW=<path.glb> exports an
                        un-baked flat-colour preview GLB instead of baking (fast shape pass).

Variants and names come from env (the parish kit reserves argv for building STATE):
    HG_VAR=b blender -b -t 2 -P assets/src/boulder.py
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector, Matrix
from mathutils import noise as MN
import _lib as L
import _parish_kit as K
from _parish_kit import (G, B, Batch, BATCHES, MAT, R, jit, srgb, box, beam, cyl, prism_hull, hull, TRS, Face,
                         window, slit, putlogs, apply_boolean, cutter_obj, cleanup_bottoms, blob, ground_patch,
                         slab_poly, tussock, arch_profile, box_geo, quoins, m_stone, m_wood, m_simple, m_ground,
                         m_water, m_rope, begin)

# landscape pieces are authored centred on the origin at z=0; never re-centre (sunk rocks or a
# one-sided spoil heap would otherwise shift the pivot the map placed them by)
L.ground_origin = lambda objs: None

VAR = os.environ.get("HG_VAR", "")
PREVIEW = os.environ.get("HG_PREVIEW")
PCOL = {}          # material -> preview hex


# =====================================================================  rock geometry
def rock_geo(size, seed, blocky=2.6, amp=0.10, freq=1.1, cuts=2, cut_depth=(0.10, 0.28), cut_up=(-0.15, 0.75),
             sub=3, chamfer=0.035, squash_top=0.0, taper=0.0, lean=(0.0, 0.0), dents=0, facets=0,
             facet_depth=(0.04, 0.16), facet_soft=0.8, ridged=0.0, planes=()):
    """closed rock mass centred at origin, extents `size` (full x, y, z), un-sunk.
    blocky: superellipsoid exponent (2 = ellipsoid, 4+ = boxy tor block).
    cuts: planar fractures (normal elevation range cut_up) removing cut_depth of the support.
    taper: >0 narrows the top (standing stones), squash_top flattens the crown."""
    rng = random.Random(seed)
    sx, sy, sz = size
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    o = Vector((rng.uniform(-90, 90), rng.uniform(-90, 90), rng.uniform(-90, 90)))
    o2 = Vector((rng.uniform(-90, 90), rng.uniform(-90, 90), rng.uniform(-90, 90)))
    for v in bm.verts:
        d = v.co.normalized()
        s = (abs(d.x) ** blocky + abs(d.y) ** blocky + abs(d.z) ** blocky) ** (-1.0 / blocky)
        p = d * s
        n1 = MN.fractal(p * freq + o, 0.9, 2.1, 4)
        n2 = MN.noise(p * freq * 3.1 + o2)
        p = p * (1 + amp * n1 + amp * 0.25 * n2)
        if ridged:
            # erosion runnels: ridged noise cuts shallow grooves
            rn = 1.0 - abs(MN.noise(p * freq * 2.2 + o2 * 0.5))
            p = p * (1 - ridged * rn ** 6)
        if squash_top and p.z > 0:
            p.z *= 1 - squash_top * min(1.0, p.z)
        tz = (p.z + 1) / 2
        w = 1 - taper * tz * tz
        v.co = Vector((p.x * sx / 2 * w, p.y * sy / 2 * w, p.z * sz / 2))
    # soft facets: vertices beyond a random plane are pulled most of the way onto it (weathered
    # joint faces that are nearly flat but still undulate), then re-noised a little
    for k in range(facets):
        az = rng.uniform(0, 2 * math.pi)
        el = rng.uniform(-0.25, 0.9)
        n = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        sup = max(v.co.dot(n) for v in bm.verts)
        low = min(v.co.dot(n) for v in bm.verts)
        off = sup - (sup - low) * rng.uniform(*facet_depth)
        for v in bm.verts:
            dd = v.co.dot(n) - off
            if dd > 0:
                v.co -= n * dd * facet_soft
    if facets:
        bm.normal_update()
        for v in bm.verts:
            v.co += v.normal * MN.noise(v.co * 2.3 + o2) * amp * 0.12 * min(sx, sy, sz)
    # shallow scalloped dents (weathering hollows / solution basins)
    for k in range(dents):
        dv = Vector((rng.gauss(0, 1), rng.gauss(0, 1), abs(rng.gauss(0, 1)) + 0.3)).normalized()
        sup = max(v.co.dot(dv) for v in bm.verts)
        c = dv * sup
        r = min(sx, sy, sz) * rng.uniform(0.2, 0.35)
        dep = r * rng.uniform(0.12, 0.22)
        for v in bm.verts:
            dd = (v.co - c).length / r
            if dd < 1:
                v.co -= dv * dep * (1 - dd * dd) ** 2
    ext = max(sx, sy, sz)
    for k in range(cuts):
        az = rng.uniform(0, 2 * math.pi)
        el = rng.uniform(*cut_up)
        n = Vector((math.cos(az) * math.cos(el * 1.3), math.sin(az) * math.cos(el * 1.3), math.sin(el * 1.3))).normalized()
        sup = max(v.co.dot(n) for v in bm.verts)
        low = min(v.co.dot(n) for v in bm.verts)
        off = sup - (sup - low) * rng.uniform(*cut_depth)
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        r = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=n * off, plane_no=n, clear_outer=True, dist=1e-4)
        edges = [e for e in r["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        bnd = [e for e in bm.edges if e.is_boundary]
        if bnd:
            fr = bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
            nf = fr["faces"]
            if nf:
                bmesh.ops.triangulate(bm, faces=nf, quad_method="BEAUTY", ngon_method="BEAUTY")
        if chamfer > 0:
            ce = [e for e in bm.edges if e.is_valid and len(e.link_faces) == 2 and
                  e.calc_face_angle(0.0) > math.radians(35)]
            if ce:
                try:
                    bmesh.ops.bevel(bm, geom=ce, offset=chamfer * ext * rng.uniform(0.6, 1.2), segments=1,
                                    affect="EDGES", clamp_overlap=True, profile=0.5)
                except Exception:
                    pass
    # explicit exact cuts (worked quarry faces, bench tops): (point, outward normal), rock-local
    for (pc, pn) in planes:
        pn = Vector(pn).normalized()
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=pc, plane_no=pn, clear_outer=True, dist=1e-4)
        bnd = [e for e in bm.edges if e.is_boundary]
        if bnd:
            fr = bmesh.ops.holes_fill(bm, edges=bnd, sides=0)
            if fr["faces"]:
                bmesh.ops.triangulate(bm, faces=fr["faces"], quad_method="BEAUTY", ngon_method="BEAUTY")
    if lean != (0.0, 0.0):
        M = Matrix.Rotation(lean[0], 4, "X") @ Matrix.Rotation(lean[1], 4, "Y")
        bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def rock(bt, c, size, seed, yaw=None, sink=0.15, rnd=None, **kw):
    """rock mass sitting at ground point c, `sink` fraction of its height buried (base cut at z=c.z,
    or z=0 when c.z is 0). Returns (lo, hi) world bbox."""
    bm = rock_geo(size, seed, **kw)
    c = Vector(c)
    yaw = R.uniform(0, 2 * math.pi) if yaw is None else yaw
    bmesh.ops.transform(bm, matrix=Matrix.Rotation(yaw, 4, "Z"), verts=bm.verts)
    zmin = min(v.co.z for v in bm.verts)
    zmax = max(v.co.z for v in bm.verts)
    shift = Vector((c.x, c.y, c.z - zmin - sink * (zmax - zmin)))
    bmesh.ops.translate(bm, vec=shift, verts=bm.verts)
    ground = 0.0 if c.z <= 0.001 else None
    if ground is not None:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0.0), plane_no=(0, 0, -1), clear_outer=True, dist=1e-4)
    P = [tuple(v.co) for v in bm.verts]
    idx = {v: i for i, v in enumerate(bm.verts)}
    F = [[idx[v] for v in f.verts] for f in bm.faces]
    lo = Vector((min(p[0] for p in P), min(p[1] for p in P), min(p[2] for p in P)))
    hi = Vector((max(p[0] for p in P), max(p[1] for p in P), max(p[2] for p in P)))
    bm.free()
    # loc = rock-local coords (unrotated centre) so per-rock material noise stays with the rock
    bt.add(P, F, None, rnd, [(p[0] - c.x, p[1] - c.y, p[2] - c.z) for p in P])
    return lo, hi


def scatter_stones(bt, cx, cy, rx, ry, n, smin, smax, seed, z=0.0, blocky=2.4, flat=0.6, sink=0.2, sub=1, cuts=1):
    """small loose stones / scree in an ellipse (cheap: icosphere sub 1)."""
    rng = random.Random(seed)
    for i in range(n):
        a = rng.uniform(0, 2 * math.pi)
        rr = math.sqrt(rng.random())
        x, y = cx + math.cos(a) * rr * rx, cy + math.sin(a) * rr * ry
        s = rng.uniform(smin, smax)
        rock(bt, (x, y, z), (s * rng.uniform(0.9, 1.4), s * rng.uniform(0.8, 1.1), s * flat * rng.uniform(0.7, 1.2)),
             seed * 1000 + i, sink=sink, sub=sub, blocky=blocky, amp=0.12, cuts=cuts, chamfer=0.0)


# =====================================================================  materials
def lichen(g, col, P, N, density=0.5, amount=1.0, scale=6.0, tones=("#a3a78c", "#bdb9a4", "#c29a45"), up_boost=0.6,
           rough=None, mask=None):
    """crustose lichen: irregular lobed rosettes of varied size that merge into colonies, plus broad
    pale map-lichen crusts on lit faces. Returns (col, lichen_mask)."""
    nx, ny, nz = g.sep(N)
    tot = None
    face = g.clamp(g.add(g.mr(nz, -0.6, 0.1), g.mul(g.mr(nz, 0.2, 0.9), up_boost)))
    for k, (sc, dens) in enumerate(((scale, density), (scale * 2.3, density * 0.7), (scale * 5.5, density * 0.35))):
        Pk = g.node("ShaderNodeVectorMath", [(0, P), (1, (k * 3.7, k * 1.3, k * 5.1))], operation="ADD").outputs[0]
        # domain warp so rosettes are lobed, not coins
        wv = g.node("ShaderNodeTexNoise", [("Vector", Pk), ("Scale", sc * 1.7), ("Detail", 3.0)]).outputs["Color"]
        Pw = g.node("ShaderNodeVectorMath", [(0, Pk), (1, g.vmul(g.node("ShaderNodeVectorMath", [(0, wv), (1, (-0.5, -0.5, -0.5))],
                                                                         operation="ADD").outputs[0], (0.55 / sc,) * 3))],
                    operation="ADD").outputs[0]
        vn = g.node("ShaderNodeTexVoronoi", [("Vector", Pw), ("Scale", sc), ("Randomness", 0.9)], feature="F1")
        d, cc = vn.outputs["Distance"], vn.outputs["Color"]
        cr, cg, cb = g.sep(cc)
        present = g.gt(cr, 1.0 - dens)
        rad = g.add(0.14, g.mul(g.mul(cg, cg), 0.5))
        d2 = g.add(d, g.mul(g.sub(g.noise(Pk, sc * 7.0, 3), 0.5), 0.1))
        spot = g.mul(g.inv(g.mr(d2, g.mul(rad, 0.75), rad)), present)
        rim = g.mul(g.mul(g.mr(d2, g.mul(rad, 0.5), g.mul(rad, 0.78)), spot), 0.45)
        c = g.ramp(cb, [(0.0, tones[0]), (0.5, tones[0]), (0.51, tones[1]), (0.88, tones[1]), (0.89, tones[2]), (1.0, tones[2])])
        c = g.mix(0.25, c, g.noise(Pk, sc * 12.0, 3), "OVERLAY")
        c = g.mix(rim, c, g.mix(1.0, c, (1.12, 1.12, 1.1, 1), "MULTIPLY"))
        zone = g.mr(g.noise(P, 0.4 + k * 0.25, 3), 0.36, 0.56)
        m = g.mul(g.mul(spot, zone), face)
        if mask is not None:
            m = g.mul(m, mask)
        m = g.mul(m, amount)
        col = g.mix(m, col, c)
        tot = m if tot is None else g.mx(tot, m)
    # broad pale crusts (map lichen) with dark prothallus lines between colonies
    crust = g.noise(P, 1.1, 5, 0.65)
    cm = g.mul(g.mul(g.mr(crust, 0.56, 0.6), g.mr(g.noise(P, 0.3, 2), 0.45, 0.6)), g.mul(face, amount * 0.85))
    if mask is not None:
        cm = g.mul(cm, mask)
    edge = g.mul(g.mul(g.mr(crust, 0.54, 0.56), g.inv(g.mr(crust, 0.56, 0.58))), cm)
    col = g.mix(g.mul(cm, 0.7), col, g.mix(0.3, tones[1], g.noise(P, 40.0, 3), "OVERLAY"))
    col = g.mix(g.mul(edge, 0.8), col, "#2f2c28")
    tot = g.mx(tot, cm)
    return col, tot


def m_rock(name, tones, speck=0.5, speck_scale=110.0, speck_light="#c8c0b0", speck_dark="#34312d", lichen_d=0.45,
           lichen_amt=0.9, moss=0.6, strata=0.0, strata_scale=2.2, strata_tones=None, cracks=0.6, streaks=0.5,
           stain=None, bump=1.0, preview=None, grime=True, lichen_tones=("#a3a78c", "#bdb9a4", "#c29a45"),
           lichen_scale=6.0, rough=0.86, pits=0.3, extra=None):
    """natural rock. stain = (hex_a, hex_b, amount, scale) iron/limonite staining in blotches + runs.
    extra(g, col, h) -> (col, h) hook for ore flecks etc."""
    g = G(name)
    P, N = g.P, g.N
    x, y, z = g.sep(P)
    nx, ny, nz = g.sep(N)
    vert = g.inv(g.mr(g.math("ABSOLUTE", nz), 0.6, 0.9))
    up = g.mr(nz, 0.35, 0.85)
    blot = g.noise(P, 0.28, 4)
    mid = g.noise(P, 1.9, 5, 0.6)
    col = g.ramp(g.add(g.mul(blot, 0.75), g.mul(mid, 0.45)), tones)
    # weathering drift: warm buff (iron-leached rind) vs cool blue-grey fresh faces
    drift = g.noise(P, 0.18, 3)
    col = g.mix(g.mul(g.mr(drift, 0.52, 0.7), 0.45), col, g.mix(1.0, col, (1.12, 1.02, 0.86, 1), "MULTIPLY"))
    col = g.mix(g.mul(g.mr(drift, 0.46, 0.32), 0.35), col, g.mix(1.0, col, (0.92, 0.96, 1.04, 1), "MULTIPLY"))
    if strata > 0:
        # bedding: beds of irregular thickness (strata_scale beds per metre), each its own tone,
        # with a dark recessed parting between beds and a slight dip
        zz = g.add(g.add(z, g.mul(x, 0.06)), g.mul(g.sub(g.noise(P, 0.35, 2), 0.5), 0.5))
        bz = g.mul(zz, strata_scale)
        bid = g.math("FLOOR", bz)
        tone = g.white(g.comb(bid, 7.3, 1.1))
        sc = g.ramp(tone, strata_tones or [(0.2, "#5f5a52"), (0.8, "#8a8276")])
        col = g.mix(g.mul(strata, 0.75), col, sc)
        fr = g.math("FRACT", bz)
        parting = g.inv(g.mr(g.mn(fr, g.sub(1.0, fr)), 0.0, 0.07))
        parting = g.mul(parting, g.mr(g.noise(P, 1.5, 3), 0.3, 0.5))
        col = g.mix(g.mul(parting, 0.6 * strata), col, g.mix(1.0, col, (0.45, 0.42, 0.4, 1), "MULTIPLY"))
        g._parting = g.mul(parting, strata)
    fine = g.noise(P, 38.0, 6, 0.62)
    col = g.mix(0.4, col, fine, "OVERLAY")
    if speck > 0:
        vn = g.node("ShaderNodeTexVoronoi", [("Vector", P), ("Scale", speck_scale), ("Randomness", 1.0)], feature="F1")
        cr = g.sep(vn.outputs["Color"])[0]
        sd = vn.outputs["Distance"]
        grain = g.inv(g.mr(sd, 0.25, 0.55))
        col = g.mix(g.mul(g.mul(g.gt(cr, 0.8), grain), speck), col, speck_light)
        col = g.mix(g.mul(g.mul(g.math("LESS_THAN", cr, 0.16), grain), speck), col, speck_dark)
    # cavity / pitting
    pit = g.inv(g.mr(g.vor(P, 16.0), 0.0, 0.12))
    col = g.mix(g.mul(pit, pits), col, g.mix(1.0, col, (0.55, 0.55, 0.55, 1), "MULTIPLY"))
    # joint cracks
    cr_ = g.vor(g.add(P, g.vmul(g.node("ShaderNodeTexNoise", [("Vector", P), ("Scale", 1.2)]).outputs["Color"], (0.35, 0.35, 0.35))),
                1.4, "DISTANCE_TO_EDGE")
    crack = g.mul(g.inv(g.mr(cr_, 0.0, 0.03)), g.mr(g.noise(P, 0.9, 3), 0.42, 0.55))
    col = g.mix(g.mul(crack, 0.85 * cracks), col, "#2c2925")
    if stain:
        ha, hb, amt, ssc = stain
        sm = g.mr(g.add(g.noise(P, ssc, 5, 0.62), g.mul(g.sub(g.noise(P, ssc * 5, 3), 0.5), 0.3)), 0.5, 0.66)
        run = g.mr(g.noise(g.comb(g.mul(x, 3.5), g.mul(y, 3.5), g.mul(z, 0.25)), 1.0, 4), 0.55, 0.72)
        sm = g.clamp(g.add(sm, g.mul(g.mul(run, vert), 0.6)))
        scol = g.ramp(g.noise(P, ssc * 3.0, 4), [(0.3, ha), (0.75, hb)])
        col = g.mix(g.mul(sm, amt), col, scol)
    # rain streaks down vertical faces
    st = g.noise(g.comb(g.mul(x, 2.8), g.mul(y, 2.8), g.mul(z, 0.12)), 1.0, 3)
    col = g.mix(g.mul(g.mul(g.mr(st, 0.52, 0.74), vert), 0.55 * streaks), col, g.mix(1.0, col, (0.62, 0.62, 0.6, 1), "MULTIPLY"))
    h = g.add(g.mul(mid, 0.9), g.mul(fine, 0.35))
    if extra:
        col, h = extra(g, col, h)
    lmask = g.inv(g._groove) if getattr(g, "_groove", None) is not None else None
    col, lm = lichen(g, col, P, N, lichen_d, lichen_amt, lichen_scale, lichen_tones, mask=lmask)
    # moss cushions on up-faces and in the lee
    mz = g.mul(g.mul(up, g.mr(g.noise(P, 0.9, 4), 0.42, 0.58)), moss)
    mossc = g.ramp(g.noise(P, 7.0, 4), [(0.25, "#3c4623"), (0.6, "#56602f"), (0.9, "#707840")])
    col = g.mix(mz, col, mossc)
    if grime:
        col, md, mb = g.ground_grime(col, z, vert, moss * 0.8, 0.3)
    h = g.sub(h, g.mul(crack, 1.2 * cracks))
    if strata > 0:
        h = g.sub(h, g.mul(g._parting, 1.2))
    h = g.sub(h, g.mul(pit, 0.4))
    h = g.add(h, g.mul(lm, 0.12))
    h = g.add(h, g.mul(mz, g.mul(g.noise(P, 30.0, 4), 0.9)))
    rgh = g.add(rough, g.mul(mz, 0.08))
    PCOL[name] = preview or tones[len(tones) // 2][1]
    return g.out(col, rgh, h, 1.0, 0.03 * bump)


def m_turf(name, dry=0.3, tones=None, wet=0.0, flowers=0.0, ring=None, bare=1.0):
    """rough upland grass sward over lumpy ground: tussocky mottling, straw, blade streaks."""
    g = G(name)
    P, N = g.P, g.N
    x, y, z = g.sep(P)
    nx, ny, nz = g.sep(N)
    big = g.noise(P, 0.35, 4)
    tus = g.vor(P, 4.5, "F1")
    col = g.ramp(g.add(g.mul(big, 0.7), g.mul(tus, 0.35)),
                 tones or [(0.15, "#3f4b25"), (0.45, "#56652f"), (0.7, "#667238"), (0.95, "#7d7a44")])
    straw = g.mul(g.mr(g.noise(P, 1.6, 4), 0.55, 0.7), dry)
    col = g.mix(straw, col, g.ramp(g.noise(P, 12.0, 3), [(0.3, "#8a7d4e"), (0.8, "#a39462")]))
    blades = g.noise(g.comb(g.mul(x, 70.0), g.mul(y, 70.0), g.mul(z, 16.0)), 1.0, 4, 0.7)
    col = g.mix(0.55, col, blades, "OVERLAY")
    # tussock crowns darker in their centres, lit tips
    col = g.mix(g.mul(g.inv(g.mr(tus, 0.0, 0.3)), 0.35), col, "#2f3a1c")
    # bare earth where slopes steepen (sheep scars) and soil showing at the very rim
    steep = g.mr(nz, 0.75, 0.45)
    bare = g.mul(g.mul(steep, g.mr(g.noise(P, 1.4, 3), 0.45, 0.6)), bare)
    soil = g.ramp(g.noise(P, 5.0, 3), [(0.3, "#4a3a2a"), (0.8, "#62503a")])
    col = g.mix(bare, col, soil)
    if ring:
        # a fairy ring: a band of darker, lusher sward (and paler, starved grass just inside it)
        rr, rw = ring
        dist = g.math("SQRT", g.add(g.mul(x, x), g.mul(y, y)))
        dist = g.add(dist, g.mul(g.sub(g.noise(P, 0.8, 3), 0.5), rw * 0.8))
        band = g.inv(g.mr(g.math("ABSOLUTE", g.sub(dist, rr)), rw * 0.3, rw))
        inner = g.mul(g.mul(g.inv(g.mr(g.math("ABSOLUTE", g.sub(dist, rr - rw * 1.3)), rw * 0.2, rw * 0.7)), 0.4),
                      g.mr(g.noise(P, 1.3, 3), 0.35, 0.6))
        band = g.mul(band, g.add(0.55, g.mul(g.noise(P, 2.0, 3), 0.6)))
        col = g.mix(g.mul(band, 0.8), col, g.ramp(g.noise(P, 9.0, 3), [(0.3, "#2e3d1a"), (0.8, "#3f5222")]))
        col = g.mix(inner, col, g.ramp(g.noise(P, 11.0, 3), [(0.3, "#7d7a4c"), (0.8, "#94905c")]))
    if flowers > 0:
        fl = g.inv(g.mr(g.vor(P, 55.0), 0.0, 0.1))
        fl = g.mul(fl, g.mr(g.noise(P, 1.0, 3), 0.55, 0.62))
        col = g.mix(g.mul(fl, flowers), col, "#d8cf9a")
    if wet > 0:
        wetm = g.mul(g.mr(z, 0.25, 0.02), wet)
        col = g.mix(g.mul(wetm, 0.4), col, g.mix(1.0, col, (0.6, 0.6, 0.55, 1), "MULTIPLY"))
    h = g.add(g.mul(g.inv(g.mr(tus, 0.0, 0.5)), 0.6), g.mul(blades, 0.5))
    h = g.add(h, g.mul(big, 0.6))
    PCOL[name] = "#56652f"
    return g.out(col, g.sub(0.93, g.mul(wet, 0.1) if wet else 0.0), h, 1.0, 0.035)


def m_peat(name, cut=0.5):
    """dark wet peat: fibrous layered cut faces (spade marks), crumbly tops."""
    g = G(name)
    P, N = g.P, g.N
    x, y, z = g.sep(P)
    nx, ny, nz = g.sep(N)
    vert = g.inv(g.mr(g.math("ABSOLUTE", nz), 0.5, 0.85))
    col = g.ramp(g.noise(P, 1.2, 4), [(0.2, "#2a1f17"), (0.55, "#3a2b1f"), (0.85, "#4b3826")])
    fib = g.node("ShaderNodeTexWave", [("Vector", g.comb(x, y, g.mul(z, 1.0))), ("Scale", 14.0), ("Distortion", 6.0),
                                       ("Detail", 4.0)], bands_direction="Z").outputs[1]
    col = g.mix(g.mul(vert, 0.45), col, g.ramp(fib, [(0.2, "#271c14"), (0.8, "#4e3a28")]))
    spade = g.node("ShaderNodeTexWave", [("Vector", P), ("Scale", 3.0), ("Distortion", 0.6)], bands_direction="X").outputs[1]
    col = g.mix(g.mul(g.mul(vert, g.mr(spade, 0.8, 0.95)), 0.35 * cut), col, "#1d1510")
    fine = g.noise(P, 40.0, 5, 0.65)
    col = g.mix(0.35, col, fine, "OVERLAY")
    roots = g.mul(g.inv(g.mr(g.noise(g.comb(g.mul(x, 18), g.mul(y, 18), g.mul(z, 2)), 1.0, 3), 0.0, 0.04)), 0.6)
    col = g.mix(g.mul(roots, vert), col, "#6e5b3e")
    h = g.add(g.mul(g.noise(P, 6.0, 4), 0.6), g.mul(g.mul(fib, vert), 0.5))
    PCOL[name] = "#3a2b1f"
    return g.out(col, 0.72, h, 1.0, 0.02)


def m_pool(name, deep="#1d1a14", shallow="#3a2f20", scum=None, scum_amt=0.0, edge_r=None):
    """still bog / spring water: dark tea-brown, low roughness. scum = (hexa, hexb) ochre or
    duckweed film in drifts (rough, matte); edge_r = (cx, cy, r) thickens the film toward the rim."""
    g = G(name)
    P = g.P
    x, y, z = g.sep(P)
    col = g.ramp(g.noise(P, 0.6, 3), [(0.3, deep), (0.8, shallow)])
    rip = g.noise(g.comb(g.mul(x, 1.0), g.mul(y, 1.0), 0.0), 7.0, 3)
    rough = 0.05
    h = g.mul(rip, 0.15)
    if scum:
        drift = g.add(g.noise(P, 0.9, 4, 0.6), g.mul(g.noise(P, 6.0, 3), 0.25))
        if edge_r:
            cx, cy, r = edge_r
            dx, dy = g.sub(x, cx), g.sub(y, cy)
            dist = g.math("SQRT", g.add(g.mul(dx, dx), g.mul(dy, dy)))
            drift = g.add(drift, g.mul(g.mr(dist, r * 0.3, r), 0.35))
        sm = g.mul(g.mr(drift, 0.62 - scum_amt * 0.25, 0.7 - scum_amt * 0.25), 1.0)
        cells = g.inv(g.mr(g.vor(P, 30.0, "DISTANCE_TO_EDGE"), 0.0, 0.06))
        sc = g.ramp(g.add(g.noise(P, 4.0, 4), g.mul(cells, 0.3)), [(0.25, scum[0]), (0.8, scum[1])])
        # iridescent-looking broken film: paler plates cut by dark cracks
        sc = g.mix(g.mul(cells, 0.5), sc, g.mix(1.0, sc, (0.55, 0.5, 0.45, 1), "MULTIPLY"))
        col = g.mix(sm, col, sc)
        rough = g.add(0.05, g.mul(sm, 0.75))
        h = g.add(h, g.mul(sm, g.sub(0.6, g.mul(cells, 0.6))))
    PCOL[name] = "#2a241a"
    return g.out(col, rough, h, 0.4, 0.01)


def m_loose(name, tones, lump=12.0, rough=0.9, moss=0.0, grass=0.0, pebble=0.4, peb_tones=("#6f6a62", "#9a9284"),
            stain=None):
    """loose stuff: spoil, scree, dug earth, ore. voronoi lumps + pebbles + optional grass creep."""
    g = G(name)
    P = g.P
    x, y, z = g.sep(P)
    cell = g.node("ShaderNodeTexVoronoi", [("Vector", P), ("Scale", lump), ("Randomness", 1.0)], feature="F1")
    cd, cc = cell.outputs["Distance"], cell.outputs["Color"]
    cr = g.sep(cc)[0]
    col = g.ramp(g.add(g.mul(cr, 0.5), g.mul(g.noise(P, 0.9, 3), 0.6)), tones)
    fine = g.noise(P, lump * 4.0, 5, 0.6)
    col = g.mix(0.35, col, fine, "OVERLAY")
    col = g.mix(0.4, col, g.noise(P, 0.25, 2), "OVERLAY")
    edge = g.mr(cd, 0.25, 0.6)
    col = g.mix(g.mul(edge, 0.4), col, g.mix(1.0, col, (0.6, 0.6, 0.6, 1), "MULTIPLY"))
    if pebble > 0:
        pv = g.node("ShaderNodeTexVoronoi", [("Vector", P), ("Scale", lump * 0.5), ("Randomness", 1.0)], feature="F1")
        pb = g.inv(g.mr(pv.outputs["Distance"], 0.05, 0.28))
        pc = g.ramp(g.sep(pv.outputs["Color"])[1], [(0.2, peb_tones[0]), (0.8, peb_tones[1])])
        col = g.mix(g.mul(pb, pebble), col, pc)
    if stain:
        sm = g.mul(g.mr(g.noise(P, 1.3, 4), 0.5, 0.65), stain[1])
        col = g.mix(sm, col, stain[0])
    if grass > 0:
        gm = g.mul(g.mr(g.add(g.noise(P, 0.7, 4), g.mul(g.mr(z, 0.6, 0.0), 0.25)), 0.56, 0.66), grass)
        col = g.mix(gm, col, g.ramp(g.noise(P, 9.0, 3), [(0.3, "#46512a"), (0.7, "#66703b")]))
    if moss > 0:
        mo = g.mul(g.mr(g.noise(P, 1.3, 4), 0.55, 0.68), moss)
        col = g.mix(mo, col, "#56602f")
    h = g.add(g.mul(g.inv(g.mr(cd, 0.0, 0.5)), 0.8), g.mul(fine, 0.3))
    PCOL[name] = tones[len(tones) // 2][1]
    return g.out(col, rough, h, 1.0, 0.03)


def m_cloth2(name, hexa, hexb, dirt=0.5):
    """faded, rain-rotted rag cloth (offerings)."""
    g = G(name)
    P = g.P
    x, y, z = g.sep(P)
    loc, rnd = g.attr("hg_loc")[0], g.attr("hg_rnd")[1]
    col = g.ramp(rnd, [(0.0, hexa), (0.5, hexb), (1.0, hexa)])
    weave = g.noise(P, 160.0, 2)
    col = g.mix(0.3, col, weave, "OVERLAY")
    stain = g.mr(g.noise(P, 6.0, 4), 0.45, 0.7)
    col = g.mix(g.mul(stain, dirt), col, g.mix(1.0, col, (0.6, 0.55, 0.48, 1), "MULTIPLY"))
    PCOL[name] = hexb
    return g.out(col, 0.95, weave, 0.5, 0.003)


def m_wood2(name, tones, **kw):
    m = m_wood(name, tones, **kw)
    PCOL[name] = tones[1][1]
    return m


def m_simple2(name, a, b, rough=0.8, scale=2.0, rust=False):
    m = m_simple(name, a, b, rough, scale, rust)
    PCOL[name] = a
    return m


def m_stone2(name, tones, mortar, **kw):
    m = m_stone(name, tones, mortar, **kw)
    PCOL[name] = tones[1][1]
    return m


# =====================================================================  foliage cards
def leaf_atlas(png, cells, force=False, res=1024, seed=7):
    import _veg as V
    return V.load_or_make(os.path.join(L.TEX_DIR, png), lambda: V.atlas(os.path.join(L.TEX_DIR, png), cells, res=res,
                                                                          seed=seed), force)


def ivy_outline(rng, n=80):
    """Hedera helix juvenile leaf: 3-5 triangular lobes on a cordate base."""
    lobes = rng.choice((1.0, 1.0, 1.5))
    out = []
    for i in range(n + 1):
        t = i / n
        env = math.sin(math.pi * t ** 0.75) ** 0.7 * 0.5
        lob = 0.55 + 0.45 * abs(math.cos(math.pi * (t * 2.0 * lobes + 0.1)))
        out.append((env * (lob if t < 0.8 else 1.0) * (1.15 - 0.5 * t), t))
    out[0] = (0.06, 0.0); out[-1] = (0.0, 1.0)
    return out


def cards_obj(name, quads, image, lod=0):
    """quads: list of (centre, normal, up, w, h, cell, grid). Two-layer cards like T.scatter_cards."""
    bm = bmesh.new(); uv = bm.loops.layers.uv.new("UVMap"); normals = []
    for (c, nrm, up, w, h, cell, grid) in quads:
        c, nrm, up = Vector(c), Vector(nrm).normalized(), Vector(up)
        t1 = up.cross(nrm).normalized()
        t2 = nrm.cross(t1).normalized()
        cs = 1.0 / grid
        u0 = (cell % grid) * cs; v0 = (cell // grid) * cs
        flip = R.random() < 0.5
        corners = ((-1, -1, 0, 0), (1, -1, 1, 0), (1, 1, 1, 1), (-1, 1, 0, 1))
        for side in (1, -1):
            off = nrm * 0.004 * side
            order = corners if side > 0 else corners[::-1]
            vs = [bm.verts.new(c + off + t1 * sx * w / 2 + t2 * sy * h / 2) for sx, sy, _, _ in order]
            f = bm.faces.new(vs)
            for lp, (_, _, a, b) in zip(f.loops, order):
                if flip: a = 1 - a
                lp[uv].uv = (u0 + a * cs, v0 + b * cs)
            normals.extend([(nrm + Vector((0, 0, 0.3))).normalized()] * 4)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.normals_split_custom_set_from_vertices(normals)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    ob["hg_nobake"] = True
    ob["hg_lod"] = lod
    m = L.make_image_material(name + "_mat", image)
    m.use_backface_culling = True
    L.assign(ob, m)
    return ob


# =====================================================================  finish
def build_batches():
    for k, v in list(BATCHES.items()):
        if isinstance(v, tuple):
            s, c = v
            ob = s.build()
            if c is not None and c.F:
                apply_boolean(ob, cutter_obj(c))
        elif not k.startswith("_") and not getattr(v, "_built", False):
            v.build()


def done(name, tex=1024, lods=(1.0, 0.4, 0.12)):
    build_batches()
    # nothing below grade: buried ends (a spade blade, a toppled slab) are flattened onto z=0 so the
    # asset's lowest point is the ground it is placed on
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and not o.hide_render:
            for v in o.data.vertices:
                if v.co.z < 0.0:
                    v.co.z = 0.0
    cleanup_bottoms()
    stats = {}
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and not o.hide_render and not o.get("hg_nobake"):
            k = o.data.materials[0].name if o.data.materials else "?"
            a = sum(p.area for p in o.data.polygons)
            t, aa = stats.get(k, (0, 0))
            stats[k] = (t + sum(len(p.vertices) - 2 for p in o.data.polygons), aa + a)
    tot = 0
    for k, (t, a) in sorted(stats.items(), key=lambda x: -x[1][0]):
        print("HG_STAT %-12s tris %6d area %7.1f" % (k, t, a)); tot += t
    cards = [o for o in bpy.context.scene.objects if o.type == "MESH" and "hg_lod" in o.keys()]
    ctris = sum(len(o.data.polygons) for o in cards if o["hg_lod"] == 0)
    print("HG_TRIS_PRE", tot, "cards_LOD0", ctris)
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and not o.hide_render:
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c); lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    print("HG_BBOX", tuple(round(v, 2) for v in lo), tuple(round(v, 2) for v in hi))
    for o in [o for o in bpy.context.scene.objects if o.hide_render]:
        bpy.data.objects.remove(o, do_unlink=True)
    if os.environ.get("HG_DRY"):
        return
    if PREVIEW:
        cache = {}
        for o in bpy.context.scene.objects:
            o.select_set(o.type == "MESH")
            if o.type == "MESH" and not o.get("hg_nobake"):
                mn = o.data.materials[0].name if o.data.materials else "?"
                if mn not in cache:
                    m = bpy.data.materials.new("pv_" + mn)
                    m.use_nodes = True
                    b = m.node_tree.nodes["Principled BSDF"]
                    b.inputs["Base Color"].default_value = srgb(PCOL.get(mn, "#808080"))
                    b.inputs["Roughness"].default_value = 0.9
                    cache[mn] = m
                o.data.materials.clear(); o.data.materials.append(cache[mn])
        for o in bpy.context.scene.objects:
            if o.type == "MESH" and not o.get("hg_nobake"):
                bpy.context.view_layer.objects.active = o
                bpy.ops.object.select_all(action="DESELECT"); o.select_set(True)
                bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
        for o in bpy.context.scene.objects:
            o.select_set(o.type == "MESH")
        bpy.ops.export_scene.gltf(filepath=PREVIEW, use_selection=True)
        print("HG_PREVIEW", PREVIEW)
        return
    tex = int(os.environ.get("HG_TEX", tex))
    for o in cards: o.hide_render = True
    path = L.finish(name, tex=tex, lods=lods)
    if cards:
        for o in cards:
            o.hide_render = False
            o.name = f"{name}_{o.get('hg_tag', 'cards')}_LOD{int(o['hg_lod'])}"
        sel = [o for o in bpy.context.scene.objects if o.type == "MESH"]
        bpy.ops.object.select_all(action="DESELECT")
        for o in sel: o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_apply=True,
                                  export_image_format="JPEG", export_jpeg_quality=90)
        print("HG_CARDS", {o.name: len(o.data.polygons) for o in cards})
    return path


# =====================================================================  material presets
GRANITE = [(0.0, "#67635d"), (0.3, "#77736c"), (0.55, "#858078"), (0.8, "#948e84"), (1.0, "#726e68")]


def mat_granite(name="granite", **kw):
    a = dict(speck=0.55, speck_scale=120.0, speck_light="#bdb5a6", speck_dark="#2f2d2a", lichen_d=0.5,
             lichen_amt=0.95, moss=0.85, cracks=0.5, streaks=0.6)
    a.update(kw)
    MAT[name] = m_rock(name, GRANITE, **a)
    return MAT[name]


def mat_turf(name="turf", **kw):
    MAT[name] = m_turf(name, **kw)
    return MAT[name]


def base_tufts(cx, cy, rx, ry, n, seed, bt=None, s=(0.6, 1.1)):
    """grass tussocks hugging a rock foot (hides the hard terrain seam)."""
    rng = random.Random(seed)
    bt = bt or B("tuft", "turf")
    for i in range(n):
        a = rng.uniform(0, 2 * math.pi)
        rr = rng.uniform(0.92, 1.12)
        tussock(bt, cx + math.cos(a) * rx * rr, cy + math.sin(a) * ry * rr, 0.0, rng.uniform(*s), blades=9)


# =====================================================================  megaliths
MEGA = [(0.0, "#716b61"), (0.3, "#827b6f"), (0.55, "#8f887b"), (0.8, "#9b9384"), (1.0, "#7a7468")]


def carving(spirals=(), cups=(), depth=1.0, wear=0.6, clean=False):
    """extra() hook for m_rock: pecked spirals / cup-and-ring marks on the -Y face, in hg_loc space.
    spirals: (u, v, R, turns, sense); cups: (u, v, r_cup, rings). Returns hook producing a groove mask
    that darkens slightly, is kept free of lichen (the carving stays strangely clean) and is recessed."""
    def hook(g, col, h):
        loc = g.attr("hg_loc")[0]
        lx, ly, lz = g.sep(loc)
        nx, ny, nz = g.sep(g.N)
        face = g.mr(ny, -0.25, -0.6)
        groove = 0.0
        for (u0, v0, Rr, turns, sense) in spirals:
            du, dv = g.sub(lx, u0), g.sub(lz, v0)
            r = g.math("SQRT", g.add(g.mul(du, du), g.mul(dv, dv)))
            th = g.math("ARCTAN2", dv, g.mul(du, sense))
            pitch = Rr / turns
            ph = g.math("FRACT", g.sub(g.math("DIVIDE", r, pitch), g.math("DIVIDE", th, 2 * math.pi)))
            # wobble the line a little: it was pecked by hand
            ph = g.add(ph, g.mul(g.sub(g.noise(loc, 9.0, 2), 0.5), 0.12))
            line = g.inv(g.mr(g.math("ABSOLUTE", g.sub(ph, 0.5)), 0.04, 0.24))
            line = g.mul(line, g.inv(g.mr(r, Rr * 0.92, Rr * 1.02)))
            groove = g.mx(groove, line) if not isinstance(groove, float) else line
        for (u0, v0, rc, rings) in cups:
            du, dv = g.sub(lx, u0), g.sub(lz, v0)
            r = g.math("SQRT", g.add(g.mul(du, du), g.mul(dv, dv)))
            cup = g.inv(g.mr(r, rc * 0.7, rc))
            for k in range(1, rings + 1):
                rr = rc + k * rc * 1.1
                cup = g.mx(cup, g.inv(g.mr(g.math("ABSOLUTE", g.sub(r, rr)), rc * 0.18, rc * 0.4)))
            groove = g.mx(groove, cup) if not isinstance(groove, float) else cup
        groove = g.mul(groove, face)
        # four thousand winters: the pecking is worn soft and gone altogether in patches
        groove = g.mul(groove, g.add(g.mul(g.mr(g.noise(loc, 2.2, 3), 0.35, 0.6), wear), 1.0 - wear))
        # pecked texture inside the groove
        peck = g.mr(g.noise(loc, 140.0, 2), 0.4, 0.7)
        gcol = g.mix(0.5, g.mix(1.0, col, (0.72, 0.7, 0.68, 1), "MULTIPLY"), peck, "OVERLAY")
        col = g.mix(g.mul(groove, 0.55 * depth), col, gcol)
        h = g.sub(h, g.mul(groove, 1.3 * depth))
        if clean:
            g._groove = groove
        return col, h
    return hook


def mat_megalith(name="megalith", carve=None, **kw):
    a = dict(speck=0.3, speck_scale=160.0, speck_light="#bcb3a0", speck_dark="#3a3630", lichen_d=0.6, lichen_amt=1.0,
             moss=0.5, cracks=0.35, streaks=0.9, lichen_scale=5.0,
             lichen_tones=("#9da386", "#c2bfae", "#b99a48"), pits=0.45)
    a.update(kw)
    if carve:
        a["extra"] = carve
    MAT[name] = m_rock(name, MEGA, **a)
    return MAT[name]


def packing_stones(cx, cy, rx, ry, n, seed, bt):
    """small wedging stones rammed round a megalith's foot, half buried."""
    rng = random.Random(seed)
    for i in range(n):
        a = 2 * math.pi * i / n + rng.uniform(-0.3, 0.3)
        x, y = cx + math.cos(a) * rx * rng.uniform(1.0, 1.25), cy + math.sin(a) * ry * rng.uniform(1.0, 1.25)
        s = rng.uniform(0.18, 0.36)
        rock(bt, (x, y, 0), (s * 1.3, s, s * 0.7), seed * 100 + i, sink=0.35, sub=1, blocky=2.6, amp=0.12,
             cuts=1, chamfer=0.0)


# =====================================================================  thorn tree (hawthorn) with rags
def thorn_tree(cx, cy, height=3.2, seed=5, rags=0, lean=(0.35, 0.2), name="thorn"):
    """wind-bent old hawthorn: short leaning bole splitting into crooked limbs, dense twiggy crown of
    hawthorn cards (shared shrub atlas). rags: strips of cloth tied to the lower twigs (clootie)."""
    import _trees as T, _veg as V
    rng = random.Random(seed)
    sk = T.Skel()
    base = Vector((cx, cy, 0.0))
    root = sk.add(base, -1, growable=False)
    d0 = Vector((lean[0], lean[1], 1.0)).normalized()
    trunk = T.polyline(sk, root, d0, height * 0.38, 0.14, rng, wander=0.35, kink_every=0.35, kink_deg=20, growable=False)
    top = trunk[-1]
    lobes = []
    for k in range(rng.randint(4, 5)):
        a = rng.uniform(0, 6.283)
        tilt = math.radians(rng.uniform(25, 60))
        d = Vector((math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt), math.cos(tilt))) + d0 * 0.4
        T.polyline(sk, top, d, height * rng.uniform(0.3, 0.45), 0.15, rng, kink_every=0.3, kink_deg=26, up_bias=0.05)
    cz = height * 0.68
    c0 = base + d0 * height * 0.25
    for k in range(5):
        a = k * 1.3 + rng.uniform(-0.3, 0.3); r = rng.uniform(0.3, 0.8) if k else 0
        lobes.append((Vector((c0.x + math.cos(a) * r, c0.y + math.sin(a) * r, cz + rng.uniform(-0.2, 0.25))),
                      (height * rng.uniform(0.34, 0.42), height * rng.uniform(0.34, 0.42), height * rng.uniform(0.22, 0.28))))
    att = T.lobe_attractors(lobes, 4000, rng, shell=0.5, zmin=height * 0.35)
    T.colonize(sk, att, infl=1.6, kill=0.3, step=0.16, iters=160, tropism=(0, 0, -0.02), jitter=0.25, rng=rng)
    rad = T.pipe_radii(sk, r_tip=0.006, exp=2.2, base_radius=0.16 * height / 3.2)
    bark = T.bark_material(name + "_bark", plate="#5f574d", plate2="#51493f", crack="#28221d", lichen="#a2a585",
                           moss="#4e5a27", plate_scale=12.0, along=0.6, crack_width=0.2, moss_amount=0.8,
                           lichen_amount=0.6, smooth_below_r=0.03)
    PCOL[name + "_bark"] = "#5a5046"
    V.wood(sk, rad, name + "_wood", bark, 2200, min_rs=(0.01, 0.012, 0.015, 0.018, 0.022, 0.026, 0.03, 0.035),
           gnarl=0.18, seed=seed)
    centre, ext = V.crown_frame(lobes)
    pts = T.tip_points(sk, rad, r_leaf=0.012, stride=1.4, rng=rng)
    pts += T.tip_points(sk, rad, r_leaf=0.02, stride=4, rng=rng)

    def pick(out, rng):
        if out.z > 0.4 and rng.random() < 0.6: return 2
        return rng.choice((0, 0, 0, 2, 3))
    cs = V.card_lods(pts, V.shrub_atlas(), centre, ext, rng, name + "_leaves", size=(0.55, 0.85), cell_pick=pick,
                     up_bias=0.35, lod_keep=(1.0, 0.3, 0.08), lod_grow=(1.0, 1.6, 2.6), jitter=0.2, spread=0.15)
    for o in cs:
        o["hg_tag"] = name
    if rags:
        cols = ["#8e4b3c", "#c4b99c", "#6e7884", "#a08650", "#6b7350", "#b7a98a", "#7d4f5c"]
        spots = [i for i, p in enumerate(sk.pos) if 0.008 < rad[i] < 0.04 and 0.9 < p.z < height * 0.72]
        rng.shuffle(spots)
        cen = Vector((cx, cy, 0)) + d0 * height * 0.25
        spots.sort(key=lambda i: -((sk.pos[i].x - cen.x) ** 2 + (sk.pos[i].y - cen.y) ** 2) + rng.uniform(0, 0.6))
        for k, i in enumerate(spots[:rags]):
            p = sk.pos[i]
            ln = rng.uniform(0.3, 0.6); w = rng.uniform(0.05, 0.09)
            yaw = rng.uniform(0, 6.283)
            ax = Vector((math.cos(yaw), math.sin(yaw), 0))
            sway = Vector((rng.gauss(0, 0.05), rng.gauss(0, 0.05), 0))
            # knot + hanging strip, 3 segments with a slight twist
            pts_, F = [], []
            for s in range(4):
                t = s / 3
                c = p + Vector((0, 0, -ln * t)) + sway * t * t
                tw = ax.copy(); tw.rotate(__import__("mathutils").Quaternion((0, 0, 1), t * rng.uniform(-0.8, 0.8)))
                ww = w * (1 - 0.3 * t)
                pts_ += [tuple(c - tw * ww / 2), tuple(c + tw * ww / 2)]
            for s in range(3):
                q = 2 * s
                F.append((q, q + 1, q + 3, q + 2))
            # thickness: back layer so both sides render and bake
            n0 = len(pts_)
            nrm = ax.cross(Vector((0, 0, 1))) * 0.006
            pts_ += [tuple(Vector(v) + nrm) for v in pts_]
            F += [(n0 + a, n0 + d, n0 + c_, n0 + b) for (a, b, c_, d) in F]
            B("rags", "rag").add(pts_, F, None, rng.random())
            blob(B("rags", "rag"), tuple(p), 0.03, 0.03, 0.025, sub=1, amp=0.1, rnd=rng.random())
    return cs


def pit(cx, cy, r, h, bt, floor_bt=None, seed=0.0, puddle=None):
    """prospect / bell pit: ring of upcast spoil round a shallow hollow (all above grade)."""
    def shape(t, a):
        return h * math.exp(-((t - 0.62) / 0.2) ** 2) * (1 + 0.25 * MN.noise(Vector((math.cos(a) * 2 + seed, math.sin(a) * 2, 0.4))))
    ground_patch(bt, cx, cy, r, r * R.uniform(0.8, 1.0), h=0.0, n=20, rings=7, bump=0.02, seed=seed, shape=shape)
    if floor_bt is not None:
        ground_patch(floor_bt, cx, cy, r * 0.38, r * 0.34, h=0.03, n=12, rings=2, bump=0.005, seed=seed + 1)
    if puddle is not None:
        ground_patch(puddle, cx + jit(0.05), cy + jit(0.05), r * 0.2, r * 0.17, h=0.045, n=10, rings=1, bump=0.0, seed=seed + 2)


def spoil_heap(bt, cx, cy, rx, ry, h, seed=0.0, rot=0.0):
    ca, sa = math.cos(rot), math.sin(rot)
    def shape(t, a):
        return h * (1 - t ** 1.6) ** 1.2 * (1 + 0.2 * MN.noise(Vector((math.cos(a) * 1.5 + seed, math.sin(a) * 1.5, t * 2))))
    ground_patch(bt, cx, cy, rx, ry, h=0.0, n=20, rings=6, bump=0.04, seed=seed, shape=shape)


def lumps(bt, cx, cy, r, n, smin, smax, seed, zfn=None):
    rng = random.Random(seed)
    for i in range(n):
        a = rng.uniform(0, 6.283); rr = r * math.sqrt(rng.random())
        x, y = cx + math.cos(a) * rr, cy + math.sin(a) * rr
        s = rng.uniform(smin, smax)
        z = zfn(x, y) if zfn else 0.0
        rock(bt, (x, y, z), (s * 1.3, s, s * 0.8), int(seed * 1000) + i, sink=0.25 if z <= 0.001 else 0.3, sub=1,
             blocky=2.4, amp=0.15, cuts=1, chamfer=0.0)
