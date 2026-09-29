"""Vegetation helpers shared by pine / birch / alder / willow / dead_tree / fruit_tree /
bush / hedge_shrub / log.  Builds on _trees.py (see docs/tree-recipe.md).

Adds:
  * atlas()          generalised leaf-atlas renderer: leaf sprays, pine needle brushes,
                     bare twigs, fruit / berries (spheres), per-cell recipes.
  * bark_zblend()    splice a height-dependent second bark colour (pine orange upper trunk,
                     birch white/black) into a T.bark_material node tree.
  * card_lods()      LOD-specific card sets: <name>_cards_LOD0/1/2 so the game draws the full
                     crown near, a thinned crown with larger cards mid, and a handful far.
  * pin_centre()     keeps the trunk base at the origin after finish() bbox-centres.
  * finish()         L.finish + renames the card objects per LOD and re-exports.
"""
import bpy, bmesh, math, random, os
import numpy as np
from mathutils import Vector, Matrix, Quaternion
import _lib as L
import _trees as T

srgb = T.srgb


# ---------------------------------------------------------------- atlas
def _strip(bm, p, q, r0, r1, col_layer=None, col=None):
    d = q - p
    if d.length < 1e-6: return
    o = Vector((-d.y, d.x, 0)).normalized()
    v = [bm.verts.new(p - o * r0), bm.verts.new(p + o * r0), bm.verts.new(q + o * r1), bm.verts.new(q - o * r1)]
    f = bm.faces.new(v)
    if col_layer is not None:
        for lp in f.loops: lp[col_layer] = col


def needle_outline(rng):
    w = rng.uniform(0.030, 0.042)
    return [(0.004, 0.0), (w, 0.08), (w, 0.85), (w * 0.4, 0.97), (0.0, 1.0)]


def _rot2(v, a):
    c, s = math.cos(a), math.sin(a)
    return Vector((v.x * c - v.y * s, v.x * s + v.y * c, 0))


def atlas(path, cells, res=1024, grid=2, seed=5, samples=48, twig="#5b4a36"):
    """cells: list (grid*grid) of dicts. Keys:
         kind: 'spray' (broadleaf twig spray) | 'needles' (pine shoot brushes) | 'twigs' (bare)
         outline: fn(rng)->[(hw,t)], leaves: int, leaf_len: float (fraction of cell),
         greens: [hex], tint: (r,g,b), dry: hex, dry_p: float,
         shoots: int (needles), needles: int per shoot,
         fruit: (count, radius_frac, [hex]),  twig: hex, twig_w: float
    Renders top-down ortho under a white sky -> albedo x AO; RGB bled into clear texels."""
    rng = random.Random(seed); sc = bpy.context.scene; made = []
    lb = bmesh.new(); uv = lb.loops.layers.uv.new("leaf"); cl = lb.loops.layers.color.new("col")
    tw = bmesh.new(); tcl = tw.loops.layers.color.new("col")
    fb = bmesh.new(); fcl = fb.loops.layers.color.new("col")
    cell = 1.0 / grid
    for gi, spec in enumerate(cells):
        kind = spec.get("kind", "spray")
        tint = spec.get("tint", (1, 1, 1))
        cx = (gi % grid + 0.5) * cell; cy = (gi // grid + 0.5) * cell
        C = Vector((cx, cy, 0)); half = cell / 2 * 0.94
        tcol = (*[c * 1.0 for c in srgb(spec.get("twig", twig))], 1.0)

        def inside(p, m=0.0):
            return Vector((min(max(p.x, cx - half + m), cx + half - m), min(max(p.y, cy - half + m), cy + half - m), p.z))

        def leaf_at(anchor, ang, ln, z, greens):
            ol = spec.get("outline", T.oak_leaf_outline)(rng)
            anchor = inside(anchor, ln * 1.02)
            M = (Matrix.Translation(anchor + Vector((0, 0, z))) @ Matrix.Rotation(ang, 4, "Z")
                 @ Matrix.Rotation(rng.uniform(-0.35, 0.35), 4, "X") @ Matrix.Rotation(rng.uniform(-0.25, 0.25), 4, "Y")
                 @ Matrix.Scale(ln, 4))
            g = srgb(rng.choice(greens))
            if rng.random() < spec.get("dry_p", 0.06): g = srgb(spec.get("dry", "#9a9440"))
            j = rng.uniform(0.85, 1.15)
            T._leaf_mesh(lb, ol, M, uv, cl, (g[0] * j * tint[0], g[1] * j * tint[1], g[2] * j * tint[2], 1.0))

        if kind == "spray":
            tips = []; a0 = rng.uniform(0, 6.283); sd = Vector((math.cos(a0), math.sin(a0), 0))
            spread = spec.get("spread", 0.36)
            base = C - sd * spread * cell * 0.9
            segs = [(base, base + sd * spread * cell * 1.3)]; tips.append(segs[0][1])
            for k in range(rng.randint(3, 5)):
                t = rng.uniform(0.2, 0.85); p = base + sd * spread * cell * 1.3 * t
                side = _rot2(sd, rng.choice((-1, 1)) * rng.uniform(0.5, 1.1))
                q = p + side * spread * cell * rng.uniform(0.35, 0.7); segs.append((p, q)); tips.append(q)
            for p, q in segs: _strip(tw, p, q, spec.get("twig_w", 0.004), 0.002, tcl, tcol)
            ll = spec.get("leaf_len", 0.105)
            for li in range(spec.get("leaves", 40)):
                if li < len(tips) * spec.get("per_tip", 8):
                    k = li % len(tips); anchor = tips[k]; lift = rng.uniform(0.0, 0.03)
                    p, q = segs[k]; th = math.atan2(q.y - p.y, q.x - p.x) + rng.gauss(0, 0.55)
                else:
                    p, q = rng.choice(segs); anchor = p.lerp(q, rng.uniform(0.2, 1.0)); lift = rng.uniform(0, 0.02)
                    # alternate leaves along the twig, angled forward 35-70 deg
                    th = math.atan2(q.y - p.y, q.x - p.x) + rng.choice((-1, 1)) * rng.uniform(0.6, 1.2)
                ln = ll * cell * rng.uniform(0.75, 1.15) * 2.2
                ang = th - math.pi / 2
                leaf_at(anchor, ang, ln, 0.01 + lift + rng.random() * 0.03, spec["greens"])
        elif kind == "needles":
            # a branchlet with several upturned shoots, each a bottle-brush of needle pairs
            a0 = rng.uniform(0, 6.283); sd = Vector((math.cos(a0), math.sin(a0), 0))
            base = C - sd * cell * 0.38; main_end = C + sd * cell * 0.3
            _strip(tw, base, main_end, 0.006, 0.004, tcl, tcol)
            shoots = []
            for k in range(spec.get("shoots", 7)):
                t = rng.uniform(0.15, 1.0); p = base.lerp(main_end, t)
                ang = rng.choice((-1, 1)) * rng.uniform(0.35, 1.2) if k else 0.0
                d = _rot2(sd, ang); L_ = cell * rng.uniform(0.16, 0.3)
                q = inside(p + d * L_, cell * 0.06); _strip(tw, p, q, 0.0035, 0.0025, tcl, tcol); shoots.append((p, q))
            nl = spec.get("leaf_len", 0.07) * cell
            for p, q in shoots:
                d = (q - p); dl = d.length; d = d.normalized()
                for k in range(spec.get("needles", 70)):
                    t = rng.random() ** 0.6            # denser toward the shoot tip (tufted)
                    a = p.lerp(q, 0.25 + 0.75 * t)
                    side = rng.choice((-1, 1))
                    ang = math.atan2(d.y, d.x) - math.pi / 2 + side * rng.uniform(0.35, 1.25)
                    ln = nl * rng.uniform(0.7, 1.15) * (0.75 + 0.35 * t)
                    leaf_at(a, ang, ln, 0.01 + 0.03 * t + rng.random() * 0.01, spec["greens"])
                # terminal tuft
                for k in range(spec.get("tuft", 16)):
                    ang = math.atan2(d.y, d.x) - math.pi / 2 + rng.gauss(0, 0.8)
                    leaf_at(q, ang, nl * rng.uniform(0.6, 1.0), 0.05, spec["greens"])
        elif kind == "twigs":
            def grow(p, d, L_, w, depth):
                q = inside(p + d * L_, 0.004)
                _strip(tw, p, q, w, w * 0.62, tcl, tcol)
                if depth <= 0: return
                for s in (-1, 1):
                    if rng.random() < 0.85:
                        grow(p.lerp(q, rng.uniform(0.45, 0.95)), _rot2(d, s * rng.uniform(0.35, 0.8)), L_ * rng.uniform(0.5, 0.72), w * 0.62, depth - 1)
                grow(q, _rot2(d, rng.gauss(0, 0.25)), L_ * 0.7, w * 0.66, depth - 1)
            a0 = rng.uniform(0, 6.283); d0 = Vector((math.cos(a0), math.sin(a0), 0))
            grow(C - d0 * cell * 0.42, d0, cell * 0.36, spec.get("twig_w", 0.009), spec.get("depth", 5))
        fr = spec.get("fruit")
        if fr:
            n, rf, cols = fr
            for k in range(n):
                p = inside(C + Vector((rng.gauss(0, 0.22), rng.gauss(0, 0.22), 0)) * cell, rf * cell * 1.5)
                r = rf * cell * rng.uniform(0.8, 1.15)
                g = srgb(rng.choice(cols)); j = rng.uniform(0.85, 1.1)
                res_ = bmesh.ops.create_uvsphere(fb, u_segments=12, v_segments=8, radius=r,
                                                 matrix=Matrix.Translation(p + Vector((0, 0, 0.09))))
                for f in {f for v in res_["verts"] for f in v.link_faces}:
                    for lp in f.loops: lp[fcl] = (g[0] * j, g[1] * j, g[2] * j, 1.0)
    objs = []
    for bm_, nm, mk in ((lb, "leafclust", "leaf"), (tw, "twigs", "twig"), (fb, "fruit", "fruit")):
        me = bpy.data.meshes.new(nm); bm_.to_mesh(me); bm_.free()
        ob = bpy.data.objects.new(nm, me); sc.collection.objects.link(ob); made.append(ob); objs.append(ob)
    # leaf material (vertex colour + midrib/veins + mottling) as in T.leaf_atlas
    n_ = T._n; mth = T._math; mix = T._mix
    m, n, l, b = L.mat("leafrender")
    ca = n_(n, "ShaderNodeVertexColor", layer_name="col")
    u = n_(n, "ShaderNodeUVMap", uv_map="leaf"); su = n.new("ShaderNodeSeparateXYZ"); l.new(u.outputs[0], su.inputs[0])
    ax = mth(n, l, "ABSOLUTE", su.outputs[0])
    rib = mth(n, l, "SUBTRACT", 1.0, mth(n, l, "DIVIDE", ax, 0.012), clamp=True)
    vein = mth(n, l, "SINE", mth(n, l, "MULTIPLY", mth(n, l, "SUBTRACT", su.outputs[1], mth(n, l, "MULTIPLY", ax, 1.2)), 50.0))
    vein = mth(n, l, "MULTIPLY", mth(n, l, "SUBTRACT", vein, 0.96), 6.0, clamp=True)
    vein = mth(n, l, "MULTIPLY", vein, mth(n, l, "SUBTRACT", 1.0, mth(n, l, "DIVIDE", ax, 0.25), clamp=True))
    mot = n_(n, "ShaderNodeTexNoise", in_Scale=30.0, in_Detail=4.0)
    geo = n.new("ShaderNodeNewGeometry"); l.new(geo.outputs["Position"], mot.inputs["Vector"])
    c = mix(n, l, ca.outputs["Color"], srgb("#a3b56a"), mth(n, l, "MULTIPLY", mth(n, l, "ADD", rib, vein), 0.25))
    c = mix(n, l, c, srgb("#3c5220"), mth(n, l, "MULTIPLY", mot.outputs["Fac"], 0.25))
    l.new(c, b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.7
    objs[0].data.materials.append(m)
    for ob, nm in ((objs[1], "twigrender"), (objs[2], "fruitrender")):
        m2, n2, l2, b2 = L.mat(nm)
        vc = n_(n2, "ShaderNodeVertexColor", layer_name="col"); l2.new(vc.outputs["Color"], b2.inputs["Base Color"])
        b2.inputs["Roughness"].default_value = 0.5 if nm == "fruitrender" else 0.9
        ob.data.materials.append(m2)
    cd = bpy.data.cameras.new("lc"); cd.type = "ORTHO"; cd.ortho_scale = 1.0
    cam = bpy.data.objects.new("lc", cd); sc.collection.objects.link(cam); made.append(cam)
    cam.location = (0.5, 0.5, 5); sc.camera = cam
    w = bpy.data.worlds.new("lw"); w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
    old_w = sc.world; sc.world = w
    r = sc.render; r.resolution_x = r.resolution_y = res; r.film_transparent = True
    r.image_settings.file_format = "PNG"; r.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"; sc.cycles.samples = samples; sc.cycles.use_denoising = False
    r.filepath = path; bpy.ops.render.render(write_still=True)
    for o in made: bpy.data.objects.remove(o, do_unlink=True)
    sc.world = old_w
    img = bpy.data.images.load(path, check_existing=False)
    T._dilate_alpha(img); img.save()
    return img


def load_or_make(png, maker, force=False):
    os.makedirs(L.TEX_DIR, exist_ok=True)
    if force or not os.path.exists(png):
        return maker()
    return bpy.data.images.load(png, check_existing=True)


# ---------------------------------------------------------------- bark zone blend
def _final_color_link(m):
    b = m.node_tree.nodes["Principled BSDF"]
    for lk in m.node_tree.links:
        if lk.to_socket == b.inputs["Base Color"]:
            return lk.from_socket
    return None


def bark_zblend(m, upper, z0, z1, noise_amp=0.8, r_max=None, invert=False, bump_scale=None):
    """Blend T.bark_material's colour toward an upper-zone colour network between heights
    z0..z1 (noisy, ragged boundary). upper(n, l, coord, rad, geo) -> colour socket.
    invert=True: the upper colour is used BELOW z0 instead (e.g. dark birch base).
    bump_scale: multiply the bump strength inside the blended zone (smooth papery bark)."""
    n, l = m.node_tree.nodes, m.node_tree.links; b = n["Principled BSDF"]
    base_col = _final_color_link(m)
    co, rad = T.bark_coords(n, l, 1.0)
    geo = n.new("ShaderNodeNewGeometry")
    sp = n.new("ShaderNodeSeparateXYZ"); l.new(geo.outputs["Position"], sp.inputs[0])
    nz = T._n(n, "ShaderNodeTexNoise", in_Scale=0.9, in_Detail=4.0, in_Roughness=0.6)
    l.new(geo.outputs["Position"], nz.inputs["Vector"])
    z = T._math(n, l, "ADD", sp.outputs[2], T._math(n, l, "MULTIPLY", T._math(n, l, "SUBTRACT", nz.outputs["Fac"], 0.5), noise_amp * (z1 - z0) + 0.4))
    f = T._math(n, l, "DIVIDE", T._math(n, l, "SUBTRACT", z, z0), max(0.01, z1 - z0))
    f = T._math(n, l, "MINIMUM", T._math(n, l, "MAXIMUM", f, 0.0), 1.0)
    if invert: f = T._math(n, l, "SUBTRACT", 1.0, f)
    if r_max is not None:  # thin branches also get the upper colour
        f = T._math(n, l, "MAXIMUM", f, T._math(n, l, "SUBTRACT", 1.0, T._math(n, l, "DIVIDE", rad, r_max), clamp=True))
    up = upper(n, l, co, rad, geo)
    col = T._mix(n, l, base_col, up, f)
    l.new(col, b.inputs["Base Color"])
    if bump_scale is not None:
        bump = next((x for x in n if x.type == "BUMP"), None)
        if bump is not None:
            src = None
            for lk in l:
                if lk.to_socket == bump.inputs["Strength"]: src = lk.from_socket
            s = T._math(n, l, "ADD", T._math(n, l, "MULTIPLY", f, bump_scale - 1.0), 1.0)
            l.new(T._math(n, l, "MULTIPLY", s, bump.inputs["Strength"].default_value), bump.inputs["Strength"])
    return f


def noise_col(n, l, co, scale, c1, c2, stretch=(1, 1, 1), detail=4.0):
    vm = n.new("ShaderNodeVectorMath"); vm.operation = "MULTIPLY"; vm.inputs[1].default_value = stretch
    l.new(co, vm.inputs[0])
    nz = T._n(n, "ShaderNodeTexNoise", in_Scale=scale, in_Detail=detail, in_Roughness=0.6)
    l.new(vm.outputs[0], nz.inputs["Vector"])
    return T._mix(n, l, srgb(c1), srgb(c2), nz.outputs["Fac"]), nz.outputs["Fac"]


# ---------------------------------------------------------------- cards
def cards(pts, image, centre, ext, rng, size, name, lod, cell_pick=None, up_bias=0.3, spread=0.35,
          facing_random=1.4, zmin=0.03, **kw):
    ob = T.scatter_cards(pts, image, centre, ext, rng, size=size, name=name, cell_pick=cell_pick,
                         up_bias=up_bias, spread=spread, facing_random=facing_random, **kw)
    ob["hg_lod"] = lod
    me = ob.data
    for v in me.vertices:   # nothing below ground: finish() grounds by bbox
        if v.co.z < zmin: v.co.z = zmin
    return ob


def card_lods(pts, image, centre, ext, rng, name, size, lod_keep=(1.0, 0.28, 0.07), lod_grow=(1.0, 1.7, 3.0),
              share=True, **kw):
    """Three card sets. LOD1/2 keep a random subset with enlarged cards (roughly preserved cover)."""
    obs = []
    for lod, (keep, grow) in enumerate(zip(lod_keep, lod_grow)):
        if keep <= 0: continue
        sub = [p for p in pts if rng.random() < keep] if keep < 1 else list(pts)
        if not sub: sub = pts[:1]
        obs.append(cards(sub, image, centre, ext, rng, (size[0] * grow, size[1] * grow), f"{name}_c{lod}", lod, **kw))
    if share:
        m = obs[0].data.materials[0]
        for o in obs[1:]:
            old = o.data.materials[0]; o.data.materials[0] = m; bpy.data.materials.remove(old)
    return obs


def pin_centre(mat_, zc=1.0):
    """finish() centres the bbox of everything on the origin. Add two 1 mm triangles at the
    point-mirror of the bbox corners so the bbox is symmetric about the trunk (x=y=0)."""
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in bpy.context.scene.objects:
        if o.type != "MESH": continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c); lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    X = max(abs(lo.x), abs(hi.x)); Y = max(abs(lo.y), abs(hi.y))
    bm = bmesh.new(); uva = bm.loops.layers.uv.new("bk_a"); uvb = bm.loops.layers.uv.new("bk_b")
    for sx, sy in ((-1, -1), (1, 1)):
        p = Vector((sx * X, sy * Y, zc))
        vs = [bm.verts.new(p), bm.verts.new(p + Vector((0.001, 0, 0))), bm.verts.new(p + Vector((0, 0, 0.001)))]
        bm.faces.new(vs)
    me = bpy.data.meshes.new("pin"); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new("pin", me); bpy.context.scene.collection.objects.link(ob)
    L.assign(ob, mat_)
    return ob


def finish(name, tex=1024, lods=(1.0, 0.3, 0.08), **kw):
    """L.finish, then name card objects <name>_cards_LOD<k> (props.js buckets by /_LOD(\\d)/;
    booth.py shows *_LOD0) and re-export the GLB."""
    # cards must not shadow the bark AO bake (a white birch stem went black inside its crown);
    # the engine's own lighting/shadows darken the inner crown at runtime
    cards_ = [o for o in bpy.context.scene.objects if "hg_lod" in o.keys()]
    for o in cards_: o.hide_render = True
    path = L.finish(name, tex=tex, lods=lods, **kw)
    for o in cards_: o.hide_render = False
    sel = []
    for o in bpy.context.scene.objects:
        if o.type != "MESH": continue
        if "hg_lod" in o.keys():
            o.name = f"{name}_cards_LOD{int(o['hg_lod'])}"
        sel.append(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in sel: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_apply=True,
                              export_image_format="JPEG", export_jpeg_quality=90)
    stats = {}
    for o in sel:
        stats[o.name] = sum(len(p.vertices) - 2 for p in o.data.polygons)
    tot = [0, 0, 0]
    for k, v in stats.items():
        for i in range(3):
            if k.endswith(f"_LOD{i}"): tot[i] += v
    print(f"HG_VEG {name} " + " ".join(f"{k}={v}" for k, v in sorted(stats.items())) + f" | total LOD0={tot[0]} LOD1={tot[1]} LOD2={tot[2]}")
    return path


def wood(sk, rad, name, bark, budget, min_rs=(0.02, 0.025, 0.03, 0.035, 0.042, 0.05, 0.06, 0.07, 0.085, 0.1, 0.12),
         **kw):
    """build_tubes, raising min_r until the tri budget fits."""
    for min_r in min_rs:
        ob = T.build_tubes(sk, rad, min_r=min_r, name=name, **kw)
        tris = T.tri_count(ob)
        if tris <= budget: break
        bpy.data.objects.remove(ob, do_unlink=True)
    print(f"{name}: min_r={min_r} wood_tris={tris} nodes={len(sk.pos)}")
    L.assign(ob, bark)
    return ob


def crown_frame(lobes):
    centre = sum((c for c, _ in lobes), Vector()) / len(lobes)
    ext = [max(abs(c[i] - centre[i]) + r[i] for c, r in lobes) for i in range(3)]
    return centre, ext


def sector_balance(sk, rad, r_leaf=0.03):
    h = [0] * 8
    for i, p in enumerate(sk.pos):
        if rad[i] <= r_leaf:
            h[int((math.atan2(p.y, p.x) + math.pi) / (2 * math.pi) * 8) % 8] += 1
    return h


def bark_blend(m, colour_fn, fac_fn):
    """Generic: mix colour_fn(n,l,co,rad,geo) over the bark colour by fac_fn(n,l,co,rad,geo)."""
    n, l = m.node_tree.nodes, m.node_tree.links; b = n["Principled BSDF"]
    base_col = _final_color_link(m)
    co, rad = T.bark_coords(n, l, 1.0); geo = n.new("ShaderNodeNewGeometry")
    f = fac_fn(n, l, co, rad, geo)
    l.new(T._mix(n, l, base_col, colour_fn(n, l, co, rad, geo), f), b.inputs["Base Color"])
    return f


def const(hexc):
    return lambda n, l, co, rad, geo: srgb(hexc)


def thin_mask(r0, r1):
    """1 on branches thinner than r0, fading to 0 at r1."""
    def f(n, l, co, rad, geo):
        return T._math(n, l, "DIVIDE", T._math(n, l, "SUBTRACT", r1, rad), r1 - r0, clamp=True)
    return f


# ---------------------------------------------------------------- leaf outlines
def serrate(w, t, teeth, depth):
    s = (t * teeth) % 1.0
    return w * (1 - depth * s)


def birch_outline(rng, n=90):
    """Betula pendula: triangular-ovate, long acuminate tip, doubly serrate."""
    out = []
    for i in range(n + 1):
        t = i / n
        env = (math.sin(math.pi * min(1, t / 0.32) * 0.5) if t < 0.32 else (1 - (t - 0.32) / 0.68) ** 1.25) * 0.3
        out.append((serrate(env, t, 11, 0.07 if t > 0.1 else 0), t))
    out[0] = (0.02, 0); out[-1] = (0, 1)
    return out


def alder_outline(rng, n=90):
    """Alnus glutinosa: near-round obovate, notched (emarginate) tip, wavy-toothed."""
    out = []
    for i in range(n + 1):
        t = i / n
        env = math.sin(math.pi * t ** 0.85) ** 0.6 * (0.55 + 0.45 * t) * 0.46
        if t > 0.9: env *= 1 - (t - 0.9) * 3
        out.append((serrate(env, t, 9, 0.1), t))
    out[0] = (0.03, 0); out[-1] = (0.0, 0.93)   # notch: tip pulled in
    return out


def willow_outline(rng, n=60):
    """Salix fragilis: long narrow lanceolate."""
    out = []
    for i in range(n + 1):
        t = i / n
        out.append((math.sin(math.pi * t ** 0.9) ** 0.8 * 0.09 * (1 - 0.3 * t), t))
    out[0] = (0.008, 0); out[-1] = (0, 1)
    return out


def apple_outline(rng, n=70):
    """Malus: ovate-elliptic, finely serrate, short tip."""
    out = []
    for i in range(n + 1):
        t = i / n
        out.append((serrate(math.sin(math.pi * t ** 0.9) ** 0.75 * 0.3, t, 14, 0.08), t))
    out[0] = (0.02, 0); out[-1] = (0, 1)
    return out


def hawthorn_outline(rng, n=90):
    """Crataegus monogyna: small, deeply 3-5 lobed, wedge base."""
    lobes = rng.choice((2, 3)); out = []
    for i in range(n + 1):
        t = i / n
        env = (t ** 0.8) * (1 - t ** 3) * 0.55
        c = abs(math.cos(math.pi * (lobes * t + 0.5 * (t > 0.3))))
        out.append((env * (0.3 + 0.7 * c ** 0.6) if t > 0.25 else env * 0.5, t))
    out[0] = (0.01, 0); out[-1] = (0, 1)
    return out


def hazel_outline(rng, n=80):
    """Corylus: broad, round-cordate, double-serrate, short tip."""
    out = []
    for i in range(n + 1):
        t = i / n
        env = math.sin(math.pi * t ** 0.8) ** 0.55 * 0.45 * (1.1 - 0.4 * t)
        out.append((serrate(env, t, 12, 0.14), t))
    out[0] = (0.05, 0); out[-1] = (0, 1)
    return out


def blackthorn_outline(rng, n=60):
    """Prunus spinosa: small narrow-obovate, finely toothed."""
    out = []
    for i in range(n + 1):
        t = i / n
        out.append((serrate(math.sin(math.pi * t ** 0.7) ** 0.8 * 0.22, t, 10, 0.1), t))
    out[0] = (0.01, 0); out[-1] = (0, 1)
    return out


SHRUB_PNG = os.path.join(L.TEX_DIR, "shrub_leaves.png")


def shrub_atlas(force=False):
    """Shared by bush + hedge_shrub. Cells: 0 hawthorn, 1 hazel, 2 hawthorn sunlit + haws,
    3 blackthorn (shade) + sloes."""
    haws = ["#8e2a1c", "#a3361f", "#7a2419"]; sloes = ["#3b3c50", "#4a4d66", "#35364a"]
    def mk():
        hw = dict(kind="spray", outline=hawthorn_outline, greens=("#56722d", "#607d33", "#6a8838", "#4f6a2a"),
                  leaf_len=0.06, leaves=80, per_tip=10, spread=0.42, twig="#4a3c32", twig_w=0.0035, dry="#8c8a3c", dry_p=0.05)
        hz = dict(hw, outline=hazel_outline, greens=("#648434", "#6e8e3a", "#78973f", "#5c7a30"), leaf_len=0.09,
                  leaves=45, per_tip=7, twig="#6a5440")
        bt = dict(hw, outline=blackthorn_outline, greens=("#4f6a2c", "#587531", "#627f35", "#4a6429"), leaf_len=0.05,
                  leaves=95, per_tip=11, twig="#2f2a28")
        cells = [hw, hz, dict(hw, tint=(1.07, 1.05, 0.9), fruit=(14, 0.013, haws)),
                 dict(bt, tint=(0.84, 0.9, 0.88), fruit=(9, 0.016, sloes))]
        return atlas(SHRUB_PNG, cells, seed=51)
    return load_or_make(SHRUB_PNG, mk, force)
