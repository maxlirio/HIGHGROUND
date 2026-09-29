"""Build + bake one unit (rest mesh GLB, vertex-animation texture, team/dye mask).

    blender -b -t 5 -P tools/vat_bake.py -- <arm> [sheet] [close] [gripcheck] [booth] [nobake] [out=<dir>]

    sheet   render a Workbench pose contact-sheet of every clip  -> assets/booth/unit_<arm>_sheet_{side,front}.png
    booth   Cycles booth renders (close / lineup / game camera)   -> assets/booth/unit_<arm>_{close,lineup,game}.png
    nobake  skip texture painting + VAT (quick geometry/pose iteration with `sheet`)
    close   one big sheet per clip (<=8 frames x 3 views, that clip's kit only) -> close_<arm>_<clip>.png
    gripcheck  per clip: max fist miss (hands placed with _arms_anims.place_hand) and Blender-vs-FK agreement

Outputs (assets/units/):
    <arm>.glb        meshes <arm>_LOD0, <arm>_LOD1 (one material: baseColor + roughness), TEXCOORD_0 = atlas,
                     TEXCOORD_1 = (vertex index into the VAT, 1 - part id)   [glTF flips V]
    <arm>_vat.bin    little-endian uint16 RGBA texels; texel k = frame * nVerts + vertex; width = texWidth.
                     RGB = position quantised into bounds (three.js axes: x, y up, z toward the viewer);
                     A   = octahedral normal, 8 bits x | 8 bits y.
    <arm>_vat.json   clips {name: {start, frames, fps, loop, speed}}, verts [lod0, lod1] (LOD1 rows follow LOD0),
                     texWidth, frames, bounds, parts, dyes, neutral, tris
                     Then tools/vat_pack.py packs the .bin into <arm>_vat.hgz (what the game loads; ~4-5x smaller),
                     strips the GLB's unused normals and moves _col/_rough.png to assets/units-atlas/.
    <arm>_mask.png   R team, G accent, B dye (1.0 = dye 1, 0.5 = dye 2)
The recipe is assets/src/units/<arm>.py: SPEC + build(lod) -> [Part]. See docs/units-pipeline.md.
"""
import bpy, sys, os, math, json, importlib, struct
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
UNITS_SRC = os.path.join(ROOT, "assets", "src", "units")
sys.path.insert(0, UNITS_SRC)
import _human as H, _anims as A, _paint as PT
for m in (H, A, PT): importlib.reload(m)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
UNIT = argv[0]; FLAGS = set(argv[1:])
R = importlib.import_module(UNIT)
SPEC = R.SPEC
OUT = H.UNIT_DIR; BOOTH = os.path.join(ROOT, "assets", "booth")
SHEET_DIR = ([f[4:] for f in FLAGS if f.startswith("out=")] or [BOOTH])[0]   # out=<dir>: sheets somewhere else
os.makedirs(OUT, exist_ok=True); os.makedirs(BOOTH, exist_ok=True)
TEX = SPEC.get("tex", 1024)


def srgb2lin(c): return ((c + 0.055) / 1.055) ** 2.4 if c > 0.04045 else c / 12.92


# ------------------------------------------------------------------------------------------ scene
def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"
    sc.render.threads_mode = "FIXED"; sc.render.threads = 5
    sc.cycles.samples = 16
    return sc


def make_mats():
    mats = {}
    for name, hx in PT.FLAT.items():
        m = bpy.data.materials.new(name)
        c = PT.hexc(hx); m.diffuse_color = (srgb2lin(c[0]), srgb2lin(c[1]), srgb2lin(c[2]), 1)
        m.use_nodes = True
        mats[name] = m
    return mats


def build_lod(lod, rig, mats):
    objs = [H.make_object(p, mats, None) for p in R.build(lod)]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = f"{UNIT}_LOD{lod}"; ob.data.name = ob.name
    ob.parent = rig
    md = ob.modifiers.new("rig", "ARMATURE"); md.object = rig
    return ob


def rest_frames(rig):
    return {b.name: b.matrix_local.to_3x3() for b in rig.data.bones}


def apply_pose(rig, RF, P):
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    for b, q in P.quats().items():
        Rm = RF[b]
        rig.pose.bones[b].rotation_quaternion = (Rm.inverted() @ q.to_matrix() @ Rm).to_quaternion()
    rig.pose.bones["root"].location = RF["root"].inverted() @ P.loc
    rig.pose.bones["ik_grip"].location = RF["ik_grip"].inverted() @ Vector((0, -(P.grip - 0.40), 0))
    rig.pose.bones["forearm.L"].constraints["offhand"].influence = P.ik
    # recipe-added helper constraints (named "x_*", e.g. a bowstring drawn to the right hand): P.cons[name] or 0
    cons = getattr(P, "cons", {})
    for b, v in getattr(P, "locs", {}).items():   # helper-bone offsets (IK targets), armature axes at the bone's rest
        rig.pose.bones[b].location = RF[b].inverted() @ Vector(v)
    for pb in rig.pose.bones:
        for cn in pb.constraints:
            if cn.name.startswith("x_"): cn.influence = cons.get(cn.name, 0.0)
    bpy.context.view_layer.update()


def run_pose(fn, t):
    """a clip's pose at t, with any two-handed grip (P.ik) solved exactly onto the haft (_work_anims.resolve_offhand)."""
    import _work_anims as WA
    P = A.Pose(); fn(t, P); WA.resolve_offhand(P); return P


def pose_clip(rig, RF, family, clip, t):
    fn = A.FAMILIES[family][clip][3]
    apply_pose(rig, RF, run_pose(fn, t))


def eval_mesh(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    oe = ob.evaluated_get(dg); me = oe.to_mesh()
    n = len(me.vertices)
    co = np.zeros(n * 3, np.float32); me.vertices.foreach_get("co", co)
    no = np.zeros(n * 3, np.float32); me.vertex_normals.foreach_get("vector", no)
    oe.to_mesh_clear()
    return co.reshape(n, 3), no.reshape(n, 3)


def snapshot(ob, name, loc=(0, 0, 0), rot_z=0.0, keep=None):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o)
    o.location = loc; o.rotation_euler = (0, 0, rot_z)
    sp = [f[6:] for f in FLAGS if f.startswith("parts=")]   # sheets: show only these optional parts (parts=1,7,9)
    if sp: keep = [int(x) for x in sp[0].split(",") if x]
    if keep is not None and "part" in me.attributes:        # else SPEC["clip_parts"][clip] (the clip's own loadout)
        n = len(me.vertices); part = np.zeros(n); me.attributes["part"].data.foreach_get("value", part)
        co = np.zeros(n * 3); me.vertices.foreach_get("co", co); co = co.reshape(n, 3)
        hide = (part > 0.5) & ~np.isin(np.round(part), keep)
        if hide.any(): co[hide] = co[~hide].mean(0); me.vertices.foreach_set("co", co.ravel()); me.update()
    return o


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ------------------------------------------------------------------------------------------ UV + paint
def unwrap(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        uv = o.data.uv_layers.new(name="bake"); o.data.uv_layers.active = uv
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=0.002, area_weight=1.0)
    bpy.ops.object.mode_set(mode="OBJECT")
    # texel density: faces and shield faces get more, the far LOD much less
    boost = SPEC.get("uv_boost", {"skin": 1.6, "shield_paint": 1.3})
    for o in objs:
        me = o.data; lod = o.name.endswith("LOD1")
        uv = np.zeros(len(me.loops) * 2); me.uv_layers["bake"].data.foreach_get("uv", uv); uv = uv.reshape(-1, 2)
        names = [m.name for m in me.materials]
        for p in me.polygons:
            k = 0.42 if lod else boost.get(names[p.material_index], 1.0)
            if k != 1.0:
                for li in p.loop_indices: uv[li] *= k
        me.uv_layers["bake"].data.foreach_set("uv", uv.ravel())
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(margin=4.0 / TEX, margin_method="FRACTION", shape_method="CONCAVE", rotate=True, scale=True)
    bpy.ops.object.mode_set(mode="OBJECT")


COVER = []  # per-mesh texel coverage from the last paint_all (used to merge the per-mesh AO bakes)


def paint_all(objs):
    """rasterise both LODs into one atlas and run the material painters."""
    S = TEX
    tid_all = -np.ones((S, S), np.int64); bary_all = np.zeros((S, S, 3))
    CO, NO, PAT, TV, TM, names = [], [], [], [], [], []
    COVER.clear()
    voff = 0; toff = 0
    for o in objs:
        me = o.data
        tid, bary, tverts, tmats = PT.rasterize(me, "bake", S)
        onames = [m.name for m in me.materials]
        for n in onames:
            if n not in names: names.append(n)
        remap = np.array([names.index(n) for n in onames])
        take = (tid >= 0) & (tid_all < 0)
        COVER.append(tid >= 0)
        # a texel covered for real by one mesh must not be stolen by the other's dilation: prefer
        # whichever mesh's raster actually hit it (dilated texels are re-marked below)
        tid_all[take] = tid[take] + toff; bary_all[take] = bary[take]
        nv = len(me.vertices)
        co = np.zeros(nv * 3); me.vertices.foreach_get("co", co)
        no = np.zeros(nv * 3); me.vertex_normals.foreach_get("vector", no)
        pat = np.zeros(nv * 3); me.attributes["pat"].data.foreach_get("vector", pat)
        CO.append(co.reshape(nv, 3)); NO.append(no.reshape(nv, 3)); PAT.append(pat.reshape(nv, 3))
        TV.append(tverts + voff); TM.append(remap[tmats])
        voff += nv; toff += len(tverts)
    co = np.concatenate(CO); no = np.concatenate(NO); pat = np.concatenate(PAT)
    tv = np.concatenate(TV); tm = np.concatenate(TM)
    m = tid_all >= 0
    t = tid_all[m]; b = bary_all[m]; vv = tv[t]
    def interp(Aa): return Aa[vv[:, 0]] * b[:, :1] + Aa[vv[:, 1]] * b[:, 1:2] + Aa[vv[:, 2]] * b[:, 2:3]
    P = interp(co); N = interp(no); N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-9
    PA = interp(pat); PD = pat[vv[np.arange(len(vv)), np.argmax(b, 1)]]
    mat_of = tm[t]
    col = np.full((S, S, 3), 0.5); rough = np.full((S, S), 0.8); mask = np.zeros((S, S, 3))
    AOW[:] = 1.0
    idx = np.argwhere(m)
    for mi, name in enumerate(names):
        sel = mat_of == mi
        if not sel.any(): continue
        rgb, r, mk = PT.PAINTERS[name](P[sel], N[sel], PA[sel], PD[sel])
        yy, xx = idx[sel, 0], idx[sel, 1]
        col[yy, xx] = rgb; rough[yy, xx] = r; mask[yy, xx] = mk
        AOW[yy, xx] = AO_WEIGHT.get(name, 1.0)
    return col, rough, mask


AO_WEIGHT = {"skin": 0.4, "iron": 0.7}   # faces inside hoods and helmets went black at full AO
AOW = np.ones((TEX, TEX), np.float32)


def np_to_image(name, arr, color=True):
    S = arr.shape[0]
    img = bpy.data.images.new(name, S, S, alpha=False)
    img.colorspace_settings.name = "sRGB" if color else "Non-Color"
    px = np.ones((S, S, 4), np.float32)
    if arr.ndim == 2: px[..., 0] = px[..., 1] = px[..., 2] = arr
    else: px[..., :3] = arr
    img.pixels.foreach_set(px.ravel())
    return img


def bake_ao(objs, rig, RF):
    """AO in a spread pose (arms out, legs apart) with the optional kit moved away, so hanging arms
    and a hanging shield don't print dark ghosts on the body."""
    sc = bpy.context.scene
    img = bpy.data.images.new("ao", TEX, TEX, alpha=False); img.colorspace_settings.name = "Non-Color"
    tmp = bpy.data.materials.new("ao_tmp"); tmp.use_nodes = True
    tn = tmp.node_tree.nodes.new("ShaderNodeTexImage"); tn.image = img; tmp.node_tree.nodes.active = tn
    saved = {}
    for o in objs:
        saved[o.name] = [s.material for s in o.material_slots]
        for s in o.material_slots: s.material = tmp
        me = o.data; n = len(me.vertices)
        part = np.zeros(n); me.attributes["part"].data.foreach_get("value", part)
        co = np.zeros(n * 3); me.vertices.foreach_get("co", co); co = co.reshape(n, 3)
        saved[o.name + "_co"] = co.copy()
        co[part > 0.5, 2] += 60.0
        me.vertices.foreach_set("co", co.ravel()); me.update()
    P = A.Pose()
    if "ao_rest" not in FLAGS:
        for s_ in ("L", "R"):
            P.arm(s_, "upperarm", -5, 62, 0); P.leg(s_, 0, 0, 0, 7)
    apply_pose(rig, RF, P)
    if "ao_single" in FLAGS: objs = objs[:1]
    # AO rays sampled round a SMOOTH normal dip under the flat facets of a low-poly tube and hit its own
    # far wall (black spikes in every face). Bake on a subdivided, genuinely smooth surface instead.
    for o in objs:
        sub = o.modifiers.new("ao_sub", "SUBSURF"); sub.levels = sub.render_levels = 2; sub.uv_smooth = "PRESERVE_BOUNDARIES"
    if not sc.world: sc.world = bpy.data.worlds.new("w")
    sc.world.light_settings.distance = 0.07
    sc.cycles.samples = 96
    sc.render.bake.margin = 6
    sc.render.bake.target = "IMAGE_TEXTURES"
    # one bake per mesh (a shared image baked from several objects only keeps the last one), merged by coverage
    ao = np.ones((TEX, TEX), np.float32); first = None
    for k, o in enumerate(objs):
        bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
        for q in objs: q.hide_render = q is not o     # the LODs overlap in space: each would shadow the other
        img.pixels.foreach_set(np.ones(TEX * TEX * 4, np.float32))
        bpy.ops.object.bake(type="AO")
        for q in objs: q.hide_render = False
        a_k = np.array(img.pixels[:], np.float32).reshape(TEX, TEX, 4)[..., 0]
        if first is None: first = a_k.copy(); ao = a_k.copy()
        elif k < len(COVER): ao[COVER[k]] = a_k[COVER[k]]
    if COVER: ao[COVER[0]] = first[COVER[0]]
    for o in objs:
        o.modifiers.remove(o.modifiers["ao_sub"])
        for s, m in zip(o.material_slots, saved[o.name]): s.material = m
        o.data.vertices.foreach_set("co", saved[o.name + "_co"].ravel()); o.data.update()
    apply_pose(rig, RF, A.Pose())
    return ao


def baked_material(col_img, rough_img):
    m = bpy.data.materials.new(UNIT); m.use_nodes = True
    n, l = m.node_tree.nodes, m.node_tree.links
    b = n["Principled BSDF"]
    uvn = n.new("ShaderNodeUVMap"); uvn.uv_map = "bake"
    tc = n.new("ShaderNodeTexImage"); tc.image = col_img
    tr = n.new("ShaderNodeTexImage"); tr.image = rough_img
    for t in (tc, tr): l.new(uvn.outputs["UV"], t.inputs["Vector"])
    l.new(tc.outputs["Color"], b.inputs["Base Color"])
    sep = n.new("ShaderNodeSeparateColor"); l.new(tr.outputs["Color"], sep.inputs["Color"])
    l.new(sep.outputs["Green"], b.inputs["Roughness"])
    b.inputs["Metallic"].default_value = 0.0
    return m, tc


# ------------------------------------------------------------------------------------------ VAT
def oct_encode(n):
    n = n / (np.abs(n).sum(1, keepdims=True) + 1e-9)
    x, y = n[:, 0].copy(), n[:, 1].copy()
    neg = n[:, 2] < 0
    x2 = (1 - np.abs(y)) * np.sign(x + 1e-12); y2 = (1 - np.abs(x)) * np.sign(y + 1e-12)
    x[neg], y[neg] = x2[neg], y2[neg]
    qx = np.clip(np.round((x * 0.5 + 0.5) * 255), 0, 255).astype(np.uint16)
    qy = np.clip(np.round((y * 0.5 + 0.5) * 255), 0, 255).astype(np.uint16)
    return (qx << 8) | qy


def bake_vat(objs, rig, RF):
    fam = SPEC["family"]; clips = SPEC.get("clips") or list(A.FAMILIES[fam].keys())
    frames_pos, frames_nrm, table = [], [], {}
    start = 0
    for name in clips:
        nf, fps, loop, fn, speed = A.FAMILIES[fam][name]
        for f in range(nf):
            t = f / nf if loop else f / (nf - 1)
            pose_clip(rig, RF, fam, name, t)
            cos, nos = [], []
            for o in objs:
                co, no = eval_mesh(o); cos.append(co); nos.append(no)
            co = np.concatenate(cos); no = np.concatenate(nos)
            # Blender (x, y, z) -> three.js (x, z, -y)
            frames_pos.append(np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1))
            frames_nrm.append(np.stack([no[:, 0], no[:, 2], -no[:, 1]], 1))
        table[name] = {"start": start, "frames": nf, "fps": fps, "loop": loop, "speed": speed}
        table[name].update(SPEC.get("clip_meta", {}).get(name, {}))   # e.g. shoot: {"loose": 0.64}
        CM = sys.modules.get("_combat_anims")                           # blows: {"hit": contact fraction}
        if CM: table[name].update(CM.CLIP_META.get(fam, {}).get(name, {}))
        start += nf
    apply_pose(rig, RF, A.Pose())
    pos = np.stack(frames_pos); nrm = np.stack(frames_nrm)      # (F, V, 3)
    lo = pos.reshape(-1, 3).min(0) - 0.01; hi = pos.reshape(-1, 3).max(0) + 0.01
    q = np.clip(np.round((pos - lo) / (hi - lo) * 65535), 0, 65535).astype(np.uint16)
    F, V = pos.shape[:2]
    on = oct_encode(nrm.reshape(-1, 3)).reshape(F, V)
    tex = np.zeros((F, V, 4), np.uint16); tex[..., :3] = q; tex[..., 3] = on
    W = 2048; total = F * V; Hh = (total + W - 1) // W
    flat = np.zeros((W * Hh, 4), np.uint16); flat[:total] = tex.reshape(-1, 4)
    with open(os.path.join(OUT, f"{UNIT}_vat.bin"), "wb") as fh:
        fh.write(flat.astype("<u2").tobytes())
    return table, (lo, hi), W, Hh, F


def set_vid_uv(objs):
    off = 0
    for o in objs:
        me = o.data
        uv = me.uv_layers.new(name="vid")
        n = len(me.loops)
        vi = np.zeros(n, np.int64); me.loops.foreach_get("vertex_index", vi)
        part = np.zeros(len(me.vertices)); me.attributes["part"].data.foreach_get("value", part)
        arr = np.zeros((n, 2), np.float32); arr[:, 0] = vi + off; arr[:, 1] = part[vi]
        uv.data.foreach_set("uv", arr.ravel())
        me.uv_layers.active = me.uv_layers["bake"]
        off += len(me.vertices)


def export(objs, rig):
    for o in objs:
        for m in list(o.modifiers): o.modifiers.remove(m)
        o.parent = None
        for g in list(o.vertex_groups): o.vertex_groups.remove(g)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    path = os.path.join(OUT, UNIT + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_apply=True, export_skins=False,
                              export_animations=False, export_morph=False, export_attributes=False,
                              export_image_format="JPEG", export_jpeg_quality=92, export_yup=True)
    return path


def update_index():
    arms = sorted(f[:-9] for f in os.listdir(OUT) if f.endswith("_vat.json"))
    with open(os.path.join(OUT, "index.json"), "w") as fh: json.dump({"arms": arms}, fh)


# ------------------------------------------------------------------------------------------ renders
def pose_sheet(ob, rig, RF, tag, direction):
    """Workbench contact sheet: one row per clip, frames left to right."""
    sc = bpy.context.scene
    fam = SPEC["family"]; clips = SPEC.get("clips") or list(A.FAMILIES[fam].keys())
    only = [f[5:] for f in FLAGS if f.startswith("only=")]
    if only: clips = [c for c in clips if c in only[0].split(",")]
    d = Vector(direction).normalized(); right = Vector((0, 0, 1)).cross(d).normalized()
    snaps = []
    maxn = 0
    for row, name in enumerate(clips):
        nf, fps, loop, fn, speed = A.FAMILIES[fam][name]
        step = 1 if (nf <= 12 or only) else 2
        k = 0
        fsel = [f[7:] for f in FLAGS if f.startswith("frames=")]   # sheets: just these frames (frames=6,9,10)
        for f in ([int(x) for x in fsel[0].split(",")] if fsel else range(0, nf, step)):
            t = f / nf if loop else f / (nf - 1)
            pose_clip(rig, RF, fam, name, t)
            loc = right * (k * 1.25) + Vector((0, 0, -row * 2.4))
            snaps.append(snapshot(ob, f"s_{name}_{f}", loc, keep=SPEC.get("clip_parts", {}).get(name))); k += 1
        maxn = max(maxn, k)
    apply_pose(rig, RF, A.Pose())
    for o in bpy.data.objects:
        if o.name.startswith(UNIT + "_LOD"): o.hide_render = True
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"; sc.display.shading.color_type = "MATERIAL"
    sc.display.shading.show_backface_culling = True
    sc.display.shading.show_cavity = True
    wm, hm = maxn * 1.25 + 0.5, len(clips) * 2.4 + 0.3
    sc.render.resolution_x = 1800; sc.render.resolution_y = int(1800 * hm / wm)
    cam_d = bpy.data.cameras.new("c"); cam_d.type = "ORTHO"; cam_d.ortho_scale = max(wm, hm)
    cam = bpy.data.objects.new("c", cam_d); sc.collection.objects.link(cam); sc.camera = cam
    centre = right * ((maxn - 1) * 1.25 / 2) + Vector((0, 0, -(len(clips) - 1) * 2.4 / 2 + 0.95))
    cam.location = centre + d * 20
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.join(SHEET_DIR, f"unit_{UNIT}_sheet_{tag}.png")
    bpy.ops.render.render(write_still=True)
    for s in snaps: bpy.data.objects.remove(s)
    print("SHEET", sc.render.filepath)


def close_sheets(ob, rig, RF):
    """one big Workbench sheet per clip for checking grips: every frame across, three views down
    (his right side, three-quarter front-right, his left side), only that clip's kit (SPEC["clip_parts"])."""
    sc = bpy.context.scene
    fam = SPEC["family"]; clips = SPEC.get("clips") or list(A.FAMILIES[fam].keys())
    only = [f[5:] for f in FLAGS if f.startswith("only=")]
    if only: clips = [c for c in clips if c in only[0].split(",")]
    for o in bpy.data.objects:
        if o.name.startswith(UNIT + "_LOD"): o.hide_render = True
    sc.render.engine = "BLENDER_WORKBENCH"; sc.display.shading.light = "STUDIO"; sc.display.shading.color_type = "MATERIAL"
    sc.display.shading.show_backface_culling = False; sc.display.shading.show_cavity = True
    views = (math.pi, 2.3, math.pi / 2, 0.0) if "front" in FLAGS else (math.pi, 2.3, 0.0)   # right, 3/4, [front,] left
    HB = [f[6:] for f in FLAGS if f.startswith("horse=")]   # horse=horse_destrier: ride* clips sit on that horse (rest pose)
    horse = None
    if HB:
        meta = json.load(open(os.path.join(OUT, HB[0] + "_vat.json"))); seat = meta.get("seatRest", [0, 1.4, 0])
        before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, HB[0] + ".glb"))
        for o in set(bpy.data.objects) - before:
            if o.type == "MESH" and "LOD0" in o.name: horse = o
            else: o.hide_render = True
        horse.hide_render = True; horse.matrix_world = Matrix.Translation((0, 0, -200))
        HOFF = Vector((-seat[0], seat[2], -seat[1]))   # three.js (x, y, z) -> Blender (x, -z, y), moved so the seat is at the origin
    for name in clips:
        nf, fps, loop, fn, speed = A.FAMILIES[fam][name]
        fsel = [f[7:] for f in FLAGS if f.startswith("frames=")]          # close: just these frames (frames=0,3,6,9)
        frames = [int(x) for x in fsel[0].split(",") if int(x) < nf] if fsel else list(range(nf))
        if "q4" in FLAGS: frames = sorted({round(k * (nf - 1) / 3) for k in range(4)})   # 4 frames evenly
        snaps = []
        for col, f in enumerate(frames):
            t = f / nf if loop else f / (nf - 1)
            pose_clip(rig, RF, fam, name, t)
            for row, rz in enumerate(views):
                loc = Vector((0, col * 2.0, -row * 2.5))
                if horse and name.startswith("ride"):
                    loc = loc + Vector((0, 0, 1.0))
                    h = horse.copy(); sc.collection.objects.link(h); h.hide_render = False
                    h.matrix_world = Matrix.Translation(loc) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Translation(HOFF); snaps.append(h)
                snaps.append(snapshot(ob, f"c_{name}_{f}_{row}", loc, rz, keep=SPEC.get("clip_parts", {}).get(name)))
        apply_pose(rig, RF, A.Pose())
        wm, hm = len(frames) * 2.0 + 0.4, len(views) * 2.5 + 0.3
        rw = min(3200, 700 * len(frames)); sc.render.resolution_x = rw; sc.render.resolution_y = int(rw * hm / wm)
        cd = bpy.data.cameras.new("cc"); cd.type = "ORTHO"; cd.ortho_scale = max(wm, hm)
        cam = bpy.data.objects.new("cc", cd); sc.collection.objects.link(cam); sc.camera = cam
        centre = Vector((0, (len(frames) - 1) * 1.0, -(len(views) - 1) * 1.25 + 0.95))
        cam.location = centre + Vector((20, 0, 0)); cam.rotation_euler = Vector((-1, 0, 0)).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(SHEET_DIR, f"close_{UNIT}_{name}.png")
        bpy.ops.render.render(write_still=True); print("CLOSE", sc.render.filepath)
        for s_ in snaps: bpy.data.objects.remove(s_)
        bpy.data.objects.remove(cam)


def _kit_shown(part, clip):
    """the engine's kit rules (js/render/figures.js kitBits) for shield-like parts: is `part` drawn in `clip`?"""
    if clip.endswith("_bare") or clip.endswith("_pollaxe"): return False       # no shield with a two-hander / bare
    fight = clip.startswith("strike") or clip in ("guard", "block", "parry", "bash", "shove", "hit") or clip.startswith("hit_")
    if part == "buckler": return fight
    if part == "buckler_belt": return not fight
    if part == "pavise": return clip in ("idle", "shoot", "reload")
    if part == "pavise_back": return clip not in ("idle", "shoot", "reload")
    return True


def clash_check(ob, rig, RF):
    """`clash`: per clip and frame, triangle-pair overlaps (BVH) between each shield-like part (shield, buckler,
    pavise) and the man's body (part 0), and his weapons; with horse=<key>, riding clips also against that horse
    (rest pose, seat at the origin). Prints the worst frame per clip; 0 everywhere is the goal."""
    from mathutils.bvhtree import BVHTree
    fam = SPEC["family"]; parts = SPEC.get("parts", {}); names = {v: k for k, v in parts.items()}
    shields = [pid for n, pid in parts.items() if any(k in n for k in ("shield", "buckler", "pavise"))]
    weapons = [pid for n, pid in parts.items() if pid not in shields and n not in ("helm", "cap", "hat", "visor", "mail")]
    me = ob.data; part = np.zeros(len(me.vertices)); me.attributes["part"].data.foreach_get("value", part); part = np.round(part).astype(int)
    polys = [list(p.vertices) for p in me.polygons]
    gname = {g.index: g.name for g in ob.vertex_groups}
    vbone = [gname.get(max(v.groups, key=lambda g: g.weight).group, "?") if len(v.groups) else "?" for v in me.vertices]
    groups = {}
    for p in polys:
        g = part[p[0]]; groups.setdefault(g, []).append(p)
    HB = [f[6:] for f in FLAGS if f.startswith("horse=")]; hbvh = None
    if HB:
        meta = json.load(open(os.path.join(OUT, HB[0] + "_vat.json"))); seat = meta.get("seatRest", [0, 1.4, 0])
        before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, HB[0] + ".glb"))
        hob = [o for o in set(bpy.data.objects) - before if o.type == "MESH" and "LOD0" in o.name][0]
        hv = [hob.matrix_world @ v.co + Vector((-seat[0], seat[2], -seat[1])) for v in hob.data.vertices]
        hbvh = BVHTree.FromPolygons(hv, [list(p.vertices) for p in hob.data.polygons])
    only = [f[5:] for f in FLAGS if f.startswith("only=")]
    total = 0
    for name, (nf, fps, loop, fn, sp) in A.FAMILIES[fam].items():
        if only and name not in only[0].split(","): continue
        worst = {}
        sfx = [names[wp] for wp in weapons if name.endswith("_" + names[wp])]
        allsfx = {c_.rsplit("_", 1)[-1] for c_ in A.FAMILIES[fam] if "_" in c_}
        carried = [wp for wp in weapons if names[wp] in sfx] if sfx else [wp for wp in weapons if names[wp] not in allsfx]
        for f in range(nf):
            pose_clip(rig, RF, fam, name, f / nf if loop else f / max(1, nf - 1))
            co, _ = eval_mesh(ob); V = [Vector(c) for c in co]
            bv = {g: BVHTree.FromPolygons(V, ps) for g, ps in groups.items()}
            for s_ in shields:
                if s_ not in bv or not _kit_shown(names[s_], name): continue
                tests = [("body", bv.get(0))] + [(names[wp], bv.get(wp)) for wp in carried if wp in bv]
                if hbvh and name.startswith("ride"): tests.append(("HORSE", hbvh))
                for tn, tb in tests:
                    if tb is None: continue
                    ov = bv[s_].overlap(tb); n = len(ov)
                    if tn == "body" and n:   # which bone's skin it cuts into
                        from collections import Counter
                        bp = groups[0]; cnt = Counter(vbone[bp[j][0]] for i_, j in ov)
                        tn = "body(" + ",".join(b for b, _ in cnt.most_common(2)) + ")"
                    k = f"{names[s_]}x{tn}"
                    if n > worst.get(k, (0, 0))[0]: worst[k] = (n, f)
            shown = [0] + [p_ for p_ in shields if _kit_shown(names[p_], name)] + carried
            msk = np.isin(part, shown); zz = np.where(msk, co[:, 2], 9.0); vi = int(zz.argmin()); zmin = float(zz[vi])
            fk = "FLOOR(" + (vbone[vi] if part[vi] == 0 else names.get(int(part[vi]), "?")) + ")"
            if zmin < -0.035 and worst.get(fk, (0, 0))[0] < -zmin * 100: worst[fk] = (round(-zmin * 100), f)
        bad = {k: v for k, v in worst.items() if v[0]}
        total += sum(v[0] for v in bad.values())
        print(f"CLASH {name:16s} " + ("ok" if not bad else "  ".join(f"{k}:{n}@f{f}" for k, (n, f) in sorted(bad.items()))))
    print(f"CLASH total {total}")


def grip_check(rig, RF):
    """every frame of every clip: how far each fist is from where the clip put it (P.err, analytic FK) and
    whether Blender's skinned pose agrees with that FK (fist position from the pose bones)."""
    import _arms_anims as AA
    fam = SPEC["family"]; worst = 0.0
    for name, (nf, fps, loop, fn, sp) in A.FAMILIES[fam].items():
        errs, dis = [], []
        for f in range(nf):
            P = run_pose(fn, f / nf if loop else f / max(1, nf - 1)); apply_pose(rig, RF, P)
            errs.append(max(getattr(P, "err", [0.0]) or [0.0]))
            if P.ik > 0:   # the old wrist-onto-a-point IK constraint: how far is the left FIST from its grip point?
                g = rig.pose.bones["ik_grip"].head; pb = rig.pose.bones["hand.L"]
                fl = pb.head + (pb.matrix.to_3x3() @ RF["hand.L"].inverted()) @ (H.fist("L") - rig.data.bones["hand.L"].head_local)
                errs[-1] = max(errs[-1], (fl - g).length * P.ik)
            for sd in ("L", "R"):
                pb = rig.pose.bones[f"hand.{sd}"]
                off = H.fist(sd) - rig.data.bones[f"hand.{sd}"].head_local
                blend = pb.head + (pb.matrix.to_3x3() @ RF[f"hand.{sd}"].inverted()) @ off
                p, r = AA.world(P, f"hand.{sd}")
                dis.append((blend - (p + r @ off)).length)
        worst = max(worst, max(errs))
        print(f"GRIP {name:12s} fist miss max {max(errs) * 100:5.1f} cm   blender-vs-FK max {max(dis) * 100:5.2f} cm")
    print(f"GRIP worst {worst * 100:.1f} cm")


def turnaround(ob, rig, RF):
    """big Workbench model sheet: front, three-quarter, side, back of the idle pose (all kit on)."""
    sc = bpy.context.scene
    pose_clip(rig, RF, SPEC["family"], "idle", 0.0)
    snaps = [snapshot(ob, f"t{i}", (i * 1.3, 0, 0), a) for i, a in enumerate((0, 0.6, math.pi / 2, math.pi))]
    apply_pose(rig, RF, A.Pose())
    for o in bpy.data.objects:
        if o.name.startswith(UNIT + "_LOD"): o.hide_render = True
    sc.render.engine = "BLENDER_WORKBENCH"; sc.display.shading.light = "STUDIO"; sc.display.shading.color_type = "MATERIAL"
    sc.display.shading.show_backface_culling = True; sc.display.shading.show_cavity = True
    sc.render.resolution_x = 1600; sc.render.resolution_y = 900
    cd = bpy.data.cameras.new("t"); cd.type = "ORTHO"; cd.ortho_scale = 5.4
    cam = bpy.data.objects.new("t", cd); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (1.95, -20, 1.0); cam.rotation_euler = (math.pi / 2, 0, 0)
    sc.render.filepath = os.path.join(BOOTH, f"unit_{UNIT}_model.png"); bpy.ops.render.render(write_still=True)
    for s in snaps: bpy.data.objects.remove(s)


def booth_material(col_img, mask_img, team, accent, dyes):
    """the engine's tint, rebuilt in nodes: albedo * mix(1, tint/neutral, mask) per channel;
    per-object random picks each man's dyes."""
    m = bpy.data.materials.new("booth_" + team); m.use_nodes = True
    n, l = m.node_tree.nodes, m.node_tree.links
    b = n["Principled BSDF"]; b.inputs["Roughness"].default_value = 0.85
    uvn = n.new("ShaderNodeUVMap"); uvn.uv_map = "bake"
    tc = n.new("ShaderNodeTexImage"); tc.image = col_img
    tm = n.new("ShaderNodeTexImage"); tm.image = mask_img
    for t in (tc, tm): l.new(uvn.outputs["UV"], t.inputs["Vector"])
    sep = n.new("ShaderNodeSeparateColor"); l.new(tm.outputs["Color"], sep.inputs["Color"])
    oi = n.new("ShaderNodeObjectInfo")
    def ramp(cols, off):
        r = n.new("ShaderNodeValToRGB"); r.color_ramp.interpolation = "CONSTANT"
        el = r.color_ramp.elements
        while len(el) < len(cols): el.new(0.5)
        for i, cx in enumerate(cols):
            c = PT.hexc(cx); el[i].position = i / len(cols); el[i].color = (srgb2lin(c[0]), srgb2lin(c[1]), srgb2lin(c[2]), 1)
        mth = n.new("ShaderNodeMath"); mth.operation = "FRACT"
        add = n.new("ShaderNodeMath"); add.operation = "MULTIPLY_ADD"; add.inputs[1].default_value = 7.13; add.inputs[2].default_value = off
        l.new(oi.outputs["Random"], add.inputs[0]); l.new(add.outputs[0], mth.inputs[0]); l.new(mth.outputs[0], r.inputs["Fac"])
        return r.outputs["Color"]
    def const(hx):
        c = PT.hexc(hx); r = n.new("ShaderNodeRGB"); r.outputs[0].default_value = (srgb2lin(c[0]), srgb2lin(c[1]), srgb2lin(c[2]), 1)
        return r.outputs[0]
    cur = tc.outputs["Color"]
    def tint(cur, colour, fac):
        div = n.new("ShaderNodeMix"); div.data_type = "RGBA"; div.blend_type = "MULTIPLY"
        div.inputs["Factor"].default_value = 1.0
        sc_ = n.new("ShaderNodeVectorMath"); sc_.operation = "SCALE"; sc_.inputs["Scale"].default_value = 1.0 / PT.NEUTRAL_LIN
        l.new(colour, sc_.inputs[0])
        l.new(cur, div.inputs["A"]); l.new(sc_.outputs[0], div.inputs["B"])
        mix = n.new("ShaderNodeMix"); mix.data_type = "RGBA"
        l.new(fac, mix.inputs["Factor"]); l.new(cur, mix.inputs["A"]); l.new(div.outputs["Result"], mix.inputs["B"])
        return mix.outputs["Result"]
    def band(src, a0, a1, b0, b1):
        r1 = n.new("ShaderNodeMapRange"); r1.inputs[1].default_value = a0; r1.inputs[2].default_value = a1
        l.new(src, r1.inputs[0])
        if b0 is None: return r1.outputs[0]
        r2 = n.new("ShaderNodeMapRange"); r2.inputs[1].default_value = b0; r2.inputs[2].default_value = b1
        r2.inputs[3].default_value = 1; r2.inputs[4].default_value = 0
        l.new(src, r2.inputs[0])
        mu = n.new("ShaderNodeMath"); mu.operation = "MULTIPLY"
        l.new(r1.outputs[0], mu.inputs[0]); l.new(r2.outputs[0], mu.inputs[1]); return mu.outputs[0]
    cur = tint(cur, const(team), sep.outputs["Red"])
    cur = tint(cur, const(accent), sep.outputs["Green"])
    cur = tint(cur, ramp(dyes["d1"], 0.0), band(sep.outputs["Blue"], 0.75, 0.95, None, None))
    cur = tint(cur, ramp(dyes["d2"], 0.37), band(sep.outputs["Blue"], 0.3, 0.45, 0.55, 0.7))
    l.new(cur, b.inputs["Base Color"])
    return m


def booth_scene():
    sc = bpy.context.scene
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
    g = bpy.context.object; gm = bpy.data.materials.new("ground"); gm.use_nodes = True
    gb = gm.node_tree.nodes["Principled BSDF"]; gb.inputs["Base Color"].default_value = (0.20, 0.23, 0.13, 1)
    gb.inputs["Roughness"].default_value = 0.95; g.data.materials.append(gm)
    sd = bpy.data.lights.new("sun", "SUN"); sd.energy = 4.0; sd.color = (1.0, 0.95, 0.86); sd.angle = math.radians(1.5)
    sun = bpy.data.objects.new("sun", sd); sc.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(48), 0, math.radians(-135))
    w = bpy.data.worlds.new("sky"); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]; bg.inputs["Color"].default_value = (0.55, 0.68, 0.85, 1); bg.inputs["Strength"].default_value = 0.9
    sc.render.engine = "CYCLES"
    sc.cycles.device = "GPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"; prefs.get_devices()
        for d in prefs.devices: d.use = True
    except Exception:
        sc.cycles.device = "CPU"
    sc.cycles.samples = 64; sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "AgX"
    sc.render.resolution_x = 1024; sc.render.resolution_y = 768
    cd = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cd); sc.collection.objects.link(cam); sc.camera = cam
    return cam


def shoot(cam, target, direction, dist, lens, name):
    sc = bpy.context.scene
    cam.data.lens = lens; d = Vector(direction).normalized()
    cam.location = Vector(target) + d * dist
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_start = 0.05; cam.data.clip_end = 1000
    sc.render.filepath = os.path.join(BOOTH, f"unit_{UNIT}_{name}.png")
    bpy.ops.render.render(write_still=True); print("BOOTH", sc.render.filepath)


def booth(ob, rig, RF, col_img, mask_img):
    fam = SPEC["family"]; dyes = SPEC["dyes"]
    cam = booth_scene()
    mats = [booth_material(col_img, mask_img, "2a55a5", "d9a927", dyes), booth_material(col_img, mask_img, "b0282a", "e9e4d6", dyes)]
    for o in bpy.data.objects:
        if o.name.startswith(UNIT + "_LOD"): o.hide_render = True
    import random
    rnd = random.Random(3)
    def place(clip, t, loc, rz, team, parts_on):
        pose_clip(rig, RF, fam, clip, t)
        o = snapshot(ob, f"b_{clip}", loc, rz)
        o.data.materials.clear(); o.data.materials.append(mats[team])
        # optional kit off: collapse hidden parts (same trick as the shader)
        me = o.data; n = len(me.vertices)
        part = np.zeros(n); me.attributes["part"].data.foreach_get("value", part)
        co = np.zeros(n * 3); me.vertices.foreach_get("co", co); co = co.reshape(n, 3)
        hide = (part > 0.5) & ~np.isin(np.round(part), list(parts_on))
        co[hide] = co[~hide].mean(0) if (~hide).any() else 0
        co[hide, 2] = -5
        me.vertices.foreach_set("co", co.ravel()); me.update()
        s = 0.94 + 0.09 * rnd.random(); o.scale = (s, s, s)
        return o
    dflt = SPEC.get("booth_parts", [1])
    # close: one man, three-quarter front, head to boots
    o = place("idle", 0.1, (0, 0, 0), 0, 0, dflt)
    shoot(cam, (0, 0, 0.98), (0.75, -1.0, 0.28), 3.2, 50, "close")
    o2 = place("idle", 0.1, (0, 0, 0), 0, 0, dflt)
    bpy.data.objects.remove(o)
    shoot(cam, (0, 0, 1.52), (0.55, -1.0, 0.12), 1.1, 60, "face")
    bpy.data.objects.remove(o2)
    # lineup: every clip at a telling moment
    lineup = SPEC["lineup"]
    objs = []
    for i, (clip, t, parts) in enumerate(lineup):
        objs.append(place(clip, t, (i * 1.25 - (len(lineup) - 1) * 0.625, 0, 0), 0.35 if clip != "fall" else 0.0, i % 2, parts))
    shoot(cam, (0, 0, 0.9), (0.35, -1.0, 0.30), 9.5 + len(lineup) * 0.3, 50, "lineup")
    for o in objs: bpy.data.objects.remove(o)
    # game camera: a company at the in-game ground/oblique zoom, ~70-110 m away through a long lens
    objs = []
    for r in range(4):
        for fcol in range(8):
            clip, t, parts = SPEC["crowd"](r, fcol, rnd)
            x = fcol * 1.0 + rnd.uniform(-0.12, 0.12); y = r * 1.1 + rnd.uniform(-0.1, 0.1)
            objs.append(place(clip, t, (x - 3.5, y, 0), rnd.uniform(-0.15, 0.15), 0 if r < 2 else 0, parts))
    for k in range(6):  # a few of the other side, and the fallen
        clip = "fall" if k < 2 else "strike"
        objs.append(place(clip, 1.0 if clip == "fall" else rnd.random(), (k * 1.3 - 3.2, -2.2 - rnd.random() * 0.6, 0), math.pi + rnd.uniform(-0.3, 0.3), 1, dflt))
    shoot(cam, (0, 0.5, 0.8), (0, -math.cos(math.radians(30)), math.sin(math.radians(30))), 85, 135, "game")
    shoot(cam, (0, 0.5, 0.8), (0.3, -math.cos(math.radians(55)), math.sin(math.radians(55))), 190, 135, "game_far")


# ------------------------------------------------------------------------------------------ main
def main():
    setup()
    mats = make_mats()
    rig = H.build_armature()
    if SPEC.get("rig"): SPEC["rig"](rig)      # recipe hook: extra helper bones / constraints (string, nock, ground)
    RF = rest_frames(rig)
    lod0 = build_lod(0, rig, mats)
    lod1 = build_lod(1, rig, mats)
    objs = [lod0, lod1]
    tris = [tri_count(o) for o in objs]
    print(f"UNIT {UNIT} tris LOD0={tris[0]} LOD1={tris[1]} verts={[len(o.data.vertices) for o in objs]}")
    if "ikcheck" in FLAGS:
        fam = SPEC["family"]
        for name, (nf, fps, loop, fn, sp) in A.FAMILIES[fam].items():
            ds = []
            for f in range(nf):
                P = A.Pose(); fn(f / nf, P); apply_pose(rig, RF, P)
                if P.ik > 0:
                    ds.append(round((rig.pose.bones["forearm.L"].tail - rig.pose.bones["ik_grip"].head).length, 3))
                    if "ikv" in FLAGS: print("  f", f, "shL", tuple(round(v, 2) for v in rig.pose.bones["upperarm.L"].head), "tgt", tuple(round(v, 2) for v in rig.pose.bones["ik_grip"].head), "fistR", tuple(round(v, 2) for v in rig.pose.bones["hand.R"].head))
            if ds: print("IK", name, ds)
    if "gripcheck" in FLAGS: grip_check(rig, RF)
    if "clash" in FLAGS: clash_check(lod0, rig, RF)
    if "close" in FLAGS:
        close_sheets(lod0, rig, RF)
        bpy.context.scene.render.engine = "CYCLES"
        for o in objs: o.hide_render = False
    if "sheet" in FLAGS:
        pose_sheet(lod0, rig, RF, "side", (1, 0, 0.12))
        pose_sheet(lod0, rig, RF, "front", (0.6, -1, 0.25))
        turnaround(lod0, rig, RF)
        bpy.context.scene.render.engine = "CYCLES"
        for o in objs: o.hide_render = False
    if "nobake" in FLAGS: return
    unwrap(objs)
    col, rough, mask = paint_all(objs)
    ao = bake_ao(objs, rig, RF)
    if "debug" in FLAGS:
        dbg = "/private/tmp/claude-501/-Users-maxlirio/0bb14be1-0061-401c-8927-e2e2fdc2e339/scratchpad"
        for nm, arr in (("ao", np.stack([ao] * 3, -1)), ("paint", col)):
            im = np_to_image("dbg_" + nm, arr.clip(0, 1), nm != "ao"); im.filepath_raw = f"{dbg}/{UNIT}_{nm}.png"; im.file_format = "PNG"; im.save()
    k = SPEC.get("ao", 0.65) * AOW
    col = col * (1 - k[..., None] + k[..., None] * ao[..., None])
    col_img = np_to_image(UNIT + "_col", col.clip(0, 1)); rough_img = np_to_image(UNIT + "_rough", np.stack([rough] * 3, -1), False)
    mask_img = np_to_image(UNIT + "_mask", mask.clip(0, 1), False)
    for img, nm in ((mask_img, "mask"), (col_img, "col")):
        img.filepath_raw = os.path.join(OUT, f"{UNIT}_{nm}.png"); img.file_format = "PNG"; img.save()
    rough_img.filepath_raw = os.path.join(OUT, f"{UNIT}_rough.png"); rough_img.file_format = "PNG"; rough_img.save()
    bm, _ = baked_material(col_img, rough_img)
    for o in objs:
        o.data.materials.clear(); o.data.materials.append(bm)
    table, (lo, hi), W, Hh, F = bake_vat(objs, rig, RF)
    if "booth" in FLAGS:
        booth(lod0, rig, RF, col_img, mask_img)
    set_vid_uv(objs)
    nverts = [len(o.data.vertices) for o in objs]
    path = export(objs, rig)
    meta = {"arm": UNIT, "family": SPEC["family"], "clips": table, "verts": nverts, "texWidth": W, "texHeight": Hh, "frames": F,
            "bounds": {"min": lo.tolist(), "max": hi.tolist()}, "parts": SPEC.get("parts", {}), "dyes": SPEC["dyes"],
            "neutral": PT.NEUTRAL_LIN, "tris": tris, "height": 1.72}
    with open(os.path.join(OUT, f"{UNIT}_vat.json"), "w") as fh: json.dump(meta, fh, indent=1)
    update_index()
    if os.path.abspath(OUT) == os.path.abspath(os.path.join(ROOT, "assets", "units")):   # the shipped folder: pack it
        sys.path.insert(0, HERE); import vat_pack; importlib.reload(vat_pack); vat_pack.pack(UNIT, 0.5)
    print(f"HG_UNIT {path} tris={tris} verts={nverts} frames={F} vat={W}x{Hh}")


main()
