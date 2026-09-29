"""Castle photo booth: renders castle_*.glb pieces (or a composed test castle) under the game's lighting rig.

  tools/heavy.sh /opt/homebrew/bin/blender -t 2 -b -P assets/src/castle/castle_booth.py -- <glb> [views] [hide=part1,part2]
  views: comma list of 34,close,game,back,top,inside  (default 34,close,game)

Writes assets/booth/castle/<name>_<view>.png. Same rig as tools/booth.py (warm sun 42deg from the SW, blue
sky fill, AgX). The glTF importer loads the shared castle textures through their relative URIs, and this
script multiplies COLOR_0 (AO + weathering) into the base colour exactly as three.js does.
"""
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "assets", "booth", "castle")


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 4.0; sun_data.color = (1.0, 0.95, 0.86); sun_data.angle = math.radians(1.5)
    sun = bpy.data.objects.new("sun", sun_data); sc.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(48), 0, math.radians(-135))
    world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.55, 0.68, 0.85, 1); bg.inputs["Strength"].default_value = 0.9
    sc.render.engine = "CYCLES"
    sc.render.threads_mode = "FIXED"; sc.render.threads = 2
    sc.cycles.device = "GPU"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"; prefs.get_devices()
        for d in prefs.devices: d.use = True
    except Exception:
        sc.cycles.device = "CPU"
    sc.cycles.samples = 40
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "AgX"
    sc.render.resolution_x = 1024; sc.render.resolution_y = 768
    return sc


def import_glb(path, loc=(0, 0, 0), rot=0.0, hide=(), lod=0, show=()):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    for o in roots:
        o.location = Vector(o.location) + Vector(loc)
        o.rotation_euler.z += rot
        if rot:
            # rotate about the piece origin
            p = Vector(o.location) - Vector(loc)
            c, s = math.cos(rot), math.sin(rot)
            o.location = Vector(loc) + Vector((p.x * c - p.y * s, p.x * s + p.y * c, p.z))
    for o in new:
        if o.type != "MESH":
            continue
        nm = o.name.split(".")[0]
        if "_LOD" in nm and not nm.endswith(f"_LOD{lod}"):
            o.hide_render = True
        base = nm.split("_LOD")[0]
        if base in hide or any(base.startswith(h) for h in hide if h.endswith("*") and False):
            o.hide_render = True
        for h in hide:
            if h.endswith("*") and base.startswith(h[:-1]):
                o.hide_render = True
        if base in show and ("_LOD" not in nm or nm.endswith(f"_LOD{lod}")):
            o.hide_render = False
    wire_vcol()
    return [o for o in new if o.type == "MESH" and not o.hide_render]


_done = set()


def wire_vcol():
    for o in bpy.data.objects:
        if o.type != "MESH" or not o.data.color_attributes:
            continue
        cname = o.data.color_attributes[0].name
        for m in o.data.materials:
            if not m or m.name in _done or not m.use_nodes:
                continue
            nt = m.node_tree
            b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if not b:
                continue
            src = b.inputs["Base Color"].links[0].from_socket if b.inputs["Base Color"].links else None
            if src and src.node.type == "MIX" and src.node.get("hg_vc"):
                _done.add(m.name); continue
            # already vertex-colour driven?
            if src and src.node.type in ("VERTEX_COLOR", "ATTRIBUTE"):
                _done.add(m.name); continue
            ca = nt.nodes.new("ShaderNodeVertexColor"); ca.layer_name = cname
            mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MULTIPLY"; mx["hg_vc"] = 1
            mx.inputs["Factor"].default_value = 1.0
            if src:
                # the importer may already multiply by vertex colour (a Mix fed by a Color Attribute)
                if src.node.type == "MIX" and any(l.from_node.type in ("VERTEX_COLOR", "ATTRIBUTE") for i in src.node.inputs for l in i.links):
                    _done.add(m.name); nt.nodes.remove(ca); nt.nodes.remove(mx); continue
                nt.links.new(src, mx.inputs["A"])
            else:
                mx.inputs["A"].default_value = tuple(b.inputs["Base Color"].default_value)
            nt.links.new(ca.outputs["Color"], mx.inputs["B"])
            nt.links.new(mx.outputs["Result"], b.inputs["Base Color"])
            _done.add(m.name)


def ground(center, size, z=0.0):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(center.x, center.y, z - 0.01))
    g = bpy.context.object
    gm = bpy.data.materials.new("booth_ground"); gm.use_nodes = True
    b = gm.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.20, 0.23, 0.13, 1); b.inputs["Roughness"].default_value = 0.95
    g.data.materials.append(gm)
    return g


def bounds(objs):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi


def camera():
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam); sc.camera = cam
    return cam, cd


def shoot(cam, cd, path, target, direction, dist, lens):
    cd.lens = lens
    d = Vector(direction).normalized()
    cam.location = Vector(target) + d * dist
    cd.clip_start = 0.05; cd.clip_end = dist * 20 + 500
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("BOOTH wrote", path)


def fit_dist(r, lens, fill, cd):
    sc = bpy.context.scene
    fov = 2 * math.atan(cd.sensor_width / 2 / lens) * (sc.render.resolution_y / sc.render.resolution_x)
    return r / math.tan(fov / 2) / fill


if __name__ == "__main__":
    glb = argv[0]
    views = (argv[1] if len(argv) > 1 and "=" not in argv[1] else "34,close,game").split(",")
    hide = []; tag = ""; show = []
    for a in argv[1:]:
        if a.startswith("hide="):
            hide = a[5:].split(",")
        if a.startswith("show="):
            show = a[5:].split(",")
        if a.startswith("tag="):
            tag = a[4:]
    os.makedirs(OUT, exist_ok=True)
    name = os.path.splitext(os.path.basename(glb))[0].replace("castle_", "")
    sc = setup_scene()
    objs = import_glb(glb, hide=hide, show=show)
    lo, hi = bounds(objs)
    center = (lo + hi) / 2; size = (hi - lo).length
    if "noground" not in argv:
        ground(center, max(60, size * 8))
    else:
        ground(center, max(60, size * 8), z=lo.z - 0.3)
    cam, cd = camera()
    h = hi.z - max(lo.z, 0)
    for v in views:
        p = os.path.join(OUT, f"{name}{tag}_{v}.png")
        if v == "34":
            shoot(cam, cd, p, center, (1, -1.1, 0.75), fit_dist(size / 2, 50, 0.9, cd), 50)
        elif v == "back":
            shoot(cam, cd, p, center, (-0.9, 1.1, 0.7), fit_dist(size / 2, 50, 0.9, cd), 50)
        elif v == "close":
            t = Vector((center.x * 0.5 + lo.x * 0.5 + (hi.x - lo.x) * 0.15, lo.y, lo.z + h * 0.62))
            shoot(cam, cd, p, t, (0.55, -1, 0.18), 6.5, 35)
        elif v == "closein":
            t = Vector((center.x, hi.y, lo.z + h * 0.8))
            shoot(cam, cd, p, t, (-0.5, 1, 0.5), 7.5, 30)
        elif v == "game":
            shoot(cam, cd, p, center, (0, -math.cos(math.radians(55)), math.sin(math.radians(55))), fit_dist(size / 2, 135, 0.12, cd), 135)
        elif v == "gamenear":
            shoot(cam, cd, p, center, (0, -math.cos(math.radians(55)), math.sin(math.radians(55))), fit_dist(size / 2, 50, 0.55, cd), 50)
        elif v == "top":
            shoot(cam, cd, p, center, (0.001, -0.25, 1), fit_dist(size / 2, 50, 0.8, cd), 50)
        elif v == "inside":
            shoot(cam, cd, p, center, (0.35, 0.3, 1), fit_dist(size / 2, 40, 0.8, cd), 40)
        elif v == "walk":
            # standing on the wall-walk looking along it
            t = Vector((hi.x - 0.5, 0.3, 9.5))
            cam_loc = Vector((lo.x + 0.6, 0.6, 9.7))
            shoot(cam, cd, p, t, (cam_loc - t), (cam_loc - t).length, 24)
