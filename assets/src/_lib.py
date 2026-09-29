"""Shared helpers for every HIGHGROUND asset script. Read docs/art-bible.md first.

Usage from an asset script (run with: blender -b -P assets/src/<name>.py):

    import sys, os; sys.path.insert(0, os.path.dirname(__file__))
    import _lib as L
    L.reset()
    ... build procedural geometry + procedural node materials ...
    L.finish("oak", tex=2048, lods=(1.0, 0.35, 0.1))

finish() applies modifiers, joins everything opaque into ONE mesh, smart-UV-packs it,
bakes the procedural materials (base colour x AO, roughness, normal) into one texture
set, builds decimated LODs and exports assets/glb/<name>.glb with meshes <name>_LOD0..n.

Objects with obj["hg_nobake"] = True are exported as-is (use for alpha-cutout foliage
cards that already use an image texture, see make_image_material()).
"""
import bpy, bmesh, os, math, random
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GLB_DIR = os.path.join(ROOT, "assets", "glb")
TEX_DIR = os.path.join(ROOT, "assets", "tex")


def reset(seed=1):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    random.seed(seed)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"  # baking is small; avoids GPU contention between agents
    # many artist agents share one Mac: never let a single Blender take every core
    sc.render.threads_mode = "FIXED"; sc.render.threads = 2
    sc.cycles.samples = 16
    sc.unit_settings.scale_length = 1.0


# ---------------------------------------------------------------- materials
def mat(name):
    """New node material, returns (material, nodes, links, principled_bsdf)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    return m, nt.nodes, nt.links, nt.nodes["Principled BSDF"]


def assign(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)


def make_image_material(name, image, alpha_clip=True):
    m, n, l, b = mat(name)
    t = n.new("ShaderNodeTexImage"); t.image = image
    l.new(t.outputs["Color"], b.inputs["Base Color"])
    if alpha_clip:
        # glTF exporter only writes alphaMode MASK when alpha passes through a
        # Math:Round (cutoff 0.5); a direct link exports as BLEND (sorting artefacts).
        rnd = n.new("ShaderNodeMath"); rnd.operation = "ROUND"
        l.new(t.outputs["Alpha"], rnd.inputs[0])
        l.new(rnd.outputs[0], b.inputs["Alpha"])
        if hasattr(m, "blend_method"):
            m.blend_method = "CLIP"
    b.inputs["Roughness"].default_value = 0.8
    return m


# ---------------------------------------------------------------- geometry utils
def apply_all(obj):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects: o.select_set(False)
    obj.select_set(True)
    for mod in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except RuntimeError:
            obj.modifiers.remove(mod)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def ground_origin(objs):
    """Move everything so the combined footprint is centred on XY origin with base at z=0."""
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    off = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for o in objs:
        if o.parent is None:
            o.location -= off


# ---------------------------------------------------------------- bake
def _bake(obj, img, kind, **kw):
    for m in obj.data.materials:
        nt = m.node_tree
        node = nt.nodes.get("__bake__") or nt.nodes.new("ShaderNodeTexImage")
        node.name = "__bake__"; node.image = img
        nt.nodes.active = node
    bpy.context.scene.render.bake.margin = 8
    bpy.ops.object.bake(type=kind, **kw)


def finish(name, tex=1024, lods=(1.0, 0.4, 0.12), ao=0.85, smooth_angle=40):
    os.makedirs(GLB_DIR, exist_ok=True); os.makedirs(TEX_DIR, exist_ok=True)
    sc = bpy.context.scene
    meshes = [o for o in sc.objects if o.type == "MESH"]
    for o in meshes:
        apply_all(o)
    ground_origin([o for o in sc.objects if o.parent is None])
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.select_all(action="DESELECT"); o.select_set(True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    keep = [o for o in meshes if o.get("hg_nobake")]
    opaque = [o for o in meshes if not o.get("hg_nobake")]

    bpy.ops.object.select_all(action="DESELECT")
    for o in opaque: o.select_set(True)
    bpy.context.view_layer.objects.active = opaque[0]
    if len(opaque) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = name + "_LOD0"

    # UV: fresh atlas for bake
    uv = body.data.uv_layers.new(name="bake")
    body.data.uv_layers.active = uv
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=1.0)
    # margin as a fixed pixel fraction: the default SCALED method wastes ~98% of the atlas
    # when there are thousands of islands (measured: 2% UV coverage -> 40%+)
    bpy.ops.uv.pack_islands(margin=3.0 / tex, margin_method="FRACTION", shape_method="CONVEX")
    bpy.ops.object.mode_set(mode="OBJECT")

    imgs = {k: bpy.data.images.new(f"{name}_{k}", tex, tex, alpha=False)
            for k in ("col", "rough", "nrm", "ao")}
    imgs["nrm"].colorspace_settings.name = "Non-Color"
    imgs["rough"].colorspace_settings.name = "Non-Color"
    bpy.ops.object.select_all(action="DESELECT"); body.select_set(True)
    bpy.context.view_layer.objects.active = body
    sc.cycles.samples = 16
    _bake(body, imgs["col"], "DIFFUSE", pass_filter={"COLOR"})
    _bake(body, imgs["rough"], "ROUGHNESS")
    _bake(body, imgs["nrm"], "NORMAL")
    sc.cycles.samples = 64
    _bake(body, imgs["ao"], "AO")

    # multiply AO into albedo (numpy-free, keeps script dependency-free)
    import array
    c = array.array("f", [0.0]) * (tex * tex * 4); imgs["col"].pixels.foreach_get(c)
    a = array.array("f", [0.0]) * (tex * tex * 4); imgs["ao"].pixels.foreach_get(a)
    for i in range(0, len(c), 4):
        f = 1.0 - ao + ao * a[i]
        c[i] *= f; c[i + 1] *= f; c[i + 2] *= f
    imgs["col"].pixels.foreach_set(c)

    for k in ("col", "rough", "nrm"):
        p = os.path.join(TEX_DIR, f"{name}_{k}.png")
        imgs[k].filepath_raw = p; imgs[k].file_format = "PNG"; imgs[k].save()

    # swap to the baked material
    m, n, l, b = mat(name + "_baked")
    tc = n.new("ShaderNodeTexImage"); tc.image = imgs["col"]
    tr = n.new("ShaderNodeTexImage"); tr.image = imgs["rough"]
    tn = n.new("ShaderNodeTexImage"); tn.image = imgs["nrm"]
    nm = n.new("ShaderNodeNormalMap"); nm.uv_map = "bake"
    uvn = n.new("ShaderNodeUVMap"); uvn.uv_map = "bake"
    for t in (tc, tr, tn): l.new(uvn.outputs["UV"], t.inputs["Vector"])
    l.new(tc.outputs["Color"], b.inputs["Base Color"])
    l.new(tr.outputs["Color"], b.inputs["Roughness"])
    l.new(tn.outputs["Color"], nm.inputs["Color"])
    l.new(nm.outputs["Normal"], b.inputs["Normal"])
    b.inputs["Metallic"].default_value = 0.0
    body.data.materials.clear(); body.data.materials.append(m)
    # drop the other UV layers so the GLB carries one UV set
    for u in list(body.data.uv_layers):
        if u.name != "bake": body.data.uv_layers.remove(u)
    bpy.ops.object.select_all(action="DESELECT"); body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))

    # LODs
    out = [body]
    for i, ratio in enumerate(lods[1:], start=1):
        d = body.copy(); d.data = body.data.copy(); d.name = f"{name}_LOD{i}"
        sc.collection.objects.link(d)
        mod = d.modifiers.new("dec", "DECIMATE"); mod.ratio = ratio
        apply_all(d)
        out.append(d)
    for i, o in enumerate(keep):
        o.name = f"{name}_extra{i}"

    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    bpy.ops.object.select_all(action="DESELECT")
    for o in out + keep: o.select_set(True)
    path = os.path.join(GLB_DIR, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_apply=True,
                              export_image_format="JPEG", export_jpeg_quality=90)
    print(f"HG_EXPORT {path} LOD0_tris={tris} lods={len(out)} extras={len(keep)}")
    return path
