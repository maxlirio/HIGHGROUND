"""HIGHGROUND castle kit — shared geometry, weathering and export library (Blender 5.1, headless).

Piece scripts (assets/src/castle/<piece>.py) build SOLIDS with the helpers below, cut openings with
booleans, then call finish_piece(), which
  * joins the solids into named PARTS (base, upper_1.., roof, and moving parts such as portcullis_outer),
  * projects metre-true tiling UVs per face (box / cylinder / roof mapping; U,V in tiles of the material's
    tile_m, so every piece shares ONE texture library: assets/tex/castle/*.jpg — see castle_tex.py),
  * computes per-corner COLOR_0 = ambient occlusion x weathering (grime at the foot, rain streaks, lichen,
    soot above loops and flues, pale fresh breaks on damaged pieces) — the tiling breaks up at every scale,
  * makes LOD1 (and LOD2) per static part by decimation,
  * exports assets/glb/castle_<name>.glb WITHOUT embedded images, then patches the glTF JSON so every
    material points at the shared textures by relative URI (../tex/castle/<mat>_*.jpg). Any glTF loader
    (three.js GLTFLoader, Blender's importer) resolves them; the browser downloads each texture once.
  * merges the piece's metadata (walk surfaces, doors, links, ports ...) into assets/castle-kit.json.

Coordinates: Blender, 1 unit = 1 m, Z up. Piece local X,Y == the sim's local x,y (the renderer maps
sim (x, y, h) -> three (x, h, -y) and glTF export does the same with Blender (X, Y, Z)). Outer face -Y.
"""
import bpy, bmesh, os, sys, math, json, random, struct
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
GLB_DIR = os.path.join(ROOT, "assets", "glb")
TEX_DIR = os.path.join(ROOT, "assets", "tex", "castle")
KIT_JSON = os.path.join(ROOT, "assets", "castle-kit.json")
TEX_URI = "../tex/castle/"

# material key -> tile size (m); read from the texture library json when present
MATS = {}
for k in ("ashlar", "rubble", "paving", "planks", "timber", "slate", "shingle", "lead", "plaster", "iron",
          "debris", "earth"):
    try:
        MATS[k] = json.load(open(os.path.join(TEX_DIR, k + ".json")))["tile_m"]
    except Exception:
        MATS[k] = 4.0
MATS["water"] = 0          # untextured, flat
MATS["dark"] = 0           # untextured near-black (the unlit depth inside murder holes etc.)
STONE = {"ashlar", "rubble", "paving", "debris"}
WOOD = {"planks", "timber", "shingle"}
ROOF = {"slate", "lead", "shingle"}

SEED = 1
RNG = random.Random(1)


def reset(seed=1):
    global SEED, RNG
    bpy.ops.wm.read_factory_settings(use_empty=True)
    SEED = seed; RNG = random.Random(seed); random.seed(seed)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"
    sc.render.threads_mode = "FIXED"; sc.render.threads = 2
    _MATCACHE.clear()


# ------------------------------------------------------------------ materials
_MATCACHE = {}
AVG = {"water": (0.06, 0.075, 0.06), "dark": (0.02, 0.018, 0.016)}


def material(key):
    if key in _MATCACHE:
        return _MATCACHE[key]
    m = bpy.data.materials.new("castle_" + key)
    m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    ca = nt.nodes.new("ShaderNodeVertexColor"); ca.layer_name = "Col"
    nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.2 if key == "water" else 0.85
    b.inputs["Metallic"].default_value = 0.0
    m["hg_key"] = key
    m.use_backface_culling = True
    _MATCACHE[key] = m
    return m


# ------------------------------------------------------------------ solid builder
class Solid:
    """Accumulates faces in a bmesh; each face carries a material key. to_object() makes the object."""

    def __init__(self, name, uv="box", uvc=(0.0, 0.0), roof_axis=None):
        self.name = name; self.bm = bmesh.new(); self.keys = []
        self.uv = uv; self.uvc = uvc; self.roof_axis = roof_axis

    def _mi(self, key):
        if key not in self.keys:
            self.keys.append(key)
        return self.keys.index(key)

    def face(self, pts, key):
        vs = [self.bm.verts.new(Vector(p)) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = self._mi(key)
        return f

    def grid(self, p0, du, dv, key, res=0.9, nu=None, nv=None):
        p0 = Vector(p0); du = Vector(du); dv = Vector(dv)
        nu = nu or max(1, math.ceil(du.length / res - 1e-6)); nv = nv or max(1, math.ceil(dv.length / res - 1e-6))
        V = [[self.bm.verts.new(p0 + du * (i / nu) + dv * (j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
        mi = self._mi(key)
        for i in range(nu):
            for j in range(nv):
                f = self.bm.faces.new((V[i][j], V[i + 1][j], V[i + 1][j + 1], V[i][j + 1]))
                f.material_index = mi

    def box(self, x0, x1, y0, y1, z0, z1, key, res=0.9, skip=(), keys=None):
        """Axis box; keys may override the material per side: dict side->key, sides '-x','+x','-y','+y','-z','+z'."""
        k = lambda s: (keys or {}).get(s, key)
        R = (lambda s: res.get(s, res.get("*", 0.9))) if isinstance(res, dict) else (lambda s: res)
        if "-y" not in skip: self.grid((x0, y0, z0), (x1 - x0, 0, 0), (0, 0, z1 - z0), k("-y"), R("-y"))
        if "+y" not in skip: self.grid((x1, y1, z0), (x0 - x1, 0, 0), (0, 0, z1 - z0), k("+y"), R("+y"))
        if "-x" not in skip: self.grid((x0, y1, z0), (0, y0 - y1, 0), (0, 0, z1 - z0), k("-x"), R("-x"))
        if "+x" not in skip: self.grid((x1, y0, z0), (0, y1 - y0, 0), (0, 0, z1 - z0), k("+x"), R("+x"))
        if "+z" not in skip: self.grid((x0, y0, z1), (x1 - x0, 0, 0), (0, y1 - y0, 0), k("+z"), R("+z"))
        if "-z" not in skip: self.grid((x0, y1, z0), (x1 - x0, 0, 0), (0, y0 - y1, 0), k("-z"), R("-z"))

    def prism(self, poly, z0, z1, key, res=0.9, cap=True, keys=None, capkey=None, top=None):
        """Vertical prism of a CCW 2-D polygon. top: optional function (x,y)->z for a sloped top."""
        poly = [Vector((p[0], p[1])) for p in poly]
        if _area(poly) < 0:
            poly = poly[::-1]
        n = len(poly)
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            kk = (keys[i] if keys else key)
            if top is None:
                self.grid((a.x, a.y, z0), (b.x - a.x, b.y - a.y, 0), (0, 0, z1 - z0), kk, res)
            else:
                za, zb = top(a.x, a.y), top(b.x, b.y)
                nu = max(1, math.ceil((b - a).length / res))
                nv = max(1, math.ceil(max(za, zb) - z0) / res)
                for i2 in range(nu):
                    t0, t1 = i2 / nu, (i2 + 1) / nu
                    p0 = a.lerp(b, t0); p1 = a.lerp(b, t1)
                    h0 = z0 + (za + (zb - za) * t0 - z0); h1 = z0 + (za + (zb - za) * t1 - z0)
                    self.face([(p0.x, p0.y, z0), (p1.x, p1.y, z0), (p1.x, p1.y, h1), (p0.x, p0.y, h0)], kk)
        if cap:
            ck = capkey or key
            if top is None:
                self.face([(p.x, p.y, z1) for p in poly], ck)
            else:
                self.face([(p.x, p.y, top(p.x, p.y)) for p in poly], ck)
            self.face([(p.x, p.y, z0) for p in reversed(poly)], ck)

    def ring(self, cx, cy, r_out, r_in, z0, z1, key, segs=48, res=0.9, a0=0.0, a1=2 * math.pi, caps=True,
             inner_key=None, cap_key=None, ends=True, r_out0=None):
        """Cylindrical shell (optionally an arc a0..a1, CCW). r_out0: outer radius at z0 (a batter)."""
        full = abs(a1 - a0 - 2 * math.pi) < 1e-6
        ns = max(2, int(round(segs * (a1 - a0) / (2 * math.pi))))
        nv = max(1, math.ceil((z1 - z0) / res))
        ro0 = r_out0 if r_out0 is not None else r_out
        ang = [a0 + (a1 - a0) * i / ns for i in range(ns + 1)]
        P = lambda r, a, z: (cx + r * math.cos(a), cy + r * math.sin(a), z)
        ik = inner_key or key; ck = cap_key or key
        for i in range(ns):
            A, B = ang[i], ang[i + 1]
            for j in range(nv):
                za, zb = z0 + (z1 - z0) * j / nv, z0 + (z1 - z0) * (j + 1) / nv
                ra = ro0 + (r_out - ro0) * (j / nv); rb = ro0 + (r_out - ro0) * ((j + 1) / nv)
                self.face([P(ra, A, za), P(ra, B, za), P(rb, B, zb), P(rb, A, zb)], key)
                if r_in > 0:
                    self.face([P(r_in, B, za), P(r_in, A, za), P(r_in, A, zb), P(r_in, B, zb)], ik)
            if caps:
                if r_in > 0:
                    self.face([P(r_in, A, z1), P(r_in, B, z1), P(r_out, B, z1), P(r_out, A, z1)], ck)
                    self.face([P(ro0, A, z0), P(ro0, B, z0), P(r_in, B, z0), P(r_in, A, z0)], ck)
        if caps and r_in <= 0:
            self.face([P(r_out, a, z1) for a in ang[:-1]] if full else [(cx, cy, z1)] + [P(r_out, a, z1) for a in ang], ck)
            self.face([P(ro0, a, z0) for a in reversed(ang[:-1])] if full else [(cx, cy, z0)] + [P(ro0, a, z0) for a in reversed(ang)], ck)
        if ends and not full and r_in > 0:
            for a, s in ((a0, -1), (a1, 1)):
                pts = [P(r_in, a, z0), P(ro0, a, z0), P(r_out, a, z1), P(r_in, a, z1)]
                self.face(pts if s < 0 else pts[::-1], key)

    def disc(self, cx, cy, r, z, key, segs=32, rings=None, up=True, hole=None):
        """Horizontal disc as a polar grid (so it carries vertex colour). hole=(hx,hy,hr) is skipped (faces
        whose centre falls inside it are not made) — used for stair wells."""
        rings = rings or max(1, int(r / 0.9))
        P = lambda rr, a: (cx + rr * math.cos(a), cy + rr * math.sin(a), z)
        for j in range(rings):
            r0, r1 = r * j / rings, r * (j + 1) / rings
            for i in range(segs):
                a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
                if hole:
                    mx = cx + (r0 + r1) / 2 * math.cos((a0 + a1) / 2); my = cy + (r0 + r1) / 2 * math.sin((a0 + a1) / 2)
                    if math.hypot(mx - hole[0], my - hole[1]) < hole[2]:
                        continue
                pts = [P(r0, a0), P(r1, a0), P(r1, a1), P(r0, a1)] if j else [(cx, cy, z), P(r1, a0), P(r1, a1)]
                self.face(pts if up else pts[::-1], key)

    def extrude(self, poly, origin, U, V, W, w0, w1, key, cap=True, capkey=None):
        """Prism of the 2-D polygon (u,v) in the plane origin+U*u+V*v, from W*w0 to W*w1. Normals fixed
        afterwards by recalc (closed solid)."""
        o = Vector(origin); U = Vector(U); V = Vector(V); W = Vector(W)
        P = lambda p, w: o + U * p[0] + V * p[1] + W * w
        poly = clean_poly(poly)
        n = len(poly)
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            self.face([P(a, w0), P(b, w0), P(b, w1), P(a, w1)], key)
        if cap:
            self.face([P(p, w1) for p in poly], capkey or key)
            self.face([P(p, w0) for p in reversed(poly)], capkey or key)

    def merge(self, other):
        """Append another Solid's geometry (keeps its material keys)."""
        remap = {}
        for i, k in enumerate(other.keys):
            remap[i] = self._mi(k)
        vm = {}
        for v in other.bm.verts:
            vm[v] = self.bm.verts.new(v.co)
        for f in other.bm.faces:
            nf = self.bm.faces.new([vm[v] for v in f.verts])
            nf.material_index = remap[f.material_index]

    def to_object(self, recalc=False, weld=True):
        bm = self.bm
        if weld:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        if recalc:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(o)
        for k in self.keys:
            me.materials.append(material(k))
        o["hg_uv"] = self.uv; o["hg_uvc"] = list(self.uvc)
        if self.roof_axis is not None:
            o["hg_roof"] = list(self.roof_axis)
        return o


def clean_poly(poly, eps=1e-5):
    """Drop repeated and collinear vertices (degenerate triangles break exact booleans)."""
    pts = []
    for p in poly:
        if not pts or abs(p[0] - pts[-1][0]) + abs(p[1] - pts[-1][1]) > eps:
            pts.append((p[0], p[1]))
    if len(pts) > 1 and abs(pts[0][0] - pts[-1][0]) + abs(pts[0][1] - pts[-1][1]) <= eps:
        pts.pop()
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for i in range(len(pts)):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
            if abs(cr) < eps * 10:
                pts.pop(i); changed = True
                break
    return pts


def _welded(sol):
    bmesh.ops.remove_doubles(sol.bm, verts=sol.bm.verts, dist=0.0005)
    bmesh.ops.recalc_face_normals(sol.bm, faces=sol.bm.faces)
    return sol


def _area(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly))) / 2


# ------------------------------------------------------------------ cutters and booleans
def cutter(name="cut"):
    return Solid(name)


def cut(obj, cutters, key=None, solver="EXACT"):
    """Boolean-difference each cutter object from obj. Faces made by a cutter take the cutter's material
    (so give the cutter the material the exposed surface should have: rubble core, dark, plaster...)."""
    if not cutters:
        return obj
    if not isinstance(cutters, (list, tuple)):
        cutters = [cutters]
    # one union of all cutters keeps it to a single boolean
    for c in cutters:
        c.hide_render = True; c.display_type = "WIRE"
    bpy.context.view_layer.objects.active = obj
    for c in cutters:
        m = obj.modifiers.new("b", "BOOLEAN"); m.operation = "DIFFERENCE"; m.object = c
        try:
            m.solver = solver
        except TypeError:
            m.solver = "EXACT"
        try:
            m.material_mode = "TRANSFER"
        except Exception:
            pass
        if m.solver == "EXACT":
            m.use_self = True; m.use_hole_tolerant = True
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError as e:
            print("HG_WARN boolean failed", obj.name, c.name, e)
            obj.modifiers.remove(m)
    for c in cutters:
        bpy.data.objects.remove(c, do_unlink=True)
    return obj


def slit_cutter(pos, inward, up, z0, z1, depth_out, depth_in, w_slit=0.07, w_in=0.75, h_in_extra=0.15,
                oillet=0.16, cross=False, key="ashlar", splay_frac=0.72):
    """An arrow loop: a narrow slit through the outer skin + a splayed embrasure behind it.
    pos = point on the OUTER face at the slit's centre line (x,y), inward = unit horizontal vector into the
    wall, depth_out/depth_in = wall thickness measured from pos along inward (outer face at 0)."""
    pos = Vector((pos[0], pos[1], 0)); iw = Vector((inward[0], inward[1], 0)).normalized()
    side = Vector((-iw.y, iw.x, 0))
    parts = []
    # slit through the outer part
    s = Solid("slit")
    zc = (z0 + z1) / 2
    d_s = (depth_in) * (1 - splay_frac)
    poly = [(-w_slit / 2, z0), (w_slit / 2, z0), (w_slit / 2, z1), (-w_slit / 2, z1)]
    s.extrude(poly, pos, side, (0, 0, 1), iw, -0.3, d_s + 0.05, key)
    parts.append(s.to_object(recalc=True, weld=True))
    if oillet:
        o = Solid("oil")
        pts = [(math.cos(a) * oillet / 2, z0 + oillet * 0.35 + math.sin(a) * oillet / 2) for a in [i * 2 * math.pi / 10 for i in range(10)]]
        o.extrude(pts, pos, side, (0, 0, 1), iw, -0.3, d_s + 0.05, key)
        parts.append(o.to_object(recalc=True, weld=True))
    if cross:
        c = Solid("cross")
        zc2 = z0 + (z1 - z0) * 0.62
        c.extrude([(-0.28, zc2 - 0.035), (0.28, zc2 - 0.035), (0.28, zc2 + 0.035), (-0.28, zc2 + 0.035)], pos, side, (0, 0, 1), iw, -0.3, d_s + 0.05, key)
        parts.append(c.to_object(recalc=True, weld=True))
    # splayed embrasure: a frustum from the slit (narrow) to the inner face (wide, taller, sloped sill)
    e = Solid("embr")
    P = lambda u, z, w: pos + side * u + Vector((0, 0, z)) + iw * w
    a = [P(-w_slit / 2 - 0.02, z0 + 0.02, d_s), P(w_slit / 2 + 0.02, z0 + 0.02, d_s), P(w_slit / 2 + 0.02, z1 - 0.02, d_s), P(-w_slit / 2 - 0.02, z1 - 0.02, d_s)]
    zin0 = z0 - 0.35; zin1 = z1 + h_in_extra
    b = [P(-w_in / 2, zin0, depth_in + 0.3), P(w_in / 2, zin0, depth_in + 0.3), P(w_in / 2, zin1, depth_in + 0.3), P(-w_in / 2, zin1, depth_in + 0.3)]
    for i in range(4):
        e.face([a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]], key)
    e.face(a[::-1], key); e.face(b, key)
    parts.append(e.to_object(recalc=True, weld=True))
    return parts


def arch_profile(w, h_spring, kind="pointed", segs=10, rise=None):
    """2-D (u, z) polygon of an arched opening centred on u=0, springing at h_spring. CCW."""
    r = w / 2
    pts = [(-r, 0.0), (r, 0.0), (r, h_spring)]
    if kind == "round":
        for i in range(1, segs):
            a = math.pi * i / segs
            pts.append((r * math.cos(a), h_spring + r * math.sin(a)))
    elif kind == "flat":
        pass
    else:  # two-centred pointed (equilateral) arch
        R = w * (rise or 1.0)
        for i in range(1, segs + 1):
            t = i / segs
            a = math.acos(max(-1, min(1, (R - w) / R))) if False else None
            # right half: centre at (r - R, h_spring)
            ang0 = 0.0; ang1 = math.acos((R - r) / R)
            ang = ang0 + (ang1 - ang0) * t
            pts.append((r - R + R * math.cos(ang), h_spring + R * math.sin(ang)))
        apex = pts[-1]
        left = [(-p[0], p[1]) for p in reversed(pts[3:-1])]
        pts = pts + left
    pts.append((-r, h_spring))
    return pts


def opening_cutter(pos, along, inward, w, h_spring, depth0, depth1, kind="pointed", key="ashlar", z0=0.0, rise=None):
    """Arched opening (door, passage, window) through a wall. pos = (x,y) on the axis, along = the wall's
    horizontal direction, inward = through-wall direction; depth0..depth1 measured along inward."""
    s = Solid("open")
    prof = [(u, z + z0) for u, z in arch_profile(w, h_spring, kind, rise=rise)]
    s.extrude(prof, (pos[0], pos[1], 0), (along[0], along[1], 0), (0, 0, 1), (inward[0], inward[1], 0), depth0, depth1, key)
    return s.to_object(recalc=True, weld=True)


def box_cutter(x0, x1, y0, y1, z0, z1, key="ashlar", rot=0.0, about=(0, 0)):
    s = Solid("boxcut"); s.box(x0, x1, y0, y1, z0, z1, key, res=99)
    o = s.to_object(recalc=True, weld=True)
    if rot:
        o.matrix_world = Matrix.Translation((about[0], about[1], 0)) @ Matrix.Rotation(rot, 4, "Z") @ Matrix.Translation((-about[0], -about[1], 0))
        apply_xf(o)
    return o


def apply_xf(o):
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


# ------------------------------------------------------------------ higher-level parts
def lathe(sol, cx, cy, prof, key, segs=48, a0=0.0, a1=2 * math.pi, inner_key=None, cap_key=None, res=0.9):
    """Revolve a closed (r, z) profile about the vertical axis at (cx, cy) from angle a0 to a1 (CCW).
    Profile edges are resampled to <= res. Faces facing the axis get inner_key, horizontal faces cap_key.
    A partial revolution gets end caps. Closed solid; normals recalculated."""
    pts = []
    n = len(prof)
    for i in range(n):
        a, b = prof[i], prof[(i + 1) % n]
        k = max(1, math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / res))
        for j in range(k):
            pts.append((a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k))
    full = abs(a1 - a0 - 2 * math.pi) < 1e-6
    ns = max(1, int(round(segs * (a1 - a0) / (2 * math.pi))))
    angs = [a0 + (a1 - a0) * i / ns for i in range(ns + (0 if full else 1))]
    t = Solid("lathe")
    V = [[t.bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), z)) for (r, z) in pts] for a in angs]
    m_out = t._mi(key); m_in = t._mi(inner_key or key); m_cap = t._mi(cap_key or key)
    na = len(angs); npf = len(pts)
    for i in range(na if full else na - 1):
        i2 = (i + 1) % na
        for j in range(npf):
            j2 = (j + 1) % npf
            (r1, z1), (r2, z2) = pts[j], pts[j2]
            f = t.bm.faces.new((V[i][j], V[i2][j], V[i2][j2], V[i][j2]))
            if abs(z2 - z1) < 1e-6:
                f.material_index = m_cap
            else:
                # which side of the profile: outward-facing edges have the solid toward smaller r
                f.material_index = m_out
    if not full:
        for i in (0, na - 1):
            try:
                f = t.bm.faces.new([V[i][j] for j in range(npf)]); f.material_index = m_out
            except ValueError:
                pass
    sol_t = _welded(t)
    # inner faces: normal pointing toward the axis
    if inner_key:
        for f in sol_t.bm.faces:
            if f.material_index == m_out:
                c = f.calc_center_median(); d = Vector((cx - c.x, cy - c.y, 0))
                if d.length > 1e-6 and f.normal.dot(d.normalized()) > 0.5:
                    f.material_index = m_in
    sol.merge(sol_t)


def offset_pts(pts, off, closed=False):
    """Mitred offset of a 2-D polyline; +off = right of the direction of travel."""
    n = len(pts); out = []
    for j in range(n):
        if not closed and j == 0:
            d = (pts[1] - pts[0]).normalized(); out.append(pts[0] + Vector((d.y, -d.x)) * off); continue
        if not closed and j == n - 1:
            d = (pts[-1] - pts[-2]).normalized(); out.append(pts[-1] + Vector((d.y, -d.x)) * off); continue
        a, b, c = pts[j - 1], pts[j], pts[(j + 1) % n]
        d1 = (b - a).normalized(); d2 = (c - b).normalized()
        n1 = Vector((d1.y, -d1.x)); n2 = Vector((d2.y, -d2.x))
        m = n1 + n2
        if m.length < 1e-6:
            m = n1.copy()
        m.normalize()
        out.append(b + m * (off / max(0.25, m.dot(n1))))
    return out


def resample(pts, step, closed=False):
    pts = [Vector((p[0], p[1])) for p in pts]
    out = []
    segs = list(zip(pts, pts[1:] + ([pts[0]] if closed else [])))
    for a, b in segs:
        n = max(1, math.ceil((b - a).length / step))
        for i in range(n):
            out.append(a.lerp(b, i / n))
    if not closed:
        out.append(pts[-1])
    return out


def sweep(sol, pts, profile, key, closed=False, caps=True, step=0.8):
    """Sweep a closed 2-D profile [(offset, z)] (offset + = right of travel) along a polyline with mitred
    joints. Makes a closed solid (merged into sol)."""
    pts = resample(pts, step, closed)
    t = Solid("sweep")
    rows = []
    for (o, z) in profile:
        rows.append([t.bm.verts.new((p.x, p.y, z)) for p in offset_pts(pts, o, closed)])
    nP, nJ = len(profile), len(pts)
    mi = t._mi(key)
    for k in range(nP):
        k2 = (k + 1) % nP
        for j in range(nJ if closed else nJ - 1):
            j2 = (j + 1) % nJ
            try:
                f = t.bm.faces.new((rows[k][j], rows[k][j2], rows[k2][j2], rows[k2][j])); f.material_index = mi
            except ValueError:
                pass
    if caps and not closed:
        for j in (0, nJ - 1):
            try:
                f = t.bm.faces.new([rows[k][j] for k in range(nP)]); f.material_index = mi
            except ValueError:
                pass
    sol.merge(_welded(t))


def sub_path(pts, t0, t1):
    """The part of an open polyline between arc lengths t0..t1 (with its interior vertices)."""
    pts = [Vector((p[0], p[1])) for p in pts]
    out = []; acc = 0.0
    for a, b in zip(pts, pts[1:]):
        L = (b - a).length
        s0, s1 = acc, acc + L
        if s1 >= t0 - 1e-9 and s0 <= t1 + 1e-9:
            u0 = max(t0, s0); u1 = min(t1, s1)
            pa = a.lerp(b, (u0 - s0) / L); pb = a.lerp(b, (u1 - s0) / L)
            if not out or (out[-1] - pa).length > 1e-6:
                out.append(pa)
            if (out[-1] - pb).length > 1e-6:
                out.append(pb)
        acc = s1
    return out


def battlements(sol, path, z_base, key="ashlar", thick=0.6, breast=1.1, merlon_h=1.1, merlon_w=2.0, crenel_w=0.9,
                phase=0.0, closed=False, res=0.8, coping=True, slits=None, intervals=None):
    """Parapet (breastwork + merlons with gabled copings) swept along `path`, which is the parapet's
    CENTRELINE; the outer (field) side is on the RIGHT of travel. intervals = explicit merlon spans in arc
    length (else a regular pattern from `phase`). Closed paths (tower tops) need explicit intervals or a
    pitch that divides the perimeter. Returns crenel centres [(x, y, z_sill, (dx, dy))]."""
    pts = [Vector((p[0], p[1])) for p in path]
    h = thick / 2
    sweep(sol, pts, [(-h, z_base), (h, z_base), (h, z_base + breast - 0.07), (-h, z_base + breast)], key, closed=closed, step=res)
    P = pts + ([pts[0]] if closed else [])
    total = sum((b - a).length for a, b in zip(P, P[1:]))
    pitch = merlon_w + crenel_w

    def at(t):
        u = t
        for a, b in zip(P, P[1:]):
            L = (b - a).length
            if u <= L + 1e-9:
                return a + (b - a) * (u / L), (b - a) / L
            u -= L
        return P[-1], (P[-1] - P[-2]).normalized()
    if intervals is not None:
        spans = list(intervals)
    else:
        spans = []; t = phase
        while t < total - 1e-6:
            spans.append((max(0.0, t), min(total, t + merlon_w))); t += pitch
    zb = z_base + breast; zt = zb + merlon_h
    prof = ([(-h, zb - 0.02), (h, zb - 0.09), (h, zt - 0.14), (h + 0.045, zt - 0.1), (h + 0.045, zt), (0, zt + 0.17),
             (-h - 0.045, zt), (-h - 0.045, zt - 0.1), (-h, zt - 0.14)] if coping else [(-h, zb - 0.02), (h, zb - 0.09), (h, zt), (-h, zt)])
    crenels = []
    for si, (m0, m1) in enumerate(spans):
        if m1 - m0 < 0.12:
            continue
        sp = sub_path(P, m0, m1)
        if len(sp) >= 2:
            sweep(sol, sp, prof, key, closed=False, step=res)
        nxt = spans[(si + 1) % len(spans)] if (closed or si + 1 < len(spans)) else None
        if nxt is not None:
            a0 = m1; a1 = nxt[0] + (total if nxt[0] < m1 else 0)
            cc = ((a0 + a1) / 2) % total if closed else (a0 + a1) / 2
            p, d = at(cc)
            crenels.append((p.x, p.y, zb, (d.x, d.y)))
    return crenels


def spiral_stair(sol_by_band, cx, cy, r_newel, r_out, z0, z1, a_start, ccw=True, rise=0.2, step_deg=22.0,
                 key="ashlar", bands=None, res=9):
    """Newel stair: wedge steps from z0 to z1 starting at angle a_start (radians). sol_by_band: function
    z -> Solid (so steps go into the storey's part). Returns list of (angle, z) for each step top."""
    n = max(1, int(round((z1 - z0) / rise)))
    rise = (z1 - z0) / n
    out = []
    sgn = 1 if ccw else -1
    for i in range(n):
        zt = z0 + rise * (i + 1)
        a0 = a_start + sgn * math.radians(step_deg) * i
        a1 = a0 + sgn * math.radians(step_deg) * 1.08
        lo, hi = (a0, a1) if sgn > 0 else (a1, a0)
        poly = [(cx + r_newel * math.cos(lo), cy + r_newel * math.sin(lo))]
        for k in range(4):
            a = lo + (hi - lo) * k / 3
            poly.append((cx + r_out * math.cos(a), cy + r_out * math.sin(a)))
        poly.append((cx + r_newel * math.cos(hi), cy + r_newel * math.sin(hi)))
        sol = sol_by_band(zt - rise * 0.5)
        sol.prism(poly, zt - rise - 0.18, zt, key, res=9)
        out.append(((a0 + a1) / 2, zt))
    return out


def straight_stair(sol, p0, direction, width, z0, z1, rise=0.19, going=0.28, key="ashlar", solid_below=True, side=None):
    """Straight flight from p0 (bottom front edge centre, at z0) along direction up to z1."""
    d = Vector((direction[0], direction[1])).normalized(); nrm = Vector((-d.y, d.x))
    n = max(1, int(round((z1 - z0) / rise))); rise = (z1 - z0) / n
    for i in range(n):
        a = Vector(p0) + d * (going * i); b = a + d * going
        zt = z0 + rise * (i + 1)
        q = [a - nrm * width / 2, b - nrm * width / 2, b + nrm * width / 2, a + nrm * width / 2]
        zb = z0 if solid_below else zt - rise - 0.25
        sol.prism([(p.x, p.y) for p in q], zb, zt, key, res=9)
    return Vector(p0) + d * (going * n), n


def gable_roof(sol, x0, x1, y0, y1, z_eave, z_ridge, key="slate", over=0.45, thick=0.18, gable_over=0.3,
               ridge_axis="x", fascia_key="timber"):
    """Dual-pitch roof: ridge along X (or Y). Slabs with thickness, overhang at eaves and gables."""
    if ridge_axis == "y":
        # swap roles by building along x then rotating is messy; build directly
        cx = (x0 + x1) / 2; hw = (x1 - x0) / 2 + over
        slope = (z_ridge - z_eave) / ((x1 - x0) / 2)
        ze = z_eave - over * slope
        for s in (-1, 1):
            xe = cx + s * hw
            top = [(xe, y0 - gable_over, ze), (cx, y0 - gable_over, z_ridge), (cx, y1 + gable_over, z_ridge), (xe, y1 + gable_over, ze)]
            if s > 0:
                top = top[::-1]
            bot = [(p[0], p[1], p[2] - thick) for p in top]
            _slab(sol, top, bot, key, fascia_key)
        return
    cy = (y0 + y1) / 2; hw = (y1 - y0) / 2 + over
    slope = (z_ridge - z_eave) / ((y1 - y0) / 2)
    ze = z_eave - over * slope
    for s in (-1, 1):
        ye = cy + s * hw
        top = [(x0 - gable_over, ye, ze), (x1 + gable_over, ye, ze), (x1 + gable_over, cy, z_ridge), (x0 - gable_over, cy, z_ridge)]
        if s > 0:
            top = top[::-1]
        bot = [(p[0], p[1], p[2] - thick) for p in top]
        _slab(sol, top, bot, key, fascia_key)


def _slab(sol, top, bot, key, edge_key):
    """A thick quad slab: top face (CCW seen from above), bottom face, 4 edges. Top face gridded."""
    a, b, c, d = [Vector(p) for p in top]
    nu = max(1, math.ceil((b - a).length / 1.2)); nv = max(1, math.ceil((d - a).length / 1.2))
    V = [[sol.bm.verts.new(a.lerp(b, i / nu).lerp(d.lerp(c, i / nu), j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    mi = sol._mi(key)
    for i in range(nu):
        for j in range(nv):
            f = sol.bm.faces.new((V[i][j], V[i + 1][j], V[i + 1][j + 1], V[i][j + 1])); f.material_index = mi
    A, B, C, D = [Vector(p) for p in bot]
    sol.face([D, C, B, A], edge_key)
    for p, q, P, Q in ((a, b, A, B), (b, c, B, C), (c, d, C, D), (d, a, D, A)):
        sol.face([P, Q, q, p], edge_key)


def gable_wall(sol, x0, x1, y, z_eave, z_ridge, thick, key, res=0.9, outward=-1):
    """Triangular gable end (a vertical prism of a triangle) at y, thickness along y."""
    xm = (x0 + x1) / 2
    tri = [(x0, z_eave), (x1, z_eave), (xm, z_ridge)]
    ya, yb = (y - thick, y) if outward < 0 else (y, y + thick)
    s = sol
    s.face([(x0, ya, z_eave), (x1, ya, z_eave), (xm, ya, z_ridge)][::-1] if False else [(x1, ya, z_eave), (x0, ya, z_eave), (xm, ya, z_ridge)], key)
    s.face([(x0, yb, z_eave), (x1, yb, z_eave), (xm, yb, z_ridge)], key)
    s.face([(x0, ya, z_eave), (xm, ya, z_ridge), (xm, yb, z_ridge), (x0, yb, z_eave)], key)
    s.face([(x1, yb, z_eave), (xm, yb, z_ridge), (xm, ya, z_ridge), (x1, ya, z_eave)], key)


def rubble_mound(sol, heightfn, x0, x1, y0, y1, res=0.45, key="debris", zmin=-0.3):
    """Heightfield mound (debris). heightfn(x,y) -> z (<= zmin means nothing there)."""
    nx = max(2, int((x1 - x0) / res)); ny = max(2, int((y1 - y0) / res))
    def hf(x, y):
        edge = min(x - x0, x1 - x, y - y0, y1 - y)       # fall to the ground at the domain border
        return min(heightfn(x, y), edge * 0.9 - 0.25)
    H = [[hf(x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny) for j in range(ny + 1)] for i in range(nx + 1)]
    V = {}
    def v(i, j):
        if (i, j) not in V:
            V[(i, j)] = sol.bm.verts.new((x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny, max(H[i][j], zmin)))
        return V[(i, j)]
    mi = sol._mi(key)
    for i in range(nx):
        for j in range(ny):
            if max(H[i][j], H[i + 1][j], H[i][j + 1], H[i + 1][j + 1]) <= zmin + 1e-4:
                continue
            f = sol.bm.faces.new((v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1))); f.material_index = mi


def chunk(sol, c, size, rng, key="ashlar", tilt=0.5):
    """An irregular fallen block (squared stone with knocked arrises) at c, rotated randomly."""
    sx, sy, sz = size
    R = Matrix.Rotation(rng.uniform(0, 6.28), 3, "Z") @ Matrix.Rotation(rng.uniform(-tilt, tilt), 3, "X") @ Matrix.Rotation(rng.uniform(-tilt, tilt), 3, "Y")
    k = 0.18
    pts = []
    for dx in (-1, 1):
        for dy in (-1, 1):
            for dz in (-1, 1):
                for ax in range(3):
                    p = [dx * sx / 2, dy * sy / 2, dz * sz / 2]
                    p[ax] *= (1 - k * rng.uniform(0.3, 1.0))
                    pts.append(Vector(p))
    # convex hull of the chamfered corners
    bm = bmesh.new()
    for p in pts:
        bm.verts.new(R @ p + Vector(c))
    res = bmesh.ops.convex_hull(bm, input=bm.verts)
    for g in res.get("geom_interior", []):
        if isinstance(g, bmesh.types.BMVert):
            bm.verts.remove(g)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    vm = {v: sol.bm.verts.new(v.co) for v in bm.verts}
    mi = sol._mi(key)
    for f in bm.faces:
        try:
            nf = sol.bm.faces.new([vm[v] for v in f.verts]); nf.material_index = mi
        except ValueError:
            pass
    bm.free()


# ------------------------------------------------------------------ UVs
def uv_project(obj):
    """Metre-true tiling UVs per face, in units of the face material's tile."""
    me = obj.data
    mode = obj.get("hg_uv", "box"); c = obj.get("hg_uvc", [0, 0])
    roof = obj.get("hg_roof")
    uvl = me.uv_layers.get("UVMap") or me.uv_layers.new(name="UVMap")
    keys = [m.get("hg_key", "ashlar") if m else "ashlar" for m in me.materials]
    for poly in me.polygons:
        key = keys[poly.material_index] if poly.material_index < len(keys) else "ashlar"
        tile = MATS.get(key, 4.0) or 4.0
        n = poly.normal
        ctr = poly.center
        for li in poly.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co
            if key in ROOF and abs(n.z) < 0.97 and abs(n.z) > 0.05:
                # roof: V up the slope, U along the eaves
                t = Vector((-n.y, n.x, 0)).normalized()
                b = n.cross(t).normalized()
                if b.z < 0: b = -b
                u, v = p.dot(t), p.dot(b)
            elif abs(n.z) > 0.72:
                if key in ("planks",) and roof is None:
                    u, v = p.x, p.y
                else:
                    u, v = p.x, p.y
            elif mode == "cyl":
                a = math.atan2(p.y - c[1], p.x - c[0])
                # unwrap relative to the face centre so faces don't straddle the seam
                ac = math.atan2(ctr.y - c[1], ctr.x - c[0])
                d = a - ac
                if d > math.pi: a -= 2 * math.pi
                if d < -math.pi: a += 2 * math.pi
                R = c[2] if len(c) > 2 else 5.0
                u, v = a * R, p.z
                if abs(n.z) > 0.3:  # battered faces: slope length
                    v = p.z / max(0.3, math.sqrt(max(0.0, 1 - n.z * n.z)))
            else:
                t = Vector((-n.y, n.x, 0))
                if t.length < 1e-6:
                    t = Vector((1, 0, 0))
                t.normalize()
                b = n.cross(t).normalized()
                if b.z < 0: b = -b
                u, v = p.dot(t), p.dot(b)
                if key in ("timber",) and abs(n.z) < 0.72:
                    # timber: grain along the longest horizontal run (posts get grain up)
                    pass
            uvl.data[li].uv = (u / tile, v / tile)


# ------------------------------------------------------------------ weathering (COLOR_0)
def _sstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def _fbm(p, oct=3):
    s = 0.0; a = 0.5; f = 1.0
    for _ in range(oct):
        s += a * noise.noise(p * f); a *= 0.5; f *= 2.03
    return s


def weather(objs, soot=(), fresh=(), grime_h=1.8, ao_dist=2.5, ao_rays=20, damp=0.0, seed=None, ground=True,
            dark_under=()):
    """Compute COLOR_0 on every object. soot: [(x,y,z, width, height)] plumes rising above openings.
    fresh: [(x,y,z, radius)] pale freshly-broken stone. dark_under: [(x0,x1,y0,y1,z)] soffits kept dark."""
    seed = SEED if seed is None else seed
    off = Vector((seed * 17.31, seed * 5.77, seed * 3.1))
    # BVH over everything + a ground plane
    bm = bmesh.new()
    for o in objs:
        bm.from_mesh(o.data)
    if ground:
        g = [bm.verts.new(p) for p in ((-80, -80, -0.02), (80, -80, -0.02), (80, 80, -0.02), (-80, 80, -0.02))]
        bm.faces.new(g)
    bvh = BVHTree.FromBMesh(bm); bm.free()
    rng = random.Random(seed)
    dirs = []
    for i in range(ao_rays):
        # cosine-weighted hemisphere (z up); rotated to the normal per sample
        u1 = (i + 0.5) / ao_rays; u2 = (i * 0.618034) % 1.0
        r = math.sqrt(u1); th = 2 * math.pi * u2
        dirs.append(Vector((r * math.cos(th), r * math.sin(th), math.sqrt(max(0, 1 - u1)))))
    for o in objs:
        me = o.data
        keys = [m.get("hg_key", "ashlar") if m else "ashlar" for m in me.materials]
        if "Col" in me.color_attributes:
            me.color_attributes.remove(me.color_attributes["Col"])
        ca = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
        cache = {}
        vals = [0.0] * (len(me.loops) * 4)
        aocache = {}
        for poly in me.polygons:
            key = keys[poly.material_index] if poly.material_index < len(keys) else "ashlar"
            n = poly.normal.copy()
            # a basis around n
            t = n.orthogonal().normalized(); b = n.cross(t)
            # big faces (booleans leave long triangles fanning from a hole): blend each corner's AO toward the
            # face's own centre AO, so a dark loop edge does not smear across a whole merlon
            area = poly.area
            wgt = max(0.0, min(0.75, (area - 0.2) / 1.2))
            ao_c = _ao(poly.center, n, t, b, bvh, dirs, ao_dist) if wgt > 0 else 1.0
            for li in poly.loop_indices:
                vi = me.loops[li].vertex_index
                p = me.vertices[vi].co
                ck = (vi, round(n.x, 2), round(n.y, 2), round(n.z, 2))
                ao = aocache.get(ck)
                if ao is None:
                    ao = _ao(p, n, t, b, bvh, dirs, ao_dist)
                    aocache[ck] = ao
                ao = ao * (1 - wgt) + ao_c * wgt
                col = _vcol(p, n, key, ao, off, soot, fresh, grime_h, damp, dark_under)
                vals[li * 4:li * 4 + 4] = (col[0], col[1], col[2], 1.0)
        ca.data.foreach_set("color", vals)
        me.color_attributes.active_color = ca
        try:
            me.attributes.active_color = ca
        except Exception:
            pass


def _ao(p, n, t, b, bvh, dirs, ao_dist):
    o = p + n * 0.04
    hit = 0
    for d in dirs:
        w = t * d.x + b * d.y + n * d.z
        loc, nrm, idx, dist = bvh.ray_cast(o, w, ao_dist)
        if loc is not None:
            hit += 1.0 - 0.6 * (dist / ao_dist)
    return 1.0 - hit / len(dirs)


def _vcol(p, n, key, ao, off, soot, fresh, grime_h, damp, dark_under):
    if key in ("water", "dark"):
        c = AVG[key]
        return c
    m = 0.46 + 0.54 * ao
    r = g = bl = m
    q = p + off
    z = p.z
    if key == "plaster":
        r *= 0.84; g *= 0.8; bl *= 0.72
    if key in STONE or key in ("plaster", "earth"):
        macro = 1.0 + 0.18 * _fbm(q * 0.08) + 0.07 * _fbm(q * 0.4 + Vector((3, 1, 7)))
        r *= macro; g *= macro; bl *= macro
        if key != "earth":
            # grime and damp at the foot
            gr = _sstep(grime_h, -0.2, z)
            gm = gr * (0.55 + 0.35 * (0.5 + 0.5 * _fbm(q * 0.7)))
            r *= 1 - 0.5 * gm; g *= 1 - 0.45 * gm; bl *= 1 - 0.58 * gm
            # rain streaks on vertical faces
            if abs(n.z) < 0.35:
                s = _fbm(Vector((q.x * 2.2, q.y * 2.2, q.z * 0.16)))
                st = _sstep(0.02, 0.35, s) * (0.6 + 0.4 * _sstep(0, 8, z))
                r *= 1 - 0.3 * st; g *= 1 - 0.29 * st; bl *= 1 - 0.26 * st
                pale = _sstep(0.1, 0.4, -_fbm(Vector((q.x * 1.6 + 9, q.y * 1.6, q.z * 0.2))))
                r *= 1 + 0.08 * pale; g *= 1 + 0.08 * pale; bl *= 1 + 0.07 * pale
            # lichen / moss on up-facing surfaces and damp patches
            up = _sstep(0.3, 0.9, n.z)
            lic = up * _sstep(-0.05, 0.3, _fbm(q * 1.3 + Vector((5, 5, 5))))
            lic = max(lic, damp * _sstep(0.1, 0.45, _fbm(q * 0.6 + Vector((1, 9, 2)))) * _sstep(3.0, 0.0, z))
            r *= 1 - 0.18 * lic; g *= 1 - 0.06 * lic; bl *= 1 - 0.3 * lic
    elif key in WOOD:
        macro = 1.0 + 0.12 * _fbm(q * 0.3)
        r *= macro; g *= macro; bl *= macro
        gr = _sstep(1.0, -0.2, z) * 0.5
        r *= 1 - 0.3 * gr; g *= 1 - 0.3 * gr; bl *= 1 - 0.35 * gr
        if key == "shingle":
            moss = _sstep(0.0, 0.4, _fbm(q * 0.8)) * 0.5
            r *= 1 - 0.25 * moss; bl *= 1 - 0.35 * moss
    elif key in ("slate", "lead"):
        macro = 1.0 + 0.12 * _fbm(q * 0.25)
        r *= macro; g *= macro; bl *= macro
        st = _sstep(0.0, 0.4, _fbm(Vector((q.x * 1.5, q.y * 1.5, q.z * 0.3))))
        r *= 1 - 0.12 * st; g *= 1 - 0.1 * st; bl *= 1 - 0.08 * st
    # soot above openings (hearths, loops that burned, flues)
    for src in soot:
        sx, sy, sz, sw, sh = src[:5]
        k = src[5] if len(src) > 5 else 1.0
        dz = z - sz
        if -0.3 < dz < sh:
            dh = math.hypot(p.x - sx, p.y - sy)
            wid = sw * (0.55 + 0.9 * max(0, dz) / sh)
            if dh < wid:
                f = (1 - max(0, dz) / sh) ** 0.8 * (1 - dh / wid) ** 0.7 * _sstep(-0.3, 0.1, dz)
                f *= 0.75 + 0.25 * _fbm(Vector((p.x * 3, p.y * 3, p.z * 1.2)) + off)
                f *= k
                r *= 1 - 0.78 * f; g *= 1 - 0.79 * f; bl *= 1 - 0.8 * f
    for (fx, fy, fz, fr) in fresh:
        d = (p - Vector((fx, fy, fz))).length
        if d < fr:
            f = (1 - d / fr) ** 0.7
            r *= 1 + 0.22 * f; g *= 1 + 0.19 * f; bl *= 1 + 0.12 * f
    for (x0, x1, y0, y1, zz) in dark_under:
        if x0 <= p.x <= x1 and y0 <= p.y <= y1 and p.z < zz:
            r *= 0.7; g *= 0.7; bl *= 0.7
    return (max(0.02, min(r, 1.6)), max(0.02, min(g, 1.6)), max(0.02, min(bl, 1.6)))


# ------------------------------------------------------------------ export
def _join(objs, name):
    objs = [o for o in objs if o and o.type == "MESH" and len(o.data.polygons)]
    if not objs:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    # keep the uv/cyl mode of the first; UVs are projected per object BEFORE joining
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name; o.data.name = name
    return o


def finish_piece(name, parts, moving=None, meta=None, lods=(1.0, 0.4), soot=(), fresh=(), damp=0.0,
                 dark_under=(), smooth=None, grime_h=1.8, ao_dist=1.8):
    """parts: {part_name: [objects]} (static, origin = piece origin). moving: {node_name: (objects, pivot)}.
    Writes assets/glb/castle_<name>.glb and merges meta into assets/castle-kit.json."""
    moving = moving or {}
    allobjs = []
    for objs in list(parts.values()) + [m[0] for m in moving.values()]:
        for o in objs:
            if o is None:
                continue
            uv_project(o)
            allobjs.append(o)
    weather(allobjs, soot=soot, fresh=fresh, damp=damp, dark_under=dark_under, grime_h=grime_h, ao_dist=ao_dist)
    out = []
    tris = {}
    for pname, objs in parts.items():
        o = _join(objs, pname + "_LOD0")
        if not o:
            continue
        _shade(o, smooth)
        out.append(o)
        tris[pname + "_LOD0"] = _tris(o)
        for i, r in enumerate(lods[1:], start=1):
            d = o.copy(); d.data = o.data.copy(); d.name = f"{pname}_LOD{i}"
            bpy.context.scene.collection.objects.link(d)
            mod = d.modifiers.new("dec", "DECIMATE"); mod.ratio = r
            try:
                mod.use_collapse_triangulate = True
            except Exception:
                pass
            bpy.context.view_layer.objects.active = d
            bpy.ops.object.select_all(action="DESELECT"); d.select_set(True)
            bpy.ops.object.modifier_apply(modifier=mod.name)
            out.append(d)
            tris[f"{pname}_LOD{i}"] = _tris(d)
    for mname, (objs, pivot) in moving.items():
        o = _join(objs, mname)
        if not o:
            continue
        _shade(o, smooth)
        # origin at the pivot
        piv = Vector(pivot)
        o.data.transform(Matrix.Translation(-piv)); o.location = piv
        out.append(o); tris[mname] = _tris(o)
    path = os.path.join(GLB_DIR, f"castle_{name}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for o in out:
        o.select_set(True)
    kw = dict(filepath=path, use_selection=True, export_apply=True, export_format="GLB",
              export_image_format="NONE", export_yup=True)
    for extra in (dict(export_vertex_color="ACTIVE"), dict(export_colors=True), {}):
        try:
            bpy.ops.export_scene.gltf(**kw, **extra)
            break
        except TypeError:
            continue
    patch_glb(path)
    total = sum(v for k, v in tris.items() if "_LOD" not in k or k.endswith("_LOD0"))
    lod0 = sum(v for k, v in tris.items() if "_LOD" not in k) + sum(v for k, v in tris.items() if k.endswith("_LOD0"))
    print(f"HG_EXPORT {path} parts={list(parts)} moving={list(moving)} tris={tris} LOD0_total={sum(v for k,v in tris.items() if not any(k.endswith(f'_LOD{i}') for i in range(1,4)))}")
    if meta is not None:
        meta = dict(meta)
        meta["file"] = f"castle_{name}.glb"
        meta["tris_lod0"] = sum(v for k, v in tris.items() if not any(k.endswith(f"_LOD{i}") for i in range(1, 4)))
        meta["moving"] = {m: {"pivot": V3(pv)} for m, (o_, pv) in moving.items()} if moving else {}
        meta["nodes"] = sorted(tris.keys())
        write_meta(name, meta)
    return path


def _tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def _shade(o, smooth):
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
    if smooth:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth))
    else:
        bpy.ops.object.shade_flat()


def patch_glb(path):
    """Point every castle_<key> material at the shared texture library by relative URI."""
    data = open(path, "rb").read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    clen, ctype = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + clen].decode("utf-8"))
    rest = data[20 + clen:]
    js.setdefault("images", []); js.setdefault("textures", []); js.setdefault("samplers", [])
    js["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}]
    img_idx = {}

    def tex(fn):
        if fn not in img_idx:
            js["images"].append({"uri": TEX_URI + fn, "mimeType": "image/jpeg", "name": fn[:-4]})
            js["textures"].append({"sampler": 0, "source": len(js["images"]) - 1})
            img_idx[fn] = len(js["textures"]) - 1
        return img_idx[fn]
    for m in js.get("materials", []):
        nm = m.get("name", "")
        if not nm.startswith("castle_"):
            continue
        key = nm[len("castle_"):]
        pbr = m.setdefault("pbrMetallicRoughness", {})
        pbr["metallicFactor"] = 0.0
        if MATS.get(key):
            pbr["baseColorFactor"] = [1, 1, 1, 1]
            pbr["baseColorTexture"] = {"index": tex(f"{key}_albedo.jpg")}
            pbr["metallicRoughnessTexture"] = {"index": tex(f"{key}_rough.jpg")}
            pbr["roughnessFactor"] = 1.0
            m["normalTexture"] = {"index": tex(f"{key}_normal.jpg"), "scale": 1.0}
        else:
            pbr["baseColorFactor"] = [1, 1, 1, 1]
            pbr["roughnessFactor"] = 0.15 if key == "water" else 0.9
        m.setdefault("extras", {})["hg_tile_m"] = MATS.get(key, 0)
    if not js["images"]:
        for k in ("images", "textures", "samplers"):
            js.pop(k, None)
    raw = json.dumps(js, separators=(",", ":")).encode("utf-8")
    raw += b" " * ((4 - len(raw) % 4) % 4)
    body = struct.pack("<II", len(raw), 0x4E4F534A) + raw + rest
    out = struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body
    open(path, "wb").write(out)


def write_meta(name, meta):
    kit = {}
    if os.path.exists(KIT_JSON):
        try:
            kit = json.load(open(KIT_JSON))
        except Exception:
            kit = {}
    kit.update(kit_header())
    kit.setdefault("pieces", {})[name] = _round(meta)
    kit["pieces"] = dict(sorted(kit["pieces"].items()))
    txt = json.dumps(kit, indent=1)
    open(KIT_JSON, "w").write(txt)


def kit_header():
    import _dims as Dm
    mats = {}
    for k, t in MATS.items():
        j = {}
        try:
            j = json.load(open(os.path.join(TEX_DIR, k + ".json")))
        except Exception:
            pass
        mats["castle_" + k] = {"tile_m": t, "avg_srgb": j.get("avg_srgb", "#%02x%02x%02x" % tuple(int(c ** (1 / 2.2) * 255) for c in AVG.get(k, (0.3, 0.3, 0.3)))),
                               "maps": ({m: TEX_URI.replace("../", "assets/") + f"{k}_{m}.jpg" for m in ("albedo", "normal", "rough")} if t else {})}
    return {
        "version": 1,
        "doc": "docs/siege-art-contract.md (Castle kit) and docs/castle-plan.md §2.1",
        "conventions": {
            "units": "metres",
            "frame": "piece-local [x, y, z]: x,y = the sim's local map plane (world = rotate by rot, then translate), z = height above the piece's ground origin. glTF nodes are exported Y-up: glTF (x, y, z) = (x, z, -y), i.e. exactly the renderer's sim->three mapping (x, h, -y).",
            "outer": "outer (field) face toward -y unless a piece says otherwise",
            "ground": "z=0 is ground; foundations continue to z=-2 so a piece can sit on a slope",
            "nodes": "static parts are '<part>_LOD0' / '<part>_LOD1'; part = base | upper_<n> (storey n and its floor) | roof (roofs, top floor, battlements above the last storey). Hide roof + upper_<k> for k > n to look into storey n. Moving parts have no LOD suffix and their node origin is the pivot (see each piece's 'moving').",
            "materials": "every material is castle_<key>; maps are shared, referenced by relative URI from the GLB (../tex/castle/<key>_{albedo,normal,rough}.jpg); UVs are metres / tile_m (repeat wrap). COLOR_0 carries AO + weathering and multiplies the base colour (GLTFLoader does this automatically).",
            "levels": "suggested level ids: 0 ground (incl. tower/keep ground floors and the gate passage), 1 the wall-walk network at z=8 (curtain walks, tower doors, gatehouse chamber), 2 tower tops and the gatehouse roof, 3 tower first floors (z=4.2), 4+ keep storeys (see the keep). Each walk surface also carries its own z.",
            "walks": "kind 'strip' = centreline 'line' [[x,y]...] + 'width'; kind 'poly' = polygon [[x,y]...]; all at height z.",
            "links": "{kind: stair|ladder|door|breach|scramble|hatch, a:{surf, p:[x,y,z]}, b:{surf, p}, width (men abreast), via: optional waypoints}",
            "ladders": "points where a scaling ladder reaches the parapet: top = crenel sill on the outer face, foot on the ground at LADDER_ANGLE",
        },
        "dims": {k: getattr(Dm, k) for k in dir(Dm) if k.isupper()},
        "materials": mats,
    }


def _round(x):
    if isinstance(x, float):
        return round(x, 3)
    if isinstance(x, dict):
        return {k: _round(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_round(v) for v in x]
    return x


def V2(p):
    return [round(p[0], 3), round(p[1], 3)]


def V3(p):
    return [round(p[0], 3), round(p[1], 3), round(p[2], 3)]
